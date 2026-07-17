import { Router } from 'express';
import { existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '../db/database.js';
import { authMiddleware } from '../auth/jwt.js';

const router = Router();
router.use(authMiddleware);

// ── FOTO DE ARTISTA (artist.jpg curado por el usuario) ──────────────────────────
// Se resuelve al vuelo desde el disco: no hay columna en la DB ni paso del scanner.
// Soltar el archivo y recargar alcanza (el scanner solo corre a mano, así que indexarlo
// obligaría a re-escanear en producción para ver un cambio de foto).

const __dir = dirname(fileURLToPath(import.meta.url));
// Raíz de la biblioteca, mismo criterio que el scanner (scanner/index.js:229) sin el arg de
// CLI. Es el PRIMER sitio donde el server lee MUSIC_DIR: hasta ahora solo lo usaba el
// scanner (el server trabaja con las rutas absolutas que ya están en la DB). Si faltara,
// esto degrada a "no hay foto" — no rompe el arranque.
const MUSIC_DIR = resolve(process.env.MUSIC_DIR ?? resolve(__dir, '../../music'));

const ARTIST_IMAGE_NAMES = ['artist.jpg', 'artist.jpeg', 'artist.png', 'artist.webp'];

// El tag del FLAC y el nombre de la carpeta pueden traer la MISMA letra en dos formas
// Unicode distintas: "Motörhead" puede llevar ö como un solo code point (NFC) o como o +
// diéresis combinante (NFD). En pantalla se ven idénticos, byte a byte no lo son — y en
// Linux (producción) el sistema de archivos compara bytes, así que la foto no cargaría y no
// habría ningún error visible. Normalizamos a NFC de los dos lados para que un artista con
// acento no dependa de que el tag y la carpeta se hayan escrito igual.
//
// NFC a propósito, NO NFKC: NFKC hace mapeos de compatibilidad (p. ej. U+FE68 '﹨' → '\'),
// así que normalizar con NFKC después del guard reintroduciría el path traversal. NFC nunca
// produce caracteres ASCII nuevos.
const nfc = (s) => (typeof s === 'string' ? s.normalize('NFC') : s);

// GUARD 1 — el nombre llega de la URL: si trae separadores o '..' es una ruta disfrazada de
// nombre. Se rechaza ANTES de tocar el disco y ANTES de normalizar.
function isSafeArtistName(a) {
  return typeof a === 'string' && a !== ''
    && !a.includes('..') && !a.includes('/') && !a.includes('\\') && !a.includes('\0');
}

// GUARD 2 — la ruta RESUELTA tiene que caer estrictamente dentro de MUSIC_DIR (ni igual a
// la raíz, ni fuera). Se aplica a TODOS los candidatos, incluidos los derivados de la DB.
function insideMusicDir(dir) {
  const rel = relative(MUSIC_DIR, dir);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

// Carpetas candidatas a "carpeta del artista", en orden de preferencia.
// NO se asume MUSIC_DIR/<artista>: en producción la biblioteca cuelga de un prefijo
// (docker-compose monta /mnt/storage en /music con MUSIC_DIR=/music, y la música vive en
// /mnt/storage/Musica → dentro del contenedor es /music/Musica/<Artista>). Esa suposición
// andaría en local y fallaría EN SILENCIO en prod, así que la carpeta se deriva del
// file_path real que el scanner ya escribió; la convención queda como primer candidato.
function artistDirCandidates(artist) {
  const wanted = nfc(artist);
  // Las dos formas del candidato por convención: si la carpeta se escribió en la forma
  // contraria a la del tag, una de las dos acierta.
  const dirs = [join(MUSIC_DIR, artist), join(MUSIC_DIR, wanted)];
  const rows = db.prepare(
    'SELECT DISTINCT file_path FROM tracks WHERE album_artist = ? AND file_path IS NOT NULL'
  ).all(artist);
  for (const { file_path } of rows) {
    const d = dirname(file_path);      // <raíz>/<Artista>/<Álbum>  ó  <raíz>/<Artista>
    dirs.push(dirname(d), d);          // el padre primero: cubre el caso con carpeta de álbum
  }
  // basename === artist distingue "carpeta del artista" de "carpeta del álbum" y descarta
  // las pistas sueltas en la raíz (Metallica tiene 8 en su carpeta y 7 sueltas). La
  // comparación va en NFC de ambos lados: estas rutas salen del file_path real (bytes del
  // disco) y el nombre viene del tag — pueden no coincidir byte a byte.
  return [...new Set(dirs)].filter(d => nfc(basename(d)) === wanted && insideMusicDir(d));
}

// Ruta absoluta de la foto del artista, o null si no hay. Nunca lanza.
function findArtistImage(artist) {
  if (!isSafeArtistName(artist)) return null;
  for (const dir of artistDirCandidates(artist)) {
    for (const name of ARTIST_IMAGE_NAMES) {
      const file = join(dir, name);
      if (existsSync(file)) return file;
    }
  }
  return null;
}

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

// GET /api/browse/artists  — artistas (por album_artist) con conteos, carátula y foto propia
router.get('/artists', (req, res) => {
  const artists = db.prepare(`
    SELECT
      album_artist          AS artist,
      COUNT(DISTINCT album) AS album_count,
      COUNT(*)              AS track_count,
      MIN(CASE WHEN cover_path IS NOT NULL THEN id END) AS sample_track_id
    FROM tracks
    WHERE album_artist IS NOT NULL AND album_artist <> ''
    GROUP BY album_artist
    ORDER BY album_artist COLLATE NOCASE
  `).all();
  // has_image deja que la vista elija el nivel de la cadena de fallback ANTES de renderizar
  // (foto → carátula → iniciales), igual que hoy hace con sample_track_id. Cuesta unos pocos
  // existsSync por artista; el server ya lee la biblioteca en cada request (stream.js:29,42).
  res.json(artists.map(a => ({ ...a, has_image: findArtistImage(a.artist) !== null })));
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
      SUM(duration)         AS total_duration,
      SUM(CASE WHEN lossless = 1 AND (COALESCE(bits_per_sample, 0) >= 24 OR COALESCE(sample_rate, 0) > 48000) THEN 1 ELSE 0 END) AS hires,
      SUM(CASE WHEN lossless = 1 THEN 1 ELSE 0 END) AS lossless_total,
      SUM(CASE WHEN lossless = 0 THEN 1 ELSE 0 END) AS lossy
    FROM tracks
    WHERE album_artist = ?
  `).get(artist);

  if (!agg || agg.track_count === 0) return res.status(404).json({ error: 'Artist not found' });

  // Por nº de pistas, no alfabético: quien consume esto muestra los primeros N (el hero de
  // Artistas corta en 3), y alfabético elegía mal. Medido: a Kali Uchis le cortaba **R&B**
  // (15 pistas) dejando "Pop/General"; a Daft Punk le ponía "Dance & DJ" (10) delante de
  // "Electronic" (81). Desempate alfabético para que el orden sea estable entre llamadas.
  const genres = db.prepare(`
    SELECT genre FROM tracks
    WHERE album_artist = ? AND genre IS NOT NULL AND genre <> ''
    GROUP BY genre
    ORDER BY COUNT(*) DESC, genre COLLATE NOCASE
  `).all(artist).map(r => r.genre);

  const hires = agg.hires ?? 0;
  const losslessTotal = agg.lossless_total ?? 0;
  res.json({
    artist,
    album_count: agg.album_count ?? 0,
    track_count: agg.track_count ?? 0,
    // Segundos. `duration` está poblada al 100% (medido: 0 nulas en 484 pistas), pero el
    // ?? 0 cubre el caso de que un rescan futuro deje alguna sin ella: SUM() ignora los
    // NULL y solo devuelve NULL si TODAS lo son. El cliente oculta el dato si es 0.
    total_duration: agg.total_duration ?? 0,
    genres,
    quality: {
      hires,
      lossless: Math.max(0, losslessTotal - hires),   // lossless "CD" (sin contar hi-res)
      lossy:    agg.lossy ?? 0,
    },
  });
});

// GET /api/browse/artists/:artist/image  — la foto curada del artista (artist.jpg en su
// carpeta). Sin foto → 404 y la vista cae a la carátula (cadena de fallback).
router.get('/artists/:artist/image', (req, res) => {
  const artist = req.params.artist;      // Express ya lo decodificó (decodeURIComponent)
  // Un nombre inválido es un intento de ruta, no un artista que no existe → 400, no 404.
  if (!isSafeArtistName(artist)) return res.status(400).json({ error: 'Invalid artist name' });
  const file = findArtistImage(artist);
  if (!file) return res.status(404).json({ error: 'No artist image' });
  res.sendFile(file);
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
