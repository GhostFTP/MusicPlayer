import { api } from '../api/client.js';

// AGREGAR UN VIDEO A UNA PLAYLIST Y QUITARLO (V8d/V8e). Copia de la PANTALLA de iOS (sonorarev-ios
// @ a3964fb): cómo se lee cada respuesta y con qué texto se avisa.
//   · lib/playlists/videos-datos.ts — leerAgregar :113, leerQuitar :136, SIN_RED/SESION/NO_EXISTE
//     :286-288, mensajeAgregar :291, mensajeQuitar :320, accionesHoja :372, playlistsParaVideo :383,
//     leerPlaylistCreada :404, mensajeCrear :413, mensajeNuevaPlaylist :423;
//   · components/videos/hoja-video.tsx — agregar :100, crearYAgregar :114, quitar :141; encabezados
//     de los Alert :108 ("No se pudo agregar"), :119 ("No se pudo crear la playlist"), :123
//     ("Playlist creada"), :148 ("No se pudo quitar"); "Nueva playlist" :246; "Aún no tienes otras
//     playlists." :249.
// Los Alert de iOS ("No se pudo agregar", "No se pudo quitar", "No se pudo crear la playlist",
// "Playlist creada") son en la web el toast ámbar de la casa, con el mismo texto.
//
// Las llamadas usan la opción `raw` de api/client.js → { status, data } en 2xx, para exigir el
// código EXACTO como iOS ("un 200 no es éxito"). Un error lanza con .status; sin respuesta (red,
// timeout) no hay status → "sin-red", como el null de iOS.

const SIN_RED = 'Sin conexión. Los videos necesitan internet.';     // videos-datos.ts:286
const SESION = 'Sesión expirada. Sal y vuelve a entrar.';          // videos-datos.ts:287
const NO_EXISTE = 'Esa playlist ya no existe.';                     // videos-datos.ts:288

const numero = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

// La respuesta de una llamada `raw`, o lo que lanzó, como { status, data } | null.
async function respuesta(llamada) {
  try { return await llamada(); }
  catch (e) { return Number.isInteger(e?.status) ? { status: e.status, data: null } : null; }
}

// ── POST /api/playlists/:id/videos en LOTE ──
export function leerAgregar(r) {
  if (r == null) return { estado: 'sin-red' };
  switch (r.status) {
    case 201: {
      const d = r.data ?? {};
      const a = numero(d.added), y = numero(d.already), s = numero(d.skipped);
      if (a == null || y == null || s == null) return { estado: 'error' };
      return { estado: 'ok', agregados: a, yaEstaban: y, noEstan: s };
    }
    case 401: return { estado: 'sesion' };
    case 404: return { estado: 'playlist-no-existe' };
    case 413: return { estado: 'tope-envio' };
    case 409: return { estado: 'tope-playlist' };
    case 503: return { estado: 'indice-caido' };
    case 400: return { estado: 'invalido' };
    default: return { estado: 'error' };
  }
}

// { titulo, tipo: 'ok' | 'info' | 'error' }
export function mensajeAgregar(r, playlist) {
  switch (r.estado) {
    case 'ok': {
      const extra = r.noEstan === 0 ? ''
        : r.noEstan === 1 ? ' · 1 ya no está en el servidor'
        : ` · ${r.noEstan} ya no están en el servidor`;
      if (r.agregados > 0) {
        const base = r.agregados === 1 ? `Agregado a «${playlist}»` : `${r.agregados} videos agregados a «${playlist}»`;
        return { titulo: base + extra, tipo: 'ok' };
      }
      if (r.yaEstaban > 0) {
        return { titulo: (r.yaEstaban === 1 ? `Ese video ya está en «${playlist}»` : `Ya estaban en «${playlist}»`) + extra, tipo: 'info' };
      }
      if (r.noEstan > 0) {
        return { titulo: r.noEstan === 1 ? 'Ese video ya no está en el servidor.' : 'Esos videos ya no están en el servidor.', tipo: 'error' };
      }
      return { titulo: 'No se pudo agregar. Intenta de nuevo.', tipo: 'error' };
    }
    case 'sin-red': return { titulo: SIN_RED, tipo: 'error' };
    case 'sesion': return { titulo: SESION, tipo: 'error' };
    case 'playlist-no-existe': return { titulo: NO_EXISTE, tipo: 'error' };
    case 'tope-envio': return { titulo: 'Son demasiados videos a la vez. Agrega menos.', tipo: 'error' };
    case 'tope-playlist': return { titulo: 'Esta playlist ya llegó al máximo de 500 videos.', tipo: 'error' };
    case 'indice-caido': return { titulo: 'Los videos no están disponibles ahora. Intenta más tarde.', tipo: 'error' };
    default: return { titulo: 'No se pudo agregar. Intenta de nuevo.', tipo: 'error' };
  }
}

