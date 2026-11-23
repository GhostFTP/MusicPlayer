import jwt from 'jsonwebtoken';
import db from '../db/database.js';

const SECRET = process.env.JWT_SECRET ?? 'change-me-in-production';
// LA SESIÓN DURA 90 DÍAS, y es el ÚNICO lugar donde se decide: los cuatro que emiten un
// token (/login, /cf, /google y PATCH /api/me) y POST /api/auth/renovar pasan todos por
// signToken. Hasta S0 eran 7 días y nada renovaba, así que la familia volvía a ver el login
// cada semana. Ahora la app pide uno nuevo con /renovar cuando al suyo le quedan menos de 60
// días (api/auth.js).
//
// Un token ya emitido NO cambia: el `exp` va adentro y firmado, así que los de 7 días
// siguen valiendo hasta su fecha y los nuevos salen con 90.
//
// El precio, aceptado por Oscar: un token robado vive mientras alguien lo renueve. Lo
// cortan dos cosas: borrar la cuenta (cuentaExiste, abajo) o rotar JWT_SECRET, que echa a
// todos. Cambiar la contraseña no lo corta.
const EXPIRES = '90d';

export function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES });
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

// ¿LA CUENTA DEL TOKEN TODAVÍA EXISTE? Desde 1.19.0, sí se pregunta en cada petición.
//
// Hasta ahí un token bien firmado y sin vencer bastaba, y un usuario BORRADO por un admin
// seguía viendo el catálogo y escuchando música con su sesión vieja hasta que venciera: solo
// /api/me y las rutas de admin se enteraban. Ahora borrar corta al momento.
//
// El precio es UNA lectura por clave primaria por petición —medida en ~5 µs con la base de
// desarrollo, contra ~1,1 ms que tarda una petición entera de catálogo—, así que no hay
// caché: una caché de 30 s justo reabriría la ventana que esto viene a cerrar.
//
// Lo usan los DOS porteros: `authMiddleware` y el de /stream (src/stream/stream.js), que
// no pasa por el middleware porque acepta el token por query para `<audio src>`. Si hay un
// tercero algún día, tiene que llamar a esto también, o una cuenta borrada entra por ahí.
const EXISTE = db.prepare('SELECT 1 FROM users WHERE id = ?');

export function cuentaExiste(id) {
  // Un token sin `id` entero no es de ninguna cuenta (y bindear `undefined` lanzaría).
  return Number.isInteger(id) && EXISTE.get(id) !== undefined;
}

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token ?? null;

  if (!token) return res.status(401).json({ error: 'No token' });

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // 401 y no 404: para quien llama, una sesión de una cuenta que ya no existe es una
  // sesión que ya no sirve, y lo que tiene que hacer es lo mismo que con una vencida —
  // volver a entrar—. La app lo trata así.
  if (!cuentaExiste(payload?.id)) return res.status(401).json({ error: 'User not found' });

  req.user = payload;
  next();
}

// Gatea por ROL, y va SIEMPRE detrás de authMiddleware, que es quien deja `req.user`.
// Suelto no sirve: sin ese middleware delante, `req.user` es undefined y esto le
// respondería 403 a todo el mundo. Por eso vive pegado a él y no en otro archivo —
// el orden es parte de cómo se usa, y acá se ve de un vistazo.
//
// LEE LA BASE, NO EL TOKEN, y es una decisión tomada, no una distracción:
//   · El rol cambia sin que la persona vuelva a entrar. Con el rol adentro del JWT,
//     ascender a alguien no haría nada hasta que su token venza —hasta 90 días—, y
//     DEGRADARLO sería peor: seguiría siendo admin todo ese tiempo, que es justo el
//     caso en el que uno necesita que el cambio valga YA.
//   · Por eso signToken() NO se toca. Ningún token viejo arrastra privilegios,
//     porque ninguno los lleva escritos: el permiso se pregunta cada vez.
// El precio es un SELECT por petición administrativa. Son cuatro endpoints que usa
// una persona cada tanto; no hay nada que optimizar acá.
export function requireAdmin(req, res, next) {
  const row = db.prepare('SELECT role FROM users WHERE id = ?').get(req.user?.id);

  // Un usuario BORRADO ya no llega acá desde 1.19.0: authMiddleware lo corta antes con
  // 401. Si igual la fila no está (lo borraron entre una lectura y la otra), no es admin y
  // no pasa, con 403.
  if (row?.role !== 'admin') return res.status(403).json({ error: 'admin required' });

  next();
}
