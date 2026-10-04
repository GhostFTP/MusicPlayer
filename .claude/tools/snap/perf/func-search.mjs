// func-search.mjs — verificación funcional de la búsqueda LOCAL de la Biblioteca (Frente 1, sub-paso 4).
// Uso: SNAP_BASE=http://localhost:4173 node func-search.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';

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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.route('**/stream/**', (r) => {
  const h = r.request().headers().range; const total = WAV.length;
  if (!h) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV });
  const [, a, b] = h.match(/bytes=(\d*)-(\d*)/); const start = a ? +a : 0; const end = b ? +b : total - 1;
  r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: WAV.subarray(start, end + 1) });
});
await ctx.addInitScript((t) => {
  localStorage.setItem('token', t);
  const A = window.Audio;
  window.Audio = function (...a) { const x = new A(...a); window.__audio = x; return x; };
}, token);
const page = await ctx.newPage();
let searchReqs = 0;
page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname === '/api/tracks' && u.searchParams.has('search')) searchReqs++; });
const wait = (ms) => page.waitForTimeout(ms);
const ROWS = '.library-tracks .track-row';
const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };
// Con la ventana de Biblioteca (sub-paso 9) sólo están montadas las filas cercanas a la vista: para ver
// la lista COMPLETA se recorre el scroller y se juntan las filas por su data-index.
const rowKeys = () => page.evaluate(async () => {
  const sc = document.querySelector('.main-content');
  const keyOf = (r) => r.querySelector('.track-title').textContent + ' | ' + r.querySelector('.track-artist').textContent;
  const seen = new Map();
  // sin data-index (build sin ventana) todas las filas están montadas: su posición es su índice
  const grab = () => { [...document.querySelectorAll('.library-tracks .track-row')].forEach((r, i) => seen.set(Number(r.dataset.index ?? i), keyOf(r))); };
  const frame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  const top0 = sc.scrollTop;
  sc.scrollTop = 0; await frame(); grab();
  while (sc.scrollTop + sc.clientHeight < sc.scrollHeight - 1) { sc.scrollTop += sc.clientHeight; await frame(); grab(); }
  sc.scrollTop = top0; await frame();
  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([, k]) => k);
});
const type = async (q) => { await page.fill('.search-box input', q); await wait(700); };
const playingTitle = () => page.evaluate(() => document.querySelector('.track-row.playing .track-title')?.textContent ?? null);

await page.goto(BASE + '/');
await page.waitForSelector(ROWS);
await wait(1500);
const full = await rowKeys();

