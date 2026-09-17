// Las reglas de usuarios, en UN solo lugar. Las consumen los dos frentes que pueden
// tocar la tabla: el router de /api/admin/users y el CLI de src/admin/users.js.
//
// POR QUÉ COMPARTIDO Y NO COPIADO. Son siete reglas —el largo del usuario, el techo
// de 72 bytes de bcrypt, el coste, los roles válidos, el último admin, la
// confirmación del borrado y el listado sin hash— y dos copias de siete reglas
// divergen. El día que diverjan, la contraseña puesta por la web tendría otra fuerza
// que la puesta por el CLI, o el CLI dejaría borrar al último admin y la API no, y
// nadie se entera hasta que pasa.
//
// ERRORES TIPADOS, porque los dos consumidores necesitan cosas distintas de lo
// mismo: el router necesita un status HTTP y el CLI un mensaje para imprimir y un
// código de salida. UserError lleva las dos cosas, así que la regla se escribe una
// vez y cada lado la presenta como le corresponde.
import bcrypt from 'bcrypt';
import db from '../db/database.js';
import { avatarDe, deleteAvatarPhoto, writeAvatarPhoto } from './avatars.js';

// El MISMO coste que usa auth.js. Antes vivía duplicado en el CLI con un comentario
// que decía "si algún día se unifica, este es el otro sitio que hay que mover":
// esto es ese día, y este es ese sitio.
export const BCRYPT_ROUNDS = 12;

// bcrypt IGNORA EN SILENCIO todo lo que pase de 72 bytes: una contraseña más larga
// se guardaría truncada y la persona creería tener algo que no tiene. Se mide en
// BYTES y no en caracteres, porque una tilde ocupa dos.
export const MAX_PASSWORD_BYTES = 72;
export const MIN_PASSWORD = 8;

export const MIN_USERNAME = 3;
export const MAX_USERNAME = 64;

// SQLite no tiene enum y el CHECK no se puede agregar con ALTER TABLE (ver la
// migración en db/database.js). O sea que esta lista ES la restricción: si un valor
// entra por otro camino, la base lo acepta sin chistar.
export const ROLES = ['user', 'admin'];

export class UserError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'UserError';
    this.status = status;
  }
}

// ---- Validación ----

export function normalizeUsername(raw) {
  const name = String(raw ?? '').trim();
  if (!name) throw new UserError(400, 'El usuario no puede estar vacío.');
  if (/\s/.test(name)) throw new UserError(400, `El usuario no puede llevar espacios: "${name}".`);
  if (name.length < MIN_USERNAME || name.length > MAX_USERNAME) {
    throw new UserError(400, `El usuario tiene que medir entre ${MIN_USERNAME} y ${MAX_USERNAME} caracteres.`);
  }
  return name;
}

