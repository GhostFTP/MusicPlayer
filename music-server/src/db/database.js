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

  CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
  CREATE INDEX IF NOT EXISTS idx_tracks_album  ON tracks(album);
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
