import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { api, coverUrl } from '../api/client.js';
import { usePlayer } from '../context/PlayerContext.jsx';

// ── Río continuo (Dirección B) ─────────────────────────────────────────────
// El cuerpo de karaoke NO scrollea nativo: el track (.lyrics-synced) se mueve por
// transform (translate3d) para que el desplazamiento vaya en el compositor (GPU) y
// no por scrollTop (repaint de layout). Estos números afinan ese movimiento.
const SCROLL_K     = 0.22;   // suavizado del río: fracción de acercamiento al target por frame
const RESUME_MS    = 2800;   // reanudar el auto-follow tras un scroll/touch manual
const DRAG_SLOP    = 6;      // px de arrastre antes de tratar un touch como scroll (no como tap→seek)
const REFRAME_EASE = 'transform .55s cubic-bezier(.22, 1, .36, 1)';   // reencuadre discreto suavizado

// ── Seek grande dentro del río continuo (glide aislado del avance normal) ───────────────
// El avance línea a línea sigue 100% con SCROLL_K de arriba (el lerp por FRACCIÓN de la
// distancia restante, por frame): para saltos chicos (una línea) es imperceptible y a Oscar
// ya le gusta. Para un SEEK GRANDE (varias líneas de un salto, DENTRO de la misma canción — un
// cambio de canción NUNCA es esto, ver el guard de trackId más abajo) ese mismo lerp tiene un
// defecto estructural: la velocidad del primer frame es `SCROLL_K × distancia`, SIN TOPE —
// cuanto más grande el salto, más brusco el arranque ("salta") y más tarda en asentarse la
// desaceleración ("se frena"). Este glide usa en cambio una duración PROPORCIONAL a cuántas
// líneas saltó (260–420 ms, ver seekGlideDuration) con la curva "ease-standard" de Material
// Design (cubic-bezier(.4, 0, .2, 1)) evaluada en JS — a diferencia del ease-out cúbico puro
// (1-(1-t)^3) no hay forma cerrada para un cubic-bezier arbitrario, así que se resuelve con
// Newton-Raphson (mismo método que usan los navegadores para <easing-function>).
const SEEK_GLIDE_MIN_MS   = 260;   // saltos "grandes" apenas por encima del avance normal (delta=2)
const SEEK_GLIDE_MAX_MS   = 420;   // saltos de muchas líneas (satura en SEEK_LINES_SATURATE)
const SEEK_LINES_SATURATE = 20;    // delta de líneas a partir del cual la duración ya no crece
function seekGlideDuration(deltaLines) {
  const t = Math.min(1, Math.max(0, (deltaLines - 2) / (SEEK_LINES_SATURATE - 2)));
  return SEEK_GLIDE_MIN_MS + (SEEK_GLIDE_MAX_MS - SEEK_GLIDE_MIN_MS) * t;
}

// Evalúa un cubic-bezier(x1,y1,x2,y2) arbitrario en tiempo real x∈[0,1] (fracción de la
// duración, NO el parámetro interno de la curva — para eso hay que invertir x(t)=x). Newton-
// Raphson con fallback a bisección si no converge (mismo algoritmo que UnitBezier de WebKit):
// preciso, ~20 líneas, sin sumar una dependencia nueva.
function makeBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX  = (t) => ((ax * t + bx) * t + cx) * t;
  const sampleY  = (t) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  function solveX(x) {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const dx = sampleDX(t);
      if (Math.abs(dx) < 1e-6) break;
      t -= (sampleX(t) - x) / dx;
    }
    if (t < 0 || t > 1) {                    // Newton se fue de [0,1]: bisección (siempre converge)
      let lo = 0, hi = 1; t = x;
      for (let i = 0; i < 20; i++) {
        const xt = sampleX(t);
        if (Math.abs(xt - x) < 1e-6) break;
        if (xt < x) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
    }
    return t;
  }
  return (x) => (x <= 0 ? 0 : x >= 1 ? 1 : sampleY(solveX(x)));
}
const SEEK_GLIDE_EASE = makeBezier(.4, 0, .2, 1);   // "ease-standard" (Material Design)

