// video-fixtures.mjs — VIDEOS SINTÉTICOS para la regresión y los smokes (H.264/AAC con ffmpeg).
// No usa red ni toca nada fuera de la carpeta que se le da. Los videos reales (VIDEO_DIR de
// producción o local) nunca se leen ni se escriben.
//
//   node video-fixtures.mjs              genera en una carpeta temporal NUEVA, verifica y la BORRA
//   node video-fixtures.mjs --out <dir>  genera en <dir> (tiene que no existir o estar vacía) y la deja
//   import { crearFixtures } from './video-fixtures.mjs'   (así lo usa regresion.mjs)
//
// LA FORMA es la que indexa el backend (music-server/src/videos/index.js): VIDEO_DIR/<Artista>/<archivo>,
// sólo dos niveles, extensión .mp4/.m4v/.mov, el año sale de un "(AAAA)" al final del nombre y la
// portada es <mismo nombre>.jpg al lado. El id es sha1("<Artista>/<archivo>")[0:16], así que estos
// nombres dan SIEMPRE los mismos ids.
//
// Los tres:
//   1. Fixture Uno/Faststart (2021).mp4        2,5 s · moov AL INICIO (+faststart) · con portada
//   2. Fixture Uno/Moov Al Final (2020).mp4    2,5 s · moov AL FINAL (lo que hace ffmpeg por defecto) · sin portada
//   3. Fixture Dos/Largo Para Seek.mp4         30 s · faststart · sin año · con portada (para Range y seek)
//
// Determinista: misma fuente (testsrc2 + seno), un solo hilo, flags bitexact y sin metadatos. Lo
// verifica leyendo el orden de los átomos de primer nivel (moov antes o después de mdat).
//
// Código de salida (CLI): 0 bien · 3 no hay ffmpeg · 1 ffmpeg falló o la verificación no cuadra.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, openSync, readSync, closeSync, fstatSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FFMPEG = process.env.FFMPEG || 'ffmpeg';

export const FIXTURES = [
  { artista: 'Fixture Uno', archivo: 'Faststart (2021).mp4', segundos: 2.5, faststart: true, portada: true },
  { artista: 'Fixture Uno', archivo: 'Moov Al Final (2020).mp4', segundos: 2.5, faststart: false, portada: false },
  { artista: 'Fixture Dos', archivo: 'Largo Para Seek.mp4', segundos: 30, faststart: true, portada: true },
];

export class SinFfmpeg extends Error {}

/** ¿Hay ffmpeg? Devuelve la primera línea de `ffmpeg -version` o null. */
export function versionFfmpeg() {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-version'], { encoding: 'utf8', windowsHide: true });
  if (r.error || r.status !== 0) return null;
  return r.stdout.split(/\r?\n/)[0];
}

function ff(args) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { encoding: 'utf8', windowsHide: true });
  if (r.error || r.status !== 0) throw new Error(`ffmpeg falló (${r.error?.code ?? 'exit ' + r.status}): ${(r.stderr || '').trim().slice(0, 300)}`);
}

const BITEXACT = ['-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact', '-map_metadata', '-1', '-threads', '1'];

