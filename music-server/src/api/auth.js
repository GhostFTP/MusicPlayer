import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import db from '../db/database.js';
import { signToken } from '../auth/jwt.js';
import { verifyCfAccess, cfAccessEnabled } from '../auth/cloudflare.js';

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
 *   2. LEGADO: la fila guarda el correo en el username y todavía no tiene email. Pasa
 *      con las cuentas que un admin dio de alta usando el correo como nombre y que
 *      después entran por Google por primera vez. Se le escribe el email y queda
 *      resuelto para siempre.
 *   3. NUEVA.
 *
 * ⚠️ EL PASO 2 ADOPTA SOLO SI LA FILA NO TIENE EMAIL, y no es una comprobación de
 * más: desde que existe el rename, alguien podría llamarse igual que el correo de
 * otra persona. Si esa fila YA tiene un email —el suyo, distinto—, entonces el
 * username coincide pero la identidad no, y fusionarlas le daría a quien entra la
 * cuenta de otro. Ahí no se adivina: se corta y se avisa.
 */
// Exportada SOLO para poder probarla: es la función que decide si una identidad de
// Google es alguien que ya existe o alguien nuevo, y esa decisión no se puede
// verificar de verdad desde fuera del proceso (haría falta una identidad de
// Cloudflare firmada). El router sigue siendo su único llamador en producción.
export async function upsertUserByEmail(email) {
  const mail = String(email ?? '').trim().toLowerCase();
  if (!mail) return null;

  const porEmail = db.prepare('SELECT id, username FROM users WHERE email = ?').get(mail);
  if (porEmail) return porEmail;

  const legado = db.prepare('SELECT id, username, email FROM users WHERE lower(username) = ?').get(mail);
  if (legado) {
    // Con un email distinto, el nombre coincide por casualidad y la identidad no.
    if (legado.email != null) return null;
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(mail, legado.id);
    return { id: legado.id, username: legado.username };
  }

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
  if (!user) {
    return res.status(409).json({
      error: 'Ese correo coincide con el nombre de otra cuenta. Avisa a quien administra el servidor.',
    });
  }

  res.json({ token: signToken({ id: user.id, username: user.username }) });
});

// Config PÚBLICA del login: SIN auth middleware (este router es público — es la pantalla
// de login, el usuario aún no tiene token; gatearlo sería un catch-22). Solo expone si el
// auto-login por Cloudflare Access está disponible, para que el frontend decida si mostrar
// el botón "Iniciar sesión con Google". NO filtra el AUD ni el team domain: cfAccessEnabled
// es un booleano puro (Boolean(TEAM_DOMAIN && AUD), ver cloudflare.js).
router.get('/config', (_req, res) => res.json({ sso: cfAccessEnabled }));

export default router;
