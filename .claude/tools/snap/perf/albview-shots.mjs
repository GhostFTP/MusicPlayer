// albview-shots.mjs — capturas de la VISTA del listado de Álbumes (Frente 3) a 1440/1024/390.
//   grid-<w>.png      la GRILLA (recorte relativo a su propia caja, primeras filas): para el diff
//                     píxel a píxel del predeterminado contra la base (shotdiff.mjs, tolerancia 0)
//   page-<w>.png      la vista arriba (cabecera + fila de acciones + grilla)
//   mode-<m>-<w>.png  cada modo (MODES=1)
//   sel-<w>.png       el selector (en 390, con el menú abierto) (MODES=1)
// Además imprime la posición de la grilla y el alto de la fila de acciones (¿el selector la movió?).
// Animaciones congeladas y carátulas esperadas antes de capturar.
// Uso: SNAP_BASE=http://localhost:<p> OUT=<carpeta> [MODES=1] node albview-shots.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

await preflight();
const token = await getToken();
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'shots', 'sub3', process.env.OUT ?? 'albview');
mkdirSync(OUT, { recursive: true });
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const MODES = ['d2', 'd3', 'd4', 'mosaic', 'list'];
const idOf = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).id;
const KEY = `sonorarev.albumsView:id:${idOf(token)}`;
const geo = {};

async function settle(p) {
  await p.waitForSelector('.album-grid .album-card');
  await p.evaluate(async () => {
    window.scrollTo(0, 0); document.querySelector('.main-content')?.scrollTo?.(0, 0);
    const imgs = [...document.querySelectorAll('.album-grid img')].filter((i) => i.getBoundingClientRect().top < innerHeight);
    await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
  });
  await p.mouse.move(1, 1);
  await p.waitForTimeout(600);
}

for (const [w, h, mobile] of [[1440, 900, false], [1024, 800, false], [390, 844, true]]) {
  for (const mode of process.env.MODES ? MODES : ['default']) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
    await ctx.route('**/stream/**', (r) => r.fulfill({ status: 404, body: '' }));
    await ctx.addInitScript(([t, k, m]) => {
      localStorage.setItem('token', t);
      if (m === 'default') localStorage.removeItem(k); else localStorage.setItem(k, m);
    }, [token, KEY, mode]);
    const p = await ctx.newPage();
    await p.goto(BASE + '/albums');
    await settle(p);
    const g = await p.evaluate(() => {
      const gr = document.querySelector('.album-grid').getBoundingClientRect();
      const va = document.querySelector('.view-actions')?.getBoundingClientRect();
      return { gridTop: Math.round(gr.top), gridLeft: Math.round(gr.left), gridW: Math.round(gr.width), actionsH: va ? Math.round(va.height) : null };
    });
    geo[`${mode}-${w}`] = g;
    const box = await p.locator('.album-grid').boundingBox();
    const clipH = Math.min(box.height, h - box.y - (mobile ? 130 : 90));
    if (mode === 'default') {
      await p.screenshot({ path: join(OUT, `grid-${w}.png`), clip: { x: box.x, y: box.y, width: box.width, height: clipH }, animations: 'disabled' });
      await p.screenshot({ path: join(OUT, `page-${w}.png`), animations: 'disabled' });
    } else {
      await p.screenshot({ path: join(OUT, `mode-${mode}-${w}.png`), animations: 'disabled' });
      if (mode === 'd3') {
        if (mobile) { await p.locator('.avs-btn').click(); await p.waitForSelector('.avs-menu'); await p.waitForTimeout(250); }
        else { await p.locator('.avs-seg [aria-checked="true"]').focus(); await p.waitForTimeout(150); }
        await p.screenshot({ path: join(OUT, `sel-${w}.png`), animations: 'disabled' });
      }
    }
    await ctx.close();
  }
}
console.log(JSON.stringify(geo));
await browser.close();
