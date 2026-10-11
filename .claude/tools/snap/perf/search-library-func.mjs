// search-library-func.mjs — funcional del campo de búsqueda de la BIBLIOTECA con el SearchBox (sub-paso
// S4). Hermano de search-views-func / search-browse-func / search-lists-func. El MOTOR de filtrado de la
// Biblioteca no cambió (lo cubre func-search.mjs); acá va lo que trae el campo nuevo y lo que no debía
// moverse: tecleo y contador, acentos y mayúsculas, RECORTE de espacios en los extremos ("daft " ==
// "daft", sólo espacios = sin filtro), ✕ de limpiar, sin resultados, Esc con la cola y con el expandido
// abiertos, tocar la pestaña activa y cambiar de vista, tocar una fila y el Mix con y sin filtro, el
// riel de orden con filtro, y 1440 / 390 sin desbordes ni choques con los chips o los botones flotantes.
// La tabla está en ventana (sólo se montan las filas cercanas): los totales se leen del contador y de
// aria-rowcount, no contando filas. Lo esperado se calcula ACÁ con un plegado propio.
// Capturas en shots/sub3/search-library (ignorado por git).
// Uso: SNAP_BASE=http://localhost:4173 node search-library-func.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'shots', 'sub3', process.env.OUT ?? 'search-library');
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
const TRACKS = await fetch(`${BASE}/api/tracks?limit=10000`, { headers: H }).then((r) => r.json());
const TOTAL = TRACKS.length;
const match = (q) => { const f = fold(q).trim(); return TRACKS.filter((t) => fold(t.title).includes(f) || fold(t.artist).includes(f) || fold(t.album).includes(f)); };
const Q = 'daft';
const N = match(Q).length;
const NADA = 'zzqxjw';
const INPUT = '.section-header .search-box input';
const ROWS = '.library-tracks .track-row';

async function open(opts) {
  const ctx = await browser.newContext(opts);
  await ctx.route('**/stream/**', (r) => {
    const h = r.request().headers().range; const total = WAV.length;
    if (!h) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV });
    const [, a, b] = h.match(/bytes=(\d*)-(\d*)/); const start = a ? +a : 0; const end = b ? +b : total - 1;
    r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: WAV.subarray(start, end + 1) });
  });
  await ctx.addInitScript((t) => {
    localStorage.setItem('token', t);
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
// Estado de la vista. `filas` = total de la lista ACTUAL según aria-rowcount (cabecera aparte).
const snap = (p) => p.evaluate(() => {
  const t = document.querySelector('.library-tracks');
  return {
    filas: t ? Number(t.getAttribute('aria-rowcount')) - 1 : 0,
    contador: document.querySelector('.library-count')?.getAttribute('aria-label') ?? null,
    value: document.querySelector('.section-header .search-box input')?.value ?? null,
    empty: document.querySelector('.empty-state .empty-title')?.textContent ?? null,
    focused: document.activeElement === document.querySelector('.section-header .search-box input'),
    titulos: [...document.querySelectorAll('.library-tracks .track-row')].slice(0, 8).map((r) => r.querySelector('.track-title').textContent),
    duraciones: [...document.querySelectorAll('.library-tracks .track-row')].slice(0, 12).map((r) => r.querySelector('.col-time').textContent),
  };
});
const goto = async (p) => { await p.goto(BASE + '/'); await p.waitForSelector(ROWS); await p.waitForTimeout(1300); };   // 1300: que termine el conteo 0→N
const type = async (p, q) => { await p.locator(INPUT).click(); await p.keyboard.press('Control+A'); await p.keyboard.press('Delete'); await p.keyboard.type(q, { delay: 15 }); await p.waitForTimeout(300); };
const cola = (p) => p.evaluate(() => { const v = window.__player(); return { n: v.queue.length, actual: v.currentTrack?.title ?? null, titulos: v.queue.slice(0, 8).map((t) => t.title ?? 'Sin título'), shuffle: v.shuffle }; });
const overflow = (p) => p.evaluate(() => {
  const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: Math.round(b.width) }; };
  const choca = (a, b) => !!a && !!b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  const m = document.querySelector('.main-content'); const caja = r('.section-header .search-box'), head = r('.section-header');
  return { doc: document.documentElement.scrollWidth - window.innerWidth, main: m.scrollWidth - m.clientWidth, cajaFuera: Math.round(Math.max(0, caja.r - head.r, head.l - caja.l)),
    chips: !!r('.lib-stats'), chocaChips: choca(caja, r('.lib-stats')), chocaTitulo: choca(caja, r('.section-title')), chocaFab: choca(caja, r('.settings-fab')), chocaCampana: choca(caja, r('.changelog-bell')) };
});
const limpio = (o) => o.doc <= 0 && o.main <= 0 && o.cajaFuera === 0 && o.chips && !o.chocaChips && !o.chocaTitulo && !o.chocaFab && !o.chocaCampana;
const same = (a, b) => a.join('|') === b.join('|');
const segundos = (s) => { const [m, x] = s.split(':').map(Number); return m * 60 + x; };

