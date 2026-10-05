import { useRef, useState } from 'react';
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

// Con menos de esto no hay nada que mezclar: el botón queda visible pero deshabilitado.
const MIN_TRACKS = 2;

// Botón "Mix aleatorio" reutilizable (los 10 usos de la app): baraja las pistas dadas, reproduce y
// activa el modo shuffle del PlayerContext. Recibe la lista directa (`tracks`) o un cargador
// asíncrono (`getTracks`) para vistas que aún no tienen la lista cargada.
//
// Frente 2 · M2b:
//  · `count`: cuántas pistas tiene la vista cuando se usa `getTracks` (la vista ya lo muestra en su
//    contador → no hay que pedir la lista en cada render). Con `tracks` se usa su largo. Sin dato
//    (lista de la vista aún no cargada) el botón queda habilitado y `run` decide al tener la lista.
//  · Con 0 o 1 pista: deshabilitado y el title explica por qué; `run` tampoco reproduce < 2.
//  · Un solo pedido y una sola reproducción por gesto: guard por ref (sobrevive al re-render) y el
//    2.º clic de un doble clic (event.detail > 1) se ignora.
//  · Si el pedido falla (401, red, cuenta cambiada → el helper devuelve []), vuelve a su estado
//    normal sin reproducir ni dejar un rechazo sin atrapar. Aviso visual: pendiente de decisión.
export default function ShuffleButton({ tracks, getTracks, count, label = 'Mix aleatorio' }) {
  const { play, shuffle, toggleShuffle } = usePlayer();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const known = tracks ? tracks.length : count;
  const tooFew = known != null && known < MIN_TRACKS;

  const run = async (e) => {
    if (e?.detail > 1) return;                   // 2.º clic de un doble clic
    if (inFlight.current || tooFew) return;
    inFlight.current = true;
    try {
      let list = tracks;
      if ((!list || list.length === 0) && getTracks) {
        setBusy(true);
        try { list = await getTracks(); } catch { list = null; } finally { setBusy(false); }
      }
      if (!list || list.length < MIN_TRACKS) return;
      play(shuffled(list), 0);
      if (!shuffle) toggleShuffle();
    } finally {
      inFlight.current = false;
    }
  };

  const disabled = busy || tooFew || (!tracks && !getTracks);

  return (
    <button
      type="button"
      className="mix-btn"
      onClick={run}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      aria-busy={busy || undefined}
      title={tooFew ? 'No hay suficientes canciones para mezclar' : 'Baraja estas canciones y reproduce al azar'}
    >
      <ShuffleIcon size={18} />
      {busy ? 'Cargando…' : label}
    </button>
  );
}

function ShuffleIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <polyline points="16 3 21 3 21 8" />
      <line x1="4" y1="20" x2="21" y2="3" />
      <polyline points="21 16 21 21 16 21" />
      <line x1="15" y1="15" x2="21" y2="21" />
      <line x1="4" y1="4" x2="9" y2="9" />
    </svg>
  );
}
