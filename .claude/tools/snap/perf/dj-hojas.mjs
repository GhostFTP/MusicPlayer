// dj-hojas.mjs — HOJAS DE CONTACTO de las capturas de dj-matriz.mjs (h5e), para revisión humana.
// No reutiliza contact-sheet.mjs: ése está atado a header-shots (h-<ancho>-<vista>.png en shots/sub3) y a tres anchos
// fijos. Sí la misma técnica: un HTML con las PNG en base64, capturado con Playwright (página completa).
//
//   node dj-hojas.mjs <carpeta>                       → <carpeta>/hoja-<estado>.png: las ventanas del estado EN FILA,
//                                                       cada una rotulada «estado · ventana» (las de tablet incluidas)
//   node dj-hojas.mjs --comparar <limpio> <otra>      → <otra>/comparacion-<estado>.png: una fila por ventana, la
//                                                       captura LIMPIA a la izquierda y la de <otra> a la derecha
// <carpeta> es una carpeta de shots/dj-matriz/ (ruta completa o sólo su nombre). Imprime las rutas completas.
// Las capturas se escalan para que todas tengan el mismo ALTO en la hoja (se ven completas, no recortadas); el rótulo
// lleva el tamaño real.
import { loadPlaywright } from '../session.mjs';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'shots', 'dj-matriz');
const carpeta = (x) => (isAbsolute(x) ? x : join(RAIZ, x));
const args = process.argv.slice(2);
const comparar = args[0] === '--comparar';
const [A, B] = comparar ? args.slice(1).map(carpeta) : [carpeta(args[0] ?? ''), null];
if (!args.length || !existsSync(A) || (comparar && (!B || !existsSync(B)))) {
  console.error('uso: node dj-hojas.mjs <carpeta> · node dj-hojas.mjs --comparar <limpio> <otra>');
  process.exit(2);
}
const ORDEN_E = ['e1', 'e2', 'e3', 'e4', 'e5', 'e7a', 'e7b', 'e7c', 'e8', 'e9', 'e10'];
const ORDEN_V = ['900x800', '1024x768', '1280x800', '1366x768', '1440x900', '1920x1080', 'cola_1280x800', 'cola_1366x768', 'cola_1440x900', 'cola_1920x1080', 'cola_900x800', 'cola_1024x768', 'tablet_820x1180', 'tablet_1180x820'];
const partes = (f) => { const m = f.match(/^(e\d+[abc]?)_(.+)\.png$/); return m ? { e: m[1], v: m[2], f } : null; };
const pngs = (dir) => readdirSync(dir).map(partes).filter(Boolean);
const b64 = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;
const tam = (p) => { const b = readFileSync(p); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };   // ancho y alto de la cabecera IHDR
const ALTO = 420;
const img = (p, rot) => {
  const [w, h] = tam(p);
  return `<figure style="margin:0"><figcaption style="margin-bottom:6px;color:#a78bfa;font-weight:600">${rot} <span style="color:#888;font-weight:400">${w}×${h}</span></figcaption>
    <img src="${b64(p)}" style="height:${ALTO}px;width:${Math.round((w * ALTO) / h)}px;border:1px solid #333;display:block"></figure>`;
};
const vacio = (rot) => `<figure style="margin:0"><figcaption style="color:#888">${rot} · (sin captura)</figcaption></figure>`;

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const salida = [];
async function hoja(html, ruta) {
  const p = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await p.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0b0b0c;color:#ddd;font:13px Inter,system-ui,sans-serif;width:max-content">${html}</body>`, { waitUntil: 'load' });
  await p.screenshot({ path: ruta, fullPage: true });
  await p.close();
  salida.push(ruta);
}
const porEstado = (lst) => ORDEN_E.filter((e) => lst.some((x) => x.e === e));
const ordenV = (a, b) => ORDEN_V.indexOf(a) - ORDEN_V.indexOf(b);

if (!comparar) {
  const todas = pngs(A);
  for (const e of porEstado(todas)) {
    const vs = todas.filter((x) => x.e === e).map((x) => x.v).sort(ordenV);
    await hoja(`<div style="padding:12px 16px;font-size:16px;font-weight:700">Modo DJ · ${e.toUpperCase()} · ${A}</div>
      <div style="display:flex;gap:16px;padding:0 16px 16px;align-items:flex-start">${vs.map((v) => img(join(A, `${e}_${v}.png`), `${e} · ${v}`)).join('')}</div>`, join(A, `hoja-${e}.png`));
  }
} else {
  const a = pngs(A), bb = pngs(B);
  for (const e of porEstado(bb)) {
    const vs = bb.filter((x) => x.e === e).map((x) => x.v).sort(ordenV);
    await hoja(`<div style="padding:12px 16px;font-size:16px;font-weight:700">Modo DJ · ${e.toUpperCase()} · izquierda LIMPIO (${A}) · derecha (${B})</div>
      ${vs.map((v) => `<div style="padding:8px 16px;border-top:1px solid #2a2a2a;display:flex;gap:16px;align-items:flex-start">
        ${a.some((x) => x.e === e && x.v === v) ? img(join(A, `${e}_${v}.png`), `${e} · ${v} · limpio`) : vacio(`${e} · ${v} · limpio`)}
        ${img(join(B, `${e}_${v}.png`), `${e} · ${v} · ${B.split(/[\\/]/).pop()}`)}</div>`).join('')}`, join(B, `comparacion-${e}.png`));
  }
}
console.log(salida.join('\n'));
await browser.close();
