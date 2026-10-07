import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

// Ventana de filas (virtualización a mano, Frente 1 · sub-paso 9). Sólo se montan las filas que se
// ven + `overscan` arriba y abajo; el resto lo ocupan filas espaciadoras de alto = filas × paso, así
// la barra de scroll y el alto total son los mismos que con todas las filas.
//
// · El PASO de fila no se escribe en JS: se mide en el DOM (distancia entre dos filas consecutivas
//   montadas, que incluye el borde colapsado de la tabla). Cambia por modo (tabla/lista/móvil) y se
//   vuelve a medir cuando la tabla cambia de tamaño (ResizeObserver: viewport, cola abierta, modo).
// · El scroll lo hace el CONTENEDOR que se indique (`scroller`: selector que se busca hacia arriba
//   desde la lista con closest). Por defecto `.main-content` (Layout), que es el de Biblioteca; la
//   cola usa su `.queue-body`. Listener PASIVO + un requestAnimationFrame por frame, y setState SÓLO
//   si cambia el inicio o el tamaño de la ventana (no en cada píxel).
// · Las filas reales se reconocen por `data-index` (su índice en la lista COMPLETA); las espaciadoras
//   no lo llevan. Qué elemento es la espaciadora (<tr><td>, <li>…) lo decide la vista.
// · `pinned`: índices que deben quedar montados aunque estén fuera de la ventana (la fila que se
//   arrastra — si se desmonta se pierde su dragend —, y la que tiene el foco del teclado).
//
// Devuelve `segments`: [{ type: 'rows', from, to }] y [{ type: 'gap', from, to }] en orden, para que
// la vista arme filas y espaciadoras. `tbodyRef` (alias `listRef`) va en el contenedor DIRECTO de las
// filas (<tbody>, <ul>). `syncWindow()` recalcula la ventana YA (p. ej. tras mover el scroll a mano
// en un layout effect, para que el frame que se pinta ya tenga las filas de destino).

const INITIAL_ROWS = 60;   // primer render, antes de poder medir (se corrige antes de pintar)
const HYST = 3;            // filas de margen antes de mover la ventana (ver compute)

