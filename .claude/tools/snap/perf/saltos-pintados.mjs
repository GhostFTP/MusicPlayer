// saltos-pintados.mjs — ¿se ve algún frame vacío al saltar en Biblioteca? Graba los frames REALMENTE pintados
// (screencast de CDP) mientras se salta con entrada real: Fin/Inicio/AvPág sobre el scroller y rueda con
// deltas enormes; un frame cuya zona de filas sale lisa (desv. de luminancia < 3) = hueco visible.
// Es la medida que manda para la ventana (Frente 1, sub-paso 9): una sonda en página puede ver estados
// intermedios que nunca se pintan. Uso: SNAP_BASE=http://localhost:4173 [SCALE=3000] node saltos-pintados.mjs
import { getToken, loadPlaywright } from '../session.mjs';
const BASE = process.env.SNAP_BASE; const N = Number(process.env.SCALE ?? 0);
const token = await getToken(); const { chromium } = await loadPlaywright();
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript((t) => localStorage.setItem('token', t), token);
if (N) {
  const real = await fetch(`${BASE}/api/tracks?limit=10000`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  const tracks = []; for (let k = 0; tracks.length < N; k++) for (const t of real) { if (tracks.length >= N) break; tracks.push({ ...t, id: t.id + k * 1_000_000 }); }
  await ctx.route((url) => { const u = new URL(url); return u.pathname === '/api/tracks' && u.searchParams.get('limit') === '10000' && [...u.searchParams.keys()].length === 1; }, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tracks) }));
}
const p = await ctx.newPage(); await p.goto(BASE + '/'); await p.waitForSelector('.library-tracks .track-row'); await p.waitForTimeout(1500);
const box = await p.locator('.main-content').boundingBox();
// zona de filas a analizar (debajo de la cabecera de la vista, dentro del scroller)
const region = { x: Math.round(box.x + 40), y: Math.round(box.y + 300), w: Math.round(box.width - 120), h: Math.round(box.height - 340) };
const cdp = await ctx.newCDPSession(p);
const frames = [];
cdp.on('Page.screencastFrame', async (f) => { frames.push(f.data); await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });
await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
// arrastrar el thumb de la barra de scroll de .main-content de arriba a abajo y de vuelta, rápido
await p.evaluate(() => { window.__max = 0; document.querySelector('.main-content').addEventListener('scroll', (e) => { window.__max = Math.max(window.__max, e.target.scrollTop); }, { passive: true }); });
// Saltos con ENTRADA REAL: teclado (Fin/Inicio/AvPág) sobre el scroller y rueda con deltas enormes.
await p.evaluate(() => { const sc = document.querySelector('.main-content'); sc.tabIndex = -1; sc.focus(); });
for (const k of ['End', 'Home', 'End', 'Home']) { await p.keyboard.press(k); await p.waitForTimeout(450); }
for (let i = 0; i < 6; i++) { await p.keyboard.press('PageDown'); await p.waitForTimeout(120); }
await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
for (const d of [5000, 9000, -7000, 12000, -20000]) { await p.mouse.wheel(0, d); await p.waitForTimeout(250); }
await cdp.send('Page.stopScreencast');
const moved = await p.evaluate(() => ({ final: document.querySelector('.main-content').scrollTop, maxAlcanzado: window.__max, maxPosible: document.querySelector('.main-content').scrollHeight - document.querySelector('.main-content').clientHeight }));
// analizar: desviación estándar de luminancia en la zona de filas; una zona "lisa" = hueco visible
const an = await p.evaluate(async ([frames, region]) => {
  const out = [];
  for (const d of frames) {
    const img = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + d; });
    const c = document.createElement('canvas'); c.width = region.w; c.height = region.h;
    const x = c.getContext('2d'); x.drawImage(img, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h);
    const px = x.getImageData(0, 0, region.w, region.h).data; let s = 0, s2 = 0, n = 0;
    for (let i = 0; i < px.length; i += 16) { const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]; s += l; s2 += l * l; n++; }
    const m = s / n; out.push(Math.sqrt(Math.max(0, s2 / n - m * m)));
  }
  return out;
}, [frames, region]);
const lisos = an.filter((v) => v < 3).length;
console.log(JSON.stringify({ frames: frames.length, framesLisos: lisos, desvMin: +Math.min(...an).toFixed(2), desvMediana: +an.sort((a, z) => a - z)[an.length >> 1].toFixed(2), scrollTopFinal: moved }));
await b.close();
