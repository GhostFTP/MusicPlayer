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

// ---- GET /api/plays/resumen?since=&until=&tz=&limit=  (1.22.0)
//
// TODO lo que necesita el "Resumen del año" de la app en UNA llamada, para el usuario de
// la sesión y nada más: no hay parámetro de usuario, y cada consulta filtra por
// `p.user_id = ?` con `req.user.id`. Solo lee: ni escribe ni cambia el esquema.
//
// El rango es [since, until): since incluido, until excluido, en epoch ms. `tz` son los
// minutos al ESTE de UTC (Querétaro, UTC−6: -360) y solo sirve para lo LOCAL —hora, día
// de la semana, día y mes—: `played_at` es un instante (lo pone el dispositivo) y la tabla
// no guarda zona horaria.
//
// ⚠️ LOS MINUTOS SALEN DE LA DURACIÓN DE LA PISTA, NO DE `plays.ms_played`. La app manda
// `ms_played` en el instante en que la reproducción CUENTA (la mitad de la pista o 4 min,
// lo que pase primero), no al terminar: sumarlo daría más o menos la mitad de lo escuchado.
// `ms_estimados` = la duración de la pista (tracks.duration, en SEGUNDOS, REAL) × 1000 por
// cada reproducción contada. Una pista sin duración (null o 0) cuenta como reproducción y
// suma 0 ms.
//
// Ocho consultas, todas sobre idx_plays_user_time salvo `nuevas`, que necesita la primera
// reproducción de cada pista en TODA la historia y va por idx_plays_user_track. La hora,
// el día de la semana, el mes y los días salen de UNA sola consulta agrupada por (día,
// hora) locales y se reparten acá.

const TZ_MAX = 840;                 // UTC+14 / UTC−14: los husos que existen
const RESUMEN_LIMIT = 10;
const RESUMEN_LIMIT_MAX = 50;
const RESUMEN_DIAS_MAX = 3700;      // ~10 años de días con escucha; si sobran, van los más recientes
const RESUMEN_LISTA_MAX = 500;      // géneros y años: tope de seguridad, no de diseño
const HASTA_MAX = 8.64e15;          // el máximo de un Date de JS

// Un entero de la query string, o { vacio } si viene vacío o ausente. Solo dígitos (con
// signo si se permite): "1e3", "12.5", " 3" o "abc" no son enteros válidos.
function enteroDeQuery(v, { signo = false } = {}) {
  if (v == null || v === '') return { vacio: true };
  if (typeof v !== 'string' || !(signo ? /^-?\d{1,16}$/ : /^\d{1,16}$/).test(v)) return { error: true };
  return { valor: Number(v) };
}

// Valida y acota. Devuelve { error } (para un 400) o los valores listos.
function paramsResumen(query, ahora) {
  const s = enteroDeQuery(query.since);
  if (s.error) return { error: 'invalid since' };
  const since = s.vacio ? 0 : s.valor;

  const u = enteroDeQuery(query.until);
  if (u.error) return { error: 'invalid until' };
  const until = u.vacio ? ahora : u.valor;
  if (since > HASTA_MAX || until > HASTA_MAX) return { error: 'since/until out of range' };
  if (until <= since) return { error: 'until must be greater than since' };

  const t = enteroDeQuery(query.tz, { signo: true });
  if (t.error) return { error: 'invalid tz' };
  const tz = t.vacio ? 0 : t.valor;
  if (tz < -TZ_MAX || tz > TZ_MAX) return { error: `tz out of range (-${TZ_MAX}..${TZ_MAX})` };

  // limit: lo que no es un entero ≥ 1 es un error (400); lo que pasa del máximo se ACOTA
  // a 50, igual que /top acota el suyo. Un número grande no es un pedido mal hecho, es
  // "dame todo lo que puedas".
  const l = enteroDeQuery(query.limit);
  if (l.error || (!l.vacio && l.valor < 1)) return { error: 'invalid limit' };
  const limit = l.vacio ? RESUMEN_LIMIT : Math.min(l.valor, RESUMEN_LIMIT_MAX);

  return { since, until, tz, limit };
}

