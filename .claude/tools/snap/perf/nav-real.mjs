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
// ── Álbum SIN album_artist («Random Access Memories (10th…)» con "—", 1 pista; existe además un álbum
//    HOMÓNIMO de Daft Punk con 22). Ruta esperada: /albums/@/<álbum>.
const RAM = 'Random Access Memories (10th Anniversary Edition)';
const RAM_PATH = `/albums/@/${encodeURIComponent(RAM)}`;
const ramCard = (p) => p.locator('.album-grid .album-card').filter({ has: p.locator('.album-artist', { hasText: /^—$/ }) }).filter({ hasText: RAM }).first();
const detailInfo = (p) => p.evaluate(() => ({ title: document.querySelector('.detail-title')?.textContent ?? null, sub: document.querySelector('.detail-sub')?.textContent ?? null, rows: document.querySelectorAll('.track-table .track-row').length }));
// ESE álbum = 1 pista (el homónimo de Daft Punk tiene 22; antes se mezclaban: 23). El subtítulo muestra
// el artista de la pista cuando el álbum no tiene album_artist, como siempre.
const isRam = (d) => d.title === RAM && d.rows === 1;
const R2 = {};
const ok2 = (k, v, extra) => { R2[k] = extra === undefined ? v : { ok: v, ...extra }; };
async function ctxOpen(opts = { viewport: { width: 1440, height: 900 } }, init) {
  const ctx = await browser.newContext(opts);
  await ctx.route('**/stream/**', (r) => r.fulfill({ status: 404, body: '' }));
  await ctx.addInitScript((t) => localStorage.setItem('token', t), token);
  if (init) await ctx.addInitScript(init);
  return { ctx, p: await ctx.newPage() };
}
{
  // 1) Desde la lista: la URL cambia, el historial crece, el detalle es ESE álbum (1 pista, sin las 22
  //    del homónimo) y Volver cae en la lista. 2) F5 sobre el detalle lo reabre.
  const { ctx, p } = await ctxOpen();
  await p.goto(BASE + '/albums'); await p.waitForSelector('.album-grid .album-card'); await p.waitForTimeout(400);
  const a = await snap(p);
  await ramCard(p).click(); await p.waitForSelector('.back-btn'); await p.waitForTimeout(600);
  const b = await snap(p); const d = await detailInfo(p);
  ok2('lista_url_e_historial', b.path === RAM_PATH && b.len === a.len + 1 && isRam(d), { antes: [a.path, a.len], despues: [b.path, b.len], d });
  await p.reload(); await p.waitForSelector('.detail-title', { timeout: 8000 }).catch(() => {}); await p.waitForTimeout(800);
  const f5 = await detailInfo(p);
  ok2('f5_reabre', isRam(f5) && (await snap(p)).path === RAM_PATH, { f5 });
  await p.locator('.back-btn').click(); await p.waitForTimeout(900);
  const v = await snap(p);
  ok2('volver_a_la_lista', v.path === '/albums' && !v.detalle, { v: [v.path, v.len] });
  await ctx.close();
}
{
  // 3) Viniendo de OTRA vista (Biblioteca → Álbumes → el álbum → Volver): cae en Álbumes, no en Biblioteca.
  const { ctx, p } = await ctxOpen();
  await p.goto(BASE + '/'); await p.waitForSelector('.library-tracks .track-row');
  await p.locator('.sidebar button', { hasText: 'Álbumes' }).click(); await p.waitForSelector('.album-grid .album-card');
  await ramCard(p).click(); await p.waitForSelector('.back-btn'); await p.waitForTimeout(500);
  await p.locator('.back-btn').click(); await p.waitForTimeout(900);
  const v = await snap(p);
  ok2('desde_biblioteca_volver_a_albumes', v.path === '/albums' && !v.detalle && (await p.locator('.album-grid').count()) === 1, { v: [v.path, v.len] });
  await ctx.close();
}
{
  // 4) Deep link EN FRÍO a /albums/@/… abre ese detalle; Volver → lista, sin salir de la app.
  const { ctx, p } = await ctxOpen();
  await p.goto(BASE + RAM_PATH); await p.waitForSelector('.detail-title', { timeout: 8000 }).catch(() => {}); await p.waitForTimeout(800);
  const d = await detailInfo(p);
  await p.locator('.back-btn').click(); await p.waitForTimeout(900);
  const v = { ...(await snap(p)), url: p.url() };
  ok2('deeplink_frio', isRam(d) && v.path === '/albums' && v.url.startsWith(BASE), { d, v: [v.path, v.len] });
  await ctx.close();
}
{
  // 5) El link de COMPARTIR (menú contextual de la pista del detalle; portapapeles en escritorio) abre
  //    ESE álbum en una pestaña nueva.
  const { ctx, p } = await ctxOpen(undefined, () => {
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (s) => { window.__copied.push(s); } } });
  });
  await p.goto(BASE + RAM_PATH); await p.waitForSelector('.track-table .track-row', { timeout: 8000 });
  await p.locator('.track-table .track-row').first().click({ button: 'right' });
  await p.waitForSelector('.ctx-menu [role="menuitem"]'); await p.waitForTimeout(250);
  await p.locator('.ctx-menu [role="menuitem"]', { hasText: 'Compartir' }).click(); await p.waitForTimeout(400);
  const text = (await p.evaluate(() => window.__copied.at(-1))) ?? '';
  const link = text.split('\n')[1] ?? '';
  await ctx.close();
  const o = await ctxOpen();
  await o.p.goto(link); await o.p.waitForSelector('.detail-title', { timeout: 8000 }).catch(() => {}); await o.p.waitForTimeout(800);
  const d = await detailInfo(o.p);
  ok2('compartir_abre_ese_album', link === BASE + RAM_PATH && isRam(d), { text, d });
  await o.ctx.close();
}
{
  // 6) Red de seguridad B: si la entrada actual NO es un detalle (se borra su estado a mano), Volver no
  //    hace history.back() (que saldría de la app en esta pestaña nueva): va a la lista de la vista.
  const { ctx, p } = await ctxOpen();
  await p.goto(BASE + '/albums'); await p.waitForSelector('.album-grid .album-card');
  await p.locator('.album-grid .album-card').nth(1).click(); await p.waitForSelector('.back-btn'); await p.waitForTimeout(400);
  await p.evaluate(() => history.replaceState(null, '', location.pathname));
  await p.locator('.back-btn').click(); await p.waitForTimeout(900);
  const v = { ...(await snap(p)), url: p.url() };
  ok2('red_b_sin_estado_va_a_la_lista', v.path === '/albums' && !v.detalle && v.url.startsWith(BASE), { v: [v.path, v.len] });
  await ctx.close();
}
out.__sin_album_artist = R2;
await fetch(BASE + `/api/playlists/${pl.id}`, { method: 'DELETE', headers: H });
console.log(JSON.stringify(out, null, 1));
// Resumen: los 6 casos normales tienen que volver a la lista con URL propia, y los del álbum sin artista pasar.
const normales = Object.entries(out).filter(([k]) => !k.startsWith('__'));
const okN = normales.filter(([, v]) => v.url_cambia_al_abrir && v.volver_a_la_lista).length;
const okS = Object.values(R2).filter((v) => (typeof v === 'object' ? v.ok : v)).length;
console.log(`\nnav-real: ${okN + okS}/${normales.length + Object.keys(R2).length}`);
process.exitCode = okN + okS === normales.length + Object.keys(R2).length ? 0 : 1;
await browser.close();