export function assertPassword(password) {
  const pw = String(password ?? '');
  if (pw.length < MIN_PASSWORD) {
    throw new UserError(400, `La contraseña necesita al menos ${MIN_PASSWORD} caracteres.`);
  }
  if (Buffer.byteLength(pw, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new UserError(400, `Más de ${MAX_PASSWORD_BYTES} bytes: bcrypt la truncaría en silencio.`);
  }
  return pw;
}

export function normalizeRole(raw) {
  const role = String(raw ?? '').trim();
  if (!ROLES.includes(role)) {
    throw new UserError(400, `Rol inválido: "${role}". Los válidos son ${ROLES.join(' y ')}.`);
  }
  return role;
}

export function hashPassword(password) {
  return bcrypt.hash(assertPassword(password), BCRYPT_ROUNDS);
}

// ---- El emoji del avatar ----
//
// UN SOLO GRAFEMA, y se cuenta con Intl.Segmenter porque es lo único que sabe que
// 👨‍👩‍👧 son ocho unidades de código y UNA cosa. Contar `.length` rechazaría cualquier
// emoji compuesto, y contar code points rechazaría los de tono de piel.
const SEGMENTADOR = new Intl.Segmenter('es', { granularity: 'grapheme' });

// Tope en unidades de código UTF-16. La familia de cuatro con tonos de piel es la
// secuencia razonable más larga y no llega a 16; el tope está para que nadie guarde
// una cadena de mil ZWJ que un cliente tenga que dibujar.
const MAX_EMOJI_UNITS = 16;

// PICTOGRÁFICO: tiene que llevar al menos un Extended_Pictographic. Se pregunta por
// "contiene" y no por "todo el grafema lo es" porque las secuencias traen piezas que
// NO lo son —el ZWJ, el selector de variación FE0F, los modificadores de tono— y
// exigirlo en todas rechazaría justo los emojis compuestos.
const PICTOGRAFICO = /\p{Extended_Pictographic}/u;

// Y NADA DE LETRAS NI DÍGITOS. Es lo que cierra el agujero que deja la regla de
// arriba: "#️⃣" y "1️⃣" son un grafema y llevan un pictográfico (el recuadro
// U+20E3), así que sin esto pasarían — y un dígito como avatar es exactamente lo
// que no se quiere, porque se confunde con la inicial que la app dibuja cuando no
// hay avatar.
const ALFANUMERICO = /[\p{L}\p{N}]/u;

/** Valida el emoji y lo devuelve tal cual. Lanza UserError 400 si no sirve.
 *
 *  ⚠️ LAS BANDERAS DE PAÍS QUEDAN AFUERA, y es consecuencia de la regla, no un
 *  olvido: 🇲🇽 son dos indicadores regionales y NINGUNO es Extended_Pictographic.
 *  Medido en node 22, no supuesto. Si algún día se quieren, la línea es admitir
 *  además \p{Regional_Indicator}; se dejó como está porque nadie lo pidió y ampliar
 *  lo que se acepta es más fácil que volver a achicarlo. */
export function assertEmoji(raw) {
  const emoji = String(raw ?? '');
  if (!emoji) throw new UserError(400, 'No mandaste ningún emoji.');

  if (emoji.length > MAX_EMOJI_UNITS) {
    throw new UserError(400, 'Ese emoji es demasiado largo.');
  }
  if ([...SEGMENTADOR.segment(emoji)].length !== 1) {
    throw new UserError(400, 'Tiene que ser un solo emoji.');
  }
  if (!PICTOGRAFICO.test(emoji) || ALFANUMERICO.test(emoji)) {
    throw new UserError(400, 'Eso no es un emoji: elegí uno del teclado de emojis.');
  }
  return emoji;
}

// ---- Lectura ----

// password_hash NO aparece acá, y por eso las columnas van NOMBRADAS: un SELECT con
// asterisco lo arrastraría a la respuesta HTTP al primer descuido, y un hash de
// bcrypt en un JSON es material para atacarlo offline, sin límite de intentos.
//
// LOS DOS CONTEOS VAN POR SUBCONSULTA Y NO POR JOIN, y no es cuestión de estilo. Con
// dos LEFT JOIN sobre playlists y plays, SQLite hace el producto de las dos: quien
// tenga 3 playlists y 500 plays da 1500 filas, y COUNT() devolvería 1500 en las dos
// columnas. Con UNA sola tabla el JOIN anda —así lo hacía list() del CLI— y por eso
// el bug no aparece hasta que alguien agrega la segunda.
// `email` va acá y NO en ningún UPDATE de este archivo: se muestra, pero no se edita
// por ninguna de las vías de administración. Lo escribe solo el login por Cloudflare
// (api/auth.js), que es quien tiene una identidad verificada para escribirlo. Un admin
// que pudiera cambiarlo a mano podría, sin querer, apuntar la cuenta de alguien a la
// identidad de Google de otro.
const SELECT_PUBLIC = `
  SELECT u.id, u.username, u.email, u.role, u.created_at,
         u.avatar_emoji, u.avatar_updated_at,
         (SELECT COUNT(*) FROM playlists p WHERE p.user_id = u.id) AS playlists,
         (SELECT COUNT(*) FROM plays     y WHERE y.user_id = u.id) AS plays
  FROM users u
`;

// Las dos columnas del avatar salen del SELECT y NO de la respuesta: lo que viaja es
// `avatar`, ya resuelto a una de sus tres formas. Que el cliente tenga que decidir
// entre `avatar_emoji` y `avatar_updated_at` sería repartir el invariante entre el
// servidor y cada consumidor, y el móvil y el web lo implementarían distinto.
function publico(row) {
  if (!row) return null;
  const { avatar_emoji, avatar_updated_at, ...resto } = row;
  return { ...resto, avatar: avatarDe(row) };
}

export function listUsers() {
  return db.prepare(`${SELECT_PUBLIC} ORDER BY u.id`).all().map(publico);
}

export function getUser(id) {
  return publico(db.prepare(`${SELECT_PUBLIC} WHERE u.id = ?`).get(id) ?? null);
}

export function findByUsername(username) {
  return publico(db.prepare(`${SELECT_PUBLIC} WHERE u.username = ?`).get(username) ?? null);
}

export function countAdmins() {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
}

// Exige el usuario y explota con 404 si no está. Lo usan las tres escrituras, para
// que "no existe" se diga igual en todas.
function mustGet(id) {
  const user = getUser(id);
  if (!user) throw new UserError(404, 'No existe ese usuario.');
  return user;
}

// Se queda sin admins si tocamos a ESTE. Es la misma pregunta para bajar de rol y
// para borrar, así que se escribe una vez: una base sin ningún admin no se arregla
// desde la API —haría falta el CLI y acceso al contenedor—, así que el bloqueo sale
// barato y el agujero sale caro.
function assertNotLastAdmin(user, accion) {
  if (user.role === 'admin' && countAdmins() <= 1) {
    throw new UserError(400, `"${user.username}" es el último admin: ${accion} dejaría la base sin ninguno.`);
  }
}

// ---- Escritura ----

export async function createUser({ username, password, role = 'user' }) {
  const name = normalizeUsername(username);
  const rol = normalizeRole(role);
  const hash = await hashPassword(password);

  // El SELECT previo es SOLO para el mensaje; la garantía real es el UNIQUE de la
  // tabla, y por eso el INSERT igual va con catch. Sin él, dos altas del mismo
  // nombre en el mismo instante saldrían como un SQLITE_CONSTRAINT crudo.
  if (findByUsername(name)) throw new UserError(409, `Ya existe el usuario "${name}".`);

  let info;
  try {
    info = db
      .prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run(name, hash, rol);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new UserError(409, `Ya existe el usuario "${name}".`);
    throw e;
  }

  return getUser(Number(info.lastInsertRowid));
}

// EL NOMBRE ESTÁ LIBRE PARA ESTE id. Privadas y compartidas por los dos caminos que
// renombran —el propio (PATCH /api/me) y el de un admin (PATCH /api/admin/users/:id)—,
// que es lo que hace que la REGLA sea una sola aunque las funciones sean dos.
//
// `taken.id !== id` y no `taken` a secas: renombrarse al nombre que uno ya tiene no es
// un conflicto, es no hacer nada, y contestarle 409 a eso sería absurdo.
function assertNombreLibre(id, name) {
  const taken = findByUsername(name);
  if (taken && taken.id !== id) throw new UserError(409, `Ya existe el usuario "${name}".`);
}

// El SELECT de arriba es solo para el mensaje; la garantía real es el UNIQUE de la
// tabla, así que el UPDATE igual va con catch — dos renombres al mismo nombre en el
// mismo instante saldrían como un SQLITE_CONSTRAINT crudo. Es la misma pareja de
// comprobaciones que ya hace createUser.
function writeUsername(id, name) {
  try {
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(name, id);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new UserError(409, `Ya existe el usuario "${name}".`);
    throw e;
  }
}

/** Cambia el NOMBRE y nada más. El email no se toca acá ni en ningún otro sitio de
 *  este archivo: es la identidad con la que el login por Google encuentra la cuenta
 *  (api/auth.js), y moverla desde una pantalla de "cambiar mi nombre" es exactamente
 *  cómo se le entrega la cuenta de alguien a otra persona. */
export function renameUser(id, username) {
  mustGet(id);
  const name = normalizeUsername(username);
  assertNombreLibre(id, name);
  writeUsername(id, name);
  return getUser(id);
}

/** Cambia la PROPIA contraseña, y para eso exige la actual. No lo pide el esquema ni
 *  el token: lo pide el hecho de que una sesión abierta en un teléfono prestado o sin
 *  bloquear alcanzaría, si no, para dejar a su dueño afuera de su propia cuenta.
 *
 *  Un ADMIN no pasa por acá: `updateUser` cambia la contraseña de otro sin conocerla,
 *  que es justo para lo que existe —alguien que la perdió—. Son dos operaciones
 *  distintas y por eso son dos funciones. */
export async function changeOwnPassword(id, { currentPassword, newPassword }) {
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(id);
  if (!row) throw new UserError(404, 'No existe ese usuario.');

  // La nueva se valida ANTES de mirar la actual: si la nueva no sirve, el resultado
  // es el mismo sepa o no la actual, y hacer el bcrypt.compare primero sería trabajo
  // tirado. `String(...)` porque bcrypt.compare(undefined, hash) RECHAZA en vez de
  // devolver false, y eso no es un 401: es una promesa sin dueño.
  assertPassword(newPassword);
  if (!(await bcrypt.compare(String(currentPassword ?? ''), row.password_hash))) {
    throw new UserError(401, 'La contraseña actual no es correcta.');
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(newPassword), id);
  return getUser(id);
}

export async function updateUser(id, { role, password, username }) {
  const user = mustGet(id);

  if (role === undefined && password === undefined && username === undefined) {
    throw new UserError(400, 'No hay nada que cambiar: mandá role, password, username o varios.');
  }

  // Se valida TODO antes de escribir NADA. Con un PATCH de rol y contraseña juntos,
  // validar sobre la marcha dejaría el rol cambiado y la contraseña sin cambiar.
  //
  // Por eso el username NO se hace llamando a renameUser, que valida y escribe de una:
  // se usan sus DOS mitades por separado, la comprobación acá arriba y la escritura
  // abajo. La regla sigue siendo una sola —las dos mitades son las mismas— y este
  // PATCH conserva su promesa de no dejar la fila a medias.
  const rol = role === undefined ? undefined : normalizeRole(role);
  const hash = password === undefined ? undefined : await hashPassword(password);
  const nombre = username === undefined ? undefined : normalizeUsername(username);

  if (nombre !== undefined) assertNombreLibre(id, nombre);
  if (rol === 'user') assertNotLastAdmin(user, 'bajarlo a usuario normal');

  if (rol !== undefined) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(rol, id);
  if (hash !== undefined) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
  if (nombre !== undefined) writeUsername(id, nombre);

  return getUser(id);
}

// BORRADO CON CASCADA: se lleva las playlists y el historial de reproducciones de
// esa persona (db/database.js:51 y :83). Es la decisión tomada; la alternativa que
// se descartó era negarse con 409 cuando el usuario tuviera algo.
//
// `confirm` tiene que ser el username EXACTO. Es la única barrera antes de algo que
// no se deshace, y por eso no alcanza con un booleano: escribir el nombre obliga a
// mirar A QUIÉN se está borrando, que es justo el error que se quiere evitar —el id
// equivocado—.
export function deleteUser(id, { confirm } = {}) {
  const user = mustGet(id);

  if (confirm !== user.username) {
    throw new UserError(400, `Para borrar hay que confirmar con el usuario exacto: "${user.username}".`);
  }

  assertNotLastAdmin(user, 'borrarlo');

  // LA CASCADA ES POR CONEXIÓN, no por esquema: PRAGMA foreign_keys = ON lo pone el
  // bootstrap de db/database.js y vale para ESA conexión. Si algún día alguien abre
  // la suya, el DELETE no cascadearía: dejaría playlists apuntando a un id que ya no
  // existe, en silencio. Se comprueba en vez de confiar — es leer un PRAGMA contra
  // un borrado irreversible.
  const fk = db.prepare('PRAGMA foreign_keys').get();
  if (!Object.values(fk ?? {})[0]) {
    throw new UserError(500, 'foreign_keys está apagado en esta conexión: el borrado dejaría datos huérfanos.');
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return user;
}
