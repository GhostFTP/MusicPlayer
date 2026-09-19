// Smoke test de /api/admin/users contra un servidor VIVO.
//
// El repo no tiene infraestructura de tests, y montar una (runner, config, CI) por
// cuatro endpoints sería más andamio que obra. Esto es lo mínimo que responde la
// pregunta que importa: ¿el gateo por rol funciona de verdad sobre HTTP, y la
// cascada borra lo que promete?
//
// CÓMO SE CORRE
//   1. Levanta el servidor, con el verificador FALSO de Google (desde 1.19.0: el caso del
//      alta con correo y sin contraseña entra por Google, y sin esto FALLA a propósito):
//        GOOGLE_FAKE=1 GOOGLE_IOS_CLIENT_ID=smoke.apps.googleusercontent.com PORT=3999 npm start
//      GOOGLE_FAKE solo arranca fuera de producción (auth/google.js).
//   2. En otra terminal:     SMOKE_URL=http://localhost:3999 npm run smoke:admin
//
// El paso 9 corre el CLI (`src/admin/users.js set-email`) como proceso aparte, con el
// mismo entorno, así que escribe en la misma base que el servidor.
//
// TOCA LA BASE DE DESARROLLO. Crea usuarios con prefijo `smoke-` y los borra al
// empezar y al terminar; no toca ninguna otra fila salvo el rol de ADMIN_USERNAME,
// que es lo que hace falta para poder probar nada.
//
// POR QUÉ FIRMA SUS PROPIOS TOKENS en vez de hacer login: el usuario admin de la
// base de desarrollo tiene una contraseña que este script no conoce ni debe conocer.
// Firmar con el mismo JWT_SECRET del servidor prueba exactamente el mismo camino
// —authMiddleware verifica la firma— sin meter una contraseña en un archivo.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '../src/db/database.js';
import { signToken } from '../src/auth/jwt.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

const BASE = process.env.SMOKE_URL ?? 'http://localhost:3000';
const ADMIN_USERNAME = process.env.SMOKE_ADMIN ?? 'admin@adr.com';

let pass = 0;
let fail = 0;

function check(ok, label, detalle = '') {
  if (ok) {
    pass++;
    console.log(`  ok    ${label}`);
  } else {
    fail++;
    console.log(`  FALLA ${label}${detalle ? `  → ${detalle}` : ''}`);
  }
}

