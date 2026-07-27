import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useToast } from './Toast.jsx';
import { api } from '../api/client.js';

// ── Menú contextual GLOBAL (actions-lab · dirección visual C, "Lista seca") ──────────────
//
// UN solo menú montado y UN provider para toda la app: las superficies (filas de pista, y en
// fase B tarjetas de álbum/artista) sólo llaman openMenu(e, { type, item }); el menú arma sus
// acciones según el `type`. Si algún día aparece un segundo componente de menú, algo se hizo mal.
//
// TIPOS (fase B): 'track' (fila de lista) · 'album' (tarjeta) · 'artist' (retrato) ·
// 'queue-track' (fila de la cola). Cada tipo ofrece SOLO lo que le aplica — no se fuerzan las
// cinco acciones en todos. Sigue siendo DESKTOP (clic derecho): el long-press de móvil está
// DIFERIDO a propósito (fase C); en Android dispara igual el evento 'contextmenu', así que
// openMenu lo descarta por matchMedia — mismo criterio de régimen que el resto del proyecto
// (ancho, no pointerType). En móvil, entonces, no pasa nada: queda el menú nativo.
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

// Pistas de un álbum / de un artista con los MISMOS parámetros que ya usan las vistas
// (Albums.openAlbum y el ShuffleButton del hero de Artistas) → el orden que se encola es el
// mismo que se ve en pantalla. Filtrar el álbum por album_artist desambigua los homónimos.
const albumTracks  = (a) => api.tracks({ album: a.album, limit: 500, ...(a.album_artist ? { album_artist: a.album_artist } : {}) });
const artistTracks = (a) => api.tracks({ album_artist: a.artist, limit: 10000 });

// Rótulo accesible por tipo: el menú es uno solo, pero lo que lo abrió cambia.
const MENU_LABEL = {
  'track':       'Acciones de la pista',
  'queue-track': 'Acciones de la pista en la cola',
  'album':       'Acciones del álbum',
  'artist':      'Acciones del artista',
};