// ── Escritorio (1440) ──
{
  const { ctx, p } = await open({ viewport: { width: 1440, height: 900 } });
  await goto(p);
  await p.screenshot({ path: join(OUT, 'biblioteca-1440.png') });

  const geo = await p.evaluate(() => {
    const h = document.querySelector('.lib-heading').getBoundingClientRect(); const b = document.querySelector('.section-header .search-box').getBoundingClientRect();
    return { hRight: Math.round(h.right), hMid: h.top + h.height / 2, bLeft: Math.round(b.left), bTop: b.top, bBottom: b.bottom, bW: Math.round(b.width), lupa: !!document.querySelector('.section-header .search-box svg'), rol: document.querySelector('.section-header .search-box').getAttribute('role') };
  });
  ok('caja_a_la_derecha_de_la_cabecera', geo.bLeft > geo.hRight && geo.hMid > geo.bTop && geo.hMid < geo.bBottom && geo.bW === 280 && geo.lupa && geo.rol === 'search', geo);
  const ov0 = await overflow(p);

  const s0 = await snap(p);
  await type(p, Q);
  let s = await snap(p);
  ok('teclear_filtra_y_contador', s0.filas === TOTAL && s0.contador === `${TOTAL} canciones` && N > 1 && N < TOTAL && s.filas === N && s.contador === `${N} resultados`, { q: Q, antes: s0.contador, despues: s.contador, esperado: N });
  await p.screenshot({ path: join(OUT, 'biblioteca-1440-filtrado.png') });
  const ovF = await overflow(p);

  await type(p, 'DÁFT');
  s = await snap(p);
  ok('acentos_y_mayusculas', s.filas === N && s.contador === `${N} resultados`, { filas: s.filas });

  // RECORTE: los espacios de los extremos no cuentan (el campo conserva lo tecleado); los de adentro sí;
  // sólo espacios = sin filtro, y el contador vuelve a decir "canciones".
  const rec = {};
  for (const [k, q] of [['detras', 'daft '], ['delante', '  daft'], ['ambos', ' daft  '], ['adentro', 'daft punk'], ['adentroDoble', 'daft  punk'], ['soloEspacios', '   ']]) {
    await type(p, q); const x = await snap(p); rec[k] = { filas: x.filas, contador: x.contador, value: x.value };
  }
  const NP = match('daft punk').length, NPP = match('daft  punk').length;
  ok('recorte_de_espacios', rec.detras.filas === N && rec.delante.filas === N && rec.ambos.filas === N && rec.detras.value === 'daft ' && rec.ambos.value === ' daft  '
    && rec.adentro.filas === NP && rec.adentroDoble.filas === NPP && NPP !== NP
    && rec.soloEspacios.filas === TOTAL && rec.soloEspacios.contador === `${TOTAL} canciones` && rec.soloEspacios.value === '   ', { esperado: { daft: N, 'daft punk': NP, 'daft  punk': NPP, total: TOTAL }, ...rec });

  await type(p, Q);
  await p.locator('.section-header .sbx-clear').click(); await p.waitForTimeout(300);
  s = await snap(p);
  ok('limpiar_restaura', s.filas === TOTAL && s.contador === `${TOTAL} canciones` && s.value === '' && s.focused && (await p.locator('.section-header .sbx-clear').count()) === 0, { filas: s.filas, contador: s.contador, value: s.value, focused: s.focused });

  await type(p, `${NADA} `);
  s = await snap(p);
  ok('sin_resultados', s.filas === 0 && s.empty === `Sin resultados para «${NADA}»` && s.contador === '0 resultados' && await p.locator(INPUT).isVisible(), { empty: s.empty, contador: s.contador });
  const ovV = await overflow(p);

  // Tocar una FILA con filtro: la cola es la lista filtrada, en el orden en que se ve (Biblioteca no
  // tiene "▶ Reproducir": se reproduce tocando una fila).
  await type(p, Q);
  s = await snap(p);
  await p.locator(ROWS).first().click(); await p.waitForFunction(() => !!window.__player()?.currentTrack);
  const c1 = await cola(p);
  ok('tocar_una_fila_reproduce_lo_filtrado', c1.n === N && same(c1.titulos, s.titulos) && c1.actual === s.titulos[0], { cola: c1.n, esperado: N, actual: c1.actual });

  // Riel de orden con filtro: los 5 modos conservan el conjunto (N); la fila tocada arma la cola en el
  // orden visible; Título va A→Z y Duración de menor a mayor, y volver a tocar el modo lo invierte.
  const coll = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
  const riel = {};
  for (const modo of ['Título', 'Artista', 'Álbum', 'Año', 'Duración']) {
    await p.locator('.pl-sortbar .pl-sort-seg', { hasText: modo }).click(); await p.waitForTimeout(300);
    const x = await snap(p);
    await p.locator(ROWS).first().click(); await p.waitForTimeout(300);
    const c = await cola(p);
    riel[modo] = { filas: x.filas, colaIgualALoVisible: c.n === N && same(c.titulos, x.titulos), titulos: x.titulos.slice(0, 3), duraciones: x.duraciones.slice(0, 4) };
    if (modo === 'Título') riel[modo].ordenado = x.titulos.every((t, i) => i === 0 || coll.compare(x.titulos[i - 1], t) <= 0);
    if (modo === 'Duración') {
      riel[modo].ordenado = x.duraciones.map(segundos).every((d, i, a) => i === 0 || a[i - 1] <= d);
      await p.locator('.pl-sortbar .pl-sort-seg', { hasText: modo }).click(); await p.waitForTimeout(300);
      const y = await snap(p);
      riel[modo].invertido = y.filas === N && y.duraciones.map(segundos).every((d, i, a) => i === 0 || a[i - 1] >= d);
    }
  }
  await p.locator('.pl-sortbar .pl-sort-seg', { hasText: 'Artista' }).click(); await p.waitForTimeout(300);
  ok('riel_de_orden_con_filtro', Object.values(riel).every((x) => x.filas === N && x.colaIgualALoVisible) && riel['Título'].ordenado && riel['Duración'].ordenado && riel['Duración'].invertido && (await snap(p)).value === Q, riel);

  // Mix: con filtro mezcla las N filtradas; sin filtro, las TOTAL.
  await p.locator('.library-actions .mix-btn').click(); await p.waitForTimeout(600);
  const m1 = await cola(p);
  await p.locator('.section-header .sbx-clear').click(); await p.waitForTimeout(300);
  await p.locator('.library-actions .mix-btn').click(); await p.waitForTimeout(800);
  const m2 = await cola(p);
  const filtradas = new Set(match(Q).map((t) => t.title ?? 'Sin título'));
  ok('mix_con_y_sin_filtro', m1.n === N && m1.shuffle === true && m1.titulos.every((t) => filtradas.has(t)) && m2.n === TOTAL, { conFiltro: m1.n, esperadoConFiltro: N, sinFiltro: m2.n, esperadoSinFiltro: TOTAL });
  await p.evaluate(() => { const v = window.__player(); if (v.shuffle) v.toggleShuffle(); });

  // Esc con la COLA abierta: 1.º limpia, 2.º suelta el foco, la cola sigue; el 3.º (fuera) la cierra.
  await p.click('.player-bar [aria-label="Cola"]'); await p.waitForSelector('.queue-panel');
  await p.evaluate(() => { window.__esc = 0; window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.__esc++; }); });
  await type(p, Q);
  const st = async () => ({ ...(await snap(p)), cola: await p.locator('.queue-panel').count(), fugas: await p.evaluate(() => window.__esc) });
  await p.keyboard.press('Escape'); await p.waitForTimeout(250); const e1 = await st();
  await p.keyboard.press('Escape'); await p.waitForTimeout(250); const e2 = await st();
  await p.keyboard.press('Escape'); await p.waitForTimeout(300); const e3 = await st();
  ok('esc_limpia_sin_cerrar_la_cola', e1.value === '' && e1.focused && e1.filas === TOTAL && e1.cola === 1 && e2.focused === false && e2.cola === 1 && e2.fugas === 0 && e3.cola === 0 && e3.fugas === 1,
    { e1: { value: e1.value, focused: e1.focused, filas: e1.filas, cola: e1.cola }, e2: { focused: e2.focused, cola: e2.cola, fugas: e2.fugas }, e3: { cola: e3.cola, fugas: e3.fugas } });

  // Esc con el EXPANDIDO abierto (tapa la vista: el foco se pone por código).
  await p.click('.player-bar', { position: { x: 6, y: 6 } }); await p.waitForSelector('.player-expanded');
  await p.evaluate((sel) => document.querySelector(sel).focus(), INPUT);
  await p.keyboard.type('ab'); await p.waitForTimeout(250);
  const x0 = (await snap(p)).value;
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);
  const x1 = { value: (await snap(p)).value, exp: await p.locator('.player-expanded').count() };
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);
  const x2 = { focused: (await snap(p)).focused, exp: await p.locator('.player-expanded').count() };
  await p.keyboard.press('Escape'); await p.waitForTimeout(600);
  const x3 = await p.locator('.player-expanded').count();
  ok('esc_limpia_sin_cerrar_el_expandido', x0 === 'ab' && x1.value === '' && x1.exp === 1 && x2.focused === false && x2.exp === 1 && x3 === 0, { x0, x1, x2, x3 });

  // Tocar la pestaña activa limpia el buscador (ya lo hacía); cambiar de vista y volver, también.
  await type(p, Q);
  await p.locator('.sidebar-nav button', { hasText: 'Biblioteca' }).click(); await p.waitForTimeout(300);
  s = await snap(p);
  ok('pestana_activa_borra', s.value === '' && s.filas === TOTAL && s.contador === `${TOTAL} canciones`, { value: s.value, filas: s.filas });
  await type(p, Q);
  await p.locator('.sidebar-nav button', { hasText: 'Artistas' }).click(); await p.waitForSelector('.artist-grid');
  await p.locator('.sidebar-nav button', { hasText: 'Biblioteca' }).click(); await p.waitForSelector(ROWS); await p.waitForTimeout(400);
  s = await snap(p);
  ok('cambiar_de_vista_borra', s.value === '' && s.filas === TOTAL, { value: s.value, filas: s.filas });

  ok('sin_desborde_ni_choques_1440', limpio(ov0) && limpio(ovF) && ovV.doc <= 0 && ovV.main <= 0 && ovV.cajaFuera === 0, { sinFiltro: ov0, conFiltro: ovF, sinResultados: ovV });
  await ctx.close();
}

