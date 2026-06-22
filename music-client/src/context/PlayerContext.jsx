import {
  createContext, useContext, useRef, useState, useEffect, useCallback,
} from 'react';
import { streamUrl } from '../api/client.js';

const PlayerContext = createContext(null);

export function PlayerProvider({ children }) {
  const audioRef    = useRef(null);
  const queueRef    = useRef([]);   // stable refs for event callbacks
  const idxRef      = useRef(-1);

  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying,    setIsPlaying]    = useState(false);
  const [currentTime,  setCurrentTime]  = useState(0);
  const [duration,     setDuration]     = useState(0);
  const [volume,       setVolumeState]  = useState(1);

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
    setCurrentTrack(track);
    const audio = getAudio();
    audio.src = streamUrl(track.id);
    audio.play().catch(() => {});
  }, []);

  useEffect(() => {
    const audio = getAudio();

    const onPlay      = () => setIsPlaying(true);
    const onPause     = () => setIsPlaying(false);
    const onTimeUpdate= () => {
      setCurrentTime(audio.currentTime);
      setDuration(isFinite(audio.duration) ? audio.duration : 0);
    };
    const onEnded = () => {
      const next = idxRef.current + 1;
      if (next < queueRef.current.length) playIndex(next);
      else setIsPlaying(false);
    };

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
  }, [playIndex]);

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
    playIndex(startIndex);
  }, [playIndex]);

  const togglePlay = useCallback(() => {
    const audio = getAudio();
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }, []);

  const next = useCallback(() => {
    const n = idxRef.current + 1;
    if (n < queueRef.current.length) playIndex(n);
  }, [playIndex]);

  const prev = useCallback(() => {
    const audio = getAudio();
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
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

  const queueIndex = idxRef.current;

  return (
    <PlayerContext.Provider value={{
      currentTrack, isPlaying, currentTime, duration, volume, queueIndex,
      queue: queueRef.current,
      play, togglePlay, next, prev, seek, setVolume,
    }}>
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  return useContext(PlayerContext);
}
