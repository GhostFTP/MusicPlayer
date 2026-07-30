import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useToast } from './Toast.jsx';
import { api } from '../api/client.js';
import { albumTracks, artistTracks, genreTracks } from '../utils/itemTracks.js';
import EmojiPicker from './EmojiPicker.jsx';
import { emojiHue } from '../utils/emojiHue.js';
import { addTrackToPlaylist, createPlaylistWithTrack } from '../utils/playlistActions.js';

// ── Menú contextual GLOBAL (actions-lab · dirección visual C, "Lista seca") ──────────────
//
// UN solo menú montado y UN provider para toda la app: las superficies (filas de pista, y en
// fase B tarjetas de álbum/artista) sólo llaman openMenu(e, { type, item }); el menú arma sus
// acciones según el `type`. Si algún día aparece un segundo componente de menú, algo se hizo mal.
//
// TIPOS: 'track' (fila de lista) · 'album' (tarjeta) · 'artist' (retrato) · 'queue-track' (fila
// de la cola) · 'playlist-track' (fila del detalle de playlist) · 'genre' (tarjeta de género).
// Cada tipo ofrece SOLO lo que le aplica — no se fuerzan todas las acciones en todos.
//
// DISPARADORES: clic derecho (desktop) · botón "⋯" de la fila (desktop) · LONG-PRESS (móvil,
// fase C1 — utils/useLongPress.js). El long-press entra por una puerta EXPLÍCITA (`via:
// 'longpress'`): sin esa marca, openMenu sigue descartando el móvil por matchMedia. Así el
// 'contextmenu' que Android dispara solo sobre las superficies que TODAVÍA no montaron el hook
// (tarjetas de álbum/artista) sigue cayendo en el menú nativo, como hasta ahora, en vez de
// abrir este popover en sitios que no se probaron. El criterio de régimen es el de siempre:
// ancho, no pointerType.
//
// PRESENTACIÓN — el mismo menú se pinta de dos formas, y lo decide QUIÉN lo abrió (no el ancho).
// La CAJA es la misma en los dos casos: un flotante anclado, con el flip/clamp de siempre. Lo que
// cambia es el CONTENIDO y contra qué punto se ancla:
//   · clic derecho / "⋯"  → LISTA, anclada al cursor o al botón (desktop, sin cambios).
//   · long-press          → GRID DE TILES (icono + etiqueta corta `short`, 2 por fila), anclado
//     al punto del toque y centrado sobre el dedo (C2c), con cada tile teñido con el color de
//     identidad de SU acción desde el reposo (C2e, dirección "Neón" — el porqué, en main.css).
// C2 lo había hecho hoja desde abajo y C2b le puso los tiles adentro; C2c se quedó con los tiles
// y devolvió la caja al flotante — ocupa menos pantalla y aparece donde está la mano.
// Las ACCIONES son las mismas en las dos: `items` se arma una sola vez, más abajo.
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

const MARGIN = 8;      // aire mínimo contra el borde del viewport
const BTN_GAP = 6;     // separación entre el botón "⋯" y el menú que cuelga de él
const TOUCH_GAP = 16;  // separación entre la yema y el menú, en el long-press

// Ancla del menú, según qué lo abrió. Con el CURSOR (clic derecho) nace en el punto exacto.
// Con un BOTÓN (`anchor: 'element'`, el "⋯" de la fila) nace DEBAJO y alineado a su borde
// derecho; `yUp` es el borde superior del botón, que se usa como base al voltear hacia arriba
// para que el menú volteado no le caiga encima. El flip y el clamp los resuelve el mismo efecto.
//
// C2c · Con el LONG-PRESS (móvil) nace junto al DEDO: centrado en horizontal sobre el punto del
// toque (`center`) y separado en vertical, para que la yema no tape la primera fila de tiles.
// `yUp` es el mismo punto con el gap hacia el otro lado → al voltear hacia arriba el menú queda
// por ENCIMA del dedo con la misma separación. Puesto así, el flip/clamp del efecto de abajo no
// necesita saber nada nuevo: es el MISMO mecanismo probado del popover de desktop.
function anchorOf(e, payload) {
  if (payload.via === 'longpress') {
    return { x: e.clientX, y: e.clientY + TOUCH_GAP, yUp: e.clientY - TOUCH_GAP, center: true };
  }
  if (payload.anchor !== 'element') return { x: e.clientX, y: e.clientY };
  const r = e.currentTarget.getBoundingClientRect();
  return { x: r.right, y: r.bottom + BTN_GAP, yUp: r.top - BTN_GAP, alignRight: true };
}