// ── Teléfono (390) ──
{
  const { ctx, p } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await goto(p);
  const geo = await p.evaluate(() => {
    const h = document.querySelector('.lib-heading').getBoundingClientRect(); const b = document.querySelector('.section-header .search-box').getBoundingClientRect(); const head = document.querySelector('.section-header').getBoundingClientRect();
    return { hBottom: Math.round(h.bottom), bTop: Math.round(b.top), bW: Math.round(b.width), headW: Math.round(head.width) };
  });
  const o = { todo: await overflow(p) };
  ok('movil_caja_debajo_sin_chocar', geo.bTop >= geo.hBottom && geo.bW === geo.headW && limpio(o.todo), { ...geo, ...o.todo });
  await p.screenshot({ path: join(OUT, 'biblioteca-390.png') });

  const h0 = await p.locator('.section-header .search-box').boundingBox();
  await p.locator(INPUT).tap(); await p.keyboard.type(`${Q} `, { delay: 15 }); await p.waitForTimeout(350);
  const s = await snap(p);
  const cb = await p.locator('.section-header .sbx-clear').boundingBox();
  const h1 = await p.locator('.section-header .search-box').boundingBox();
  o.filtrado = await overflow(p);
  await p.screenshot({ path: join(OUT, 'biblioteca-390-filtrado.png') });
  await p.locator(INPUT).fill(NADA); await p.waitForTimeout(300);
  o.sinResultados = await overflow(p);
  await p.locator('.section-header .sbx-clear').tap(); await p.waitForTimeout(300);
  const fin = await snap(p);
  ok('movil_filtra_limpia_y_sin_desborde_390', s.filas === N && s.contador === `${N} resultados` && Math.round(cb.width) >= 44 && Math.round(cb.height) >= 44 && Math.round(h1.height) === Math.round(h0.height)
    && limpio(o.filtrado) && o.sinResultados.doc <= 0 && o.sinResultados.main <= 0 && fin.filas === TOTAL && fin.value === '',
    { filas: s.filas, contador: s.contador, limpiar: [cb.width, cb.height], alto: [h0.height, h1.height], filtrado: o.filtrado, sinResultados: o.sinResultados });
  await ctx.close();
}

const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
writeFileSync(join(OUT, 'resultado.json'), JSON.stringify(R, null, 1));   // el runner sólo guarda el conteo
console.log(`capturas: ${OUT}`);
console.log(`\nsearch-library-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
