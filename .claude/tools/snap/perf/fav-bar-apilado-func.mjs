// fav-bar-apilado-func.mjs — funcional del CORAZÓN APILADO bajo el «+» en la barra de escritorio angosta
// (701–899 px, 1.40.1). Hasta la 1.40.0 ahí la barra NO mostraba el corazón (vivía en el expandido y
// en el menú contextual): el hueco al costado del «+» le dejaba 31 px al título. Ahora el «+» y el
// corazón van en UNA columna de 30 px, el «+» arriba, y el título no pierde ancho (gana 6 px).
//
// Comprueba, a 701, 760, 820 y 899 (ratón): el corazón se ve y mide 30×30; «+» y corazón quedan
// dentro de los 80 px de la barra y de la columna, uno sobre otro (misma x, 2 px de hueco) y sin
// pisarse; el título no es menor que el medido en main 8754c1e (73/90/106/128 px, con tolerancia) y
// NO hay scroll horizontal (a 9 anchos entre 701 y 899). A 900 sigue al costado del «+».
// ≥900 (900, 1024, 1280, 1440) y ≤700 (390 táctil, 600, 700): IDÉNTICO a main 8754c1e — mismas cajas
// del «+» y del corazón y mismo título, `.player-track` sigue en flex y en la mini barra el corazón
// de escritorio no existe (valores fijados abajo, medidos en 8754c1e). Con SNAP_REF (ese mismo build
// en otro puerto) además se compara la caja de CADA elemento de la barra: ≥900 y ≤700 idénticas, y
// en 701–899 todo lo de fuera de la columna izquierda también. Sin SNAP_REF esas filas NO se cuentan.
// TÁCTIL (dedo, isMobile+hasTouch → pointer: coarse) a 701, 768, 820, 834 y 899: «+» y corazón tienen
// 44 px de ancho de área de toque y ~40 de alto, contiguas y SIN solape (se mide con elementFromPoint
// en la columna: quién recibe el toque en cada px). 44 de alto a cada uno es imposible: son dos
// botones a 32 px de centro a centro en una barra de 80 → a lo sumo 40 cada uno (el «+» tenía 44×44;
// pasa a 44×40: es el costo medido de apilar). Un toque en la extensión de cada uno (arriba del «+»,
// debajo del corazón) activa el suyo. Las cajas visibles con dedo y con ratón son iguales.
// Un clic en el corazón a 800 px alterna aria-pressed, deja el servidor consistente y no abre el
// expandido. Los tooltips (BarTip): el del «+» sigue arriba; el del corazón sale a su derecha (arriba
// taparía el «+»), también con teclado, y sin movimiento con prefers-reduced-motion.
// Con un VIDEO sonando a 800 no hay ni corazón ni «+» y el título ocupa el ancho (la columna de
// acciones vacía no gasta los 40 px). Soltar un arrastre sobre la barra sigue encolando, también si
// se suelta justo sobre el corazón (y entonces NO lo alterna).
//
// ⚠️ ESCRIBE (crea/borra "Mis favoritos" de la cuenta de prueba): correr contra la COPIA de la base.
// Los videos son los fixtures sintéticos de video-fixtures.mjs (regresion.mjs los arma).
// Uso: SNAP_BASE=http://localhost:4173 [SNAP_REF=http://localhost:4174] node fav-bar-apilado-func.mjs
import { preflight, BASE } from '../session.mjs';
import { preparar, sleep } from './tablet-util.mjs';

const REF = process.env.SNAP_REF ?? null;
await preflight();
const { token, browser, abrir } = await preparar();

const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
const apiJ = async (path, opts = {}) => {
  const r = await fetch(BASE + path, { ...opts, headers: H });
  return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
};
const FAV = 'Mis favoritos';
const favLists = async () => (await apiJ('/api/playlists')).body.filter((p) => p.name.trim() === FAV);
const favTrackIds = async () => { const l = await favLists(); return l.length ? (await apiJ(`/api/playlists/${l[0].id}/tracks`)).body.map((t) => t.id) : []; };
async function wipeFavs() { for (const p of await favLists()) await apiJ(`/api/playlists/${p.id}`, { method: 'DELETE' }); }

