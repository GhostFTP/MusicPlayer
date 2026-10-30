// recientes-vistas-func.mjs — funcional del chip «Recién añadidas» en ÁLBUMES, ARTISTAS, GÉNEROS y AÑOS
// (1.41.0, sub-paso 2 de 2; la Biblioteca la cubre recientes-func.mjs).
//
// «Reciente» = una de las N=50 pistas de id más alto de la biblioteca COMPLETA (tracks:all). Un álbum, artista,
// género o año cuenta si tiene AL MENOS UNA pista reciente. El oráculo se calcula APARTE, desde la API
// (GET /api/tracks → ids ordenados → de ahí álbumes, artistas, géneros y años) y se cruza con las listas de
// GET /api/albums y /api/browse/*: no se reusa el código de las vistas ni utils/recientes.js.
//
// UNIDAD (utils/recientes.js: indicesRecientes y albumKeyDe, importados directo): RECIENTES_UTIL=<ruta> prueba otra copia
// del módulo (mutaciones); SOLO_UNIDAD=1 corre sólo esto, sin navegador ni servidor.
//
// E2E, por vista (a_ álbumes · r_ artistas · g_ géneros · y_ años), escritorio 1440 salvo lo táctil:
//   · tracks:all se pide AL PRIMER TOQUE, no al montar: el montaje hace 0 pedidos de /api/tracks (aunque estuviera demorado
//     2,5 s las tarjetas se pintan sin esperar y el chip nace habilitado); el primer toque en frío hace exactamente 1 pedido,
//     queda ocupado (aria-busy) y el filtro se aplica al llegar SÓLO si el chip sigue encendido; un segundo toque mientras
//     carga cancela; fallo = el mismo aviso ámbar que el Mix; 401 = sin aviso; caché caliente = aplica al instante, sin pedidos;
//     precarga opcional con ratón o teclado (nunca con el dedo);
//   · encendido muestra EXACTAMENTE lo esperado (más «N de M» en el conteo, y «N nuevas» en géneros y años);
//     apagado devuelve la lista idéntica (mismo orden);
//   · AND con el buscador (y, en Álbumes, con Década); estado vacío claro; «Nada reciente» (cuando ninguna pista
//     reciente aporta: se fuerza vaciando el campo en las 50 pistas más altas); Mix = lo que se ve; el detalle de
//     una tarjeta NO cambia (el álbum/artista/género/año completo) y al volver el chip sigue (como el buscador);
//   · se reinicia al salir y volver y al tocar la pestaña activa; no persiste (storage y URL); Enter lo alterna;
//   · sin entrada escalonada al alternar
//     (Artistas, Géneros); caso de álbum de OLEADAS MEZCLADAS (la mitad vieja, la mitad nueva) visible;
//   · Álbumes: el chip es independiente de AlbumsFilter (no suma a su badge ni se guarda con su filtro).
// FILAS a 390 (dedo), 700, 1024 y 1440, apagado y encendido: sin desborde ni solape ni choque con los FABs, y
// cuánto empuja el contenido el chip. Costo en frío por vista: pedidos al montar (0), primera tarjeta y primer toque → filtro aplicado.
//
// CONTROL NEGATIVO: SNAP_BASE hacia un build SIN el chip (v1.40.1): los E2E tienen que fallar.
// ⚠️ Reproduce pistas (la cola): correr contra la COPIA de la base. No escribe en la base.
// Uso: SNAP_BASE=http://localhost:4173 node recientes-vistas-func.mjs
import { preflight, BASE } from '../session.mjs';
import { preparar, sleep } from './tablet-util.mjs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const UTIL = process.env.RECIENTES_UTIL ?? resolve(HERE, '..', '..', '..', '..', 'music-client', 'src', 'utils', 'recientes.js');
const U = await import(pathToFileURL(UTIL).href);

const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? !!v : { ok: !!v, ...extra }; };
// SOLO=prefijo1,prefijo2: corre sólo las secciones con alguna clave que empiece así (las mutaciones apuntan a lo suyo).
const SOLO = (process.env.SOLO ?? '').split(',').filter(Boolean);
// DOS PARTES (el arnés da 5 min por script): sin PARTE corre la del FILTRO (AND, vacíos, Mix, detalle, reinicio, táctil, filas, década…);
// PARTE=carga (la dispara recientes-vistas-carga-func.mjs) corre la de LA CARGA AL PRIMER TOQUE (montaje sin pedidos, ocupado,
// cancelar, fallo, 401, caché caliente, precarga, costo en frío). Con SOLO=… se corre lo pedido sea de la parte que sea.
const PARTE = process.env.PARTE === 'carga' ? 'carga' : 'filtro';
const ES_CARGA = (k) => /(_montaje_0_|_primer_toque_|_segundo_toque_|_fallo_mismo_|_401_sin_aviso|_cache_caliente_)|^(precarga_|con_el_dedo_|lista_llegada_|respuesta_vacia_|cancelar_y_luego_|costo_en_frio_)/.test(k);
const seccion = async (claves, fn) => { if (SOLO.length ? !claves.some((k) => SOLO.some((p) => k.startsWith(p))) : (PARTE === 'carga') !== claves.some(ES_CARGA)) return; try { await fn(); } catch (e) { for (const k of claves) if (!(k in R)) ok(k, false, { excepcion: String(e.message).split('\n')[0].slice(0, 160) }); } };
const mismoSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const igualesSeq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const S = (a) => new Set(a);

// ═══ UNIDAD: indicesRecientes / albumKeyDe ═══
if (PARTE === 'filtro') {
  const T = [
    { id: 1, album: 'Vieja', album_artist: 'A', genre: 'Rock', year: 1990 },
    { id: 2, album: 'Mixta', album_artist: 'B', genre: 'Rock', year: 2001 },
    { id: 3, album: 'Mixta', album_artist: 'B', genre: 'Pop', year: 2001 },     // mismo álbum, oleada nueva
    { id: 4, album: 'Nueva', album_artist: 'C', genre: 'Pop', year: 2023 },
    { id: 5, album: 'Sin artista', album_artist: null, genre: '', year: null },
    { id: 6, album: null, album_artist: '', genre: null, year: 2023 },          // sin álbum, artista vacío
    { id: 7, album: 'Nueva', album_artist: 'C', genre: 'Pop', year: 2023 },
  ];
  const um = U.umbralDe(T, 5);                      // ids 3..7
  const I = U.indicesRecientes(T, um);
  ok('u_indices_albumes_artistas_generos_y_anios', um === 3
    && mismoSet(I.albums, S(['Mixta\nB', 'Nueva\nC', 'Sin artista\n']))
    && mismoSet(I.artists, S(['B', 'C']))
    && mismoSet(S(I.genres.keys()), S(['Pop'])) && I.genres.get('Pop') === 3 && !I.genres.has('') && !I.genres.has('Rock')
    && mismoSet(S(I.years.keys()), S([2001, 2023])) && I.years.get(2023) === 3 && I.years.get(2001) === 1,
  { albums: [...I.albums], artists: [...I.artists], genres: [...I.genres], years: [...I.years] });
  ok('u_un_album_de_oleadas_mezcladas_cuenta_si_tiene_una_reciente', I.albums.has('Mixta\nB') && !I.albums.has('Vieja\nA'));
  ok('u_albumKeyDe_null_y_vacio_son_el_mismo_album', U.albumKeyDe({ album: 'X', album_artist: null }) === U.albumKeyDe({ album: 'X', album_artist: '' })
    && U.albumKeyDe({ album: 'X', album_artist: 'a' }) !== U.albumKeyDe({ album: 'X', album_artist: 'b' })
    && U.albumKeyDe({ album: 'X', album_artist: 'a' }) !== U.albumKeyDe({ album: 'Xa', album_artist: '' }));
  const vacio = [U.indicesRecientes([], null), U.indicesRecientes(undefined, 5), U.indicesRecientes(T, null)];
  ok('u_sin_umbral_o_sin_pistas_no_hay_nada_reciente', vacio.every((v) => v.albums.size === 0 && v.artists.size === 0 && v.genres.size === 0 && v.years.size === 0));
  const copia = JSON.stringify(T); U.indicesRecientes(T, um);
  ok('u_no_muta_la_biblioteca', JSON.stringify(T) === copia);
}
if (process.env.SOLO_UNIDAD) {
  const fu = Object.entries(R).filter(([, x]) => (typeof x === 'object' ? !x.ok : !x));
  console.log(JSON.stringify(R, null, 1));
  console.log(`\nrecientes-vistas-func (sólo unidad): ${Object.keys(R).length - fu.length}/${Object.keys(R).length}`);
  process.exit(fu.length ? 1 : 0);
}

