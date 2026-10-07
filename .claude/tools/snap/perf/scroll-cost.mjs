// scroll-cost.mjs — costo del LISTENER de scroll de la ventana (Frente 1, sub-paso 9), aislado.
// Envuelve en la página los listeners de 'scroll' de .main-content y los requestAnimationFrame que
// piden: mide cuánto tarda cada uno (el rAF incluye compute + flushSync + render de las filas que
// entran) durante 3 s de rueda real. Uso: SNAP_BASE=http://localhost:4173 CPU=1 [SCALE=3000] node scroll-cost.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';

const CPU = Number(process.env.CPU ?? 1);
const SCALE = Number(process.env.SCALE ?? 0);
await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript((t) => {
  localStorage.setItem('token', t);
  window.__h = []; window.__r = [];
  let inScroll = false;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => (inScroll
    ? raf((ts) => { const t0 = performance.now(); try { cb(ts); } finally { window.__r.push(performance.now() - t0); } })
    : raf(cb));
  const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (type === 'scroll' && this instanceof Element && this.classList?.contains('main-content') && typeof fn === 'function') {
      const wrapped = function (e) { const t0 = performance.now(); inScroll = true; try { return fn.call(this, e); } finally { inScroll = false; window.__h.push(performance.now() - t0); } };
      return add.call(this, type, wrapped, opts);
    }
    return add.call(this, type, fn, opts);
  };
}, token);
if (SCALE) {
  const real = await fetch(`${BASE}/api/tracks?limit=10000`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  const tracks = []; for (let k = 0; tracks.length < SCALE; k++) for (const t of real) { if (tracks.length >= SCALE) break; tracks.push({ ...t, id: t.id + k * 1_000_000 }); }
  await ctx.route((url) => { const u = new URL(url); return u.pathname === '/api/tracks' && u.searchParams.get('limit') === '10000' && [...u.searchParams.keys()].length === 1; },
    (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tracks) }));
}
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
await page.goto(BASE + '/');
await page.waitForSelector('.library-tracks .track-row');
await page.waitForTimeout(1500);
await page.evaluate(() => { window.__h = []; window.__r = []; });
const box = await page.locator('.main-content').boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
const tEnd = Date.now() + 3000; let dir = 1, k = 0;
while (Date.now() < tEnd) { await page.mouse.wheel(0, 120 * dir); if (++k % 60 === 0) dir = -dir; await page.waitForTimeout(16); }
const r = await page.evaluate(() => {
  const st = (xs) => { const s = [...xs].sort((a, b) => a - b); const sum = s.reduce((a, b) => a + b, 0); return { n: s.length, totalMs: +sum.toFixed(1), p50: +(s[s.length >> 1] ?? 0).toFixed(3), p95: +(s[Math.floor(s.length * 0.95)] ?? 0).toFixed(2), max: +(s.at(-1) ?? 0).toFixed(2) }; };
  return { handler: st(window.__h), rafVentana: st(window.__r) };
});
console.log(`[cpu x${CPU} · ${SCALE || 680}] listener de scroll (3 s): handler ${JSON.stringify(r.handler)} · rAF de la ventana (compute+render) ${JSON.stringify(r.rafVentana)}`);
await browser.close();
