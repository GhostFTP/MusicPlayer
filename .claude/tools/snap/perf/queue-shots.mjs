// queue-shots.mjs — capturas de la COLA para comparar píxel a píxel (frente 2 · sub-paso Q).
// Cola DETERMINISTA (no un mix, que es aleatorio): clic en la fila ROW de Biblioteca → la cola es la
// biblioteca entera en orden y la actual queda a mitad. Audio pausado en el arranque (la barra de
// progreso queda en ~0) y animaciones congeladas por Playwright. Por presentación:
//   col-*    columna de escritorio 1440 (.queue-panel)
//   drawer-* drawer del expandido en escritorio (.exp-drawer)
//   movil-*  hoja móvil 390 en su altura chica (.exp-drawer)
// y por posición: actual (recién abierta, centrada en la actual), top, mid, end.
// Salida: shots/sub3/<OUT>/q-*.png. Uso: SNAP_BASE=http://localhost:4173 OUT=q-antes [ROW=300]
//   [MODES=col,drawer,movil] [EXTRA_CSS='...'] [SHOT_WAIT=ms antes de cada captura] [CPU=4] node queue-shots.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'shots', 'sub3', process.env.OUT ?? 'q-antes');
const ROW = Number(process.env.ROW ?? 300);
const MODES = (process.env.MODES ?? 'col,drawer,movil').split(',');   // presentaciones a capturar
// EXTRA_CSS: CSS inyectado SÓLO en la captura (para aislar causas de una diferencia, nunca en la app)
mkdirSync(OUT, { recursive: true });
await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
function wav(sec = 900, sr = 8000) {
  const n = sec * sr, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const WAV = wav();
const saved = [];

async function setup(opts) {
  const ctx = await browser.newContext({ deviceScaleFactor: 1, ...opts });
  await ctx.route('**/stream/**', (r) => {
    const h = r.request().headers().range; const total = WAV.length;
    if (!h) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV });
    const [, a, b] = h.match(/bytes=(\d*)-(\d*)/); const start = a ? +a : 0; const end = b ? +b : total - 1;
    r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: WAV.subarray(start, end + 1) });
  });
  await ctx.addInitScript((t) => {
    localStorage.setItem('token', t);
    const A = window.Audio;
    window.Audio = function (...a) { const x = new A(...a); window.__audio = x; return x; };
  }, token);
  const p = await ctx.newPage();
  // CPU>1: throttling (para ver si la apariencia depende del TIEMPO del render, no del contenido)
  if (Number(process.env.CPU ?? 1) > 1) await (await ctx.newCDPSession(p)).send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU) });
  await p.goto(BASE + '/');
  if (process.env.EXTRA_CSS) await p.addStyleTag({ content: process.env.EXTRA_CSS });
  await p.waitForSelector('.library-tracks .track-row');
  await p.waitForTimeout(1500);
  // fila ROW de Biblioteca (con la ventana puede no estar montada: se scrollea hasta ella)
  await p.evaluate(async (row) => {
    const sc = document.querySelector('.main-content');
    const fr = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    for (let k = 0; k < 200; k++) {
      const tr = document.querySelector(`.library-tracks .track-row[data-index="${row}"]`) ?? document.querySelectorAll('.library-tracks .track-row')[row];
      if (tr) { tr.scrollIntoView({ block: 'center' }); await fr(); return; }
      sc.scrollTop += sc.clientHeight; await fr();
    }
  }, ROW);
  await p.waitForTimeout(300);
  const tr = p.locator(`.library-tracks .track-row[data-index="${ROW}"]`).or(p.locator('.library-tracks .track-row').nth(ROW)).first();
  await tr.click();
  await p.waitForTimeout(800);
  await p.evaluate(() => { window.__audio.pause(); window.__audio.currentTime = 0; });
  await p.waitForTimeout(500);
  return { ctx, p };
}
async function shot(p, sel, name, where) {
  if (where !== 'actual') {
    await p.evaluate((w) => { const b = document.querySelector('.queue-body'); const m = b.scrollHeight - b.clientHeight; b.scrollTop = w === 'top' ? 0 : w === 'mid' ? Math.floor(m / 2) : m; }, where);
  }
  await p.waitForTimeout(Number(process.env.SHOT_WAIT ?? 700));
  await p.mouse.move(2, 2);
  if (process.env.DEBUG) console.log(name, where, JSON.stringify(await p.evaluate((sel) => { const b = document.querySelector('.queue-body'); const r = document.querySelector('.queue-row').getBoundingClientRect(); const d = document.querySelector(sel).getBoundingClientRect(); const bb = b.getBoundingClientRect(); return { scrollTop: b.scrollTop, bodyTop: bb.top, row0: r.top, cont: d.top, contH: d.height, gaps: [...document.querySelectorAll('.queue-gap')].map((g) => g.style.height) }; }, sel)));
  const path = join(OUT, `q-${name}-${where}.png`);
  await p.locator(sel).screenshot({ path, animations: 'disabled' });
  saved.push(path);
}

// columna
if (MODES.includes('col')) {
  const { ctx, p } = await setup({ viewport: { width: 1440, height: 900 } });
  await p.click('.player-bar [aria-label="Cola"]');
  await p.waitForSelector('.queue-row.current');
  for (const w of ['actual', 'top', 'mid', 'end']) await shot(p, '.queue-panel', 'col', w);
  await ctx.close();
}
// drawer del expandido (escritorio)
if (MODES.includes('drawer')) {
  const { ctx, p } = await setup({ viewport: { width: 1440, height: 900 } });
  // clic en la CARÁTULA (borde izquierdo): al centro puede caer el link "Ir al artista", que navega
  { const pb = await p.locator('.player-bar .player-track').boundingBox(); await p.mouse.click(pb.x + 12, pb.y + pb.height / 2); }
  await p.waitForTimeout(700);
  await p.locator('.exp-actions .exp-icon-btn[title="Cola"]').click();
  await p.waitForSelector('.exp-drawer .queue-row.current');
  await p.waitForTimeout(600);
  for (const w of ['actual', 'top', 'mid', 'end']) await shot(p, '.exp-drawer', 'drawer', w);
  await ctx.close();
}
// hoja móvil (altura chica)
if (MODES.includes('movil')) {
  const { ctx, p } = await setup({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await p.click('.player-mini-controls .queue-mini');
  await p.waitForSelector('.exp-drawer .queue-row.current');
  await p.waitForTimeout(800);
  for (const w of ['actual', 'top', 'mid', 'end']) await shot(p, '.exp-drawer', 'movil', w);
  await ctx.close();
}
console.log(saved.join('\n'));
await browser.close();
