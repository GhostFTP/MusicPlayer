import { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import TrackTable from './TrackTable.jsx';
import ShuffleButton from './ShuffleButton.jsx';

export default function Genres({ target, clearTarget }) {
  const [genres, setGenres] = useState(null);
  const [sel,    setSel]    = useState(null);   // género seleccionado
  const [tracks, setTracks] = useState(null);
  const { play } = usePlayer();

  useEffect(() => { api.genres().then(setGenres); }, []);

  async function open(g) {
    setSel(g);
    setTracks(null);
    setTracks(await api.tracks({ genre: g.genre, limit: 500 }));
  }

  // Consumo del target de navegación (clic en el género de la barra del player).
  // Corre cuando hay target Y la lista ya cargó (por eso `genres` está en deps:
  // resuelve el timing del fetch async). Abre el género si existe; si no, no pasa
  // nada. Siempre limpia el target → consumo único (volver por el menú muestra la
  // lista, no el género anterior). clearTarget queda fuera de deps a propósito.
  useEffect(() => {
    if (target?.reset) { setSel(null); setTracks(null); clearTarget(); return; }
    if (!target?.genre || !genres) return;
    const g = genres.find(x => x.genre === target.genre);
    if (g) open(g);
    clearTarget();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, genres]);

  // ── Detalle: la música de un género ──
  if (sel) {
    return (
      <div>
        <button className="back-btn" onClick={() => { setSel(null); setTracks(null); }}>
          ← Todos los géneros
        </button>
        <div className="section-header">
          <h1 className="section-title">{sel.genre}</h1>
          {tracks && tracks.length > 0 && (
            <div className="detail-actions">
              <button className="btn-primary" onClick={() => play(tracks, 0)}>▶ Reproducir</button>
              <ShuffleButton tracks={tracks} />
            </div>
          )}
        </div>
        {tracks ? <TrackTable tracks={tracks} /> : <div className="spinner">Cargando…</div>}
      </div>
    );
  }

  if (!genres) return <div className="spinner">Cargando géneros…</div>;
  if (genres.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🏷️</div>
        <div className="empty-title">Sin géneros</div>
        <div className="empty-sub">Escanea tu música; los géneros salen de las etiquetas.</div>
      </div>
    );
  }

  // ── Lista de géneros ──
  return (
    <div>
      <div className="section-header">
        <h1 className="section-title">Géneros</h1>
        <div className="detail-actions">
          <span className="section-count">{genres.length} géneros</span>
          <ShuffleButton getTracks={() => api.tracks({ limit: 10000 })} />
        </div>
      </div>
      <ul className="browse-list">
        {genres.map(g => (
          <li key={g.genre} className="browse-item" onClick={() => open(g)}>
            <span className="browse-item-name">{g.genre}</span>
            <span className="browse-item-meta">{g.track_count} pistas · {g.album_count} álbumes</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
