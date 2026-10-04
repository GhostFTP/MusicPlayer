// func2.mjs — verificación funcional de las filas/tarjetas memoizadas (complementa func.mjs).
// Uso: SNAP_BASE=http://localhost:4173 node func2.mjs
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
async function context(opts) {
  const ctx = await browser.newContext(opts);
  await ctx.route('**/stream/**', (r) => {
    const h = r.request().headers().range; const total = WAV.length;
    if (!h) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV });
    const [, a, b] = h.match(/bytes=(\d*)-(\d*)/); const start = a ? +a : 0; const end = b ? +b : total - 1;
    r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: WAV.subarray(start, end + 1) });
  });
  await ctx.addInitScript((t) => localStorage.setItem('token', t), token);
  return ctx;
}
const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };

// ── Desktop ──
const ctx = await context({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const wait = (ms) => page.waitForTimeout(ms);
const activeIdx = (sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)].findIndex((r) => r.classList.contains('playing')), sel);
const numText = (sel, i) => page.evaluate(([sel, i]) => document.querySelectorAll(sel)[i]?.querySelector('.track-num')?.textContent, [sel, i]);
const LIB = '.library-tracks .track-row';
await page.goto(BASE + '/');
await page.waitForSelector(LIB);

// clic en fila reproduce + resaltado + indicador
await page.locator(LIB).nth(4).click(); await wait(1200);
ok('clic_fila_reproduce', (await activeIdx(LIB)) === 4 && (await numText(LIB, 4)) === '▶', { activa: await activeIdx(LIB), num: await numText(LIB, 4) });
// pausa: el ▶ desaparece y vuelve el número; la fila sigue resaltada
await page.click('.player-bar .ctrl-btn.play'); await wait(500);
ok('pausa_indicador', (await numText(LIB, 4)) === '5' && (await activeIdx(LIB)) === 4, { num: await numText(LIB, 4), activa: await activeIdx(LIB) });
await page.click('.player-bar .ctrl-btn.play'); await wait(500);
ok('play_indicador', (await numText(LIB, 4)) === '▶', { num: await numText(LIB, 4) });
// siguiente: el resaltado y el ▶ pasan a la 5; la 4 vuelve a su número
await page.click('.player-bar .ctrl-next'); await wait(700);
ok('siguiente_mueve_resaltado', (await activeIdx(LIB)) === 5 && (await numText(LIB, 5)) === '▶' && (await numText(LIB, 4)) === '5',
  { activa: await activeIdx(LIB), num5: await numText(LIB, 5), num4: await numText(LIB, 4) });

// clic derecho abre el menú (con reintento por la pasada de medición)
let menuOk = false;
for (let k = 0; k < 3 && !menuOk; k++) {
  await page.locator(LIB).nth(12).click({ button: 'right' });
  menuOk = await page.waitForSelector('.ctx-menu [role="menuitem"]', { timeout: 1500 }).then(() => true).catch(() => false);
}
ok('clic_derecho_menu', menuOk, { items: await page.locator('.ctx-menu [role="menuitem"]').count() });
await page.keyboard.press('Escape'); await wait(300);
// "⋯" de la fila abre el menú y NO reproduce
const before = await activeIdx(LIB);
await page.locator(LIB).nth(15).locator('.ctx-row-btn').click(); await wait(400);
ok('boton_mas_menu', (await page.locator('.ctx-menu').count()) === 1 && (await activeIdx(LIB)) === before);
await page.keyboard.press('Escape'); await wait(300);

// arrastrar una fila a la cola
await page.click('.player-bar [aria-label="Cola"]');
await page.waitForSelector('.queue-panel .queue-row');
const q0 = await page.evaluate(() => Number((document.querySelector('.queue-panel .queue-kicker')?.textContent.match(/(\d+)\s+pistas?/) ?? [])[1] ?? 0));
await page.locator(LIB).nth(20).dragTo(page.locator('.queue-panel'));
await wait(800);
const q1 = await page.evaluate(() => Number((document.querySelector('.queue-panel .queue-kicker')?.textContent.match(/(\d+)\s+pistas?/) ?? [])[1] ?? 0));
ok('drag_fila_a_cola', q1 === q0 + 1, { cola: `${q0}→${q1}` });
// arrastrar a la barra (2º destino)
await page.locator(LIB).nth(21).dragTo(page.locator('.player-bar'));
await wait(800);
ok('drag_fila_a_barra', (await page.evaluate(() => Number((document.querySelector('.queue-panel .queue-kicker')?.textContent.match(/(\d+)\s+pistas?/) ?? [])[1] ?? 0))) === q1 + 1);
await page.click('.player-bar [aria-label="Cola"]'); await wait(300);

