// video-artista-func.mjs — funcional de VIDEOS EN LA PÁGINA DEL ARTISTA (1.36.0).
//
// La página de un artista suma una sección «Videos» cuando hay videos cuyo artista (el nombre de su
// carpeta en VIDEO_DIR) es ese artista según matchArtist (utils/artistMatch.js). La lista de videos
// sale de useVideoList (utils/videoList.js): compartida y cacheada con la vista Videos, y pedida SÓLO
// al abrir un artista o la vista Videos — nunca al arrancar ni en el listado de artistas.
//
// Necesita videos en una carpeta con nombre de artista REAL: suma a la carpeta de fixtures de la
// corrida dos videos cortos (crearExtras de video-fixtures.mjs, con ffmpeg) en la carpeta de <A>, un
// artista de la biblioteca, y los BORRA al terminar (también si se corta, ver `limpiar`), esperando a
// que el backend vuelva a ver los tres de siempre. <B> es otro artista de la biblioteca, sin videos.
// Ambos salen de GET /api/browse/artists (no están escritos a mano). Pide VIDEO_DIR (regresion.mjs la
// pasa sola) y se NIEGA a escribir si esa carpeta no es la de los fixtures.
//
// Comprueba:
//   · arrancar la app (en /, y en el listado de artistas) no pide GET /api/videos;
//   · 1440: abrir <A> pide la lista UNA vez y pinta «Videos · 2» con sus dos tarjetas, sin enlace al
//     artista (ya estamos en su página) y con la jerarquía nueva (artista arriba, título debajo);
//     el menú del video trae lo de siempre y no «Ir al artista»; <B> no tiene sección; clic en una
//     tarjeta reproduce y la cola son los videos del artista; ir a Videos después pinta desde la
//     caché sin pasar por «Cargando videos…»;
//   · si GET /api/videos falla, la página del artista se ve sin sección y sin error;
//   · 701, 800 y 1024 (escritorio) y 390 (teléfono, touch): sección visible y sin desborde horizontal;
//     a 390 las tarjetas miden ≥ 44 px de alto y tocar la portada reproduce.
// Capturas (en shots/video-artista/, ignorada por git): artista con video a 1440 y a 390, y la
// tarjeta nueva en la vista Videos a 1440.
//
// Uso: VIDEO_DIR=<fixtures del backend> SNAP_BASE=http://localhost:4173 node video-artista-func.mjs
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { FIXTURES, EXTRAS, crearExtras, borrarExtras, SinFfmpeg } from './video-fixtures.mjs';

const NOMBRE = 'video-artista-func';
const noCorrio = (msg) => { console.error(`[${NOMBRE}] NO CORRIÓ: ${msg}`); process.exit(2); };
const PREFIJO = 'Seccion ';   // todos los archivos de este script empiezan así: es su firma
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'shots', 'video-artista');

