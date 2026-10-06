import { Router } from 'express';
import db from '../db/database.js';
import { authMiddleware } from '../auth/jwt.js';
import { estadoIndice, obtenerIndice } from '../videos/index.js';

const router = Router();
router.use(authMiddleware);

// Tope defensivo del alta por lote: la biblioteca entera son ~1000 pistas, así que
// 2000 no le queda corto a ninguna colección real y frena a un cliente descontrolado.
const MAX_BULK = 2000;

// GET /api/playlists
router.get('/', (req, res) => {
  res.json(db.prepare(`
    SELECT p.id, p.name, p.emoji, p.user_id, p.created_at,
           COUNT(pt.track_id) AS track_count,
           -- Portada collage: los primeros 4 track_id CON carátula, por orden de
           -- agregado (position). json_group_array → string JSON "[id,id,…]"; el
           -- front lo parsea y sirve cada uno con coverUrl(id). Devolvemos ids (no
           -- cover_path) para no exponer rutas del filesystem. Mismo patrón que
           -- sample_track_id de albums.js. ADITIVO: no cambia los campos previos.
           (SELECT json_group_array(id) FROM (
              SELECT t.id
              FROM playlist_tracks pt2
              JOIN tracks t ON t.id = pt2.track_id
              WHERE pt2.playlist_id = p.id
                AND t.cover_path IS NOT NULL
              ORDER BY pt2.position
              LIMIT 4
           )) AS sample_covers,
           -- Cuántos VIDEOS tiene (1.21.1). Subconsulta correlacionada y NO otro LEFT
           -- JOIN, a propósito: un segundo join multiplicaría las filas del GROUP BY y
           -- track_count contaría canciones × videos. Va al final: ningún campo de antes
           -- cambia de valor ni de orden. Lee la PK (playlist_id, video_id) como índice.
           (SELECT COUNT(*) FROM playlist_videos pv WHERE pv.playlist_id = p.id) AS video_count
    FROM playlists p
    LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
    WHERE p.user_id = ?
    GROUP BY p.id
    ORDER BY p.created_at, p.id
  `).all(req.user.id));
});

