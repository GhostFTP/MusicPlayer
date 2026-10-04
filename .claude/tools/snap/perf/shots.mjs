// shots.mjs — capturas DETERMINISTAS de la barra, el expandido y el glifo de Letra, para comparar
// antes/después píxel a píxel. Congela el tiempo (playbackRate=0: no avanza y NO dispara 'pause', así
// el shimmer sigue montado) y congela cada animación en una fase fija con getAnimations().
// Uso: SNAP_BASE=http://localhost:4173 OUT=before node shots.mjs   → shots/sub3/<OUT>/*.png
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'shots', 'sub3', process.env.OUT ?? 'before');
mkdirSync(OUT, { recursive: true });
await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
function wav(sec = 120, sr = 8000) {
  const n = sec * sr, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const WAV = wav();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
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
// Ganchos de EXPERIMENTO (prototipos inyectados, nunca en el código).
if (process.env.EXTRA_JS) await ctx.addInitScript(process.env.EXTRA_JS);
const page = await ctx.newPage();
if (process.env.EXTRA_CSS) page.on('load', () => page.addStyleTag({ content: process.env.EXTRA_CSS }).catch(() => {}));
const wait = (ms) => page.waitForTimeout(ms);
const saved = [];
async function shot(name, locator) {
  const path = join(OUT, `${name}.png`);
  await page.locator(locator).first().screenshot({ path, animations: 'allow' });
  saved.push(path);
}
const seekTo = (sec, scope) => page.evaluate(([sec, scope]) => {
  const inp = document.querySelector(`${scope} .seek input[type=range]`);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, String(sec));
  inp.dispatchEvent(new Event('input', { bubbles: true }));
}, [sec, scope]);
// Congela: el audio deja de avanzar y cada animación queda en una fase fija (por nombre).
const PHASE = { 'seek-shimmer': 1300, 'sparkle-pulse': 900, 'time-tick': 60, 'time-pulse': 180 };
async function freeze(phase = PHASE) {
  await page.evaluate(() => { window.__audio.playbackRate = 0; });
  await wait(700);                                   // terminan las transiciones en curso
  await page.evaluate((phase) => {
    for (const a of document.getAnimations()) {
      const n = a.animationName;
      if (n && phase[n] != null) { a.pause(); a.currentTime = phase[n]; }
      else if (a.transitionProperty) { a.finish(); }
    }
  }, phase);
  await wait(150);
}
const unfreeze = () => page.evaluate(() => { window.__audio.playbackRate = 1; for (const a of document.getAnimations()) a.play(); });

await page.goto(BASE + '/');
await page.waitForSelector('.library-tracks .track-row');
await page.mouse.move(5, 5);
await page.locator('.library-tracks .track-row').first().click();
await wait(1500);
await page.mouse.move(5, 5);

for (const [label, sec] of [['0', 0], ['50', 60], ['100', 117]]) {
  await unfreeze(); await seekTo(sec, '.player-bar'); await wait(900);
  await freeze();
  await shot(`bar-${label}`, '.player-bar');
  await shot(`seek-${label}`, '.player-bar .seek');
  await shot(`time-${label}`, '.player-bar .time-label.time-elapsed');
}
// glifo de Letra: reposo (fase 0) y pico (fase 900 = scale 1.8)
await freeze({ ...PHASE, 'sparkle-pulse': 0 });
await shot('glyph-rest', '.player-bar [aria-label="Letra"]');
await freeze({ ...PHASE, 'sparkle-pulse': 900 });
await shot('glyph-peak', '.player-bar [aria-label="Letra"]');
await freeze({ ...PHASE, 'sparkle-pulse': 450 });
await shot('glyph-mid', '.player-bar [aria-label="Letra"]');
// glifo ACTIVO (Letra abierta → drop-shadow)
await unfreeze();
await page.click('.player-bar [aria-label="Letra"]'); await wait(1200);
await freeze({ ...PHASE, 'sparkle-pulse': 900 });
await shot('glyph-active-peak', '.player-bar [aria-label="Letra"]');
await unfreeze();
await page.click('.player-bar [aria-label="Letra"]'); await wait(800);
// time-tick en mitad del tick
await unfreeze(); await seekTo(30, '.player-bar'); await wait(1300);
await freeze({ ...PHASE, 'time-tick': 60 });
await shot('tick-mid', '.player-bar .time-label.time-elapsed');
// expandido a ~50%
await unfreeze(); await seekTo(60, '.player-bar'); await wait(600);
await page.click('.player-bar', { position: { x: 6, y: 6 } });
await page.waitForSelector('.exp-progress'); await wait(900);
await freeze();
await shot('exp-progress-50', '.exp-progress');
await shot('expanded', '.player-expanded');
await unfreeze(); await seekTo(4, '.player-expanded'); await wait(900);
await freeze();
await shot('exp-progress-3', '.exp-progress');
console.log(saved.join('\n'));
await browser.close();
