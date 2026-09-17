import { Router } from 'express';
import db from '../db/database.js';
import { authMiddleware, signToken } from '../auth/jwt.js';
import { UserError, changeOwnPassword, renameUser } from '../users/service.js';
import { handle } from './handle.js';

const router = Router();

// Las columnas que ve uno de SU PROPIA cuenta. `password_hash` no está, por lo mismo
// que en el SELECT_PUBLIC del servicio: un hash de bcrypt en un JSON es material para
// atacarlo offline, sin límite de intentos.
const SELECT_ME = 'SELECT id, username, email, role, created_at FROM users WHERE id = ?';
const leerMe = id => db.prepare(SELECT_ME).get(id);

// Quién soy. Lo lee de la BASE y no del token, por el mismo motivo que requireAdmin
// (auth/jwt.js): el JWT congela id y username en el momento del login y el rol no
// está ahí a propósito. Si esto contestara con lo del token, un ascenso a admin no
// se vería hasta dentro de siete días.
//
// COLUMNAS NOMBRADAS, nunca `SELECT *`: password_hash vive en esta misma tabla, y un
// `*` lo mandaría por la red al primer descuido. Es la misma regla que sigue el CLI.
router.get('/', authMiddleware, (req, res) => {
  const user = leerMe(req.user.id);

  // Token válido de un usuario que ya no está (lo borró un admin mientras su sesión
  // seguía viva). No es 401: el token no tiene nada de malo — el que no existe es el
  // usuario, y decirle "credenciales inválidas" mandaría a buscar el problema al
  // lado equivocado.
  if (!user) return res.status(404).json({ error: 'User not found' });

  res.json(user);
});

// Cambiar lo de UNO MISMO: el nombre, o la contraseña. Sin requireAdmin a propósito —
// esto es lo único de la API de cuentas que un usuario normal puede hacer.
//
// EL EMAIL NO SE TOCA ACÁ NUNCA, y es el punto entero del frente: es la identidad con
// la que el login por Google encuentra la cuenta. El nombre es un nombre y se puede
// cambiar; el correo es quién sos.
//
// ⚠️ NO ACEPTA LOS DOS CAMBIOS EN LA MISMA PETICIÓN. No es una limitación técnica:
// aplicarlos en orden deja la puerta a que el primero se escriba y el segundo falle
// —la contraseña cambiada y el nombre no, con un 409 que no dice eso—, y validarlos a
// los dos primero obligaría a partir `changeOwnPassword` en mitades solo por un caso
// que ninguna pantalla manda: son dos hojas distintas en la app y dos comandos
// distintos en cualquier cliente. Cortarlo acá es más barato y más honesto que
// prometer algo atómico que después no lo sea.
router.patch('/', authMiddleware, handle(async (req, res) => {
  const { username, currentPassword, newPassword } = req.body ?? {};
  const cambiaNombre = username !== undefined;
  const cambiaClave = newPassword !== undefined;

  if (!cambiaNombre && !cambiaClave) {
    throw new UserError(400, 'No hay nada que cambiar: mandá username o newPassword.');
  }
  if (cambiaNombre && cambiaClave) {
    throw new UserError(400, 'Cambiá el nombre o la contraseña, no los dos a la vez.');
  }

  if (cambiaClave) await changeOwnPassword(req.user.id, { currentPassword, newPassword });
  else renameUser(req.user.id, username);

  const me = leerMe(req.user.id);

  // TOKEN NUEVO, firmado con el nombre nuevo.
  //
  // ⚠️ EL VIEJO SIGUE SIENDO VÁLIDO, y eso está comprobado, no supuesto: `grep -rn
  // "req.user.username"` sobre music-server/src da CERO. Todas las decisiones del
  // servidor salen de `req.user.id` —las playlists y los plays filtran por user_id, el
  // borrado propio compara ids, y requireAdmin lee el rol de la BASE y no del token—,
  // así que el username del JWT es solo para mostrar. Nadie queda afuera por seguir
  // usando el token con el que entró.
  //
  // Entonces el token nuevo NO es una revocación: es para que el cliente no siga
  // mostrando el nombre viejo en su pantalla de cuenta hasta que venza la sesión, que
  // son siete días. Cambiar la contraseña tampoco invalida los tokens existentes —para
  // eso haría falta rotar JWT_SECRET, que echa a todos—, y con doce personas de
  // confianza no lo vale.
  res.json({ me, token: signToken({ id: me.id, username: me.username }) });
}));

export default router;