// POST /api/playlists
router.post('/', (req, res) => {
  const { name, emoji } = req.body ?? {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const result = db.prepare('INSERT INTO playlists (name, user_id, emoji) VALUES (?, ?, ?)')
    .run(name, req.user.id, emoji ?? null);
  res.status(201).json({ id: result.lastInsertRowid, name, emoji: emoji ?? null });
});

// GET /api/playlists/:id/tracks
router.get('/:id/tracks', (req, res) => {
  const pl = db.prepare('SELECT * FROM playlists WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!pl) return res.status(404).json({ error: 'Playlist not found' });

  const tracks = db.prepare(`
    SELECT t.id, t.title, t.artist, t.album, t.album_artist, t.duration, t.cover_path,
           t.codec, t.bits_per_sample, t.sample_rate, t.bitrate, t.lossless,
           pt.position
    FROM playlist_tracks pt
    JOIN tracks t ON t.id = pt.track_id
    WHERE pt.playlist_id = ?
    ORDER BY pt.position
  `).all(req.params.id);
  res.json(tracks);
});

// POST /api/playlists/:id/tracks
router.post('/:id/tracks', (req, res) => {
  const body = req.body ?? {};
  // ADITIVO: acepta las DOS formas. Los clientes que mandan `track_id` —la app iOS
  // y este mismo web— siguen funcionando sin tocarse y su respuesta no cambia ni un
  // campo; sólo la forma nueva devuelve contadores.
  const bulk = Array.isArray(body.track_ids);
  const ids  = bulk ? body.track_ids : [body.track_id];

  const pl = db.prepare('SELECT * FROM playlists WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!pl) return res.status(404).json({ error: 'Playlist not found' });

  // Enteros, sin nulos y SIN REPETIDOS. El dedupe no es cosmético: dos ids iguales
  // en la misma tanda consumirían dos `position` y dejarían un hueco.
  const clean = [...new Set(ids.map(Number).filter(Number.isInteger))];
  if (!clean.length)           return res.status(400).json({ error: 'track_id or track_ids required' });
  if (clean.length > MAX_BULK) return res.status(413).json({ error: `too many tracks (max ${MAX_BULK})` });

  // UNA sola consulta de posición: el resto se cuenta en memoria. Volver a pedir
  // MAX(position) por fila serían N SELECT de más.
  const max = db.prepare('SELECT MAX(position) AS m FROM playlist_tracks WHERE playlist_id = ?').get(req.params.id);
  let position = (max?.m ?? 0) + 1;

  const insert = db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)');

  // La transacción es a mano y no con `db.transaction()` porque ESO NO EXISTE acá:
  // es una comodidad de better-sqlite3 y este backend usa `node:sqlite`
  // (DatabaseSync), que sólo expone prepare/exec/close.
  //
  // Y no es sólo por atomicidad: con `journal_mode = WAL` cada statement suelto es
  // un commit con su fsync. Setecientos inserts sueltos son setecientos commits;
  // envueltos, uno. Ahí está el grueso de la ganancia.
  let added = 0, already = 0, skipped = 0;
  db.exec('BEGIN');
  try {
    for (const id of clean) {
      try {
        // PK (playlist_id, track_id): si ya estaba, INSERT OR IGNORE no inserta
        // (changes === 0) → se cuenta como `already` en vez de fingir que se añadió.
        const r = insert.run(req.params.id, id, position);
        if (r.changes) { added++; position++; } else already++;
      } catch {
        // FK rota: ese id ya no existe en `tracks` (un rescan lo borró y el cliente
        // manda su caché viejo). ⚠️ `INSERT OR IGNORE` NO cubre esto: el ON CONFLICT
        // de SQLite aplica a UNIQUE, NOT NULL, CHECK y PRIMARY KEY — no a FOREIGN
        // KEY. Sin este catch, un solo id viejo aborta la tanda entera.
        skipped++;
      }
    }
    db.exec('COMMIT');
  } catch {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'could not add tracks' });
  }

  // La forma VIEJA responde exactamente como antes, para no romper a nadie. La
  // única diferencia: una id inexistente devuelve 404 en vez del 500 que salía de
  // dejar la excepción sin atrapar.
  if (!bulk) {
    if (skipped) return res.status(404).json({ error: 'Track not found' });
    if (!added)  return res.json({ already: true });
    return res.status(201).json({ position: position - 1 });
  }
  res.status(201).json({ added, already, skipped });
});

