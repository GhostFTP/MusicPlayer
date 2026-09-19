// Administración de usuarios por HTTP. Es el gemelo del CLI de src/admin/users.js:
// los dos son cáscara, y las reglas viven en src/users/service.js. Acá adentro no
// hay ni una validación ni una consulta — si aparece una, se escapó del servicio y
// ya empezó a divergir.
import { Router } from 'express';
import { authMiddleware, requireAdmin } from '../auth/jwt.js';
import { UserError, listUsers, getUser, createUser, updateUser, deleteUser, clearAvatar } from '../users/service.js';
import { handle } from './handle.js';

const router = Router();

// LAS DOS CAPAS, EN ESTE ORDEN Y PARA TODO EL ROUTER. requireAdmin lee req.user, que
// lo deja authMiddleware: invertirlos daría 403 a todo el mundo, admins incluidos.
// Va como router.use() y no repetido en cada ruta a propósito — con cuatro rutas, la
// que se olvide el día que se agregue la quinta queda abierta a cualquiera con
// sesión, y eso no se ve en un diff.
router.use(authMiddleware, requireAdmin);

// Quién hace el cambio, para el log del correo (users/service.js). El nombre sale de la
// BASE y no del token, que lo congela en el login: un admin que se renombró aparecería
// con el nombre viejo.
function actorDe(req) {
  const yo = getUser(req.user.id);
  return `el admin ${req.user.id} (${yo?.username ?? req.user.username})`;
}

// El id viene de la URL, así que es texto hasta que alguien lo mire. Sin esto, un
// /api/admin/users/abc entraría como NaN y el SELECT no encontraría nada: saldría un
// 404 "no existe ese usuario" cuando lo que pasó es que la petición estaba mal.
function idParam(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new UserError(400, 'El id tiene que ser un entero.');
  return id;
}

router.get('/', handle(async (_req, res) => {
  res.json(listUsers());
}));

// `email` desde el 1.19.0: con correo, la contraseña es opcional —la cuenta entra solo
// con Google hasta que alguien le ponga una—. Las reglas, en createUser.
router.post('/', handle(async (req, res) => {
  const { username, password, role, email } = req.body ?? {};
  res.status(201).json(
    await createUser({ username, password, role: role ?? 'user', email }, { actor: actorDe(req) }),
  );
}));

// `username` y `emoji` desde el 1.17.0: un admin puede renombrar a otro y ponerle o
// quitarle el emoji. Van por la misma regla que los cambios propios de PATCH /api/me —
// ver updateUser, que usa las dos mitades de renameUser en vez de llamarlo, para no
// perder su promesa de validar todo antes de escribir nada.
//
// `email` desde el 1.19.0: `string` lo pone y `null` lo quita (desliga la cuenta de su
// Google). Las reglas —minúsculas, formato, único, que no sea el nombre de otra cuenta— y
// la línea de log viven en updateUser (users/service.js). Ya no se deja fuera "por las
// dudas": era lo que obligaba a ligar cuentas renombrándolas al correo, y esa vuelta rompe
// más de lo que protege.
//
// Y LA FOTO TAMPOCO SE SUBE ACÁ, a propósito: un admin puede QUITAR la de otro (el
// DELETE de abajo) pero no ponérsela. Elegir la cara con la que aparece otra persona
// no es administrar, y quitar una foto que no corresponde ya cubre el caso real.
router.patch('/:id', handle(async (req, res) => {
  const { role, password, username, emoji, email } = req.body ?? {};
  res.json(await updateUser(idParam(req), { role, password, username, emoji, email }, { actor: actorDe(req) }));
}));

// Quitarle el avatar a otro: la foto Y el emoji. 204 y sin cuerpo, idempotente como el
// de /api/me/avatar.
//
// No pide escribir el nombre para confirmar, a diferencia del DELETE del usuario: esto
// no se lleva nada por delante —la persona se vuelve a poner el suyo cuando quiera— y
// pedir una confirmación cara para algo barato enseña a confirmar sin leer.
router.delete('/:id/avatar', handle(async (req, res) => {
  clearAvatar(idParam(req));
  res.status(204).end();
}));

// El cuerpo con `confirm` lo parsea el express.json() global de server.js. Un DELETE
// con cuerpo es raro pero es HTTP válido, y acá el cuerpo es la confirmación: ver el
// porqué en deleteUser().
router.delete('/:id', handle(async (req, res) => {
  const id = idParam(req);

  // Borrarse a UNO MISMO se corta acá y no en el servicio, porque "uno mismo" es una
  // noción de la sesión HTTP y en el CLI no existe: ahí quien lo corre no es ningún
  // usuario de la tabla. Un admin que se borra pierde el acceso en el acto, con la
  // sesión abierta y sin forma de volver.
  if (id === req.user.id) {
    throw new UserError(400, 'No puedes borrar tu propio usuario.');
  }

  deleteUser(id, { confirm: req.body?.confirm });
  res.status(204).end();
}));

export default router;
