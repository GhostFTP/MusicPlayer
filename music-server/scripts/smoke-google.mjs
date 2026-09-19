// Smoke test de POST /api/auth/google: el login con Google desde la app del teléfono.
//
// CÓMO SE CORRE
//   npm run smoke:google
// No hace falta levantar nada antes: el script levanta SUS PROPIOS servidores, porque
// la prueba necesita cuatro configuraciones distintas del mismo servidor (con Google,
// sin Google, con el verificador real y en producción) y una sola terminal no alcanza.
//
// CORRE SOBRE UNA BASE TEMPORAL, no sobre la de desarrollo: MUSIC_DB_PATH se pone ANTES
// de importar nada del servidor, porque db/database.js abre el archivo al evaluarse. Los
// servidores hijos reciben la misma variable, así que el script y ellos ven las mismas
// filas.
//
// EL VERIFICADOR FALSO (GOOGLE_FAKE=1, auth/google.js) acepta `fake:<correo>` y
// `fake:<correo>:unverified` sin hablar con Google. Lo que se prueba acá es TODO lo que
// pasa después de verificar —quién entra, quién no, qué se escribe—, que es lo que
// decide este servidor. Que Google firme bien sus tokens es problema de Google.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'sonorarev-google-'));
process.env.MUSIC_DB_PATH = join(dir, 'test.db');
// El MISMO secreto que los servidores hijos, y también antes de importar: auth/jwt.js lo
// lee al evaluarse, y sin esto este proceso verificaría contra el secreto por defecto
// tokens que los hijos firmaron con otro.
const SECRETO = 'smoke-google';
process.env.JWT_SECRET = SECRETO;

const { default: db } = await import('../src/db/database.js');
const { verifyToken } = await import('../src/auth/jwt.js');

const CLIENTE = 'smoke-cliente-ios.apps.googleusercontent.com';
const MENSAJE_403 = 'Esta cuenta no tiene acceso. Pídeselo a Oscar.';

let pass = 0;
let fail = 0;

function check(ok, label, detalle = '') {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FALLA ${label}${detalle ? `  → ${detalle}` : ''}`); }
}

// ---- Los servidores ----

// El entorno de cada hijo se arma A MANO a partir del de este proceso, borrando lo que
// cambia la prueba: si quien corre esto tiene GOOGLE_IOS_CLIENT_ID o CF_ACCESS_* en su
// shell, el servidor "sin Google" no estaría sin Google.
function entorno(extra) {
  const env = { ...process.env };
  for (const k of ['GOOGLE_IOS_CLIENT_ID', 'GOOGLE_FAKE', 'CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD', 'PORT']) delete env[k];
  return { ...env, NODE_ENV: 'development', JWT_SECRET: SECRETO, MUSIC_DB_PATH: process.env.MUSIC_DB_PATH, ...extra };
}

const hijos = [];

function levantar(nombre, extra) {
  const hijo = spawn(process.execPath, ['server.js'], { cwd: RAIZ, env: entorno(extra), stdio: ['ignore', 'pipe', 'pipe'] });
  let salida = '';
  hijo.stdout.on('data', (d) => { salida += d; });
  hijo.stderr.on('data', (d) => { salida += d; });
  const fin = new Promise((resolve) => hijo.on('exit', (code) => resolve(code)));
  hijos.push(hijo);
  return { nombre, hijo, fin, salida: () => salida, base: extra.PORT ? `http://localhost:${extra.PORT}` : null };
}

async function listo(srv) {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${srv.base}/api/health`);
      if (r.ok) return true;
    } catch { /* todavía no escucha */ }
    if (srv.hijo.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  console.error(`[SMOKE-GOOGLE] El servidor "${srv.nombre}" no levantó:\n${srv.salida()}`);
  return false;
}

function apagar() {
  for (const h of hijos) if (h.exitCode === null) h.kill();
}

// `ip` va como CF-Connecting-IP, que es lo que el límite usa de clave (auth/rate-limit.js).
// Cada caso usa la suya, así el límite de 10 no se come a los casos que no lo prueban.
async function login(srv, idToken, ip) {
  const res = await fetch(`${srv.base}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(idToken === undefined ? {} : { idToken }),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, retryAfter: res.headers.get('retry-after') };
}

