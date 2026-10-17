// Smoke test del endurecimiento de POST /api/auth/login (1.37.1): el límite de FALLOS por IP
// y por cuenta, y el bcrypt de relleno para que el tiempo no diga quién existe.
//
// CÓMO SE CORRE
//   npm run smoke:login
// Levanta SU PROPIO servidor (node server.js) contra una base TEMPORAL, como smoke-google:
// MUSIC_DB_PATH va antes de importar nada, porque db/database.js abre el archivo al evaluarse.
//
// `ip` va como CF-Connecting-IP. Cada escenario usa IPs y cuentas propias, así los contadores
// de uno no contaminan al siguiente. Lo único que NO se puede probar acá con el servidor es que
// la ventana venza (son 15 minutos): eso lo prueba la primera parte, sobre limiteDeFallos con
// un reloj falso.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'sonorarev-login-'));
process.env.MUSIC_DB_PATH = join(dir, 'test.db');
const SECRETO = 'smoke-login';
process.env.JWT_SECRET = SECRETO;

const { default: db } = await import('../src/db/database.js');
const { hashPassword } = await import('../src/users/service.js');
const { limiteDeFallos } = await import('../src/auth/rate-limit.js');

const PORT = 3191;
const BASE = `http://localhost:${PORT}`;
const PASS = 'correcta-123';

