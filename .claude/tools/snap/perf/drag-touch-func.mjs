// drag-touch-func.mjs — un arrastre que nace de un TOQUE no levanta nada; con ratón sigue igual (1.32.1).
//
// Sobre algo `draggable`, iPadOS arranca su propio arrastre con la pulsación larga y le gana al menú.
// DragQueueContext recuerda con qué se hizo el último pointerdown y cancela el `dragstart` cuando fue
// un dedo o un lápiz. Se decide por gesto, no por dispositivo: el ratón o el trackpad arrastran igual
// que antes, también en una tablet.
//
// ⚠️ La parte del toque es SINTÉTICA: los navegadores de escritorio no arrancan un arrastre nativo
// desde un toque, así que se despacha el pointerdown (touch / pen / mouse) y después un `dragstart`
// sobre la tarjeta, y se mira si salió cancelado. El arrastre del sistema de iPadOS no se puede
// probar acá: requiere un iPad real.
//
// Comprueba, a 1440 con ratón:
//   · tras un pointerdown de dedo o de lápiz, el dragstart sale cancelado (género, álbum, fila, año);
//   · tras uno de ratón, no;
//   · el arrastre REAL con ratón sigue encolando: un género a la cola abierta y un año a la barra;
//   · después de un toque, el siguiente arrastre con ratón vuelve a funcionar.
// En la tablet (1280 con dedo): las tarjetas siguen siendo `draggable` (no se apaga por media query)
// y el dragstart que nace de un toque sale cancelado.
// Con SNAP_REF (un build sin esto, p. ej. v1.32.0 en otro puerto): control negativo. Sin SNAP_REF ese
// control NO se corre ni se cuenta, y se avisa. Sólo lee: no escribe nada en la base.
// Uso: SNAP_BASE=http://localhost:4173 [SNAP_REF=http://localhost:4174] node drag-touch-func.mjs
import { preflight, BASE } from '../session.mjs';
import { preparar, sleep, same } from './tablet-util.mjs';

const REF = process.env.SNAP_REF ?? null;
await preflight();
const { token, browser, abrir } = await preparar();
const R = {}; const ok = (k, v, extra = {}) => { R[k] = { ok: !!v, ...extra }; };
const H = { Authorization: `Bearer ${token}` };

// pointerdown del tipo dado + dragstart sobre el elemento: ¿salió cancelado?
const probar = (loc, tipo) => loc.evaluate((el, tipo) => {
  const b = el.getBoundingClientRect(); const x = b.left + Math.min(40, b.width / 2), y = b.top + b.height / 2;
  const o = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: tipo === 'mouse' ? 1 : 7, pointerType: tipo, isPrimary: true, button: 0, buttons: 1 };
  el.dispatchEvent(new PointerEvent('pointerdown', o));
  const ev = new DragEvent('dragstart', { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, dataTransfer: new DataTransfer() });
  el.dispatchEvent(ev);
  el.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
  el.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
  document.querySelectorAll('.dq-ghost').forEach((g) => g.remove());
  return { draggable: el.getAttribute('draggable'), cancelado: ev.defaultPrevented };
}, tipo);
const SUP = [['genero', '/genres', '.main-content .genre-item'], ['album', '/albums', '.main-content .album-grid .album-card'], ['fila', '/', '.library-tracks .track-row'], ['anio', '/years', '.main-content .browse-list .browse-item']];