async function req(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

// ---- Preparación ----

function limpiarSmoke() {
  for (const u of db.prepare("SELECT id FROM users WHERE username LIKE 'smoke-%'").all()) {
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  }
}

console.log(`[SMOKE] ${BASE}`);

const salud = await req('GET', '/api/health').catch(() => null);
if (!salud || salud.status !== 200) {
  console.error(`[SMOKE] No hay servidor en ${BASE}. Levantalo con: PORT=3999 npm start`);
  process.exit(1);
}

limpiarSmoke();

const admin = db.prepare('SELECT id, username FROM users WHERE username = ?').get(ADMIN_USERNAME);
if (!admin) {
  console.error(`[SMOKE] No existe "${ADMIN_USERNAME}" en la base de desarrollo.`);
  process.exit(1);
}

// ADMIN_USERNAME queda como el ÚNICO admin: la prueba del "último admin" necesita
// que lo sea, y si quedara otro de una corrida anterior ese caso pasaría en falso.
db.prepare("UPDATE users SET role = 'user'").run();
db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(admin.id);

// El usuario normal existe solo para probar los 403. Nace por SQL y no por la API
// porque la API es justo lo que todavía no sabemos si funciona.
db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('smoke-normal', 'x', 'user')").run();
const normal = db.prepare("SELECT id, username FROM users WHERE username = 'smoke-normal'").get();

const tokAdmin = signToken({ id: admin.id, username: admin.username });
const tokNormal = signToken({ id: normal.id, username: normal.username });

// ---- 1. Un usuario normal no pasa de la puerta, en los CUATRO ----

console.log('\n[1] usuario normal → 403 en los cuatro endpoints');
for (const [method, path, body] of [
  ['GET', '/api/admin/users', null],
  ['POST', '/api/admin/users', { username: 'smoke-colado', password: 'contrasena123' }],
  ['PATCH', `/api/admin/users/${admin.id}`, { role: 'user' }],
  ['DELETE', `/api/admin/users/${admin.id}`, { confirm: admin.username }],
]) {
  const r = await req(method, path, { token: tokNormal, body });
  check(r.status === 403 && r.data?.error === 'admin required', `${method} ${path}`, `dio ${r.status} ${JSON.stringify(r.data)}`);
}

const sinToken = await req('GET', '/api/admin/users');
check(sinToken.status === 401, 'GET sin token → 401', `dio ${sinToken.status}`);

// ---- 2. El admin lista, sin hash y con los dos conteos ----

console.log('\n[2] admin → lista sin hash y con conteos');
const lista = await req('GET', '/api/admin/users', { token: tokAdmin });
check(lista.status === 200 && Array.isArray(lista.data), 'GET → 200 y array', `dio ${lista.status}`);
check(
  !JSON.stringify(lista.data).includes('password_hash') && !JSON.stringify(lista.data).includes('$2b$'),
  'ningún password_hash en la respuesta',
);
const fila = lista.data.find(u => u.id === admin.id);
check(
  typeof fila?.playlists === 'number' && typeof fila?.plays === 'number',
  'cada fila trae playlists y plays numéricos',
  JSON.stringify(fila),
);
check(fila?.role === 'admin', 'el admin figura con role=admin');

// ---- 3. Crear ----

console.log('\n[3] admin → crea');
const creado = await req('POST', '/api/admin/users', {
  token: tokAdmin,
  body: { username: 'smoke-victima', password: 'contrasena123' },
});
check(creado.status === 201 && creado.data?.username === 'smoke-victima', 'POST → 201', `dio ${creado.status} ${JSON.stringify(creado.data)}`);
check(creado.data?.role === 'user', 'sin role explícito nace como user');
check(!('password_hash' in (creado.data ?? {})), 'la fila devuelta no trae hash');
const victima = creado.data;

const dup = await req('POST', '/api/admin/users', {
  token: tokAdmin,
  body: { username: 'smoke-victima', password: 'contrasena123' },
});
check(dup.status === 409, 'usuario repetido → 409', `dio ${dup.status}`);

for (const [label, body, esperado] of [
  ['usuario de 2 caracteres → 400', { username: 'ab', password: 'contrasena123' }, 400],
  ['contraseña corta → 400', { username: 'smoke-corta', password: 'abc' }, 400],
  ['rol inventado → 400', { username: 'smoke-rol', password: 'contrasena123', role: 'superadmin' }, 400],
]) {
  const r = await req('POST', '/api/admin/users', { token: tokAdmin, body });
  check(r.status === esperado, label, `dio ${r.status} ${JSON.stringify(r.data)}`);
}

// ---- 4. Cambiar rol ----

console.log('\n[4] admin → cambia rol');
const sube = await req('PATCH', `/api/admin/users/${victima.id}`, { token: tokAdmin, body: { role: 'admin' } });
check(sube.status === 200 && sube.data?.role === 'admin', 'PATCH role=admin → 200', `dio ${sube.status}`);
const baja = await req('PATCH', `/api/admin/users/${victima.id}`, { token: tokAdmin, body: { role: 'user' } });
check(baja.status === 200 && baja.data?.role === 'user', 'PATCH role=user → 200', `dio ${baja.status}`);

// ---- 5. Los dos bloqueos ----

console.log('\n[5] los bloqueos');
const ultimo = await req('PATCH', `/api/admin/users/${admin.id}`, { token: tokAdmin, body: { role: 'user' } });
check(ultimo.status === 400, 'bajar al ÚLTIMO admin → 400', `dio ${ultimo.status} ${JSON.stringify(ultimo.data)}`);
check(
  db.prepare('SELECT role FROM users WHERE id = ?').get(admin.id).role === 'admin',
  'y el rol quedó intacto en la base',
);

const propio = await req('DELETE', `/api/admin/users/${admin.id}`, { token: tokAdmin, body: { confirm: admin.username } });
check(propio.status === 400, 'borrarse a UNO MISMO → 400', `dio ${propio.status} ${JSON.stringify(propio.data)}`);

const borrarUltimo = await req('DELETE', `/api/admin/users/${victima.id}`, { token: tokAdmin, body: { confirm: 'otra-cosa' } });
check(borrarUltimo.status === 400, 'DELETE con confirm equivocado → 400', `dio ${borrarUltimo.status}`);

const sinConfirm = await req('DELETE', `/api/admin/users/${victima.id}`, { token: tokAdmin });
check(sinConfirm.status === 400, 'DELETE SIN confirm → 400', `dio ${sinConfirm.status} ${JSON.stringify(sinConfirm.data)}`);
check(!!db.prepare('SELECT id FROM users WHERE id = ?').get(victima.id), 'y la víctima sigue viva');

// ---- 6. La cascada ----

console.log('\n[6] DELETE con confirm → 204 y cascada');
db.prepare("INSERT INTO playlists (name, user_id) VALUES ('smoke-lista', ?)").run(victima.id);
db.prepare("INSERT INTO playlists (name, user_id) VALUES ('smoke-otra', ?)").run(victima.id);
const antes = db.prepare('SELECT COUNT(*) AS n FROM playlists WHERE user_id = ?').get(victima.id).n;
check(antes === 2, `la víctima tiene ${antes} playlists antes de borrarla`);

// Su sesión, para probar que borrar la corta AL MOMENTO (1.19.0, auth/jwt.js).
const tokVictima = signToken({ id: victima.id, username: victima.username });
const vivaAntes = await req('GET', '/api/tracks?limit=1', { token: tokVictima });
check(vivaAntes.status === 200, 'antes de borrarla, su token entra al catálogo', `dio ${vivaAntes.status}`);

const borrado = await req('DELETE', `/api/admin/users/${victima.id}`, { token: tokAdmin, body: { confirm: 'smoke-victima' } });
check(borrado.status === 204, 'DELETE con confirm → 204', `dio ${borrado.status} ${JSON.stringify(borrado.data)}`);
check(!db.prepare('SELECT id FROM users WHERE id = ?').get(victima.id), 'el usuario ya no está');
check(
  db.prepare('SELECT COUNT(*) AS n FROM playlists WHERE user_id = ?').get(victima.id).n === 0,
  'y sus playlists se fueron con él (cascada)',
);
const vivaDespues = await req('GET', '/api/tracks?limit=1', { token: tokVictima });
check(vivaDespues.status === 401, 'y su token ya no entra: 401 al momento, sin esperar a que venza', `dio ${vivaDespues.status}`);
const streamDespues = await req('GET', `/stream/1?token=${tokVictima}`);
check(streamDespues.status === 401, 'tampoco a /stream, que tiene su propio portero', `dio ${streamDespues.status}`);

const fantasma = await req('DELETE', `/api/admin/users/${victima.id}`, { token: tokAdmin, body: { confirm: 'smoke-victima' } });
check(fantasma.status === 404, 'volver a borrarlo → 404', `dio ${fantasma.status}`);

// ---- 7. El correo (1.19.0) ----

console.log('\n[7] admin → pone, cambia y quita el correo');
db.prepare("INSERT INTO users (username, password_hash) VALUES ('smoke-correo-a', 'x')").run();
db.prepare("INSERT INTO users (username, password_hash) VALUES ('smoke-correo-b', 'x')").run();
// Una cuenta "legado": su NOMBRE es un correo y todavía no tiene email. Es lo que el
// correo de otra cuenta no puede pisar.
db.prepare("INSERT INTO users (username, password_hash) VALUES ('smoke-legado@correo.test', 'x')").run();
const correoA = db.prepare("SELECT id FROM users WHERE username = 'smoke-correo-a'").get();
const correoB = db.prepare("SELECT id FROM users WHERE username = 'smoke-correo-b'").get();
const ponerCorreo = (id, email) => req('PATCH', `/api/admin/users/${id}`, { token: tokAdmin, body: { email } });

let rc = await ponerCorreo(correoA.id, '  Smoke-A@Correo.TEST ');
check(rc.status === 200 && rc.data?.email === 'smoke-a@correo.test', 'pone el correo, en minúsculas y sin espacios', `dio ${rc.status} ${JSON.stringify(rc.data)}`);
rc = await ponerCorreo(correoA.id, 'SMOKE-A@correo.test');
check(rc.status === 200 && rc.data?.email === 'smoke-a@correo.test', 'el mismo correo en otras mayúsculas → 200 y sin cambios', `dio ${rc.status} ${JSON.stringify(rc.data)}`);

for (const [label, email] of [
  ['sin @ → 400', 'smoke-acorreo.test'],
  ['sin punto en el dominio → 400', 'smoke-a@correo'],
  ['con un espacio → 400', 'smoke a@correo.test'],
  ['vacío → 400', '   '],
  [`más de 254 caracteres → 400`, `${'a'.repeat(250)}@correo.test`],
]) {
  const r = await ponerCorreo(correoB.id, email);
  check(r.status === 400, label, `dio ${r.status} ${JSON.stringify(r.data)}`);
}

rc = await ponerCorreo(correoB.id, 'Smoke-A@correo.test');
check(
  rc.status === 409 && rc.data?.error === 'Ese correo ya es de «smoke-correo-a».',
  'el correo de OTRA cuenta → 409 con su nombre',
  `dio ${rc.status} ${JSON.stringify(rc.data)}`,
);
rc = await ponerCorreo(correoB.id, 'SMOKE-LEGADO@correo.test');
check(
  rc.status === 409 && /nombre de usuario de «smoke-legado@correo\.test»/.test(rc.data?.error ?? ''),
  'el NOMBRE de otra cuenta → 409',
  `dio ${rc.status} ${JSON.stringify(rc.data)}`,
);
check(db.prepare('SELECT email FROM users WHERE id = ?').get(correoB.id).email === null, 'y los rechazados no escribieron nada');

// Con correo y contraseña puestos por el admin, /login entra por el correo, en
// cualquier mayúscula: es lo que hace que guardarlo en minúsculas no sea cosmético.
rc = await req('PATCH', `/api/admin/users/${correoB.id}`, {
  token: tokAdmin, body: { email: 'Smoke-B@Correo.test', password: 'contrasena123' },
});
check(rc.status === 200 && rc.data?.email === 'smoke-b@correo.test', 'correo y contraseña en el mismo PATCH → 200', `dio ${rc.status} ${JSON.stringify(rc.data)}`);
const porCorreo = await req('POST', '/api/auth/login', { body: { username: 'SMOKE-B@correo.test', password: 'contrasena123' } });
check(porCorreo.status === 200 && typeof porCorreo.data?.token === 'string', '/login con el correo nuevo → 200', `dio ${porCorreo.status}`);

rc = await ponerCorreo(correoA.id, null);
check(rc.status === 200 && rc.data?.email === null, 'null → desliga', `dio ${rc.status} ${JSON.stringify(rc.data)}`);
rc = await ponerCorreo(correoA.id, null);
check(rc.status === 200 && rc.data?.email === null, 'null sobre una cuenta sin correo → 200 (no-op)', `dio ${rc.status} ${JSON.stringify(rc.data)}`);

// ---- 8. Alta con correo y sin contraseña (1.19.0) ----

console.log('\n[8] admin → alta con correo y sin contraseña; entra solo con Google');
const soloGoogle = await req('POST', '/api/admin/users', {
  token: tokAdmin, body: { username: 'smoke-solo-google', email: 'Smoke-Google@correo.test' },
});
check(
  soloGoogle.status === 201 && soloGoogle.data?.email === 'smoke-google@correo.test',
  'POST con correo y sin password → 201',
  `dio ${soloGoogle.status} ${JSON.stringify(soloGoogle.data)}`,
);
const sinClave = await req('POST', '/api/auth/login', { body: { username: 'smoke-solo-google', password: 'contrasena123' } });
check(sinClave.status === 401, 'y no entra por /login con ninguna contraseña', `dio ${sinClave.status}`);
const porGoogle = await req('POST', '/api/auth/google', { body: { idToken: 'fake:smoke-google@correo.test' } });
check(
  porGoogle.status === 200 && porGoogle.data?.me?.username === 'smoke-solo-google',
  'pero SÍ entra con Google (verificador falso) y a ESA cuenta',
  porGoogle.status === 503
    ? 'el servidor no tiene Google: levántalo con GOOGLE_FAKE=1 y GOOGLE_IOS_CLIENT_ID (ver arriba)'
    : `dio ${porGoogle.status} ${JSON.stringify(porGoogle.data)}`,
);
const sinNada = await req('POST', '/api/admin/users', { token: tokAdmin, body: { username: 'smoke-sin-nada' } });
check(sinNada.status === 400 && /Falta la contraseña/.test(sinNada.data?.error ?? ''), 'sin correo ni contraseña → 400', `dio ${sinNada.status} ${JSON.stringify(sinNada.data)}`);

// ---- 9. El CLI: set-email (1.19.0) ----

console.log('\n[9] CLI → set-email');
function cli(...args) {
  const r = spawnSync(process.execPath, [join(RAIZ, 'src/admin/users.js'), ...args], { env: process.env, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const correoDe = (id) => db.prepare('SELECT email FROM users WHERE id = ?').get(id).email;

let rcli = cli('set-email', 'smoke-correo-a', 'Smoke-CLI@correo.test');
check(rcli.code === 0 && correoDe(correoA.id) === 'smoke-cli@correo.test', 'set-email pone el correo, en minúsculas', rcli.out.trim());
rcli = cli('set-email', 'smoke-correo-a', 'smoke-cli@correo.test');
check(rcli.code === 0 && /No se cambió nada/.test(rcli.out), 'el mismo correo → no-op', rcli.out.trim());
rcli = cli('set-email', 'smoke-correo-b', 'smoke-cli@correo.test');
check(rcli.code === 1 && /ya es de «smoke-correo-a»/.test(rcli.out), 'el de otra cuenta → sale con 1 y lo dice', rcli.out.trim());
rcli = cli('set-email', 'smoke-correo-a', 'no-es-un-correo');
check(rcli.code === 1 && /no parece un correo/.test(rcli.out), 'uno sin forma de correo → sale con 1', rcli.out.trim());
rcli = cli('set-email', 'smoke-correo-a', '-');
check(rcli.code === 0 && correoDe(correoA.id) === null, '`-` desliga', rcli.out.trim());

// ---- Limpieza ----

limpiarSmoke();

console.log(`\n[SMOKE] ${pass} ok, ${fail} fallas`);
process.exit(fail ? 1 : 0);
