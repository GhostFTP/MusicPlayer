// fav-func.mjs — funcional de FAVORITOS ("Mis favoritos", la misma playlist que la app iOS):
// creación perezosa y única, reuso de una creada desde el iPhone, corazón optimista con deshacer +
// toast ámbar si el servidor falla, 404 (la borraron) y el ítem del menú contextual.
// ⚠️ ESCRIBE en la base del backend al que apunta (crea/borra playlists de la cuenta de prueba):
// correrlo SÓLO contra un backend con una COPIA de la base.
// Uso: SNAP_BASE=http://localhost:4173 [SHOTS=1] node fav-func.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'shots', 'sub3', process.env.OUT ?? 'fav');
if (process.env.SHOTS) mkdirSync(OUT, { recursive: true });
const FAV = 'Mis favoritos';

function wav(sec = 120, sr = 8000) {
  const n = sec * sr, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const WAV = wav();

// API directa (la cuenta de prueba), para preparar y verificar el estado del servidor.
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
const apiJ = async (path, opts = {}) => {
  const r = await fetch(BASE + path, { ...opts, headers: H });
  return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
};
const favLists = async () => (await apiJ('/api/playlists')).body.filter((p) => p.name.trim() === FAV);
const favTrackIds = async (id) => (await apiJ(`/api/playlists/${id}/tracks`)).body.map((t) => t.id);
async function wipeFavs() { for (const p of await favLists()) await apiJ(`/api/playlists/${p.id}`, { method: 'DELETE' }); }

const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };
const LIB = '.library-tracks .track-row';

let failTracks = false;   // POST/DELETE de pistas de playlist → 500
let delayCreate = 0;      // retraso del POST /api/playlists (para probar el vuelo único)
const creates = [];
async function newCtx(opts = { viewport: { width: 1440, height: 900 } }) {
  const ctx = await browser.newContext(opts);
  await ctx.route('**/stream/**', (r) => {
    const h = r.request().headers().range; const total = WAV.length;
    if (!h) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV });
    const [, a, b] = h.match(/bytes=(\d*)-(\d*)/); const start = a ? +a : 0; const end = b ? +b : total - 1;
    r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: WAV.subarray(start, end + 1) });
  });
  await ctx.route('**/api/playlists**', async (r) => {
    const req = r.request(); const u = new URL(req.url());
    if (req.method() === 'POST' && u.pathname === '/api/playlists') {
      creates.push(JSON.parse(req.postData() ?? '{}'));
      if (delayCreate) await new Promise((res) => setTimeout(res, delayCreate));
    }
    if (failTracks && /\/api\/playlists\/\d+\/tracks/.test(u.pathname) && req.method() !== 'GET') {
      return r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"x"}' });
    }
    return r.continue();
  });
  await ctx.addInitScript((t) => { localStorage.setItem('token', t); }, token);
  return ctx;
}

await wipeFavs();
let ctx = await newCtx();
let page = await ctx.newPage();
const wait = (ms) => page.waitForTimeout(ms);
const heart = () => page.locator('.player-bar .fav-player');
const heartOn = async () => (await heart().getAttribute('aria-pressed')) === 'true';
const playingId = () => page.evaluate(() => navigator.mediaSession?.metadata ? null : null);
async function rowMenu(i, label) {
  const row = page.locator(LIB).nth(i);
  for (let k = 0; k < 3; k++) {
    await row.scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await row.click({ button: 'right' });
    if (await page.waitForSelector('.ctx-menu [role="menuitem"]', { timeout: 1500 }).then(() => true).catch(() => false)) break;
  }
  await wait(250);
  const labels = await page.locator('.ctx-menu [role="menuitem"]').allTextContents();
  if (label) await page.locator('.ctx-menu [role="menuitem"]', { hasText: label }).first().click();
  else await page.keyboard.press('Escape');
  return labels;
}
// id de la pista de una fila: se lee de la lista que cachea la app (misma que pinta la tabla).
const tracksAll = (await apiJ('/api/tracks?limit=10000')).body;
const idOfTitle = (title) => tracksAll.find((t) => t.title === title)?.id;

await page.goto(BASE + '/');
await page.waitForSelector(LIB);
await page.locator(LIB).nth(0).click(); await wait(800);

// 1) Cargar la app NO crea "Mis favoritos".
ok('cargar_no_crea', (await favLists()).length === 0 && creates.length === 0 && !(await heartOn()));

