import { memo, useEffect, useRef } from 'react';
import { coverUrl } from '../api/client.js';
import { usePlayer } from '../context/PlayerContext.jsx';

// Vista de cola — overlay del player (dirección A "Lista de sala" + eq-bars/progreso de B).
// SOLO lectura + salto: sonó / suena / viene, la actual marcada, tap salta a la fila. SIN
// reorder ni quitar (paso posterior, con el menú contextual).

// Barra de progreso de la pista actual, AISLADA en su propio nodo: consume currentTime/duration
// (cambian ~4 Hz). Al re-renderizarse por cada tick, SOLO se re-pinta ella — las filas de la cola
// (memoizadas, con props estables por tick) NO se re-renderizan (cuidado 3: sin jank en 50 pistas).
function NowPlayingProgress() {
  const { currentTime, duration } = usePlayer();
  const pct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  return (
    <div className="queue-progress" aria-hidden="true">
      <div className="queue-progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

// Ecualizador decorativo sobre la carátula de la actual. Static bajo reduced-motion (CSS).
function EqBars() {
  return <span className="queue-eq" aria-hidden="true"><i /><i /><i /></span>;
}

function fmt(s) {
  if (s == null) return '';
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${ss}`;
}

// Fila memoizada. Sus props son valores ESTABLES por tick (track: misma ref; zone/isCurrent:
// mismo valor salvo que cambie la actual; isUpNext: booleano; onJump: useCallback estable) →
// en cada tick de progreso la fila NO se re-renderiza. Solo cambia cuando su estado real cambia.
const QueueRow = memo(function QueueRow({ track, index, zone, isCurrent, isUpNext, onJump }) {
  return (
    <li
      className={`queue-row queue-${zone}${isCurrent ? ' current' : ''}`}
      onClick={() => onJump(index)}
      title="Reproducir esta pista"
    >
      <span className="queue-cover">
        {track.cover_path
          ? <img src={coverUrl(track.id)} alt="" loading="lazy" />
          : <span className="queue-cover-ph">♪</span>}
        {isCurrent && <EqBars />}
        <span className="queue-play" aria-hidden="true">▶</span>
      </span>
      <span className="queue-text">
        <span className="queue-title">
          <span className="queue-title-name">{track.title ?? 'Sin título'}</span>
          {isUpNext && <span className="queue-pill">a continuación</span>}
        </span>
        <span className="queue-artist">{track.artist ?? '—'}</span>
      </span>
      <span className="queue-dur">{fmt(track.duration)}</span>
      {isCurrent && <NowPlayingProgress />}
    </li>
  );
});

export default function QueueOverlay({ onClose }) {
  const { queue, queueIndex, currentTrack, shuffle, upNext, jumpTo } = usePlayer();
  const hasCover = !!currentTrack?.cover_path;
  const bodyRef = useRef(null);

  // Auto-scroll: al cambiar la pista actual, llevar la fila marcada a la vista. Dep [queueIndex]
  // (NO currentTime) → no corre en cada tick del progreso. Vía querySelector sobre el DOM: NO
  // agrega props a las QueueRow memoizadas → el aislamiento del re-render del progreso (cuidado 3)
  // queda intacto. block:'nearest' no salta si la fila ya está visible; reduced-motion → sin animar.
  useEffect(() => {
    const row = bodyRef.current?.querySelector('.queue-row.current');
    if (!row) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    row.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }, [queueIndex]);

  return (
    <div className="queue-panel">
      {/* Fondo: carátula actual difuminada (como Letra); si no hay, queda el glass sólido. */}
      {hasCover && (
        <div
          className="queue-bg"
          style={{ backgroundImage: `url(${coverUrl(currentTrack.id)})` }}
          aria-hidden="true"
        />
      )}
      <div className="queue-header">
        <div className="queue-head-text">
          <span className="queue-kicker">
            En cola · {queue.length} {queue.length === 1 ? 'pista' : 'pistas'}
          </span>
          {shuffle && (
            <span className="queue-shuf" title="En aleatorio, el orden real de reproducción no sigue esta lista">
              ⇄ Aleatorio · orden de la cola
            </span>
          )}
        </div>
        <button className="queue-close" onClick={onClose} title="Cerrar cola" aria-label="Cerrar cola">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className="queue-body" ref={bodyRef}>
        {queue.length === 0 ? (
          <div className="queue-empty">
            <div className="queue-empty-icon">♪</div>
            <div>La cola está vacía</div>
          </div>
        ) : (
          <ul className="queue-list">
            {queue.map((t, i) => (
              <QueueRow
                key={t._qid}
                track={t}
                index={i}
                zone={i < queueIndex ? 'played' : i > queueIndex ? 'coming' : 'now'}
                isCurrent={i === queueIndex}
                isUpNext={upNext.has(t._qid)}
                onJump={jumpTo}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
