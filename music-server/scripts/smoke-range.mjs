// Smoke del header Range (1.24.1) en los DOS streams: audio (GET /stream/:id) y video
// (GET /stream/video/:id), que comparten enviarConRange + parsearRange (src/stream/).
//
// CÓMO SE CORRE
//   npm run smoke:range
// No hace falta levantar nada: el script levanta SU PROPIO servidor en un puerto libre, con una
// base y una carpeta de videos TEMPORALES, y al final apaga SOLO ese proceso y borra todo. Nunca
// habla con sonorarev.com ni con :3000.
//
// POR QUÉ "SIGUE VIVO" DESPUÉS DE CADA CASO: hasta la 1.24.0, "Range: bytes=-100" (o "-0", o
// "abc") al stream de VIDEO tumbaba el proceso entero (start = NaN → createReadStream lanza
// dentro de un handler async sin dueño). Por eso, tras CADA caso, se pide /api/health (200) y un
// rango normal 0-99 (206). Si el servidor murió, el caso falla, se anota y se levanta otro para
// seguir midiendo los demás casos.
//
// Los archivos no necesitan ser MP4 ni FLAC de verdad: el stream sirve bytes. Llevan un patrón
// conocido (byte i = i % 251) para comparar cada respuesta byte a byte con lo esperado.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'sonorarev-range-'));
process.env.MUSIC_DB_PATH = join(dir, 'test.db');
const SECRETO = 'smoke-range';
process.env.JWT_SECRET = SECRETO;

const { default: db } = await import('../src/db/database.js');
const { signToken } = await import('../src/auth/jwt.js');
const { idDeRuta } = await import('../src/videos/index.js');

const ID = 900001;
const S_AUDIO = 50_000;
const S_VIDEO = 120_000;
const RUTA_VIDEO = 'Smoke Range/Largo (2024).mp4';

function patron(n) {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) b[i] = i % 251;
  return b;
}
const AUDIO = patron(S_AUDIO);
const VIDEO = patron(S_VIDEO);
writeFileSync(join(dir, 'pista.flac'), AUDIO);
mkdirSync(join(dir, 'videos', 'Smoke Range'), { recursive: true });
writeFileSync(join(dir, 'videos', RUTA_VIDEO), VIDEO);

db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(ID, 'smoke-range', 'x');
db.prepare('INSERT INTO tracks (id, title, file_path, mime_type) VALUES (?, ?, ?, ?)')
  .run(ID, 'pista de prueba', join(dir, 'pista.flac'), 'audio/flac');
const token = signToken({ id: ID, username: 'smoke-range' });

// ---- el servidor (uno solo vivo a la vez; se relevanta si un caso lo tumba) ----

function puertoLibre() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  });
}

const env = { ...process.env };
for (const k of ['GOOGLE_IOS_CLIENT_ID', 'GOOGLE_FAKE', 'CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD', 'PORT', 'VIDEO_DIR']) delete env[k];
const hijos = [];
let srv = null;

async function levantar() {
  const port = await puertoLibre();
  const hijo = spawn(process.execPath, ['server.js'], {
    cwd: RAIZ,
    env: { ...env, NODE_ENV: 'development', JWT_SECRET: SECRETO, MUSIC_DB_PATH: process.env.MUSIC_DB_PATH, PORT: String(port), VIDEO_DIR: join(dir, 'videos') },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let salida = '';
  hijo.stdout.on('data', (d) => { salida += d; });
  hijo.stderr.on('data', (d) => { salida += d; });
  hijos.push(hijo);
  const s = { hijo, base: `http://127.0.0.1:${port}`, salida: () => salida };
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${s.base}/api/health`)).ok) return s; } catch { /* todavía no escucha */ }
    if (hijo.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`el servidor no levantó:\n${salida}`);
}

process.on('exit', () => {
  for (const h of hijos) if (h.exitCode === null) h.kill();
  rmSync(dir, { recursive: true, force: true });
});

// ---- utilidades ----

let pass = 0;
let fail = 0;
const tabla = [];
function check(ok, label, detalle = '') {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FALLA ${label}${detalle ? `  → ${detalle}` : ''}`); }
  return ok;
}

