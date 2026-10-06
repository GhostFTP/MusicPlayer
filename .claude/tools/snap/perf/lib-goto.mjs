// lib-goto.mjs — SÓLO "Biblioteca goto → filas" de rows.mjs (mismo arranque: caché de red apagada,
// CPU emulada, contador de commits), más las peticiones /api que salen en los primeros 4 s (para ver
// qué compite con la carga). Una corrida por invocación; se alterna entre builds desde afuera.
// Uso: SNAP_BASE=http://localhost:<p> CPU=1|4 node lib-goto.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';

const CPU = Number(process.env.CPU ?? 1);
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

const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
const log = (...a) => console.log(`[cpu x${CPU}]`, ...a);
const wait = (ms) => page.waitForTimeout(ms);
const takeLT = () => page.evaluate(() => { const x = window.__lt ?? []; window.__lt = []; return `${x.length} LT (max ${Math.round(Math.max(0, ...x))}ms)`; });
const reqs = [];
page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/') && !/\/(cover|image)/.test(u.pathname)) reqs.push({ t: Date.now(), p: r.method() + ' ' + u.pathname }); });
const s = Date.now();
await page.goto(BASE + '/');
await page.waitForSelector('.library-tracks .track-row', { timeout: 15000 });
const ms = Date.now() - s;
const cReady = await page.evaluate(() => window.__commits);
await wait(2500);
const lt = await takeLT();
const early = reqs.filter((r) => r.t - s <= 4000).map((r) => r.p);
console.log(JSON.stringify({ cpu: CPU, base: BASE, gotoFilas: ms, commitsHastaFilas: cReady, lt, apiReqs: early }));
await browser.close();