// Las dos pistas salen de la base: el título más corto y el más largo (únicos, para hallar la fila).
const tracksAll = (await apiJ('/api/tracks?limit=10000')).body.filter((t) => (t.title ?? '').trim());
const unicos = tracksAll.filter((t) => tracksAll.filter((o) => o.title === t.title).length === 1);
const porLargo = [...unicos].sort((a, b) => a.title.length - b.title.length || a.id - b.id);
const CORTO = porLargo[0], LARGO = porLargo[porLargo.length - 1];
const VIDEO = (await apiJ('/api/videos')).body?.videos?.find((v) => v.title === 'Largo Para Seek') ?? null;

const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? !!v : { ok: !!v, ...extra }; };
const r1 = (n) => Math.round(n * 10) / 10;
// Una excepción dentro de una sección (p. ej. no hay corazón al que apuntar) cuenta como FALLO de sus claves, no como caída del script.
const seccion = async (claves, fn) => { try { await fn(); } catch (e) { for (const k of claves) if (!(k in R)) ok(k, false, { excepcion: String(e.message).split('\n')[0].slice(0, 160) }); } };

// Ancho del título medido en main 8754c1e (v1.40.0), con el título largo, y el de 701–899 de hoy.
const TITULO_HOY = { 701: 73, 760: 90, 820: 106, 899: 128 };
const TOL = 2;
// Cajas [x, y, ancho, alto] medidas en main 8754c1e (pista larga, viewport de alto 900). En ≥900 el «+» y el
// corazón van al costado; en ≤700 el corazón es el de la mini barra (.fav-mini) y el de escritorio no existe.
const HUELLA_GE900 = {
  900: { mas: [178.4, 845.5, 30, 30], corazon: [220.4, 845.5, 30, 30], titulo: 86 },
  1024: { mas: [212.9, 845.5, 30, 30], corazon: [254.9, 845.5, 30, 30], titulo: 121 },
  1280: { mas: [285.3, 845.5, 30, 30], corazon: [327.3, 845.5, 30, 30], titulo: 185 },
  1440: { mas: [329.8, 845.5, 30, 30], corazon: [371.8, 845.5, 30, 30], titulo: 230 },
};
const HUELLA_LE700 = {
  390: { mini: [178, 788.5, 40, 40], titulo: 92, tactil: true },
  600: { mini: [388, 788.5, 40, 40], titulo: 302 },
  700: { mini: [488, 788.5, 40, 40], titulo: 402 },
};
const iguales = (a, b, t = 0.2) => !!a && !!b && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= t);

// Deja sonando `track` en un contexto nuevo (ratón o dedo) a ancho `w` y alto 900.
async function reproducir(base, w, track, { tactil = false } = {}) {
  const o = await abrir(base, '/', { w, h: 900, tactil, esperar: '.library-tracks .track-row' });
  await o.p.evaluate(() => document.fonts.ready);
  await o.p.locator('.search-box input').first().fill(track.title); await sleep(500);
  await o.tocar(o.p.locator('.library-tracks .track-row').filter({ has: o.p.getByText(track.title, { exact: true }) }).first());
  await o.p.waitForFunction((t) => document.querySelector('.player-bar .player-title')?.textContent.trim() === t, track.title, { timeout: 6000 });
  await sleep(600);
  return o;
}

