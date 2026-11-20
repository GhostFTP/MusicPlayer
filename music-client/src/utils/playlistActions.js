import { api } from '../api/client.js';

// Acciones de "añadir a playlist", compartidas por las DOS superficies que las ofrecen:
// el botón "+" (AddToPlaylistMenu) y el menú contextual (fase D). Vivían dentro del "+"
// y no se exportaban — al necesitarlas el menú, la alternativa era duplicarlas, y con
// ellas el aviso: el "ya está" es la variante WARNING (ámbar, más grande, dura más) para
// que se note que NO se añadió de nuevo. Esa distinción es parte del comportamiento, no
// del widget, así que el toast se emite acá y no en cada llamador.
//
// El `toast` llega por parámetro (no por hook) para que este módulo sea plano: lo usan un
// componente y un provider, y los dos ya tienen el suyo por useToast().

// Añade una pista a una playlist YA existente. Devuelve la respuesta del backend
// ({ already: true } si la pista ya estaba — la DB impide duplicados, esto sólo lo cuenta).
export async function addTrackToPlaylist(playlist, trackId, toast) {
  const res = await api.addToPlaylist(playlist.id, trackId);
  if (res?.already) toast(`Ya está en «${playlist.name}»`, { variant: 'warning' });
  else toast(`Añadida a «${playlist.name}»`);
  return res;
}

// Crea una playlist y le añade la pista de una. Devuelve la playlist creada.
//
// Si la playlist se creó y lo que falló fue AGREGAR, el error sale con `creada` (la playlist nueva):
// quien llama sabe así que ya existe —vacía— y no la vuelve a crear con el mismo nombre.
export async function createPlaylistWithTrack(name, emoji, trackId, toast) {
  const pl = await api.createPlaylist(name, emoji);
  try {
    await api.addToPlaylist(pl.id, trackId);
  } catch (e) {
    throw Object.assign(e ?? new Error('agregar'), { creada: pl });
  }
  toast(`Añadida a «${pl.name ?? name}»`);
  return pl;
}

// ── POR QUÉ FALLÓ AGREGAR (hallazgo de la playlist 14, v1.43.0) ──
//
// `POST /api/playlists/:id/tracks` (music-server/src/api/playlists.js) contesta 404 por DOS motivos
// distintos, y sólo el cuerpo los separa:
//   · `{ error: 'Track not found' }` — la playlist es tuya pero la PISTA ya no existe: un reescaneo
//     movió o renombró el archivo y le dio otro id (scanner/index.js, ON CONFLICT(file_path)), y la
//     pestaña sigue con el id viejo en la cola. Recargar la página trae el id nuevo.
//   · `{ error: 'Playlist not found' }` — la playlist no existe o no es tuya.
// Cualquier otro fallo (red, 5xx, 401) es "otro". request() (api/client.js) deja el cuerpo en
// `e.body` y el status en `e.status`.
export const AVISO_PISTA_CAMBIO = 'Esta canción cambió en la biblioteca. Recarga la página para agregarla.';
export const AVISO_PLAYLIST_NO_EXISTE = 'Esa playlist ya no existe.';
export const AVISO_NO_SE_PUDO = 'No se pudo agregar a la playlist.';
// El texto que el menú contextual ya daba cuando lo que falla es CREAR la playlist (no agregar).
export const AVISO_NO_SE_PUDO_CREAR = 'No se pudo crear la playlist';

export function motivoFalloAgregar(e) {
  if (e?.status !== 404) return 'otro';
  if (e?.body?.error === 'Track not found') return 'pista';
  if (e?.body?.error === 'Playlist not found') return 'playlist';
  return 'otro';
}

const AVISOS = { pista: AVISO_PISTA_CAMBIO, playlist: AVISO_PLAYLIST_NO_EXISTE, otro: AVISO_NO_SE_PUDO };
export const avisoFalloAgregar = (e) => AVISOS[motivoFalloAgregar(e)];

// "Crear y agregar": si ni siquiera se creó, es el aviso de crear; si se creó y falló agregar, el
// de agregar.
export const avisoFalloCrearYAgregar = (e) => (e?.creada ? avisoFalloAgregar(e) : AVISO_NO_SE_PUDO_CREAR);