// Rectángulo donde el menú tiene PERMITIDO vivir. En desktop es el viewport con su margen — o
// sea, exactamente lo de siempre. En móvil se le descuentan además:
//  · el NOTCH, vía `--sa-top`. Ojo: la custom property lleva un env() PELADO a propósito. Un
//    `max(env(...), 8px)` ahí adentro NO se evalúa (las custom properties sin registrar no
//    resuelven funciones matemáticas) y getComputedStyle devolvería el texto literal; el piso
//    se aplica acá, en JS.
//  · el CROMO FIJO de abajo (mini barra + tabs), medido del DOM real: sus rects ya traen dentro
//    su propio padding de safe-area, así que no hay que sumar nada a mano. Con el expandido
//    abierto esos dos están tapados y no valen como referencia — ahí manda el inset de abajo.
function safeArea(mobile) {
  const s = { top: MARGIN, bottom: window.innerHeight - MARGIN, left: MARGIN, right: window.innerWidth - MARGIN };
  if (!mobile) return s;
  const cs = getComputedStyle(document.documentElement);
  const px = (name) => parseFloat(cs.getPropertyValue(name)) || 0;
  s.top = Math.max(s.top, px('--sa-top') + MARGIN);
  if (document.querySelector('.player-expanded')) {
    s.bottom = Math.min(s.bottom, window.innerHeight - px('--sa-bottom') - MARGIN);
  } else {
    for (const sel of ['.player-bar', '.bottom-nav']) {
      const r = document.querySelector(sel)?.getBoundingClientRect();
      if (r && r.height > 0) s.bottom = Math.min(s.bottom, r.top - MARGIN);
    }
  }
  return s;
}

// Las pistas de un álbum/artista/género salen de utils/itemTracks.js: desde la fase (b) de
// drag-to-enqueue las comparte con el drop de la cola, que encola exactamente lo mismo que
// "agregar a la cola" del menú. Se movieron tal cual, sin cambiar un parámetro.

