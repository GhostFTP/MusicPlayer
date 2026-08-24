import { Router } from 'express';
import db from '../db/database.js';
import { authMiddleware } from '../auth/jwt.js';

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
           )) AS sample_covers
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

export default router;
