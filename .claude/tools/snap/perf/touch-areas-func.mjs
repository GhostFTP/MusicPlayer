// touch-areas-func.mjs — áreas de toque de 44 px en la TABLET, sin mover lo que se ve (1.32.1).
//
// En una tablet (dedo + layout de escritorio, 701 px o más) los controles de la barra, del expandido
// y de las listas medían de 16 a 40 px. Con `(pointer: coarse) and (min-width: 701px)` cada uno
// tiene 44×44 de área de toque EFECTIVA (se mide con elementFromPoint: cuenta el área ampliada y
// descuenta lo que tapa un vecino), sin que cambie la caja visible. Con ratón no cambia nada.
//
// DOS EXCEPCIONES, medidas y a propósito (no hay espacio sin pisar al vecino):
//   · la barra de progreso de la barra de escritorio: 20 px de alto (los botones están 3 px encima);
//   · «silenciar» de la barra: 23 px de ancho × 44 de alto (entre «info» y el slider hay 23 px).
// Y dos que crecen de verdad (no hay otra forma): el selector de vista de Álbumes y el de orden de
// Biblioteca pasan a 44 px.
//
// Comprueba, con dedo a 1024, 1180, 1280 y 1366: barra, Biblioteca, cola, Álbumes y expandido — todo
// en 44×44 o más, salvo las dos excepciones, que tienen que medir lo dicho.
// A 1280: las cajas visibles de los botones de la barra y del expandido son IDÉNTICAS con dedo y con
// ratón; con dedo los pulgares de progreso y volumen se ven sin pasar el ratón.
// Con ratón a 1440: nada tiene área extra (los botones de la barra miden sus 36 px de siempre).
// Con SNAP_REF (un build sin esto, p. ej. v1.32.0 en otro puerto): control negativo. Sin SNAP_REF ese
// control NO se corre ni se cuenta, y se avisa. Sólo lee: no escribe nada en la base.
// Uso: SNAP_BASE=http://localhost:4173 [SNAP_REF=http://localhost:4174] node touch-areas-func.mjs
import { preflight, BASE } from '../session.mjs';
import { preparar, sleep, same, medirAreas } from './tablet-util.mjs';

const REF = process.env.SNAP_REF ?? null;
await preflight();
const { browser, abrir } = await preparar();
const R = {}; const ok = (k, v, extra = {}) => { R[k] = { ok: !!v, ...extra }; };
const medidas = {};
const chicos = (filas, excepciones = {}) => filas.filter((f) => {
  const ex = excepciones[f.control];
  return ex ? !(f.toque[0] >= ex[0] && f.toque[1] >= ex[1]) : Math.min(...f.toque) < 44;
}).map((f) => `${f.control} caja ${f.caja.join('×')} toque ${f.toque.join('×')}${f.n > 1 ? ' ×' + f.n : ''}`);
// Las dos excepciones de la barra: [ancho mínimo, alto mínimo].
const EXC_BARRA = { 'input[progreso]': [44, 20], 'volume-btn': [23, 44] };

// ¿Se ve el pulgar del slider? El pseudo-elemento no se puede consultar por CSSOM, así que se cuenta
// en una captura: el pulgar es un disco casi blanco sobre un riel gris.
async function pulgarVisible(p, sel) {
  const png = await p.locator(sel).first().screenshot();
  return p.evaluate(async (b64) => { const i = new Image(); await new Promise((r) => { i.onload = r; i.src = 'data:image/png;base64,' + b64; });
    const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0); const d = x.getImageData(0, 0, i.width, i.height).data;
    let n = 0; for (let k = 0; k < d.length; k += 4) if (d[k] > 225 && d[k + 1] > 225 && d[k + 2] > 225) n++; return n; }, png.toString('base64'));
}
// Deja sonando SIEMPRE la misma pista (la primera fila), en pausa para que nada se mueva, y mide
// cada superficie.
async function medirTodo(base, w, h, tactil) {
  const o = await abrir(base, '/', { w, h, tactil, esperar: '.library-tracks .track-row' });
  await o.tocar(o.p.locator('.library-tracks .track-row').first()); await o.p.waitForFunction(() => window.__player().queue.length > 0, null, { timeout: 6000 }).catch(() => {});
  await o.p.waitForFunction(() => window.__player().isPlaying, null, { timeout: 3000 }).catch(() => {});
  await o.p.evaluate(() => { const v = window.__player(); if (v.isPlaying) v.togglePlay(); }); await sleep(700);
  if (!tactil) await o.p.mouse.move(600, 300);
  const out = { barra: await medirAreas(o.p, '.player-bar'), biblioteca: await medirAreas(o.p, '.main-content') };
  out.cajas_barra = await o.p.evaluate(() => [...document.querySelectorAll('.player-bar button')].filter((e) => e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; }));
  out.pulgares = [await pulgarVisible(o.p, '.player-bar .seek'), await pulgarVisible(o.p, '.player-bar .player-volume input[type="range"]')];
  await o.tocar(o.p.locator('.player-bar .action-btn[aria-label="Cola"]')); await o.p.waitForSelector('.queue-panel .queue-row', { timeout: 4000 }).catch(() => {}); await sleep(500);
  out.cola = await medirAreas(o.p, '.queue-panel');
  await o.tocar(o.p.locator('.player-bar .action-btn[aria-label="Cola"]')); await sleep(400);
  await o.tocar(o.p.locator('.player-bar .player-art, .player-bar .player-art-placeholder').first()); await o.p.waitForSelector('.player-expanded', { timeout: 4000 }).catch(() => {}); await sleep(1000);
  out.expandido = await medirAreas(o.p, '.player-expanded');
  out.cajas_expandido = await o.p.evaluate(() => [...document.querySelectorAll('.player-expanded button, .player-expanded .exp-link, .player-expanded .seek')].filter((e) => e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; }));
  await o.p.keyboard.press('Escape'); await sleep(400);
  await o.p.goto(base + '/albums'); await o.p.waitForSelector('.album-grid .album-card').catch(() => {}); await sleep(500);
  out.albumes = await medirAreas(o.p, '.main-content');
  await o.ctx.close(); return out;
}