// Geometría de la barra: «+», corazón, columna izquierda, título y desbordes.
const medir = (p) => p.evaluate(() => {
  const r1 = (n) => Math.round(n * 10) / 10;
  const bar = document.querySelector('.player-bar');
  const vis = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const caja = (el) => { const r = el.getBoundingClientRect(); return { x: r1(r.left), y: r1(r.top), w: r1(r.width), h: r1(r.height), r: r1(r.right), b: r1(r.bottom) }; };
  const el = (s) => bar.querySelector(s);
  const mas = el('.ptp-player .ptp-btn'), cor = el('.fav-player'), mini = el('.fav-mini'), track = el('.player-track'), meta = el('.player-meta'), art = el('.player-art, .player-art-placeholder'), title = el('.player-title');
  const caja3 = (e) => { const c = caja(e); return [c.x, c.y, c.w, c.h]; };
  return {
    innerW: window.innerWidth, pageScrollW: document.documentElement.scrollWidth,
    bar: { ...caja(bar), scrollW: bar.scrollWidth, clientW: bar.clientWidth },
    track: { ...caja(track), display: getComputedStyle(track).display }, meta: caja(meta), art: art ? caja(art) : null,
    titulo: title.clientWidth,
    mas: vis(mas) ? caja(mas) : null, corazon: vis(cor) ? { ...caja(cor), pressed: cor.getAttribute('aria-pressed') } : null,
    masExiste: !!mas, corazonExiste: !!cor,
    mini: vis(mini) ? caja3(mini) : null,
    favTipDisplay: el('.fav-tip') ? getComputedStyle(el('.fav-tip')).display : 'ausente',
    masA3: vis(mas) ? caja3(mas) : null, corA3: vis(cor) ? caja3(cor) : null,
  };
});
const sePisan = (a, b) => a.x < b.r - 0.5 && b.x < a.r - 0.5 && a.y < b.b - 0.5 && b.y < a.b - 0.5;
const expandidoAbierto = (p) => p.locator('.player-expanded').count().then((n) => n > 0);

// Quién recibe el toque a lo largo de la columna del «+» y del corazón (elementFromPoint), en px de la barra.
const barrido = (p) => p.evaluate(() => {
  const mas = document.querySelector('.player-bar .ptp-btn'), cor = document.querySelector('.player-bar .fav-player'), bar = document.querySelector('.player-bar').getBoundingClientRect();
  if (!mas || !cor) return { barra_alto: Math.round(bar.height), mas: null, corazon: null, ancho_mas: 0, ancho_corazon: 0 };
  const m = mas.getBoundingClientRect(), c = cor.getBoundingClientRect(); const cx = m.left + m.width / 2;
  const dueno = (x, y) => { const t = document.elementFromPoint(x, y); if (!t) return '-'; if (mas.contains(t)) return '+'; if (cor.contains(t)) return 'v'; return '.'; };
  const col = []; for (let y = Math.ceil(bar.top); y < Math.min(bar.bottom, innerHeight - 1); y++) col.push(dueno(cx, y + 0.5));
  const tramo = (k) => { const i = col.indexOf(k), j = col.lastIndexOf(k); return i < 0 ? null : { desde: Math.ceil(bar.top) + i - Math.round(bar.top), alto: j - i + 1, continuo: col.slice(i, j + 1).every((z) => z === k) }; };
  const horiz = (r, k) => { const cy = r.top + r.height / 2; let a = 0, b = 0; while (a < 80 && dueno(r.left + r.width / 2 - a - 1, cy) === k) a++; while (b < 80 && dueno(r.left + r.width / 2 + b, cy) === k) b++; return a + b; };
  return { barra_alto: Math.round(bar.height), mas: tramo('+'), corazon: tramo('v'), ancho_mas: horiz(m, '+'), ancho_corazon: horiz(c, 'v') };
});

await wipeFavs();
const medidas = {};

