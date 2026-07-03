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

// GET /api/browse/artists/:artist  — agregados LOCALES de un artista (album_artist):
// nº de álbumes, canciones, géneros que abarca y desglose de calidad por tier.
// Solo lectura, campos ya presentes en la DB.
router.get('/artists/:artist', (req, res) => {
  const artist = req.params.artist;
  const agg = db.prepare(`
    SELECT
      COUNT(DISTINCT album) AS album_count,
      COUNT(*)              AS track_count,
      SUM(CASE WHEN lossless = 1 AND (COALESCE(bits_per_sample, 0) >= 24 OR COALESCE(sample_rate, 0) > 48000) THEN 1 ELSE 0 END) AS hires,
      SUM(CASE WHEN lossless = 1 THEN 1 ELSE 0 END) AS lossless_total,
      SUM(CASE WHEN lossless = 0 THEN 1 ELSE 0 END) AS lossy
    FROM tracks
    WHERE album_artist = ?
  `).get(artist);

  if (!agg || agg.track_count === 0) return res.status(404).json({ error: 'Artist not found' });

  const genres = db.prepare(`
    SELECT DISTINCT genre FROM tracks
    WHERE album_artist = ? AND genre IS NOT NULL AND genre <> ''
    ORDER BY genre COLLATE NOCASE
  `).all(artist).map(r => r.genre);

  const hires = agg.hires ?? 0;
  const losslessTotal = agg.lossless_total ?? 0;
  res.json({
    artist,
    album_count: agg.album_count ?? 0,
    track_count: agg.track_count ?? 0,
    genres,
    quality: {
      hires,
      lossless: Math.max(0, losslessTotal - hires),   // lossless "CD" (sin contar hi-res)
      lossy:    agg.lossy ?? 0,
    },
  });
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
