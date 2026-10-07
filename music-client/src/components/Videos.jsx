import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, videoCoverUrl } from '../api/client.js';
import { usePlayer } from '../context/PlayerContext.jsx';

// Vista "Videos". Lee GET /api/videos, que ya viene ordenada (artista A→Z, año
// del más nuevo al más viejo, sin año al final, título) — acá no se reordena, sólo se agrupa por
// artista conservando ese orden. Mismo lenguaje que Álbumes: .album-grid + tarjetas .album-card,
// con el modificador .video-card (portada 16:9).
//
// Tocar un video hace EXACTAMENTE lo que tocar una canción en un listado (TrackTable, Library):
// play(lista visible, índice) → reemplaza la cola con los videos de la vista, en el orden en que se
// ven, y arranca por el tocado. Cada ítem va con kind:'video' para que el motor use el <video>.
export default function Videos() {
  const { play } = usePlayer();
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

  // [{ artist, videos: [...] }] en el orden en que llegan.
  const groups = useMemo(() => {
    const out = [];
    const byArtist = new Map();
    for (const v of videos ?? []) {
      let g = byArtist.get(v.artist);
      if (!g) { g = { artist: v.artist, videos: [] }; byArtist.set(v.artist, g); out.push(g); }
      g.videos.push(v);
    }
    return out;
  }, [videos]);

  // La lista visible (grupos aplanados, el mismo orden que se ve) como ítems de cola de video.
  const items = useMemo(() => groups.flatMap((g) => g.videos).map((v) => ({ ...v, kind: 'video' })), [groups]);
  const onPlay = useCallback((i) => play(items, i), [play, items]);
  const indexOf = useMemo(() => new Map(items.map((v, i) => [v.id, i])), [items]);

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

  if (groups.length === 0) {
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

      {groups.map((g) => (
        <section key={g.artist} className="video-group">
          <h2 className="video-group-title">{g.artist}</h2>
          <div className="album-grid">
            {g.videos.map((v) => <VideoCard key={v.id} video={v} onPlay={() => onPlay(indexOf.get(v.id))} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function VideoCard({ video, onPlay }) {
  const meta = [video.year, fmtDuration(video.duration)].filter(Boolean).join(' · ');
  return (
    <div className="album-card video-card" onClick={onPlay}>
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

// 1:05:09 / 4:07. Sin duración (el backend manda null si no pudo leerla) → null y no se muestra.
function fmtDuration(s) {
  if (!s) return null;
  const t = Math.round(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