// ═══ 701–899, ratón ═══
for (const w of [701, 760, 820, 899]) {
  const o = await reproducir(BASE, w, LARGO);
  const m = await medir(o.p);
  medidas[w] = { titulo: m.titulo, mas: m.masA3, corazon: m.corA3 };
  const c = m.corazon, mas = m.mas;
  ok(`corazon_visible_30x30_${w}`, !!c && c.w === 30 && c.h === 30, { corazon: c });
  ok(`apilado_dentro_de_la_barra_${w}`, !!c && !!mas && m.track.display === 'grid' && mas.w === 30 && mas.h === 30
    && Math.abs(mas.x - c.x) <= 0.5 && c.y - mas.b >= 1 && c.y - mas.b <= 3 && !sePisan(mas, c)
    && mas.y >= m.bar.y && c.b <= m.bar.b && mas.x >= m.track.x && c.r <= m.track.r + 0.5 && mas.x >= m.meta.r - 0.5,
  { mas: m.masA3, corazon: m.corA3, hueco_px: c && mas ? r1(c.y - mas.b) : null, barra: [m.bar.y, m.bar.b], display: m.track.display });
  ok(`titulo_no_menor_que_main_${w}`, m.titulo >= TITULO_HOY[w] - TOL, { medido: m.titulo, main_8754c1e: TITULO_HOY[w], tolerancia: TOL });
  await o.ctx.close();
}
// Sin scroll horizontal en todo el rango (la barra y la página).
{
  const malos = [];
  for (const w of [701, 720, 760, 768, 800, 820, 834, 850, 899]) {
    const o = await reproducir(BASE, w, LARGO); const m = await medir(o.p);
    if (m.pageScrollW > m.innerW || m.bar.scrollW > m.bar.clientW) malos.push({ w, pagina: [m.pageScrollW, m.innerW], barra: [m.bar.scrollW, m.bar.clientW] });
    await o.ctx.close();
  }
  ok('sin_scroll_horizontal_701_a_899', malos.length === 0, { anchos_con_desborde: malos });
}

// ═══ ≥900: al costado y IDÉNTICO a main 8754c1e ═══
for (const w of [900, 1024, 1280, 1440]) {
  const o = await reproducir(BASE, w, LARGO); const m = await medir(o.p); const h = HUELLA_GE900[w];
  ok(`ge900_identico_a_main_${w}`, !!m.corazon && !!m.mas && m.track.display === 'flex' && iguales(m.masA3, h.mas) && iguales(m.corA3, h.corazon) && m.titulo === h.titulo
    && Math.abs(m.corazon.y - m.mas.y) < 0.5 && Math.abs((m.corazon.x - m.mas.x) - 42) < 0.2 && m.favTipDisplay !== 'none',
  { display: m.track.display, mas: m.masA3, corazon: m.corA3, titulo: m.titulo, esperado: h });
  await o.ctx.close();
}
// ═══ ≤700 (mini barra): intacta ═══
for (const w of [390, 600, 700]) {
  const h = HUELLA_LE700[w];
  const o = await reproducir(BASE, w, LARGO, { tactil: !!h.tactil }); const m = await medir(o.p);
  ok(`le700_mini_barra_intacta_${w}`, m.track.display === 'flex' && iguales(m.mini, h.mini) && m.titulo === h.titulo && m.corazon === null && m.mas === null && m.favTipDisplay === 'none',
    { display: m.track.display, corazon_mini: m.mini, titulo: m.titulo, corazon_escritorio_visible: !!m.corazon, mas_visible: !!m.mas, fav_tip: m.favTipDisplay, esperado: h });
  await o.ctx.close();
}

