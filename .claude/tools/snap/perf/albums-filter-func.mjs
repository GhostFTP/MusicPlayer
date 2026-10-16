// albums-filter-func.mjs — funcional del FILTRO del listado de Álbumes (v1: Ordenar + Década).
// Sin filtro todo igual que antes (orden del servidor, contador "N álbumes", ningún pedido nuevo: sólo
// /api/albums); cada orden contra un cálculo propio sobre /api/albums; décadas OR dentro del grupo y AND
// con el buscador; badge = grupos activos; "N de M álbumes"; guardado por usuario (segunda cuenta real),
// recarga, década guardada obsoleta (no filtra ni cuenta), JSON corrupto → predeterminado; estado vacío
// con "Limpiar filtro"; Mix = sólo los álbumes filtrados; Esc y retorno del foco sin fugas a los atajos
// globales; hoja móvil (foco adentro, scrim que cierra sin abrir el álbum de abajo, 44px) y sin desbordes
// a 390 y en la franja 701–1024.
// La segunda cuenta (SNAP2_USER / SNAP2_PASS) tiene que existir SÓLO en la COPIA de la base.
// Uso: SNAP_BASE=http://localhost:4173 SNAP2_USER=… SNAP2_PASS=… node albums-filter-func.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';

await preflight();
const token = await getToken();
const login2 = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: process.env.SNAP2_USER, password: process.env.SNAP2_PASS }) });
const token2 = login2.ok ? (await login2.json()).token : null;
const idOf = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).id;
const K1 = `sonorarev.albumsFilter:id:${idOf(token)}`;
const K2 = token2 ? `sonorarev.albumsFilter:id:${idOf(token2)}` : null;

// Los datos de verdad, para calcular cada resultado esperado por fuera de la app.
const ALBUMS = await (await fetch(BASE + '/api/albums', { headers: { Authorization: 'Bearer ' + token } })).json();
const keyOf = (a) => `${a.album}|${a.album_artist ?? ''}`;
const dec = (a) => (a.year ? String(Math.floor(a.year / 10) * 10) : 'none');
const cmp = (a, b) => (a ?? '').localeCompare(b ?? '', 'es', { sensitivity: 'base' });
const byAA = (a, b) => cmp(a.album_artist, b.album_artist) || cmp(a.album, b.album);
const DECS = [...new Set(ALBUMS.map(dec))].filter((d) => d !== 'none').sort();
// Las dos décadas con más álbumes: el OR se nota y el AND con el buscador tiene con qué cruzar.
const byCount = DECS.map((d) => [d, ALBUMS.filter((a) => dec(a) === d).length]).sort((x, y) => y[1] - x[1]);
const [DA, DB] = [byCount[0][0], byCount[1][0]];
const label = (d) => `Años ${d}`;
const EXPECT = {
  az: ALBUMS.slice().sort((a, b) => cmp(a.album, b.album) || cmp(a.album_artist, b.album_artist)),
  'year-asc': ALBUMS.slice().sort((a, b) => (!a.year !== !b.year ? (a.year ? -1 : 1) : (a.year && b.year ? a.year - b.year : 0) || byAA(a, b))),
  'year-desc': ALBUMS.slice().sort((a, b) => (!a.year !== !b.year ? (a.year ? -1 : 1) : (a.year && b.year ? b.year - a.year : 0) || byAA(a, b))),
  tracks: ALBUMS.slice().sort((a, b) => (b.track_count ?? 0) - (a.track_count ?? 0) || byAA(a, b)),
};
const SORT_BTN = { az: 'A–Z', 'year-asc': 'Año ↑', 'year-desc': 'Año ↓', tracks: 'Más pistas', artist: 'Artista' };

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };

