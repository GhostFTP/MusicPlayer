// anim-solo.mjs — costo de las animaciones de la barra, UNA por vez (las otras apagadas con CSS
// inyectado; nada se aplica al código). Por variante: 3 ventanas de 5 s (TaskDuration de CDP →
// mediana y rango) + 1 trace de 3 s (frames del hilo principal = ProxyMain::BeginMainFrame).
// Uso: SNAP_BASE=http://localhost:4173 CPU=1 GPU=0|1 [ONLY=todas,ninguna] node anim-solo.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CPU = Number(process.env.CPU ?? 1);
const GPU = process.env.GPU === '1';
const ONLY = process.env.ONLY?.split(',');
await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const args = ['--autoplay-policy=no-user-gesture-required'];
if (GPU) args.push('--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization');
const browser = await chromium.launch({ args });

function wav(sec = 900, sr = 8000) {
  const n = sec * sr, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const WAV = wav();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.route('**/stream/**', (r) => {
  const h = r.request().headers().range; const total = WAV.length;
  if (!h) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV });
  const [, a, b] = h.match(/bytes=(\d*)-(\d*)/); const start = a ? +a : 0; const end = b ? +b : total - 1;
  r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: WAV.subarray(start, end + 1) });
});
await ctx.addInitScript((t) => {
  localStorage.setItem('token', t);
  const A = window.Audio;   // expone el <audio> para los experimentos (EXTRA_JS)
  window.Audio = function (...a) { const x = new A(...a); window.__audio = x; return x; };
}, token);
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
await page.goto(BASE + '/');
await page.waitForSelector('.library-tracks .track-row');
await page.locator('.library-tracks .track-row').nth(5).click();
await page.waitForTimeout(CPU > 1 ? 5000 : 3000);
await page.mouse.move(700, 450);   // cursor sobre la tabla (como en las mediciones anteriores)
// Ganchos de EXPERIMENTO (sólo medición): CSS y JS inyectados en la página, nunca en el código.
if (process.env.EXTRA_CSS) await page.addStyleTag({ content: process.env.EXTRA_CSS });
if (process.env.EXTRA_JS) await page.evaluate(process.env.EXTRA_JS);
if (process.env.EXTRA_INIT) await ctx.addInitScript(process.env.EXTRA_INIT);
if (process.env.EXTRA_CSS || process.env.EXTRA_JS) await page.waitForTimeout(1000);

const OFF = {
  shimmer: '.seek-shimmer{animation:none!important}',
  sparkle: '.lyrics-glyph-sparkle,.lg-spark-wrap{animation:none!important}',
  fill:    '.seek-fill,.seek-fill-move,.seek-shine-track{transition:none!important}',
  tick:    '.time-tick{animation:none!important}',
};
const all = Object.keys(OFF);
const VARIANTS = [
  ['todas corriendo', []],
  ['ninguna (las 4 apagadas)', all],
  ['solo shimmer', all.filter((k) => k !== 'shimmer')],
  ['solo sparkle', all.filter((k) => k !== 'sparkle')],
  ['solo seek-fill (transition)', all.filter((k) => k !== 'fill')],
  ['solo time-tick', all.filter((k) => k !== 'tick')],
].filter(([l]) => !ONLY || ONLY.some((o) => l.startsWith(o)));

const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const tracePath = join(tmpdir(), `anim-solo-${process.pid}.json`);

console.log(`[cpu x${CPU}${GPU ? ' gpu' : ' sw'}] ${BASE}`);
for (const [label, offs] of VARIANTS) {
  const tags = [];
  for (const k of offs) tags.push(await page.addStyleTag({ content: OFF[k] }));
  await page.waitForTimeout(700);
  const tasks = [];
  for (let k = 0; k < 3; k++) {
    const a = await metrics(); await page.waitForTimeout(5000); const z = await metrics();
    tasks.push(Math.round((z.TaskDuration - a.TaskDuration) * 1000));
  }
  await browser.startTracing(page, { path: tracePath, categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'cc'] });
  await page.waitForTimeout(3000);
  await browser.stopTracing();
  const ev = JSON.parse(readFileSync(tracePath)).traceEvents;
  const main = ev.find((e) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain');
  const frames = ev.filter((e) => e.name === 'ProxyMain::BeginMainFrame' && e.ph === 'X' && (!main || (e.pid === main.pid && e.tid === main.tid))).length;
  for (const t of tags) await t.evaluate((n) => n.remove());
  console.log(`  ${label.padEnd(30)} hilo ocupado 5 s: mediana ${String(med(tasks)).padStart(5)} ms  rango ${Math.min(...tasks)}–${Math.max(...tasks)}  ·  frames hilo principal: ${(frames / 3).toFixed(1)}/s`);
}
rmSync(tracePath, { force: true });
await browser.close();
