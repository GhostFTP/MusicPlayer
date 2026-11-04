import { clearViewCache } from './viewCache.js';
import { RADIO, cuerpoDePublicacion, falloDeStatus, leerCreada, leerPublicada, leerRadio, leerTerminada, normalizarCodigo } from '../utils/radioSync.js';

const BASE = '';

function getToken() {
  return localStorage.getItem('token');
}

// Registrado por AuthContext: se invoca cuando cualquier request recibe un 401
// a mitad de sesión, para reintentar la reautenticación vía Cloudflare Access
// sin que el usuario tenga que recargar ni usar incógnito.
let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

// Techo duro de toda petición. Sin esto un fetch colgado (túnel tosiendo, Access lento)
// deja la promesa pendiente PARA SIEMPRE. El caso caro es cfLogin(): AuthContext lo espera
// con checking=true y App.jsx devuelve null hasta que resuelva → pantalla en blanco con la
// música sonando (el <audio> vive en PlayerProvider, por encima de App, y no se entera).
// Con el timeout la promesa rechaza, el finally de reauth() baja checking y aparece el Login.
const REQUEST_TIMEOUT_MS = 10_000;

// `raw: true` (videos en playlists, V8d/V8e): una respuesta 2xx vuelve como { status, data } en vez
// de sólo el cuerpo, para poder exigir el código EXACTO como iOS ("un 200 no es éxito",
// sonorarev-ios/lib/playlists/videos-datos.ts:111-113). Los errores siguen lanzando igual (con
// .status). Sin `raw`, todo exactamente como antes.
// `timeoutMs` (radio): un techo más corto que el de siempre; sin él, REQUEST_TIMEOUT_MS.
async function request(path, { raw, timeoutMs = REQUEST_TIMEOUT_MS, ...options } = {}) {
  const token = getToken();

  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  // El signal del llamador NO se pisa (LyricsPanel manda el suyo, ver api.lyrics): se reenvía
  // al nuestro. Así conviven los dos y `timedOut` distingue "lo canceló el panel" de "se
  // acabó el tiempo", que dan mensajes distintos.
  const callerSignal = options.signal;
  const relayAbort = () => ctrl.abort();
  if (callerSignal?.aborted) ctrl.abort();
  else callerSignal?.addEventListener('abort', relayAbort);

  let res;
  try {
    res = await fetch(BASE + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
      signal: ctrl.signal,   // después de ...options: pisa el del llamador a propósito
    });
  } catch (err) {
    if (timedOut) {
      throw Object.assign(
        new Error(`La petición a ${path} superó los ${timeoutMs / 1000} segundos`),
        { timeout: true },
      );
    }
    throw err;   // abort del llamador, red caída, etc. — se propaga tal cual
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', relayAbort);
  }

  // Sólo cfLogin pide `redirect: 'manual'`: si Cloudflare Access no tiene sesión, contesta con una
  // redirección a su login (otro origen) que un fetch no puede seguir. Con 'manual' llega como
  // `opaqueredirect` y se distingue de una red caída: `gate` = "Access pide pasar por /sso".
  if (res.type === 'opaqueredirect') {
    throw Object.assign(new Error('Cloudflare Access pide iniciar sesión'), { status: 0, gate: true });
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // Se excluyen los endpoints de auth (cfLogin/login pueden responder 401
    // como parte de su flujo normal, ver el comentario de cfLogin abajo) para
    // no generar un loop de reintentos.
    if (res.status === 401 && !path.startsWith('/api/auth/')) {
      clearViewCache();   // sesión inválida: nada cacheado de esta cuenta sobrevive al reauth
      onUnauthorized?.();
    }
    // `retryAfter` (la cabecera, texto o null) y `body` (el cuerpo de error) los usa la radio: el 429
    // trae cuánto esperar y el 410 por qué terminó. Para el resto de los llamadores es aditivo.
    throw Object.assign(new Error(body.error ?? res.statusText), { status: res.status, retryAfter: res.headers.get('retry-after'), body });
  }
  // `etag`: el que manda el servidor para esta respuesta (o null). utils/libraryLoader.js arma con
  // él la firma de la biblioteca, sin recorrerla.
  if (raw) return { status: res.status, etag: res.headers.get('etag'), data: res.status === 204 ? null : await res.json().catch(() => null) };
  if (res.status === 204) return null;
  return res.json();
}

