import { Router } from 'express';
import db from '../db/database.js';
import { authMiddleware } from '../auth/jwt.js';
import { ollama } from '../ia/ollama.js';
import { crearServicio, leerConfigServicio } from '../locutor/servicio.js';
import { handle } from './handle.js';

// GET /api/tracks/:id/locutor
//
// Router aparte, montado en /api/tracks DESPUÉS de tracks.js (server.js): tracks.js solo casa
// `/:id` de un segmento, así que esta ruta le sigue de largo y no se tocan las que ya existen.
// Aquí solo hay cableado; las decisiones están en locutor/servicio.js.
//
// SIEMPRE contesta al instante: { estado, frase, escuchas, reintentar_s? }.
//   estado: lista | generando | sin-frase | limite | apagado
//   · `frase` solo viene con "lista"; en cualquier otro estado es null.
//   · `escuchas` es una plantilla fija (nunca el modelo) con las escuchas PREVIAS de quien
//     pregunta. La app registra la escucha a la mitad de la pista, así que hay que pedir esto
//     al EMPEZAR la pista; pedido pasada la mitad, contaría la actual (uno de más).
//   · "apagado" (OLLAMA_URL vacío): escuchas también es null; la función no existe.
//   · `reintentar_s` solo con "generando": cuánto esperar antes de volver a preguntar.
const router = Router();

const config = leerConfigServicio(process.env);

// Dos consultas preparadas una vez. El conteo usa idx_plays_user_track.
const LEER_PISTA = db.prepare(
  'SELECT title, artist, album_artist, album, genre, year, track_number, disc_total FROM tracks WHERE id = ?'
);
const CONTAR = db.prepare('SELECT COUNT(*) AS n FROM plays WHERE user_id = ? AND track_id = ?');

export const servicio = crearServicio({
  cliente: ollama,
  leerTrack: (id) => LEER_PISTA.get(id) ?? null,
  contarEscuchas: (userId, trackId) => Number(CONTAR.get(userId, trackId).n),
  config,
});

router.get('/:id/locutor', authMiddleware, handle(async (req, res) => {
  // A mano, como el resto: solo dígitos. "1e3", "12.5" o "abc" no son un id.
  if (!/^\d{1,9}$/.test(req.params.id)) return res.status(400).json({ error: 'invalid id' });

  const cuerpo = servicio.consultar({ trackId: Number(req.params.id), userId: req.user.id });
  if (!cuerpo) return res.status(404).json({ error: 'Track not found' });

  // El estado cambia en segundos (generando → lista): nada de cachés intermedias.
  res.set('Cache-Control', 'no-store');
  res.json(cuerpo);
}));

// server.js lo llama al escuchar. No espera ni bloquea el arranque.
export function iniciarLocutor() {
  if (config.calentarAlArrancar) servicio.calentarAlArrancar();
}

export default router;
