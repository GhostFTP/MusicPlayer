import { useState, useEffect, useRef, useCallback } from 'react';
import { usePlayer } from '../context/PlayerContext.jsx';
import { api, coverUrl } from '../api/client.js';
import { qualityCodec, qualityDetail, qualityTier, qualityTierTitle } from './QualityChip.jsx';
import AddToPlaylistMenu from './AddToPlaylistMenu.jsx';
import ChangelogBell from './ChangelogBell.jsx';
import SettingsFab from './SettingsFab.jsx';
import LyricsPanel from './LyricsPanel.jsx';
import QueueOverlay from './QueueOverlay.jsx';
import InfoPanel from './InfoPanel.jsx';

function fmt(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

// Color del relleno del volumen según el nivel: teal calmado (bajo/medio) →
// ámbar (alto) → rojo (tope). Se interpola para que la transición sea suave.
const VOL_TEAL  = [45, 212, 191];   // #2dd4bf
const VOL_AMBER = [251, 191, 36];   // #fbbf24
const VOL_RED   = [239, 68, 68];    // #ef4444
function lerpColor(a, b, t) {
  return a.map((c, i) => Math.round(c + (b[i] - c) * t));
}
function volumeColor(v) {
  let c;
  if (v <= 0.55)      c = VOL_TEAL;
  else if (v <= 0.8)  c = lerpColor(VOL_TEAL,  VOL_AMBER, (v - 0.55) / 0.25);
  else if (v <= 0.9)  c = VOL_AMBER;
  else                c = lerpColor(VOL_AMBER, VOL_RED,   (v - 0.9) / 0.10);
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
// El gradiente del relleno lo pinta el CSS (.player-volume / .exp-volume) a
// partir de estas vars; así el mismo color por nivel alimenta relleno, glow
// del riel y tooltip sin duplicar la interpolación.
function volumeVars(v) {
  return { '--vol-pct': `${v * 100}%`, '--vol-color': volumeColor(v) };
}

// Tooltip "vidrio con firma" de la barra (estilos .bar-tip): envuelve un control
// y muestra el tip glass al hover / focus-visible. `accent` tiñe el hairline y
// la palabra de estado; `line` permite un hairline propio (letra: morado→rosa).
// No reemplaza accesibilidad: cada botón conserva su aria-label.
function BarTip({ tip, accent, line, className, children }) {
  const style = {};
  if (accent) style['--tip-accent'] = accent;
  if (line) style['--tip-line'] = line;
  return (
    <span className={`bar-tip-wrap${className ? ` ${className}` : ''}`} style={style}>
      {children}
      <span className="bar-tip" aria-hidden="true">{tip}</span>
    </span>
  );
}

// Frases coquetas para el botón de aleatorio (una al azar en cada hover).
const SHUFFLE_PHRASES = [
  'Pícame', 'Sorpréndeme', 'Tírame algo random', 'Modo caos',
  'Dale shuffle', 'A ver qué sale', 'Confía en mí', 'Ruleta musical',
];

// ── Swipe de la carátula del expandido ──────────────────────────────────────
// Cambia de pista con gesto horizontal, por DISTANCIA (arrastre largo) o por
// VELOCIDAD (flick corto y rápido). Seguimiento 1:1 hasta RUBBER_LIMIT y luego
// resistencia progresiva (rubber-band), sin tope duro.
const DIST_THRESH  = 80;    // px de arrastre para disparar el cambio
const VEL_THRESH   = 0.5;   // px/ms (flick): a esta velocidad basta poca distancia
const MIN_FLICK    = 36;    // px mínimos recorridos para aceptar un flick
const RUBBER_LIMIT = 120;   // px de seguimiento 1:1 antes de la resistencia
const DUR_OUT      = 250;   // ms de la salida (carta que sale volando)
const DUR_IN       = 320;   // ms de la entrada (desliza desde abajo + rebote), coincide con el CSS

// ── Cerrar el expandido deslizando hacia abajo (táctil y mouse) ──
const CLOSE_DIST = 120;   // px de arrastre hacia abajo para cerrar
const CLOSE_VEL  = 0.55;  // px/ms (flick hacia abajo): a esta velocidad basta poca distancia
const CLOSE_MIN  = 24;    // px mínimos recorridos para aceptar un flick
// Cierre con momentum: la duración continúa la velocidad del gesto (distancia
// restante / velocidad, con clamps) — tras un flick el sheet no "frena y re-acelera".
const DUR_CLOSE     = 300;  // ms máximos del cierre (y fallback si no hay velocidad)
const DUR_CLOSE_MIN = 160;  // ms mínimos (que un flick violento no sea un parpadeo)
// Snap-back proporcional a la distancia recorrida (un rebote corto no se arrastra).
const DUR_BACK_MIN = 180;   // ms
const DUR_BACK_MAX = 360;   // ms (la duración fija de antes)

// ── Fijado de eje (compartido carátula/sheet) ──
// Mientras el eje no está decidido se re-evalúa en CADA move (sin candados
// terminales): gana el primer eje que alcanza AXIS_DIST px con dominancia
// AXIS_DOM sobre el perpendicular. El jerk lateral del click del mouse es
// transitorio y pierde la re-evaluación; un swipe real la gana enseguida.
const AXIS_DIST = 12;   // px mínimos para fijar un eje (antes: 8 y terminal)
const AXIS_DOM  = 1.3;  // dominancia requerida sobre el otro eje

// ── Affordance de sheet nativo durante el drag de cierre ──
// Radio progresivo en las esquinas superiores (llega al máximo a ~48px de
// arrastre) + hairline y sombra hacia arriba. El sheet se mantiene OPACO: el
// oscurecido honesto lo pone el scrim de atrás (.exp-scrim), que se aclara a
// medida que el sheet baja.
const SHEET_RADIUS = 24;  // px máximos del radio
const sheetRadius = (y) => Math.min(SHEET_RADIUS, y * 0.5);
const SHEET_EDGE = 'inset 0 1px 0 rgba(255, 255, 255, .1), 0 -18px 48px rgba(0, 0, 0, .45)';

// Resistencia progresiva más allá de RUBBER_LIMIT (no un clamp seco).
function rubber(dx) {
  const a = Math.abs(dx);
  if (a <= RUBBER_LIMIT) return dx;
  return Math.sign(dx) * (RUBBER_LIMIT + (a - RUBBER_LIMIT) * 0.28);
}
// Feedback sutil durante el arrastre (se ignora si prefers-reduced-motion, en el estilo).
function dragRotation(x) { return Math.max(-6, Math.min(6, x * 0.04)); }
function dragOpacity(x)  { return 1 - Math.min(0.28, Math.abs(x) / 520); }

export default function Player({ navigate, view, restoreRoute }) {
  // `navigate(view, target)` disponible para navegar desde la barra. Aún NO se
  // usa (los onClick de portada/artista/género/canción llegan en pasos 3-5).
  const [expanded, setExpanded] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  // Modo de la Letra: inmersivo (full-bleed, tapa la barra) vs panel (deja la barra
  // visible). Vive acá y no en LyricsPanel para coordinarlo con `expanded`:
  // INVARIANTE: nunca expandido montado + Letra en modo panel — el expandido (z 200,
  // fixed inset 0) se colaría ENTRE la Letra (250) y la barra (sin z) y la franja
  // inferior mostraría el expandido cortado en vez de la barra ("barra fantasma").
  const [lyricsImmersive, setLyricsImmersive] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [shufflePhrase, setShufflePhrase] = useState('');
  const [shuffleSpin, setShuffleSpin] = useState(false);
  const [repeatSpin, setRepeatSpin] = useState(false);
  const preMuteVol = useRef(0.7);          // volumen a restaurar al quitar el mute
  const player = usePlayer();
  const { currentTrack, trackMeta, isPlaying, currentTime, duration, volume, togglePlay, next, prev, seek, setVolume,
          shuffle, repeat, toggleShuffle, cycleRepeat } = player;

  // ── Estado del swipe de la carátula ──
  const [dragX, setDragX]     = useState(0);                // desplazamiento crudo durante el arrastre
  const [motion, setMotion]   = useState({ mode: 'idle' }); // idle | drag | out | in | return
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const [coverTrack, setCoverTrack] = useState(currentTrack); // carátula visible (difiere de currentTrack durante la animación)
  const gesture   = useRef(null);          // gesto en curso: { x0, y0, dir, bx, by, lastX, lastY, lastT, vx, vy } | null
  const busy      = useRef(false);         // animación de salida/entrada en curso → ignora gestos nuevos
  const timers    = useRef([]);            // timeouts de la animación (para limpiarlos)
  const artRef    = useRef(null);          // nodo de la carátula (ancho para las animaciones)
  const currentTrackRef = useRef(currentTrack); // último currentTrack (para leerlo dentro de timeouts)

  // ── Estado del gesto "deslizar hacia abajo para cerrar" (táctil y mouse) ──
  const [dragY, setDragY] = useState(0);              // desplazamiento vertical del overlay durante el arrastre
  const [sheet, setSheet] = useState('idle');         // idle | drag | return | closing
  const vGesture = useRef(null);                      // { x0, y0, dir, by, lastY, lastT, vy } | null
  // Timers de vuelta (snap-back) IDENTIFICABLES, fuera de la bolsa `timers`: un
  // pointerdown nuevo los cancela — si dispararan 'idle' a mitad del drag
  // siguiente, lo congelarían (reintento rápido tras un rebote).
  const sheetReturnTimer = useRef(null);              // snap-back del sheet
  const artReturnTimer   = useRef(null);              // spring-back de la carátula
  // Duraciones del cierre/rebote EN CURSO (momentum): las escriben closeSheet()/
  // sheetBack() justo antes del setState y las leen sheetStyle()/scrimStyle().
  const closeDurRef = useRef(DUR_CLOSE);
  const backDurRef  = useRef(DUR_BACK_MAX);

  const repeatState = repeat === 'one' ? 'una canción'
    : repeat === 'all' ? 'toda la cola'
    : 'desactivado';
  const repeatTitle = `Repetir: ${repeatState}`;

  // La metadata enriquecida (badge de calidad + `album`/`album_artist` para navegación y
  // MediaSession) ahora vive en PlayerContext como `trackMeta`, memoizada y compartida.
  // Antes era un estado `quality` local con su propio api.track de fallback.

  // Handle imperativo del InfoPanel: dismissTop dispara su cierre ANIMADO (requestClose)
  // en vez de dejar el Info como excepción que solo su propio Esc conocía (nav-lab).
  const infoRef = useRef(null);

  // ── La escalera del "atrás" (contrato nav-lab · Modelo 2) ───────────────────
  // dismissTop() cierra el overlay más "encima" por prioridad y devuelve true si cerró algo,
  // false si no había nada. Cubre SOLO overlays (Info/Letra/Expandido) — lo único que NO es ruta.
  // Todos los detalles (incluido el álbum, que antes era capa anidada) son RUTAS: abrir = navigate
  // empuja /view/X; cerrar = pop de ruta vía history.back en el back-btn/swipe. La corren DOS
  // disparadores: Esc y el popstate. El swipe-atrás (Layout) NO la llama. Prioridad:
  //  1. Info: cierre ANIMADO (requestClose vía infoRef).
  //  2. Cola: overlay z 255, por encima de la Letra (250) y del expandido (200).
  //  3. Letra: esté o no dentro del expandido.
  //  4. Expandido.
  const dismissTop = useCallback(() => {
    if (showInfo)   { infoRef.current?.requestClose(); return true; }   // cierre animado (imperative handle)
    if (showQueue)  { setShowQueue(false);           return true; }
    if (showLyrics) { setShowLyrics(false);          return true; }
    if (expanded)   { setExpanded(false);           return true; }
    return false;
  }, [showInfo, showQueue, showLyrics, expanded]);

  // Esc global del reproductor → corre la escalera de overlays. Escucha siempre (no solo con
  // expanded=true), así cierra la Letra abierta desde la barra. Bajo el Modelo 2 Esc NO navega
  // rutas (cambiar de vista, cerrar Novedades o un DETALLE es el atrás del navegador): Esc NO
  // llama history.back() → REGLA DURA #3 se cumple trivial (cero history.back() acá).
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') dismissTop(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismissTop]);

  // ── Atrás del navegador = DOS NIVELES (contrato nav-lab · Modelo 2) ──────────
  // Las RUTAS (vistas + detalles /artists/X + changelog/settings) son entradas de historial que
  // empuja Layout.navigate (o el mount al sintetizar el padre). Los OVERLAYS (Info/Cola/Letra/Expandido)
  // NO son rutas, así que para que el atrás los cierre ANTES de tocar una ruta necesitan su propia
  // entrada. Guardia: cada vez que la profundidad de overlays SUBE se empuja UNA entrada del MISMO
  // path/estado (pushState no dispara popstate → sin ciclo); el atrás la consume cerrando el overlay,
  // sin mover la URL. Al BAJAR por Esc/botón la entrada queda sin consumir a propósito: es el
  // "atrás absorbido", quirk conocido del guardia.
  const layerDepth = (showInfo ? 1 : 0) + (showQueue ? 1 : 0) + (showLyrics ? 1 : 0) + (expanded ? 1 : 0);
  const prevLayerDepth = useRef(layerDepth);
  useEffect(() => {
    const delta = layerDepth - prevLayerDepth.current;
    for (let i = 0; i < delta; i++) window.history.pushState(window.history.state, '', window.location.pathname);
    prevLayerDepth.current = layerDepth;
  }, [layerDepth]);

  // popstate = el "atrás" del navegador, en DOS NIVELES. ⛔ REGLA DURA #3 (nav-lab): acá SOLO
  // setState (dismissTop / restoreRoute). NUNCA history.back()/go() dentro de popstate
  // (dispararía otro popstate → loop "el atrás no hace nada"). Nivel 1: si hay una capa,
  // dismissTop la cierra y se PARA (el atrás consumió el guardia; la ruta no se toca). Nivel 2:
  // sin capa, es pop de RUTA → restoreRoute(event.state) restaura la vista de la entrada.
  useEffect(() => {
    const onPop = (e) => {
      if (dismissTop()) return;      // cerró un overlay/álbum anidado → el atrás se consumió ahí
      restoreRoute(e.state);         // pop de ruta (vista o detalle de primer nivel)
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [dismissTop, restoreRoute]);

  // ── Swipe de la carátula del expandido (izq = siguiente, der = anterior) ──
  // Pointer Events (touch + mouse). touch-action: none (CSS): el navegador no
  // panea nada sobre la carátula — el gesto entero es del JS, incluida la
  // vertical hacia abajo (rama dir='close' → cerrar el expandido). Un solo
  // elemento: la carátula vieja SALE hacia el lado del swipe, se cambia la
  // fuente ya fuera de pantalla y la nueva ENTRA desde el lado opuesto.

  // currentTrack más reciente, legible dentro de los timeouts de la animación.
  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
  // La carátula visible sigue a currentTrack, salvo mientras corre la animación
  // (ahí se cambia a mano al quedar fuera de pantalla).
  useEffect(() => { if (!busy.current) setCoverTrack(currentTrack); }, [currentTrack]);
  // prefers-reduced-motion en vivo.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const clearReturnTimers = () => {
    clearTimeout(sheetReturnTimer.current); sheetReturnTimer.current = null;
    clearTimeout(artReturnTimer.current);   artReturnTimer.current = null;
  };
  // Al cerrar el expandido (o desmontar): corta la animación y resetea, para no
  // dejar la carátula colgada ni disparar setState de más.
  useEffect(() => {
    if (expanded) return;
    clearTimers(); clearReturnTimers(); busy.current = false; gesture.current = null;
    setMotion({ mode: 'idle' }); setDragX(0);
    vGesture.current = null; setSheet('idle'); setDragY(0);   // gesto de cierre por swipe-down
  }, [expanded]);
  useEffect(() => () => { clearTimers(); clearReturnTimers(); }, []);

  // Cancela la vuelta pendiente de cada gesto (timer + estado 'return' → 'idle').
  // Se llama en los pointerdown: sin esto, el timer del rebote anterior dispararía
  // 'idle' a mitad del drag nuevo y lo dejaría congelado.
  const cancelSheetReturn = () => {
    if (sheetReturnTimer.current) { clearTimeout(sheetReturnTimer.current); sheetReturnTimer.current = null; }
    setSheet(s => (s === 'return' ? 'idle' : s));
  };
  const cancelArtReturn = () => {
    if (artReturnTimer.current) { clearTimeout(artReturnTimer.current); artReturnTimer.current = null; }
    setMotion(m => (m.mode === 'return' ? { mode: 'idle' } : m));
  };

  // Vuelta con spring (bajo el umbral).
  const springBack = () => {
    if (reduced) { setMotion({ mode: 'idle' }); setDragX(0); return; }
    setMotion({ mode: 'return' });
    setDragX(0);
    clearTimeout(artReturnTimer.current);
    artReturnTimer.current = setTimeout(() => { artReturnTimer.current = null; setMotion({ mode: 'idle' }); }, 520);
  };
  // Cancelación limpia (pointercancel / captura perdida / blur): nunca a medias.
  const cancelGesture = () => {
    if (!gesture.current) return;
    const d = gesture.current.dir;
    gesture.current = null;
    if (d === 'h') springBack();
    else if (d === 'close') sheetBack();                  // swipe-down desde la carátula
    else { setMotion({ mode: 'idle' }); setDragX(0); }
  };
  useEffect(() => {
    const onBlur = () => { cancelGesture(); cancelSheet(); };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  });

  // Cambio de pista: dispara al ARRANCAR la salida (respuesta inmediata), no al
  // terminar. busy corta cualquier gesto nuevo hasta que la entrada acaba.
  const triggerChange = (dir) => {
    busy.current = true;
    if (dir === 'next') next(); else prev();
    if (reduced) { busy.current = false; setMotion({ mode: 'idle' }); setDragX(0); return; }
    // la carta sale volando hacia el lado del swipe (bien fuera de pantalla)
    const w = artRef.current?.offsetWidth || 300;
    const off = Math.max(w + 280, (window.innerWidth || 800) * 0.85);
    setMotion({ mode: 'out', outX: dir === 'next' ? -off : off, rot: dir === 'next' ? -18 : 18 });
    timers.current.push(setTimeout(() => {
      setCoverTrack(currentTrackRef.current);        // ya fuera de pantalla → intercambia la fuente
      setMotion({ mode: 'in' });                     // la nueva entra deslizando desde abajo
      timers.current.push(setTimeout(() => {
        setMotion({ mode: 'idle' }); setDragX(0); busy.current = false;
        setCoverTrack(currentTrackRef.current);      // resync final (por si hubo auto-avance)
      }, DUR_IN + 30));
    }, DUR_OUT));
  };

  const onArtPointerDown = (e) => {
    if (busy.current || sheet === 'closing' || !currentTrack) return;      // ignora gestos durante la animación
    if (e.target.closest?.('button, a, input, [role="button"]')) return;  // no arrancar sobre un control
    // Reintento rápido tras un rebote: cancela AMBAS vueltas pendientes (la de la
    // carátula y la del sheet — este gesto puede terminar en dir='close').
    cancelArtReturn();
    cancelSheetReturn();
    gesture.current = { x0: e.clientX, y0: e.clientY, dir: null, bx: e.clientX, by: e.clientY, lastX: e.clientX, lastY: e.clientY, lastT: e.timeStamp, vx: 0, vy: 0 };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
  };
  // Un solo gesto sobre la carátula: horizontal → cambiar de pista · vertical
  // hacia ABAJO (táctil o mouse) → cerrar el expandido (mismo cierre que el
  // header). El eje se decide por distancia + dominancia, re-evaluando en cada
  // move mientras siga indeciso (ver AXIS_DIST/AXIS_DOM); una vez fijado es
  // definitivo, como siempre. Al fijarlo se RE-BASA el offset renderizado (bx/by
  // = punto del fijado) para que el drag arranque en 0 sin salto; los UMBRALES
  // del up se siguen midiendo desde x0/y0 → mismos 80/120px físicos de siempre.
  const onArtPointerMove = (e) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (g.dir === null) {
      const ax = Math.abs(dx);
      if (ax >= AXIS_DIST && ax >= Math.abs(dy) * AXIS_DOM) {
        g.dir = 'h';                                       // horizontal → cambiar de pista
        g.bx = e.clientX;                                  // re-base del offset renderizado
        g.lastX = e.clientX; g.lastT = e.timeStamp;        // velocidad medida desde el fijado
        setMotion({ mode: 'drag' });
      } else if (dy >= AXIS_DIST && dy >= ax * AXIS_DOM) {
        g.dir = 'close';                                   // vertical hacia abajo → cerrar
        g.by = e.clientY;
        g.lastY = e.clientY; g.lastT = e.timeStamp;
        setSheet('drag');
      } else {
        return;                                            // aún indeciso (o hacia arriba): se sigue esperando
      }
    }
    if (g.dir === 'close') {                               // arrastre de cierre desde la carátula
      const dt = e.timeStamp - g.lastT;
      if (dt > 0) { g.vy = g.vy * 0.7 + ((e.clientY - g.lastY) / dt) * 0.3; g.lastY = e.clientY; g.lastT = e.timeStamp; }
      setDragY(Math.max(0, e.clientY - g.by));
      return;
    }
    const dt = e.timeStamp - g.lastT;                     // velocidad instantánea suavizada (px/ms)
    if (dt > 0) { g.vx = g.vx * 0.7 + ((e.clientX - g.lastX) / dt) * 0.3; g.lastX = e.clientX; g.lastT = e.timeStamp; }
    setDragX(e.clientX - g.bx);                           // re-basado; el rubber se aplica en el estilo
  };
  const onArtPointerUp = (e) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.dir === 'close') {                               // swipe-down desde la carátula → cerrar o volver
      const dy = Math.max(0, e.clientY - g.y0);            // umbral desde el down (feel intacto)
      const flick = g.vy > CLOSE_VEL && dy > CLOSE_MIN;
      if (dy >= CLOSE_DIST || flick) closeSheet(g.vy); else sheetBack();
      return;
    }
    if (g.dir !== 'h') { setMotion({ mode: 'idle' }); setDragX(0); return; }
    const dx = e.clientX - g.x0;                           // umbral desde el down (feel intacto)
    const flick = Math.abs(g.vx) > VEL_THRESH && Math.abs(dx) > MIN_FLICK && Math.sign(g.vx) === Math.sign(dx);
    if (Math.abs(dx) >= DIST_THRESH || flick) triggerChange(dx < 0 ? 'next' : 'prev');
    else springBack();
  };

  // Estilo del wrapper según la fase. La SALIDA (out) lanza la carátula vieja
  // volando hacia el lado del swipe (parte del transform actual del drag,
  // continuidad). La ENTRADA (in) la hace el keyframe exp-card-in (desde abajo).
  const wrapStyle = () => {
    const m = motion.mode;
    if (m === 'drag') {
      const x = rubber(dragX);
      return reduced
        ? { transform: `translateX(${x}px)`, transition: 'none' }
        : { transform: `translateX(${x}px) rotate(${dragRotation(x)}deg)`, opacity: dragOpacity(x), transition: 'none', willChange: 'transform' };
    }
    if (m === 'out') {
      // sale volando hacia el lado: translateX grande + subida + rotación marcada,
      // fade al final (opacity ease-in). Transiciona desde el transform del drag.
      return {
        transform: `translateX(${motion.outX}px) translateY(-20px) rotate(${motion.rot}deg)`,
        opacity: 0,
        transition: `transform ${DUR_OUT}ms cubic-bezier(.25,.8,.4,1), opacity ${DUR_OUT}ms ease-in`,
        willChange: 'transform',
      };
    }
    if (m === 'return') {
      return {
        transform: 'translateX(0) rotate(0deg)',
        opacity: 1,
        transition: reduced ? 'transform .12s linear' : 'transform .52s cubic-bezier(.34,1.42,.6,1), opacity .3s ease',
      };
    }
    return undefined;   // in → keyframe exp-card-in; idle → neutral
  };

  // ── Cerrar el expandido deslizando hacia abajo (táctil y mouse) ──
  // Mismos patrones que el swipe de carátula (Pointer Events, eje fijado por el
  // primer movimiento, velocidad suavizada, cancelación limpia). En desktop el
  // mouse arrastra desde el header o la carátula (cursor grab lo anuncia);
  // Esc / botón "Ahora reproduciendo" siguen funcionando igual.
  // Vuelta con spring si no se alcanza el umbral.
  const sheetBack = () => {
    if (reduced) { setSheet('idle'); setDragY(0); return; }
    // Duración proporcional a lo recorrido (un rebote corto vuelve rápido).
    const dur = Math.round(Math.min(DUR_BACK_MAX, Math.max(DUR_BACK_MIN, dragY * 2)));
    backDurRef.current = dur;
    setSheet('return');
    setDragY(0);
    clearTimeout(sheetReturnTimer.current);
    sheetReturnTimer.current = setTimeout(() => { sheetReturnTimer.current = null; setSheet('idle'); }, dur + 40);
  };
  // Cierre: el overlay baja fuera de pantalla y recién ahí se desmonta. Con
  // momentum: la duración continúa la velocidad del flick (distancia restante /
  // vy, clamp DUR_CLOSE_MIN..DUR_CLOSE) y la curva es ease-out — arranca a la
  // velocidad del gesto en vez de frenar y re-acelerar.
  const closeSheet = (vy = 0) => {
    if (reduced) { setExpanded(false); return; }
    const h = window.innerHeight || 800;
    const remaining = Math.max(0, h - dragY);
    const dur = Math.round(Math.min(DUR_CLOSE, Math.max(DUR_CLOSE_MIN, vy > 0 ? remaining / vy : DUR_CLOSE)));
    closeDurRef.current = dur;
    setSheet('closing');
    setDragY(h);
    timers.current.push(setTimeout(() => setExpanded(false), dur));
  };
  const onSheetPointerDown = (e) => {
    if (busy.current || sheet === 'closing') return;
    // No arrancar el cierre sobre controles ni sobre texto: el header no tiene
    // .exp-meta/.exp-times, pero esta misma función la reutiliza la columna de
    // info en desktop (onInfoPointerDown) → ahí el guard protege enlaces
    // (título/artista/género), sliders (seek/volumen), botones y el bloque de
    // texto (meta y tiempos), dejando agarrable sólo el ambiente de la columna.
    if (e.target.closest?.('button, a, input, [role="button"], .exp-meta, .exp-times')) return;
    cancelSheetReturn();          // reintento rápido tras un rebote: no congelar el drag nuevo
    vGesture.current = { x0: e.clientX, y0: e.clientY, dir: null, by: e.clientY, lastY: e.clientY, lastT: e.timeStamp, vy: 0 };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
  };
  // Eje por distancia + dominancia, re-evaluado en cada move mientras siga
  // indeciso (nada de candados terminales 'x'/'up': acá no compiten con ningún
  // otro gesto y solo congelaban el drag — p.ej. el jerk lateral del click).
  // Al fijar 'y' se re-basa el offset renderizado (by) → sin salto de arranque;
  // el umbral del up se sigue midiendo desde y0 (mismos 120px físicos).
  const onSheetPointerMove = (e) => {
    const g = vGesture.current;
    if (!g) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (g.dir === null) {
      if (dy < AXIS_DIST || dy < Math.abs(dx) * AXIS_DOM) return;  // aún indeciso (o no es un cierre)
      g.dir = 'y';
      g.by = e.clientY;                                            // re-base del offset renderizado
      g.lastY = e.clientY; g.lastT = e.timeStamp;                  // velocidad medida desde el fijado
      setSheet('drag');
    }
    const dt = e.timeStamp - g.lastT;                            // velocidad vertical suavizada (px/ms)
    if (dt > 0) { g.vy = g.vy * 0.7 + ((e.clientY - g.lastY) / dt) * 0.3; g.lastY = e.clientY; g.lastT = e.timeStamp; }
    setDragY(Math.max(0, e.clientY - g.by));                     // sólo hacia abajo
  };
  const onSheetPointerUp = (e) => {
    const g = vGesture.current;
    vGesture.current = null;
    if (!g || g.dir !== 'y') return;
    const dy = Math.max(0, e.clientY - g.y0);                    // umbral desde el down (feel intacto)
    const flick = g.vy > CLOSE_VEL && dy > CLOSE_MIN;
    if (dy >= CLOSE_DIST || flick) closeSheet(g.vy);
    else sheetBack();
  };
  // Cancelación limpia (pointercancel / captura perdida / blur): nunca a medias.
  const cancelSheet = () => {
    const g = vGesture.current;
    if (!g) return;
    const wasY = g.dir === 'y';
    vGesture.current = null;
    if (wasY) sheetBack();
  };
  // Zona de agarre EXTRA sólo en desktop: la columna de info ambiente (los huecos
  // entre bloques y el espacio vacío arriba/abajo) arrastra hacia abajo para
  // CERRAR — misma física que el header (reusa los sheet handlers), sin cambiar
  // de pista (eso sigue siendo exclusivo de la carátula). Se gatea a desktop:
  // en móvil .exp-col-info es display:contents (no genera caja) y sus hijos son
  // controles/texto, así que ahí no debe activarse; el gate lo evita en el down y
  // los move/up/cancel del sheet ya son inertes si no hay gesto (if (!g) return).
  const onInfoPointerDown = (e) => {
    if (!window.matchMedia('(min-width: 701px)').matches) return;   // sólo desktop
    onSheetPointerDown(e);
  };

  // Estilo del overlay según la fase del gesto de cierre. Affordance de sheet
  // nativo: el overlay se mantiene OPACO (nada de ghosting del contenido) y se
  // "despega" con radio progresivo en las esquinas superiores + hairline y
  // sombra hacia arriba; el oscurecido honesto lo comunica el scrim de atrás.
  // El cierre usa la duración con momentum (closeDurRef) y curva ease-out
  // (.22,1,.36,1 — la "salida suave" de la casa); el radio ya presente durante
  // el drag/cierre desaparece solo al desmontar (offscreen, no se nota).
  const sheetStyle = () => {
    if (sheet === 'drag') {
      const r = sheetRadius(dragY);
      return {
        transform: `translateY(${dragY}px)`,
        borderRadius: `${r}px ${r}px 0 0`,
        boxShadow: SHEET_EDGE,
        transition: 'none',
        willChange: 'transform',
      };
    }
    if (sheet === 'closing') {
      return {
        transform: `translateY(${dragY}px)`,
        borderRadius: `${SHEET_RADIUS}px ${SHEET_RADIUS}px 0 0`,
        boxShadow: SHEET_EDGE,
        transition: `transform ${closeDurRef.current}ms cubic-bezier(.22,1,.36,1), border-radius ${closeDurRef.current}ms ease`,
      };
    }
    if (sheet === 'return') {
      return {
        transform: 'translateY(0)',
        borderRadius: '0px 0px 0 0',
        boxShadow: SHEET_EDGE,
        transition: `transform ${backDurRef.current}ms cubic-bezier(.34,1.42,.6,1), border-radius ${backDurRef.current}ms ease`,
      };
    }
    return undefined;   // idle → deja la animación de entrada del CSS (slide-up)
  };
  // Scrim detrás del sheet (hermano previo en el DOM, .exp-scrim): mientras el
  // sheet baja, lo que se revela detrás (app + barra) se ve a través de un
  // oscurecido que se ACLARA con el progreso — el fade honesto del cierre. En
  // idle queda en su opacity 0 del CSS (no ensombrece la entrada slide-up).
  const scrimStyle = () => {
    const h = window.innerHeight || 800;
    if (sheet === 'drag')    return { opacity: Math.max(0, 1 - dragY / (h * 0.9)), transition: 'none' };
    if (sheet === 'closing') return { opacity: 0, transition: `opacity ${closeDurRef.current}ms ease` };
    if (sheet === 'return')  return { opacity: 1, transition: `opacity ${backDurRef.current}ms ease` };
    return undefined;
  };

  // Mute: clic en la bocina silencia (guardando el volumen previo) y otro clic lo
  // restaura. stopPropagation para no abrir el expandido desde la barra.
  const toggleMute = (e) => {
    e.stopPropagation();
    if (volume > 0) { preMuteVol.current = volume; setVolume(0); }
    else { setVolume(preMuteVol.current > 0 ? preMuteVol.current : 0.7); }
  };

  // Abrir "Ahora reproduciendo" (clic en zona libre de la barra o en la portada).
  // Con la Letra abierta en modo panel, el comportamiento depende del viewport
  // (lectura PUNTUAL del ancho, sin estado ni listener; el 700 espeja el bloque CSS
  // móvil maestro ~main.css:2559 @media (max-width: 700px)):
  //  · MÓVIL (≤700px): se promueve la Letra a inmersivo y se expande — mismo estado
  //    canónico que abrir la Letra desde el expandido (Letra full-bleed con el
  //    expandido detrás); cerrar la Letra (X / Esc) revela el expandido que el clic pidió.
  //  · DESKTOP (>700px): la Letra en panel manda (el clic en la barra era sólo para
  //    usar la barra, no para tapar la vista). NO se monta el expandido: early-return
  //    con setExpanded(false) defensivo — quitar sólo la promoción no basta, el
  //    setExpanded(true) de abajo reintroduciría la "barra fantasma" (expandido montado
  //    bajo la Letra en panel).
  // Sin Letra abierta (cualquier viewport): se expande como siempre.
  const openNowPlaying = () => {
    const isMobile = window.matchMedia('(max-width: 700px)').matches;
    if (showLyrics) {
      if (!isMobile) { setExpanded(false); return; }   // desktop: no montar el expandido bajo la Letra en panel
      setLyricsImmersive(true);                          // móvil: Letra → inmersivo + expandir
    }
    setExpanded(true);
  };

  // Toggle de la Letra desde el EXPANDIDO: abre directo en inmersivo (full-bleed
  // sobre el expandido, que queda montado detrás).
  const toggleLyricsExpanded = () => {
    if (!showLyrics) setLyricsImmersive(true);
    setShowLyrics(v => !v);
  };
  // Toggle de la Letra desde la BARRA (desktop y mini móvil): abre en modo panel
  // (la barra sigue visible). stopPropagation: no abrir el expandido de paso.
  const toggleLyricsBar = (e) => {
    e.stopPropagation();
    if (!showLyrics) setLyricsImmersive(false);
    setShowLyrics(v => !v);
  };

  // La portada abre la vista "Ahora reproduciendo" (también en desktop). Lleva
  // stopPropagation porque .player-bar abre el expandido en cualquier zona libre:
  // el clic en la portada ya lo abre y no debe re-disparar. Inerte si no hay pista.
  const openExpanded = (e) => {
    if (!currentTrack) return;
    e.stopPropagation();
    openNowPlaying();
  };

  const art = currentTrack?.cover_path
    ? <img className="player-art" src={coverUrl(currentTrack.id)} alt="" onClick={openExpanded} title="Abrir reproductor" />
    : <div className="player-art-placeholder" onClick={openExpanded} title="Abrir reproductor">♪</div>;

  // Género (integrado al subtítulo) del track enriquecido (trackMeta) o del actual.
  const genre = (trackMeta ?? currentTrack)?.genre ?? null;
  // album_artist/album confiables: trackMeta (api.track = SELECT *) o el track de la
  // cola. Para navegar al artista usamos album_artist (NO el `artist` mostrado, que
  // rompería "Various Artists"/feats). Puede faltar `album_artist` si la cola vino de una
  // playlist → goArtist/goAlbum lo resuelven con api.track(id) (fetch lazy, sin tocar).
  const albumArtist = (trackMeta ?? currentTrack)?.album_artist ?? null;
  const album       = (trackMeta ?? currentTrack)?.album ?? null;

  // Navegación desde la barra Y el expandido. stopPropagation (no disparar el
  // onClick de .player-track en móvil) y cierre del expandido Y de la Letra antes
  // de cambiar de vista (la Letra —panel o inmersiva— cubre el área de contenido:
  // sin cerrarla, la vista destino quedaba oculta detrás). Inertes si falta el dato.
  const goGenre = (e) => {
    e.stopPropagation();
    if (!genre) return;
    setExpanded(false);
    setShowLyrics(false);
    navigate('genres', { genre });
  };
  const goArtist = async (e) => {
    e.stopPropagation();
    if (!currentTrack) return;
    let artist = albumArtist;
    if (!artist) { try { artist = (await api.track(currentTrack.id))?.album_artist ?? null; } catch { /* ignore */ } }
    if (!artist) return;
    setExpanded(false);
    setShowLyrics(false);
    navigate('artists', { artist });
  };
  const goAlbum = async (e) => {
    e.stopPropagation();
    if (!currentTrack) return;
    let alb = album, aArtist = albumArtist;
    if (!alb) {
      try { const full = await api.track(currentTrack.id); alb = full?.album ?? null; aArtist = full?.album_artist ?? null; }
      catch { /* ignore */ }
    }
    if (!alb) return;
    setExpanded(false);
    setShowLyrics(false);
    navigate('albums', { album: alb, album_artist: aArtist });
  };
  // Calidad partida: códec para el badge + resto del detalle como texto gris.
  // El color/caja del badge refleja el tier (hi-res / lossless / lossy…).
  const qCodec = qualityCodec(trackMeta);
  const qDetail = qualityDetail(trackMeta);
  const qTier = qualityTier(trackMeta);

  // Color del tiempo transcurrido, por PRIORIDAD: pausa (ámbar) > últimos 15s (rojo)
  // > normal (lavanda). El color transiciona suave (va en el span estable, no en el
  // interior que se remonta cada segundo). Al reanudar/cambiar de canción vuelve solo.
  const ending = duration > 0 && duration - currentTime <= 15;
  const timeClass = !isPlaying ? ' time-paused' : ending ? ' time-ending' : '';

  // Elige una frase distinta a la anterior en cada hover del shuffle.
  const pickShufflePhrase = () => setShufflePhrase(prev => {
    if (SHUFFLE_PHRASES.length < 2) return SHUFFLE_PHRASES[0];
    let p = prev;
    while (p === prev) p = SHUFFLE_PHRASES[Math.floor(Math.random() * SHUFFLE_PHRASES.length)];
    return p;
  });

  return (
    <>
      {/* ── Campanita de Novedades (solo móvil; oculta con overlays abiertos) ── */}
      <ChangelogBell navigate={navigate} view={view} hidden={expanded || showLyrics || showInfo || showQueue} />
      <SettingsFab   navigate={navigate} view={view} hidden={expanded || showLyrics || showInfo || showQueue} />

      {/* ── Panel de letra (overlay, desktop y móvil). Modo controlado desde acá;
          "Reducir" además cierra el expandido: modo panel ⇒ barra real visible
          (si el expandido quedara montado detrás, su franja taparía la barra). ── */}
      {showLyrics && (
        <LyricsPanel
          onClose={() => setShowLyrics(false)}
          immersive={lyricsImmersive}
          onToggleImmersive={next => {
            setLyricsImmersive(next);
            if (!next) setExpanded(false);
          }}
        />
      )}

      {/* ── Panel de información de la pista (modal) ── */}
      {showInfo && (
        <InfoPanel
          ref={infoRef}
          track={trackMeta ?? currentTrack}
          onClose={() => setShowInfo(false)}
          navigate={(view, target) => { setShowInfo(false); setExpanded(false); setShowLyrics(false); navigate(view, target); }}
        />
      )}

      {/* ── Vista de cola (overlay del player) ── */}
      {showQueue && <QueueOverlay onClose={() => setShowQueue(false)} />}

      {/* ── Full-screen expanded player (mobile) ── */}
      {/* Scrim del gesto de cierre: mismo z (200) que el sheet, pero hermano
          ANTERIOR en el DOM → pinta debajo. Comparte el {expanded && …}: se
          desmonta junto con el sheet (Esc, reduced-motion, fin del cierre),
          nunca queda huérfano. pointer-events: none en CSS. */}
      {expanded && <div className="exp-scrim" style={scrimStyle()} aria-hidden="true" />}
      {expanded && (
        <div className="player-expanded" style={sheetStyle()}>
          {/* Fondo: carátula actual difuminada + overlay oscuro. key → refade al
              cambiar de canción. aria-hidden: decorativo. */}
          {currentTrack?.cover_path && (
            <div
              key={currentTrack.id}
              className="exp-bg"
              style={{ backgroundImage: `url(${coverUrl(currentTrack.id)})` }}
              aria-hidden="true"
            />
          )}
          <div
            className="exp-header"
            onPointerDown={onSheetPointerDown}
            onPointerMove={onSheetPointerMove}
            onPointerUp={onSheetPointerUp}
            onPointerCancel={cancelSheet}
            onLostPointerCapture={cancelSheet}
          >
            <button className="exp-back" onClick={() => setExpanded(false)}>
              <ChevronDown /> Ahora reproduciendo
            </button>
            <div className="exp-head-actions">
              <button
                className={`exp-icon-btn${showQueue ? ' active' : ''}`}
                onClick={() => setShowQueue(v => !v)}
                title="Cola"
              >
                <QueueGlyph size={22} />
              </button>
              <button
                className={`exp-icon-btn${showLyrics ? ' active' : ''}`}
                onClick={toggleLyricsExpanded}
                title="Letra"
              >
                <LyricsGlyph size={22} />
              </button>
              <button
                className={`exp-icon-btn exp-info${showInfo ? ' active' : ''}`}
                onClick={() => setShowInfo(v => !v)}
                disabled={!currentTrack}
                title="Información de la pista"
              >
                <InfoIcon size={22} />
              </button>
              {currentTrack && (
                <AddToPlaylistMenu trackId={currentTrack.id} className="ptp-exp" />
              )}
            </div>
          </div>

          {/* Cuerpo: en desktop dos columnas (carátula | info); en móvil los
              wrappers son display:contents y el layout de columna queda igual. */}
          <div className="exp-body">
            <div className="exp-col-art">
              <div
                ref={artRef}
                className={`exp-art-wrap${motion.mode === 'in' ? ' exp-card-in' : ''}`}
                onPointerDown={onArtPointerDown}
                onPointerMove={onArtPointerMove}
                onPointerUp={onArtPointerUp}
                onPointerCancel={cancelGesture}
                onLostPointerCapture={cancelGesture}
                style={wrapStyle()}
              >
                {coverTrack?.cover_path
                  ? <img className="exp-art" src={coverUrl(coverTrack.id)} alt="" draggable={false} />
                  : <div className="exp-art-placeholder">♪</div>
                }
              </div>
            </div>

            <div
              className="exp-col-info"
              onPointerDown={onInfoPointerDown}
              onPointerMove={onSheetPointerMove}
              onPointerUp={onSheetPointerUp}
              onPointerCancel={cancelSheet}
              onLostPointerCapture={cancelSheet}
            >

          <div className="exp-meta">
            <div
              className={`exp-title${currentTrack ? ' exp-link' : ''}`}
              onClick={currentTrack ? goAlbum : undefined}
              title={currentTrack ? 'Ir al álbum' : undefined}
            >
              {currentTrack?.title ?? 'Sin reproducción'}
            </div>
            <div className="exp-subline">
              {currentTrack?.artist
                ? <span className="exp-artist exp-link" onClick={goArtist} title="Ir al artista">{currentTrack.artist}</span>
                : <span className="exp-artist">—</span>}
              {genre && (
                <span className="exp-genre exp-link" onClick={goGenre} title={`Ver género: ${genre}`}>{genre}</span>
              )}
              {(qCodec || qDetail) && (
                <div className="player-quality">
                  {qCodec && (
                    <span
                      className={`quality-chip player-quality-badge q-${qTier.id}`}
                      title={qualityTierTitle(trackMeta)}
                    >
                      {qCodec}
                    </span>
                  )}
                  {qDetail && <span className={`player-quality-detail q-${qTier.id}`}>{qDetail}</span>}
                </div>
              )}
            </div>
          </div>

          <div className="exp-progress">
            <SeekBar value={currentTime} max={duration} playing={isPlaying} onSeek={seek} />
          </div>
          <div className="exp-times">
            <span className={`exp-time-elapsed${timeClass}`}>
              <span key={fmt(currentTime)} className="time-tick">{fmt(currentTime)}</span>
            </span>
            <span className="exp-time-total">{fmt(duration)}</span>
          </div>

          <div className="exp-controls">
            <button
              className={`exp-btn${shuffle ? ' active' : ''}`}
              onClick={() => { toggleShuffle(); setShuffleSpin(true); }}
              aria-pressed={shuffle}
              title={`Aleatorio: ${shuffle ? 'activado' : 'desactivado'}`}
            >
              <span
                className={`shuffle-icon${shuffleSpin ? ' spin' : ''}`}
                onAnimationEnd={() => setShuffleSpin(false)}
              >
                <ShuffleIcon size={24} />
              </span>
            </button>
            <button className="exp-btn exp-prev" onClick={prev}>
              <PrevIcon size={28} />
            </button>
            <button className="exp-btn play" onClick={togglePlay}>
              <span key={isPlaying ? 'pause' : 'play'} className="exp-play-swap">
                {isPlaying ? <PauseIcon size={32} /> : <PlayIcon size={32} />}
              </span>
            </button>
            <button className="exp-btn exp-next" onClick={next}>
              <NextIcon size={28} />
            </button>
            <button
              className={`exp-btn${repeat !== 'off' ? ' active' : ''}`}
              onClick={() => { cycleRepeat(); setRepeatSpin(true); }}
              aria-pressed={repeat !== 'off'}
              title={repeatTitle}
            >
              <span
                className={`repeat-icon${repeatSpin ? ' spin' : ''}`}
                onAnimationEnd={() => setRepeatSpin(false)}
              >
                {repeat === 'one' ? <RepeatOneIcon size={24} /> : <RepeatIcon size={24} />}
              </span>
            </button>
          </div>

          <div className="exp-volume">
            <button
              className="volume-btn"
              onClick={toggleMute}
              title={volume === 0 ? 'Activar sonido' : 'Silenciar'}
              aria-label={volume === 0 ? 'Activar sonido' : 'Silenciar'}
            >
              <VolumeIcon muted={volume === 0} color={volumeColor(volume)} />
            </button>
            <input
              type="range"
              min={0} max={1} step={0.02}
              value={volume}
              onChange={e => setVolume(Number(e.target.value))}
              style={volumeVars(volume)}
            />
          </div>

          {/* Acciones (letra, info, +): en desktop van aquí, bajo el volumen; en
              móvil se ocultan (CSS) y se usan las del header. */}
          <div className="exp-actions">
            <button
              className={`exp-icon-btn${showQueue ? ' active' : ''}`}
              onClick={() => setShowQueue(v => !v)}
              title="Cola"
            >
              <QueueGlyph size={22} />
            </button>
            <button
              className={`exp-icon-btn${showLyrics ? ' active' : ''}`}
              onClick={toggleLyricsExpanded}
              title="Letra"
            >
              <LyricsGlyph size={22} />
            </button>
            <button
              className={`exp-icon-btn exp-info${showInfo ? ' active' : ''}`}
              onClick={() => setShowInfo(v => !v)}
              disabled={!currentTrack}
              title="Información de la pista"
            >
              <InfoIcon size={22} />
            </button>
            {currentTrack && (
              <AddToPlaylistMenu trackId={currentTrack.id} className="ptp-exp" placement="up" />
            )}
          </div>
            </div>{/* /exp-col-info */}
          </div>{/* /exp-body */}
        </div>
      )}

      {/* ── Player bar (desktop full / mobile mini) ── */}
      {/* Clic en CUALQUIER zona libre de la barra (huecos alrededor de controles,
          seek y volumen) abre el expandido. Cada control interactivo corta la
          propagación para no dispararlo. */}
      <div className="player-bar" onClick={openNowPlaying}>

        {/* Track info (portada, links y "+" cortan la propagación) */}
        <div className="player-track">
          {currentTrack ? (
            <>
              {art}
              <div className="player-meta">
                {/* El link va en un span inline (ancho = texto): el div ocupa todo el
                    ancho de la barra y con el onClick encima se tragaba el tap en la
                    zona "vacía" (goAlbum + stopPropagation) en vez de abrir el expandido. */}
                <div className="player-title">
                  <span className="player-bar-link" onClick={goAlbum} title="Ir al álbum">
                    {currentTrack.title ?? 'Sin título'}
                  </span>
                </div>
                <div className="player-artist">
                  {currentTrack.artist
                    ? <span className="player-bar-link" onClick={goArtist} title="Ir al artista">{currentTrack.artist}</span>
                    : 'Artista desconocido'}
                  {genre && (
                    <>
                      <span className="player-genre"> · </span>
                      <span
                        className="player-genre player-bar-link"
                        onClick={goGenre}
                        title={`Ver género: ${genre}`}
                      >
                        {genre}
                      </span>
                    </>
                  )}
                </div>
                {(qCodec || qDetail) && (
                  <div className="player-quality">
                    {qCodec && (
                      <span
                        className={`quality-chip player-quality-badge q-${qTier.id}`}
                        title={qualityTierTitle(trackMeta)}
                      >
                        {qCodec}
                      </span>
                    )}
                    {qDetail && <span className={`player-quality-detail q-${qTier.id}`}>{qDetail}</span>}
                  </div>
                )}
              </div>
              {/* El "+" entra al sistema de tooltips con su firma teal; el CSS
                  oculta el tip mientras el menú está abierto (.ptp.active). */}
              <BarTip tip={<>Añadir a <span className="bar-tip-state">playlist</span></>} accent="var(--teal)">
                <AddToPlaylistMenu trackId={currentTrack.id} placement="up" className="ptp-player" nativeTitle={false} />
              </BarTip>
            </>
          ) : (
            <div className="player-meta">
              <div className="player-title" style={{ color: 'var(--text-muted)' }}>Sin reproducción</div>
            </div>
          )}
        </div>

        {/* Desktop: center controls + progress */}
        <div className="player-controls">
          <div className="player-buttons">
            <BarTip tip={shufflePhrase || SHUFFLE_PHRASES[0]}>
              <button
                className={`ctrl-btn shuffle-btn${shuffle ? ' active' : ''}`}
                onClick={e => { e.stopPropagation(); toggleShuffle(); setShuffleSpin(true); }}
                onMouseEnter={pickShufflePhrase}
                aria-pressed={shuffle}
                aria-label={`Aleatorio: ${shuffle ? 'activado' : 'desactivado'}`}
              >
                <span
                  className={`shuffle-icon${shuffleSpin ? ' spin' : ''}`}
                  onAnimationEnd={() => setShuffleSpin(false)}
                >
                  <ShuffleIcon />
                </span>
              </button>
            </BarTip>
            <BarTip tip={<>Anterior <span className="bar-tip-kbd">←</span></>}>
              <button className="ctrl-btn ctrl-prev" onClick={e => { e.stopPropagation(); prev(); }} aria-label="Anterior (←)"><PrevIcon /></button>
            </BarTip>
            <BarTip tip={<>{isPlaying ? 'Pausa' : 'Reproducir'} <span className="bar-tip-kbd">espacio</span></>}>
              <button
                className="ctrl-btn play"
                onClick={e => { e.stopPropagation(); togglePlay(); }}
                aria-label={`${isPlaying ? 'Pausa' : 'Reproducir'} (espacio)`}
              >
                <span key={isPlaying ? 'pause' : 'play'} className="ctrl-play-swap">
                  {isPlaying ? <PauseIcon /> : <PlayIcon />}
                </span>
              </button>
            </BarTip>
            <BarTip tip={<>Siguiente <span className="bar-tip-kbd">→</span></>}>
              <button className="ctrl-btn ctrl-next" onClick={e => { e.stopPropagation(); next(); }} aria-label="Siguiente (→)"><NextIcon /></button>
            </BarTip>
            <BarTip tip={<>Repetir: <span className={`bar-tip-state${repeat === 'off' ? ' dim' : ''}`}>{repeatState}</span></>}>
              <button
                className={`ctrl-btn${repeat !== 'off' ? ' active' : ''}`}
                onClick={e => { e.stopPropagation(); cycleRepeat(); setRepeatSpin(true); }}
                aria-pressed={repeat !== 'off'}
                aria-label={repeatTitle}
              >
                <span
                  className={`repeat-icon${repeatSpin ? ' spin' : ''}`}
                  onAnimationEnd={() => setRepeatSpin(false)}
                >
                  {repeat === 'one' ? <RepeatOneIcon /> : <RepeatIcon />}
                </span>
              </button>
            </BarTip>
          </div>
          <div className="player-progress">
            <span className={`time-label time-elapsed${timeClass}`}>
              <span key={fmt(currentTime)} className="time-tick">{fmt(currentTime)}</span>
            </span>
            <SeekBar value={currentTime} max={duration} playing={isPlaying} onSeek={seek} />
            <span className="time-label right time-total">{fmt(duration)}</span>
          </div>
        </div>

        {/* Desktop: acciones (cola, letra, info) + volumen. En móvil `.player-actions`
            se oculta por completo (la cola en móvil se abre desde el expandido). */}
        <div className="player-actions">
          <BarTip tip="Cola" accent="var(--accent)">
            <button
              className={`action-btn queue-btn${showQueue ? ' active' : ''}`}
              onClick={e => { e.stopPropagation(); setShowQueue(v => !v); }}
              aria-pressed={showQueue}
              aria-label="Cola"
            >
              <QueueGlyph />
            </button>
          </BarTip>
          <BarTip tip="Letra" accent="var(--lyric-pink)" line="linear-gradient(90deg, var(--accent), var(--lyric-pink))">
            <button
              className={`action-btn lyrics-btn${showLyrics ? ' active' : ''}`}
              onClick={toggleLyricsBar}
              aria-pressed={showLyrics}
              aria-label="Letra"
            >
              <LyricsGlyph />
            </button>
          </BarTip>
          <BarTip tip="Información de la pista" accent="var(--amber)">
            <button
              className={`action-btn info-btn${showInfo ? ' active' : ''}`}
              onClick={e => { e.stopPropagation(); setShowInfo(v => !v); }}
              aria-pressed={showInfo}
              disabled={!currentTrack}
              aria-label="Información de la pista"
            >
              <InfoIcon />
            </button>
          </BarTip>
          {/* El grupo entero (bocina + slider) comparte un tooltip con readout
              del nivel, teñido por volumeColor; gris cuando está silenciado. */}
          <div
            className="player-volume bar-tip-wrap"
            style={{ '--tip-accent': volume === 0 ? 'var(--text-muted)' : volumeColor(volume) }}
          >
            <button
              className="volume-btn"
              onClick={toggleMute}
              aria-label={volume === 0 ? 'Activar sonido' : 'Silenciar'}
            >
              <VolumeIcon muted={volume === 0} color={volumeColor(volume)} />
            </button>
            <input
              type="range"
              min={0} max={1} step={0.02}
              value={volume}
              onChange={e => setVolume(Number(e.target.value))}
              onClick={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
              style={volumeVars(volume)}
            />
            <span className="bar-tip" aria-hidden="true">
              {volume === 0
                ? <span className="bar-tip-state dim">Silenciado</span>
                : <>Volumen · <span className="bar-tip-state">{Math.round(volume * 100)}%</span></>}
            </span>
          </div>
        </div>

        {/* Mobile mini controls — letra + play + siguiente (lyrics nunca desaparece) */}
        <div className="player-mini-controls">
          <button
            className={`mini-btn lyrics-mini${showLyrics ? ' active' : ''}`}
            onClick={toggleLyricsBar}
            title="Letra"
          >
            <LyricsGlyph size={22} />
          </button>
          <button
            className="mini-btn play-mini"
            onClick={e => { e.stopPropagation(); togglePlay(); }}
          >
            {isPlaying ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
          </button>
          <button
            className="mini-btn mini-next"
            onClick={e => { e.stopPropagation(); next(); }}
          >
            <NextIcon size={22} />
          </button>
        </div>

      </div>
    </>
  );
}

function PlayIcon({ size = 18 })  {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>;
}
function PauseIcon({ size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>;
}
function PrevIcon({ size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><polygon points="19,20 9,12 19,4"/><line x1="5" y1="4" x2="5" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>;
}
function NextIcon({ size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><polygon points="5,4 15,12 5,20"/><line x1="19" y1="4" x2="19" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>;
}
function ShuffleIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 3 21 3 21 8" />
      <line x1="4" y1="20" x2="21" y2="3" />
      <polyline points="21 16 21 21 16 21" />
      <line x1="15" y1="15" x2="21" y2="21" />
      <line x1="4" y1="4" x2="9" y2="9" />
    </svg>
  );
}
function RepeatIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}
function RepeatOneIcon({ size = 18 }) {
  // Mismo lazo de repetir + un "1" centrado para distinguir "repetir una".
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
      <text className="repeat-one-digit" x="12" y="15.5" textAnchor="middle" fontSize="9" fontWeight="700" fill="currentColor" stroke="none" fontFamily="system-ui, sans-serif">1</text>
    </svg>
  );
}
// Glifo de cola: líneas de lista (decrecientes) + triángulo de play. SVG inline propio.
function QueueGlyph({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="14" y2="12" />
      <line x1="4" y1="17" x2="12" y2="17" />
      <polygon points="17,13 22,15.5 17,18" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Glifo de letra original: líneas de texto + nota musical (corchea) + un destello
// (sparkle) que late despacio vía CSS (.lyrics-glyph-sparkle). SVG inline propio.
function LyricsGlyph({ size = 20 }) {
  // Colores por clase (CSS): líneas en morado (accent), nota + destello en rosa.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="lyrics-glyph" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {/* líneas de letra — morado */}
      <g className="lg-lines">
        <line x1="3" y1="6.5"  x2="12" y2="6.5" />
        <line x1="3" y1="11"   x2="10" y2="11" />
        <line x1="3" y1="15.5" x2="8"  y2="15.5" />
      </g>
      {/* nota musical (cabeza + plica con beam) — rosa */}
      <circle className="lg-note-head" cx="15.4" cy="17" r="2.3" />
      <path className="lg-note-stem" d="M17.7 17V8.4l3.6-1.1v6.6" />
      {/* destello / sparkle — rosa (late) */}
      <path className="lyrics-glyph-sparkle lg-spark"
            d="M19.2 2.3l.62 1.66 1.66.62-1.66.62-.62 1.66-.62-1.66L16.9 4.58l1.66-.62z" />
    </svg>
  );
}
// Icono info-circle original.
function InfoIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <circle cx="12" cy="8" r="1.05" fill="currentColor" stroke="none" />
    </svg>
  );
}
function ChevronDown() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="6,9 12,15 18,9"/></svg>;
}
function VolumeIcon({ muted, color }) {
  // En silencio: gris tenue. Con volumen: acompaña el color del nivel (item 3).
  const stroke = muted ? 'var(--text-muted)' : (color ?? 'var(--text-muted)');
  return muted
    ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
    : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>;
}

// Barra de progreso animada (item 4): thumb que crece al hover/seek y un shimmer
// tenue sobre lo ya reproducido (sólo en play). El relleno se dibuja por CSS con
// --seek-pct, así el destello queda confinado a la parte reproducida.
function SeekBar({ value, max, playing, onSeek }) {
  const pct = max ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      className="seek"
      style={{ '--seek-pct': `${pct}%` }}
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
    >
      <div className="seek-fill">
        {playing && <span className="seek-shimmer" aria-hidden="true" />}
      </div>
      <input
        type="range"
        min={0} max={max || 0} step={0.5}
        value={value}
        onChange={e => onSeek(Number(e.target.value))}
      />
    </div>
  );
}