// DELETE /api/playlists/:id/tracks/:trackId
router.delete('/:id/tracks/:trackId', (req, res) => {
  const pl = db.prepare('SELECT * FROM playlists WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!pl) return res.status(404).json({ error: 'Playlist not found' });

  db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?').run(req.params.id, req.params.trackId);
  res.status(204).send();
});

// PATCH /api/playlists/:id  — renombrar y/o cambiar emoji (campos opcionales).
// Actualiza sólo lo que venga en el body; siempre acotado a la playlist del usuario.
router.patch('/:id', (req, res) => {
  const body = req.body ?? {};
  const hasName  = typeof body.name === 'string';
  const hasEmoji = Object.prototype.hasOwnProperty.call(body, 'emoji');
  if (!hasName && !hasEmoji) return res.status(400).json({ error: 'name or emoji required' });

  const sets = [], vals = [];
  if (hasName) {
    const name = body.name.trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    sets.push('name = ?'); vals.push(name);
  }
  if (hasEmoji) { sets.push('emoji = ?'); vals.push(body.emoji || null); }
  vals.push(req.params.id, req.user.id);

  const result = db.prepare(`UPDATE playlists SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...vals);
  if (result.changes === 0) return res.status(404).json({ error: 'Playlist not found' });

  const pl = db.prepare('SELECT id, name, emoji FROM playlists WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  res.json(pl);
});

// DELETE /api/playlists/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM playlists WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.status(204).send();
});

// ---- VIDEOS EN PLAYLISTS (1.21.0) ----
// Rutas NUEVAS: nada de lo de arriba cambió, y GET /api/playlists no gana ningún campo.
// Los videos van en su propia tabla (playlist_videos) y no se mezclan con las pistas.

// Topes. 200 por envío es de sobra para elegir a mano; 500 por playlist frena a un
// cliente descontrolado con un catálogo de videos que hoy son siete.
const MAX_VIDEOS_POR_ENVIO = 200;
const MAX_VIDEOS_POR_PLAYLIST = 500;
const ID_VIDEO = /^[0-9a-f]{16}$/;

// GET y POST son async (esperan al índice de videos), y en Express 4 un throw DESPUÉS de un
// await no lo atrapa nadie: es una promesa rechazada sin dueño, y Node 22 por defecto MATA
// EL PROCESO (medido: exit 1). Un error de la base ahí —una tabla que no está, un
// SQLITE_BUSY— tumbaría el servidor entero para todos. Esto lo convierte en un 500, con la
// misma respuesta que `handle()` (api/handle.js): nada del mensaje de SQLite sale al
// cliente. El log dice la ruta y el error; nunca el cuerpo, el token ni quién pidió.
function protegido(ruta, fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      console.error(`[playlists/videos] ${ruta}:`, e);
      if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
    }
  };
}

// GET /api/playlists/:id/videos → { index, videos }
// `index` dice si el índice de videos se pudo leer ('ok' | 'unavailable'). Cada video:
//   - available: true  → está en el índice; los datos son los de AHORA;
//   - available: false → el índice se leyó y el video ya no está (se renombró o borró);
//                        se devuelven el título y el artista guardados al agregarlo;
//   - available: null  → no se sabe: el índice no se pudo leer. No es "desapareció".
// `year` (1.21.1) sale del índice, así que solo lo tiene un video disponible; la fila no
// guarda el año al agregar (no hay columna), y sin índice no se sabe: en los dos casos, null.
router.get('/:id/videos', protegido('GET /:id/videos', async (req, res) => {
  const pl = db.prepare('SELECT id FROM playlists WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!pl) return res.status(404).json({ error: 'Playlist not found' });

  const indice = await obtenerIndice();
  const index = estadoIndice();
  const filas = db.prepare(`
    SELECT video_id, position, added_at, title, artist
    FROM playlist_videos
    WHERE playlist_id = ?
    ORDER BY position
  `).all(req.params.id);

  const videos = filas.map((f) => {
    const v = index === 'ok' ? indice.porId.get(f.video_id) : undefined;
    if (v) {
      return {
        id: f.video_id, position: f.position, added_at: f.added_at,
        title: v.title, artist: v.artist, available: true,
        duration: v.duration, size: v.size, has_cover: v.has_cover, year: v.year ?? null,
      };
    }
    return {
      id: f.video_id, position: f.position, added_at: f.added_at,
      title: f.title, artist: f.artist, available: index === 'ok' ? false : null,
      duration: null, size: null, has_cover: index === 'ok' ? false : null, year: null,
    };
  });
  res.json({ index, videos });
}));

// POST /api/playlists/:id/videos  { video_ids: [...] }  o  { video_id }
// Las dos formas, como /tracks: la de lote devuelve { added, already, skipped } y la simple
// responde como la simple de /tracks ({ position } con 201, { already: true } con 200, o
// 404 si el video no está en el índice). Con el índice sin poder leerse, 503 y no se
// inserta nada: sin índice no hay forma de saber si el id es un video de verdad.
router.post('/:id/videos', protegido('POST /:id/videos', async (req, res) => {
  const body = req.body ?? {};
  const bulk = Array.isArray(body.video_ids);
  const ids  = bulk ? body.video_ids : [body.video_id];

  const pl = db.prepare('SELECT id FROM playlists WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!pl) return res.status(404).json({ error: 'Playlist not found' });

  // Solo strings con forma de id, y sin repetidos (dos iguales gastarían dos `position`).
  const clean = [...new Set(ids.filter((id) => typeof id === 'string' && ID_VIDEO.test(id)))];
  if (!clean.length) return res.status(400).json({ error: 'video_id or video_ids required' });
  if (clean.length > MAX_VIDEOS_POR_ENVIO) {
    return res.status(413).json({ error: `too many video_ids (max ${MAX_VIDEOS_POR_ENVIO})` });
  }

  const indice = await obtenerIndice();
  if (estadoIndice() !== 'ok') return res.status(503).json({ error: 'video index unavailable' });

  // De acá en adelante TODO es síncrono: entre la cuenta del tope y el COMMIT no hay
  // ningún await, así que dos POST no pueden pasarse del tope intercalándose. Y se vuelve
  // a comprobar la playlist, porque durante el await la pudieron borrar.
  if (!db.prepare('SELECT id FROM playlists WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)) {
    return res.status(404).json({ error: 'Playlist not found' });
  }

  const yaEstan = new Set(db.prepare('SELECT video_id FROM playlist_videos WHERE playlist_id = ?')
    .all(req.params.id).map((r) => r.video_id));
  const nuevos = clean.filter((id) => !yaEstan.has(id) && indice.porId.has(id));
  if (yaEstan.size + nuevos.length > MAX_VIDEOS_POR_PLAYLIST) {
    return res.status(409).json({ error: `playlist video limit reached (max ${MAX_VIDEOS_POR_PLAYLIST})` });
  }

  const max = db.prepare('SELECT MAX(position) AS m FROM playlist_videos WHERE playlist_id = ?').get(req.params.id);
  let position = (max?.m ?? 0) + 1;
  const insert = db.prepare(`INSERT OR IGNORE INTO playlist_videos (playlist_id, video_id, position, title, artist)
                             VALUES (?, ?, ?, ?, ?)`);

  // A mano, como /tracks: node:sqlite no tiene db.transaction().
  //
  // El BEGIN va DENTRO del try y `abierta` dice si de verdad se abrió: si falla el BEGIN no
  // hay nada que deshacer. Si falla un INSERT o el COMMIT, se deshace todo. Y el ROLLBACK
  // va en su propio try: si él también falla, el error no se escapa del handler; queda en
  // el log y la respuesta es el mismo 500. (La conexión es UNA para todo el servidor, así
  // que una transacción que quedara abierta bloquearía las escrituras de todos.)
  let added = 0, already = 0, skipped = 0;
  let abierta = false;
  try {
    db.exec('BEGIN');
    abierta = true;
    for (const id of clean) {
      const v = indice.porId.get(id);
      if (!v) { skipped++; continue; }
      const r = insert.run(req.params.id, id, position, v.title, v.artist);
      if (r.changes) { added++; position++; } else already++;
    }
    db.exec('COMMIT');
    abierta = false;
  } catch (e) {
    console.error('[playlists/videos] POST /:id/videos: no se pudieron agregar:', e);
    if (abierta) {
      try { db.exec('ROLLBACK'); }
      catch (e2) { console.error('[playlists/videos] POST /:id/videos: el ROLLBACK también falló:', e2); }
    }
    return res.status(500).json({ error: 'could not add videos' });
  }

  if (!bulk) {
    if (skipped) return res.status(404).json({ error: 'Video not found' });
    if (!added)  return res.json({ already: true });
    return res.status(201).json({ position: position - 1 });
  }
  res.status(201).json({ added, already, skipped });
}));

// DELETE /api/playlists/:id/videos/:videoId → 204, también si no estaba (como /tracks).
router.delete('/:id/videos/:videoId', (req, res) => {
  const pl = db.prepare('SELECT id FROM playlists WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!pl) return res.status(404).json({ error: 'Playlist not found' });

  db.prepare('DELETE FROM playlist_videos WHERE playlist_id = ? AND video_id = ?').run(req.params.id, req.params.videoId);
  res.status(204).send();
});

export default router;
