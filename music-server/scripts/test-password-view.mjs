// Prueba PURA de src/users/password-view.js (1.23.0): sin servidor y sin base. Corre con
//   npm run test:password-view
//
// Además, una revisión de TEXTO sobre src/: ningún `SELECT *` de users y ningún SELECT que
// traiga password_view salvo el de verPassword. Es la red que caza el día que alguien
// vuelva a escribir un `SELECT *` "por comodidad" y la copia cifrada empiece a viajar.
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const LLAVE = randomBytes(32).toString('base64');
const OTRA = randomBytes(32).toString('base64');

// La llave del cifrador por defecto se lee al importar: se pone antes para que no avise.
process.env.PASSWORD_VIEW_KEY = LLAVE;
const { crearCifrador, leerLlave, cifrarPassword, descifrarPassword } = await import('../src/users/password-view.js');

let pass = 0;
let fail = 0;
function check(ok, label) {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FALLA ${label}`); }
}

const c = crearCifrador(LLAVE);

console.log('[1] ida y vuelta');
for (const [label, texto] of [
  ['ascii', 'contrasena123'],
  ['unicode (acentos, ñ, kana, emoji)', 'Ñandú-çàé ガンバレ 🎧🔑 ok'],
  ['larga (2000 caracteres)', 'x'.repeat(1999) + '!'],
  ['con dos puntos, que es el separador', 'a:b:c:d:e'],
  ['vacía', ''],
]) {
  const v = c.cifrar(7, texto);
  check(typeof v === 'string' && v.startsWith('v1:') && v.split(':').length === 4, `${label}: forma v1:iv:tag:dato`);
  check(c.descifrar(7, v) === texto, `${label}: vuelve igual`);
  check(!v.includes(texto) || texto === '', `${label}: el texto no aparece en claro`);
}

console.log('[2] cada cifrado lleva su IV');
const a = c.cifrar(7, 'misma'), b = c.cifrar(7, 'misma');
check(a !== b, 'la misma contraseña dos veces da dos valores distintos');
check(a.split(':')[1] !== b.split(':')[1], 'y los IV son distintos');
check(Buffer.from(a.split(':')[1], 'base64').length === 12, 'IV de 12 bytes');
check(Buffer.from(a.split(':')[2], 'base64').length === 16, 'tag de 16 bytes');

console.log('[3] todo lo que tiene que dar null');
const v = c.cifrar(7, 'secreta123');
check(crearCifrador(OTRA).descifrar(7, v) === null, 'otra llave → null');
check(c.descifrar(8, v) === null, 'AAD de otro id → null');
const [ver, iv, tag, dato] = v.split(':');
const voltear = (b64) => { const buf = Buffer.from(b64, 'base64'); buf[0] ^= 1; return buf.toString('base64'); };
check(c.descifrar(7, [ver, iv, tag, voltear(dato)].join(':')) === null, 'cifrado alterado → null');
check(c.descifrar(7, [ver, iv, voltear(tag), dato].join(':')) === null, 'tag alterado → null');
check(c.descifrar(7, [ver, voltear(iv), tag, dato].join(':')) === null, 'IV alterado → null');
check(c.descifrar(7, ['v2', iv, tag, dato].join(':')) === null, 'otra versión → null');
check(c.descifrar(7, 'basura') === null, 'sin forma → null');
check(c.descifrar(7, null) === null, 'null → null');
check(c.descifrar(7, [ver, iv, dato].join(':')) === null, 'falta una parte → null');
check(c.cifrar(0, 'x') === null && c.cifrar('abc', 'x') === null, 'id inválido → cifrar da null');

console.log('[4] sin llave o con una que no sirve');
for (const [label, llave] of [
  ['sin llave', undefined],
  ['vacía', '   '],
  ['16 bytes', randomBytes(16).toString('base64')],
  ['33 bytes', randomBytes(33).toString('base64')],
  ['no es base64', 'esto no es una llave!!'],
]) {
  const s = crearCifrador(llave);
  check(!s.disponible && s.cifrar(7, 'x') === null && s.descifrar(7, v) === null, `${label} → no disponible y las dos dan null`);
}
check(leerLlave(randomBytes(16).toString('base64')).motivo === 'decodifica a 16 bytes y no a 32', 'el motivo dice el largo, no el valor');
check(leerLlave(` ${LLAVE} `).llave?.length === 32, 'con espacios en los bordes, sirve');

console.log('[5] el cifrador por defecto lee PASSWORD_VIEW_KEY');
check(descifrarPassword(3, cifrarPassword(3, 'por defecto')) === 'por defecto', 'ida y vuelta con la llave del entorno');
check(c.descifrar(3, cifrarPassword(3, 'misma llave')) === 'misma llave', 'y es la misma llave');

console.log('[6] password_view no viaja: revisión de texto sobre src/');
function archivos(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : p.endsWith('.js') ? [p] : [];
  });
}
let selectEstrella = [];
let selectsConView = [];
for (const f of archivos(join(RAIZ, 'src'))) {
  const t = readFileSync(f, 'utf8');
  const rel = relative(RAIZ, f).replace(/\\/g, '/');
  if (/SELECT\s+\*\s+FROM\s+users\b/i.test(t)) selectEstrella.push(rel);
  for (const m of t.matchAll(/SELECT[^;'"`]*?password_view/gi)) selectsConView.push(`${rel}: ${m[0].replace(/\s+/g, ' ')}`);
}
check(selectEstrella.length === 0, `ningún SELECT * FROM users${selectEstrella.length ? ` (${selectEstrella.join(', ')})` : ''}`);
check(
  selectsConView.length === 1 && selectsConView[0].startsWith('src/users/service.js'),
  `un solo SELECT trae password_view, el de verPassword${selectsConView.length !== 1 ? ` (${selectsConView.join(' | ')})` : ''}`,
);

console.log(`\n${pass} ok, ${fail} fallas`);
process.exit(fail ? 1 : 0);