export function useWindowedRows(count, { overscan = 10, pinned = [], scroller: scrollerSel = '.main-content' } = {}) {
  const tbodyRef = useRef(null);
  const [pitch, setPitch] = useState(0);              // px por fila (0 = todavía sin medir)
  // ¿El <tbody> se pinta como TABLA (escritorio) o como bloques (modo lista ≤1024 / cola abierta /
  // móvil)? La espaciadora necesita un estilo distinto en cada caso para medir exacto (ver la vista).
  const [tableMode, setTableMode] = useState(true);
  const [win, setWin] = useState({ start: 0, size: INITIAL_ROWS });
  const raf = useRef(0);

  const scroller = () => tbodyRef.current?.closest(scrollerSel) ?? null;

  // Paso de fila: dos filas montadas con índices consecutivos (data-index) → distancia entre sus tops.
  // Se toma un par del MEDIO de lo montado: las filas pegadas a una espaciadora pueden diferir medio
  // píxel por el borde colapsado de la tabla.
  const measure = useCallback(() => {
    const body = tbodyRef.current;
    if (!body) return 0;
    const rows = body.querySelectorAll(':scope > [data-index]');
    const mid = Math.max(0, Math.floor(rows.length / 2) - 1);
    for (let k = mid; k + 1 < rows.length; k++) {
      if (Number(rows[k + 1].dataset.index) === Number(rows[k].dataset.index) + 1) {
        const p = rows[k + 1].getBoundingClientRect().top - rows[k].getBoundingClientRect().top;
        if (p > 0) return p;
      }
    }
    return rows.length ? rows[0].getBoundingClientRect().height : 0;
  }, []);

  // Inicio/tamaño de la ventana a partir del scroll actual.
  const compute = useCallback((p) => {
    const sc = scroller();
    const body = tbodyRef.current;
    if (!sc || !body || !p) return;
    const scTop = sc.getBoundingClientRect().top;
    const bodyTop = body.getBoundingClientRect().top - scTop + sc.scrollTop;   // en coordenadas del contenido
    const first = Math.floor((sc.scrollTop - bodyTop) / p);
    const visible = Math.ceil(sc.clientHeight / p);
    const size = visible + 2 * overscan;
    const start = Math.max(0, Math.min(first - overscan, Math.max(0, count - size)));
    // Histéresis: la ventana actual se conserva mientras lo visible quede a ≥ HYST filas de sus bordes
    // (y no haya cambiado el tamaño). Así no se re-renderiza cada ~2 filas de scroll sino cada ~7, y
    // los frames sin trabajo de React quedan libres [MEDIDO en mount.mjs, scroll a 4x].
    setWin((w) => {
      if (w.size === size && w.start === start) return w;
      const inside = w.size === size
        && first - w.start >= HYST
        && (w.start + w.size) - (first + visible) >= HYST
        && !(w.start > 0 && first - overscan <= 0)                   // al llegar arriba, pegarse al 0
        && !(w.start + w.size < count && first + visible + overscan >= count);   // y abajo, al final
      return inside ? w : { start, size };
    });
  }, [count, overscan]);

  const detectMode = useCallback(() => {
    const body = tbodyRef.current;
    if (body) setTableMode(getComputedStyle(body).display === 'table-row-group');
  }, []);

  // Medir y ubicar la ventana ANTES de pintar (al montar y cada vez que cambia la lista).
  useLayoutEffect(() => {
    detectMode();
    const p = measure() || pitch;
    if (p && p !== pitch) setPitch(p);
    compute(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  // Scroll (pasivo + rAF) y cambios de tamaño: de la tabla/lista (modo, viewport, cola abierta) y del
  // CONTENEDOR de scroll (en la hoja móvil de la cola cambia el alto visible sin que la lista cambie).
  useEffect(() => {
    const sc = scroller();
    const body = tbodyRef.current;
    if (!sc || !body) return undefined;
    // Pasivo + un requestAnimationFrame por frame; flushSync para que la ventana nueva se monte en ese
    // mismo frame, antes de pintar (sin él React la dejaba para después del pintado).
    const onScroll = () => {
      if (raf.current) return;
      raf.current = requestAnimationFrame(() => { raf.current = 0; flushSync(() => compute(pitch || measure())); });
    };
    sc.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(() => {
      detectMode();
      const p = measure();
      if (p && p !== pitch) setPitch(p);
      compute(p || pitch);
    });
    ro.observe(body.closest('table') ?? body);
    if (sc !== body) ro.observe(sc);
    return () => {
      sc.removeEventListener('scroll', onScroll);
      ro.disconnect();
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compute, measure, detectMode, pitch, scrollerSel]);

  // Devuelve el paso usado (0 si todavía no hay filas para medir).
  const syncWindow = useCallback(() => {
    const p = pitch || measure();
    if (p && p !== pitch) setPitch(p);
    compute(p);
    return p;
  }, [compute, measure, pitch]);

  // Segmentos: ventana ∪ filas fijadas, con espaciadoras en los huecos. Sin paso medido todavía
  // (primer render) no hay espaciadoras: se montan las primeras filas y se corrige antes de pintar.
  // Memoizados: si la ventana no cambió, la vista recibe el MISMO arreglo y no rearma sus filas
  // (importa al teclear en el buscador: el render urgente no debe tocar la tabla).
  const segments = useMemo(() => {
    const out = [];
    if (count <= 0) return out;
    if (!pitch) {
      out.push({ type: 'rows', from: 0, to: Math.min(count, INITIAL_ROWS) });
      return out;
    }
    const end = Math.min(count, win.start + win.size);
    const idx = new Set();
    for (let i = win.start; i < end; i++) idx.add(i);
    for (const i of pinned) if (i != null && i >= 0 && i < count) idx.add(i);
    // La ÚLTIMA fila siempre montada: en modo lista/móvil no lleva borde inferior (mide 1 px menos que
    // el paso); con ella real, la espaciadora de abajo sólo cubre filas de paso completo y el alto
    // total es exacto.
    idx.add(count - 1);
    const sorted = [...idx].sort((x, y) => x - y);
    let cursor = 0;
    for (let k = 0; k < sorted.length; k++) {
      const from = sorted[k];
      let to = from + 1;
      while (k + 1 < sorted.length && sorted[k + 1] === to) { k++; to++; }
      if (from > cursor) out.push({ type: 'gap', from: cursor, to: from });
      out.push({ type: 'rows', from, to });
      cursor = to;
    }
    if (cursor < count) out.push({ type: 'gap', from: cursor, to: count });
    return out;
  }, [count, win, pitch, pinned]);

  return { tbodyRef, listRef: tbodyRef, segments, pitch, tableMode, syncWindow };
}