async function open(opts, init, initArg) {
  const ctx = await browser.newContext(opts);
  await ctx.route('**/stream/**', (r) => r.fulfill({ status: 404, body: '' }));
  await ctx.addInitScript((t) => { if (!sessionStorage.getItem('__seeded')) { localStorage.setItem('token', t); sessionStorage.setItem('__seeded', '1'); } }, token);
  if (init) await ctx.addInitScript(init, initArg);
  const p = await ctx.newPage();
  const api = [];
  p.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) api.push(u.pathname); });
  return { ctx, p, api };
}
const gotoAlbums = async (p) => { await p.goto(BASE + '/albums'); await p.waitForSelector('.album-grid .album-card'); await p.waitForTimeout(300); };
const cards = (p) => p.evaluate(() => [...document.querySelectorAll('.album-grid .album-card')].map((c) => `${c.querySelector('.album-name').textContent}|${c.querySelector('.album-artist').textContent === '—' ? '' : c.querySelector('.album-artist').textContent}`));
const view = (p) => p.evaluate(() => ({
  count: document.querySelector('.view-actions .section-count')?.textContent.trim(),
  badge: document.querySelector('.af-badge')?.textContent ?? null,
  expanded: document.querySelector('.af-btn')?.getAttribute('aria-expanded'),
}));
const openPanel = async (p) => { if ((await p.locator('.af-panel').count()) === 0) await p.click('.af-btn'); await p.waitForSelector('.af-panel'); };
const closePanel = async (p) => { if (await p.locator('.af-panel').count()) { await p.keyboard.press('Escape'); await p.waitForTimeout(100); } };
const pickSort = async (p, s) => { await openPanel(p); await p.click(`.af-panel [role="radio"]:has-text("${SORT_BTN[s]}")`); };
const toggleDec = async (p, d) => { await openPanel(p); await p.click(`.af-panel [aria-label="${label(d)}"]`); };
const clearKeys = (p) => p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('sonorarev.albumsFilter:')) localStorage.removeItem(k); });
const overflow = (p) => p.evaluate(() => {
  const d = document.documentElement;
  const offenders = [...document.querySelectorAll('.view-actions *, .af-panel *')].filter((el) => { const r = el.getBoundingClientRect(); return r.width && (r.right > innerWidth + 0.5 || r.left < -0.5); }).map((el) => el.className).slice(0, 4);
  return { scroll: d.scrollWidth, client: d.clientWidth, offenders };
});
const kicker = (p) => p.evaluate(() => Number((document.querySelector('.queue-panel .queue-kicker')?.textContent.match(/(\d+)\s+pistas?/) ?? [])[1] ?? 0));

