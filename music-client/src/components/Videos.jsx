import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, videoCoverUrl } from '../api/client.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useContextMenu } from './ContextMenu.jsx';
import { useLongPress } from '../utils/useLongPress.js';

// Vista "Videos". Lee GET /api/videos y la muestra en UNA sola grilla (.video-grid, propia: no
// toca la .album-grid de Álbumes) ordenada por artista A→Z y después por título. Sin títulos de
// grupo: el artista va dentro de cada tarjeta. La grilla era una por artista y, con un video por
// artista, cada uno ocupaba una fila con una tarjeta chica y el resto vacío. Tarjetas .album-card
// con el modificador .video-card (portada 16:9).
//
// Tocar un video hace EXACTAMENTE lo que tocar una canción en un listado (TrackTable, Library):
// play(lista visible, índice) → reemplaza la cola con los videos de la vista, en el orden en que se
// ven, y arranca por el tocado. Cada ítem va con kind:'video' para que el motor use el <video>.
//
// Menú contextual (V7): clic derecho en escritorio y pulsación larga en el teléfono, igual que las
// tarjetas de álbum (AlbumGrid). Va con el MISMO ítem de cola (kind:'video') que arma el toque, y
// trae sólo "a continuación" y "a la cola" (ContextMenu, case 'video'). El long-press envuelve el
// onClick: una pulsación larga abre el menú y no reproduce.
export default function Videos() {
  const { play } = usePlayer();
  const { openMenu } = useContextMenu();
  const bindPress = useLongPress((item, ev) => openMenu(ev, { type: 'video', item, via: 'longpress' }));
  const [videos, setVideos]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.videos()
      .then((d) => setVideos(Array.isArray(d?.videos) ? d.videos : []))
      .catch((e) => setError(e))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // La lista visible, en el orden en que se ve (artista A→Z, después título), como ítems de cola de
  // video: tocar uno reproduce ESTA lista desde ése.
  const items = useMemo(() => [...(videos ?? [])]
    .sort((a, b) => COLLATOR.compare(a.artist ?? '', b.artist ?? '') || COLLATOR.compare(a.title ?? '', b.title ?? ''))
    .map((v) => ({ ...v, kind: 'video' })), [videos]);
  const onPlay = useCallback((i) => play(items, i), [play, items]);

  if (loading) return <div className="spinner">Cargando videos…</div>;

  if (error) {
    return (
      <div className="empty-state">
        <div className="empty-icon">⚠️</div>
        <div className="empty-title">No se pudieron cargar los videos</div>
        <div className="empty-sub">Intenta de nuevo en un momento.</div>
        <button className="btn-primary" onClick={load}>Reintentar</button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🎬</div>
        <div className="empty-title">Sin videos</div>
        <div className="empty-sub">Todavía no hay videos en el servidor.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="section-header">
        <h1 className="section-title">Videos</h1>
      </div>
      <div className="view-actions">
        <span className="section-count">{videos.length} {videos.length === 1 ? 'video' : 'videos'}</span>
      </div>

      <div className="video-grid">
        {items.map((v, i) => (
          <VideoCard
            key={v.id}
            video={v}
            press={bindPress(v, {
              onClick: () => onPlay(i),
              onContextMenu: (e) => openMenu(e, { type: 'video', item: v }),
            })}
          />
        ))}
      </div>
    </div>
  );
}

function VideoCard({ video, press }) {
  const meta = [video.year, fmtDuration(video.duration)].filter(Boolean).join(' · ');
  return (
    <div className="album-card video-card" {...press}>
      <div className="album-cover-frame video-cover-frame">
        {video.has_cover
          ? <img className="album-cover video-cover" src={videoCoverUrl(video.id)} alt="" loading="lazy" draggable={false} />
          : <div className="album-cover-placeholder video-cover">🎬</div>
        }
      </div>
      <div className="album-name">{video.title}</div>
      <div className="album-artist">{video.artist}</div>
      {meta && <div className="album-count">{meta}</div>}
    </div>
  );
}

// A→Z en español sin distinguir mayúsculas ni tildes ("Ávila" junto a "Avicii"), con los números
// en orden natural ("Parte 2" antes que "Parte 10").
const COLLATOR = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

// 1:05:09 / 4:07. Sin duración (el backend manda null si no pudo leerla) → null y no se muestra.
function fmtDuration(s) {
  if (!s) return null;
  const t = Math.round(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