// ═══ TÁCTIL: áreas de toque de la pila ═══
for (const w of [701, 768, 820, 834, 899]) {
  const o = await reproducir(BASE, w, LARGO, { tactil: true });
  const b = await barrido(o.p);
  const mas = b.mas, cor = b.corazon;
  ok(`tactil_areas_sin_solape_${w}`, !!mas && !!cor && mas.continuo && cor.continuo && mas.alto >= 38 && cor.alto >= 38 && b.ancho_mas >= 44 && b.ancho_corazon >= 44
    && mas.desde >= 0 && mas.desde + mas.alto <= cor.desde && cor.desde + cor.alto <= b.barra_alto,
  { barra_alto: b.barra_alto, mas: mas && `${b.ancho_mas}×${mas.alto} desde ${mas.desde}`, corazon: cor && `${b.ancho_corazon}×${cor.alto} desde ${cor.desde}` });
  await o.ctx.close();
}
// Un toque en la EXTENSIÓN de cada botón (fuera de su caja visible) activa el suyo, no el del vecino.
await seccion(['tactil_extensiones_activan_el_suyo_820'], async () => {
  const o = await reproducir(BASE, 820, CORTO, { tactil: true });
  const m = await medir(o.p);
  const antes = { pressed: m.corazon.pressed, menu: await o.p.locator('.player-bar .ptp-menu').count() };
  await o.p.touchscreen.tap(m.mas.x + 15, m.mas.y - 5); await sleep(500);                 // 5 px arriba del «+»: extensión del «+»
  const menuAbierto = (await o.p.locator('.player-bar .ptp-menu').count()) > 0;
  const pressedTrasMas = await o.p.locator('.player-bar .fav-player').getAttribute('aria-pressed');
  await o.p.keyboard.press('Escape'); await sleep(400);
  await o.p.touchscreen.tap(m.corazon.x + 15, m.corazon.b + 5); await sleep(900);         // 5 px debajo del corazón: extensión del corazón
  const pressedTrasCor = await o.p.locator('.player-bar .fav-player').getAttribute('aria-pressed');
  const menuTrasCor = await o.p.locator('.player-bar .ptp-menu').count();
  await o.p.touchscreen.tap(m.corazon.x + 15 + 20, m.corazon.y + 15); await sleep(900);   // 5 px a la derecha del corazón (caja: 30 → +7 de área)
  const pressedTrasLado = await o.p.locator('.player-bar .fav-player').getAttribute('aria-pressed');
  ok('tactil_extensiones_activan_el_suyo_820', antes.pressed === 'false' && menuAbierto && pressedTrasMas === 'false' && pressedTrasCor === 'true' && menuTrasCor === 0 && pressedTrasLado === 'false' && !(await expandidoAbierto(o.p)),
    { antes, menu_abierto_con_toque_sobre_el_mas: menuAbierto, corazon_tras_el_mas: pressedTrasMas, corazon_tras_toque_debajo: pressedTrasCor, menu_tras_toque_debajo: menuTrasCor, corazon_tras_toque_al_costado: pressedTrasLado });
  await o.ctx.close();
  await wipeFavs();
});
// Con dedo y con ratón las cajas VISIBLES son las mismas (el área de toque no se ve).
{
  const a = await reproducir(BASE, 768, LARGO, { tactil: true }), ma = await medir(a.p); await a.ctx.close();
  const b = await reproducir(BASE, 768, LARGO), mb = await medir(b.p); await b.ctx.close();
  ok('cajas_visibles_iguales_con_dedo_y_con_raton_768', iguales(ma.masA3, mb.masA3, 0.1) && iguales(ma.corA3, mb.corA3, 0.1) && ma.titulo === mb.titulo, { dedo: [ma.masA3, ma.corA3, ma.titulo], raton: [mb.masA3, mb.corA3, mb.titulo] });
}

