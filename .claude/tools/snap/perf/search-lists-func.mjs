// search-lists-func.mjs — funcional del BUSCADOR DE LOS LISTADOS en VIDEOS y en la LISTA de PLAYLISTS
// (sub-paso S3). Hermano de search-views-func.mjs (Álbumes) y search-browse-func.mjs (Artistas, Géneros).
//
// Videos (las 3 fixtures sintéticas de regresion.mjs: Fixture Dos/Largo Para Seek · Fixture Uno/Faststart
// · Fixture Uno/Moov Al Final): tecleo y contador (con singular), acentos y mayúsculas, limpiar, sin
// resultados, lista vacía SIN buscador, LA COLA FILTRADA (tocar reproduce lo que se ve; "siguiente" y el
// fin natural pasan al siguiente FILTRADO, no al de la lista completa), menú contextual con filtro
// (clic derecho y pulsación larga), pantalla completa (la F en el campo escribe; fuera, entra y sale),
// Esc con cola y expandido, pestaña activa y cambio de vista, 1440 y 390 sin desbordes.
// Playlists (se crean 4 de prueba por la API → correr contra la COPIA de la base): lo mismo, más: Enter
// en el buscador NO crea ni envía; Enter en "Nueva playlist…" crea y NO filtra; los dos campos del
// teléfono se distinguen; texto conservado al volver del detalle; entrada escalonada al filtrar.
// `info_*` son mediciones (no cuentan): costo de teclear en Videos con 3 y con 300 tarjetas.
// Lo esperado se calcula ACÁ desde la API con un plegado propio. Capturas en shots/sub3/search-lists.
// Uso: SNAP_BASE=http://localhost:4173 node search-lists-func.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'shots', 'sub3', process.env.OUT ?? 'search-lists');
mkdirSync(OUT, { recursive: true });

await preflight();
const token = await getToken();
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
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

const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };
const fold = (s) => (s ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const NADA = 'zzqxjw';
const INPUT = '.section-header .search-box input';

async function open(opts, { videos, playlists } = {}) {
  const ctx = await browser.newContext(opts);
  // Audio: WAV sintético. /stream/video/ NO se toca (son las fixtures reales del backend).
  await ctx.route((u) => u.pathname.startsWith('/stream/') && !u.pathname.startsWith('/stream/video/'), (r) => {
    const h = r.request().headers().range; const total = WAV.length;
    if (!h) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV });
    const [, a, b] = h.match(/bytes=(\d*)-(\d*)/); const start = a ? +a : 0; const end = b ? +b : total - 1;
    r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: WAV.subarray(start, end + 1) });
  });
  if (videos) await ctx.route((u) => u.pathname === '/api/videos', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ videos }) }));
  if (playlists) await ctx.route((u) => u.pathname === '/api/playlists', (r) => (r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(playlists) }) : r.continue()));
  await ctx.addInitScript((t) => {
    localStorage.setItem('token', t);
    // El valor de PlayerContext (cola, pista actual, play), leído del árbol de React: lo mismo que usan
    // los scripts de video.
    window.__player = () => {
      const root = document.getElementById('root');
      const key = Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
      const stack = [root[key]];
      while (stack.length) {
        const f = stack.pop();
        if (!f) continue;
        const v = f.memoizedProps?.value;
        if (v && typeof v.play === 'function' && typeof v.addToQueue === 'function') return v;
        if (f.sibling) stack.push(f.sibling);
        if (f.child) stack.push(f.child);
      }
      return null;
    };
  }, token);
  return { ctx, p: await ctx.newPage() };
}
const player = (p) => p.evaluate(() => { const v = window.__player(); return { actual: v.currentTrack?.title ?? null, cola: v.queue.map((t) => t.title) }; });
const overflow = (p) => p.evaluate(() => {
  const m = document.querySelector('.main-content'); const b = document.querySelector('.section-header .search-box').getBoundingClientRect();
  const h = document.querySelector('.section-header').getBoundingClientRect();
  return { doc: document.documentElement.scrollWidth - window.innerWidth, main: m.scrollWidth - m.clientWidth, cajaFuera: Math.round(Math.max(0, b.right - h.right, h.left - b.left)) };
});
const sinDesborde = (o) => o.doc <= 0 && o.main <= 0 && o.cajaFuera === 0;
const type = async (p, q) => { await p.locator(INPUT).click(); await p.keyboard.press('Control+A'); await p.keyboard.type(q, { delay: 15 }); await p.waitForTimeout(250); };
const geoEscritorio = (p) => p.evaluate(() => {
  const t = document.querySelector('.section-header .section-title').getBoundingClientRect();
  const b = document.querySelector('.section-header .search-box').getBoundingClientRect();
  return { tRight: t.right, tMid: t.top + t.height / 2, bLeft: b.left, bTop: b.top, bBottom: b.bottom, bW: Math.round(b.width) };
});
const cajaBien = (g) => g.bLeft > g.tRight && g.tMid > g.bTop && g.tMid < g.bBottom && g.bW === 280;
// Esc con la cola abierta y con el expandido abierto (lo mismo que en los otros dos scripts).
async function escCola(p, total, cards) {
  await p.click('.player-bar [aria-label="Cola"]'); await p.waitForSelector('.queue-panel');
  await p.evaluate(() => { window.__esc = 0; window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.__esc++; }); });
  await p.locator(INPUT).click(); await p.keyboard.type('a'); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  const st = () => p.evaluate((c) => ({ value: document.querySelector('.section-header .search-box input').value, focused: document.activeElement === document.querySelector('.section-header .search-box input'), cards: document.querySelectorAll(c).length, cola: document.querySelectorAll('.queue-panel').length, fugas: window.__esc }), cards);
  const e1 = await st();
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  const e2 = await st();
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  const e3 = await st();
  return { bien: e1.value === '' && e1.focused && e1.cards === total && e1.cola === 1 && e2.focused === false && e2.cola === 1 && e2.fugas === 0 && e3.cola === 0 && e3.fugas === 1, e1, e2, e3 };
}
async function escExpandido(p) {
  await p.click('.player-bar', { position: { x: 6, y: 6 } }); await p.waitForSelector('.player-expanded');
  await p.evaluate((sel) => document.querySelector(sel).focus(), INPUT);
  await p.keyboard.type('ab'); await p.waitForTimeout(200);
  const v = () => p.evaluate(() => ({ value: document.querySelector('.section-header .search-box input').value, focused: document.activeElement === document.querySelector('.section-header .search-box input'), exp: document.querySelectorAll('.player-expanded').length }));
  const x0 = await v();
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  const x1 = await v();
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  const x2 = await v();
  await p.keyboard.press('Escape'); await p.waitForTimeout(600);
  const x3 = await p.locator('.player-expanded').count();
  return { bien: x0.value === 'ab' && x1.value === '' && x1.exp === 1 && x2.focused === false && x2.exp === 1 && x3 === 0, x0, x1, x2, x3 };
}
const geoMovil = (p, extra) => p.evaluate((sel) => {
  const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: Math.round(b.width) }; };
  const choca = (a, b) => !!a && !!b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  const caja = r('.section-header .search-box'), tit = r('.section-header .section-title'), head = r('.section-header'), otro = sel ? r(sel) : null;
  return { tBottom: Math.round(tit.b), bTop: Math.round(caja.t), bBottom: Math.round(caja.b), bW: caja.w, hW: head.w, fab: !!r('.settings-fab'), campana: !!r('.changelog-bell'),
    chocaFab: choca(caja, r('.settings-fab')), chocaCampana: choca(caja, r('.changelog-bell')), otroTop: otro ? Math.round(otro.t) : null, chocaOtro: choca(caja, otro) };
}, extra ?? null);
const movilBien = (g) => g.bTop >= g.tBottom && g.bW === g.hW && g.fab && g.campana && !g.chocaFab && !g.chocaCampana;

