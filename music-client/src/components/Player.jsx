import { useState, useEffect } from 'react';
import { usePlayer } from '../context/PlayerContext.jsx';
import { api, coverUrl } from '../api/client.js';
import QualityChip from './QualityChip.jsx';
import AddToPlaylistMenu from './AddToPlaylistMenu.jsx';

function fmt(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

function progressStyle(value, max) {
  const pct = max ? (value / max) * 100 : 0;
  return { background: `linear-gradient(to right, var(--accent) ${pct}%, var(--border) ${pct}%)` };
}

export default function Player() {
  const [expanded, setExpanded] = useState(false);
  const player = usePlayer();
  const { currentTrack, isPlaying, currentTime, duration, volume, togglePlay, next, prev, seek, setVolume,
          shuffle, repeat, toggleShuffle, cycleRepeat } = player;

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

  const art = currentTrack?.cover_path
    ? <img className="player-art" src={coverUrl(currentTrack.id)} alt="" />
    : <div className="player-art-placeholder">♪</div>;

  return (
    <>
      {/* ── Full-screen expanded player (mobile) ── */}
      {expanded && (
        <div className="player-expanded">
          <div className="exp-header">
            <button className="exp-back" onClick={() => setExpanded(false)}>
              <ChevronDown /> Ahora reproduciendo
            </button>
            {currentTrack && (
              <AddToPlaylistMenu trackId={currentTrack.id} className="ptp-exp" />
            )}
          </div>

          <div className="exp-art-wrap">
            {currentTrack?.cover_path
              ? <img className="exp-art" src={coverUrl(currentTrack.id)} alt="" />
              : <div className="exp-art-placeholder">♪</div>
            }
          </div>

          <div className="exp-meta">
            <div className="exp-title">{currentTrack?.title ?? 'Sin reproducción'}</div>
            <div className="exp-subline">
              <span className="exp-artist">{currentTrack?.artist ?? '—'}</span>
              <QualityChip track={quality} className="chip-lg" />
            </div>
          </div>

          <div className="exp-progress">
            <input
              type="range"
              min={0} max={duration || 0} step={0.5}
              value={currentTime}
              onChange={e => seek(Number(e.target.value))}
              style={progressStyle(currentTime, duration)}
            />
          </div>
          <div className="exp-times">
            <span>{fmt(currentTime)}</span>
            <span>{fmt(duration)}</span>
          </div>

          <div className="exp-controls">
            <button
              className={`exp-btn${shuffle ? ' active' : ''}`}
              onClick={toggleShuffle}
              aria-pressed={shuffle}
              title={`Aleatorio: ${shuffle ? 'activado' : 'desactivado'}`}
            >
              <ShuffleIcon size={24} />
            </button>
            <button className="exp-btn" onClick={prev}>
              <PrevIcon size={28} />
            </button>
            <button className="exp-btn play" onClick={togglePlay}>
              {isPlaying ? <PauseIcon size={32} /> : <PlayIcon size={32} />}
            </button>
            <button className="exp-btn" onClick={next}>
              <NextIcon size={28} />
            </button>
            <button
              className={`exp-btn${repeat !== 'off' ? ' active' : ''}`}
              onClick={cycleRepeat}
              aria-pressed={repeat !== 'off'}
              title={repeatTitle}
            >
              {repeat === 'one' ? <RepeatOneIcon size={24} /> : <RepeatIcon size={24} />}
            </button>
          </div>

          <div className="exp-volume">
            <VolumeIcon muted={volume === 0} />
            <input
              type="range"
              min={0} max={1} step={0.02}
              value={volume}
              onChange={e => setVolume(Number(e.target.value))}
              style={progressStyle(volume, 1)}
            />
          </div>
        </div>
      )}

      {/* ── Player bar (desktop full / mobile mini) ── */}
      <div className="player-bar">

        {/* Track info — tappable on mobile to open expanded */}
        <div
          className="player-track"
          onClick={() => { if (window.innerWidth <= 700) setExpanded(true); }}
        >
          {currentTrack ? (
            <>
              {art}
              <div className="player-meta">
                <div className="player-title">{currentTrack.title ?? 'Sin título'}</div>
                <div className="player-subline">
                  <span className="player-artist">{currentTrack.artist ?? 'Artista desconocido'}</span>
                  <QualityChip track={quality} className="player-quality" />
                </div>
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
            <button
              className={`ctrl-btn${shuffle ? ' active' : ''}`}
              onClick={toggleShuffle}
              aria-pressed={shuffle}
              title={`Aleatorio: ${shuffle ? 'activado' : 'desactivado'}`}
            >
              <ShuffleIcon />
            </button>
            <button className="ctrl-btn" onClick={prev} title="Anterior (←)"><PrevIcon /></button>
            <button className="ctrl-btn play" onClick={togglePlay} title="Play/Pause (Espacio)">
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button className="ctrl-btn" onClick={next} title="Siguiente (→)"><NextIcon /></button>
            <button
              className={`ctrl-btn${repeat !== 'off' ? ' active' : ''}`}
              onClick={cycleRepeat}
              aria-pressed={repeat !== 'off'}
              title={repeatTitle}
            >
              {repeat === 'one' ? <RepeatOneIcon /> : <RepeatIcon />}
            </button>
          </div>
          <div className="player-progress">
            <span className="time-label">{fmt(currentTime)}</span>
            <input
              type="range"
              min={0} max={duration || 0} step={0.5}
              value={currentTime}
              onChange={e => seek(Number(e.target.value))}
              style={progressStyle(currentTime, duration)}
            />
            <span className="time-label right">{fmt(duration)}</span>
          </div>
        </div>

        {/* Desktop: volume */}
        <div className="player-volume">
          <VolumeIcon muted={volume === 0} />
          <input
            type="range"
            min={0} max={1} step={0.02}
            value={volume}
            onChange={e => setVolume(Number(e.target.value))}
            style={progressStyle(volume, 1)}
          />
        </div>

        {/* Mobile mini controls */}
        <div className="player-mini-controls">
          <button
            className="mini-btn play-mini"
            onClick={e => { e.stopPropagation(); togglePlay(); }}
          >
            {isPlaying ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
          </button>
          <button
            className="mini-btn"
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
      <text x="12" y="15.5" textAnchor="middle" fontSize="9" fontWeight="700" fill="currentColor" stroke="none" fontFamily="system-ui, sans-serif">1</text>
    </svg>
  );
}
function ChevronDown() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="6,9 12,15 18,9"/></svg>;
}
function VolumeIcon({ muted }) {
  return muted
    ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
    : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>;
}
