// Chip toggle «Recién añadidas» (utils/recientes.js). Sólo es el botón: el estado vive en la vista que
// lo usa (no persiste: ni localStorage ni URL; se reinicia al salir de la vista, como el buscador).
// Lo comparten las vistas que lo lleven. aria-pressed + un <button> real: Enter lo alterna y el foco se
// queda donde está (el Espacio lo consume el atajo global del reproductor: PlayerContext.jsx).
//
// `busy`: está pidiendo la biblioteca tras el primer toque (utils/useRecientes.js). Igual que el Mix NO
// usa `disabled` nativo —perdería el foco—: queda aria-busy, y el nombre accesible lo dice. El clic sigue
// vivo a propósito: tocarlo otra vez mientras carga CANCELA la intención.
// `disabled`: para la vista que de verdad no puede usarlo (hoy ninguna lo necesita al cargar).
// `onWarm`: precarga opcional, sólo con ratón encima o foco de teclado (nunca con el dedo ni al hacer clic).
import { N_RECIENTES } from '../utils/recientes.js';

const focoDeTeclado = (el) => { try { return el.matches(':focus-visible'); } catch { return false; } };

export default function RecientesChip({ on, onToggle, n = N_RECIENTES, disabled = false, busy = false, onWarm }) {
  return (
    <button
      type="button"
      className="recientes-chip"
      aria-pressed={on}
      aria-busy={busy || undefined}
      aria-label={busy ? 'Recién añadidas, cargando…' : undefined}
      disabled={disabled}
      title={`Las ${n} pistas más recientes de la biblioteca`}
      onClick={onToggle}
      onPointerEnter={onWarm ? (e) => { if (e.pointerType === 'mouse') onWarm(); } : undefined}
      onFocus={onWarm ? (e) => { if (focoDeTeclado(e.currentTarget)) onWarm(); } : undefined}
    >
      <span className="recientes-chip-ico" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" focusable="false">
          <path d="M12 2.5c.5 4.8 2.7 7 7.5 9.5-4.8 2.5-7 4.7-7.5 9.5-.5-4.8-2.7-7-7.5-9.5C9.3 9.5 11.5 7.3 12 2.5z" />
        </svg>
      </span>
      Recién añadidas
    </button>
  );
}