// Radio (music-server/src/api/radio.js, 1.29.0), como iOS (sonorarev-ios lib/radio/api.ts): las
// cuatro NUNCA LANZAN. Devuelven { ok: true, status, ..., muestra } o { ok: false, status?, error,
// ... } con los errores de falloDeStatus (utils/radioSync.js); sin respuesta (red, timeout) es
// { ok: false, error: 'sin-respuesta' }, sin status. Se exige el código EXACTO (201 al crear, 200
// en las demás) Y la forma del cuerpo: Cloudflare Access puede contestar 200 con su página de login.
// `muestra` = { enviadoMs, recibidoMs, serverNow }, para mejorReloj. Un 401 pasa por request()
// como cualquier otro (onUnauthorized): no seguir pidiendo después de 'sesion' es de la capa de arriba.
// `opciones.keepalive`: la ÚNICA opción que se deja pasar al fetch (la usa radioTerminar al cerrar la
// pestaña). Sin ella, el fetch recibe exactamente lo mismo que antes: ni siquiera la clave.
async function radioPedir(ruta, method, path, exito, leer, cuerpo, opciones = {}) {
  const enviadoMs = Date.now();
  let r;
  try {
    r = await request(path, {
      method, raw: true, timeoutMs: RADIO.TIMEOUT_MS,
      ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
      ...(opciones.keepalive === true ? { keepalive: true } : {}),
    });
  } catch (err) {
    if (!err?.status) return { ok: false, error: 'sin-respuesta' };
    const retryAfterS = err.retryAfter == null ? null : Number(err.retryAfter);
    return { ok: false, status: err.status, ...falloDeStatus(ruta, err.status, err.body, retryAfterS) };
  }
  const recibidoMs = Date.now();
  if (r.status !== exito) return { ok: false, status: r.status, ...falloDeStatus(ruta, r.status, r.data, null) };
  const leido = leer(r.data);
  if (!leido) return { ok: false, status: r.status, error: 'servidor' };
  return { ok: true, status: r.status, ...leido, muestra: { enviadoMs, recibidoMs, serverNow: leido.serverNow } };
}
const rutaRadio = (codigo) => `/api/radio/${encodeURIComponent(codigo)}`;
const NO_ES_CODIGO = Object.freeze({ ok: false, error: 'no-existe' });

export const api = {
  // Auth
  // Iniciar sesión vacía la caché de vistas (viewCache.js): la cuenta nueva arranca sin datos ajenos.
  login:    (username, password) => { clearViewCache(); return request('/api/auth/login',    { method: 'POST', body: JSON.stringify({ username, password }) }); },
  // Auto-login vía Cloudflare Access: si la petición pasa por Cloudflare, el edge
  // inyecta las cabeceras de identidad y el backend devuelve un token. Si no
  // (red local), responde 401 y caemos al login tradicional. Si Access no tiene
  // sesión, redirige a su login: rechaza con `gate: true` (ver request()).
  cfLogin:  () => { clearViewCache(); return request('/api/auth/cf', { method: 'POST', redirect: 'manual' }); },
  // Config pública del login: ¿hay auto-login por Cloudflare Access? (para el botón Google).
  authConfig: () => request('/api/auth/config'),

  // Tracks
  // `options.signal`: para cancelar (utils/libraryLoader.js pagina y corta al desmontar la vista).
  tracks:   (params = {}, options) => request('/api/tracks?' + new URLSearchParams(params), options),
  track:    (id)          => request(`/api/tracks/${id}`),
  lyrics:   (id, options) => request(`/api/tracks/${id}/lyrics`, options),   // options.signal: timeout del panel

  // Albums
  albums:   (params = {}) => request('/api/albums?' + new URLSearchParams(params)),
  albumTracks: (album)    => request(`/api/albums/${encodeURIComponent(album)}/tracks`),

  // Browse (géneros / artistas / años)
  genres:   ()            => request('/api/browse/genres'),
  artists:  ()            => request('/api/browse/artists'),
  artistDetail: (artist)  => request('/api/browse/artists/' + encodeURIComponent(artist)),
  artistInfo:   (name)    => request('/api/info/artist/'    + encodeURIComponent(name)),   // MusicBrainz en vivo
  years:    ()            => request('/api/browse/years'),

  // Playlists
  playlists:       ()           => request('/api/playlists'),
  createPlaylist:  (name, emoji)=> request('/api/playlists',                  { method: 'POST',   body: JSON.stringify({ name, emoji }) }),
  renamePlaylist:  (id, name)   => request(`/api/playlists/${id}`,            { method: 'PATCH',  body: JSON.stringify({ name }) }),
  updatePlaylist:  (id, fields) => request(`/api/playlists/${id}`,            { method: 'PATCH',  body: JSON.stringify(fields) }),  // { name?, emoji? }
  deletePlaylist:  (id)         => request(`/api/playlists/${id}`,            { method: 'DELETE' }),
  playlistTracks:  (id)         => request(`/api/playlists/${id}/tracks`),
  addToPlaylist:   (id, trackId)=> request(`/api/playlists/${id}/tracks`,     { method: 'POST', body: JSON.stringify({ track_id: trackId }) }),
  removeFromPlaylist: (id, tid) => request(`/api/playlists/${id}/tracks/${tid}`, { method: 'DELETE' }),
  // Videos de una playlist (music-server/src/api/playlists.js, 1.21.0): tabla aparte, con su propio
  // orden. GET → { index: 'ok'|'unavailable', videos: [{ id, position, added_at, title, artist,
  // available: true|false|null, duration, size, has_cover, year }] }.
  playlistVideos:  (id)         => request(`/api/playlists/${id}/videos`),
  // En LOTE como iOS (lib/playlists/videos.ts:33-43): un video que ya no está llega como `skipped` y
  // un 404 sólo puede ser la playlist. Las tres van con `raw` → { status, data } (utils/videoPlaylistActions.js).
  addVideoToPlaylist:      (id, videoId) => request(`/api/playlists/${id}/videos`, { method: 'POST', body: JSON.stringify({ video_ids: [videoId] }), raw: true }),
  removeVideoFromPlaylist: (id, videoId) => request(`/api/playlists/${id}/videos/${videoId}`, { method: 'DELETE', raw: true }),
  createPlaylistRaw:       (name, emoji) => request('/api/playlists', { method: 'POST', body: JSON.stringify({ name, emoji }), raw: true }),

  // Escuchas (utils/playsOutbox.js): lote de { client_id, track_id, played_at, ms_played } → { added, already, skipped }
  recordPlays:     (plays)      => request('/api/plays', { method: 'POST', body: JSON.stringify({ plays }) }),

  // Novedades (CHANGELOG.md del repo) → { content }
  changelog:       ()           => request('/api/changelog'),

  // Videos (music-server/src/videos/routes.js) → { videos: [{ id, title, artist, year, ext, size,
  // mime, duration, has_cover }] }. Ya vienen ordenados: artista A→Z, año del más nuevo al más viejo.
  videos:          ()           => request('/api/videos'),

  // Radio (ver radioPedir arriba). `estado` = EstadoAnfitrion de utils/radioSync.js.
  // crear → { code, serverNow } · publicar → { serverNow, state } · leer → { radio, serverNow } · terminar → { serverNow, endedReason }
  radioCrear:    ()               => radioPedir('crear', 'POST', '/api/radio', 201, leerCreada),
  radioPublicar: (codigo, estado) => {
    const c = normalizarCodigo(codigo);
    return c ? radioPedir('publicar', 'PUT', `${rutaRadio(c)}/state`, 200, leerPublicada, cuerpoDePublicacion(estado)) : Promise.resolve(NO_ES_CODIGO);
  },
  radioLeer:     (codigo)         => {
    const c = normalizarCodigo(codigo);
    return c ? radioPedir('leer', 'GET', rutaRadio(c), 200, (d) => { const radio = leerRadio(d); return radio && { radio, serverNow: radio.serverNow }; }) : Promise.resolve(NO_ES_CODIGO);
  },
  // `{ keepalive: true }`: para terminar al cerrar la pestaña (pagehide). El fetch sigue vivo aunque la
  // página se descargue, y lleva el Bearer (sendBeacon no manda headers). Sin cuerpo: keepalive tiene
  // tope de cuerpo y DELETE no lo necesita. El timeout de 6 s de request() se queda. Lo esperado (SIN
  // MEDIR todavía, lo mide radio-func): si la página se descarga, el temporizador muere con ella y no
  // aborta; si sigue viva, 6 s es lo de siempre. Sin opciones, igual que antes.
  radioTerminar: (codigo, { keepalive = false } = {}) => {
    const c = normalizarCodigo(codigo);
    return c ? radioPedir('terminar', 'DELETE', rutaRadio(c), 200, leerTerminada, undefined, { keepalive }) : Promise.resolve(NO_ES_CODIGO);
  },
};