// 2) Primer corazón: se llena AL INSTANTE, crea UNA "Mis favoritos" sin emoji y agrega la pista.
const t0 = (await page.locator('.player-bar .player-title').first().textContent()).trim();
const id0 = idOfTitle(t0);
await heart().click();
const inmediato = await heartOn();
await wait(1200);
let favs = await favLists();
ok('primer_corazon_optimista', inmediato);
ok('crea_una_sin_emoji', favs.length === 1 && creates.length === 1 && creates[0].name === FAV && !creates[0].emoji && !favs[0].emoji, { creates, favs: favs.map((f) => ({ id: f.id, name: f.name, emoji: f.emoji })) });
ok('agrega_la_pista', favs.length === 1 && (await favTrackIds(favs[0].id)).includes(id0), { id0 });
const favId = favs[0]?.id;

// 3) Quitar: el corazón se vacía y la pista sale del servidor.
await heart().click(); await wait(1000);
ok('quitar', !(await heartOn()) && !(await favTrackIds(favId)).includes(id0));

// 4) Menú contextual: "Agregar a favoritos" → luego ofrece "Quitar de favoritos".
const t3 = (await page.locator(LIB).nth(3).locator('.track-title').textContent()).trim();
const l1 = await rowMenu(3, 'Agregar a favoritos'); await wait(1000);
const l2 = await rowMenu(3, null);
ok('menu_agregar_y_quitar', l1.some((l) => l.includes('Agregar a favoritos')) && l2.some((l) => l.includes('Quitar de favoritos')) && (await favTrackIds(favId)).includes(idOfTitle(t3)), { l1, l2 });
ok('sigue_una_sola', (await favLists()).length === 1 && creates.length === 1);

// 5) Servidor falla → el corazón VUELVE a como estaba y aparece un toast ámbar.
failTracks = true;
await heart().click();
const opt = await heartOn();
await wait(1200);
const warn = await page.locator('.toast.warning').allTextContents();
ok('falla_deshace_y_avisa', opt === true && !(await heartOn()) && warn.some((w) => w.includes('Mis favoritos')), { warn });
if (process.env.SHOTS) await page.screenshot({ path: join(OUT, 'toast-ambar-1440.png') });
failTracks = false;
await page.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 6000 }).catch(() => {});

// 6) La borraron (desde otro lado): el próximo corazón re-resuelve y crea otra, sin error.
await apiJ(`/api/playlists/${favId}`, { method: 'DELETE' });
await heart().click(); await wait(1500);
favs = await favLists();
ok('borrada_re_resuelve', (await heartOn()) && favs.length === 1 && favs[0].id !== favId && (await favTrackIds(favs[0].id)).includes(id0) && (await page.locator('.toast.warning').count()) === 0, { nueva: favs[0]?.id });
await ctx.close();

// 7) REUSO de la del iPhone: existen DOS "Mis favoritos" (la más vieja creada "desde iOS" con una
//    pista); este navegador no tiene id guardado → elige la MÁS VIEJA, muestra su corazón lleno y
//    agrega ahí, sin crear otra.
await wipeFavs();
const ios = (await apiJ('/api/playlists', { method: 'POST', body: JSON.stringify({ name: FAV }) })).body;
await new Promise((r) => setTimeout(r, 1100));   // created_at tiene resolución de segundos
const otra = (await apiJ('/api/playlists', { method: 'POST', body: JSON.stringify({ name: ' Mis favoritos ' }) })).body;
creates.length = 0;
ctx = await newCtx(); page = await ctx.newPage();
await page.goto(BASE + '/'); await page.waitForSelector(LIB);
// La pista "favorita desde iOS" es una fila VISIBLE (la tabla usa ventana: no todas están en el DOM).
const idx = 2;
const tIos = { title: (await page.locator(LIB).nth(idx).locator('.track-title').textContent()).trim() };
tIos.id = idOfTitle(tIos.title);
await apiJ(`/api/playlists/${ios.id}/tracks`, { method: 'POST', body: JSON.stringify({ track_ids: [tIos.id] }) });
await page.evaluate(() => localStorage.removeItem('sonorarev.favoritos'));
await page.reload(); await page.waitForSelector(LIB);
// reproducir la pista que ya era favorita en "iOS"
await page.locator(LIB).nth(idx).click(); await wait(1200);
const llenoDesdeIos = await heartOn();
await page.locator('.player-bar .ctrl-next').click(); await wait(800);
const tNext = (await page.locator('.player-bar .player-title').first().textContent()).trim();
await heart().click(); await wait(1200);
const listsNow = await favLists();
ok('reusa_la_de_ios', tIos.id != null && llenoDesdeIos && creates.length === 0 && listsNow.length === 2
  && (await favTrackIds(ios.id)).includes(idOfTitle(tNext)) && !(await favTrackIds(otra.id)).length, { ios: ios.id, otra: otra.id, creates: creates.length, idx, llenoDesdeIos, lists: listsNow.length, tNext, tNextId: idOfTitle(tNext), iosTracks: await favTrackIds(ios.id), otraTracks: await favTrackIds(otra.id) });
