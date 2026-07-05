// Fallback de letras vía LRCLIB (lrclib.net) para pistas SIN .lrc local.
// API pública sin key; nos identificamos con User-Agent propio (misma cortesía
// que con MusicBrainz en info.js).
// - Solo se acepta letra SINCRONIZADA (syncedLyrics) con duración compatible
//   (±5s): una plainLyrics suelta rompía el layout karaoke, y un match con otra
//   duración era la versión equivocada (p.ej. la cantada para un instrumental).
// - Pistas con "instrumental" en el título ni se consultan.
// - Caché en memoria 24h, positiva Y negativa (descartes incluidos: si no hay
//   letra válida, no se re-pide en cada apertura del panel).
// - Los fallos de red/servicio se cachean solo 10 min: si LRCLIB estaba caído,
//   se reintenta pronto sin martillarlo mientras tanto.

const UA      = 'SonoraRev/1.0 ( https://sonorarev.com )';
const TTL_OK  = 24 * 60 * 60 * 1000;   // respuesta definitiva (con o sin letra)
const TTL_ERR = 10 * 60 * 1000;        // servicio caído / timeout

const cache = new Map();   // trackId -> { at, ttl, value }

function getCached(id) {
  const hit = cache.get(id);
  if (!hit) return undefined;
  if (Date.now() - hit.at > hit.ttl) { cache.delete(id); return undefined; }
  return hit.value;   // puede ser null (caché negativa)
}

// Busca la letra de la pista por su firma (artista + título + álbum + duración,
// GET /api/get). Devuelve { instrumental, synced, lyrics } o null (sin letra
// válida / servicio caído).
export async function lrclibLyrics(track) {
  // Versión instrumental (según el título): no hay letra que buscar — consultar
  // devolvía la letra de la versión CANTADA. Chequeo barato, sin pasar por caché.
  if (/instrumental/i.test(track.title ?? '')) return null;

  const cached = getCached(track.id);
  if (cached !== undefined) return cached;

  const params = new URLSearchParams({
    artist_name: track.artist ?? '',
    track_name:  track.title ?? '',
  });
  if (track.album) params.set('album_name', track.album);
  if (track.duration) params.set('duration', String(Math.round(track.duration)));

  let value = null;
  let ttl = TTL_OK;
  try {
    const resp = await fetch(`https://lrclib.net/api/get?${params}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (resp.ok) {
      const d = await resp.json();
      // Duración del match vs la pista local: si difiere >5s es OTRA versión
      // (radio edit, en vivo, la cantada de un instrumental…) → descartar.
      const durOk = !(track.duration && d?.duration)
        || Math.abs(d.duration - track.duration) <= 5;
      // Solo letra sincronizada y no instrumental; plainLyrics suelta se
      // descarta (mejor "sin letra" que el karaoke a medias). Todo descarte
      // queda en caché negativa 24h.
      if (durOk && !d?.instrumental && d?.syncedLyrics) {
        value = { instrumental: false, synced: true, lyrics: d.syncedLyrics };
      }
    } else if (resp.status !== 404) {
      ttl = TTL_ERR;   // 5xx / rate limit: no castigar 24h
    }
    // 404 = LRCLIB no la tiene → null con caché negativa de 24h
  } catch {
    ttl = TTL_ERR;     // red caída o timeout → reintentar en 10 min
  }

  cache.set(track.id, { at: Date.now(), ttl, value });
  return value;
}
