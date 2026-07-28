// snap-ctx.mjs — el MENÚ CONTEXTUAL móvil, abierto, en una captura.
//
//   node snap-ctx.mjs                  → la vista por defecto (un álbum de 32 pistas)
//   node snap-ctx.mjs "/albums/…"      → cualquier ruta del Modelo 2
//
// Complemento de snap.mjs, no reemplazo: aquél mide los tres regímenes de ancho de las LISTAS,
// éste abre una superficie que sólo existe en móvil y que ninguna captura estática alcanza.
// Un solo régimen: 390×844 con isMobile+hasTouch, el único donde el menú táctil existe.
//
// (Nació en C2d para comparar tres pieles del menú con un flag `?ctxv=`; C2e fijó la dirección
// "Neón" y el flag desapareció, así que esto volvió a ser lo que tiene que ser: una toma.)
//
// EL LONG-PRESS se simula con el puntero: down, esperar más de HOLD_MS (500) sin moverse, up.
// useLongPress NO mira pointerType (mobile-lab: una sola maquinaria para táctil y mouse), así que
// el mouse de Playwright entra por la misma puerta que el dedo — no hay atajo ni evento fabricado.
//
// LO QUE NO PRUEBA (sigue siendo 🔍 PRUEBA FÍSICA): env(safe-area-*) vale 0 en headless → el
// recorte contra el notch no se ve acá; y la sensación del gesto real tampoco.

import { mkdirSync, unlinkSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE, getToken, loadPlaywright, preflight } from './session.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, 'shots');

const { chromium } = await loadPlaywright();

const PATH = process.argv[2]
  ?? `/albums/${encodeURIComponent('Daft Punk')}/${encodeURIComponent('TRON: Legacy - The Complete Edition (Original Motion Picture Soundtrack)')}`;

const HOLD_MS = 700;   // > los 500 de useLongPress.HOLD_MS, con margen para el reloj del headless

// ── Auditoría del menú abierto ───────────────────────────────────────────────
// Corre DENTRO de la página. Mide lo que el menú promete: targets ≥44, nada de blur, y el
// flotante entero dentro del rectángulo permitido (sin pisar el cromo fijo de abajo).
function auditMenu() {
  const px = (n) => Math.round(n);
  const menu = document.querySelector('.ctx-menu');
  if (!menu) return { ok: false, why: 'no hay .ctx-menu en el DOM' };

  const cs = getComputedStyle(menu);
  const r = menu.getBoundingClientRect();
  const flags = [];

  // Sin blur: el "buffeo" móvil es regresión conocida.
  const blur = cs.backdropFilter ?? cs.webkitBackdropFilter;
  if (blur && blur !== 'none') flags.push({ sev: 'alto', kind: 'blur', detail: `backdrop-filter: ${blur}` });

  // Dentro del viewport.
  if (r.left < -0.5 || r.top < -0.5 || r.right > window.innerWidth + 0.5 || r.bottom > window.innerHeight + 0.5) {
    flags.push({ sev: 'alto', kind: 'fuera-de-pantalla',
      detail: `menú en ${px(r.left)},${px(r.top)} ${px(r.width)}×${px(r.height)} vs viewport ${window.innerWidth}×${window.innerHeight}` });
  }

  // Sin pisar el cromo fijo de abajo (lo que `safeArea()` promete descontar).
  for (const sel of ['.player-bar', '.bottom-nav']) {
    const b = document.querySelector(sel)?.getBoundingClientRect();
    if (b && b.height > 0 && r.bottom > b.top + 0.5) {
      flags.push({ sev: 'alto', kind: 'pisa-cromo', detail: `el menú (bottom ${px(r.bottom)}) invade ${sel} (top ${px(b.top)})` });
    }
  }

  // Targets táctiles y tono de cada acción: que el tile esté teñido con SU identidad y no todos
  // del mismo color es justo lo que se fue a buscar en C2e, así que se reporta.
  const tiles = [...menu.querySelectorAll('.ctx-tile')];
  const acciones = tiles.map((t) => {
    const b = t.getBoundingClientRect();
    return {
      label: t.textContent.trim(),
      w: px(b.width), h: px(b.height),
      tono: [...t.classList].find((c) => c.startsWith('tone-')) ?? '—',
      canales: getComputedStyle(t).getPropertyValue('--t').trim(),
    };
  });
  const chico = acciones.filter((a) => a.h < 44 || a.w < 44);
  if (chico.length) {
    flags.push({ sev: 'alto', kind: 'target<44', detail: chico.map((a) => `"${a.label}" ${a.w}×${a.h}`).join(' · ') });
  }
  if (!tiles.length) flags.push({ sev: 'alto', kind: 'sin-acciones', detail: 'el menú abrió vacío' });

  return { ok: true, flags, caja: { x: px(r.left), y: px(r.top), w: px(r.width), h: px(r.height) }, acciones };
}