// ═══ Clic en el corazón a 800 px: alterna, servidor consistente, no abre el expandido ═══
await seccion(['clic_corazon_800_aria_pressed_y_servidor', 'clic_corazon_800_no_abre_expandido'], async () => {
  const o = await reproducir(BASE, 800, CORTO);
  const heart = o.p.locator('.player-bar .fav-player');
  const antes = { pressed: await heart.getAttribute('aria-pressed'), exp: await expandidoAbierto(o.p) };
  await heart.click(); await sleep(1200);
  const on = { pressed: await heart.getAttribute('aria-pressed'), clase: (await heart.getAttribute('class')).includes('fav-on'), servidor: (await favTrackIds()).includes(CORTO.id), exp: await expandidoAbierto(o.p) };
  await heart.click(); await sleep(1200);
  const off = { pressed: await heart.getAttribute('aria-pressed'), clase: (await heart.getAttribute('class')).includes('fav-on'), servidor: (await favTrackIds()).includes(CORTO.id), exp: await expandidoAbierto(o.p) };
  ok('clic_corazon_800_aria_pressed_y_servidor', antes.pressed === 'false' && on.pressed === 'true' && on.clase && on.servidor && off.pressed === 'false' && !off.clase && !off.servidor, { antes, on, off });
  ok('clic_corazon_800_no_abre_expandido', !antes.exp && !on.exp && !off.exp);
  await o.ctx.close();
});

// ═══ Tooltips (BarTip) a 800 px ═══
await seccion(['tooltip_mas_sigue_arriba_800', 'tooltip_corazon_a_la_derecha_800', 'tooltip_corazon_con_teclado_800', 'tooltip_corazon_sin_movimiento_con_reduced_motion_800'], async () => {
  const o = await reproducir(BASE, 800, CORTO); const p = o.p;
  const tip = (sel) => p.evaluate((sel) => { const t = document.querySelector(sel); const r = t.getBoundingClientRect(); const cs = getComputedStyle(t); return { op: +cs.opacity, vis: cs.visibility, x: r.left, y: r.top, r: r.right, b: r.bottom, texto: t.textContent.trim() }; }, sel);
  const m = await medir(p);
  const SEL_MAS = '.player-bar .player-track > .bar-tip-wrap:not(.fav-tip) > .bar-tip', SEL_COR = '.player-bar .fav-tip > .bar-tip';
  await p.mouse.move(m.mas.x + 15, m.mas.y + 15); await sleep(500);
  const tm = await tip(SEL_MAS);
  ok('tooltip_mas_sigue_arriba_800', tm.op === 1 && tm.vis === 'visible' && tm.b <= m.mas.y && tm.x >= 0 && /playlist/.test(tm.texto), { tip: tm, mas_y: m.mas.y });
  await p.mouse.move(m.corazon.x + 15, m.corazon.y + 15); await sleep(500);
  const tc = await tip(SEL_COR); const cy = m.corazon.y + 15;
  ok('tooltip_corazon_a_la_derecha_800', tc.op === 1 && tc.vis === 'visible' && tc.x >= m.corazon.r + 4 && tc.y <= cy && tc.b >= cy && Math.abs((tc.y + tc.b) / 2 - cy) <= 2
    && !(tc.x < m.mas.r && tc.r > m.mas.x && tc.y < m.mas.b && tc.b > m.mas.y) && tc.r <= m.innerW && /favoritos/.test(tc.texto), { tip: tc, corazon: [m.corazon.x, m.corazon.y, m.corazon.r], mas: [m.mas.x, m.mas.y, m.mas.r, m.mas.b] });
  await p.mouse.move(600, 300); await sleep(400);
  await p.locator('.player-bar .ptp-btn').focus(); await p.keyboard.press('Tab'); await sleep(500);
  const enfocado = await p.evaluate(() => document.activeElement?.classList.contains('fav-player'));
  const tk = await tip(SEL_COR);
  ok('tooltip_corazon_con_teclado_800', enfocado && tk.op === 1 && tk.vis === 'visible' && tk.x >= m.corazon.r + 4, { enfocado, tip: tk });
  await p.mouse.move(600, 300); await p.keyboard.press('Shift+Tab'); await p.evaluate(() => document.activeElement?.blur()); await sleep(300);
  await p.emulateMedia({ reducedMotion: 'reduce' }); await sleep(200);
  const mtx = await p.evaluate(() => getComputedStyle(document.querySelector('.player-bar .fav-tip > .bar-tip')).transform);
  const v = (mtx.match(/matrix\(([^)]+)\)/) ?? [])[1]?.split(',').map(Number);
  ok('tooltip_corazon_sin_movimiento_con_reduced_motion_800', !!v && v[0] === 1 && v[3] === 1 && v[4] === 0, { transform: mtx });
  await o.ctx.close();
});

