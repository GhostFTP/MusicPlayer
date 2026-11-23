// GET /api/servidor → { estado, version, uptime_s, admin }
//
// Lo que cualquiera con sesión puede saber del servidor: si anda bien, qué versión corre y si
// quien pregunta es admin (para que Ajustes sepa si ofrecer el detalle). El detalle está en
// GET /api/admin/servidor (api/admin-servidor.js), solo para admins.
//
// SOLO LECTURA y solo memoria, salvo el rol: no toca disco.
//
// `admin` LEE EL ROL DE LA BASE, como requireAdmin (auth/jwt.js) y por la misma razón: el
// token no lo lleva. Es una lectura por clave primaria. authMiddleware ya hace una
// (cuentaExiste), pero pide `SELECT 1`, no el rol; reusarla obligaría a cambiar el portero
// que comparten todas las rutas y /stream, y eso queda fuera de este paso.
import { Router } from 'express';
import db from '../db/database.js';
import { authMiddleware } from '../auth/jwt.js';
import { muestreador } from '../estado/muestreo.js';
import { estadoDe } from '../estado/salud.js';
import { VERSION } from '../estado/version.js';
import { handle } from './handle.js';

const router = Router();
router.use(authMiddleware);

const ROL = db.prepare('SELECT role FROM users WHERE id = ?');

router.get('/', handle(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    estado: estadoDe(muestreador),
    version: VERSION,
    uptime_s: Math.round(process.uptime()),
    admin: ROL.get(req.user.id)?.role === 'admin',
  });
}));

export default router;
