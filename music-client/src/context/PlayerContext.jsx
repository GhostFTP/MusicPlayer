import {
  createContext, useContext, useRef, useState, useEffect, useCallback,
} from 'react';
import { streamUrl, coverUrl } from '../api/client.js';
import { resolveTrackMeta, isComplete } from '../utils/trackMeta.js';
import { useAuth } from './AuthContext.jsx';

const PlayerContext = createContext(null);

// Acciones de MediaSession que cableamos. Se listan aparte para poder desregistrarlas
// todas en el cleanup sin repetir la lista.
const MEDIA_ACTIONS = [
  'play', 'pause', 'previoustrack', 'nexttrack',
  'seekto', 'seekbackward', 'seekforward', 'stop',
];

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

  // Lazy-init audio element once (avoids SSR issues and StrictMode double-mount)
  function getAudio() {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.volume = 1;
    }
    return audioRef.current;
  }

  const playIndex = useCallback((idx) => {
    const track = queueRef.current[idx];
    if (!track) return;
    idxRef.current = idx;
    playedRef.current.add(track._qid);     // marca como sonada por _qid (regla shuffle sin repetir)
    setCurrentTrack(track);
    const audio = getAudio();
    audio.src = streamUrl(track.id);
    // Reflejar YA el reset del elemento: hasta el primer 'timeupdate' de la pista
    // nueva, la UI (letra sincronizada, tiempos) veía el tiempo de la ANTERIOR.
    setCurrentTime(0);
    setDuration(0);
    audio.play().catch(() => {});
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

  useEffect(() => {
    const audio = getAudio();

    const onPlay      = () => setIsPlaying(true);
    const onPause     = () => setIsPlaying(false);
    const onTimeUpdate= () => {
      setCurrentTime(audio.currentTime);
      setDuration(isFinite(audio.duration) ? audio.duration : 0);
    };
    const onEnded = () => playNext(true);

    audio.addEventListener('play',       onPlay);
    audio.addEventListener('pause',      onPause);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended',      onEnded);

    return () => {
      audio.removeEventListener('play',       onPlay);
      audio.removeEventListener('pause',      onPause);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended',      onEnded);
    };
  }, [playNext]);

  // Keyboard: space = play/pause, ←/→ = seek 10s
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if (e.code === 'ArrowRight') seek(getAudio().currentTime + 10);
      if (e.code === 'ArrowLeft')  seek(getAudio().currentTime - 10);
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
    const audio = getAudio();
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }, []);

  // "Siguiente" manual: avanza respetando shuffle/repeat, pero ignora "repetir una"
  // (pulsar siguiente debe pasar de canción, no repetir la misma).
  const next = useCallback(() => playNext(false), [playNext]);

  const prev = useCallback(() => {
    const audio = getAudio();
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
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

  const seek = useCallback((time) => {
    const audio = getAudio();
    audio.currentTime = Math.max(0, Math.min(time, audio.duration || 0));
  }, []);

  const setVolume = useCallback((v) => {
    getAudio().volume = v;
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
    const meta = trackMeta?.id === currentTrack.id ? trackMeta : currentTrack;
    // Hueco de reauth (token=null un instante): emitimos SIN artwork en vez de mandar
    // `?token=null`, que 404ea en el lockscreen. Al llegar el token nuevo, este efecto
    // vuelve a correr y re-emite con la URL fresca.
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
    set('play',          () => { getAudio().play().catch(() => {}); });
    set('pause',         () => getAudio().pause());
    set('previoustrack', () => prev());
    set('nexttrack',     () => next());
    set('seekto',        (d) => { if (d?.seekTime != null) seek(d.seekTime); });   // seek() clampa
    set('seekbackward',  (d) => seek(getAudio().currentTime - (d?.seekOffset ?? 10)));
    set('seekforward',   (d) => seek(getAudio().currentTime + (d?.seekOffset ?? 10)));
    set('stop',          () => { getAudio().pause(); seek(0); });
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

  const queueIndex = idxRef.current;

  return (
    <PlayerContext.Provider value={{
      currentTrack, trackMeta, isPlaying, currentTime, duration, volume, queueIndex,
      shuffle, repeat,
      queue, upNext: new Set(upNextIds),   // _qid "a continuación" desde ESTADO (reactivo); forcedNextRef sigue siendo la verdad del motor
      play, addToQueue, playAfterCurrent, jumpTo, togglePlay, next, prev, seek, setVolume, toggleShuffle, cycleRepeat,
    }}>
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  return useContext(PlayerContext);
}
