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

// Álbum SIN album_artist (tags sin ALBUMARTIST): su ruta es /albums/@/<álbum>. El "@" va CRUDO y es
// un centinela que ningún link real puede producir: encodeURIComponent SIEMPRE lo escribe "%40", así
// que un artista llamado literalmente "@" viaja como /albums/%40/… y se lee como ese artista. Los
// otros caracteres que encodeURIComponent deja crudos (~ - _ . ! * ' ( )) chocarían con nombres reales
// que la app iOS sí comparte tal cual. "@" crudo es válido en un path (no lo reescriben el navegador ni
// new URL()). Sin esto, abrir uno de esos álbumes no cambiaba la URL ni dejaba entrada de historial, y
// "Volver" (history.back) se iba a la entrada ANTERIOR a la lista — o fuera de la app.
export const NO_ALBUM_ARTIST = '@';

// Vistas conocidas. Las 7 del contrato nav-lab + `settings` y `videos` (que se sumaron a la
// app DESPUÉS de escribir el contrato: son vistas reales y necesitan ruta). Un primer segmento
// fuera de este set = ruta desconocida → library.
const KNOWN_VIEWS = new Set(['albums', 'artists', 'genres', 'years', 'playlists', 'changelog', 'settings', 'videos']);

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

  if (view === 'albums' && target?.album) {
    return target.album_artist
      ? `/albums/${enc(target.album_artist)}/${enc(target.album)}`
      : `/albums/${NO_ALBUM_ARTIST}/${enc(target.album)}`;   // sin album_artist: centinela crudo
  }

  const param = DETAIL_PARAM[view];
  if (param && target?.[param] != null && target[param] !== '') {
    return `/${view}/${enc(String(target[param]))}`;
  }

  return `/${view}`;   // lista, o vista simple (changelog, settings), o detalle incompleto
}

// pathname → { view, target }. Ruta desconocida → { view:'library', target:null } (no crashea).
export function pathToState(pathname = '/') {
  const raw = String(pathname).split('/').filter(Boolean);   // CRUDOS: el centinela se mira antes de decodificar
  const parts = raw.map(decodeSeg);
  if (parts.length === 0) return { view: 'library', target: null };

  const [seg0, seg1, seg2] = parts;
  if (!KNOWN_VIEWS.has(seg0)) return { view: 'library', target: null };

  if (seg0 === 'albums') {
    if (!(seg1 && seg2)) return { view: 'albums', target: null };
    // "@" crudo = sin album_artist (null). "%40" (un artista llamado "@") llega decodificado como "@" en
    // seg1 pero su segmento crudo es "%40", así que no se confunde.
    return { view: 'albums', target: { album_artist: raw[1] === NO_ALBUM_ARTIST ? null : seg1, album: seg2 } };
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
