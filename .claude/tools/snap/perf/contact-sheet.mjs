// contact-sheet.mjs — HOJA DE CONTACTO antes | después por ancho, para revisar un cambio visual de un
// vistazo (Frente 2, M2d). Toma las capturas de header-shots.mjs (h-<ancho>-<vista>.png) de dos
// carpetas de shots/sub3 y, opcionalmente, recortes extra de mix-shots.mjs (x-<ancho>-<caso>.png),
// y arma UNA imagen por ancho: una fila por vista, con la captura de antes a la izquierda y la de
// después a la derecha. Salida: shots/sub3/<OUT>/contacto-<ancho>.png
// Uso: node contact-sheet.mjs <antes> <después> [<extra-antes> <extra-después>]   (OUT=contacto)
import { loadPlaywright } from '../session.mjs';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SUB3 = join(dirname(fileURLToPath(import.meta.url)), '..', 'shots', 'sub3');
const [A, D, XA, XD] = process.argv.slice(2);
if (!A || !D) { console.error('uso: node contact-sheet.mjs <antes> <después> [<extra-antes> <extra-después>]'); process.exit(1); }
const OUT = join(SUB3, process.env.OUT ?? 'contacto');
mkdirSync(OUT, { recursive: true });
const b64 = (p) => (existsSync(p) ? `data:image/png;base64,${readFileSync(p).toString('base64')}` : null);
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const saved = [];
for (const w of [1440, 1024, 390]) {
  const rows = [];
  const names = readdirSync(join(SUB3, A)).filter((f) => f.startsWith(`h-${w}-`) && f.endsWith('.png')).sort();
  for (const f of names) rows.push({ label: f.replace(`h-${w}-`, '').replace('.png', ''), a: b64(join(SUB3, A, f)), d: b64(join(SUB3, D, f)) });
  if (XA && XD) {
    const extra = readdirSync(join(SUB3, XA)).filter((f) => f.startsWith(`x-${w}-`) && f.endsWith('.png') && !f.includes('toast')).sort();
    for (const f of extra) rows.push({ label: 'estado: ' + f.replace(`x-${w}-`, '').replace('.png', ''), a: b64(join(SUB3, XA, f)), d: b64(join(SUB3, XD, f)) });
  }
  const col = w === 390 ? 390 : Math.round(w * 0.5);
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0b0b0c;color:#ddd;font:13px Inter,system-ui,sans-serif">
    <div style="padding:12px 16px;font-size:16px;font-weight:700">Hoja de contacto · ${w}px · izquierda ANTES (${A}) · derecha DESPUÉS (${D})</div>
    ${rows.map((r) => `<div style="padding:8px 16px;border-top:1px solid #2a2a2a">
      <div style="margin-bottom:6px;color:#a78bfa;font-weight:600">${r.label}</div>
      <div style="display:flex;gap:12px;align-items:flex-start">
        ${[r.a, r.d].map((src) => (src ? `<img src="${src}" style="width:${col}px;height:auto;border:1px solid #333">` : `<div style="width:${col}px;color:#888">(sin captura)</div>`)).join('')}
      </div></div>`).join('')}
  </body>`;
  const p = await browser.newPage({ viewport: { width: col * 2 + 60, height: 900 } });
  await p.setContent(html, { waitUntil: 'load' });
  const path = join(OUT, `contacto-${w}.png`);
  await p.screenshot({ path, fullPage: true });
  saved.push(path);
  await p.close();
}
console.log(saved.join('\n'));
await browser.close();
