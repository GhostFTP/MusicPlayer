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

async function request(path, options = {}) {
  const token = getToken();

  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, REQUEST_TIMEOUT_MS);
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
        new Error(`La petición a ${path} superó los ${REQUEST_TIMEOUT_MS / 1000} segundos`),
        { timeout: true },
      );
    }
    throw err;   // abort del llamador, red caída, etc. — se propaga tal cual
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', relayAbort);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // Se excluyen los endpoints de auth (cfLogin/login pueden responder 401
    // como parte de su flujo normal, ver el comentario de cfLogin abajo) para
    // no generar un loop de reintentos.
    if (res.status === 401 && !path.startsWith('/api/auth/')) {
      onUnauthorized?.();
    }
    throw Object.assign(new Error(body.error ?? res.statusText), { status: res.status });
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  // Auth
  login:    (username, password) => request('/api/auth/login',    { method: 'POST', body: JSON.stringify({ username, password }) }),
  // Auto-login vía Cloudflare Access: si la petición pasa por Cloudflare, el edge
  // inyecta las cabeceras de identidad y el backend devuelve un token. Si no
  // (red local), responde 401 y caemos al login tradicional.
  cfLogin:  () => request('/api/auth/cf', { method: 'POST' }),
  // Config pública del login: ¿hay auto-login por Cloudflare Access? (para el botón Google).
  authConfig: () => request('/api/auth/config'),

  // Tracks
  tracks:   (params = {}) => request('/api/tracks?' + new URLSearchParams(params)),
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

  // Novedades (CHANGELOG.md del repo) → { content }
  changelog:       ()           => request('/api/changelog'),
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
