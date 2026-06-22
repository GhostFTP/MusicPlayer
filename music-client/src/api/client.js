const BASE = '';

function getToken() {
  return localStorage.getItem('token');
}

async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.error ?? res.statusText), { status: res.status });
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  // Auth
  login:    (username, password) => request('/api/auth/login',    { method: 'POST', body: JSON.stringify({ username, password }) }),
  register: (username, password) => request('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }),

  // Tracks
  tracks:   (params = {}) => request('/api/tracks?' + new URLSearchParams(params)),
  track:    (id)          => request(`/api/tracks/${id}`),

  // Albums
  albums:   ()            => request('/api/albums'),
  albumTracks: (album)    => request(`/api/albums/${encodeURIComponent(album)}/tracks`),

  // Playlists
  playlists:       ()           => request('/api/playlists'),
  createPlaylist:  (name)       => request('/api/playlists',                  { method: 'POST', body: JSON.stringify({ name }) }),
  deletePlaylist:  (id)         => request(`/api/playlists/${id}`,            { method: 'DELETE' }),
  playlistTracks:  (id)         => request(`/api/playlists/${id}/tracks`),
  addToPlaylist:   (id, trackId)=> request(`/api/playlists/${id}/tracks`,     { method: 'POST', body: JSON.stringify({ track_id: trackId }) }),
  removeFromPlaylist: (id, tid) => request(`/api/playlists/${id}/tracks/${tid}`, { method: 'DELETE' }),
};

// URL helpers for src attributes (need token in query param)
export function coverUrl(trackId)  { return `/api/tracks/${trackId}/cover?token=${getToken()}`; }
export function streamUrl(trackId) { return `/stream/${trackId}?token=${getToken()}`; }
