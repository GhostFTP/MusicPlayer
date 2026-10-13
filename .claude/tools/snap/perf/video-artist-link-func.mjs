// video-artist-link-func.mjs — funcional de VIDEO → ARTISTA (1.32.0): el artista de un video enlaza
// a su página cuando es un artista de la biblioteca.
//
// El artista de un video es el nombre de su CARPETA. Si coincide con un artista de la biblioteca
// (utils/artistMatch.js: sin mayúsculas ni acentos, y nada más), su nombre en la tarjeta de Videos
// es un enlace, el menú del video suma «Ir al artista» y en el expandido el artista también enlaza.
// Sin coincidencia todo queda como antes.
//
// Necesita videos en carpetas con nombre de artista REAL: suma a la carpeta de fixtures de la corrida
// cuatro videos cortos (crearExtras de video-fixtures.mjs, con ffmpeg) y los BORRA al terminar,
// también si se corta (ver `limpiar`), esperando a que el backend vuelva a ver los tres de siempre:
//   · <Artista A>            exactamente como está en la biblioteca            → enlace
//   · <ARTISTA B con tilde>  otro artista, en mayúsculas y con un acento de más → enlace (al nombre de la biblioteca)
//   · <Artista A> feat. X    una colaboración                                 → sin enlace
//   · Artista Inexistente    nadie                                            → sin enlace
// A y B salen de GET /api/browse/artists (no están escritos a mano). Son dos artistas distintos
// porque en Windows «Daft Punk» y «daft punk» son la misma carpeta.
// Por eso pide VIDEO_DIR (la carpeta que se le pasó al backend; regresion.mjs la pasa sola) y se
// NIEGA a escribir si esa carpeta no es la de los fixtures: nunca toca una carpeta de videos de verdad.
//
// Comprueba, a 1440: la lista de artistas se pide UNA vez (no por tarjeta); qué tarjetas tienen enlace
// y cuáles no; la tarjeta con enlace mide lo mismo que la que no; el menú con y sin «Ir al artista»;
// el clic en el enlace navega a la página correcta y NO reproduce; lo mismo con el teclado y desde el
// menú; el clic en el resto de la tarjeta sigue reproduciendo; y en el expandido, enlace o texto con
// la misma regla.
// A 390 y 360 con touch: el enlace mide 32 px de alto o más (el texto solo mide menos: va en
// `medidas`), el toque en el título de la tarjeta no cae en el enlace, tocar el enlace navega y no
// reproduce, tocar la portada reproduce, y la pulsación larga trae el tile «Artista» sólo donde toca.
// En la tablet (1280 con touch, 1.32.1): el enlace mide 44 px de alto o más y tocarlo navega.
// Con SNAP_REF (un build SIN el enlace, p. ej. el de v1.31.1 en otro puerto): control negativo. Sin
// SNAP_REF ese control NO se corre ni se cuenta, y se avisa.
// Contra un build sin el enlace las comprobaciones fallan una por una (no se corta con un timeout).
// No escribe en la base. Escribe y borra videos sintéticos en VIDEO_DIR (sólo si es de fixtures).
// Uso: VIDEO_DIR=<fixtures del backend> SNAP_BASE=http://localhost:4173 [SNAP_REF=http://localhost:4174] node video-artist-link-func.mjs
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { FIXTURES, EXTRAS, crearExtras, borrarExtras, SinFfmpeg } from './video-fixtures.mjs';

const REF = process.env.SNAP_REF ?? null;
const NOMBRE = 'video-artist-link-func';
const noCorrio = (msg) => { console.error(`[${NOMBRE}] NO CORRIÓ: ${msg}`); process.exit(2); };
const PREFIJO = 'Enlace ';   // todos los archivos de este script empiezan así: es su firma

// La carpeta tiene que ser la de los fixtures. Lo que haya quedado de una corrida cortada de ESTE
// script (carpetas cuyos archivos empiezan todos con «Enlace ») se borra al arrancar.
const DIR = process.env.VIDEO_DIR ? resolve(process.env.VIDEO_DIR) : null;
if (!DIR || !existsSync(DIR)) noCorrio('falta VIDEO_DIR (la carpeta de fixtures que usa el backend de la prueba)');
const ARTISTAS_FIX = new Set(FIXTURES.map((f) => f.artista)), ARTISTAS_MIX = new Set(EXTRAS.map((f) => f.artista));
const esMia = (n) => { try { const fs = readdirSync(join(DIR, n)); return fs.length > 0 && fs.every((f) => f.startsWith(PREFIJO)); } catch { return false; } };
let sobras = 0;
for (const n of readdirSync(DIR)) if (!ARTISTAS_FIX.has(n) && !ARTISTAS_MIX.has(n) && esMia(n)) { rmSync(join(DIR, n), { recursive: true, force: true }); sobras++; }
const enDisco = readdirSync(DIR);
if (!enDisco.length || enDisco.some((n) => !ARTISTAS_FIX.has(n) && !ARTISTAS_MIX.has(n))) noCorrio(`VIDEO_DIR no es una carpeta de fixtures (${enDisco.slice(0, 4).join(', ')}…): no escribo ahí`);