// ═══ E2E ═══
await preflight();
const { token, browser, abrir } = await preparar();
const H = { Authorization: `Bearer ${token}` };
const get = async (u) => (await fetch(BASE + u, { headers: H })).json();
const tracks = await get('/api/tracks?limit=100000');
const ALBUMS = await get('/api/albums'), ARTISTS = await get('/api/browse/artists'), GENRES = await get('/api/browse/genres'), YEARS = await get('/api/browse/years');
const TOTAL = tracks.length;
const TOP = [...tracks].map((t) => t.id).sort((a, b) => b - a).slice(0, 50), TOPSET = S(TOP);
const REC_T = tracks.filter((t) => TOPSET.has(t.id));
const tx = (x) => (x ?? '').toString().trim();
const keyA = (x) => `${x.album}\n${x.album_artist ?? ''}`;           // clave cruda (para cruzar con pistas)
const keyDom = (x) => `${tx(x.album)}\n${tx(x.album_artist)}`;       // clave como se lee de la tarjeta
const fold = (x) => (x ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const hasT = (v) => v != null && v !== '';

// Oráculo: lo reciente de cada vista, desde las pistas de la API.
const RECI = {
  albumes: S(REC_T.filter((t) => t.album != null).map(keyA)),
  artistas: S(REC_T.filter((t) => hasT(t.album_artist)).map((t) => t.album_artist)),
  generos: new Map(), anios: new Map(),
};
for (const t of REC_T) { if (hasT(t.genre)) RECI.generos.set(t.genre, (RECI.generos.get(t.genre) ?? 0) + 1); if (t.year != null) RECI.anios.set(t.year, (RECI.anios.get(t.year) ?? 0) + 1); }

// Configuración por vista. `lista`: las tarjetas que existen en la vista (de la API, en su orden), con su clave,
// el texto donde busca el buscador y si es reciente. `tracksDe(k)`: las pistas de la tarjeta (lo que mezcla el Mix / abre el detalle).
const V = {
  albumes: { pre: 'a', nav: 'Álbumes', ruta: '/albums', cont: '.album-grid', item: '.album-grid .album-card', palabra: 'álbumes',
    lista: ALBUMS.map((a) => ({ k: keyDom(a), hay: `${a.album}\n${a.album_artist ?? ''}`, rec: RECI.albumes.has(keyA(a)), raw: a })),
    tracksVista: tracks.filter((t) => t.album != null), tracksDe: (it) => tracks.filter((t) => t.album != null && keyDom(t) === it.k) },
  artistas: { pre: 'r', nav: 'Artistas', ruta: '/artists', cont: '.artist-grid', item: '.artist-grid .artist-portrait', palabra: 'artistas',
    lista: ARTISTS.map((a) => ({ k: tx(a.artist), hay: a.artist, rec: RECI.artistas.has(a.artist), raw: a })),
    tracksVista: tracks.filter((t) => hasT(t.album_artist)), tracksDe: (it) => tracks.filter((t) => t.album_artist === it.raw.artist) },
  generos: { pre: 'g', nav: 'Géneros', ruta: '/genres', cont: '.browse-list', item: '.browse-list .genre-item', palabra: 'géneros',
    lista: GENRES.map((g) => ({ k: tx(g.genre), hay: g.genre, rec: RECI.generos.has(g.genre), nuevas: RECI.generos.get(g.genre) ?? 0, raw: g })),
    tracksVista: tracks.filter((t) => hasT(t.genre)), tracksDe: (it) => tracks.filter((t) => t.genre === it.raw.genre) },
  anios: { pre: 'y', nav: 'Años', ruta: '/years', cont: '.browse-list', item: '.browse-list .year-item', palabra: 'años',
    lista: YEARS.map((y) => ({ k: String(y.year), hay: String(y.year), rec: RECI.anios.has(y.year), nuevas: RECI.anios.get(y.year) ?? 0, raw: y })),
    tracksVista: tracks.filter((t) => t.year != null), tracksDe: (it) => tracks.filter((t) => t.year === it.raw.year) },
};
const VISTAS = Object.keys(V);
// Qué busca el buscador de cada vista (mismo criterio que el hook: subcadena, sin mayúsculas ni acentos). Años: sólo dígitos = por año
// (desde el principio); con letras = años que tienen alguna pista con álbum/artista que coincide.
const haystackPista = (t) => fold(`${t.album ?? ''}\n${t.album_artist ?? ''}\n${t.artist ?? ''}`);
function buscados(v, q) {
  const f = fold(q.trim()); if (!f) return V[v].lista;
  if (v === 'anios') {
    if (/^\d+$/.test(f)) return V.anios.lista.filter((it) => it.k.startsWith(f));
    const con = S(tracks.filter((t) => t.year != null && haystackPista(t).includes(f)).map((t) => t.year));
    return V.anios.lista.filter((it) => con.has(it.raw.year));
  }
  return V[v].lista.filter((it) => fold(it.hay).includes(f));
}
// Consultas elegidas DESDE LOS DATOS: una que coincide con recientes y con viejas (para probar el AND de verdad) y otra
// que sólo coincide con viejas (para el estado vacío).
// `minPistas` (sólo Años por texto): que las pistas que coinciden en los años recientes sean al menos tantas (el Mix se
// deshabilita con menos de 2: MIN_TRACKS de utils/mixPlayback.js).
function consultas(v, digitos = false, minPistas = 0) {
  const cand = new Set();
  if (digitos) for (const p of ['1', '2', '19', '20', '198', '199', '200', '201', '202']) cand.add(p);
  else for (const s of v === 'anios' ? [...new Set(tracks.map(haystackPista))] : V[v].lista.map((it) => fold(it.hay))) for (let n = 1; n <= 4; n++) for (let i = 0; i + n <= s.length; i++) { const w = s.slice(i, i + n); if (/^[a-z0-9]+$/.test(w)) cand.add(w); }
  const st = [...cand].map((w) => {
    const m = buscados(v, w), ys = S(m.filter((x) => x.rec).map((x) => x.raw.year));
    const pistas = v === 'anios' && !digitos ? tracks.filter((t) => t.year != null && ys.has(t.year) && haystackPista(t).includes(fold(w))).length : null;
    return { w, todas: m.length, rec: m.filter((x) => x.rec).length, pistas };
  });
  const mixta = st.filter((x) => x.rec > 0 && x.todas > x.rec && (x.pistas === null || x.pistas >= minPistas)).sort((a, b) => a.todas - b.todas || a.w.localeCompare(b.w))[0] ?? null;
  const vieja = st.filter((x) => x.rec === 0 && x.todas > 0).sort((a, b) => b.todas - a.todas || a.w.localeCompare(b.w))[0] ?? null;
  return { mixta, vieja };
}

// Lectura del DOM
const nombres = (p, v) => p.evaluate((v) => {
  const t = (e) => (e?.textContent ?? '').trim();
  if (v === 'albumes') return [...document.querySelectorAll('.album-grid .album-card')].map((c) => { const a = t(c.querySelector('.album-artist')); return `${t(c.querySelector('.album-name'))}\n${a === '—' ? '' : a}`; });
  if (v === 'artistas') return [...document.querySelectorAll('.artist-grid .artist-portrait .artist-portrait-name')].map(t);
  if (v === 'generos') return [...document.querySelectorAll('.browse-list .genre-item .browse-item-name')].map(t);
  return [...document.querySelectorAll('.browse-list .year-item .browse-item-name')].map(t);
}, v);
const nuevasDom = (p, v) => p.evaluate((v) => Object.fromEntries([...document.querySelectorAll(v === 'generos' ? '.browse-list .genre-item' : '.browse-list .year-item')].map((li) => {
  const m = li.querySelector('.browse-item-meta')?.textContent.match(/(\d+) nuev/); return [li.querySelector('.browse-item-name').textContent.trim(), m ? Number(m[1]) : null];
})), v);
const estado = (p) => p.evaluate(() => {
  const chip = document.querySelector('.view-actions .recientes-chip');
  return { chip: !!chip, pressed: chip?.getAttribute('aria-pressed') ?? null, disabled: !!chip?.disabled, busy: chip?.getAttribute('aria-busy') === 'true', nombre: chip?.getAttribute('aria-label') ?? null, texto: chip?.textContent.trim() ?? null,
    conteo: document.querySelector('.view-actions .section-count')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
    vacio: document.querySelector('.empty-state')?.innerText.replace(/\s+/g, ' ').trim() ?? null,
    badge: document.querySelector('.af-badge')?.textContent ?? null, url: location.pathname + location.search };
});
const cola = (p) => p.evaluate(() => (window.__player()?.queue ?? []).map((t) => t.id));
const open = (v, w = 1440, h = 900, tactil = false) => abrir(BASE, V[v].ruta, { w, h, tactil, esperar: V[v].item });
const chipLoc = (o) => o.p.locator('.view-actions .recientes-chip');
const listo = (o) => o.p.waitForSelector('.view-actions .recientes-chip:not([disabled])', { timeout: 8000 });
// Alterna y espera a que termine de cargar (el primer toque en frío pide la biblioteca y queda aria-busy hasta que llega).
const alternar = async (o, tactil = false) => {
  await (tactil ? o.tocar(chipLoc(o)) : chipLoc(o).click());
  await o.p.waitForFunction(() => !document.querySelector('.view-actions .recientes-chip[aria-busy="true"]'), null, { timeout: 8000 });
  await sleep(700);
};
const pedidosTracks = (o) => o.pedidos.filter((u) => u.startsWith('/api/tracks?')).length;
const observarToasts = (p) => p.evaluate(() => {
  window.__toasts = [];
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList?.contains('toast')) window.__toasts.push({ texto: n.textContent.trim(), warning: n.classList.contains('warning') }); })
    .observe(document, { childList: true, subtree: true });
});
const toasts = (p) => p.evaluate(() => window.__toasts ?? []);
const buscar = async (o, q) => { await o.p.locator('.search-box input').first().fill(q); await sleep(900); };
const nav = (o, t) => o.p.locator('.sidebar-nav button', { hasText: t });
const esperados = (v, { q = '', rec = true } = {}) => buscados(v, q).filter((it) => !rec || it.rec);
const claves = (items) => items.map((it) => it.k);
const conteoEsperado = (v, n, M = V[v].lista.length) => `${n} de ${M} ${V[v].palabra}`;
async function mixCola(o) {
  await o.p.locator('.view-actions .mix-btn').click();
  await o.p.waitForFunction(() => (window.__player()?.queue?.length ?? 0) > 0, null, { timeout: 8000 }); await sleep(1200);
  return cola(o.p);
}

