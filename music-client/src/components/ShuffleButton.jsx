import { useRef, useState } from 'react';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useToast } from './Toast.jsx';
import { shuffled, MIN_TRACKS, ERROR_TOAST_MS, MIX_ERROR_TEXT } from '../utils/mixPlayback.js';

// shuffled, MIN_TRACKS, ERROR_TOAST_MS y el texto del aviso viven en utils/mixPlayback.js (Frente 2,
// M3): los comparte el atajo de teclado M, así botón y atajo se comportan igual.

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
//    normal sin reproducir ni dejar un rechazo sin atrapar.
//
// Frente 2 · M2c:
//  · Aviso de error: el toast ámbar de la casa (useToast, variant 'warning'), con el MISMO texto que
//    el menú contextual y el arrastre a la cola. Uno por intento y sin repetirse mientras sigue en
//    pantalla. Con 401 NO hay aviso: el cliente ya cierra la sesión. Con la cuenta cambiada a mitad
//    del pedido (el helper devuelve []) tampoco: no es un error.
//  · Mientras pide la lista el botón NO usa `disabled` nativo: un botón deshabilitado pierde el foco
//    (se iba a <body> al activarlo con el teclado). Queda con aria-disabled + aria-busy, el clic
//    repetido lo frena el guard de inFlight, y se ve igual que antes (main.css: [aria-busy="true"]
//    comparte la regla de :disabled). Con < 2 pistas sigue siendo disabled real.
//
// `onPlayed` (opcional, V8c): se llama DESPUÉS de arrancar el Mix. Hoy sólo lo pasa el detalle de
// playlist, para avisar los videos que quedaron afuera; sin él, el botón hace exactamente lo de antes.
export default function ShuffleButton({ tracks, getTracks, count, label = 'Mix aleatorio', onPlayed }) {
  const { play, shuffle, toggleShuffle } = usePlayer();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const lastErrorToast = useRef(0);

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
        try {
          list = await getTracks();
        } catch (err) {
          list = null;
          const now = Date.now();
          if (err?.status !== 401 && now - lastErrorToast.current > ERROR_TOAST_MS) {
            lastErrorToast.current = now;
            toast(MIX_ERROR_TEXT, { variant: 'warning' });
          }
        } finally {
          setBusy(false);
        }
      }
      if (!list || list.length < MIN_TRACKS) return;
      play(shuffled(list), 0);
      if (!shuffle) toggleShuffle();
      onPlayed?.();
    } finally {
      inFlight.current = false;
    }
  };

  // disabled REAL sólo cuando no hay nada que mezclar; ocupado = aria-disabled (conserva el foco).
  const disabled = tooFew || (!tracks && !getTracks);

  return (
    <button
      type="button"
      className="mix-btn"
      onClick={run}
      disabled={disabled}
      aria-disabled={disabled || busy || undefined}
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
