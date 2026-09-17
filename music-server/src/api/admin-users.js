// Administración de usuarios por HTTP. Es el gemelo del CLI de src/admin/users.js:
// los dos son cáscara, y las reglas viven en src/users/service.js. Acá adentro no
// hay ni una validación ni una consulta — si aparece una, se escapó del servicio y
// ya empezó a divergir.
import { Router } from 'express';
import { authMiddleware, requireAdmin } from '../auth/jwt.js';
import { UserError, listUsers, createUser, updateUser, deleteUser } from '../users/service.js';

const router = Router();

// LAS DOS CAPAS, EN ESTE ORDEN Y PARA TODO EL ROUTER. requireAdmin lee req.user, que
// lo deja authMiddleware: invertirlos daría 403 a todo el mundo, admins incluidos.
// Va como router.use() y no repetido en cada ruta a propósito — con cuatro rutas, la
// que se olvide el día que se agregue la quinta queda abierta a cualquiera con
// sesión, y eso no se ve en un diff.
router.use(authMiddleware, requireAdmin);

// El id viene de la URL, así que es texto hasta que alguien lo mire. Sin esto, un
// /api/admin/users/abc entraría como NaN y el SELECT no encontraría nada: saldría un
// 404 "no existe ese usuario" cuando lo que pasó es que la petición estaba mal.
function idParam(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new UserError(400, 'El id tiene que ser un entero.');
  return id;
}

// UserError trae el status adentro (ver el servicio), así que traducir es una línea.
// Lo que NO se traduce se loguea y sale como 500 genérico: un mensaje de SQLite en la
// respuesta le cuenta el esquema a quien pregunte.
function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof UserError) return res.status(e.status).json({ error: e.message });
      console.error('[ADMIN-USERS]', e);
      res.status(500).json({ error: 'Internal error' });
    }
  };
}

router.get('/', handle(async (_req, res) => {
  res.json(listUsers());
}));

router.post('/', handle(async (req, res) => {
  const { username, password, role } = req.body ?? {};
  res.status(201).json(await createUser({ username, password, role: role ?? 'user' }));
}));

router.patch('/:id', handle(async (req, res) => {
  const { role, password } = req.body ?? {};
  res.json(await updateUser(idParam(req), { role, password }));
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
    throw new UserError(400, 'No podés borrar tu propio usuario.');
  }

  deleteUser(id, { confirm: req.body?.confirm });
  res.status(204).end();
}));

export default router;
