// album-grid-cost.mjs — costo de la vista Álbumes (/albums) según cuántas tarjetas tenga: montaje
// (clic en la sidebar desde Biblioteca → tarjetas pintadas, y hasta que no quedan animaciones),
// nodos DOM, carátulas pedidas (al montar y tras scrollear al final), scroll 3 s y hilo ocupado quieto.
// Uso: SNAP_BASE=http://localhost:4273 CPU=1|4 N=48|240|1000 [STAGGER=1] [RUNS=3] node album-grid-cost.mjs
//   N>48 intercepta GET /api/albums con la lista real repetida (nombres únicos). STAGGER=1 inyecta en la
//   grilla la entrada escalonada de AlbumGrid (emoji-pop + 24 ms × índice) para ver cuánto estorba.
//   EXTRA_CSS="…" inyecta CSS (p. ej. Mosaico denso); UNIQUE_COVERS=1 da a cada sintético una carátula distinta (red real).
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CPU = Number(process.env.CPU ?? 1);
const N = Number(process.env.N ?? 48);
const RUNS = Number(process.env.RUNS ?? 3);
const STAGGER = process.env.STAGGER === '1';
const LIGHT = process.env.LIGHT === '1';   // sólo montaje (sin scroll/quieto)
const EXTRA_CSS = process.env.EXTRA_CSS ?? '';   // p. ej. grilla densa (Mosaico simulado)
const UNIQUE = process.env.UNIQUE_COVERS === '1'; // sintéticos con sample_track_id distinto (carátulas que NO salen de caché)
await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();

const H = { Authorization: `Bearer ${token}` };
const realAlb = await fetch(`${BASE}/api/albums`, { headers: H }).then((r) => r.json());
let albums = null;
if (N !== realAlb.length) {
  albums = [];
  for (let k = 0; albums.length < N; k++) for (const a of realAlb) { if (albums.length >= N) break; albums.push({ ...a, album: k ? `${a.album} · ${k}` : a.album }); }
  if (UNIQUE) { const tr = await fetch(`${BASE}/api/tracks?limit=10000`, { headers: H }).then((r) => r.json()); albums.forEach((a, i) => { if (i >= realAlb.length) a.sample_track_id = tr[i % tr.length].id; }); }
}

// La misma regla que AlbumGrid (main.css .album-grid-anim .album-card), aplicada a la grilla de Albums.jsx.
const STAGGER_CSS = `.album-grid .album-card { animation: emoji-pop .34s cubic-bezier(.34, 1.42, .5, 1) backwards; animation-delay: calc(var(--i, 0) * 24ms); }`;

const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const rng = (xs) => `${med(xs)} (${Math.min(...xs)}–${Math.max(...xs)})`;
const tag = `[cpu x${CPU} · N=${N}${STAGGER ? ' · stagger' : ''}${EXTRA_CSS ? ' · css' : ''}${UNIQUE ? ' · únicas' : ''}]`;

async function traceFrames(browser, page, fn, secs) {
  const p = join(tmpdir(), `agc-${process.pid}-${Date.now()}.json`);
  await browser.startTracing(page, { path: p, categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'cc'] });
  await fn();
  await browser.stopTracing();
  const ev = JSON.parse(readFileSync(p)).traceEvents;
  rmSync(p, { force: true });
  const main = ev.find((e) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain');
  const bmf = ev.filter((e) => e.name === 'ProxyMain::BeginMainFrame' && e.ph === 'X' && (!main || (e.pid === main.pid && e.tid === main.tid))).length;
  return +(bmf / secs).toFixed(1);
}

