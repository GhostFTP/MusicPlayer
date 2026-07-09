import { useState, useEffect } from 'react';
import { api, coverUrl } from '../api/client.js';
import AlbumGrid from './AlbumGrid.jsx';
import AlbumDetail from './AlbumDetail.jsx';
import ShuffleButton from './ShuffleButton.jsx';

export default function Artists({ target, clearTarget, setDetailOpen }) {
  const [artists,  setArtists]  = useState(null);
  const [sel,      setSel]      = useState(null);   // artista seleccionado
  const [albums,   setAlbums]   = useState(null);
  const [selAlbum, setSelAlbum] = useState(null);
  const [error,    setError]    = useState(null);

  // Función nombrada (no solo inline en el efecto) para poder reusarla desde
  // el botón "Reintentar" del estado de error.
  function loadArtists() {
    setError(null);
    api.artists().then(setArtists).catch(setError);
  }

  useEffect(() => {
    loadArtists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reporta a Layout si hay un detalle abierto (para el Esc de Player). Detalle
  // anidado: álbumes del artista (`sel`) o un AlbumDetail (`selAlbum`). El cleanup
  // de desmontaje evita que el flag quede colgado en true al cambiar de pestaña.
  useEffect(() => { setDetailOpen(!!(sel || selAlbum)); }, [sel, selAlbum, setDetailOpen]);
  useEffect(() => () => setDetailOpen(false), [setDetailOpen]);

  async function open(a) {
    setSel(a);
    setAlbums(null);
    setAlbums(await api.albums({ artist: a.artist }));
  }

  // Consumo del target de navegación (clic en el artista de la barra/expandido).
  // El target trae album_artist; la lista se agrupa por album_artist (alias
  // `artist`), así que el match es directo. Espera a que la lista cargue (deps).
  // Consumo único: siempre limpia; si no existe, queda en la lista.
  useEffect(() => {
    if (target?.reset) { setSel(null); setSelAlbum(null); setAlbums(null); clearTarget(); return; }
    if (!target?.artist || !artists) return;
    const a = artists.find(x => x.artist === target.artist);
    if (a) open(a);
    clearTarget();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, artists]);

  // ── Álbum abierto desde un artista ──
  if (selAlbum) {
    return <AlbumDetail album={selAlbum} onBack={() => setSelAlbum(null)} />;
  }

  // ── Detalle: los álbumes de un artista ──
  if (sel) {
    return (
      <div>
        <button className="back-btn" onClick={() => { setSel(null); setAlbums(null); }}>
          ← Todos los artistas
        </button>
        <div className="section-header">
          <h1 className="section-title">{sel.artist}</h1>
          <div className="detail-actions">
            <span className="section-count">{sel.album_count} álbumes · {sel.track_count} pistas</span>
            <ShuffleButton getTracks={() => api.tracks({ album_artist: sel.artist, limit: 10000 })} />
          </div>
        </div>
        {albums ? <AlbumGrid albums={albums} onOpen={setSelAlbum} /> : <div className="spinner">Cargando…</div>}
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state">
        <div className="empty-icon">⚠️</div>
        <div className="empty-title">No se pudieron cargar los artistas</div>
        <div className="empty-sub">Intenta de nuevo en un momento.</div>
        <button className="btn-primary" onClick={loadArtists}>Reintentar</button>
      </div>
    );
  }

  if (!artists) return <div className="spinner">Cargando artistas…</div>;
  if (artists.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🎤</div>
        <div className="empty-title">Sin artistas</div>
        <div className="empty-sub">Escanea tu música para empezar.</div>
      </div>
    );
  }

  // ── Lista de artistas ──
  return (
    <div>
      <div className="section-header">
        <h1 className="section-title">Artistas</h1>
        <div className="detail-actions">
          <span className="section-count">{artists.length} artistas</span>
          <ShuffleButton getTracks={() => api.tracks({ limit: 10000 })} />
        </div>
      </div>
      <div className="album-grid">
        {artists.map(a => (
          <div key={a.artist} className="album-card artist-card" onClick={() => open(a)}>
            {a.sample_track_id
              ? <img className="album-cover artist-avatar" src={coverUrl(a.sample_track_id)} alt="" />
              : <div className="album-cover-placeholder artist-avatar">♪</div>
            }
            <div className="album-name">{a.artist}</div>
            <div className="album-count">{a.album_count} álbumes · {a.track_count} pistas</div>
          </div>
        ))}
      </div>
    </div>
  );
}
