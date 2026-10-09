import {
  createContext, useContext, useRef, useState, useEffect, useCallback, useMemo,
} from 'react';
import { streamUrl, coverUrl, videoStreamUrl, videoCoverUrl } from '../api/client.js';
import { resolveTrackMeta, isComplete } from '../utils/trackMeta.js';
import { useAuth } from './AuthContext.jsx';
import VideoFullscreenControls from '../components/VideoFullscreenControls.jsx';

const PlayerContext = createContext(null);
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
  const playedRef   = useRef(new Set());     // _qid ya sonados en el ciclo de shuffle
  const historyRef  = useRef([]);            // orden real de reproducción por _qid (para "anterior" en shuffle)
  const forcedNextRef = useRef([]);          // FIFO de _qid "a continuación" (play-next; prioridad sobre shuffle/secuencial)

  const [queue,        setQueue]        = useState([]);    // cola reactiva para la UI; queueRef es su espejo
  const [upNextIds,    setUpNextIds]    = useState([]);    // espejo REACTIVO de forcedNextRef → el pill "a continuación" no cuelga de un ref invisible a React
  const [currentTrack, setCurrentTrack] = useState(null);
  const [trackMeta,    setTrackMeta]    = useState(null);  // currentTrack enriquecido (badge + MediaSession)
  const [isPlaying,    setIsPlaying]    = useState(false);
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

  const playIndex = useCallback((idx) => {
    const track = queueRef.current[idx];
    if (!track) return;
    const isVideo = track.kind === 'video';
    // Un video que va a EMPEZAR con la página oculta se salta: en segundo plano sólo suena audio.
    // Se marca como sonado y se pide el siguiente; el tope corta una cola sólo de videos.
    if (isVideo && document.hidden) {
      idxRef.current = idx;
      playedRef.current.add(track._qid);
      if (++skipRunRef.current > queueRef.current.length) { skipRunRef.current = 0; getActive().pause(); setIsPlaying(false); return; }
      playNextRef.current?.(false);
      return;
    }
    skipRunRef.current = 0;
    idxRef.current = idx;
    playedRef.current.add(track._qid);     // marca como sonada por _qid (regla shuffle sin repetir)
    setCurrentTrack(track);
    const audio = getAudio();
    const video = videoRef.current;
    let el = audio;
    if (isVideo && video) {
      activeRef.current = 'video';
      vacate(audio);
      el = video;
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
    el.play().catch(() => {});
  }, []);

  // Decide y reproduce la siguiente pista respetando shuffle + repeat.
  // natural = true cuando la canción terminó sola (la única vez que aplica "repetir una").
  const playNext = useCallback((natural) => {
    const len = queueRef.current.length;
    if (len === 0) return;

    // Repetir una: al terminar sola, vuelve a empezar la misma.
    if (natural && repeatRef.current === 'one') { playIndex(idxRef.current); return; }

    const q = queueRef.current;
    const curQid = q[idxRef.current]?._qid;

    // Cola manual "a continuación" (play-next): tiene PRIORIDAD sobre el pick shuffle/secuencial
    // → hace que playAfterCurrent suene a continuación incluso en shuffle. FIFO por _qid; se
    // descartan los _qid que ya no estén en la cola (por si se quitó en un paso futuro).
    while (forcedNextRef.current.length) {
      const qid = forcedNextRef.current.shift();
      const i = q.findIndex((t) => t._qid === qid);
      if (i >= 0) {
        setUpNextIds([...forcedNextRef.current]);   // el consumido (y descartes previos) ya salieron del ref → sacarlos del pill
        if (curQid != null) historyRef.current.push(curQid);
        playIndex(i);
        return;
      }
    }

    let nextIdx = -1;
    if (shuffleRef.current && len > 1) {
      // candidatas: las que aún no han sonado en este ciclo (sin la actual), por _qid
      let pool = [];
      for (let i = 0; i < len; i++) {
        if (i !== idxRef.current && !playedRef.current.has(q[i]._qid)) pool.push(i);
      }
      // ciclo agotado: si repetimos la cola, reinicia el ciclo (conserva la actual como sonada)
      if (pool.length === 0 && repeatRef.current === 'all') {
        playedRef.current = new Set(curQid != null ? [curQid] : []);
        for (let i = 0; i < len; i++) if (i !== idxRef.current) pool.push(i);
      }
      if (pool.length) nextIdx = pool[Math.floor(Math.random() * pool.length)];
    } else {
      const n = idxRef.current + 1;
      if (n < len) nextIdx = n;
      else if (repeatRef.current === 'all') nextIdx = 0;   // fin de cola → vuelve a la primera
    }

    if (nextIdx >= 0) {
      if (curQid != null) historyRef.current.push(curQid);   // orden real por _qid (para "anterior")
      playIndex(nextIdx);
    } else {
      setIsPlaying(false);                 // fin sin repetición
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

    const els = video ? [audio, video] : [audio];
    for (const el of els) {
      el.addEventListener('play',       onPlay);
      el.addEventListener('pause',      onPause);
      el.addEventListener('timeupdate', onTimeUpdate);
      el.addEventListener('ended',      onEnded);
    }
    video?.addEventListener('loadedmetadata', onVideoMeta);
    video?.addEventListener('error',          onVideoError);

    return () => {
      for (const el of els) {
        el.removeEventListener('play',       onPlay);
        el.removeEventListener('pause',      onPause);
        el.removeEventListener('timeupdate', onTimeUpdate);
        el.removeEventListener('ended',      onEnded);
      }
      video?.removeEventListener('loadedmetadata', onVideoMeta);
      video?.removeEventListener('error',          onVideoError);
    };
  }, [playNext]);

  // Keyboard: space = play/pause, ←/→ = seek 10s (sobre el elemento activo)
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if (e.code === 'ArrowRight') seek(getActive().currentTime + 10);
      if (e.code === 'ArrowLeft')  seek(getActive().currentTime - 10);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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

  const play = useCallback((tracks, startIndex = 0) => {
    // Cada entrada recibe un _qid estable (identidad interna de la cola; NO viaja a la API ni a
    // MediaSession). play() REEMPLAZA la cola entera, como antes.
    const items = tracks.map((t) => ({ ...t, _qid: ++uidRef.current }));
    queueRef.current = items;              // espejo síncrono para los callbacks
    setQueue(items);                       // estado reactivo para la UI
    playedRef.current = new Set();         // nuevo origen de cola → reinicia ciclo shuffle e historial
    historyRef.current = [];
    forcedNextRef.current = [];            // reemplazar la cola entera también limpia lo "a continuación"
    setUpNextIds([]);                      // espejo reactivo
    playIndex(startIndex);
  }, [playIndex]);

  // Encola pistas AL FINAL sin resetear. Acepta una o muchas. Si nada suena (sin pista actual),
  // arranca la reproducción con la primera agregada — si no, la acción sería invisible. Append
  // no corre índices → played/history (por _qid) no se tocan.
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
  // así vale también en shuffle). Acepta una o muchas. Nada suena → arranca. Como played/history
  // son por _qid, insertar NO remapea nada; solo se recomputa idxRef por _qid.
  const playAfterCurrent = useCallback((tracks) => {
    const list = Array.isArray(tracks) ? tracks : [tracks];
    if (!list.length) return;
    const items = list.map((t) => ({ ...t, _qid: ++uidRef.current }));
    const curQid = queueRef.current[idxRef.current]?._qid;
    const at = idxRef.current + 1;                     // idx=-1 (nada suena) → at=0
    const next = [...queueRef.current];
    next.splice(at, 0, ...items);
    queueRef.current = next;
    setQueue(next);
    if (idxRef.current < 0) {
      playIndex(at);                                  // nada sonaba → arranca con la primera insertada
    } else {
      forcedNextRef.current.unshift(...items.map((t) => t._qid));   // que suenen a continuación (incl. shuffle)
      setUpNextIds([...forcedNextRef.current]);                     // espejo reactivo para el pill
      if (curQid != null) idxRef.current = next.findIndex((t) => t._qid === curQid);  // recomputar posición actual
    }
  }, [playIndex]);

  const togglePlay = useCallback(() => {
    const el = getActive();
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  }, []);

  // "Siguiente" manual: avanza respetando shuffle/repeat, pero ignora "repetir una"
  // (pulsar siguiente debe pasar de canción, no repetir la misma).
  const next = useCallback(() => playNext(false), [playNext]);

  const prev = useCallback(() => {
    const el = getActive();
    if (el.currentTime > 3) { el.currentTime = 0; return; }
    if (shuffleRef.current && historyRef.current.length) {
      const qid = historyRef.current.pop();  // en shuffle, "anterior" = la realmente sonada antes
      const i = queueRef.current.findIndex(t => t._qid === qid);
      if (i >= 0) playIndex(i);
      return;
    }
    const p = idxRef.current - 1;
    if (p >= 0) playIndex(p);
  }, [playIndex]);

  // Salta a una pista de la cola por índice (tap en la vista de cola). Empuja el _qid actual a
  // history para que "anterior" vuelva a donde saltaste; playIndex ya marca la nueva como sonada
  // (playedRef.add(_qid)) → en shuffle el ciclo NO la vuelve a elegir.
  const jumpTo = useCallback((index) => {
    const curQid = queueRef.current[idxRef.current]?._qid;
    if (curQid != null) historyRef.current.push(curQid);
    playIndex(index);
  }, [playIndex]);

  // Quita UNA entrada de la cola por `_qid`. Es exactamente la operación para la que se eligió
  // el keying por _qid (actions-lab, "el paso 2 muerde"): como played/history/forcedNext se
  // llevan por _qid y NO por índice, quitar no remapea nada — sólo hay que recomputar idxRef
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
    playedRef.current.delete(qid);                          // ciclo de shuffle
    historyRef.current = historyRef.current.filter((h) => h !== qid);   // "anterior" no vuelve a un fantasma
    if (forcedNextRef.current.includes(qid)) {              // pill "a continuación"
      forcedNextRef.current = forcedNextRef.current.filter((f) => f !== qid);
      setUpNextIds([...forcedNextRef.current]);
    }
    if (curQid != null) idxRef.current = next.findIndex((t) => t._qid === curQid);
  }, []);

  // Mueve UNA entrada de la cola a otra posición (reorder por arrastre en desktop). Es la tercera
  // pata del trípode que habilita el keying por _qid: como played/history/forcedNext se llevan por
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
  // played/history NO se tocan a propósito: son Set/array de _qid y reordenar no agrega ni quita
  // entradas. El historial es lo que YA sonó — permutar el plan no lo reescribe.
  //
  // forcedNext SÍ: mover a mano una pista marcada "a continuación" REVOCA su marca. Sin esto el
  // arrastre mentiría — forcedNext tiene prioridad sobre el orden (playNext lo consume antes de
  // cualquier pick), así que arrastrarla al fondo la haría sonar a continuación igual. La regla
  // queda simple y explicable: si la moviste a mano, manda el orden. Simétrico con
  // removeFromQueue, y sale del ref Y de su espejo reactivo (el pill).
  //
  // En SHUFFLE el motor no mira el orden (playNext elige del pool de no-sonadas), así que reordenar
  // es cosmético: shuffle sigue activo y sólo se reacomoda lo que se ve. El aviso ya está en el
  // header de la cola ("Aleatorio · orden de la cola").
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
    const el = getActive();
    el.currentTime = Math.max(0, Math.min(time, el.duration || 0));
  }, []);

  // El volumen va a los DOS elementos: así al pasar de canción a video (o al revés) no salta.
  const setVolume = useCallback((v) => {
    getAudio().volume = v;
    if (videoRef.current) videoRef.current.volume = v;
    setVolumeState(v);
  }, []);

  const toggleShuffle = useCallback(() => {
    setShuffle((s) => {
      const v = !s;
      shuffleRef.current = v;
      if (v) {
        // al activar: arranca un ciclo nuevo dejando la actual como ya sonada (por _qid)
        const curQid = queueRef.current[idxRef.current]?._qid;
        playedRef.current = new Set(curQid != null ? [curQid] : []);
        historyRef.current = [];
      }
      return v;
    });
  }, []);

  const cycleRepeat = useCallback(() => {
    setRepeat((r) => {
      const nextMode = r === 'off' ? 'all' : r === 'all' ? 'one' : 'off';
      repeatRef.current = nextMode;
      return nextMode;
    });
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
    currentTrack, trackMeta, isPlaying, volume, queueIndex,
    shuffle, repeat,
    queue, upNext, notice,
    play, addToQueue, playAfterCurrent, removeFromQueue, moveInQueue, jumpTo, togglePlay, next, prev, seek, setVolume, toggleShuffle, cycleRepeat,
    isVideoFullscreen, enterVideoFullscreen, exitVideoFullscreen,
  }), [
    currentTrack, trackMeta, isPlaying, volume, queueIndex, shuffle, repeat, queue, upNext, notice,
    play, addToQueue, playAfterCurrent, removeFromQueue, moveInQueue, jumpTo, togglePlay, next, prev, seek, setVolume, toggleShuffle, cycleRepeat,
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
