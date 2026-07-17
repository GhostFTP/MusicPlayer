import { Router } from 'express';
import db from '../db/database.js';
import { authMiddleware } from '../auth/jwt.js';

const router = Router();

// GET /api/albums?artist=&year=&genre=  — álbumes únicos (con filtros opcionales)
router.get('/', authMiddleware, (req, res) => {
  const { artist, year, genre } = req.query;

  let sql = `
    SELECT
      album,
      album_artist,
      year,
      COUNT(*) AS track_count,
      MIN(CASE WHEN cover_path IS NOT NULL THEN id END) AS sample_track_id
    FROM tracks
    WHERE album IS NOT NULL`;
  const params = [];

  if (artist) { sql += ' AND album_artist = ?'; params.push(artist); }
  if (year)   { sql += ' AND year = ?';         params.push(Number(year)); }
  if (genre)  { sql += ' AND genre = ?';        params.push(genre); }

  sql += ' GROUP BY album, album_artist ORDER BY album_artist, album';

  res.json(db.prepare(sql).all(...params));
});

// GET /api/albums/:album/tracks
router.get('/:album/tracks', authMiddleware, (req, res) => {
  const tracks = db.prepare(`
    SELECT id, title, artist, track_number, disc_number, disc_total, duration, cover_path
    FROM tracks
    WHERE album = ?
    ORDER BY COALESCE(disc_number, 1), track_number, title
  `).all(req.params.album);
  res.json(tracks);
});

export default router;
