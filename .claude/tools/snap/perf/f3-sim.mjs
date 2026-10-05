// f3-sim.mjs — SIMULACIONES visuales del Frente 3 (diagnóstico): CSS/DOM inyectado SÓLO en la prueba,
// sin tocar código de la app. A 1440, 1024 y 390:
//   back-*   detalle de álbum: botón de volver HOY / A1 (pill: chevron 22px + texto 15px) / A2 (círculo 44px)
//   alb-*    Álbumes: HOY / densidades con el TAMAÑO DE CELDA de iOS (d2 ~160, d3 ~104, d4 ~76 px; texto
//            2/2/1 renglones) / Mosaico (~60 px, sólo carátula) / Lista (carátula 52)
//   sel-*    Álbumes: selector de vista S1 (un botón "Vista" como iOS) y S2 (grupo de íconos en línea),
//            dibujados a la derecha de la cabecera (donde M2d pondrá la fila de acciones)
// Salida: shots/sub3/<OUT>/. Uso: SNAP_BASE=http://localhost:4273 OUT=f3-sim node f3-sim.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'shots', 'sub3', process.env.OUT ?? 'f3-sim');
mkdirSync(OUT, { recursive: true });
await preflight();
const token = await getToken();
const enc = encodeURIComponent;
const CHEVRON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';