// Parsea .lrc → [{time:number|null, text}]. Soporta varias marcas por línea
// (líneas repetidas) y descarta metadatos [ar:][ti:][offset:]…
function parseLrc(lrc) {
  const stampRe = /\[(\d{1,2}):(\d{2}(?:[.:]\d{1,3})?)\]/g;
  const metaRe  = /^\s*\[[a-z#]+:[^\]]*\]\s*$/i;
  // Etiqueta [offset:±ms] del formato LRC: desplaza TODAS las marcas. Convención
  // estándar: un valor positivo RETRASA la letra y uno negativo la ADELANTA (ms→s).
  const offMatch = lrc.match(/\[offset:\s*([+-]?\d+)\s*\]/i);
  const offset = offMatch ? parseInt(offMatch[1], 10) / 1000 : 0;
  const out = [];
  for (const raw of lrc.split(/\r?\n/)) {
    if (metaRe.test(raw)) continue;
    const stamps = [];
    let m; stampRe.lastIndex = 0;
    while ((m = stampRe.exec(raw)) !== null) {
      stamps.push(parseInt(m[1], 10) * 60 + parseFloat(m[2].replace(':', '.')) + offset);
    }
    const text = raw.replace(stampRe, '').trim();
    if (stamps.length === 0) {
      if (text) out.push({ time: null, text });
    } else {
      for (const t of stamps) out.push({ time: t, text });
    }
  }
  out.sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity));
  return out;
}

// Línea activa = última cuyo timestamp ya pasó. +0.1 s de anticipación de lectura
// (bajada de 0.2 → 0.1: sumaba sensación de "adelantada"; el resto lo afina el offset).
function findActiveIdx(lines, t) {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time != null && lines[i].time <= t + 0.1) idx = i;
  }
  return idx;
}