// Rótulo accesible por tipo: el menú es uno solo, pero lo que lo abrió cambia.
const MENU_LABEL = {
  'track':          'Acciones de la pista',
  'queue-track':    'Acciones de la pista en la cola',
  'playlist-track': 'Acciones de la pista en la playlist',
  'album':          'Acciones del álbum',
  'artist':         'Acciones del artista',
  'genre':          'Acciones del género',
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
    // CÓMO se presenta: lo decide QUIÉN lo abrió, no el ancho. El long-press es táctil por
    // definición → GRID DE TILES; el clic derecho y el "⋯" son de desktop → LISTA, siempre, a
    // cualquier ancho. Es lo que garantiza "desktop intacto" por construcción y no porque un
    // número caiga de un lado: achicar la ventana no puede cambiarle la cara al clic derecho.
    // Se congela al abrir → la presentación no cambia a mitad de vida.
    // Ojo: `tiles` es sólo el CONTENIDO. La caja es un flotante anclado en los dos casos (C2c);
    // lo que cambia es qué se pinta adentro y contra qué rectángulo se recorta.
    setMenu({ ...payload, tiles: payload.via === 'longpress', ...anchorOf(e, payload) });
  }, []);

  // Posicionamiento con FLIP: se mide el menú ya montado y, si no cabe hacia abajo/derecha, se
  // abre hacia arriba/izquierda. El clamp final es la red: con un menú más alto que la ventana
  // tampoco cabe volteado, así que se pega al borde. Nunca se sale de la pantalla.
  // useLayoutEffect (no useEffect): corre ANTES del pintado → no hay salto visible.
  //
  // Se re-mide también al cambiar de PANEL y al llegar las playlists: el selector ensancha y
  // alarga la caja, así que la que se voltea/clampa es la caja NUEVA, no la de las acciones.
  //
  // C2c · Ahora corre TAMBIÉN en móvil: el menú del long-press dejó de ser una hoja anclada abajo
  // y volvió a ser un flotante, así que reusa este mismo mecanismo — el que ya estaba probado.
  // Lo único que cambia entre regímenes es el RECTÁNGULO contra el que se recorta (`safeArea`) y
  // que el ancla táctil viene centrada; el flip y el clamp son idénticos.
  useLayoutEffect(() => {
    if (!menu || !elRef.current) return;
    const { offsetWidth: w, offsetHeight: h } = elRef.current;
    const s = safeArea(menu.tiles);
    // `alignRight` lo pide el ancla de BOTÓN (el "⋯"): ahí el menú no nace en el punto clicado
    // sino alineado al borde derecho del botón, quepa o no. Con el cursor, sólo voltea si hace
    // falta. Con el ancla táctil (`center`) no hay flip horizontal: se centra y se recorta.
    const flipX = menu.alignRight || (!menu.center && menu.x + w > s.right);
    const flipY = menu.y + h > s.bottom;
    const left = menu.center ? menu.x - w / 2 : (flipX ? menu.x - w : menu.x);
    const x = Math.max(s.left, Math.min(left, s.right - w));
    // Al voltear hacia arriba se usa `yUp` como BORDE INFERIOR: con el cursor es el mismo punto,
    // con un botón es su borde superior y con el dedo es el punto del toque menos el gap — si no,
    // el menú volteado taparía justo lo que lo abrió.
    const y = Math.max(s.top, Math.min(flipY ? (menu.yUp ?? menu.y) - h : menu.y, s.bottom - h));
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
    // El listener de scroll es de CAPTURA, así que ve el scroll de CUALQUIER elemento, no sólo el
    // del contenido de la app: scrollear DENTRO del propio menú lo cerraba. Se notaba poco porque
    // lo único scrolleable era .ptp-list con 6+ playlists, pero en móvil el selector de playlists
    // scrollea siempre. Lo de adentro no cierra.
    const onScroll = (e) => { if (!elRef.current?.contains(e.target)) closeMenu(); };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('blur', closeMenu);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onScroll, true);
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
    // `short` = la etiqueta del TILE en móvil (C2b). Un tile de ~134px no admite "Reproducir a
    // continuación", así que cada acción declara su versión corta acá, al lado de la larga —
    // no en una tabla aparte que se desincronizaría al agregar una acción. Sin `short`, el tile
    // cae a `label` (sirve para las que ya son cortas).
    const pushGoArtist = (albumArtist, seed) => {
      if (host.goArtist && albumArtist) {
        list.push({ id: 'artist', sep: list.length > 0, label: 'Ir al artista', short: 'Artista', tone: 'nav', icon: <IconArtist />, run: () => host.goArtist(seed) });
      }
    };
    // Sólo para ítems que son UNA pista: `api.addToPlaylist` es de a una, así que un álbum o un
    // artista serían N requests — deuda anotada en actions-lab, fuera de alcance.
    // `keepOpen` porque no ejecuta nada: cambia el menú al selector, en la misma caja.
    const pushAddToPlaylist = () => {
      list.push({
        id: 'playlist', label: 'Agregar a playlist', short: 'Playlist', tone: 'playlist', icon: <IconPlaylistAdd />,
        chev: true, keepOpen: true, run: () => setPanel('playlist'),
      });
    };
    // Las dos acciones de cola sobre UNA pista. Se arman una sola vez porque valen igual para una
    // fila de lista y para una fila de playlist: si mañana cambia el texto o el toast, cambia en
    // los dos lados o en ninguno. (La fila de la COLA no las usa: ver su case.)
    const pushQueueActions = (t) => {
      // "A continuación" sobre la pista que YA suena es un no-op → se oculta.
      if (currentTrack?.id !== t.id) {
        list.push({
          id: 'next', label: 'Reproducir a continuación', short: 'A continuación', tone: 'queue', icon: <IconPlayNext />,
          run: () => { playAfterCurrent(t); toast('Suena a continuación'); },
        });
      }
      list.push({
        id: 'queue', label: 'Agregar a la cola', short: 'A la cola', tone: 'queue', icon: <IconQueue />,
        run: () => { addToQueue(t); toast('Añadida a la cola'); },
      });
    };
    const pushTrackNav = (t) => {
      pushGoArtist(t.album_artist, t);
      if (host.goAlbum && t.album) {
        list.push({ id: 'album', sep: !t.album_artist && list.length > 0, label: 'Ir al álbum', short: 'Álbum', tone: 'nav', icon: <IconAlbum />, run: () => host.goAlbum(t) });
      }
      if (host.openInfo) {
        list.push({ id: 'info', sep: list.length > 0, label: 'Ver info', short: 'Info', tone: 'info', icon: <IconInfo />, run: () => host.openInfo(t) });
      }
    };

    switch (menu.type) {
      // ── Pista de una lista ──
      case 'track': {
        pushQueueActions(it);
        pushAddToPlaylist();
        pushTrackNav(it);
        break;
      }

      // ── Fila del DETALLE DE PLAYLIST. Es una pista normal (todo lo de 'track' aplica) MÁS su
      //    acción propia: quitarla de esta playlist. A diferencia de la vista de álbum, acá "ir
      //    al álbum" SÍ aplica: estás en una playlist, no dentro del álbum de la pista.
      //
      //    `onRemove` viaja en el PAYLOAD, igual que `isCurrent` en la fila de cola: quitar de una
      //    playlist depende del estado de Playlists.jsx (cuál está abierta, su lista y su contador),
      //    y eso no es del menú ni del host global. El menú no sabe quitar — invoca lo que ya
      //    existía detrás del botón "✕" de la fila. Sin `onRemove` la acción no aparece.
      case 'playlist-track': {
        if (menu.onRemove) {
          list.push({
            id: 'pl-remove', label: 'Quitar de esta playlist', short: 'Quitar', tone: 'playlist', icon: <IconPlaylistRemove />,
            run: () => menu.onRemove(),
          });
        }
        pushQueueActions(it);
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
            id: 'remove', label: 'Quitar de la cola', short: 'Quitar', tone: 'queue', icon: <IconRemove />,
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
          id: 'play', label: 'Reproducir álbum', short: 'Reproducir', tone: 'queue', icon: <IconPlay />,
          run: () => onTracks(() => albumTracks(it), (ts) => play(ts, 0), 'Ese álbum no tiene pistas'),
        });
        list.push({
          id: 'queue', label: 'Agregar a la cola', short: 'A la cola', tone: 'queue', icon: <IconQueue />,
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
          id: 'play', label: 'Reproducir todo', short: 'Reproducir', tone: 'queue', icon: <IconPlay />,
          run: () => onTracks(() => artistTracks(it), (ts) => play(ts, 0), 'Ese artista no tiene pistas'),
        });
        list.push({
          id: 'queue', label: 'Agregar a la cola', short: 'A la cola', tone: 'queue', icon: <IconQueue />,
          run: () => onTracks(() => artistTracks(it), (ts) => {
            addToQueue(ts);
            toast(`«${it.artist}» a la cola · ${ts.length} ${ts.length === 1 ? 'pista' : 'pistas'}`);
          }, 'Ese artista no tiene pistas'),
        });
        pushGoArtist(it.artist, { album_artist: it.artist });
        break;
      }

      // ── Tarjeta de GÉNERO. Sólo las dos acciones de conjunto: un género abarca muchos artistas
      //    y muchos álbumes, así que no hay un "ir al artista" que signifique algo. Sin "ver info"
      //    por lo mismo que el álbum: el panel de Info es de PISTA.
      case 'genre': {
        list.push({
          id: 'play', label: 'Reproducir género', short: 'Reproducir', tone: 'queue', icon: <IconPlay />,
          run: () => onTracks(() => genreTracks(it), (ts) => play(ts, 0), 'Ese género no tiene pistas'),
        });
        list.push({
          id: 'queue', label: 'Agregar a la cola', short: 'A la cola', tone: 'queue', icon: <IconQueue />,
          run: () => onTracks(() => genreTracks(it), (ts) => {
            addToQueue(ts);
            toast(`«${it.genre}» a la cola · ${ts.length} ${ts.length === 1 ? 'pista' : 'pistas'}`);
          }, 'Ese género no tiene pistas'),
        });
        break;
      }

      default: break;
    }
    return list;
  }, [menu, currentTrack, play, addToQueue, playAfterCurrent, removeFromQueue, onTracks, toast]);

  // C2b · Escalera INTERNA del menú. Con el selector de playlists abierto, el primer Esc/atrás
  // vuelve al grid y el segundo cierra — antes cerraba todo de una. Sigue valiendo "un Esc = una
  // cosa": cada pulsación deshace exactamente UN paso. Vive acá (el menú es el que sabe si tiene
  // un panel abierto) pero la corre Player como peldaño 0 de su escalera, así que no aparece un
  // segundo listener de Esc peleando con el suyo. Devuelve true si consumió algo, igual que
  // dismissTop. NUNCA history.back().
  const dismissMenu = useCallback(() => {
    if (menu === null) return false;
    if (panel !== null) { setPanel(null); return true; }   // selector → grid
    closeMenu();
    return true;
  }, [menu, panel, closeMenu]);

  const value = useMemo(
    () => ({ openMenu, closeMenu, dismissMenu, registerHost, menuOpen: menu !== null }),
    [openMenu, closeMenu, dismissMenu, registerHost, menu],
  );

  return (
    <ContextMenuCtx.Provider value={value}>
      {children}
      {menu && items.length > 0 && (
        <>
        {/* Scrim del menú TÁCTIL. NO es decorativo: sin él, el toque de "cerrar tocando afuera"
            cierra el menú en el pointerdown y después sigue viaje hasta la fila de abajo, que
            REPRODUCE en el click. El scrim se lo come. Por eso, al revés que .exp-scrim (que es
            pointer-events:none porque ahí sólo tiñe), éste sí intercepta.
            El cierre lo hace el listener de document: el scrim está fuera de elRef, así que cae
            solo en la rama de "afuera" — sin handler propio, una sola vía de cierre.
            Hermano ANTERIOR y MISMO z que el menú (patrón de .exp-scrim): el orden del DOM lo
            deja debajo, sin inventar una capa nueva. Sin blur (no revivir el buffeo móvil). */}
        {menu.tiles && <div className="ctx-scrim" aria-hidden="true" />}
        <div
          ref={elRef}
          className={`ctx-menu${panel === 'playlist' ? ' ctx-menu--wide' : ''}${menu.tiles ? ' ctx-menu--tiles' : ''}`}
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
            // El pop nace de la esquina que quedó pegada al cursor. Con el ancla táctil el menú
            // está centrado sobre el dedo, así que crece desde el CENTRO del borde que lo tocó.
            transformOrigin: pos
              ? `${pos.flipY ? 'bottom' : 'top'} ${menu.center ? 'center' : (pos.flipX ? 'right' : 'left')}`
              : undefined,
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
                {/* autoFocus SÓLO en desktop: en táctil, entrar al selector es casi siempre para
                    ELEGIR una playlist existente, y abrir el teclado de una tapa justo la lista que
                    se vino a mirar. Acá se enfoca cuando se toca, como cualquier campo del teléfono. */}
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Nueva playlist…"
                  autoFocus={!menu.tiles}
                />
                <button className="ptp-new-btn" type="submit" title="Crear y añadir" disabled={busy}>+</button>
              </form>
            </>
          ) : menu.tiles ? (
            /* C2b · GRID DE TILES (móvil). Rama de render propia y no un override de CSS sobre la
               lista: el tile es otra composición (icono ARRIBA, etiqueta corta abajo) y los
               separadores no significan nada en una cuadrícula, así que rendirlos y ocultarlos
               sería mentirle al DOM. La lista de desktop, abajo, queda intacta.
               Se reusan `items` tal cual: mismas acciones, mismo orden, mismos iconos y los mismos
               `run` — lo único que cambia es la caja y que la etiqueta usa `short`. */
            <div className="ctx-grid" role="none">
              {items.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  role="menuitem"
                  className={`ctx-tile tone-${it.tone}`}
                  // La etiqueta LARGA sigue siendo la accesible: el tile recorta por espacio,
                  // no porque "Artista" describa mejor la acción que "Ir al artista".
                  aria-label={it.label}
                  onClick={() => { if (!it.keepOpen) closeMenu(); it.run(); }}
                >
                  {it.icon}
                  <span className="ctx-tile-label">{it.short ?? it.label}</span>
                </button>
              ))}
            </div>
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
        </>
      )}
    </ContextMenuCtx.Provider>
  );
}