try {
  for (const [clave, ruta, sel] of SUP) {
    const o = await abrir(BASE, ruta, { w: 1440, h: 900, esperar: sel });
    const el = o.p.locator(sel).first();
    const t = await probar(el, 'touch'), l = await probar(el, 'pen'), m = await probar(el, 'mouse');
    ok(`toque_no_levanta_${clave}`, t.draggable === 'true' && t.cancelado && l.cancelado, { draggable: t.draggable, dedo_cancelado: t.cancelado, lapiz_cancelado: l.cancelado });
    ok(`raton_si_levanta_${clave}`, m.draggable === 'true' && !m.cancelado && !o.errores.length, { draggable: m.draggable, raton_cancelado: m.cancelado, errores: o.errores });
    await o.ctx.close();
  }
  // El arrastre real con ratón sigue encolando.
  {
    const o = await abrir(BASE, '/genres', { w: 1440, h: 900, esperar: '.main-content .genre-item' });
    const tarjeta = o.p.locator('.main-content .genre-item').first(); const genero = (await tarjeta.locator('.browse-item-name').textContent()).trim();
    const delGenero = (await (await fetch(`${BASE}/api/tracks?${new URLSearchParams({ genre: genero, limit: 100000 })}`, { headers: H })).json()).map((t) => t.id);
    await o.p.locator('.player-bar .action-btn[aria-label="Cola"]').click(); await o.p.waitForSelector('.queue-panel', { timeout: 3000 }).catch(() => {}); await sleep(400);
    // antes, un toque (sintético) en otra tarjeta: el ratón tiene que volver a mandar
    await probar(o.p.locator('.main-content .genre-item').nth(1), 'touch');
    await tarjeta.dragTo(o.p.locator('.queue-panel'), { timeout: 6000 }).catch(() => {});
    await o.p.waitForFunction((n) => window.__player().queue.length === n, delGenero.length, { timeout: 6000 }).catch(() => {}); await sleep(300);
    const e = await o.estado();
    ok('raton_arrastra_un_genero_a_la_cola_tras_un_toque', same(e.ids, delGenero), { genero, en_cola: e.ids.length, esperadas: delGenero.length });
    await o.p.goto(BASE + '/years'); await o.p.waitForSelector('.main-content .browse-list .browse-item'); await sleep(400);
    const fila = o.p.locator('.main-content .browse-list .browse-item').last(); const anio = Number((await fila.locator('.browse-item-name').textContent()).trim());
    const delAnio = (await (await fetch(`${BASE}/api/tracks?limit=100000`, { headers: H })).json()).filter((t) => t.year === anio).map((t) => t.id);
    await fila.dragTo(o.p.locator('.player-bar .player-progress'), { timeout: 6000 }).catch(() => {});
    await o.p.waitForFunction((n) => window.__player().queue.length === n, delAnio.length, { timeout: 6000 }).catch(() => {}); await sleep(300);
    const e2 = await o.estado();
    ok('raton_arrastra_un_anio_a_la_barra', same(e2.ids, delAnio) && e2.ruta === '/years', { anio, en_cola: e2.ids.length, esperadas: delAnio.length });
    await o.ctx.close();
  }
  // La tablet: sigue siendo draggable y el toque no levanta.
  {
    const o = await abrir(BASE, '/genres', { w: 1280, h: 800, tactil: true, esperar: '.main-content .genre-item' });
    const t = await probar(o.p.locator('.main-content .genre-item').first(), 'touch'); const m = await probar(o.p.locator('.main-content .genre-item').first(), 'mouse');
    ok('tablet_sigue_draggable_y_el_toque_no_levanta', t.draggable === 'true' && t.cancelado && !m.cancelado, { draggable: t.draggable, dedo_cancelado: t.cancelado, trackpad_o_raton_cancelado: m.cancelado });
    await o.ctx.close();
  }
  if (REF) {
    const o = await abrir(REF, '/genres', { w: 1440, h: 900, esperar: '.main-content .genre-item' });
    const t = await probar(o.p.locator('.main-content .genre-item').first(), 'touch');
    ok('control_ref_el_toque_levanta', t.draggable === 'true' && !t.cancelado, { en_la_ref: t });
    await o.ctx.close();
  }
} catch (e) {
  ok('sin_excepciones', false, { error: String(e.message).split('\n')[0].slice(0, 200) });
}

const fails = Object.entries(R).filter(([, v]) => !v.ok);
console.log(JSON.stringify(R, null, 1));
console.log(REF ? `referencia (un build donde el toque levanta el arrastre): ${REF}` : 'SIN SNAP_REF: el control contra la referencia (control_ref_el_toque_levanta) NO se corrió ni se cuenta.');
console.log(`\ndrag-touch-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
