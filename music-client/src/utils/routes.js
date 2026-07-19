// Módulo PURO de rutas del Modelo 2 (nav-lab): traduce entre el estado de navegación
// { view, target } y el pathname de la URL, en ambas direcciones. Sin React, sin efectos,
// sin fetch → se compila y se verifica solo (round-trip). Nadie lo importa todavía; lo
// consumen F1.2/F1.3.
//
// Encoding: encodeURIComponent al ARMAR el path; decodeURIComponent + normalización NFC al
// PARSEAR (mismo cuidado que /image — commit c201836). Así un link tipeado a mano con otra
// normalización Unicode resuelve a la forma NFC, que es la que matchea la DB. Para nombres
// ya en NFC (la fuente de verdad), el round-trip cierra exacto.
//
// OJO (para F1.2/F1.3): una URL no tiene tipos — todos los segmentos vuelven como STRING.
// year e id, que en la app pueden venir como número, salen de acá como string.

const enc = encodeURIComponent;

// Decodifica un segmento y lo normaliza a NFC (robustez de matcheo; ver arriba). Un
// segmento mal formado (% suelto) no debe crashear: se devuelve normalizado tal cual.
function decodeSeg(s) {
  try { return decodeURIComponent(s).normalize('NFC'); }
  catch { return s.normalize('NFC'); }
}

// Vistas conocidas. Las 7 del contrato nav-lab + `settings` (que se sumó a la app DESPUÉS
// de escribir el contrato: es una vista real y necesita ruta). Un primer segmento fuera de
// este set = ruta desconocida → library.
const KNOWN_VIEWS = new Set(['albums', 'artists', 'genres', 'years', 'playlists', 'changelog', 'settings']);

// Vistas con detalle de UN segmento y el nombre de su parámetro. `albums` va aparte: su
// detalle son DOS segmentos (album_artist/album) para desambiguar homónimos.
const DETAIL_PARAM = { artists: 'artist', genres: 'genre', years: 'year', playlists: 'id' };

// Params NUMÉRICOS (year e id son INTEGER en la DB). Se coercen a number en el BORDE
// (pathToState), no en las vistas: así cuando years/playlists consuman su target matchean
// contra el número de la DB (=== ), y el resto de la app sigue viendo los tipos de siempre.
// Sin esto, un '2007' string nunca matchearía y el detalle no abriría — falla silenciosa.
const NUMERIC_PARAM = new Set(['years', 'playlists']);

// { view, target } → pathname. library = '/'; el resto '/<view>' o su detalle.
export function stateToPath(state = {}) {
  const { view, target } = state ?? {};
  if (!view || view === 'library') return '/';

  if (view === 'albums' && target?.album && target?.album_artist) {
    return `/albums/${enc(target.album_artist)}/${enc(target.album)}`;
  }

  const param = DETAIL_PARAM[view];
  if (param && target?.[param] != null && target[param] !== '') {
    return `/${view}/${enc(String(target[param]))}`;
  }

  return `/${view}`;   // lista, o vista simple (changelog, settings), o detalle incompleto
}

// pathname → { view, target }. Ruta desconocida → { view:'library', target:null } (no crashea).
export function pathToState(pathname = '/') {
  const parts = String(pathname).split('/').filter(Boolean).map(decodeSeg);
  if (parts.length === 0) return { view: 'library', target: null };

  const [seg0, seg1, seg2] = parts;
  if (!KNOWN_VIEWS.has(seg0)) return { view: 'library', target: null };

  if (seg0 === 'albums') {
    return (seg1 && seg2)
      ? { view: 'albums', target: { album_artist: seg1, album: seg2 } }
      : { view: 'albums', target: null };
  }

  const param = DETAIL_PARAM[seg0];
  if (param && seg1) {
    if (NUMERIC_PARAM.has(seg0)) {
      const n = Number(seg1);
      // Segmento no numérico (/years/abc) → cae a la lista, no crashea ni inventa NaN.
      return Number.isFinite(n) ? { view: seg0, target: { [param]: n } } : { view: seg0, target: null };
    }
    return { view: seg0, target: { [param]: seg1 } };
  }

  return { view: seg0, target: null };
}
