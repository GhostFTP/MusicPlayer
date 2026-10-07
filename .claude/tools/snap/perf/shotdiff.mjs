// shotdiff.mjs — diff píxel a píxel entre dos carpetas de capturas de shots.mjs (mismo nombre de
// archivo). Usa el canvas del navegador (sin dependencias nuevas). Escribe diff-<nombre>.png (rojo =
// píxel distinto) en la carpeta B. Uso: node shotdiff.mjs before after [tolerancia=16]
import { loadPlaywright } from '../session.mjs';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'shots', 'sub3');
const [A, B, TOL = '16'] = process.argv.slice(2);
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage();
const files = readdirSync(join(ROOT, A)).filter((f) => f.endsWith('.png') && !f.startsWith('diff-'));
for (const f of files) {
  let b64b;
  try { b64b = readFileSync(join(ROOT, B, f)).toString('base64'); } catch { console.log(`${f.padEnd(24)} falta en ${B}`); continue; }
  const b64a = readFileSync(join(ROOT, A, f)).toString('base64');
  const r = await page.evaluate(async ([a, b, tol]) => {
    const load = (s) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + s; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return { size: `${ia.width}x${ia.height} vs ${ib.width}x${ib.height}` };
    const c = document.createElement('canvas'); c.width = ia.width; c.height = ia.height;
    const x = c.getContext('2d');
    x.drawImage(ia, 0, 0); const da = x.getImageData(0, 0, c.width, c.height).data;
    x.clearRect(0, 0, c.width, c.height); x.drawImage(ib, 0, 0); const db = x.getImageData(0, 0, c.width, c.height);
    let n = 0, max = 0;
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.max(Math.abs(da[i] - db.data[i]), Math.abs(da[i + 1] - db.data[i + 1]), Math.abs(da[i + 2] - db.data[i + 2]), Math.abs(da[i + 3] - db.data[i + 3]));
      if (d > max) max = d;
      if (d > tol) { n++; db.data[i] = 255; db.data[i + 1] = 0; db.data[i + 2] = 0; db.data[i + 3] = 255; }
      else { db.data[i + 3] = Math.round(db.data[i + 3] * 0.25); }
    }
    x.putImageData(db, 0, 0);
    return { n, total: da.length / 4, max, png: c.toDataURL('image/png').split(',')[1] };
  }, [b64a, b64b, Number(TOL)]);
  if (r.size) { console.log(`${f.padEnd(24)} TAMAÑO DISTINTO ${r.size}`); continue; }
  writeFileSync(join(ROOT, B, `diff-${f}`), Buffer.from(r.png, 'base64'));
  console.log(`${f.padEnd(24)} píxeles distintos (>${TOL}): ${String(r.n).padStart(6)} de ${r.total} (${(100 * r.n / r.total).toFixed(3)}%) · máx Δ ${r.max}`);
}
await browser.close();
