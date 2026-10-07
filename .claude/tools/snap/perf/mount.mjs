// mount.mjs — costo de MONTAR Biblioteca y Álbumes (con la lista ya en caché: sin red en el camino)
// y de hacer scroll en Biblioteca (Frente 1, sub-paso 7).
// Por entrada (3 al volver → mediana y rango): clic→filas pintadas, y el desglose del hilo principal
// con métricas de CDP: script (React), estilos, layout y "resto" (pintado, compositing, hit-test…).
// Nodos DOM: totales y por fila, con el desglose de una fila. Scroll: 3 s de scroll continuo →
// frames/s del hilo principal (trace), p95 del frame y long tasks.
// SCALE=1200|3000 multiplica /api/tracks (ids únicos) y /api/albums (nombres únicos).
// Uso: SNAP_BASE=http://localhost:4173 CPU=1 [GPU=1] [SCALE=3000] [EXTRA_CSS=...] node mount.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CPU = Number(process.env.CPU ?? 1);
const GPU = process.env.GPU === '1';
const SCALE = Number(process.env.SCALE ?? 0);
await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const args = [];
if (GPU) args.push('--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization');
const browser = await chromium.launch({ args });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript((t) => { localStorage.setItem('token', t); window.__lt = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: 'longtask', buffered: true }); } catch {} }, token);
if (process.env.EXTRA_CSS) ctx.on('page', (p) => p.on('load', () => p.addStyleTag({ content: process.env.EXTRA_CSS }).catch(() => {})));

let tracks = null, albums = null;
if (SCALE) {
  const H = { Authorization: `Bearer ${token}` };
  const real = await fetch(`${BASE}/api/tracks?limit=10000`, { headers: H }).then((r) => r.json());
  const realAlb = await fetch(`${BASE}/api/albums`, { headers: H }).then((r) => r.json());
  tracks = []; for (let k = 0; tracks.length < SCALE; k++) for (const t of real) { if (tracks.length >= SCALE) break; tracks.push({ ...t, id: t.id + k * 1_000_000 }); }
  const reps = Math.ceil(SCALE / real.length);
  albums = []; for (let k = 0; k < reps; k++) for (const a of realAlb) albums.push({ ...a, album: k ? `${a.album} · ${k}` : a.album });
  // la app pide '/api/albums?' (query vacía): se matchea por pathname
  await ctx.route((url) => { const u = new URL(url); return (u.pathname === '/api/tracks' && u.searchParams.get('limit') === '10000' && [...u.searchParams.keys()].length === 1) || u.pathname === '/api/albums'; },
    (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(new URL(r.request().url()).pathname === '/api/albums' ? albums : tracks) }));
}

const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const rng = (xs) => `${med(xs)} (${Math.min(...xs)}–${Math.max(...xs)})`;
const log = (...a) => console.log(`[cpu x${CPU}${GPU ? ' gpu' : ''} · ${SCALE || 680}]`, ...a);

await page.goto(BASE + '/artists');
await page.waitForSelector('.sidebar');
await page.waitForTimeout(1200);

