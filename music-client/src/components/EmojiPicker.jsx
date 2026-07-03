import { useState, useRef, useEffect } from 'react';

// Emojis comunes de música / vibras. Sin dependencias externas (emoji nativo).
export const PLAYLIST_EMOJIS = [
  '🎵', '🎶', '🔥', '💜', '🌊', '⚡',
  '🌙', '✨', '🎧', '🥁', '🎸', '🎹',
  '🎤', '🎷', '🎺', '🎻', '🌈', '☀️',
  '❄️', '🍃', '💫', '🖤', '💃', '🚀',
];

// Botón con el emoji elegido que abre un grid para escoger otro. Controlado:
// `value` (emoji actual) + `onChange(emoji)`. Cierra al elegir, clic fuera o Esc.
export default function EmojiPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="emoji-picker" ref={ref} onClick={e => e.stopPropagation()}>
      <button
        type="button"
        className="emoji-picker-btn"
        title="Elegir emoji"
        onClick={() => setOpen(o => !o)}
      >
        {value || '🎵'}
      </button>

      {open && (
        <div className="emoji-grid">
          {PLAYLIST_EMOJIS.map(em => (
            <button
              type="button"
              key={em}
              className={`emoji-cell${em === value ? ' active' : ''}`}
              onClick={() => { onChange(em); setOpen(false); }}
            >
              {em}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
