import { useState, useRef, useEffect } from 'react';
import { api } from '../api/client.js';
import EmojiPicker from './EmojiPicker.jsx';

// Botón "+" por pista: abre un menú para añadirla a una playlist existente
// o crear una nueva al vuelo. Desde aquí también se pueden RENOMBRAR (con cambio
// de emoji) y BORRAR playlists, sin salir del menú. Persiste vía API.
// `placement`: 'down' (por defecto) o 'up' para abrir el menú hacia arriba
// (útil en el Player, pegado al fondo de la pantalla). `className`: extra para
// adaptar el botón a su contexto (biblioteca, barra, player expandido).
export default function AddToPlaylistMenu({ trackId, placement = 'down', className = '' }) {
  const [open, setOpen]           = useState(false);
  const [playlists, setPlaylists] = useState([]);
  const [newName, setNewName]     = useState('');
  const [emoji, setEmoji]         = useState('🎵');
  const [done, setDone]           = useState(false);
  const [busy, setBusy]           = useState(false);
  const [editingId, setEditingId] = useState(null);   // id de la playlist en edición inline
  const [editName, setEditName]   = useState('');
  const [editEmoji, setEditEmoji] = useState('🎵');
  const [confirmId, setConfirmId] = useState(null);   // id pendiente de confirmar borrado
  const ref = useRef(null);

  // Al abrir: refresca la lista y cierra al hacer clic fuera o con Escape. Al
  // cerrar: descarta cualquier edición/confirmación a medias.
  useEffect(() => {
    if (!open) { setEditingId(null); setConfirmId(null); return; }
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
      const pl = await api.createPlaylist(name, emoji);
      await api.addToPlaylist(pl.id, trackId);
      setNewName('');
      setEmoji('🎵');
      setOpen(false);
      flashDone();
    } finally {
      setBusy(false);
    }
  }

  // ── Renombrar / cambiar emoji ──
  function startEdit(pl) {
    setConfirmId(null);
    setEditingId(pl.id);
    setEditName(pl.name);
    setEditEmoji(pl.emoji || '🎵');
  }
  async function saveEdit(e) {
    e.preventDefault();
    const name = editName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const upd = await api.updatePlaylist(editingId, { name, emoji: editEmoji });
      setPlaylists(prev => prev.map(p =>
        p.id === editingId ? { ...p, name: upd?.name ?? name, emoji: upd?.emoji ?? editEmoji } : p
      ));
      setEditingId(null);
    } finally {
      setBusy(false);
    }
  }

  // ── Borrar (con confirmación inline) ──
  async function doDelete(pl) {
    if (busy) return;
    setBusy(true);
    try {
      await api.deletePlaylist(pl.id);
      setPlaylists(prev => prev.filter(p => p.id !== pl.id));
      setConfirmId(null);
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
              {playlists.map((pl, idx) => (
                <li key={pl.id} className="ptp-item">
                  {editingId === pl.id ? (
                    <form className="ptp-item-edit" onSubmit={saveEdit}>
                      <EmojiPicker value={editEmoji} onChange={setEditEmoji} />
                      <input
                        className="ptp-edit-input"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        placeholder="Nombre"
                        autoFocus
                      />
                      <button type="submit" className="ptp-mini-btn save" title="Guardar" disabled={busy}><CheckSmall /></button>
                      <button type="button" className="ptp-mini-btn" title="Cancelar" onClick={() => setEditingId(null)}><XSmall /></button>
                    </form>
                  ) : confirmId === pl.id ? (
                    <div className="ptp-item-confirm">
                      <span className="ptp-confirm-text">¿Borrar «{pl.name}»?</span>
                      <button className="ptp-mini-btn danger" title="Sí, borrar" onClick={() => doDelete(pl)} disabled={busy}>Sí</button>
                      <button className="ptp-mini-btn" title="No" onClick={() => setConfirmId(null)}>No</button>
                    </div>
                  ) : (
                    <>
                      <button className="ptp-item-main" onClick={() => addTo(pl)} title="Añadir a esta playlist">
                        <span className="ptp-item-emoji" style={{ '--i': idx }}>{pl.emoji || '🎵'}</span>
                        <span className="ptp-item-name">{pl.name}</span>
                        <span className="ptp-item-count">{pl.track_count ?? 0}</span>
                      </button>
                      <div className="ptp-item-actions">
                        <button className="ptp-mini-btn" title="Renombrar" onClick={() => startEdit(pl)}><PencilIcon /></button>
                        <button className="ptp-mini-btn danger-hint" title="Borrar" onClick={() => { setEditingId(null); setConfirmId(pl.id); }}><TrashIcon /></button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          <form className="ptp-new" onSubmit={createAndAdd}>
            <EmojiPicker value={emoji} onChange={setEmoji} />
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Nueva playlist…"
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

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <polyline points="3,6 5,6 21,6" /><path d="M19,6l-1,14H6L5,6" /><path d="M10,11v6" /><path d="M14,11v6" /><path d="M9,6V4h6v2" />
    </svg>
  );
}

function CheckSmall() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function XSmall() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
