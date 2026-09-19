import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import db from '../db/database.js';
import { signToken } from '../auth/jwt.js';
import { verifyCfAccess, cfAccessEnabled } from '../auth/cloudflare.js';
import { googleEnabled, verifyGoogle } from '../auth/google.js';
import { limitePorIp } from '../auth/rate-limit.js';
import { CONFLICTO_IDENTIDAD, UserError, findByEmailOrLegacy, leerMe } from '../users/service.js';
import { handle } from './handle.js';

const router = Router();

// NO HAY REGISTRO PÚBLICO, y no es que esté apagado: la ruta no existe. Antes era
// POST /register detrás de ALLOW_REGISTRATION, un flag que se abría "un momento" para
// crear a alguien y se volvía a cerrar — o sea, una ruta de alta sin autenticar cuya
// única defensa era acordarse de volver a apagarla.
//
// Las altas van por los dos caminos que piden ser admin:
//   · POST /api/admin/users  (api/admin-users.js)
//   · npm run users -- create <usuario>  (admin/users.js)
// Los dos comparten las reglas de users/service.js, así que validan igual.
//
// El alta automática por Cloudflare Access (POST /cf, más abajo) NO es una excepción a
// esto y nunca dependió del flag: ahí la identidad ya viene verificada por Cloudflare,
// y quién puede tener cuenta lo decide la política de Access.

/**
 * Crea (o recupera) el usuario asociado a un email verificado por Cloudflare.
 * Como estos usuarios nunca inician sesión por contraseña, guardamos un hash
 * aleatorio e inutilizable para cumplir el NOT NULL de password_hash.
 *
 * BUSCA POR EMAIL Y NO POR USERNAME, que es el cambio que hace posible renombrarse.
 * Antes era `WHERE username = ?`: el día que alguien se cambiaba el nombre, el
 * siguiente login por Google no lo encontraba y le creaba una cuenta nueva, con sus
 * playlists y su historial en la vieja.
 *
 * Los tres caminos, en este orden:
 *   1. POR EMAIL — el caso normal a partir de la segunda vez.
 *   2. LEGADO: la fila guarda el correo en el username y todavía no tiene email.
 *   3. NUEVA.
 *
 * Los dos primeros son `findByEmailOrLegacy` (users/service.js), que es donde está
 * explicado el cuidado del paso 2, y los comparte con POST /google. Lo único propio de
 * acá es el paso 3: /cf da de alta porque la política de Access ya decidió quién entra.
 * El conflicto del paso 2 sale como `null`, que es lo que este contrato devolvía antes
 * de que la búsqueda se mudara al servicio.
 */
// Exportada SOLO para poder probarla: es la función que decide si una identidad de
// Google es alguien que ya existe o alguien nuevo, y esa decisión no se puede
// verificar de verdad desde fuera del proceso (haría falta una identidad de
// Cloudflare firmada). El router sigue siendo su único llamador en producción.
export async function upsertUserByEmail(email) {
  const mail = String(email ?? '').trim().toLowerCase();
  if (!mail) return null;

  let existente;
  try {
    existente = findByEmailOrLegacy(mail);
  } catch (e) {
    if (e instanceof UserError && e.status === 409) return null;
    throw e;
  }
  if (existente) return existente;

  const hash = await bcrypt.hash(randomUUID(), 12);
  const info = db.prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)')
    .run(mail, mail, hash);
  return { id: Number(info.lastInsertRowid), username: mail };
}

