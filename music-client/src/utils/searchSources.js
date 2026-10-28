import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { readCache, fetchFresh } from '../api/viewCache.js';
import { libraryTracks, onLibraryChange } from './viewTracks.js';
import { byArtistTitle } from '../components/VideoCard.jsx';

// LAS CINCO LISTAS QUE ALIMENTAN A /search. Ninguna es nueva: cada una sale de la MISMA entrada de
// viewCache (api/viewCache.js, en memoria y por usuario) que ya llena la vista de su nombre, así que
// con la caché tibia la vista pinta al instante y no pide nada de más. Con la caché fría usa el MISMO
// cargador que esa vista:
//   songs     'tracks:all'   libraryTracks()   (utils/viewTracks.js: la biblioteca completa, paginada)
//   albums    'albums:list'  api.albums()      (Albums.jsx)
//   artists   'artists:list' api.artists()     (utils/artistMatch.js)
//   videos    'videos:list'  api.videos()      (utils/videoList.js; su entrada guarda { videos })
//   playlists 'playlists:list' api.playlists() (Playlists.jsx NO la cachea: esta entrada es sólo de la
//                                               búsqueda, para que volver con el atrás pinte al instante)
// Stale-while-revalidate: se pinta lo cacheado y se revalida en segundo plano al montar. Si lo que llega
// es idéntico (misma firma) no se toca el estado → el índice de búsqueda de esa lista no se rehace.
// Cada fuente informa su estado ('loading' | 'ready' | 'error'): una que no cargó NO tumba a las demás
// (la vista muestra lo que sí hay y avisa de la que falta, con Reintentar).
const SOURCES = {
  songs: {
    key: 'tracks:all',
    // libraryTracks() ya comparte la petición en vuelo y sólo revalida si lo cacheado es viejo.
    load: async () => { const data = await libraryTracks(); return readCache('tracks:all') ?? { data, sig: null }; },
    select: (d) => d,
  },
  albums:    { key: 'albums:list',    load: () => fetchFresh('albums:list',    () => api.albums()),    select: (d) => d },
  artists:   { key: 'artists:list',   load: () => fetchFresh('artists:list',   () => api.artists()),   select: (d) => d },
  playlists: { key: 'playlists:list', load: () => fetchFresh('playlists:list', () => api.playlists()), select: (d) => d },
  videos: {
    key: 'videos:list',
    load: () => fetchFresh('videos:list', () => api.videos()),
    // Como la vista Videos: artista A→Z y después título, y cada ítem con kind:'video' (el motor usa el <video>).
    select: (d) => [...(Array.isArray(d?.videos) ? d.videos : [])].sort(byArtistTitle).map((v) => ({ ...v, kind: 'video' })),
  },
};

function useSource(name) {
  const spec = SOURCES[name];
  const [st, setSt] = useState(() => {
    const c = readCache(spec.key);
    return c ? { data: c.data, sig: c.sig, status: 'ready' } : { data: null, sig: null, status: 'loading' };
  });
  const sigRef = useRef(st.sig);
  sigRef.current = st.sig;

  const load = useCallback(() => {
    let alive = true;
    spec.load()
      .then((entry) => {
        if (!alive || !entry) return;   // desmontada, o cambió la cuenta mientras la petición estaba en vuelo
        if (entry.sig != null && entry.sig === sigRef.current) { setSt((s) => (s.status === 'ready' ? s : { ...s, status: 'ready' })); return; }
        setSt({ data: entry.data, sig: entry.sig, status: 'ready' });
      })
      // Con algo ya en pantalla, una revalidación fallida deja lo cacheado; sin nada, es un error.
      .catch(() => { if (alive) setSt((s) => (s.data != null ? s : { data: null, sig: null, status: 'error' })); });
    return () => { alive = false; };
  }, [spec]);

  useEffect(() => load(), [load]);

  // La biblioteca cambió en segundo plano (otra pestaña de la app, un escaneo): releer la caché.
  useEffect(() => {
    if (name !== 'songs') return undefined;
    return onLibraryChange(() => {
      const c = readCache(spec.key);
      if (c) setSt({ data: c.data, sig: c.sig, status: 'ready' });
    });
  }, [name, spec]);

  const reload = useCallback(() => { setSt((s) => (s.data != null ? s : { ...s, status: 'loading' })); load(); }, [load]);
  // `select` arma un array nuevo (videos): memoizado por los datos, así el índice de búsqueda lo reconoce.
  const list = useMemo(() => (st.data == null ? null : spec.select(st.data)), [st.data, spec]);
  return { list, status: st.status, reload };
}

export function useSearchSources() {
  const songs = useSource('songs');
  const albums = useSource('albums');
  const artists = useSource('artists');
  const playlists = useSource('playlists');
  const videos = useSource('videos');
  return { songs, albums, artists, playlists, videos };
}
