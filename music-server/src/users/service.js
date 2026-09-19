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
import { randomUUID } from 'node:crypto';
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

/** El hash de una cuenta SIN contraseña utilizable: un bcrypt real de un UUID que nadie
 *  conoce. Existe para cumplir el NOT NULL de `password_hash` en las cuentas que entran
 *  solo por una identidad de afuera —las que da de alta /cf y, desde 1.19.0, las que un
 *  admin crea con correo y sin contraseña—. Nadie puede entrar con él por /login, y en la
 *  tabla se ve igual que cualquier otro hash. Vive acá para que sea UNO: antes estaba
 *  escrito a mano en api/auth.js. */
export function hashInservible() {
  return bcrypt.hash(randomUUID(), BCRYPT_ROUNDS);
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
    throw new UserError(400, 'Eso no es un emoji: elige uno del teclado de emojis.');
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
// `email` lo escriben DOS caminos, y solo esos dos: los logins que traen una identidad
// VERIFICADA —el de Cloudflare y el de Google (api/auth.js), por findByEmailOrLegacy— y,
// desde 1.19.0, un ADMIN a mano (updateUser, con las reglas de "El correo", más abajo). El
// riesgo que durante 1.16-1.18 lo dejó fuera de la administración sigue ahí —un admin que
// se equivoca de correo le apunta la cuenta de alguien a la identidad de Google de otro—,
// y por eso cada cambio deja una línea en el log con quién, a quién, antes y después.
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

// ---- Quién soy ----
//
// Las columnas que ve uno de SU PROPIA cuenta: sin los conteos de SELECT_PUBLIC, que son
// del panel de administración, y sin `password_hash`, por lo mismo que allá. Vive acá y
// no en api/me.js porque desde el login por Google tiene dos consumidores —GET /api/me y
// POST /api/auth/google, que devuelve `me` junto con el token— y la forma tiene que ser
// la misma en los dos: la app arma su sesión con cualquiera de las dos respuestas.
const SELECT_ME = `
  SELECT id, username, email, role, created_at, avatar_emoji, avatar_updated_at
  FROM users WHERE id = ?
`;

export function leerMe(id) {
  const row = db.prepare(SELECT_ME).get(id);
  if (!row) return null;
  const { avatar_emoji, avatar_updated_at, ...resto } = row;
  return { ...resto, avatar: avatarDe(row) };
}

// ---- Identidad por correo ----

// El mensaje del conflicto vive acá porque lo dicen los dos logins que llegan con un
// correo verificado (Cloudflare y Google), y tiene que decirse igual en los dos.
export const CONFLICTO_IDENTIDAD =
  'Ese correo coincide con el nombre de otra cuenta. Avisa a quien administra el servidor.';

/**
 * La cuenta de un correo YA VERIFICADO por alguien de afuera (Cloudflare Access o
 * Google), o `null` si no hay ninguna. NO CREA NADA: crear es decisión de cada login
 * —/cf da de alta, porque ahí la política de Access ya filtró quién puede entrar;
 * /google no, porque nadie filtró nada antes de llegar acá—.
 *
 * Los dos caminos, en este orden:
 *   1. POR EMAIL — el caso normal. `lower(email)` y no `email` a secas: hoy se guarda
 *      siempre en minúsculas, pero la comparación no depende de que nadie se olvide.
 *   2. LEGADO: la fila guarda el correo en el username y todavía no tiene email. Pasa
 *      con las cuentas que un admin dio de alta usando el correo como nombre. Se le
 *      ESCRIBE el email —la única escritura de esta función— y queda resuelto para
 *      siempre.
 *
 * ⚠️ EL PASO 2 ADOPTA SOLO SI LA FILA NO TIENE EMAIL. Desde que existe el rename,
 * alguien podría llamarse igual que el correo de otra persona: si esa fila YA tiene un
 * email distinto, el nombre coincide pero la identidad no, y fusionarlas le daría a
 * quien entra la cuenta de otro. Ahí no se adivina: UserError 409.
 */
export function findByEmailOrLegacy(email) {
  const mail = String(email ?? '').trim().toLowerCase();
  if (!mail) return null;

  const porEmail = db.prepare('SELECT id, username FROM users WHERE lower(email) = ?').get(mail);
  if (porEmail) return porEmail;

  const legado = db.prepare('SELECT id, username, email FROM users WHERE lower(username) = ?').get(mail);
  if (!legado) return null;

  if (legado.email != null) throw new UserError(409, CONFLICTO_IDENTIDAD);
  db.prepare('UPDATE users SET email = ? WHERE id = ?').run(mail, legado.id);
  return { id: legado.id, username: legado.username };
}

// ---- El correo ----
//
// Las reglas del correo que pone un ADMIN (desde la API o desde el CLI). No las usan los
// logins de Cloudflare y Google: esos traen el correo ya verificado por alguien de afuera
// y pasan por findByEmailOrLegacy, que tiene su propio cuidado.

// El techo práctico de una dirección (RFC 5321: 254 en el camino SMTP). No es por la
// base, que no tiene límite: es para que un error de pegado no guarde un párrafo.
export const MAX_EMAIL = 254;

// El formato BÁSICO y nada más: una @, algo antes, un dominio con punto, sin espacios. No
// pretende cumplir el RFC —un validador "completo" rechaza direcciones reales y acepta
// basura rara—; lo que evita es el error de dedo ("kister@", "kister@gmail"). Es la misma
// regla que usa la app para avisar antes de mandar (`pareceCorreo`).
const FORMATO_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Limpia y valida un correo, o lanza UserError 400. Lo guarda en MINÚSCULAS, y no es
 *  cosmético: POST /api/auth/login busca con `email = ident.toLowerCase()` (api/auth.js),
 *  así que uno guardado con mayúsculas dejaría de servir para entrar con contraseña. */
export function normalizeEmail(raw) {
  const mail = String(raw ?? '').trim().toLowerCase();
  if (!mail) throw new UserError(400, 'El correo no puede estar vacío. Para quitarlo, manda null.');
  if (mail.length > MAX_EMAIL) {
    throw new UserError(400, `El correo no puede tener más de ${MAX_EMAIL} caracteres.`);
  }
  if (!FORMATO_CORREO.test(mail)) {
    throw new UserError(400, `"${mail}" no parece un correo: tiene que ser algo como nombre@dominio.com.`);
  }
  return mail;
}

/** El correo está libre para la cuenta `id` (0 si todavía no existe). Dos choques:
 *
 *   1. YA ES EL CORREO DE OTRA CUENTA. El índice único (db/database.js) lo impediría
 *      igual, pero con un SQLITE_CONSTRAINT crudo; esto es para el mensaje, y el catch de
 *      `writeEmail` sigue siendo la garantía si dos cambios llegan a la vez.
 *   2. ES EL NOMBRE DE OTRA CUENTA. Ese es el caso que el índice NO ve y el que más
 *      rompe: findByEmailOrLegacy busca primero por correo, así que Google entraría a
 *      ESTA cuenta y la otra —que se habría ligado por su nombre la primera vez— no se
 *      ligaría nunca; y /login, que busca primero por nombre, abriría la OTRA con ese
 *      texto. Dos puertas que llevan a dos cuentas con la misma llave. */
function assertCorreoLibre(id, mail) {
  const deOtra = db.prepare('SELECT username FROM users WHERE lower(email) = ? AND id <> ?').get(mail, id);
  if (deOtra) throw new UserError(409, `Ese correo ya es de «${deOtra.username}».`);

  const nombreDeOtra = db.prepare('SELECT username FROM users WHERE lower(username) = ? AND id <> ?').get(mail, id);
  if (nombreDeOtra) {
    throw new UserError(
      409,
      `Ese correo es el nombre de usuario de «${nombreDeOtra.username}»: si también fuera el `
      + 'correo de esta cuenta, Google no sabría a cuál entrar.',
    );
  }
}

// El SELECT de arriba es solo para el mensaje; la garantía es el índice único, así que el
// UPDATE va con catch. Es la misma pareja que writeUsername.
function writeEmail(id, mail) {
  try {
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(mail, id);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new UserError(409, 'Ese correo ya es de otra cuenta.');
    throw e;
  }
}

// UNA LÍNEA POR CAMBIO, y no es opcional: el correo es con lo que Google encuentra una
// cuenta, y un admin que lo cambia mal le da a otra persona las playlists y el historial
// de alguien (o su rol de admin). Sin esto no queda ningún rastro de quién lo hizo. Va a
// la salida del proceso, que es lo que Dokploy guarda como log del contenedor.
function registrarCorreo({ actor, user, antes, despues }) {
  console.log(
    `[usuarios] correo de la cuenta ${user.id} (${user.username}): ${antes ?? 'sin correo'} → `
    + `${despues ?? 'sin correo'} · lo cambió ${actor ?? 'alguien sin nombre'}`,
  );
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

/** Da de alta una cuenta. Desde 1.19.0 acepta `email` opcional, con las reglas de "El
 *  correo" (arriba), y ahí la CONTRASEÑA PASA A SER OPCIONAL: una cuenta con correo y sin
 *  contraseña entra solo con Google —el login por Google la encuentra por ese correo—
 *  hasta que un admin le ponga una. SIN correo, la contraseña sigue siendo obligatoria,
 *  porque sería la única forma de entrar.
 *
 *  "Sin contraseña" es `undefined`, `null` o `""`: los tres dicen lo mismo, y un cliente
 *  que manda el campo vacío no tiene por qué recibir un "necesita 8 caracteres". */
export async function createUser({ username, password, role = 'user', email }, { actor } = {}) {
  const name = normalizeUsername(username);
  const rol = normalizeRole(role);
  const mail = email === undefined || email === null ? null : normalizeEmail(email);
  const sinPassword = password === undefined || password === null || password === '';
  if (sinPassword && !mail) {
    throw new UserError(400, 'Falta la contraseña: sin correo, es la única forma de entrar.');
  }
  const hash = sinPassword ? await hashInservible() : await hashPassword(password);

  // El SELECT previo es SOLO para el mensaje; la garantía real es el UNIQUE de la
  // tabla, y por eso el INSERT igual va con catch. Sin él, dos altas del mismo
  // nombre en el mismo instante saldrían como un SQLITE_CONSTRAINT crudo.
  if (findByUsername(name)) throw new UserError(409, `Ya existe el usuario "${name}".`);
  // 0 como id: la cuenta todavía no existe, así que cualquier choque es con OTRA.
  if (mail) assertCorreoLibre(0, mail);

  let info;
  try {
    info = db
      .prepare('INSERT INTO users (username, password_hash, role, email) VALUES (?, ?, ?, ?)')
      .run(name, hash, rol, mail);
  } catch (e) {
    // Dos UNIQUE pueden saltar acá: el del nombre (columna) y el del correo (índice), y
    // SQLite dice cuál en el mensaje ("users.email").
    if (String(e.message).includes('users.email')) throw new UserError(409, 'Ese correo ya es de otra cuenta.');
    if (String(e.message).includes('UNIQUE')) throw new UserError(409, `Ya existe el usuario "${name}".`);
    throw e;
  }

  const creado = getUser(Number(info.lastInsertRowid));
  // Nacer con correo también es ponerle un correo, así que deja su línea como cualquier
  // cambio (ver `registrarCorreo`).
  if (mail) registrarCorreo({ actor, user: creado, antes: null, despues: mail });
  return creado;
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

/** Cambia el NOMBRE y nada más. El email NO se toca acá: es la identidad con la que el
 *  login por Google encuentra la cuenta (api/auth.js), y moverla desde una pantalla de
 *  "cambiar mi nombre" es exactamente cómo se le entrega la cuenta de alguien a otra
 *  persona. El único camino a mano para el correo es `updateUser`, que solo usa un admin,
 *  con sus reglas y su línea de log. */
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

// ---- Avatar ----
//
// ⚠️ EL ORDEN DE LAS DOS ESCRITURAS NO ES CASUAL, y es la misma regla en las tres:
// **la base manda y el archivo solo se sirve si ella lo dice.** Por eso, cuando hay
// que BORRAR el archivo, primero se actualiza la base y después se hace el unlink: si
// el proceso muere en el medio, queda un archivo huérfano que nadie sirve — invisible
// y pisado por la próxima subida. Al revés (unlink y después UPDATE) quedaría la base
// diciendo "hay foto" y el endpoint devolviendo 404, que sí se ve.
//
// Cuando hay que CREARLO el orden se invierte por obligación: no se puede apuntar a un
// archivo que todavía no existe. Ahí el corte deja el archivo escrito y la columna en
// null, que cae del mismo lado seguro.

/** Pone el emoji, o lo quita con `null`.
 *
 *  Poner uno BORRA la foto: son excluyentes por diseño (ver el invariante en
 *  db/database.js). Quitarlo con `null` toca solo el emoji y deja la foto donde esté —
 *  que por ese mismo invariante es "en ningún lado". Para llevarse las dos cosas sin
 *  preguntar está `clearAvatar`. */
export function setAvatarEmoji(id, raw) {
  mustGet(id);

  if (raw === null) {
    db.prepare('UPDATE users SET avatar_emoji = NULL WHERE id = ?').run(id);
    return getUser(id);
  }

  const emoji = assertEmoji(raw);
  db.prepare('UPDATE users SET avatar_emoji = ?, avatar_updated_at = NULL WHERE id = ?').run(emoji, id);
  deleteAvatarPhoto(id);
  return getUser(id);
}

/** Guarda la foto ya procesada y se lleva el emoji. */
export async function setAvatarPhoto(id, buffer) {
  mustGet(id);

  let cuando;
  try {
    cuando = await writeAvatarPhoto(id, buffer);
  } catch {
    // Lo que sabe el que llama es que mandó bytes con un Content-Type de imagen; que
    // libvips no los entienda es un 400 suyo, no un 500 nuestro. El detalle de sharp
    // no sube: diría más de nuestras tripas que del problema.
    throw new UserError(400, 'No se pudo leer la imagen.');
  }

  db.prepare('UPDATE users SET avatar_emoji = NULL, avatar_updated_at = ? WHERE id = ?').run(cuando, id);
  return getUser(id);
}

/** Deja la cuenta sin avatar de ningún tipo. */
export function clearAvatar(id) {
  mustGet(id);
  db.prepare('UPDATE users SET avatar_emoji = NULL, avatar_updated_at = NULL WHERE id = ?').run(id);
  deleteAvatarPhoto(id);
  return getUser(id);
}

/** Lo que un admin le cambia a una cuenta. `actor` es quién lo hace, para el log del
 *  correo: el router pasa el admin de la sesión y el CLI dice que fue él. */
export async function updateUser(id, { role, password, username, emoji, email }, { actor } = {}) {
  const user = mustGet(id);

  if (
    role === undefined && password === undefined && username === undefined
    && emoji === undefined && email === undefined
  ) {
    throw new UserError(400, 'No hay nada que cambiar: manda role, password, username, emoji, email o varios.');
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
  // `null` es "quitalo" y no un valor a validar, así que no pasa por assertEmoji.
  const emo = emoji === undefined || emoji === null ? emoji : assertEmoji(emoji);
  // El correo: `null` es DESLIGAR —la cuenta deja de tener correo—. Y el mismo valor que ya
  // tiene no es un cambio: no se escribe ni se loguea, y el PATCH contesta 200 igual.
  const mail = email === undefined || email === null ? email : normalizeEmail(email);
  const correoAntes = user.email ?? null;
  const cambiaCorreo = mail !== undefined && mail !== (correoAntes === null ? null : correoAntes.toLowerCase());

  if (nombre !== undefined) assertNombreLibre(id, nombre);
  if (cambiaCorreo && mail !== null) assertCorreoLibre(id, mail);
  if (rol === 'user') assertNotLastAdmin(user, 'bajarlo a usuario normal');

  if (rol !== undefined) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(rol, id);
  if (hash !== undefined) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
  if (nombre !== undefined) writeUsername(id, nombre);
  if (cambiaCorreo) {
    writeEmail(id, mail);
    registrarCorreo({ actor, user, antes: correoAntes, despues: mail });
  }
  // Va último y por setAvatarEmoji para no repetir el borrado del archivo ni el
  // cuidado del orden entre la base y el disco, que está explicado ahí arriba.
  if (emo !== undefined) setAvatarEmoji(id, emo);

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