// ═══ Con VIDEO sonando a 800: ni corazón ni «+», y la columna de acciones vacía no gasta ancho ═══
{
  const o = await abrir(BASE, '/', { w: 800, h: 900, esperar: '.library-tracks .track-row' }); const p = o.p;
  if (!VIDEO) {
    ok('video_800_sin_corazon_ni_mas', false, { motivo: 'no hay el video fixture «Largo Para Seek» (¿falta ffmpeg? regresion.mjs lo arma)' });
    ok('video_800_el_titulo_ocupa_el_ancho', false, { motivo: 'sin video fixture' });
  } else {
    await p.evaluate((q) => window.__player().play(q, 0), [{ ...VIDEO, kind: 'video' }]);
    await p.waitForFunction(() => { const v = document.querySelector('video.player-video'); return v && !v.paused && v.currentTime > 0; }, null, { timeout: 8000 }).catch(() => {});
    await sleep(600);
    const m = await medir(p);
    ok('video_800_sin_corazon_ni_mas', !m.masExiste && !m.corazonExiste && !m.mas && !m.corazon && m.track.display === 'grid', { mas_existe: m.masExiste, corazon_existe: m.corazonExiste, display: m.track.display });
    ok('video_800_el_titulo_ocupa_el_ancho', !!m.art && m.art.x === m.track.x && Math.abs(m.meta.x - (m.art.r + 12)) <= 0.5 && Math.abs(m.meta.r - m.track.r) <= 0.5, { track: [m.track.x, m.track.r], art: [m.art?.x, m.art?.r], meta: [m.meta.x, m.meta.r] });
  }
  await o.ctx.close();
}

// ═══ Soltar un arrastre sobre la barra sigue encolando (a 800 px, con la cola cerrada) ═══
await seccion(['soltar_en_la_barra_encola_800', 'soltar_sobre_el_corazon_encola_y_no_lo_alterna_800'], async () => {
  const o = await reproducir(BASE, 800, CORTO); const p = o.p;
  const largoCola = () => p.evaluate(() => window.__player().queue.length);
  const filas = p.locator('.library-tracks .track-row');
  await p.locator('.search-box input').first().fill(''); await sleep(700);
  const q0 = await largoCola();
  await filas.nth(21).dragTo(p.locator('.player-bar'), { timeout: 6000 }).catch(() => {}); await sleep(900);
  const q1 = await largoCola();
  ok('soltar_en_la_barra_encola_800', q1 === q0 + 1, { cola: `${q0}→${q1}` });
  const pressed0 = await p.locator('.player-bar .fav-player').getAttribute('aria-pressed');
  await filas.nth(23).dragTo(p.locator('.player-bar .fav-player'), { timeout: 6000 }).catch(() => {}); await sleep(1200);
  const q2 = await largoCola();
  const pressed1 = await p.locator('.player-bar .fav-player').getAttribute('aria-pressed');
  ok('soltar_sobre_el_corazon_encola_y_no_lo_alterna_800', q2 === q1 + 1 && pressed0 === 'false' && pressed1 === 'false' && !(await expandidoAbierto(p)), { cola: `${q1}→${q2}`, corazon: [pressed0, pressed1] });
  await o.ctx.close();
});
await wipeFavs();

