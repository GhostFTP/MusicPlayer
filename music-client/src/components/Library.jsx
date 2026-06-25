import { useState, useEffect, useCallback } from 'react';
import { api, coverUrl } from '../api/client.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import QualityChip from './QualityChip.jsx';
import AddToPlaylistMenu from './AddToPlaylistMenu.jsx';

export default function Library() {
  const [tracks,  setTracks]  = useState([]);
  const [search,  setSearch]  = useState('');
  const [loading, setLoading] = useState(true);
  const { play, currentTrack, isPlaying } = usePlayer();

  const fetchTracks = useCallback(async (q) => {
    setLoading(true);
    try {
      const params = q ? { search: q } : {};
      setTracks(await api.tracks(params));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => fetchTracks(search), 280);
    return () => clearTimeout(t);
  }, [search, fetchTracks]);

  return (
    <div>
      <div className="section-header">
        <h1 className="section-title">Biblioteca</h1>
        <div className="search-box">
          <SearchIcon />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar título, artista, álbum…"
          />
        </div>
      </div>

      {loading ? (
        <div className="spinner">Cargando…</div>
      ) : tracks.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🎵</div>
          <div className="empty-title">Biblioteca vacía</div>
          <div className="empty-sub">
            Copia tus archivos de audio a <code>music/</code> y ejecuta <code>npm run scan</code>.
          </div>
        </div>
      ) : (
        <table className="track-table">
          <thead>
            <tr>
              <th className="col-num">#</th>
              <th>Título</th>
              <th className="col-artist">Artista</th>
              <th className="col-album">Álbum</th>
              <th className="col-quality">Calidad</th>
              <th className="col-time">⏱</th>
              <th className="col-actions"></th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((track, i) => {
              const active = currentTrack?.id === track.id;
              return (
                <tr
                  key={track.id}
                  className={`track-row${active ? ' playing' : ''}`}
                  onClick={() => play(tracks, i)}
                >
                  <td className="col-num">
                    <span className={`track-num${active ? ' active' : ''}`}>
                      {active && isPlaying ? '▶' : i + 1}
                    </span>
                    <span className="track-play-icon">▶</span>
                  </td>
                  <td>
                    <div className="track-info-cell">
                      {track.cover_path
                        ? <img className="track-art" src={coverUrl(track.id)} alt="" />
                        : <div className="track-art-placeholder">♪</div>
                      }
                      <div className="track-text">
                        <div className={`track-title${active ? ' active' : ''}`}>
                          {track.title ?? 'Sin título'}
                        </div>
                        <div className="track-sub">
                          <span className="track-artist">{track.artist ?? '—'}</span>
                          {/* En móvil las columnas colapsan: el chip viaja junto al título */}
                          <QualityChip track={track} className="chip-inline" />
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="col-artist track-artist">{track.artist ?? '—'}</td>
                  <td className="col-album track-album">{track.album ?? '—'}</td>
                  <td className="col-quality">
                    <QualityChip track={track} />
                  </td>
                  <td className="col-time">{fmt(track.duration)}</td>
                  <td className="col-actions">
                    <AddToPlaylistMenu trackId={track.id} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function fmt(s) {
  if (!s) return '—';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  );
}
