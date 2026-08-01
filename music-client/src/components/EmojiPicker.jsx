import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

// Emojis comunes de música / vibras. Sin dependencias externas (emoji nativo).
export const PLAYLIST_EMOJIS = [
  '🎵', '🎶', '🔥', '💜', '🌊', '⚡',
  '🌙', '✨', '🎧', '🥁', '🎸', '🎹',
  '🎤', '🎷', '🎺', '🎻', '🌈', '☀️',
  '❄️', '🍃', '💫', '🖤', '💃', '🚀',
];

const MARGIN = 8;   // aire mínimo contra el borde de la ventana
const GAP    = 8;   // separación entre el botón y la grilla

// ── Por qué la grilla vive en un PORTAL y no adentro del picker ─────────────────────────────────
//
// Antes era `position: absolute; bottom: 100%` — o sea, crecía hacia arriba desde el botón. Mide
// ~169px (4 filas de 24 emojis) y en la barra "Nueva playlist" arriba sólo hay ~75px hasta el
// borde de `.main-content`, que es `overflow-y: auto` y por lo tanto RECORTA a sus descendientes
// posicionados. Resultado: se comían filas enteras. El mismo picker se monta en 5 lugares y cada
// uno tiene su propio recortador — el peor, `.ptp-list` (max-height 264px + overflow) dentro del
// menú "+".
//
// `position: fixed` a secas NO alcanza: `.ptp-menu` y `.ctx-menu` tienen `backdrop-filter`, que
// (como `transform` o `filter`) crea un CONTAINING BLOCK para descendientes fijos. Adentro de esos
// dos menús, un `fixed` se posiciona contra el menú y no contra la ventana, así que las
// coordenadas de `getBoundingClientRect()` quedarían corridas. El portal a <body> es lo único que
// se sale de todos los ancestros de una vez: ni overflow ni containing blocks.
//
// El precio del portal, y hay que pagarlo explícito: para los popovers que HOSPEDAN un picker, la
// grilla pasa a estar FUERA de su árbol, así que su "cerrar al tocar afuera" (`contains`) leería
// un toque en un emoji como un toque de afuera y se cerrarían justo al elegir. Por eso se exporta
// `isEmojiPickerTarget`, que esos dos menús consultan antes de cerrarse.

// ¿Este nodo pertenece a una grilla de emojis abierta? Lo consultan el menú "+" y el menú
// contextual para no cerrarse cuando el toque cae en un picker que ellos mismos abrieron.
export function isEmojiPickerTarget(el) {
  return !!el?.closest?.('.emoji-grid');
}

// Botón con el emoji elegido que abre un grid para escoger otro. Controlado:
// `value` (emoji actual) + `onChange(emoji)`. Cierra al elegir, clic fuera o Esc.
export default function EmojiPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [pos,  setPos]  = useState(null);   // { x, y, down } en coords de viewport; null = sin medir
  const btnRef  = useRef(null);
  const gridRef = useRef(null);

  // Flip + clamp, mismo criterio que ContextMenu: se prefiere ARRIBA del botón (donde abría
  // siempre); si no entra, abajo; y el clamp final es la red para que nunca se salga de la
  // ventana. useLayoutEffect y no useEffect: corre ANTES del pintado, así no hay salto visible.
  useLayoutEffect(() => {
    if (!open || !btnRef.current || !gridRef.current) return;
    const b = btnRef.current.getBoundingClientRect();
    const { offsetWidth: w, offsetHeight: h } = gridRef.current;
    const top = MARGIN, bottom = window.innerHeight - MARGIN;
    const left = MARGIN, right = window.innerWidth - MARGIN;

    const down = b.top - GAP - h < top;               // no entra arriba → se abre hacia abajo
    const rawY = down ? b.bottom + GAP : b.top - GAP - h;
    // El clamp vertical va con max(top, …) DESPUÉS del min: si la grilla fuera más alta que la
    // ventana no entra ni volteada, y ahí se pega al borde de arriba en vez de irse a negativo.
    const y = Math.max(top, Math.min(rawY, bottom - h));
    const x = Math.max(left, Math.min(b.left, right - w));
    setPos({ x: Math.round(x), y: Math.round(y), down });
  }, [open]);

  useEffect(() => {
    if (!open) { setPos(null); return; }              // al cerrar, la próxima apertura re-mide
    // `pointerdown` y no `mousedown` (que es lo que había): en un teléfono el mousedown es un
    // evento SINTETIZADO después del toque, y este picker ahora también se abre desde el menú
    // contextual táctil. pointerdown cubre dedo y mouse por igual — mismo criterio que ContextMenu.
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target)) return;
      if (gridRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    // Con la grilla en coordenadas de ventana, scrollear o redimensionar la dejaría flotando lejos
    // del botón que la abrió. Se cierra, que es lo que hace el resto de los flotantes de la casa.
    // El scroll se escucha en CAPTURA: el contenido scrollea en .main-content, no en window.
    const onScroll = () => setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  return (
    <div className="emoji-picker" onClick={e => e.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        className="emoji-picker-btn"
        title="Elegir emoji"
        onClick={() => setOpen(o => !o)}
      >
        {value || '🎵'}
      </button>

      {open && createPortal(
        <div
          ref={gridRef}
          className={`emoji-grid${pos?.down ? ' emoji-grid--down' : ''}`}
          // Sin medir todavía → se renderiza invisible pero CON layout (visibility, no display),
          // que es lo que permite medirla. El efecto corre antes del pintado, así que en la
          // práctica nadie ve este estado.
          style={pos ? { left: pos.x, top: pos.y } : { visibility: 'hidden' }}
          onClick={e => e.stopPropagation()}
        >
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
        </div>,
        document.body,
      )}
    </div>
  );
}