// ════════════════════════════════ VIDEOS ════════════════════════════════
{
  const VIDS = (await fetch(`${BASE}/api/videos`, { headers: H }).then((r) => r.json())).videos ?? [];
  const coll = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
  const ORDEN = [...VIDS].sort((a, b) => coll.compare(a.artist ?? '', b.artist ?? '') || coll.compare(a.title ?? '', b.title ?? ''));
  const match = (q) => ORDEN.filter((v) => fold(v.artist).includes(fold(q).trim()) || fold(v.title).includes(fold(q).trim()));
  const titles = (l) => l.map((v) => v.title);
  const word = (n) => `${n} ${n === 1 ? 'video' : 'videos'}`;
  const TOTAL = VIDS.length;
  const CARDS = '.video-grid .video-card';
  const snap = (p) => p.evaluate(() => ({
    titulos: [...document.querySelectorAll('.video-grid .video-card .album-name')].map((e) => e.textContent),
    count: document.querySelector('.view-actions .section-count')?.textContent ?? null,
    value: document.querySelector('.section-header .search-box input')?.value ?? null,
    empty: document.querySelector('.empty-state .empty-title')?.textContent ?? null,
    focused: document.activeElement === document.querySelector('.section-header .search-box input'),
  }));
  const goto = async (p) => { await p.goto(BASE + '/videos'); await p.waitForSelector(CARDS); await p.waitForTimeout(400); };
  const same = (a, b) => a.join('|') === b.join('|');
  const fixturesOk = same(titles(ORDEN), ['Largo Para Seek', 'Faststart', 'Moov Al Final']);

  const { ctx, p } = await open({ viewport: { width: 1440, height: 900 } });
  await goto(p);
  await p.screenshot({ path: join(OUT, 'videos-1440.png') });
  const g = await geoEscritorio(p);
  ok('v_caja_a_la_derecha_del_titulo', cajaBien(g), g);

  const s0 = await snap(p);
  await type(p, 'uno');
  let s = await snap(p);
  ok('v_teclear_filtra_y_contador', fixturesOk && same(s0.titulos, titles(ORDEN)) && s0.count === word(TOTAL) && match('uno').length === 2 && same(s.titulos, titles(match('uno'))) && s.count === word(2), { antes: s0.count, despues: s.count, titulos: s.titulos });
  await p.screenshot({ path: join(OUT, 'videos-1440-filtrado.png') });
  await type(p, 'seek');
  s = await snap(p);
  ok('v_contador_en_singular', same(s.titulos, ['Largo Para Seek']) && s.count === '1 video', { count: s.count });
  await type(p, 'ÚNO');
  s = await snap(p);
  ok('v_acentos_y_mayusculas', same(s.titulos, titles(match('uno'))), { titulos: s.titulos });
  await p.locator('.section-header .sbx-clear').click(); await p.waitForTimeout(250);
  s = await snap(p);
  ok('v_limpiar_restaura', same(s.titulos, titles(ORDEN)) && s.count === word(TOTAL) && s.value === '' && s.focused, s);
  await type(p, NADA);
  s = await snap(p);
  ok('v_sin_resultados', s.titulos.length === 0 && s.empty === `Sin resultados para «${NADA}»` && s.count === word(0) && await p.locator('.section-header .section-title').isVisible() && await p.locator(INPUT).isVisible(), s);
  const ovVacio = await overflow(p);

  // LA COLA FILTRADA. "l" deja [Largo Para Seek, Moov Al Final]: en la lista completa, después de
  // Largo viene Faststart; filtrada, Moov Al Final.
  await type(p, 'l');
  s = await snap(p);
  await p.locator(CARDS).first().click(); await p.waitForFunction(() => window.__player()?.currentTrack?.title === 'Largo Para Seek');
  const q1 = await player(p);
  await p.click('.player-bar .ctrl-next'); await p.waitForTimeout(700);
  const q2 = await player(p);
  ok('v_cola_es_la_lista_filtrada', same(s.titulos, ['Largo Para Seek', 'Moov Al Final']) && q1.actual === 'Largo Para Seek' && same(q1.cola, ['Largo Para Seek', 'Moov Al Final']) && q2.actual === 'Moov Al Final', { visible: s.titulos, q1, despuesDeSiguiente: q2.actual });

  // Fin NATURAL: Largo (30 s) adelantado a 2 s del final; al terminar tiene que sonar Moov Al Final.
  await p.locator(CARDS).first().click(); await p.waitForFunction(() => window.__player()?.currentTrack?.title === 'Largo Para Seek');
  await p.waitForFunction(() => { const v = document.querySelector('video.player-video'); return v && v.readyState >= 2 && v.duration > 20; }, null, { timeout: 8000 }).catch(() => {});
  await p.evaluate(() => window.__player().seek(28));
  const fin = await p.waitForFunction(() => window.__player()?.currentTrack?.title !== 'Largo Para Seek', null, { timeout: 12000 }).then(() => true, () => false);
  const q3 = await player(p);
  ok('v_al_terminar_pasa_al_siguiente_filtrado', fin && q3.actual === 'Moov Al Final' && same(q3.cola, ['Largo Para Seek', 'Moov Al Final']), { termino: fin, q3 });

  // Menú contextual con filtro (clic derecho): sobre la tarjeta que NO suena salen las dos acciones
  // de cola; "Agregar a la cola" la suma al final.
  await p.locator(CARDS).first().click(); await p.waitForFunction(() => window.__player()?.currentTrack?.title === 'Largo Para Seek');
  await p.locator(CARDS).nth(1).click({ button: 'right' }); await p.waitForSelector('.ctx-menu');
  const items = await p.locator('.ctx-menu').innerText();
  await p.locator('.ctx-menu', { hasText: 'Agregar a la cola' }).getByText('Agregar a la cola').click(); await p.waitForTimeout(400);
  const q4 = await player(p);
  ok('v_menu_contextual_con_filtro', /Reproducir a continuación/.test(items) && /Agregar a la cola/.test(items) && same(q4.cola, ['Largo Para Seek', 'Moov Al Final', 'Moov Al Final']) && q4.actual === 'Largo Para Seek' && (await snap(p)).value === 'l',
    { items: items.replace(/\s+/g, ' ').slice(0, 120), q4 });

  // "Reproducir a continuación" EJECUTADO con filtro activo. Se arranca con "seek" (cola = [Largo]) y,
  // cambiando el filtro a "uno" (la cola no cambia por teclear), se manda a continuación primero Moov y
  // después Faststart: el último pedido va primero → [Largo, Faststart, Moov], y "siguiente" da Faststart.
  await type(p, 'seek');
  await p.locator(CARDS).first().click(); await p.waitForFunction(() => { const v = window.__player(); return v?.currentTrack?.title === 'Largo Para Seek' && v.queue.length === 1; });
  await type(p, 'uno');
  const colaTrasTeclear = (await player(p)).cola;
  const aContinuacion = async (titulo) => {
    await p.locator(CARDS, { hasText: titulo }).click({ button: 'right' }); await p.waitForSelector('.ctx-menu');
    await p.locator('.ctx-menu').getByText('Reproducir a continuación').click(); await p.waitForTimeout(400);
  };
  await aContinuacion('Moov Al Final');
  const n1 = await player(p);
  await aContinuacion('Faststart');
  const n2 = await player(p);
  await p.click('.player-bar .ctrl-next'); await p.waitForTimeout(700);
  const n3 = await player(p);
  ok('v_reproducir_a_continuacion_con_filtro', same(colaTrasTeclear, ['Largo Para Seek']) && same(n1.cola, ['Largo Para Seek', 'Moov Al Final']) && same(n2.cola, ['Largo Para Seek', 'Faststart', 'Moov Al Final'])
    && n2.actual === 'Largo Para Seek' && n3.actual === 'Faststart', { colaTrasTeclear, n1: n1.cola, n2: n2.cola, despuesDeSiguiente: n3.actual });

  // ALEATORIO encendido + filtro "l" ([Largo, Moov]): la cola son sólo los filtrados y, avanzando varias
  // veces, nunca suena Faststart (que es el que queda fuera del filtro).
  await p.evaluate(() => { const v = window.__player(); if (!v.shuffle) v.toggleShuffle(); });
  await p.waitForFunction(() => window.__player().shuffle === true);
  await type(p, 'l');
  await p.locator(CARDS, { hasText: 'Moov Al Final' }).click(); await p.waitForFunction(() => window.__player()?.currentTrack?.title === 'Moov Al Final');
  const r0 = await player(p);
  const oidos = [r0.actual];
  for (let i = 0; i < 5; i++) { await p.click('.player-bar .ctrl-next'); await p.waitForTimeout(500); oidos.push((await player(p)).actual); }
  const r1 = await player(p);
  await p.evaluate(() => { const v = window.__player(); if (v.shuffle) v.toggleShuffle(); });
  await p.waitForFunction(() => window.__player().shuffle === false);
  ok('v_aleatorio_solo_lo_filtrado', same([...r0.cola].sort(), ['Largo Para Seek', 'Moov Al Final']) && same([...r1.cola].sort(), ['Largo Para Seek', 'Moov Al Final'])
    && oidos.every((t) => t === 'Largo Para Seek' || t === 'Moov Al Final') && oidos.includes('Largo Para Seek') && !oidos.includes('Faststart'), { cola: r0.cola, oidos });
  // Se deja como lo esperan las pruebas de abajo: sin aleatorio, filtro "l" y sonando Largo.
  await p.locator(CARDS, { hasText: 'Largo Para Seek' }).click(); await p.waitForFunction(() => window.__player()?.currentTrack?.title === 'Largo Para Seek');

  // Pantalla completa: una "f" escrita en el campo es texto (no entra); fuera del campo, F entra y sale.
  const enFs = () => p.evaluate(() => !!(document.fullscreenElement ?? document.webkitFullscreenElement));
  await p.locator(INPUT).click(); await p.keyboard.press('Control+A'); await p.keyboard.type('f'); await p.waitForTimeout(400);
  const f1 = { fs: await enFs(), value: (await snap(p)).value, actual: (await player(p)).actual };
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(200);   // limpia y suelta el foco
  await p.keyboard.press('f'); await p.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 4000 }).catch(() => {});
  const f2 = await enFs();
  await p.keyboard.press('f'); await p.waitForFunction(() => !document.fullscreenElement, null, { timeout: 4000 }).catch(() => {});
  const f3 = await enFs();
  ok('v_pantalla_completa_no_se_afecta', f1.fs === false && f1.value === 'f' && f1.actual === 'Largo Para Seek' && f2 === true && f3 === false, { escribirF: f1, entra: f2, sale: !f3 });

  const ec = await escCola(p, TOTAL, CARDS);
  ok('v_esc_limpia_sin_cerrar_la_cola', ec.bien, ec);
  const ee = await escExpandido(p);
  ok('v_esc_limpia_sin_cerrar_el_expandido', ee.bien, ee);

  await type(p, 'uno');
  const ov = await overflow(p);
  await p.locator('.sidebar-nav button', { hasText: 'Videos' }).click(); await p.waitForTimeout(300);
  s = await snap(p);
  ok('v_pestana_activa_borra', s.value === '' && s.titulos.length === TOTAL, s);
  await type(p, 'uno');
  await p.locator('.sidebar-nav button', { hasText: 'Artistas' }).click(); await p.waitForSelector('.artist-grid');
  await p.locator('.sidebar-nav button', { hasText: 'Videos' }).click(); await p.waitForSelector(CARDS); await p.waitForTimeout(300);
  s = await snap(p);
  ok('v_cambiar_de_vista_borra', s.value === '' && s.titulos.length === TOTAL && s.count === word(TOTAL), s);
  ok('v_sin_desborde_1440', sinDesborde(ov) && sinDesborde(ovVacio) && sinDesborde(await overflow(p)), { conFiltro: ov, sinResultados: ovVacio });
  await ctx.close();

  // Lista VACÍA: "Sin videos" como siempre y SIN buscador.
  {
    const { ctx: c2, p: p2 } = await open({ viewport: { width: 1440, height: 900 } }, { videos: [] });
    await p2.goto(BASE + '/videos'); await p2.waitForSelector('.empty-state');
    ok('v_vacio_sin_buscador', (await p2.locator('.empty-title').textContent()) === 'Sin videos' && (await p2.locator('.search-box').count()) === 0);
    await c2.close();
  }

  // Teléfono (390)
  {
    const { ctx: c3, p: p3 } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await goto(p3);
    const gm = await geoMovil(p3);
    ok('v_movil_caja_debajo_sin_chocar', movilBien(gm), gm);
    await p3.screenshot({ path: join(OUT, 'videos-390.png') });
    const o = { todo: await overflow(p3) };
    await p3.locator(INPUT).tap(); await p3.keyboard.type('uno', { delay: 15 }); await p3.waitForTimeout(300);
    const sm = await snap(p3);
    o.filtrado = await overflow(p3);
    await p3.screenshot({ path: join(OUT, 'videos-390-filtrado.png') });
    // Pulsación larga sobre una tarjeta filtrada: abre el menú (y no reproduce).
    const bb = await p3.locator(CARDS).first().boundingBox();
    await p3.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await p3.mouse.down(); await p3.waitForTimeout(650); await p3.mouse.up(); await p3.waitForTimeout(300);
    const menu = await p3.locator('.ctx-menu').count();
    const sonando = await p3.evaluate(() => window.__player()?.currentTrack?.title ?? null);
    await p3.keyboard.press('Escape'); await p3.waitForTimeout(200);
    await p3.locator(INPUT).fill(NADA); await p3.waitForTimeout(250);
    o.sinResultados = await overflow(p3);
    ok('v_movil_filtra_menu_y_sin_desborde_390', same(sm.titulos, titles(match('uno'))) && sm.count === word(2) && menu === 1 && sonando === null && Object.values(o).every(sinDesborde), { titulos: sm.titulos, menu, sonando, ...o });
    await c3.close();
  }

  // MEDICIÓN (no cuenta): costo de teclear en Videos. Por tecla, desde el evento `input` hasta dos
  // frames después (lo ya pintado), y cuántas tareas largas (>50 ms) hubo. Con las 3 tarjetas reales y
  // con 300 sintéticas (sin portada, para no medir la red). CPU real y frenada ×4.
  for (const [nombre, lista] of [['3', null], ['300', Array.from({ length: 300 }, (_, i) => ({ ...VIDS[i % VIDS.length], id: `sint${i}`, title: `${VIDS[i % VIDS.length].title} ${i}`, artist: `Fixture ${i % 40}`, has_cover: false }))]]) {
    for (const cpu of [1, 4]) {
      const { ctx: c4, p: p4 } = await open({ viewport: { width: 1440, height: 900 } }, lista ? { videos: lista } : {});
      await goto(p4);
      const cdp = await c4.newCDPSession(p4); await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
      await p4.evaluate(() => {
        window.__dt = []; window.__lt = 0;
        new PerformanceObserver((l) => { window.__lt += l.getEntries().length; }).observe({ entryTypes: ['longtask'] });
        document.querySelector('.section-header .search-box input').addEventListener('input', () => { const t0 = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => window.__dt.push(Math.round(performance.now() - t0)))); });
      });
      await p4.locator(INPUT).click();
      for (const ch of 'fixture 1') { await p4.keyboard.type(ch); await p4.waitForTimeout(140 * cpu); }
      for (let i = 0; i < 9; i++) { await p4.keyboard.press('Backspace'); await p4.waitForTimeout(140 * cpu); }
      const m = await p4.evaluate(() => ({ dt: window.__dt, lt: window.__lt, cards: document.querySelectorAll('.video-grid .video-card').length }));
      const orden = [...m.dt].sort((a, b) => a - b);
      R[`info_teclear_videos_${nombre}_cpu${cpu}`] = { teclas: m.dt.length, medianaMs: orden[orden.length >> 1], maxMs: orden[orden.length - 1], tareasLargas: m.lt, tarjetasAlFinal: m.cards };
      await c4.close();
    }
  }
}

