import { api } from '../api/client.js';
import { yearsViewTracks } from './viewTracks.js';

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
export const artistTracks = (a) => api.tracks({ album_artist: a.artist, limit: 10000 });
// Mismo `limit` que usa Genres.open() al abrir el detalle → lo que se encola es exactamente lo que
// se ve al entrar al género, no otro conjunto. 10000 como artistas (hasta la 1.32.0 era 500 y un
// género con más pistas se reproducía cortado, sin aviso).
export const genreTracks  = (g) => api.tracks({ genre: g.genre, limit: 10000 });
// Las pistas de un AÑO salen de la biblioteca en memoria (viewTracks: la misma que usan el buscador
// y el Mix de Años, con su revalidación en segundo plano), no de un pedido por año: con la
// biblioteca ya cargada no hay request, y el orden es el del servidor (artista, álbum, nº de pista),
// el mismo de GET /api/tracks?year=. Siempre el año COMPLETO, haya o no texto en el buscador.
export const yearTracks   = async (y) => (await yearsViewTracks()).filter((t) => t.year === y.year);
