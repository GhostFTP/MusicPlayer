// playlist-404-func.mjs — funcional del arreglo del "+" (fix/web-anadir-playlist-404): AGREGAR A UNA
// PLAYLIST QUE FALLA con 404 no deja errores sin atrapar, avisa con el texto de cada causa y suelta el
// candado del botón. Lo mismo en el menú contextual (mismos textos, una sola fuente) y en el corazón.
//
// Origen: en v1.43.0 el "+" del reproductor (AddToPlaylistMenu.addTo) no tenía catch: un
// POST /api/playlists/14/tracks → 404 { error: 'Track not found' } (la pista cambió de id con un
// reescaneo y la pestaña tenía el viejo) quedaba como "Uncaught (in promise)" y sin aviso.
//
// Los 404 se FABRICAN con page.route (el cuerpo es el del servidor: smoke-playlist-404.mjs fija ese
// contrato del lado del backend). ⚠️ ESCRIBE en la base del backend al que apunta (crea y borra
// playlists de la cuenta de prueba): correrlo SÓLO contra un backend con una COPIA de la base.
// Uso: SNAP_BASE=http://localhost:4173 node playlist-404-func.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';

await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

// Los textos que pidió Oscar (copiados a mano a propósito: si alguien los cambia en el código, esto falla).
const T_PISTA = 'Esta canción cambió en la biblioteca. Recarga la página para agregarla.';
const T_PLAYLIST = 'Esa playlist ya no existe.';
const T_OTRO = 'No se pudo agregar a la playlist.';
const FAV = 'Mis favoritos';
const NOMBRE = 'PL404 prueba';
const NUEVA = 'PL404 nueva';

function wav(sec = 120, sr = 8000) {
  const n = sec * sr, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const WAV = wav();

const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
const apiJ = async (path, opts = {}) => {
  const r = await fetch(BASE + path, { ...opts, headers: H });
  return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
};
const lists = async () => (await apiJ('/api/playlists')).body;
async function limpiar() {
  for (const p of await lists()) {
    if ([NOMBRE, NUEVA, FAV].includes(p.name.trim())) await apiJ(`/api/playlists/${p.id}`, { method: 'DELETE' });
  }
}

const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };
const LIB = '.library-tracks .track-row';

// ── Lo que el route fabrica ──
// falla = { tipo: 'pista'|'playlist'|'otro', veces } → los próximos `veces` POST a /:id/tracks fallan.
let falla = null;
const posts = [];          // cada POST a /api/playlists/:id/tracks: { id, body }
let getsLista = 0;         // GET /api/playlists (la lista)
const CUERPOS = {
  pista: { status: 404, body: '{"error":"Track not found"}' },
  playlist: { status: 404, body: '{"error":"Playlist not found"}' },
  otro: { status: 500, body: '{"error":"x"}' },
};

await limpiar();
const pl = (await apiJ('/api/playlists', { method: 'POST', body: JSON.stringify({ name: NOMBRE }) })).body;

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.route('**/stream/**', (r) => {
  const h = r.request().headers().range; const total = WAV.length;
  if (!h) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV });
  const [, a, b] = h.match(/bytes=(\d*)-(\d*)/); const start = a ? +a : 0; const end = b ? +b : total - 1;
  r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: WAV.subarray(start, end + 1) });
});
await ctx.route('**/api/playlists**', async (r) => {
  const req = r.request(); const u = new URL(req.url());
  if (req.method() === 'GET' && u.pathname === '/api/playlists') getsLista++;
  const m = u.pathname.match(/^\/api\/playlists\/(\d+)\/tracks$/);
  if (m && req.method() === 'POST') {
    posts.push({ id: Number(m[1]), body: req.postData() });
    if (falla && falla.veces > 0) {
      falla.veces--;
      const c = CUERPOS[falla.tipo];
      return r.fulfill({ status: c.status, contentType: 'application/json', body: c.body });
    }
  }
  return r.continue();
});
await ctx.addInitScript((t) => {
  localStorage.setItem('token', t);
  window.__sinAtrapar = [];
  window.addEventListener('unhandledrejection', (e) => { window.__sinAtrapar.push(String(e.reason?.message ?? e.reason)); });
}, token);