// 1) escribir: resultados correctos (= servidor para ASCII) y en el mismo orden que la lista completa
const H = { Authorization: `Bearer ${token}` };
const srv = await page.evaluate(async (H) => (await fetch('/api/tracks?limit=10000&search=daf', { headers: H }).then((r) => r.json())).map((t) => t.title + ' | ' + (t.artist ?? '—')), H);
await type('daf');
const got = await rowKeys();
const sameSet = got.length === srv.length && [...got].sort().join('\n') === [...srv].sort().join('\n');
let k = 0; for (const x of full) if (x === got[k]) k++;
ok('escribir_daf_resultados', sameSet && k === got.length, { filas: got.length, servidor: srv.length, mismoConjunto: sameSet, ordenComoListaCompleta: k === got.length, contador: await page.locator('.library-count').getAttribute('aria-label') });
// 2) borrar
await type('');
// Con la ventana no están montadas todas las filas: se compara el CONTADOR y la lista completa recorrida.
const contadorBorrado = await page.locator('.library-count').getAttribute('aria-label');
const tras = await rowKeys();
ok('borrar_vuelve_todo', contadorBorrado === `${full.length} canciones` && tras.length === full.length, { filas: tras.length, contador: contadorBorrado });
// 3) estado vacío
await type('zzzqqq');
ok('sin_resultados', (await page.locator('.empty-title').textContent().catch(() => null)) === 'Sin resultados para «zzzqqq»', { texto: await page.locator('.empty-title').textContent().catch(() => null), sub: await page.locator('.empty-state .empty-sub').count() });
// 4) acentos
await type('orquideas');
ok('acentos_orquideas', (await page.locator(ROWS).count()) === 21, { filas: await page.locator(ROWS).count() });
await type('ÁNGEL');
ok('acentos_ANGEL_mayusculas', (await page.locator(ROWS).count()) === 8, { filas: await page.locator(ROWS).count() });
// 5) tocar una fila filtrada reproduce esa; "siguiente" avanza dentro de la lista filtrada
await type('daf');
const filtered = await rowKeys();
await page.locator(ROWS).nth(2).click(); await wait(900);
const t2 = filtered[2].split(' | ')[0];
ok('clic_fila_filtrada', (await playingTitle()) === t2, { suena: await playingTitle(), esperado: t2 });
await page.click('.player-bar .ctrl-next'); await wait(900);
const t3 = filtered[3].split(' | ')[0];
ok('siguiente_en_filtrada', (await playingTitle()) === t3, { suena: await playingTitle(), esperado: t3 });
// 6) la cola se armó desde la lista filtrada
await page.click('.player-bar [aria-label="Cola"]');
await page.waitForSelector('.queue-panel .queue-row');
const q0 = await page.locator('.queue-panel .queue-row').count();
ok('cola_desde_filtrada', q0 === filtered.length, { cola: q0, filtradas: filtered.length });
// 7) clic derecho y arrastre desde una fila filtrada
let menu = false;
for (let i = 0; i < 3 && !menu; i++) { await page.locator(ROWS).nth(5).click({ button: 'right' }); menu = await page.waitForSelector('.ctx-menu [role="menuitem"]', { timeout: 1500 }).then(() => true).catch(() => false); }
ok('clic_derecho_filtrada', menu);
await page.keyboard.press('Escape'); await wait(300);
await page.locator(ROWS).nth(6).dragTo(page.locator('.queue-panel')); await wait(800);
ok('arrastre_filtrada_a_cola', (await page.locator('.queue-panel .queue-row').count()) === q0 + 1, { cola: `${q0}→${await page.locator('.queue-panel .queue-row').count()}` });
await page.click('.player-bar [aria-label="Cola"]'); await wait(300);
// 8) la barra sigue normal mientras se busca
const a1 = await page.evaluate(() => window.__audio.currentTime);
await type('metal'); await type('');
const a2 = await page.evaluate(() => window.__audio.currentTime);
ok('barra_sigue_avanzando', a2 > a1, { t: `${a1.toFixed(1)}→${a2.toFixed(1)}`, label: await page.locator('.player-bar .time-label.time-elapsed').textContent() });
// 9) ninguna request de búsqueda al servidor (sólo la de la prueba 1, hecha a mano)
ok('requests_search_desde_la_app', searchReqs === 1, { requestsConSearch: searchReqs, nota: '1 = la consulta manual de la prueba 1' });
// 10) escribir ANTES de que cargue la biblioteca no se pierde
const p2 = await ctx.newPage();
await p2.route('**/api/tracks?limit=10000', async (r) => { await new Promise((s) => setTimeout(s, 2500)); r.fallback(); });
await p2.goto(BASE + '/');
await p2.waitForSelector('.search-box input');
await p2.fill('.search-box input', 'daf');
const spinner = await p2.locator('.spinner').count();
await p2.waitForSelector(ROWS, { timeout: 15000 });
await p2.waitForTimeout(800);
const contadorP2 = await p2.locator('.library-count').getAttribute('aria-label');
ok('escribir_antes_de_cargar', contadorP2 === `${got.length} resultados` && (await p2.inputValue('.search-box input')) === 'daf', { spinnerMientrasCarga: spinner, contador: contadorP2, input: await p2.inputValue('.search-box input') });

console.log(JSON.stringify(R, null, 1));
await browser.close();
