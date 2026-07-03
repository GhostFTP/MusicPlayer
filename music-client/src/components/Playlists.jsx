import { useState, useEffect } from 'react';
import { api, coverUrl } from '../api/client.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import QualityChip from './QualityChip.jsx';
import ShuffleButton from './ShuffleButton.jsx';
import EmojiPicker from './EmojiPicker.jsx';

export default function Playlists() {
  const [playlists, setPlaylists] = useState([]);
  const [newName,   setNewName]   = useState('');
  const [emoji,     setEmoji]     = useState('🎵');
  const [selected,  setSelected]  = useState(null); // { playlist, tracks }
  const [renaming,  setRenaming]  = useState(false);
  const [renameVal, setRenameVal] = useState('');
  const { play, currentTrack, isPlaying } = usePlayer();

  useEffect(() => { api.playlists().then(setPlaylists); }, []);

  async function create(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    const pl = await api.createPlaylist(newName.trim(), emoji);
    setPlaylists(prev => [...prev, { ...pl, track_count: 0 }]);
    setNewName('');
    setEmoji('🎵');
  }

  async function remove(id, e) {
    e?.stopPropagation();
    await api.deletePlaylist(id);
    setPlaylists(prev => prev.filter(p => p.id !== id));
    if (selected?.playlist.id === id) setSelected(null);
  }

  async function open(playlist) {
    const tracks = await api.playlistTracks(playlist.id);
    setSelected({ playlist, tracks });
    setRenaming(false);
  }

  function startRename() {
    setRenameVal(selected.playlist.name);
    setRenaming(true);
  }

  async function saveRename(e) {
    e.preventDefault();
    const name = renameVal.trim();
    if (!name) return;
    const updated = await api.renamePlaylist(selected.playlist.id, name);
    setSelected(s => ({ ...s, playlist: { ...s.playlist, name: updated.name } }));
    setPlaylists(prev => prev.map(p => (p.id === updated.id ? { ...p, name: updated.name } : p)));
    setRenaming(false);
  }

  async function removeTrack(trackId, e) {
    e.stopPropagation();
    await api.removeFromPlaylist(selected.playlist.id, trackId);
    setSelected(s => ({ ...s, tracks: s.tracks.filter(t => t.id !== trackId) }));
    setPlaylists(prev => prev.map(p =>
      p.id === selected.playlist.id ? { ...p, track_count: Math.max(0, (p.track_count ?? 1) - 1) } : p
    ));
  }

  // ── Detalle de una playlist ──────────────────────────────
  if (selected) {
    const { playlist, tracks } = selected;
    return (
      <div>
        <button className="back-btn" onClick={() => setSelected(null)}>
          ← Todas las playlists
        </button>

        <div className="section-header">
          {renaming ? (
            <form className="pl-rename" onSubmit={saveRename}>
              <input
                value={renameVal}
                onChange={e => setRenameVal(e.target.value)}
                placeholder="Nombre de la playlist"
                autoFocus
              />
              <button className="btn-primary" type="submit">Guardar</button>
              <button className="btn-icon" type="button" title="Cancelar" onClick={() => setRenaming(false)}>
                ✕
              </button>
            </form>
          ) : (
            <h1 className="section-title pl-title">
              <span className="pl-title-emoji">{playlist.emoji || '🎵'}</span>
              {playlist.name}
              <button className="btn-icon pl-edit" title="Renombrar" onClick={startRename}>
                <EditIcon />
              </button>
            </h1>
          )}

          {!renaming && (
            <div className="pl-detail-actions">
              {tracks.length > 0 && (
                <>
                  <button className="btn-primary" onClick={() => play(tracks, 0)}>▶ Reproducir</button>
                  <ShuffleButton tracks={tracks} />
                </>
              )}
              <button className="btn-icon" title="Eliminar playlist" onClick={() => remove(playlist.id)}>
                <TrashIcon />
              </button>
            </div>
          )}
        </div>

        {tracks.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🎶</div>
            <div className="empty-title">Playlist vacía</div>
            <div className="empty-sub">Busca canciones en la Biblioteca y añádelas con el botón “+”.</div>
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
                            <QualityChip track={track} className="chip-inline" />
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="col-artist track-artist">{track.artist ?? '—'}</td>
                    <td className="col-album track-album">{track.album ?? '—'}</td>
                    <td className="col-quality"><QualityChip track={track} /></td>
                    <td className="col-time">{fmt(track.duration)}</td>
                    <td className="col-actions">
                      <button
                        className="ptp-btn"
                        title="Quitar de la playlist"
                        onClick={e => removeTrack(track.id, e)}
                      >
                        <XIcon />
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

  // ── Lista de playlists ───────────────────────────────────
  return (
    <div>
      <div className="section-header">
        <h1 className="section-title">Playlists</h1>
      </div>

      <form className="new-playlist-form" onSubmit={create}>
        <EmojiPicker value={emoji} onChange={setEmoji} />
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
              <div className="playlist-item-left">
                <span className="playlist-emoji">{pl.emoji || '🎵'}</span>
                <div>
                  <div className="playlist-name">{pl.name}</div>
                  <div className="playlist-meta">{pl.track_count ?? 0} canciones</div>
                </div>
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

function EditIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  );
}
