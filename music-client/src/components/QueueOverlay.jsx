import { memo, useCallback, useEffect, useRef } from 'react';
import { coverUrl } from '../api/client.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useContextMenu } from './ContextMenu.jsx';
import { useLongPress } from '../utils/useLongPress.js';

// Vista de cola — overlay del player (dirección A "Lista de sala" + eq-bars/progreso de B).
// Lectura + salto: sonó / suena / viene, la actual marcada, tap salta a la fila. El clic DERECHO
// abre el menú contextual con las acciones propias de la cola (quitar, ir a artista/álbum, info).
// D1 · REORDER por arrastre, sólo en DESKTOP (ver el bloque de gesto abajo).

// px de movimiento vertical que declaran "esto es un arrastre, no un click". Por DEBAJO de
// AXIS_DIST (12, el umbral con el que Player fija eje) porque acá no compite con ningún otro
// gesto: en desktop el long-press no arma y el arrastre de la hoja es móvil. Alcanza con que un
// click tembloroso (<3px de jerk del mouse) nunca se cuele como reorder.
const DRAG_START = 6;

// D3 · Autoscroll de bordes. Sin esto el reorden sólo alcanza lo VISIBLE: en una cola de ~650
// pistas no hay manera de llevar la 400 a la 3.
const EDGE_ZONE  = 56;     // px de franja sensible arriba y abajo del cuerpo scrolleable
const EDGE_V_MAX = 1600;   // px/s pegado al borde (~30 filas/s). Más rápido se vuelve incontrolable

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
// mismo valor salvo que cambie la actual; isUpNext: booleano; onJump/onCtx: useCallback estables)
// → en cada tick de progreso la fila NO se re-renderiza. Solo cambia cuando su estado real cambia.
const QueueRow = memo(function QueueRow({ track, index, zone, isCurrent, isUpNext, onJump, onCtx }) {
  // C1 · long-press = menú también acá. El hook devuelve handlers estables (el callback viaja por
  // ref), así que la memoización de la fila queda intacta: sigue sin re-renderizarse por tick.
  //
  // No choca con los arrastres de la hoja: onQueueDragDown (Player.jsx) sólo arma sobre
  // '.queue-header, .exp-drawer-grabber' y el pointerdown de una fila cae ahí por burbujeo y SALE
  // sin capturar el puntero. El cuerpo de la lista scrollea nativo, y ese scroll manda un
  // pointercancel que apaga el timer del long-press — la colisión se resuelve sola.
  const bindPress = useLongPress((t, ev) => onCtx(ev, t, isCurrent, 'longpress'));
  return (
    <li
      className={`queue-row queue-${zone}${isCurrent ? ' current' : ''}`}
      data-qid={track._qid}
      {...bindPress(track, {
        onClick: () => onJump(index),
        onContextMenu: (e) => onCtx(e, track, isCurrent),
      })}
      title="Reproducir esta pista"
    >
      <span className="queue-num">{index + 1}</span>
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
  const { queue, queueIndex, currentTrack, shuffle, upNext, jumpTo, moveInQueue } = usePlayer();
  const { openMenu } = useContextMenu();
  const hasCover = !!currentTrack?.cover_path;
  const bodyRef = useRef(null);

  // ── D1 · Reorder por arrastre (DESKTOP-ONLY) ────────────────────────────────────────────────
  //
  // Patrón de la casa, sin librerías (regla dura #9 de actions-lab): pointer events + captura +
  // umbral + cancelación limpia, calcado de onGrabberDown/onQueueDragDown (Player.jsx). Como en el
  // arrastre de la hoja móvil, los handlers van en el CONTENEDOR (el <ul>) y se filtra por target:
  // así las filas memoizadas no reciben ni una prop nueva.
  //
  // Durante el gesto NO se pasa por React: los transforms y las marcas se escriben DIRECTO sobre
  // los nodos (mismo permiso que se toma el auto-scroll de abajo). Si el estado del drag viviera en
  // un useState, cada frame re-renderizaría las ~650 filas y tiraría abajo la memoización que este
  // archivo cuida (cuidado 3). React se entera UNA vez: al soltar, vía moveInQueue.
  //
  // Gate por ANCHO en el pointerdown, igual que onGrabberDown (Player.jsx) — nunca por pointerType
  // (criterio de régimen de mobile-lab). En móvil las filas NO se vuelven arrastrables: ahí la cola
  // es la hoja del drawer y su gesto (subir/bajar) queda intacto.
  const dragRef    = useRef(null);    // gesto en curso (null = ninguno)
  const didDragRef = useRef(false);   // este gesto arrastró → su click NO salta de pista

  // Marca dónde caería: línea de 2px sobre la fila destino. Hacia abajo cae DESPUÉS de la que hoy
  // ocupa ese índice; hacia arriba, ANTES (la convención splice-remove-then-insert de moveInQueue).
  // Se recuerda la fila marcada (`d.marked`) en vez de barrer la lista entera: con el autoscroll
  // corriendo el destino cambia ~30 veces por segundo, y limpiar las ~650 filas en cada cambio
  // serían decenas de miles de classList por segundo. Así son dos toques de DOM por cambio.
  const paintDrop = (d, to) => {
    if (d.marked) {
      d.marked.classList.remove('queue-row--drop-before', 'queue-row--drop-after');
      d.marked = null;
    }
    if (to === d.index) return;                                  // vuelve a su sitio: sin marca
    d.marked = d.rows[to];
    d.marked.classList.add(to > d.index ? 'queue-row--drop-after' : 'queue-row--drop-before');
  };

  // Pinta el estado del arrastre. El desplazamiento se mide en COORDENADAS DE CONTENIDO, no de
  // pantalla: dy = (puntero recorrido) + (lo que scrolleó la lista debajo). Esa suma es la clave de
  // D3 y hace las dos cosas de una:
  //  · el transform deja la fila pegada al puntero — al desarrollar la posición visual, los dos
  //    scrollTop se cancelan y queda `rowTop0 + (lastY - y0)`, o sea sigue al dedo y NADA más;
  //  · el índice destino sí incorpora el scroll, que es exactamente lo que permite pasar de la
  //    posición 400 a la 3: el destino se recalcula con las filas que van apareciendo.
  // Con scroll quieto (scrollTop === top0) se reduce a lo de D1 — es compatible hacia atrás.
  const updateDrag = (d) => {
    const dy = (d.lastY - d.y0) + (d.body.scrollTop - d.top0);
    d.row.style.transform = `translateY(${dy}px)`;
    const to = Math.max(0, Math.min(d.index + Math.round(dy / d.h), d.rows.length - 1));
    if (to !== d.to) { d.to = to; paintDrop(d, to); }
  };

  // Velocidad del autoscroll según cuánto penetró el puntero en la franja. Cuadrática: control fino
  // al entrar, velocidad alta al pegarse al borde. El rect va CACHEADO desde el pointerdown (el
  // cuerpo no cambia de tamaño a mitad de arrastre), así que el loop no lee layout ni un solo frame
  // — sólo escribe scrollTop y transform. Es lo que lo mantiene sin jank.
  // Puntero FUERA del cuerpo (arriba del header o debajo del borde) → p se clampea a 1: máxima
  // velocidad, en vez de un número disparatado.
  const edgeVelocity = (d) => {
    const toTop = d.lastY - d.rect.top;
    const toBot = d.rect.bottom - d.lastY;
    const ramp  = (p) => EDGE_V_MAX * Math.min(1, Math.max(0, p)) ** 2;
    // Si el cuerpo es más bajo que las dos franjas juntas (drawer chico en una pantalla baja) se
    // solapan: gana el borde MÁS CERCANO, en vez de que "arriba" se quede siempre con el gesto.
    if (toTop < EDGE_ZONE && toTop <= toBot) return -ramp(1 - toTop / EDGE_ZONE);
    if (toBot < EDGE_ZONE) return  ramp(1 - toBot / EDGE_ZONE);
    return 0;
  };

  // Un frame de autoscroll. Se detiene solo al tocar el tope o el fondo (chequeo explícito, no por
  // "scrollTop no cambió", que con velocidades bajas daría un falso positivo por redondeo).
  const autoTick = (t) => {
    const d = dragRef.current;
    if (!d || !d.auto.vy) { if (d) d.auto.raf = 0; return; }   // el drag terminó → no re-agendar
    const dt = Math.min((t - d.auto.lastT) / 1000, 0.05);   // clamp: si el tab estuvo dormido, no saltar
    d.auto.lastT = t;
    const cur = d.body.scrollTop;
    // Tope/fondo contra el máximo cacheado en el pointerdown: la cola no muta durante el arrastre,
    // así que el loop no vuelve a leer scrollHeight/clientHeight ni un frame.
    if ((d.auto.vy < 0 && cur <= 0) || (d.auto.vy > 0 && cur >= d.maxScroll - 1)) {
      d.auto.vy = 0; d.auto.raf = 0; return;
    }
    d.body.scrollTop = cur + d.auto.vy * dt;
    updateDrag(d);                                      // el marcador de drop NO se congela
    d.auto.raf = requestAnimationFrame(autoTick);
  };

  const setAutoScroll = (d, vy) => {
    d.auto.vy = vy;
    if (vy && !d.auto.raf) {
      d.auto.lastT = performance.now();                 // misma base de tiempo que el timestamp de rAF
      d.auto.raf = requestAnimationFrame(autoTick);
    } else if (!vy && d.auto.raf) {
      cancelAnimationFrame(d.auto.raf);
      d.auto.raf = 0;
    }
  };

  // Deja el DOM como estaba. SIEMPRE antes de moveInQueue: React reusa los <li> por su key (_qid)
  // y no controla `style`, así que un transform inline sin limpiar quedaría pegado tras el reorder.
  // Corta el rAF acá: es el único camino de salida (pointerup, cancel, captura perdida y desmontaje
  // pasan todos por acá), así que no queda ningún loop colgado.
  const endDrag = useCallback(() => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    if (d.auto.raf) cancelAnimationFrame(d.auto.raf);
    d.auto.raf = 0; d.auto.vy = 0;
    d.row.style.transform = '';
    d.row.classList.remove('queue-row--dragging');
    d.list.classList.remove('queue-dragging');
    d.marked?.classList.remove('queue-row--drop-before', 'queue-row--drop-after');
    try { d.list.releasePointerCapture(d.id); } catch { /* ya liberada */ }
  }, []);

  const onListPointerDown = (e) => {
    didDragRef.current = false;                                   // gesto nuevo → guard limpio
    if (e.button !== 0) return;                                   // el clic DERECHO es el menú
    if (!window.matchMedia('(min-width: 701px)').matches) return;  // desktop-only
    if (e.target.closest?.('button, a, input, [role="button"]')) return;
    const row = e.target.closest?.('.queue-row');
    if (!row) return;
    const list = e.currentTarget;
    const rows = Array.from(list.children);
    const index = rows.indexOf(row);
    if (index < 0) return;
    if (!row.offsetHeight) return;   // alto 0 (fila oculta): dy/h daría NaN y el destino se iría a undefined
    const body = bodyRef.current;
    if (!body) return;
    // Paso entre filas medido del DOM REAL, no hardcodeado. Son de alto uniforme: lo manda la
    // carátula (38px + padding), el título va nowrap y el pill no la supera.
    // `top0` es el scroll de partida y `rect` la caja del cuerpo, los dos leídos UNA vez acá para
    // que ni el move ni el loop de autoscroll toquen layout.
    dragRef.current = {
      id: e.pointerId, qid: Number(row.dataset.qid),
      list, row, rows, index, to: index, body,
      y0: e.clientY, lastY: e.clientY, top0: body.scrollTop,
      rect: body.getBoundingClientRect(),
      maxScroll: body.scrollHeight - body.clientHeight,
      h: row.offsetHeight, active: false, marked: null,
      auto: { raf: 0, vy: 0, lastT: 0 },
    };
  };

  const onListPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    d.lastY = e.clientY;                                          // el loop de autoscroll lo reusa
    if (!d.active) {
      if (Math.abs(e.clientY - d.y0) < DRAG_START) return;        // aún indeciso: puede ser un click
      d.active = true;
      didDragRef.current = true;
      try { d.list.setPointerCapture(d.id); } catch { /* noop */ }
      d.list.classList.add('queue-dragging');
      d.row.classList.add('queue-row--dragging');
    }
    updateDrag(d);
    setAutoScroll(d, edgeVelocity(d));                            // entrar/salir de la franja de borde
  };

  const onListPointerUp = () => {
    const d = dragRef.current;
    if (!d) return;
    const { active, qid, to, index } = d;
    endDrag();                                                    // limpiar el DOM ANTES del commit
    if (active && to !== index) moveInQueue(qid, to);
  };

  // El click que sigue a un arrastre no debe saltar de pista. Se traga en fase de CAPTURA sobre el
  // <ul> (corre antes del onClick de la fila, y no depende de dónde re-targetee la captura), no con
  // un preventDefault en el pointerdown que mataría el scroll — mismo criterio que useLongPress.
  const onListClickCapture = (e) => {
    if (!didDragRef.current) return;
    didDragRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  useEffect(() => endDrag, [endDrag]);   // desmontar a mitad de gesto no deja el DOM sucio

  // Estable (openMenu es un useCallback sin deps) → las QueueRow memoizadas siguen sin
  // re-renderizarse en cada tick del progreso. `isCurrent` viaja en el payload porque la cola
  // admite DUPLICADOS: la identidad de una fila es su `_qid`, no el id de la pista.
  // `via` lo manda el long-press de móvil (C1) y es lo único que distingue las dos puertas: sin él
  // openMenu descarta el móvil, como hasta ahora. Un solo callback para las dos → la fila sigue
  // recibiendo props estables.
  const onCtx = useCallback(
    (e, track, isCurrent, via) => openMenu(e, { type: 'queue-track', item: track, isCurrent, via }),
    [openMenu],
  );

  // Auto-scroll: al cambiar la pista actual, centrar la fila marcada en la vista. Dep por _qid de
  // la actual (NO currentTime) → no corre en cada tick del progreso. Vía querySelector sobre el DOM:
  // NO agrega props a las QueueRow memoizadas → el aislamiento del re-render del progreso queda intacto.
  //
  // D1 · La dep es el _qid y ya NO queueIndex: reordenar cruzando la pista actual le cambia el
  // ÍNDICE sin cambiar la pista (idxRef la sigue por _qid), y con la dep vieja la lista se
  // auto-centraba sola a mitad del arrastre. Por _qid dispara exactamente cuando cambia la pista
  // —que es lo que este efecto siempre quiso decir— y de paso distingue duplicados.
  // behavior:'auto' (salto directo, SIEMPRE): con shuffle + cola larga "siguiente" salta cientos de
  // filas y animar ese trayecto marea; el salto instantáneo orienta sin recorrerlo (auto = sin
  // motion → también respeta prefers-reduced-motion). block:'center' orienta mejor en saltos grandes.
  useEffect(() => {
    // D3 · Con un arrastre en curso este efecto se ABSTIENE. Si la canción termina a mitad del
    // gesto, centrar la nueva actual movería el scroll de golpe por debajo del dedo: el arrastre
    // lo leería como desplazamiento y el destino pegaría un salto. Los dos scrollean el mismo
    // nodo, así que mandan de a uno — y mientras arrastrás, mandás vos.
    if (dragRef.current) return;
    const row = bodyRef.current?.querySelector('.queue-row.current');
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'auto' });
  }, [currentTrack?._qid]);

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
          <ul
            className="queue-list"
            onPointerDown={onListPointerDown}
            onPointerMove={onListPointerMove}
            onPointerUp={onListPointerUp}
            onPointerCancel={endDrag}
            onLostPointerCapture={endDrag}
            onClickCapture={onListClickCapture}
          >
            {queue.map((t, i) => (
              <QueueRow
                key={t._qid}
                track={t}
                index={i}
                zone={i < queueIndex ? 'played' : i > queueIndex ? 'coming' : 'now'}
                isCurrent={i === queueIndex}
                isUpNext={upNext.has(t._qid)}
                onJump={jumpTo}
                onCtx={onCtx}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
