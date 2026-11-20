// dj-matriz.mjs — MATRIZ VISUAL del Modo DJ (sub-paso h5a, Fase 1: sólo medidas numéricas con aserciones).
// El mismo estado de /dj medido en varios tamaños de ventana, para atrapar desbordes antes de que los vea Oscar.
//
//   SNAP_BASE=http://localhost:4173 node dj-matriz.mjs        (lo normal: por el runner, con su baseline aparte)
//   node regresion.mjs --baseline baseline-dj-matriz.json      (build + servidores aislados + esta matriz)
//
// h5a: UN estado, tres ventanas con ratón, dos métricas.
//   · E1 = sin salida de audífonos: /dj recargado sin 'djCue' ni __fdCfg (como cs0 de dj-func): lista 'inactivo',
//     cue 'sin-salida', el botón «Ver salidas de audio».
//   · Ventanas: 900×800 (el mínimo con los decks lado a lado), 1280×800, 1366×768.
//   · (a) sin scroll horizontal: .main-content y document.scrollingElement con scrollWidth ≤ clientWidth.
//   · (b) nada fuera del área: todo descendiente de .dj-page con caja de ancho > 0 queda entre el borde izquierdo y el
//     derecho del CONTENIDO de .main-content (sin su padding), con 0,5 px de margen (generaliza dj-func.mjs:1521–1523
//     a los dos lados). Se nombran las clases de los que se salen (las 8 primeras, como ce12).
//   · Redes anti pase en falso: .dj-page existe y se midió al menos un elemento, en cada ventana.
//   · Espera estable: tras cada setViewportSize, dos frames y dos medidas IGUALES seguidas (no un sleep fijo).
// NO mide: solapes, texto cortado, alto, objetivos táctiles, otros estados ni la tablet (h5b en adelante).
// Los falsos (AudioContext/setSinkId, MIDI mínimo, mediaDevices) son una COPIA de dj-func: dj-falsos.mjs.
// Salida: el JSON de casos, el registro, y la línea «dj-matriz: n/m» (modo name-line de regresion.mjs); exit 0 o 1.
// Con DJ_MATRIZ_SALIDA=<archivo>, el resultado completo va también a ese archivo (lo usa mutar.mjs --suites dj-matriz).
import { writeFileSync } from 'node:fs';
import { BASE } from '../session.mjs';
import { preparar, instalarFalsos } from './dj-falsos.mjs';

const VENTANAS = [[900, 800], [1280, 800], [1366, 768]];
const R = {};
const REG = {};   // lo que sólo se registra (no cuenta en el n/m)
const ok = (k, v, extra) => { R[k] = extra === undefined ? !!v : { ok: !!v, ...extra }; };
const t0 = Date.now();

// Lo que se mide, en la página. Sin .dj-page → { pagina: false } (y los casos fallan).
const medir = () => {
  const sc = document.querySelector('.main-content'), pg = document.querySelector('.dj-page');
  if (!sc || !pg) return { pagina: !!pg, main: !!sc };
  const cs = getComputedStyle(sc), r = sc.getBoundingClientRect();
  const izq = r.left + sc.clientLeft + parseFloat(cs.paddingLeft);
  const der = r.left + sc.clientLeft + sc.clientWidth - parseFloat(cs.paddingRight);
  const nombre = (e) => (typeof e.className === 'string' && e.className ? e.className : e.tagName);
  let medidos = 0;
  const fuera = [];
  for (const e of pg.querySelectorAll('*')) {
    const q = e.getBoundingClientRect();
    if (!(q.width > 0)) continue;
    medidos++;
    if (q.left < izq - 0.5 || q.right > der + 0.5) fuera.push(`${nombre(e)} [${Math.round(q.left)}–${Math.round(q.right)}]`);
  }
  const d = document.scrollingElement;
  return {
    pagina: true, vw: innerWidth, vh: innerHeight, area: [Math.round(izq), Math.round(der)], medidos, nFuera: fuera.length, fuera: fuera.slice(0, 8),
    main: { sw: sc.scrollWidth, cw: sc.clientWidth }, doc: { sw: d.scrollWidth, cw: d.clientWidth },
  };
};

// Dos frames y dos medidas iguales seguidas; a lo sumo 30 intentos. → { m, intentos } o { m, intentos, inestable: true }.
async function medirEstable(p) {
  let prev = null;
  for (let i = 1; i <= 30; i++) {
    await p.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
    const m = await p.evaluate(medir);
    if (prev !== null && JSON.stringify(m) === JSON.stringify(prev)) return { m, intentos: i };
    prev = m;
  }
  return { m: prev, intentos: 30, inestable: true };
}

const { browser, abrir } = await preparar();
const { ctx, p, errores } = await abrir(BASE, '/', { w: 1280, h: 800, esperar: '.player-bar' });
try {
  await instalarFalsos(ctx);
  // E1: sin 'djCue' guardado y sin config del mediaDevices falso (permiso 'prompt' → sin nombres, como cs0).
  await p.evaluate(() => { localStorage.removeItem('djCue'); sessionStorage.removeItem('__fdCfg'); sessionStorage.removeItem('__fmCfg'); });
  await p.goto(BASE + '/dj');
  await p.waitForSelector('.dj-cue', { timeout: 15000 }).catch(() => {});
  const e1 = await p.evaluate(() => {
    const s = document.querySelector('.dj-cue');
    return s ? { estado: s.dataset.estado, lista: s.dataset.lista, ver: !!s.querySelector('.dj-cue-ver'), falsos: !!window.__fd && !!window.__ac, ruta: location.pathname } : null;
  });
  ok('e1_estado_sin_salida', !!e1 && e1.ruta === '/dj' && e1.estado === 'sin-salida' && e1.lista === 'inactivo' && e1.ver && e1.falsos, { e1 });

  REG.e1 = {};
  for (const [w, h] of VENTANAS) {
    await p.setViewportSize({ width: w, height: h });
    const { m, intentos, inestable } = await medirEstable(p);
    const k = `e1_${w}x${h}`;
    REG.e1[`${w}x${h}`] = { intentos, inestable: !!inestable, medidos: m?.medidos ?? null, area: m?.area ?? null };
    ok(`${k}_hay_que_medir`, !!m && m.pagina === true && m.medidos > 0 && !inestable, { pagina: m?.pagina ?? null, medidos: m?.medidos ?? null, intentos, inestable: !!inestable });
    ok(`${k}_sin_scroll_horizontal`, !!m?.pagina && m.main.sw <= m.main.cw && m.doc.sw <= m.doc.cw, { main: m?.main ?? null, doc: m?.doc ?? null });
    ok(`${k}_nada_fuera_del_area`, !!m?.pagina && m.medidos > 0 && m.nFuera === 0, { area: m?.area ?? null, nFuera: m?.nFuera ?? null, fuera: m?.fuera ?? null });
  }
  ok('sin_errores_de_pagina', errores.length === 0, { errores });
} catch (e) {
  ok('excepcion', false, { error: String(e.message).split('\n')[0].slice(0, 200) });
}
REG.ms = Date.now() - t0;

const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
console.log('registro (fuera del conteo):', JSON.stringify(REG, null, 1));
console.log(`\ndj-matriz: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
if (process.env.DJ_MATRIZ_SALIDA) writeFileSync(process.env.DJ_MATRIZ_SALIDA, JSON.stringify({ fallan: fails.map(([k]) => k), R, REG }, null, 1));
await browser.close();
process.exit(fails.length ? 1 : 0);
