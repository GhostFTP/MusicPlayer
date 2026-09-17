import { Router } from 'express';
import db from '../db/database.js';
import { authMiddleware } from '../auth/jwt.js';

const router = Router();

// Quién soy. Lo lee de la BASE y no del token, por el mismo motivo que requireAdmin
// (auth/jwt.js): el JWT congela id y username en el momento del login y el rol no
// está ahí a propósito. Si esto contestara con lo del token, un ascenso a admin no
// se vería hasta dentro de siete días.
//
// COLUMNAS NOMBRADAS, nunca `SELECT *`: password_hash vive en esta misma tabla, y un
// `*` lo mandaría por la red al primer descuido. Es la misma regla que sigue el CLI.
router.get('/', authMiddleware, (req, res) => {
  const user = db
    .prepare('SELECT id, username, role, created_at FROM users WHERE id = ?')
    .get(req.user.id);

  // Token válido de un usuario que ya no está (lo borró un admin mientras su sesión
  // seguía viva). No es 401: el token no tiene nada de malo — el que no existe es el
  // usuario, y decirle "credenciales inválidas" mandaría a buscar el problema al
  // lado equivocado.
  if (!user) return res.status(404).json({ error: 'User not found' });

  res.json(user);
});

export default router;
