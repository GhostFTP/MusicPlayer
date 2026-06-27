import { usePlayer } from '../context/PlayerContext.jsx';
import { coverUrl } from '../api/client.js';
import QualityChip from './QualityChip.jsx';
import AddToPlaylistMenu from './AddToPlaylistMenu.jsx';

// Tabla de pistas reutilizable — mismo diseño de fila que la Biblioteca
// (carátula, jerarquía título/artista, QualityChip y botón "+").
// `showAlbum`: oculta la columna Álbum cuando el contexto ya es un álbum.
export default function TrackTable({ tracks, showAlbum = true }) {
  const { play, currentTrack, isPlaying } = usePlayer();

  return (
    <table className="track-table">
      <thead>
        <tr>
          <th className="col-num">#</th>
          <th>Título</th>
          <th className="col-artist">Artista</th>
          {showAlbum && <th className="col-album">Álbum</th>}
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
                  {active && isPlaying ? '▶' : (track.track_number ?? i + 1)}
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
                      <QualityChip track={track} className="chip-inline" />
                    </div>
                  </div>
                </div>
              </td>
              <td className="col-artist track-artist">{track.artist ?? '—'}</td>
              {showAlbum && <td className="col-album track-album">{track.album ?? '—'}</td>}
              <td className="col-quality"><QualityChip track={track} /></td>
              <td className="col-time">{fmt(track.duration)}</td>
              <td className="col-actions">
                <AddToPlaylistMenu trackId={track.id} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function fmt(s) {
  if (!s) return '—';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}
