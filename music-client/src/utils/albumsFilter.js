// Filtro del listado de Álbumes (v1): orden + década. Sólo cliente — sale de lo que ya trae
// GET /api/albums (year, track_count), sin backend.
//
// Se guarda POR USUARIO y por navegador, como la vista (utils/albumsView.js): una clave por dueño
// del JWT. Leer valida el formato: un JSON corrupto, un orden desconocido o décadas mal formadas
// caen al predeterminado; leer y escribir nunca rompen la vista.
//
// Las décadas guardadas pueden quedar OBSOLETAS (la música cambió y esa década ya no está): no se
// borran del storage, pero effectiveFilter() las descarta contra los datos, así que no filtran ni
// cuentan en el badge.
//
//   sort     'artist' (el orden del servidor, intacto) · 'az' · 'year-asc' · 'year-desc' · 'tracks'
//   decades  ['1990', '2020', 'none'] — 'none' = sin año. Dentro del grupo se suman (OR).

export const ALBUM_SORTS = ['artist', 'az', 'year-asc', 'year-desc', 'tracks'];
export const DEFAULT_ALBUM_FILTER = Object.freeze({ sort: 'artist', decades: [] });
const KEY = 'sonorarev.albumsFilter:';
const DECADE_RE = /^(\d{4}|none)$/;

function sanitize(v) {
  if (!v || typeof v !== 'object') return DEFAULT_ALBUM_FILTER;
  const sort = ALBUM_SORTS.includes(v.sort) ? v.sort : 'artist';
  const decades = Array.isArray(v.decades)
    ? [...new Set(v.decades.filter((d) => typeof d === 'string' && DECADE_RE.test(d)))]
    : [];
  return { sort, decades };
}

export function readAlbumsFilter(owner) {
  if (!owner) return DEFAULT_ALBUM_FILTER;
  try {
    const raw = localStorage.getItem(KEY + owner);
    return raw ? sanitize(JSON.parse(raw)) : DEFAULT_ALBUM_FILTER;
  } catch {
    return DEFAULT_ALBUM_FILTER;
  }
}

export function writeAlbumsFilter(owner, filter) {
  if (!owner) return;
  try { localStorage.setItem(KEY + owner, JSON.stringify(sanitize(filter))); } catch { /* sin storage: sólo dura esta visita */ }
}

export const decadeOf = (a) => (a.year ? String(Math.floor(a.year / 10) * 10) : 'none');

// Décadas presentes en los datos, de la más vieja a la más nueva; 'none' al final si hay alguno.
export function availableDecades(albums) {
  const set = new Set(albums.map(decadeOf));
  const list = [...set].filter((d) => d !== 'none').sort();
  if (set.has('none')) list.push('none');
  return list;
}

// El filtro que de verdad aplica: sin las décadas que ya no existen en los datos.
export function effectiveFilter(filter, available) {
  const decades = filter.decades.filter((d) => available.includes(d));
  return decades.length === filter.decades.length ? filter : { ...filter, decades };
}

// Cuántos grupos están activos (el número del badge). El orden cuenta sólo si no es el de siempre.
export const activeCount = (f) => (f.sort !== 'artist' ? 1 : 0) + (f.decades.length ? 1 : 0);

const cmp = (a, b) => (a ?? '').localeCompare(b ?? '', 'es', { sensitivity: 'base' });
const byArtistAlbum = (a, b) => cmp(a.album_artist, b.album_artist) || cmp(a.album, b.album);

// Aplica década + orden. Sin filtro activo devuelve LA MISMA lista (misma identidad): así el resto
// de la vista (el Mix compara identidades) se comporta exactamente como antes.
export function applyAlbumsFilter(albums, f) {
  if (activeCount(f) === 0) return albums;
  const want = f.decades.length ? new Set(f.decades) : null;
  const out = want ? albums.filter((a) => want.has(decadeOf(a))) : albums.slice();
  switch (f.sort) {
    case 'az': out.sort((a, b) => cmp(a.album, b.album) || cmp(a.album_artist, b.album_artist)); break;
    case 'year-asc':
    case 'year-desc': {
      const dir = f.sort === 'year-asc' ? 1 : -1;
      out.sort((a, b) => {
        if (!a.year !== !b.year) return a.year ? -1 : 1;   // sin año, siempre al final
        return (a.year && b.year ? (a.year - b.year) * dir : 0) || byArtistAlbum(a, b);
      });
      break;
    }
    case 'tracks': out.sort((a, b) => (b.track_count ?? 0) - (a.track_count ?? 0) || byArtistAlbum(a, b)); break;
    default: break;   // 'artist': el orden del servidor, sin tocar
  }
  return out;
}
