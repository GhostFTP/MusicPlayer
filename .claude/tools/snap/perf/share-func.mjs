// share-func.mjs — funcional de COMPARTIR (menú contextual → utils/share.js) en el navegador.
// La hoja del sistema y el portapapeles se reemplazan por dobles que GRABAN lo que reciben y se
// pueden poner en cada modo (sin share / share ok / el usuario cancela / share denegado; portapapeles
// ok / falla). El texto copiado se valida contra la fila y su link se ABRE: tiene que llevar al
// álbum de esa pista con una sesión iniciada.
// Uso: SNAP_BASE=http://localhost:4173 [SHOTS=1] node share-func.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'shots', 'sub3', process.env.OUT ?? 'share');
if (process.env.SHOTS) mkdirSync(OUT, { recursive: true });

const stubs = (t) => {
  localStorage.setItem('token', t);
  window.__shareMode = 'none'; window.__clipMode = 'ok'; window.__shared = []; window.__copied = [];
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    get() {
      if (window.__shareMode === 'none') return undefined;
      return async (d) => {
        window.__shared.push(d);
        if (window.__shareMode === 'abort') throw new DOMException('cancelado', 'AbortError');
        if (window.__shareMode === 'deny') throw new DOMException('sin permiso', 'NotAllowedError');
      };
    },
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (s) => { if (window.__clipMode === 'fail') throw new DOMException('no', 'NotAllowedError'); window.__copied.push(s); } },
  });
};

async function context(opts) {
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(stubs, token);
  return ctx;
}
const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };
const LIB = '.library-tracks .track-row';

const ctx = await context({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const wait = (ms) => page.waitForTimeout(ms);
const set = (k, v) => page.evaluate(([k, v]) => { window[k] = v; }, [k, v]);
const got = (k) => page.evaluate((k) => window[k], k);
const toastTexts = () => page.locator('.toast').allTextContents();
const clearToasts = () => page.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 6000 }).catch(() => {});
async function menuOn(locator, label = 'Compartir') {
  for (let k = 0; k < 3; k++) {
    await locator.scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await locator.click({ button: 'right' });
    if (await page.waitForSelector('.ctx-menu [role="menuitem"]', { timeout: 1500 }).then(() => true).catch(() => false)) break;
  }
  await wait(250);
  const labels = await page.locator('.ctx-menu [role="menuitem"]').allTextContents();
  if (label) await page.locator('.ctx-menu [role="menuitem"]', { hasText: label }).first().click();
  return labels;
}

