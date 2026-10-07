// Vista del listado de Álbumes (Frente 3, F3b–F3e): qué modo eligió cada usuario EN ESTE
// NAVEGADOR. Sólo la vista Álbumes; AlbumGrid (Artistas y Años) no lo usa.
//
//   d2 · d3 · d4  grillas con el tamaño de celda de la app iOS (2, 3 y 4 por fila en el teléfono).
//                 d2 ES la grilla de siempre: el predeterminado se ve igual que antes.
//   mosaic        sólo carátulas (el de 5 por fila de iOS).
//   list          lista: carátula chica + título, artista y canciones.
//
// Se guarda POR USUARIO (una clave por dueño del JWT, el mismo criterio que la caché de vistas):
// en un navegador compartido cada cuenta ve su vista. Un valor que no es un modo conocido, o un
// storage bloqueado, cae al predeterminado; leer y escribir nunca rompen la vista.

export const ALBUM_VIEW_MODES = ['d2', 'd3', 'd4', 'mosaic', 'list'];
export const DEFAULT_ALBUM_VIEW = 'd2';
const KEY = 'sonorarev.albumsView:';

export function readAlbumView(owner) {
  if (!owner) return DEFAULT_ALBUM_VIEW;
  try {
    const v = localStorage.getItem(KEY + owner);
    return ALBUM_VIEW_MODES.includes(v) ? v : DEFAULT_ALBUM_VIEW;
  } catch {
    return DEFAULT_ALBUM_VIEW;
  }
}

export function writeAlbumView(owner, mode) {
  if (!owner || !ALBUM_VIEW_MODES.includes(mode)) return;
  try { localStorage.setItem(KEY + owner, mode); } catch { /* sin storage: sólo dura esta visita */ }
}
