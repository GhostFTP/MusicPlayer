import { Router } from 'express';
import db from '../db/database.js';
import { authMiddleware } from '../auth/jwt.js';

const router = Router();
router.use(authMiddleware);

// GET /api/playlists
router.get('/', (req, res) => {
  res.json(db.prepare(`
    SELECT p.id, p.name, p.emoji, p.user_id, p.created_at,
           COUNT(pt.track_id) AS track_count
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
    SELECT t.id, t.title, t.artist, t.album, t.duration, t.cover_path,
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
  const { track_id } = req.body ?? {};
  const pl = db.prepare('SELECT * FROM playlists WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!pl) return res.status(404).json({ error: 'Playlist not found' });

  const max = db.prepare('SELECT MAX(position) AS m FROM playlist_tracks WHERE playlist_id = ?').get(req.params.id);
  const position = (max?.m ?? 0) + 1;

  db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)').run(req.params.id, track_id, position);
  res.status(201).json({ position });
});

// DELETE /api/playlists/:id/tracks/:trackId
router.delete('/:id/tracks/:trackId', (req, res) => {
  const pl = db.prepare('SELECT * FROM playlists WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!pl) return res.status(404).json({ error: 'Playlist not found' });

  db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?').run(req.params.id, req.params.trackId);
  res.status(204).send();
});

// PATCH /api/playlists/:id  — renombrar
router.patch('/:id', (req, res) => {
  const { name } = req.body ?? {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });

  const result = db.prepare('UPDATE playlists SET name = ? WHERE id = ? AND user_id = ?')
    .run(name.trim(), req.params.id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Playlist not found' });

  res.json({ id: Number(req.params.id), name: name.trim() });
});

// DELETE /api/playlists/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM playlists WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.status(204).send();
});

export default router;
