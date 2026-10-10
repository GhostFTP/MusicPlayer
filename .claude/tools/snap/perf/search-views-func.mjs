// search-views-func.mjs — funcional del BUSCADOR DE LOS LISTADOS (SearchBox + useListFilter), sub-paso S1:
// sólo Álbumes. Teclear filtra y el contador acompaña; limpiar restaura; acentos y mayúsculas; sin
// resultados; Esc limpia (o suelta el foco) SIN cerrar la cola ni el expandido — y lo mismo el Esc del
// filtro del detalle de playlist —; el texto se conserva al entrar y salir de un detalle y se borra al
// tocar la pestaña activa o cambiar de vista; Mix sobre lo que se ve; modos Cuadrícula y Lista; 390 y
// 1440 sin desbordes. Lo esperado se calcula ACÁ desde /api/albums con un plegado propio (no importa
// el de la app). Escribe una playlist de prueba: correr contra la COPIA de la base (regresion.mjs).
// Capturas en shots/sub3/search-views (ignorado por git).
// Uso: SNAP_BASE=http://localhost:4173 node search-views-func.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'shots', 'sub3', process.env.OUT ?? 'search-views');
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

// ── Lo esperado, calculado acá ──
const fold = (s) => (s ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const albums = await fetch(`${BASE}/api/albums`, { headers: H }).then((r) => r.json());
const tracks = await fetch(`${BASE}/api/tracks?limit=10000`, { headers: H }).then((r) => r.json());
const match = (q) => albums.filter((a) => fold(a.album).includes(fold(q).trim()) || fold(a.album_artist).includes(fold(q).trim()));
const TOTAL = albums.length;
const word = (n) => `${n} ${n === 1 ? 'álbum' : 'álbumes'}`;
// Consulta que deje un subconjunto propio de varios álbumes: un artista con ≥2 álbumes.
const byArtist = new Map();
for (const a of albums) if (a.album_artist) byArtist.set(a.album_artist, (byArtist.get(a.album_artist) ?? 0) + 1);
const ARTIST = [...byArtist.entries()].filter(([, n]) => n >= 2).sort((x, y) => x[1] - y[1])[0]?.[0] ?? albums.find((a) => a.album_artist)?.album_artist;
const Q = fold(ARTIST).slice(0, Math.max(4, Math.min(8, ARTIST.length)));
const EXP = match(Q);
// La misma consulta en MAYÚSCULAS y con una vocal acentuada: tiene que dar lo mismo.
const ACC = { a: 'Á', e: 'É', i: 'Í', o: 'Ó', u: 'Ú' };
let accented = false;
const Q_RARA = [...Q].map((ch) => { if (!accented && ACC[ch]) { accented = true; return ACC[ch]; } return ch.toUpperCase(); }).join('');
const NADA = 'zzqxjw';
const sumTracks = (list) => { const keys = new Set(list.map((a) => `${a.album}\n${a.album_artist ?? ''}`)); return tracks.filter((t) => t.album != null && keys.has(`${t.album}\n${t.album_artist ?? ''}`)).length; };

// Playlist de prueba con 3 pistas (para el Esc del filtro del detalle). En la copia de la base.
const pl = await fetch(`${BASE}/api/playlists`, { method: 'POST', headers: H, body: JSON.stringify({ name: `buscador-${Date.now()}`, emoji: '🔎' }) }).then((r) => r.json());
for (const t of tracks.slice(0, 3)) await fetch(`${BASE}/api/playlists/${pl.id}/tracks`, { method: 'POST', headers: H, body: JSON.stringify({ track_id: t.id }) });

async function open(opts) {
  const ctx = await browser.newContext(opts);
  await ctx.route('**/stream/**', (r) => {
    const h = r.request().headers().range; const total = WAV.length;
    if (!h) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV });
    const [, a, b] = h.match(/bytes=(\d*)-(\d*)/); const start = a ? +a : 0; const end = b ? +b : total - 1;
    r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: WAV.subarray(start, end + 1) });
  });
  await ctx.addInitScript((t) => { localStorage.setItem('token', t); for (const k of Object.keys(localStorage)) if (k.startsWith('sonorarev.albumsView:')) localStorage.removeItem(k); }, token);
  return { ctx, p: await ctx.newPage() };
}
const INPUT = '.section-header .search-box input';
const CARDS = '.album-grid .album-card';
const gotoAlbums = async (p) => { await p.goto(BASE + '/albums'); await p.waitForSelector(CARDS); await p.waitForTimeout(300); };
const snap = (p) => p.evaluate(() => ({
  cards: document.querySelectorAll('.album-grid .album-card').length,
  count: document.querySelector('.view-actions .section-count')?.textContent ?? null,
  value: document.querySelector('.section-header .search-box input')?.value ?? null,
  empty: document.querySelector('.empty-state .empty-title')?.textContent ?? null,
  focused: document.activeElement === document.querySelector('.section-header .search-box input'),
  grid: document.querySelector('.album-grid')?.className ?? null,
}));
const names = (p) => p.evaluate(() => [...document.querySelectorAll('.album-grid .album-card')].map((c) => `${c.querySelector('.album-name').textContent}\n${c.querySelector('.album-artist').textContent}`));
const type = async (p, q) => { await p.locator(INPUT).click(); await p.keyboard.press('Control+A'); await p.keyboard.type(q, { delay: 15 }); await p.waitForTimeout(250); };
const overflow = (p) => p.evaluate(() => {
  const m = document.querySelector('.main-content'); const b = document.querySelector('.section-header .search-box').getBoundingClientRect();
  const h = document.querySelector('.section-header').getBoundingClientRect();
  return { doc: document.documentElement.scrollWidth - window.innerWidth, main: m.scrollWidth - m.clientWidth, cajaFuera: Math.round(Math.max(0, b.right - h.right, h.left - b.left)) };
});
const sinDesborde = (o) => o.doc <= 0 && o.main <= 0 && o.cajaFuera === 0;
const queueCount = (p) => p.evaluate(() => Number((document.querySelector('.queue-panel .queue-kicker')?.textContent.match(/(\d+)\s+pistas?/) ?? [])[1] ?? -1));
const wantNames = (list) => list.map((a) => `${a.album}\n${a.album_artist ?? '—'}`).sort().join('|');