// Inmersivo: full-bleed (tapa la barra) vs panel (deja la barra visible). El modo
// es CONTROLADO por Player.jsx (`immersive` + `onToggleImmersive`): él coordina la
// Letra con el expandido (invariante: nunca expandido montado + Letra en modo
// panel — su franja inferior taparía la barra real → "barra fantasma").
export default function LyricsPanel({ onClose, immersive = false, onToggleImmersive }) {
  const { currentTrack, currentTime, duration, isPlaying, seek } = usePlayer();
  const [data, setData]       = useState(null);   // { instrumental, synced, lyrics }
  const [loading, setLoading] = useState(false);
  // Ajuste fino de sincronía por canción (segundos). Desplaza el tiempo efectivo
  // (línea activa + barrido); +: la letra va adelante. Se persiste en localStorage.
  const [offset, setOffset] = useState(0);
  // Override manual "no es la letra": el matching estricto de LRCLIB no puede
  // defenderse de data comunitaria incorrecta con duración compatible (caso
  // "Burnin'"); esta marca por pista suprime la letra remota. Se persiste en
  // localStorage (patrón lyricsOffset:<trackId>).
  const [hidden, setHidden] = useState(false);
  const activeRef = useRef(null);
  const bodyRef   = useRef(null);   // .lyrics-body: viewport (recorta el track)
  const trackRef  = useRef(null);   // .lyrics-synced: track de líneas que se mueve por transform

  // ── Río continuo / auto-follow (Dirección B) ─────────────────────────────
  const renderYRef     = useRef(0);      // translateY actual aplicado al track
  const followRef      = useRef(true);   // ¿el auto-follow manda? (false mientras el usuario hojea)
  const resumeTimerRef = useRef(0);      // timer para retomar el auto-follow tras scroll manual
  const framedIdxRef   = useRef(-1);     // línea para la que ya se computaron las anclas de encuadre
  const y0Ref          = useRef(0);      // encuadre (translateY) de la línea activa
  const y1Ref          = useRef(0);      // encuadre de la siguiente (se interpola con --p)
  const padTopRef      = useRef(44);     // padding-top del cuerpo (cacheado; recalculado en resize)
  const movedRecentlyRef = useRef(false);// último touch fue arrastre → no dispares el seek de la línea
  const isPlayingRef   = useRef(false);  // leídos dentro de closures (resume/resize) sin recrearlos
  const syncedRef      = useRef(false);
  const currentTimeRef = useRef(0);
  // Glide de seek grande (ver SEEK_GLIDE_MIN_MS/MAX_MS arriba): { fromY, start, dur } mientras
  // está en curso, o null. prevIdxForGlideRef es el "anterior" propio para detectar el salto —
  // activeIdxRef ya quedó pisado con el valor nuevo en el render, así que no sirve para comparar
  // viejo vs nuevo. prevTrackIdRef es el guard clave para no confundir un cambio de canción
  // (activeIdx también "salta" ahí) con un seek grande dentro de la misma canción.
  const seekGlideRef       = useRef(null);
  const prevIdxForGlideRef = useRef(-1);
  const prevTrackIdRef     = useRef(undefined);

  // ── Reloj interpolado (línea activa + wipe) ──────────────────────────────
  // El PlayerContext NO expone el <audio>; currentTime llega por 'timeupdate' a
  // ~4 Hz (grueso para karaoke). Interpolamos con rAF: sembramos t0/perf0 en cada
  // tick y en el frame calculamos
  //   liveTime = t0 + (now - perf0)/1000  → ~60fps entre ticks, autocorregido cada
  // ~250ms. Ese reloj conmuta la línea activa Y pinta el wipe. El rAF corre SOLO
  // con synced && isPlaying (y sin reduced-motion); al pausar se cancela, --p
  // queda congelado y la línea activa la sostiene el camino lento (estado 4 Hz).
  const t0Ref        = useRef(0);   // segundos: currentTime del último tick sembrado
  const perf0Ref     = useRef(0);   // ms: performance.now() de esa siembra
  const linesRef     = useRef([]);  // últimas líneas (leídas dentro del rAF sin recrear el loop)
  const activeIdxRef = useRef(-1);
  const durationRef  = useRef(0);
  const offsetRef    = useRef(0);   // ajuste de sync leído dentro del rAF

  // Media queries REACTIVAS (estado + listener 'change'): sin esto, cruzar 701px o
  // togglear reduced-motion con la Letra abierta no reconfiguraba el gate hasta el
  // próximo re-render de React (que solo llegaba al conmutar de línea).
  const [reduced, setReduced] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  // Río continuo (transform por frame) SOLO en pantallas amplias. En móvil / GPU
  // floja (Adreno 610) recomponer una capa por frame bajo mask + backdrop-filter
  // tironea: ahí el track se reencuadra DISCRETO y suavizado por CSS (más barato).
  const [continuous, setContinuous] = useState(
    () => window.matchMedia?.('(min-width: 701px)').matches ?? true);
  useEffect(() => {
    const mqR = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const mqC = window.matchMedia?.('(min-width: 701px)');
    const onR = () => setReduced(!!mqR?.matches);
    const onC = () => setContinuous(!!mqC?.matches);
    mqR?.addEventListener?.('change', onR);
    mqC?.addEventListener?.('change', onC);
    return () => {
      mqR?.removeEventListener?.('change', onR);
      mqC?.removeEventListener?.('change', onC);
    };
  }, []);

  // ── Helpers de encuadre por transform (Dirección B) ──────────────────────
  // translateY que centra `node` en el viewport del cuerpo. offsetTop/offsetHeight
  // son de LAYOUT → invariantes al transform actual y a la scale por línea (que es
  // sobre el centro): puedo leerlos con el track ya movido sin realimentación.
  function centerYOf(node) {
    const cont = bodyRef.current;
    if (!cont || !node) return 0;
    return cont.clientHeight / 2 - padTopRef.current - node.offsetTop - node.offsetHeight / 2;
  }
  // Acota el desplazamiento entre "primera línea centrada" y "última centrada".
  function clampY(y) {
    const kids = trackRef.current?.children;
    if (!kids || !kids.length) return y;
    const min = centerYOf(kids[kids.length - 1]);   // última centrada → tope arriba (más negativo)
    const max = Math.max(0, centerYOf(kids[0]));     // primera centrada → tope abajo
    return Math.min(max, Math.max(min, y));
  }
  function applyY(y, transition) {
    const track = trackRef.current;
    if (!track) return;
    track.style.transition = transition;
    track.style.transform  = `translate3d(0, ${y}px, 0)`;
    renderYRef.current = y;
  }
  // Reencuadre discreto: centra la línea activa (o el tope si aún no hay activa).
  function reframe(transition) {
    const track = trackRef.current;
    if (!track) return;
    const idx  = activeIdxRef.current;
    const node = idx >= 0 ? track.children[idx] : null;
    applyY(clampY(node ? centerYOf(node) : 0), transition);
    framedIdxRef.current = -1;   // que el río recompute sus anclas al reanudar
  }
  function pauseFollow() {
    followRef.current = false;
    seekGlideRef.current = null;   // un scroll/arrastre manual cancela cualquier glide de seek en curso
    clearTimeout(resumeTimerRef.current);
  }
  function scheduleResume() {
    clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = setTimeout(() => {
      followRef.current = true;
      // Si el río está manejando el transform (desktop reproduciendo), retoma solo
      // (lerp desde la posición manual). Si no (móvil/pausa/reduced), reencuadro acá.
      const riverDriving = continuous && isPlayingRef.current && !reduced && syncedRef.current;
      if (!riverDriving) reframe(reduced ? 'none' : REFRAME_EASE);
    }, RESUME_MS);
  }

  useEffect(() => {
    if (!currentTrack) { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    // Timeout client-side 7s: red de seguridad si el server o el túnel se pasman
    // (el server ya corta LRCLIB a los 4s, así que una respuesta legítima SIEMPRE
    // llega antes). Al vencer, el catch degrada EN SILENCIO a "Sin letra
    // disponible" (regla 8: fallos externos sin error visible); el flag
    // `cancelled` evita que un abort tardío pise data de la pista siguiente.
    api.lyrics(currentTrack.id, { signal: AbortSignal.timeout(7000) })
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentTrack]);

  // Cargar el ajuste de sync guardado al cambiar de pista (localStorage por trackId).
  useEffect(() => {
    if (!currentTrack) { setOffset(0); return; }
    const saved = parseFloat(localStorage.getItem('lyricsOffset:' + currentTrack.id));
    setOffset(Number.isFinite(saved) ? saved : 0);
  }, [currentTrack]);

  // Cargar la marca "no es la letra" al cambiar de pista (mismo patrón que el offset).
  useEffect(() => {
    if (!currentTrack) { setHidden(false); return; }
    setHidden(localStorage.getItem('lyricsHidden:' + currentTrack.id) === '1');
  }, [currentTrack]);

  // La marca SOLO suprime letra vía LRCLIB: un .lrc curado llega sin `source` y
  // se muestra siempre, aunque la marca siga guardada. El fetch NO se evita
  // (el source recién se conoce con la respuesta); se suprime en render, así el
  // deshacer revela la letra ya en memoria sin round-trip.
  const suppressed = hidden && data?.source === 'lrclib' && !data?.instrumental;

  const lines = useMemo(
    () => (data && !suppressed && !data.instrumental && data.lyrics ? parseLrc(data.lyrics) : []),
    [data, suppressed],
  );
  const synced = !!data?.synced && lines.some(l => l.time != null);

  // Línea activa en ESTADO, no derivada de currentTime en el render: derivada del
  // estado (~4 Hz por 'timeupdate') cada línea encendía 0–250 ms tarde según dónde
  // cayera el tick — jitter POR LÍNEA que el ajuste ± (constante) no puede
  // compensar. El rAF de abajo la conmuta con el reloj interpolado, exacta en su
  // marca; este efecto queda como camino lento (pausa, reduced-motion, seeks).
  const [activeIdx, setActiveIdx] = useState(-1);
  useEffect(() => {
    setActiveIdx(synced ? findActiveIdx(lines, currentTime + offset) : -1);
  }, [synced, lines, currentTime, offset]);

  // Detecta un SEEK GRANDE (delta de varias líneas DENTRO de la misma canción, no el avance
  // normal de a una) para dispararle el glide. Solo aplica al río continuo (desktop
  // reproduciendo): en móvil/pausa/reduced-motion el reencuadre ya lo cubre REFRAME_EASE (otro
  // efecto, sin tocar). GUARD DE TRACKID: un cambio de canción también hace "saltar" activeIdx
  // (de la línea vieja a donde sea que arranque la nueva) pero eso NUNCA debe glidear — tiene
  // que verse instantáneo (lo resuelve el useLayoutEffect de abajo, con applyY(..., 'none')).
  useEffect(() => {
    const prevIdx     = prevIdxForGlideRef.current;
    const prevTrackId = prevTrackIdRef.current;
    prevIdxForGlideRef.current = activeIdx;
    prevTrackIdRef.current     = currentTrack?.id;
    if (!synced || !continuous || !isPlaying || reduced) return;
    if (!followRef.current) return;                      // el usuario está hojeando
    if (currentTrack?.id !== prevTrackId) return;         // ← cambio de canción: JAMÁS es un seek
    if (prevIdx < 0 || activeIdx < 0) return;             // arranque de pista / sin línea activa
    const delta = Math.abs(activeIdx - prevIdx);
    if (delta <= 1) return;                               // avance normal (o línea repetida)
    seekGlideRef.current = {
      fromY: renderYRef.current,
      start: performance.now(),
      dur:   seekGlideDuration(delta),   // 260–420 ms según cuántas líneas saltó
    };
  }, [activeIdx, synced, continuous, isPlaying, reduced, currentTrack]);

  // Valores frescos para el rAF sin recrear el loop en cada tick.
  linesRef.current       = lines;
  activeIdxRef.current   = activeIdx;
  durationRef.current    = duration;
  offsetRef.current      = offset;
  isPlayingRef.current   = isPlaying;
  syncedRef.current      = synced;
  currentTimeRef.current = currentTime;

  // Reencuadre DISCRETO del track (por transform, NUNCA scrollIntoView). Corre
  // cuando el río continuo NO maneja el transform: móvil (continuous=false), pausa,
  // seek con la reproducción parada, y reduced-motion (instantáneo). En desktop
  // reproduciendo, este efecto se abstiene y manda el rAF de abajo. No tironea si
  // el usuario está hojeando (followRef=false).
  useEffect(() => {
    if (!synced) return;
    if (continuous && isPlaying && !reduced) return;   // el río lo mueve
    if (!followRef.current) return;                     // el usuario está leyendo
    reframe(reduced ? 'none' : REFRAME_EASE);
  }, [activeIdx, synced, isPlaying, reduced, continuous]);

  // Al abrir el panel o cambiar de canción: encuadrar la línea activa AL INSTANTE,
  // pre-paint (useLayoutEffect), para que no haya un flash con la posición de la
  // canción anterior ni un scroll de reacomodo. Resetea el auto-follow.
  useLayoutEffect(() => {
    const track = trackRef.current, cont = bodyRef.current;
    if (!synced || !track || !cont) { renderYRef.current = 0; return; }
    followRef.current = true;
    seekGlideRef.current = null;             // cambio de pista: ningún glide de seek de la anterior sigue vivo
    prevIdxForGlideRef.current = -1;         // defensa extra (el guard real es prevTrackIdRef, ver abajo)
    prevTrackIdRef.current = currentTrack?.id;
    clearTimeout(resumeTimerRef.current);
    framedIdxRef.current = -1;
    padTopRef.current = parseFloat(getComputedStyle(cont).paddingTop) || 44;
    // Índice activo real AHORA (el estado activeIdx puede no haberse recomputado aún).
    const idx  = findActiveIdx(lines, currentTimeRef.current + offsetRef.current);
    const node = idx >= 0 ? track.children[idx] : null;
    applyY(clampY(node ? centerYOf(node) : 0), 'none');
  }, [lines, synced]);

  // Siembra del reloj: en cada tick de currentTime (~4Hz) y al pausar/reanudar.
  // Incluir isPlaying evita el salto al reanudar: sin él, perf0 quedaría viejo
  // (con toda la pausa acumulada) hasta el próximo timeupdate. Un seek también
  // pasa por acá: el elemento dispara 'timeupdate' al saltar.
  useEffect(() => {
    t0Ref.current    = currentTime;
    perf0Ref.current = performance.now();
  }, [currentTime, isPlaying]);

  // rAF del reloj: con el tiempo interpolado (a) CONMUTA la línea activa exacta en
  // su marca y (b) interpola --p (0→1) sobre ella. Solo con sync + reproduciendo +
  // sin reduced-motion. Cleanup cancela el frame (pausa, cambio de track,
  // desmontaje) → nada de loops colgados.
  useEffect(() => {
    if (!synced || !isPlaying || reduced) return;
    let raf;
    const tick = () => {
      const live = t0Ref.current + (performance.now() - perf0Ref.current) / 1000 + offsetRef.current;
      const ls   = linesRef.current;
      const idx  = findActiveIdx(ls, live);
      if (idx !== activeIdxRef.current) {
        setActiveIdx(idx);               // re-render; el ref se actualiza al pintar
      } else {
        const cur = ls[idx];
        let p = 0;
        if (cur && cur.time != null) {
          const nextT = ls[idx + 1]?.time;
          // Duración de la línea: hasta la próxima marca, o un tope de 4s (acotado por
          // la duración de la pista) si es la última.
          const cap = Math.min(cur.time + 4, durationRef.current || cur.time + 4);
          const end = nextT != null ? nextT : cap;
          const den = end - cur.time;
          p = den > 0 ? Math.min(1, Math.max(0, (live - cur.time) / den)) : 1;
          const node = activeRef.current;
          if (node) node.style.setProperty('--p', p.toFixed(4));   // una sola CSS var por frame
        }
        // Río continuo (Dirección B, solo desktop): interpola el encuadre de la línea
        // activa → siguiente con --p y lo aplica por TRANSFORM (compositor, no scrollTop).
        // Las anclas (y0/y1) se leen una sola vez por línea; el lerp da el suavizado y
        // absorbe el retorno tras un scroll manual. Pausado mientras el usuario hojea.
        const track = trackRef.current;
        if (continuous && followRef.current && track) {
          if (framedIdxRef.current !== idx) {
            const a = track.children[idx];
            const n = track.children[idx + 1];
            y0Ref.current = a ? centerYOf(a) : renderYRef.current;
            y1Ref.current = n ? centerYOf(n) : y0Ref.current;
            framedIdxRef.current = idx;
          }
          const target = y0Ref.current + (y1Ref.current - y0Ref.current) * p;
          let rY;
          const glide = seekGlideRef.current;
          if (glide) {
            // Seek grande en curso: blend por TIEMPO real (no fracción/frame), con la duración
            // propia del glide (proporcional a cuántas líneas saltó) y la curva ease-standard,
            // desde el punto de arranque hasta el target actual (que igual se mueve un poco con
            // --p; el recorrido del seek domina esa distancia chica, no hace falta re-anclar
            // "fromY" cada frame).
            const frac = Math.min(1, (performance.now() - glide.start) / glide.dur);
            rY = glide.fromY + (target - glide.fromY) * SEEK_GLIDE_EASE(frac);
            if (frac >= 1) seekGlideRef.current = null;   // resuelto: el lerp normal retoma desde acá
          } else {
            rY = renderYRef.current + (target - renderYRef.current) * SCROLL_K;
            if (Math.abs(target - rY) < 0.5) rY = target;   // snap: sin lerp infinitesimal
          }
          renderYRef.current = rY;
          track.style.transition = 'none';
          track.style.transform  = `translate3d(0, ${rY}px, 0)`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [synced, isPlaying, reduced, continuous]);

  // Scroll manual (rueda / arrastre táctil) → mueve el track por transform y pausa
  // el auto-follow unos segundos (sin esto el follow pelearía con el dedo). Listeners
  // NO pasivos: preventDefault evita que scrollee la página de atrás y que un
  // arrastre dispare el seek de la línea. Solo activo en karaoke (synced).
  useEffect(() => {
    const cont = bodyRef.current;
    if (!cont || !synced) return;

    let startTouchY = 0, startY = 0, moved = false;

    const onWheel = (e) => {
      e.preventDefault();
      pauseFollow();
      applyY(clampY(renderYRef.current - e.deltaY), 'none');
      scheduleResume();
    };
    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      startTouchY = e.touches[0].clientY;
      startY = renderYRef.current;
      moved = false;
      pauseFollow();
    };
    const onTouchMove = (e) => {
      if (e.touches.length !== 1) return;
      const dy = e.touches[0].clientY - startTouchY;
      if (!moved && Math.abs(dy) > DRAG_SLOP) { moved = true; movedRecentlyRef.current = true; }
      if (moved) {
        e.preventDefault();
        applyY(clampY(startY + dy), 'none');
      }
    };
    const onTouchEnd = () => {
      if (moved) scheduleResume();
      else followRef.current = true;   // fue un tap (seek de línea): retomar ya
      setTimeout(() => { movedRecentlyRef.current = false; }, 60);
    };
    const onResize = () => {
      padTopRef.current = parseFloat(getComputedStyle(cont).paddingTop) || 44;
      framedIdxRef.current = -1;
      if (followRef.current) reframe(reduced ? 'none' : REFRAME_EASE);
    };

    cont.addEventListener('wheel', onWheel, { passive: false });
    cont.addEventListener('touchstart', onTouchStart, { passive: false });
    cont.addEventListener('touchmove', onTouchMove, { passive: false });
    cont.addEventListener('touchend', onTouchEnd);
    window.addEventListener('resize', onResize);
    return () => {
      cont.removeEventListener('wheel', onWheel);
      cont.removeEventListener('touchstart', onTouchStart);
      cont.removeEventListener('touchmove', onTouchMove);
      cont.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('resize', onResize);
      clearTimeout(resumeTimerRef.current);
    };
  }, [synced, reduced, continuous]);

  // Ajuste fino de sync (persistido por trackId). +0.5: adelanta; −0.5: atrasa.
  function persistOffset(v) {
    if (!currentTrack) return;
    if (v === 0) localStorage.removeItem('lyricsOffset:' + currentTrack.id);
    else         localStorage.setItem('lyricsOffset:' + currentTrack.id, String(v));
  }
  function adjustOffset(delta) {
    setOffset(o => {
      const v = Math.round((o + delta) * 10) / 10;   // 0.1 s de precisión, sin drift de float
      persistOffset(v);
      return v;
    });
  }
  function resetOffset() {
    setOffset(0);
    persistOffset(0);
  }

  // Override "no es la letra": marca/desmarca la pista (persistido por trackId;
  // deshacer borra la key, como el offset en 0). Deshacer muestra la letra ya en
  // memoria — re-pedirla devolvería lo mismo por el caché 24h del server.
  function hideLyrics() {
    if (!currentTrack) return;
    localStorage.setItem('lyricsHidden:' + currentTrack.id, '1');
    setHidden(true);
  }
  function restoreLyrics() {
    if (!currentTrack) return;
    localStorage.removeItem('lyricsHidden:' + currentTrack.id);
    setHidden(false);
  }

  const hasCover = !!currentTrack?.cover_path;

  let body;
  if (!currentTrack) {
    body = <Empty icon="♪" title="Nada en reproducción" />;
  } else if (loading) {
    // Una sola fase de copy: el .lrc local resuelve en ms (ni se llega a leer);
    // la única espera visible es la búsqueda del fallback → "Buscando".
    body = <div className="lyrics-loading">Buscando letra…</div>;
  } else if (data?.instrumental) {
    body = <Empty icon="🎹" title="Instrumental" sub="Esta pista no tiene voz." />;
  } else if (!lines.length) {
    // Pista suprimida por el usuario: mismo Empty "sin letra", con la vía de
    // deshacer (borra la marca y revela la letra que quedó en memoria).
    body = suppressed ? (
      <Empty
        icon="🎙️"
        title="Sin letra disponible"
        sub="Ocultaste la letra encontrada en LRCLIB."
        action={
          <button className="lyrics-empty-action" onClick={restoreLyrics}>
            Buscar en LRCLIB de nuevo
          </button>
        }
      />
    ) : (
      <Empty icon="🎙️" title="Sin letra disponible" sub="No hay un .lrc junto a esta canción." />
    );
  } else if (!synced) {
    body = (
      <div className="lyrics-plain">
        {lines.map((l, i) => <p key={i}>{l.text || ' '}</p>)}
      </div>
    );
  } else {
    body = (
      <div className="lyrics-synced" ref={trackRef}>
        {lines.map((l, i) => {
          const dist = activeIdx >= 0 ? Math.abs(i - activeIdx) : null;   // distancia a la línea activa
          const isActive = i === activeIdx;
          // Capas de profundidad por distancia real a la activa: opacidad + scale
          // (+ blur leve en desktop) decrecientes. Los estados los pinta el CSS.
          const state = isActive ? ' active'
            : dist === 1 ? ' near'
            : dist === 2 ? ' far'
            : dist === 3 ? ' far2'
            : '';
          const text = l.text || '♪';
          return (
            <p
              key={i}
              ref={isActive ? activeRef : null}
              className={`lyrics-line${state}`}
              onClick={() => {
                // Un arrastre táctil recién terminado NO debe saltar de línea.
                if (movedRecentlyRef.current) return;
                if (l.time != null) seek(l.time - offset);
              }}
              title={l.time != null ? 'Saltar a esta línea' : undefined}
            >
              {isActive ? (
                <>
                  {/* Base atenuada (define el tamaño y es la que anuncian los lectores) */}
                  <span className="lyrics-base">{text}</span>
                  {/* Copia brillante recortada por --p (barrido izq→der). Decorativa. */}
                  <span className="lyrics-wipe" aria-hidden="true">{text}</span>
                </>
              ) : text}
            </p>
          );
        })}
      </div>
    );
  }

  return (
    <div className={`lyrics-panel${immersive ? ' immersive' : ''}`}>
      {/* Fondo: carátula actual difuminada + doble oscurecido (legibilidad sobre
          portadas claras). Solo si hay carátula; si no, queda el glass sólido. */}
      {hasCover && (
        <div
          className="lyrics-bg"
          style={{ backgroundImage: `url(${coverUrl(currentTrack.id)})` }}
          aria-hidden="true"
        />
      )}
      <div className="lyrics-header">
        <div className="lyrics-head-text">
          <span className="lyrics-kicker">
            Letra{synced ? ' · sincronizada' : ''}
            {/* Letra remota (fallback): badge sutil, en familia con el "vía
                MusicBrainz" del panel de Info, para distinguirla de los .lrc curados.
                La × es el override "no es la letra" (adosado a la procedencia).
                Guard !loading: al cambiar de pista, `data` viejo sigue en estado
                mientras carga — sin él, la × marcaría la pista NUEVA por data de
                la VIEJA (y el badge mostraba procedencia stale). */}
            {data?.source === 'lrclib' && !data?.instrumental && !suppressed && !loading && (
              <span className="lyrics-via" title="Letra obtenida de LRCLIB (lrclib.net)">
                <span className="lyrics-via-dot" aria-hidden="true">●</span>vía LRCLIB
                <button
                  className="lyrics-via-x"
                  onClick={hideLyrics}
                  title="No es la letra correcta — ocultarla para esta pista"
                  aria-label="No es la letra correcta — ocultarla para esta pista"
                >
                  ×
                </button>
              </span>
            )}
          </span>
          {currentTrack && <span className="lyrics-song">{currentTrack.title ?? ''}</span>}
        </div>
        <div className="lyrics-head-actions">
          {synced && (
            <div className="lyrics-sync" title="Ajuste de sincronía (se guarda para esta canción)">
              <button className="lyrics-sync-btn" onClick={() => adjustOffset(-0.5)} title="Atrasar 0.5 s" aria-label="Atrasar medio segundo">−.5</button>
              <button className="lyrics-sync-btn" onClick={() => adjustOffset(-0.1)} title="Atrasar 0.1 s" aria-label="Atrasar una décima">−.1</button>
              <button
                className={`lyrics-sync-val${offset !== 0 ? ' on' : ''}`}
                onClick={offset !== 0 ? resetOffset : undefined}
                title={offset !== 0 ? 'Restablecer sincronía' : 'Sincronía'}
              >
                {offset === 0 ? 'sync' : `${offset > 0 ? '+' : '−'}${Math.abs(offset).toFixed(1)} s`}
              </button>
              <button className="lyrics-sync-btn" onClick={() => adjustOffset(0.1)} title="Adelantar 0.1 s" aria-label="Adelantar una décima">+.1</button>
              <button className="lyrics-sync-btn" onClick={() => adjustOffset(0.5)} title="Adelantar 0.5 s" aria-label="Adelantar medio segundo">+.5</button>
            </div>
          )}
          <button
            className="lyrics-toggle"
            onClick={() => onToggleImmersive?.(!immersive)}
            title={immersive ? 'Reducir' : 'Pantalla completa'}
            aria-label={immersive ? 'Reducir' : 'Pantalla completa'}
            aria-pressed={immersive}
          >
            {immersive ? <ContractIcon /> : <ExpandIcon />}
          </button>
          <button className="lyrics-close" onClick={onClose} title="Cerrar letra">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
      <div className={`lyrics-body${synced ? ' karaoke' : ''}`} ref={bodyRef}>{body}</div>
    </div>
  );
}

function Empty({ icon, title, sub, action }) {
  return (
    <div className="lyrics-empty">
      <div className="lyrics-empty-icon">{icon}</div>
      <div className="lyrics-empty-title">{title}</div>
      {sub && <div className="lyrics-empty-sub">{sub}</div>}
      {action}
    </div>
  );
}

// Entrar a pantalla completa (flechas hacia afuera).
function ExpandIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}
// Salir de pantalla completa (flechas hacia adentro).
function ContractIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="14" y1="10" x2="21" y2="3" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}
