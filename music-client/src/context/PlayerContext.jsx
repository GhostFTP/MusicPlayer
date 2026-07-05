import {
  createContext, useContext, useRef, useState, useEffect, useCallback,
} from 'react';
import { streamUrl } from '../api/client.js';

const PlayerContext = createContext(null);

export function PlayerProvider({ children }) {
  const audioRef    = useRef(null);
  const queueRef    = useRef([]);   // stable refs for event callbacks
  const idxRef      = useRef(-1);

  // Modos de reproducción. Se duplican en refs porque el callback 'ended' del
  // <audio> se registra una vez y necesita leer el valor actual, no el del montaje.
  const shuffleRef  = useRef(false);
  const repeatRef   = useRef('off');         // 'off' | 'all' | 'one'
  const playedRef   = useRef(new Set());     // índices ya sonados en el ciclo de shuffle
  const historyRef  = useRef([]);            // orden real de reproducción (para "anterior" en shuffle)

  const [currentTrack, setCurrentTrack] = useState(null);
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

  const queueIndex = idxRef.current;

  return (
    <PlayerContext.Provider value={{
      currentTrack, isPlaying, currentTime, duration, volume, queueIndex,
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
