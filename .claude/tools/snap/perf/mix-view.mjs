// mix-view.mjs — el "Mix aleatorio" de los LISTADOS (Álbumes, Artistas, Géneros, Años) (Frente 2, M2a).
// Por vista y en dos estados de caché:
//   · caliente: se entra a Biblioteca (deja la biblioteca en viewCache) y se navega a la vista DENTRO
//     de la app (sidebar, sin recargar) → con el helper nuevo el clic no debería pedir nada;
//   · frío: se entra directo por URL a la vista → la biblioteca no está en memoria (1 request).
// Mide: requests a /api/tracks durante el clic, clic→play() (cuando el reproductor recibe la pista:
// setter de src del <audio>; ≈ armar la lista + barajar + play), clic→suena ('playing'), long tasks
// y cuántas pistas quedaron en la cola (kicker "En cola · N pistas").
// 3 repeticiones por vista y estado dentro de la corrida (mediana).
// Uso: SNAP_BASE=http://localhost:4173 CPU=1|4 [SCALE=3000] node mix-view.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';

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
await ctx.addInitScript((t) => {
  localStorage.setItem('token', t);
  window.__lt = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: 'longtask', buffered: true }); } catch {}
  // momento en que el reproductor recibe una pista (asignación de src del <audio>)
  const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  Object.defineProperty(HTMLMediaElement.prototype, 'src', { configurable: true, get() { return d.get.call(this); }, set(v) { window.__srcAt = performance.now(); d.set.call(this, v); } });
  const A = window.Audio;
  window.Audio = function (...a) { const x = new A(...a); window.__audio = x; return x; };
}, token);
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
let reqs = 0;
page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname === '/api/tracks') reqs++; });
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const R = { cpu: CPU, scale: SCALE || 680 };
const VIEWS = [['albums', 'Álbumes', '/albums'], ['artists', 'Artistas', '/artists'], ['genres', 'Géneros', '/genres'], ['years', 'Años', '/years']];

async function clickMix() {
  const r0 = reqs;
  const r = await page.evaluate(async () => {
    window.__lt = []; window.__srcAt = null;
    const btn = document.querySelector('.section-header .mix-btn');
    const prev = window.__audio;
    const t0 = performance.now();
    let tPlay = null;
    const playing = new Promise((res) => {
      const hook = () => { const a = window.__audio; if (a) a.addEventListener('playing', () => { tPlay = performance.now() - t0; res(); }, { once: true }); else setTimeout(hook, 1); };
      hook(); setTimeout(res, 20000);
    });
    btn.click();
    const tFrame = await new Promise((r) => requestAnimationFrame(() => setTimeout(() => r(performance.now() - t0), 0)));
    await playing;
    return { frame: Math.round(tFrame), aPlay: window.__srcAt ? +(window.__srcAt - t0).toFixed(1) : null, suena: Math.round(tPlay ?? -1), ltMax: Math.round(Math.max(0, ...window.__lt)), reused: window.__audio === prev };
  });
  r.requests = reqs - r0;
  // pistas en la cola: abrir la cola, leer el kicker, cerrar
  await page.click('.player-bar [aria-label="Cola"]');
  await page.waitForSelector('.queue-panel .queue-kicker');
  r.enCola = await page.evaluate(() => Number((document.querySelector('.queue-panel .queue-kicker')?.textContent.match(/(\d+)\s+pistas?/) ?? [])[1] ?? 0));
  await page.click('.player-bar [aria-label="Cola"]');
  await page.waitForSelector('.queue-panel', { state: 'detached' });
  await page.evaluate(() => window.__audio?.pause());
  return r;
}
const pick = (xs) => ({ requests: med(xs.map((x) => x.requests)), aPlay: med(xs.map((x) => x.aPlay ?? -1)), suena: med(xs.map((x) => x.suena)), frame: med(xs.map((x) => x.frame)), ltMax: Math.max(...xs.map((x) => x.ltMax)), enCola: med(xs.map((x) => x.enCola)) });

for (const [key, label, path] of VIEWS) {
  // caliente: Biblioteca → vista por la sidebar
  const hot = [];
  for (let k = 0; k < 3; k++) {
    await page.goto(BASE + '/');
    await page.waitForSelector('.library-tracks .track-row');
    await page.waitForTimeout(1000);
    await page.click(`.sidebar button:has-text("${label}")`);
    await page.waitForSelector('.section-header .mix-btn');
    await page.waitForTimeout(800);
    hot.push(await clickMix());
  }
  // frío: directo por URL
  const cold = [];
  for (let k = 0; k < 3; k++) {
    await page.goto(BASE + path);
    await page.waitForSelector('.section-header .mix-btn');
    await page.waitForTimeout(1000);
    cold.push(await clickMix());
  }
  R[key] = { caliente: pick(hot), frio: pick(cold) };
}
console.log('JSON ' + JSON.stringify(R));
for (const [key] of VIEWS) console.log(`[cpu x${CPU} · ${R.scale}] ${key}: caliente ${JSON.stringify(R[key].caliente)} · frío ${JSON.stringify(R[key].frio)}`);
await browser.close();