// ACEPTA EL USERNAME O EL EMAIL en el mismo campo. Desde que uno se puede renombrar,
// exigir el nombre exacto sería pedirle a la gente que recuerde cuál de los dos puso
// la última vez; el correo, en cambio, no cambia.
//
// Se prueban en DOS pasos y no con un `OR`, para que el resultado sea siempre el
// mismo: nada impide que el username de alguien sea el email de otro (los dos campos
// admiten arroba), y con un `OR` cuál de las dos filas vuelve lo decidiría SQLite.
// **Gana el username**, que es el identificador principal.
router.post('/login', async (req, res) => {
  const { username, password } = req.body ?? {};
  const ident = String(username ?? '').trim();

  // Sin uno de los dos no hay nada que comparar, y bcrypt.compare(undefined, hash)
  // RECHAZA: en una ruta async eso es una promesa sin dueño, no un 401.
  if (!ident || !password) return res.status(401).json({ error: 'Invalid credentials' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(ident)
    ?? db.prepare('SELECT * FROM users WHERE email = ?').get(ident.toLowerCase());

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  res.json({ token: signToken({ id: user.id, username: user.username }) });
});

// Auto-login vía Cloudflare Access. El frontend lo llama al cargar: si la
// petición trae una identidad CF válida (JWT firmado por Cloudflare), canjea
// esa identidad por el JWT normal de la app. Si no, responde 401 y el frontend
// cae al formulario usuario/contraseña (caso red local sin Cloudflare).
router.post('/cf', async (req, res) => {
  const identity = await verifyCfAccess(req);
  if (!identity) return res.status(401).json({ error: 'No Cloudflare identity' });

  const user = await upsertUserByEmail(identity.email);

  // `null` = no se pudo decidir de quién es esa identidad (ver el paso 2 de arriba).
  // Es 409 y no 401: la identidad de Cloudflare está bien verificada — lo que está en
  // conflicto es a qué cuenta de acá corresponde, y eso lo arregla un admin
  // renombrando a quien ocupa ese nombre.
  if (!user) return res.status(409).json({ error: CONFLICTO_IDENTIDAD });

  res.json({ token: signToken({ id: user.id, username: user.username }) });
});

// ---- Login con Google desde la app ----
//
// La app manda el ID token que le dio Google (su cliente OAuth de iOS) y recibe el JWT de
// siempre. SIN authMiddleware: es un login, el que llama todavía no tiene token.
//
// ⚠️ NO CREA CUENTAS, y es la diferencia de fondo con /cf. Allá la política de Cloudflare
// Access ya decidió quién puede entrar antes de que la petición llegue, así que dar de
// alta es seguro. Acá no filtró nadie: cualquiera con una cuenta de Google puede sacar un
// token para nuestra app. Si esto creara cuentas, el login con Google sería un registro
// abierto al mundo. Así que solo entra quien YA tiene cuenta —por su correo, o por el
// legado del correo guardado como nombre— y el resto recibe 403.
//
// EL VERIFICADOR ENTRA INYECTADO (`verificar`), para poder probar la ruta entera sin un
// token real de Google: scripts/smoke-google.mjs levanta el servidor con el falso.
export function crearLoginGoogle({ verificar, habilitado }) {
  return handle(async (req, res) => {
    if (!habilitado) return res.status(503).json({ error: 'Google no está configurado' });

    const idToken = req.body?.idToken;
    if (typeof idToken !== 'string' || !idToken.trim()) {
      return res.status(400).json({ error: 'Falta el idToken.' });
    }

    let identidad;
    try {
      identidad = await verificar(idToken.trim());
    } catch (e) {
      // El motivo va al log y NO a la respuesta: "audiencia equivocada" es exactamente
      // lo que hay que ver cuando se configura el cliente, y exactamente lo que no hay
      // que contarle a quien está probando tokens. El token no se loguea nunca.
      console.warn('[google] token rechazado:', e?.message ?? e);
      return res.status(401).json({ error: 'No se pudo verificar tu cuenta de Google.' });
    }

    if (typeof identidad?.email !== 'string' || !identidad.email.trim()) {
      return res.status(401).json({ error: 'No se pudo verificar tu cuenta de Google.' });
    }
    // `=== true` y no "truthy": un correo sin verificar es un correo que cualquiera
    // pudo escribir, y es justo con lo que se busca la cuenta.
    if (identidad.email_verified !== true) {
      return res.status(401).json({ error: 'Tu correo de Google no está verificado.' });
    }

    // Lanza UserError 409 si el correo choca con el nombre de otra cuenta: `handle` lo
    // convierte en el mismo 409 que da /cf.
    const user = findByEmailOrLegacy(identidad.email);
    if (!user) {
      return res.status(403).json({ error: 'Esta cuenta no tiene acceso. Pídeselo a Oscar.' });
    }

    // El token es el de /login, firmado igual. `me` va además para que la app no tenga
    // que pedir GET /api/me enseguida: es la misma forma que devuelve esa ruta.
    res.json({
      token: signToken({ id: user.id, username: user.username }),
      me: leerMe(user.id),
    });
  });
}

// 10 intentos por IP cada 15 minutos. Un login legítimo es uno; diez ya es alguien
// probando tokens o un cliente roto en un bucle, y en los dos casos conviene frenar antes
// de pedirle a Google que verifique cada uno.
const limiteGoogle = limitePorIp({
  max: 10,
  ventanaMs: 15 * 60 * 1000,
  mensaje: 'Demasiados intentos. Espera unos minutos y vuelve a probar.',
});

router.post('/google', limiteGoogle, crearLoginGoogle({ verificar: verifyGoogle, habilitado: googleEnabled }));

// Config PÚBLICA del login: SIN auth middleware (este router es público — es la pantalla
// de login, el usuario aún no tiene token; gatearlo sería un catch-22). Solo expone si el
// auto-login por Cloudflare Access está disponible, para que el frontend decida si mostrar
// el botón "Iniciar sesión con Google". NO filtra el AUD ni el team domain: cfAccessEnabled
// es un booleano puro (Boolean(TEAM_DOMAIN && AUD), ver cloudflare.js).
router.get('/config', (_req, res) => res.json({ sso: cfAccessEnabled }));

export default router;