async function run() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(([t, stagger]) => {
    localStorage.setItem('token', t);
    window.__lt = [];
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: 'longtask', buffered: true }); } catch {}
    if (stagger) {
      // --i por índice, puesto antes del primer pintado (MutationObserver = microtarea), como el style inline de AlbumGrid
      new MutationObserver(() => { const g = document.querySelector('.album-grid'); if (!g || g.__i) return; g.__i = 1; [...g.children].forEach((c, i) => c.style.setProperty('--i', i)); })
        .observe(document, { childList: true, subtree: true });
    }
  }, [token, STAGGER]);
  if (albums) {
    const body = JSON.stringify(albums);
    await ctx.route((url) => new URL(url).pathname === '/api/albums', (r) => r.fulfill({ status: 200, contentType: 'application/json', body }));
  }
  let covers = 0;
  ctx.on('request', (r) => { if (r.url().includes('/cover')) covers++; });

  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));

  await page.goto(BASE + '/library');
  await page.waitForSelector('.library-tracks .track-row', { timeout: 60000 });
  if (STAGGER) await page.addStyleTag({ content: STAGGER_CSS });
  if (EXTRA_CSS) await page.addStyleTag({ content: EXTRA_CSS });
  await page.waitForTimeout(1500);

  // ── 1. Montaje (1ª visita: incluye el fetch de /api/albums) ──
  // Fase A: clic → tarjetas pintadas. Fase B ("post"): desde ahí hasta que no quedan animaciones en la
  // grilla, con un piso de 5 s — trace para frames/s y TaskDuration del hilo en esa ventana.
  const enter = async () => {
    const m0 = await metrics();
    const r = await page.evaluate(async () => {
      const btn = [...document.querySelectorAll('.sidebar button')].find((b) => b.textContent.trim().startsWith('Álbumes'));
      window.__lt = [];
      const t0 = performance.now();
      btn.click();
      await new Promise((res) => {
        const f = () => {
          if (document.querySelectorAll('.album-grid .album-card').length > 0 && !document.querySelector('.main-content .spinner')) return res();
          if (performance.now() - t0 > 60000) return res();
          requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      });
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      window.__t0 = t0;
      const lt1 = [...window.__lt]; window.__lt = [];
      // sólo las de la grilla: la barra/sidebar tienen animaciones infinitas propias
      const anim0 = document.getAnimations().filter((a) => a.effect?.target?.closest?.('.album-grid')).length;
      return { ms: Math.round(performance.now() - t0), anim0, cards: document.querySelectorAll('.album-grid .album-card').length, lt: lt1.length, ltMax: Math.round(Math.max(0, ...lt1)) };
    });
    const m1 = await metrics();
    r.task = Math.round((m1.TaskDuration - m0.TaskDuration) * 1000);
    let post;
    const tr0 = Date.now();
    const fpsRaw = await traceFrames(browser, page, async () => {
      post = await page.evaluate(async () => {
        const t1 = performance.now();
        const inGrid = (a) => a.effect?.target?.closest?.('.album-grid');
        let tAnim = null;
        while (performance.now() - t1 < 60000) {
          const busy = document.getAnimations().some((a) => inGrid(a) && (a.playState === 'running' || a.pending));
          if (!busy && tAnim == null) tAnim = performance.now();
          if (!busy && performance.now() - t1 >= 5000) break;
          await new Promise((r) => setTimeout(r, 50));
        }
        return { msAnim: Math.round((tAnim ?? performance.now()) - window.__t0), lt: window.__lt.length, ltMax: Math.round(Math.max(0, ...window.__lt)) };
      });
    }, 1);
    const secs = (Date.now() - tr0) / 1000;
    const m2 = await metrics();
    r.msAnim = post.msAnim; r.postLt = post.lt; r.postLtMax = post.ltMax;
    r.postSecs = +secs.toFixed(1);
    r.postFps = +(fpsRaw / secs).toFixed(1);
    r.postTaskPerS = Math.round((m2.TaskDuration - m1.TaskDuration) * 1000 / secs);
    return r;
  };
  const coversBefore = covers;
  const first = await enter();
  first.coversMount = covers - coversBefore;
  first.imgs = await page.evaluate(() => { const i = [...document.querySelectorAll('.album-grid img')]; return { n: i.length, complete: i.filter((x) => x.complete && x.naturalWidth > 0).length }; });

  // nodos
  first.nodes = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.album-grid .album-card')];
    const per = cards.map((c) => c.querySelectorAll('*').length + 1);
    const vr = document.querySelector('.main-content').getBoundingClientRect(); const vis = cards.filter((c) => { const b = c.getBoundingClientRect(); return b.bottom > vr.top && b.top < vr.bottom; }).length;
    return { vis, total: document.querySelectorAll('*').length, porTarjeta: `${Math.min(...per)}–${Math.max(...per)}`, enTarjetas: per.reduce((a, b) => a + b, 0) };
  });

  if (!LIGHT) {
    // ── scrollear hasta el final (carátulas lazy), antes de salir de la vista ──
    const cBefore = covers;
    await page.evaluate(async () => { const m = document.querySelector('.main-content'); while (m.scrollTop + m.clientHeight < m.scrollHeight - 2) { m.scrollTop += 700; await new Promise((r) => setTimeout(r, 60)); } });
    await page.waitForTimeout(2500);
    first.coversScrollEnd = covers - cBefore;
    first.imgsEnd = await page.evaluate(() => { const i = [...document.querySelectorAll('.album-grid img')]; return { n: i.length, complete: i.filter((x) => x.complete && x.naturalWidth > 0).length }; });
    await page.evaluate(() => { document.querySelector('.main-content').scrollTop = 0; });
  }

  // 2ª visita (vuelta desde Biblioteca, lista ya en la caché de vistas)
  await page.evaluate(() => [...document.querySelectorAll('.sidebar button')].find((b) => b.textContent.trim().startsWith('Biblioteca')).click());
  await page.waitForSelector('.library-tracks .track-row');
  await page.waitForTimeout(800);
  const back = await enter();

  if (!LIGHT) {
    // ── 5 s después del montaje ya están contemplados en msAnim; ahora scroll 3 s ──
    await page.waitForTimeout(1000);
    await page.evaluate(() => { document.querySelector('.main-content').scrollTop = 0; });
    await page.waitForTimeout(500);
    const box = await page.locator('.main-content').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const s0 = await metrics();
    await page.evaluate(() => { window.__lt = []; });
    const fps = await traceFrames(browser, page, async () => {
      const tEnd = Date.now() + 3000; let dir = 1, k = 0;
      while (Date.now() < tEnd) { await page.mouse.wheel(0, 120 * dir); if (++k % 60 === 0) dir = -dir; await page.waitForTimeout(16); }
    }, 3);
    const s1 = await metrics();
    first.scroll = { fps, lt: await page.evaluate(() => window.__lt.length), ltMax: await page.evaluate(() => Math.round(Math.max(0, ...window.__lt))), task: Math.round((s1.TaskDuration - s0.TaskDuration) * 1000) };

    // ── quieto 5 s ──
    await page.mouse.move(5, 5);
    await page.waitForTimeout(2000);
    const q0 = await metrics();
    const qfps = await traceFrames(browser, page, () => page.waitForTimeout(5000), 5);
    const q1 = await metrics();
    first.idle = { task: Math.round((q1.TaskDuration - q0.TaskDuration) * 1000), fps: qfps };

  }
  await browser.close();
  return { first, back };
}