async function enter(label, rowSel) {
  const m0 = await metrics();
  const r = await page.evaluate(async ([label, rowSel]) => {
    const btn = [...document.querySelectorAll('.sidebar button')].find((b) => b.textContent.trim().startsWith(label));
    window.__lt = [];
    const t0 = performance.now();
    btn.click();
    let t = null;
    await new Promise((res) => {
      const f = () => {
        const n = document.querySelectorAll(rowSel).length;
        if (n > 0 && !document.querySelector('.main-content .spinner')) { t = performance.now() - t0; return res(); }
        if (performance.now() - t0 > 30000) return res();
        requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
    // un frame más: que el frame con las filas termine de pintarse antes de leer métricas
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    return { ms: Math.round(t), lt: window.__lt.length, ltMax: Math.round(Math.max(0, ...window.__lt)) };
  }, [label, rowSel]);
  const m1 = await metrics();
  const d = (k) => Math.round((m1[k] - m0[k]) * 1000);
  r.script = d('ScriptDuration'); r.style = d('RecalcStyleDuration'); r.layout = d('LayoutDuration');
  r.task = d('TaskDuration'); r.resto = r.task - r.script - r.style - r.layout;
  return r;
}

const LIB = ['Biblioteca', '.library-tracks .track-row'];
const ALB = ['Álbumes', '.album-grid .album-card'];
// 1ª visita (llena la caché) y después 3 entradas "al volver"
await enter(...LIB); await enter(...ALB);
const lib = [], alb = [];
for (let k = 0; k < 3; k++) { lib.push(await enter(...LIB)); alb.push(await enter(...ALB)); }
for (const [name, rs] of [['Biblioteca montaje', lib], ['Álbumes montaje   ', alb]]) {
  log(`${name}: clic→pintado ${rng(rs.map((r) => r.ms))} ms · script ${med(rs.map((r) => r.script))} · estilos ${med(rs.map((r) => r.style))} · layout ${med(rs.map((r) => r.layout))} · resto(pintado/compositing) ${med(rs.map((r) => r.resto))} · LT ${med(rs.map((r) => r.lt))} (máx ${Math.max(...rs.map((r) => r.ltMax))})`);
}

// Nodos DOM (en Biblioteca)
await enter(...LIB);
const nodes = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.library-tracks .track-row')];
  const per = rows.map((r) => r.querySelectorAll('*').length + 1);
  const sample = rows.find((r) => r.querySelector('img')) ?? rows[0];
  const name = (n) => n.tagName.toLowerCase() + (typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\s+/).join('.') : '');
  return { total: document.querySelectorAll('*').length, filas: rows.length, enFilas: per.reduce((a, b) => a + b, 0), porFila: `${Math.min(...per)}–${Math.max(...per)}`, desglose: [sample, ...sample.querySelectorAll('*')].map(name) };
});
log(`nodos: total ${nodes.total} · filas ${nodes.filas} · en filas ${nodes.enFilas} · por fila ${nodes.porFila}`);
if (process.env.NODES) log('desglose de una fila:', nodes.desglose.join(' | '));
if (process.env.NODES) log('alturas:', JSON.stringify(await page.evaluate(() => { const r = document.querySelector('.library-tracks .track-row'); const c = r.querySelector('.track-info-cell'); return { fila: r.getBoundingClientRect().height, infoCell: c.getBoundingClientRect().height, infoCellAncho: c.getBoundingClientRect().width }; })));

// Scroll continuo 3 s en Biblioteca
const tracePath = join(tmpdir(), `mount-${process.pid}.json`);
const m0 = await metrics();
await browser.startTracing(page, { path: tracePath, categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'cc'] });
// Rueda REAL del mouse (no scrollTop desde JS, que obliga a scrollear en el hilo principal): el cursor
// queda sobre la tabla, como el de una persona, así que también cuentan los :hover de las filas.
await page.evaluate(() => { document.querySelector('.main-content').scrollTop = 0; window.__lt = []; window.__d = []; let last = performance.now(); window.__run = true; const f = (t) => { window.__d.push(t - last); last = t; if (window.__run) requestAnimationFrame(f); }; requestAnimationFrame(f); });
const box = await page.locator('.main-content').boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
const tEnd = Date.now() + 3000; let dir = 1, k = 0;
while (Date.now() < tEnd) { await page.mouse.wheel(0, 120 * dir); if (++k % 60 === 0) dir = -dir; await page.waitForTimeout(16); }
const sc = await page.evaluate(() => { window.__run = false; const d = window.__d.slice(1).sort((a, b) => a - b); return { frames: d.length, p50: +d[d.length >> 1].toFixed(1), p95: +d[Math.floor(d.length * 0.95)].toFixed(1), max: +d.at(-1).toFixed(1), lt: window.__lt.length, scrollTop: Math.round(document.querySelector('.main-content').scrollTop) }; });
await browser.stopTracing();
const m1 = await metrics();
const ev = JSON.parse(readFileSync(tracePath)).traceEvents;
const main = ev.find((e) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain');
const bmf = ev.filter((e) => e.name === 'ProxyMain::BeginMainFrame' && e.ph === 'X' && (!main || (e.pid === main.pid && e.tid === main.tid))).length;
rmSync(tracePath, { force: true });
log(`scroll 3 s: rAF ${(sc.frames / 3).toFixed(1)}/s · frames hilo principal ${(bmf / 3).toFixed(1)}/s · frame p50 ${sc.p50} / p95 ${sc.p95} / máx ${sc.max} ms · LT ${sc.lt} · hilo ocupado ${Math.round((m1.TaskDuration - m0.TaskDuration) * 1000)} ms`);
await browser.close();
