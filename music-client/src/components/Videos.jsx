import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, videoCoverUrl } from '../api/client.js';

// Vista "Videos" (V3): sólo LISTA. Lee GET /api/videos, que ya viene ordenada (artista A→Z, año
// del más nuevo al más viejo, sin año al final, título) — acá no se reordena, sólo se agrupa por
// artista conservando ese orden. Mismo lenguaje que Álbumes: .album-grid + tarjetas .album-card,
// con el modificador .video-card (portada 16:9).
//
// TODO(V4/V5): reproducir. Hoy tocar un video NO hace nada a propósito: la tarjeta va con
// aria-disabled y sin onClick. El reproductor de video llega con V4 (PlayerContext) y no se
// inventa uno aparte acá. El stream ya tiene su helper: videoStreamUrl() en api/client.js.
export default function Videos() {
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
            {g.videos.map((v) => <VideoCard key={v.id} video={v} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function VideoCard({ video }) {
  const meta = [video.year, fmtDuration(video.duration)].filter(Boolean).join(' · ');
  return (
    // TODO(V4/V5): reproducir al tocar. Deshabilitada hasta entonces (ver el banner de arriba).
    <div className="album-card video-card" aria-disabled="true" title="La reproducción de videos llega pronto">
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
