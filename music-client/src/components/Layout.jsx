import { useState, useEffect, useRef, useCallback } from 'react';
import Sidebar   from './Sidebar.jsx';
import Library   from './Library.jsx';
import Albums    from './Albums.jsx';
import Artists   from './Artists.jsx';
import Genres    from './Genres.jsx';
import Years     from './Years.jsx';
import Playlists from './Playlists.jsx';
import Changelog from './Changelog.jsx';
import Settings  from './Settings.jsx';
import Player    from './Player.jsx';
import QueueOverlay from './QueueOverlay.jsx';
import { pathToState, stateToPath } from '../utils/routes.js';

// ── Gesto "atrás" en móvil: deslizar en el contenido para salir del detalle
// actual (álbum/artista/género/playlist/año) y volver a su lista. Reusa el
// MISMO canal que ya usa Esc en Player.jsx (navigate(view) → target
// {reset:true}, que cada vista ya consume) — así generaliza a las 5 vistas
// con detalle sin tocarlas. Constantes propias (NO importadas de Player.jsx):
// mismo patrón físico que el swipe de carátula (eje por distancia+dominancia,
// umbral por distancia u por flick) pero un módulo totalmente aparte — cero
// acoplamiento con la maquinaria del expandido.
const NAV_AXIS_DIST   = 12;   // px para fijar el eje (igual que Player.jsx)
const NAV_AXIS_DOM    = 1.3;  // dominancia requerida sobre el eje perpendicular
const NAV_DIST_THRESH = 80;   // px de arrastre hacia la derecha para disparar "atrás"
const NAV_VEL_THRESH  = 0.5;  // px/ms (flick)
const NAV_MIN_FLICK   = 36;   // px mínimos para aceptar un flick
const NAV_SETTLE_MS   = 180;  // ms del fundido del chevron al soltar (anulado en reduced-motion)

// Chevron flotante: única señal visual del gesto (arrastre "ciego" salvo por
// esto). Sigue el dedo apenas (nudge chico) y su opacidad/escala crecen con el
// progreso hacia el umbral — interacción directa, no se anula en reduced-motion
// (mismo criterio que dragOpacity/dragRotation de la carátula en Player.jsx).
// El fundido al SOLTAR (drag → settle) sí es una transición y esa sí se anula.
function navChevronStyle(navDrag, reduced) {
  if (navDrag.mode === 'drag') {
    const progress = Math.min(1, navDrag.x / NAV_DIST_THRESH);
    const nudge = Math.min(22, navDrag.x * 0.3);
    return {
      opacity: 0.18 + progress * 0.82,
      transform: `translate(${nudge}px, -50%) scale(${0.82 + progress * 0.18})`,
      transition: 'none',
    };
  }
  // settle: vuelve a invisible, con o sin fundido (haya disparado "atrás" o no)
  return {
    opacity: 0,
    transform: 'translate(0, -50%) scale(.82)',
    transition: reduced ? 'none' : `opacity ${NAV_SETTLE_MS}ms ease, transform ${NAV_SETTLE_MS}ms cubic-bezier(.34,1.42,.6,1)`,
  };
}

