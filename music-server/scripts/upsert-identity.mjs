// La prueba del frente: QUE RENOMBRARSE NO TE PARTA LA CUENTA EN DOS.
//
// Es lo único que no se puede comprobar por HTTP desde acá: para llegar a POST
// /api/auth/cf hace falta una identidad firmada por Cloudflare, y falsificarla
// pediría la clave de Cloudflare. Así que se llama a upsertUserByEmail directamente,
// que es la función que toma la decisión.
//
// CORRE SOBRE UNA BASE TEMPORAL, no sobre la de desarrollo: MUSIC_DB_PATH se pone
// ANTES de importar nada del servidor, porque db/database.js abre el archivo al
// evaluarse. Un import más arriba y esto escribiría en la base real.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sonorarev-upsert-'));
process.env.MUSIC_DB_PATH = join(dir, 'test.db');

const { default: db } = await import('../src/db/database.js');
const { upsertUserByEmail } = await import('../src/api/auth.js');

let pass = 0;
let fail = 0;

function check(ok, label, detalle = '') {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FALLA ${label}${detalle ? `  → ${detalle}` : ''}`); }
}

const fila = id => db.prepare('SELECT id, username, email FROM users WHERE id = ?').get(id);
const cuantos = () => db.prepare('SELECT COUNT(*) n FROM users').get().n;

console.log(`\nBase temporal: ${process.env.MUSIC_DB_PATH}`);

// ---------------------------------------------------------------------------
console.log('\n[1] EL CASO DEL FRENTE: renombrarse y volver a entrar por Google');

const alta = await upsertUserByEmail('x@y.com');
check(alta?.username === 'x@y.com', 'alta por SSO → username = el correo', JSON.stringify(alta));
check(fila(alta.id).email === 'x@y.com', 'y le queda el email escrito');

// El rename se hace acá con un UPDATE porque lo que se está probando es el UPSERT, no
// renameUser: da igual quién haya cambiado el nombre, lo que importa es que después
// la identidad siga apuntando a la misma fila.
db.prepare('UPDATE users SET username = ? WHERE id = ?').run('equis', alta.id);
check(fila(alta.id).username === 'equis', 'se renombra a "equis"');

const antes = cuantos();
const vuelve = await upsertUserByEmail('x@y.com');
check(vuelve?.id === alta.id, 'el upsert con "x@y.com" devuelve LA MISMA fila', `esperaba id ${alta.id}, vino ${vuelve?.id}`);
check(vuelve?.username === 'equis', 'y con el nombre nuevo');
check(cuantos() === antes, 'NO se creó una cuenta nueva', `había ${antes}, hay ${cuantos()}`);

// ---------------------------------------------------------------------------
console.log('\n[2] LEGADO: cuenta dada de alta con el correo como nombre, sin email');

db.prepare("INSERT INTO users (username, password_hash) VALUES ('juan@gmail.com', 'x')").run();
const juanId = db.prepare("SELECT id FROM users WHERE username = 'juan@gmail.com'").get().id;
check(fila(juanId).email === null, 'arranca sin email (la creó un admin, no el SSO)');

const juan = await upsertUserByEmail('juan@gmail.com');
check(juan?.id === juanId, 'el primer login por Google la ADOPTA en vez de duplicarla');
check(fila(juanId).email === 'juan@gmail.com', 'y le escribe el email, así queda resuelto para siempre');

// ---------------------------------------------------------------------------
console.log('\n[3] MAYÚSCULAS: el correo se normaliza');

const mayus = await upsertUserByEmail('X@Y.com');
check(mayus?.id === alta.id, '"X@Y.com" encuentra la fila de "x@y.com"');

// ---------------------------------------------------------------------------
console.log('\n[4] AMBIGUO: alguien se llama igual que el correo de otro');

// `ana` tiene su propio correo y después se renombra al correo de otra persona. Su
// username coincide con esa identidad, pero su email dice que es otra: fusionarlas le
// daría a quien entra la cuenta de ana.
const ana = await upsertUserByEmail('ana@gmail.com');
db.prepare('UPDATE users SET username = ? WHERE id = ?').run('pedro@gmail.com', ana.id);

const antesAmbiguo = cuantos();
const ambiguo = await upsertUserByEmail('pedro@gmail.com');
check(ambiguo === null, 'no adivina: devuelve null y el router contesta 409', JSON.stringify(ambiguo));
check(cuantos() === antesAmbiguo, 'y no crea nada');
check(fila(ana.id).email === 'ana@gmail.com', 'la cuenta de ana queda intacta');

// ---------------------------------------------------------------------------
console.log('\n[5] El índice único de email hace su trabajo');

let choco = false;
try {
  db.prepare("INSERT INTO users (username, email, password_hash) VALUES ('otro', 'x@y.com', 'z')").run();
} catch { choco = true; }
check(choco, 'dos filas no pueden compartir email');

let dosNull = true;
try {
  db.prepare("INSERT INTO users (username, password_hash) VALUES ('sin1', 'z')").run();
  db.prepare("INSERT INTO users (username, password_hash) VALUES ('sin2', 'z')").run();
} catch { dosNull = false; }
check(dosNull, 'pero sí pueden compartir "sin email"');

// ---------------------------------------------------------------------------
console.log(`\n[UPSERT] ${pass} ok, ${fail} fallas\n`);
db.close();
rmSync(dir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
