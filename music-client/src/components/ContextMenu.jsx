import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useToast } from './Toast.jsx';
import { api } from '../api/client.js';
import EmojiPicker from './EmojiPicker.jsx';
import { emojiHue } from '../utils/emojiHue.js';
import { addTrackToPlaylist, createPlaylistWithTrack } from '../utils/playlistActions.js';

// ── Menú contextual GLOBAL (actions-lab · dirección visual C, "Lista seca") ──────────────
//
// UN solo menú montado y UN provider para toda la app: las superficies (filas de pista, y en
// fase B tarjetas de álbum/artista) sólo llaman openMenu(e, { type, item }); el menú arma sus
// acciones según el `type`. Si algún día aparece un segundo componente de menú, algo se hizo mal.
//
// TIPOS (fase B): 'track' (fila de lista) · 'album' (tarjeta) · 'artist' (retrato) ·
// 'queue-track' (fila de la cola). Cada tipo ofrece SOLO lo que le aplica — no se fuerzan las
// cinco acciones en todos.
//
// DISPARADORES: clic derecho (desktop) · botón "⋯" de la fila (desktop) · LONG-PRESS (móvil,
// fase C1 — utils/useLongPress.js). El long-press entra por una puerta EXPLÍCITA (`via:
// 'longpress'`): sin esa marca, openMenu sigue descartando el móvil por matchMedia. Así el
// 'contextmenu' que Android dispara solo sobre las superficies que TODAVÍA no montaron el hook
// (tarjetas de álbum/artista) sigue cayendo en el menú nativo, como hasta ahora, en vez de
// abrir este popover en sitios que no se probaron. El criterio de régimen es el de siempre:
// ancho, no pointerType.
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

const MARGIN = 8;    // aire mínimo contra el borde del viewport
const BTN_GAP = 6;   // separación entre el botón "⋯" y el menú que cuelga de él

