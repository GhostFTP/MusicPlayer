import { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import AlbumGrid from './AlbumGrid.jsx';
import AlbumDetail from './AlbumDetail.jsx';
import ShuffleButton from './ShuffleButton.jsx';

export default function Years({ target, clearTarget, setDetailOpen }) {
  const [years,    setYears]    = useState(null);
  const [sel,      setSel]      = useState(null);   // año seleccionado
  const [albums,   setAlbums]   = useState(null);
  const [selAlbum, setSelAlbum] = useState(null);

  useEffect(() => { api.years().then(setYears); }, []);

  // Tap en la pestaña ya activa → salir del detalle (volver a la lista).
  useEffect(() => {
    if (!target?.reset) return;
    setSel(null); setSelAlbum(null); setAlbums(null);
    clearTarget();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // Reporta a Layout si hay un detalle abierto (para el Esc de Player). Detalle
  // anidado: álbumes del año (`sel`) o un AlbumDetail (`selAlbum`). El cleanup de
  // desmontaje evita que el flag quede colgado en true al cambiar de pestaña.
  useEffect(() => { setDetailOpen(!!(sel || selAlbum)); }, [sel, selAlbum, setDetailOpen]);
  useEffect(() => () => setDetailOpen(false), [setDetailOpen]);

  async function open(y) {
    setSel(y);
    setAlbums(null);
    setAlbums(await api.albums({ year: y.year }));
  }

  // ── Álbum abierto desde un año ──
  if (selAlbum) {
    return <AlbumDetail album={selAlbum} onBack={() => setSelAlbum(null)} />;
  }

  // ── Detalle: los álbumes de un año ──
  if (sel) {
    return (
      <div>
        <button className="back-btn" onClick={() => { setSel(null); setAlbums(null); }}>
          ← Todos los años
        </button>
        <div className="section-header">
          <h1 className="section-title">{sel.year}</h1>
          <div className="detail-actions">
            <span className="section-count">{sel.album_count} álbumes · {sel.track_count} pistas</span>
            <ShuffleButton getTracks={() => api.tracks({ year: sel.year, limit: 10000 })} />
          </div>
        </div>
        {albums ? <AlbumGrid albums={albums} onOpen={setSelAlbum} /> : <div className="spinner">Cargando…</div>}
      </div>
    );
  }

  if (!years) return <div className="spinner">Cargando años…</div>;
  if (years.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">📅</div>
        <div className="empty-title">Sin años</div>
        <div className="empty-sub">Tus pistas no tienen año en las etiquetas.</div>
      </div>
    );
  }

  // ── Lista de años (uno por uno, desc) ──
  return (
    <div>
      <div className="section-header">
        <h1 className="section-title">Años</h1>
        <div className="detail-actions">
          <span className="section-count">{years.length} años</span>
          <ShuffleButton getTracks={() => api.tracks({ limit: 10000 })} />
        </div>
      </div>
      <ul className="browse-list">
        {years.map(y => (
          <li key={y.year} className="browse-item" onClick={() => open(y)}>
            <span className="browse-item-name">{y.year}</span>
            <span className="browse-item-meta">{y.album_count} álbumes · {y.track_count} pistas</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
