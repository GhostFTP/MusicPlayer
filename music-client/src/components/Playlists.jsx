import { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { usePlayer } from '../context/PlayerContext.jsx';

export default function Playlists() {
  const [playlists, setPlaylists] = useState([]);
  const [newName,   setNewName]   = useState('');
  const [selected,  setSelected]  = useState(null); // { playlist, tracks }
  const { play, currentTrack } = usePlayer();

  useEffect(() => { api.playlists().then(setPlaylists); }, []);

  async function create(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    const pl = await api.createPlaylist(newName.trim());
    setPlaylists(prev => [...prev, { ...pl, track_count: 0 }]);
    setNewName('');
  }

  async function remove(id, e) {
    e.stopPropagation();
    await api.deletePlaylist(id);
    setPlaylists(prev => prev.filter(p => p.id !== id));
    if (selected?.playlist.id === id) setSelected(null);
  }

  async function open(playlist) {
    const tracks = await api.playlistTracks(playlist.id);
    setSelected({ playlist, tracks });
  }

  if (selected) {
    return (
      <div>
        <button className="back-btn" onClick={() => setSelected(null)}>
          ← Todas las playlists
        </button>
        <div className="section-header">
          <h1 className="section-title">{selected.playlist.name}</h1>
          {selected.tracks.length > 0 && (
            <button className="btn-primary" onClick={() => play(selected.tracks, 0)}>
              ▶ Reproducir
            </button>
          )}
        </div>

        {selected.tracks.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🎶</div>
            <div className="empty-title">Playlist vacía</div>
            <div className="empty-sub">Busca canciones en la Biblioteca y añádelas aquí.</div>
          </div>
        ) : (
          <table className="track-table">
            <thead><tr><th>#</th><th>Título</th><th>Artista</th><th>Álbum</th><th>⏱</th><th></th></tr></thead>
            <tbody>
              {selected.tracks.map((track, i) => {
                const active = currentTrack?.id === track.id;
                return (
                  <tr key={track.id} className={`track-row${active ? ' playing' : ''}`} onClick={() => play(selected.tracks, i)}>
                    <td>
                      <span className={`track-num${active ? ' active' : ''}`}>{active ? '▶' : i + 1}</span>
                      <span className="track-play-icon">▶</span>
                    </td>
                    <td><div className={`track-title${active ? ' active' : ''}`}>{track.title ?? 'Sin título'}</div></td>
                    <td className="track-artist">{track.artist ?? '—'}</td>
                    <td className="track-album">{track.album ?? '—'}</td>
                    <td>{fmt(track.duration)}</td>
                    <td>
                      <button
                        className="btn-icon"
                        title="Quitar de playlist"
                        onClick={async e => {
                          e.stopPropagation();
                          await api.removeFromPlaylist(selected.playlist.id, track.id);
                          setSelected(s => ({ ...s, tracks: s.tracks.filter(t => t.id !== track.id) }));
                        }}
                      >
                        ✕
                      </button>
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

  return (
    <div>
      <div className="section-header">
        <h1 className="section-title">Playlists</h1>
      </div>

      <form className="new-playlist-form" onSubmit={create}>
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="Nueva playlist…"
        />
        <button className="btn-primary" type="submit">Crear</button>
      </form>

      {playlists.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🎶</div>
          <div className="empty-title">Sin playlists</div>
          <div className="empty-sub">Crea una playlist para organizar tu música.</div>
        </div>
      ) : (
        <ul className="playlist-list">
          {playlists.map(pl => (
            <li key={pl.id} className="playlist-item" onClick={() => open(pl)}>
              <div>
                <div className="playlist-name">{pl.name}</div>
                <div className="playlist-meta">{pl.track_count ?? 0} canciones</div>
              </div>
              <button className="btn-icon" title="Eliminar" onClick={e => remove(pl.id, e)}>
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function fmt(s) {
  if (!s) return '—';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14H6L5,6"/><path d="M10,11v6"/><path d="M14,11v6"/><path d="M9,6V4h6v2"/>
    </svg>
  );
}