// Ancla del menú, según qué lo abrió. Con el CURSOR (clic derecho) nace en el punto exacto.
// Con un BOTÓN (`anchor: 'element'`, el "⋯" de la fila) nace DEBAJO y alineado a su borde
// derecho; `yUp` es el borde superior del botón, que se usa como base al voltear hacia arriba
// para que el menú volteado no le caiga encima. El flip y el clamp los resuelve el mismo efecto.
function anchorOf(e, payload) {
  if (payload.anchor !== 'element') return { x: e.clientX, y: e.clientY };
  const r = e.currentTarget.getBoundingClientRect();
  return { x: r.right, y: r.bottom + BTN_GAP, yUp: r.top - BTN_GAP, alignRight: true };
}

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
  // ── Sub-selector de playlists (fase D) ──────────────────────────────────────────────────
  // Es un PANEL EN EL MISMO SITIO, no un submenú lateral ni un modal: la caja del menú cambia
  // su contenido y se ensancha. Elegido porque es lo único que NO pelea con el posicionamiento:
  // un flyout lateral necesitaría su propio flip relativo al padre (y heredar el lado cuando el
  // padre ya volteó), y un modal sería un overlay nuevo que habría que meter en la escalera de
  // nav-lab. Así se reusa TODO lo que ya funciona: mismo ancla, mismo z-index, mismos cierres
  // (clic afuera, scroll, Esc por la escalera) y el mismo flip — que se vuelve a medir al crecer.
  const [panel,     setPanel]     = useState(null);    // null = acciones · 'playlist' = selector
  const [playlists, setPlaylists] = useState(null);    // null = cargando
  const [newName,   setNewName]   = useState('');
  const [newEmoji,  setNewEmoji]  = useState('🎵');
  const [busy,      setBusy]      = useState(false);
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
    // QUIÉN puede abrir: por ANCHO, el corte 700/701 de siempre (mobile-lab). En móvil sólo entra
    // por la puerta explícita del long-press (ver el banner de arriba). Este gate NO se ensancha:
    // subirlo a 880 dejaría al clic derecho sin menú entre 701 y 880.
    if (payload.via !== 'longpress' && window.matchMedia('(max-width: 700px)').matches) return;
    e.preventDefault();
    e.stopPropagation();
    setPos(null);                                                   // se recalcula al medir
    setPanel(null); setPlaylists(null); setNewName(''); setNewEmoji('🎵');   // el menú abre en la raíz
    setMenu({ ...payload, ...anchorOf(e, payload) });
  }, []);

  // Posicionamiento con FLIP: se mide el menú ya montado y, si no cabe hacia abajo/derecha, se
  // abre hacia arriba/izquierda. El clamp final es la red: con un menú más alto que la ventana
  // tampoco cabe volteado, así que se pega al borde. Nunca se sale de la pantalla.
  // useLayoutEffect (no useEffect): corre ANTES del pintado → no hay salto visible.
  //
  // Se re-mide también al cambiar de PANEL y al llegar las playlists: el selector ensancha y
  // alarga la caja, así que la que se voltea/clampa es la caja NUEVA, no la de las acciones.
  useLayoutEffect(() => {
    if (!menu || !elRef.current) return;
    const { offsetWidth: w, offsetHeight: h } = elRef.current;
    const vw = window.innerWidth, vh = window.innerHeight;
    // `alignRight` lo pide el ancla de BOTÓN (el "⋯"): ahí el menú no nace en el punto clicado
    // sino alineado al borde derecho del botón, quepa o no. Con el cursor, sólo voltea si hace falta.
    const flipX = menu.alignRight || menu.x + w + MARGIN > vw;
    const flipY = menu.y + h + MARGIN > vh;
    const x = Math.max(MARGIN, Math.min(flipX ? menu.x - w : menu.x, vw - w - MARGIN));
    // Al voltear hacia arriba se usa `yUp` como BORDE INFERIOR: con el cursor es el mismo punto,
    // pero con un botón es su borde superior — si no, el menú volteado le taparía el botón.
    const y = Math.max(MARGIN, Math.min(flipY ? (menu.yUp ?? menu.y) - h : menu.y, vh - h - MARGIN));
    setPos({ x, y, flipX, flipY });
  }, [menu, panel, playlists]);

  // Carga las playlists al entrar al selector (no antes: el menú de acciones no las necesita).
  useEffect(() => {
    if (panel !== 'playlist') return;
    let cancelled = false;
    api.playlists()
      .then((ps) => { if (!cancelled) setPlaylists(ps); })
      .catch(() => { if (!cancelled) setPlaylists([]); });
    return () => { cancelled = true; };
  }, [panel]);

  // Cierres "ambientales". Esc NO está acá a propósito (lo corre la escalera de Player).
  // El scroll se escucha en CAPTURA: el contenido scrollea en .main-content, no en window.
  //
  // C1 · dos ajustes que el táctil obliga:
  //  · 'pointerdown' en vez de 'mousedown': en un teléfono el mousedown es un evento SINTETIZADO
  //    después del toque, así que el "tocar afuera" dependía de esa emulación. pointerdown cubre
  //    dedo y mouse por igual, y en desktop mantiene el orden de siempre (pointerdown → mousedown
  //    → contextmenu), o sea que el clic derecho sobre otra fila sigue cerrando y reabriendo.
  //  · el resize sólo cierra si cambió el ANCHO: en móvil, abrir el teclado dispara resize por el
  //    alto, y eso cerraba el menú justo al enfocar el input de "nueva playlist" (autoFocus).
  useEffect(() => {
    if (!menu) return;
    const onDown = (e) => { if (!elRef.current?.contains(e.target)) closeMenu(); };
    const w0 = window.innerWidth;
    const onResize = () => { if (window.innerWidth !== w0) closeMenu(); };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('blur', closeMenu);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', onResize);
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

  // ── Selector de playlists: el QUÉ (llamada + aviso) sale de utils/playlistActions.js, el
  //    mismo módulo que usa el "+". Acá sólo el candado `busy` y cerrar el menú al terminar.
  const plTrackId = menu?.item?.id;
  const addToPlaylist = async (pl) => {
    if (busy || plTrackId == null) return;
    setBusy(true);
    try { await addTrackToPlaylist(pl, plTrackId, toast); closeMenu(); }
    catch { toast('No se pudo añadir a la playlist', { variant: 'warning' }); }
    finally { setBusy(false); }
  };
  const createAndAdd = async (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name || busy || plTrackId == null) return;
    setBusy(true);
    try { await createPlaylistWithTrack(name, newEmoji, plTrackId, toast); closeMenu(); }
    catch { toast('No se pudo crear la playlist', { variant: 'warning' }); }
    finally { setBusy(false); }
  };

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
    // Sólo para ítems que son UNA pista: `api.addToPlaylist` es de a una, así que un álbum o un
    // artista serían N requests — deuda anotada en actions-lab, fuera de alcance.
    // `keepOpen` porque no ejecuta nada: cambia el menú al selector, en la misma caja.
    const pushAddToPlaylist = () => {
      list.push({
        id: 'playlist', label: 'Agregar a playlist', tone: 'playlist', icon: <IconPlaylistAdd />,
        chev: true, keepOpen: true, run: () => setPanel('playlist'),
      });
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
        pushAddToPlaylist();
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
        pushAddToPlaylist();
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
          className={`ctx-menu${panel === 'playlist' ? ' ctx-menu--wide' : ''}`}
          role="menu"
          aria-label={panel === 'playlist' ? 'Agregar a playlist' : (MENU_LABEL[menu.type] ?? 'Acciones')}
          style={{
            // La pasada de MEDICIÓN va en 0,0 — no en el ancla. Puesto en el ancla, un menú
            // cerca del borde derecho queda con poco espacio a su derecha y el shrink-to-fit lo
            // ESTRUJA hasta su min-width (208 en vez de sus ~214 naturales): se medía una caja
            // más angosta que la real y el flip aterrizaba corrido unos px. En 0,0 tiene el
            // viewport entero para tomar su ancho natural, y recién ahí se posiciona.
            left: pos ? pos.x : 0,
            top:  pos ? pos.y : 0,
            // Hasta medir no se pinta: nadie ve el paso por 0,0.
            visibility: pos ? undefined : 'hidden',
            // El pop nace de la esquina que quedó pegada al cursor, no siempre de arriba-izquierda.
            transformOrigin: pos ? `${pos.flipY ? 'bottom' : 'top'} ${pos.flipX ? 'right' : 'left'}` : undefined,
          }}
          onContextMenu={(e) => e.preventDefault()}   // clic derecho SOBRE el menú: no abrir el nativo encima
        >
          {panel === 'playlist' ? (
            <>
              {/* Volver a las acciones. El Esc NO retrocede acá: cierra el menú entero (lo corre
                  la escalera de Player, peldaño 0) — es un popover, no una pila de vistas. */}
              <button type="button" className="ctx-back" onClick={() => setPanel(null)}>
                <IconChevronLeft />
                <span>Agregar a playlist</span>
              </button>

              {/* Lista y formulario calcan las clases del "+" (.ptp-list / .ptp-item / .ptp-new):
                  es la MISMA lista de playlists, con el mismo tile de emoji tintado por su hue.
                  Reuso de estilos, no copia: esas clases ya son de nivel raíz. */}
              {playlists === null ? (
                <div className="ctx-loading">Cargando…</div>
              ) : playlists.length > 0 ? (
                <ul className="ptp-list">
                  {playlists.map((pl, idx) => (
                    <li key={pl.id} className="ptp-item" style={{ '--h': emojiHue(pl.emoji), '--i': idx }}>
                      <button
                        type="button"
                        className="ptp-item-main"
                        onClick={() => addToPlaylist(pl)}
                        disabled={busy}
                        title="Añadir a esta playlist"
                      >
                        <span className="ptp-item-emoji">{pl.emoji || '🎵'}</span>
                        <span className="ptp-item-text">
                          <span className="ptp-item-name">{pl.name}</span>
                          <span className="ptp-item-sub">
                            {pl.track_count ?? 0} {pl.track_count === 1 ? 'canción' : 'canciones'}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="ptp-empty">
                  <div className="ptp-empty-icon">🎶</div>
                  <div className="ptp-empty-text">Aún no tenés playlists</div>
                  <div className="ptp-empty-sub">Creá la primera abajo 👇</div>
                </div>
              )}

              <form className="ptp-new" onSubmit={createAndAdd}>
                <EmojiPicker value={newEmoji} onChange={setNewEmoji} />
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Nueva playlist…"
                  autoFocus
                />
                <button className="ptp-new-btn" type="submit" title="Crear y añadir" disabled={busy}>+</button>
              </form>
            </>
          ) : (
            items.map((it, i) => (
              <div key={it.id}>
                {it.sep && i > 0 && <div className="ctx-sep" role="separator" />}
                <button
                  type="button"
                  role="menuitem"
                  className={`ctx-item tone-${it.tone}`}
                  onClick={() => { if (!it.keepOpen) closeMenu(); it.run(); }}
                >
                  {it.icon}
                  <span>{it.label}</span>
                  {it.chev && <IconChevronRight />}
                </button>
              </div>
            ))
          )}
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

// Botón "⋯" de fila: el disparador VISIBLE del menú (el clic derecho sobre la fila sigue
// funcionando como atajo). Vive acá y no en cada vista para que el ancla y el stopPropagation
// se definan UNA vez — igual que el menú es uno solo.
//
//  · `anchor:'element'` → el menú cuelga del BOTÓN (debajo, alineado a su borde derecho), no
//    del punto clicado; el flip y el clamp siguen siendo los mismos.
//  · stopPropagation porque el onClick de la fila REPRODUCE — mismo cuidado que ya tenía el "+".
//    Va explícito acá y no se confía en el de openMenu, que en móvil sale antes de llegar a él.
export function ContextMenuButton({ type, item, label = 'Más acciones' }) {
  const { openMenu } = useContextMenu();
  return (
    <button
      type="button"
      className="ptp-btn ctx-row-btn"
      title={label}
      aria-label={label}
      aria-haspopup="menu"
      onClick={(e) => { e.stopPropagation(); openMenu(e, { type, item, anchor: 'element' }); }}
    >
      <IconMore />
    </button>
  );
}

function IconMore() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="19" cy="12" r="1.9" />
    </svg>
  );
}

// ── Iconos: 14px, monocromo, currentColor. El texto manda; el icono orienta. ──
function IconPlaylistAdd() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="6" x2="16" y2="6" /><line x1="3" y1="12" x2="12" y2="12" /><line x1="3" y1="18" x2="12" y2="18" />
      <line x1="18" y1="9" x2="18" y2="19" /><line x1="13" y1="14" x2="23" y2="14" />
    </svg>
  );
}
function IconChevronRight() {
  return (
    <svg className="ctx-chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
function IconChevronLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}
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
