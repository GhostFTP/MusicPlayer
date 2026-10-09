import { useEffect, useRef, useState } from 'react';

// Controles del video en PANTALLA COMPLETA (T27). Se montan DENTRO del envoltorio .player-video-layer
// (PlayerContext), que es lo que está en pantalla completa: lo que viva fuera de él no se ve, por eso
// también el aviso de error del motor se pinta acá. Sólo existen mientras el envoltorio está en
// pantalla completa; con el reproductor nativo del iPhone (webkitEnterFullscreen) no se montan.
//
// Todo llega por props desde el provider: este archivo NO importa PlayerContext (lo monta él, y
// usePlayer desde acá cerraría un ciclo de imports).
//
// · Auto-ocultado a los IDLE_MS sin mover el puntero, tocar ni apretar una tecla; con pausa no se
//   ocultan. Ocultos, el cursor también desaparece (clase vfs-idle en el envoltorio).
// · El clic sobre el FONDO (play/pausa) y el doble clic (salir) los maneja el envoltorio y sólo
//   cuentan con target === envoltorio: un clic en estos controles no los dispara.
// · Espacio con un botón enfocado: el botón ya se activa solo; si además llegara al keydown global
//   de PlayerContext alternaría dos veces. Se corta acá (el listener de React está en #root, antes
//   que window).
const IDLE_MS   = 2500;
const NOTICE_MS = 4000;

export default function VideoFullscreenControls({
  layerRef, track, isPlaying, currentTime, duration, notice,
  onToggle, onPrev, onNext, onSeek, onExit,
}) {
  const rootRef = useRef(null);
  const timer   = useRef(0);
  const [idle, setIdle] = useState(false);
  const wakeRef = useRef(null);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return undefined;
    const wake = () => {
      setIdle(false);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setIdle(true), IDLE_MS);
    };
    wakeRef.current = wake;
    wake();
    layer.addEventListener('pointermove', wake);
    layer.addEventListener('pointerdown', wake);
    document.addEventListener('keydown', wake, true);   // captura: Espacio sobre un botón corta la propagación
    return () => {
      clearTimeout(timer.current);
      layer.removeEventListener('pointermove', wake);
      layer.removeEventListener('pointerdown', wake);
      document.removeEventListener('keydown', wake, true);
    };
  }, [layerRef]);

  // Pausar o reanudar también cuenta como actividad (si no, al reanudar se esconderían de golpe).
  useEffect(() => { wakeRef.current?.(); }, [isPlaying]);

  const hidden = idle && isPlaying;
  useEffect(() => {
    const layer = layerRef.current;
    layer?.classList.toggle('vfs-idle', hidden);
    return () => layer?.classList.remove('vfs-idle');
  }, [hidden, layerRef]);

  // Foco a la capa al entrar: el teclado (Tab, Espacio, flechas) arranca acá y no en el expandido de abajo.
  useEffect(() => { rootRef.current?.focus({ preventScroll: true }); }, []);

  // Aviso del motor ("No se pudo reproducir el video…"): sólo los que llegan con la capa montada.
  const firstNotice = useRef(notice);
  const [shownNotice, setShownNotice] = useState(null);
  useEffect(() => {
    if (!notice || notice === firstNotice.current) return undefined;
    setShownNotice(notice.text);
    const t = setTimeout(() => setShownNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  const onKeyDown = (e) => {
    if (e.code === 'Space' && e.target.closest?.('button')) e.stopPropagation();
  };

  const pct = duration ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  return (
    <>
      <div
        ref={rootRef}
        className={`vfs${hidden ? ' vfs--hidden' : ''}`}
        role="group"
        aria-label="Controles del video"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="vfs-top">
          <div className="vfs-meta">
            <div className="vfs-title">{track?.title || 'Sin título'}</div>
            <div className="vfs-artist">{track?.artist || 'Artista desconocido'}</div>
          </div>
          <button className="vfs-btn vfs-exit" onClick={onExit} aria-label="Salir de pantalla completa" title="Salir de pantalla completa (Esc)">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="9,4 9,9 4,9" /><polyline points="20,9 15,9 15,4" />
              <polyline points="15,20 15,15 20,15" /><polyline points="4,15 9,15 9,20" />
            </svg>
          </button>
        </div>

        <div className="vfs-bottom">
          {/* Mismo markup y clases que el SeekBar del reproductor (Player.jsx), que no se importa
              para no cerrar un ciclo PlayerContext → acá → Player → PlayerContext. */}
          <div className="seek vfs-seek" style={{ '--seek-pct': `${pct}%` }}>
            <div className="seek-fill" />
            <input
              type="range"
              min={0} max={duration || 0} step={0.5}
              value={currentTime}
              onChange={(e) => onSeek(Number(e.target.value))}
              aria-label="Posición del video"
              aria-valuetext={`${fmt(currentTime)} de ${fmt(duration)}`}
            />
          </div>
          <div className="vfs-row">
            <span className="vfs-time">{fmt(currentTime)} / {fmt(duration)}</span>
            <div className="vfs-ctrls">
              <button className="vfs-btn" onClick={onPrev} aria-label="Anterior" title="Anterior">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="19,20 9,12 19,4" /><line x1="5" y1="4" x2="5" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>
              </button>
              <button className="vfs-btn vfs-play" onClick={onToggle} aria-label={isPlaying ? 'Pausar' : 'Reproducir'} title={isPlaying ? 'Pausar' : 'Reproducir'}>
                {isPlaying
                  ? <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                  : <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5,3 19,12 5,21" /></svg>}
              </button>
              <button className="vfs-btn" onClick={onNext} aria-label="Siguiente" title="Siguiente">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5,4 15,12 5,20" /><line x1="19" y1="4" x2="19" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>
              </button>
            </div>
            <span className="vfs-spacer" aria-hidden="true" />
          </div>
        </div>
      </div>
      {shownNotice && <div className="vfs-notice" role="status">{shownNotice}</div>}
    </>
  );
}

function fmt(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}
