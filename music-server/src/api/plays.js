import { Router } from 'express';
import db from '../db/database.js';
import { authMiddleware } from '../auth/jwt.js';

const router = Router();
router.use(authMiddleware);

// Tope de un envío. La app encola en disco mientras no hay red, así que una vuelta
// larga sin señal puede juntar cientos; 500 es holgado para eso y frena a un
// cliente descontrolado. Lo que sobra se manda en el siguiente envío.
const MAX_PLAYS = 500;

// Cuántas filas devuelven los rankings por defecto y como máximo.
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

// ---- POST /api/plays  —  { plays: [{ track_id, played_at, ms_played?, client_id }] }
//
// SIEMPRE por lote, incluso para una sola. La app registra en disco y envía lo que
// tenga acumulado, así que el caso normal es "una" y el caso del auto sin señal es
// "ochenta" — y son la misma petición. (Diseñado bulk desde el día uno; el alta de
// canciones en playlists nació singular y costó un frente entero corregirlo.)
router.post('/', (req, res) => {
  const body = req.body ?? {};
  const list = Array.isArray(body.plays) ? body.plays : null;
  if (!list) return res.status(400).json({ error: 'plays[] required' });
  if (!list.length) return res.status(201).json({ added: 0, already: 0, skipped: 0 });
  if (list.length > MAX_PLAYS) return res.status(413).json({ error: `too many plays (max ${MAX_PLAYS})` });

  const insert = db.prepare(
    'INSERT OR IGNORE INTO plays (user_id, track_id, played_at, ms_played, client_id) VALUES (?, ?, ?, ?, ?)'
  );

  let added = 0, already = 0, skipped = 0;
  db.exec('BEGIN');
  try {
    for (const p of list) {
      const trackId = Number(p?.track_id);
      const playedAt = Number(p?.played_at);
      const clientId = typeof p?.client_id === 'string' ? p.client_id.trim() : '';
      // Una fila inválida no puede tumbar el envío entero: el resto del lote es
      // escucha real y perderla sería peor que descartar la mala.
      if (!Number.isInteger(trackId) || !Number.isFinite(playedAt) || !clientId) { skipped++; continue; }
      const ms = Number(p?.ms_played);
      try {
        const r = insert.run(
          req.user.id, trackId, Math.round(playedAt),
          Number.isFinite(ms) && ms >= 0 ? Math.round(ms) : null,
          clientId,
        );
        // changes === 0 → el client_id ya estaba: es un reintento de algo que ya
        // habíamos guardado, no un error.
        if (r.changes) added++; else already++;
      } catch {
        // FK rota: la pista ya no existe (un rescan la borró y el cliente manda su
        // cola vieja). ⚠️ `INSERT OR IGNORE` NO cubre esto — el ON CONFLICT de
        // SQLite aplica a UNIQUE, NOT NULL, CHECK y PRIMARY KEY, no a FOREIGN KEY.
        // Sin este catch, una pista borrada aborta el lote entero para siempre: la
        // app reintentaría el mismo envío en cada arranque y nunca vaciaría su cola.
        skipped++;
      }
    }
    db.exec('COMMIT');
  } catch {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'could not record plays' });
  }

  res.status(201).json({ added, already, skipped });
});

// `since` en epoch ms; sin él, todo el historial. Es lo que separa "lo más
// escuchado" de "lo más escuchado este año" sin dos endpoints.
function sinceClause(req) {
  const since = Number(req.query.since);
  return Number.isFinite(since) ? { sql: ' AND p.played_at >= ?', val: [Math.round(since)] } : { sql: '', val: [] };
}

function limitOf(req) {
  const n = Number(req.query.limit);
  return Number.isFinite(n) ? Math.min(Math.max(1, Math.round(n)), MAX_LIMIT) : DEFAULT_LIMIT;
}

// ---- GET /api/plays/top?type=tracks|artists|albums&since=&limit=
//
// El agregado se hace ACÁ y no en el cliente porque los plays crecen sin techo —a
// diferencia de la biblioteca, que son ~1000 filas fijas—, y mandarlos todos para
// contarlos del otro lado empeora con cada mes de uso.
//
// Se agrupa por `album_artist` y no por `artist`, la misma regla que el resto del
// proyecto: si no, un feat parte al artista en dos y Various Artists se desmenuza.
router.get('/top', (req, res) => {
  const type = String(req.query.type ?? 'tracks');
  const { sql: sinceSql, val: sinceVal } = sinceClause(req);
  const limit = limitOf(req);

  const base = `FROM plays p JOIN tracks t ON t.id = p.track_id WHERE p.user_id = ?${sinceSql}`;
  const params = [req.user.id, ...sinceVal, limit];

  if (type === 'artists') {
    return res.json(db.prepare(`
      SELECT t.album_artist AS artist, COUNT(*) AS plays, SUM(COALESCE(p.ms_played, 0)) AS ms_played
      ${base} AND t.album_artist IS NOT NULL AND t.album_artist <> ''
      GROUP BY t.album_artist ORDER BY plays DESC, artist COLLATE NOCASE LIMIT ?
    `).all(...params));
  }

  if (type === 'albums') {
    return res.json(db.prepare(`
      SELECT t.album, t.album_artist, COUNT(*) AS plays, SUM(COALESCE(p.ms_played, 0)) AS ms_played,
             MIN(CASE WHEN t.cover_path IS NOT NULL THEN t.id END) AS sample_track_id
      ${base} AND t.album IS NOT NULL
      GROUP BY t.album, t.album_artist ORDER BY plays DESC, t.album COLLATE NOCASE LIMIT ?
    `).all(...params));
  }

  // tracks (default). Devuelve la pista entera para que el cliente la pinte sin
  // una segunda consulta — los mismos campos que /api/tracks.
  res.json(db.prepare(`
    SELECT t.id, t.title, t.artist, t.album, t.album_artist, t.genre, t.year, t.track_number,
           t.disc_number, t.duration, t.cover_path, t.codec, t.bits_per_sample, t.sample_rate,
           t.bitrate, t.lossless,
           COUNT(*) AS plays, SUM(COALESCE(p.ms_played, 0)) AS ms_played, MAX(p.played_at) AS last_played
    ${base}
    GROUP BY t.id ORDER BY plays DESC, last_played DESC LIMIT ?
  `).all(...params));
});

// ---- GET /api/plays/stats?since=
//
// Los totales del período: lo que necesita un resumen anual sin traerse las filas.
router.get('/stats', (req, res) => {
  const { sql: sinceSql, val: sinceVal } = sinceClause(req);
  res.json(db.prepare(`
    SELECT COUNT(*)                      AS plays,
           SUM(COALESCE(p.ms_played, 0)) AS ms_played,
           COUNT(DISTINCT p.track_id)    AS tracks,
           COUNT(DISTINCT t.album_artist) AS artists,
           COUNT(DISTINCT t.album)       AS albums,
           MIN(p.played_at)              AS first_play,
           MAX(p.played_at)              AS last_play
    FROM plays p JOIN tracks t ON t.id = p.track_id
    WHERE p.user_id = ?${sinceSql}
  `).get(req.user.id, ...sinceVal));
});

export default router;