// ── Escritorio (1440) ──
{
  const { ctx, p } = await open({ viewport: { width: 1440, height: 900 } });
  await gotoAlbums(p);

  // 1) La caja está en la cabecera, a la derecha del título y en su mismo renglón.
  const geo = await p.evaluate(() => {
    const t = document.querySelector('.section-header .section-title').getBoundingClientRect();
    const b = document.querySelector('.section-header .search-box').getBoundingClientRect();
    return { tRight: t.right, tMid: t.top + t.height / 2, bLeft: b.left, bTop: b.top, bBottom: b.bottom, bW: Math.round(b.width) };
  });
  ok('caja_a_la_derecha_del_titulo', geo.bLeft > geo.tRight && geo.tMid > geo.bTop && geo.tMid < geo.bBottom && geo.bW === 280, geo);

  // 2) Teclear filtra y el contador cambia.
  const s0 = await snap(p);
  await type(p, Q);
  let s = await snap(p);
  ok('teclear_filtra_y_contador', s0.cards === TOTAL && s0.count === word(TOTAL) && EXP.length > 0 && EXP.length < TOTAL && s.cards === EXP.length && s.count === word(EXP.length)
    && (await names(p)).sort().join('|') === wantNames(EXP), { q: Q, antes: s0.count, despues: s.count, esperado: EXP.length });
  await p.screenshot({ path: join(OUT, 'albumes-1440-filtrado.png') });

  // 3) Acentos y mayúsculas: la misma consulta "rara" da lo mismo.
  await type(p, Q_RARA);
  s = await snap(p);
  ok('acentos_y_mayusculas', accented && s.cards === EXP.length && (await names(p)).sort().join('|') === wantNames(EXP), { q: Q_RARA, cards: s.cards });

  // 4) Limpiar con el ✕ restaura todo y devuelve el foco al campo; sin texto el ✕ no está.
  await p.locator('.section-header .sbx-clear').click(); await p.waitForTimeout(250);
  s = await snap(p);
  ok('limpiar_restaura', s.cards === TOTAL && s.count === word(TOTAL) && s.value === '' && s.focused && (await p.locator('.section-header .sbx-clear').count()) === 0, s);

  // 5) Sin resultados: el aviso, contador en 0 y la cabecera con el buscador sigue ahí.
  await type(p, NADA);
  s = await snap(p);
  ok('sin_resultados', s.cards === 0 && s.empty === `Sin resultados para «${NADA}»` && s.count === word(0) && s.value === NADA
    && await p.locator('.section-header .section-title').isVisible() && await p.locator('.avs-seg').isVisible(), s);
  await p.screenshot({ path: join(OUT, 'albumes-1440-sin-resultados.png') });

  // 6) Modos: con filtro, Lista y Cuadrícula muestran los mismos álbumes; el filtro no se pierde.
  await type(p, Q);
  await p.locator('.avs-seg [role="radio"][aria-label="Lista"]').click(); await p.waitForTimeout(200);
  const lista = await snap(p); const listaNames = (await names(p)).sort().join('|');
  const ovLista = await overflow(p);
  await p.locator('.avs-seg [role="radio"][aria-label="Grande"]').click(); await p.waitForTimeout(200);
  const grande = await snap(p);
  ok('modos_cuadricula_y_lista', lista.grid.includes('album-grid--list') && lista.cards === EXP.length && listaNames === wantNames(EXP) && lista.value === Q
    && grande.grid === 'album-grid' && grande.cards === EXP.length && grande.value === Q, { lista: lista.grid, grande: grande.grid, cards: [lista.cards, grande.cards] });

  // 6b) Los otros tres modos (Mediana, Pequeña, Mosaico) con el filtro puesto: mismos álbumes, el
  //     contador acompaña y nada desborda. En Mosaico el texto de la tarjeta está oculto pero sigue
  //     en el DOM, así que los nombres se comparan igual.
  const otros = {};
  for (const [m, label] of [['d3', 'Mediana'], ['d4', 'Pequeña'], ['mosaic', 'Mosaico']]) {
    await p.locator(`.avs-seg [role="radio"][aria-label="${label}"]`).click(); await p.waitForTimeout(200);
    const st = await snap(p);
    otros[m] = { grid: st.grid, cards: st.cards, count: st.count, value: st.value, nombres: (await names(p)).sort().join('|') === wantNames(EXP), ov: await overflow(p) };
  }
  await p.locator('.avs-seg [role="radio"][aria-label="Grande"]').click(); await p.waitForTimeout(200);
  ok('modos_mediana_pequena_mosaico_1440', Object.entries(otros).every(([m, x]) => x.grid.includes(`album-grid--${m}`) && x.cards === EXP.length && x.count === word(EXP.length) && x.value === Q && x.nombres && sinDesborde(x.ov)), otros);

  // 7) El texto se conserva al entrar a un detalle y volver (botón Volver = atrás del historial).
  await p.locator(CARDS).first().click(); await p.waitForSelector('.detail-title');
  const enDetalle = await p.locator(INPUT).count();
  await p.locator('.back-btn').click(); await p.waitForSelector(CARDS); await p.waitForTimeout(250);
  s = await snap(p);
  ok('texto_se_conserva_al_volver_del_detalle', enDetalle === 0 && s.value === Q && s.cards === EXP.length && s.count === word(EXP.length), s);

  // 8) Tocar la pestaña activa borra el texto.
  await p.locator('.sidebar-nav button', { hasText: 'Álbumes' }).click(); await p.waitForTimeout(250);
  s = await snap(p);
  ok('pestana_activa_borra', s.value === '' && s.cards === TOTAL, s);

  // 9) Cambiar de vista y volver borra el texto.
  await type(p, Q);
  await p.locator('.sidebar-nav button', { hasText: 'Artistas' }).click(); await p.waitForSelector('.artist-grid');
  await p.locator('.sidebar-nav button', { hasText: 'Álbumes' }).click(); await p.waitForSelector(CARDS); await p.waitForTimeout(250);
  s = await snap(p);
  ok('cambiar_de_vista_borra', s.value === '' && s.cards === TOTAL && s.count === word(TOTAL), s);

  // 10) Sin desbordes a 1440 (sin filtro, y antes en Lista con filtro).
  const ov = await overflow(p);
  ok('sin_desborde_1440', sinDesborde(ov) && sinDesborde(ovLista), { cuadricula: ov, lista: ovLista });

  // 11) Mix: sin filtro mezcla TODA la vista (las pistas con álbum); con filtro, las de lo que se ve.
  await p.locator('.view-actions .mix-btn').click(); await p.waitForSelector('.player-bar [aria-label="Cola"]');
  await p.click('.player-bar [aria-label="Cola"]'); await p.waitForSelector('.queue-panel .queue-row');
  const qTodo = await queueCount(p);
  await type(p, Q);
  await p.locator('.view-actions .mix-btn').click(); await p.waitForTimeout(700);
  const qFiltro = await queueCount(p);
  ok('mix_sobre_lo_que_se_ve', qTodo === sumTracks(albums) && qFiltro === sumTracks(EXP) && qFiltro < qTodo, { sinFiltro: qTodo, esperadoSinFiltro: sumTracks(albums), conFiltro: qFiltro, esperadoConFiltro: sumTracks(EXP) });

  // 12) Esc con la COLA abierta: 1.º limpia el texto, 2.º suelta el foco, y la cola sigue abierta las
  //     dos veces; ninguno de los dos llega a window. El 3.º (ya fuera del campo) sí la cierra.
  await p.evaluate(() => { window.__esc = 0; window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.__esc++; }); });
  await p.locator(INPUT).click();
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  const e1 = { ...(await snap(p)), cola: await p.locator('.queue-panel').count() };
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  const e2 = { ...(await snap(p)), cola: await p.locator('.queue-panel').count(), fugas: await p.evaluate(() => window.__esc) };
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  const e3 = { cola: await p.locator('.queue-panel').count(), fugas: await p.evaluate(() => window.__esc) };
  ok('esc_limpia_sin_cerrar_la_cola', e1.value === '' && e1.focused && e1.cards === TOTAL && e1.cola === 1 && e2.focused === false && e2.cola === 1 && e2.fugas === 0 && e3.cola === 0 && e3.fugas === 1,
    { e1: { value: e1.value, focused: e1.focused, cola: e1.cola }, e2: { focused: e2.focused, cola: e2.cola, fugas: e2.fugas }, e3 });

  // 13) Esc con el EXPANDIDO abierto. El expandido tapa la vista, así que el foco se pone por código.
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
  ok('esc_limpia_sin_cerrar_el_expandido', x0 === 'ab' && x1.value === '' && x1.exp === 1 && x2.focused === false && x2.exp === 1 && x3 === 0, { x0, x1, x2, x3 });

  // 14) El Esc del filtro del DETALLE DE PLAYLIST tampoco cierra la cola (y sigue limpiando).
  await p.goto(`${BASE}/playlists/${pl.id}`); await p.waitForSelector('.pl-search input');
  await p.click('.player-bar [aria-label="Cola"]'); await p.waitForSelector('.queue-panel');
  await p.locator('.pl-search input').click(); await p.keyboard.type('zz'); await p.waitForTimeout(150);
  const y0 = await p.locator('.pl-search input').inputValue();
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);
  const y1 = { value: await p.locator('.pl-search input').inputValue(), cola: await p.locator('.queue-panel').count() };
  ok('esc_del_filtro_de_playlist_no_cierra_la_cola', y0 === 'zz' && y1.value === '' && y1.cola === 1, { y0, y1 });

  await ctx.close();
}

