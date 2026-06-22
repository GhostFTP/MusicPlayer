import { readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
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

function* walkDir(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkDir(full);
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
  INSERT INTO tracks (title, artist, album, album_artist, year, track_number, duration, file_path, cover_path, mime_type)
  VALUES (@title, @artist, @album, @album_artist, @year, @track_number, @duration, @file_path, @cover_path, @mime_type)
  ON CONFLICT(file_path) DO UPDATE SET
    title        = excluded.title,
    artist       = excluded.artist,
    album        = excluded.album,
    album_artist = excluded.album_artist,
    year         = excluded.year,
    track_number = excluded.track_number,
    duration     = excluded.duration,
    cover_path   = excluded.cover_path,
    scanned_at   = datetime('now')
`);

export async function scanLibrary(musicDir) {
  const files = [...walkDir(resolve(musicDir))];
  console.log(`Found ${files.length} audio files in ${musicDir}`);

  let added = 0, updated = 0, failed = 0;

  for (const filePath of files) {
    try {
      const meta = await mm.parseFile(filePath, { skipCovers: false });
      const { common, format } = meta;

      // We need the row ID to name the cover file, so insert first without cover
      const result = upsert.run({
        title:        common.title  ?? null,
        artist:       common.artist ?? null,
        album:        common.album  ?? null,
        album_artist: common.albumartist ?? null,
        year:         common.year   ?? null,
        track_number: common.track?.no ?? null,
        duration:     format.duration ?? null,
        file_path:    filePath,
        cover_path:   null,
        mime_type:    MIME[extname(filePath).toLowerCase()] ?? 'audio/mpeg',
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
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const musicPath = process.argv[2] ?? resolve(__dir, '../../music');
  scanLibrary(musicPath).catch(console.error);
}
