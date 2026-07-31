import { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import { artistImageUrl, coverUrl } from '../api/client.js';
import { genreEmoji } from '../utils/genreEmoji.js';

// ── Drag-to-enqueue: arrastrar cosas hasta la cola ──────────────────────────────────────────
//
// Agarrar algo de cualquier lista y soltarlo en la COLUMNA de la cola para encolarlo al final.
// Fase (a): una fila de pista. Fase (b): una tarjeta de ÁLBUM. Fase (c): una de ARTISTA o de
// GÉNERO. Las tres últimas encolan todas las pistas del conjunto.
//
// La maquinaria es la misma para los cuatro kinds: lo único que cambia es el `kind` del payload y
// quién lo resuelve en el destino. Acá NO se sabe qué significa cada kind ni se pide una sola pista
// a la API: esto transporta una intención, el destino la ejecuta. Por eso el ghost es lo único que
// mira el kind — porque es lo único que se ve.
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
//
// UNA sola marca para todos los kinds, no una por tipo: lo que decide si la columna acepta es
// "¿esto lo soltó SonoraRev?", y esa respuesta es idéntica para una pista y para un álbum. El kind
// se lee del payload al soltar, que es el único momento en que hace falta saberlo.
export const DRAG_MIME = 'application/x-sonorarev-item';

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

  // Qué se ve arrastrando, por kind. Cada tarjeta saca su imagen de un lado distinto —la pista de
  // su propio id, el álbum de `sample_track_id`, el artista de su foto curada con la MISMA cadena
  // de fallback que ArtistImage (foto → carátula de un álbum suyo → nada), y el género de un emoji
  // en vez de una imagen—, así que no hay campo común: cada kind dice de dónde sale la suya.
  //
  // El subtítulo lo llevan los kinds de CONJUNTO y no la pista suelta: ahí sería el artista, que no
  // aporta al "qué estoy arrastrando", mientras que el conteo SÍ avisa que vienen N y no una. Es el
  // conteo de la TARJETA, el mismo que ya se ve en pantalla; lo que realmente entró lo dice el
  // toast al soltar (para un género con más de 500 pistas los dos números pueden no coincidir: el
  // fetch está topado, igual que en el menú).
  const count = (n) => (n != null ? `${n} ${n === 1 ? 'canción' : 'canciones'}` : null);
  const GHOST = {
    track: (t) => ({ cover: t.cover_path ? coverUrl(t.id) : null, glyph: '♪', title: t.title ?? 'Sin título', sub: null }),
    album: (a) => ({
      cover: a.sample_track_id ? coverUrl(a.sample_track_id) : null,
      glyph: '♫',
      title: a.album ?? 'Álbum',
      sub: count(a.track_count),
    }),
    artist: (a) => ({
      cover: a.has_image ? artistImageUrl(a.artist) : (a.sample_track_id ? coverUrl(a.sample_track_id) : null),
      glyph: '♫',
      title: a.artist ?? 'Artista',
      sub: count(a.track_count),
    }),
    genre: (g) => ({ cover: null, glyph: genreEmoji(g.genre), title: g.genre ?? 'Género', sub: count(g.track_count) }),
  };

  // El ghost es un nodo EFÍMERO: se crea en dragstart, el navegador le saca una foto al terminar
  // de despachar el evento, y se descarta en el mismo tick. Se construye con DOM API y no con
  // innerHTML porque el texto sale de los tags del archivo — dato externo, no se interpola a mano.
  const makeGhost = (item, kind) => {
    const { cover, glyph, title, sub } = (GHOST[kind] ?? GHOST.track)(item);
    const el = document.createElement('div');
    el.className = 'dq-ghost';
    if (cover) {
      const img = document.createElement('img');
      img.className = 'dq-ghost-art';
      img.src = cover;
      img.alt = '';
      el.appendChild(img);
    } else {
      // Sin imagen: el glifo del kind. Para el género no es un placeholder sino SU emoji, el mismo
      // que lleva la tarjeta — es la identidad del género, no un relleno por falta de carátula.
      const ph = document.createElement('span');
      ph.className = 'dq-ghost-art dq-ghost-ph';
      ph.textContent = glyph;
      el.appendChild(ph);
    }
    const text = document.createElement('span');
    text.className = 'dq-ghost-text';
    const name = document.createElement('span');
    name.className = 'dq-ghost-title';
    name.textContent = title;
    text.appendChild(name);
    if (sub) {
      const meta = document.createElement('span');
      meta.className = 'dq-ghost-sub';
      meta.textContent = sub;
      text.appendChild(meta);
    }
    el.appendChild(text);
    document.body.appendChild(el);
    return el;
  };

  const dropGhost = () => {
    ghostRef.current?.remove();
    ghostRef.current = null;
  };

  const onDragStart = useCallback((e, item, kind) => {
    // Segunda red del gate. preventDefault en dragstart CANCELA el arrastre: si por un resize la
    // cola quedó abierta en móvil, no se levanta nada.
    if (!window.matchMedia(DESKTOP).matches) { e.preventDefault(); return; }
    payloadRef.current = { kind, item };
    // Sólo la marca. A propósito NO se setea 'text/plain': con él, arrastrar algo sobre el
    // buscador de la biblioteca o el input de renombrar playlist ofrecería pegar el texto ahí.
    e.dataTransfer.setData(DRAG_MIME, kind);
    e.dataTransfer.effectAllowed = 'copy';
    dropGhost();                                  // por si un dragend se perdió
    const ghost = makeGhost(item, kind);
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

  // Lo que cada fila/tarjeta esparce. Con la cola cerrada devuelve un objeto VACÍO: no queda
  // draggable, así que no se levanta nada que no tenga dónde caer. Y como no incluye
  // onPointerDown, no le pisa el suyo a useLongPress (que es quien abre el menú en móvil).
  const dragProps = useCallback(
    (item, kind = 'track') => (enabled
      ? { draggable: true, onDragStart: (e) => onDragStart(e, item, kind), onDragEnd }
      : NO_DRAG),
    [enabled, onDragStart, onDragEnd],
  );

  // El destino lee el payload de acá: `{ kind, item }`. No lo borra — de eso se encarga onDragEnd,
  // que corre siempre. Ojo desde (b): el destino resuelve el kind de forma ASÍNCRONA (un álbum hay
  // que ir a buscarlo), así que tiene que quedarse con el valor ANTES de esperar nada; para cuando
  // el fetch vuelva, dragend ya pasó y el ref está en null.
  const takeDrag = useCallback(() => payloadRef.current, []);

  const value = useMemo(() => ({ enabled, dragProps, takeDrag }), [enabled, dragProps, takeDrag]);
  return <DragQueueCtx.Provider value={value}>{children}</DragQueueCtx.Provider>;
}

// Fuera del provider (tests, o un árbol que no lo monte) las filas simplemente no son arrastrables.
const NO_CTX = { enabled: false, dragProps: () => NO_DRAG, takeDrag: () => null };

export function useDragQueue() {
  return useContext(DragQueueCtx) ?? NO_CTX;
}
