// Lo que un usuario puede ver DE OTRO. Hoy es una sola cosa: su foto de avatar.
//
// POR QUÉ NO PIDE SER ADMIN. Las fotos se ven entre todos: el panel de usuarios las
// lista, y cualquier tarjeta de perfil que venga después las va a mostrar igual.
// Gatearlas por rol dejaría al 90% de la app con círculos vacíos. Lo que sí pide es
// SESIÓN: esto no es contenido público, y sin authMiddleware la URL de la foto de
// cualquiera quedaría abierta a internet.
//
// Va en su propio router y no en api/me.js porque el sujeto es otro: `/api/me` es
// "lo mío", esto es "lo de alguien". Meterlo ahí obligaría a que una ruta de `/api/me`
// llevara un `:id` ajeno, que es justo la confusión que después se paga.
import { readFile } from 'node:fs/promises';
import { Router } from 'express';
import db from '../db/database.js';
import { authMiddleware } from '../auth/jwt.js';
import { avatarPath, epochDe } from '../users/avatars.js';

const router = Router();

// Un día. Es una foto de perfil: cambia cada muchos meses, y cuando cambia lo que
// cambia es la URL (el `?v=`), así que el número de acá no es lo que decide si se ve
// la nueva — para eso está la versión. Es cuánto tiempo el cliente se ahorra preguntar.
const MAX_AGE = 86400;

router.get('/:id/avatar', authMiddleware, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'El id tiene que ser un entero.' });
  }

  // La BASE decide si hay foto, no el disco: es el invariante de db/database.js. Un
  // archivo que quedó huérfano de un corte a mitad de camino no se sirve, porque su
  // columna está en null.
  const row = db.prepare('SELECT avatar_updated_at FROM users WHERE id = ?').get(id);
  if (!row?.avatar_updated_at) return res.status(404).json({ error: 'Esa cuenta no tiene foto.' });

  // ETag POR VERSIÓN y no por el contenido del archivo. Así no hay que leerlo para
  // saber si el cliente ya lo tiene: con un If-None-Match que coincida, `res.send` ve
  // `req.fresh` y contesta 304 sin cuerpo.
  //
  // `private` porque es de una persona: le prohíbe guardarla a cualquier caché
  // compartida en el camino. Y NUNCA `immutable` — eso le diría al cliente que no
  // revalide ni siquiera al recargar, y una foto vieja se quedaría pegada sin forma
  // de echarla si alguna vez la URL llega sin el `?v=`.
  res.set('ETag', `"av-${id}-${epochDe(row.avatar_updated_at)}"`);
  res.set('Cache-Control', `private, max-age=${MAX_AGE}`);
  res.type('jpeg');

  // ⚠️ `req.fresh` DEVUELVE FALSE SI EL CLIENTE MANDA `Cache-Control: no-cache`, aunque
  // el If-None-Match coincida, y eso es lo correcto: le está pidiendo explícitamente
  // una copia fresca. Vale saberlo porque el `fetch` de node (undici) agrega ese header
  // SOLO por su cuenta, así que una prueba escrita con fetch nunca vería el 304 y
  // parecería que esto no funciona. Medido, no supuesto.
  if (req.fresh) return res.status(304).end();

  try {
    res.send(await readFile(avatarPath(id)));
  } catch {
    // La base dice que hay foto y el archivo no está: el volumen se recreó, o alguien
    // limpió a mano. Es un 404 —no hay nada que servir— y no un 500: el servidor está
    // bien, lo que falta es el archivo.
    res.status(404).json({ error: 'Esa cuenta no tiene foto.' });
  }
});

export default router;
