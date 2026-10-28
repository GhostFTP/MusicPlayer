// buscar-escala.mjs — MIDE (no verifica) la búsqueda de /search con bibliotecas grandes y la compara con el
// buscador de la Biblioteca, con la MISMA sonda. La base local tiene ~680 pistas y producción ~1200+; para
// ver cómo escala se intercepta GET /api/tracks y se sirve la biblioteca real multiplicada con ids únicos
// (como pide perf-lab). Lo demás (álbumes, artistas, playlists, videos) es lo real.
//
// Sonda: desde el keydown hasta la ÚLTIMA mutación del DOM de .main-content (MutationObserver), esperando
// 400 ms de quietud por tecla. Incluye el render urgente y el diferido. Se teclea «gorillaz» y se borra
// letra por letra (16 teclas), 3 corridas por configuración → mediana por corrida y rango de las 3.
// Long tasks (>50 ms) del hilo principal durante el tecleo. También: carga en frío (de la navegación a la
// primera fila de Canciones). CPU 1x y 4x (4x ≈ teléfono). Software (sin GPU): no mide pintado real.
// Tamaños: 680 (la real, sin interceptar), 3000 y 10000.
// Uso: SNAP_BASE=http://localhost:4173 node buscar-escala.mjs [--runs 3] [--sizes 680,3000,10000]
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const RUNS = Number(arg('--runs', 3));
const SIZES = arg('--sizes', '680,3000,10000').split(',').map(Number);
const QUERY = 'gorillaz';

await preflight();
const token = await getToken();
const H = { Authorization: `Bearer ${token}` };
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const REAL = await fetch(`${BASE}/api/tracks?limit=100000`, { headers: H }).then((r) => r.json());

const synth = (n) => {
  const out = [];
  for (let k = 0; out.length < n; k++) for (const t of REAL) { if (out.length >= n) break; out.push({ ...t, id: t.id + k * 1_000_000 }); }
  return out;
};

async function run(view, size, cpu) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => localStorage.setItem('token', t), token);
  if (size !== REAL.length) {
    const all = synth(size);
    await ctx.route('**/api/tracks?*', (r) => {
      const u = new URL(r.request().url());
      const off = Number(u.searchParams.get('offset') ?? 0), lim = Number(u.searchParams.get('limit') ?? 50);
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(all.slice(off, off + lim)) });
    });
  }
  const p = await ctx.newPage();
  p.setDefaultTimeout(30000);
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  const search = view === 'search';
  const input = search ? '.search-view .sbx input' : '.section-header .search-box input';
  const rows = search ? '.search-group[data-group="songs"] tr.track-row' : '.library-tracks .track-row';

  const t0 = Date.now();
  await p.goto(BASE + (search ? '/search' : '/'));
  await p.locator(input).waitFor();
  if (search) await p.locator(input).fill('a');     // dispara la primera búsqueda para medir la carga en frío
  await p.locator(rows).first().waitFor();
  const cold = Date.now() - t0;
  if (search) { await p.locator(input).fill(''); await p.waitForTimeout(300); }

  await p.evaluate(() => {
    window.__m = { t0: 0, last: 0, lt: [] };
    document.addEventListener('keydown', () => { window.__m.t0 = performance.now(); window.__m.last = 0; }, true);
    new MutationObserver(() => { window.__m.last = performance.now(); }).observe(document.querySelector('.main-content'), { subtree: true, childList: true, characterData: true, attributes: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.lt.push(e.duration); }).observe({ entryTypes: ['longtask'] });
  });
  await p.locator(input).click();
  const samples = [];
  const keys = [...QUERY, ...Array(QUERY.length).fill('Backspace')];
  for (const k of keys) {
    await p.evaluate(() => { window.__m.last = 0; });
    await p.keyboard.press(k);
    await p.waitForTimeout(400);
    const ms = await p.evaluate(() => (window.__m.last ? window.__m.last - window.__m.t0 : 0));
    if (ms > 0) samples.push(ms);
  }
  const lt = await p.evaluate(() => window.__m.lt);
  await ctx.close();
  samples.sort((a, b) => a - b);
  const q = (f) => samples.length ? samples[Math.min(samples.length - 1, Math.floor(samples.length * f))] : null;
  return { cold, med: q(0.5), p95: q(0.95), max: samples.at(-1) ?? null, n: samples.length, lt: lt.length, ltMax: lt.length ? Math.max(...lt) : 0 };
}

const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const fmt = (a) => `${Math.round(med(a))} (${Math.round(Math.min(...a))}–${Math.round(Math.max(...a))})`;
const rowsOut = [];
for (const size of SIZES) for (const cpu of [1, 4]) for (const view of ['library', 'search']) {
  const rs = [];
  for (let i = 0; i < RUNS; i++) rs.push(await run(view, size, cpu));
  const row = { size, cpu, view, cold: fmt(rs.map((r) => r.cold)), tecla_med: fmt(rs.map((r) => r.med ?? 0)), tecla_p95: fmt(rs.map((r) => r.p95 ?? 0)), max: Math.round(Math.max(...rs.map((r) => r.max ?? 0))), longtasks: rs.map((r) => r.lt).join('/'), ltMax: Math.round(Math.max(...rs.map((r) => r.ltMax))) };
  rowsOut.push(row);
  console.log(`${String(size).padStart(6)} · ${cpu}x · ${view.padEnd(7)} · carga en frío ${row.cold} ms · tecla mediana ${row.tecla_med} ms · p95 ${row.tecla_p95} ms · máx ${row.max} ms · long tasks ${row.longtasks} (máx ${row.ltMax} ms)`);
}
console.log('\n(ms; en paréntesis el rango de las corridas · corridas por configuración:', RUNS, '· teclas por corrida:', QUERY.length * 2, ')');
await browser.close();