// ── Escritorio ──
{
  const { ctx, p, api } = await open({ viewport: { width: 1440, height: 900 } });
  await p.goto(BASE + '/'); await clearKeys(p);
  // Arranque directo en /albums: sin filtro, la vista pide SÓLO /api/albums (ningún /api/tracks).
  api.length = 0;
  await gotoAlbums(p);
  await p.waitForTimeout(700);
  // Las carátulas (/api/tracks/:id/cover) son imágenes de las tarjetas, no datos: quedan fuera.
  const reqs = api.filter((x) => !x.endsWith('/cover'));
  let v = await view(p);
  const c0 = await cards(p);
  ok('sin_filtro_identico', c0.join('\n') === ALBUMS.map(keyOf).join('\n') && v.count === `${ALBUMS.length} álbumes` && v.badge === null && v.expanded === 'false'
    && (await p.evaluate((k) => localStorage.getItem(k), K1)) === null, { count: v.count, badge: v.badge });
  ok('sin_requests_nuevos', reqs.includes('/api/albums') && !reqs.some((x) => x.startsWith('/api/tracks')), { reqs: [...new Set(reqs)] });

  // Abrir el panel y elegir orden/décadas tampoco pide nada (todo sale de la lista cargada).
  api.length = 0;
  // Cada orden contra el cálculo propio. Artista = el del servidor, intacto.
  const sorts = {};
  for (const s of ['az', 'year-asc', 'year-desc', 'tracks']) {
    await pickSort(p, s);
    sorts[s] = (await cards(p)).join('\n') === EXPECT[s].map(keyOf).join('\n');
  }
  await pickSort(p, 'artist');
  sorts.artist = (await cards(p)).join('\n') === ALBUMS.map(keyOf).join('\n');
  v = await view(p);
  ok('ordenes', Object.values(sorts).every(Boolean) && v.badge === null && v.count === `${ALBUMS.length} álbumes`, sorts);

  // Década: OR dentro del grupo; el orden se mantiene sobre lo filtrado.
  await toggleDec(p, DA);
  const onlyA = ALBUMS.filter((a) => dec(a) === DA);
  const cA = await cards(p);
  await toggleDec(p, DB);
  const AB = ALBUMS.filter((a) => [DA, DB].includes(dec(a)));
  const cAB = await cards(p);
  await pickSort(p, 'year-desc');
  const cABsorted = await cards(p);
  v = await view(p);
  ok('decada_or_y_orden', cA.join('\n') === onlyA.map(keyOf).join('\n') && cAB.join('\n') === AB.map(keyOf).join('\n')
    && cABsorted.join('\n') === EXPECT['year-desc'].filter((a) => [DA, DB].includes(dec(a))).map(keyOf).join('\n'), { DA, DB, nA: cA.length, nAB: cAB.length });
  if (process.env.RAW) { await p.evaluate(() => document.querySelector('.section-header').scrollIntoView({ block: 'start' })); await p.waitForTimeout(200); await p.screenshot({ path: `${process.env.RAW}/aff-1440-popover.png` }); }
  ok('badge_y_n_de_m', v.badge === '2' && v.count === `${AB.length} de ${ALBUMS.length} álbumes`
    && /2 filtros activos/.test(await p.getAttribute('.af-btn', 'aria-label')), v);
  ok('sin_requests_al_filtrar', !api.some((x) => !x.endsWith('/cover')), { reqs: api.filter((x) => !x.endsWith('/cover')) });

  // AND con el buscador: buscar un artista que tenga álbumes dentro Y fuera de las décadas elegidas.
  const art = [...new Set(ALBUMS.map((a) => a.album_artist).filter(Boolean))].find((x) => {
    const mine = ALBUMS.filter((a) => a.album_artist === x);
    return mine.some((a) => [DA, DB].includes(dec(a)));
  });
  await closePanel(p);
  await p.fill('.section-header .search-box input', art); await p.waitForTimeout(400);
  const cS = await cards(p);
  const fold = (s) => (s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const wantS = EXPECT['year-desc'].filter((a) => [DA, DB].includes(dec(a)) && (fold(a.album).includes(fold(art)) || fold(a.album_artist).includes(fold(art))));
  ok('and_con_buscador', cS.join('\n') === wantS.map(keyOf).join('\n') && cS.length > 0, { art, n: cS.length });
  await p.fill('.section-header .search-box input', ''); await p.waitForTimeout(300);

  // Persistencia: se guardó con la clave del usuario y sobrevive a recargar.
  const saved = JSON.parse(await p.evaluate((k) => localStorage.getItem(k), K1));
  await p.reload(); await p.waitForSelector('.album-grid .album-card'); await p.waitForTimeout(300);
  v = await view(p);
  ok('guarda_por_usuario_y_recarga', saved.sort === 'year-desc' && saved.decades.length === 2 && v.badge === '2' && (await cards(p)).join('\n') === cABsorted.join('\n'), { saved, v });

  // Mix con filtro: la cola son SÓLO las pistas de los álbumes filtrados.
  const wantMix = AB.reduce((s, a) => s + (a.track_count ?? 0), 0);
  await p.click('.view-actions .mix-btn'); await p.waitForTimeout(1500);
  await p.click('.player-bar .action-btn[aria-label="Cola"]'); await p.waitForSelector('.queue-panel .queue-kicker');
  const nMix = await kicker(p);
  await p.click('.player-bar .action-btn[aria-label="Cola"]');
  ok('mix_con_filtro', nMix === wantMix && wantMix < ALBUMS.reduce((s, a) => s + (a.track_count ?? 0), 0), { nMix, wantMix });

  // Esc cierra y el foco vuelve al botón; ninguna tecla del panel llega a window.
  await p.evaluate(() => { window.__leaked = []; window.addEventListener('keydown', (e) => window.__leaked.push(e.key)); });
  await p.focus('.af-btn'); await p.keyboard.press('Enter'); await p.waitForSelector('.af-panel');
  const focusIn = await p.evaluate(() => document.activeElement?.closest('.af-panel') != null && document.activeElement.getAttribute('aria-checked') === 'true');
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowLeft');
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  const st = await p.evaluate(() => ({ open: !!document.querySelector('.af-panel'), focusBtn: document.activeElement?.classList.contains('af-btn'), exp: document.querySelector('.af-btn').getAttribute('aria-expanded') }));
  const leaked = await p.evaluate(() => window.__leaked.filter((k) => k !== 'Enter'));
  ok('esc_y_foco', focusIn && !st.open && st.focusBtn && st.exp === 'false' && leaked.length === 0, { focusIn, ...st, leaked });

  // Estado vacío: buscar un álbum que quedó FUERA del filtro → mensaje + "Limpiar filtro".
  const outside = ALBUMS.find((a) => ![DA, DB].includes(dec(a)));
  await p.fill('.section-header .search-box input', outside.album); await p.waitForTimeout(400);
  const empty = await p.evaluate(() => ({ cards: document.querySelectorAll('.album-grid .album-card').length, btn: !!document.querySelector('.empty-state .btn-primary') }));
  await p.click('.empty-state .btn-primary'); await p.waitForTimeout(300);
  v = await view(p);
  const afterClear = await cards(p);
  const stored = JSON.parse(await p.evaluate((k) => localStorage.getItem(k), K1));
  ok('vacio_con_limpiar', empty.cards === 0 && empty.btn && v.badge === null && afterClear.includes(keyOf(outside)) && stored.sort === 'artist' && stored.decades.length === 0, { empty, v });
  await p.fill('.section-header .search-box input', ''); await p.waitForTimeout(300);

  // Década guardada OBSOLETA (no existe en los datos): no filtra ni cuenta en el badge.
  await p.evaluate((k) => localStorage.setItem(k, JSON.stringify({ sort: 'az', decades: ['1900'] })), K1);
  await p.reload(); await p.waitForSelector('.album-grid .album-card'); await p.waitForTimeout(300);
  v = await view(p);
  ok('obsoleto_ignorado', v.badge === '1' && (await cards(p)).length === ALBUMS.length && v.count === `${ALBUMS.length} de ${ALBUMS.length} álbumes`, v);

  // JSON corrupto → predeterminado sin romper.
  await p.evaluate((k) => localStorage.setItem(k, '{"sort":'), K1);
  await p.reload(); await p.waitForSelector('.album-grid .album-card'); await p.waitForTimeout(300);
  v = await view(p);
  ok('json_corrupto', v.badge === null && (await cards(p)).join('\n') === ALBUMS.map(keyOf).join('\n') && v.count === `${ALBUMS.length} álbumes`, v);

  // Segunda cuenta real: arranca sin filtro; lo suyo no pisa lo de la primera.
  if (token2) {
    await p.evaluate((k) => localStorage.setItem(k, JSON.stringify({ sort: 'tracks', decades: [] })), K1);
    await p.evaluate((t) => localStorage.setItem('token', t), token2);
    await p.reload(); await p.waitForSelector('.album-grid .album-card'); await p.waitForTimeout(300);
    const u2 = await view(p);
    await toggleDec(p, DA); await closePanel(p);
    const k2 = JSON.parse(await p.evaluate((k) => localStorage.getItem(k), K2));
    await p.evaluate((t) => localStorage.setItem('token', t), token);
    await p.reload(); await p.waitForSelector('.album-grid .album-card'); await p.waitForTimeout(300);
    const u1 = await view(p);
    const k1 = JSON.parse(await p.evaluate((k) => localStorage.getItem(k), K1));
    ok('no_se_mezcla_entre_cuentas', u2.badge === null && k2.decades[0] === DA && u1.badge === '1' && k1.sort === 'tracks' && k1.decades.length === 0
      && (await cards(p)).join('\n') === EXPECT.tracks.map(keyOf).join('\n'), { u2: u2.badge, k2, u1: u1.badge, k1 });
  } else ok('no_se_mezcla_entre_cuentas', false, { motivo: 'sin SNAP2_USER/SNAP2_PASS o el login falló' });
  await clearKeys(p);
  await ctx.close();
}

// ── Franja 701–1024 (y escritorio angosto): sin desbordes, popover dentro de la pantalla ──
{
  const res = {};
  for (const w of [701, 820, 1024]) {
    const { ctx, p } = await open({ viewport: { width: w, height: 900 } }, (k) => localStorage.setItem(k, JSON.stringify({ sort: 'year-asc', decades: [] })), K1);
    await gotoAlbums(p);
    await openPanel(p);
    const o = await overflow(p);
    const pb = await p.locator('.af-panel').boundingBox();
    const sheet = await p.locator('.af-panel--sheet').count();
    if (process.env.RAW && w === 820) await p.screenshot({ path: `${process.env.RAW}/aff-820.png` });
    res[w] = { ok: o.scroll <= o.client && o.offenders.length === 0 && pb.x >= 0 && pb.x + pb.width <= w && sheet === 0, ...o };
    await ctx.close();
  }
  ok('franja_701_1024', Object.values(res).every((x) => x.ok), res);
}

// ── Teléfono (390): hoja desde abajo ──
{
  const { ctx, p } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await p.goto(BASE + '/'); await clearKeys(p);
  await gotoAlbums(p);
  const bb = await p.locator('.af-btn').boundingBox();
  // Sin filtro, Mix + contador + filtro + vista entran en UNA fila (como antes de existir el filtro).
  const rows = await p.evaluate(() => new Set([...document.querySelectorAll('.view-actions > *')].map((e) => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2))).size);
  ok('movil_una_fila_sin_filtro', rows === 1 && Math.round(bb.width) === 44, { filas: rows, ancho: bb.width });
  await p.click('.af-btn'); await p.waitForSelector('.af-panel--sheet'); await p.waitForTimeout(400);   // que termine de subir
  const sheet = await p.evaluate(() => {
    const s = document.querySelector('.af-panel--sheet'); const r = s.getBoundingClientRect();
    return {
      bottom: Math.round(r.bottom), fixed: getComputedStyle(s).position, scrim: !!document.querySelector('.af-scrim'),
      focusIn: s.contains(document.activeElement), modal: s.getAttribute('aria-modal'),
      minH: Math.min(...[...s.querySelectorAll('button')].map((b) => b.getBoundingClientRect().height)),
    };
  });
  ok('movil_hoja', Math.round(bb.height) >= 44 && sheet.bottom === 844 && sheet.fixed === 'fixed' && sheet.scrim && sheet.focusIn && sheet.modal === 'true' && sheet.minH >= 44, { btn: bb.height, ...sheet });

  // Con filtro activo ("N de M álbumes" es más largo) no desborda a 390.
  await p.click(`.af-panel [aria-label="${label(DA)}"]`);
  await p.click('.af-panel [role="radio"]:has-text("Año ↓")');
  const o = await overflow(p);
  if (process.env.RAW) await p.screenshot({ path: `${process.env.RAW}/aff-390-hoja.png` });
  ok('movil_390_sin_desbordar', o.scroll <= o.client && o.offenders.length === 0, o);

  // Tocar el scrim (sobre una tarjeta) cierra, no abre el álbum de abajo, y el foco vuelve al botón.
  const card = await p.locator('.album-grid .album-card').nth(0).boundingBox();
  await p.mouse.click(card.x + card.width / 2, card.y + card.height / 2); await p.waitForTimeout(500);
  // …y el toque SIGUIENTE sobre la tarjeta sí la abre después (no quedó un click tragado de más) — se
  // prueba al final, para no perder esta vista.
  const st = await p.evaluate(() => ({ open: !!document.querySelector('.af-panel'), scrim: !!document.querySelector('.af-scrim'), detail: !!document.querySelector('.detail-title'), focusBtn: document.activeElement?.classList.contains('af-btn') }));
  if (process.env.RAW) await p.screenshot({ path: `${process.env.RAW}/aff-390-lista.png` });
  ok('scrim_cierra_sin_abrir', !st.open && !st.scrim && !st.detail && st.focusBtn, st);

  // Esc en la hoja también cierra y devuelve el foco.
  await p.click('.af-btn'); await p.waitForSelector('.af-panel--sheet');
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  ok('movil_esc', await p.evaluate(() => !document.querySelector('.af-panel') && document.activeElement?.classList.contains('af-btn')));
  // Tras cerrar con el scrim, el toque siguiente funciona: reabrir enseguida (<600ms) y tocar una tarjeta.
  await p.click('.af-btn'); await p.waitForSelector('.af-panel--sheet');
  await p.mouse.click(card.x + card.width / 2, card.y + card.height / 2); await p.waitForTimeout(100);
  await p.click('.af-btn'); const reopened = await p.waitForSelector('.af-panel--sheet', { timeout: 2000 }).then(() => true, () => false);
  await p.mouse.click(card.x + card.width / 2, card.y + card.height / 2); await p.waitForTimeout(150);
  await p.mouse.click(card.x + card.width / 2, card.y + card.height / 2); await p.waitForTimeout(900);
  ok('movil_toque_siguiente', reopened && (await p.locator('.detail-title').count()) === 1, { reopened });
  await clearKeys(p);
  await ctx.close();
}

const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
if (process.env.RAW) { const { writeFileSync, mkdirSync } = await import('node:fs'); mkdirSync(process.env.RAW, { recursive: true }); writeFileSync(`${process.env.RAW}/albums-filter-func.json`, JSON.stringify(R, null, 1)); }
console.log(`\nalbums-filter-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
