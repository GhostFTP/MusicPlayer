// inputs-16-func.mjs — los campos de texto miden 16 px donde hay dedo o la pantalla es angosta (1.32.1).
//
// Con menos de 16 px, Safari de iOS agranda la página al enfocar un campo y no vuelve sola. La
// regla: `@media (pointer: coarse), (max-width: 700px)` sobre los buscadores, «Nueva playlist…», el
// login y los campos de los menús de playlist. Con ratón y pantalla ancha no cambia nada (14 px).
//
// Comprueba:
//   · con dedo a 360, 390 y 430: en las 8 vistas con campo, todos miden 16 px o más; el campo no se
//     pisa con el engrane ni con la campana, la página no desborda y el placeholder no se corta;
//   · con dedo a 1280 (tablet): los mismos campos, 16 px o más;
//   · el login (sin sesión, a 390): usuario y contraseña, 16 px o más;
//   · el campo «Nueva playlist» del menú «+» de la barra (tablet) y el del menú de una fila (390);
//   · con ratón a 1440: el buscador sigue en 14 px; con ratón a 600 (angosto): 16 px.
// ⚠️ Que Safari de verdad no haga zoom sólo se ve en un iPhone: acá se mide el tamaño de letra.
// Con SNAP_REF (un build sin esto, p. ej. v1.32.0 en otro puerto): control negativo. Sin SNAP_REF ese
// control NO se corre ni se cuenta, y se avisa. Sólo lee: no escribe nada en la base.
// Uso: SNAP_BASE=http://localhost:4173 [SNAP_REF=http://localhost:4174] node inputs-16-func.mjs
import { preflight, BASE } from '../session.mjs';
import { preparar, sleep } from './tablet-util.mjs';

const REF = process.env.SNAP_REF ?? null;
await preflight();
const { browser, abrir } = await preparar();
const R = {}; const ok = (k, v, extra = {}) => { R[k] = { ok: !!v, ...extra }; };
const VISTAS = [['Biblioteca', '/'], ['Álbumes', '/albums'], ['Artistas', '/artists'], ['Géneros', '/genres'], ['Años', '/years'], ['Playlists', '/playlists'], ['Videos', '/videos'], ['Novedades', '/changelog']];
const CAMPO = '.main-content .search-box input, .main-content .new-playlist-form input';

const medir = (p) => p.evaluate(() => {
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, b: b.bottom }; };
  const pisa = (a, b) => !!a && !!b && a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;
  const ins = [...document.querySelectorAll('.main-content input:not([type="range"]):not([type="checkbox"]):not([type="radio"]), .main-content textarea, .main-content select')].filter((e) => e.getClientRects().length);
  const gear = r(document.querySelector('.settings-fab')), bell = r(document.querySelector('.changelog-bell'));
  return { px: ins.map((e) => parseFloat(getComputedStyle(e).fontSize)), pisa: ins.some((e) => { const c = r(e.closest('.search-box, .new-playlist-form') ?? e); return pisa(c, gear) || pisa(c, bell); }),
    cortado: ins.some((e) => e.placeholder && e.scrollWidth > e.clientWidth), desborde: document.documentElement.scrollWidth - window.innerWidth };
});
async function recorrer(base, w, h, tactil) {
  const o = await abrir(base, '/', { w, h, tactil, esperar: '.library-tracks .track-row' });
  const out = { campos: 0, min: Infinity, chicos: [], pisa: [], cortado: [], desborda: [] };
  for (const [nombre, ruta] of VISTAS) {
    await o.p.goto(base + ruta); await o.p.waitForSelector(CAMPO, { timeout: 6000 }).catch(() => {}); await o.p.waitForTimeout(350);
    const m = await medir(o.p);
    out.campos += m.px.length; for (const px of m.px) { out.min = Math.min(out.min, px); if (px < 16) out.chicos.push(`${nombre} ${px}px`); }
    if (m.pisa) out.pisa.push(nombre); if (m.cortado) out.cortado.push(nombre); if (m.desborde > 0) out.desborda.push(`${nombre} +${m.desborde}`);
  }
  await o.ctx.close(); return out;
}

