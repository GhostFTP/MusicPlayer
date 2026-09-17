import jwt from 'jsonwebtoken';
import db from '../db/database.js';

const SECRET = process.env.JWT_SECRET ?? 'change-me-in-production';
const EXPIRES = '7d';

export function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES });
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token ?? null;

  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Gatea por ROL, y va SIEMPRE detrás de authMiddleware, que es quien deja `req.user`.
// Suelto no sirve: sin ese middleware delante, `req.user` es undefined y esto le
// respondería 403 a todo el mundo. Por eso vive pegado a él y no en otro archivo —
// el orden es parte de cómo se usa, y acá se ve de un vistazo.
//
// LEE LA BASE, NO EL TOKEN, y es una decisión tomada, no una distracción:
//   · El rol cambia sin que la persona vuelva a entrar. Con el rol adentro del JWT,
//     ascender a alguien no haría nada hasta que su token venza —hasta 7 días—, y
//     DEGRADARLO sería peor: seguiría siendo admin toda esa semana, que es justo el
//     caso en el que uno necesita que el cambio valga YA.
//   · Por eso signToken() NO se toca. Ningún token viejo arrastra privilegios,
//     porque ninguno los lleva escritos: el permiso se pregunta cada vez.
// El precio es un SELECT por petición administrativa. Son cuatro endpoints que usa
// una persona cada tanto; no hay nada que optimizar acá.
export function requireAdmin(req, res, next) {
  const row = db.prepare('SELECT role FROM users WHERE id = ?').get(req.user?.id);

  // Un usuario BORRADO con un token todavía vigente cae acá: la fila ya no existe,
  // así que no es admin y no pasa. Es 403 y no 401 a propósito — el token está bien
  // firmado y no vencido; lo que falta es el permiso, no la identidad.
  if (row?.role !== 'admin') return res.status(403).json({ error: 'admin required' });

  next();
}