// ── 1 · AL MONTAR no se pide NADA: el chip nace habilitado y el primer render no espera ──
for (const v of VISTAS) {
  const c = V[v], n = `${c.pre}_montaje_0_pedidos_chip_habilitado_y_primer_render_sin_espera`;
  await seccion([n], async () => {
    const o = await abrir(BASE, '/settings', { w: 1440, h: 900 }); await sleep(800);
    const previos = pedidosTracks(o);
    await o.p.route(/\/api\/tracks\?/, async (r) => { await sleep(2500); await r.continue(); });   // si algo lo pidiera al montar, se notaría
    const t0 = Date.now();
    await nav(o, c.nav).click();
    await o.p.waitForSelector(c.item, { timeout: 8000 });
    const tItem = Date.now() - t0;
    const e1 = await estado(o.p);
    await sleep(1800);   // margen para que un pedido al montar llegue a verse
    const e2 = await estado(o.p);
    ok(n, previos === 0 && pedidosTracks(o) === 0 && tItem < 1800 && e1.chip && !e1.disabled && e1.pressed === 'false' && !e1.busy && !e2.busy && e2.pressed === 'false' && !o.errores.length,
      { pedidos_de_tracks_antes: previos, pedidos_de_tracks_tras_montar: pedidosTracks(o), ms_hasta_la_primera_tarjeta: tItem, habilitado_al_pintar: !e1.disabled, ocupado: e1.busy, errores: o.errores });
    await o.ctx.close();
  });
}

// ── 1b · PRIMER TOQUE en frío: exactamente 1 pedido, ocupado (aria-busy) y el filtro se aplica al llegar ──
for (const v of VISTAS) {
  const c = V[v], n = `${c.pre}_primer_toque_en_frio_1_pedido_ocupado_y_se_aplica_al_llegar`;
  await seccion([n], async () => {
    const o = await abrir(BASE, '/settings', { w: 1440, h: 900 }); await sleep(800);
    await o.p.route(/\/api\/tracks\?/, async (r) => { await sleep(1500); await r.continue(); });
    await nav(o, c.nav).click(); await o.p.waitForSelector(c.item, { timeout: 8000 }); await sleep(300);
    const lista0 = await nombres(o.p, v), conteo0 = (await estado(o.p)).conteo, p0 = pedidosTracks(o);
    await chipLoc(o).click(); await sleep(300);
    const e1 = await estado(o.p), lista1 = await nombres(o.p, v), p1 = pedidosTracks(o) - p0;
    const foco = await o.p.evaluate(() => document.activeElement?.classList.contains('recientes-chip'));
    await o.p.waitForFunction(() => !document.querySelector('.view-actions .recientes-chip[aria-busy="true"]'), null, { timeout: 8000 }); await sleep(500);
    const e2 = await estado(o.p), on = await nombres(o.p, v), esp = claves(esperados(v));
    ok(n, p0 === 0 && p1 === 1 && e1.busy && e1.pressed === 'true' && !e1.disabled && foco && igualesSeq(lista1, lista0) && e1.conteo === conteo0 && /cargando/.test(e1.nombre ?? '')
      && !e2.busy && e2.nombre === null && e2.pressed === 'true' && mismoSet(S(on), S(esp)) && on.length === esp.length && e2.conteo === conteoEsperado(v, esp.length) && pedidosTracks(o) - p0 === 1,
    { pedidos_en_el_montaje: p0, pedidos_del_primer_toque: p1, durante: { ocupado: e1.busy, pulsado: e1.pressed, lista_igual: igualesSeq(lista1, lista0), conteo: e1.conteo, foco_en_el_chip: foco },
      despues: { ocupado: e2.busy, pulsado: e2.pressed, esperado: esp.length, obtenido: on.length, conteo: e2.conteo } });
    await o.ctx.close();
  });
}

// ── 1c · Un SEGUNDO toque mientras carga CANCELA la intención ──
for (const v of VISTAS) {
  const c = V[v], n = `${c.pre}_segundo_toque_mientras_carga_cancela_la_intencion`;
  await seccion([n], async () => {
    const o = await abrir(BASE, '/settings', { w: 1440, h: 900 }); await sleep(800);
    await o.p.route(/\/api\/tracks\?/, async (r) => { await sleep(1500); await r.continue(); });
    await nav(o, c.nav).click(); await o.p.waitForSelector(c.item, { timeout: 8000 }); await sleep(300);
    const lista0 = await nombres(o.p, v), p0 = pedidosTracks(o);
    await chipLoc(o).click(); await sleep(300);
    const e1 = await estado(o.p);
    await chipLoc(o).click(); await sleep(200);
    const e2 = await estado(o.p);
    await sleep(2200);                                   // la respuesta tardía llega: no debe aplicar nada
    const e3 = await estado(o.p), lista3 = await nombres(o.p, v);
    // el pedido quedó cacheado: el siguiente toque aplica al instante, sin pedir otra vez
    await chipLoc(o).click(); await sleep(250);
    const e4 = await estado(o.p), on = await nombres(o.p, v), esp = claves(esperados(v));
    ok(n, e1.busy && e1.pressed === 'true' && !e2.busy && e2.pressed === 'false' && !e3.busy && e3.pressed === 'false' && igualesSeq(lista3, lista0) && e3.conteo === e2.conteo
      && pedidosTracks(o) - p0 === 1 && e4.pressed === 'true' && !e4.busy && mismoSet(S(on), S(esp)) && e4.conteo === conteoEsperado(v, esp.length),
    { tras_1er_toque: { ocupado: e1.busy, pulsado: e1.pressed }, tras_2do_toque: { ocupado: e2.busy, pulsado: e2.pressed },
      tras_llegar_la_respuesta: { ocupado: e3.busy, pulsado: e3.pressed, lista_igual: igualesSeq(lista3, lista0) }, pedidos_en_total: pedidosTracks(o) - p0, tercer_toque: { pulsado: e4.pressed, conteo: e4.conteo, esperado: esp.length } });
    await o.ctx.close();
  });
}