// URL helpers for src attributes (need token in query param)
// `thumb` pide la miniatura de 480px (ver covers/thumbs.js en el server). Es ADITIVO:
// sin opciones devuelve exactamente la URL de siempre, asi que un consumidor que no se
// toque no se entera. El server cae al original si no pudo generarla.
export function coverUrl(trackId, { thumb } = {}) {
  return `/api/tracks/${trackId}/cover?token=${getToken()}` + (thumb ? '&size=thumb' : '');
}
export function streamUrl(trackId) { return `/stream/${trackId}?token=${getToken()}`; }
// Foto curada del artista (artist.jpg en su carpeta). 404 si no hay: quien la use tiene que
// manejar el onError y caer a la carátula (ver ArtistImage.jsx).
export function artistImageUrl(artist) {
  return `/api/browse/artists/${encodeURIComponent(artist)}/image?token=${getToken()}`;
}
// Videos: misma autenticación que el audio (Bearer o ?token=). La portada da 404 si el video
// no la tiene (has_cover === false); el stream usa el mismo manejo de Range que el audio.
export function videoCoverUrl(videoId) { return `/api/videos/${videoId}/cover?token=${getToken()}`; }
export function videoStreamUrl(videoId) { return `/stream/video/${videoId}?token=${getToken()}`; }
// Avatar de una persona de la radio: la `url` que ya validó leerAvatar (radioSync.js), que es
// /api/users/N/avatar con su `?v=` opcional. Sin url (emoji o sin avatar) → null.
export function avatarUrl(url) {
  if (typeof url !== 'string' || url === '') return null;
  return `${url}${url.includes('?') ? '&' : '?'}token=${getToken()}`;
}
