import { useState, useEffect } from 'react';
import { api, coverUrl } from '../api/client.js';
import AlbumGrid from './AlbumGrid.jsx';
import AlbumDetail from './AlbumDetail.jsx';
import ShuffleButton from './ShuffleButton.jsx';

export default function Artists() {
  const [artists,  setArtists]  = useState(null);
  const [sel,      setSel]      = useState(null);   // artista seleccionado
  const [albums,   setAlbums]   = useState(null);
  const [selAlbum, setSelAlbum] = useState(null);

  useEffect(() => { api.artists().then(setArtists); }, []);

  async function open(a) {
    setSel(a);
    setAlbums(null);
    setAlbums(await api.albums({ artist: a.artist }));
  }

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
