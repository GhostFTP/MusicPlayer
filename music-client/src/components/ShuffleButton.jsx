import { useState } from 'react';
import { usePlayer } from '../context/PlayerContext.jsx';

// Baraja una copia (Fisher–Yates) sin mutar el original.
function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Botón "Mix aleatorio" reutilizable: baraja las pistas dadas, reproduce y activa
// el modo shuffle del PlayerContext. Recibe la lista directa (`tracks`) o un
// cargador asíncrono (`getTracks`) para vistas que aún no tienen la lista cargada.
export default function ShuffleButton({ tracks, getTracks, label = 'Mix aleatorio' }) {
  const { play, shuffle, toggleShuffle } = usePlayer();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    let list = tracks;
    if ((!list || list.length === 0) && getTracks) {
      setBusy(true);
      try { list = await getTracks(); } finally { setBusy(false); }
    }
    if (!list || list.length === 0) return;
    play(shuffled(list), 0);
    if (!shuffle) toggleShuffle();
  };

  const disabled = busy || (tracks ? tracks.length === 0 : !getTracks);

  return (
    <button
      className="mix-btn"
      onClick={run}
      disabled={disabled}
      title="Baraja estas canciones y reproduce al azar"
    >
      <ShuffleIcon size={18} />
      {busy ? 'Cargando…' : label}
    </button>
  );
}

function ShuffleIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 3 21 3 21 8" />
      <line x1="4" y1="20" x2="21" y2="3" />
      <polyline points="21 16 21 21 16 21" />
      <line x1="15" y1="15" x2="21" y2="21" />
      <line x1="4" y1="4" x2="9" y2="9" />
    </svg>
  );
}