function generarVideo(out, { segundos, faststart }, i) {
  ff([
    '-f', 'lavfi', '-i', `testsrc2=size=320x180:rate=15:duration=${segundos}`,
    '-f', 'lavfi', '-i', `sine=frequency=${440 + 110 * i}:sample_rate=44100:duration=${segundos}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'baseline', '-pix_fmt', 'yuv420p', '-g', '15',
    '-c:a', 'aac', '-b:a', '64k', '-ac', '1',
    '-shortest', ...BITEXACT,
    ...(faststart ? ['-movflags', '+faststart'] : []),
    out,
  ]);
}

function generarPortada(out, i) {
  ff(['-f', 'lavfi', '-i', `color=c=${['0x6b4bd6', '0x1f9e8a', '0xd69a1f'][i % 3]}:size=320x180:duration=1`, '-frames:v', '1', '-update', '1', ...BITEXACT, out]);
}

/** Orden de los átomos de primer nivel de un MP4 (p. ej. ['ftyp','moov','mdat']). */
export function atomosRaiz(ruta) {
  const fd = openSync(ruta, 'r');
  try {
    const size = fstatSync(fd).size;
    const h = Buffer.alloc(16);
    const out = [];
    let pos = 0;
    while (pos + 8 <= size && out.length < 64) {
      readSync(fd, h, 0, 16, pos);
      let len = h.readUInt32BE(0);
      const tipo = h.toString('latin1', 4, 8);
      if (len === 1) len = Number(h.readBigUInt64BE(8));
      else if (len === 0) len = size - pos;
      if (len < 8) throw new Error(`átomo inválido en ${pos} de ${ruta}`);
      out.push(tipo);
      pos += len;
    }
    return out;
  } finally { closeSync(fd); }
}

/**
 * Genera los 3 fixtures en `dir` (se crea; tiene que no existir o estar vacía) y los verifica.
 * Lanza SinFfmpeg si no hay ffmpeg. Devuelve { dir, ffmpeg, videos: [{ rel, ruta, bytes, segundos, faststart, portada, atomos }] }.
 */
export function crearFixtures(dir) {
  const ffmpeg = versionFfmpeg();
  if (!ffmpeg) throw new SinFfmpeg(`no encuentro ffmpeg ("${FFMPEG}"): instálalo (winget install Gyan.FFmpeg) o pon FFMPEG=<ruta>`);
  const raiz = resolve(dir);
  if (existsSync(raiz) && readdirSync(raiz).length) throw new Error(`${raiz} no está vacía: no escribo ahí`);
  mkdirSync(raiz, { recursive: true });
  const videos = FIXTURES.map((f, i) => {
    const carpeta = join(raiz, f.artista);
    mkdirSync(carpeta, { recursive: true });
    const ruta = join(carpeta, f.archivo);
    generarVideo(ruta, f, i);
    if (f.portada) generarPortada(join(carpeta, f.archivo.replace(/\.mp4$/, '.jpg')), i);
    const atomos = atomosRaiz(ruta);
    const moovPrimero = atomos.indexOf('moov') < atomos.indexOf('mdat');
    if (atomos.indexOf('moov') < 0 || atomos.indexOf('mdat') < 0) throw new Error(`${f.archivo}: faltan moov/mdat (${atomos.join(',')})`);
    if (moovPrimero !== f.faststart) throw new Error(`${f.archivo}: esperaba moov ${f.faststart ? 'antes' : 'después'} de mdat y quedó ${atomos.join(',')}`);
    return { rel: `${f.artista}/${f.archivo}`, ruta, bytes: statSync(ruta).size, segundos: f.segundos, faststart: f.faststart, portada: f.portada, atomos };
  });
  return { dir: raiz, ffmpeg, videos };
}

// ── CLI ──
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--out');
  const out = i >= 0 ? process.argv[i + 1] : null;
  const dir = out ? resolve(out) : mkdtempSync(join(tmpdir(), 'video-fixtures-'));
  let code = 0;
  try {
    const r = crearFixtures(dir);
    console.log(`[video-fixtures] ${r.ffmpeg}`);
    for (const v of r.videos) console.log(`[video-fixtures] ${v.rel.padEnd(34)} ${String(v.bytes).padStart(8)} B · ${v.segundos} s · ${v.atomos.join(',')} · portada ${v.portada ? 'sí' : 'no'}`);
    console.log(`video-fixtures: ${r.videos.length}/${FIXTURES.length}`);
  } catch (e) {
    console.error(`[video-fixtures] ${e.message}`);
    code = e instanceof SinFfmpeg ? 3 : 1;
  } finally {
    if (!out) { rmSync(dir, { recursive: true, force: true }); console.log(`[video-fixtures] borrada ${dir}`); }
    else console.log(`[video-fixtures] quedan en ${dir}`);
  }
  process.exitCode = code;
}
