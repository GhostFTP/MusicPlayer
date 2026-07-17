import { Router } from 'express';
import { readFileSync, existsSync } from 'node:fs';
import db from '../db/database.js';
import { authMiddleware } from '../auth/jwt.js';
import { lrclibLyrics } from '../lyrics/lrclib.js';

// ¿El .lrc trae timestamps [mm:ss.xx]? → letra sincronizada.
const SYNCED_RE = /\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/;

const router = Router();

// GET /api/tracks?search=&artist=&album_artist=&album=&genre=&year=&limit=50&offset=0
router.get('/', authMiddleware, (req, res) => {
  const { search, artist, album_artist, album, genre, year, limit = 50, offset = 0 } = req.query;

  let sql = `SELECT id, title, artist, album, album_artist, genre, year, track_number, disc_number, disc_total,
                    duration, cover_path, codec, bits_per_sample, sample_rate, bitrate, lossless
             FROM tracks WHERE 1=1`;
  const params = [];

  if (search) {
    sql += ' AND (title LIKE ? OR artist LIKE ? OR album LIKE ?)';
    const q = `%${search}%`;
    params.push(q, q, q);
  }
  if (artist)       { sql += ' AND artist = ?';       params.push(artist); }
  if (album_artist) { sql += ' AND album_artist = ?'; params.push(album_artist); }
  if (album)        { sql += ' AND album = ?';        params.push(album); }
  if (genre)        { sql += ' AND genre = ?';        params.push(genre); }
  if (year)         { sql += ' AND year = ?';         params.push(Number(year)); }

  // Con filtro de álbum: orden natural del disco (disc_number primero para
  // discos dobles/múltiples, luego track_number decide, no el artist de la
  // pista — evita que las pistas feat. salten al final). COALESCE(disc_number,1)
  // trata los álbumes de un solo disco (disc_number NULL) como disco 1, sin romperlos.
  // Sin filtro (Biblioteca, Géneros): igual que hoy — agrupar por artista/álbum.
  sql += album
    ? ' ORDER BY COALESCE(disc_number, 1), track_number, title'
    : ' ORDER BY artist, album, track_number, title';
  sql += ' LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  res.json(db.prepare(sql).all(...params));
});

// GET /api/tracks/:id
router.get('/:id', authMiddleware, (req, res) => {
  const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(req.params.id);
  if (!track) return res.status(404).json({ error: 'Track not found' });
  res.json(track);
});

// GET /api/tracks/:id/lyrics
// Devuelve el .lrc sidecar (prioridad), o cae a LRCLIB (source: 'lrclib', con
// caché 24h positiva y negativa). Si tampoco hay → sin letra, nunca error.
router.get('/:id/lyrics', authMiddleware, async (req, res) => {
  const track = db.prepare(
    'SELECT id, lrc_path, vocals, title, artist, album, duration FROM tracks WHERE id = ?'
  ).get(req.params.id);
  if (!track) return res.status(404).json({ error: 'Track not found' });

  const instrumental = (track.vocals || '').toLowerCase() === 'instrumental';
  if (instrumental) return res.json({ instrumental: true, synced: false, lyrics: null });

  if (track.lrc_path && existsSync(track.lrc_path)) {
    let lyrics = null;
    try { lyrics = readFileSync(track.lrc_path, 'utf8'); } catch { lyrics = null; }
    if (lyrics) return res.json({ instrumental: false, synced: SYNCED_RE.test(lyrics), lyrics });
  }

  const remote = await lrclibLyrics(track);
  if (remote) return res.json({ ...remote, source: 'lrclib' });

  return res.json({ instrumental: false, synced: false, lyrics: null });
});

// GET /api/tracks/:id/cover
router.get('/:id/cover', authMiddleware, (req, res) => {
  const track = db.prepare('SELECT cover_path FROM tracks WHERE id = ?').get(req.params.id);
  if (!track?.cover_path) return res.status(404).json({ error: 'No cover' });
  res.sendFile(track.cover_path);
});

export default router;
