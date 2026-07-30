import { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import { coverUrl } from '../api/client.js';

// ── Drag-to-enqueue · FASE (a): arrastrar una fila de pista hasta la cola ────────────────────
//
// Agarrar una canción de cualquier lista y soltarla en la COLUMNA de la cola para encolarla al
// final. Esta fase monta la maquinaria; (b) álbumes y (c) artista/género la reusan cambiando sólo
// QUÉ se pone en el payload (una pista hoy, un conjunto de pistas después).
//
// POR QUÉ HTML5 DnD NATIVO Y NO LOS POINTER EVENTS DE LA CASA. El gesto cruza dos subárboles
// distintos del DOM: la tabla vive en .main-content y la cola es la 3ª columna del grid. Todo
// gesto de la casa captura el puntero, y con pointer capture los eventos siguientes se
// RE-TARGETEAN al capturador (el mismo motivo está escrito en el banner de useLongPress.js): la
// columna no vería un solo pointermove y habría que hacer hit-testing a mano con elementFromPoint
// en cada frame. La API nativa dispara dragover/drop sobre lo que está bajo el cursor, que es
// exactamente el problema a resolver. Además el drop de esta fase NO tiene posición (soltar en
// cualquier parte = al final), así que no se pierde nada de lo que el enfoque a mano daría.
//
// NO ES EL REORDER. El reorder dentro de la cola (v1.11.0) es pointer events sobre .queue-list, en
// otro componente. Son dos mecanismos que no comparten ni un handler ni un estado, y ninguno de
// los dos ve los eventos del otro: un drop cruzado no genera pointerdown en la cola, y un arrastre
// de fila de cola no dispara dragstart (sus filas no son draggable).
//
// EL MOTOR NO SE TOCA: esto sólo transporta una pista hasta quien llama addToQueue.

const DragQueueCtx = createContext(null);

// Marca propia del arrastre. En `dragover` el navegador NO deja leer los datos (sólo `types`), así
// que esto es lo único con lo que el destino puede distinguir un arrastre NUESTRO de una imagen,
// un archivo o una selección de texto venidos de afuera. Sin la marca, la columna se iluminaría
// con cualquier cosa que pase por encima.
export const DRAG_MIME = 'application/x-sonorarev-track';

// Doble red del gate, igual que el reorder (matchMedia en el pointerdown + @media en el CSS):
// `enabled` ya cuelga de showQueue —que sólo existe en desktop—, pero un resize desktop→móvil
// puede dejarlo en true, caso que el CSS de la cola también contempla explícitamente.
const DESKTOP = '(min-width: 701px)';

const NO_DRAG = {};

export function DragQueueProvider({ enabled, children }) {
  // El payload viaja por un ref y NO por dataTransfer: éste sólo transporta strings, y addToQueue
  // necesita el objeto de pista entero (lo esparce para ponerle su _qid). En dataTransfer va sólo
  // la marca. Un arrastre por vez, así que un ref alcanza — no hay carrera posible.
  const payloadRef = useRef(null);
  const ghostRef   = useRef(null);

  // El ghost es un nodo EFÍMERO: se crea en dragstart, el navegador le saca una foto al terminar
  // de despachar el evento, y se descarta en el mismo tick. Se construye con DOM API y no con
  // innerHTML porque el título sale de los tags del archivo — dato externo, no se interpola a mano.
  const makeGhost = (track) => {
    const el = document.createElement('div');
    el.className = 'dq-ghost';
    if (track.cover_path) {
      const img = document.createElement('img');
      img.className = 'dq-ghost-art';
      img.src = coverUrl(track.id);
      img.alt = '';
      el.appendChild(img);
    } else {
      const ph = document.createElement('span');
      ph.className = 'dq-ghost-art dq-ghost-ph';
      ph.textContent = '♪';
      el.appendChild(ph);
    }
    const text = document.createElement('span');
    text.className = 'dq-ghost-text';
    text.textContent = track.title ?? 'Sin título';
    el.appendChild(text);
    document.body.appendChild(el);
    return el;
  };

  const dropGhost = () => {
    ghostRef.current?.remove();
    ghostRef.current = null;
  };

  const onDragStart = useCallback((e, track) => {
    // Segunda red del gate. preventDefault en dragstart CANCELA el arrastre: si por un resize la
    // cola quedó abierta en móvil, la fila no se levanta.
    if (!window.matchMedia(DESKTOP).matches) { e.preventDefault(); return; }
    payloadRef.current = track;
    // Sólo la marca. A propósito NO se setea 'text/plain': con él, arrastrar una fila sobre el
    // buscador de la biblioteca o el input de renombrar playlist ofrecería pegar el título ahí.
    e.dataTransfer.setData(DRAG_MIME, String(track.id));
    e.dataTransfer.effectAllowed = 'copy';
    dropGhost();                                  // por si un dragend se perdió
    const ghost = makeGhost(track);
    ghostRef.current = ghost;
    // La foto se toma al final del despacho de este evento → el nodo se puede tirar en el próximo
    // tick. Se agenda acá y no sólo en dragend porque en dragend ya no hace falta que exista.
    try { e.dataTransfer.setDragImage(ghost, 16, 16); } catch { /* noop */ }
    setTimeout(dropGhost, 0);
  }, []);

  // dragend dispara SIEMPRE en el origen: soltando, cancelando con Esc o soltando fuera de un
  // destino válido. Es la única limpieza que hace falta — la API no deja gestos colgados.
  const onDragEnd = useCallback(() => {
    payloadRef.current = null;
    dropGhost();
  }, []);

  // Lo que cada fila esparce. Con la cola cerrada devuelve un objeto VACÍO: la fila no queda
  // draggable, así que no se levanta nada que no tenga dónde caer. Y como no incluye
  // onPointerDown, no le pisa el suyo a useLongPress (que es quien abre el menú en móvil).
  const dragProps = useCallback(
    (track) => (enabled
      ? { draggable: true, onDragStart: (e) => onDragStart(e, track), onDragEnd }
      : NO_DRAG),
    [enabled, onDragStart, onDragEnd],
  );

  // El destino lee el payload de acá. No lo borra: de eso se encarga onDragEnd, que corre siempre.
  const takeDrag = useCallback(() => payloadRef.current, []);

  const value = useMemo(() => ({ enabled, dragProps, takeDrag }), [enabled, dragProps, takeDrag]);
  return <DragQueueCtx.Provider value={value}>{children}</DragQueueCtx.Provider>;
}

// Fuera del provider (tests, o un árbol que no lo monte) las filas simplemente no son arrastrables.
const NO_CTX = { enabled: false, dragProps: () => NO_DRAG, takeDrag: () => null };

export function useDragQueue() {
  return useContext(DragQueueCtx) ?? NO_CTX;
}
