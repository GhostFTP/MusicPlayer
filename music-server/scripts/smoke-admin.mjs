// Smoke test de /api/admin/users contra un servidor VIVO.
//
// El repo no tiene infraestructura de tests, y montar una (runner, config, CI) por
// cuatro endpoints sería más andamio que obra. Esto es lo mínimo que responde la
// pregunta que importa: ¿el gateo por rol funciona de verdad sobre HTTP, y la
// cascada borra lo que promete?
//
// CÓMO SE CORRE
//   1. Levantá el servidor:  PORT=3999 npm start
//   2. En otra terminal:     SMOKE_URL=http://localhost:3999 npm run smoke:admin
//
// TOCA LA BASE DE DESARROLLO. Crea usuarios con prefijo `smoke-` y los borra al
// empezar y al terminar; no toca ninguna otra fila salvo el rol de ADMIN_USERNAME,
// que es lo que hace falta para poder probar nada.
//
// POR QUÉ FIRMA SUS PROPIOS TOKENS en vez de hacer login: el usuario admin de la
// base de desarrollo tiene una contraseña que este script no conoce ni debe conocer.
// Firmar con el mismo JWT_SECRET del servidor prueba exactamente el mismo camino
// —authMiddleware verifica la firma— sin meter una contraseña en un archivo.
import db from '../src/db/database.js';
import { signToken } from '../src/auth/jwt.js';

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

const borrado = await req('DELETE', `/api/admin/users/${victima.id}`, { token: tokAdmin, body: { confirm: 'smoke-victima' } });
check(borrado.status === 204, 'DELETE con confirm → 204', `dio ${borrado.status} ${JSON.stringify(borrado.data)}`);
check(!db.prepare('SELECT id FROM users WHERE id = ?').get(victima.id), 'el usuario ya no está');
check(
  db.prepare('SELECT COUNT(*) AS n FROM playlists WHERE user_id = ?').get(victima.id).n === 0,
  'y sus playlists se fueron con él (cascada)',
);

const fantasma = await req('DELETE', `/api/admin/users/${victima.id}`, { token: tokAdmin, body: { confirm: 'smoke-victima' } });
check(fantasma.status === 404, 'volver a borrarlo → 404', `dio ${fantasma.status}`);

// ---- Limpieza ----

limpiarSmoke();

console.log(`\n[SMOKE] ${pass} ok, ${fail} fallas`);
process.exit(fail ? 1 : 0);
