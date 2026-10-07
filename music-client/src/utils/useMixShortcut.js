import { useEffect, useRef } from 'react';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { useContextMenu } from '../components/ContextMenu.jsx';
import { libraryTracks } from './viewTracks.js';
import { shuffled, MIN_TRACKS, ERROR_TOAST_MS, MIX_ERROR_TEXT } from './mixPlayback.js';

// Atajo global "M" (Frente 2, M3): mezcla TODA la biblioteca, desde cualquier vista. El botón de
// cada vista mezcla SU vista; esto no mira la vista ni la búsqueda: siempre la biblioteca completa
// (la lista 'tracks:all' de viewCache, por usuario; si no está, UN pedido que además la deja en caché).
// Mismo barajado, misma reproducción y mismo aviso de error que ShuffleButton (utils/mixPlayback.js).
//
// Se monta en Layout, que sólo existe con sesión iniciada. NO toca PlayerContext: escucha su propio
// keydown en window. Guardas, en orden:
//   1. e.defaultPrevented, e.repeat (mantener M apretada no repite), composición de IME
//   2. Ctrl/Meta/Alt (atajos del navegador o del sistema: Cmd+M minimiza en macOS). Shift sí vale.
//   3. e.code === 'KeyM' (por posición: igual con mayúsculas o cualquier distribución)
//   4. foco en un campo de texto (input, textarea, select, contenteditable, role textbox/combobox/
//      searchbox): escribir una "m" nunca mezcla
//   5. un menú o diálogo abierto (menú contextual, menú "+", selector de emoji, panel de Info, o
//      cualquier role="dialog"/aria-modal): la M no actúa por debajo de una capa así. Cola, letra y
//      expandido NO bloquean (no son diálogos; Espacio y las flechas también funcionan con ellos).
//   6. un pedido en vuelo
// Con un BOTÓN enfocado SÍ actúa: la M no choca con Enter/Espacio (el problema de Espacio con un
// botón enfocado es de PlayerContext y está anotado para M4).
const TEXT_FIELDS = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="combobox"], [role="searchbox"]';
const BLOCKING = '.ctx-menu, .ptp-menu, .emoji-grid, .info-overlay, [role="dialog"], [aria-modal="true"]';

export function useMixShortcut() {
  const { play, shuffle, toggleShuffle } = usePlayer();
  const toast = useToast();
  const { menuOpen } = useContextMenu();
  // Lo que cambia entre renders se lee por ref: el listener se registra UNA vez.
  const live = useRef(null);
  live.current = { play, shuffle, toggleShuffle, toast, menuOpen };
  const inFlight = useRef(false);
  const lastErrorToast = useRef(0);

  useEffect(() => {
    const onKeyDown = async (e) => {
      if (e.defaultPrevented || e.repeat || e.isComposing) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code !== 'KeyM') return;
      const t = e.target;
      if (t?.closest?.(TEXT_FIELDS) || t?.isContentEditable) return;
      if (live.current.menuOpen || document.querySelector(BLOCKING)) return;
      if (inFlight.current) return;
      e.preventDefault();
      inFlight.current = true;
      try {
        let list;
        try {
          list = await libraryTracks();
        } catch (err) {
          const now = Date.now();
          if (err?.status !== 401 && now - lastErrorToast.current > ERROR_TOAST_MS) {
            lastErrorToast.current = now;
            live.current.toast(MIX_ERROR_TEXT, { variant: 'warning' });
          }
          return;
        }
        if (!list || list.length < MIN_TRACKS) return;
        const { play: p, shuffle: on, toggleShuffle: toggle } = live.current;
        p(shuffled(list), 0);
        if (!on) toggle();
      } finally {
        inFlight.current = false;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
