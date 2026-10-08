// VIDEOS EN EL DETALLE DE UNA PLAYLIST (V8b/V8c) — reglas PURAS, copiadas de la app iOS para que una
// playlist se vea y suene igual en el teléfono y en la web:
//   · sonorarev-ios/lib/playlists/videos-datos.ts: estadoFila, filaTocable, notaFila, estadoSeccion,
//     vistaSeccion, vistaSinCanciones, renglonSinCanciones, contadorDeLista;
//   · sonorarev-ios/lib/cola/playlist.ts: videoReproducible, colaDePlaylist, avisoVideosOmitidos.
// Lo de las DESCARGAS de iOS (estado "descargado") no existe en la web y se omite.
// Sin React y sin red: Playlists.jsx sólo las usa.

// ── Una fila ──
// 'disponible' | 'sin-red' | 'no-disponible' | 'sin-indice'
export function estadoFila(v, offline) {
  if (v?.available === false) return 'no-disponible';   // el índice se leyó y el video ya no está
  if (offline) return 'sin-red';
  if (v?.available == null) return 'sin-indice';         // el índice no se pudo leer: no se sabe
  return 'disponible';
}
export const filaTocable = (e) => e === 'disponible';

// La nota de la fila cuando no se puede ver.
export function notaFila(e) {
  switch (e) {
    case 'no-disponible': return 'No disponible';
    case 'sin-red': return 'Necesita conexión';
    case 'sin-indice': return 'No se puede ver ahora';
    default: return null;
  }
}

// ¿Se puede ver AHORA? La regla de su fila y, además, con artista (iOS: videoReproducible).
export function videoReproducible(v, offline) {
  return filaTocable(estadoFila(v, offline)) && typeof v?.artist === 'string' && v.artist.trim() !== '';
}

// El video de la playlist como ítem de la cola (kind:'video', lo que espera PlayerContext).
export function itemDeVideo(v) {
  return {
    id: String(v.id), title: v.title, artist: v.artist,
    year: v.year ?? null, duration: v.duration ?? null, has_cover: v.has_cover === true,
    kind: 'video',
  };
}

// ── La sección ──
// carga = { status: 'loading' | 'ok' | 'error', fallo: null | 'sesion' | 'playlist-no-existe' | 'error', videos }
// 'cargando' | 'sin-red' | 'sesion' | 'error' | 'vacia' | 'lista'
export function estadoSeccion({ offline, carga }) {
  if (carga?.fallo === 'sesion') return 'sesion';
  if (carga?.status === 'ok') return carga.videos.length ? 'lista' : 'vacia';
  if (offline) return 'sin-red';
  if (carga?.status === 'loading' || !carga) return 'cargando';
  if (carga?.fallo) return 'error';
  return 'cargando';
}
// 'oculta' | 'lista' | 'error'. "Mis favoritos" no lleva videos; el error se ve (con Reintentar)
// salvo si la playlist ya no existe; cargando, sin red, sesión vencida o vacía: oculta.
export function vistaSeccion({ esFav, estado, fallo }) {
  if (esFav) return 'oculta';
  if (estado === 'lista') return 'lista';
  if (estado === 'error' && fallo !== 'playlist-no-existe') return 'error';
  return 'oculta';
}
// Con CERO canciones: 'como-hoy' | 'spinner' | 'sin-canciones' | 'con-videos' | 'vacia'.
export function vistaSinCanciones({ esFav, estado, vista }) {
  if (esFav) return 'como-hoy';
  if (vista !== 'oculta') return 'con-videos';
  if (estado === 'cargando') return 'spinner';
  if (estado === 'vacia') return 'vacia';
  return 'sin-canciones';
}
// El renglón "Sin canciones." sobre la sección: sólo con la sección en error (con videos en lista,
// el encabezado ya dice "0 canciones · N videos").
export const renglonSinCanciones = (vista) => vista !== 'lista';

// ── Textos ──
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
// "N canciones · M videos"; los videos en 0 o sin dato no agregan nada ("· 0 videos" nunca sale).
export function contadorDeLista(canciones, videos) {
  const c = plural(Number.isFinite(canciones) && canciones > 0 ? canciones : 0, 'canción', 'canciones');
  const n = Number.isFinite(videos) && videos > 0 ? videos : 0;
  return n ? `${c} · ${plural(n, 'video', 'videos')}` : c;
}
// El aviso de los videos que quedaron afuera de Reproducir/Mix; null si no se omitió ninguno.
export function avisoVideosOmitidos(n, offline) {
  if (!Number.isInteger(n) || n <= 0) return null;
  const cuantos = n === 1 ? '1 video no se puede ver' : `${n} videos no se pueden ver`;
  return offline ? `${cuantos} sin conexión` : `${cuantos} ahora`;
}
