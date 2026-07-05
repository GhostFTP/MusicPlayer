import { useState, useEffect, useRef } from 'react';
import { usePlayer } from '../context/PlayerContext.jsx';
import { api, coverUrl } from '../api/client.js';
import { qualityCodec, qualityDetail, qualityTier, qualityTierTitle } from './QualityChip.jsx';
import AddToPlaylistMenu from './AddToPlaylistMenu.jsx';
import ChangelogBell from './ChangelogBell.jsx';
import LyricsPanel from './LyricsPanel.jsx';
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
function volumeFillStyle(v) {
  const pct = v * 100;
  return { background: `linear-gradient(to right, ${volumeColor(v)} ${pct}%, var(--border) ${pct}%)` };
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

// ── Cerrar el expandido deslizando hacia abajo (móvil) ──
const CLOSE_DIST = 120;   // px de arrastre hacia abajo para cerrar
const CLOSE_VEL  = 0.55;  // px/ms (flick hacia abajo): a esta velocidad basta poca distancia
const CLOSE_MIN  = 24;    // px mínimos recorridos para aceptar un flick
const DUR_CLOSE  = 300;   // ms de la animación de cierre (coincide con la transición del estilo)

// Resistencia progresiva más allá de RUBBER_LIMIT (no un clamp seco).
function rubber(dx) {
  const a = Math.abs(dx);
  if (a <= RUBBER_LIMIT) return dx;
  return Math.sign(dx) * (RUBBER_LIMIT + (a - RUBBER_LIMIT) * 0.28);
}
// Feedback sutil durante el arrastre (se ignora si prefers-reduced-motion, en el estilo).
function dragRotation(x) { return Math.max(-6, Math.min(6, x * 0.04)); }
function dragOpacity(x)  { return 1 - Math.min(0.28, Math.abs(x) / 520); }

export default function Player({ navigate, view }) {
  // `navigate(view, target)` disponible para navegar desde la barra. Aún NO se
  // usa (los onClick de portada/artista/género/canción llegan en pasos 3-5).
  const [expanded, setExpanded] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [shufflePhrase, setShufflePhrase] = useState('');
  const [shuffleSpin, setShuffleSpin] = useState(false);
  const [repeatSpin, setRepeatSpin] = useState(false);
  const preMuteVol = useRef(0.7);          // volumen a restaurar al quitar el mute
  const player = usePlayer();
  const { currentTrack, isPlaying, currentTime, duration, volume, togglePlay, next, prev, seek, setVolume,
          shuffle, repeat, toggleShuffle, cycleRepeat } = player;

  // ── Estado del swipe de la carátula ──
  const [dragX, setDragX]     = useState(0);                // desplazamiento crudo durante el arrastre
  const [motion, setMotion]   = useState({ mode: 'idle' }); // idle | drag | out | in | return
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const [coverTrack, setCoverTrack] = useState(currentTrack); // carátula visible (difiere de currentTrack durante la animación)
  const gesture   = useRef(null);          // gesto en curso: { x0, y0, dir, lastX, lastT, vx } | null
  const busy      = useRef(false);         // animación de salida/entrada en curso → ignora gestos nuevos
  const timers    = useRef([]);            // timeouts de la animación (para limpiarlos)
  const artRef    = useRef(null);          // nodo de la carátula (ancho para las animaciones)
  const currentTrackRef = useRef(currentTrack); // último currentTrack (para leerlo dentro de timeouts)

  // ── Estado del gesto "deslizar hacia abajo para cerrar" (móvil) ──
  const [dragY, setDragY] = useState(0);              // desplazamiento vertical del overlay durante el arrastre
  const [sheet, setSheet] = useState('idle');         // idle | drag | return | closing
  const vGesture = useRef(null);                      // { x0, y0, dir, lastY, lastT, vy } | null

  const repeatTitle = repeat === 'one' ? 'Repetir: una canción'
    : repeat === 'all' ? 'Repetir: toda la cola'
    : 'Repetir: desactivado';

  // Calidad de la pista que suena. Si la cola ya la trae (reproducción desde la
  // Biblioteca) la usamos directo; si no (p.ej. un álbum), pedimos el detalle.
  const [quality, setQuality] = useState(null);
  useEffect(() => {
    if (!currentTrack) { setQuality(null); return; }
    if (currentTrack.codec || currentTrack.sample_rate || currentTrack.bitrate) {
      setQuality(currentTrack);
      return;
    }
    let cancelled = false;
    api.track(currentTrack.id)
      .then(full => { if (!cancelled) setQuality(full); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [currentTrack]);

  // Esc global del reproductor, por prioridad de lo más "encima": el InfoPanel
  // (modal, z 300) maneja su propio Esc; luego la Letra —esté o no en el expandido—;
  // por último, si no hay panel abierto, cierra el expandido. Antes este handler
  // vivía sólo mientras expanded=true, así que Esc no cerraba la Letra abierta desde
  // la barra (fuera del expandido); ahora escucha siempre.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (showInfo)        return;                 // el InfoPanel maneja su propio Esc (cierre animado)
      else if (showLyrics) setShowLyrics(false);   // cierra la letra donde sea que esté abierta
      else if (expanded)   setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded, showInfo, showLyrics]);

  // ── Swipe de la carátula del expandido (izq = siguiente, der = anterior) ──
  // Pointer Events (touch + mouse). touch-action: pan-y (CSS) cede el scroll
  // vertical al navegador y nos deja el gesto horizontal. Un solo elemento: la
  // carátula vieja SALE hacia el lado del swipe, se cambia la fuente ya fuera de
  // pantalla y la nueva ENTRA desde el lado opuesto.

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
  // Al cerrar el expandido (o desmontar): corta la animación y resetea, para no
  // dejar la carátula colgada ni disparar setState de más.
  useEffect(() => {
    if (expanded) return;
    clearTimers(); busy.current = false; gesture.current = null;
    setMotion({ mode: 'idle' }); setDragX(0);
    vGesture.current = null; setSheet('idle'); setDragY(0);   // gesto de cierre por swipe-down
  }, [expanded]);
  useEffect(() => clearTimers, []);

  // Vuelta con spring (bajo el umbral).
  const springBack = () => {
    if (reduced) { setMotion({ mode: 'idle' }); setDragX(0); return; }
    setMotion({ mode: 'return' });
    setDragX(0);
    timers.current.push(setTimeout(() => setMotion({ mode: 'idle' }), 520));
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
    if (busy.current || !currentTrack) return;                             // ignora gestos durante la animación
    if (e.target.closest?.('button, a, input, [role="button"]')) return;  // no arrancar sobre un control
    gesture.current = { x0: e.clientX, y0: e.clientY, dir: null, lastX: e.clientX, lastY: e.clientY, lastT: e.timeStamp, vx: 0, vy: 0 };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
  };
  // Un solo gesto sobre la carátula, con el eje fijado en el primer movimiento:
  //   horizontal → cambiar de pista · vertical hacia ABAJO (táctil) → cerrar el
  //   expandido (mismo cierre que el header) · vertical hacia arriba → soltar.
  const onArtPointerMove = (e) => {
    const g = gesture.current;
    if (!g || g.dir === 'v') return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (g.dir === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;   // aún indeciso
      if (Math.abs(dx) > Math.abs(dy)) {
        g.dir = 'h';                                       // horizontal → cambiar de pista
        setMotion({ mode: 'drag' });
      } else if (dy > 0 && e.pointerType !== 'mouse') {
        g.dir = 'close';                                   // vertical hacia abajo → cerrar (solo táctil)
        setSheet('drag');
      } else {
        g.dir = 'v';                                       // vertical hacia arriba (o mouse) → soltar
        return;
      }
    }
    if (g.dir === 'close') {                               // arrastre de cierre desde la carátula
      const dt = e.timeStamp - g.lastT;
      if (dt > 0) { g.vy = g.vy * 0.7 + ((e.clientY - g.lastY) / dt) * 0.3; g.lastY = e.clientY; g.lastT = e.timeStamp; }
      setDragY(Math.max(0, dy));
      return;
    }
    const dt = e.timeStamp - g.lastT;                     // velocidad instantánea suavizada (px/ms)
    if (dt > 0) { g.vx = g.vx * 0.7 + ((e.clientX - g.lastX) / dt) * 0.3; g.lastX = e.clientX; g.lastT = e.timeStamp; }
    setDragX(dx);                                         // crudo; el rubber se aplica en el estilo
  };
  const onArtPointerUp = (e) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.dir === 'close') {                               // swipe-down desde la carátula → cerrar o volver
      const dy = Math.max(0, e.clientY - g.y0);
      const flick = g.vy > CLOSE_VEL && dy > CLOSE_MIN;
      if (dy >= CLOSE_DIST || flick) closeSheet(); else sheetBack();
      return;
    }
    if (g.dir !== 'h') { setMotion({ mode: 'idle' }); setDragX(0); return; }
    const dx = e.clientX - g.x0;
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

  // ── Cerrar el expandido deslizando hacia abajo (móvil) ──
  // Mismos patrones que el swipe de carátula (Pointer Events, eje fijado por el
  // primer movimiento, velocidad suavizada, cancelación limpia). Sólo táctil:
  // en desktop el cierre sigue siendo Esc / botón "Ahora reproduciendo".
  // Vuelta con spring si no se alcanza el umbral.
  const sheetBack = () => {
    if (reduced) { setSheet('idle'); setDragY(0); return; }
    setSheet('return');
    setDragY(0);
    timers.current.push(setTimeout(() => setSheet('idle'), 360));
  };
  // Cierre: el overlay baja fuera de pantalla y recién ahí se desmonta.
  const closeSheet = () => {
    if (reduced) { setExpanded(false); return; }
    setSheet('closing');
    setDragY(window.innerHeight || 800);
    timers.current.push(setTimeout(() => setExpanded(false), DUR_CLOSE));
  };
  const onSheetPointerDown = (e) => {
    if (e.pointerType === 'mouse') return;   // sólo táctil (móvil)
    if (busy.current || sheet === 'closing') return;
    if (e.target.closest?.('button, a, input, [role="button"]')) return;   // no sobre los botones del header
    vGesture.current = { x0: e.clientX, y0: e.clientY, dir: null, lastY: e.clientY, lastT: e.timeStamp, vy: 0 };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
  };
  const onSheetPointerMove = (e) => {
    const g = vGesture.current;
    if (!g || g.dir === 'x' || g.dir === 'up') return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (g.dir === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;          // aún indeciso
      if (Math.abs(dx) > Math.abs(dy)) { g.dir = 'x'; return; }  // horizontal → no es cierre
      if (dy < 0) { g.dir = 'up'; return; }                      // hacia arriba → ignorar (deja el scroll)
      g.dir = 'y';
      setSheet('drag');
    }
    const dt = e.timeStamp - g.lastT;                            // velocidad vertical suavizada (px/ms)
    if (dt > 0) { g.vy = g.vy * 0.7 + ((e.clientY - g.lastY) / dt) * 0.3; g.lastY = e.clientY; g.lastT = e.timeStamp; }
    setDragY(Math.max(0, dy));                                   // sólo hacia abajo
  };
  const onSheetPointerUp = (e) => {
    const g = vGesture.current;
    vGesture.current = null;
    if (!g || g.dir !== 'y') return;
    const dy = Math.max(0, e.clientY - g.y0);
    const flick = g.vy > CLOSE_VEL && dy > CLOSE_MIN;
    if (dy >= CLOSE_DIST || flick) closeSheet();
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

  // Estilo del overlay según la fase del gesto de cierre (translateY + fade sutil).
  const sheetStyle = () => {
    if (sheet === 'drag') {
      return { transform: `translateY(${dragY}px)`, opacity: 1 - Math.min(0.5, dragY / 900), transition: 'none', willChange: 'transform' };
    }
    if (sheet === 'closing') {
      return { transform: `translateY(${dragY}px)`, opacity: 0, transition: `transform ${DUR_CLOSE}ms cubic-bezier(.4,0,.6,1), opacity ${DUR_CLOSE}ms ease` };
    }
    if (sheet === 'return') {
      return { transform: 'translateY(0)', opacity: 1, transition: 'transform .36s cubic-bezier(.34,1.42,.6,1), opacity .2s ease' };
    }
    return undefined;   // idle → deja la animación de entrada del CSS (slide-up)
  };

  // Mute: clic en la bocina silencia (guardando el volumen previo) y otro clic lo
  // restaura. stopPropagation para no abrir el expandido desde la barra.
  const toggleMute = (e) => {
    e.stopPropagation();
    if (volume > 0) { preMuteVol.current = volume; setVolume(0); }
    else { setVolume(preMuteVol.current > 0 ? preMuteVol.current : 0.7); }
  };

  // La portada abre la vista "Ahora reproduciendo" (también en desktop). Lleva
  // stopPropagation porque .player-bar abre el expandido en cualquier zona libre:
  // el clic en la portada ya lo abre y no debe re-disparar. Inerte si no hay pista.
  const openExpanded = (e) => {
    if (!currentTrack) return;
    e.stopPropagation();
    setExpanded(true);
  };

  const art = currentTrack?.cover_path
    ? <img className="player-art" src={coverUrl(currentTrack.id)} alt="" onClick={openExpanded} title="Abrir reproductor" />
    : <div className="player-art-placeholder" onClick={openExpanded} title="Abrir reproductor">♪</div>;

  // Género (integrado al subtítulo) del track enriquecido (quality) o del actual.
  const genre = (quality ?? currentTrack)?.genre ?? null;
  // album_artist/album confiables: quality (api.track = SELECT *) o el track de la
  // cola. Para navegar al artista usamos album_artist (NO el `artist` mostrado, que
  // rompería "Various Artists"/feats). Pueden faltar si la cola vino de
  // /albums/:album/tracks → en ese caso se resuelven con api.track(id).
  const albumArtist = (quality ?? currentTrack)?.album_artist ?? null;
  const album       = (quality ?? currentTrack)?.album ?? null;

  // Navegación desde la barra Y el expandido. stopPropagation (no disparar el
  // onClick de .player-track en móvil) y cierre del expandido antes de cambiar de
  // vista. Inertes si falta el dato.
  const goGenre = (e) => {
    e.stopPropagation();
    if (!genre) return;
    setExpanded(false);
    navigate('genres', { genre });
  };
  const goArtist = async (e) => {
    e.stopPropagation();
    if (!currentTrack) return;
    let artist = albumArtist;
    if (!artist) { try { artist = (await api.track(currentTrack.id))?.album_artist ?? null; } catch { /* ignore */ } }
    if (!artist) return;
    setExpanded(false);
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
    navigate('albums', { album: alb, album_artist: aArtist });
  };
  // Calidad partida: códec para el badge + resto del detalle como texto gris.
  // El color/caja del badge refleja el tier (hi-res / lossless / lossy…).
  const qCodec = qualityCodec(quality);
  const qDetail = qualityDetail(quality);
  const qTier = qualityTier(quality);

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
      <ChangelogBell navigate={navigate} view={view} hidden={expanded || showLyrics || showInfo} />

      {/* ── Panel de letra (overlay, desktop y móvil) ── */}
      {showLyrics && <LyricsPanel onClose={() => setShowLyrics(false)} startImmersive={expanded} />}

      {/* ── Panel de información de la pista (modal) ── */}
      {showInfo && (
        <InfoPanel
          track={quality ?? currentTrack}
          onClose={() => setShowInfo(false)}
          navigate={(view, target) => { setShowInfo(false); setExpanded(false); navigate(view, target); }}
        />
      )}

      {/* ── Full-screen expanded player (mobile) ── */}
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
                className={`exp-icon-btn${showLyrics ? ' active' : ''}`}
                onClick={() => setShowLyrics(v => !v)}
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

            <div className="exp-col-info">

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
                      title={qualityTierTitle(quality)}
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
              style={volumeFillStyle(volume)}
            />
          </div>

          {/* Acciones (letra, info, +): en desktop van aquí, bajo el volumen; en
              móvil se ocultan (CSS) y se usan las del header. */}
          <div className="exp-actions">
            <button
              className={`exp-icon-btn${showLyrics ? ' active' : ''}`}
              onClick={() => setShowLyrics(v => !v)}
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
      <div className="player-bar" onClick={() => setExpanded(true)}>

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
                        title={qualityTierTitle(quality)}
                      >
                        {qCodec}
                      </span>
                    )}
                    {qDetail && <span className={`player-quality-detail q-${qTier.id}`}>{qDetail}</span>}
                  </div>
                )}
              </div>
              <AddToPlaylistMenu trackId={currentTrack.id} placement="up" className="ptp-player" />
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
            <div className="shuffle-wrap">
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
              <span className="shuffle-tip" aria-hidden="true">{shufflePhrase || SHUFFLE_PHRASES[0]}</span>
            </div>
            <button className="ctrl-btn ctrl-prev" onClick={e => { e.stopPropagation(); prev(); }} title="Anterior (←)"><PrevIcon /></button>
            <button className="ctrl-btn play" onClick={e => { e.stopPropagation(); togglePlay(); }} title="Play/Pause (Espacio)">
              <span key={isPlaying ? 'pause' : 'play'} className="ctrl-play-swap">
                {isPlaying ? <PauseIcon /> : <PlayIcon />}
              </span>
            </button>
            <button className="ctrl-btn ctrl-next" onClick={e => { e.stopPropagation(); next(); }} title="Siguiente (→)"><NextIcon /></button>
            <button
              className={`ctrl-btn${repeat !== 'off' ? ' active' : ''}`}
              onClick={e => { e.stopPropagation(); cycleRepeat(); setRepeatSpin(true); }}
              aria-pressed={repeat !== 'off'}
              title={repeatTitle}
            >
              <span
                className={`repeat-icon${repeatSpin ? ' spin' : ''}`}
                onAnimationEnd={() => setRepeatSpin(false)}
              >
                {repeat === 'one' ? <RepeatOneIcon /> : <RepeatIcon />}
              </span>
            </button>
          </div>
          <div className="player-progress">
            <span className={`time-label time-elapsed${timeClass}`}>
              <span key={fmt(currentTime)} className="time-tick">{fmt(currentTime)}</span>
            </span>
            <SeekBar value={currentTime} max={duration} playing={isPlaying} onSeek={seek} />
            <span className="time-label right time-total">{fmt(duration)}</span>
          </div>
        </div>

        {/* Desktop: acciones (letra, info) + volumen */}
        <div className="player-actions">
          <button
            className={`action-btn lyrics-btn${showLyrics ? ' active' : ''}`}
            onClick={e => { e.stopPropagation(); setShowLyrics(v => !v); }}
            aria-pressed={showLyrics}
            title="Letra"
          >
            <LyricsGlyph />
          </button>
          <button
            className={`action-btn info-btn${showInfo ? ' active' : ''}`}
            onClick={e => { e.stopPropagation(); setShowInfo(v => !v); }}
            aria-pressed={showInfo}
            disabled={!currentTrack}
            title="Información de la pista"
          >
            <InfoIcon />
          </button>
          <div className="player-volume">
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
              onClick={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
              style={volumeFillStyle(volume)}
            />
          </div>
        </div>

        {/* Mobile mini controls — letra + play + siguiente (lyrics nunca desaparece) */}
        <div className="player-mini-controls">
          <button
            className={`mini-btn lyrics-mini${showLyrics ? ' active' : ''}`}
            onClick={e => { e.stopPropagation(); setShowLyrics(v => !v); }}
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
