// mix-cost.mjs — costo de armar la lista del "Mix aleatorio" por vista (Frente 2, sub-paso M2). Sólo medición.
//   A) HOY: clic en el Mix de la cabecera de Álbumes/Artistas/Géneros/Años (piden /api/tracks?limit=10000
//      en cada clic) → primer frame, empieza a sonar, requests y long tasks.
//   B) DERIVAR DE MEMORIA: con la lista completa ya en memoria (como la deja Biblioteca), filtrar por el
//      criterio de cada vista + Fisher–Yates → ms puros de JS (es lo que haría el componente unificado).
//   C) PEDIR Y DERIVAR: 1 request /api/tracks?limit=10000 + JSON + filtro + Fisher–Yates → ms.
// 3 repeticiones por medición dentro de la corrida (mediana). Escritorio 1440.
// Uso: SNAP_BASE=http://localhost:4173 CPU=1|4 [SCALE=3000] node mix-cost.mjs
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
  // cualquier /api/tracks con limit=10000 (con o sin filtros) devuelve la biblioteca sintética filtrada igual
  await ctx.route((url) => { const u = new URL(url); return u.pathname === '/api/tracks' && u.searchParams.get('limit') === '10000' && [...u.searchParams.keys()].length === 1; },
    (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tracks) }));
}
await ctx.addInitScript((t) => {
  localStorage.setItem('token', t);
  window.__lt = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: 'longtask', buffered: true }); } catch {}
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

// ── A) hoy: clic en el Mix de cada vista de lista ──
for (const [vista, path] of [['albums', '/albums'], ['artists', '/artists'], ['genres', '/genres'], ['years', '/years']]) {
  const xs = [];
  for (let k = 0; k < 3; k++) {
    await page.goto(BASE + path);
    await page.waitForSelector(':is(.section-header, .view-actions) .mix-btn');
    await page.waitForTimeout(1200);
    const r0 = reqs;
    const r = await page.evaluate(async () => {
      window.__lt = [];
      const btn = document.querySelector(':is(.section-header, .view-actions) .mix-btn');
      const t0 = performance.now();
      let tPlay = null;
      const prev = window.__audio;
      btn.click();
      const tFrame = await new Promise((r) => requestAnimationFrame(() => setTimeout(() => r(performance.now() - t0), 0)));
      await new Promise((res) => {
        const poll = () => { const a = window.__audio; if (a && (a !== prev || !a.paused) && !a.paused && a.currentTime > 0) { tPlay = performance.now() - t0; return res(); } if (performance.now() - t0 > 20000) return res(); setTimeout(poll, 5); };
        poll();
      });
      const kick = document.querySelector('.player-bar .player-title, .player-bar .track-title')?.textContent ?? '';
      return { frame: Math.round(tFrame), suena: Math.round(tPlay ?? -1), ltMax: Math.round(Math.max(0, ...window.__lt)) };
    });
    r.requests = reqs - r0;
    xs.push(r);
    await page.evaluate(() => { window.__audio?.pause(); });
  }
  R[`hoy_${vista}`] = { frame: med(xs.map((x) => x.frame)), suena: med(xs.map((x) => x.suena)), ltMax: Math.max(...xs.map((x) => x.ltMax)), requestsPorClic: med(xs.map((x) => x.requests)) };
}

// ── B y C) derivar la lista de cada vista ──
await page.goto(BASE + '/');
await page.waitForSelector('.library-tracks .track-row');
await page.waitForTimeout(1200);
Object.assign(R, await page.evaluate(async () => {
  const H = { Authorization: `Bearer ${localStorage.getItem('token')}` };
  const PRED = {
    albums: (t) => !!t.album,
    artists: (t) => !!t.album_artist,
    genres: (t) => !!t.genre,
    years: (t) => t.year != null,
  };
  const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return +s[s.length >> 1].toFixed(2); };
  const all = await fetch('/api/tracks?limit=10000', { headers: H }).then((r) => r.json());
  const out = { total: all.length };
  for (const [v, p] of Object.entries(PRED)) {
    const mem = [], net = [];
    let n = 0;
    for (let k = 0; k < 3; k++) {
      let t0 = performance.now();
      const l = shuffle(all.filter(p)); n = l.length;
      mem.push(performance.now() - t0);
      t0 = performance.now();
      const fresh = await fetch('/api/tracks?limit=10000', { headers: H }).then((r) => r.json());
      shuffle(fresh.filter(p));
      net.push(performance.now() - t0);
    }
    out[`derivar_${v}`] = { pistas: n, memoria_ms: med(mem), pedir_y_derivar_ms: med(net) };
  }
  return out;
}));
console.log('JSON ' + JSON.stringify(R));
console.log(JSON.stringify(R, null, 1));
await browser.close();
