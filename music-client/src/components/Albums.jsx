import { useState, useEffect } from 'react';
import { api, coverUrl } from '../api/client.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import ShuffleButton from './ShuffleButton.jsx';
import TrackTable from './TrackTable.jsx';

export default function Albums({ target, clearTarget, setDetailOpen, navigate }) {
  const [albums,   setAlbums]   = useState([]);
  const [selected, setSelected] = useState(null); // { album, tracks }
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const { play } = usePlayer();

  // Función nombrada (no solo inline en el efecto) para poder reusarla desde
  // el botón "Reintentar" del estado de error.
  function loadAlbums() {
    setLoading(true);
    setError(null);
    api.albums().then(setAlbums).catch(setError).finally(() => setLoading(false));
  }

  useEffect(() => {
    loadAlbums();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reporta a Layout si hay un detalle abierto (para el Esc de Player). Reactivo a
  // `selected` (el {reset:true} que ya lo pone en null baja el flag solo). El cleanup
  // de desmontaje evita que el flag quede colgado en true al cambiar de pestaña.
  useEffect(() => { setDetailOpen(!!selected); }, [selected, setDetailOpen]);
  useEffect(() => () => setDetailOpen(false), [setDetailOpen]);

  async function openAlbum(album) {
    // Mismas pistas que AlbumDetail: /api/tracks trae los campos de calidad (para el
    // QualityChip de TrackTable) y filtra por album + album_artist — /albums/:album/tracks
    // no traía la calidad y mezclaba álbumes homónimos de distinto artista.
    const params = { album: album.album, limit: 500 };
    if (album.album_artist) params.album_artist = album.album_artist;
    const tracks = await api.tracks(params);
    setSelected({ ...album, tracks });
  }

  // Consumo del target de navegación (clic en el título de la pista en la barra/
  // expandido). openAlbum necesita el objeto álbum → lo buscamos en la lista por
  // album (+ album_artist si vino). Espera a que la lista termine (loading) para
  // no perder el target. Consumo único: siempre limpia.
  useEffect(() => {
    if (target?.reset) { setSelected(null); clearTarget(); return; }   // tap en la pestaña activa
    if (!target?.album || loading) return;
    const found = albums.find(a =>
      a.album === target.album &&
      (target.album_artist == null || a.album_artist === target.album_artist)
    );
    if (found) openAlbum(found);
    clearTarget();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, loading, albums]);

  if (loading) return <div className="spinner">Cargando álbumes…</div>;

  if (error) {
    return (
      <div className="empty-state">
        <div className="empty-icon">⚠️</div>
        <div className="empty-title">No se pudieron cargar los álbumes</div>
        <div className="empty-sub">Intenta de nuevo en un momento.</div>
        <button className="btn-primary" onClick={loadAlbums}>Reintentar</button>
      </div>
    );
  }

  if (selected) {
    // Detalle unificado con AlbumDetail: hero .detail-* + TrackTable (misma estructura
    // de clases → hereda el tratamiento móvil: carátula 116px, título 22px, columnas
    // Artista/Álbum/Calidad ocultas, chip de calidad inline). La pista que suena se
    // desplaza a la vista dentro de TrackTable.
    return (
      <div>
        <button className="back-btn" onClick={() => window.history.back()}>
          ← Volver
        </button>

        <div className="detail-hero">
          {selected.sample_track_id
            ? <img className="detail-hero-cover" src={coverUrl(selected.sample_track_id)} alt="" />
            : <div className="detail-hero-cover placeholder">♫</div>
          }
          <div className="detail-hero-info">
            <div className="detail-kicker">Álbum</div>
            <h1 className="detail-title">{selected.album}</h1>
            <div className="detail-sub">{selected.album_artist ?? selected.tracks[0]?.artist ?? '—'}</div>
            <div className="detail-meta">
              {selected.year ? `${selected.year} · ` : ''}{selected.track_count ?? selected.tracks.length} canciones
            </div>
            {selected.tracks.length > 0 && (
              <div className="detail-actions">
                <button className="btn-primary" onClick={() => play(selected.tracks, 0)}>▶ Reproducir</button>
                <ShuffleButton tracks={selected.tracks} />
              </div>
            )}
          </div>
        </div>

        <TrackTable tracks={selected.tracks} showAlbum={false} />
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
          <div key={`${album.album}-${album.album_artist}`} className="album-card" onClick={() => navigate('albums', { album: album.album, album_artist: album.album_artist })}>
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