// ── 1d · FALLO del pedido: el mismo aviso ámbar que el Mix, el chip se apaga, la lista no cambia ──
for (const v of VISTAS) {
  const c = V[v], n = `${c.pre}_fallo_mismo_aviso_que_el_mix_y_chip_apagado`;
  await seccion([n], async () => {
    const o = await abrir(BASE, '/settings', { w: 1440, h: 900 }); await sleep(800);
    await o.p.route(/\/api\/tracks\?/, (r) => r.abort('failed'));
    await nav(o, c.nav).click(); await o.p.waitForSelector(c.item, { timeout: 8000 }); await sleep(300);
    await observarToasts(o.p);
    const lista0 = await nombres(o.p, v), p0 = pedidosTracks(o);
    await chipLoc(o).click(); await sleep(900);
    const e1 = await estado(o.p), ts = await toasts(o.p), lista1 = await nombres(o.p, v);
    await chipLoc(o).click(); await sleep(900);          // se puede reintentar
    const e2 = await estado(o.p);
    ok(n, e1.chip && e1.pressed === 'false' && !e1.busy && ts.length === 1 && ts[0].warning && ts[0].texto.includes('No se pudieron cargar las pistas') && igualesSeq(lista1, lista0)
      && pedidosTracks(o) - p0 === 2 && !e2.busy && e2.pressed === 'false' && !o.errores.length,
    { toasts: ts, pulsado: e1.pressed, ocupado: e1.busy, pedidos_tras_reintentar: pedidosTracks(o) - p0, errores: o.errores });
    await o.ctx.close();
  });
}