try {
  let t1280 = null;
  for (const [w, h] of [[1024, 768], [1180, 820], [1280, 800], [1366, 1024]]) {
    const m = await medirTodo(BASE, w, h, true); if (w === 1280) t1280 = m;
    const cb = chicos(m.barra, EXC_BARRA);
    ok(`areas_barra_${w}`, m.barra.length >= 10 && cb.length === 0, { controles: m.barra.length, por_debajo: cb, excepciones: m.barra.filter((f) => EXC_BARRA[f.control]).map((f) => `${f.control} ${f.toque.join('×')}`) });
    const cl = [...chicos(m.biblioteca).map((s) => 'Biblioteca · ' + s), ...chicos(m.cola).map((s) => 'cola · ' + s), ...chicos(m.albumes).map((s) => 'Álbumes · ' + s)];
    ok(`areas_listas_${w}`, m.biblioteca.length >= 2 && m.cola.length >= 1 && m.albumes.length >= 2 && cl.length === 0, { controles: m.biblioteca.length + m.cola.length + m.albumes.length, por_debajo: cl });
    const ce = chicos(m.expandido);
    ok(`areas_expandido_${w}`, m.expandido.length >= 12 && ce.length === 0, { controles: m.expandido.length, por_debajo: ce });
    medidas[w] = { barra: Object.fromEntries(m.barra.map((f) => [f.control, f.toque.join('×')])), expandido: Object.fromEntries(m.expandido.map((f) => [f.control, f.toque.join('×')])) };
  }
  // Lo que se ve no se movió: mismas cajas con dedo que con ratón, al mismo ancho.
  const r1280 = await medirTodo(BASE, 1280, 800, false);
  ok('cajas_visibles_iguales_con_dedo_y_con_raton_1280', same(t1280.cajas_barra, r1280.cajas_barra) && same(t1280.cajas_expandido, r1280.cajas_expandido) && t1280.cajas_barra.length >= 10,
    { barra: [t1280.cajas_barra.length, same(t1280.cajas_barra, r1280.cajas_barra)], expandido: [t1280.cajas_expandido.length, same(t1280.cajas_expandido, r1280.cajas_expandido)] });
  ok('pulgares_visibles_sin_hover_con_dedo', t1280.pulgares.every((n) => n >= 30) && r1280.pulgares.every((n) => n < 10), { pixeles_casi_blancos_progreso_y_volumen: { con_dedo: t1280.pulgares, con_raton: r1280.pulgares } });
  // Con ratón no hay áreas extra.
  const r1440 = await medirTodo(BASE, 1440, 900, false);
  const ctrl = r1440.barra.filter((f) => f.control.startsWith('ctrl-btn'));
  ok('raton_1440_sin_areas_extra', ctrl.length >= 4 && ctrl.every((f) => same(f.toque, f.caja)) && r1440.barra.find((f) => f.control === 'volume-btn')?.toque.join('×') === '16×16', { botones_de_control: ctrl.map((f) => `${f.control} caja ${f.caja.join('×')} toque ${f.toque.join('×')}`) });
  if (REF) {
    const m = await medirTodo(REF, 1280, 800, true);
    ok('control_ref_areas_chicas', chicos(m.barra, EXC_BARRA).length >= 8 && chicos(m.expandido).length >= 3, { barra_por_debajo: chicos(m.barra, EXC_BARRA).length, expandido_por_debajo: chicos(m.expandido).length });
  }
} catch (e) {
  ok('sin_excepciones', false, { error: String(e.message).split('\n')[0].slice(0, 200) });
}

const fails = Object.entries(R).filter(([, v]) => !v.ok);
console.log(JSON.stringify(R, null, 1));
console.log('medidas: ' + JSON.stringify(medidas));
console.log(REF ? `referencia (un build sin las áreas de 44 px): ${REF}` : 'SIN SNAP_REF: el control contra la referencia (control_ref_areas_chicas) NO se corrió ni se cuenta.');
console.log(`\ntouch-areas-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
