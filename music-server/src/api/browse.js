import { Router } from 'express';
import db from '../db/database.js';
import { authMiddleware } from '../auth/jwt.js';

const router = Router();
router.use(authMiddleware);

// GET /api/browse/genres  — géneros con nº de pistas y álbumes
router.get('/genres', (req, res) => {
  res.json(db.prepare(`
    SELECT
      genre,
      COUNT(*)              AS track_count,
      COUNT(DISTINCT album) AS album_count
    FROM tracks
    WHERE genre IS NOT NULL AND genre <> ''
    GROUP BY genre
    ORDER BY genre COLLATE NOCASE
  `).all());
});

// GET /api/browse/artists  — artistas (por album_artist) con conteos y carátula
router.get('/artists', (req, res) => {
  res.json(db.prepare(`
    SELECT
      album_artist          AS artist,
      COUNT(DISTINCT album) AS album_count,
      COUNT(*)              AS track_count,
      MIN(CASE WHEN cover_path IS NOT NULL THEN id END) AS sample_track_id
    FROM tracks
    WHERE album_artist IS NOT NULL AND album_artist <> ''
    GROUP BY album_artist
    ORDER BY album_artist COLLATE NOCASE
  `).all());
});

// GET /api/browse/years  — años con nº de álbumes y pistas
router.get('/years', (req, res) => {
  res.json(db.prepare(`
    SELECT
      year,
      COUNT(DISTINCT album) AS album_count,
      COUNT(*)              AS track_count
    FROM tracks
    WHERE year IS NOT NULL
    GROUP BY year
    ORDER BY year DESC
  `).all());
});

export default router;
