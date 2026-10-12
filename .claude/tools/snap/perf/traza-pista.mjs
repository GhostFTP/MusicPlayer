// traza-pista.mjs — TRAZA de quién cambia la pista, para los scripts que a veces fallan porque
// "la pista avanzó sola" (fav-sync-func, video-ui-func). No cambia el comportamiento de la app: sólo
// envuelve y anota. No imprime nada si todo pasa.
//
//   await instalarTraza(ctx)            antes de abrir la página (addInitScript)
//   await recogerTraza(p, 'etiqueta')   ANTES de cerrar el contexto, sólo si algo falló ahí
//   imprimirTraza()                     al final, antes de la línea "nombre: N/N"
//
// Lo que anota en window.__trazaPista (hora, ms desde la carga, tipo, detalle y una pila corta):
//   · src        cada cambio de src de un <audio>/<video> (propiedad, setAttribute o removeAttribute)
//   · play / pause / load   cada llamada a esos métodos de HTMLMediaElement
//   · mediaSession          cada vez que el NAVEGADOR invoca nexttrack / previoustrack / play / pause /
//                           stop (una tecla multimedia, el sistema): si la pila sale vacía, no lo
//                           llamó código de la página
//   · ended / error         los eventos del elemento (fin natural, o un medio que no cargó); sin pila
//   · entrada               clics y teclas, con el elemento: para ver qué gesto precedió al cambio; sin pila
// Las URL se anotan SIN la query (lleva el token de la sesión de prueba).
// La pila viene del bundle minificado: los nombres dicen poco, pero el ORIGEN se distingue (un clic,
// un `ended`, un handler de mediaSession o nada).

const guardadas = [];

export async function instalarTraza(ctx) {
  await ctx.addInitScript(() => {
    const T = (window.__trazaPista = []);
    const t0 = performance.now();
    const pila = () => (new Error().stack || '').split('\n').slice(3, 8)
      .map((l) => l.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+/g, '')).filter(Boolean).join(' < ');
    const reg = (tipo, detalle, conPila = true) => {
      T.push({ hora: new Date().toISOString().slice(11, 23), ms: Math.round(performance.now() - t0), tipo, detalle, pila: conPila ? pila() : null });
      if (T.length > 400) T.shift();
    };
    // Sin la query: lleva el token de la sesión de prueba y no tiene por qué quedar en la salida.
    const corto = (s) => String(s ?? '').replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '').slice(0, 70);
    const quien = (el) => `${el.tagName.toLowerCase()}@${Number(el.currentTime || 0).toFixed(1)}s`;
    const M = HTMLMediaElement.prototype;

    // 1) src
    const d = Object.getOwnPropertyDescriptor(M, 'src');
    Object.defineProperty(M, 'src', {
      configurable: true, enumerable: d.enumerable,
      get() { return d.get.call(this); },
      set(v) { reg('src', `${quien(this)} ← ${corto(v) || '(vacío)'}`); d.set.call(this, v); },
    });
    const setA = M.setAttribute, remA = M.removeAttribute;
    M.setAttribute = function (n, v) { if (String(n).toLowerCase() === 'src') reg('src', `${quien(this)} ← ${corto(v)} (setAttribute)`); return setA.call(this, n, v); };
    M.removeAttribute = function (n) { if (String(n).toLowerCase() === 'src') reg('src', `${quien(this)} ← (removeAttribute)`); return remA.call(this, n); };

    // 3) play / pause / load
    for (const m of ['play', 'pause', 'load']) {
      const o = M[m];
      M[m] = function (...a) { reg(m, quien(this)); return o.apply(this, a); };
    }

    // 2) mediaSession: se envuelve cada handler que la app registra.
    const ms = navigator.mediaSession;
    if (ms?.setActionHandler) {
      const o = ms.setActionHandler.bind(ms);
      const VIGILADAS = ['nexttrack', 'previoustrack', 'play', 'pause', 'stop'];
      ms.setActionHandler = (accion, h) => o(accion, h && VIGILADAS.includes(accion)
        ? (det) => { reg('mediaSession', accion); return h(det); }
        : h);
    }

    // Eventos del elemento y gestos (en captura: los eventos de medios no burbujean).
    for (const ev of ['ended', 'error']) {
      document.addEventListener(ev, (e) => { if (e.target instanceof HTMLMediaElement) reg(ev, quien(e.target), false); }, true);
    }
    const nombre = (el) => {
      if (!(el instanceof Element)) return String(el);
      const b = el.closest('button, a, [role="button"], li, tr, .track-row, .video-card, input') ?? el;
      return `${b.tagName.toLowerCase()}${b.className && typeof b.className === 'string' ? '.' + b.className.trim().split(/\s+/).slice(0, 3).join('.') : ''}${b.getAttribute('aria-label') ? ` [${b.getAttribute('aria-label')}]` : ''}`;
    };
    document.addEventListener('click', (e) => reg('entrada', `clic en ${nombre(e.target)}`, false), true);
    document.addEventListener('keydown', (e) => reg('entrada', `tecla ${e.code} sobre ${nombre(e.target)}`, false), true);
  });
}

/** Guarda la traza de una página. Llamar antes de cerrar su contexto. */
export async function recogerTraza(p, etiqueta) {
  try { guardadas.push({ etiqueta, eventos: await p.evaluate(() => window.__trazaPista ?? []) }); } catch { /* página ya cerrada */ }
}

/** Imprime lo guardado (los últimos `n` eventos de cada página). Sin nada guardado no imprime nada. */
export function imprimirTraza(n = 20) {
  for (const g of guardadas) {
    console.log(`\n── traza de pista · ${g.etiqueta} · últimos ${Math.min(n, g.eventos.length)} de ${g.eventos.length} eventos ──`);
    for (const e of g.eventos.slice(-n)) {
      console.log(`${e.hora} +${String(e.ms).padStart(6)}ms  ${e.tipo.padEnd(12)} ${e.detalle}`);
      if (e.pila !== null) console.log(`${' '.repeat(26)}${e.pila ? '↳ ' + e.pila : '↳ (sin pila de la página: lo invocó el navegador)'}`);
    }
  }
}
