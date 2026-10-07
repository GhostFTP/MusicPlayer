// winshots.mjs — capturas de la Biblioteca a distintas alturas de scroll, para verificar que la
// VENTANA (virtualización, Frente 1 sub-paso 9) es visualmente idéntica a pintar todas las filas.
// Por modo (tabla 1440, lista 900, móvil 390): arriba, a mitad y al final, y con búsqueda activa
// ("a" a mitad, "daf" arriba). Registra el scrollHeight de cada caso: si la altura total cambia, la
// barra de scroll también. Salida: shots/sub3/<OUT>/win-*.png + scroll-heights.json.
// Uso: SNAP_BASE=http://localhost:4173 OUT=win-antes node winshots.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'shots', 'sub3', process.env.OUT ?? 'win-antes');
mkdirSync(OUT, { recursive: true });
await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const heights = {};
const saved = [];

async function at(p, name, where) {
  // where: 'top' | 'mid' | 'end' → mismo scrollTop en los dos builds si la altura total es la misma
  const info = await p.evaluate((where) => {
    const sc = document.querySelector('.main-content');
    const max = sc.scrollHeight - sc.clientHeight;
    sc.scrollTop = where === 'top' ? 0 : where === 'mid' ? Math.floor(max / 2) : max;
    return { scrollHeight: sc.scrollHeight, scrollTop: Math.round(sc.scrollTop) };
  }, where);
  await p.waitForTimeout(700);           // ventana recalculada + carátulas visibles cargadas
  await p.mouse.move(2, 2);
  const path = join(OUT, `win-${name}.png`);
  await p.locator('.main-content').screenshot({ path, animations: 'disabled' });
  saved.push(path);
  heights[name] = info;
}

for (const [mode, opts] of [
  ['tabla', { viewport: { width: 1440, height: 900 } }],
  ['lista', { viewport: { width: 900, height: 900 } }],
  ['movil', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
]) {
  const ctx = await browser.newContext({ deviceScaleFactor: 1, ...opts });
  await ctx.addInitScript((t) => localStorage.setItem('token', t), token);
  const p = await ctx.newPage();
  await p.goto(BASE + '/');
  await p.waitForSelector('.library-tracks .track-row');
  await p.waitForTimeout(1500);
  for (const w of ['top', 'mid', 'end']) await at(p, `${mode}-${w}`, w);
  await p.fill('.search-box input', 'a'); await p.waitForTimeout(600);
  await at(p, `${mode}-busca-a-mid`, 'mid');
  await p.fill('.search-box input', 'daf'); await p.waitForTimeout(600);
  await at(p, `${mode}-busca-daf-top`, 'top');
  await ctx.close();
}
writeFileSync(join(OUT, 'scroll-heights.json'), JSON.stringify(heights, null, 1));
console.log(saved.join('\n'));
await browser.close();
