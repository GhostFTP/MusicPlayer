import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useToast } from './Toast.jsx';

// ── Menú contextual GLOBAL (actions-lab · dirección visual C, "Lista seca") ──────────────
//
// UN solo menú montado y UN provider para toda la app: las superficies (filas de pista, y en
// fase B tarjetas de álbum/artista) sólo llaman openMenu(e, { type, item }); el menú arma sus
// acciones según el `type`. Si algún día aparece un segundo componente de menú, algo se hizo mal.
//
// FASE A1: sólo `type: 'track'` y sólo DESKTOP (clic derecho). El long-press de móvil está
// DIFERIDO a propósito (fase C): en Android el long-press dispara igual el evento 'contextmenu',
// así que openMenu lo descarta por matchMedia — mismo criterio de régimen que usa el resto del
// proyecto (ancho, no pointerType). En móvil, entonces, no pasa nada: queda el menú nativo.
//
// Las acciones NO se crean acá, se REÚNEN: la cola sale de PlayerContext (addToQueue /
// playAfterCurrent) y navegar/info salen del host (Player) vía registerHost — son las mismas
// funciones que ya usan la barra y el expandido, no copias.
//
// CIERRE — el menú es un POPOVER EFÍMERO, no un overlay de nav-lab:
//   · clic afuera (mousedown), scroll, resize/blur y elegir una acción → se cierra acá;
//   · Esc y el atrás del navegador → los corre Player, que lo trata como peldaño 0 de su
//     escalera (un Esc = una cosa: sin eso, un Esc con el menú abierto sobre el expandido
//     cerraría los dos de una);
//   · NO entra en `layerDepth` (no empuja entrada-guardia de historial) y NUNCA llama
//     history.back(). El porqué está en el comentario de Player.jsx, junto a layerDepth.

const ContextMenuCtx = createContext(null);

const MARGIN = 8;   // aire mínimo contra el borde del viewport

