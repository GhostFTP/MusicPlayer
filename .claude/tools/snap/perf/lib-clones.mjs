// lib-clones.mjs — BIBLIOTECAS GRANDES DE PRUEBA: clona las filas de una COPIA de la base hasta N pistas.
//
// Para medir y probar con 4646, 25 000 o 50 000 pistas sin tener esa música: parte de una copia de
// music.db (la de desarrollo tiene unas 680 pistas) y repite sus filas con otra ruta de archivo,
// otro álbum («Álbum [k]») y otro artista de álbum («Artista k»), así crecen también los álbumes y
// los artistas. Los años y los géneros se conservan (cada uno queda con muchas más pistas).
//
// ⚠️ NUNCA TOCA LA BASE REAL. Se niega a correr si el origen o el destino no están dentro de la
// carpeta temporal del sistema (os.tmpdir()), o si el origen es la base que usa el servidor
// (MUSIC_DB_PATH) o vive en un music-server/data. El origen tiene que ser una COPIA hecha antes:
//   cp music-server/data/music.db* <carpeta temporal>/
// El origen se abre en sólo lectura; se escribe únicamente en los archivos nuevos music-<N>.db.
//
// Uso:
//   node lib-clones.mjs --from <tmp>/music.db --out <tmp>/clones [--sizes 4646,25000,50000]
// Después, un backend de prueba con MUSIC_DB_PATH=<tmp>/clones/music-25000.db en un puerto que no
// sea el 3000 (el de la regresión es el 3100).
// Código de salida: 0 bien · 2 se negó a correr · 1 error.
import { copyFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const negarse = (msg) => { console.error(`[lib-clones] ME NIEGO: ${msg}`); process.exit(2); };
const from = arg('--from'), out = arg('--out');
const sizes = (arg('--sizes') ?? '4646,25000,50000').split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
if (!from || !out || !sizes.length) negarse('uso: node lib-clones.mjs --from <copia.db en la carpeta temporal> --out <carpeta temporal> [--sizes 4646,25000,50000]');

const real = (p) => { const r = resolve(p); try { return realpathSync(r); } catch { const d = dirname(r); try { return join(realpathSync(d), r.slice(d.length + 1)); } catch { return r; } } };
const TMP = real(tmpdir());
const dentroDeTmp = (p) => { const rel = relative(TMP, real(p)); return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel); };
const src = real(from), dst = real(out);
if (!existsSync(src)) negarse(`no existe ${src}`);
if (!dentroDeTmp(src)) negarse(`el origen no está en la carpeta temporal (${TMP}): ${src}. Copia la base ahí primero; este script no abre una base que no sea una copia.`);
if (!dentroDeTmp(dst)) negarse(`el destino no está en la carpeta temporal (${TMP}): ${dst}`);
if (src.split(sep).join('/').toLowerCase().includes('music-server/data/')) negarse(`el origen está en un music-server/data: ${src}`);
if (process.env.MUSIC_DB_PATH && real(process.env.MUSIC_DB_PATH) === src) negarse('el origen es la base de MUSIC_DB_PATH (la que usa el servidor)');

mkdirSync(dst, { recursive: true });
const origen = new DatabaseSync(src, { readOnly: true });
const cols = origen.prepare('PRAGMA table_info(tracks)').all().map((c) => c.name).filter((c) => c !== 'id');
const base = origen.prepare(`SELECT ${cols.join(',')} FROM tracks ORDER BY id`).all();
origen.close();
if (!base.length) negarse('la copia no tiene pistas');
console.log(`[lib-clones] origen: ${src} (${base.length} pistas, sólo lectura)`);

for (const N of sizes) {
  const f = join(dst, `music-${N}.db`);
  if (existsSync(f)) { console.log(`[lib-clones] ${f} ya existe: no lo piso`); continue; }
  // La copia byte a byte trae también usuarios, playlists y esquema; después se le suman pistas.
  copyFileSync(src, f); for (const x of ['-wal', '-shm']) if (existsSync(src + x)) copyFileSync(src + x, f + x);
  const db = new DatabaseSync(f);
  const ins = db.prepare(`INSERT INTO tracks (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
  let n = db.prepare('SELECT COUNT(*) n FROM tracks').get().n;
  db.exec('BEGIN');
  for (let k = 1; n < N; k++) for (const r of base) {
    if (n >= N) break;
    const x = { ...r, file_path: `${r.file_path}#${k}`, album: r.album == null ? null : `${r.album} [${k}]`, album_artist: r.album_artist == null ? null : `${r.album_artist} ${k}` };
    ins.run(...cols.map((c) => x[c])); n++;
  }
  db.exec('COMMIT');
  const t = db.prepare('SELECT COUNT(*) pistas, COUNT(DISTINCT album_artist) artistas, COUNT(DISTINCT album) albumes, COUNT(DISTINCT year) anios, (SELECT MAX(c) FROM (SELECT COUNT(*) c FROM tracks GROUP BY genre)) genero_mayor FROM tracks').get();
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close();
  console.log(`[lib-clones] ${f}: ${JSON.stringify(t)}`);
}