// Una petición que nunca lanza: { status, headers, body } o { error } si se cortó la conexión.
async function pedir(path, { range, method = 'GET' } = {}) {
  try {
    const res = await fetch(`${srv.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(range !== undefined ? { Range: range } : {}) },
      signal: AbortSignal.timeout(5000),
    });
    const body = Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, body };
  } catch (e) {
    return { error: e.cause?.code ?? e.name ?? String(e) };
  }
}

// ¿Sigue vivo? /api/health 200 y un 0-99 → 206. Si no, se levanta otro (y se dice).
async function sigueVivo(path) {
  const h = await pedir('/api/health');
  const r = await pedir(path, { range: 'bytes=0-99' });
  const vivo = h.status === 200 && r.status === 206 && r.body?.length === 100;
  if (!vivo) {
    const murio = srv.hijo.exitCode !== null || (await new Promise((res) => setTimeout(() => res(srv.hijo.exitCode !== null), 300)));
    const motivo = murio ? `el proceso MURIÓ (exit ${srv.hijo.exitCode})` : `health ${h.status ?? h.error} · 0-99 ${r.status ?? r.error}`;
    if (srv.hijo.exitCode === null) srv.hijo.kill();
    srv = await levantar();
    return { vivo, motivo: `${motivo} → servidor relevantado` };
  }
  return { vivo, motivo: '' };
}

// ---- los casos ----
//
// `esperado(S)` devuelve { status, rango: [a, b] | null } — rango null = cuerpo entero (200) o
// vacío (416). HEAD no trae cuerpo; sólo se miran estado y cabeceras.
const CASOS = [
  { nombre: 'sin Range', range: undefined, esperado: () => ({ status: 200 }) },
  { nombre: 'bytes=0-', range: 'bytes=0-', esperado: (S) => ({ status: 206, rango: [0, S - 1] }) },
  { nombre: 'bytes=0-99', range: 'bytes=0-99', esperado: () => ({ status: 206, rango: [0, 99] }) },
  { nombre: 'bytes=-100 (sufijo)', range: 'bytes=-100', esperado: (S) => ({ status: 206, rango: [S - 100, S - 1] }) },
  { nombre: 'bytes=-0', range: 'bytes=-0', esperado: () => ({ status: 416 }) },
  { nombre: 'bytes=-99999999 (sufijo > tamaño)', range: 'bytes=-99999999', esperado: (S) => ({ status: 206, rango: [0, S - 1] }) },
  { nombre: 'bytes=5-2 (a > b)', range: 'bytes=5-2', esperado: () => ({ status: 200 }) },
  { nombre: 'bytes=abc', range: 'bytes=abc', esperado: () => ({ status: 200 }) },
  { nombre: 'Range: abc', range: 'abc', esperado: () => ({ status: 200 }) },
  { nombre: 'bytes=0-1,5-6 (multi-rango)', range: 'bytes=0-1,5-6', esperado: () => ({ status: 200 }) },
  { nombre: 'bytes=S- (inicio = tamaño)', range: (S) => `bytes=${S}-`, esperado: () => ({ status: 416 }) },
  { nombre: 'bytes=0-99999999 (fin > tamaño)', range: 'bytes=0-99999999', esperado: (S) => ({ status: 206, rango: [0, S - 1] }) },
  { nombre: 'HEAD sin Range', range: undefined, method: 'HEAD', esperado: () => ({ status: 200 }) },
  { nombre: 'HEAD bytes=0-99', range: 'bytes=0-99', method: 'HEAD', esperado: () => ({ status: 206, rango: [0, 99] }) },
];

function evaluar(r, esp, S, archivo, method) {
  if (r.error) return `conexión cortada (${r.error})`;
  const problemas = [];
  if (r.status !== esp.status) problemas.push(`estado ${r.status}≠${esp.status}`);
  if (r.headers.get('accept-ranges') !== 'bytes') problemas.push(`Accept-Ranges ${r.headers.get('accept-ranges')}`);
  const cr = r.headers.get('content-range');
  const len = Number(r.headers.get('content-length'));
  if (esp.status === 206) {
    const [a, b] = esp.rango;
    if (cr !== `bytes ${a}-${b}/${S}`) problemas.push(`Content-Range ${cr}`);
    if (len !== b - a + 1) problemas.push(`Content-Length ${len}`);
    if (method !== 'HEAD' && !r.body.equals(archivo.subarray(a, b + 1))) problemas.push(`cuerpo de ${r.body.length} B no coincide`);
  } else if (esp.status === 200) {
    if (cr !== null) problemas.push(`Content-Range inesperado ${cr}`);
    if (len !== S) problemas.push(`Content-Length ${len}`);
    if (method !== 'HEAD' && !r.body.equals(archivo)) problemas.push(`cuerpo de ${r.body.length} B no es el archivo`);
  } else if (esp.status === 416) {
    if (cr !== `bytes */${S}`) problemas.push(`Content-Range ${cr}`);
  }
  return problemas.join(' · ');
}

const OBJETIVOS = [
  { nombre: 'video', path: `/stream/video/${idDeRuta(RUTA_VIDEO)}`, archivo: VIDEO, S: S_VIDEO },
  { nombre: 'audio', path: `/stream/${ID}`, archivo: AUDIO, S: S_AUDIO },
];

try {
  srv = await levantar();
  console.log(`[SMOKE-RANGE] servidor propio en ${srv.base} · carpeta ${dir}`);
  for (const o of OBJETIVOS) {
    console.log(`\n[${o.nombre}] ${o.path} · ${o.S} bytes`);
    for (const c of CASOS) {
      const range = typeof c.range === 'function' ? c.range(o.S) : c.range;
      const esp = c.esperado(o.S);
      const r = await pedir(o.path, { range, method: c.method });
      const problema = evaluar(r, esp, o.S, o.archivo, c.method);
      const okCaso = check(!problema, `${o.nombre} · ${c.nombre} → ${esp.status}`, problema);
      const { vivo, motivo } = await sigueVivo(o.path);
      const okVivo = check(vivo, `${o.nombre} · ${c.nombre} · sigue vivo (health 200 + 0-99 206)`, motivo);
      tabla.push({ objetivo: o.nombre, caso: c.nombre, esperado: esp.status, obtenido: r.error ? `cortada` : r.status, caso_ok: okCaso, vivo: okVivo, nota: [problema, motivo].filter(Boolean).join(' · ') });
    }
  }
  console.log('\nobjetivo · caso · esperado · obtenido · resultado · vivo');
  for (const t of tabla) console.log(`${t.objetivo} · ${t.caso} · ${t.esperado} · ${t.obtenido} · ${t.caso_ok ? 'ok' : 'FALLA'} · ${t.vivo ? 'sí' : 'NO'}${t.nota ? ' · ' + t.nota : ''}`);
} catch (e) {
  fail++;
  console.error('[SMOKE-RANGE] se cortó:', e);
} finally {
  for (const h of hijos) if (h.exitCode === null) h.kill();
  await Promise.all(hijos.map((h) => (h.exitCode === null ? new Promise((r) => h.on('exit', r)) : null)));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\nsmoke-range: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
