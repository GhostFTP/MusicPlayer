import { api } from '../api/client.js';
import { readCache, fetchFresh } from '../api/viewCache.js';

// Pistas de cada VISTA de listado para el "Mix aleatorio" (Frente 2, sub-paso M2a).
//
// El Mix de Álbumes, Artistas, Géneros y Años mezcla las pistas de SU vista, no la biblioteca
// entera. Las cuatro salen de la biblioteca completa que Biblioteca ya deja en memoria
// (viewCache 'tracks:all', POR USUARIO: si cambió la cuenta, readCache la vacía y no devuelve
// nada). Si no está, se pide UNA vez con el mismo fetchFresh que usa Biblioteca, así queda
// cacheada para las dos. Con la lista en memoria, el clic del Mix no hace ningún request.
//
// Cada filtro es EXACTAMENTE el criterio con que el backend arma las tarjetas de esa vista (la
// unión de lo que abre cada tarjeta), sin reglas nuevas:
//   · Álbumes  → music-server/src/api/albums.js   `WHERE album IS NOT NULL`
//   · Artistas → music-server/src/api/browse.js   `WHERE album_artist IS NOT NULL AND album_artist <> ''`
//   · Géneros  → music-server/src/api/browse.js   `WHERE genre IS NOT NULL AND genre <> ''`
//   · Años     → music-server/src/api/browse.js   `WHERE year IS NOT NULL`
// Mismo tope que Biblioteca (limit 10000).

// La MISMA clave que Library.jsx (LIB_CACHE_KEY): las dos vistas comparten la entrada.
const LIBRARY_KEY = 'tracks:all';

// Biblioteca completa del usuario actual. [] si la cuenta cambió mientras se pedía (fetchFresh
// descarta el resultado): el Mix no reproduce nada en vez de mezclar la lista de otra cuenta.
// Los errores de red se propagan (igual que el getTracks de antes).
export async function libraryTracks() {
  const cached = readCache(LIBRARY_KEY);
  if (cached) return cached.data;
  const fresh = await fetchFresh(LIBRARY_KEY, () => api.tracks({ limit: 10000 }));
  return fresh ? fresh.data : [];
}

const hasText = (v) => v != null && v !== '';

export const albumsViewTracks  = async () => (await libraryTracks()).filter((t) => t.album != null);
export const artistsViewTracks = async () => (await libraryTracks()).filter((t) => hasText(t.album_artist));
export const genresViewTracks  = async () => (await libraryTracks()).filter((t) => hasText(t.genre));
export const yearsViewTracks   = async () => (await libraryTracks()).filter((t) => t.year != null);
