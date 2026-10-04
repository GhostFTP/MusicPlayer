// search.mjs — velocidad de la búsqueda de la Biblioteca (Frente 1, sub-paso 4).
// Mide por consulta (3 repeticiones → mediana y rango): tecla→tabla asentada (último cambio del DOM
// de .main-content tras teclear), requests a /api/tracks, long tasks y commits de React, e IDENTIDAD
// de nodos (¿el <tbody> es el mismo? ¿las filas que siguen coincidiendo son los mismos nodos?).
// Además: latencia del input con teclado REAL (5 letras seguidas): keydown → valor pintado.
// SCALE=1200|3000 intercepta /api/tracks y multiplica la biblioteca real con ids únicos (y, para el
// baseline, simula `search` con la semántica del LIKE del servidor: subcadena, mayúsculas ASCII).
// Uso: SNAP_BASE=http://localhost:4173 CPU=1 [SCALE=3000] node search.mjs
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
  window.__lt = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: 'longtask', buffered: true }); } catch {}
  window.__commits = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers: new Map(), inject() { return 1; },
    onCommitFiberRoot() { window.__commits++; }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {},
  };
}, token);

// Biblioteca sintética (sólo si SCALE): la real repetida con ids únicos.
let synth = null;
if (SCALE) {
  const real = await fetch(`${BASE}/api/tracks?limit=10000`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  synth = [];
  for (let k = 0; synth.length < SCALE; k++) for (const t of real) { if (synth.length >= SCALE) break; synth.push({ ...t, id: t.id + k * 1_000_000 }); }
  const likeCI = (s, q) => (s ?? '').replace(/[A-Z]/g, (c) => c.toLowerCase()).includes(q.replace(/[A-Z]/g, (c) => c.toLowerCase()));
  await ctx.route('**/api/tracks?*', (r) => {
    const u = new URL(r.request().url());
    if (u.pathname !== '/api/tracks') return r.fallback();
    const keys = [...u.searchParams.keys()].filter((k) => k !== 'limit' && k !== 'search');
    if (keys.length) return r.fallback();                       // album/genre/...: al servidor real
    const q = u.searchParams.get('search');
    const body = q ? synth.filter((t) => likeCI(t.title, q) || likeCI(t.artist, q) || likeCI(t.album, q)) : synth;
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
let reqs = 0;
page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname === '/api/tracks') reqs++; });
const ROWS = '.library-tracks .track-row';
await page.goto(BASE + '/');
await page.waitForSelector(ROWS, { timeout: 30000 });
await page.waitForTimeout(2500);
const total = await page.locator(ROWS).count();
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const log = (...a) => console.log(`[cpu x${CPU}${SCALE ? ` · ${SCALE} pistas` : ''}]`, ...a);
log(`${BASE} · filas iniciales: ${total}`);

async function clearAndSettle() {
  await page.fill('.search-box input', '');
  await page.waitForFunction((n) => document.querySelectorAll('.library-tracks .track-row').length === n, total, { timeout: 30000 });
  await page.waitForTimeout(800);
}

// Teclea `q` (eventos input, como un tecleo rápido) y espera a que .main-content quede 1.5 s quieto.
async function measure(q) {
  await clearAndSettle();
  const r0 = reqs;
  const res = await page.evaluate(async (q) => {
    const main = document.querySelector('.main-content');
    const tb0 = document.querySelector('.library-tracks tbody');
    const rows0 = new Set(document.querySelectorAll('.library-tracks .track-row'));
    window.__lt = []; const c0 = window.__commits;
    let last = performance.now();
    const mo = new MutationObserver(() => { last = performance.now(); });
    mo.observe(main, { childList: true, subtree: true, characterData: true });
    const inp = document.querySelector('.search-box input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const t0 = performance.now();
    for (const ch of q) { setter.call(inp, inp.value + ch); inp.dispatchEvent(new Event('input', { bubbles: true })); }
    await new Promise((res) => {
      const tick = () => (performance.now() - last > 1500 ? res() : setTimeout(tick, 100));
      setTimeout(tick, 100);
    });
    mo.disconnect();
    const rows = [...document.querySelectorAll('.library-tracks .track-row')];
    const tb1 = document.querySelector('.library-tracks tbody');
    return {
      ms: Math.round(last - t0),
      filas: rows.length,
      mismoTbody: tb0 === tb1,
      filasConservadas: rows.filter((r) => rows0.has(r)).length,
      commits: window.__commits - c0,
      lt: window.__lt.length, ltMax: Math.round(Math.max(0, ...window.__lt)),
    };
  }, q);
  res.reqs = reqs - r0;
  return res;
}

for (const q of ['d', 'da', 'daf']) {
  const runs = [];
  for (let k = 0; k < 3; k++) runs.push(await measure(q));
  const ms = runs.map((r) => r.ms);
  const r = runs[runs.length - 1];
  log(`"${q}": tecla→tabla mediana ${med(ms)} ms (rango ${Math.min(...ms)}–${Math.max(...ms)}) · filas ${r.filas} · reqs/búsqueda ${med(runs.map((x) => x.reqs))} · LT ${med(runs.map((x) => x.lt))} (máx ${Math.max(...runs.map((x) => x.ltMax))} ms) · commits ${med(runs.map((x) => x.commits))} · mismo <tbody> ${r.mismoTbody} · filas que conservan su nodo ${r.filasConservadas}/${r.filas}`);
}

// Latencia del input con teclado REAL: 5 letras seguidas sin pausa.
const lat = [];
for (let k = 0; k < 3; k++) {
  await clearAndSettle();
  await page.focus('.search-box input');
  await page.evaluate(() => {
    window.__lat = []; window.__lt = []; window.__c0 = window.__commits;
    const inp = document.querySelector('.search-box input');
    const pending = [];
    inp.addEventListener('keydown', (e) => pending.push(e.timeStamp), { capture: true });
    inp.addEventListener('input', () => {
      const t = pending.shift();
      // "pintado": el frame siguiente al input ya pasó por render+paint cuando corre el setTimeout.
      requestAnimationFrame(() => setTimeout(() => window.__lat.push(performance.now() - t), 0));
    });
  });
  await page.keyboard.type('metal', { delay: 0 });
  await page.waitForTimeout(2500);
  lat.push(await page.evaluate(() => ({ lat: window.__lat, lt: window.__lt.length, ltMax: Math.round(Math.max(0, ...window.__lt)), commits: window.__commits - window.__c0, valor: document.querySelector('.search-box input').value })));
}
const all = lat.flatMap((x) => x.lat);
log(`teclado real "metal" ×3: keydown→valor pintado mediana ${med(all).toFixed(1)} ms · máx ${Math.max(...all).toFixed(1)} ms · commits/tecla ${(med(lat.map((x) => x.commits)) / 5).toFixed(1)} · LT ${med(lat.map((x) => x.lt))} (máx ${Math.max(...lat.map((x) => x.ltMax))} ms) · valor final "${lat[0].valor}"`);
await browser.close();