// La carpeta tiene que ser la de los fixtures. Lo que haya quedado de una corrida cortada de ESTE
// script (carpetas cuyos archivos empiezan todos con «Seccion ») se borra al arrancar.
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
const ARTISTAS = (await (await fetch(BASE + '/api/browse/artists', { headers: H })).json()).map((a) => a.artist);
const aptos = ARTISTAS.filter((a) => /^[A-Za-z]+( [A-Za-z]+)*$/.test(a) && a.length >= 4 && a !== 'Various Artists');
if (aptos.length < 2) noCorrio(`la biblioteca no tiene dos artistas con nombre simple (hay ${aptos.length})`);
const A = aptos[0], B = aptos[1];
const MIOS = [
  { artista: A, archivo: `${PREFIJO}Uno (2020).mp4`, segundos: 2.5, faststart: true, portada: true },
  { artista: A, archivo: `${PREFIJO}Dos.mp4`, segundos: 2.5, faststart: true, portada: false },
];
const TITULOS = [`${PREFIJO}Dos`, `${PREFIJO}Uno`];   // orden de la sección: artista y después título

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
const medidas = { con_videos: A, sin_videos: B, sobras_borradas_al_arrancar: sobras, capturas: [] };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ETIQUETAS = '.ctx-menu .ctx-item span:first-of-type, .ctx-menu .ctx-tile-label';
const MENU_BASE = ['Reproducir a continuación', 'Agregar a la cola', 'Agregar a playlist'];
const rutaArtista = (a) => `/artists/${encodeURIComponent(a)}`;

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
// Página nueva = arranque de la app. `pedidos.videos` cuenta SÓLO GET /api/videos (la lista), no las
// portadas (/api/videos/<id>/cover). `falla`: la lista responde 500.
async function abrir(w, h, mobile, { falla = false } = {}) {
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
    // ¿Se llegó a pintar «Cargando videos…»? (para ver que Videos pinta desde la caché)
    window.__spinnerVideos = 0;
    new MutationObserver(() => {
      for (const s of document.querySelectorAll('.spinner')) if (s.textContent.includes('Cargando videos')) window.__spinnerVideos++;
    }).observe(document, { childList: true, subtree: true });
  }, token);
  if (falla) await ctx.route((u) => u.pathname === '/api/videos', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"x"}' }));
  // Las escuchas no se registran en la base de la prueba.
  await ctx.route('**/api/plays', (r) => r.fulfill({ status: 201, contentType: 'application/json', body: '{"added":0,"already":0,"skipped":0}' }));
  const pedidos = { videos: 0 };
  ctx.on('request', (r) => { if (new URL(r.url()).pathname === '/api/videos') pedidos.videos++; });
  const p = await ctx.newPage();
  const errores = []; p.on('pageerror', (e) => errores.push(String(e.message).slice(0, 120)));
  return { ctx, p, errores, pedidos };
}
const suena = (p) => p.evaluate(() => { const v = window.__player(); return { actual: v.currentTrack?.title ?? null, kind: v.currentTrack?.kind ?? null, cola: v.queue.map((x) => x.title) }; });
const pausar = async (p) => {
  await p.waitForFunction(() => window.__player().isPlaying, null, { timeout: 3000 }).catch(() => {});
  await p.evaluate(() => { const v = window.__player(); if (v.isPlaying) v.togglePlay(); });
};
const heroe = (p) => p.locator('.artist-hero-name').first().textContent({ timeout: 6000 }).then((s) => s.trim()).catch(() => null);
const cerrar = async (p) => { if (await p.locator('.ctx-menu').count()) { await p.keyboard.press('Escape'); await sleep(250); } };
const seccion = (p) => p.evaluate(() => {
  const s = document.querySelector('.artist-videos');
  if (!s) return null;
  const cards = [...s.querySelectorAll('.video-card')];
  return {
    titulo: s.querySelector('.artist-videos-title')?.textContent ?? null,
    tarjetas: cards.map((c) => c.querySelector('.video-card-title')?.textContent),
    artistas: cards.map((c) => c.querySelector('.video-card-artist')?.textContent),
    enlaces: s.querySelectorAll('.video-artist-link').length,
    alto_min: Math.round(Math.min(...cards.map((c) => c.getBoundingClientRect().height))),
    artista_arriba: cards.every((c) => c.querySelector('.video-card-artist').getBoundingClientRect().bottom <= c.querySelector('.video-card-title').getBoundingClientRect().top + 0.5),
  };
});
const desborde = (p) => p.evaluate(() => {
  const main = document.querySelector('.main-content');
  const s = document.querySelector('.artist-videos');
  const fuera = s ? [...s.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 0.5 || r.left < -0.5); }).length : null;
  return { pagina: document.documentElement.scrollWidth - innerWidth, main: main ? main.scrollWidth - main.clientWidth : null, nodos_fuera: fuera };
});
const sinDesborde = (d) => d.pagina <= 0 && (d.main ?? 0) <= 0 && d.nodos_fuera === 0;
const captura = async (p, nombre, sel) => {
  mkdirSync(OUT, { recursive: true });
  const path = join(OUT, nombre);
  if (sel) { await p.locator(sel).first().scrollIntoViewIfNeeded().catch(() => {}); await sleep(300); }
  await p.screenshot({ path });
  medidas.capturas.push(resolve(path));
};
const esperarSeccion = (p) => p.waitForSelector('.artist-videos .video-card', { timeout: 6000 }).then(() => true).catch(() => false);