// ════════════════════════════════ PLAYLISTS (lista) ════════════════════════════════
{
  const sello = Date.now().toString(36);
  const NOMBRES = [`Rock en Español ${sello}`, `Rock Clásico ${sello}`, `Para Correr ${sello}`, `Ñandú Tranquilo ${sello}`];
  const creadas = [];
  for (const name of NOMBRES) creadas.push(await fetch(`${BASE}/api/playlists`, { method: 'POST', headers: H, body: JSON.stringify({ name, emoji: '🎸' }) }).then((r) => r.json()));
  const tracks = await fetch(`${BASE}/api/tracks?limit=4`, { headers: H }).then((r) => r.json());
  for (const t of tracks.slice(0, 3)) await fetch(`${BASE}/api/playlists/${creadas[0].id}/tracks`, { method: 'POST', headers: H, body: JSON.stringify({ track_id: t.id }) });
  const listar = () => fetch(`${BASE}/api/playlists`, { headers: H }).then((r) => r.json());
  let PLS = await listar();
  const match = (q) => PLS.filter((x) => fold(x.name).includes(fold(q).trim()));
  const names = (l) => l.map((x) => x.name).sort();
  const word = (n) => `${n} ${n === 1 ? 'playlist' : 'playlists'}`;
  const CARDS = '.playlist-list .playlist-item';
  const snap = (p) => p.evaluate(() => ({
    nombres: [...document.querySelectorAll('.playlist-list .playlist-item .playlist-name')].map((e) => e.textContent).sort(),
    count: document.querySelector('.view-actions .section-count')?.textContent ?? null,
    value: document.querySelector('.section-header .search-box input')?.value ?? null,
    nuevo: document.querySelector('.new-playlist-form input')?.value ?? null,
    empty: document.querySelector('.empty-state .empty-title')?.textContent ?? null,
    focused: document.activeElement === document.querySelector('.section-header .search-box input'),
  }));
  const same = (a, b) => a.join('|') === b.join('|');
  const goto = async (p) => { await p.goto(BASE + '/playlists'); await p.waitForSelector(CARDS); await p.waitForTimeout(900); };

  const { ctx, p } = await open({ viewport: { width: 1440, height: 900 } });
  await goto(p);
  await p.screenshot({ path: join(OUT, 'playlists-1440.png') });
  const g = await geoEscritorio(p);
  ok('p_caja_a_la_derecha_del_titulo', cajaBien(g), g);

  // Entrada escalonada al filtrar (como en Artistas y Géneros).
  await p.evaluate(() => {
    document.querySelectorAll('.playlist-list .playlist-item').forEach((c) => { c.__viejo = true; });
    window.__anim = [];
    document.addEventListener('animationstart', (e) => { if (e.target.matches?.('.playlist-list .playlist-item')) window.__anim.push({ fase: window.__fase, viejo: !!e.target.__viejo }); }, true);
    window.__running = () => document.getAnimations().filter((a) => a.effect?.target?.matches?.('.playlist-list .playlist-item') && a.playState === 'running').length;
    window.__fase = 'filtrar';
  });
  await p.locator(INPUT).click(); await p.keyboard.type('rock', { delay: 15 }); await p.waitForTimeout(60);
  const runF = await p.evaluate(() => window.__running()); await p.waitForTimeout(600);
  const trasF = await p.evaluate(() => ({ cards: document.querySelectorAll('.playlist-list .playlist-item').length, mismos: [...document.querySelectorAll('.playlist-list .playlist-item')].every((c) => c.__viejo) }));
  await p.evaluate(() => { window.__fase = 'borrar'; });
  await p.locator('.section-header .sbx-clear').click(); await p.waitForTimeout(60);
  const runB = await p.evaluate(() => window.__running()); await p.waitForTimeout(800);
  const ev = await p.evaluate(() => window.__anim);
  ok('p_animacion_no_se_repite_al_filtrar', trasF.cards === match('rock').length && trasF.mismos && ev.length === 0 && runF === 0 && runB === 0,
    { alFiltrar: { seQuedan: trasF.cards, mismosNodos: trasF.mismos, corriendo: runF }, alBorrar: { arrancan: ev.filter((e) => e.fase === 'borrar').length, corriendo: runB } });

  const s0 = await snap(p);
  await type(p, 'rock');
  let s = await snap(p);
  ok('p_teclear_filtra_y_contador', same(s0.nombres, names(PLS)) && s0.count === word(PLS.length) && match('rock').length === 2 && same(s.nombres, names(match('rock'))) && s.count === word(2), { antes: s0.count, despues: s.count, nombres: s.nombres });
  await p.screenshot({ path: join(OUT, 'playlists-1440-filtrado.png') });
  await type(p, 'correr');
  s = await snap(p);
  ok('p_contador_en_singular', s.nombres.length === 1 && s.count === '1 playlist', { count: s.count });
  // Mayúsculas y acentos en los DOS sentidos: "RÓCK" (acento de más) y "clasico"/"nandu" (acento de menos).
  await type(p, 'RÓCK'); const a1 = (await snap(p)).nombres;
  await type(p, 'clasico'); const a2 = (await snap(p)).nombres;
  await type(p, 'NANDU'); const a3 = (await snap(p)).nombres;
  ok('p_acentos_y_mayusculas', same(a1, names(match('rock'))) && same(a2, [NOMBRES[1]]) && same(a3, [NOMBRES[3]]), { a1, a2, a3 });
  await p.locator('.section-header .sbx-clear').click(); await p.waitForTimeout(250);
  s = await snap(p);
  ok('p_limpiar_restaura', same(s.nombres, names(PLS)) && s.count === word(PLS.length) && s.value === '' && s.focused, s);
  await type(p, NADA);
  s = await snap(p);
  ok('p_sin_resultados', s.nombres.length === 0 && s.empty === `Sin resultados para «${NADA}»` && s.count === word(0) && await p.locator('.new-playlist-form').isVisible() && await p.locator(INPUT).isVisible(), s);
  const ovVacio = await overflow(p);

  // Enter en el BUSCADOR: no crea una playlist ni envía el formulario; el filtro sigue.
  let posts = 0;
  p.on('request', (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/playlists') posts++; });
  await type(p, 'rock');
  await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  s = await snap(p);
  const trasEnter = await listar();
  ok('p_enter_en_el_buscador_no_crea', posts === 0 && trasEnter.length === PLS.length && s.value === 'rock' && same(s.nombres, names(match('rock'))) && s.nuevo === '', { posts, antes: PLS.length, despues: trasEnter.length, value: s.value });

  // "Nueva playlist…" con el filtro "rock" puesto. Mientras se escribe el nombre, eso NO filtra (la
  // lista sigue en "rock"). Al crear con Enter: un POST, y el buscador SE LIMPIA para que la nueva
  // ("Jazz …", que no coincide con "rock") se vea; el contador vuelve al total.
  const nueva = `Jazz Nocturno ${sello}`;
  await p.locator('.new-playlist-form input').click(); await p.keyboard.type(nueva); await p.waitForTimeout(250);
  const escribiendo = await snap(p);
  const postsAntesDeEnter = posts;   // mientras se escribe todavía no se creó nada
  await p.keyboard.press('Enter'); await p.waitForTimeout(700);
  s = await snap(p);
  const trasCrear = await listar();
  const creada = trasCrear.find((x) => x.name === nueva);
  if (creada) creadas.push(creada);
  ok('p_enter_en_crear_no_filtra', escribiendo.value === 'rock' && same(escribiendo.nombres, names(match('rock'))) && escribiendo.nuevo === nueva && postsAntesDeEnter === 0, { value: escribiendo.value, nombres: escribiendo.nombres.length, postsAntesDeEnter });
  const antesDeCrear = PLS.length;
  PLS = trasCrear;
  const apareceAlCrear = s.nombres.includes(nueva) && s.count === word(PLS.length);
  ok('p_crear_limpia_el_buscador', posts === postsAntesDeEnter + 1 &&!!creada && PLS.length === antesDeCrear + 1 && s.value === '' && s.nuevo === '' && apareceAlCrear && same(s.nombres, names(PLS)), { posts, creada: !!creada, value: s.value, nuevo: s.nuevo, count: s.count, seVe: s.nombres.includes(nueva) });

  // Borrar una playlist con el filtro puesto: se va de la lista filtrada, el contador baja y el filtro
  // sigue; al limpiar, el total también bajó.
  await type(p, 'rock');
  const fila = p.locator(CARDS, { hasText: NOMBRES[1] });
  await fila.hover(); await fila.locator('.playlist-del').click(); await p.waitForTimeout(600);
  const b1 = await snap(p);
  const trasBorrar = await listar();
  await p.locator('.section-header .sbx-clear').click(); await p.waitForTimeout(250);
  const b2 = await snap(p);
  ok('p_borrar_con_filtro', trasBorrar.length === PLS.length - 1 && !trasBorrar.some((x) => x.name === NOMBRES[1]) && b1.value === 'rock' && same(b1.nombres, [NOMBRES[0]]) && b1.count === '1 playlist'
    && same(b2.nombres, names(trasBorrar)) && b2.count === word(trasBorrar.length), { antes: PLS.length, despues: trasBorrar.length, filtrado: b1.nombres, count: [b1.count, b2.count] });
  PLS = trasBorrar;
  const apareceAlLimpiar = apareceAlCrear;

  // El texto se conserva al entrar a una playlist y volver; el detalle abre con SU filtro vacío.
  await type(p, 'rock');
  const ov = await overflow(p);
  await p.locator(CARDS, { hasText: NOMBRES[0] }).click(); await p.waitForSelector('.pl-hero'); await p.waitForSelector('.pl-search input');
  const enDetalle = { cajaLista: await p.locator(INPUT).count(), filtroDetalle: await p.locator('.pl-search input').inputValue() };
  await p.locator('.back-btn').click(); await p.waitForSelector(CARDS); await p.waitForTimeout(300);
  s = await snap(p);
  ok('p_texto_se_conserva_al_volver_del_detalle', apareceAlLimpiar && enDetalle.cajaLista === 0 && enDetalle.filtroDetalle === '' && s.value === 'rock' && same(s.nombres, names(match('rock'))), { apareceAlLimpiar, enDetalle, value: s.value });

  await p.locator('.sidebar-nav button', { hasText: 'Playlists' }).click(); await p.waitForTimeout(300);
  s = await snap(p);
  ok('p_pestana_activa_borra', s.value === '' && s.nombres.length === PLS.length, s);
  await type(p, 'rock');
  await p.locator('.sidebar-nav button', { hasText: 'Artistas' }).click(); await p.waitForSelector('.artist-grid');
  await p.locator('.sidebar-nav button', { hasText: 'Playlists' }).click(); await p.waitForSelector(CARDS); await p.waitForTimeout(300);
  s = await snap(p);
  ok('p_cambiar_de_vista_borra', s.value === '' && s.nombres.length === PLS.length && s.count === word(PLS.length), s);
  ok('p_sin_desborde_1440', sinDesborde(ov) && sinDesborde(ovVacio) && sinDesborde(await overflow(p)), { conFiltro: ov, sinResultados: ovVacio });

  // Esc con cola y expandido: hace falta algo sonando.
  await p.evaluate(async () => { const t = await (await fetch('/api/tracks?limit=3', { headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } })).json(); window.__player().play(t, 0); });
  await p.waitForSelector('.player-bar [aria-label="Cola"]'); await p.waitForTimeout(400);
  const ec = await escCola(p, PLS.length, CARDS);
  ok('p_esc_limpia_sin_cerrar_la_cola', ec.bien, ec);
  const ee = await escExpandido(p);
  ok('p_esc_limpia_sin_cerrar_el_expandido', ee.bien, ee);
  await ctx.close();

  // Sin NINGUNA playlist: el vacío de siempre, con "Nueva playlist…" y SIN buscador.
  {
    const { ctx: c2, p: p2 } = await open({ viewport: { width: 1440, height: 900 } }, { playlists: [] });
    await p2.goto(BASE + '/playlists'); await p2.waitForSelector('.empty-state');
    ok('p_vacio_sin_buscador', (await p2.locator('.empty-title').textContent()) === 'Sin playlists' && (await p2.locator('.search-box').count()) === 0 && await p2.locator('.new-playlist-form').isVisible() && (await p2.locator('.section-count').count()) === 0);
    await c2.close();
  }

  // Teléfono (390): los DOS campos apilados.
  {
    const { ctx: c3, p: p3 } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await goto(p3);
    const gm = await geoMovil(p3, '.new-playlist-form');
    const campos = await p3.evaluate(() => {
      const b = document.querySelector('.section-header .search-box input'), n = document.querySelector('.new-playlist-form input'), crear = document.querySelector('.new-playlist-form button[type="submit"]');
      const cr = crear.getBoundingClientRect();
      return { buscar: { placeholder: b.placeholder, label: b.getAttribute('aria-label'), lupa: !!document.querySelector('.section-header .search-box svg'), rol: document.querySelector('.section-header .search-box').getAttribute('role'), dentroDeForm: !!b.closest('form') },
        nuevo: { placeholder: n.placeholder, label: n.getAttribute('aria-label'), crearTexto: crear.textContent, crearVisible: cr.width > 0 && cr.height > 0 && cr.right <= window.innerWidth, emoji: !!document.querySelector('.new-playlist-form .emoji-picker-btn') } };
    });
    ok('p_movil_dos_campos_distintos', movilBien(gm) && gm.otroTop >= gm.bBottom && !gm.chocaOtro
      && campos.buscar.placeholder !== campos.nuevo.placeholder && campos.buscar.label !== campos.nuevo.label && !!campos.buscar.label && !!campos.nuevo.label
      && campos.buscar.lupa && campos.buscar.rol === 'search' && !campos.buscar.dentroDeForm && campos.nuevo.crearTexto === 'Crear' && campos.nuevo.crearVisible && campos.nuevo.emoji, { ...gm, ...campos });
    await p3.screenshot({ path: join(OUT, 'playlists-390.png') });
    const o = { todo: await overflow(p3) };
    await p3.locator(INPUT).tap(); await p3.keyboard.type('rock', { delay: 15 }); await p3.waitForTimeout(300);
    const sm = await snap(p3);
    o.filtrado = await overflow(p3);
    await p3.screenshot({ path: join(OUT, 'playlists-390-filtrado.png') });
    await p3.locator(INPUT).fill(NADA); await p3.waitForTimeout(250);
    o.sinResultados = await overflow(p3);
    await p3.screenshot({ path: join(OUT, 'playlists-390-sin-resultados.png') });
    ok('p_movil_filtra_y_sin_desborde_390', match('rock').length >= 1 && same(sm.nombres, names(match('rock'))) && sm.count === word(match('rock').length) && Object.values(o).every(sinDesborde), { nombres: sm.nombres, count: sm.count, ...o });
    await c3.close();
  }

  for (const c of creadas) await fetch(`${BASE}/api/playlists/${c.id}`, { method: 'DELETE', headers: H }).catch(() => {});
}

const cuentan = Object.entries(R).filter(([k]) => !k.startsWith('info_'));
const fails = cuentan.filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
writeFileSync(join(OUT, 'resultado.json'), JSON.stringify(R, null, 1));   // el runner sólo guarda el conteo
console.log(`capturas: ${OUT}`);
console.log(`\nsearch-lists-func: ${cuentan.length - fails.length}/${cuentan.length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
