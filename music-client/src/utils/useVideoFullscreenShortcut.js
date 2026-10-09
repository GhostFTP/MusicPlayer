import { useEffect, useRef } from 'react';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useContextMenu } from '../components/ContextMenu.jsx';

// Atajo global "F" (T27): entra o sale de la pantalla completa del VIDEO que suena. Sin un video
// sonando no hace nada. Se monta en Layout, como la M (useMixShortcut.js), y calca sus guardas:
//   1. e.defaultPrevented, e.repeat, composición de IME
//   2. Ctrl/Meta/Alt (Ctrl+F es buscar en la página)
//   3. e.code === 'KeyF' (por posición: igual con mayúsculas o cualquier distribución)
//   4. foco en un campo de texto: escribir una "f" nunca cambia la pantalla
//   5. un menú o diálogo abierto — sólo para ENTRAR: en pantalla completa no se ve nada de afuera,
//      y la F tiene que poder sacarte siempre.
// Las dos listas son copia de useMixShortcut.js (no se exportan desde ahí): si cambian allá, acá también.
const TEXT_FIELDS = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="combobox"], [role="searchbox"]';
const BLOCKING = '.ctx-menu, .ptp-menu, .emoji-grid, .info-overlay, [role="dialog"], [aria-modal="true"]';

export function useVideoFullscreenShortcut() {
  const { currentTrack, isVideoFullscreen, enterVideoFullscreen, exitVideoFullscreen } = usePlayer();
  const { menuOpen } = useContextMenu();
  // Lo que cambia entre renders se lee por ref: el listener se registra UNA vez.
  const live = useRef(null);
  live.current = { currentTrack, isVideoFullscreen, enterVideoFullscreen, exitVideoFullscreen, menuOpen };

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.defaultPrevented || e.repeat || e.isComposing) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code !== 'KeyF') return;
      const t = e.target;
      // La barra de tiempo de los controles es un <input type="range">: no es un campo de texto y,
      // en pantalla completa, suele tener el foco. Es la única diferencia con las guardas de la M.
      const isRange = t?.tagName === 'INPUT' && t.type === 'range';
      if ((!isRange && t?.closest?.(TEXT_FIELDS)) || t?.isContentEditable) return;
      const s = live.current;
      if (s.currentTrack?.kind !== 'video') return;
      if (s.isVideoFullscreen) { e.preventDefault(); s.exitVideoFullscreen(); return; }
      if (s.menuOpen || document.querySelector(BLOCKING)) return;
      e.preventDefault();
      s.enterVideoFullscreen();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
