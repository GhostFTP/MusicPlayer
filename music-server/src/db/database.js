import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));

// La base es SIEMPRE data/music.db salvo que MUSIC_DB_PATH diga otra cosa. El
// override existe para UNA cosa: que un script de prueba pueda importar este módulo
// —y con él el resto del servidor— contra una base temporal, sin tocar la de
// desarrollo. Sin esto, cualquier prueba de algo que importe `db` escribe en la base
// real, que es como un test termina borrándole las playlists a alguien.
//
// No se documenta como variable de despliegue a propósito: en producción no hay que
// ponerla, y el default es el de siempre.
const DB_PATH = process.env.MUSIC_DB_PATH ?? join(__dir, '../../data/music.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    UNIQUE NOT NULL,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tracks (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT,
    artist        TEXT,
    album         TEXT,
    album_artist  TEXT,
    genre         TEXT,
    year          INTEGER,
    track_number  INTEGER,
    duration      REAL,
    file_path     TEXT UNIQUE NOT NULL,
    cover_path    TEXT,
    lrc_path      TEXT,
    vocals        TEXT,
    mime_type     TEXT DEFAULT 'audio/mpeg',
    codec           TEXT,
    bits_per_sample INTEGER,
    sample_rate     INTEGER,
    bitrate         INTEGER,
    lossless        INTEGER,
    scanned_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS playlists (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    emoji      TEXT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS playlist_tracks (
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id    INTEGER NOT NULL REFERENCES tracks(id)    ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    PRIMARY KEY (playlist_id, track_id)
  );

  -- Registro de reproducciones. Es una TABLA de eventos y no un contador en
  -- 'tracks' a proposito: un play_count no se puede desagregar despues, y sin
  -- played_at no hay "lo mas escuchado este anio" ni resumen anual.
  --
  -- played_at lo pone el DISPOSITIVO, no el servidor: la app se usa sin senial y
  -- encola en disco, asi que una semana de escucha offline llegaria toda junta y
  -- con la fecha del insert quedaria registrada el dia que hubo wifi.
  --
  -- client_id es la idempotencia del reintento: si un envio se corta a mitad y se
  -- reintenta, el UNIQUE + INSERT OR IGNORE evita duplicar. Sin esto los conteos
  -- se inflan y nadie se entera.
  --
  -- ms_played es cuanto se escucho DE VERDAD. Va desde el dia uno porque no se
  -- puede backfillear: el dia que se quiera "escuchaste 412 horas", los registros
  -- viejos no lo tendrian.
  --
  -- OJO: nada de acentos ni backticks en estos comentarios. Todo este bloque vive
  -- dentro de un template literal de JS, asi que un backtick lo cierra antes de
  -- tiempo y el archivo deja de parsear.
  CREATE TABLE IF NOT EXISTS plays (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    track_id   INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    played_at  INTEGER NOT NULL,
    ms_played  INTEGER,
    client_id  TEXT    NOT NULL UNIQUE
  );

  CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
  CREATE INDEX IF NOT EXISTS idx_tracks_album  ON tracks(album);
  -- Los dos ejes por los que se consulta: que se escucho en tal periodo, y
  -- cuantas veces se escucho una pista.
  CREATE INDEX IF NOT EXISTS idx_plays_user_time  ON plays(user_id, played_at);
  CREATE INDEX IF NOT EXISTS idx_plays_user_track ON plays(user_id, track_id);
`);

// Migración: añade a bases ya existentes las columnas agregadas después del
// esquema inicial (CREATE TABLE IF NOT EXISTS no modifica tablas ya creadas).
const trackCols = new Set(db.prepare('PRAGMA table_info(tracks)').all().map(c => c.name));
const ADDED_COLUMNS = {
  codec:           'TEXT',
  bits_per_sample: 'INTEGER',
  sample_rate:     'INTEGER',
  bitrate:         'INTEGER',
  lossless:        'INTEGER',
  genre:           'TEXT',
  lrc_path:        'TEXT',
  vocals:          'TEXT',
  disc_number:     'INTEGER',
  disc_total:      'INTEGER',
};
for (const [col, type] of Object.entries(ADDED_COLUMNS)) {
  if (!trackCols.has(col)) db.exec(`ALTER TABLE tracks ADD COLUMN ${col} ${type}`);
}

db.exec('CREATE INDEX IF NOT EXISTS idx_tracks_genre ON tracks(genre);');

// Migración de playlists: emoji opcional por playlist (bases ya existentes).
const playlistCols = new Set(db.prepare('PRAGMA table_info(playlists)').all().map(c => c.name));
if (!playlistCols.has('emoji')) db.exec('ALTER TABLE playlists ADD COLUMN emoji TEXT');

// Migración de usuarios: ROL, para separar quién puede administrar (bases ya existentes).
//
// Valores válidos: 'user' y 'admin'. Se validan EN CÓDIGO, no con un CHECK, y no es
// pereza: SQLite no tiene enum, y un CHECK no se puede agregar con ALTER TABLE — habría
// que recrear la tabla entera y copiar las filas. Para dos valores no lo vale, y recrear
// la tabla de usuarios en una migración automática es exactamente donde se pierden filas.
//
// El DEFAULT 'user' es lo que hace que la migración sea segura sobre una base con datos:
// cada fila existente queda como usuario normal y nadie gana privilegios por el hecho de
// que la columna aparezca. Admin se marca después, a mano y de a uno.
const userCols = new Set(db.prepare('PRAGMA table_info(users)').all().map(c => c.name));
if (!userCols.has('role')) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");

// Migración de usuarios: EMAIL, separado del username.
//
// POR QUÉ. Las cuentas que entran por Cloudflare Access guardaban el correo EN el
// username, y upsertUserByEmail lo buscaba por ahí (api/auth.js). Mientras nadie
// pudiera cambiarse el nombre, funcionaba. El día que alguien se renombra, el
// siguiente login por Google no encuentra su fila y le crea OTRA cuenta — con sus
// playlists y su historial en la vieja, y sin ninguna forma de notarlo salvo que la
// persona diga "se me borró todo". El email es el identificador que no cambia; el
// username pasa a ser un nombre y nada más.
//
// Nullable a propósito: las cuentas de contraseña no tienen por qué tener uno, y las
// técnicas (app-ios) no deberían.
if (!userCols.has('email')) {
  db.exec('ALTER TABLE users ADD COLUMN email TEXT');

  // BACKFILL, y corre UNA sola vez: va dentro de este if, o sea solo en el arranque
  // que agrega la columna. En los siguientes no se ejecuta ni se mira.
  //
  // El heurístico es "el username parece un correo", y es el ÚNICO que hay: una
  // cuenta de SSO y una de contraseña se ven idénticas en la tabla (las dos tienen un
  // bcrypt de 60 caracteres, porque a las de SSO se les guarda el hash de un UUID
  // aleatorio para cumplir el NOT NULL). Se pasa de largo a propósito: darle un email
  // a una cuenta de contraseña cuyo nombre tiene arroba no rompe nada —nadie va a
  // autenticarse con Google como "snap@local"—, mientras que NO dárselo a una cuenta
  // de SSO de verdad es justamente el bug que esto viene a cerrar.
  //
  // ⚠️ SALTEA LAS AMBIGUAS en vez de arriesgarse a que el índice de abajo falle. Dos
  // filas cuyo lower(username) coincide —"A@x.com" y "a@x.com"— no pueden tener las
  // dos el mismo email, y si el UPDATE las escribiera igual, el CREATE INDEX de
  // después tiraría y el servidor NO ARRANCARÍA. Un arranque caído por una condición
  // de datos es mucho peor que dos filas sin email, que se arreglan a mano.
  const info = db.prepare(`
    UPDATE users SET email = lower(username)
    WHERE email IS NULL
      AND username LIKE '%@%'
      AND (SELECT COUNT(*) FROM users u2 WHERE lower(u2.username) = lower(users.username)) = 1
  `).run();
  console.log(`[migración] email: ${info.changes} usuario(s) con el correo copiado del nombre.`);
}

// UNIQUE no se puede agregar con ALTER TABLE —habría que recrear la tabla entera, que
// es donde se pierden filas—, así que la unicidad vive en un ÍNDICE.
//
// PARCIAL (`WHERE email IS NOT NULL`), y no un único normal: en SQLite los NULL no
// chocan entre sí ni en un índice común, así que para ESTO los dos servirían. Se
// declara parcial igual porque dice lo que se quiere decir —"los correos son únicos,
// las cuentas sin correo no son un caso"— y porque el índice no carga las filas sin
// email. Comprobado que el SQLite de node lo soporta: 3.50.2 en node 22, índice
// creado, tres NULL conviviendo y el duplicado rechazado.
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users(email) WHERE email IS NOT NULL');

export default db;