export function ContextMenuProvider({ children }) {
  const [menu, setMenu] = useState(null);   // { type, item, x, y } | null — x/y = posición CRUDA del cursor
  const [pos, setPos]   = useState(null);   // posición YA resuelta (flip + clamp), null hasta medir
  const elRef   = useRef(null);
  const hostRef = useRef({});               // handlers del host (Player): goArtist / goAlbum / openInfo

  const { play, addToQueue, playAfterCurrent, removeFromQueue, currentTrack } = usePlayer();
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

  // Carga un CONJUNTO de pistas y opera sobre él. Si el fetch falla o el conjunto viene vacío,
  // avisa: sin esto, "reproducir álbum" sobre un álbum vacío no haría nada y parecería un bug.
  const onTracks = useCallback(async (load, done, empty) => {
    try {
      const ts = await load();
      if (!ts?.length) { toast(empty, { variant: 'warning' }); return; }
      done(ts);
    } catch { toast('No se pudieron cargar las pistas', { variant: 'warning' }); }
  }, [toast]);

  // Las acciones que NO aplican se OCULTAN, no se deshabilitan (regla dura de actions-lab: un
  // menú con ítems grises es ruido). `sep: true` = separador ARRIBA de ese ítem.
  //
  // El BLOQUE DE NAVEGACIÓN + INFO es idéntico en todos los tipos que lo ofrecen (mismas
  // funciones del host), así que se arma una sola vez: "ir al artista" significa lo mismo en una
  // fila de lista, en una tarjeta de álbum y en una fila de la cola.
  const items = useMemo(() => {
    if (!menu) return [];
    const it = menu.item;
    const host = hostRef.current;
    const list = [];

    // Navegar SIEMPRE por album_artist, NUNCA por el `artist` mostrado (rompería Various Artists
    // y los feats; el backend además filtra album_artist IS NOT NULL). Sin album_artist no hay
    // vista de artista a la que ir → la acción no aparece. Es curación/tagging, no un bug.
    // `seed` = lo que se le pasa al host: una pista completa cuando la hay (así conserva su
    // fallback por api.track), o el mínimo {album_artist} cuando el ítem es una tarjeta.
    const pushGoArtist = (albumArtist, seed) => {
      if (host.goArtist && albumArtist) {
        list.push({ id: 'artist', sep: list.length > 0, label: 'Ir al artista', tone: 'nav', icon: <IconArtist />, run: () => host.goArtist(seed) });
      }
    };
    const pushTrackNav = (t) => {
      pushGoArtist(t.album_artist, t);
      if (host.goAlbum && t.album) {
        list.push({ id: 'album', sep: !t.album_artist && list.length > 0, label: 'Ir al álbum', tone: 'nav', icon: <IconAlbum />, run: () => host.goAlbum(t) });
      }
      if (host.openInfo) {
        list.push({ id: 'info', sep: list.length > 0, label: 'Ver info', tone: 'info', icon: <IconInfo />, run: () => host.openInfo(t) });
      }
    };

    switch (menu.type) {
      // ── Pista de una lista ──
      case 'track': {
        // "A continuación" sobre la pista que YA suena es un no-op → se oculta.
        if (currentTrack?.id !== it.id) {
          list.push({
            id: 'next', label: 'Reproducir a continuación', tone: 'queue', icon: <IconPlayNext />,
            run: () => { playAfterCurrent(it); toast('Suena a continuación'); },
          });
        }
        list.push({
          id: 'queue', label: 'Agregar a la cola', tone: 'queue', icon: <IconQueue />,
          run: () => { addToQueue(it); toast('Añadida a la cola'); },
        });
        pushTrackNav(it);
        break;
      }

      // ── Fila de la COLA. Acciones propias de estar YA en la cola: NO se ofrece "agregar a la
      //    cola" (ya está) ni "reproducir a continuación" (con el motor actual insertaría una
      //    COPIA nueva —otro _qid— en vez de mover ésta; mover es reorder, frente aparte).
      //    "Quitar" no aparece sobre la que suena: eso obliga a decidir qué reproducir después.
      case 'queue-track': {
        if (!menu.isCurrent) {
          list.push({
            id: 'remove', label: 'Quitar de la cola', tone: 'queue', icon: <IconRemove />,
            run: () => { removeFromQueue(it._qid); toast('Quitada de la cola'); },
          });
        }
        pushTrackNav(it);
        break;
      }

      // ── Tarjeta de ÁLBUM. Sin "ir al álbum": la tarjeta YA es el álbum (el clic izquierdo lo
      //    abre). Sin "ver info": el panel de Info es de PISTA (título, nº de pista, códec de
      //    ese archivo) — un info de álbum es otro panel, no esta acción.
      case 'album': {
        list.push({
          id: 'play', label: 'Reproducir álbum', tone: 'queue', icon: <IconPlay />,
          run: () => onTracks(() => albumTracks(it), (ts) => play(ts, 0), 'Ese álbum no tiene pistas'),
        });
        list.push({
          id: 'queue', label: 'Agregar a la cola', tone: 'queue', icon: <IconQueue />,
          run: () => onTracks(() => albumTracks(it), (ts) => {
            addToQueue(ts);
            toast(`«${it.album}» a la cola · ${ts.length} ${ts.length === 1 ? 'pista' : 'pistas'}`);
          }, 'Ese álbum no tiene pistas'),
        });
        pushGoArtist(it.album_artist, { album_artist: it.album_artist });
        break;
      }

      // ── Retrato de ARTISTA. `artist` en esta vista YA ES album_artist (browse.js lo aliasea:
      //    SELECT album_artist AS artist), así que la regla dura se cumple sola.
      case 'artist': {
        list.push({
          id: 'play', label: 'Reproducir todo', tone: 'queue', icon: <IconPlay />,
          run: () => onTracks(() => artistTracks(it), (ts) => play(ts, 0), 'Ese artista no tiene pistas'),
        });
        list.push({
          id: 'queue', label: 'Agregar a la cola', tone: 'queue', icon: <IconQueue />,
          run: () => onTracks(() => artistTracks(it), (ts) => {
            addToQueue(ts);
            toast(`«${it.artist}» a la cola · ${ts.length} ${ts.length === 1 ? 'pista' : 'pistas'}`);
          }, 'Ese artista no tiene pistas'),
        });
        pushGoArtist(it.artist, { album_artist: it.artist });
        break;
      }

      default: break;
    }
    return list;
  }, [menu, currentTrack, play, addToQueue, playAfterCurrent, removeFromQueue, onTracks, toast]);

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
          aria-label={MENU_LABEL[menu.type] ?? 'Acciones'}
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
function IconPlay() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M7 4.5l13 7.5-13 7.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconRemove() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="6" x2="15" y2="6" /><line x1="3" y1="12" x2="15" y2="12" /><line x1="3" y1="18" x2="12" y2="18" />
      <line x1="15" y1="18" x2="21" y2="18" />
    </svg>
  );
}
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
