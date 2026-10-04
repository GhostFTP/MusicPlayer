// queue-cost.mjs — costo de la COLA con un mix grande (Frente 2, sub-paso M1). Solo medición.
// Escritorio 1440×900, build de producción. Biblioteca sintética con SCALE (ids únicos) y WAV de
// 15 min interceptado. Escenarios, en este orden, con una sola sesión:
//   1. mix con la cola CERRADA: clic en "Mix aleatorio" de Biblioteca → primer frame / 'playing'
//   2. abrir la cola (3 veces, cerrando entre medio): clic → fila actual pintada, nodos, LT
//   3. scroll continuo 3 s con la rueda sobre la cola: frames/s (trace) y LT
//   4. cambio de canción con la cola abierta: con aleatorio (lo deja encendido el mix) y sin él
//   5. tick: 5 s sonando con la cola abierta → filas re-renderizadas y hilo ocupado
//   6. quitar una pista de la cola y "Reproducir a continuación" desde Biblioteca
//   7. re-mix con la cola ABIERTA (el atajo M se puede apretar así)
//   8. cola cerrada: nodos y heap de JS antes del mix / después (con GC)
// Salida: una línea JSON por corrida (para agregar) + un resumen legible.
// Uso: SNAP_BASE=http://localhost:4173 CPU=1|4 [SCALE=3000] [EXTRA_CSS='...'] node queue-cost.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CPU = Number(process.env.CPU ?? 1);
const SCALE = Number(process.env.SCALE ?? 0);
await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

function wav(sec = 900, sr = 8000) {
  const n = sec * sr, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const WAV = wav();
await ctx.route('**/stream/**', (r) => {
  const h = r.request().headers().range; const total = WAV.length;
  if (!h) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV });
  const [, a, b] = h.match(/bytes=(\d*)-(\d*)/); const start = a ? +a : 0; const end = b ? +b : total - 1;
  r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: WAV.subarray(start, end + 1) });
});
if (SCALE) {
  const real = await fetch(`${BASE}/api/tracks?limit=10000`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  const tracks = []; for (let k = 0; tracks.length < SCALE; k++) for (const t of real) { if (tracks.length >= SCALE) break; tracks.push({ ...t, id: t.id + k * 1_000_000 }); }
  await ctx.route((url) => { const u = new URL(url); return u.pathname === '/api/tracks' && u.searchParams.get('limit') === '10000' && [...u.searchParams.keys()].length === 1; },
    (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tracks) }));
}
if (process.env.EXTRA_CSS) await ctx.addInitScript((css) => { window.__EXTRA_CSS = css; }, process.env.EXTRA_CSS);
await ctx.addInitScript((t) => {
  localStorage.setItem('token', t);
  window.__lt = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: 'longtask', buffered: true }); } catch {}
  window.__commits = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers: new Map(), inject() { return 1; },
    onCommitFiberRoot() { window.__commits++; }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {},
  };
  // EXTRA_CSS: variante de medición (CSS inyectado SOLO en la prueba, no en la app)
  if (window.__EXTRA_CSS) document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = window.__EXTRA_CSS; document.head.appendChild(st); });
  const A = window.Audio;
  window.Audio = function (...a) { const x = new A(...a); window.__audio = x; return x; };
}, token);

const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
const busy = async (fn) => { const m0 = await metrics(); const r = await fn(); const m1 = await metrics(); return { ...r, task: Math.round((m1.TaskDuration - m0.TaskDuration) * 1000) }; };
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); const h = await cdp.send('Runtime.getHeapUsage'); return +(h.usedSize / 1048576).toFixed(1); };
const R = { cpu: CPU, scale: SCALE || 680 };
const wait = (ms) => page.waitForTimeout(ms);
const QUEUE_BTN = '.player-bar [aria-label="Cola"]';

await page.goto(BASE + '/');
await page.waitForSelector('.library-tracks .track-row');
await wait(1800);

// ── 8a) antes del mix: heap y nodos ──
R.heapAntesMB = await heap();
R.nodosAntes = await page.evaluate(() => document.querySelectorAll('*').length);

// ── 1) mix con la cola cerrada ──
R.mixCerrada = await busy(() => page.evaluate(async () => {
  const btn = document.querySelector('.library-actions .mix-btn');
  window.__lt = [];
  const t0 = performance.now();
  let tPlaying = null;
  const playing = new Promise((res) => {
    const poll = () => { const a = window.__audio; if (a) { a.addEventListener('playing', () => { tPlaying = performance.now() - t0; res(); }, { once: true }); } else setTimeout(poll, 1); };
    poll(); setTimeout(res, 20000);
  });
  btn.click();
  // primer frame tras el clic = cuánto tarda la UI en responder
  const tFrame = await new Promise((r) => requestAnimationFrame(() => setTimeout(() => r(performance.now() - t0), 0)));
  await playing;
  await new Promise((r) => setTimeout(r, 300));
  return { clicFrame: Math.round(tFrame), clicPlaying: Math.round(tPlaying ?? -1), lt: window.__lt.length, ltMax: Math.round(Math.max(0, ...window.__lt)) };
}));

