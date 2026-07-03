import { useState, useEffect, useRef } from 'react';
import { api, coverUrl } from '../api/client.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import ShuffleButton from './ShuffleButton.jsx';

export default function Albums({ target, clearTarget }) {
  const [albums,   setAlbums]   = useState([]);
  const [selected, setSelected] = useState(null); // { album, tracks }
  const [loading,  setLoading]  = useState(true);
  const { play, currentTrack } = usePlayer();
  const activeRowRef = useRef(null);

  useEffect(() => {
    api.albums().then(setAlbums).finally(() => setLoading(false));
  }, []);

  async function openAlbum(album) {
    const tracks = await api.albumTracks(album.album);
    setSelected({ ...album, tracks });
  }

  // Consumo del target de navegación (clic en el título de la pista en la barra/
  // expandido). openAlbum necesita el objeto álbum → lo buscamos en la lista por
  // album (+ album_artist si vino). Espera a que la lista termine (loading) para
  // no perder el target. Consumo único: siempre limpia.
  useEffect(() => {
    if (!target?.album || loading) return;
    const found = albums.find(a =>
      a.album === target.album &&
      (target.album_artist == null || a.album_artist === target.album_artist)
    );
    if (found) openAlbum(found);
    clearTarget();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, loading, albums]);

  // Al abrir un álbum, desplaza la pista que suena a la vista (si está en él).
  useEffect(() => {
    if (selected) activeRowRef.current?.scrollIntoView({ block: 'center' });
  }, [selected]);

  if (loading) return <div className="spinner">Cargando álbumes…</div>;

  if (selected) {
    return (
      <div>
        <button className="back-btn" onClick={() => setSelected(null)}>
          ← Todos los álbumes
        </button>

        <div style={{ display: 'flex', gap: 28, marginBottom: 28, alignItems: 'flex-end' }}>
          {selected.sample_track_id
            ? <img className="album-cover" style={{ width: 160, marginBottom: 0 }} src={coverUrl(selected.sample_track_id)} alt="" />
            : <div className="album-cover-placeholder" style={{ width: 160, fontSize: 56 }}>♫</div>
          }
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)', marginBottom: 6 }}>Álbum</div>
            <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 4 }}>{selected.album}</h1>
            <div style={{ color: 'var(--text-muted)', fontSize: 15 }}>{selected.album_artist ?? selected.tracks[0]?.artist}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 6 }}>
              {selected.year && `${selected.year} · `}{selected.tracks.length} canciones
            </div>
            <button
              className="btn-primary"
              style={{ marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 6 }}
              onClick={() => play(selected.tracks, 0)}
            >
              ▶ Reproducir
            </button>
          </div>
        </div>

        <table className="track-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Título</th>
              <th>Artista</th>
              <th>⏱</th>
            </tr>
          </thead>
          <tbody>
            {selected.tracks.map((track, i) => {
              const active = currentTrack?.id === track.id;
              return (
                <tr
                  key={track.id}
                  ref={active ? activeRowRef : null}
                  className={`track-row${active ? ' playing' : ''}`}
                  onClick={() => play(selected.tracks, i)}
                >
                  <td>
                    <span className={`track-num${active ? ' active' : ''}`}>
                      {active ? '▶' : (track.track_number ?? i + 1)}
                    </span>
                    <span className="track-play-icon">▶</span>
                  </td>
                  <td>
                    <div className={`track-title${active ? ' active' : ''}`}>
                      {track.title ?? 'Sin título'}
                    </div>
                  </td>
                  <td className="track-artist">{track.artist ?? '—'}</td>
                  <td>{fmt(track.duration)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  if (albums.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">💿</div>
        <div className="empty-title">Sin álbumes</div>
        <div className="empty-sub">Escanea tu carpeta de música para empezar.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="section-header">
        <h1 className="section-title">Álbumes</h1>
        <div className="detail-actions">
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{albums.length} álbumes</span>
          <ShuffleButton getTracks={() => api.tracks({ limit: 10000 })} />
        </div>
      </div>

      <div className="album-grid">
        {albums.map(album => (
          <div key={`${album.album}-${album.album_artist}`} className="album-card" onClick={() => openAlbum(album)}>
            {album.sample_track_id
              ? <img className="album-cover" src={coverUrl(album.sample_track_id)} alt="" />
              : <div className="album-cover-placeholder">♫</div>
            }
            <div className="album-name">{album.album}</div>
            <div className="album-artist">{album.album_artist ?? '—'}</div>
            <div className="album-count">{album.track_count} canciones</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function fmt(s) {
  if (!s) return '—';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}
