import { useState, useEffect } from 'react';
import { usePlayer } from '../context/PlayerContext.jsx';
import { api, coverUrl } from '../api/client.js';
import QualityChip, { qualityCodec, qualityDetail, qualityTier, qualityTierTitle } from './QualityChip.jsx';
import AddToPlaylistMenu from './AddToPlaylistMenu.jsx';
import LyricsPanel from './LyricsPanel.jsx';
import InfoPanel from './InfoPanel.jsx';

function fmt(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

function progressStyle(value, max) {
  const pct = max ? (value / max) * 100 : 0;
  return { background: `linear-gradient(to right, var(--accent) ${pct}%, var(--border) ${pct}%)` };
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

export default function Player({ navigate }) {
  // `navigate(view, target)` disponible para navegar desde la barra. Aún NO se
  // usa (los onClick de portada/artista/género/canción llegan en pasos 3-5).
  const [expanded, setExpanded] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [shufflePhrase, setShufflePhrase] = useState('');
  const [shuffleSpin, setShuffleSpin] = useState(false);
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

  // La portada abre la vista "Ahora reproduciendo" (también en desktop). Lleva
  // stopPropagation porque .player-track tiene su propio onClick (abrir en móvil):
  // el clic en la portada no debe disparar ambos. Inerte si no hay pista.
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
  // Calidad partida: códec para el badge + resto del detalle como texto gris.
  // El color/caja del badge refleja el tier (hi-res / lossless / lossy…).
  const qCodec = qualityCodec(quality);
  const qDetail = qualityDetail(quality);
  const qTier = qualityTier(quality);

  // Elige una frase distinta a la anterior en cada hover del shuffle.
  const pickShufflePhrase = () => setShufflePhrase(prev => {
    if (SHUFFLE_PHRASES.length < 2) return SHUFFLE_PHRASES[0];
    let p = prev;
    while (p === prev) p = SHUFFLE_PHRASES[Math.floor(Math.random() * SHUFFLE_PHRASES.length)];
    return p;
  });

  return (
    <>
      {/* ── Panel de letra (overlay, desktop y móvil) ── */}
      {showLyrics && <LyricsPanel onClose={() => setShowLyrics(false)} />}

      {/* ── Panel de información de la pista (modal) ── */}
      {showInfo && <InfoPanel track={quality ?? currentTrack} onClose={() => setShowInfo(false)} />}

      {/* ── Full-screen expanded player (mobile) ── */}
      {expanded && (
        <div className="player-expanded">
          <div className="exp-header">
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
              <QualityChip track={quality} format="full" className="chip-lg" />
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
            <VolumeIcon muted={volume === 0} color={volumeColor(volume)} />
            <input
              type="range"
              min={0} max={1} step={0.02}
              value={volume}
              onChange={e => setVolume(Number(e.target.value))}
              style={volumeFillStyle(volume)}
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
                <div className="player-artist">
                  {currentTrack.artist ?? 'Artista desconocido'}
                  {genre && (
                    <>
                      <span className="player-genre"> · </span>
                      <span
                        className="player-genre player-genre-link"
                        onClick={(e) => { e.stopPropagation(); navigate('genres', { genre }); }}
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
                onClick={() => { toggleShuffle(); setShuffleSpin(true); }}
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
            <SeekBar value={currentTime} max={duration} playing={isPlaying} onSeek={seek} />
            <span className="time-label right">{fmt(duration)}</span>
          </div>
        </div>

        {/* Desktop: acciones (letra, info) + volumen */}
        <div className="player-actions">
          <button
            className={`action-btn lyrics-btn${showLyrics ? ' active' : ''}`}
            onClick={() => setShowLyrics(v => !v)}
            aria-pressed={showLyrics}
            title="Letra"
          >
            <LyricsGlyph />
          </button>
          <button
            className={`action-btn info-btn${showInfo ? ' active' : ''}`}
            onClick={() => setShowInfo(v => !v)}
            aria-pressed={showInfo}
            disabled={!currentTrack}
            title="Información de la pista"
          >
            <InfoIcon />
          </button>
          <div className="player-volume">
            <VolumeIcon muted={volume === 0} color={volumeColor(volume)} />
            <input
              type="range"
              min={0} max={1} step={0.02}
              value={volume}
              onChange={e => setVolume(Number(e.target.value))}
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
    <div className="seek" style={{ '--seek-pct': `${pct}%` }}>
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