// ── 8b) cola cerrada con N pistas: nodos y heap ──
R.nodosColaCerrada = await page.evaluate(() => document.querySelectorAll('*').length);
R.filasColaCerrada = await page.evaluate(() => document.querySelectorAll('.queue-row').length);
R.heapDespuesMB = await heap();

// ── 2) abrir la cola (3 veces) ──
const openQueue = () => busy(() => page.evaluate(async (sel) => {
  window.__lt = [];
  const t0 = performance.now();
  document.querySelector(sel).click();
  await new Promise((res) => { const f = () => { if (document.querySelector('.queue-row.current') || performance.now() - t0 > 60000) return res(); requestAnimationFrame(f); }; requestAnimationFrame(f); });
  const t = performance.now() - t0;
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  return { ms: Math.round(t), lt: window.__lt.length, ltMax: Math.round(Math.max(0, ...window.__lt)) };
}, QUEUE_BTN));
const closeQueue = async () => { await page.click(QUEUE_BTN); await page.waitForSelector('.queue-panel', { state: 'detached' }); await wait(300); };
const opens = [];
for (let k = 0; k < 3; k++) { opens.push(await openQueue()); if (k < 2) await closeQueue(); }
R.abrir = { ms: med(opens.map((o) => o.ms)), msTodas: opens.map((o) => o.ms), task: med(opens.map((o) => o.task)), lt: med(opens.map((o) => o.lt)), ltMax: Math.max(...opens.map((o) => o.ltMax)) };
Object.assign(R, await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.queue-row')];
  const per = rows.slice(0, 50).map((r) => r.querySelectorAll('*').length + 1);
  const kicker = document.querySelector('.queue-kicker')?.textContent ?? '';
  const hs = rows.slice(0, 200).map((r) => Math.round(r.getBoundingClientRect().height * 10) / 10);
  return { nodosColaAbierta: document.querySelectorAll('*').length, filasCola: rows.length, nodosPorFila: `${Math.min(...per)}–${Math.max(...per)}`, altoFila: [...new Set(hs)].join('/'), kicker };
}));
await wait(500);

// ── 3) scroll continuo 3 s sobre la cola ──
{
  const tracePath = join(tmpdir(), `qcost-${process.pid}.json`);
  const m0 = await metrics();
  await browser.startTracing(page, { path: tracePath, categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'cc'] });
  await page.evaluate(() => { document.querySelector('.queue-body').scrollTop = 0; window.__lt = []; });
  const box = await page.locator('.queue-body').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const tEnd = Date.now() + 3000; let dir = 1, k = 0;
  while (Date.now() < tEnd) { await page.mouse.wheel(0, 120 * dir); if (++k % 60 === 0) dir = -dir; await page.waitForTimeout(16); }
  const lt = await page.evaluate(() => ({ n: window.__lt.length, max: Math.round(Math.max(0, ...window.__lt)) }));
  await browser.stopTracing();
  const m1 = await metrics();
  const ev = JSON.parse(readFileSync(tracePath)).traceEvents;
  const main = ev.find((e) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain');
  const bmf = ev.filter((e) => e.name === 'ProxyMain::BeginMainFrame' && e.ph === 'X' && (!main || (e.pid === main.pid && e.tid === main.tid))).length;
  rmSync(tracePath, { force: true });
  R.scroll = { fps: +(bmf / 3).toFixed(1), lt: lt.n, ltMax: lt.max, task: Math.round((m1.TaskDuration - m0.TaskDuration) * 1000) };
  await page.mouse.move(2, 2);
}

// ── re-renders de filas de la cola por una acción (identidad de __reactProps$) ──
const rerenders = (action, settleMs = 700) => busy(() => page.evaluate(async ([action, settleMs]) => {
  const nodes = [...document.querySelectorAll('.queue-row')];
  const key = (n) => Object.keys(n).find((k) => k.startsWith('__reactProps$'));
  const a = nodes.map((n) => n[key(n)]);
  const c0 = window.__commits; window.__lt = [];
  const t0 = performance.now();
  (0, eval)(action);
  const tFrame = await new Promise((r) => requestAnimationFrame(() => setTimeout(() => r(performance.now() - t0), 0)));
  await new Promise((r) => setTimeout(r, settleMs));
  const alive = nodes.filter((n) => n.isConnected);
  return { filas: nodes.filter((n, i) => n.isConnected && n[key(n)] !== a[i]).length, de: nodes.length, desmontadas: nodes.length - alive.length, commits: window.__commits - c0, frame: Math.round(tFrame), lt: window.__lt.length, ltMax: Math.round(Math.max(0, ...window.__lt)) };
}, [action, settleMs]));
const NEXT = "document.querySelector('.player-bar .ctrl-next').click()";
const pick = (xs) => ({ filas: med(xs.map((x) => x.filas)), de: xs[0].de, commits: med(xs.map((x) => x.commits)), frame: med(xs.map((x) => x.frame)), task: med(xs.map((x) => x.task)), lt: med(xs.map((x) => x.lt)), ltMax: Math.max(...xs.map((x) => x.ltMax)) });

