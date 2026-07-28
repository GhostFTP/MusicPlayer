import { useEffect, useMemo, useRef } from 'react';

// ── Long-press → menú contextual en MÓVIL (actions-lab · fase C1) ───────────────────────────
//
// Contraparte táctil del clic derecho: la MISMA puerta al MISMO menú, sólo que el disparador es
// mantener el dedo. El gate es por ANCHO (matchMedia 700), nunca por pointerType — mismo criterio
// de régimen que el resto del proyecto (mobile-lab: una sola maquinaria para táctil y mouse).
//
// Por qué los listeners de movimiento van en WINDOW y no en la fila:
//   con un DETALLE abierto, .main-content captura el puntero en su propio pointerdown (el
//   swipe-atrás de Layout.jsx). Con pointer capture los eventos siguientes se RE-TARGETEAN al
//   capturador, así que la fila sale del camino de propagación y un onPointerMove suyo NUNCA
//   correría → la cancelación por movimiento andaría en Biblioteca pero no dentro de un álbum.
//   En window llegan siempre (burbujean desde el capturador), con o sin captura de por medio.
//
// Al DISPARAR se captura el puntero en la fila: .main-content pierde la suya y recibe
// lostpointercapture → su cancelNavDrag() corre solo. Sin eso, seguir arrastrando hacia la derecha
// con el menú ya abierto dispararía el swipe-atrás (history.back()) y sacaría del detalle.
//
// Este módulo NO navega ni toca el historial: sólo avisa "mantuvieron el dedo acá". El cierre del
// menú sigue siendo el de siempre (escalera de Player: Esc / atrás / tap afuera).

const HOLD_MS  = 500;   // igual que el long-press nativo del navegador
const MOVE_TOL = 10;    // px que cancelan. A propósito por DEBAJO de AXIS_DIST (12), el umbral con
                        // el que el resto de los gestos fija eje: el long-press siempre muere antes
                        // de que otro gesto se declare — nunca compiten dos ganadores.

const isMobile  = () => window.matchMedia('(max-width: 700px)').matches;
const isControl = (t) => !!t?.closest?.('button, a, input, [role="button"]');

export function useLongPress(onFire) {
  // El callback se refresca en cada render, pero los handlers devueltos quedan ESTABLES: así una
  // fila memoizada (QueueRow) sigue sin re-renderizarse por culpa de esto.
  const fireRef = useRef(onFire);
  fireRef.current = onFire;

  const down  = useRef(null);    // { x0, y0, el, pointerId, arg } — el toque en curso
  const armed = useRef(false);   // ¿el timer sigue vivo? (lo apagan el movimiento y las cancelaciones)
  const fired = useRef(false);   // este gesto YA abrió el menú → su click no reproduce
  const timer = useRef(null);
  const wl    = useRef(null);    // listeners de window activos

  const { bind, cancel } = useMemo(() => {
    const detach = () => {
      const w = wl.current;
      if (!w) return;
      wl.current = null;
      window.removeEventListener('pointermove', w.move);
      window.removeEventListener('pointerup', w.end);
      window.removeEventListener('pointercancel', w.end);
      window.removeEventListener('blur', w.end);
    };
    // Cancelación limpia (movimiento, soltar, el pointercancel que manda el scroll, blur de
    // ventana): nunca queda un timer ni un listener suelto. `down` NO se borra acá a propósito —
    // el camino del 'contextmenu' lo sigue necesitando (ver `context`).
    const cancel = () => {
      armed.current = false;
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      detach();
    };

    // Abre el menú. IDEMPOTENTE (`fired`): en Android el 'contextmenu' nativo llega casi en el
    // mismo instante que nuestro timer y el orden entre los dos relojes no está garantizado —
    // gane quien gane, el menú se abre UNA sola vez.
    const fire = (x, y) => {
      const d = down.current;
      if (!d || fired.current) return;
      fired.current = true;
      cancel();
      // Le roba la captura a .main-content → su swipe-atrás se cancela solo (ver banner de arriba).
      try { d.el?.setPointerCapture?.(d.pointerId); } catch { /* noop */ }
      // openMenu() sólo necesita el punto y sus dos no-ops: en C1 el ancla del popover ES el toque.
      fireRef.current?.(d.arg, { clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} });
    };

    const start = (e, arg) => {
      cancel();
      fired.current = false;             // gesto nuevo → el guard del click arranca limpio
      down.current  = null;
      if (!isMobile()) return;
      if (isControl(e.target)) return;   // el "⋯", enlaces e inputs conservan su toque de siempre
      down.current  = { x0: e.clientX, y0: e.clientY, el: e.currentTarget, pointerId: e.pointerId, arg };
      armed.current = true;

      const move = (ev) => {
        const d = down.current;
        if (!d || !armed.current) return;
        if (Math.abs(ev.clientX - d.x0) > MOVE_TOL || Math.abs(ev.clientY - d.y0) > MOVE_TOL) cancel();
      };
      const end = () => cancel();
      wl.current = { move, end };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
      window.addEventListener('blur', end);

      // El punto del disparo es el del DOWN, no el último move: pasarse de MOVE_TOL cancela, así
      // que por construcción el dedo sigue a menos de 10px de ahí.
      timer.current = setTimeout(() => {
        timer.current = null;
        const d = down.current;
        if (armed.current && d) fire(d.x0, d.y0);
      }, HOLD_MS);
    };

    // 'contextmenu' nativo:
    //  · DESKTOP → es el disparador de siempre: se delega tal cual (clic derecho, sin tocar nada).
    //  · MÓVIL   → se previene SIEMPRE (Android lo dispara con el long-press y sacaría el menú del
    //    SISTEMA encima del nuestro) y, si nuestro timer todavía no llegó, dispara el nuestro.
    //    Ese segundo camino es el que salva el orden REAL de Android: al reconocer el long-press el
    //    navegador manda un 'pointercancel' que apaga nuestro timer y recién después el
    //    'contextmenu' — sin esto, ahí el menú no se abriría nunca. Por eso `fire` no exige
    //    `armed`: le alcanza con el `down` de esta misma secuencia de toque.
    const context = (e, arg, onContextMenu) => {
      if (!isMobile()) { onContextMenu?.(e); return; }
      e.preventDefault();
      fire(e.clientX, e.clientY);
    };

    // El click que sigue a un long-press NO debe reproducir. Se traga ACÁ y no con un
    // preventDefault en el pointerdown, que mataría el scroll de la lista.
    const click = (e, onClick) => {
      if (fired.current) { e.preventDefault(); e.stopPropagation(); return; }
      onClick?.(e);
    };

    // `arg` es lo que se le devuelve a onFire (la pista de esta fila). Los handlers propios de la
    // fila viajan en `h` y se siguen ejecutando: el hook los envuelve, no los reemplaza.
    const bind = (arg, h = {}) => ({
      onPointerDown: (e) => start(e, arg),
      onContextMenu: (e) => context(e, arg, h.onContextMenu),
      onClick:       (e) => click(e, h.onClick),
    });

    return { bind, cancel };
  }, []);

  useEffect(() => cancel, [cancel]);   // desmontar a mitad de gesto no deja listeners sueltos
  return bind;
}
