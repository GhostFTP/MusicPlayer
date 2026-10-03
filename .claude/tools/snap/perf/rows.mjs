// rows.mjs — ¿cuántas filas/tarjetas re-renderiza React por ACCIÓN? (siguiente, play/pausa, carga).
// Detección: identidad de __reactProps$ en cada nodo antes/después (cambia sólo si React re-renderizó
// ese host). Commits: hook de devtools (funciona en build de prod). Audio: WAV silencioso inyectado
// en /stream/* con soporte de Range. Uso: SNAP_BASE=http://localhost:4173 CPU=1 node rows.mjs
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

// Ejecuta `action` (string de código en página) y cuenta cuántos nodos de `sel` re-renderizó React.
async function rerendersOn(sel, action, settleMs = 600) {
  return page.evaluate(async ([sel, action, settleMs]) => {
    const nodes = [...document.querySelectorAll(sel)];
    const key = (n) => Object.keys(n).find((k) => k.startsWith('__reactProps$'));
    const a = nodes.map((n) => n[key(n)]); const c0 = window.__commits;
    (0, eval)(action);
    await new Promise((r) => setTimeout(r, settleMs));
    return { rerendered: nodes.filter((n, i) => n[key(n)] !== a[i]).length, of: nodes.length, commits: window.__commits - c0 };
  }, [sel, action, settleMs]);
}
// Carga: tiempo hasta que aparecen las filas y commits en los 2.5 s siguientes (el contador animado
// dura 900 ms).
async function load(label, trigger, readySel, isGoto = false) {
  await takeLT();
  // en un goto la página nueva arranca su contador en 0
  const c0 = isGoto ? 0 : await page.evaluate(() => window.__commits ?? 0);
  const s = Date.now();
  await trigger();
  await page.waitForSelector(readySel, { timeout: 15000 });
  const ms = Date.now() - s;
  const cReady = await page.evaluate(() => window.__commits);
  await wait(2500);
  const cEnd = await page.evaluate(() => window.__commits);
  log(`${label}: →filas ${ms} ms · commits hasta filas ${cReady - c0} · commits 2.5 s después ${cEnd - cReady} ·`, await takeLT());
}

// ── 1) carga inicial y re-entrada a Biblioteca (sin música) ──
await load('Biblioteca goto', () => page.goto(BASE + '/'), '.library-tracks .track-row', true);
await page.click('.sidebar button:has-text("Álbumes")'); await page.waitForSelector('.album-grid .album-card');
await load('Biblioteca nav (desde Álbumes)', () => page.click('.sidebar button:has-text("Biblioteca")'), '.library-tracks .track-row');

// ── 2) reproducir, pausa, siguiente en Biblioteca ──
await page.locator('.library-tracks .track-row').nth(5).click();
await wait(CPU > 1 ? 5000 : 2500);
const ROWS = '.library-tracks .track-row';
log('Biblioteca pausa  :', JSON.stringify(await rerendersOn(ROWS, `document.querySelector('.player-bar .ctrl-btn.play').click()`)));
log('Biblioteca play   :', JSON.stringify(await rerendersOn(ROWS, `document.querySelector('.player-bar .ctrl-btn.play').click()`)));
log('Biblioteca sig.   :', JSON.stringify(await rerendersOn(ROWS, `document.querySelector('.player-bar .ctrl-next').click()`)));
log('  fila activa ahora:', await page.evaluate(() => [...document.querySelectorAll('.library-tracks .track-row')].findIndex((r) => r.classList.contains('playing'))), '(esperado 6)');

// ── 3) Álbumes: siguiente ──
await page.click('.sidebar button:has-text("Álbumes")'); await page.waitForSelector('.album-grid .album-card'); await wait(1500);
log('Álbumes sig.      :', JSON.stringify(await rerendersOn('.album-grid .album-card', `document.querySelector('.player-bar .ctrl-next').click()`)));
log('Álbumes pausa     :', JSON.stringify(await rerendersOn('.album-grid .album-card', `document.querySelector('.player-bar .ctrl-btn.play').click()`)));
await page.click('.player-bar .ctrl-btn.play');

// ── 4) Detalle de álbum (TrackTable): reproducir desde el detalle, siguiente y pausa ──
await page.locator('.album-grid .album-card').nth(3).click();
await page.waitForSelector('.track-table .track-row'); await wait(800);
await page.locator('.track-table .track-row').nth(2).click(); await wait(CPU > 1 ? 4000 : 2000);
const TT = '.track-table .track-row';
log('Detalle sig.      :', JSON.stringify(await rerendersOn(TT, `document.querySelector('.player-bar .ctrl-next').click()`)));
log('Detalle pausa     :', JSON.stringify(await rerendersOn(TT, `document.querySelector('.player-bar .ctrl-btn.play').click()`)));
log('  fila activa ahora:', await page.evaluate(() => [...document.querySelectorAll('.track-table .track-row')].findIndex((r) => r.classList.contains('playing'))), '(esperado 3)');

await browser.close();