await preflight();
const TOKEN = await getToken();

mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();

const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
// Siembra la sesión ANTES de que monte la app: AuthContext lee localStorage en el initializer.
await ctx.addInitScript((t) => {
  localStorage.setItem('token', t);
  localStorage.setItem('loginMethod', 'password');
}, TOKEN);

const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('response', (r) => { if (r.url().includes('/api/') && !r.ok()) problems.push(`HTTP ${r.status()} ${r.url()}`); });

await page.goto(BASE + PATH, { waitUntil: 'domcontentloaded' });

const outcome = await Promise.race([
  page.locator('.track-table .track-row').first().waitFor({ state: 'visible', timeout: 20_000 }).then(() => 'content'),
  page.locator('form input[type="password"]').first().waitFor({ state: 'visible', timeout: 20_000 }).then(() => 'login'),
]).catch(() => 'timeout');

const out = join(SHOTS, 'ctx-menu-390.png');
const fallo = join(SHOTS, 'ctx-menu-390-FALLO.png');

if (outcome !== 'content') {
  console.error(`[snap-ctx] ${outcome === 'login'
    ? 'se renderizó el LOGIN → la sesión sembrada no fue aceptada.'
    : 'ni contenido ni login en 20s → ¿Vite (:5173) y backend (:3000) arriba?'}`);
  for (const p of problems.slice(0, 5)) console.error('  - ' + p);
  await browser.close();
  process.exit(1);
}

// La 4ª fila: deja el ancla a media altura, que es donde cae un pulgar de verdad, y con lugar
// para que el menú se despliegue hacia abajo sin que el flip lo mande arriba de una.
const row = page.locator('.track-table .track-row').nth(3);
const box = await row.boundingBox();
if (!box) { console.error('[snap-ctx] no se pudo medir la fila.'); await browser.close(); process.exit(1); }

await page.mouse.move(box.x + box.width * 0.42, box.y + box.height / 2);   // sobre el título, lejos de controles
await page.mouse.down();
await page.waitForTimeout(HOLD_MS);   // el timer de useLongPress dispara a los 500ms
const abrió = await page.locator('.ctx-menu.ctx-menu--tiles').isVisible().catch(() => false);
await page.mouse.up();

if (!abrió) {
  console.error('[snap-ctx] el long-press no abrió el menú táctil (.ctx-menu--tiles).');
  await page.screenshot({ path: fallo });
  await browser.close();
  process.exit(1);
}
await page.waitForTimeout(250);   // que termine el pop de entrada (.14s)

await page.screenshot({ path: out });
// Esta toma salió bien → el -FALLO viejo ya no describe nada. Borrado por nombre exacto.
if (existsSync(fallo)) unlinkSync(fallo);

const audit = await page.evaluate(auditMenu);

// La "segunda página" del menú (selector de playlists): no se captura, se MIDE. Es lo único que
// podía romperse al cambiar el ancho de la caja. No es fatal: si algo falla, sale como flag.
try {
  await page.locator('.ctx-menu .ctx-tile.tone-playlist').first().click();
  await page.locator('.ctx-menu--wide').waitFor({ state: 'visible', timeout: 3_000 });
  const w = await page.locator('.ctx-menu--wide').evaluate((el) => Math.round(el.getBoundingClientRect().width));
  audit.panelPlaylist = `${w}px`;
  if (w < 280) audit.flags.push({ sev: 'medio', kind: 'panel-angosto', detail: `el selector de playlists quedó en ${w}px` });
} catch {
  audit.flags.push({ sev: 'medio', kind: 'panel-no-verificado', detail: 'no se pudo abrir el selector de playlists' });
}

await browser.close();

console.log(`\n── menú táctil · 390×844 · caja ${audit.caja.w}×${audit.caja.h} en ${audit.caja.x},${audit.caja.y}${audit.panelPlaylist ? ` · panel playlists ${audit.panelPlaylist}` : ''}`);
for (const a of audit.acciones) console.log(`   ${String(a.w).padStart(3)}×${a.h}  ${a.tono.padEnd(14)} ${a.canales.padEnd(14)} ${a.label}`);
if (!audit.flags.length) console.log('   ✓ sin flags (targets ≥44, sin blur, dentro del área segura)');
for (const f of audit.flags) console.log(`   ${f.sev === 'alto' ? '🔴' : '🟡'} ${f.kind}: ${f.detail}`);
for (const p of problems.slice(0, 5)) console.log(`   ⚠ ${p}`);
console.log(`   → ${out}`);

writeFileSync(join(SHOTS, 'report-ctx.json'), JSON.stringify({ ...audit, file: out, problems }, null, 2));
process.exit(audit.flags.some((f) => f.sev === 'alto') ? 1 : 0);
