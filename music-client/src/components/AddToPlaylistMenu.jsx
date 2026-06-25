import { useState, useRef, useEffect } from 'react';
import { api } from '../api/client.js';

// Botón "+" por pista: abre un menú para añadirla a una playlist existente
// o crear una nueva al vuelo. Persiste vía API (no estado local).
// `placement`: 'down' (por defecto) o 'up' para abrir el menú hacia arriba
// (útil en el Player, pegado al fondo de la pantalla). `className`: extra para
// adaptar el botón a su contexto (biblioteca, barra, player expandido).
export default function AddToPlaylistMenu({ trackId, placement = 'down', className = '' }) {
  const [open, setOpen]           = useState(false);
  const [playlists, setPlaylists] = useState([]);
  const [newName, setNewName]     = useState('');
  const [done, setDone]           = useState(false);
  const [busy, setBusy]           = useState(false);
  const ref = useRef(null);

  // Al abrir: refresca la lista y cierra al hacer clic fuera o con Escape.
  useEffect(() => {
    if (!open) return;
    api.playlists().then(setPlaylists).catch(() => {});

    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function flashDone() {
    setDone(true);
    setTimeout(() => setDone(false), 1600);
  }

  async function addTo(playlist) {
    if (busy) return;
    setBusy(true);
    try {
      await api.addToPlaylist(playlist.id, trackId);
      setOpen(false);
      flashDone();
    } finally {
      setBusy(false);
    }
  }

  async function createAndAdd(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const pl = await api.createPlaylist(name);
      await api.addToPlaylist(pl.id, trackId);
      setNewName('');
      setOpen(false);
      flashDone();
    } finally {
      setBusy(false);
    }
  }

  const active = open || done;
  const cls = ['ptp', active && 'active', placement === 'up' && 'ptp-up', className]
    .filter(Boolean).join(' ');

  return (
    <div className={cls} ref={ref} onClick={e => e.stopPropagation()}>
      <button
        className="ptp-btn"
        title={done ? 'Añadida' : 'Añadir a playlist'}
        onClick={() => setOpen(o => !o)}
      >
        {done ? <CheckIcon /> : <PlusIcon />}
      </button>

      {open && (
        <div className="ptp-menu">
          <div className="ptp-menu-head">Añadir a playlist</div>

          {playlists.length > 0 && (
            <ul className="ptp-list">
              {playlists.map(pl => (
                <li key={pl.id} className="ptp-item" onClick={() => addTo(pl)}>
                  <span className="ptp-item-name">{pl.name}</span>
                  <span className="ptp-item-count">{pl.track_count ?? 0}</span>
                </li>
              ))}
            </ul>
          )}

          <form className="ptp-new" onSubmit={createAndAdd}>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Nueva playlist…"
              autoFocus
            />
            <button className="ptp-new-btn" type="submit" title="Crear y añadir">+</button>
          </form>
        </div>
      )}
    </div>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5ee19a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