export function ContextMenuProvider({ children }) {
  const [menu, setMenu] = useState(null);   // { type, item, x, y } | null — x/y = posición CRUDA del cursor
  const [pos, setPos]   = useState(null);   // posición YA resuelta (flip + clamp), null hasta medir
  const elRef   = useRef(null);
  const hostRef = useRef({});               // handlers del host (Player): goArtist / goAlbum / openInfo

  const { addToQueue, playAfterCurrent, currentTrack } = usePlayer();
  const toast = useToast();

  // El host (Player) publica acá los handlers que dependen de SU estado (cerrar expandido/letra
  // antes de navegar, abrir el Info sobre una pista arbitraria). Se guarda en un ref: refrescarlo
  // en cada render del host no debe re-renderizar el menú.
  const registerHost = useCallback((handlers) => { hostRef.current = handlers; }, []);

  const closeMenu = useCallback(() => {
    setMenu((m) => (m === null ? m : null));   // no-op si ya estaba cerrado (no fuerza render)
  }, []);

  const openMenu = useCallback((e, payload) => {
    if (window.matchMedia('(max-width: 700px)').matches) return;   // móvil: long-press es fase C
    e.preventDefault();
    e.stopPropagation();
    setPos(null);                                                   // se recalcula al medir
    setMenu({ ...payload, x: e.clientX, y: e.clientY });
  }, []);

  // Posicionamiento con FLIP: se mide el menú ya montado y, si no cabe hacia abajo/derecha, se
  // abre hacia arriba/izquierda. El clamp final es la red: con un menú más alto que la ventana
  // tampoco cabe volteado, así que se pega al borde. Nunca se sale de la pantalla.
  // useLayoutEffect (no useEffect): corre ANTES del pintado → no hay salto visible.
  useLayoutEffect(() => {
    if (!menu || !elRef.current) return;
    const { offsetWidth: w, offsetHeight: h } = elRef.current;
    const vw = window.innerWidth, vh = window.innerHeight;
    const flipX = menu.x + w + MARGIN > vw;
    const flipY = menu.y + h + MARGIN > vh;
    const x = Math.max(MARGIN, Math.min(flipX ? menu.x - w : menu.x, vw - w - MARGIN));
    const y = Math.max(MARGIN, Math.min(flipY ? menu.y - h : menu.y, vh - h - MARGIN));
    setPos({ x, y, flipX, flipY });
  }, [menu]);

  // Cierres "ambientales". Esc NO está acá a propósito (lo corre la escalera de Player).
  // El scroll se escucha en CAPTURA: el contenido scrollea en .main-content, no en window.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e) => { if (!elRef.current?.contains(e.target)) closeMenu(); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('blur', closeMenu);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('blur', closeMenu);
    };
  }, [menu, closeMenu]);

  // Las acciones que NO aplican se OCULTAN, no se deshabilitan (regla dura de actions-lab: un
  // menú con ítems grises es ruido). `sep: true` = separador ARRIBA de ese ítem.
  const items = useMemo(() => {
    if (menu?.type !== 'track') return [];
    const t = menu.item;
    const host = hostRef.current;
    const list = [];

    // "A continuación" sobre la pista que YA suena es un no-op → se oculta.
    if (currentTrack?.id !== t.id) {
      list.push({
        id: 'next', label: 'Reproducir a continuación', tone: 'queue', icon: <IconPlayNext />,
        run: () => { playAfterCurrent(t); toast('Suena a continuación'); },
      });
    }
    list.push({
      id: 'queue', label: 'Agregar a la cola', tone: 'queue', icon: <IconQueue />,
      run: () => { addToQueue(t); toast('Añadida a la cola'); },
    });

    // Navegar SIEMPRE por album_artist, NUNCA por `artist` (rompería Various Artists y los feats;
    // el backend además filtra album_artist IS NOT NULL). Sin album_artist no hay vista de artista
    // a la que ir → la acción no aparece. Es curación/tagging del usuario, no un bug de código.
    if (host.goArtist && t.album_artist) {
      list.push({ id: 'artist', sep: true, label: 'Ir al artista', tone: 'nav', icon: <IconArtist />, run: () => host.goArtist(t) });
    }
    if (host.goAlbum && t.album) {
      list.push({ id: 'album', sep: !t.album_artist, label: 'Ir al álbum', tone: 'nav', icon: <IconAlbum />, run: () => host.goAlbum(t) });
    }
    if (host.openInfo) {
      list.push({ id: 'info', sep: true, label: 'Ver info', tone: 'info', icon: <IconInfo />, run: () => host.openInfo(t) });
    }
    return list;
  }, [menu, currentTrack, addToQueue, playAfterCurrent, toast]);

  const value = useMemo(
    () => ({ openMenu, closeMenu, registerHost, menuOpen: menu !== null }),
    [openMenu, closeMenu, registerHost, menu],
  );

  return (
    <ContextMenuCtx.Provider value={value}>
      {children}
      {menu && items.length > 0 && (
        <div
          ref={elRef}
          className="ctx-menu"
          role="menu"
          aria-label="Acciones de la pista"
          style={{
            left: pos ? pos.x : menu.x,
            top:  pos ? pos.y : menu.y,
            // Hasta medir no se pinta: evita el frame en la posición cruda si hay que voltear.
            visibility: pos ? undefined : 'hidden',
            // El pop nace de la esquina que quedó pegada al cursor, no siempre de arriba-izquierda.
            transformOrigin: pos ? `${pos.flipY ? 'bottom' : 'top'} ${pos.flipX ? 'right' : 'left'}` : undefined,
          }}
          onContextMenu={(e) => e.preventDefault()}   // clic derecho SOBRE el menú: no abrir el nativo encima
        >
          {items.map((it, i) => (
            <div key={it.id}>
              {it.sep && i > 0 && <div className="ctx-sep" role="separator" />}
              <button
                type="button"
                role="menuitem"
                className={`ctx-item tone-${it.tone}`}
                onClick={() => { closeMenu(); it.run(); }}
              >
                {it.icon}
                <span>{it.label}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </ContextMenuCtx.Provider>
  );
}

// Para las superficies: openMenu(e, { type:'track', item:track }). Devuelve un no-op si por lo
// que sea el provider no está montado, para que ninguna vista tenga que preguntar.
export function useContextMenu() {
  return useContext(ContextMenuCtx) ?? NO_MENU;
}
const NO_MENU = { openMenu: () => {}, closeMenu: () => {}, registerHost: () => {}, menuOpen: false };

// ── Iconos: 14px, monocromo, currentColor. El texto manda; el icono orienta. ──
function IconPlayNext() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="14" y2="6" /><line x1="3" y1="12" x2="14" y2="12" /><line x1="3" y1="18" x2="10" y2="18" />
      <path d="M16 15l5 3-5 3z" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconQueue() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="6" x2="15" y2="6" /><line x1="3" y1="12" x2="15" y2="12" /><line x1="3" y1="18" x2="12" y2="18" />
      <line x1="18" y1="15" x2="18" y2="21" /><line x1="15" y1="18" x2="21" y2="18" />
    </svg>
  );
}
function IconArtist() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  );
}
function IconAlbum() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}
function IconInfo() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16" /><line x1="12" y1="7.5" x2="12" y2="7.6" />
    </svg>
  );
}
