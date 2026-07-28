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
export async function createPlaylistWithTrack(name, emoji, trackId, toast) {
  const pl = await api.createPlaylist(name, emoji);
  await api.addToPlaylist(pl.id, trackId);
  toast(`Añadida a «${pl.name ?? name}»`);
  return pl;
}