async function me(srv, token) {
  const res = await fetch(`${srv.base}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, data: await res.json().catch(() => null) };
}

const cuantos = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
const fila = (id) => db.prepare('SELECT id, username, email FROM users WHERE id = ?').get(id);

// ---- Preparación ----

console.log(`[SMOKE-GOOGLE] base temporal: ${process.env.MUSIC_DB_PATH}`);

// Tres cuentas, una por camino:
//   · ana: cuenta normal con su correo en `email`.
//   · luis@gmail.com: el LEGADO, el correo guardado como nombre y sin `email`.
//   · pedro@gmail.com: alguien que se renombró al correo de OTRA persona; su email es otro.
const ins = db.prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)');
const ana = Number(ins.run('ana', 'ana@gmail.com', 'x').lastInsertRowid);
const luis = Number(ins.run('luis@gmail.com', null, 'x').lastInsertRowid);
const pedro = Number(ins.run('pedro@gmail.com', 'otra@gmail.com', 'x').lastInsertRowid);

const conGoogle = levantar('con Google (falso)', { PORT: '3991', GOOGLE_IOS_CLIENT_ID: CLIENTE, GOOGLE_FAKE: '1' });
const sinGoogle = levantar('sin cliente', { PORT: '3992', GOOGLE_FAKE: '1' });
const real = levantar('verificador real', { PORT: '3993', GOOGLE_IOS_CLIENT_ID: CLIENTE });

try {
  const vivos = await Promise.all([listo(conGoogle), listo(sinGoogle), listo(real)]);
  if (vivos.includes(false)) throw new Error('algún servidor no levantó');

  // ---- [1] Correo existente ----

  console.log('\n[1] correo que ya tiene cuenta');
  {
    const antes = cuantos();
    const r = await login(conGoogle, 'fake:ana@gmail.com', '10.0.0.1');
    check(r.status === 200, 'POST /api/auth/google → 200', `${r.status} ${JSON.stringify(r.data)}`);
    check(typeof r.data?.token === 'string', 'trae token');
    check(r.data?.me?.id === ana && r.data?.me?.username === 'ana' && r.data?.me?.email === 'ana@gmail.com',
      'y `me` es la cuenta de ana', JSON.stringify(r.data?.me));
    check(r.data?.me && !('password_hash' in r.data.me), '`me` no trae el hash');

    let payload = null;
    try { payload = verifyToken(r.data?.token); } catch { /* queda null */ }
    check(payload?.id === ana && payload?.username === 'ana', 'el token está firmado como el de /login', JSON.stringify(payload));

    const m = await me(conGoogle, r.data?.token);
    check(m.status === 200 && m.data?.id === ana, 'y sirve para GET /api/me', `${m.status} ${JSON.stringify(m.data)}`);
    check(JSON.stringify(m.data) === JSON.stringify(r.data?.me), 'GET /api/me devuelve el mismo `me`');
    check(cuantos() === antes, 'no se creó ninguna fila');

    const mayus = await login(conGoogle, 'fake:ANA@Gmail.com', '10.0.0.2');
    check(mayus.status === 200 && mayus.data?.me?.id === ana, 'el correo con mayúsculas encuentra la misma cuenta',
      `${mayus.status} ${JSON.stringify(mayus.data?.me)}`);
  }

  // ---- [2] Legado ----

  console.log('\n[2] correo guardado como nombre, sin email (legado)');
  {
    const antes = cuantos();
    check(fila(luis).email === null, 'la fila de luis arranca sin email');
    const r = await login(conGoogle, 'fake:luis@gmail.com', '10.0.0.3');
    check(r.status === 200 && r.data?.me?.id === luis, '→ 200 con la cuenta de luis', `${r.status} ${JSON.stringify(r.data)}`);
    check(fila(luis).email === 'luis@gmail.com', 'y la fila GANA el email', JSON.stringify(fila(luis)));
    check(fila(luis).username === 'luis@gmail.com', 'sin tocar el nombre');
    check(cuantos() === antes, 'no se creó ninguna fila');
  }

  // ---- [3] Desconocido ----

  console.log('\n[3] correo sin cuenta');
  {
    const antes = cuantos();
    const r = await login(conGoogle, 'fake:nadie@gmail.com', '10.0.0.4');
    check(r.status === 403, '→ 403', `${r.status} ${JSON.stringify(r.data)}`);
    check(r.data?.error === MENSAJE_403, 'con el mensaje acordado', JSON.stringify(r.data));
    check(!('token' in (r.data ?? {})), 'y sin token');
    check(cuantos() === antes, 'NO se creó ninguna fila', `había ${antes}, hay ${cuantos()}`);
    const rastro = db.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'nadie@gmail.com' OR username = 'nadie@gmail.com'").get().n;
    check(rastro === 0, 'ni rastro de nadie@gmail.com en la tabla');
  }

  // ---- [4] Correo sin verificar ----

  console.log('\n[4] email_verified false');
  {
    const r = await login(conGoogle, 'fake:ana@gmail.com:unverified', '10.0.0.5');
    check(r.status === 401, '→ 401 aunque el correo tenga cuenta', `${r.status} ${JSON.stringify(r.data)}`);
    check(!('token' in (r.data ?? {})), 'y sin token');
  }

  // ---- [5] Lo que no es un token ----

  console.log('\n[5] peticiones que no traen un token que sirva');
  {
    const sin = await login(conGoogle, undefined, '10.0.0.6');
    check(sin.status === 400, 'sin idToken → 400', `${sin.status} ${JSON.stringify(sin.data)}`);
    const malo = await login(conGoogle, 'esto-no-es-un-token', '10.0.0.6');
    check(malo.status === 401, 'un token que el verificador rechaza → 401', `${malo.status} ${JSON.stringify(malo.data)}`);
  }

  // ---- [6] Conflicto de identidad ----

  console.log('\n[6] el correo coincide con el NOMBRE de otra cuenta');
  {
    const antes = cuantos();
    const r = await login(conGoogle, 'fake:pedro@gmail.com', '10.0.0.7');
    check(r.status === 409, '→ 409, igual que /cf', `${r.status} ${JSON.stringify(r.data)}`);
    check(fila(pedro).email === 'otra@gmail.com', 'la cuenta de pedro queda intacta');
    check(cuantos() === antes, 'y no se creó nada');
  }

  // ---- [7] Sin cliente configurado ----

  console.log('\n[7] servidor sin GOOGLE_IOS_CLIENT_ID');
  {
    const r = await login(sinGoogle, 'fake:ana@gmail.com', '10.0.0.8');
    check(r.status === 503, '→ 503', `${r.status} ${JSON.stringify(r.data)}`);
    check(r.data?.error === 'Google no está configurado', 'con el mensaje acordado', JSON.stringify(r.data));
    check(/GOOGLE_IOS_CLIENT_ID sin definir/.test(sinGoogle.salida()), 'y lo avisó al arrancar');
  }

  // ---- [8] Límite de intentos ----

  console.log('\n[8] 11 intentos desde la misma IP');
  {
    const estados = [];
    let ultimo = null;
    for (let i = 0; i < 11; i++) {
      ultimo = await login(conGoogle, 'fake:nadie@gmail.com', '10.0.0.99');
      estados.push(ultimo.status);
    }
    check(estados.slice(0, 10).every((s) => s === 403), 'los 10 primeros pasan (403: la cuenta no existe)', estados.join(','));
    check(estados[10] === 429, 'el 11º → 429', estados.join(','));
    check(Number(ultimo.retryAfter) > 0, 'con Retry-After', String(ultimo.retryAfter));
    const otra = await login(conGoogle, 'fake:nadie@gmail.com', '10.0.0.100');
    check(otra.status === 403, 'otra IP no queda afectada', String(otra.status));
  }

  // ---- [9] El verificador de verdad ----

  console.log('\n[9] servidor con el verificador REAL de Google');
  {
    // Sin un token real no se puede probar que acepte; sí que google-auth-library está
    // cableado y que un token falso no pasa. `fake:` en este servidor no significa nada.
    const r = await login(real, 'fake:ana@gmail.com', '10.0.0.9');
    check(r.status === 401, 'un token falso → 401', `${r.status} ${JSON.stringify(r.data)}`);
  }

  // ---- [10] El falso en producción ----

  console.log('\n[10] GOOGLE_FAKE=1 con NODE_ENV=production');
  {
    const prod = levantar('producción con el falso', { PORT: '3994', NODE_ENV: 'production', GOOGLE_IOS_CLIENT_ID: CLIENTE, GOOGLE_FAKE: '1' });
    const code = await Promise.race([prod.fin, new Promise((r) => setTimeout(() => r('sigue vivo'), 10000))]);
    check(code !== 'sigue vivo' && code !== 0, 'el servidor NO arranca', `salida: ${code}`);
    check(/GOOGLE_FAKE=1 con NODE_ENV=production/.test(prod.salida()), 'y dice por qué');
  }
} catch (e) {
  fail++;
  console.error('[SMOKE-GOOGLE] se cortó:', e);
} finally {
  apagar();
  await Promise.all(hijos.map((h) => (h.exitCode === null ? new Promise((r) => h.on('exit', r)) : null)));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n[SMOKE-GOOGLE] ${pass} ok, ${fail} fallas\n`);
process.exit(fail ? 1 : 0);