const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
const wait = (ms) => page.waitForTimeout(ms);
const sinAtrapar = async () => [...pageErrors, ...(await page.evaluate(() => window.__sinAtrapar))];
const toasts = () => page.locator('.toast.warning .toast-text').allTextContents();
const sinToasts = () => page.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 8000 }).catch(() => {});

await page.goto(BASE + '/');
await page.waitForSelector(LIB);
await page.locator(LIB).nth(0).click(); await wait(900);

// ── El "+" del reproductor ──
const MAS = '.player-bar .ptp-btn';
const itemMas = () => page.locator('.player-bar .ptp-menu .ptp-item-main', { hasText: NOMBRE });
async function abrirMas() {
  if (!(await page.locator('.player-bar .ptp-menu').count())) await page.locator(MAS).click();
  await itemMas().waitFor({ timeout: 4000 });
}

// 1) Track not found: aviso propio, nada sin atrapar, el menú sigue abierto y el botón se suelta.
await abrirMas();
falla = { tipo: 'pista', veces: 2 };
posts.length = 0;
await itemMas().click(); await wait(700);
{
  const w = await toasts(); const s = await sinAtrapar();
  ok('mas_pista_aviso', w.includes(T_PISTA), { w });
  ok('mas_pista_sin_uncaught', s.length === 0, { s });
  ok('mas_pista_menu_abierto', (await page.locator('.player-bar .ptp-menu').count()) === 1);
  // El candado `busy` se soltó: un segundo clic SÍ manda otro POST.
  await itemMas().click(); await wait(700);
  ok('mas_pista_boton_libre', posts.length === 2, { posts: posts.length });
}
falla = null; await sinToasts();

// 2) Playlist not found: su aviso y la lista se vuelve a pedir.
falla = { tipo: 'playlist', veces: 1 };
{
  const antes = getsLista;
  await itemMas().click(); await wait(900);
  const w = await toasts(); const s = await sinAtrapar();
  ok('mas_playlist_aviso', w.includes(T_PLAYLIST), { w });
  ok('mas_playlist_recarga_lista', getsLista > antes, { antes, despues: getsLista });
  ok('mas_playlist_sin_uncaught', s.length === 0, { s });
}
falla = null; await sinToasts();

// 3) Cualquier otro fallo (500): el aviso genérico, y NO se recarga la lista.
falla = { tipo: 'otro', veces: 1 };
{
  const antes = getsLista;
  await itemMas().click(); await wait(900);
  const w = await toasts(); const s = await sinAtrapar();
  ok('mas_otro_aviso', w.includes(T_OTRO) && !w.includes(T_PISTA) && !w.includes(T_PLAYLIST), { w });
  ok('mas_otro_no_recarga', getsLista === antes, { antes, despues: getsLista });
  ok('mas_otro_sin_uncaught', s.length === 0, { s });
}
falla = null; await sinToasts();

// 4) Crear y agregar, con la pista que cambió: la playlist SÍ se creó, el aviso es el de la pista, el
//    campo se limpia (no se crea dos veces) y la nueva aparece en la lista.
falla = { tipo: 'pista', veces: 1 };
{
  await page.locator('.player-bar .ptp-new input').fill(NUEVA);
  await page.locator('.player-bar .ptp-new .ptp-new-btn').click(); await wait(1200);
  const w = await toasts(); const s = await sinAtrapar();
  const creadas = (await lists()).filter((p) => p.name === NUEVA);
  const campo = await page.locator('.player-bar .ptp-new input').inputValue().catch(() => null);
  const enLista = await page.locator('.player-bar .ptp-menu .ptp-item-name', { hasText: NUEVA }).count();
  ok('crear_pista_aviso', w.includes(T_PISTA), { w });
  ok('crear_pista_limpia_y_lista', creadas.length === 1 && campo === '' && enLista === 1, { creadas: creadas.length, campo, enLista });
  ok('crear_pista_sin_uncaught', s.length === 0, { s });
}
falla = null; await sinToasts();
await page.keyboard.press('Escape'); await wait(300);

