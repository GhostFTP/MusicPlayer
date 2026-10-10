// search-browse-func.mjs — funcional del BUSCADOR DE LOS LISTADOS en ARTISTAS y GÉNEROS (sub-paso S2).
// Hermano de search-views-func.mjs (Álbumes): las mismas verificaciones, corridas una vez por vista con
// una tabla de selectores. Por vista: caja en la cabecera, tecleo + contador (con su singular), acentos
// y mayúsculas, limpiar, sin resultados, texto conservado al volver del detalle, borrado al tocar la
// pestaña activa y al cambiar de vista, Mix con y sin filtro, Esc con la cola y con el expandido
// abiertos, la ENTRADA ESCALONADA al filtrar (ver `animacion`), 1440 y 390 sin desbordes y sin chocar
// con los botones flotantes. Además: abrir un álbum desde un artista deja el buscador de Álbumes vacío.
// Lo esperado se calcula ACÁ desde la API con un plegado propio (no importa el de la app).
// Capturas en shots/sub3/search-browse (ignorado por git).
// Uso: SNAP_BASE=http://localhost:4173 node search-browse-func.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'shots', 'sub3', process.env.OUT ?? 'search-browse');
mkdirSync(OUT, { recursive: true });

await preflight();
const token = await getToken();
const H = { Authorization: `Bearer ${token}` };
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
const tracks = await fetch(`${BASE}/api/tracks?limit=10000`, { headers: H }).then((r) => r.json());
const NADA = 'zzqxjw';
const ACC = { a: 'Á', e: 'É', i: 'Í', o: 'Ó', u: 'Ú' };

const VIEWS = [
  { id: 'art', route: '/artists', api: '/api/browse/artists', key: 'artist', trackField: 'album_artist', tab: 'Artistas', otra: 'Géneros', otraSel: '.browse-list',
    list: '.artist-grid', card: '.artist-grid .artist-portrait', name: '.artist-portrait-name', anim: '.artist-grid .artist-portrait', uno: 'artista', muchos: 'artistas',
    detalle: '.artist-hero-name', shot: 'artistas' },
  { id: 'gen', route: '/genres', api: '/api/browse/genres', key: 'genre', trackField: 'genre', tab: 'Géneros', otra: 'Artistas', otraSel: '.artist-grid',
    list: '.browse-list', card: '.browse-list .genre-item', name: '.browse-item-name', anim: '.browse-list .genre-tile', uno: 'género', muchos: 'géneros',
    detalle: '.back-btn', shot: 'generos' },
];

async function open(opts) {
  const ctx = await browser.newContext(opts);
  await ctx.route('**/stream/**', (r) => {
    const h = r.request().headers().range; const total = WAV.length;
    if (!h) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV });
    const [, a, b] = h.match(/bytes=(\d*)-(\d*)/); const start = a ? +a : 0; const end = b ? +b : total - 1;
    r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: WAV.subarray(start, end + 1) });
  });
  await ctx.addInitScript((t) => { localStorage.setItem('token', t); }, token);
  return { ctx, p: await ctx.newPage() };
}
const INPUT = '.section-header .search-box input';
const queueCount = (p) => p.evaluate(() => Number((document.querySelector('.queue-panel .queue-kicker')?.textContent.match(/(\d+)\s+pistas?/) ?? [])[1] ?? -1));
const overflow = (p) => p.evaluate(() => {
  const m = document.querySelector('.main-content'); const b = document.querySelector('.section-header .search-box').getBoundingClientRect();
  const h = document.querySelector('.section-header').getBoundingClientRect();
  return { doc: document.documentElement.scrollWidth - window.innerWidth, main: m.scrollWidth - m.clientWidth, cajaFuera: Math.round(Math.max(0, b.right - h.right, h.left - b.left)) };
});
const sinDesborde = (o) => o.doc <= 0 && o.main <= 0 && o.cajaFuera === 0;