// Para las superficies: openMenu(e, { type:'track', item:track }). Devuelve un no-op si por lo
// que sea el provider no está montado, para que ninguna vista tenga que preguntar.
export function useContextMenu() {
  return useContext(ContextMenuCtx) ?? NO_MENU;
}
const NO_MENU = { openMenu: () => {}, closeMenu: () => {}, dismissMenu: () => false, registerHost: () => {}, menuOpen: false };

// Botón "⋯" de fila: el disparador VISIBLE del menú (el clic derecho sobre la fila sigue
// funcionando como atajo). Vive acá y no en cada vista para que el ancla y el stopPropagation
// se definan UNA vez — igual que el menú es uno solo.
//
//  · `anchor:'element'` → el menú cuelga del BOTÓN (debajo, alineado a su borde derecho), no
//    del punto clicado; el flip y el clamp siguen siendo los mismos.
//  · stopPropagation porque el onClick de la fila REPRODUCE — mismo cuidado que ya tenía el "+".
//    Va explícito acá y no se confía en el de openMenu, que en móvil sale antes de llegar a él.
//  · `extra` es carga del payload que depende de la SUPERFICIE, no del ítem: hoy lo usa el
//    detalle de playlist para pasar su `onRemove`. Va antes de `anchor` a propósito — el ancla
//    la define este botón y no se deja pisar desde afuera.
export function ContextMenuButton({ type, item, label = 'Más acciones', extra }) {
  const { openMenu } = useContextMenu();
  return (
    <button
      type="button"
      className="ptp-btn ctx-row-btn"
      title={label}
      aria-label={label}
      aria-haspopup="menu"
      onClick={(e) => { e.stopPropagation(); openMenu(e, { type, item, ...extra, anchor: 'element' }); }}
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
// Hermano de IconPlaylistAdd con el signo cambiado: la misma lista, quitando en vez de sumando.
// No reusa IconRemove (el de la cola) para que "quitar de la playlist" no se lea como "quitar de
// la cola" — comparten la idea pero no la superficie.
function IconPlaylistRemove() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="6" x2="16" y2="6" /><line x1="3" y1="12" x2="12" y2="12" /><line x1="3" y1="18" x2="12" y2="18" />
      <line x1="13" y1="14" x2="23" y2="14" />
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