// 0) ANTES de nada: el link de un álbum abre ESE álbum con la sesión iniciada (deep link frío).
const albums = await (await fetch(BASE + '/api/albums', { headers: { Authorization: `Bearer ${token}` } })).json();
const list = Array.isArray(albums) ? albums : (albums.albums ?? []);
const conAcento = list.find((a) => a.album_artist && /[^\x00-\x7F]|[&/?#'"]/.test(a.album + a.album_artist)) ?? list.find((a) => a.album_artist);
const deep = `/albums/${encodeURIComponent(conAcento.album_artist.normalize('NFC'))}/${encodeURIComponent(conAcento.album.normalize('NFC'))}`;
await page.goto(BASE + deep);
const abrio = await page.waitForSelector('.detail-title', { timeout: 8000 }).then(() => true).catch(() => false);
ok('deeplink_abre_album', abrio && (await page.locator('.detail-title').textContent()) === conAcento.album, { album: conAcento.album, album_artist: conAcento.album_artist, url: deep });

await page.goto(BASE + '/');
await page.waitForSelector(LIB);

// 1) Fila de Biblioteca, SIN hoja del sistema → portapapeles + toast. El texto es el de la fila.
const row = page.locator(LIB).nth(4);
const rowTitle = (await row.locator('.track-title').textContent()).trim();
const labels = await menuOn(row);
await wait(400);
const copied = (await got('__copied')).at(-1) ?? '';
const [linea, link] = copied.split('\n');
ok('menu_tiene_compartir_al_final', labels.at(-1)?.includes('Compartir'), { labels });
ok('portapapeles_texto', linea?.startsWith(`${rowTitle} – `) && link?.startsWith(`${new URL(BASE).origin}/albums/`), { copied });
ok('portapapeles_toast', (await toastTexts()).some((t) => t.includes('Copiado para compartir')), { toasts: await toastTexts() });

// 2) Ese link abre el álbum de la pista y la pista está en él.
if (link) {
  await page.goto(link);
  const ab = await page.waitForSelector('.detail-title', { timeout: 8000 }).then(() => true).catch(() => false);
  const titles = ab ? (await page.locator('.track-row .track-title').allTextContents()).map((s) => s.trim()) : [];
  ok('link_abre_album_de_la_pista', ab && titles.includes(rowTitle), { link, album: ab ? await page.locator('.detail-title').textContent() : null });
  await page.goto(BASE + '/'); await page.waitForSelector(LIB);
} else ok('link_abre_album_de_la_pista', false, { copied });

// 3) CON hoja del sistema: se llama con { text } (el link dentro del texto, como iOS) y sin toast.
await clearToasts();
await set('__shareMode', 'ok');
const nCopied = (await got('__copied')).length;
await menuOn(page.locator(LIB).nth(4));
await wait(400);
const sh = (await got('__shared')).at(-1);
ok('share_sistema_text', !!sh && Object.keys(sh).join() === 'text' && sh.text === copied, { shared: sh });
ok('share_sistema_sin_toast_ni_copia', (await toastTexts()).length === 0 && (await got('__copied')).length === nCopied);

// 4) El usuario CANCELA la hoja: nada de avisos ni copia.
await set('__shareMode', 'abort');
await menuOn(page.locator(LIB).nth(5));
await wait(400);
ok('cancelar_no_avisa', (await toastTexts()).length === 0 && (await got('__copied')).length === nCopied);

// 5) La hoja falla (permiso denegado): cae al portapapeles y avisa "copiado".
await set('__shareMode', 'deny');
await menuOn(page.locator(LIB).nth(5));
await wait(400);
ok('share_denegado_cae_a_portapapeles', (await got('__copied')).length === nCopied + 1 && (await toastTexts()).some((t) => t.includes('Copiado')));
await clearToasts();

// 6) Sin hoja y el portapapeles falla → toast ÁMBAR.
await set('__shareMode', 'none'); await set('__clipMode', 'fail');
await menuOn(page.locator(LIB).nth(6));
await wait(400);
const warn = await page.locator('.toast.warning').allTextContents();
ok('falla_toast_ambar', warn.some((t) => t.includes('No se pudo compartir')), { warn });
if (process.env.SHOTS) await page.screenshot({ path: join(OUT, 'toast-ambar-1440.png') });
await set('__clipMode', 'ok');
await clearToasts();

// 7) Tarjeta de ÁLBUM: «Álbum – Artista del álbum» + link.
await page.goto(BASE + '/albums'); await page.waitForSelector('.album-grid .album-card');
const card = page.locator('.album-grid .album-card').nth(1);
const albLabels = await menuOn(card);
await wait(400);
const albText = (await got('__copied')).at(-1) ?? '';
ok('album_compartir', albLabels.at(-1)?.includes('Compartir') && /^.+ – .+\nhttps?:\/\/[^/]+\/albums\/[^/]+\/[^/]+$/.test(albText), { albText, albLabels });
await clearToasts();

// 8) Fila de la COLA: también ofrece Compartir.
await page.goto(BASE + '/'); await page.waitForSelector(LIB);
await page.locator(LIB).nth(0).click(); await wait(500);
await page.click('.player-bar [aria-label="Cola"]'); await wait(600);
const qLabels = await menuOn(page.locator('.queue-row').nth(1), null);
ok('cola_tiene_compartir', qLabels.some((l) => l.includes('Compartir')), { qLabels });
await page.keyboard.press('Escape'); await wait(300);
await page.click('.player-bar [aria-label="Cola"]').catch(() => {}); await wait(300);

// Capturas del menú (1440 y 1024).
if (process.env.SHOTS) {
  for (const w of [1440, 1024]) {
    await page.setViewportSize({ width: w, height: 900 }); await wait(400);
    await page.goto(BASE + '/'); await page.waitForSelector(LIB);
    await menuOn(page.locator(LIB).nth(6), null);
    await page.screenshot({ path: join(OUT, `menu-${w}.png`) });
    await page.keyboard.press('Escape'); await wait(200);
    await page.locator(LIB).nth(6).click({ button: 'right' }); await wait(300);
    await page.locator('.ctx-menu [role="menuitem"]', { hasText: 'Compartir' }).first().click(); await wait(350);
    await page.screenshot({ path: join(OUT, `toast-${w}.png`) });
    await clearToasts();
  }
}
await ctx.close();

// 9) MÓVIL: long-press abre los tiles y "Compartir" está.
const m = await context({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const mp = await m.newPage();
await mp.goto(BASE + '/'); await mp.waitForSelector(LIB);
const box = await mp.locator(LIB).nth(3).boundingBox();
await mp.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await mp.mouse.down(); await mp.waitForTimeout(700); await mp.mouse.up();
await mp.waitForTimeout(400);
const tiles = await mp.locator('.ctx-menu--tiles [role="menuitem"]').allTextContents();
ok('movil_tile_compartir', tiles.some((t) => t.includes('Compartir')), { tiles });
if (process.env.SHOTS) await mp.screenshot({ path: join(OUT, 'menu-390.png') });
await mp.locator('.ctx-menu--tiles [role="menuitem"]', { hasText: 'Compartir' }).first().click();
await mp.waitForTimeout(400);
ok('movil_copia_y_toast', (await mp.evaluate(() => window.__copied.length)) === 1 && (await mp.locator('.toast').count()) === 1);
if (process.env.SHOTS) await mp.screenshot({ path: join(OUT, 'toast-390.png') });
await m.close();

const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
console.log(`\nshare-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
