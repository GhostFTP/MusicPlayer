import { useEffect, useRef, useState } from 'react';
import { ALBUM_VIEW_MODES } from '../utils/albumsView.js';

// Selector de vista del listado de Álbumes (Frente 3, F3e). Dos caras, las dos siempre montadas y
// el CSS muestra una sola según el ancho (≤700px = teléfono):
//   · escritorio/tableta: los cinco modos en línea, como un grupo de radios (role="radiogroup").
//     Tab entra al modo elegido; las flechas cambian de modo (Inicio/Fin a los extremos).
//   · teléfono: un botón "Vista" de 44×44 que abre un menú (role="menu" + menuitemradio). Flechas
//     para moverse, Enter/Espacio elige, Esc o tocar afuera cierra y el foco vuelve al botón.
// Las teclas que maneja el selector NO siguen viaje: si no, ←/→ también adelantaría la canción y
// Espacio la pausaría (los atajos globales de PlayerContext y el de "M" escuchan en window).

export const MODE_LABEL = {
  d2: '2 por fila', d3: '3 por fila', d4: '4 por fila', mosaic: 'Mosaico', list: 'Lista',
};

function GridIcon({ n }) {
  const s = 18, g = n >= 5 ? 1 : n === 4 ? 1.5 : 2, c = (s - g * (n - 1)) / n;
  const r = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    r.push(<rect key={`${i}-${j}`} x={(c + g) * j} y={(c + g) * i} width={c} height={c} rx={n > 3 ? 0.5 : 1} />);
  }
  return <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><g fill="currentColor">{r}</g></svg>;
}
function ListIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><g fill="currentColor">
      <rect x="0" y="1" width="4" height="4" rx="1" /><rect x="6" y="2" width="12" height="2" rx="1" />
      <rect x="0" y="7" width="4" height="4" rx="1" /><rect x="6" y="8" width="12" height="2" rx="1" />
      <rect x="0" y="13" width="4" height="4" rx="1" /><rect x="6" y="14" width="12" height="2" rx="1" />
    </g></svg>
  );
}
export function ModeIcon({ mode }) {
  if (mode === 'list') return <ListIcon />;
  return <GridIcon n={{ d2: 2, d3: 3, d4: 4, mosaic: 5 }[mode] ?? 2} />;
}

// Índice destino para una tecla de navegación, o null si la tecla no es de navegación.
function stepFor(key, i, n, { vertical }) {
  const prev = vertical ? ['ArrowUp'] : ['ArrowLeft', 'ArrowUp'];
  const next = vertical ? ['ArrowDown'] : ['ArrowRight', 'ArrowDown'];
  if (prev.includes(key)) return (i - 1 + n) % n;
  if (next.includes(key)) return (i + 1) % n;
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  return null;
}

export default function AlbumViewSelector({ mode, onChange }) {
  const segRef = useRef(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const [open, setOpen] = useState(false);
  const n = ALBUM_VIEW_MODES.length;
  const cur = Math.max(0, ALBUM_VIEW_MODES.indexOf(mode));

  // ── escritorio: radiogroup con foco itinerante (sólo el elegido está en el orden de Tab) ──
  const onSegKey = (e) => {
    const to = stepFor(e.key, cur, n, { vertical: false });
    if (to == null && e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault(); e.stopPropagation();
    if (to == null) return;   // Espacio/Enter sobre el ya elegido: nada que cambiar
    onChange(ALBUM_VIEW_MODES[to]);
    segRef.current?.querySelectorAll('[role="radio"]')[to]?.focus();
  };

  // ── teléfono: menú ──
  const close = (refocus = true) => { setOpen(false); if (refocus) btnRef.current?.focus(); };
  useEffect(() => {
    if (!open) return undefined;
    menuRef.current?.querySelectorAll('[role="menuitemradio"]')[cur]?.focus();
    // Tocar afuera cierra y ese toque NO sigue viaje: sin esto, cerrar el menú tocando una tarjeta
    // abría además ese álbum (mismo motivo que el scrim del menú contextual táctil). Se traga sólo
    // el click de ESTE toque (tope de 600ms), nunca uno posterior.
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
      const swallow = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
      document.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 600);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const onMenuKey = (e) => {
    e.stopPropagation();   // ninguna tecla del menú llega a los atajos globales
    const items = [...(menuRef.current?.querySelectorAll('[role="menuitemradio"]') ?? [])];
    const i = items.indexOf(document.activeElement);
    const to = stepFor(e.key, i < 0 ? cur : i, n, { vertical: true });
    if (to != null) { e.preventDefault(); items[to]?.focus(); return; }
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') { setOpen(false); return; }
    if ((e.key === 'Enter' || e.key === ' ') && i >= 0) { e.preventDefault(); onChange(ALBUM_VIEW_MODES[i]); close(); }
  };

  return (
    <div className="avs">
      <div className="avs-seg" role="radiogroup" aria-label="Vista de álbumes" ref={segRef} onKeyDown={onSegKey}>
        {ALBUM_VIEW_MODES.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={m === mode}
            aria-label={MODE_LABEL[m]}
            title={MODE_LABEL[m]}
            tabIndex={m === mode ? 0 : -1}
            onClick={() => onChange(m)}
          >
            <ModeIcon mode={m} />
          </button>
        ))}
      </div>

      <div className="avs-mobile">
        <button
          ref={btnRef}
          type="button"
          className="avs-btn"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Vista de álbumes: ${MODE_LABEL[mode]}`}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setOpen(true); }
          }}
        >
          <ModeIcon mode={mode} />
        </button>
        {open && (
          <div className="avs-menu" role="menu" aria-label="Vista de álbumes" ref={menuRef} onKeyDown={onMenuKey}>
            {ALBUM_VIEW_MODES.map((m) => (
              <button
                key={m}
                type="button"
                role="menuitemradio"
                aria-checked={m === mode}
                tabIndex={-1}
                onClick={() => { onChange(m); close(); }}
              >
                <ModeIcon mode={m} />
                <span>{MODE_LABEL[m]}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
