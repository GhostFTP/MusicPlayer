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

// Barrido de huérfanas — límites de seguridad (ver el pruneo al final de scanLibrary):
//  - GUARD 1: nunca barrer si el walk no encontró NINGÚN archivo (mount caído/vacío).
//  - GUARD 2: aun con archivos, si el barrido borraría más de PRUNE_MAX_RATIO de la
//    tabla Y más de PRUNE_MIN_ABS filas, abortar (probable mount PARCIAL). Override: --force-prune.
const PRUNE_MAX_RATIO = 0.5;   // no borrar de una si supera el 50% de las filas
const PRUNE_MIN_ABS   = 10;    // por debajo de esto, un % alto igual es poquitas filas → seguro

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
  INSERT INTO tracks (title, artist, album, album_artist, genre, year, track_number, disc_number, disc_total, duration, file_path, cover_path, lrc_path, vocals, mime_type,
                      codec, bits_per_sample, sample_rate, bitrate, lossless)
  VALUES (@title, @artist, @album, @album_artist, @genre, @year, @track_number, @disc_number, @disc_total, @duration, @file_path, @cover_path, @lrc_path, @vocals, @mime_type,
          @codec, @bits_per_sample, @sample_rate, @bitrate, @lossless)
  ON CONFLICT(file_path) DO UPDATE SET
    title        = excluded.title,
    artist       = excluded.artist,
    album        = excluded.album,
    album_artist = excluded.album_artist,
    genre        = excluded.genre,
    year         = excluded.year,
    track_number = excluded.track_number,
    disc_number  = excluded.disc_number,
    disc_total   = excluded.disc_total,
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

// Encuentra las filas huérfanas (archivo inexistente en disco). Solo lectura.
function findOrphans() {
  const rows = db.prepare('SELECT id, file_path FROM tracks').all();
  const orphanIds = rows.filter(r => !r.file_path || !existsSync(r.file_path)).map(r => r.id);
  return { orphanIds, total: rows.length };
}

// Borra las filas huérfanas dadas, en una transacción. FK ON → el CASCADE limpia
// solas las filas de playlist_tracks. Devuelve cuántas pistas y cuántas filas de
// playlist se fueron (para el log).
function deleteOrphans(orphanIds) {
  db.exec('PRAGMA foreign_keys = ON');   // defensivo: el CASCADE a playlist_tracks depende de esto
  db.exec('PRAGMA busy_timeout = 5000'); // tolera escrituras concurrentes de la app (WAL) sin SQLITE_BUSY
  const playlistRows = db.prepare(
    `SELECT COUNT(*) c FROM playlist_tracks WHERE track_id IN (${orphanIds.join(',')})`
  ).get().c;

  const del = db.prepare('DELETE FROM tracks WHERE id = ?');
  db.exec('BEGIN');
  try {
    for (const id of orphanIds) del.run(id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { deleted: orphanIds.length, playlistRows };
}

export async function scanLibrary(musicDir, { prune = true, forcePrune = false } = {}) {
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
        disc_number:  common.disk?.no ?? null,
        disc_total:   common.disk?.of ?? null,
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

  // --- Barrido de huérfanas (filas cuyo archivo ya no existe en disco) ---
  if (!prune) {
    console.log('  [PRUNE] Desactivado (--no-prune).');
    return;
  }
  // GUARD 1 — mount caído/vacío: si el walk no halló NINGÚN archivo, barrer
  // vaciaría la biblioteca entera de la DB. Jamás barrer con files.length === 0.
  if (files.length === 0) {
    console.warn('  [PRUNE] 0 archivos hallados: barrido OMITIDO (¿mount caído/vacío?). No se borró nada.');
    return;
  }

  const { orphanIds, total } = findOrphans();
  const n = orphanIds.length;
  const ratio = total > 0 ? n / total : 0;

  if (n === 0) {
    console.log('  [PRUNE] Sin huérfanas.');
    return;
  }
  // GUARD 2 — barrido masivo: un mount PARCIAL (pocos archivos, pero no cero) burlaría
  // el Guard 1 y borraría filas válidas en masa. Si el barrido tocaría más de
  // PRUNE_MAX_RATIO de la tabla Y más de PRUNE_MIN_ABS filas, abortar y pedir revisión.
  if (!forcePrune && n > PRUNE_MIN_ABS && ratio > PRUNE_MAX_RATIO) {
    console.warn(
      `\n  ⚠️  [PRUNE] ABORTADO: el barrido quería borrar ${n}/${total} filas ` +
      `(${(ratio * 100).toFixed(0)}% > ${PRUNE_MAX_RATIO * 100}%).\n` +
      `      Un borrado normal de huérfanas es de pocas filas; esto sugiere un mount PARCIAL\n` +
      `      o un problema, no una limpieza normal. NO se borró nada.\n` +
      `      Revisá /music. Si el borrado es intencional, re-corré con --force-prune.`
    );
    return;
  }

  const { deleted, playlistRows } = deleteOrphans(orphanIds);
  console.log(`  [PRUNE] Huérfanas borradas: ${deleted}` +
              (playlistRows ? ` (+${playlistRows} filas de playlist por CASCADE)` : ''));
}

// Si se ejecuta directamente: node src/scanner/index.js [ruta] [--no-prune] [--force-prune]
// Ruta: 1º arg no-flag, 2º env MUSIC_DIR (.env), 3º fallback local ../../music.
//   --no-prune    : no barrer huérfanas (solo agregar/actualizar).
//   --force-prune : barrer aunque supere el guard de borrado masivo (Guard 2).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const prune = !args.includes('--no-prune');
  const forcePrune = args.includes('--force-prune');
  // 1º arg que no sea flag = ruta; luego env MUSIC_DIR; luego fallback local.
  const musicPath = args.find(a => !a.startsWith('--')) ?? process.env.MUSIC_DIR ?? resolve(__dir, '../../music');
  scanLibrary(musicPath, { prune, forcePrune }).catch(console.error);
}