let pass = 0;
let fail = 0;
function check(ok, label, detalle = '') {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FALLA ${label}${detalle ? `  → ${detalle}` : ''}`); }
}
const filas = [];   // la tabla de escenarios que se imprime al final
const fila = (nombre, codigos) => { filas.push({ nombre, codigos }); return codigos; };

// ---- 1. limiteDeFallos, con reloj falso ----
console.log('\n[1] limiteDeFallos (reloj falso)');
{
  const l = limiteDeFallos({ max: 3, ventanaMs: 1000 });
  for (let i = 0; i < 3; i++) l.intento('k', 0);
  check(l.bloqueado('k', 10) > 0, 'con max fallos queda bloqueada');
  check(l.bloqueado('k', 999) === 1, 'Retry-After redondea hacia arriba (1 ms → 1 s)');
  check(l.bloqueado('k', 1000) === 0, 'vence justo al cerrar la ventana');
  l.intento('k', 1000);
  check(l.bloqueado('k', 1001) === 0, 'tras vencer, la ventana arranca de cero');

  const m = limiteDeFallos({ max: 3, ventanaMs: 1000 });
  m.intento('a', 0); m.intento('a', 0);
  m.acierto('a');
  m.intento('a', 0); m.intento('a', 0);
  check(m.bloqueado('a', 0) === 0, 'un acierto borra la cuenta (2 + acierto + 2 no bloquea)');
  m.intento('b', 0); m.intento('b', 0); m.intento('b', 0);
  check(m.bloqueado('a', 0) === 0 && m.bloqueado('b', 0) > 0, 'las claves no se mezclan');
}

// ---- 2. El servidor ----
db.prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)')
  .run('familia', 'familia@example.com', await hashPassword(PASS));
for (const u of ['victima', 'rotada', 'sinip', 'paralelo', 'reinicio']) {
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(u, await hashPassword(PASS));
}

function entorno() {
  const env = { ...process.env };
  for (const k of ['GOOGLE_IOS_CLIENT_ID', 'GOOGLE_FAKE', 'CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD', 'PASSWORD_VIEW_KEY']) delete env[k];
  return { ...env, NODE_ENV: 'development', PORT: String(PORT), JWT_SECRET: SECRETO, MUSIC_DB_PATH: process.env.MUSIC_DB_PATH };
}

let srv = null;
async function levantar() {
  const hijo = spawn(process.execPath, ['server.js'], { cwd: RAIZ, env: entorno(), stdio: ['ignore', 'pipe', 'pipe'] });
  let salida = '';
  hijo.stdout.on('data', (d) => { salida += d; });
  hijo.stderr.on('data', (d) => { salida += d; });
  srv = { hijo, salida: () => salida };
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* todavía no */ }
    if (hijo.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`el servidor no levantó:\n${salida}`);
}
function apagar() {
  if (!srv || srv.hijo.exitCode !== null) return Promise.resolve();
  return new Promise((r) => { srv.hijo.once('exit', r); srv.hijo.kill(); });
}

async function login(username, password, ip) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(ip ? { 'cf-connecting-ip': ip } : {}) },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, retry: res.headers.get('retry-after'), ms: performance.now() - t0 };
}
const codigos = (rs) => rs.map((r) => r.status).join(' ');
const veces = (rs, s) => rs.filter((r) => r.status === s).length;

try {
  await levantar();
  // El relleno se calcula al cargar: se espera a que esté antes de medir.
  await login('calentar', 'x', '9.9.9.9');

  // ---- 2a. Tiempos ----
  console.log('\n[2a] tiempo existente vs inexistente');
  const N = 25;
  const ex = [];
  const nx = [];
  for (let i = 0; i < N; i++) {
    // IPs y nombres distintos por intento: que el límite no entre en la medición. La cuenta
    // existente sí acumula fallos (25 > 20), así que se la limpia con un acierto a mitad.
    if (i === 12) await login('familia', PASS, '10.7.0.1');
    ex.push((await login('familia', 'mala', `10.9.${i}.1`)).ms);
    nx.push((await login(`nadie${i}`, 'mala', `10.8.${i}.1`)).ms);
  }
  await login('familia', PASS, '10.7.0.2');
  const ord = (a) => [...a].sort((x, y) => x - y);
  const med = (a) => ord(a)[Math.floor(a.length / 2)];
  const p90 = (a) => ord(a)[Math.floor(a.length * 0.9)];
  const tiempos = {
    existente: { mediana: med(ex), p90: p90(ex) },
    inexistente: { mediana: med(nx), p90: p90(nx) },
  };
  const ratio = tiempos.inexistente.mediana / tiempos.existente.mediana;
  // Tolerancia ancha a propósito: lo que se prueba es que ya no hay un orden de magnitud de
  // diferencia (antes: ~2 ms contra ~220 ms), no un empate al milisegundo.
  check(ratio > 0.75 && ratio < 1.33, `medianas parecidas (inexistente/existente = ${ratio.toFixed(2)})`);

  // ---- 2b. Escenarios ----
  console.log('\n[2b] escenarios');

  // A) 15 fallos seguidos desde una IP
  const a = [];
  for (let i = 0; i < 15; i++) a.push(await login('familia', 'mala', '1.1.1.1'));
  fila('15 fallos seguidos, misma IP (1.1.1.1)', codigos(a));
  check(veces(a.slice(0, 10), 401) === 10 && veces(a.slice(10), 429) === 5, 'A: 10 × 401 y después 5 × 429', codigos(a));
  check(a.slice(10).every((r) => Number(r.retry) > 0 && Number(r.retry) <= 900), 'A: los 429 traen Retry-After (1–900 s)');
  check(a.slice(10).every((r) => r.ms < 50), `A: los 429 no corren bcrypt (máx ${Math.max(...a.slice(10).map((r) => r.ms)).toFixed(1)} ms)`);

  // B) correcto desde la IP bloqueada
  const b = await login('familia', PASS, '1.1.1.1');
  fila('correcto tras esos 15, misma IP', String(b.status));
  check(b.status === 429, 'B: el acierto NO desbloquea: sigue en 429', String(b.status));

  // B2) 429 igual para una cuenta inexistente desde la IP bloqueada
  const b2 = await login('nadie-existe', 'mala', '1.1.1.1');
  check(b2.status === 429 && b2.body.error === b.body.error && b2.retry !== null,
    'B: inexistente desde la IP bloqueada → mismo 429, mismo mensaje, con Retry-After');

  // C) 4 fallos, correcto, 4 fallos
  const c = [];
  for (let i = 0; i < 4; i++) c.push(await login('familia', 'mala', '2.2.2.2'));
  c.push(await login('familia', PASS, '2.2.2.2'));
  for (let i = 0; i < 4; i++) c.push(await login('familia', 'mala', '2.2.2.2'));
  fila('4 fallos, correcto, 4 fallos (2.2.2.2)', codigos(c));
  check(codigos(c) === '401 401 401 401 200 401 401 401 401', 'C: el acierto reinicia', codigos(c));
  // Y ahora llega a 10 sin bloquear antes: 4 tras el acierto + 6 = 10 → el 11º es 429.
  const c2 = [];
  for (let i = 0; i < 7; i++) c2.push(await login('familia', 'mala', '2.2.2.2'));
  check(codigos(c2) === '401 401 401 401 401 401 429', 'C: tras el acierto cuenta desde cero (10 fallos nuevos → 429)', codigos(c2));
  await login('familia', PASS, '2.2.2.3');   // limpia la cuenta para lo que sigue

  // D) otra IP mientras 1.1.1.1 sigue bloqueada
  const d = [];
  for (let i = 0; i < 3; i++) d.push(await login('familia', 'mala', '3.3.3.3'));
  d.push(await login('familia', PASS, '3.3.3.3'));
  fila('otra IP (3.3.3.3) con 1.1.1.1 bloqueada: 3 fallos + correcto', codigos(d));
  check(codigos(d) === '401 401 401 200', 'D: el bloqueo es por IP, no general', codigos(d));

  // E) una cuenta atacada rotando IPs
  const e = [];
  for (let i = 0; i < 25; i++) e.push(await login('victima', 'mala', `4.4.4.${i}`));
  const e2 = await login('victima', PASS, '5.5.5.5');
  fila('25 fallos a una cuenta rotando IP, luego correcto desde IP limpia', `${codigos(e)} | ${e2.status}`);
  check(veces(e.slice(0, 20), 401) === 20 && veces(e.slice(20), 429) === 5, 'E: 20 × 401 y 5 × 429 (freno por cuenta)', codigos(e));
  check(e2.status === 429, 'E: el acierto desde una IP limpia también queda en 429', String(e2.status));

  // E2) por nombre y por correo suman al mismo contador
  const e3 = [];
  for (let i = 0; i < 10; i++) e3.push(await login('familia', 'mala', `6.6.6.${i}`));
  for (let i = 0; i < 10; i++) e3.push(await login('familia@example.com', 'mala', `6.6.7.${i}`));
  const e4 = await login('familia', 'mala', '6.6.8.1');
  check(e4.status === 429, 'E: 10 por nombre + 10 por correo = 20 sobre la misma cuenta → 429', String(e4.status));

  // E3) una cuenta inexistente se bloquea igual que una existente
  const e5 = [];
  for (let i = 0; i < 21; i++) e5.push(await login('fantasma', 'mala', `7.7.7.${i}`));
  check(veces(e5.slice(0, 20), 401) === 20 && e5[20].status === 429 && e5[20].body.error === e[24].body.error,
    'E: una inexistente también se bloquea a los 20, con el mismo 429', codigos(e5.slice(18)));

  // F) SIN CF-Connecting-IP: no hay contador por IP
  const f = [];
  for (let i = 0; i < 15; i++) f.push(await login(`sinip-otro${i}`, 'mala', null));
  const f2 = await login('sinip', PASS, null);
  fila('SIN CF-Connecting-IP: 15 fallos de cuentas distintas, luego correcto de otra', `${codigos(f)} | ${f2.status}`);
  check(veces(f, 401) === 15 && f2.status === 200, 'F: sin header nadie bloquea a nadie por IP', `${codigos(f)} | ${f2.status}`);
  const f3 = [];
  for (let i = 0; i < 21; i++) f3.push(await login('sinip', 'mala', null));
  fila('SIN CF-Connecting-IP: 21 fallos a una cuenta', codigos(f3.slice(18)));
  check(veces(f3.slice(0, 20), 401) === 20 && f3[20].status === 429, 'F: sin header queda el freno por cuenta (20 → 429)', codigos(f3.slice(18)));
  const avisos = srv.salida().split('\n').filter((l) => l.includes('sin CF-Connecting-IP'));
  check(avisos.length === 1, `F: el aviso sale UNA vez y no por petición (${avisos.length} línea/s)`);
  check(avisos.every((l) => !/sinip|mala|correcta/.test(l)), 'F: el aviso no trae usuario ni contraseña');

  // Con el header presente (cualquiera de los de arriba) no hay aviso nuevo
  const antes = srv.salida().split('\n').filter((l) => l.includes('sin CF-Connecting-IP')).length;
  await login('familia', 'mala', '8.8.8.8');
  const despues = srv.salida().split('\n').filter((l) => l.includes('sin CF-Connecting-IP')).length;
  fila('CON CF-Connecting-IP', 'cuenta por IP; sin aviso en el log');
  check(antes === despues, 'con CF-Connecting-IP no hay aviso');

  // G) Ráfaga en paralelo desde una IP: el contador se suma antes del bcrypt
  const g = await Promise.all(Array.from({ length: 30 }, () => login('paralelo', 'mala', '11.11.11.11')));
  fila('30 fallos EN PARALELO desde una IP', `${veces(g, 401)} × 401, ${veces(g, 429)} × 429`);
  check(veces(g, 401) === 10 && veces(g, 429) === 20, 'G: en paralelo también pasan sólo 10', `${veces(g, 401)} × 401, ${veces(g, 429)} × 429`);

  // H) Reinicio del servidor: el límite vive en memoria
  for (let i = 0; i < 10; i++) await login('reinicio', 'mala', '12.12.12.12');
  const h1 = await login('reinicio', 'mala', '12.12.12.12');
  await apagar();
  await levantar();
  await login('calentar', 'x', '9.9.9.8');
  const h2 = await login('reinicio', PASS, '12.12.12.12');
  fila('IP bloqueada, reinicio del servidor, correcto', `${h1.status} → reinicio → ${h2.status}`);
  check(h1.status === 429 && h2.status === 200, 'H: el reinicio vacía los contadores (se pierde, como está anotado)', `${h1.status} → ${h2.status}`);

  console.log('\n[tiempos, ms]');
  for (const [k, v] of Object.entries(tiempos)) console.log(`  ${k.padEnd(12)} mediana ${v.mediana.toFixed(1)} · p90 ${v.p90.toFixed(1)}`);
  console.log('\n[escenarios]');
  for (const r of filas) console.log(`  ${r.nombre}\n      ${r.codigos}`);
} catch (e) {
  fail++;
  console.error('[SMOKE-LOGIN] error:', e);
} finally {
  await apagar();
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n[SMOKE-LOGIN] ${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
