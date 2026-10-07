// mix-shots.mjs — capturas del botón "Mix aleatorio" en sus ESTADOS (Frente 2, sub-paso M2b), a 1440 y
// 390. Complementa header-shots.mjs (estado normal de las vistas reales) con lo que ésa no cubre:
//   · detalle de PLAYLIST (snap@local no tiene playlists → se simulan por red: una de 3 pistas y otra
//     de 1, con pistas reales de la biblioteca);
//   · DESHABILITADO: álbum de 1 pista (Alive 1997), Biblioteca con una búsqueda de 1 resultado y la
//     playlist de 1 pista;
//   · FOCO por teclado (Tab hasta el Mix): Álbumes, detalle de artista (hero) y detalle de playlist.
//   · M2c: "Cargando…" congelado (pedido de la biblioteca colgado) con el mouse afuera y con foco de
//     teclado (Tab + Enter), y el TOAST de error (pedido abortado) en pantalla completa.
// Recorte: la zona alrededor del botón (rect del botón ± margen), el mismo en los dos builds.
// Salida: shots/sub3/<OUT>/x-<ancho>-<caso>.png. Uso: SNAP_BASE=http://localhost:4173 OUT=m2b-despues node mix-shots.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'shots', 'sub3', process.env.OUT ?? 'm2b-despues');
mkdirSync(OUT, { recursive: true });
await preflight();
const token = await getToken();
const H = { Authorization: `Bearer ${token}` };
const LIB = await fetch(`${BASE}/api/tracks?limit=10000`, { headers: H }).then((r) => r.json());
const enc = encodeURIComponent;
// término de búsqueda con UN solo resultado (título único que no aparece en ningún otro campo)
const fold = (s) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const hay = LIB.map((t) => fold(`${t.title} ${t.artist} ${t.album}`));
const one = LIB.find((t) => t.title && t.title.length > 8 && hay.filter((h) => h.includes(fold(t.title))).length === 1);
const PL = [
  { id: 901, name: 'Prueba Mix', emoji: '🎧', track_count: 3, created_at: '2026-01-01 00:00:00' },
  { id: 902, name: 'Una sola', emoji: '🎸', track_count: 1, created_at: '2026-01-01 00:00:00' },
];
const plTracks = { 901: LIB.slice(0, 3).map((t, i) => ({ ...t, position: i })), 902: LIB.slice(3, 4).map((t) => ({ ...t, position: 0 })) };

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const saved = [];
for (const [w, opts] of [
  [1440, { viewport: { width: 1440, height: 900 } }],
  [390, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
]) {
  const ctx = await browser.newContext({ deviceScaleFactor: 1, ...opts });
  await ctx.addInitScript((t) => localStorage.setItem('token', t), token);
  await ctx.route((url) => new URL(url).pathname === '/api/playlists', (r) => r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PL) }) : r.fallback());
  await ctx.route((url) => /^\/api\/playlists\/90[12]\/tracks$/.test(new URL(url).pathname), (r) => {
    const id = Number(new URL(r.request().url()).pathname.split('/')[3]);
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(plTracks[id]) });
  });
  const p = await ctx.newPage();
  const shot = async (name) => {
    await p.mouse.move(2, 2);
    await p.waitForTimeout(300);
    const b = await p.locator('.mix-btn').first().boundingBox();
    const vw = opts.viewport.width;
    const clip = { x: Math.max(0, b.x - 60), y: Math.max(0, b.y - 40), width: Math.min(vw - Math.max(0, b.x - 60), b.width + 120), height: b.height + 80 };
    const path = join(OUT, `x-${w}-${name}.png`);
    await p.screenshot({ path, clip, animations: 'disabled' });
    saved.push(path);
  };
  const go = async (path, sel = '.mix-btn') => { await p.goto(BASE + path); await p.waitForSelector(sel, { timeout: 15000 }); await p.waitForTimeout(1500); };
  const focusMix = async () => {
    await p.locator('body').click({ position: { x: 1, y: 1 } }).catch(() => {});
    for (let k = 0; k < 80; k++) {
      await p.keyboard.press('Tab');
      if (await p.evaluate(() => document.activeElement?.classList.contains('mix-btn'))) return true;
    }
    return false;
  };
  // normal: detalle de playlist (3 pistas)
  await go('/playlists/901'); await shot('playlist-normal');
  if (await focusMix()) await shot('playlist-foco');
  // deshabilitado: playlist de 1, álbum de 1, búsqueda de 1
  await go('/playlists/902'); await shot('playlist-1pista');
  await go(`/albums/${enc('Daft Punk')}/${enc('Alive 1997')}`); await shot('album-1pista');
  await go('/', '.library-tracks .track-row'); await p.fill('.search-box input', one.title); await p.waitForTimeout(800); await shot('biblioteca-1resultado');
  // foco: listado de Álbumes y hero de artista
  await go('/albums'); if (await focusMix()) await shot('albumes-foco');
  await go(`/artists/${enc('Daft Punk')}`); if (await focusMix()) await shot('artista-foco');
  // M2c · "Cargando…" congelado: el pedido de la biblioteca no responde nunca (en frío, URL directa)
  const isLib = (u) => { const x = new URL(u); return x.pathname === '/api/tracks' && x.searchParams.get('limit') === '10000' && [...x.searchParams.keys()].length === 1; };
  const hang = () => {};   // no fulfill: queda pendiente
  await p.route(isLib, hang);
  await go('/albums'); await p.locator(':is(.section-header, .view-actions) .mix-btn').click(); await p.waitForTimeout(600); await shot('albumes-cargando');
  await go('/albums'); if (await focusMix()) { await p.keyboard.press('Enter'); await p.waitForTimeout(600); await shot('albumes-cargando-foco'); }
  await p.unroute(isLib, hang);
  // M2c · toast de error: el pedido se aborta
  const abort = (r) => r.abort('failed');
  await p.route(isLib, abort);
  await go('/albums'); await p.locator(':is(.section-header, .view-actions) .mix-btn').click(); await p.waitForTimeout(700);
  await p.mouse.move(2, 2);
  { const path = join(OUT, `x-${w}-toast.png`); await p.screenshot({ path, animations: 'disabled' }); saved.push(path); }
  await p.unroute(isLib, abort);
  await ctx.close();
}
console.log(`búsqueda de 1 resultado: «${one.title}»`);
console.log(saved.join('\n'));
await browser.close();