// ── 1e · 401: igual que el Mix, sin aviso; el cliente cierra la sesión ──
for (const v of VISTAS) {
  const c = V[v], n = `${c.pre}_401_sin_aviso_y_cierra_sesion`;
  await seccion([n], async () => {
    const o = await abrir(BASE, '/settings', { w: 1440, h: 900 }); await sleep(800);
    await o.p.route(/\/api\/tracks\?/, (r) => r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Invalid token' }) }));
    await nav(o, c.nav).click(); await o.p.waitForSelector(c.item, { timeout: 8000 }); await sleep(300);
    await observarToasts(o.p);
    const p0 = pedidosTracks(o);
    await chipLoc(o).click(); await sleep(1500);
    const login = await o.p.locator('input[type=password]').count(), ts = await toasts(o.p), sinChip = await chipLoc(o).count();
    ok(n, pedidosTracks(o) - p0 === 1 && login > 0 && sinChip === 0 && ts.filter((t) => t.warning).length === 0 && !o.errores.length, { pedidos: pedidosTracks(o) - p0, pantalla_de_login: login > 0, toasts: ts, errores: o.errores });
    await o.ctx.close();
  });
}

// ── 1f · CACHÉ CALIENTE (se visitó la Biblioteca): el toque aplica al instante, sin pedidos y sin pasar por «ocupado» ──
for (const v of VISTAS) {
  const c = V[v], n = `${c.pre}_cache_caliente_aplica_al_instante_sin_pedidos`;
  await seccion([n], async () => {
    const o = await abrir(BASE, '/', { w: 1440, h: 900, esperar: '.library-tracks .track-row' }); await sleep(1200);
    await nav(o, c.nav).click(); await o.p.waitForSelector(c.item, { timeout: 8000 }); await sleep(500);
    const p0 = pedidosTracks(o);
    await o.p.evaluate(() => {
      window.__w = { ocupado: false, t0: 0, t1: null };
      document.querySelector('.view-actions .recientes-chip').addEventListener('click', () => { window.__w.t0 = performance.now(); }, true);
      new MutationObserver(() => {
        if (document.querySelector('.view-actions .recientes-chip[aria-busy="true"]')) window.__w.ocupado = true;
        if (window.__w.t0 && window.__w.t1 === null && /\d+ de \d+/.test(document.querySelector('.view-actions .section-count')?.textContent ?? '')) window.__w.t1 = performance.now();
      }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    });
    await chipLoc(o).click(); await sleep(400);
    const w = await o.p.evaluate(() => window.__w), e = await estado(o.p), on = await nombres(o.p, v), esp = claves(esperados(v));
    const ms = w.t1 === null ? null : Math.round((w.t1 - w.t0) * 10) / 10;
    ok(n, pedidosTracks(o) - p0 === 0 && !w.ocupado && ms !== null && ms < 120 && e.pressed === 'true' && mismoSet(S(on), S(esp)) && on.length === esp.length && e.conteo === conteoEsperado(v, esp.length),
      { pedidos_nuevos: pedidosTracks(o) - p0, paso_por_ocupado: w.ocupado, ms_del_toque_al_filtro_aplicado: ms, esperado: esp.length, obtenido: on.length });
    await o.ctx.close();
  });
}

// ── 2/3 · Encendido = lo esperado; apagado = lista idéntica ──
for (const v of VISTAS) {
  const c = V[v], n2 = `${c.pre}_encendido_muestra_exactamente_lo_esperado`, n3 = `${c.pre}_apagado_restaura_la_lista_identica`;
  await seccion([n2, n3], async () => {
    const o = await open(v); await listo(o); await sleep(300);
    const antes = await nombres(o.p, v), e0 = await estado(o.p);
    await alternar(o);
    const e1 = await estado(o.p), on = await nombres(o.p, v), esp = claves(esperados(v));
    let nuevas = true, detNuevas = null;
    if (v === 'generos' || v === 'anios') { const d = await nuevasDom(o.p, v); detNuevas = d; nuevas = esp.length > 0 && esp.every((k) => d[k] === c.lista.find((x) => x.k === k).nuevas); }
    ok(n2, e0.pressed === 'false' && e0.disabled === false && igualesSeq(antes, claves(c.lista)) && e1.pressed === 'true' && mismoSet(S(on), S(esp)) && on.length === esp.length && esp.length > 0 && esp.length < c.lista.length
      && e1.conteo === conteoEsperado(v, esp.length) && nuevas,
    { esperado: esp.length, de: c.lista.length, obtenido: on.length, faltan: esp.filter((k) => !on.includes(k)).slice(0, 4), sobran: on.filter((k) => !esp.includes(k)).slice(0, 4), conteo: e1.conteo, nuevas: detNuevas });
    await alternar(o);
    const e2 = await estado(o.p), off = await nombres(o.p, v);
    ok(n3, e2.pressed === 'false' && igualesSeq(off, antes) && e2.conteo === e0.conteo && e2.badge === e0.badge, { conteo_antes: e0.conteo, conteo_despues: e2.conteo, mismo_orden: igualesSeq(off, antes) });
    await o.ctx.close();
  });
}

// ── 4 · AND con el buscador ──
for (const v of VISTAS) {
  const c = V[v], n = `${c.pre}_AND_con_el_buscador`;
  await seccion([n], async () => {
    const { mixta } = consultas(v, v === 'anios');
    if (!mixta) throw new Error('los datos no tienen una consulta que coincida con recientes y con viejas');
    const o = await open(v); await listo(o);
    await alternar(o); await buscar(o, mixta.w);
    const e = await estado(o.p), on = await nombres(o.p, v), esp = claves(esperados(v, { q: mixta.w }));
    let extra = {}, okTexto = true;
    if (v === 'anios') {   // además, el modo por TEXTO (álbum/artista), que es el que cruza la biblioteca
      const t = consultas('anios', false).mixta;
      if (t) { await buscar(o, t.w); const on2 = await nombres(o.p, 'anios'), esp2 = claves(esperados('anios', { q: t.w })); okTexto = mismoSet(S(on2), S(esp2)) && on2.length === esp2.length; extra = { texto: t.w, esperado_texto: esp2.length, obtenido_texto: on2.length, sin_chip_serian: t.todas }; }
    }
    ok(n, esp.length > 0 && esp.length < mixta.todas && mismoSet(S(on), S(esp)) && on.length === esp.length && e.conteo === conteoEsperado(v, esp.length) && okTexto,
      { consulta: mixta.w, esperado_con_chip: esp.length, sin_chip_serian: mixta.todas, obtenido: on.length, conteo: e.conteo, ...extra });
    await o.ctx.close();
  });
}

// ── 5 · Estado vacío: sin resultados entre las recién añadidas ──
for (const v of VISTAS) {
  const c = V[v], n = `${c.pre}_estado_vacio_claro_sin_resultados_entre_recientes`;
  await seccion([n], async () => {
    const { vieja } = consultas(v, v === 'anios');
    if (!vieja) throw new Error('los datos no tienen una consulta que sólo coincida con viejas');
    const o = await open(v); await listo(o);
    await alternar(o); await buscar(o, vieja.w);
    const e = await estado(o.p), n_items = (await nombres(o.p, v)).length;
    await buscar(o, '');
    const vuelve = (await nombres(o.p, v)).length;
    ok(n, n_items === 0 && e.vacio?.includes('Sin resultados') && e.vacio.includes('entre las recién añadidas') && e.vacio.includes('Apaga «Recién añadidas»') && e.chip && e.pressed === 'true' && vuelve === claves(esperados(v)).length,
      { consulta: vieja.w, coinciden_en_toda_la_vista: vieja.todas, vacio: e.vacio, al_borrar_el_texto_vuelven: vuelve });
    await o.ctx.close();
  });
}

// ── 6 · «Nada reciente»: ninguna pista reciente aporta a la vista (se vacía el campo en las 50 más altas) ──
const CAMPO = { albumes: 'album', artistas: 'album_artist', generos: 'genre', anios: 'year' };
for (const v of VISTAS) {
  const c = V[v], n = `${c.pre}_nada_reciente_cuando_ninguna_pista_reciente_aporta`;
  await seccion([n], async () => {
    const o = await abrir(BASE, '/settings', { w: 1440, h: 900 }); await sleep(800);
    await o.p.route(/\/api\/tracks\?/, async (r) => {
      const res = await r.fetch(); const arr = await res.json();
      for (const t of arr) if (TOPSET.has(t.id)) t[CAMPO[v]] = null;
      await r.fulfill({ status: 200, headers: { 'content-type': 'application/json', etag: 'W/"mutada"' }, body: JSON.stringify(arr) });
    });
    await nav(o, c.nav).click(); await o.p.waitForSelector(c.item, { timeout: 8000 });
    await listo(o); await alternar(o);
    const e = await estado(o.p), items = (await nombres(o.p, v)).length;
    ok(n, items === 0 && e.vacio?.includes('Nada reciente') && e.vacio.includes('Apaga «Recién añadidas»') && e.pressed === 'true' && e.conteo === conteoEsperado(v, 0), { vacio: e.vacio, conteo: e.conteo });
    await o.ctx.close();
  });
}

// ── 7 · El Mix mezcla lo que se ve ──
for (const v of VISTAS) {
  const c = V[v], n = `${c.pre}_mix_respeta_lo_que_se_ve`;
  await seccion([n], async () => {
    const o = await open(v); await listo(o);
    await alternar(o);
    const vis = esperados(v), q1 = await mixCola(o).catch((e) => { throw new Error('mix con chip: ' + e.message.split(String.fromCharCode(10))[0]); });
    const esp1 = S(vis.flatMap((it) => c.tracksDe(it).map((t) => t.id)));
    await alternar(o);
    const q2 = await mixCola(o).catch((e) => { throw new Error('mix apagado: ' + e.message.split(String.fromCharCode(10))[0]); }), esp2 = S(c.tracksVista.map((t) => t.id));
    let q3ok = true, d3 = null;
    if (v === 'anios') {   // con texto el Mix de Años mezcla SÓLO las pistas que coinciden: con el chip, las de los años que se ven
      const t = consultas('anios', false, 2).mixta;
      if (t) {
        await alternar(o); await buscar(o, t.w);
        const q3 = await mixCola(o).catch((e) => { throw new Error('mix con texto «' + t.w + '» y chip: ' + e.message.split(String.fromCharCode(10))[0]); }), anios = S(esperados('anios', { q: t.w }).map((it) => it.raw.year)), f = fold(t.w);
        const esp3 = S(tracks.filter((x) => x.year != null && anios.has(x.year) && haystackPista(x).includes(f)).map((x) => x.id));
        q3ok = mismoSet(S(q3), esp3) && q3.length === esp3.size; d3 = { consulta: t.w, cola: q3.length, esperado: esp3.size };
      }
    }
    ok(n, mismoSet(S(q1), esp1) && q1.length === esp1.size && esp1.size < esp2.size && mismoSet(S(q2), esp2) && q2.length === esp2.size && q3ok,
      { con_chip: { cola: q1.length, esperado: esp1.size }, apagado: { cola: q2.length, esperado: esp2.size }, años_con_texto_y_chip: d3 });
    await o.ctx.close();
  });
}

// ── 8 · El detalle NO cambia, y al volver el chip sigue ──
for (const v of VISTAS) {
  const c = V[v], n = `${c.pre}_el_detalle_no_cambia_y_al_volver_el_chip_sigue`;
  await seccion([n], async () => {
    const o = await open(v); await listo(o); await alternar(o);
    // La tarjeta reciente con MÁS pistas viejas: si el detalle se filtrara a lo reciente, se notaría.
    const viejas = (x) => c.tracksDe(x).filter((t) => !TOPSET.has(t.id)).length;
    const it = [...esperados(v)].sort((a, b) => viejas(b) - viejas(a))[0];
    const dom = await nombres(o.p, v);
    await o.p.locator(c.item).nth(dom.indexOf(it.k)).click(); await sleep(1200);
    let obtenido, esperado, detalle;
    if (v === 'artistas' || v === 'anios') {
      await o.p.waitForSelector('.album-grid .album-card', { timeout: 8000 }); await sleep(500);
      obtenido = await o.p.locator('.album-grid .album-card').count();
      esperado = (await get(v === 'artistas' ? '/api/albums?artist=' + encodeURIComponent(it.raw.artist) : '/api/albums?year=' + it.raw.year)).length;
      detalle = { tarjeta: it.k, tarjetas_de_album: obtenido, esperado, de_las_cuales_viejas: viejas(it) };
    } else {
      await o.p.locator('.detail-actions .btn-primary, .view-actions .btn-primary').first().click();
      await o.p.waitForFunction(() => (window.__player()?.queue?.length ?? 0) > 0, null, { timeout: 8000 }); await sleep(600);
      const q = await cola(o.p), esp = S(c.tracksDe(it).map((t) => t.id));
      obtenido = mismoSet(S(q), esp) ? q.length : -1; esperado = esp.size; detalle = { tarjeta: it.k, cola: q.length, esperado: esp.size, viejas: viejas(it) };
    }
    await o.p.locator('.back-btn').click(); await sleep(900);
    const e = await estado(o.p);
    ok(n, obtenido === esperado && esperado > 0 && e.chip && e.pressed === 'true' && e.conteo === conteoEsperado(v, esperados(v).length), { ...detalle, tras_volver: { pressed: e.pressed, conteo: e.conteo } });
    await o.ctx.close();
  });
}

// ── 9/10 · Reinicio ──
for (const v of VISTAS) {
  const c = V[v], n9 = `${c.pre}_se_reinicia_al_salir_y_volver`, n10 = `${c.pre}_tocar_la_pestana_activa_lo_apaga`;
  await seccion([n9, n10], async () => {
    const o = await open(v); await listo(o); await alternar(o);
    await nav(o, 'Biblioteca').click(); await o.p.waitForSelector('.library-tracks .track-row', { timeout: 8000 }); await sleep(500);
    await nav(o, c.nav).click(); await o.p.waitForSelector(c.item, { timeout: 8000 }); await sleep(500);
    const e1 = await estado(o.p);
    ok(n9, e1.chip && e1.pressed === 'false' && (await nombres(o.p, v)).length === c.lista.length, { estado: e1 });
    await listo(o); await alternar(o);
    const encendido = (await estado(o.p)).pressed;
    await nav(o, c.nav).click(); await sleep(800);
    const e2 = await estado(o.p);
    ok(n10, encendido === 'true' && e2.pressed === 'false' && (await nombres(o.p, v)).length === c.lista.length, { antes: encendido, despues: e2.pressed });
    await o.ctx.close();
  });
}

// ── 11 · Táctil 390 ──
for (const v of VISTAS) {
  const c = V[v], n = `${c.pre}_tactil_390_un_toque_alterna`;
  await seccion([n], async () => {
    const o = await open(v, 390, 844, true); await listo(o); await sleep(300);
    await alternar(o, true); const e1 = await estado(o.p), on = await nombres(o.p, v), esp = claves(esperados(v));
    await alternar(o, true); const e2 = await estado(o.p);
    ok(n, e1.pressed === 'true' && mismoSet(S(on), S(esp)) && e1.conteo === conteoEsperado(v, esp.length) && e2.pressed === 'false', { tras_toque_1: e1.pressed, tras_toque_2: e2.pressed, conteo: e1.conteo });
    await o.ctx.close();
  });
}

// ── Globales ──
// PRECARGA opcional: ratón encima o foco de teclado calientan la misma caché; el dedo no (ahí el primer toque paga el pedido).
await seccion(['precarga_con_raton_calienta_la_cache_y_el_toque_siguiente_no_pide'], async () => {
  const o = await open('albumes'); await listo(o); await sleep(500);
  const p0 = pedidosTracks(o);
  await chipLoc(o).hover(); await sleep(900);
  const p1 = pedidosTracks(o) - p0, e1 = await estado(o.p);
  await chipLoc(o).click(); await sleep(250);
  const e2 = await estado(o.p), on = await nombres(o.p, 'albumes'), esp = claves(esperados('albumes'));
  ok('precarga_con_raton_calienta_la_cache_y_el_toque_siguiente_no_pide', p0 === 0 && p1 === 1 && e1.pressed === 'false' && !e1.busy && e2.pressed === 'true' && !e2.busy && mismoSet(S(on), S(esp)) && pedidosTracks(o) - p0 === 1,
    { pedidos_al_pasar_el_raton: p1, pulsado_tras_pasar: e1.pressed, tras_el_toque: { pulsado: e2.pressed, ocupado: e2.busy }, pedidos_en_total: pedidosTracks(o) - p0 });
  await o.ctx.close();
});

await seccion(['precarga_y_toque_inmediato_comparten_el_pedido'], async () => {
  const o = await open('albumes'); await listo(o); await sleep(400);
  await o.p.route(/\/api\/tracks\?/, async (r) => { await sleep(1500); await r.continue(); });
  const p0 = pedidosTracks(o);
  await chipLoc(o).hover(); await chipLoc(o).click(); await sleep(300);
  const e1 = await estado(o.p);
  await o.p.waitForFunction(() => !document.querySelector('.view-actions .recientes-chip[aria-busy="true"]'), null, { timeout: 8000 }); await sleep(400);
  const e2 = await estado(o.p), on = await nombres(o.p, 'albumes'), esp = claves(esperados('albumes'));
  ok('precarga_y_toque_inmediato_comparten_el_pedido', e1.busy && e1.pressed === 'true' && !e2.busy && e2.pressed === 'true' && mismoSet(S(on), S(esp)) && pedidosTracks(o) - p0 === 1,
    { durante: { ocupado: e1.busy, pulsado: e1.pressed }, despues: { ocupado: e2.busy, esperado: esp.length, obtenido: on.length }, pedidos_en_total: pedidosTracks(o) - p0 });
  await o.ctx.close();
});

await seccion(['con_el_dedo_no_hay_precarga_el_primer_toque_paga_el_pedido'], async () => {
  const r = {};
  for (const v of VISTAS) {
    const o = await open(v, 390, 844, true); await listo(o); await sleep(500);
    const p0 = pedidosTracks(o);
    // Dedo puesto y sostenido 600 ms SIN soltar: en un táctil no hay «pasar por encima», así que no se precarga nada.
    const bb = await o.p.evaluate(() => { const b = document.querySelector('.view-actions .recientes-chip').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    const cdp = await o.ctx.newCDPSession(o.p);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bb.x, y: bb.y }] }); await sleep(600);
    const sostenido = pedidosTracks(o) - p0;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach().catch(() => {}); await sleep(150);
    const e1 = await estado(o.p);
    await o.p.waitForFunction(() => !document.querySelector('.view-actions .recientes-chip[aria-busy="true"]'), null, { timeout: 8000 }); await sleep(400);
    const e2 = await estado(o.p);
    r[v] = { antes_del_toque: p0, con_el_dedo_sostenido: sostenido, tras_el_toque: pedidosTracks(o) - p0, ocupado_o_ya_aplicado: e1.busy || e1.pressed === 'true', aplicado: e2.pressed === 'true' && /\d+ de \d+/.test(e2.conteo ?? '') };
    await o.ctx.close();
  }
  ok('con_el_dedo_no_hay_precarga_el_primer_toque_paga_el_pedido', Object.values(r).every((x) => x.antes_del_toque === 0 && x.con_el_dedo_sostenido === 0 && x.tras_el_toque === 1 && x.ocupado_o_ya_aplicado && x.aplicado), r);
});