try {
  for (const w of [360, 390, 430]) {
    const r = await recorrer(BASE, w, 780, true);
    ok(`campos_16px_${w}`, r.campos >= 8 && r.chicos.length === 0, { campos: r.campos, el_menor: r.min, menores_de_16: r.chicos });
    ok(`sin_pisar_ni_desbordar_${w}`, r.pisa.length === 0 && r.desborda.length === 0 && r.cortado.length === 0, { pisan_engrane_o_campana: r.pisa, desbordan: r.desborda, placeholder_cortado: r.cortado });
  }
  { const r = await recorrer(BASE, 1280, 800, true);
    ok('campos_16px_tablet_1280', r.campos >= 8 && r.chicos.length === 0 && r.desborda.length === 0, { campos: r.campos, el_menor: r.min, menores_de_16: r.chicos, desbordan: r.desborda }); }
  // Login: sin sesión.
  { const o = await abrir(BASE, '/', { w: 390, h: 780, tactil: true, sesion: false, esperar: '.field input' });
    const px = await o.p.evaluate(() => [...document.querySelectorAll('.field input')].map((e) => parseFloat(getComputedStyle(e).fontSize)));
    ok('login_16px_390', px.length >= 2 && px.every((x) => x >= 16) && (await o.p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, { campos: px });
    await o.ctx.close(); }
  // «Nueva playlist» del menú «+» de la barra, en la tablet.
  { const o = await abrir(BASE, '/', { w: 1280, h: 800, tactil: true, esperar: '.library-tracks .track-row' });
    await o.tocar(o.p.locator('.library-actions .mix-btn').first()); await o.p.waitForFunction(() => window.__player().queue.length > 0, null, { timeout: 6000 }).catch(() => {}); await sleep(600);
    await o.tocar(o.p.locator('.player-bar .ptp-btn').first()); await o.p.waitForSelector('.ptp-new input', { timeout: 3000 }).catch(() => {}); await sleep(300);
    const px = await o.p.evaluate(() => [...document.querySelectorAll('.ptp-new input, .ptp-edit-input')].filter((e) => e.getClientRects().length).map((e) => parseFloat(getComputedStyle(e).fontSize)));
    ok('menu_mas_nueva_playlist_tablet', px.length >= 1 && px.every((x) => x >= 16), { campos: px });
    await o.ctx.close(); }
  // El del menú de una fila, en el teléfono (pulsación larga → Playlist).
  { const o = await abrir(BASE, '/', { w: 390, h: 780, tactil: true, esperar: '.library-tracks .track-row' });
    await o.mantener(o.p.locator('.library-tracks .track-row').nth(2)); await o.esperarMenu();
    const tile = o.p.locator('.ctx-menu .ctx-tile', { hasText: 'Playlist' }).first();
    if (await tile.count()) { await o.tocar(tile); await o.p.waitForSelector('.ctx-menu .ptp-new input', { timeout: 3000 }).catch(() => {}); await sleep(300); }
    const px = await o.p.evaluate(() => [...document.querySelectorAll('.ctx-menu .ptp-new input')].filter((e) => e.getClientRects().length).map((e) => parseFloat(getComputedStyle(e).fontSize)));
    ok('menu_de_fila_nueva_playlist_390', px.length >= 1 && px.every((x) => x >= 16), { campos: px });
    await o.ctx.close(); }
  // Con ratón: ancho, igual que siempre; angosto, 16.
  for (const [w, esperado, clave] of [[1440, 14, 'raton_1440_sigue_en_14px'], [600, 16, 'raton_angosto_600_en_16px']]) {
    const o = await abrir(BASE, '/', { w, h: 800, esperar: '.library-tracks .track-row' });
    const px = await o.p.evaluate(() => { const e = document.querySelector('.main-content .search-box input'); return e ? parseFloat(getComputedStyle(e).fontSize) : null; });
    ok(clave, px === esperado, { medido: px, esperado, pointer_coarse: await o.p.evaluate(() => matchMedia('(pointer: coarse)').matches) });
    await o.ctx.close(); }
  if (REF) { const r = await recorrer(REF, 390, 780, true); ok('control_ref_menos_de_16', r.chicos.length >= 8, { menores_de_16_en_la_ref: r.chicos.length, el_menor: r.min }); }
} catch (e) {
  ok('sin_excepciones', false, { error: String(e.message).split('\n')[0].slice(0, 200) });
}

const fails = Object.entries(R).filter(([, v]) => !v.ok);
console.log(JSON.stringify(R, null, 1));
console.log(REF ? `referencia (un build con los campos a 14 px): ${REF}` : 'SIN SNAP_REF: el control contra la referencia (control_ref_menos_de_16) NO se corrió ni se cuenta.');
console.log(`\ninputs-16-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
