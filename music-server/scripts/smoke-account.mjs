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
import bcrypt from 'bcrypt';
import db from '../src/db/database.js';
import { signToken } from '../src/auth/jwt.js';

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

// ---- Limpieza ----

limpiar();
console.log(`\n[SMOKE-ACCOUNT] ${pass} ok, ${fail} fallas\n`);
process.exit(fail ? 1 : 0);
