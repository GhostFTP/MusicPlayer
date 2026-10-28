import { foldForSearch } from './searchText.js';

// BÚSQUEDA EN TODA LA MÚSICA (vista /search). Lógica PURA: sin React ni red, así se razona (y se mide)
// aparte. Mismo criterio que el buscador de cada listado (utils/searchText.js + utils/useListFilter.js):
// subcadena, sin distinguir mayúsculas ni acentos, campos separados por "\n" para que una consulta no
// coincida "cruzando" dos campos, y el texto buscable de cada ítem se calcula UNA vez por lista.
//
// Cinco grupos, cada uno con los campos donde busca el listado de SU vista:
//   songs     título · artista · álbum           (Biblioteca)
//   albums    álbum · artista del álbum          (Álbumes)
//   artists   artista                            (Artistas)
//   playlists nombre                             (Playlists)
//   videos    artista · título                   (Videos)
export const GROUPS = ['songs', 'albums', 'artists', 'playlists', 'videos'];
export const TITLES = { songs: 'Canciones', albums: 'Álbumes', artists: 'Artistas', playlists: 'Playlists', videos: 'Videos' };

// Cuántos se ven de cada grupo antes de «Ver todo». Un grupo no tapa a los demás: el límite es por
// grupo y cuenta lo que ENTRA en una pantalla (las tarjetas grandes —artistas— son menos que las filas).
export const LIMITS = { songs: 8, albums: 8, artists: 6, playlists: 6, videos: 6 };
// «Ver todo» no monta más que esto: con una consulta de una letra coinciden miles de pistas y esta
// vista no está ventaneada (la Biblioteca sí). Pasado el tope se avisa y se afina escribiendo más.
export const EXPANDED_MAX = 100;

const SPEC = {
  songs:     { text: (t) => `${t.title ?? ''}\n${t.artist ?? ''}\n${t.album ?? ''}`, primary: (t) => [t.title] },
  albums:    { text: (a) => `${a.album ?? ''}\n${a.album_artist ?? ''}`,             primary: (a) => [a.album] },
  artists:   { text: (a) => `${a.artist ?? ''}`,                                      primary: (a) => [a.artist] },
  playlists: { text: (p) => `${p.name ?? ''}`,                                        primary: (p) => [p.name] },
  videos:    { text: (v) => `${v.artist ?? ''}\n${v.title ?? ''}`,                    primary: (v) => [v.artist, v.title] },
};

// Índice por IDENTIDAD de la lista (WeakMap, como los de utils/viewTracks.js): mientras la lista en
// memoria sea el mismo array, todos reciben el índice ya hecho; una revalidación que trae otro array
// lo reemplaza y el viejo se va con él. `hay` = texto plegado de todos los campos; `prim` = el plegado
// de los campos PRINCIPALES, que son los que deciden la relevancia.
const indexes = Object.fromEntries(GROUPS.map((g) => [g, new WeakMap()]));
function indexFor(group, list) {
  let idx = indexes[group].get(list);
  if (!idx) {
    const s = SPEC[group];
    idx = list.map((it) => ({ hay: foldForSearch(s.text(it)), prim: s.primary(it).map(foldForSearch) }));
    indexes[group].set(list, idx);
  }
  return idx;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Los ítems de `list` que coinciden con `query`, ordenados por RELEVANCIA (y, a igual relevancia, en el
// orden de la lista: el sort es estable por índice):
//   0  un campo principal EMPIEZA con la consulta        «dis» → «Discovery»
//   1  la consulta empieza una palabra de un principal   «punk» → «Daft Punk»
//   2  cualquier otra coincidencia                       (artista o álbum de una canción, etc.)
// Los espacios de los extremos no cuentan; una consulta vacía no devuelve nada (la vista muestra la
// invitación a escribir, no toda la biblioteca).
export function searchGroup(group, list, query) {
  const q = foldForSearch((query ?? '').trim());
  if (!q || !list || list.length === 0) return [];
  const idx = indexFor(group, list);
  const word = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(q)}`, 'u');
  const hits = [];
  for (let i = 0; i < idx.length; i++) {
    const e = idx[i];
    if (!e.hay.includes(q)) continue;
    const tier = e.prim.some((s) => s.startsWith(q)) ? 0 : e.prim.some((s) => word.test(s)) ? 1 : 2;
    hits.push(tier * 0x1000000 + i);   // un solo número ordena por (relevancia, posición): rápido con miles de aciertos
  }
  hits.sort((a, b) => a - b);
  return hits.map((h) => list[h % 0x1000000]);
}

// ── La consulta, sólo en MEMORIA ──
// La vista se desmonta al abrir un resultado (álbum, artista, playlist); al volver con el atrás tiene que
// encontrar lo que se había escrito. No va a la URL (sin ?q=) ni a localStorage: F5 la abre vacía. Vive
// en este módulo y no en Layout porque cada tecla re-renderizaría el Layout entero (y con él el Player).
// Search la lee SÓLO al volver por historial (con un target); Layout la vacía al desmontarse (cerrar
// sesión), junto con la caché de vistas.
let saved = '';
export const savedSearch = () => saved;
export const saveSearch = (q) => { saved = q; };
export const clearSavedSearch = () => { saved = ''; };