const rs = [];
for (let k = 0; k < RUNS; k++) rs.push(await run());
const F = rs.map((r) => r.first), B = rs.map((r) => r.back);
console.log(tag, `tarjetas ${F[0].cards} · animaciones al pintar ${F[0].anim0}`);
for (const [lbl, X] of [['1ª visita', F], ['vuelta   ', B]]) {
  console.log(tag, `${lbl}: clic→pintado ${rng(X.map((r) => r.ms))} ms · hilo ${rng(X.map((r) => r.task))} ms · LT ${rng(X.map((r) => r.lt))} máx ${rng(X.map((r) => r.ltMax))}`);
  console.log(tag, `${lbl}: post (≥5 s, hasta sin animaciones) →sin anim ${rng(X.map((r) => r.msAnim))} ms · ventana ${rng(X.map((r) => r.postSecs))} s · hilo ${rng(X.map((r) => r.postTaskPerS))} ms/s · frames ${rng(X.map((r) => r.postFps))}/s · LT ${rng(X.map((r) => r.postLt))} máx ${rng(X.map((r) => r.postLtMax))}`);
}
console.log(tag, `visibles ${F[0].nodes.vis} · nodos: total ${F[0].nodes.total} · por tarjeta ${F[0].nodes.porTarjeta} · en tarjetas ${F[0].nodes.enTarjetas}`);
console.log(tag, `carátulas: req al montar ${rng(F.map((r) => r.coversMount))} · <img> ${F[0].imgs.n} (complete ${rng(F.map((r) => r.imgs.complete))})`);
if (!LIGHT) {
  console.log(tag, `carátulas tras scroll al final: +${rng(F.map((r) => r.coversScrollEnd))} req · <img> ${F[0].imgsEnd.n} (complete ${rng(F.map((r) => r.imgsEnd.complete))})`);
  console.log(tag, `scroll 3 s: frames hilo ppal ${rng(F.map((r) => r.scroll.fps))}/s · LT ${rng(F.map((r) => r.scroll.lt))} máx ${rng(F.map((r) => r.scroll.ltMax))} · hilo ${rng(F.map((r) => r.scroll.task))} ms`);
  console.log(tag, `quieto 5 s: hilo ${rng(F.map((r) => r.idle.task))} ms · frames ${rng(F.map((r) => r.idle.fps))}/s`);
}
if (process.env.RAW) { const { writeFileSync, mkdirSync } = await import('node:fs'); mkdirSync(process.env.RAW, { recursive: true }); writeFileSync(join(process.env.RAW, `agc-cpu${CPU}-n${N}${STAGGER ? '-stagger' : ''}${EXTRA_CSS ? '-css' : ''}${UNIQUE ? '-unicas' : ''}.json`), JSON.stringify(rs, null, 1)); }
