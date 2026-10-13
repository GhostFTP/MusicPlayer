import { api } from '../api/client.js';
import { yearsViewTracks, tracksByYear } from './viewTracks.js';
import { loadAllTracks } from './libraryLoader.js';

// Pistas de un álbum / de un artista / de un género, con los MISMOS parámetros que ya usan las
// vistas (Albums.openAlbum, el ShuffleButton del hero de Artistas, Genres.open) → el orden que se
// encola es el mismo que se ve en pantalla.
//
// Viven acá y no en ContextMenu.jsx porque desde la fase (b) de drag-to-enqueue tienen DOS
// consumidores: el menú contextual ("reproducir álbum" / "agregar a la cola") y el drop de la cola.
// Son la misma pregunta hecha por dos puertas distintas — copiarlas era garantizar que un día una
// de las dos encolara un conjunto distinto del que muestra la vista.
//
// Filtrar el álbum por album_artist desambigua los homónimos.
export const albumTracks  = (a) => api.tracks({ album: a.album, limit: 500, ...(a.album_artist ? { album_artist: a.album_artist } : {}) });
// Artista y género: sin tope (1.33.0), paginando con el cargador único. El álbum conserva su
// `limit: 500` propio: es UN pedido chico y un álbum de más de 500 pistas no es un caso real.
export const artistTracks = (a) => loadAllTracks({ params: { album_artist: a.artist } });
// El mismo pedido que hace Genres.open() al abrir el detalle → lo que se encola es exactamente lo
// que se ve al entrar al género, no otro conjunto.
export const genreTracks  = (g) => loadAllTracks({ params: { genre: g.genre } });
// Las pistas de un AÑO salen de la biblioteca en memoria (viewTracks: la misma que usan el buscador
// y el Mix de Años, con su revalidación en segundo plano), no de un pedido por año: con la
// biblioteca ya cargada no hay request, y el orden es el del servidor (artista, álbum, nº de pista),
// el mismo de GET /api/tracks?year=. Siempre el año COMPLETO, haya o no texto en el buscador.
// Desde la 1.33.0 sale del índice año → pistas (viewTracks.tracksByYear), armado una vez por
// biblioteca. Se devuelve una COPIA: el array del índice es compartido.
export const yearTracks   = async (y) => (tracksByYear(await yearsViewTracks()).get(y.year) ?? []).slice();
