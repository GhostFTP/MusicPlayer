import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dir, '../../data/music.db');

mkdirSync(join(__dir, '../../data'), { recursive: true });

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

export default db;
