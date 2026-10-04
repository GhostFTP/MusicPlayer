// rowshots.mjs — capturas de las FILAS de la Biblioteca para verificar que un recorte de nodos es
// visualmente idéntico (Frente 1, sub-paso 7). Escritorio 1440 (bloque de filas, fila en hover, fila
// que suena, botón "⋯" ampliado), lista 900 y móvil 390. Salida: shots/sub3/<OUT>/rows-*.png, para
// comparar con shotdiff.mjs. Uso: SNAP_BASE=http://localhost:4173 OUT=rows-antes node rowshots.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'shots', 'sub3', process.env.OUT ?? 'rows-antes');
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
async function session(opts) {
  const ctx = await browser.newContext({ deviceScaleFactor: 2, ...opts });
  await ctx.route('**/stream/**', (r) => r.fulfill({ status: 200, contentType: 'audio/wav', body: WAV }));
  await ctx.addInitScript((t) => localStorage.setItem('token', t), token);
  const p = await ctx.newPage();
  await p.goto(BASE + '/');
  await p.waitForSelector('.library-tracks .track-row');
  await p.waitForTimeout(1500);   // carátulas visibles cargadas, contador terminado
  return { ctx, p };
}
const shot = async (p, name, loc) => { const path = join(OUT, `${name}.png`); await p.locator(loc).first().screenshot({ path, animations: 'disabled' }); saved.push(path); };
// Sólo filas (la zona visible de .main-content, no el <tbody> entero: a DPR 2 serían ~72 000 px de alto);
// la barra del reproductor no entra en las capturas → no hace falta congelar sus animaciones.

// Escritorio
{
  const { ctx, p } = await session({ viewport: { width: 1440, height: 900 } });
  await p.mouse.move(5, 5);
  await shot(p, 'rows-desk-bloque', '.main-content');                          // todas, en reposo
  await p.locator('.library-tracks .track-row').nth(3).click();                         // la 4ª suena (▶ + resaltado)
  await p.waitForTimeout(800);
  await p.mouse.move(5, 5); await p.waitForTimeout(400);
  await shot(p, 'rows-desk-suena', '.library-tracks .track-row >> nth=3');
  await p.locator('.library-tracks .track-row').nth(6).hover(); await p.waitForTimeout(500);   // hover: ▶ en vez del número
  await shot(p, 'rows-desk-hover', '.library-tracks .track-row >> nth=6');
  await shot(p, 'rows-desk-mas', '.library-tracks .track-row >> nth=6 >> .ctx-row-btn');
  await p.locator('.library-tracks .track-row').nth(3).hover(); await p.waitForTimeout(500);   // hover sobre la que suena
  await shot(p, 'rows-desk-suena-hover', '.library-tracks .track-row >> nth=3');
  await ctx.close();
}
// Lista (900) y móvil (390)
for (const [name, opts] of [['lista', { viewport: { width: 900, height: 900 } }], ['movil', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]]) {
  const { ctx, p } = await session(opts);
  await shot(p, `rows-${name}-bloque`, '.main-content');
  await ctx.close();
}
console.log(saved.join('\n'));
await browser.close();