for (const V of VIEWS) {
  const items = await fetch(`${BASE}${V.api}`, { headers: H }).then((r) => r.json());
  const TOTAL = items.length;
  const word = (n) => `${n} ${n === 1 ? V.uno : V.muchos}`;
  const match = (q) => items.filter((it) => fold(it[V.key]).includes(fold(q).trim()));
  const want = (list) => list.map((it) => it[V.key]).sort().join('|');
  // Q: una consulta que deje VARIOS pero no todos (el fragmento más corto que lo logre); Q1: una que
  // deje exactamente UNO (para el singular del contador).
  let Q = null, Q1 = null;
  for (const it of items) {
    const f = fold(it[V.key]);
    for (let len = 1; len <= f.length && !(Q && Q1); len++) for (let s = 0; s + len <= f.length; s++) {
      const q = f.slice(s, s + len); if (q !== q.trim() || !/[a-z0-9]/.test(q)) continue;
      const n = match(q).length;
      if (!Q && n >= 2 && n < TOTAL && len >= 2) Q = q;
      if (!Q1 && n === 1 && len >= 3) Q1 = q;
    }
  }
  const EXP = match(Q);
  let accented = false;
  const Q_RARA = [...Q].map((ch) => { if (!accented && ACC[ch]) { accented = true; return ACC[ch]; } return ch.toUpperCase(); }).join('');
  const withField = tracks.filter((t) => t[V.trackField] != null && t[V.trackField] !== '');
  const sumTracks = (list) => { const s = new Set(list.map((it) => it[V.key])); return withField.filter((t) => s.has(t[V.trackField])).length; };

  const snap = (p) => p.evaluate((v) => ({
    cards: document.querySelectorAll(v.card).length,
    names: [...document.querySelectorAll(v.card)].map((c) => c.querySelector(v.name).textContent).sort().join('|'),
    count: document.querySelector('.view-actions .section-count')?.textContent ?? null,
    value: document.querySelector('.section-header .search-box input')?.value ?? null,
    empty: document.querySelector('.empty-state .empty-title')?.textContent ?? null,
    focused: document.activeElement === document.querySelector('.section-header .search-box input'),
  }), V);
  const goto = async (p) => { await p.goto(BASE + V.route); await p.waitForSelector(V.card); await p.waitForTimeout(900); };   // 900: que termine la entrada escalonada
  const type = async (p, q) => { await p.locator(INPUT).click(); await p.keyboard.press('Control+A'); await p.keyboard.type(q, { delay: 15 }); await p.waitForTimeout(250); };
  const K = (k) => `${V.id}_${k}`;

  // ── Escritorio (1440) ──
  {
    const { ctx, p } = await open({ viewport: { width: 1440, height: 900 } });
    await goto(p);
    await p.screenshot({ path: join(OUT, `${V.shot}-1440.png`) });

    const geo = await p.evaluate(() => {
      const t = document.querySelector('.section-header .section-title').getBoundingClientRect();
      const b = document.querySelector('.section-header .search-box').getBoundingClientRect();
      return { tRight: t.right, tMid: t.top + t.height / 2, bLeft: b.left, bTop: b.top, bBottom: b.bottom, bW: Math.round(b.width) };
    });
    ok(K('caja_a_la_derecha_del_titulo'), geo.bLeft > geo.tRight && geo.tMid > geo.bTop && geo.tMid < geo.bBottom && geo.bW === 280, geo);

    // ANIMACIÓN de entrada (--i) al filtrar. Se marcan los nodos montados y se escuchan los
    // `animationstart` de las tarjetas: (a) al filtrar, las que se quedan ¿son el mismo nodo? ¿arrancan
    // animación?; (b) al borrar el texto, ¿arrancan animación las que se quedaron y las que vuelven?
    // Además, justo después de cada cambio, cuántas animaciones de tarjeta están corriendo.
    await p.evaluate((v) => {
      document.querySelectorAll(v.card).forEach((c) => { c.__viejo = true; });
      window.__anim = [];
      document.addEventListener('animationstart', (e) => { if (e.target.matches?.(v.anim)) window.__anim.push({ fase: window.__fase, viejo: !!e.target.closest(v.card).__viejo }); }, true);
      window.__running = () => document.getAnimations().filter((a) => a.effect?.target?.matches?.(v.anim) && a.playState === 'running').length;
      window.__fase = 'filtrar';
    }, V);
    await p.locator(INPUT).click(); await p.keyboard.type(Q, { delay: 15 });
    await p.waitForTimeout(60);
    const runFiltrar = await p.evaluate(() => window.__running());
    await p.waitForTimeout(700);
    const trasFiltrar = await p.evaluate((v) => ({ cards: document.querySelectorAll(v.card).length, mismosNodos: [...document.querySelectorAll(v.card)].every((c) => c.__viejo) }), V);
    await p.evaluate(() => { window.__fase = 'borrar'; });
    await p.locator('.section-header .sbx-clear').click();
    await p.waitForTimeout(60);
    const runBorrar = await p.evaluate(() => window.__running());
    await p.waitForTimeout(900);
    const ev = await p.evaluate(() => window.__anim);
    const trasBorrar = await p.evaluate((v) => ({ cards: document.querySelectorAll(v.card).length, nuevos: [...document.querySelectorAll(v.card)].filter((c) => !c.__viejo).length }), V);
    const anim = {
      alFiltrar: { seQuedan: trasFiltrar.cards, mismosNodos: trasFiltrar.mismosNodos, animacionesQueArrancan: ev.filter((e) => e.fase === 'filtrar').length, corriendo: runFiltrar },
      alBorrar: { vuelven: trasBorrar.nuevos, arrancanEnLasQueSeQuedaron: ev.filter((e) => e.fase === 'borrar' && e.viejo).length, arrancanEnLasQueVuelven: ev.filter((e) => e.fase === 'borrar' && !e.viejo).length, corriendo: runBorrar },
    };
    ok(K('animacion_no_se_repite_al_filtrar'), trasFiltrar.cards === EXP.length && trasFiltrar.mismosNodos && trasBorrar.cards === TOTAL && trasBorrar.nuevos === TOTAL - EXP.length
      && ev.length === 0 && runFiltrar === 0 && runBorrar === 0, anim);

    // Teclear filtra y el contador cambia.
    const s0 = await snap(p);
    await type(p, Q);
    let s = await snap(p);
    ok(K('teclear_filtra_y_contador'), s0.cards === TOTAL && s0.count === word(TOTAL) && EXP.length >= 2 && EXP.length < TOTAL && s.cards === EXP.length && s.count === word(EXP.length) && s.names === want(EXP),
      { q: Q, antes: s0.count, despues: s.count, esperado: EXP.length });
    await p.screenshot({ path: join(OUT, `${V.shot}-1440-filtrado.png`) });

    await type(p, Q1);
    s = await snap(p);
    ok(K('contador_en_singular'), !!Q1 && s.cards === 1 && s.count === `1 ${V.uno}`, { q: Q1, count: s.count });

    await type(p, Q_RARA);
    s = await snap(p);
    ok(K('acentos_y_mayusculas'), s.cards === EXP.length && s.names === want(EXP) && (accented || Q_RARA !== Q), { q: Q_RARA, acento: accented, cards: s.cards });

    await p.locator('.section-header .sbx-clear').click(); await p.waitForTimeout(250);
    s = await snap(p);
    ok(K('limpiar_restaura'), s.cards === TOTAL && s.count === word(TOTAL) && s.value === '' && s.focused && (await p.locator('.section-header .sbx-clear').count()) === 0, s);

    await type(p, NADA);
    s = await snap(p);
    ok(K('sin_resultados'), s.cards === 0 && s.empty === `Sin resultados para «${NADA}»` && s.count === word(0) && s.value === NADA && await p.locator('.section-header .section-title').isVisible(), s);

    // El texto se conserva al entrar a un detalle y volver.
    await type(p, Q);
    const ov = await overflow(p);
    await p.locator(V.card).first().click(); await p.waitForSelector(V.detalle);
    const enDetalle = await p.locator(INPUT).count();
    await p.locator('.back-btn').click(); await p.waitForSelector(V.card); await p.waitForTimeout(300);
    s = await snap(p);
    ok(K('texto_se_conserva_al_volver_del_detalle'), enDetalle === 0 && s.value === Q && s.cards === EXP.length && s.count === word(EXP.length), s);

    await p.locator('.sidebar-nav button', { hasText: V.tab }).click(); await p.waitForTimeout(300);
    s = await snap(p);
    ok(K('pestana_activa_borra'), s.value === '' && s.cards === TOTAL, s);

    await type(p, Q);
    await p.locator('.sidebar-nav button', { hasText: V.otra }).click(); await p.waitForSelector(V.otraSel);
    const otraVacia = await p.locator(INPUT).inputValue();
    await p.locator('.sidebar-nav button', { hasText: V.tab }).click(); await p.waitForSelector(V.card); await p.waitForTimeout(300);
    s = await snap(p);
    ok(K('cambiar_de_vista_borra'), s.value === '' && otraVacia === '' && s.cards === TOTAL && s.count === word(TOTAL), { ...s, otraVacia });

    const ov0 = await overflow(p);
    ok(K('sin_desborde_1440'), sinDesborde(ov) && sinDesborde(ov0), { conFiltro: ov, sinFiltro: ov0 });

    // Mix: sin filtro, TODA la vista; con filtro, lo que se ve.
    await p.locator('.view-actions .mix-btn').click(); await p.waitForSelector('.player-bar [aria-label="Cola"]');
    await p.click('.player-bar [aria-label="Cola"]'); await p.waitForSelector('.queue-panel .queue-row');
    const qTodo = await queueCount(p);
    await type(p, Q);
    await p.locator('.view-actions .mix-btn').click(); await p.waitForTimeout(700);
    const qFiltro = await queueCount(p);
    ok(K('mix_sobre_lo_que_se_ve'), qTodo === withField.length && qFiltro === sumTracks(EXP) && qFiltro < qTodo, { sinFiltro: qTodo, esperadoSinFiltro: withField.length, conFiltro: qFiltro, esperadoConFiltro: sumTracks(EXP) });

    // Esc con la COLA abierta.
    await p.evaluate(() => { window.__esc = 0; window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.__esc++; }); });
    await p.locator(INPUT).click();
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    const e1 = { ...(await snap(p)), cola: await p.locator('.queue-panel').count() };
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    const e2 = { focused: (await snap(p)).focused, cola: await p.locator('.queue-panel').count(), fugas: await p.evaluate(() => window.__esc) };
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    const e3 = { cola: await p.locator('.queue-panel').count(), fugas: await p.evaluate(() => window.__esc) };
    ok(K('esc_limpia_sin_cerrar_la_cola'), e1.value === '' && e1.focused && e1.cards === TOTAL && e1.cola === 1 && e2.focused === false && e2.cola === 1 && e2.fugas === 0 && e3.cola === 0 && e3.fugas === 1,
      { e1: { value: e1.value, focused: e1.focused, cola: e1.cola }, e2, e3 });

    // Esc con el EXPANDIDO abierto (tapa la vista: el foco se pone por código).
    await p.click('.player-bar', { position: { x: 6, y: 6 } }); await p.waitForSelector('.player-expanded');
    await p.evaluate((sel) => document.querySelector(sel).focus(), INPUT);
    await p.keyboard.type('ab'); await p.waitForTimeout(200);
    const x0 = (await snap(p)).value;
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    const x1 = { value: (await snap(p)).value, exp: await p.locator('.player-expanded').count() };
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    const x2 = { focused: (await snap(p)).focused, exp: await p.locator('.player-expanded').count() };
    await p.keyboard.press('Escape'); await p.waitForTimeout(600);
    const x3 = await p.locator('.player-expanded').count();
    ok(K('esc_limpia_sin_cerrar_el_expandido'), x0 === 'ab' && x1.value === '' && x1.exp === 1 && x2.focused === false && x2.exp === 1 && x3 === 0, { x0, x1, x2, x3 });

    // Sólo Artistas: abrir un álbum desde un artista navega a Álbumes (Artistas se desmonta). El
    // buscador de Álbumes arranca vacío, y al volver a Artistas el suyo también.
    if (V.id === 'art') {
      await type(p, Q);
      await p.locator(V.card).first().click(); await p.waitForSelector('.artist-hero-name');
      await p.locator('.album-grid .album-card').first().click(); await p.waitForSelector('.detail-title');
      await p.locator('.sidebar-nav button', { hasText: 'Álbumes' }).click(); await p.waitForSelector('.album-grid .album-card'); await p.waitForTimeout(300);
      const enAlbumes = { value: await p.locator(INPUT).inputValue(), count: await p.locator('.view-actions .section-count').textContent() };
      await p.locator('.sidebar-nav button', { hasText: 'Artistas' }).click(); await p.waitForSelector(V.card); await p.waitForTimeout(300);
      s = await snap(p);
      ok('art_album_desde_artista_deja_buscadores_vacios', enAlbumes.value === '' && /^\d+ álbum(es)?$/.test(enAlbumes.count) && s.value === '' && s.cards === TOTAL, { enAlbumes, artistas: s.value });
    }
    await ctx.close();
  }

  // ── Teléfono (390) ──
  {
    const { ctx, p } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await goto(p);
    const geo = await p.evaluate(() => {
      const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: Math.round(b.width) }; };
      const caja = r('.section-header .search-box'), tit = r('.section-header .section-title'), head = r('.section-header');
      const choca = (a, b) => !!a && !!b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
      return { tBottom: Math.round(tit.b), bTop: Math.round(caja.t), bW: caja.w, hW: head.w, fab: !!r('.settings-fab'), campana: !!r('.changelog-bell'),
        chocaFab: choca(caja, r('.settings-fab')), chocaCampana: choca(caja, r('.changelog-bell')) };
    });
    ok(K('movil_caja_debajo_sin_chocar'), geo.bTop >= geo.tBottom && geo.bW === geo.hW && geo.fab && geo.campana && !geo.chocaFab && !geo.chocaCampana, geo);
    await p.screenshot({ path: join(OUT, `${V.shot}-390.png`) });

    const o = { todo: await overflow(p) };
    await p.locator(INPUT).tap(); await p.keyboard.type(Q, { delay: 15 }); await p.waitForTimeout(300);
    const s = await snap(p);
    const cb = await p.locator('.section-header .sbx-clear').boundingBox();
    o.filtrado = await overflow(p);
    await p.screenshot({ path: join(OUT, `${V.shot}-390-filtrado.png`) });
    await p.locator(INPUT).fill(NADA); await p.waitForTimeout(250);
    o.sinResultados = await overflow(p);
    ok(K('movil_filtra_y_sin_desborde_390'), s.cards === EXP.length && s.count === word(EXP.length) && s.names === want(EXP) && Math.round(cb.width) >= 44 && Math.round(cb.height) >= 44 && Object.values(o).every(sinDesborde),
      { cards: s.cards, count: s.count, limpiar: [cb.width, cb.height], ...o });
    await ctx.close();
  }
}

const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
writeFileSync(join(OUT, 'resultado.json'), JSON.stringify(R, null, 1));   // el runner sólo guarda el conteo
console.log(`capturas: ${OUT}`);
console.log(`\nsearch-browse-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
