import { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import AlbumGrid from './AlbumGrid.jsx';
import AlbumDetail from './AlbumDetail.jsx';
import ShuffleButton from './ShuffleButton.jsx';

export default function Years({ target, clearTarget, setDetailOpen, setNestedOpen, navigate }) {
  const [years,    setYears]    = useState(null);
  const [sel,      setSel]      = useState(null);   // año seleccionado
  const [albums,   setAlbums]   = useState(null);
  const [selAlbum, setSelAlbum] = useState(null);

  useEffect(() => { api.years().then(setYears); }, []);

  // Consumo del target de navegación: closeNested cierra solo el álbum anidado; reset vuelve a
  // la lista; { year } abre el detalle del año (F1.3b: deep-link /years/2007 y pop de ruta). El
  // year llega como NÚMERO (coerción en pathToState) → matchea y.year (INTEGER) con ===.
  useEffect(() => {
    if (target?.closeNested) { setSelAlbum(null); clearTarget(); return; }
    if (target?.reset) { setSel(null); setSelAlbum(null); setAlbums(null); clearTarget(); return; }
    if (target?.year == null || !years) return;
    const y = years.find(x => x.year === target.year);
    if (y) open(y);
    clearTarget();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, years]);

  // Reporta a Layout: detailOpen (primer nivel o anidado) para el GATE del swipe; nestedOpen
  // (SOLO el álbum anidado `selAlbum`) para el guardia/escalón de Player. Cleanups de desmontaje
  // evitan flags colgados al cambiar de pestaña.
  useEffect(() => { setDetailOpen(!!(sel || selAlbum)); }, [sel, selAlbum, setDetailOpen]);
  useEffect(() => () => setDetailOpen(false), [setDetailOpen]);
  useEffect(() => { setNestedOpen(!!selAlbum); }, [selAlbum, setNestedOpen]);
  useEffect(() => () => setNestedOpen(false), [setNestedOpen]);

  async function open(y) {
    setSel(y);
    setAlbums(null);
    setAlbums(await api.albums({ year: y.year }));
  }

  // ── Álbum abierto desde un año ──
  if (selAlbum) {
    return <AlbumDetail album={selAlbum} onBack={() => window.history.back()} />;
  }

  // ── Detalle: los álbumes de un año ──
  if (sel) {
    return (
      <div>
        <button className="back-btn" onClick={() => window.history.back()}>
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
          <li key={y.year} className="browse-item" onClick={() => navigate('years', { year: y.year })}>
            <span className="browse-item-name">{y.year}</span>
            <span className="browse-item-meta">{y.album_count} álbumes · {y.track_count} pistas</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