try {
  try { crearExtras(DIR, MIOS); puestos = true; }
  catch (e) { if (e instanceof SinFfmpeg) noCorrio(e.message); throw e; }
  if (!(await esperarIndice(FIXTURES.length + MIOS.length))) throw new Error('el backend no llegó a ver los videos nuevos');

  // ── Arranque: ni en / ni en el listado de artistas se pide la lista de videos ──
  {
    const { ctx, p, pedidos } = await abrir(1440, 900, false);
    await p.goto(BASE + '/'); await p.waitForSelector('.sidebar, .main-content', { timeout: 8000 }).catch(() => {}); await sleep(1500);
    const enInicio = pedidos.videos;
    await p.goto(BASE + '/artists'); await p.waitForSelector('.artist-portrait', { timeout: 8000 }).catch(() => {}); await sleep(1200);
    ok('arranque_y_listado_sin_pedir_videos', enInicio === 0 && pedidos.videos === 0, { en_inicio: enInicio, tras_listado: pedidos.videos });

    // ── 1440: abrir A desde el listado ──
    await p.locator('.artist-portrait', { hasText: A }).first().click();
    const hay = await esperarSeccion(p); await sleep(500);
    const sA = await seccion(p);
    ok('artista_con_videos_muestra_seccion', hay && (await heroe(p)) === A && sA?.titulo === 'Videos · 2' && same(sA.tarjetas, TITULOS) && sA.artistas.every((x) => x === A) && pedidos.videos === 1,
      { ...(sA ?? { motivo: 'no hay sección' }), pedidos_de_videos: pedidos.videos });
    ok('seccion_sin_enlace_y_artista_arriba', sA && sA.enlaces === 0 && sA.artista_arriba, sA ?? {});
    await captura(p, 'artista-con-videos-1440.png', '.artist-videos');

    await p.locator('.artist-videos .video-card').first().locator('.video-cover-frame').click({ button: 'right' });
    await p.waitForSelector('.ctx-menu', { timeout: 1500 }).catch(() => {}); await sleep(250);
    const m = await p.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.trim()), ETIQUETAS);
    await cerrar(p);
    ok('menu_del_video_sin_ir_al_artista', same(m, MENU_BASE), { menu: m });

    await p.locator('.artist-videos .video-card').nth(1).locator('.video-cover-frame').click();
    await p.waitForFunction(() => window.__player().currentTrack?.kind === 'video', null, { timeout: 5000 }).catch(() => {});
    const s = await suena(p); await pausar(p);
    ok('clic_reproduce_y_cola_son_sus_videos', s.kind === 'video' && s.actual === TITULOS[1] && same(s.cola, TITULOS) && (await heroe(p)) === A, s);

    // Videos desde el menú lateral: pinta desde la caché (sin «Cargando videos…») y revalida.
    const antes = pedidos.videos;
    await p.evaluate(() => { window.__spinnerVideos = 0; });
    await p.locator('.sidebar a, .sidebar button, .sidebar [role="link"]', { hasText: 'Videos' }).first().click();
    await p.waitForSelector('.video-grid .video-card', { timeout: 4000 }).catch(() => {}); await sleep(800);
    const spin = await p.evaluate(() => window.__spinnerVideos);
    const nVideos = await p.locator('.video-grid .video-card').count();
    ok('videos_pinta_desde_cache', spin === 0 && nVideos === FIXTURES.length + MIOS.length && pedidos.videos - antes <= 1, { spinner_visto: spin, tarjetas: nVideos, pedidos_al_entrar: pedidos.videos - antes });
    await p.locator('.video-card', { hasText: TITULOS[1] }).first().scrollIntoViewIfNeeded().catch(() => {});
    await captura(p, 'videos-tarjeta-1440.png');
    await ctx.close();
  }

  // ── 1440: B no tiene videos → sin sección ──
  {
    const { ctx, p, errores } = await abrir(1440, 900, false);
    await p.goto(BASE + rutaArtista(B)); await heroe(p);
    await p.waitForSelector('.album-grid .album-card', { timeout: 6000 }).catch(() => {}); await sleep(1200);
    const n = await p.locator('.artist-videos').count();
    ok('artista_sin_videos_sin_seccion', (await heroe(p)) === B && n === 0 && !errores.length, { secciones: n, errores });
    await ctx.close();
  }

  // ── Si la lista falla, la página del artista queda sin sección y sin error ──
  {
    const { ctx, p, errores, pedidos } = await abrir(1440, 900, false, { falla: true });
    await p.goto(BASE + rutaArtista(A)); await heroe(p); await sleep(1500);
    const n = await p.locator('.artist-videos').count();
    const avisos = await p.locator('.main-content .empty-state').count();
    ok('lista_caida_sin_seccion_ni_error', (await heroe(p)) === A && n === 0 && avisos === 0 && pedidos.videos >= 1 && !errores.length, { secciones: n, avisos, pedidos: pedidos.videos, errores });
    await ctx.close();
  }

  // ── Franja 701–1024 (escritorio) ──
  medidas.franja = {};
  for (const w of [701, 800, 1024]) {
    const { ctx, p, errores } = await abrir(w, 800, false);
    await p.goto(BASE + rutaArtista(A));
    const hay = await esperarSeccion(p); await sleep(500);
    await p.locator('.artist-videos').scrollIntoViewIfNeeded().catch(() => {});
    const d = await desborde(p);
    medidas.franja[w] = d;
    ok(`franja_${w}_seccion_sin_desborde`, hay && sinDesborde(d) && !errores.length, { ...d, errores });
    await ctx.close();
  }

  // ── Teléfono 390 ──
  {
    const { ctx, p, errores } = await abrir(390, 844, true);
    await p.goto(BASE + rutaArtista(A));
    const hay = await esperarSeccion(p); await sleep(500);
    await p.locator('.artist-videos').scrollIntoViewIfNeeded().catch(() => {});
    const sA = await seccion(p), d = await desborde(p);
    ok('390_seccion_sin_desborde_y_44px', hay && sA?.alto_min >= 44 && sinDesborde(d), { ...d, alto_min_tarjeta: sA?.alto_min });
    await captura(p, 'artista-con-videos-390.png', '.artist-videos');
    await p.locator('.artist-videos .video-card').first().locator('.video-cover-frame').tap();
    await p.waitForFunction(() => window.__player().currentTrack?.kind === 'video', null, { timeout: 5000 }).catch(() => {});
    const s = await suena(p); await pausar(p);
    ok('390_toque_reproduce', s.kind === 'video' && s.actual === TITULOS[0] && same(s.cola, TITULOS) && !errores.length, { ...s, errores });
    await ctx.close();
  }
} catch (e) {
  ok('sin_excepciones', false, { error: String(e.message).split('\n')[0].slice(0, 200) });
} finally {
  const tras = await limpiar();
  ok('extras_borrados', tras !== null && tras.length === FIXTURES.length && !MIOS.some((f) => existsSync(join(DIR, f.artista))), { videos_en_el_backend: tras?.length ?? null });
  await browser.close().catch(() => {});
}

const fails = Object.entries(R).filter(([, v]) => !v.ok);
console.log(JSON.stringify(R, null, 1));
console.log('medidas: ' + JSON.stringify(medidas));
console.log(`\n${NOMBRE}: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
process.exit(fails.length ? 1 : 0);
