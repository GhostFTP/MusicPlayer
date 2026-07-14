import { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import AlbumGrid from './AlbumGrid.jsx';
import AlbumDetail from './AlbumDetail.jsx';
import ArtistImage from './ArtistImage.jsx';
import ShuffleButton from './ShuffleButton.jsx';

export default function Artists({ target, clearTarget, setDetailOpen }) {
  const [artists,  setArtists]  = useState(null);
  const [sel,      setSel]      = useState(null);   // artista seleccionado
  const [detail,   setDetail]   = useState(null);   // agregados del artista (chips del hero)
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

  // Géneros + desglose de calidad para los chips del hero. Son datos LOCALES que el backend
  // ya devolvía y esta vista ignoraba (solo los usaba el InfoPanel) → cero backend nuevo.
  // Si falla, degrada en silencio: el hero se queda sin chips, no aparece un error.
  useEffect(() => {
    if (!sel) { setDetail(null); return; }
    let cancelled = false;
    setDetail(null);
    api.artistDetail(sel.artist)
      .then(d => { if (!cancelled) setDetail(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [sel]);

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
    const q = detail?.quality;
    return (
      <div>
        <button className="back-btn" onClick={() => { setSel(null); setAlbums(null); }}>
          ← Todos los artistas
        </button>

        {/* Hero: la foto a sangre. Esta era la ÚNICA vista con detalle sin hero — el nombre
            era un <h1> desnudo sobre la grilla de álbumes. El kicker "ARTISTA" en morado es
            lo que la separa de un detalle de álbum de un vistazo. */}
        <div className="artist-hero">
          <ArtistImage artist={sel} className="artist-hero-bg" />
          <div className="artist-hero-body">
            <div className="artist-hero-kicker">Artista</div>
            <h1 className="artist-hero-name">{sel.artist}</h1>
            <div className="artist-hero-chips">
              <span className="artist-chip artist-chip-q">{sel.album_count} álbumes</span>
              <span className="artist-chip artist-chip-q">{sel.track_count} pistas</span>
              {detail?.genres?.map(g => <span key={g} className="artist-chip">{g}</span>)}
              {q?.hires    > 0 && <span className="artist-chip artist-chip-q q-hires">{q.hires} hi-res</span>}
              {q?.lossless > 0 && <span className="artist-chip artist-chip-q q-lossless">{q.lossless} lossless</span>}
              {q?.lossy    > 0 && <span className="artist-chip artist-chip-q q-lossy">{q.lossy} lossy</span>}
              <ShuffleButton getTracks={() => api.tracks({ album_artist: sel.artist, limit: 10000 })} />
            </div>
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
      {/* Grilla propia, NO `.album-grid`: la tarjeta ES la foto (retrato 3:4 a sangre, texto
          encima). Antes esto era literalmente la tarjeta de Álbumes con la miniatura
          redonda — y como esa miniatura era una carátula, un artista de un solo álbum se
          veía casi idéntico a su propio álbum en la otra pestaña. */}
      <div className="artist-grid">
        {artists.map(a => (
          <div key={a.artist} className="artist-portrait" onClick={() => open(a)}>
            <ArtistImage artist={a} />
            <div className="artist-portrait-info">
              <div className="artist-portrait-name">{a.artist}</div>
              <div className="artist-portrait-count">{a.album_count} álbumes · {a.track_count} pistas</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
