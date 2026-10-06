// exp-header-shots.mjs — capturas del header del reproductor expandido a 360/390 (teléfono: sólo la
// flecha + 6 íconos) y 768 (tableta: el texto "Ahora reproduciendo" sigue). Salida: shots/sub3/<OUT>.
// Uso: SNAP_BASE=http://localhost:4173 [OUT=exp-header] node exp-header-shots.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'shots', 'sub3', process.env.OUT ?? 'exp-header');
mkdirSync(OUT, { recursive: true });
const res = {};
for (const [w, h, mobile] of [[360, 780, true], [390, 844, true], [768, 1024, true]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
  await ctx.route('**/stream/**', (r) => r.fulfill({ status: 404, body: '' }));
  await ctx.addInitScript((t) => localStorage.setItem('token', t), token);
  const p = await ctx.newPage();
  await p.goto(BASE + '/'); await p.waitForSelector('.library-tracks .track-row');
  await p.locator('.library-tracks .track-row').nth(5).click(); await p.waitForTimeout(800);
  await p.locator(w > 700 ? '.player-bar .player-art' : '.player-bar').click(); await p.waitForTimeout(1000);
  res[w] = await p.evaluate(() => {
    const b = document.querySelector('.exp-back');
    const lab = document.querySelector('.exp-back-label');
    return { aria: b?.getAttribute('aria-label'), title: b?.getAttribute('title'), labelVisible: !!lab && getComputedStyle(lab).display !== 'none', backW: Math.round(b?.getBoundingClientRect().width ?? 0) };
  });
  const hdr = p.locator('.exp-header');
  const box = await hdr.boundingBox();
  await p.screenshot({ path: join(OUT, `header-${w}.png`), clip: { x: 0, y: 0, width: w, height: Math.ceil(box.y + box.height + 16) } });
  await ctx.close();
}
console.log(JSON.stringify(res));
await browser.close();