// ── DELETE /api/playlists/:id/videos/:videoId (sólo el 204 es éxito) ──
export function leerQuitar(r) {
  if (r == null) return 'sin-red';
  if (r.status === 204) return 'ok';
  if (r.status === 401) return 'sesion';
  if (r.status === 404) return 'playlist-no-existe';
  return 'error';
}
export function mensajeQuitar(r) {
  switch (r) {
    case 'ok': return { titulo: 'Quitado de la playlist', tipo: 'ok' };
    case 'sin-red': return { titulo: SIN_RED, tipo: 'error' };
    case 'sesion': return { titulo: SESION, tipo: 'error' };
    case 'playlist-no-existe': return { titulo: NO_EXISTE, tipo: 'error' };
    default: return { titulo: 'No se pudo quitar. Intenta de nuevo.', tipo: 'error' };
  }
}

// ── POST /api/playlists (sólo un 201 con id entero es una playlist creada) ──
export function leerPlaylistCreada(r) {
  if (r == null) return { estado: 'sin-red' };
  if (r.status === 401) return { estado: 'sesion' };
  const id = r.data?.id;
  if (r.status === 201 && Number.isInteger(id) && id > 0) return { estado: 'ok', id };
  return { estado: 'error' };
}
export function mensajeCrear(r) {
  switch (r.estado) {
    case 'sin-red': return { titulo: SIN_RED, tipo: 'error' };
    case 'sesion': return { titulo: SESION, tipo: 'error' };
    default: return { titulo: 'No se pudo crear la playlist. Intenta de nuevo.', tipo: 'error' };
  }
}
export function mensajeNuevaPlaylist(r, playlist) {
  if (r.estado === 'ok' && (r.agregados > 0 || r.yaEstaban > 0)) {
    return { titulo: `Playlist «${playlist}» creada con el video`, tipo: 'ok' };
  }
  const motivo = mensajeAgregar(r, playlist).titulo;
  return { titulo: `Playlist «${playlist}» creada, pero no se pudo agregar el video. ${motivo}`, tipo: 'error' };
}

// ── El selector: sin "Mis favoritos" (no lleva videos) y sin la playlist desde la que se abrió ──
export function playlistsParaVideo(playlists, favoritosId, desdeId) {
  return (Array.isArray(playlists) ? playlists : [])
    .filter((p) => Number.isInteger(p?.id) && p.id > 0 && p.id !== favoritosId && p.id !== desdeId);
}

// ── Qué ofrece el menú de un video (accionesHoja): 'si' | 'sin-red' | 'no' ──
// disponibilidad: 'si' (en el índice) | 'no' (ya no está) | 'desconocida' (sin índice).
export function accionesHoja({ offline, disponibilidad, desdePlaylist }) {
  const agregar = disponibilidad !== 'si' ? 'no' : offline ? 'sin-red' : 'si';
  const quitar = !desdePlaylist ? 'no' : offline ? 'sin-red' : 'si';
  return { agregar, quitar };
}

// ── El aviso: ok/info como toast normal; error como toast ámbar con el encabezado del Alert de iOS ──
export function avisar(toast, aviso, encabezado) {
  if (aviso.tipo !== 'error') { toast(aviso.titulo); return; }
  // Sin encabezado, o si el texto de iOS ya empieza con "No se pudo…", no se antepone nada.
  const texto = !encabezado || aviso.titulo.startsWith('No se pudo') ? aviso.titulo : `${encabezado}. ${aviso.titulo}`;
  toast(texto, { variant: 'warning' });
}

// ── Las tres acciones (devuelven el resultado; el aviso ya salió) ──
export async function agregarVideo(pl, videoId, toast) {
  const r = leerAgregar(await respuesta(() => api.addVideoToPlaylist(pl.id, videoId)));
  avisar(toast, mensajeAgregar(r, pl.name), 'No se pudo agregar');
  return r;
}

// Crear y agregar (crearYAgregar): si NO se crea, avisa por qué y no sigue. Si se crea pero el
// video no entra, la playlist existe igual y se dice ("creada, pero no se pudo agregar el video.
// <motivo>"). En los dos casos de creación, quien llama refresca la lista (iOS: touch(c.id)).
export async function crearYAgregarVideo(name, emoji, videoId, toast) {
  const c = leerPlaylistCreada(await respuesta(() => api.createPlaylistRaw(name, emoji)));
  if (c.estado !== 'ok') { avisar(toast, mensajeCrear(c), 'No se pudo crear la playlist'); return { creada: null, agregado: null }; }
  const r = leerAgregar(await respuesta(() => api.addVideoToPlaylist(c.id, videoId)));
  // El Alert de iOS se titula "Playlist creada" (hoja-video.tsx:123), pero el texto ya lo dice
  // ("Playlist «X» creada, pero no se pudo agregar el video…"): en el toast no se repite.
  avisar(toast, mensajeNuevaPlaylist(r, name), null);
  return { creada: c.id, agregado: r };
}

export async function quitarVideo(playlistId, videoId, toast) {
  const r = leerQuitar(await respuesta(() => api.removeVideoFromPlaylist(playlistId, videoId)));
  avisar(toast, mensajeQuitar(r), 'No se pudo quitar');
  return r;
}