export default function Layout() {
  // F1.2 (routing Modelo 2): la vista+target INICIAL salen de la URL (deep-link / F5), no de
  // un default fijo. `/` → library (igual que antes); `/artists/Daft%20Punk` → el detalle.
  // Se lee una vez al montar (initializer perezoso de useState).
  const [view, setView] = useState(() => pathToState(window.location.pathname).view);
  const [navTarget, setNavTarget] = useState(() => pathToState(window.location.pathname).target);
  // ¿Hay un DETALLE abierto en la vista actual? Cada vista lo reporta vía setDetailOpen y lo
  // limpia al desmontar. NO lo usa Player (el detalle es ruta) — lo usa el GATE del swipe-atrás
  // de móvil (solo arranca con un detalle abierto).
  const [detailOpen, setDetailOpen] = useState(false);
  // Cola: estado de UI (abierta/cerrada). Vive acá —no en Player— porque la cola pasa a ser hija
  // de .layout (C1) y en desktop será una columna del grid (C2). Player recibe showQueue+setter por
  // prop y la usa igual (botones, dismissTop, layerDepth). Sigue siendo overlay hasta C2.
  const [showQueue, setShowQueue] = useState(false);

  // F1.2/F1.3b: canoniza la entrada de historial al montar. Si la ruta inicial es un DETALLE
  // (deep-link / F5 sobre /artists/X), SINTETIZA la lista como entrada PADRE debajo del detalle:
  // replaceState(lista) + pushState(detalle). Así "cerrar = history.back()" (F1.3b) cae en la
  // lista y no sale de la app. Ruta sin target (lista/vista simple) → solo canoniza. replaceState
  // no crea entrada; pushState sí (la del detalle). Ninguno dispara popstate → sin ciclo.
  useEffect(() => {
    const s = pathToState(window.location.pathname);
    if (s.target) {
      const list = { view: s.view, target: null };
      window.history.replaceState(list, '', stateToPath(list));
      window.history.pushState(s, '', stateToPath(s));
    } else {
      window.history.replaceState(s, '', stateToPath(s));
    }
  }, []);

  // Navegación central: cambia de vista y (opcionalmente) fija un target para
  // que la vista destino lo consuma. El menú y el bottom-nav navegan siempre
  // con target null, así entrar por el menú nunca hereda un target viejo.
  // Excepción: tocar la pestaña YA activa (mismo view, sin target) envía la señal
  // { reset: true } para que la vista salga del detalle y vuelva a su lista.
  // F1.3a: además EMPUJA una entrada de ruta a nivel VISTA (Modelo 2). El detalle sigue
  // interno a cada vista (F1.3b lo hace ruta); { reset:true } es señal transitoria, no ruta,
  // así que la entrada persistente guarda target null (la lista) y la URL cae a /<view>. No
  // se empuja si el path no cambia (tocar la pestaña activa ya en su lista).
  const navigate = (nextView, target = null) => {
    const nextTarget = target == null && nextView === view ? { reset: true } : target;
    setView(nextView);
    setNavTarget(nextTarget);
    const routeTarget = nextTarget?.reset ? null : nextTarget;
    const path = stateToPath({ view: nextView, target: routeTarget });
    if (path !== window.location.pathname) {
      window.history.pushState({ view: nextView, target: routeTarget }, '', path);
    }
  };
  const clearTarget = () => setNavTarget(null);

  // F1.3a: restaura una ruta de VISTA sin empujar (lo llama el popstate de Player al hacer
  // pop de ruta, cuando no había overlay/detalle que cerrar). Traduce el estado guardado en
  // la entrada a la señal que la vista consume: con target → ese target; sin target → la lista
  // ({ reset:true } cierra cualquier detalle). Sin state (entrada ajena) → se deriva de la URL.
  // useCallback [] → estable, así el efecto de popstate en Player no se re-suscribe por render.
  const restoreRoute = useCallback((state) => {
    const s = state ?? pathToState(window.location.pathname);
    setView(s.view);
    setNavTarget(s.target ?? { reset: true });
  }, []);

  // Canal del target hacia las vistas: cada vista consume su target de navegación
  // (album/artist/genre para ir al detalle, o { reset:true } para volver a la lista)
  // y llama a clearTarget → consumo único. Al cambiar de `view` la vista destino se
  // monta de cero (reset natural de su estado).
  const viewProps = { target: navTarget, clearTarget, setDetailOpen, navigate };
  const VIEWS = {
    library:   <Library   {...viewProps} />,
    albums:    <Albums    {...viewProps} />,
    artists:   <Artists   {...viewProps} />,
    genres:    <Genres    {...viewProps} />,
    years:     <Years     {...viewProps} />,
    playlists: <Playlists {...viewProps} />,
    changelog: <Changelog {...viewProps} />,
    settings:  <Settings  {...viewProps} />,
  };

  // ── Gesto "atrás" (móvil): ver banner de comentario arriba del archivo ──
  const [navDrag, setNavDrag] = useState({ mode: 'idle', x: 0 }); // idle | drag | settle
  const [navReduced, setNavReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const navGesture     = useRef(null);   // { x0, y0, dir, lastX, lastT, vx } | null, gesto en curso
  const navSettleTimer = useRef(null);   // timer del fundido del chevron
  const detailOpenRef  = useRef(detailOpen);
  useEffect(() => { detailOpenRef.current = detailOpen; }, [detailOpen]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setNavReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);

  const clearNavSettle = () => { clearTimeout(navSettleTimer.current); navSettleTimer.current = null; };
  useEffect(() => clearNavSettle, []);
  // Si el detalle se cierra por otra vía (botón "←", Esc, cambio de pestaña)
  // mientras un gesto quedó a medio camino, no dejar el chevron colgado.
  useEffect(() => {
    if (detailOpen) return;
    navGesture.current = null;
    clearNavSettle();
    setNavDrag({ mode: 'idle', x: 0 });
  }, [detailOpen]);

  const settleNavDrag = () => {
    setNavDrag(d => (d.mode === 'idle' ? d : { mode: 'settle', x: 0 }));
    clearNavSettle();
    navSettleTimer.current = setTimeout(() => {
      navSettleTimer.current = null;
      setNavDrag({ mode: 'idle', x: 0 });
    }, navReduced ? 0 : NAV_SETTLE_MS);
  };
  const cancelNavDrag = () => { navGesture.current = null; settleNavDrag(); };
  useEffect(() => {
    const onBlur = () => cancelNavDrag();
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  });

  // Sólo móvil (mismo criterio que onInfoPointerDown en Player.jsx: matchMedia
  // por ancho, no pointerType — el proyecto no gatea gestos por pointerType) y
  // sólo con un detalle abierto (si no hay detalle, nada a lo que "volver").
  const onContentPointerDown = (e) => {
    if (!window.matchMedia('(max-width: 700px)').matches) return;
    if (!detailOpenRef.current) return;
    if (e.target.closest?.('button, a, input, [role="button"]')) return;   // no arrancar sobre un control
    clearNavSettle();
    navGesture.current = { x0: e.clientX, y0: e.clientY, dir: null, lastX: e.clientX, lastT: e.timeStamp, vx: 0 };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
  };
  // Eje por distancia + dominancia, re-evaluado mientras siga indeciso (mismo
  // patrón que Player.jsx). Si el eje sale vertical, es un scroll: no hacemos
  // nada y el navegador lo maneja nativo (touch-action: pan-y en .main-content).
  // Sólo la dirección hacia la DERECHA hace algo (es "atrás"); hacia la
  // izquierda queda inerte a propósito — no hay "adelante" en esta vuelta.
  const onContentPointerMove = (e) => {
    const g = navGesture.current;
    if (!g) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (g.dir === null) {
      const ax = Math.abs(dx), ay = Math.abs(dy);
      if (ax >= NAV_AXIS_DIST && ax >= ay * NAV_AXIS_DOM) g.dir = 'h';
      else if (ay >= NAV_AXIS_DIST && ay >= ax * NAV_AXIS_DOM) g.dir = 'v';
      else return;
    }
    if (g.dir !== 'h') return;
    const dt = e.timeStamp - g.lastT;
    if (dt > 0) { g.vx = g.vx * 0.7 + ((e.clientX - g.lastX) / dt) * 0.3; g.lastX = e.clientX; g.lastT = e.timeStamp; }
    if (dx <= 0) { setNavDrag(d => (d.mode === 'idle' ? d : { mode: 'idle', x: 0 })); return; }
    setNavDrag({ mode: 'drag', x: dx });
  };
  const onContentPointerUp = (e) => {
    const g = navGesture.current;
    navGesture.current = null;
    if (!g || g.dir !== 'h') return;
    const dx = e.clientX - g.x0;                       // umbral desde el down (feel intacto)
    const flick = g.vx > NAV_VEL_THRESH && dx > NAV_MIN_FLICK;
    if (dx > 0 && (dx >= NAV_DIST_THRESH || flick)) window.history.back();   // F1.3b: cerrar = pop de ruta
    settleNavDrag();
  };

  return (
    <div className="layout">
      <Sidebar view={view} navigate={navigate} />

      <main
        className="main-content"
        onPointerDown={onContentPointerDown}
        onPointerMove={onContentPointerMove}
        onPointerUp={onContentPointerUp}
        onPointerCancel={cancelNavDrag}
        onLostPointerCapture={cancelNavDrag}
      >
        {VIEWS[view]}
      </main>

      {navDrag.mode !== 'idle' && (
        <div className="nav-back-chevron" style={navChevronStyle(navDrag, navReduced)} aria-hidden="true">
          <ChevronLeftGlyph />
        </div>
      )}

      <Player navigate={navigate} view={view} restoreRoute={restoreRoute} showQueue={showQueue} setShowQueue={setShowQueue} />

      {/* Cola: hija directa de .layout (C1). Sigue siendo el overlay actual (fixed, z 255);
          en C2 se vuelve columna del grid en desktop. onClose la controla el estado de acá. */}
      {showQueue && <QueueOverlay onClose={() => setShowQueue(false)} />}

      <BottomNav view={view} navigate={navigate} />
    </div>
  );
}

const NAV_ITEMS = [
  { id: 'library',   label: 'Biblioteca', icon: <LibraryIcon /> },
  { id: 'albums',    label: 'Álbumes',    icon: <AlbumIcon /> },
  { id: 'artists',   label: 'Artistas',   icon: <ArtistIcon /> },
  { id: 'genres',    label: 'Géneros',    icon: <GenreIcon /> },
  { id: 'years',     label: 'Años',       icon: <YearIcon /> },
  { id: 'playlists', label: 'Playlists',  icon: <PlaylistIcon /> },
];

function BottomNav({ view, navigate }) {
  return (
    <nav className="bottom-nav">
      {NAV_ITEMS.map(v => (
        <button
          key={v.id}
          className={`bottom-nav-btn${view === v.id ? ' active' : ''}`}
          onClick={() => navigate(v.id)}
        >
          {v.icon}
          {v.label}
        </button>
      ))}
    </nav>
  );
}

function LibraryIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>;
}
function AlbumIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>;
}
function PlaylistIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>;
}
function ArtistIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
}
function GenreIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>;
}
function YearIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
}
// Glyph del chevron del gesto "atrás" (nav-back-chevron, sólo móvil).
function ChevronLeftGlyph() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>;
}
