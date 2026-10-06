import { useToast } from './Toast.jsx';
import { trackMessage, shareAndNotify } from '../utils/share.js';

// Botón visible de Compartir del reproductor expandido (alternativa 1: junto al "+"), el mismo
// lugar que en la app iOS (full-player.tsx). Comparte la pista que suena con el texto de siempre
// (utils/share.js): en táctil la hoja del sistema, en escritorio el portapapeles + toast.
export default function ShareButton({ track }) {
  const toast = useToast();
  return (
    <button
      type="button"
      className="exp-icon-btn exp-share"
      title="Compartir"
      aria-label="Compartir"
      disabled={!track}
      onClick={(e) => { e.stopPropagation(); if (track) shareAndNotify(trackMessage(track, window.location.origin), toast); }}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3v12" /><path d="M7.5 7.5 12 3l4.5 4.5" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
      </svg>
    </button>
  );
}
