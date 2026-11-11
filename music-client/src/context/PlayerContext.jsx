import {
  createContext, useContext, useRef, useState, useEffect, useCallback, useMemo,
} from 'react';
import { streamUrl, coverUrl, videoStreamUrl, videoCoverUrl } from '../api/client.js';
import { resolveTrackMeta, isComplete } from '../utils/trackMeta.js';
import { shuffled } from '../utils/mixPlayback.js';
import { useAuth } from './AuthContext.jsx';
import VideoFullscreenControls from '../components/VideoFullscreenControls.jsx';

const PlayerContext = createContext(null);

// El navegador rechaza play() con NotAllowedError cuando no hubo un gesto que lo permita (Safari al
// abrir un link en frío). Sólo ése cuenta como bloqueo: AbortError (otro src pisó al anterior) no.
const esBloqueoDeAutoplay = (err) => err?.name === 'NotAllowedError';

// El tiempo va en un contexto APARTE: currentTime cambia en cada 'timeupdate' (~4 Hz) y, si
// viajara en PlayerContext, re-renderizaría a TODO consumidor del player (las 680 filas de la
// Biblioteca, la grilla de Álbumes…) aunque no muestre el tiempo. Sólo se suscriben acá los que
// de verdad lo pintan: Player (barra + expandido), LyricsPanel y el progreso de la cola.
const PlayerTimeContext = createContext(null);

// Acciones de MediaSession que cableamos. Se listan aparte para poder desregistrarlas
// todas en el cleanup sin repetir la lista.
const MEDIA_ACTIONS = [
  'play', 'pause', 'previoustrack', 'nexttrack',
  'seekto', 'seekbackward', 'seekforward', 'stop',
];

// Donde se escribe o se elige, las teclas son del campo y no del atajo global de play/pausa y
// ±10 s. `input` de cualquier tipo (incluye los sliders, como siempre). Lo editable
// (contenteditable) se mira aparte con isContentEditable.
const KEY_FIELDS = 'input, textarea, select, [role="textbox"], [role="combobox"], [role="searchbox"]';
// Espacio sobre un control al que se llegó con Tab es del control (lo activa). Los enlaces no
// están: en un enlace Espacio desplaza la página, no lo abre.
const SPACE_CONTROLS = 'button, summary, [role="button"], [role="radio"], [role="menuitem"], '
  + '[role="menuitemradio"], [role="menuitemcheckbox"], [role="tab"], [role="option"], [role="switch"], [role="checkbox"]';
// Dentro del reproductor Espacio sigue siendo play/pausa aunque se haya llegado con Tab, salvo en el
// menú «+» ya abierto, que es un menú como cualquier otro. (Los controles del video en pantalla
// completa manejan Espacio por su cuenta y no llegan acá.)
const PLAYER_AREAS = '.player-bar, .player-expanded, .queue-panel, .lyrics-panel';
const PLAYER_MENUS = '.ptp-menu';

// El elemento en pantalla completa, con o sin prefijo (Safari viejo/iPad usa el webkit).
function fullscreenElement() {
  return document.fullscreenElement ?? document.webkitFullscreenElement ?? null;
}