// ── botón de volver ──
const BACK = {
  hoy: { css: '', js: null },
  A1: {
    css: `.back-btn{gap:4px!important;font-size:15px!important;font-weight:600;color:var(--text)!important;padding:0 14px 0 6px!important;border-radius:999px;background:rgba(255,255,255,.06)!important;min-height:44px}`,
    js: (svg) => { const b = document.querySelector('.back-btn'); b.innerHTML = svg + '<span>' + b.textContent.replace(/^←\s*/, '') + '</span>'; },
  },
  A2: {
    css: `.back-btn{width:44px;height:44px;min-height:44px;justify-content:center;border-radius:50%;padding:0!important;color:var(--text)!important;background:rgba(255,255,255,.08)!important}`,
    js: (svg) => { const b = document.querySelector('.back-btn'); b.setAttribute('aria-label', b.textContent.replace(/^←\s*/, '')); b.innerHTML = svg; },
  },
};
// ── densidades / modos de Álbumes (tamaño de celda de iOS: 390pt → 2/3/4/5 por fila) ──
const hideText = '.album-name,.album-artist,.album-count{display:none!important}';
const ALB = {
  hoy: '',
  d2: `.album-grid{grid-template-columns:repeat(auto-fill,minmax(160px,1fr))!important;gap:16px!important}`,
  d3: `.album-grid{grid-template-columns:repeat(auto-fill,minmax(104px,1fr))!important;gap:12px!important}.album-card{padding:8px!important}.album-name{font-size:13px!important}`,
  d4: `.album-grid{grid-template-columns:repeat(auto-fill,minmax(76px,1fr))!important;gap:10px!important}.album-card{padding:6px!important}.album-name{font-size:12px!important;-webkit-line-clamp:1!important;min-height:0!important}.album-artist,.album-count{display:none!important}`,
  mosaico: `.album-grid{grid-template-columns:repeat(auto-fill,minmax(60px,1fr))!important;gap:8px!important}.album-card{padding:0!important;background:none!important}.album-cover,.album-cover-placeholder{margin:0!important;border-radius:6px!important}${hideText}`,
  lista: `.album-grid{display:flex!important;flex-direction:column;gap:2px!important}.album-card{display:grid!important;grid-template-columns:52px 1fr;grid-template-rows:auto auto auto;column-gap:12px;align-items:center;padding:8px 10px!important}.album-cover,.album-cover-placeholder{width:52px!important;height:52px!important;margin:0!important;grid-row:1/4}.album-name{-webkit-line-clamp:1!important;min-height:0!important;font-size:15px!important}`,
};
// ── selector de vista (mock dibujado) ──
const SEL = {
  S1: { css: `.f3-sel{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 14px;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:var(--text);font:600 14px Inter,sans-serif}`,
        html: '<button class="f3-sel" aria-haspopup="dialog" aria-label="Vista de álbumes: 3 por fila"><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><g fill="#a0a0ac"><rect x="0" y="0" width="5" height="5" rx="1"/><rect x="6.5" y="0" width="5" height="5" rx="1"/><rect x="13" y="0" width="5" height="5" rx="1"/><rect x="0" y="6.5" width="5" height="5" rx="1"/><rect x="6.5" y="6.5" width="5" height="5" rx="1"/><rect x="13" y="6.5" width="5" height="5" rx="1"/><rect x="0" y="13" width="5" height="5" rx="1"/><rect x="6.5" y="13" width="5" height="5" rx="1"/><rect x="13" y="13" width="5" height="5" rx="1"/></g></svg>Vista</button>' },
  S2: { css: `.f3-seg{display:inline-flex;gap:2px;padding:3px;border-radius:12px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1)}.f3-seg button{width:40px;height:38px;border:0;border-radius:9px;background:none;color:#a0a0ac;display:grid;place-items:center}.f3-seg button[aria-checked=true]{background:hsl(265 40% 30% / .5);color:#fff}`,
        html: (() => { const icon = (n) => { let r = ''; const s = 18, g = n === 5 ? 1 : n === 4 ? 1.5 : 2, c = (s - g * (n - 1)) / n; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) r += `<rect x="${(c + g) * j}" y="${(c + g) * i}" width="${c}" height="${c}" rx="${n > 3 ? .5 : 1}"/>`; return `<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><g fill="currentColor">${r}</g></svg>`; };
          const lista = '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><g fill="currentColor"><rect x="0" y="1" width="4" height="4" rx="1"/><rect x="6" y="2" width="12" height="2" rx="1"/><rect x="0" y="7" width="4" height="4" rx="1"/><rect x="6" y="8" width="12" height="2" rx="1"/><rect x="0" y="13" width="4" height="4" rx="1"/><rect x="6" y="14" width="12" height="2" rx="1"/></g></svg>';
          return `<div class="f3-seg" role="radiogroup" aria-label="Vista de álbumes">${[2, 3, 4, 5].map((n) => `<button role="radio" aria-checked="${n === 3}" aria-label="${n === 5 ? 'Mosaico' : n + ' por fila'}">${icon(n)}</button>`).join('')}<button role="radio" aria-checked="false" aria-label="Lista">${lista}</button></div>`; })() },
};

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const saved = [];
for (const [w, opts] of [
  [1440, { viewport: { width: 1440, height: 900 } }],
  [1024, { viewport: { width: 1024, height: 800 } }],
  [390, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
]) {
  const ctx = await browser.newContext({ deviceScaleFactor: 1, ...opts });
  await ctx.addInitScript((t) => localStorage.setItem('token', t), token);
  const p = await ctx.newPage();
  const clipTop = async (name, h = 420) => {
    await p.mouse.move(2, 2); await p.waitForTimeout(400);
    const box = await p.locator('.main-content').boundingBox();
    const path = join(OUT, `${name}-${w}.png`);
    await p.screenshot({ path, clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, h) }, animations: 'disabled' });
    saved.push(path);
  };
  // volver (detalle de álbum)
  for (const [k, v] of Object.entries(BACK)) {
    await p.goto(`${BASE}/albums/${enc('Daft Punk')}/${enc('Discovery')}`);
    await p.waitForSelector('.back-btn'); await p.waitForTimeout(1200);
    if (v.css) await p.addStyleTag({ content: v.css });
    if (v.js) await p.evaluate(v.js, CHEVRON);
    await clipTop(`back-${k}`, 300);
  }
  // densidades / modos
  for (const [k, css] of Object.entries(ALB)) {
    await p.goto(`${BASE}/albums`);
    await p.waitForSelector('.album-grid .album-card'); await p.waitForTimeout(1500);
    if (css) await p.addStyleTag({ content: css });
    await clipTop(`alb-${k}`, w === 390 ? 760 : 620);
  }
  // selector de vista en la cabecera
  for (const [k, v] of Object.entries(SEL)) {
    await p.goto(`${BASE}/albums`);
    await p.waitForSelector('.album-grid .album-card'); await p.waitForTimeout(1200);
    await p.addStyleTag({ content: v.css });
    await p.evaluate((html) => { const a = document.querySelector('.section-header .detail-actions'); a.insertAdjacentHTML('beforeend', html); }, v.html);
    await clipTop(`sel-${k}`, 200);
  }
  await ctx.close();
}
console.log(saved.join('\n'));
await browser.close();