await seccion(['precarga_con_foco_de_teclado'], async () => {
  const o = await open('albumes'); await listo(o); await sleep(500);
  const p0 = pedidosTracks(o);
  let llego = false, antes = 0;
  for (let k = 0; k < 80 && !llego; k++) {
    await o.p.keyboard.press('Tab');
    llego = await o.p.evaluate(() => document.activeElement?.classList.contains('recientes-chip'));
    if (!llego) antes = pedidosTracks(o) - p0;
  }
  await sleep(900);
  const p1 = pedidosTracks(o) - p0, e1 = await estado(o.p);
  await o.p.keyboard.press('Enter'); await sleep(300);
  const e2 = await estado(o.p);
  ok('precarga_con_foco_de_teclado', llego && antes === 0 && p1 === 1 && e1.pressed === 'false' && e2.pressed === 'true' && !e2.busy && pedidosTracks(o) - p0 === 1, { llego_con_tab: llego, pedidos_antes_de_llegar: antes, pedidos_al_enfocar: p1, tras_enter: e2.pressed, pedidos_en_total: pedidosTracks(o) - p0 });
  await o.ctx.close();
});

await seccion(['precarga_no_se_repite_en_la_ventana_si_falla'], async () => {
  const o = await open('albumes'); await listo(o); await sleep(400);
  await o.p.route(/\/api\/tracks\?/, (r) => r.abort('failed'));
  const p0 = pedidosTracks(o);
  for (let k = 0; k < 3; k++) { await chipLoc(o).hover(); await sleep(250); await o.p.mouse.move(5, 5); await sleep(250); }
  const n = pedidosTracks(o) - p0, e = await estado(o.p);
  ok('precarga_no_se_repite_en_la_ventana_si_falla', n === 1 && e.pressed === 'false' && !e.busy && !o.errores.length, { pedidos_tras_3_pasadas: n, errores: o.errores });
  await o.ctx.close();
});