ok('guarda_id_por_cuenta', await page.evaluate((id) => { const d = JSON.parse(localStorage.getItem('sonorarev.favoritos') ?? 'null'); return d?.id === id && /^id:|^u:/.test(d.owner); }, ios.id));

// 8) Un id guardado de OTRA cuenta se ignora.
await page.evaluate((id) => localStorage.setItem('sonorarev.favoritos', JSON.stringify({ owner: 'id:999999', id })), otra.id);
await page.reload(); await page.waitForSelector(LIB);
await page.locator(LIB).nth(idx).click(); await wait(1200);
{ const h = await heartOn(); const st = await page.evaluate(() => localStorage.getItem("sonorarev.favoritos")); ok("id_de_otra_cuenta_ignorado", h && JSON.parse(st).id === ios.id, { h, st, ios: ios.id }); }
await ctx.close();

// 9) VUELO ÚNICO: sin "Mis favoritos" y con la creación lenta, dos corazones seguidos crean UNA.
await wipeFavs();
creates.length = 0; delayCreate = 900;
ctx = await newCtx(); page = await ctx.newPage();
await page.goto(BASE + '/'); await page.waitForSelector(LIB);
await page.evaluate(() => localStorage.removeItem('sonorarev.favoritos'));
await page.reload(); await page.waitForSelector(LIB);
await page.locator(LIB).nth(1).click(); await wait(800);
await heart().click();
await rowMenu(5, 'Agregar a favoritos');
await wait(2500);
favs = await favLists();
ok('vuelo_unico', creates.length === 1 && favs.length === 1 && (await favTrackIds(favs[0].id)).length === 2, { creates: creates.length, favs: favs.length });
delayCreate = 0;

// El corazón de la BARRA sólo donde cabe sin apretar el título (>= 1280px); debajo, oculto.
{
  const vis = {};
  for (const w of [1440, 1280, 1279, 1024]) { await page.setViewportSize({ width: w, height: 900 }); await wait(250); vis[w] = await heart().isVisible(); }
  await page.setViewportSize({ width: 1440, height: 900 }); await wait(250);
  ok('barra_solo_desde_1280', vis[1440] && vis[1280] && !vis[1279] && !vis[1024], vis);
}

// Capturas: barra 1440/1280/1024 con el corazón lleno y vacío; expandido.
if (process.env.SHOTS) {
  for (const w of [1440, 1280, 1024]) {
    await page.setViewportSize({ width: w, height: 900 }); await wait(400);
    await page.locator('.player-bar').screenshot({ path: join(OUT, `barra-on-${w}.png`) });
    if (await heart().isVisible()) {
      await heart().hover(); await wait(300);
      await page.locator('.player-bar').screenshot({ path: join(OUT, `barra-on-hover-${w}.png`) });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.player-bar .player-art').click(); await wait(900);
  await page.screenshot({ path: join(OUT, 'expandido-1440.png') });
  await page.keyboard.press('Escape'); await wait(500);
  await rowMenu(5, null);
}
await ctx.close();

// 10) MÓVIL: el corazón vive en el header del expandido (la barra mini no lo muestra).
const m = await newCtx({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const mp = await m.newPage();
await mp.goto(BASE + '/'); await mp.waitForSelector(LIB);
await mp.locator(LIB).nth(1).click(); await mp.waitForTimeout(800);
const barVisible = await mp.locator('.player-bar .fav-player').isVisible().catch(() => false);
await mp.locator('.player-bar').click(); await mp.waitForTimeout(900);
const expHeart = mp.locator('.exp-head-actions .fav-exp');
const expVis = await expHeart.isVisible().catch(() => false);
const expOn = (await expHeart.getAttribute('aria-pressed').catch(() => null)) === 'true';
ok('movil_corazon_en_expandido', !barVisible && expVis && expOn, { barVisible, expVis, expOn });
if (process.env.SHOTS) await mp.screenshot({ path: join(OUT, 'expandido-390.png') });
await m.close();

await wipeFavs();
const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
console.log(`\nfav-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