// ── El menú contextual: los MISMOS textos ──
async function ctxPlaylist(i) {
  const row = page.locator(LIB).nth(i);
  for (let k = 0; k < 3; k++) {
    await row.scrollIntoViewIfNeeded();
    await row.click({ button: 'right' });
    if (await page.waitForSelector('.ctx-menu [role="menuitem"]', { timeout: 1500 }).then(() => true).catch(() => false)) break;
  }
  await page.locator('.ctx-menu [role="menuitem"]', { hasText: 'Agregar a playlist' }).first().click();
  await page.locator('.ctx-menu .ptp-item-main', { hasText: NOMBRE }).first().waitFor({ timeout: 4000 });
}
falla = { tipo: 'pista', veces: 1 };
await ctxPlaylist(2);
await page.locator('.ctx-menu .ptp-item-main', { hasText: NOMBRE }).first().click(); await wait(800);
{
  const w = await toasts(); const s = await sinAtrapar();
  ok('ctx_pista_mismo_texto', w.includes(T_PISTA), { w });
  ok('ctx_pista_sin_uncaught', s.length === 0, { s });
}
falla = null; await sinToasts();
falla = { tipo: 'playlist', veces: 1 };
{
  const antes = getsLista;
  await page.locator('.ctx-menu .ptp-item-main', { hasText: NOMBRE }).first().click(); await wait(900);
  const w = await toasts();
  ok('ctx_playlist_mismo_texto_y_recarga', w.includes(T_PLAYLIST) && getsLista > antes, { w, antes, despues: getsLista });
}
falla = null; await sinToasts();
await page.keyboard.press('Escape'); await wait(300);

// ── El corazón ("Mis favoritos", utils/favorites.js) ──
const heart = () => page.locator('.player-bar .fav-player');
const heartOn = async () => (await heart().getAttribute('aria-pressed')) === 'true';
// Preparación: el primer corazón crea "Mis favoritos" y guarda su id; se quita para dejarlo vacío.
await heart().click(); await wait(1300);
await heart().click(); await wait(1000);
const clave = await page.evaluate(() => localStorage.getItem('sonorarev.favoritos'));
const favId = JSON.parse(clave ?? 'null')?.id;
ok('fav_preparado', Number.isInteger(favId) && !(await heartOn()), { clave });

// 5) Track not found: se deshace, avisa con el texto de la pista, NO borra la clave y NO repite el POST.
falla = { tipo: 'pista', veces: 5 };
posts.length = 0;
await heart().click(); await wait(1300);
{
  const w = await toasts(); const s = await sinAtrapar();
  const clave2 = await page.evaluate(() => localStorage.getItem('sonorarev.favoritos'));
  ok('fav_pista_deshace', !(await heartOn()));
  ok('fav_pista_aviso', w.includes(T_PISTA), { w });
  ok('fav_pista_no_borra_clave', clave2 === clave, { antes: clave, despues: clave2 });
  ok('fav_pista_un_solo_post', posts.length === 1 && posts[0].id === favId, { posts });
  ok('fav_pista_sin_uncaught', s.length === 0, { s });
}
falla = null; await sinToasts();

// 6) Playlist not found SIGUE re-resolviendo (como antes): un 404 así y el segundo intento sale bien.
falla = { tipo: 'playlist', veces: 1 };
posts.length = 0;
await heart().click(); await wait(1500);
{
  const w = await toasts();
  ok('fav_playlist_re_resuelve', (await heartOn()) && posts.length === 2 && w.length === 0, { posts: posts.length, w });
}
falla = null;
await heart().click(); await wait(1000);   // la deja como estaba

const s = await sinAtrapar();
ok('nada_sin_atrapar_al_final', s.length === 0, { s });

await ctx.close();
await limpiar();
const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
console.log(`\nplaylist-404-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