// La lista llegó por OTRO camino después de montar la vista (el Mix la carga y la deja en la caché compartida): el toque la lee
// fresca y aplica al instante, sin pedir nada y sin pasar por «ocupado».
await seccion(['lista_llegada_por_el_mix_el_toque_es_instantaneo'], async () => {
  const o = await open('albumes'); await listo(o); await sleep(500);
  await mixCola(o);
  const p0 = pedidosTracks(o);
  await o.p.evaluate(() => {
    window.__w = { ocupado: false, t0: 0, t1: null };
    document.querySelector('.view-actions .recientes-chip').addEventListener('click', () => { window.__w.t0 = performance.now(); }, true);
    new MutationObserver(() => {
      if (document.querySelector('.view-actions .recientes-chip[aria-busy="true"]')) window.__w.ocupado = true;
      if (window.__w.t0 && window.__w.t1 === null && /\d+ de \d+/.test(document.querySelector('.view-actions .section-count')?.textContent ?? '')) window.__w.t1 = performance.now();
    }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  await chipLoc(o).click(); await sleep(400);
  const w = await o.p.evaluate(() => window.__w), e = await estado(o.p), on = await nombres(o.p, 'albumes'), esp = claves(esperados('albumes'));
  ok('lista_llegada_por_el_mix_el_toque_es_instantaneo', pedidosTracks(o) - p0 === 0 && !w.ocupado && w.t1 !== null && e.pressed === 'true' && mismoSet(S(on), S(esp)),
    { pedidos_nuevos: pedidosTracks(o) - p0, paso_por_ocupado: w.ocupado, ms: w.t1 === null ? null : Math.round((w.t1 - w.t0) * 10) / 10 });
  await o.ctx.close();
});

// Respuesta VACÍA ([]: lo que devuelve la biblioteca si la cuenta cambió a mitad del pedido): nada que filtrar → el chip se apaga, sin aviso.
await seccion(['respuesta_vacia_apaga_el_chip_sin_aviso'], async () => {
  const o = await abrir(BASE, '/settings', { w: 1440, h: 900 }); await sleep(800);
  await o.p.route(/\/api\/tracks\?/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await nav(o, 'Álbumes').click(); await o.p.waitForSelector(V.albumes.item, { timeout: 8000 }); await sleep(300);
  await observarToasts(o.p);
  const lista0 = await nombres(o.p, 'albumes');
  await chipLoc(o).click(); await sleep(900);
  const e = await estado(o.p), ts = await toasts(o.p), lista1 = await nombres(o.p, 'albumes');
  ok('respuesta_vacia_apaga_el_chip_sin_aviso', e.pressed === 'false' && !e.busy && ts.length === 0 && igualesSeq(lista1, lista0) && !o.errores.length, { pulsado: e.pressed, ocupado: e.busy, toasts: ts, errores: o.errores });
  await o.ctx.close();
});

// Cancelar y DESPUÉS fallar: la intención ya no existe, así que la respuesta tardía no avisa ni toca el chip.
await seccion(['cancelar_y_luego_fallar_no_avisa'], async () => {
  const o = await abrir(BASE, '/settings', { w: 1440, h: 900 }); await sleep(800);
  await o.p.route(/\/api\/tracks\?/, async (r) => { await sleep(1200); await r.abort('failed'); });
  await nav(o, 'Álbumes').click(); await o.p.waitForSelector(V.albumes.item, { timeout: 8000 }); await sleep(300);
  await observarToasts(o.p);
  const lista0 = await nombres(o.p, 'albumes');
  await chipLoc(o).click(); await sleep(250);
  await chipLoc(o).click(); await sleep(200);
  await sleep(2000);
  const e = await estado(o.p), ts = await toasts(o.p), lista1 = await nombres(o.p, 'albumes');
  ok('cancelar_y_luego_fallar_no_avisa', e.pressed === 'false' && !e.busy && ts.length === 0 && igualesSeq(lista1, lista0) && !o.errores.length, { pulsado: e.pressed, ocupado: e.busy, toasts: ts, errores: o.errores });
  await o.ctx.close();
});

await seccion(['no_persiste_ni_va_en_la_url', 'teclado_enter_alterna_y_conserva_el_foco'], async () => {
  const r = {}, k = {};
  for (const v of VISTAS) {
    const o = await open(v); await listo(o);
    const snap = () => o.p.evaluate(() => JSON.stringify([Object.entries(localStorage).filter(([x]) => x !== 'token').sort(), Object.entries(sessionStorage).sort(), location.href]));
    const antes = await snap(); await alternar(o); await buscar(o, 'a'); const durante = await snap();
    r[v] = antes === durante;
    await buscar(o, ''); await alternar(o); const chip = chipLoc(o);   // apagado de nuevo: Enter lo enciende y otro Enter lo apaga
    await chip.focus(); await o.p.keyboard.press('Enter'); await sleep(500);
    const k1 = (await estado(o.p)).pressed, f1 = await o.p.evaluate(() => document.activeElement?.classList.contains('recientes-chip'));
    await o.p.keyboard.press('Enter'); await sleep(500);
    const k2 = (await estado(o.p)).pressed, f2 = await o.p.evaluate(() => document.activeElement?.classList.contains('recientes-chip'));
    k[v] = { enter: [k1, k2], foco: [f1, f2] };
    await o.ctx.close();
  }
  ok('no_persiste_ni_va_en_la_url', Object.values(r).every(Boolean), r);
  ok('teclado_enter_alterna_y_conserva_el_foco', Object.values(k).every((x) => x.enter[0] === 'true' && x.enter[1] === 'false' && x.foco[0] && x.foco[1]), k);
});

await seccion(['sin_entrada_escalonada_al_alternar_artistas_y_generos'], async () => {
  const r = {};
  for (const [v, sel] of [['artistas', '.artist-grid'], ['generos', '.browse-list']]) {
    const o = await open(v); await listo(o);
    const cl = () => o.p.evaluate((s) => document.querySelector(s).className, sel);
    const antes = await cl(); await alternar(o); const e1 = await cl(); await alternar(o); const e2 = await cl();
    r[v] = { antes, encendido: e1, apagado: e2, ok: !antes.includes('--still') && e1.includes('--still') && e2.includes('--still') };
    await o.ctx.close();
  }
  ok('sin_entrada_escalonada_al_alternar_artistas_y_generos', Object.values(r).every((x) => x.ok), r);
});

await seccion(['a_album_de_oleadas_mezcladas_visible_y_el_viejo_oculto'], async () => {
  const mezclado = ALBUMS.filter((a) => { const ts = tracks.filter((t) => keyA(t) === keyA(a)); const n = ts.filter((t) => TOPSET.has(t.id)).length; return n > 0 && n < ts.length; }).sort((a, b) => b.track_count - a.track_count);
  const viejo = ALBUMS.filter((a) => !RECI.albumes.has(keyA(a)))[0];
  if (!mezclado.length) throw new Error('la biblioteca no tiene ningún álbum de oleadas mezcladas');
  const o = await open('albumes'); await listo(o); await alternar(o);
  const on = S(await nombres(o.p, 'albumes'));
  ok('a_album_de_oleadas_mezcladas_visible_y_el_viejo_oculto', mezclado.every((a) => on.has(keyDom(a))) && !on.has(keyDom(viejo)),
    { mezclados: mezclado.map((a) => `${a.album} (${a.album_artist ?? '—'}): ${tracks.filter((t) => keyA(t) === keyA(a) && TOPSET.has(t.id)).length} de ${a.track_count} recientes`), oculto: viejo.album });
  await o.ctx.close();
});

// ── Álbumes + AlbumsFilter ──
const decada = (a) => (a.year ? String(Math.floor(a.year / 10) * 10) : 'none');
const abrirFiltro = async (o) => { await o.p.locator('.af-btn').click(); await sleep(400); };
const cerrarFiltro = async (o) => { await o.p.keyboard.press('Escape'); await sleep(400); };
const decadaChip = (o, d) => o.p.locator(`.af-chip[aria-label="Años ${d}"]`);
await seccion(['a_AND_con_decada', 'a_estado_vacio_con_chip_y_decada', 'a_mix_con_chip_y_decada', 'a_chip_independiente_del_filtro_no_suma_al_badge_ni_se_guarda'], async () => {
  const decs = [...new Set(ALBUMS.map(decada))].filter((d) => d !== 'none').sort();
  const recDecs = S(ALBUMS.filter((a) => RECI.albumes.has(keyA(a))).map(decada));
  const D = decs.filter((d) => recDecs.has(d) && ALBUMS.some((a) => decada(a) === d && !RECI.albumes.has(keyA(a))))[0];   // con recientes Y viejos
  const SIN = decs.find((d) => !recDecs.has(d));                                                                       // sin recientes
  if (!D || !SIN) throw new Error(`no hay una década con recientes y viejos (${D}) y otra sin recientes (${SIN})`);
  const o = await open('albumes'); await listo(o);
  const e0 = await estado(o.p), ls0 = await o.p.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('albumsFilter')));
  await alternar(o);
  const e1 = await estado(o.p), ls1 = await o.p.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('albumsFilter')));
  ok('a_chip_independiente_del_filtro_no_suma_al_badge_ni_se_guarda', e0.badge === null && e1.badge === null && ls0.length === 0 && ls1.length === 0, { badge_con_chip: e1.badge, claves_del_filtro: ls1 });
  await abrirFiltro(o); await decadaChip(o, D).click(); await sleep(700); await cerrarFiltro(o);
  const e2 = await estado(o.p), on = await nombres(o.p, 'albumes');
  const esp = ALBUMS.filter((a) => RECI.albumes.has(keyA(a)) && decada(a) === D).map(keyDom);
  ok('a_AND_con_decada', esp.length > 0 && mismoSet(S(on), S(esp)) && on.length === esp.length && e2.badge === '1' && e2.conteo === conteoEsperado('albumes', esp.length),
    { decada: D, esperado: esp.length, obtenido: on.length, badge: e2.badge, conteo: e2.conteo });
  // Mix con chip + década = los álbumes que se ven
  const q = await mixCola(o), espM = S(tracks.filter((t) => t.album != null && esp.includes(keyDom(t))).map((t) => t.id));
  ok('a_mix_con_chip_y_decada', mismoSet(S(q), espM) && q.length === espM.size, { cola: q.length, esperado: espM.size });
  // Década sin recientes: vacío con «Limpiar filtro»
  await abrirFiltro(o); await decadaChip(o, D).click(); await decadaChip(o, SIN).click(); await sleep(700); await cerrarFiltro(o);
  const e3 = await estado(o.p), btn = await o.p.locator('.empty-state .btn-primary', { hasText: 'Limpiar filtro' }).count();
  ok('a_estado_vacio_con_chip_y_decada', e3.vacio?.includes('Ningún álbum reciente coincide con el filtro') && e3.vacio.includes('Apaga «Recién añadidas»') && btn === 1 && e3.pressed === 'true', { decada_sin_recientes: SIN, vacio: e3.vacio, limpiar_filtro: btn });
  // Recargar: el chip NO vuelve; el filtro (década) sí, con su badge, y lo guardado no menciona al chip
  await o.p.reload(); await o.p.waitForSelector('.view-actions .recientes-chip', { timeout: 10000 }); await sleep(800);
  const e4 = await estado(o.p), guardado = await o.p.evaluate(() => Object.entries(localStorage).filter(([k]) => k.includes('albumsFilter')).map(([, v]) => v));
  const prev = R.a_chip_independiente_del_filtro_no_suma_al_badge_ni_se_guarda;
  R.a_chip_independiente_del_filtro_no_suma_al_badge_ni_se_guarda = { ...prev, ok: prev.ok && e4.pressed === 'false' && e4.badge === '1' && guardado.length === 1 && !/rec/i.test(guardado[0]), tras_recargar: { chip: e4.pressed, badge: e4.badge, guardado } };
  await o.ctx.close();
});

