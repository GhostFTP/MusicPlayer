// nav-real.mjs — DIAGNÓSTICO de navegación real (sólo lectura): desde la LISTA de cada vista, clic de
// mouse (1440) en un ítem → ¿cambia la URL al abrir el detalle? ¿crece el historial? → clic en la
// pastilla Volver → ¿cae en la lista correcta, en otra vista o fuera de la app? Repite Álbumes con un
// toque real (touchscreen.tap) a 390. Anota URL, history.length y si hay detalle en cada paso.
// La playlist de prueba se crea y se borra: correr SÓLO contra un backend con COPIA de la base.
// Uso: SNAP_BASE=http://localhost:4173 node nav-real.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
const pl = await (await fetch(BASE + '/api/playlists', { method: 'POST', headers: H, body: JSON.stringify({ name: 'nav-real temporal' }) })).json();

const CASES = [
  { view: 'albums', list: '/albums', item: '.album-grid .album-card', n: 1 },
  { view: 'artists', list: '/artists', item: '.artist-grid .artist-portrait', n: 0 },
  { view: 'genres', list: '/genres', item: '.genre-item', n: 0 },
  { view: 'years', list: '/years', item: '.browse-item', n: 0 },
  { view: 'playlists', list: '/playlists', item: '.playlist-item', n: 0, match: 'nav-real temporal' },
];
const snap = (p) => p.evaluate(() => ({ path: location.pathname, len: history.length, state: history.state, detalle: !!document.querySelector('.back-btn') }));
const out = {};
async function run(c, mobile) {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
  await ctx.route('**/stream/**', (r) => r.fulfill({ status: 404, body: '' }));
  await ctx.addInitScript((t) => localStorage.setItem('token', t), token);
  const p = await ctx.newPage();
  await p.goto(BASE + c.list);
  await p.waitForSelector(c.item, { timeout: 10000 });
  await p.waitForTimeout(500);
  const enLista = await snap(p);
  const loc = c.match ? p.locator(c.item, { hasText: c.match }).first() : p.locator(c.item).nth(c.n);
  const label = (await loc.textContent()).trim().slice(0, 40);
  if (mobile) { const b = await loc.boundingBox(); await p.touchscreen.tap(b.x + b.width / 2, b.y + Math.min(b.height / 2, 60)); }
  else await loc.click();
  await p.waitForSelector('.back-btn', { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(600);
  const enDetalle = await snap(p);
  if (mobile) { const b = await p.locator('.back-btn').boundingBox(); await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); }
  else await p.locator('.back-btn').click();
  await p.waitForTimeout(900);
  const trasVolver = { ...(await snap(p)), url: p.url() };
  out[`${c.view}${mobile ? '-390-tap' : '-1440-mouse'}`] = {
    item: label,
    lista: { path: enLista.path, len: enLista.len },
    detalle: { path: enDetalle.path, len: enDetalle.len, abierto: enDetalle.detalle, state: enDetalle.state },
    volver: { path: trasVolver.path, len: trasVolver.len, sigueEnDetalle: trasVolver.detalle, fueraDeLaApp: !trasVolver.url.startsWith(BASE) },
    url_cambia_al_abrir: enDetalle.path !== enLista.path,
    volver_a_la_lista: trasVolver.path === c.list && !trasVolver.detalle,
  };
  await ctx.close();
}
for (const c of CASES) await run(c, false);
await run(CASES[0], true);
// Álbum SIN album_artist (la 1ª tarjeta de la DB local, «Random Access Memories», con "—"): stateToPath
// necesita album + album_artist para armar la ruta del detalle.
await run({ ...CASES[0], view: "albums-sin-album_artist", n: 0 }, false);
// …y llegando a Álbumes desde OTRA vista (Biblioteca → sidebar Álbumes → tarjeta → Volver).
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => localStorage.setItem("token", t), token);
  const p = await ctx.newPage();
  await p.goto(BASE + "/"); await p.waitForSelector(".library-tracks .track-row");
  await p.locator(".sidebar button", { hasText: "Álbumes" }).click(); await p.waitForSelector(".album-grid .album-card");
  const a = await snap(p);
  await p.locator(".album-grid .album-card").nth(0).click(); await p.waitForSelector(".back-btn"); await p.waitForTimeout(500);
  const b = await snap(p);
  await p.locator(".back-btn").click(); await p.waitForTimeout(900);
  const d = { ...(await snap(p)), url: p.url() };
  out["albums-sin-album_artist-desde-biblioteca"] = { lista: { path: a.path, len: a.len }, detalle: { path: b.path, len: b.len }, volver: { path: d.path, len: d.len, url: d.url, enBiblioteca: !!(await p.locator(".library-tracks").count()) } };
  await ctx.close();
}
await fetch(BASE + `/api/playlists/${pl.id}`, { method: 'DELETE', headers: H });
console.log(JSON.stringify(out, null, 1));
await browser.close();
