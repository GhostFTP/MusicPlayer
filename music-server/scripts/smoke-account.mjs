// Smoke test de PATCH /api/me contra un servidor VIVO. El hermano de
// smoke-admin.mjs: aquel prueba lo que un admin le hace a OTROS, este lo que cada
// quien puede hacer con SU PROPIA cuenta.
//
// CÓMO SE CORRE
//   1. Levantá el servidor:  PORT=3999 npm start
//   2. En otra terminal:     SMOKE_URL=http://localhost:3999 npm run smoke:account
//
// TOCA LA BASE DE DESARROLLO, igual que su hermano: crea usuarios con prefijo `acct-`
// y los borra al empezar y al terminar. No toca ninguna otra fila.
//
// A DIFERENCIA DE smoke-admin, ACÁ SE HACE LOGIN DE VERDAD. Aquel firma sus propios
// tokens porque no conoce la contraseña del admin de desarrollo; acá la contraseña ES
// lo que se está probando, así que las cuentas las crea este script con una que sí
// conoce, y después entra por POST /api/auth/login como entraría cualquiera.
import { existsSync, unlinkSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import bcrypt from 'bcrypt';
import sharp from 'sharp';
import db from '../src/db/database.js';
import { signToken } from '../src/auth/jwt.js';
import { avatarPath } from '../src/users/avatars.js';

const BASE = process.env.SMOKE_URL ?? 'http://localhost:3000';
const ADMIN_USERNAME = process.env.SMOKE_ADMIN ?? 'admin@adr.com';

const CLAVE_VIEJA = 'clave-vieja-123';
const CLAVE_NUEVA = 'clave-nueva-456';

let pass = 0;
let fail = 0;

function check(ok, label, detalle = '') {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FALLA ${label}${detalle ? `  → ${detalle}` : ''}`); }
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

// Subir un cuerpo CRUDO (la imagen). El helper de arriba manda JSON siempre, y lo que
// se prueba acá es justamente que el servidor acepte bytes con un Content-Type de
// imagen y rechace cualquier otro.
async function reqRaw(method, path, { token, contentType, body }) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
    body,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

// Una peticion condicional con EXACTAMENTE los headers que se le pasan, por node:http
// y no por fetch.
//
// ⚠️ HACE FALTA, Y ES UN HALLAZGO: el `fetch` de node (undici) agrega
// `Cache-Control: no-cache` y `Pragma: no-cache` POR SU CUENTA. El modulo `fresh` que
// usa Express respeta ese no-cache y devuelve false aunque el ETag coincida — o sea
// que el servidor contesta 200, y hace bien: le estan pidiendo una copia fresca. Con
// fetch, esta prueba nunca veria el 304 y pareceria que el servidor esta roto.
function condicional(url, { token, ifNoneMatch }) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const r = httpRequest({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET',
      headers: { Authorization: `Bearer ${token}`, 'If-None-Match': ifNoneMatch },
    }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    r.on('error', reject);
    r.end();
  });
}

// Bajar la foto y quedarse con los bytes, para pasarselos a sharp y ver que salio.
async function reqImagen(path, token) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return {
    status: res.status,
    tipo: res.headers.get('content-type'),
    cache: res.headers.get('cache-control'),
    etag: res.headers.get('etag'),
    bytes: Buffer.from(await res.arrayBuffer()),
  };
}

// El username va DENTRO del JWT, así que para leerlo alcanza con decodificar el
// payload. No se verifica la firma: el servidor ya lo hizo al emitirlo, y lo que se
// está comprobando acá es qué dice, no si es válido.
const usernameDelToken = (tok) =>
  JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString('utf8')).username;

function limpiar() {
  for (const u of db.prepare("SELECT id FROM users WHERE username LIKE 'acct-%'").all()) {
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  }
}

// ---- Preparación ----

console.log(`[SMOKE-ACCOUNT] ${BASE}`);

const salud = await req('GET', '/api/health').catch(() => null);
if (!salud || salud.status !== 200) {
  console.error(`[SMOKE-ACCOUNT] No hay servidor en ${BASE}. Levantalo con: PORT=3999 npm start`);
  process.exit(1);
}

const admin = db.prepare('SELECT id, username FROM users WHERE username = ?').get(ADMIN_USERNAME);
if (!admin) {
  console.error(`[SMOKE-ACCOUNT] No existe "${ADMIN_USERNAME}" en la base de desarrollo.`);
  process.exit(1);
}
db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(admin.id);

limpiar();

const hash = await bcrypt.hash(CLAVE_VIEJA, 12);
db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
  .run('acct-ana', hash, 'user');
db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
  .run('acct-ocupado', hash, 'user');

const ana = db.prepare("SELECT id FROM users WHERE username = 'acct-ana'").get();
const tokAdmin = signToken({ id: admin.id, username: admin.username });

// ---- [1] Entrar con la contraseña de partida ----

console.log('\n[1] login de partida');
{
  const r = await req('POST', '/api/auth/login', { body: { username: 'acct-ana', password: CLAVE_VIEJA } });
  check(r.status === 200 && !!r.data?.token, 'entra con su usuario y contraseña', JSON.stringify(r.data));
  var tokAna = r.data?.token;
}

// ---- [2] Renombrarse ----

console.log('\n[2] cambiar el propio nombre');
{
  const r = await req('PATCH', '/api/me', { token: tokAna, body: { username: 'acct-anita' } });
  check(r.status === 200, 'PATCH /api/me → 200', `${r.status} ${JSON.stringify(r.data)}`);
  check(r.data?.me?.username === 'acct-anita', 'la respuesta trae el nombre nuevo', JSON.stringify(r.data?.me));
  check(!!r.data?.token, 'y un token');
  check(r.data?.token && usernameDelToken(r.data.token) === 'acct-anita',
    'EL TOKEN NUEVO TRAE EL USERNAME NUEVO',
    r.data?.token ? usernameDelToken(r.data.token) : 'sin token');
  check(r.data?.me?.email === null, 'el email NO se tocó (sigue en null)', String(r.data?.me?.email));

  const enBase = db.prepare('SELECT username FROM users WHERE id = ?').get(ana.id);
  check(enBase.username === 'acct-anita', 'y quedó escrito en la base', enBase.username);

  if (r.data?.token) tokAna = r.data.token;
}

console.log('\n[2b] el token VIEJO sigue sirviendo');
{
  // No es un detalle: renombrarse no puede dejar afuera a la propia sesión que lo
  // hizo. Todas las decisiones del servidor salen de req.user.id, no del username.
  const viejo = signToken({ id: ana.id, username: 'acct-ana' });
  const r = await req('GET', '/api/me', { token: viejo });
  check(r.status === 200 && r.data?.username === 'acct-anita',
    'un token con el nombre VIEJO sigue autenticando, y /api/me dice el nuevo',
    `${r.status} ${JSON.stringify(r.data)}`);
}

// ---- [3] Renombrarse a un nombre ocupado ----

console.log('\n[3] nombre ocupado');
{
  const r = await req('PATCH', '/api/me', { token: tokAna, body: { username: 'acct-ocupado' } });
  check(r.status === 409, 'renombrarse a un nombre que ya existe → 409', String(r.status));
  check(typeof r.data?.error === 'string' && r.data.error.includes('acct-ocupado'),
    'y el error dice cuál', JSON.stringify(r.data));

  const enBase = db.prepare('SELECT username FROM users WHERE id = ?').get(ana.id);
  check(enBase.username === 'acct-anita', 'no se cambió nada', enBase.username);
}

console.log('\n[3b] renombrarse al nombre que uno YA tiene no es un conflicto');
{
  const r = await req('PATCH', '/api/me', { token: tokAna, body: { username: 'acct-anita' } });
  check(r.status === 200, 'el mismo nombre → 200 y no 409', String(r.status));
}

console.log('\n[3c] las reglas del servicio valen igual acá');
{
  const corto = await req('PATCH', '/api/me', { token: tokAna, body: { username: 'ab' } });
  check(corto.status === 400, 'usuario de 2 caracteres → 400', String(corto.status));
  const espacios = await req('PATCH', '/api/me', { token: tokAna, body: { username: 'con espacio' } });
  check(espacios.status === 400, 'usuario con espacios → 400', String(espacios.status));
  const vacio = await req('PATCH', '/api/me', { token: tokAna, body: {} });
  check(vacio.status === 400, 'sin nada que cambiar → 400', String(vacio.status));
  const ambos = await req('PATCH', '/api/me', {
    token: tokAna, body: { username: 'acct-x', newPassword: CLAVE_NUEVA, currentPassword: CLAVE_VIEJA },
  });
  check(ambos.status === 400, 'nombre y contraseña juntos → 400', String(ambos.status));
}

// ---- [4] Contraseña ----

console.log('\n[4] cambiar la contraseña');
{
  const mal = await req('PATCH', '/api/me', {
    token: tokAna, body: { currentPassword: 'no-es-esta', newPassword: CLAVE_NUEVA },
  });
  check(mal.status === 401, 'con la actual INCORRECTA → 401', String(mal.status));
  check(mal.data?.error === 'La contraseña actual no es correcta.',
    'y con el mensaje exacto', JSON.stringify(mal.data));

  const sigue = await req('POST', '/api/auth/login', { body: { username: 'acct-anita', password: CLAVE_VIEJA } });
  check(sigue.status === 200, 'la contraseña vieja sigue funcionando', String(sigue.status));

  const corta = await req('PATCH', '/api/me', {
    token: tokAna, body: { currentPassword: CLAVE_VIEJA, newPassword: 'corta' },
  });
  check(corta.status === 400, 'la nueva de 5 caracteres → 400', String(corta.status));

  const bien = await req('PATCH', '/api/me', {
    token: tokAna, body: { currentPassword: CLAVE_VIEJA, newPassword: CLAVE_NUEVA },
  });
  check(bien.status === 200, 'con la actual CORRECTA → 200', `${bien.status} ${JSON.stringify(bien.data)}`);
  check(!!bien.data?.token, 'y también devuelve token');
}

console.log('\n[4b] la contraseña nueva es la que vale');
{
  const nueva = await req('POST', '/api/auth/login', { body: { username: 'acct-anita', password: CLAVE_NUEVA } });
  check(nueva.status === 200 && !!nueva.data?.token, 'login con la NUEVA → 200', String(nueva.status));

  const vieja = await req('POST', '/api/auth/login', { body: { username: 'acct-anita', password: CLAVE_VIEJA } });
  check(vieja.status === 401, 'login con la vieja → 401', String(vieja.status));
}

// ---- [5] Login por email ----

console.log('\n[5] el login acepta el email además del username');
{
  db.prepare('UPDATE users SET email = ? WHERE id = ?').run('acct-ana@ejemplo.com', ana.id);
  const porEmail = await req('POST', '/api/auth/login', {
    body: { username: 'acct-ana@ejemplo.com', password: CLAVE_NUEVA },
  });
  check(porEmail.status === 200, 'entra poniendo el correo en el campo de usuario', String(porEmail.status));
  check(porEmail.data?.token && usernameDelToken(porEmail.data.token) === 'acct-anita',
    'y el token sale con su username, no con el correo');

  const mayus = await req('POST', '/api/auth/login', {
    body: { username: 'ACCT-ana@Ejemplo.com', password: CLAVE_NUEVA },
  });
  check(mayus.status === 200, 'el correo no distingue mayúsculas', String(mayus.status));

  const sinClave = await req('POST', '/api/auth/login', { body: { username: 'acct-anita' } });
  check(sinClave.status === 401, 'sin contraseña → 401 y no una promesa colgada', String(sinClave.status));
}

// ---- [6] Un admin renombra a otro ----

console.log('\n[6] un admin renombra a otra persona');
{
  const r = await req('PATCH', `/api/admin/users/${ana.id}`, {
    token: tokAdmin, body: { username: 'acct-renombrada' },
  });
  check(r.status === 200, 'PATCH /api/admin/users/:id con username → 200', `${r.status} ${JSON.stringify(r.data)}`);
  check(r.data?.username === 'acct-renombrada', 'devuelve la fila con el nombre nuevo', JSON.stringify(r.data));
  check(r.data?.email === 'acct-ana@ejemplo.com', 'y el email sigue intacto', String(r.data?.email));

  const ocupado = await req('PATCH', `/api/admin/users/${ana.id}`, {
    token: tokAdmin, body: { username: 'acct-ocupado' },
  });
  check(ocupado.status === 409, 'a un nombre ocupado → 409', String(ocupado.status));

  const sigueEntrando = await req('POST', '/api/auth/login', {
    body: { username: 'acct-renombrada', password: CLAVE_NUEVA },
  });
  check(sigueEntrando.status === 200, 'y la persona entra con su nombre nuevo', String(sigueEntrando.status));
}

console.log('\n[6b] un usuario normal NO puede renombrar a otro');
{
  const tokNormal = signToken({ id: ana.id, username: 'acct-renombrada' });
  const otro = db.prepare("SELECT id FROM users WHERE username = 'acct-ocupado'").get();
  const r = await req('PATCH', `/api/admin/users/${otro.id}`, {
    token: tokNormal, body: { username: 'acct-robado' },
  });
  check(r.status === 403, 'PATCH /api/admin/users/:id sin ser admin → 403', String(r.status));
}

// ---- [7] Avatar: emoji ----

console.log('\n[7] avatar con emoji');
{
  for (const [emoji, que] of [['🎵', 'simple'], ['👍🏽', 'con tono de piel'], ['👨‍👩‍👧', 'con ZWJ']]) {
    const r = await req('PATCH', '/api/me', { token: tokAna, body: { emoji } });
    check(r.status === 200, `emoji ${que} (${emoji}) -> 200`, `${r.status} ${JSON.stringify(r.data)}`);
    check(r.data?.me?.avatar?.kind === 'emoji' && r.data.me.avatar.value === emoji,
      '  y viene como { kind: "emoji" }', JSON.stringify(r.data?.me?.avatar));
  }

  const me = await req('GET', '/api/me', { token: tokAna });
  check(me.data?.avatar?.value === '👨‍👩‍👧', 'el ultimo queda puesto en /api/me', JSON.stringify(me.data?.avatar));

  for (const [malo, que] of [['a', 'una letra'], ['12', 'dos digitos'], ['🎵🎶', 'dos emojis juntos']]) {
    const r = await req('PATCH', '/api/me', { token: tokAna, body: { emoji: malo } });
    check(r.status === 400, `${que} ("${malo}") -> 400`, `${r.status} ${JSON.stringify(r.data)}`);
  }

  const sigue = await req('GET', '/api/me', { token: tokAna });
  check(sigue.data?.avatar?.value === '👨‍👩‍👧', 'y ninguno de los tres lo cambio');
}

// ---- [8] Avatar: foto ----

console.log('\n[8] avatar con foto');
{
  // Un PNG de 1200x800 hecho aca mismo: no hace falta un archivo de prueba en el repo,
  // y de paso ese tamano prueba el recorte cuadrado y el encogido de una sola vez.
  const png = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: { r: 200, g: 60, b: 160 } },
  }).png().toBuffer();

  const subida = await reqRaw('PUT', '/api/me/avatar', {
    token: tokAna, contentType: 'image/png', body: png,
  });
  check(subida.status === 200, 'subir un PNG de 1200x800 -> 200', `${subida.status} ${JSON.stringify(subida.data)}`);
  check(subida.data?.avatar?.kind === 'photo', 'responde con { kind: "photo" }', JSON.stringify(subida.data?.avatar));
  check(typeof subida.data?.avatar?.url === 'string' && subida.data.avatar.url.includes('?v='),
    'y la url lleva ?v=', subida.data?.avatar?.url);

  const fila = db.prepare('SELECT avatar_emoji, avatar_updated_at FROM users WHERE id = ?').get(ana.id);
  check(fila.avatar_emoji === null, 'avatar_emoji quedo en null');
  check(fila.avatar_updated_at !== null, 'y avatar_updated_at quedo puesto');
  check(existsSync(avatarPath(ana.id)), 'el archivo esta en el disco');

  const bajada = await reqImagen(subida.data.avatar.url, tokAna);
  check(bajada.status === 200, 'el GET de la url -> 200', String(bajada.status));
  check(bajada.tipo === 'image/jpeg', 'con Content-Type image/jpeg', String(bajada.tipo));
  check(bajada.cache === 'private, max-age=86400', 'y el Cache-Control pedido', String(bajada.cache));
  check(!String(bajada.cache).includes('immutable'), 'NUNCA immutable');

  const meta = await sharp(bajada.bytes).metadata();
  check(meta.format === 'jpeg', 'sharp dice que es un JPEG', String(meta.format));
  check(meta.width === 256 && meta.height === 256, 'de 256x256', `${meta.width}x${meta.height}`);

  const revalida = await condicional(`${BASE}${subida.data.avatar.url}`, {
    token: tokAna, ifNoneMatch: bajada.etag,
  });
  check(revalida.status === 304, 'con If-None-Match devuelve 304', String(revalida.status));

  // La otra cara del hallazgo de `condicional`: pidiendo no-cache, el 304 NO tiene que
  // salir. Se comprueba para que el dia que alguien "arregle" el 304 saltandose esa
  // regla, esto se ponga rojo.
  const forzada = await fetch(`${BASE}${subida.data.avatar.url}`, {
    headers: { Authorization: `Bearer ${tokAna}`, 'If-None-Match': bajada.etag },
  });
  check(forzada.status === 200, 'pero con Cache-Control: no-cache manda el JPEG igual', String(forzada.status));

  const texto = await reqRaw('PUT', '/api/me/avatar', {
    token: tokAna, contentType: 'text/plain', body: 'esto no es una imagen',
  });
  check(texto.status === 415, 'subir text/plain -> 415', `${texto.status} ${JSON.stringify(texto.data)}`);

  const rota = await reqRaw('PUT', '/api/me/avatar', {
    token: tokAna, contentType: 'image/png', body: Buffer.from('no soy un png'),
  });
  check(rota.status === 400, 'bytes que no son una imagen -> 400', `${rota.status} ${JSON.stringify(rota.data)}`);
  check(rota.data?.error === 'No se pudo leer la imagen.', 'con el mensaje pedido', JSON.stringify(rota.data));
}

// ---- [9] Poner emoji borra la foto del disco ----

console.log('\n[9] poner un emoji se lleva la foto');
{
  check(existsSync(avatarPath(ana.id)), 'antes: el archivo esta');
  const r = await req('PATCH', '/api/me', { token: tokAna, body: { emoji: '🐙' } });
  check(r.status === 200, 'PATCH con emoji -> 200', String(r.status));
  check(!existsSync(avatarPath(ana.id)), 'DESPUES: el archivo del disco desaparecio');

  const fila = db.prepare('SELECT avatar_emoji, avatar_updated_at FROM users WHERE id = ?').get(ana.id);
  check(fila.avatar_updated_at === null, 'y avatar_updated_at volvio a null');
  check(fila.avatar_emoji === '🐙', 'con el emoji puesto');
}

// ---- [10] DELETE ----

console.log('\n[10] quitar el avatar');
{
  const r = await reqRaw('DELETE', '/api/me/avatar', { token: tokAna, contentType: 'application/json' });
  check(r.status === 204, 'DELETE /api/me/avatar -> 204', String(r.status));

  const me = await req('GET', '/api/me', { token: tokAna });
  check(me.data?.avatar === null, 'y /api/me devuelve avatar: null', JSON.stringify(me.data?.avatar));

  const otraVez = await reqRaw('DELETE', '/api/me/avatar', { token: tokAna, contentType: 'application/json' });
  check(otraVez.status === 204, 'volver a borrarlo tambien -> 204 (idempotente)', String(otraVez.status));
}

// ---- [11] El avatar de otro ----

console.log('\n[11] el avatar de otro');
{
  const otro = db.prepare("SELECT id FROM users WHERE username = 'acct-ocupado'").get();
  db.prepare("UPDATE users SET avatar_emoji = '🦊' WHERE id = ?").run(otro.id);

  const normal = await reqRaw('DELETE', `/api/admin/users/${otro.id}/avatar`, {
    token: tokAna, contentType: 'application/json',
  });
  check(normal.status === 403, 'un usuario normal NO puede quitarselo a otro -> 403', String(normal.status));

  const sigue = db.prepare('SELECT avatar_emoji FROM users WHERE id = ?').get(otro.id);
  check(sigue.avatar_emoji === '🦊', 'y sigue puesto');

  const comoAdmin = await reqRaw('DELETE', `/api/admin/users/${otro.id}/avatar`, {
    token: tokAdmin, contentType: 'application/json',
  });
  check(comoAdmin.status === 204, 'un admin si -> 204', String(comoAdmin.status));

  const despues = db.prepare('SELECT avatar_emoji FROM users WHERE id = ?').get(otro.id);
  check(despues.avatar_emoji === null, 'y se lo quito');

  const porPatch = await req('PATCH', `/api/admin/users/${otro.id}`, {
    token: tokAdmin, body: { emoji: '🐢' },
  });
  check(porPatch.status === 200 && porPatch.data?.avatar?.value === '🐢',
    'y el PATCH de admin tambien le puede poner uno', JSON.stringify(porPatch.data?.avatar));
}

// ---- Limpieza ----

// Los avatares de las cuentas de prueba se van con ellas: limpiar() borra las filas, y
// aca se borran los archivos, que si no quedarian sin nadie que los recoja.
for (const u of db.prepare("SELECT id FROM users WHERE username LIKE 'acct-%'").all()) {
  try { unlinkSync(avatarPath(u.id)); } catch { /* no tenia */ }
}
limpiar();
console.log(`\n[SMOKE-ACCOUNT] ${pass} ok, ${fail} fallas\n`);
process.exit(fail ? 1 : 0);