// Duración de la pista en ms por cada reproducción. Sin duración (null, 0 o negativa), 0.
const MS_ESTIMADOS = 'CAST(ROUND(SUM(CASE WHEN t.duration > 0 THEN t.duration * 1000 ELSE 0 END)) AS INTEGER)';

router.get('/resumen', (req, res) => {
  const p = paramsResumen(req.query ?? {}, Date.now());
  if (p.error) return res.status(400).json({ error: p.error });
  const { since, until, tz, limit } = p;

  const where = 'FROM plays p JOIN tracks t ON t.id = p.track_id WHERE p.user_id = ? AND p.played_at >= ? AND p.played_at < ?';
  const rango = [req.user.id, since, until];

  // 1. Totales. Los álbumes distintos cuentan (álbum, album_artist), como top_albumes: dos
  //    álbumes con el mismo nombre y distinto artista son dos.
  const tot = db.prepare(`
    SELECT COUNT(*)                         AS reproducciones,
           COUNT(DISTINCT p.track_id)       AS canciones_distintas,
           COUNT(DISTINCT CASE WHEN t.album_artist IS NOT NULL AND t.album_artist <> '' THEN t.album_artist END) AS artistas_distintos,
           COUNT(DISTINCT CASE WHEN t.album IS NOT NULL THEN t.album || char(0) || COALESCE(t.album_artist, '') END) AS albumes_distintos,
           ${MS_ESTIMADOS}                  AS ms_estimados,
           MIN(p.played_at)                 AS primera,
           MAX(p.played_at)                 AS ultima
    ${where}
  `).get(...rango);

  // 2. Canciones. Empates: más reproducciones, luego la más reciente, luego el id.
  const topCanciones = db.prepare(`
    SELECT t.id, t.title, t.artist, t.album, t.album_artist,
           COUNT(*) AS plays, ${MS_ESTIMADOS} AS ms_estimados, MAX(p.played_at) AS ultima
    ${where}
    GROUP BY t.id
    ORDER BY plays DESC, ultima DESC, t.id ASC
    LIMIT ?
  `).all(...rango, limit);

  // 3. Artistas: por album_artist, la misma regla que /top (si no, un feat parte al artista
  //    en dos y Various Artists se desmenuza). Las pistas sin album_artist no entran.
  const topArtistas = db.prepare(`
    SELECT t.album_artist AS artist, COUNT(*) AS plays, ${MS_ESTIMADOS} AS ms_estimados,
           COUNT(DISTINCT p.track_id) AS canciones, MAX(p.played_at) AS ultima
    ${where} AND t.album_artist IS NOT NULL AND t.album_artist <> ''
    GROUP BY t.album_artist
    ORDER BY plays DESC, ultima DESC, t.album_artist COLLATE NOCASE ASC, t.album_artist ASC
    LIMIT ?
  `).all(...rango, limit).map(({ ultima, ...r }) => r);

  // 4. Álbumes. `id_de_una_pista`, para la carátula: una con carátula si hay (como
  //    `sample_track_id` de /top), y si ninguna tiene, la de id más bajo.
  const topAlbumes = db.prepare(`
    SELECT t.album, t.album_artist, COUNT(*) AS plays, ${MS_ESTIMADOS} AS ms_estimados,
           COALESCE(MIN(CASE WHEN t.cover_path IS NOT NULL THEN t.id END), MIN(t.id)) AS id_de_una_pista,
           MAX(p.played_at) AS ultima
    ${where} AND t.album IS NOT NULL
    GROUP BY t.album, t.album_artist
    ORDER BY plays DESC, ultima DESC, t.album COLLATE NOCASE ASC, t.album ASC, COALESCE(t.album_artist, '') ASC
    LIMIT ?
  `).all(...rango, limit).map(({ ultima, ...r }) => r);

  // 5. Géneros, CRUDOS: el texto de tracks.genre tal cual, y null si no tiene. La app los
  //    normaliza y los divide (acá no se toca el texto).
  const generos = db.prepare(`
    SELECT t.genre AS genero, COUNT(*) AS plays, ${MS_ESTIMADOS} AS ms_estimados
    ${where}
    GROUP BY t.genre
    ORDER BY plays DESC, (t.genre IS NULL) ASC, t.genre ASC
    LIMIT ${RESUMEN_LISTA_MAX}
  `).all(...rango);

  // 6. Años, crudos (la app arma las décadas). Del más viejo al más nuevo, null al final.
  const anios = db.prepare(`
    SELECT t.year AS anio, COUNT(*) AS plays
    ${where}
    GROUP BY t.year
    ORDER BY (t.year IS NULL) ASC, t.year ASC
    LIMIT ${RESUMEN_LISTA_MAX}
  `).all(...rango);

  // 7. Día y hora LOCALES en UNA consulta; de acá salen por_hora, por_dia_semana, por_mes y
  //    dias. El desplazamiento va enlazado (?), en segundos, dentro del strftime.
  //    `played_at / 1000` es división ENTERA en SQLite (las dos son enteras): el segundo.
  const offset = tz * 60;
  const celdas = db.prepare(`
    SELECT strftime('%Y-%m-%d', p.played_at / 1000 + ?, 'unixepoch') AS dia,
           CAST(strftime('%H', p.played_at / 1000 + ?, 'unixepoch') AS INTEGER) AS hora,
           COUNT(*) AS plays, ${MS_ESTIMADOS} AS ms_estimados
    ${where}
    GROUP BY dia, hora
  `).all(offset, offset, ...rango);

  const porHora = new Array(24).fill(0);
  const porDiaSemana = new Array(7).fill(0);
  const meses = new Map();
  const diasMap = new Map();
  for (const c of celdas) {
    if (typeof c.dia !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(c.dia)) continue;
    if (Number.isInteger(c.hora) && c.hora >= 0 && c.hora < 24) porHora[c.hora] += c.plays;
    const [y, m, d] = c.dia.split('-').map(Number);
    porDiaSemana[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] += c.plays;  // 0 = domingo
    const mes = c.dia.slice(0, 7);
    const mm = meses.get(mes) ?? { mes, plays: 0, ms_estimados: 0 };
    mm.plays += c.plays;
    mm.ms_estimados += c.ms_estimados ?? 0;
    meses.set(mes, mm);
    diasMap.set(c.dia, (diasMap.get(c.dia) ?? 0) + c.plays);
  }
  const porMes = [...meses.values()].sort((a, b) => (a.mes < b.mes ? -1 : 1));
  // Ascendente; si pasan del tope, se quedan los MÁS RECIENTES (lo que pinta un calendario).
  const dias = [...diasMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(-RESUMEN_DIAS_MAX)
    .map(([dia, plays]) => ({ dia, plays }));

  // 8. Nuevas: pistas cuya PRIMERA reproducción de este usuario —en toda su historia, no
  //    solo en el periodo— cae dentro de [since, until).
  const fila = db.prepare(`
    SELECT COUNT(*) AS nuevas FROM (
      SELECT MIN(played_at) AS primera FROM plays WHERE user_id = ? GROUP BY track_id
    ) WHERE primera >= ? AND primera < ?
  `).get(req.user.id, since, until);

  res.json({
    version: 1,
    desde: since,
    hasta: until,
    tz,
    totales: {
      reproducciones: tot?.reproducciones ?? 0,
      canciones_distintas: tot?.canciones_distintas ?? 0,
      artistas_distintos: tot?.artistas_distintos ?? 0,
      albumes_distintos: tot?.albumes_distintos ?? 0,
      ms_estimados: tot?.ms_estimados ?? 0,
      primera: tot?.primera ?? null,
      ultima: tot?.ultima ?? null,
    },
    top_canciones: topCanciones,
    top_artistas: topArtistas,
    top_albumes: topAlbumes,
    generos,
    anios,
    por_hora: porHora,
    por_dia_semana: porDiaSemana,
    por_mes: porMes,
    dias,
    nuevas: fila?.nuevas ?? 0,
  });
});

export default router;