// ═══ Contra la referencia (main 8754c1e): la caja de CADA elemento de la barra ═══
// Se compara por ruta de clases. Se ignoran los descendientes de <svg> (la letra late: ≤0,1 px de ruido) y los tooltips.
const cajasTodas = (p) => p.evaluate(() => {
  const bar = document.querySelector('.player-bar');
  const vis = (e) => { for (let a = e; a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.display === 'none' || cs.visibility === 'hidden') return false; } const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const ruta = (e) => { const out = []; for (let a = e; a && a !== bar; a = a.parentElement) out.unshift(a.tagName.toLowerCase() + (typeof a.className === 'string' && a.className ? '.' + a.className.split(' ').filter((c) => !['active', 'fav-on', 'playing'].includes(c)).slice(0, 2).join('.') : '')); return out.join(' > '); };
  const cajas = {};
  for (const e of bar.querySelectorAll('*')) {
    if (e.closest('.bar-tip') || e.closest('svg') || !vis(e)) continue;
    const b = e.getBoundingClientRect(); let k = ruta(e); let n = 2; const k0 = k; while (cajas[k]) k = k0 + '#' + n++;
    cajas[k] = [b.left, b.top, b.width, b.height].map((x) => Math.round(x * 10) / 10);
  }
  const bb = bar.getBoundingClientRect();
  return { cajas, barra: [bb.left, bb.top, bb.width, bb.height].map((x) => Math.round(x * 10) / 10) };
});
if (REF) {
  const dif = (a, b, fuera) => {
    const d = [];
    for (const k of new Set([...Object.keys(a.cajas), ...Object.keys(b.cajas)])) {
      if (fuera?.(k)) continue;
      const x = a.cajas[k], y = b.cajas[k];
      if (!x || !y || !iguales(x, y, 0.2)) d.push(k);
    }
    if (!iguales(a.barra, b.barra, 0.2)) d.push('(barra)');
    return d;
  };
  for (const [w, t] of [[390, true], [600, false], [700, false], [900, false], [1024, false], [1280, false], [1440, false]]) {
    const n = await reproducir(BASE, w, LARGO, { tactil: t }); const cn = await cajasTodas(n.p); await n.ctx.close();
    const r = await reproducir(REF, w, LARGO, { tactil: t }); const cr = await cajasTodas(r.p); await r.ctx.close();
    const d = dif(cr, cn);
    ok(`ref_identico_${w}`, d.length === 0 && Object.keys(cr.cajas).length >= 10, { elementos: Object.keys(cr.cajas).length, difieren: d.slice(0, 8) });
  }
  for (const w of [701, 768, 834, 899]) {
    const n = await reproducir(BASE, w, LARGO); const cn = await cajasTodas(n.p); await n.ctx.close();
    const r = await reproducir(REF, w, LARGO); const cr = await cajasTodas(r.p); await r.ctx.close();
    // Lo único que se mueve es la columna izquierda (.player-track y lo de adentro): centro y derecha idénticos.
    const d = dif(cr, cn, (k) => k.startsWith('div.player-track'));
    const enColumna = Object.keys(cn.cajas).filter((k) => k.startsWith('div.player-track')).length;
    ok(`ref_fuera_de_la_columna_izquierda_identico_${w}`, d.length === 0 && Object.keys(cr.cajas).length - enColumna >= 20, { elementos_fuera_de_la_columna: Object.keys(cr.cajas).length - enColumna, difieren: d.slice(0, 8) });
  }
}

await wipeFavs();
const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
console.log('medidas: ' + JSON.stringify(medidas));
console.log(`casos: corto «${CORTO.title}» (id ${CORTO.id}) · largo «${LARGO.title.slice(0, 40)}…» (id ${LARGO.id}) · video ${VIDEO ? VIDEO.title : 'NO HAY'}`);
console.log(REF ? `referencia (debe ser el build de main 8754c1e, v1.40.0): ${REF}` : 'SIN SNAP_REF: las comprobaciones contra la referencia 8754c1e (ref_*) NO se corrieron ni se cuentan.');
console.log(`\nfav-bar-apilado-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
