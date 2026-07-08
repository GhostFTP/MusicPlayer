import { useState, useEffect, useMemo } from 'react';
import { api, coverUrl } from '../api/client.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import QualityChip from './QualityChip.jsx';
import ShuffleButton from './ShuffleButton.jsx';
import EmojiPicker from './EmojiPicker.jsx';
import PlaylistCover from './PlaylistCover.jsx';
import { emojiHue } from '../utils/emojiHue.js';

export default function Playlists({ target, clearTarget, setDetailOpen }) {
  const [playlists, setPlaylists] = useState([]);
  const [newName,   setNewName]   = useState('');
  const [emoji,     setEmoji]     = useState('🎵');
  const [selected,  setSelected]  = useState(null); // { playlist, tracks }
  const [renaming,  setRenaming]  = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false); // paso extra antes de borrar la playlist
  const [renameVal, setRenameVal] = useState('');
  const [renameEmoji, setRenameEmoji] = useState('🎵');
  const [sortMode,  setSortMode]  = useState('added'); // 'added' | 'title' | 'artist' | 'album'
  const [sortDir,   setSortDir]   = useState('desc');  // 'asc' | 'desc'
  const [query,     setQuery]     = useState('');      // filtro del detalle (título/artista)
  const { play, currentTrack, isPlaying } = usePlayer();

  useEffect(() => { api.playlists().then(setPlaylists); }, []);

  // Tap en la pestaña ya activa → salir del detalle (volver a la lista).
  useEffect(() => {
    if (!target?.reset) return;
    setSelected(null);
    clearTarget();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // Reporta a Layout si hay un detalle abierto (para el Esc de Player). Reactivo a
  // `selected`; el cleanup de desmontaje evita que el flag quede colgado en true.
  useEffect(() => { setDetailOpen(!!selected); }, [selected, setDetailOpen]);
  useEffect(() => () => setDetailOpen(false), [setDetailOpen]);

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
    setConfirmDelete(false); // sin confirmación de borrado a medias al abrir otra playlist
    setSortMode('added');   // cada playlist abre en el default: Añadido ↓
    setSortDir('desc');
    setQuery('');           // y sin filtro (el buscador arranca vacío por playlist)
  }

  function startRename() {
    setConfirmDelete(false); // renombrar y confirmar-borrado son excluyentes
    setRenameVal(selected.playlist.name);
    setRenameEmoji(selected.playlist.emoji || '🎵');
    setRenaming(true);
  }

  async function saveRename(e) {
    e.preventDefault();
    const name = renameVal.trim();
    if (!name) return;
    const updated = await api.updatePlaylist(selected.playlist.id, { name, emoji: renameEmoji });
    setSelected(s => ({ ...s, playlist: { ...s.playlist, name: updated.name, emoji: updated.emoji } }));
    setPlaylists(prev => prev.map(p => (p.id === updated.id ? { ...p, name: updated.name, emoji: updated.emoji } : p)));
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

  // Cambiar de modo arranca en su dirección natural (texto A-Z asc, Añadido desc);
  // tocar el modo YA activo voltea la dirección (toggle asc/desc fusionado).
  function cycleSort(key) {
    if (sortMode === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortMode(key);
      setSortDir(key === 'added' ? 'desc' : 'asc');
    }
  }

  // Array FILTRADO + ORDENADO derivado UNA vez: lo usa tanto el .map() como el
  // índice de play(), para que la pista que suena coincida con la fila visible.
  // El buscador reduce (filtro sobre título/artista, acento/case-insensible), el
  // Riel ordena. .filter() devuelve array nuevo y sortTracks copia con [...tracks]
  // → selected.tracks NUNCA se muta.
  const sortedTracks = useMemo(() => {
    if (!selected) return [];
    const q = norm(query.trim());
    const base = q
      ? selected.tracks.filter(t => norm(t.title).includes(q) || norm(t.artist).includes(q))
      : selected.tracks;
    return sortTracks(base, sortMode, sortDir);
  }, [selected, sortMode, sortDir, query]);

  // ── Detalle de una playlist ──────────────────────────────
  if (selected) {
    const { playlist, tracks } = selected;
    // Duración total: derivada 100% en cliente sumando track.duration (dato ya
    // cargado, el mismo que usa fmt() en la tabla). Tolera null/0. Si el total
    // da 0 → null y el segmento de duración no se muestra (evita "0 min").
    const totalLabel = fmtTotal(tracks.reduce((s, t) => s + (t.duration || 0), 0));
    // Portada del hero: primeras 4 pistas CON carátula, en orden de `selected.tracks`
    // (NO `sortedTracks`, que reordena por el Riel y filtra por el buscador → la
    // portada debe ser ESTABLE). .filter().slice().map() son lecturas: no mutan.
    const heroCoverIds = tracks.filter(t => t.cover_path != null).slice(0, 4).map(t => t.id);
    return (
      <div>
        <button className="back-btn" onClick={() => setSelected(null)}>
          ← Todas las playlists
        </button>

        <div className="detail-hero pl-hero" style={{ '--h': emojiHue(playlist.emoji) }}>
          <div className="detail-hero-cover placeholder pl-hero-cover">
            <PlaylistCover ids={heroCoverIds} emoji={playlist.emoji} />
          </div>
          <div className="detail-hero-info">
            {renaming ? (
              <form className="pl-rename" onSubmit={saveRename}>
                <EmojiPicker value={renameEmoji} onChange={setRenameEmoji} />
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
              <>
                <div className="detail-kicker pl-kicker">Playlist</div>
                <h1 className="detail-title pl-detail-title">
                  {playlist.name}
                  <button className="btn-icon pl-edit" title="Renombrar" onClick={startRename}>
                    <EditIcon />
                  </button>
                </h1>
                <div className="detail-meta">
                  {tracks.length} {tracks.length === 1 ? 'canción' : 'canciones'}
                  {totalLabel && <> · {totalLabel}</>}
                </div>
                <div className="pl-detail-actions">
                  {confirmDelete ? (
                    <div className="pl-del-confirm" role="alertdialog" aria-label="Confirmar borrado de la playlist">
                      <span className="pl-del-confirm-text">¿Seguro que quieres borrar esta playlist?</span>
                      <button
                        type="button"
                        className="pl-del-cancel"
                        onClick={() => setConfirmDelete(false)}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className="pl-del-confirm-btn"
                        onClick={() => remove(playlist.id)}
                      >
                        Borrar
                      </button>
                    </div>
                  ) : (
                    <>
                      {tracks.length > 0 && (
                        <>
                          <button
                            className="btn-primary"
                            onClick={() => play(sortedTracks, 0)}
                            disabled={sortedTracks.length === 0}
                          >
                            ▶ Reproducir
                          </button>
                          <ShuffleButton tracks={query.trim() ? sortedTracks : tracks} />
                        </>
                      )}
                      <button
                        className="btn-icon pl-del-action"
                        title="Eliminar playlist"
                        onClick={() => setConfirmDelete(true)}
                      >
                        <TrashIcon />
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {tracks.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🎶</div>
            <div className="empty-title">Playlist vacía</div>
            <div className="empty-sub">Busca canciones en la Biblioteca y añádelas con el botón “+”.</div>
          </div>
        ) : (
          <>
          <div
            className="pl-search"
            role="search"
            style={{ '--h': emojiHue(playlist.emoji) }}
          >
            <SearchIcon />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setQuery(''); }}
              placeholder="Filtrar en esta playlist…"
              aria-label="Filtrar canciones de la playlist"
            />
            {query && (
              <button
                type="button"
                className="pl-search-clear"
                aria-label="Limpiar filtro"
                onClick={() => setQuery('')}
              >
                <XIcon />
              </button>
            )}
          </div>
          <div
            className="pl-sortbar"
            role="group"
            aria-label="Ordenar pistas"
            style={{ '--h': emojiHue(playlist.emoji) }}
          >
            {SORT_MODES.map(m => {
              const isActive = sortMode === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  className={`pl-sort-seg${isActive ? ' active' : ''}`}
                  aria-pressed={isActive}
                  aria-label={isActive
                    ? `${m.label}, ${sortDir === 'asc' ? 'ascendente' : 'descendente'} (tocar para invertir)`
                    : `Ordenar por ${m.label}`}
                  onClick={() => cycleSort(m.key)}
                >
                  <span className="pl-sort-label">{m.label}</span>
                  {isActive && (
                    <span className="pl-sort-arrow" key={sortDir} aria-hidden="true">
                      {sortDir === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {sortedTracks.length === 0 ? (
            <div className="empty-state pl-search-empty">
              <div className="empty-icon">🔎</div>
              <div className="empty-title">Sin coincidencias</div>
              <div className="empty-sub">Ninguna canción coincide con «{query.trim()}».</div>
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
              {sortedTracks.map((track, i) => {
                const active = currentTrack?.id === track.id;
                return (
                  <tr
                    key={track.id}
                    className={`track-row${active ? ' playing' : ''}`}
                    onClick={() => play(sortedTracks, i)}
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
          </>
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
          {playlists.map((pl, idx) => {
            const n = pl.track_count ?? 0;
            return (
              <li
                key={pl.id}
                className="playlist-item"
                style={{ '--h': emojiHue(pl.emoji), '--i': idx }}
                onClick={() => open(pl)}
              >
                <span className="playlist-medallion">
                  <PlaylistCover ids={parseCovers(pl.sample_covers)} emoji={pl.emoji} lazy />
                </span>
                <div className="playlist-card-text">
                  <div className="playlist-name">{pl.name}</div>
                  <div className="playlist-meta">{n} {n === 1 ? 'canción' : 'canciones'}</div>
                </div>
                <button
                  className="playlist-del"
                  title="Eliminar playlist"
                  aria-label={`Eliminar playlist ${pl.name}`}
                  onClick={e => remove(pl.id, e)}
                >
                  <TrashIcon />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Modos del "Riel Prisma". 'added' usa pt.position (proxy real de fecha de agregado,
// ya viene en cada track); el resto son campos de texto nullable.
const SORT_MODES = [
  { key: 'added',  label: 'Añadido', field: 'position' },
  { key: 'title',  label: 'Título',  field: 'title' },
  { key: 'artist', label: 'Artista', field: 'artist' },
  { key: 'album',  label: 'Álbum',   field: 'album' },
];

// Parsea `pl.sample_covers` del backend: array de track-ids de las primeras 4
// pistas CON carátula (por `position`). Llega como string JSON ("[12,45,78]"),
// puede venir null/ausente. Guarda con try/catch → [] si falla (el collage cae
// al fallback del emoji). Tolera un array ya parseado por si acaso.
function parseCovers(raw) {
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw || '[]'); } catch { return []; }
}

// Normaliza para el filtro del buscador: minúsculas + sin diacríticos (NFD +
// quitar el bloque de combining marks). Conserva espacios/dígitos → "nujabes" ==
// "Nujabes", "daft" matchea "Daft Punk". Puro, cero backend.
function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Ordena una COPIA (nunca muta el original). Comparadores tolerantes a null:
// title/artist/album vacíos van SIEMPRE al final, en ambas direcciones (no se
// invierten con el toggle). localeCompare con acentos/ñ y orden numérico natural.
function sortTracks(tracks, mode, dir) {
  const arr = [...tracks];
  const sign = dir === 'asc' ? 1 : -1;

  if (mode === 'added') {
    arr.sort((a, b) => sign * ((a.position ?? 0) - (b.position ?? 0)));
    return arr;
  }

  const field = mode === 'artist' ? 'artist' : mode === 'album' ? 'album' : 'title';
  arr.sort((a, b) => {
    const av = a[field];
    const bv = b[field];
    const aEmpty = av == null || av === '';
    const bEmpty = bv == null || bv === '';
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;   // null/vacío al fondo, sin importar la dirección
    if (bEmpty) return -1;
    return sign * av.localeCompare(bv, undefined, { sensitivity: 'base', numeric: true });
  });
  return arr;
}

function fmt(s) {
  if (!s) return '—';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

// Duración total de la playlist, formato limpio ("48 min" / "1 h 12 min").
// Devuelve null si el total es 0 (o no hay datos) → el hero oculta el segmento
// en vez de mostrar "0 min". Piso de 1 min para playlists muy cortas.
function fmtTotal(secs) {
  const total = Math.round(secs || 0);
  if (total <= 0) return null;
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  return `${Math.max(1, m)} min`;
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

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  );
}