// Álbumes: tarjeta abre el detalle; "Reproducir" del detalle; auto-scroll a la que suena
await page.click('.sidebar button:has-text("Álbumes")');
await page.waitForSelector('.album-grid .album-card');
const nCards = await page.locator('.album-grid .album-card').count();
await page.locator('.album-grid .album-card').nth(2).click();
await page.waitForSelector('.detail-hero');
const albumTitle = await page.locator('.detail-title').textContent();
ok('tarjeta_album_abre', !!albumTitle, { album: albumTitle, url: new URL(page.url()).pathname });
await page.click('.detail-actions .btn-primary'); await wait(800);
const TT = '.track-table .track-row';
ok('detalle_reproducir', (await activeIdx(TT)) === 0, { activa: await activeIdx(TT) });
await page.click('.player-bar .ctrl-next'); await wait(600);
ok('detalle_siguiente_resaltado', (await activeIdx(TT)) === 1 && (await numText(TT, 0)) !== '▶', { activa: await activeIdx(TT) });
// clic derecho en tarjeta de álbum
await page.goBack(); await page.waitForSelector('.album-grid .album-card');
let albMenu = false;
for (let k = 0; k < 3 && !albMenu; k++) { await page.locator('.album-grid .album-card').nth(1).click({ button: 'right' }); albMenu = await page.waitForSelector('.ctx-menu [role="menuitem"]', { timeout: 1500 }).then(() => true).catch(() => false); }
ok('tarjeta_album_menu', albMenu, { cards: nCards, items: await page.locator('.ctx-menu [role="menuitem"]').allTextContents() });
await page.keyboard.press('Escape'); await wait(300);
// arrastrar tarjeta de álbum a la barra encola el álbum
await page.click('.player-bar [aria-label="Cola"]'); await page.waitForSelector('.queue-panel .queue-row');
const qa0 = await page.evaluate(() => Number((document.querySelector('.queue-panel .queue-kicker')?.textContent.match(/(\d+)\s+pistas?/) ?? [])[1] ?? 0));
const albCount = Number((await page.locator('.album-grid .album-card').nth(0).locator('.album-count').textContent()).match(/\d+/)[0]);
await page.locator('.album-grid .album-card').nth(0).dragTo(page.locator('.queue-panel')); await wait(1200);
ok('drag_album_a_cola', (await page.evaluate(() => Number((document.querySelector('.queue-panel .queue-kicker')?.textContent.match(/(\d+)\s+pistas?/) ?? [])[1] ?? 0))) === qa0 + albCount, { cola: `${qa0}→${await page.evaluate(() => Number((document.querySelector('.queue-panel .queue-kicker')?.textContent.match(/(\d+)\s+pistas?/) ?? [])[1] ?? 0))}`, pistas: albCount });
await page.click('.player-bar [aria-label="Cola"]'); await wait(300);

// TrackTable auto-scroll: tocar una pista lejana en un detalle largo, salir y volver a entrar
await page.click('.sidebar button:has-text("Géneros")');
await page.waitForSelector('.genre-item');
const genres = await page.locator('.genre-item').count();
await page.locator('.genre-item').first().click();
await page.waitForSelector(TT);
const nGen = await page.locator(TT).count();
ok('tarjeta_genero_abre', nGen > 0, { generos: genres, pistas: nGen });
if (nGen > 25) {
  await page.locator(TT).nth(nGen - 2).click(); await wait(600);
  await page.goBack(); await page.waitForSelector('.genre-item');
  await page.locator('.genre-item').first().click(); await page.waitForSelector(TT); await wait(600);
  const vis = await page.evaluate(() => { const r = document.querySelector('.track-table .track-row.playing')?.getBoundingClientRect(); return r ? { top: Math.round(r.top), visible: r.top >= 0 && r.bottom <= innerHeight } : null; });
  ok('autoscroll_a_la_que_suena', !!vis?.visible, vis ?? {});
} else ok('autoscroll_a_la_que_suena', 'NO MEDÍ: el primer género tiene pocas pistas');

// Artistas → AlbumGrid: abrir un artista y una tarjeta de su discografía
await page.click('.sidebar button:has-text("Artistas")');
await page.waitForSelector('.artist-portrait, .artist-card');
await page.locator('.artist-portrait, .artist-card').first().click();
const gridOk = await page.waitForSelector('.album-grid-anim .album-card', { timeout: 5000 }).then(() => true).catch(() => false);
if (gridOk) {
  await page.locator('.album-grid-anim .album-card').first().click();
  ok('albumgrid_abre_album', await page.waitForSelector('.detail-hero', { timeout: 5000 }).then(() => true).catch(() => false), { url: new URL(page.url()).pathname });
} else ok('albumgrid_abre_album', 'NO MEDÍ: no apareció la discografía');
await ctx.close();

// ── Móvil emulado: long-press abre el menú en tiles ──
const m = await context({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const mp = await m.newPage();
await mp.goto(BASE + '/'); await mp.waitForSelector(LIB);
const box = await mp.locator(LIB).nth(3).boundingBox();
await mp.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await mp.mouse.down(); await mp.waitForTimeout(700); await mp.mouse.up();
await mp.waitForTimeout(400);
ok('longpress_movil_menu', (await mp.locator('.ctx-menu.ctx-menu--tiles').count()) === 1, { tiles: await mp.locator('.ctx-menu--tiles [role="menuitem"]').count() });
// el long-press no debe reproducir
ok('longpress_no_reproduce', (await mp.locator('.track-row.playing').count()) === 0);
await m.close();

console.log(JSON.stringify(R, null, 1));
await browser.close();
