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
  const queueRef    = useRef([]);   // stable refs for event callbacks
  const idxRef      = useRef(-1);
  const metaCacheRef = useRef(new Map());   // memo id→trackMeta resuelto (evita re-fetch por reproducción)

  // Modos de reproducción. Se duplican en refs porque el callback 'ended' del
  // <audio> se registra una vez y necesita leer el valor actual, no el del montaje.
  const shuffleRef  = useRef(false);
  const repeatRef   = useRef('off');         // 'off' | 'all' | 'one'
  const playedRef   = useRef(new Set());     // índices ya sonados en el ciclo de shuffle
  const historyRef  = useRef([]);            // orden real de reproducción (para "anterior" en shuffle)

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
    playedRef.current.add(idx);            // marca como sonada (regla shuffle sin repetir)
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

    let nextIdx = -1;
    if (shuffleRef.current && len > 1) {
      // candidatas: las que aún no han sonado en este ciclo (sin la actual)
      let pool = [];
      for (let i = 0; i < len; i++) {
        if (i !== idxRef.current && !playedRef.current.has(i)) pool.push(i);
      }
      // ciclo agotado: si repetimos la cola, reinicia el ciclo (conserva la actual como sonada)
      if (pool.length === 0 && repeatRef.current === 'all') {
        playedRef.current = new Set(idxRef.current >= 0 ? [idxRef.current] : []);
        for (let i = 0; i < len; i++) if (i !== idxRef.current) pool.push(i);
      }
      if (pool.length) nextIdx = pool[Math.floor(Math.random() * pool.length)];
    } else {
      const n = idxRef.current + 1;
      if (n < len) nextIdx = n;
      else if (repeatRef.current === 'all') nextIdx = 0;   // fin de cola → vuelve a la primera
    }

    if (nextIdx >= 0) {
      historyRef.current.push(idxRef.current);
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
    queueRef.current = tracks;
    playedRef.current = new Set();         // nuevo origen de cola → reinicia ciclo shuffle e historial
    historyRef.current = [];
    playIndex(startIndex);
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
      playIndex(historyRef.current.pop());   // en shuffle, "anterior" = la realmente sonada antes
      return;
    }
    const p = idxRef.current - 1;
    if (p >= 0) playIndex(p);
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
        // al activar: arranca un ciclo nuevo dejando la actual como ya sonada
        playedRef.current = new Set(idxRef.current >= 0 ? [idxRef.current] : []);
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
      queue: queueRef.current,
      play, togglePlay, next, prev, seek, setVolume, toggleShuffle, cycleRepeat,
    }}>
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  return useContext(PlayerContext);
}