export function PlayerProvider({ children }) {
  const { token } = useAuth();      // para re-emitir el artwork al rotar el token (reauth)
  const audioRef    = useRef(null);
  const queueRef    = useRef([]);   // espejo de la cola (los callbacks registrados una vez lo leen)
  const uidRef      = useRef(0);    // contador del _qid por entrada de cola (identidad interna)
  const idxRef      = useRef(-1);
  const metaCacheRef = useRef(new Map());   // memo id→trackMeta resuelto (evita re-fetch por reproducción)

  // Modos de reproducción. Se duplican en refs porque el callback 'ended' del
  // <audio> se registra una vez y necesita leer el valor actual, no el del montaje.
  const shuffleRef  = useRef(false);
  const repeatRef   = useRef('off');         // 'off' | 'all' | 'one'
  // ALEATORIO (M4): la cola ES el orden de reproducción, también en aleatorio. Encenderlo baraja la
  // cola de verdad (sólo lo que viene después de la actual) y siguiente/anterior caminan por posición,
  // así que siguiente → anterior → siguiente da la misma pista. baseRef guarda el orden ORIGINAL (los
  // _qid en el orden de la vista) para devolverlo al apagarlo; sin aleatorio vale null.
  const baseRef     = useRef(null);
  const forcedNextRef = useRef([]);          // FIFO de _qid "a continuación" (play-next; prioridad sobre el orden)
  // Peticiones de la RADIO (1.44.0): _qid → id de quien la pidió. Solo marca de dónde vino: la que
  // está pendiente es la que sigue en forcedNext. Sirve para ponerlas en orden de llegada (no apiladas
  // como el menú local) y para el tope por persona (pendientesDe).
  const pedidosRef = useRef(new Map());

  const [queue,        setQueue]        = useState([]);    // cola reactiva para la UI; queueRef es su espejo
  const [upNextIds,    setUpNextIds]    = useState([]);    // espejo REACTIVO de forcedNextRef → el pill "a continuación" no cuelga de un ref invisible a React
  const [currentTrack, setCurrentTrack] = useState(null);
  const [trackMeta,    setTrackMeta]    = useState(null);  // currentTrack enriquecido (badge + MediaSession)
  const [isPlaying,    setIsPlaying]    = useState(false);
  // true si el último play() lo rechazó el navegador por falta de gesto (ver esBloqueoDeAutoplay).
  // Vuelve a false cuando algo arranca ('playing') o al llamar play/togglePlay otra vez.
  const [playBlocked,  setPlayBlocked]  = useState(false);
  const [currentTime,  setCurrentTime]  = useState(0);
  const [duration,     setDuration]     = useState(0);
  const [volume,       setVolumeState]  = useState(1);
  const [shuffle,      setShuffle]      = useState(false);
  const [repeat,       setRepeat]       = useState('off');
  // Aviso para el usuario que el motor no puede mostrar solo: ToastProvider vive DEBAJO de este
  // provider (main.jsx), así que se publica acá y lo muestra Player.jsx con useToast.
  const [notice,       setNotice]       = useState(null);    // { id, text } | null

  // VIDEO (V4): ítems de cola con kind:'video' (id hex de /api/videos). Hay UN <audio> (la música,
  // como siempre) y UN <video playsinline> que renderiza este provider y no se desmonta nunca:
  // mover o reparentar un elemento de medios lo pausa, así que se COLOCA por CSS sobre el hueco
  // activo (data-video-slot en Player.jsx). Un solo motor y UN elemento activo a la vez: al
  // cambiar de tipo se pausa y se vacía el otro, y los eventos del inactivo se ignoran.
  const videoRef    = useRef(null);
  const activeRef   = useRef('audio');       // 'audio' | 'video': qué elemento manda
  const playNextRef = useRef(null);          // playNext se define después de playIndex
  const skipRunRef  = useRef(0);             // videos saltados seguidos con la página oculta (tope)
  // PANTALLA COMPLETA (T27): va el ENVOLTORIO del <video>, no el <video>. Ver la capa, abajo.
  const videoLayerRef = useRef(null);
  const fsRef         = useRef(false);       // espejo de isVideoFullscreen para el rAF de la capa
  // 'none' | 'layer' (el envoltorio, con controles propios) | 'native' (reproductor del iPhone)
  const [fsMode, setFsMode] = useState('none');
  const isVideoFullscreen = fsMode !== 'none';

  // Lazy-init audio element once (avoids SSR issues and StrictMode double-mount)
  function getAudio() {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.volume = 1;
    }
    return audioRef.current;
  }

  // El elemento que manda ahora. Sin video activo (o antes de montarse) es el <audio>, así que
  // todo lo de la música se comporta exactamente como antes.
  function getActive() {
    return activeRef.current === 'video' && videoRef.current ? videoRef.current : getAudio();
  }

  // Pausa y vacía un elemento que deja de mandar (sin src no sigue bajando ni dispara 'error').
  function vacate(el) {
    if (!el || !el.getAttribute('src')) return;
    el.pause();
    el.removeAttribute('src');
    el.load();
  }

  // sonar = false (sólo lo pide play(…, { sonar: false })): deja la pista cargada y en pausa, sin
  // llamar a el.play(). Por defecto suena, como siempre.
  const playIndex = useCallback((idx, sonar = true) => {
    const track = queueRef.current[idx];
    if (!track) return;
    const isVideo = track.kind === 'video';
    // Un video que va a EMPEZAR con la página oculta se salta: en segundo plano sólo suena audio.
    // El cursor queda en su posición y se pide el siguiente (por posición, también en aleatorio); el
    // tope corta una cola sólo de videos.
    if (isVideo && document.hidden) {
      idxRef.current = idx;
      if (++skipRunRef.current > queueRef.current.length) { skipRunRef.current = 0; getActive().pause(); setIsPlaying(false); return; }
      playNextRef.current?.(false);
      return;
    }
    skipRunRef.current = 0;
    idxRef.current = idx;
    setCurrentTrack(track);
    const audio = getAudio();
    const video = videoRef.current;
    let el = audio;
    if (isVideo && video) {
      activeRef.current = 'video';
      vacate(audio);
      el = video;
      delete el.dataset.ready;             // oculto hasta el primer fotograma del src nuevo (ver la capa)
      el.src = videoStreamUrl(track.id);
    } else {
      activeRef.current = 'audio';
      vacate(video);
      audio.src = streamUrl(track.id);
    }
    // Reflejar YA el reset del elemento: hasta el primer 'timeupdate' de la pista
    // nueva, la UI (letra sincronizada, tiempos) veía el tiempo de la ANTERIOR.
    setCurrentTime(0);
    setDuration(0);
    if (sonar) el.play().catch((err) => {
      if (!esBloqueoDeAutoplay(err)) return;   // AbortError: otro src pisó a éste; no se toca nada
      setPlayBlocked(true);
      // El src nuevo pausó el elemento sin 'pause' y el play() rechazado no trae ninguno: si venía
      // sonando otra pista, isPlaying seguía en true con el elemento callado.
      if (el === getActive() && el.paused) setIsPlaying(false);
    });
    else setIsPlaying(false);   // cambiar el src deja el elemento en pausa sin garantizar un 'pause'
  }, []);

  // Decide y reproduce la siguiente pista respetando repeat. Va POR POSICIÓN, con o sin aleatorio:
  // en aleatorio la cola ya está barajada (toggleShuffle / play), así que la de después es la que se
  // ve debajo en la cola.
  // natural = true cuando la canción terminó sola (la única vez que aplica "repetir una").
  // manual = true cuando lo pidió la persona (botón, MediaSession, swipe): si no hay siguiente, no
  // pasa nada y lo que suena sigue sonando.
  const playNext = useCallback((natural, manual = false) => {
    const len = queueRef.current.length;
    if (len === 0) return;

    // Repetir una: al terminar sola, vuelve a empezar la misma.
    if (natural && repeatRef.current === 'one') { playIndex(idxRef.current); return; }

    const q = queueRef.current;

    // Cola manual "a continuación" (play-next): tiene PRIORIDAD sobre el orden de la cola. FIFO por
    // _qid; se descartan los _qid que ya no estén en la cola (por si se quitó en un paso futuro).
    while (forcedNextRef.current.length) {
      const qid = forcedNextRef.current.shift();
      const i = q.findIndex((t) => t._qid === qid);
      if (i >= 0) {
        setUpNextIds([...forcedNextRef.current]);   // el consumido (y descartes previos) ya salieron del ref → sacarlos del pill
        playIndex(i);
        return;
      }
    }

    // Repetir todo: al final vuelve a la primera, en el MISMO orden (no se rebaraja).
    let nextIdx = -1;
    const n = idxRef.current + 1;
    if (n < len) nextIdx = n;
    else if (repeatRef.current === 'all') nextIdx = 0;

    if (nextIdx >= 0) {
      playIndex(nextIdx);
    } else if (!manual) {
      // Fin sin repetición. Sólo cuando el medio YA se detuvo (terminó solo, o no cargó): un
      // "siguiente" manual en el último no pausa el elemento, así que marcarlo en pausa dejaba el
      // botón en "Reproducir" con la música sonando.
      setIsPlaying(false);
    }
  }, [playIndex]);
  playNextRef.current = playNext;

  useEffect(() => {
    const audio = getAudio();
    const video = videoRef.current;

    // Los mismos handlers para los dos elementos; cada uno se ignora si su elemento no es el
    // activo (por event.target). Con sólo música, el <audio> es siempre el activo: igual que antes.
    const live = (e) => e.target === getActive();
    const onPlay      = (e) => { if (live(e)) setIsPlaying(true); };
    const onPause     = (e) => { if (live(e)) setIsPlaying(false); };
    const onPlaying   = (e) => { if (live(e)) setPlayBlocked(false); };   // arrancó de verdad
    const onTimeUpdate= (e) => {
      if (!live(e)) return;
      const el = e.target;
      setCurrentTime(el.currentTime);
      setDuration(isFinite(el.duration) ? el.duration : 0);
    };
    const onEnded = (e) => { if (live(e)) playNext(true); };
    // Sólo video: la duración real sale del archivo (el backend puede mandar null), y un error de
    // carga (sin red, archivo que no está) salta al siguiente con aviso. El <audio> no cambia.
    const onVideoMeta  = (e) => { if (live(e) && isFinite(e.target.duration)) setDuration(e.target.duration); };
    const onVideoError = (e) => {
      if (!live(e) || !e.target.getAttribute('src')) return;
      setNotice({ id: Date.now(), text: 'No se pudo reproducir el video. Pasamos al siguiente.' });
      playNext(false);
    };
    // Primer fotograma: recién ahí se deja ver el <video> (data-ready). Hasta entonces el hueco muestra
    // la portada del video o el ♪, no el fondo negro de un <video> sin imagen. 'emptied' (vaciar con
    // vacate() o cambiar de src) lo vuelve a ocultar; playIndex además lo borra al poner el src nuevo.
    const onVideoData    = (e) => { e.target.dataset.ready = '1'; };
    const onVideoEmptied = (e) => { delete e.target.dataset.ready; };

    const els = video ? [audio, video] : [audio];
    for (const el of els) {
      el.addEventListener('play',       onPlay);
      el.addEventListener('pause',      onPause);
      el.addEventListener('playing',    onPlaying);
      el.addEventListener('timeupdate', onTimeUpdate);
      el.addEventListener('ended',      onEnded);
    }
    video?.addEventListener('loadedmetadata', onVideoMeta);
    video?.addEventListener('error',          onVideoError);
    video?.addEventListener('loadeddata',     onVideoData);
    video?.addEventListener('emptied',        onVideoEmptied);

    return () => {
      for (const el of els) {
        el.removeEventListener('play',       onPlay);
        el.removeEventListener('pause',      onPause);
        el.removeEventListener('playing',    onPlaying);
        el.removeEventListener('timeupdate', onTimeUpdate);
        el.removeEventListener('ended',      onEnded);
      }
      video?.removeEventListener('loadedmetadata', onVideoMeta);
      video?.removeEventListener('error',          onVideoError);
      video?.removeEventListener('loadeddata',     onVideoData);
      video?.removeEventListener('emptied',        onVideoEmptied);
    };
  }, [playNext]);

  // Keyboard: space = play/pause, ←/→ = seek 10s (sobre el elemento activo).
  // El atajo no actúa si alguien ya manejó la tecla, si es una repetición por mantenerla, si se
  // está componiendo texto (IME), si lleva Ctrl/Alt/Meta/Shift (son del navegador o del sistema:
  // Alt+← es "atrás"), o si el foco está donde se escribe o se elige: ahí la tecla es del campo.
  // Botones y controles: Espacio es del control enfocado si se llegó a él con Tab. Sigue siendo
  // play/pausa si el último movimiento fue un clic o un toque, o si el control está dentro del
  // reproductor (salvo el menú «+» abierto). En los enlaces Espacio sigue siendo play/pausa siempre.
  useEffect(() => {
    // Cómo se llegó al foco por última vez: 'teclado' sólo con Tab (con o sin Shift); cualquier
    // pointerdown (mouse, dedo o lápiz) lo vuelve 'puntero'. Las flechas no cambian el modo.
    let modo = 'puntero';
    const onPointer = () => { modo = 'puntero'; };
    const onTab = (e) => { if (e.key === 'Tab') modo = 'teclado'; };
    const spaceIsTheControls = (t) =>
      modo === 'teclado' && !!t?.closest?.(SPACE_CONTROLS)
      && (!t.closest(PLAYER_AREAS) || !!t.closest(PLAYER_MENUS));
    const onKey = (e) => {
      if (e.defaultPrevented) return;
      if (e.repeat) return;
      if (e.isComposing) return;
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      const t = e.target;
      if (t?.closest?.(KEY_FIELDS) || t?.isContentEditable) return;
      if (e.code === 'Space') {
        if (spaceIsTheControls(t)) return;   // sin preventDefault: ocurre la acción nativa del control
        e.preventDefault(); togglePlay();
      }
      if (e.code === 'ArrowRight') seek(getActive().currentTime + 10);
      if (e.code === 'ArrowLeft')  seek(getActive().currentTime - 10);
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onTab, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onTab, true);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Metadata enriquecida de la pista actual (badge de calidad + `album` para MediaSession).
  // Reemplaza el estado `quality` que vivía en Player.jsx: mismo comportamiento (el badge
  // se muestra SYNC desde lo que trae la cola; enriquece solo si falta algo, lo que hoy no
  // pasa con ninguna ruta de cola) pero centralizado, memoizado y disponible para MediaSession.
  useEffect(() => {
    if (!currentTrack) { setTrackMeta(null); return; }
    // Un video no es una pista: no tiene specs de audio ni ficha en /api/tracks (su id es hex).
    if (currentTrack.kind === 'video') { setTrackMeta(null); return; }
    const cached = metaCacheRef.current.get(currentTrack.id);
    if (cached) { setTrackMeta(cached); return; }
    // Badge inmediato (sync) desde la cola, como el `quality` viejo: el badge sale de
    // campos de audio, nunca de album/album_artist → jamás parpadea. Si no hay specs, NO
    // reseteamos: queda el valor previo durante el fetch (igual que el `quality` viejo).
    if (currentTrack.codec || currentTrack.sample_rate || currentTrack.bitrate) {
      setTrackMeta(currentTrack);
    }
    if (isComplete(currentTrack)) { metaCacheRef.current.set(currentTrack.id, currentTrack); return; }
    let cancelled = false;
    resolveTrackMeta(currentTrack).then(m => {
      metaCacheRef.current.set(currentTrack.id, m);
      if (!cancelled) setTrackMeta(m);
    });
    return () => { cancelled = true; };
  }, [currentTrack]);

  // play(tracks, startIndex, opciones) REEMPLAZA la cola entera. Sin opciones respeta el orden de
  // `tracks` TAL CUAL aunque el aleatorio esté encendido: la radio carga [pista, siguiente] y
  // devuelve la cola guardada con esto, y necesita ese orden. Opciones:
  //  · sonar: false → cargada y en pausa (la radio al devolver la cola).
  //  · vista: true → `tracks` es una lista de la app (tocar una fila, "Reproducir"). Con el aleatorio
  //    encendido, la tocada va PRIMERO y TODO el resto de la lista barajado detrás: lo de antes de la
  //    tocada también suena. Con el aleatorio apagado, lo de siempre.
  //  · mezclar: true → el Mix: la lista entera barajada desde la primera, y enciende el aleatorio.
  // Con el aleatorio encendido, baseRef queda con `tracks` en el orden recibido (el de la vista):
  // apagarlo lo devuelve.
  const play = useCallback((tracks, startIndex = 0, { sonar = true, vista = false, mezclar = false } = {}) => {
    // Cada entrada recibe un _qid estable (identidad interna de la cola; NO viaja a la API ni a
    // MediaSession).
    setPlayBlocked(false);                 // un intento nuevo: si lo vuelven a bloquear, el catch lo pone otra vez
    const items = tracks.map((t) => ({ ...t, _qid: ++uidRef.current }));
    let order = items;
    let start = startIndex;
    if (mezclar) {
      order = shuffled(items);
      start = 0;
      if (!shuffleRef.current) { shuffleRef.current = true; setShuffle(true); }
    } else if (vista && shuffleRef.current && items[startIndex]) {
      order = [items[startIndex], ...shuffled(items.filter((_, i) => i !== startIndex))];
      start = 0;
    }
    queueRef.current = order;              // espejo síncrono para los callbacks
    setQueue(order);                       // estado reactivo para la UI
    baseRef.current = shuffleRef.current ? items.map((t) => t._qid) : null;   // orden a devolver al apagar
    forcedNextRef.current = [];            // reemplazar la cola entera también limpia lo "a continuación"
    pedidosRef.current.clear();            // y las peticiones de la radio
    setUpNextIds([]);                      // espejo reactivo
    playIndex(start, sonar);
  }, [playIndex]);

  // Encola pistas AL FINAL sin resetear. Acepta una o muchas. Si nada suena (sin pista actual),
  // arranca la reproducción con la primera agregada — si no, la acción sería invisible. Append
  // no corre índices. Con aleatorio va al final del orden barajado (no se mezcla con lo que viene) y
  // NO entra en baseRef: al apagar el aleatorio queda al final, después del orden de la vista.
  const addToQueue = useCallback((tracks) => {
    const list = Array.isArray(tracks) ? tracks : [tracks];
    if (!list.length) return;
    const items = list.map((t) => ({ ...t, _qid: ++uidRef.current }));
    const startAt = queueRef.current.length;          // primera nueva
    const next = [...queueRef.current, ...items];
    queueRef.current = next;
    setQueue(next);
    if (idxRef.current < 0) playIndex(startAt);        // nada sonaba → arranca
  }, [playIndex]);

  // Inserta pistas JUSTO DESPUÉS de la actual y las marca para sonar a continuación (forcedNext,
  // así vale también en aleatorio). Acepta una o muchas. Nada suena → arranca. Como baseRef y
  // forcedNext son por _qid, insertar NO remapea nada; solo se recomputa idxRef por _qid. Lo insertado
  // no entra en baseRef: si el aleatorio se apaga con eso pendiente, toggleShuffle lo deja justo
  // detrás de la actual; si ya sonó, va al final como todo lo agregado después.
  //
  // DOS ÓRDENES (1.44.0). El menú local APILA: cada una va justo detrás de la actual, así que la
  // última pedida suena primero. Una petición de la RADIO (`pedidoPor`: el id de quien modera) va en
  // ORDEN DE LLEGADA: detrás de la última petición de la radio que siga pendiente (o de la actual, si
  // no hay), y en forcedNext justo después de esa. Así la cola y forcedNext siguen diciendo lo mismo
  // (la cola ES el orden de reproducción, M4) y "siguiente" da la primera que llegó.
  const playAfterCurrent = useCallback((tracks, { pedidoPor = null } = {}) => {
    const list = Array.isArray(tracks) ? tracks : [tracks];
    if (!list.length) return;
    const items = list.map((t) => ({ ...t, _qid: ++uidRef.current }));
    const q = queueRef.current;
    const idx = idxRef.current;
    const curQid = q[idx]?._qid;
    const forced = forcedNextRef.current;
    // La última petición de la radio pendiente, por delante de la actual: su lugar en la cola y en forcedNext.
    let ultima = -1, ultimaEn = -1;
    if (pedidoPor != null && idx >= 0) {
      forced.forEach((qid, k) => {
        if (!pedidosRef.current.has(qid)) return;
        const i = q.findIndex((t) => t._qid === qid);
        if (i > idx && i > ultimaEn) { ultima = k; ultimaEn = i; }
      });
    }
    const at = ultimaEn >= 0 ? ultimaEn + 1 : idx + 1;   // idx=-1 (nada suena) → at=0
    const next = [...q];
    next.splice(at, 0, ...items);
    queueRef.current = next;
    setQueue(next);
    if (idx < 0) {
      playIndex(at);                                  // nada sonaba → arranca con la primera insertada
    } else {
      const qids = items.map((t) => t._qid);
      if (pedidoPor != null) {
        for (const qid of qids) pedidosRef.current.set(qid, pedidoPor);
        forcedNextRef.current = [...forced.slice(0, ultima + 1), ...qids, ...forced.slice(ultima + 1)];
      } else {
        forcedNextRef.current = [...qids, ...forced];   // el menú local: apilada, suena primero
      }
      setUpNextIds([...forcedNextRef.current]);       // espejo reactivo para el pill
      if (curQid != null) idxRef.current = next.findIndex((t) => t._qid === curQid);  // recomputar posición actual
    }
  }, [playIndex]);

  // Cuántas peticiones de la radio de esta persona siguen pendientes (marcadas "a continuación" y sin
  // sonar). Lo usa el anfitrión para el tope por persona; lee refs, así que siempre da lo de este instante.
  const pendientesDe = useCallback((por) => {
    if (por == null) return 0;
    return forcedNextRef.current.filter((qid) => pedidosRef.current.get(qid) === por).length;
  }, []);

  const togglePlay = useCallback(() => {
    const el = getActive();
    setPlayBlocked(false);
    if (el.paused) el.play().catch((err) => { if (esBloqueoDeAutoplay(err)) setPlayBlocked(true); });
    else el.pause();
  }, []);

  // Pausar y reanudar EXPLÍCITOS (la radio): a diferencia de togglePlay no dependen de cómo esté el
  // elemento. pause() sobre algo en pausa no hace nada; resume() sobre algo que suena tampoco (no
  // reinicia ni recarga). El rechazo de resume() se maneja como en playIndex (P-c y P-f).
  const pause = useCallback(() => {
    const el = getActive();
    if (!el.paused) el.pause();
  }, []);

  const resume = useCallback(() => {
    const el = getActive();
    if (!el.paused) return;
    setPlayBlocked(false);
    el.play().catch((err) => {
      if (!esBloqueoDeAutoplay(err)) return;
      setPlayBlocked(true);
      if (el === getActive() && el.paused) setIsPlaying(false);
    });
  }, []);

  // "Siguiente" manual: avanza respetando shuffle/repeat, pero ignora "repetir una"
  // (pulsar siguiente debe pasar de canción, no repetir la misma).
  const next = useCallback(() => playNext(false, true), [playNext]);

  // "Anterior": con más de 3 s vuelve al inicio de la pista; si no, la de ARRIBA en la cola. Por
  // posición también en aleatorio (la cola ya es el orden barajado): siguiente → anterior →
  // siguiente da la misma pista.
  const prev = useCallback(() => {
    const el = getActive();
    if (el.currentTime > 3) { el.currentTime = 0; return; }
    const p = idxRef.current - 1;
    if (p >= 0) playIndex(p);
  }, [playIndex]);

  // Salta a una pista de la cola por índice (tap en la vista de cola). Desde ahí se sigue por
  // posición: lo de abajo es lo que viene, lo de arriba es "anterior".
  //
  // Lo "a continuación" que queda en la pista elegida o por ENCIMA de ella pierde la marca (1.44.0): ya
  // es "anterior". Sin esto, playNext lo seguía buscando por _qid y volvía hacia atrás (y luego, por
  // posición, repetía lo que había entre medio); y saltar a una marcada la hacía sonar otra vez.
  const jumpTo = useCallback((index) => {
    const pasadas = new Set(queueRef.current.slice(0, Math.max(0, index + 1)).map((t) => t._qid));
    if (forcedNextRef.current.some((qid) => pasadas.has(qid))) {
      forcedNextRef.current = forcedNextRef.current.filter((qid) => !pasadas.has(qid));
      setUpNextIds([...forcedNextRef.current]);
    }
    playIndex(index);
  }, [playIndex]);

  // Quita UNA entrada de la cola por `_qid`. Es exactamente la operación para la que se eligió
  // el keying por _qid (actions-lab, "el paso 2 muerde"): como el orden original (baseRef) y
  // forcedNext se llevan por _qid y NO por índice, quitar no remapea nada — sólo hay que recomputar idxRef
  // (la posición de la actual, que se corrió si lo quitado estaba antes) y sacar el _qid de las
  // estructuras para que no queden apuntando a algo que ya no existe.
  //
  // La pista que SUENA no se puede quitar: arrancarle la fuente al <audio> obliga a decidir qué
  // suena después, y eso es una decisión de reproducción aparte. El menú además oculta la acción
  // ahí, así que esto es la red, no el camino normal. NO toca MediaSession.
  const removeFromQueue = useCallback((qid) => {
    if (qid == null) return;
    const curQid = queueRef.current[idxRef.current]?._qid;
    if (qid === curQid) return;
    const next = queueRef.current.filter((t) => t._qid !== qid);
    if (next.length === queueRef.current.length) return;   // no estaba en la cola
    queueRef.current = next;
    setQueue(next);
    if (baseRef.current) baseRef.current = baseRef.current.filter((b) => b !== qid);   // al apagar no vuelve
    if (forcedNextRef.current.includes(qid)) {              // pill "a continuación"
      forcedNextRef.current = forcedNextRef.current.filter((f) => f !== qid);
      setUpNextIds([...forcedNextRef.current]);
    }
    if (curQid != null) idxRef.current = next.findIndex((t) => t._qid === curQid);
  }, []);

  // Mueve UNA entrada de la cola a otra posición (reorder por arrastre en desktop). Es la tercera
  // pata del trípode que habilita el keying por _qid: como baseRef/forcedNext se llevan por
  // _qid y NO por índice, PERMUTAR el array no corrompe nada — igual que en removeFromQueue, lo
  // único posicional del motor es idxRef, y se recomputa por findIndex.
  //
  // NO llama a playIndex ni toca el <audio>: lo que suena sigue sonando, en el mismo segundo, y
  // MediaSession (que cuelga de currentTrack/isPlaying) ni se entera. Reordenar cambia el PLAN,
  // nunca la reproducción en curso.
  //
  // `toIndex` es la posición destino en la cola YA SIN la pista movida (convención
  // splice-remove-then-insert): mover la 0 con toIndex=2 la deja en el índice 2 del array final.
  //
  // baseRef (el orden original del aleatorio) NO se toca a propósito: mover cambia lo que suena
  // después, pero apagar el aleatorio sigue devolviendo el orden de la vista.
  //
  // forcedNext SÍ: mover a mano una pista marcada "a continuación" REVOCA su marca. Sin esto el
  // arrastre mentiría — forcedNext tiene prioridad sobre el orden (playNext lo consume antes de
  // cualquier pick), así que arrastrarla al fondo la haría sonar a continuación igual. La regla
  // queda simple y explicable: si la moviste a mano, manda el orden. Simétrico con
  // removeFromQueue, y sale del ref Y de su espejo reactivo (el pill).
  //
  // En ALEATORIO también manda el orden (M4): la cola es el orden barajado y playNext camina por
  // posición, así que arrastrar cambia lo que suena después, igual que sin aleatorio. Lo que no
  // cambia es baseRef: apagar el aleatorio devuelve el orden de la vista y deshace el arrastre.
  const moveInQueue = useCallback((qid, toIndex) => {
    if (qid == null) return;
    const q = queueRef.current;
    const from = q.findIndex((t) => t._qid === qid);
    if (from < 0) return;                                   // no estaba en la cola
    const to = Math.max(0, Math.min(toIndex, q.length - 1));
    if (to === from) return;                                // no-op
    const curQid = q[idxRef.current]?._qid;
    const next = [...q];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    queueRef.current = next;
    setQueue(next);
    if (forcedNextRef.current.includes(qid)) {              // el gesto manual revoca el pill
      forcedNextRef.current = forcedNextRef.current.filter((f) => f !== qid);
      setUpNextIds([...forcedNextRef.current]);
    }
    if (curQid != null) idxRef.current = next.findIndex((t) => t._qid === curQid);
  }, []);

  const seek = useCallback((time) => {
    if (!Number.isFinite(time)) return;   // seek(Infinity) o seek(NaN) lanzaría TypeError al asignar
    const el = getActive();
    // Sin duración todavía (NaN antes de los metadatos) no se recorta: el navegador guarda el
    // punto pedido y lo aplica al cargar, recortado a lo posible. Antes eso iba a 0.
    const d = el.duration;
    el.currentTime = Math.max(0, Number.isFinite(d) ? Math.min(time, d) : time);
  }, []);

  // El volumen va a los DOS elementos: así al pasar de canción a video (o al revés) no salta.
  const setVolume = useCallback((v) => {
    getAudio().volume = v;
    if (videoRef.current) videoRef.current.volume = v;
    setVolumeState(v);
  }, []);

  // Encender/apagar el aleatorio REORDENA la cola; nunca toca el <audio>: lo que suena sigue sonando
  // en el mismo segundo (sólo se recomputa idxRef por _qid). La verdad es shuffleRef y no el updater
  // de setShuffle: el updater no puede tener efectos (StrictMode lo llama dos veces).
  //  · Encender: guarda el orden actual como el original (baseRef) y baraja SÓLO lo que viene
  //    después de la actual; lo de antes queda intacto. Lo marcado "a continuación" que está después
  //    no se baraja: queda justo detrás de la actual, en su orden, porque igual suena primero (si se
  //    barajara, al terminar se seguiría desde donde cayó y se saltarían pistas).
  //  · Apagar: devuelve el orden original con lo que sigue en la cola, y lo agregado después (que no
  //    estaba en el original) va al final. Lo "a continuación" pendiente queda justo detrás de la
  //    actual por la misma razón de arriba.
  const toggleShuffle = useCallback(() => {
    const v = !shuffleRef.current;
    shuffleRef.current = v;
    setShuffle(v);
    const q = queueRef.current;
    const cur = q[idxRef.current] ?? null;
    const forced = forcedNextRef.current;
    let next;
    if (v) {
      baseRef.current = q.map((t) => t._qid);
      if (q.length < 2) return;
      const at = idxRef.current + 1;                      // nada suena (−1) → se baraja todo
      const head = q.slice(0, at);
      const tail = q.slice(at);
      const pend = forced.map((qid) => tail.find((t) => t._qid === qid)).filter(Boolean);
      next = [...head, ...pend, ...shuffled(tail.filter((t) => !forced.includes(t._qid)))];
    } else {
      const base = baseRef.current;
      baseRef.current = null;
      if (!base) return;
      const byQid = new Map(q.map((t) => [t._qid, t]));
      const inBase = new Set(base);
      const restored = [
        ...base.map((qid) => byQid.get(qid)).filter(Boolean),
        ...q.filter((t) => !inBase.has(t._qid)),
      ];
      const pend = forced.map((qid) => byQid.get(qid)).filter((t) => t && t !== cur);
      next = restored.filter((t) => !pend.includes(t));
      const ci = cur ? next.indexOf(cur) : -1;
      if (ci >= 0) next.splice(ci + 1, 0, ...pend);
      else next = restored;
    }
    queueRef.current = next;
    setQueue(next);
    if (cur) idxRef.current = next.indexOf(cur);
  }, []);

  const cycleRepeat = useCallback(() => {
    setRepeat((r) => {
      const nextMode = r === 'off' ? 'all' : r === 'all' ? 'one' : 'off';
      repeatRef.current = nextMode;
      return nextMode;
    });
  }, []);

  // Pone un modo concreto (la radio lo apaga al unirse y lo devuelve al salir). Un valor que no
  // sea 'off' | 'all' | 'one' no hace nada.
  const setRepeatMode = useCallback((m) => {
    if (m !== 'off' && m !== 'all' && m !== 'one') return;
    repeatRef.current = m;
    setRepeat(m);
  }, []);

  // ── MediaSession ────────────────────────────────────────────────────────────
  // Proyecta el estado de reproducción al SO. Es lo ÚNICO que se ve en la pantalla del
  // carro (CarPlay en la Maverick; AVRCP por Bluetooth en Kangoo/RAV4) y lo que pinta el
  // lockscreen. Vive acá porque el contexto es el dueño del <audio>, que nunca se expone.

  // Metadata + carátula. Re-emite al cambiar de pista, al enriquecerse `trackMeta`, y al
  // rotar el token (la URL de la carátula lo lleva en query param).
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (!currentTrack) { navigator.mediaSession.metadata = null; return; }
    // `trackMeta` puede ir un tick por detrás de `currentTrack` mientras se resuelve:
    // solo lo usamos si es de ESTA pista, para no publicar el álbum de la anterior.
    // Video: título y artista del video, y su portada sólo si tiene (has_cover); sin portada, nada.
    if (currentTrack.kind === 'video') {
      const vsrc = token && currentTrack.has_cover ? videoCoverUrl(currentTrack.id) : null;
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title:  currentTrack.title  || 'Sin título',
          artist: currentTrack.artist || 'Artista desconocido',
          album:  '',
          artwork: vsrc ? ['96x96', '256x256', '512x512'].map((sizes) => ({ src: vsrc, sizes })) : [],
        });
      } catch { /* motor sin MediaMetadata */ }
      return;
    }
    const meta = trackMeta?.id === currentTrack.id ? trackMeta : currentTrack;
    // Hueco de reauth (token=null un instante): emitimos SIN artwork en vez de mandar
    // `?token=null`, que 404ea en el lockscreen. Al llegar el token nuevo, este efecto
    // vuelve a correr y re-emite con la URL fresca.
    // SIN thumb, a proposito: esta URL se la entregamos al SISTEMA OPERATIVO (lockscreen,
    // CarPlay, Android Auto) y el artwork de abajo declara hasta 512x512. Una miniatura de
    // 480 mentiria sobre su propio tamano en el caso que mas se mira de lejos.
    const src = token ? coverUrl(currentTrack.id) : null;
    // Los 3 `sizes` apuntan a la MISMA imagen (el backend sirve la carátula embebida
    // original, sin resize): el SO elige y escala. Sin `type`: el endpoint hace sendFile
    // del archivo original, que puede ser jpeg o png.
    const artwork = src ? ['96x96', '256x256', '512x512'].map((sizes) => ({ src, sizes })) : [];
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title:  meta.title  || 'Sin título',
        artist: meta.artist || 'Artista desconocido',
        album:  meta.album  || '',
        artwork,
      });
    } catch { /* motor sin MediaMetadata → sin "Now Playing"; la reproducción sigue igual */ }
  }, [currentTrack, trackMeta, token]);

  // Estado play/pause. Sin esto, iOS/CarPlay desincroniza el glifo.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState =
      !currentTrack ? 'none' : isPlaying ? 'playing' : 'paused';
  }, [currentTrack, isPlaying]);

  // Controles del volante / lockscreen. Cada handler va en su propio try/catch porque un
  // motor viejo lanza TypeError en las acciones que no soporta, y una sola caída no puede
  // llevarse las demás. No seteamos `playbackState` acá: los eventos play/pause del <audio>
  // mueven `isPlaying` y el efecto de arriba lo refleja.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const set = (action, handler) => {
      try { navigator.mediaSession.setActionHandler(action, handler); }
      catch { /* acción no soportada → se ignora */ }
    };
    set('play',          () => { getActive().play().catch(() => {}); });
    set('pause',         () => getActive().pause());
    set('previoustrack', () => prev());
    set('nexttrack',     () => next());
    set('seekto',        (d) => { if (d?.seekTime != null) seek(d.seekTime); });   // seek() clampa
    set('seekbackward',  (d) => seek(getActive().currentTime - (d?.seekOffset ?? 10)));
    set('seekforward',   (d) => seek(getActive().currentTime + (d?.seekOffset ?? 10)));
    set('stop',          () => { getActive().pause(); seek(0); });
    return () => { for (const a of MEDIA_ACTIONS) set(a, null); };
  }, [next, prev, seek]);

  // Posición para el scrubber. Crítico en iOS: con el JS dormido en background, el SO
  // interpola desde el último estado publicado; sin esto la barra se congela en el carro.
  useEffect(() => {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    // La API LANZA con duration no finita/0 o position > duration. Al arrancar una pista
    // duration=0 (playIndex resetea) → se omite hasta el primer 'timeupdate'.
    if (!isFinite(duration) || duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: 1,                                        // no cambiamos velocidad
        position: Math.max(0, Math.min(currentTime, duration)),
      });
    } catch { /* motor viejo → sin scrubber; el resto sigue */ }
  }, [currentTime, duration]);

  // ── Capa del <video> ────────────────────────────────────────────────────────
  // Mientras suena un video, cada frame se mide el hueco visible (la portada del expandido si está
  // abierto; si no, la del mini) y el <video> se coloca encima con transform/tamaño. Se escribe
  // directo en el nodo, sin estado de React: el hueco se mueve con los gestos y animaciones del
  // expandido y seguirlo por render costaría un re-render por frame. Sin video, el loop no corre y
  // el elemento queda oculto (data-slot vacío). No agrega animaciones propias: sigue al hueco.
  const isVideo = currentTrack?.kind === 'video';
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return undefined;
    if (!isVideo) { v.dataset.slot = ''; return undefined; }
    let raf = 0;
    const visible = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? r : null;
    };
    const tick = () => {
      // En pantalla completa el <video> llena la pantalla (CSS :fullscreen con !important) y no
      // hay hueco que seguir: se saltea la medición. Al salir, el frame siguiente lo devuelve.
      if (fsRef.current) { raf = requestAnimationFrame(tick); return; }
      let slot = 'exp';
      let r = visible(document.querySelector('[data-video-slot="exp"]'));
      if (!r) { slot = 'mini'; r = visible(document.querySelector('[data-video-slot="mini"]')); }
      if (r) {
        v.style.transform = `translate(${r.left}px, ${r.top}px)`;
        v.style.width  = `${r.width}px`;
        v.style.height = `${r.height}px`;
        if (v.dataset.slot !== slot) v.dataset.slot = slot;
      } else if (v.dataset.slot) {
        v.dataset.slot = '';
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { cancelAnimationFrame(raf); v.dataset.slot = ''; };
  }, [isVideo]);

  // ── Pantalla completa del video ─────────────────────────────────────────────
  // Va a pantalla completa el ENVOLTORIO estático del <video> (así los controles propios viven
  // adentro y el <video> sigue sin reparentarse). Se elige por CAPACIDAD, no por user-agent: si el
  // navegador no deja poner un elemento cualquiera en pantalla completa (iPhone), se cae al
  // reproductor nativo con webkitEnterFullscreen sobre el <video>. Todas las salidas (Esc del
  // navegador, doble clic, cambio a canción) se reflejan por EVENTO, nunca seteando el estado a mano.
  const enterVideoFullscreen = useCallback(() => {
    const layer = videoLayerRef.current;
    const v = videoRef.current;
    if (!layer || !v || activeRef.current !== 'video' || fsRef.current) return;
    const req = layer.requestFullscreen ?? layer.webkitRequestFullscreen;
    const enabled = document.fullscreenEnabled ?? document.webkitFullscreenEnabled;
    if (req && enabled !== false) {
      try { Promise.resolve(req.call(layer)).catch(() => {}); } catch { /* sin gesto o denegado */ }
      return;
    }
    try { v.webkitEnterFullscreen?.(); } catch { /* sin metadata todavía o sin soporte */ }
  }, []);

  const exitVideoFullscreen = useCallback(() => {
    const layer = videoLayerRef.current;
    if (layer && fullscreenElement() === layer) {
      const exit = document.exitFullscreen ?? document.webkitExitFullscreen;
      try { Promise.resolve(exit?.call(document)).catch(() => {}); } catch { /* ya salió */ }
      return;
    }
    const v = videoRef.current;
    if (v?.webkitDisplayingFullscreen) { try { v.webkitExitFullscreen(); } catch { /* ya salió */ } }
  }, []);

  useEffect(() => {
    const layer = videoLayerRef.current;
    const v = videoRef.current;
    if (!layer || !v) return undefined;
    const sync = (mode) => { fsRef.current = mode !== 'none'; setFsMode(mode); };
    const onDocChange = () => sync(fullscreenElement() === layer ? 'layer' : 'none');
    const onBegin = () => sync('native');   // reproductor nativo (iPhone)
    const onEnd   = () => sync('none');
    document.addEventListener('fullscreenchange', onDocChange);
    document.addEventListener('webkitfullscreenchange', onDocChange);
    v.addEventListener('webkitbeginfullscreen', onBegin);
    v.addEventListener('webkitendfullscreen', onEnd);
    return () => {
      document.removeEventListener('fullscreenchange', onDocChange);
      document.removeEventListener('webkitfullscreenchange', onDocChange);
      v.removeEventListener('webkitbeginfullscreen', onBegin);
      v.removeEventListener('webkitendfullscreen', onEnd);
    };
  }, []);

  // Video → video sigue en pantalla completa (mismo envoltorio, sólo cambia el src). Video →
  // canción sale: vacate() dejó el <video> sin src y la capa de arriba lo oculta.
  useEffect(() => {
    if (!isVideo && fsRef.current) exitVideoFullscreen();
  }, [isVideo, exitVideoFullscreen]);

  // Sobre el video en pantalla completa: clic = play/pausa, doble clic = salir. Sólo cuenta el
  // clic sobre el FONDO de la capa (el <video> no recibe puntero, así que el target es el
  // envoltorio): lo que haya encima (controles) no dispara esto. Fuera de pantalla completa la
  // capa no tiene caja y nunca recibe un clic.
  const onLayerClick = useCallback((e) => {
    if (!fsRef.current || e.target !== e.currentTarget) return;
    togglePlay();
  }, [togglePlay]);
  const onLayerDoubleClick = useCallback((e) => {
    if (!fsRef.current || e.target !== e.currentTarget) return;
    exitVideoFullscreen();
  }, [exitVideoFullscreen]);

  // Se lee del ref en cada render del provider y entra como dep del useMemo de abajo: toda
  // mutación que mueve idxRef (playIndex, insertar, quitar, reordenar) también setea estado
  // (currentTrack o queue), así que el provider re-renderiza y el value se recalcula.
  const queueIndex = idxRef.current;

  // _qid "a continuación" desde ESTADO (reactivo); forcedNextRef sigue siendo la verdad del motor.
  // Memoizado: un Set nuevo por render invalidaba el value entero.
  const upNext = useMemo(() => new Set(upNextIds), [upNextIds]);

  // Value ESTABLE: sin currentTime/duration (viven en PlayerTimeContext), así que un tick de
  // 'timeupdate' re-renderiza el provider pero NO cambia esta identidad → los consumidores que
  // no pintan el tiempo no se enteran. Todas las funciones ya son useCallback estables.
  const value = useMemo(() => ({
    currentTrack, trackMeta, isPlaying, playBlocked, volume, queueIndex,
    shuffle, repeat,
    queue, upNext, notice,
    play, addToQueue, playAfterCurrent, pendientesDe, removeFromQueue, moveInQueue, jumpTo, togglePlay, pause, resume, next, prev, seek, setVolume, toggleShuffle, cycleRepeat, setRepeatMode,
    isVideoFullscreen, enterVideoFullscreen, exitVideoFullscreen,
  }), [
    currentTrack, trackMeta, isPlaying, playBlocked, volume, queueIndex, shuffle, repeat, queue, upNext, notice,
    play, addToQueue, playAfterCurrent, pendientesDe, removeFromQueue, moveInQueue, jumpTo, togglePlay, pause, resume, next, prev, seek, setVolume, toggleShuffle, cycleRepeat, setRepeatMode,
    isVideoFullscreen, enterVideoFullscreen, exitVideoFullscreen,
  ]);

  const timeValue = useMemo(() => ({ currentTime, duration }), [currentTime, duration]);

  return (
    <PlayerContext.Provider value={value}>
      <PlayerTimeContext.Provider value={timeValue}>
        {children}
        {/* El ÚNICO <video> de la app. Siempre montado; lo coloca el efecto de la capa. Sin
            controles nativos y sin eventos de puntero: los gestos y botones siguen siendo los del
            reproductor que está debajo.
            Su envoltorio es lo que va a pantalla completa. ⚠️ Tiene que quedar SIN position,
            z-index ni transform: cualquiera de los tres crea un contexto de apilamiento y encierra
            el z-index del <video> (1 en el mini, 201 sobre el expandido). Así es un div estático
            sin caja visible y el `fixed` del <video> sigue refiriéndose al viewport. */}
        <div ref={videoLayerRef} className="player-video-layer" onClick={onLayerClick} onDoubleClick={onLayerDoubleClick}>
          <video ref={videoRef} className="player-video" data-slot="" playsInline preload="auto" aria-hidden="true" tabIndex={-1} />
          {fsMode === 'layer' && (
            <VideoFullscreenControls
              layerRef={videoLayerRef}
              track={currentTrack}
              isPlaying={isPlaying}
              currentTime={currentTime}
              duration={duration}
              notice={notice}
              onToggle={togglePlay}
              onPrev={prev}
              onNext={next}
              onSeek={seek}
              onExit={exitVideoFullscreen}
            />
          )}
        </div>
      </PlayerTimeContext.Provider>
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  return useContext(PlayerContext);
}

// { currentTime, duration } — cambia ~4 Hz mientras suena. Usarlo SÓLO donde se pinta el tiempo.
export function usePlayerTime() {
  return useContext(PlayerTimeContext);
}
