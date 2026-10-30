import { foldForSearch } from './searchText.js';
import { readCache, fetchFresh } from '../api/viewCache.js';
import { loadAllTracks } from './libraryLoader.js';

// Pistas de cada VISTA de listado para el "Mix aleatorio" (Frente 2, sub-paso M2a).
//
// El Mix de Álbumes, Artistas, Géneros y Años mezcla las pistas de SU vista, no la biblioteca
// entera. Las cuatro salen de la biblioteca completa que Biblioteca ya deja en memoria
// (viewCache 'tracks:all', POR USUARIO: si cambió la cuenta, readCache la vacía y no devuelve
// nada). Si no está, se pide UNA vez con el mismo fetchFresh que usa Biblioteca, así queda
// cacheada para las dos. Con la lista en memoria, el clic del Mix no espera ningún request.
//
// STALE-WHILE-REVALIDATE (1.31.1): antes, con la lista en memoria no se volvía a pedir nunca, así
// que Años y los Mix seguían con la biblioteca vieja hasta pasar por Biblioteca o recargar. Ahora
// se responde igual de rápido con lo cacheado y, si lo cacheado tiene más de REVALIDATE_MS, se
// revalida en segundo plano:
//   · UNA sola petición en vuelo, compartida por todos los que llamen mientras tanto;
//   · a lo sumo una por ventana de REVALIDATE_MS, llegue bien o falle (no hay pedido por tecla);
//   · si lo que llega es distinto, se avisa a los suscriptores (onLibraryChange); si es idéntico,
//     no se avisa a nadie → cero re-renders.
// El contrato de libraryTracks() y de los cuatro filtros no cambió: devuelven una lista.
//
// Cada filtro es EXACTAMENTE el criterio con que el backend arma las tarjetas de esa vista (la
// unión de lo que abre cada tarjeta), sin reglas nuevas:
//   · Álbumes  → music-server/src/api/albums.js   `WHERE album IS NOT NULL`
//   · Artistas → music-server/src/api/browse.js   `WHERE album_artist IS NOT NULL AND album_artist <> ''`
//   · Géneros  → music-server/src/api/browse.js   `WHERE genre IS NOT NULL AND genre <> ''`
//   · Años     → music-server/src/api/browse.js   `WHERE year IS NOT NULL`
// Sin tope de pistas (1.33.0): la biblioteca se trae paginando hasta agotar (utils/libraryLoader.js),
// igual que la de Biblioteca.

// La MISMA clave que Library.jsx (LIB_CACHE_KEY): las dos vistas comparten la entrada.
const LIBRARY_KEY = 'tracks:all';
const REVALIDATE_MS = 30000;

let inflight = null;           // la petición en vuelo (compartida), o null
let lastTry = 0;               // cuándo arrancó la última: el tope de frecuencia vale también si falló
const listeners = new Set();   // a quién avisar cuando la biblioteca cacheada CAMBIA

// Suscribe `fn` a los cambios de la biblioteca en memoria. Devuelve la función para desuscribir.
// `fn` no recibe datos: quien la use vuelve a llamar a su filtro (ya responde con lo nuevo).
export function onLibraryChange(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function refresh() {
  if (inflight) return inflight;
  lastTry = Date.now();
  const before = readCache(LIBRARY_KEY)?.sig;
  inflight = fetchFresh(LIBRARY_KEY, () => loadAllTracks())
    .then((fresh) => {
      // Sólo si había algo antes y es distinto: la primera carga no es un "cambio".
      if (fresh && before !== undefined && fresh.sig !== before) listeners.forEach((fn) => fn());
      return fresh;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

// Revalida en segundo plano si lo cacheado ya es viejo y no se intentó en esta ventana. No espera
// ni propaga errores: si falla, se queda lo cacheado. La usa Años al escribir en su buscador.
export function refreshLibraryIfStale() {
  const cached = readCache(LIBRARY_KEY);
  if (!cached) return;
  const now = Date.now();
  if (now - (cached.at ?? 0) < REVALIDATE_MS || now - lastTry < REVALIDATE_MS) return;
  refresh().catch(() => {});
}

// Lo que YA hay en memoria de la biblioteca (o null), sin pedir nada ni revalidar: para pintar al
// instante en el primer render sin esperar a nadie (utils/useRecientes.js).
export const cachedLibrary = () => readCache(LIBRARY_KEY)?.data ?? null;

// Biblioteca completa del usuario actual. [] si la cuenta cambió mientras se pedía (fetchFresh
// descarta el resultado): el Mix no reproduce nada en vez de mezclar la lista de otra cuenta.
// Los errores de red se propagan (igual que el getTracks de antes).
export async function libraryTracks() {
  const cached = readCache(LIBRARY_KEY);
  if (cached) { refreshLibraryIfStale(); return cached.data; }
  // Sin caché: se espera la petición (la que ya esté en vuelo, o una nueva). Si la que estaba en
  // vuelo era de OTRA cuenta, fetchFresh la descarta (null): se pide una propia.
  const ajena = inflight;
  let fresh = await refresh();
  if (!fresh && ajena) fresh = await refresh();
  return fresh ? fresh.data : [];
}

const hasText = (v) => v != null && v !== '';

// ÍNDICES DE LA BIBLIOTECA (1.33.0). Se arman UNA vez por array de biblioteca y se guardan por
// IDENTIDAD (WeakMap): mientras la biblioteca en memoria sea el mismo array, todos reciben el mismo
// índice ya hecho; cuando una revalidación trae otra, el array es nuevo y el índice viejo se va con
// él. Antes cada montaje de Años volvía a plegar el texto de toda la biblioteca, y cada «Reproducir
// año» la recorría entera.
const memo = (build) => {
  const cache = new WeakMap();
  return (arr) => { let v = cache.get(arr); if (v === undefined) { v = build(arr); cache.set(arr, v); } return v; };
};
// Las pistas con año, en el orden de la biblioteca. Mismo array para la misma biblioteca: es la
// clave de los dos índices de abajo (y lo que hace que Años no recalcule nada si no cambió).
const withYear = memo((lib) => lib.filter((t) => t.year != null));
// año → sus pistas (en el orden de la biblioteca). Recibe el array de yearsViewTracks().
export const tracksByYear = memo((tracks) => {
  const m = new Map();
  for (const t of tracks) { const l = m.get(t.year); if (l) l.push(t); else m.set(t.year, [t]); }
  return m;
});
// [pista, texto plegado de álbum · artista del álbum · artista] para el buscador de Años. Recibe el
// array de yearsViewTracks(). El plegado es el de la búsqueda (sin mayúsculas ni acentos).
export const foldedYearTracks = memo((tracks) => tracks.map((t) => [t, foldForSearch(`${t.album ?? ''}\n${t.album_artist ?? ''}\n${t.artist ?? ''}`)]));

export const albumsViewTracks  = async () => (await libraryTracks()).filter((t) => t.album != null);
export const artistsViewTracks = async () => (await libraryTracks()).filter((t) => hasText(t.album_artist));
export const genresViewTracks  = async () => (await libraryTracks()).filter((t) => hasText(t.genre));
export const yearsViewTracks   = async () => withYear(await libraryTracks());
