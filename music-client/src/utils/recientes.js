// «Recién añadidas»: las N pistas más recientes de la biblioteca, por `id`. Sólo cliente.
//
// POR QUÉ POR id Y NO POR FECHA. No hay una fecha real de «añadida»: `tracks.scanned_at` es la del
// ÚLTIMO ESCANEO (el scanner reescribe todas las filas en cada corrida) y ni siquiera viaja en las
// listas. En la base medida, el 97,6 % tenía la misma fecha (un solo escaneo), así que una ventana de
// «últimos N días» daba todo o nada. El `id`, en cambio, es AUTOINCREMENT y nunca se reutiliza: una
// pista que entra después tiene un id mayor. De ahí «las N más recientes» y no «de los últimos N días».
//
// RIESGO CONOCIDO: el id nace con la FILA, no con el archivo. Si se reorganizan carpetas o cambian
// rutas, el scanner borra las filas huérfanas y vuelve a insertar esas pistas con ids NUEVOS: pasan a
// contar como «recientes» sin serlo. (En la base medida, el 59 % de los ids emitidos eran huecos de
// filas borradas: esto pasó de verdad.) Sólo se corrige con una fecha propia en el backend.
//
// COMPARTIDO: este módulo es puro y no sabe de vistas. Biblioteca lo usa con las pistas; Álbumes,
// Artistas, Géneros y Años lo usarán con el MISMO umbral (el de las pistas de `tracks:all`) para decidir
// qué tiene «alguna pista reciente». Calcular el umbral UNA vez por lista y reusarlo.

export const N_RECIENTES = 50;

// Umbral: el id de la N-ésima pista más reciente. Una pista es reciente si su id es >= al umbral.
//   · `ids`: iterable de ids (números). Lo que no es un número finito se ignora.
//   · Con menos de N ids válidos, el umbral es el menor de ellos: todas cuentan.
//   · Sin ids válidos (lista vacía) devuelve null: ninguna es reciente.
//   · Empates (ids repetidos, que AUTOINCREMENT no da pero una lista mal armada sí): se usa `>=`, así
//     que pueden entrar más de N. Nunca menos.
// Una pasada para juntar y un orden numérico de un Float64Array: sin comparador, sin copiar objetos.
export function umbralRecientes(ids, n = N_RECIENTES) {
  const v = [];
  for (const id of ids) if (typeof id === 'number' && Number.isFinite(id)) v.push(id);
  if (v.length === 0 || !(n >= 1)) return null;
  const a = Float64Array.from(v).sort();
  return a[Math.max(0, a.length - Math.floor(n))];
}

export const esReciente = (id, umbral) => umbral !== null && typeof id === 'number' && id >= umbral;

// Umbral de una lista de ítems con id (las pistas de `tracks:all`).
export const umbralDe = (items, n = N_RECIENTES, idOf = (x) => x.id) => {
  function* ids() { for (const it of items ?? []) yield idOf(it); }
  return umbralRecientes(ids(), n);
};

// Deja los ítems recientes, en su orden. Siempre devuelve un array NUEVO: quien necesite «sin filtro →
// misma lista» (el Mix compara identidades) decide ANTES de llamar, con el chip apagado.
export function filtrarRecientes(items, umbral, idOf = (x) => x.id) {
  return (items ?? []).filter((it) => esReciente(idOf(it), umbral));
}

// ÁLBUMES, ARTISTAS, GÉNEROS Y AÑOS. Ninguno tiene un id propio con sentido de «reciente»: lo es si
// TIENE AL MENOS UNA pista reciente. Se derivan, en el cliente, de las pistas de `tracks:all`, con el
// MISMO umbral que la Biblioteca (el de la pista N-ésima de la biblioteca COMPLETA, no el de lo que
// se ve). Un álbum de oleadas mezcladas (la mitad vieja, la mitad nueva) cuenta: tiene una reciente.
//   · albums   Set de albumKeyDe — álbum + artista del álbum, la pareja por la que agrupa el backend
//   · artists  Set de album_artist (la vista Artistas agrupa por album_artist, y excluye vacío/null)
//   · genres   Map género → cuántas pistas recientes tiene (el «N nuevas» de la tarjeta)
//   · years    Map año → cuántas pistas recientes tiene
// Las mismas reglas de pertenencia que las listas del backend (album no null; album_artist y genre no
// vacíos; year no null), así que una pista que la vista no muestra tampoco suma acá.
export const albumKeyDe = (x) => `${x.album}\n${x.album_artist ?? ''}`;

export function indicesRecientes(tracks, umbral) {
  const albums = new Set(), artists = new Set(), genres = new Map(), years = new Map();
  const suma = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const t of tracks ?? []) {
    if (!esReciente(t.id, umbral)) continue;
    if (t.album != null) albums.add(albumKeyDe(t));
    if (t.album_artist != null && t.album_artist !== '') artists.add(t.album_artist);
    if (t.genre != null && t.genre !== '') suma(genres, t.genre);
    if (t.year != null) suma(years, t.year);
  }
  return { albums, artists, genres, years };
}