// ── Teléfono (390) ──
{
  const { ctx, p } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await gotoAlbums(p);

  // 15) La caja va DEBAJO del título y ocupa el ancho de la cabecera.
  const geo = await p.evaluate(() => {
    const h = document.querySelector('.section-header').getBoundingClientRect();
    const t = document.querySelector('.section-header .section-title').getBoundingClientRect();
    const b = document.querySelector('.section-header .search-box').getBoundingClientRect();
    return { tBottom: Math.round(t.bottom), bTop: Math.round(b.top), bW: Math.round(b.width), hW: Math.round(h.width) };
  });
  ok('movil_caja_debajo_del_titulo', geo.bTop >= geo.tBottom && geo.bW === geo.hW, geo);
  await p.screenshot({ path: join(OUT, 'albumes-390.png') });

  // 16) Filtra igual; el ✕ tiene 44px de área táctil y no agranda la caja.
  const h0 = await p.locator('.section-header .search-box').boundingBox();
  await p.locator(INPUT).tap(); await p.keyboard.type(Q, { delay: 15 }); await p.waitForTimeout(300);
  const s = await snap(p);
  const cb = await p.locator('.section-header .sbx-clear').boundingBox();
  const h1 = await p.locator('.section-header .search-box').boundingBox();
  ok('movil_filtra_y_limpiar_44', s.cards === EXP.length && s.count === word(EXP.length) && Math.round(cb.width) >= 44 && Math.round(cb.height) >= 44 && Math.round(h1.height) === Math.round(h0.height),
    { cards: s.cards, count: s.count, limpiar: [cb.width, cb.height], alto: [h0.height, h1.height] });
  await p.screenshot({ path: join(OUT, 'albumes-390-filtrado.png') });

  // 17) Sin desbordes a 390: cuadrícula con filtro, sin resultados, Lista con filtro y sin filtro.
  const o = {};
  o.cuadricula = await overflow(p);
  await p.locator(INPUT).fill(NADA); await p.waitForTimeout(250);
  o.sinResultados = await overflow(p);
  await p.screenshot({ path: join(OUT, 'albumes-390-sin-resultados.png') });
  await p.locator(INPUT).fill(Q); await p.waitForTimeout(250);
  await p.locator('.avs-btn').click(); await p.waitForSelector('.avs-menu');
  await p.locator('.avs-menu [role="menuitemradio"]', { hasText: 'Lista' }).click(); await p.waitForTimeout(250);
  const lista = await snap(p);
  o.lista = await overflow(p);
  await p.screenshot({ path: join(OUT, 'albumes-390-lista-filtrado.png') });
  await p.locator('.section-header .sbx-clear').tap(); await p.waitForTimeout(250);
  o.listaTodo = await overflow(p);
  ok('sin_desborde_390', Object.values(o).every(sinDesborde) && lista.grid.includes('album-grid--list') && lista.cards === EXP.length, o);

  // 18) Mediana, Pequeña y Mosaico a 390 con el filtro puesto (se eligen desde el menú "Vista").
  await p.locator(INPUT).fill(Q); await p.waitForTimeout(250);
  const otros = {};
  for (const [m, label] of [['d3', 'Mediana'], ['d4', 'Pequeña'], ['mosaic', 'Mosaico']]) {
    await p.locator('.avs-btn').click(); await p.waitForSelector('.avs-menu');
    await p.locator('.avs-menu [role="menuitemradio"]', { hasText: label }).click(); await p.waitForTimeout(250);
    const st = await snap(p);
    otros[m] = { grid: st.grid, cards: st.cards, count: st.count, value: st.value, nombres: (await names(p)).sort().join('|') === wantNames(EXP), ov: await overflow(p) };
    await p.screenshot({ path: join(OUT, `albumes-390-${m}-filtrado.png`) });
  }
  ok('modos_mediana_pequena_mosaico_390', Object.entries(otros).every(([m, x]) => x.grid.includes(`album-grid--${m}`) && x.cards === EXP.length && x.count === word(EXP.length) && x.value === Q && x.nombres && sinDesborde(x.ov)), otros);
  await ctx.close();
}

// Captura a 1440 sin filtro (la cabecera en reposo).
{
  const { ctx, p } = await open({ viewport: { width: 1440, height: 900 } });
  await gotoAlbums(p);
  await p.screenshot({ path: join(OUT, 'albumes-1440.png') });
  await ctx.close();
}

await fetch(`${BASE}/api/playlists/${pl.id}`, { method: 'DELETE', headers: H }).catch(() => {});

const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
console.log(`capturas: ${OUT}`);
console.log(`\nsearch-views-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