// ── 4) cambio de canción: con aleatorio (encendido por el mix) y sin él ──
R.shuffleEncendido = await page.evaluate(() => document.querySelector('.player-bar .shuffle-btn')?.getAttribute('aria-pressed'));
{ const xs = []; for (let k = 0; k < 3; k++) xs.push(await rerenders(NEXT)); R.siguienteAleatorio = pick(xs); }
await page.click('.player-bar .shuffle-btn'); await wait(400);
{ const xs = []; for (let k = 0; k < 3; k++) xs.push(await rerenders(NEXT)); R.siguienteEnOrden = pick(xs); }

// ── 5) tick: 5 s sonando con la cola abierta ──
R.tick5s = await rerenders('void 0', 5000);

// ── 6a) quitar una pista (la 3ª después de la actual) ──
{
  const xs = [];
  for (let k = 0; k < 3; k++) {
    const idx = await page.evaluate(() => [...document.querySelectorAll('.queue-row')].findIndex((r) => r.classList.contains('current')) + 3);
    const row = page.locator('.queue-row').nth(idx);
    await row.scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await row.click({ button: 'right' });
    await page.waitForSelector('.ctx-menu [role="menuitem"]');
    await wait(250);
    xs.push(await rerenders("[...document.querySelectorAll('.ctx-menu [role=\"menuitem\"]')].find((b) => b.textContent.includes('Quitar')).click()"));
  }
  R.quitar = pick(xs);
}
// ── 6b) "Reproducir a continuación" desde una fila de Biblioteca ──
{
  const xs = [];
  for (let k = 0; k < 3; k++) {
    const row = page.locator('.library-tracks .track-row').nth(4 + k);
    await row.scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await row.click({ button: 'right' });
    await page.waitForSelector('.ctx-menu [role="menuitem"]');
    await wait(250);
    xs.push(await rerenders("[...document.querySelectorAll('.ctx-menu [role=\"menuitem\"]')].find((b) => b.textContent.includes('continuación')).click()"));
  }
  R.aContinuacion = pick(xs);
}

// ── 7) re-mix con la cola ABIERTA ──
R.mixAbierta = await busy(() => page.evaluate(async () => {
  window.__lt = [];
  const t0 = performance.now();
  document.querySelector('.library-actions .mix-btn').click();
  const tFrame = await new Promise((r) => requestAnimationFrame(() => setTimeout(() => r(performance.now() - t0), 0)));
  await new Promise((r) => setTimeout(r, 1500));
  return { clicFrame: Math.round(tFrame), lt: window.__lt.length, ltMax: Math.round(Math.max(0, ...window.__lt)) };
}));

console.log('JSON ' + JSON.stringify(R));
const f = (o) => Object.entries(o).map(([k, v]) => `${k} ${Array.isArray(v) ? v.join('/') : v}`).join(' · ');
console.log(`[cpu x${CPU} · ${R.scale}] cola: ${R.kicker} · filas ${R.filasCola} · nodos/fila ${R.nodosPorFila} · alto ${R.altoFila}`);
console.log(`  mix (cola cerrada): ${f(R.mixCerrada)}`);
console.log(`  abrir cola: ${f(R.abrir)} · nodos ${R.nodosAntes}→${R.nodosColaAbierta}`);
console.log(`  scroll 3 s: ${f(R.scroll)}`);
console.log(`  siguiente aleatorio: ${f(R.siguienteAleatorio)}`);
console.log(`  siguiente en orden : ${f(R.siguienteEnOrden)}`);
console.log(`  tick 5 s: ${f(R.tick5s)}`);
console.log(`  quitar: ${f(R.quitar)}`);
console.log(`  a continuación: ${f(R.aContinuacion)}`);
console.log(`  re-mix cola abierta: ${f(R.mixAbierta)}`);
console.log(`  cola cerrada: filas montadas ${R.filasColaCerrada} · nodos ${R.nodosColaCerrada} · heap ${R.heapAntesMB}→${R.heapDespuesMB} MB`);
await browser.close();
