import { readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as mm from 'music-metadata';
import db from '../db/database.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const COVERS_DIR = resolve(__dir, '../../data/covers');
const AUDIO_EXTS = new Set(['.mp3', '.flac', '.ogg', '.m4a', '.aac', '.wav', '.opus', '.wma']);

const MIME = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.opus': 'audio/opus',
  '.wma': 'audio/x-ms-wma',
};

mkdirSync(COVERS_DIR, { recursive: true });

// Carpetas excluidas del escaneo (además de cualquier carpeta oculta ".*")
const IGNORED_DIRS = new Set(['_curador', '.claude']);

function* walkDir(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;
      yield* walkDir(full);
    }
    else if (AUDIO_EXTS.has(extname(entry.name).toLowerCase())) yield full;
  }
}

function saveCover(picture, trackId) {
  if (!picture?.length) return null;
  const pic = picture[0];
  const ext = pic.format.split('/')[1] ?? 'jpg';
  const path = join(COVERS_DIR, `${trackId}.${ext}`);
  writeFileSync(path, pic.data);
  return path;
}

const upsert = db.prepare(`
  INSERT INTO tracks (title, artist, album, album_artist, genre, year, track_number, duration, file_path, cover_path, lrc_path, vocals, mime_type,
                      codec, bits_per_sample, sample_rate, bitrate, lossless)
  VALUES (@title, @artist, @album, @album_artist, @genre, @year, @track_number, @duration, @file_path, @cover_path, @lrc_path, @vocals, @mime_type,
          @codec, @bits_per_sample, @sample_rate, @bitrate, @lossless)
  ON CONFLICT(file_path) DO UPDATE SET
    title        = excluded.title,
    artist       = excluded.artist,
    album        = excluded.album,
    album_artist = excluded.album_artist,
    genre        = excluded.genre,
    year         = excluded.year,
    track_number = excluded.track_number,
    duration     = excluded.duration,
    cover_path   = excluded.cover_path,
    lrc_path     = excluded.lrc_path,
    vocals       = excluded.vocals,
    codec           = excluded.codec,
    bits_per_sample = excluded.bits_per_sample,
    sample_rate     = excluded.sample_rate,
    bitrate         = excluded.bitrate,
    lossless        = excluded.lossless,
    scanned_at   = datetime('now')
`);

// SONORAREV_VOCALS vive como comentario Vorbis (vocal|instrumental|review). music-metadata
// lo expone en meta.native; lo buscamos por id sin depender del formato.
function readVocals(meta) {
  for (const tags of Object.values(meta.native ?? {})) {
    for (const t of tags) {
      if (t.id && t.id.toUpperCase() === 'SONORAREV_VOCALS') {
        return String(t.value).toLowerCase().trim() || null;
      }
    }
  }
  return null;
}

export async function scanLibrary(musicDir) {
  const files = [...walkDir(resolve(musicDir))];
  console.log(`Found ${files.length} audio files in ${musicDir}`);

  let added = 0, updated = 0, failed = 0;

  for (const filePath of files) {
    try {
      const meta = await mm.parseFile(filePath, { skipCovers: false });
      const { common, format } = meta;

      // Sidecar .lrc: mismo nombre base que la pista, junto a ella.
      const lrcPath = filePath.slice(0, -extname(filePath).length) + '.lrc';

      // We need the row ID to name the cover file, so insert first without cover
      const result = upsert.run({
        title:        common.title  ?? null,
        artist:       common.artist ?? null,
        album:        common.album  ?? null,
        album_artist: common.albumartist ?? null,
        // common.genre es un array; tomamos el primero (género principal) para
        // que la agrupación quede limpia. Vacío → null.
        genre:        common.genre?.[0]?.trim() || null,
        year:         common.year   ?? null,
        track_number: common.track?.no ?? null,
        duration:     format.duration ?? null,
        file_path:    filePath,
        cover_path:   null,
        lrc_path:     existsSync(lrcPath) ? lrcPath : null,
        vocals:       readVocals(meta),
        mime_type:    MIME[extname(filePath).toLowerCase()] ?? 'audio/mpeg',
        // Calidad de audio. node:sqlite no acepta booleanos → lossless como 1/0.
        codec:           format.codec ?? format.container ?? null,
        bits_per_sample: format.bitsPerSample ?? null,
        sample_rate:     format.sampleRate ?? null,
        bitrate:         format.bitrate != null ? Math.round(format.bitrate) : null,
        lossless:        format.lossless == null ? null : (format.lossless ? 1 : 0),
      });

      // node:sqlite devuelve lastInsertRowid=0 en conflictos DO UPDATE,
      // así que siempre resolvemos el id por file_path.
      const { id } = db.prepare('SELECT id FROM tracks WHERE file_path = ?').get(filePath);

      const coverPath = saveCover(common.picture, id);
      if (coverPath) {
        db.prepare('UPDATE tracks SET cover_path = ? WHERE id = ?').run(coverPath, id);
      }

      if (result.lastInsertRowid) added++;
      else updated++;

      process.stdout.write(`\r  Scanned: ${added + updated + failed}/${files.length}`);
    } catch (err) {
      failed++;
      console.error(`\n  [SKIP] ${filePath}: ${err.message}`);
    }
  }

  console.log(`\nDone. Added: ${added}, Updated: ${updated}, Failed: ${failed}`);
}

// Si se ejecuta directamente: node src/scanner/index.js [ruta]
// Ruta: 1º arg de CLI, 2º env MUSIC_DIR (.env), 3º fallback local ../../music.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const musicPath = process.argv[2] ?? process.env.MUSIC_DIR ?? resolve(__dir, '../../music');
  scanLibrary(musicPath).catch(console.error);
}
