// Smoke test de la sesión de 90 días y de POST /api/auth/renovar (S0 + S1).
//
// CÓMO SE CORRE
//   node scripts/smoke-renovar.mjs        (desde music-server/)
// Levanta SU PROPIO servidor (puerto 3995) sobre una BASE TEMPORAL, como smoke-google.mjs:
// MUSIC_DB_PATH y JWT_SECRET se ponen ANTES de importar nada del servidor, porque
// db/database.js abre el archivo y auth/jwt.js lee el secreto al evaluarse. El hijo recibe
// los mismos dos valores, así que este proceso y él ven las mismas filas y firman igual.
//
// Google va con el verificador FALSO (GOOGLE_FAKE=1, auth/google.js): `fake:<correo>`.
//
// LA DURACIÓN SE MIDE COMO `exp - iat` EN SEGUNDOS y se compara con 90 días exactos, no
// "más de 7": así un cambio a cualquier otra duración también sale en rojo.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'sonorarev-renovar-'));
process.env.MUSIC_DB_PATH = join(dir, 'test.db');
const SECRETO = 'smoke-renovar';
process.env.JWT_SECRET = SECRETO;

const { default: db } = await import('../src/db/database.js');

const PUERTO = '3995';
const BASE = `http://localhost:${PUERTO}`;
const CLIENTE = 'smoke-cliente-ios.apps.googleusercontent.com';
const NOVENTA_DIAS = 90 * 24 * 60 * 60;
const SIETE_DIAS = 7 * 24 * 60 * 60;

let pass = 0;
let fail = 0;

