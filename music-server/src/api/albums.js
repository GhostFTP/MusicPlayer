import { Router } from 'express';
import db from '../db/database.js';
import { authMiddleware } from '../auth/jwt.js';

const router = Router();

// GET /api/albums  — lista todos los álbumes únicos con su carátula
router.get('/', authMiddleware, (req, res) => {
  const albums = db.prepare(`
    SELECT
      album,
      album_artist,
      year,
      COUNT(*) AS track_count,
      MIN(CASE WHEN cover_path IS NOT NULL THEN id END) AS sample_track_id
    FROM tracks
    WHERE album IS NOT NULL
    GROUP BY album, album_artist
    ORDER BY album_artist, album
  `).all();
  res.json(albums);
});

// GET /api/albums/:album/tracks
router.get('/:album/tracks', authMiddleware, (req, res) => {
  const tracks = db.prepare(`
    SELECT id, title, artist, track_number, duration, cover_path
    FROM tracks
    WHERE album = ?
    ORDER BY track_number, title
  `).all(req.params.album);
  res.json(tracks);
});

export default router;
