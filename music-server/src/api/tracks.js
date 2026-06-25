import { Router } from 'express';
import db from '../db/database.js';
import { authMiddleware } from '../auth/jwt.js';

const router = Router();

// GET /api/tracks?search=&artist=&album=&limit=50&offset=0
router.get('/', authMiddleware, (req, res) => {
  const { search, artist, album, limit = 50, offset = 0 } = req.query;

  let sql = 'SELECT id, title, artist, album, duration, cover_path, codec, bits_per_sample, sample_rate, bitrate, lossless FROM tracks WHERE 1=1';
  const params = [];

  if (search) {
    sql += ' AND (title LIKE ? OR artist LIKE ? OR album LIKE ?)';
    const q = `%${search}%`;
    params.push(q, q, q);
  }
  if (artist) { sql += ' AND artist = ?'; params.push(artist); }
  if (album)  { sql += ' AND album = ?';  params.push(album);  }

  sql += ' ORDER BY artist, album, track_number, title LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  res.json(db.prepare(sql).all(...params));
});

// GET /api/tracks/:id
router.get('/:id', authMiddleware, (req, res) => {
  const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(req.params.id);
  if (!track) return res.status(404).json({ error: 'Track not found' });
  res.json(track);
});

// GET /api/tracks/:id/cover
router.get('/:id/cover', authMiddleware, (req, res) => {
  const track = db.prepare('SELECT cover_path FROM tracks WHERE id = ?').get(req.params.id);
  if (!track?.cover_path) return res.status(404).json({ error: 'No cover' });
  res.sendFile(track.cover_path);
});

export default router;