function check(ok, label, detalle = '') {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FALLA ${label}${detalle ? `  → ${detalle}` : ''}`); }
}

// ---- El servidor ----

// El entorno se arma A MANO: si quien corre esto tiene CF_ACCESS_* o PORT en su shell, el
// servidor no sería el que la prueba cree.
const env = { ...process.env };
for (const k of ['GOOGLE_IOS_CLIENT_ID', 'GOOGLE_FAKE', 'CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD', 'PORT']) delete env[k];
const hijo = spawn(process.execPath, ['server.js'], {
  cwd: RAIZ,
  env: {
    ...env, NODE_ENV: 'development', JWT_SECRET: SECRETO, MUSIC_DB_PATH: process.env.MUSIC_DB_PATH,
    PORT: PUERTO, GOOGLE_IOS_CLIENT_ID: CLIENTE, GOOGLE_FAKE: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let salida = '';
hijo.stdout.on('data', (d) => { salida += d; });
hijo.stderr.on('data', (d) => { salida += d; });

async function listo() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch { /* todavía no escucha */ }
    if (hijo.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  console.error(`[SMOKE-RENOVAR] El servidor no levantó:\n${salida}`);
  return false;
}

// ---- Peticiones ----

// Cada petición lleva su propia CF-Connecting-IP (la clave del límite, auth/rate-limit.js),
// así el límite de 10 no se come a los casos que no lo prueban. El caso del límite usa una fija.
let ipN = 0;
const ipNueva = () => `10.1.${Math.floor(++ipN / 250)}.${ipN % 250}`;

async function pedir(metodo, ruta, { token, body, ip = ipNueva(), headers = {} } = {}) {
  const res = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': ip,
      ...(token !== undefined ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, retryAfter: res.headers.get('retry-after') };
}

const renovar = (token, opciones = {}) => pedir('POST', '/api/auth/renovar', { token, ...opciones });
const me = (token) => pedir('GET', '/api/me', { token });

// La duración de un token como la firmó el servidor. `null` si no se puede leer.
function duracion(token) {
  try {
    const p = jwt.verify(token, SECRETO);
    return p.exp - p.iat;
  } catch { return null; }
}
const payload = (token) => { try { return jwt.verify(token, SECRETO); } catch { return null; } };

// Tokens fabricados acá, con el mismo secreto, para los casos que el servidor no emite hoy.
const firmar = (p, opciones = {}) => jwt.sign(p, SECRETO, opciones);

// ---- Preparación ----

console.log(`[SMOKE-RENOVAR] base temporal: ${process.env.MUSIC_DB_PATH}`);

const CLAVE = 'una-clave-de-prueba';
const hash = await bcrypt.hash(CLAVE, 4);
const ins = db.prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)');
const ana = Number(ins.run('ana', 'ana@gmail.com', hash).lastInsertRowid);
const beto = Number(ins.run('beto', 'beto@gmail.com', hash).lastInsertRowid);
const carla = Number(ins.run('carla', 'carla@gmail.com', hash).lastInsertRowid);

try {
  if (!(await listo())) throw new Error('el servidor no levantó');

  // ---- [1] Los tokens que se emiten duran 90 días ----

  console.log('\n[1] los tokens que emiten login, Google y PATCH /api/me duran 90 días');
  let tokenAna = null;
  {
    const l = await pedir('POST', '/api/auth/login', { body: { username: 'ana', password: CLAVE } });
    check(l.status === 200 && typeof l.data?.token === 'string', 'POST /api/auth/login → 200 con token', `${l.status} ${JSON.stringify(l.data)}`);
    check(duracion(l.data?.token) === NOVENTA_DIAS, 'el de /login dura 90 días', String(duracion(l.data?.token)));
    tokenAna = l.data?.token;

    const g = await pedir('POST', '/api/auth/google', { body: { idToken: 'fake:beto@gmail.com' } });
    check(g.status === 200 && typeof g.data?.token === 'string', 'POST /api/auth/google → 200 con token', `${g.status} ${JSON.stringify(g.data)}`);
    check(duracion(g.data?.token) === NOVENTA_DIAS, 'el de /google dura 90 días', String(duracion(g.data?.token)));

    const p = await pedir('PATCH', '/api/me', { token: tokenAna, body: { emoji: '🎵' } });
    check(p.status === 200 && typeof p.data?.token === 'string', 'PATCH /api/me → 200 con token', `${p.status} ${JSON.stringify(p.data)}`);
    check(duracion(p.data?.token) === NOVENTA_DIAS, 'el de PATCH /api/me dura 90 días', String(duracion(p.data?.token)));
  }

  // ---- [2] Renovar con un token válido ----

  // El caso real: un token de 90 días emitido hace 31, al que le quedan 59 (la app renueva
  // con menos de 60). Fabricado y no el de /login, porque renovar en el MISMO segundo que se
  // emitió da el mismo iat y por lo tanto el mismo JWT, byte a byte.
  console.log('\n[2] renovar con un token válido (emitido hace 31 días)');
  {
    const hace31 = Math.floor(Date.now() / 1000) - 31 * 24 * 60 * 60;
    const conSesion = firmar({ id: ana, username: 'ana', iat: hace31 }, { expiresIn: '90d' });
    const r = await renovar(conSesion);
    check(r.status === 200, 'POST /api/auth/renovar → 200', `${r.status} ${JSON.stringify(r.data)}`);
    check(typeof r.data?.token === 'string' && r.data.token !== conSesion, 'trae un token NUEVO');
    check(payload(r.data?.token)?.exp > payload(conSesion)?.exp, 'que vence DESPUÉS que el viejo',
      `${payload(r.data?.token)?.exp} vs ${payload(conSesion)?.exp}`);
    check(duracion(r.data?.token) === NOVENTA_DIAS, 'que dura 90 días', String(duracion(r.data?.token)));
    const p = payload(r.data?.token);
    check(p?.id === ana && p?.username === 'ana', 'firmado como el de /login', JSON.stringify(p));
    check(p && Object.keys(p).sort().join(',') === 'exp,iat,id,username', 'y sin nada más adentro', JSON.stringify(p));

    const m = await me(r.data?.token);
    check(m.status === 200 && m.data?.id === ana, 'el token nuevo sirve para GET /api/me', `${m.status} ${JSON.stringify(m.data)}`);
    check(JSON.stringify(r.data?.me) === JSON.stringify(m.data), '`me` es lo mismo que GET /api/me', `${JSON.stringify(r.data?.me)} vs ${JSON.stringify(m.data)}`);
    check(r.data?.me && !('password_hash' in r.data.me), '`me` no trae el hash');

    const viejo = await me(conSesion);
    check(viejo.status === 200, 'el token viejo sigue valiendo hasta su fecha (no es una revocación)', String(viejo.status));
  }

  // ---- [3] Un token de 7 días ya emitido ----

  console.log('\n[3] un token de 7 días emitido antes del cambio');
  {
    const de7 = firmar({ id: carla, username: 'carla' }, { expiresIn: '7d' });
    check(duracion(de7) === SIETE_DIAS, '(el de la prueba dura 7 días)', String(duracion(de7)));
    const m = await me(de7);
    check(m.status === 200 && m.data?.id === carla, 'sigue valiendo para GET /api/me', `${m.status}`);
    const r = await renovar(de7);
    check(r.status === 200 && duracion(r.data?.token) === NOVENTA_DIAS, 'y se renueva a uno de 90 días', `${r.status} ${duracion(r.data?.token)}`);
  }

  // ---- [4] Tokens que no sirven ----

  console.log('\n[4] tokens que no sirven → 401');
  {
    const vencido = firmar({ id: ana, username: 'ana', exp: Math.floor(Date.now() / 1000) - 60 });
    const v = await renovar(vencido);
    check(v.status === 401, 'un token VENCIDO → 401 (renovar no resucita una sesión)', `${v.status} ${JSON.stringify(v.data)}`);
    check(!('token' in (v.data ?? {})), 'y sin token');

    const otroSecreto = jwt.sign({ id: ana, username: 'ana' }, 'otro-secreto', { expiresIn: '90d' });
    const o = await renovar(otroSecreto);
    check(o.status === 401, 'firmado con OTRO secreto → 401', `${o.status} ${JSON.stringify(o.data)}`);

    const basura = await renovar('esto-no-es-un-token');
    check(basura.status === 401, 'algo que no es un JWT → 401', `${basura.status} ${JSON.stringify(basura.data)}`);

    // alg "none": el JWT sin firma. jsonwebtoken lo rechaza cuando hay secreto; se prueba
    // porque es el primer truco contra una ruta que fabrica tokens.
    const cab = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const cuerpo = Buffer.from(JSON.stringify({ id: ana, username: 'ana', iat: 1, exp: 4102444800 })).toString('base64url');
    const sinFirma = await renovar(`${cab}.${cuerpo}.`);
    check(sinFirma.status === 401, 'sin firma (alg none) → 401', `${sinFirma.status} ${JSON.stringify(sinFirma.data)}`);

    const sinId = firmar({ username: 'ana' }, { expiresIn: '1h' });
    const s = await renovar(sinId);
    check(s.status === 401, 'un token bien firmado pero sin `id` → 401 (no 500)', `${s.status} ${JSON.stringify(s.data)}`);
  }

  // ---- [5] Sin token, o por donde no va ----

  console.log('\n[5] sin header Bearer → 401');
  {
    const sin = await renovar(undefined);
    check(sin.status === 401, 'sin header → 401', `${sin.status} ${JSON.stringify(sin.data)}`);

    const vacio = await renovar('');
    check(vacio.status === 401, '`Bearer ` vacío → 401', `${vacio.status} ${JSON.stringify(vacio.data)}`);

    const valido = firmar({ id: ana, username: 'ana' }, { expiresIn: '1h' });
    const query = await pedir('POST', `/api/auth/renovar?token=${encodeURIComponent(valido)}`);
    check(query.status === 401, 'un token VÁLIDO por ?token= → 401 (solo el header)', `${query.status} ${JSON.stringify(query.data)}`);
    check(!('token' in (query.data ?? {})), 'y sin token');

    const otroEsquema = await pedir('POST', '/api/auth/renovar', { headers: { Authorization: `Token ${valido}` } });
    check(otroEsquema.status === 401, '`Authorization: Token …` (sin Bearer) → 401', `${otroEsquema.status}`);
  }

  // ---- [6] Cuenta borrada ----

  console.log('\n[6] la cuenta se borró');
  {
    const ins2 = db.prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)');
    const dani = Number(ins2.run('dani', 'dani@gmail.com', hash).lastInsertRowid);
    const t = firmar({ id: dani, username: 'dani' }, { expiresIn: '90d' });
    const antes = await renovar(t);
    check(antes.status === 200, '(antes de borrarla, renueva)', String(antes.status));
    db.prepare('DELETE FROM users WHERE id = ?').run(dani);
    const r = await renovar(t);
    check(r.status === 401, 'con la cuenta borrada → 401', `${r.status} ${JSON.stringify(r.data)}`);
    check(!('token' in (r.data ?? {})), 'y sin token');
  }

  // ---- [7] Renombrado ----

  console.log('\n[7] la cuenta se renombró después de emitir el token');
  {
    const t = firmar({ id: beto, username: 'beto' }, { expiresIn: '90d' });
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run('roberto', beto);
    const r = await renovar(t);
    check(r.status === 200, '→ 200', `${r.status} ${JSON.stringify(r.data)}`);
    check(payload(r.data?.token)?.username === 'roberto', 'el token nuevo lleva el nombre de HOY', JSON.stringify(payload(r.data?.token)));
    check(r.data?.me?.username === 'roberto' && r.data?.me?.id === beto, 'y `me` también', JSON.stringify(r.data?.me));
  }

  // ---- [8] Límite de intentos ----

  console.log('\n[8] 11 renovaciones desde la misma IP');
  {
    const t = firmar({ id: ana, username: 'ana' }, { expiresIn: '1h' });
    const estados = [];
    let ultimo = null;
    for (let i = 0; i < 11; i++) {
      ultimo = await renovar(t, { ip: '10.9.9.9' });
      estados.push(ultimo.status);
    }
    check(estados.slice(0, 10).every((s) => s === 200), 'las 10 primeras pasan (200)', estados.join(','));
    check(estados[10] === 429, 'la 11ª → 429', estados.join(','));
    check(Number(ultimo.retryAfter) > 0, 'con Retry-After', String(ultimo.retryAfter));
    check(!('token' in (ultimo.data ?? {})), 'y sin token');

    const malo = await renovar('esto-no-es-un-token', { ip: '10.9.9.9' });
    check(malo.status === 429, 'bloqueada, también un token malo recibe 429 (el límite va antes de verificar)', String(malo.status));

    const otra = await renovar(t, { ip: '10.9.9.10' });
    check(otra.status === 200, 'otra IP no queda afectada', String(otra.status));

    const g = await pedir('POST', '/api/auth/google', { body: { idToken: 'fake:ana@gmail.com' }, ip: '10.9.9.9' });
    check(g.status === 200, 'y el límite de /google es otro: la misma IP entra', String(g.status));
  }
} catch (e) {
  fail++;
  console.error('[SMOKE-RENOVAR] se cortó:', e);
} finally {
  if (hijo.exitCode === null) {
    hijo.kill();
    await new Promise((r) => hijo.on('exit', r));
  }
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n[SMOKE-RENOVAR] ${pass} ok, ${fail} fallas\n`);
process.exit(fail ? 1 : 0);
