import express, { Router } from 'express';
import { authMiddleware, signToken } from '../auth/jwt.js';
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES } from '../users/avatars.js';
import {
  UserError, changeOwnPassword, clearAvatar, leerMe, renameUser, setAvatarEmoji, setAvatarPhoto,
} from '../users/service.js';
import { handle } from './handle.js';

const router = Router();

// `leerMe` —las columnas que ve uno de SU PROPIA cuenta, sin `password_hash` y con el
// avatar ya resuelto— vive en users/service.js desde el login por Google, que devuelve
// el mismo `me` junto con su token. Dos copias de esa forma serían dos formas.

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
  const { username, currentPassword, newPassword, emoji } = req.body ?? {};
  // `emoji: null` es "quitámelo", así que la presencia se mira contra undefined y no
  // por si es falsy: con `!emoji` no habría forma de pedir que se quite.
  const pedidos = [username !== undefined, newPassword !== undefined, emoji !== undefined]
    .filter(Boolean).length;

  if (pedidos === 0) {
    throw new UserError(400, 'No hay nada que cambiar: mandá username, newPassword o emoji.');
  }
  if (pedidos > 1) {
    throw new UserError(400, 'Cambiá una cosa a la vez: el nombre, la contraseña o el emoji.');
  }

  if (newPassword !== undefined) await changeOwnPassword(req.user.id, { currentPassword, newPassword });
  else if (emoji !== undefined) setAvatarEmoji(req.user.id, emoji);
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

// ---- La foto ----
//
// EL CUERPO ES LA IMAGEN, CRUDA. Sin multipart y por lo tanto sin multer ni ninguna
// dependencia nueva: acá se sube UN archivo y nada más, así que el formulario de
// varias partes no compra nada y trae un parser entero que mantener.
//
// `express.raw` con `type` solo se activa si el Content-Type está en la lista; con
// cualquier otro no toca `req.body` y la petición llega con `undefined`. Eso es lo que
// se mira abajo para contestar 415: no hace falta leer el header a mano.
const cuerpoImagen = express.raw({ type: ACCEPTED_TYPES, limit: MAX_UPLOAD_BYTES });

router.put('/avatar', authMiddleware, cuerpoImagen, handle(async (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    throw new UserError(415, 'Manda una imagen JPEG, PNG o WebP.');
  }
  const me = await setAvatarPhoto(req.user.id, req.body);
  res.json({ avatar: me.avatar });
}));

// 204 y sin cuerpo. Es idempotente y silencioso a propósito, como el DELETE de
// playlists: borrar un avatar que no existe es el mismo resultado que borrar uno que
// sí, y quien llama quiere lo mismo en los dos casos.
router.delete('/avatar', authMiddleware, handle(async (req, res) => {
  clearAvatar(req.user.id);
  res.status(204).end();
}));

// Los errores que NO nacen en un handler sino en el parser del cuerpo: los tira
// `express.raw` antes de que corra nada nuestro, así que `handle` no los ve. Sin esto
// el 413 saldría como la página HTML por defecto de Express, que un cliente que espera
// JSON no sabe leer.
router.use((err, _req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'La imagen pesa más de 6 MB. Elegí una más chica.' });
  }
  next(err);
});

export default router;
