import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { activeCount } from '../utils/albumsFilter.js';

// Botón "Filtrar" del listado de Álbumes y su panel (v1: Ordenar + Década + Limpiar).
//   · escritorio/tableta: popover bajo el botón — el patrón de .avs-menu (capa sólida, tocar afuera
//     cierra y ese toque NO sigue viaje, Esc cierra y el foco vuelve al botón).
//   · teléfono (≤700px): hoja anclada abajo sobre el scrim del menú contextual táctil (.ctx-scrim),
//     que SÍ intercepta: tocarlo cierra sin abrir el álbum de abajo. Va por portal a <body> para que
//     ningún ancestro transformado le cambie el bloque contenedor del position:fixed.
// La cara se decide AL ABRIR (como los tiles del menú contextual): achicar la ventana con el panel
// abierto no le cambia la forma. Ninguna tecla del panel llega a los atajos globales (←/→, Espacio, M).

export const SORT_LABEL = {
  artist: 'Artista', az: 'A–Z', 'year-asc': 'Año ↑', 'year-desc': 'Año ↓', tracks: 'Más pistas',
};
const SORT_TITLE = {
  artist: 'Artista (predeterminado)', az: 'Título de A a Z', 'year-asc': 'Año, más viejo primero',
  'year-desc': 'Año, más nuevo primero', tracks: 'Más canciones primero',
};
const decadeLabel = (d) => (d === 'none' ? 'Sin año' : `${d.slice(2)}s`);
const decadeTitle = (d) => (d === 'none' ? 'Álbumes sin año' : `Años ${d}`);

function FilterIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M2 4h14M5 9h8M7.5 14h3" />
      </g>
    </svg>
  );
}

export default function AlbumsFilter({ filter, decades, onChange, onClear }) {
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const btnRef = useRef(null);
  const panelRef = useRef(null);
  const panelId = useId();
  const count = activeCount(filter);

  const close = (refocus = true) => { setOpen(false); if (refocus) btnRef.current?.focus(); };
  const toggle = () => {
    if (open) { close(); return; }
    setSheet(window.matchMedia('(max-width: 700px)').matches);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return undefined;
    // El foco entra al panel: a la opción de orden elegida.
    panelRef.current?.querySelector('[role="radio"][aria-checked="true"]')?.focus();
    const onDown = (e) => {
      if (panelRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
      const swallow = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
      document.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 600);
    };
    // Cambiar de ruta (atrás/adelante del navegador) cierra; desmontar también (el cleanup).
    const onPop = () => setOpen(false);
    // La hoja no lo necesita: su scrim cubre toda la pantalla y se cierra con SU click, así que el
    // toque nunca llega a lo de abajo. (Cerrarla en el pointerdown desmontaría el scrim antes del
    // click, el navegador no emitiría ese click y el tragador se comería el toque siguiente.)
    if (!sheet) document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('popstate', onPop);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('popstate', onPop);
    };
  }, [open, sheet]);

  const onPanelKey = (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    // Orden = grupo de radios: flechas para moverse y elegir.
    const radios = [...(panelRef.current?.querySelectorAll('[role="radio"]') ?? [])];
    const i = radios.indexOf(document.activeElement);
    if (i >= 0 && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      const to = (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + radios.length) % radios.length;
      radios[to].focus();
      radios[to].click();
      return;
    }
    // La hoja móvil es modal: Tab no sale de ella.
    if (e.key === 'Tab' && sheet) {
      const f = [...panelRef.current.querySelectorAll('button:not([disabled])')];
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    } else if (e.key === 'Tab' && !sheet) {
      // Popover: salir con Tab lo cierra sin robar el foco.
      requestAnimationFrame(() => { if (!panelRef.current?.contains(document.activeElement)) setOpen(false); });
    }
  };

  const toggleDecade = (d) => {
    const has = filter.decades.includes(d);
    onChange({ ...filter, decades: has ? filter.decades.filter((x) => x !== d) : [...filter.decades, d] });
  };

  const panel = (
    <div
      id={panelId}
      ref={panelRef}
      className={sheet ? 'af-panel af-panel--sheet' : 'af-panel'}
      role="dialog"
      aria-modal={sheet || undefined}
      aria-label="Filtrar álbumes"
      onKeyDown={onPanelKey}
    >
      {sheet && <div className="af-sheet-title">Filtrar álbumes</div>}
      <div className="af-group">
        <div className="af-label" id={`${panelId}-sort`}>Ordenar</div>
        <div className="af-chips" role="radiogroup" aria-labelledby={`${panelId}-sort`}>
          {Object.keys(SORT_LABEL).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              className="af-chip"
              aria-checked={filter.sort === s}
              tabIndex={filter.sort === s ? 0 : -1}
              title={SORT_TITLE[s]}
              onClick={() => onChange({ ...filter, sort: s })}
            >
              {SORT_LABEL[s]}
            </button>
          ))}
        </div>
      </div>
      {decades.length > 0 && (
        <div className="af-group">
          <div className="af-label" id={`${panelId}-dec`}>Década</div>
          <div className="af-chips" role="group" aria-labelledby={`${panelId}-dec`}>
            {decades.map((d) => (
              <button
                key={d}
                type="button"
                className="af-chip"
                aria-pressed={filter.decades.includes(d)}
                aria-label={decadeTitle(d)}
                onClick={() => toggleDecade(d)}
              >
                {decadeLabel(d)}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="af-foot">
        <button type="button" className="af-clear" disabled={count === 0} onClick={() => {
          onClear();
          // El botón queda deshabilitado: el foco no se pierde, pasa al orden (ya en Artista).
          requestAnimationFrame(() => panelRef.current?.querySelector('[role="radio"]')?.focus());
        }}>Limpiar</button>
        {sheet && <button type="button" className="af-done" onClick={() => close()}>Listo</button>}
      </div>
    </div>
  );

  return (
    <div className="af">
      <button
        ref={btnRef}
        type="button"
        className={count ? "af-btn af-btn--on" : "af-btn"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={count ? `Filtrar álbumes, ${count} ${count === 1 ? 'filtro activo' : 'filtros activos'}` : 'Filtrar álbumes'}
        onClick={toggle}
      >
        <FilterIcon />
        <span className="af-btn-text">Filtrar</span>
        {count > 0 && <span className="af-badge" aria-hidden="true">{count}</span>}
      </button>
      {open && !sheet && panel}
      {open && sheet && createPortal(
        <>
          {/* Tocar el scrim cierra (y el foco vuelve al botón). Es él quien recibe el toque: nada sigue viaje. */}
          <div className="ctx-scrim af-scrim" aria-hidden="true" onClick={() => close()} />
          {panel}
        </>,
        document.body,
      )}
    </div>
  );
}
