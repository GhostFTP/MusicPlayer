// genre-limit-func.mjs — un género con más de 500 pistas ya no sale cortado (1.32.1).
//
// El detalle de un género y «Reproducir género» pedían `limit=500`: con más pistas, las de más allá
// no aparecían ni sonaban, sin aviso. Ahora piden 10000, como artistas y años.
//
// La biblioteca de la prueba no tiene un género tan grande, así que se FABRICA uno: la respuesta de
// GET /api/tracks?genre=… se intercepta y devuelve 700 pistas (las reales del género, repetidas con
// otros ids), recortadas al `limit` que haya pedido el cliente — igual que haría el servidor. La base
// no se toca.
//
// Comprueba, a 1440: el detalle pide sin el tope de 500 y muestra las 700; «Reproducir género» y
// «Agregar a la cola» del menú llevan las 700; arrastrar el género a la cola encola las 700.
// Con SNAP_REF (un build con el tope, p. ej. v1.32.0 en otro puerto): control negativo (ahí llegan
// 500). Sin SNAP_REF ese control NO se corre ni se cuenta, y se avisa.
// Uso: SNAP_BASE=http://localhost:4173 [SNAP_REF=http://localhost:4174] node genre-limit-func.mjs
import { preflight, BASE } from '../session.mjs';
import { preparar, sleep } from './tablet-util.mjs';

const REF = process.env.SNAP_REF ?? null;
const N = 700;
await preflight();
const { browser, abrir } = await preparar();
const R = {}; const ok = (k, v, extra = {}) => { R[k] = { ok: !!v, ...extra }; };

async function correr(base) {
  const o = await abrir(base, '/genres', { w: 1440, h: 900, esperar: '.main-content .genre-item' });
  const limites = [];
  await o.ctx.route((u) => u.pathname === '/api/tracks' && u.searchParams.has('genre'), async (r) => {
    const u = new URL(r.request().url()); const limit = Number(u.searchParams.get('limit') ?? 50); limites.push(limit);
    const res = await r.fetch(); const reales = await res.json();
    const falsas = []; for (let k = 0; falsas.length < N; k++) for (const t of reales) { if (falsas.length >= N) break; falsas.push({ ...t, id: t.id + k * 1_000_000 }); }
    r.fulfill({ response: res, body: JSON.stringify(falsas.slice(0, limit)) });
  });
  const tarjeta = o.p.locator('.main-content .genre-item').first();
  const cola = () => o.p.evaluate(() => window.__player().queue.length);
  const esperarCola = (n) => o.p.waitForFunction((n) => window.__player().queue.length >= n, n, { timeout: 8000 }).catch(() => {});
  const out = {};
  // menú → Reproducir género
  await tarjeta.click({ button: 'right' }); await o.esperarMenu();
  await o.p.locator('.ctx-menu .ctx-item', { hasText: 'Reproducir género' }).click(); await esperarCola(1); await sleep(500);
  out.reproducir = await cola();
  // menú → Agregar a la cola
  await tarjeta.click({ button: 'right' }); await o.esperarMenu();
  await o.p.locator('.ctx-menu .ctx-item', { hasText: 'Agregar a la cola' }).click(); await esperarCola(out.reproducir + 1); await sleep(500);
  out.agregar = (await cola()) - out.reproducir;
  // arrastre a la cola abierta
  await o.p.locator('.player-bar .action-btn[aria-label="Cola"]').click(); await o.p.waitForSelector('.queue-panel', { timeout: 3000 }).catch(() => {}); await sleep(400);
  const antes = await cola();
  await tarjeta.dragTo(o.p.locator('.queue-panel'), { timeout: 6000 }).catch(() => {}); await esperarCola(antes + 1); await sleep(500);
  out.arrastre = (await cola()) - antes;
  await o.p.locator('.player-bar .action-btn[aria-label="Cola"]').click(); await sleep(300);
  // el detalle
  const antesDet = limites.length;
  await tarjeta.click(); await o.p.waitForSelector('.main-content .track-row', { timeout: 6000 }).catch(() => {}); await sleep(700);
  out.limite_del_detalle = limites[antesDet] ?? null;
  out.filas = await o.p.evaluate(() => { const t = document.querySelector('.main-content [aria-rowcount]'); const n = t ? Number(t.getAttribute('aria-rowcount')) : null; return { montadas: document.querySelectorAll('.main-content .track-row').length, aria_rowcount: n }; });
  // lo que suena al tocar la primera fila: la cola es la lista del detalle
  await o.p.locator('.main-content .track-row').first().dblclick().catch(() => {}); await sleep(900);
  out.cola_al_tocar_una_fila = await cola();
  out.limites = limites; out.errores = o.errores;
  await o.ctx.close(); return out;
}

try {
  const r = await correr(BASE);
  ok('pide_sin_el_tope_de_500', r.limites.length >= 4 && r.limites.every((l) => l >= N), { limites_pedidos: r.limites });
  ok('reproducir_genero_lleva_todas', r.reproducir === N, { en_cola: r.reproducir, esperadas: N });
  ok('agregar_a_la_cola_lleva_todas', r.agregar === N, { agregadas: r.agregar, esperadas: N });
  ok('arrastrar_el_genero_lleva_todas', r.arrastre === N, { agregadas: r.arrastre, esperadas: N });
  ok('el_detalle_muestra_todas', r.cola_al_tocar_una_fila === N && !r.errores.length, { limite_pedido: r.limite_del_detalle, filas: r.filas, cola_al_tocar_una_fila: r.cola_al_tocar_una_fila, errores: r.errores });
  if (REF) { const f = await correr(REF); ok('control_ref_corta_en_500', f.reproducir === 500 && f.cola_al_tocar_una_fila === 500 && f.limites.every((l) => l === 500), { en_la_ref: { reproducir: f.reproducir, detalle: f.cola_al_tocar_una_fila, limites: f.limites } }); }
} catch (e) {
  ok('sin_excepciones', false, { error: String(e.message).split('\n')[0].slice(0, 200) });
}

const fails = Object.entries(R).filter(([, v]) => !v.ok);
console.log(JSON.stringify(R, null, 1));
console.log(REF ? `referencia (un build con el tope de 500): ${REF}` : 'SIN SNAP_REF: el control contra la referencia (control_ref_corta_en_500) NO se corrió ni se cuenta.');
console.log(`\ngenre-limit-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