await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const H = { Authorization: `Bearer ${token}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const videosApi = async () => (await (await fetch(BASE + '/api/videos', { headers: H })).json()).videos ?? [];
async function esperarIndice(n) {
  for (let i = 0; i < 80; i++) { const v = await videosApi(); if (v.length === n) return v; await sleep(250); }
  return null;
}

// ── Los artistas, de la biblioteca real ──
const fold = (s) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const ARTISTAS = (await (await fetch(BASE + '/api/browse/artists', { headers: H })).json()).map((a) => a.artist);
const aptos = ARTISTAS.filter((a) => /^[A-Za-z]+( [A-Za-z]+)*$/.test(a) && a.length >= 4 && a !== 'Various Artists');
if (aptos.length < 2) noCorrio(`la biblioteca no tiene dos artistas con nombre simple (hay ${aptos.length}) para nombrar las carpetas`);
const A = aptos[0], B = aptos[1];
const ACENTOS = { A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú' };
const VARIANTE = B.toUpperCase().replace(/[AEIOU]/, (v) => ACENTOS[v]);   // «GÓRILLAZ»: otro caso y un acento de más
const FEAT = `${A} feat. X`, NADIE = 'Artista Inexistente';
if (VARIANTE === B || fold(VARIANTE) !== fold(B) || [FEAT, NADIE].some((n) => ARTISTAS.some((a) => fold(a) === fold(n)))) noCorrio('no pude armar los cuatro nombres de carpeta');
const MIOS = [
  { artista: A, archivo: `${PREFIJO}Exacto (2020).mp4`, segundos: 2.5, faststart: true, portada: true },
  { artista: VARIANTE, archivo: `${PREFIJO}Variante (2019).mp4`, segundos: 2.5, faststart: true, portada: false },
  { artista: FEAT, archivo: `${PREFIJO}Feat (2018).mp4`, segundos: 2.5, faststart: true, portada: false },
  { artista: NADIE, archivo: `${PREFIJO}Nadie (2017).mp4`, segundos: 2.5, faststart: true, portada: true },
];
const T = { exacto: `${PREFIJO}Exacto`, variante: `${PREFIJO}Variante`, feat: `${PREFIJO}Feat`, nadie: `${PREFIJO}Nadie` };

// LOS EXTRAS SE BORRAN SIEMPRE: en el finally, con Ctrl+C / SIGTERM, ante una excepción sin atrapar
// y, como último recurso, al salir el proceso. Un kill forzado no se puede atrapar: para eso el
// script borra sus sobras al ARRANCAR (arriba).
let puestos = false;
async function limpiar() {
  if (!puestos) return null;
  borrarExtras(DIR, MIOS); puestos = false;
  return esperarIndice(FIXTURES.length).catch(() => null);
}
process.on('exit', () => { if (puestos) { try { borrarExtras(DIR, MIOS); } catch { /* nada más que hacer */ } } });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => { limpiar().finally(() => process.exit(130)); });
process.on('uncaughtException', (e) => { console.error(`[${NOMBRE}] excepción no atrapada: ${e?.message}`); limpiar().finally(() => process.exit(1)); });
process.on('unhandledRejection', (e) => { console.error(`[${NOMBRE}] promesa rechazada sin atrapar: ${e?.message}`); limpiar().finally(() => process.exit(1)); });

const R = {};
const ok = (k, v, extra = {}) => { R[k] = { ok: !!v, ...extra }; };
const medidas = { artistas: { exacto: A, variante: [VARIANTE, '→', B], colaboracion: FEAT, nadie: NADIE }, sobras_borradas_al_arrancar: sobras };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ETIQUETAS = '.ctx-menu .ctx-item span:first-of-type, .ctx-menu .ctx-tile-label';
const MENU_BASE = ['Reproducir a continuación', 'Agregar a la cola', 'Agregar a playlist'];
const rutaArtista = (a) => `/artists/${encodeURIComponent(a)}`;

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
async function abrir(base, w, h, mobile) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript((t) => {
    localStorage.setItem('token', t);
    window.__player = () => {
      const root = document.getElementById('root');
      const key = Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
      const stack = [root[key]?.stateNode?.current ?? root[key]];
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
  const pedidos = { artistas: 0 };
  ctx.on('request', (r) => { if (new URL(r.url()).pathname === '/api/browse/artists') pedidos.artistas++; });
  const p = await ctx.newPage();
  const errores = []; p.on('pageerror', (e) => errores.push(String(e.message).slice(0, 120)));
  const videos = async () => { await p.goto(base + '/videos'); await p.waitForSelector('.video-card'); await p.waitForTimeout(700); };
  await videos();
  return { ctx, p, errores, pedidos, videos };
}
const card = (p, titulo) => p.locator('.video-card', { hasText: titulo }).first();
const enlace = (p, titulo) => card(p, titulo).locator('.video-artist-link');
const suena = (p) => p.evaluate(() => { const v = window.__player(); return { actual: v.currentTrack?.title ?? null, kind: v.currentTrack?.kind ?? null, en_cola: v.queue.length }; });
// Los videos de prueba duran 2,5 s: se pausan apenas arrancan, para que no pasen al siguiente de la
// cola mientras se mira el expandido.
const pausar = async (p) => {
  await p.waitForFunction(() => window.__player().isPlaying, null, { timeout: 3000 }).catch(() => {});
  await p.evaluate(() => { const v = window.__player(); if (v.isPlaying) v.togglePlay(); });
};
const ruta = (p) => p.evaluate(() => decodeURI(location.pathname));
const heroe = (p) => p.locator('.artist-hero-name').first().textContent({ timeout: 4000 }).then((s) => s.trim()).catch(() => null);
const cerrar = async (p) => { if (await p.locator('.ctx-menu').count()) { await p.keyboard.press('Escape'); await sleep(250); } };
async function menu(p, titulo, largo = false) {
  await card(p, titulo).scrollIntoViewIfNeeded().catch(() => {});
  if (largo) {
    const b = await card(p, titulo).locator('.video-cover-frame').boundingBox();
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await p.mouse.down(); await sleep(650); await p.mouse.up();
  } else await card(p, titulo).locator('.video-cover-frame').click({ button: 'right', timeout: 3000 }).catch(() => {});
  await p.waitForSelector('.ctx-menu', { timeout: 1500 }).catch(() => {});
  await sleep(250);
  return p.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.trim()), ETIQUETAS);
}
// Pulsa (clic o toque) el enlace si existe; devuelve false si no hay enlace.
async function pulsarEnlace(p, titulo, mobile) {
  const e = enlace(p, titulo);
  if (!(await e.count())) return false;
  await e.scrollIntoViewIfNeeded().catch(() => {});
  if (mobile) await e.tap(); else await e.click();
  await sleep(700);
  return true;
}

try {
  try { crearExtras(DIR, MIOS); puestos = true; }
  catch (e) { if (e instanceof SinFfmpeg) noCorrio(e.message); throw e; }
  const indice = await esperarIndice(FIXTURES.length + MIOS.length);
  if (!indice) throw new Error('el backend no llegó a ver los videos nuevos');

  // ── Escritorio 1440 ──
  {
    const { ctx, p, errores, pedidos, videos } = await abrir(BASE, 1440, 900, false);
    const tarjetas = await p.locator('.video-card').count();
    ok('lista_de_artistas_un_pedido', tarjetas === FIXTURES.length + MIOS.length && pedidos.artistas === 1, { tarjetas, pedidos_de_artistas: pedidos.artistas });

    const info = (titulo) => card(p, titulo).evaluate((c) => {
      const cont = c.querySelector('.album-artist'), b = c.querySelector('.video-artist-link');
      const r = (e) => { const x = e.getBoundingClientRect(); return { x: Math.round(x.left * 10) / 10, w: Math.round(x.width * 10) / 10, h: Math.round(x.height * 10) / 10 }; };
      const cs = getComputedStyle(b ?? cont);
      return { texto: cont.textContent.trim(), enlace: !!b, title: b?.getAttribute('title') ?? null, tag: b?.tagName ?? null, cont: r(cont), tarjeta: r(c), fuente: cs.fontSize, color: cs.color, lh: cs.lineHeight };
    }).catch(() => null);
    const iE = await info(T.exacto), iV = await info(T.variante), iF = await info(T.feat), iN = await info(T.nadie);
    const fix = await p.evaluate((ts) => [...document.querySelectorAll('.video-card')].filter((c) => !ts.some((t) => c.textContent.includes(t))).map((c) => !!c.querySelector('.video-artist-link')), Object.values(T));
    ok('enlace_con_nombre_exacto', iE?.enlace && iE.texto === A && iE.title === 'Ir al artista' && iE.tag === 'BUTTON', iE ?? {});
    ok('enlace_con_otro_caso_y_acentos', iV?.enlace && iV.texto === VARIANTE, iV ?? {});
    ok('sin_enlace_colaboracion_ni_inexistente', iF && iN && !iF.enlace && !iN.enlace && iF.texto === FEAT && iN.texto === NADIE && fix.length === FIXTURES.length && fix.every((x) => !x), { feat: iF, nadie: iN, fixtures_con_enlace: fix });
    ok('tarjeta_con_enlace_mide_lo_mismo', iE && iN && iE.cont.h === iN.cont.h && iE.tarjeta.h === iN.tarjeta.h && iE.cont.x - iE.tarjeta.x === iN.cont.x - iN.tarjeta.x && iE.fuente === iN.fuente && iE.color === iN.color,
      { con_enlace: iE && { linea_h: iE.cont.h, tarjeta_h: iE.tarjeta.h, fuente: iE.fuente, color: iE.color }, sin_enlace: iN && { linea_h: iN.cont.h, tarjeta_h: iN.tarjeta.h, fuente: iN.fuente, color: iN.color } });

    const mE = await menu(p, T.exacto); await cerrar(p);
    const mV = await menu(p, T.variante); await cerrar(p);
    ok('menu_con_ir_al_artista', same(mE, [...MENU_BASE, 'Ir al artista']) && same(mV, [...MENU_BASE, 'Ir al artista']), { exacto: mE, variante: mV });
    const mF = await menu(p, T.feat); await cerrar(p);
    const mN = await menu(p, T.nadie); await cerrar(p);
    ok('menu_sin_ir_al_artista', same(mF, MENU_BASE) && same(mN, MENU_BASE), { colaboracion: mF, nadie: mN });

    const h1 = await pulsarEnlace(p, T.exacto, false); const s1 = await suena(p);
    ok('clic_en_el_enlace_navega_y_no_reproduce', h1 && (await ruta(p)) === decodeURI(rutaArtista(A)) && (await heroe(p)) === A && s1.actual === null && s1.en_cola === 0, { habia_enlace: h1, ruta: await ruta(p), pagina: await heroe(p), suena: s1 });
    await videos();
    const h2 = await pulsarEnlace(p, T.variante, false); const s2 = await suena(p);
    ok('otro_caso_navega_al_nombre_de_la_biblioteca', h2 && (await ruta(p)) === decodeURI(rutaArtista(B)) && (await heroe(p)) === B && s2.actual === null, { habia_enlace: h2, carpeta: VARIANTE, ruta: await ruta(p), pagina: await heroe(p) });
    await videos();
    const mV2 = await menu(p, T.variante);
    if (mV2.includes('Ir al artista')) { await p.locator('.ctx-menu .ctx-item', { hasText: 'Ir al artista' }).first().click(); await sleep(700); } else await cerrar(p);
    const s3 = await suena(p);
    ok('ir_al_artista_del_menu_navega', mV2.includes('Ir al artista') && (await heroe(p)) === B && (await ruta(p)) === decodeURI(rutaArtista(B)) && s3.actual === null && !(await p.locator('.ctx-menu').count()), { ruta: await ruta(p), pagina: await heroe(p), suena: s3 });
    await videos();
    const hayE = (await enlace(p, T.exacto).count()) > 0;
    if (hayE) { await enlace(p, T.exacto).focus(); await p.keyboard.press('Enter'); await sleep(700); }
    const s4 = await suena(p);
    ok('teclado_enter_en_el_enlace', hayE && (await heroe(p)) === A && s4.actual === null, { ruta: await ruta(p), pagina: await heroe(p), suena: s4 });

    // El resto de la tarjeta sigue reproduciendo; y el expandido.
    await videos();
    await card(p, T.exacto).locator('.video-cover-frame').click(); await p.waitForFunction(() => window.__player().currentTrack?.kind === 'video', null, { timeout: 5000 }).catch(() => {}); await sleep(500);
    const s5 = await suena(p); await pausar(p);
    ok('clic_en_la_tarjeta_sigue_reproduciendo', s5.actual === T.exacto && s5.kind === 'video' && (await ruta(p)) === '/videos', { suena: s5, ruta: await ruta(p) });
    const abrirExp = async () => { if (!(await p.locator('.player-expanded').count())) { await p.locator('.player-bar .player-art, .player-bar .player-art-placeholder').first().click({ timeout: 3000 }).catch(() => {}); await sleep(900); } };
    await abrirExp();
    const exp1 = await p.evaluate(() => { const e = document.querySelector('.player-expanded .exp-artist'); return e ? { texto: e.textContent.trim(), enlace: e.classList.contains('exp-link'), title: e.getAttribute('title') } : null; });
    if (exp1?.enlace) { await p.locator('.player-expanded .exp-artist.exp-link').click(); await sleep(900); }
    const trasExp = { ruta: await ruta(p), pagina: await heroe(p), expandido: await p.locator('.player-expanded').count(), suena: await suena(p) };
    ok('expandido_con_enlace_navega', exp1?.enlace && exp1.texto === A && exp1.title === 'Ir al artista' && trasExp.ruta === decodeURI(rutaArtista(A)) && trasExp.pagina === A && trasExp.expandido === 0 && trasExp.suena.actual === T.exacto, { artista_en_el_expandido: exp1, despues: trasExp });
    const sinEnlace = {};
    for (const k of ['feat', 'nadie']) {
      await videos();
      await card(p, T[k]).locator('.video-cover-frame').click(); await p.waitForFunction((t) => window.__player().currentTrack?.title === t, T[k], { timeout: 5000 }).catch(() => {}); await pausar(p); await sleep(500);
      await abrirExp();
      sinEnlace[k] = await p.evaluate(() => { const e = document.querySelector('.player-expanded .exp-artist'); return e ? { texto: e.textContent.trim(), enlace: e.classList.contains('exp-link') } : null; });
      await p.keyboard.press('Escape'); await sleep(500);
    }
    ok('expandido_sin_enlace', sinEnlace.feat && sinEnlace.nadie && !sinEnlace.feat.enlace && !sinEnlace.nadie.enlace && sinEnlace.feat.texto === FEAT && sinEnlace.nadie.texto === NADIE && !errores.length, { ...sinEnlace, errores });
    await ctx.close();
  }

  // ── Teléfono: 390 y 360 ──
  medidas.enlace_tactil = {};
  for (const w of [390, 360]) {
    const { ctx, p, errores, videos } = await abrir(BASE, w, 780, true);
    await card(p, T.exacto).scrollIntoViewIfNeeded().catch(() => {}); await sleep(300);
    const g = await card(p, T.exacto).evaluate((c) => {
      const b = c.querySelector('.video-artist-link'); if (!b) return null;
      const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
      const centro = (sel) => { const e = c.querySelector(sel); if (!e) return null; const x = e.getBoundingClientRect(); const el = document.elementFromPoint(x.left + Math.min(x.width, 40) / 2, x.top + x.height / 2); return { cae_en_el_enlace: !!el?.closest('.video-artist-link'), alto: Math.round(x.height * 10) / 10 }; };
      const pt = parseFloat(cs.paddingTop), pb = parseFloat(cs.paddingBottom);
      const enCentro = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const arriba = document.elementFromPoint(r.left + r.width / 2, r.top + 2), abajo = document.elementFromPoint(r.left + r.width / 2, r.bottom - 2);
      return { alto_tactil: Math.round(r.height * 10) / 10, alto_del_texto: Math.round((r.height - pt - pb) * 10) / 10, ancho: Math.round(r.width * 10) / 10, relleno: [pt, pb],
        toque_centro: !!enCentro?.closest('.video-artist-link'), toque_borde_arriba: !!arriba?.closest('.video-artist-link'), toque_borde_abajo: !!abajo?.closest('.video-artist-link'),
        titulo: centro('.album-name'), meta: centro('.album-count'), pagina_desborda: document.documentElement.scrollWidth - window.innerWidth };
    }).catch(() => null);
    medidas.enlace_tactil[w] = g;
    ok(`enlace_tactil_${w}`, g && g.alto_tactil >= 32 && g.toque_centro && g.toque_borde_arriba && g.toque_borde_abajo && g.titulo && !g.titulo.cae_en_el_enlace && g.pagina_desborda <= 0, g ?? { motivo: 'no hay enlace' });

    const h = await pulsarEnlace(p, T.exacto, true); const s = await suena(p);
    ok(`toque_en_el_enlace_navega_${w}`, h && (await heroe(p)) === A && (await ruta(p)) === decodeURI(rutaArtista(A)) && s.actual === null && s.en_cola === 0, { habia_enlace: h, ruta: await ruta(p), pagina: await heroe(p), suena: s });
    await videos();
    if (w === 390) {
      const tE = await menu(p, T.exacto, true); await cerrar(p);
      const tN = await menu(p, T.nadie, true); await cerrar(p);
      ok('pulsacion_larga_tile_artista_390', tE.includes('Artista') && !tN.includes('Artista') && tN.length === tE.length - 1 && (await suena(p)).actual === null, { con_coincidencia: tE, sin_coincidencia: tN });
    }
    await card(p, T.exacto).locator('.video-cover-frame').tap(); await p.waitForFunction(() => window.__player().currentTrack?.kind === 'video', null, { timeout: 5000 }).catch(() => {}); await sleep(400);
    const s2 = await suena(p); await pausar(p);
    ok(`toque_en_la_portada_reproduce_${w}`, s2.actual === T.exacto && !errores.length, { suena: s2, errores });
    await ctx.close();
  }

  // ── Tablet (dedo + layout de escritorio): 44 px ──
  {
    const { ctx, p, videos } = await abrir(BASE, 1280, 800, true);
    await card(p, T.exacto).scrollIntoViewIfNeeded().catch(() => {}); await sleep(300);
    const g = await card(p, T.exacto).evaluate((c) => {
      const b = c.querySelector('.video-artist-link'); if (!b) return null;
      const r = b.getBoundingClientRect(); const en = (x, y) => !!document.elementFromPoint(x, y)?.closest('.video-artist-link');
      const t = c.querySelector('.album-name')?.getBoundingClientRect(); const cx = r.left + r.width / 2;
      let arriba = 0, abajo = 0; const cy = r.top + r.height / 2; while (arriba < 40 && en(cx, cy - arriba - 1)) arriba++; while (abajo < 40 && en(cx, cy + abajo + 1)) abajo++;
      return { caja_alto: Math.round(r.height * 10) / 10, alto_de_toque: arriba + abajo + 1, el_titulo_no_cae_en_el_enlace: t ? !en(t.left + Math.min(t.width, 40) / 2, t.top + t.height / 2) : null };
    }).catch(() => null);
    medidas.enlace_tactil[1280] = g;
    const h = await pulsarEnlace(p, T.exacto, true); const s = await suena(p);
    ok('enlace_tactil_tablet_1280', g && g.alto_de_toque >= 44 && g.el_titulo_no_cae_en_el_enlace && h && (await heroe(p)) === A && s.actual === null, { ...(g ?? { motivo: 'no hay enlace' }), navega_a: await heroe(p), suena: s.actual });
    await ctx.close();
  }

  // ── Contra la referencia: ahí no hay enlace ni «Ir al artista» ──
  if (REF) {
    const r = await abrir(REF, 1440, 900, false);
    const n = await r.p.locator('.video-artist-link').count(); const mr = await menu(r.p, T.exacto); await cerrar(r.p);
    ok('control_ref_sin_enlace_ni_ir_al_artista', n === 0 && same(mr, MENU_BASE) && (await card(r.p, T.exacto).locator('.album-artist').textContent()) === A, { enlaces_en_ref: n, menu_en_ref: mr });
    await r.ctx.close();
  }
} catch (e) {
  ok('sin_excepciones', false, { error: String(e.message).split('\n')[0].slice(0, 200) });
} finally {
  const tras = await limpiar();
  ok('extras_borrados', tras !== null && tras.length === FIXTURES.length && !MIOS.some((f) => existsSync(join(DIR, f.artista))), { videos_en_el_backend: tras?.length ?? null, carpetas_que_quedan: MIOS.filter((f) => existsSync(join(DIR, f.artista))).map((f) => f.artista) });
  await browser.close().catch(() => {});
}

const fails = Object.entries(R).filter(([, v]) => !v.ok);
console.log(JSON.stringify(R, null, 1));
console.log('medidas: ' + JSON.stringify(medidas));
console.log(REF ? `referencia (un build sin el enlace video → artista): ${REF}` : 'SIN SNAP_REF: el control contra la referencia (control_ref_sin_enlace_ni_ir_al_artista) NO se corrió ni se cuenta.');
console.log(`\n${NOMBRE}: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
process.exit(fails.length ? 1 : 0);