// ── Filas a 390 (dedo), 700, 1024 y 1440 ──
const medirFila = (p, v) => p.evaluate((cont) => {
  const r1 = (n) => Math.round(n * 10) / 10;
  const caja = (e) => { if (!e) return null; if (getComputedStyle(e).display === 'none') return null; const b = e.getBoundingClientRect(); return b.width ? { x: r1(b.left), y: r1(b.top), w: r1(b.width), h: r1(b.height), r: r1(b.right), b: r1(b.bottom) } : null; };
  const fila = document.querySelector('.view-actions');
  return { innerW: innerWidth, scrollW: document.documentElement.scrollWidth, fila: caja(fila), wrap: getComputedStyle(fila).flexWrap,
    mix: caja(fila.querySelector('.mix-btn')), conteo: caja(fila.querySelector('.section-count')), chip: caja(fila.querySelector('.recientes-chip')), herramientas: caja(fila.querySelector('.view-tools')),
    cabecera: caja(document.querySelector('.section-header')), contenido: caja(document.querySelector(cont)),
    fabs: ['.search-fab', '.settings-fab', '.changelog-bell'].map((s) => caja(document.querySelector(s))).filter(Boolean) };
}, V[v].cont);
const pisa = (a, b) => a.x < b.r - 0.5 && b.x < a.r - 0.5 && a.y < b.b - 0.5 && b.y < a.b - 0.5;
const MEDIDAS = {};
for (const [w, h, tactil] of [[390, 844, true], [700, 900, false], [1024, 768, false], [1440, 900, false]]) {
  await seccion([`filas_sin_desborde_ni_solape_${w}`], async () => {
    const problemas = [], resumen = {};
    for (const v of VISTAS) {
      const o = await open(v, w, h, tactil); await listo(o); await sleep(300);
      const cajas = {};
      let empuje = null;
      for (const est of ['apagado', 'encendido']) {
        if (est === 'encendido') await alternar(o, tactil);
        cajas[est] = await medirFila(o.p, v);
        // cuánto empuja el chip al contenido, medido con el chip APAGADO (el conteo no cambia): la parte alta de la grilla/lista
        // con el chip y sin él. Encendido el conteo se alarga («N de M») y puede envolver la fila por su cuenta.
        if (est === 'apagado') empuje = await o.p.evaluate((cont) => { const g = document.querySelector(cont), c = document.querySelector('.view-actions .recientes-chip'); const con = g.getBoundingClientRect().top; c.style.display = 'none'; const sin = g.getBoundingClientRect().top; c.style.display = ''; return Math.round((con - sin) * 10) / 10; }, V[v].cont);
      }
      for (const [nombre, m] of Object.entries(cajas)) {
        const items = [['mix', m.mix], ['conteo', m.conteo], ['chip', m.chip], ['herramientas', m.herramientas]].filter(([, c]) => c);
        if (!m.chip || !m.mix || !m.conteo) { problemas.push(`${v} ${nombre}: falta un elemento de la fila`); continue; }
        if (m.scrollW > m.innerW) problemas.push(`${v} ${nombre}: scroll horizontal ${m.scrollW} > ${m.innerW}`);
        for (const [n, c] of items) if (c.x < -0.5 || c.r > m.innerW + 0.5) problemas.push(`${v} ${nombre}: ${n} fuera de la pantalla (x ${c.x}, r ${c.r})`);
        for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (pisa(items[i][1], items[j][1])) problemas.push(`${v} ${nombre}: ${items[i][0]} pisa a ${items[j][0]}`);
        for (const [n, c] of items) for (const f of m.fabs) if (pisa(c, f)) problemas.push(`${v} ${nombre}: ${n} pisa un FAB`);
        if (m.contenido && m.contenido.y < m.fila.b - 0.5) problemas.push(`${v} ${nombre}: el contenido queda dentro de la fila`);
        const minAlto = tactil || w <= 700 ? 44 : 40;
        if (m.chip.h < minAlto) problemas.push(`${v} ${nombre}: el chip mide ${m.chip.h} (<${minAlto})`);
      }
      const m = cajas.apagado, c = (x) => x && [x.x, x.y, x.w, x.h];
      resumen[v] = { mix: c(m.mix), conteo: c(m.conteo), chip: c(m.chip), herramientas: c(m.herramientas), fila_alto: m.fila.h, linea_del_chip: m.chip.y > m.conteo.b - 1 ? 'segunda' : 'misma', empuje_px: empuje, fabs_visibles: m.fabs.length };
      await o.ctx.close();
    }
    MEDIDAS[w] = resumen;
    ok(`filas_sin_desborde_ni_solape_${w}`, problemas.length === 0, { problemas, medidas: resumen });
  });
}

// ── Costo medido en frío, por vista: peticiones al MONTAR (debe ser 0), primera tarjeta, y del primer toque al filtro aplicado ──
await seccion(['costo_en_frio_montaje_0_pedidos_y_primer_toque_por_vista'], async () => {
  const r = {};
  for (const v of VISTAS) {
    const o = await abrir(BASE, '/settings', { w: 1440, h: 900 }); await sleep(800);
    await o.p.evaluate(() => { performance.clearResourceTimings(); });
    const t0 = Date.now();
    await nav(o, V[v].nav).click(); await o.p.waitForSelector(V[v].item, { timeout: 8000 }); const tItem = Date.now() - t0;
    await sleep(800);
    const alMontar = await o.p.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.name.includes('/api/tracks?')).length);
    await o.p.evaluate(() => {
      window.__w = { t0: 0, t1: null };
      document.querySelector('.view-actions .recientes-chip').addEventListener('click', () => { window.__w.t0 = performance.now(); }, true);
      new MutationObserver(() => { if (window.__w.t0 && window.__w.t1 === null && /\d+ de \d+/.test(document.querySelector('.view-actions .section-count')?.textContent ?? '')) window.__w.t1 = performance.now(); })
        .observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    });
    await chipLoc(o).click(); await sleep(1200);
    const w = await o.p.evaluate(() => window.__w);
    const rec = await o.p.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.name.includes('/api/tracks?')).map((e) => ({ ms: Math.round(e.duration), transfer: e.transferSize, cuerpo: e.encodedBodySize, descomprimido: e.decodedBodySize })));
    r[v] = { pedidos_al_montar: alMontar, ms_hasta_la_primera_tarjeta: tItem, pedidos_tras_el_primer_toque: rec.length, ms_del_toque_al_filtro_aplicado: w.t1 === null ? null : Math.round((w.t1 - w.t0) * 10) / 10, pedido: rec[0] ?? null };
    await o.ctx.close();
  }
  ok('costo_en_frio_montaje_0_pedidos_y_primer_toque_por_vista', Object.values(r).every((x) => x.pedidos_al_montar === 0 && x.pedidos_tras_el_primer_toque === 1 && x.ms_del_toque_al_filtro_aplicado !== null), r);
});

const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
console.log(`casos: ${TOTAL} pistas · top 50 por id (de ${Math.min(...TOP)} a ${Math.max(...TOP)}) · recientes: ${RECI.albumes.size} álbumes de ${ALBUMS.length}, ${RECI.artistas.size} artistas de ${ARTISTS.length}, ${RECI.generos.size} géneros de ${GENRES.length}, ${RECI.anios.size} años de ${YEARS.length}`);
console.log(`\n${PARTE === 'carga' ? 'recientes-vistas-carga-func' : 'recientes-vistas-func'}: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
