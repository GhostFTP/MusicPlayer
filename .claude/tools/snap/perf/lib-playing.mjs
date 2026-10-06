// lib-playing.mjs — SÓLO el escenario "Biblioteca REPRODUCIENDO (5 s)" de perf.mjs (mismo código,
// recortado): costo del hilo mientras suena, para comparar builds con muchas corridas sin pagar
// los ~3,5 min de perf.mjs entero. Uso: SNAP_BASE=http://localhost:<p> CPU=4 node lib-playing.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';

const CPU = Number(process.env.CPU ?? 1);
await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

// WAV PCM 8kHz mono 16-bit, 120 s de silencio.
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

await ctx.addInitScript((t) => {
  localStorage.setItem('token', t);
  window.__lt = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: 'longtask', buffered: true }); } catch {}
  const A = window.Audio;
  window.Audio = function (...a) { const x = new A(...a); window.__audio = x; window.__tu = 0; x.addEventListener('timeupdate', () => { window.__tu++; }); return x; };
  // contador de commits de React vía el hook de devtools (funciona en build de prod)
  window.__commits = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers: new Map(), inject() { return 1; },
    onCommitFiberRoot() { window.__commits++; }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {},
  };
}, token);

const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
await cdp.send('Network.enable');
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });

const apiReqs = [];
page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/') && !/\/(cover|image)/.test(u.pathname)) apiReqs.push(u.pathname + u.search); });

async function metrics() {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  return { task: m.TaskDuration * 1000, script: m.ScriptDuration * 1000, layout: m.LayoutDuration * 1000, style: m.RecalcStyleDuration * 1000 };
}
const diff = (a, b) => Object.fromEntries(Object.keys(a).map((k) => [k, Math.round(b[k] - a[k])]));
const takeLT = () => page.evaluate(() => { const x = window.__lt; window.__lt = []; return `${x.length} LT (max ${Math.round(Math.max(0, ...x))}ms, total ${Math.round(x.reduce((s, v) => s + v, 0))}ms)`; });
const log = (...a) => console.log(`[cpu x${CPU}]`, ...a);
const wait = (ms) => page.waitForTimeout(ms);

// ¿Cuántos nodos de `sel` cambiaron de identidad de props (= React los re-renderizó) en `ms`?
async function rerenders(sel, ms) {
  return page.evaluate(async ([sel, ms]) => {
    const nodes = [...document.querySelectorAll(sel)];
    const key = (n) => Object.keys(n).find((k) => k.startsWith('__reactProps$'));
    const snap = () => nodes.map((n) => n[key(n)]);
    const c0 = window.__commits, tu0 = window.__tu ?? 0;
    const a = snap();
    await new Promise((r) => setTimeout(r, ms));
    const b = snap();
    return { nodes: nodes.length, rerendered: a.filter((p, i) => p !== b[i]).length, commits: window.__commits - c0, timeupdates: (window.__tu ?? 0) - tu0 };
  }, [sel, ms]);
}
async function idle(label, sel, ms = 5000) {
  await takeLT(); const m0 = await metrics();
  const r = await rerenders(sel, ms);
  log(`${label} (${ms / 1000}s):`, JSON.stringify(r), JSON.stringify(diff(m0, await metrics())), await takeLT());
}

// ── Biblioteca ──
let s = Date.now();
await page.goto(BASE + '/');
await page.waitForSelector('.library-tracks .track-row');
log('Biblioteca goto→filas', Date.now() - s, 'ms · filas', await page.locator('.library-tracks .track-row').count(), '· DOM', await page.evaluate(() => document.querySelectorAll('*').length));
await wait(1500);
await idle('Biblioteca PAUSA', '.library-tracks .track-row');
await page.locator('.library-tracks .track-row').nth(5).click();
await wait(CPU > 1 ? 6000 : 3000);
log('audio:', JSON.stringify(await page.evaluate(() => ({ t: +window.__audio.currentTime.toFixed(1), paused: window.__audio.paused, err: window.__audio.error?.code ?? null }))));
await idle('Biblioteca REPRODUCIENDO', '.library-tracks .track-row');
await browser.close();
