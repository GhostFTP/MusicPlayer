import { useState, useEffect } from 'react';
import { api, coverUrl } from '../api/client.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import TrackTable from './TrackTable.jsx';
import ShuffleButton from './ShuffleButton.jsx';

// Detalle de un álbum: cabecera + tabla de pistas (con QualityChip).
// Pide las pistas vía /api/tracks (que sí trae la calidad) filtrando por álbum.
export default function AlbumDetail({ album, onBack }) {
  const [tracks, setTracks] = useState(null);
  const { play } = usePlayer();

  useEffect(() => {
    const params = { album: album.album, limit: 500 };
    if (album.album_artist) params.album_artist = album.album_artist;
    let cancelled = false;
    api.tracks(params).then(t => { if (!cancelled) setTracks(t); });
    return () => { cancelled = true; };
  }, [album]);

  return (
    <div>
      <button className="back-btn" onClick={onBack}>← Volver</button>

      <div className="detail-hero">
        {album.sample_track_id
          ? <img className="detail-hero-cover" src={coverUrl(album.sample_track_id)} alt="" />
          : <div className="detail-hero-cover placeholder">♫</div>
        }
        <div className="detail-hero-info">
          <div className="detail-kicker">Álbum</div>
          <h1 className="detail-title">{album.album}</h1>
          <div className="detail-sub">{album.album_artist ?? tracks?.[0]?.artist ?? '—'}</div>
          <div className="detail-meta">
            {album.year ? `${album.year} · ` : ''}{album.track_count ?? tracks?.length ?? 0} canciones
          </div>
          {tracks && tracks.length > 0 && (
            <div className="detail-actions">
              <button className="btn-primary" onClick={() => play(tracks, 0)}>▶ Reproducir</button>
              <ShuffleButton tracks={tracks} />
            </div>
          )}
        </div>
      </div>

      {tracks
        ? <TrackTable tracks={tracks} showAlbum={false} />
        : <div className="spinner">Cargando…</div>
      }
    </div>
  );
}
