import { videoCoverUrl } from '../api/client.js';

// La tarjeta de un video. La usan la vista Videos y la sección «Videos» de la página del artista
// (1.36.0; antes vivía dentro de Videos.jsx).
//
// Jerarquía (1.36.0): el ARTISTA es la línea principal y el título la secundaria. En la biblioteca
// real casi todos los videos se llaman igual («NPR Music Tiny Desk Concert»): lo que distingue una
// tarjeta de otra es el artista. Debajo, año · duración.
//
// Con `artistLink` (el nombre del artista en la biblioteca) el artista es un botón que navega; el
// stopPropagation evita que el toque llegue a la tarjeta, que reproduciría el video. En la página
// del artista no se pasa: el enlace llevaría a la misma página.
export default function VideoCard({ video, press, artistLink, onArtist }) {
  const meta = [video.year, fmtDuration(video.duration)].filter(Boolean).join(' · ');
  return (
    <div className="album-card video-card" {...press}>
      <div className="album-cover-frame video-cover-frame">
        {video.has_cover
          ? <img className="album-cover video-cover" src={videoCoverUrl(video.id)} alt="" loading="lazy" draggable={false} />
          : <div className="album-cover-placeholder video-cover">🎬</div>
        }
      </div>
      {artistLink
        ? (
          <div className="album-name video-card-artist video-card-artist--link">
            <button
              type="button"
              className="video-artist-link"
              title="Ir al artista"
              onClick={(e) => { e.stopPropagation(); onArtist(artistLink); }}
            >
              {video.artist}
            </button>
          </div>
        )
        : <div className="album-name video-card-artist">{video.artist}</div>}
      <div className="album-artist video-card-title">{video.title}</div>
      {meta && <div className="album-count">{meta}</div>}
    </div>
  );
}

// A→Z en español sin distinguir mayúsculas ni tildes ("Ávila" junto a "Avicii"), con los números
// en orden natural ("Parte 2" antes que "Parte 10").
export const VIDEO_COLLATOR = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

// Artista A→Z y después título: el orden de la vista Videos y de la sección del artista.
export function byArtistTitle(a, b) {
  return VIDEO_COLLATOR.compare(a.artist ?? '', b.artist ?? '') || VIDEO_COLLATOR.compare(a.title ?? '', b.title ?? '');
}

// 1:05:09 / 4:07. Sin duración (el backend manda null si no pudo leerla) → null y no se muestra.
function fmtDuration(s) {
  if (!s) return null;
  const t = Math.round(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
