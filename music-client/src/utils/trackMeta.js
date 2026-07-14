import { api } from '../api/client.js';

// ¿El track ya trae lo que necesitamos aguas abajo? Dos consumidores:
//  · Badge de calidad → campos de audio (codec/bits_per_sample/sample_rate/bitrate/lossless).
//  · MediaSession     → `album` (title/artist siempre vienen en currentTrack).
// `album_artist` NO entra acá a propósito: solo lo usa la navegación a artista (goArtist),
// que conserva su propio fallback lazy en Player.jsx. Con las rutas de cola actuales
// (Biblioteca/Álbum/Género/Playlist) esto es SIEMPRE true → resolveTrackMeta no pega a la
// red; el fetch queda como red de seguridad para una pista sin specs (que hoy no existe).
export function isComplete(t) {
  return !!(t && t.album && (t.codec || t.sample_rate || t.bitrate));
}

// Resuelve la metadata rica de un track. Si ya está completa → la devuelve tal cual
// (cero red). Si no → UN api.track(id) (SELECT *) y merge. Nunca lanza: ante error
// devuelve el track crudo (la UI degrada, no rompe).
export async function resolveTrackMeta(track) {
  if (!track) return null;
  if (isComplete(track)) return track;
  try { return { ...track, ...(await api.track(track.id)) }; }
  catch { return track; }
}
