import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { readCache, fetchFresh } from '../api/viewCache.js';

// La lista de videos (GET /api/videos), pedida y COMPARTIDA (1.36.0). La leen la vista Videos y la
// página del artista (su sección «Videos»); antes Videos la pedía en cada montaje y la guardaba en
// su propio estado. Mismo patrón que useLibraryArtists (utils/artistMatch.js): viewCache (en memoria
// y por usuario), una sola petición en vuelo aunque la pidan dos a la vez, y suscriptores.
//
// Stale-while-revalidate: con algo en la caché se pinta al instante y se vuelve a pedir en segundo
// plano; si llegó algo nuevo, aparece al llegar. Nada la pide al arrancar la app: sólo quien la monta
// con `enabled` (Videos siempre; el artista sólo con un detalle abierto).
//
// Devuelve { videos, error, reload }: `videos` es null mientras no se sabe; `error` sólo cuenta
// cuando no hay nada que mostrar (una revalidación fallida deja lo cacheado en pantalla).
const KEY = 'videos:list';
let inflight = null;
const subs = new Set();

function load() {
  inflight ??= fetchFresh(KEY, () => api.videos())
    .then((entry) => { subs.forEach((fn) => fn(null)); return entry; })
    .catch((e) => { subs.forEach((fn) => fn(e)); throw e; })
    .finally(() => { inflight = null; });
  return inflight;
}

const listOf = (entry) => (entry ? (Array.isArray(entry.data?.videos) ? entry.data.videos : []) : null);

export function useVideoList(enabled = true) {
  const [videos, setVideos] = useState(() => (enabled ? listOf(readCache(KEY)) : null));
  const [error, setError]   = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const sync = (err) => {
      if (!alive) return;
      const list = listOf(readCache(KEY));
      if (list) { setVideos(list); setError(null); }
      else if (err) setError(err);
    };
    subs.add(sync);
    sync(null);
    load().catch(() => {});           // el error ya llegó por `sync`
    return () => { alive = false; subs.delete(sync); };
  }, [enabled]);

  const reload = useCallback(() => { setError(null); load().catch(() => {}); }, []);
  return enabled ? { videos, error, reload } : { videos: null, error: null, reload };
}
