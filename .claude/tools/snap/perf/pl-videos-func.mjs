// pl-videos-func.mjs — funcional de V8b/V8c/V8e: los VIDEOS en el detalle de una playlist (sección,
// estados, Reproducir/Mix) y el menú de una fila de video (la cola, agregar a OTRA playlist, quitar).
// Corre contra el backend de regresion.mjs (COPIA de la base + VIDEO_DIR = los 3 fixtures). Siembra
// con la API REAL (POST /api/playlists y /:id/videos con ids de los fixtures) y borra lo que creó al
// final. Los estados que la API real no puede dar acá (available false/null, error del GET) salen
// de interceptar el GET /api/playlists/:id/videos con route de Playwright; la base no se toca a mano.
// El audio es un WAV sintético (/stream/<id>); la cola se LEE del value de PlayerContext (árbol
// actual de React, sólo lectura).
//
// Comprueba (reglas de la PANTALLA de iOS, app/(tabs)/explore/playlist.tsx + videos-datos.ts):
//   · con canciones y videos: sección "Videos · 2" al pie (después de las canciones), contador
//     "2 canciones · 2 videos" en el encabezado y en la lista; tocar una fila arma la cola de videos
//     desde la tocada; Reproducir = canciones visibles y los videos al final; Mix = todo, sin que
//     suenen dos a la vez;
//   · 0 canciones + 2 videos: sin "Sin canciones." ni "Playlist vacía", botones visibles;
//   · available false / null: filas apagadas con su nota, afuera de la cola y con el aviso de iOS;
//   · GET de videos en error: "Sin canciones." + la sección con el error; Reintentar funciona;
//   · "Mis favoritos": sin sección y sin pedir sus videos;
//   · sólo canciones: sin sección y Reproducir como antes;
//   · cero peticiones con id hex fuera de /api/videos, /api/playlists/*/videos y /stream/video.
// Además imprime (no cuenta) cuánto tardan, en la red, el GET de canciones y el de videos al abrir.
// Con SHOTS=1 guarda capturas a 390 y 1440, con y sin canciones, en shots/sub3/<OUT>.
// Uso: SNAP_BASE=http://localhost:4173 [SHOTS=1] node pl-videos-func.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'shots', 'sub3', process.env.OUT ?? 'video-v8');
const SHOTS = !!process.env.SHOTS;
if (SHOTS) mkdirSync(OUT, { recursive: true });

const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Siembra con la API real ──
const HJ = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
const api = async (path, opts = {}) => {
  const r = await fetch(BASE + path, { ...opts, headers: HJ });
  return r.status === 204 ? null : r.json();
};
const VIDS = (await api('/api/videos')).videos ?? [];
const byTitle = (t) => VIDS.find((v) => v.title === t);
const LARGO = byTitle('Largo Para Seek'), FAST = byTitle('Faststart'), MOOV = byTitle('Moov Al Final');
const TRACKS = await api('/api/tracks?limit=5');
const A1 = TRACKS[0], A2 = TRACKS[1];
const HEX = new Set(VIDS.map((v) => v.id));

const creadas = [];
async function nueva(name, trackIds, videoIds) {
  const pl = await api('/api/playlists', { method: 'POST', body: JSON.stringify({ name }) });
  creadas.push(pl.id);
  for (const id of trackIds) await api(`/api/playlists/${pl.id}/tracks`, { method: 'POST', body: JSON.stringify({ track_id: id }) });
  if (videoIds.length) await api(`/api/playlists/${pl.id}/videos`, { method: 'POST', body: JSON.stringify({ video_ids: videoIds }) });
  return pl.id;
}
const P1 = await nueva('pl-videos con canciones', [A1.id, A2.id], [LARGO.id, FAST.id]);
const P2 = await nueva('pl-videos sin canciones', [], [FAST.id, MOOV.id]);
const P3 = await nueva('pl-videos solo canciones', [A1.id, A2.id], []);
// "Mis favoritos": la más vieja con ese nombre (la regla de iOS y de utils/favorites.js); si no hay,
// se crea. Se le agrega un video por la API para que, si la web lo pidiera o lo mostrara, se note.
let FAV = (await api('/api/playlists'))
  .filter((p) => p.name.trim() === 'Mis favoritos')
  .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id - b.id)[0]?.id;
if (FAV == null) FAV = await nueva('Mis favoritos', [A1.id], []);
const favVideoAgregado = (await api(`/api/playlists/${FAV}/videos`, { method: 'POST', body: JSON.stringify({ video_ids: [LARGO.id] }) }))?.added === 1;

function wav(sec, sr = 8000) {
  const n = sec * sr; const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const W = wav(60);

async function newPage(w, h, mobile) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript((t) => {
    localStorage.setItem('token', t);
    window.__els = new Set();
    const op = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...a) { window.__els.add(this); return op.apply(this, a); };
    window.__maxBoth = 0;
    setInterval(() => {
      const n = [...window.__els].filter((e) => !e.paused).length;
      if (n > window.__maxBoth) window.__maxBoth = n;
    }, 25);
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
    window.__cola = () => {
      const v = window.__player();
      const name = (t) => (t.kind === 'video' ? `video:${t.title}` : `audio:${t.title}`);
      return { cola: v.queue.map(name), actual: v.currentTrack ? name(v.currentTrack) : null, idx: v.queueIndex };
    };
  }, token);
  await ctx.route((u) => u.pathname.startsWith('/stream/') && !u.pathname.startsWith('/stream/video/'), (r) => {
    const h = r.request().headers().range; const total = W.length;
    if (!h) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: W });
    const m = /bytes=(\d*)-(\d*)/.exec(h); const start = m[1] ? +m[1] : 0; const end = m[2] ? +m[2] : total - 1;
    r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: W.subarray(start, end + 1) });
  });
  await ctx.route('**/api/plays', (r) => r.fulfill({ status: 201, contentType: 'application/json', body: '{"added":0,"already":0,"skipped":0}' }));
  const reqs = [];
  ctx.on('request', (r) => reqs.push({ m: r.method(), u: r.url(), body: r.postData() ?? '' }));
  const p = await ctx.newPage();
  return { ctx, p, reqs };
}

function malas(reqs) {
  return reqs.filter(({ u, body }) => {
    const path = new URL(u).pathname;
    if (path.startsWith('/api/videos') || path.startsWith('/stream/video/') || /^\/api\/playlists\/\d+\/videos/.test(path)) return false;
    for (const id of HEX) if (path.includes(id) || body.includes(id)) return true;
    return false;
  }).map((r) => `${r.m} ${new URL(r.u).pathname}`);
}

async function abrir(p, id) {
  await p.goto(BASE + `/playlists/${id}`);
  await p.waitForSelector('.pl-detail-title');
}
const detalle = (p) => p.evaluate(() => ({
  meta: document.querySelector('.detail-meta')?.textContent.trim(),
  titulo: document.querySelector('.pl-videos-title')?.textContent ?? null,
  filas: [...document.querySelectorAll('.pl-video-row')].map((r) => ({
    titulo: r.querySelector('.pl-video-title')?.textContent,
    meta: r.querySelector('.pl-video-meta')?.textContent ?? null,
    off: r.classList.contains('off'),
  })),
  sinCanciones: !!document.querySelector('.pl-sin-canciones'),
  vacia: [...document.querySelectorAll('.empty-title')].some((e) => e.textContent === 'Playlist vacía'),
  error: document.querySelector('.pl-videos-error')?.textContent ?? null,
  botones: { reproducir: !!document.querySelector('.pl-detail-actions .btn-primary'), mix: !!document.querySelector('.pl-detail-actions .mix-btn') },
  seccionDespuesDeTabla: (() => {
    const t = document.querySelector('.track-table'), s = document.querySelector('.pl-videos');
    return !!(t && s && (t.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING));
  })(),
  cancionesVisibles: [...document.querySelectorAll('.track-table .track-row .track-title')].map((e) => e.textContent),
}));
const toasts = (p) => p.evaluate(() => [...document.querySelectorAll('.toast .toast-text')].map((t) => t.textContent));
const reproducir = (p) => p.locator('.pl-detail-actions .btn-primary', { hasText: 'Reproducir' }).click();
const waitSeccion = (p) => p.waitForSelector('.pl-videos, .pl-sin-canciones, .empty-state', { timeout: 8000 });

const tiempos = {};
for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
  const { ctx, p, reqs } = await newPage(w, h, mobile);
  // En el teléfono las FILAS se tocan con el dedo (tap): un click de MOUSE a ≤700 px con un detalle
  // abierto lo redirige la captura del swipe-atrás de Layout y no llega a la fila (pasa igual con
  // las filas de canciones). Los botones no tienen ese problema.
  const toque = (loc) => (mobile ? loc.tap() : loc.click());
  // Tiempos de red del abrir (sólo escritorio): GET de canciones contra GET de videos.
  if (!mobile) {
    p.on('requestfinished', async (r) => {
      const path = new URL(r.url()).pathname;
      if (path === `/api/playlists/${P1}/tracks` || path === `/api/playlists/${P1}/videos`) {
        const t = r.timing();
        (tiempos[path.endsWith('videos') ? 'videos_ms' : 'canciones_ms'] ??= []).push(Math.round(t.responseEnd));
      }
    });
  }

  // ── P1: canciones + videos ──
  await abrir(p, P1);
  await p.waitForSelector('.pl-videos .pl-video-row');
  const d1 = await detalle(p);
  ok(`con_canciones_seccion_al_pie_${w}`, d1.titulo === 'Videos · 2' && d1.seccionDespuesDeTabla && d1.meta.startsWith('2 canciones · 2 videos') && d1.filas.map((f) => f.titulo).join('|') === `${LARGO.title}|${FAST.title}`, d1);
  if (SHOTS) await p.screenshot({ path: join(OUT, `con-canciones-${w}.png`), fullPage: true });

  await toque(p.locator('.pl-video-row', { hasText: FAST.title }));
  await p.waitForFunction((t) => window.__cola().actual === `video:${t}`, FAST.title, { timeout: 8000 }).catch(() => {});
  const c1 = await p.evaluate(() => window.__cola());
  ok(`tocar_fila_cola_de_videos_${w}`, JSON.stringify(c1.cola) === JSON.stringify([`video:${LARGO.title}`, `video:${FAST.title}`]) && c1.idx === 1, c1);

  await reproducir(p);
  await sleep(500);
  const c2 = await p.evaluate(() => window.__cola());
  const esperado = [...d1.cancionesVisibles.map((t) => `audio:${t}`), `video:${LARGO.title}`, `video:${FAST.title}`];
  ok(`reproducir_canciones_y_videos_al_final_${w}`, JSON.stringify(c2.cola) === JSON.stringify(esperado) && c2.idx === 0, { ...c2, esperado });

  await p.locator('.pl-detail-actions .mix-btn').click();
  await sleep(1500);
  const c3 = await p.evaluate(() => window.__cola());
  const ambos = [...c3.cola].sort().join('|') === [...esperado].sort().join('|');
  const maxBoth = await p.evaluate(() => window.__maxBoth);
  ok(`mix_canciones_y_videos_${w}`, ambos && maxBoth <= 1 && c3.idx === 0, { ...c3, maxBoth });

  // ── P2: 0 canciones + 2 videos ──
  await abrir(p, P2);
  await p.waitForSelector('.pl-videos .pl-video-row');
  const d2 = await detalle(p);
  ok(`sin_canciones_con_videos_${w}`, d2.titulo === 'Videos · 2' && !d2.sinCanciones && !d2.vacia && d2.meta === '0 canciones · 2 videos' && d2.botones.reproducir && d2.botones.mix, d2);
  if (SHOTS) await p.screenshot({ path: join(OUT, `sin-canciones-${w}.png`), fullPage: true });
  await reproducir(p);
  await sleep(500);
  const c4 = await p.evaluate(() => window.__cola());
  ok(`sin_canciones_reproducir_${w}`, JSON.stringify(c4.cola) === JSON.stringify([`video:${FAST.title}`, `video:${MOOV.title}`]), c4);

  // ── available false / null (interceptando el GET) ──
  await p.route(`**/api/playlists/${P2}/videos`, async (r) => {
    if (r.request().method() !== 'GET') return r.continue();
    const real = await (await r.fetch()).json();
    const vs = real.videos;
    vs[0] = { ...vs[0], available: false, has_cover: false, duration: null, year: null };
    vs[1] = { ...vs[1], available: null, has_cover: null, duration: null, year: null };
    vs.push({ id: LARGO.id, position: 99, added_at: '', title: LARGO.title, artist: LARGO.artist, available: true, duration: LARGO.duration, size: LARGO.size, has_cover: LARGO.has_cover, year: LARGO.year });
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(real) });
  });
  await abrir(p, P2);
  await p.waitForSelector('.pl-videos .pl-video-row');
  const d5 = await detalle(p);
  const fOff = d5.filas.filter((f) => f.off);
  ok(`no_reproducibles_apagadas_con_nota_${w}`, fOff.length === 2 && fOff.some((f) => f.meta === 'No disponible') && fOff.some((f) => f.meta === 'No se puede ver ahora') && d5.filas.find((f) => f.titulo === LARGO.title)?.off === false, d5);
  const antes = await p.evaluate(() => window.__cola());
  await toque(p.locator('.pl-video-row.off').first());
  await sleep(300);
  const tras = await p.evaluate(() => window.__cola());
  ok(`fila_apagada_no_reproduce_${w}`, JSON.stringify(antes) === JSON.stringify(tras), { antes, tras });
  await reproducir(p);
  await sleep(500);
  const c5 = await p.evaluate(() => window.__cola());
  const t5 = await toasts(p);
  ok(`omitidos_afuera_con_aviso_${w}`, JSON.stringify(c5.cola) === JSON.stringify([`video:${LARGO.title}`]) && t5.includes('2 videos no se pueden ver ahora'), { ...c5, toasts: t5 });
  await p.unroute(`**/api/playlists/${P2}/videos`);

  // ── GET de videos en error → Reintentar ──
  let fallar = true;
  await p.route(`**/api/playlists/${P2}/videos`, (r) => (fallar && r.request().method() === 'GET'
    ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Internal error"}' })
    : r.continue()));
  await abrir(p, P2);
  await p.waitForSelector('.pl-videos-error');
  const d6 = await detalle(p);
  ok(`error_sin_canciones_y_seccion_con_error_${w}`, d6.sinCanciones && d6.error?.includes('No se pudieron cargar los videos') && d6.titulo === 'Videos' && !d6.vacia, d6);
  fallar = false;
  await p.locator('.pl-videos-error button', { hasText: 'Reintentar' }).click();
  await p.waitForSelector('.pl-videos .pl-video-row');
  const d7 = await detalle(p);
  ok(`reintentar_trae_los_videos_${w}`, d7.titulo === 'Videos · 2' && !d7.error && !d7.sinCanciones, d7);
  await p.unroute(`**/api/playlists/${P2}/videos`);

  // ── "Mis favoritos": sin sección y sin pedir videos ──
  const antesFav = reqs.length;
  await abrir(p, FAV);
  await sleep(1200);
  const dF = await detalle(p);
  const pidioFav = reqs.slice(antesFav).some((r) => new URL(r.u).pathname === `/api/playlists/${FAV}/videos`);
  ok(`favoritos_sin_seccion_ni_peticion_${w}`, favVideoAgregado && !pidioFav && dF.titulo === null && !dF.meta.includes('video'), { ...dF, pidioFav, favVideoAgregado });

  // ── Sólo canciones: como antes ──
  await abrir(p, P3);
  await p.waitForSelector('.track-table');
  await sleep(800);   // que llegue la respuesta (vacía) de videos
  const d8 = await detalle(p);
  await reproducir(p);
  await sleep(500);
  const c8 = await p.evaluate(() => window.__cola());
  ok(`solo_canciones_como_antes_${w}`, d8.titulo === null && d8.meta.startsWith('2 canciones') && !d8.meta.includes('video') && JSON.stringify(c8.cola) === JSON.stringify(d8.cancionesVisibles.map((t) => `audio:${t}`)), { ...d8, ...c8 });

  // ── V8e: menú de una fila de video y "Quitar de esta playlist" ──
  const LQ = mobile
    ? { next: 'A continuación', queue: 'A la cola', pl: 'Playlist', quitar: 'Quitar' }
    : { next: 'Reproducir a continuación', queue: 'Agregar a la cola', pl: 'Agregar a playlist', quitar: 'Quitar de esta playlist' };
  const menuFila = async (title) => {
    const row = p.locator('.pl-video-row', { hasText: title });
    if (mobile) {
      await row.scrollIntoViewIfNeeded();
      const b = await row.boundingBox();
      await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await p.mouse.down(); await sleep(650); await p.mouse.up();
    } else {
      await row.click({ button: 'right' });
    }
    await p.waitForSelector('.ctx-menu');
    await sleep(200);
    return p.evaluate(() => [...document.querySelectorAll('.ctx-menu .ctx-item span:first-of-type, .ctx-menu .ctx-tile-label')].map((e) => e.textContent));
  };
  const elegirMenu = async (label) => {
    await p.locator('.ctx-menu :is(.ctx-item, .ctx-tile)', { hasText: label }).first().click();
  };
  const cerrarMenu = async () => {
    for (let i = 0; i < 3 && (await p.locator('.ctx-menu').count()); i++) { await p.keyboard.press('Escape'); await sleep(250); }
  };
  const videosEnServidor = async (id) => ((await api(`/api/playlists/${id}/videos`)).videos ?? []).map((v) => v.id);

  // Playlist con canciones y videos: el menú, el selector y quitar con el video sonando.
  const PQ = await nueva(`v8e quitar ${w}`, [A1.id, A2.id], [LARGO.id, FAST.id]);
  await abrir(p, PQ);
  await p.waitForSelector('.pl-videos .pl-video-row');
  await toque(p.locator('.pl-video-row', { hasText: FAST.title }));
  await p.waitForFunction((t) => window.__cola().actual === `video:${t}`, FAST.title, { timeout: 8000 }).catch(() => {});
  const colaAntes = await p.evaluate(() => window.__cola());
  const itemsFila = await menuFila(LARGO.title);
  ok(`menu_fila_video_cuatro_acciones_${w}`, JSON.stringify(itemsFila) === JSON.stringify([LQ.next, LQ.queue, LQ.pl, LQ.quitar]), { items: itemsFila });
  if (SHOTS) await p.screenshot({ path: join(OUT, `menu-fila-${w}.png`) });
  await elegirMenu(LQ.pl);
  await p.waitForSelector('.ctx-menu .ptp-new');
  await p.waitForFunction(() => !document.querySelector('.ctx-menu .ctx-loading'));
  const nombresFila = await p.evaluate(() => [...document.querySelectorAll('.ctx-menu .ptp-item-name')].map((e) => e.textContent));
  ok(`selector_sin_origen_ni_favoritos_${w}`, nombresFila.length > 0 && !nombresFila.includes(`v8e quitar ${w}`) && !nombresFila.some((x) => x.trim() === 'Mis favoritos'), { nombres: nombresFila });
  await cerrarMenu();

  // Quitar el video que SUENA: la fila se va, los contadores bajan, la cola no se toca.
  await menuFila(FAST.title);
  await elegirMenu(LQ.quitar);
  await sleep(600);
  const dQ = await detalle(p);
  const tQ = await toasts(p);
  const colaDespues = await p.evaluate(() => window.__cola());
  ok(`quitar_fila_y_contadores_${w}`,
    dQ.titulo === 'Videos · 1' && dQ.meta.startsWith('2 canciones · 1 video') && !dQ.filas.some((f) => f.titulo === FAST.title)
      && tQ.includes('Quitado de la playlist') && !(await videosEnServidor(PQ)).includes(FAST.id),
    { ...dQ, toasts: tQ });
  ok(`quitar_no_toca_la_cola_${w}`, JSON.stringify(colaAntes) === JSON.stringify(colaDespues) && colaDespues.actual === `video:${FAST.title}`, { colaAntes, colaDespues });

  // 0 canciones: quitar el último video deja "Playlist vacía".
  const PV = await nueva(`v8e vacia ${w}`, [], [MOOV.id]);
  await abrir(p, PV);
  await p.waitForSelector('.pl-videos .pl-video-row');
  await menuFila(MOOV.title);
  await elegirMenu(LQ.quitar);
  await sleep(600);
  const dV = await detalle(p);
  ok(`quitar_ultimo_playlist_vacia_${w}`, dV.vacia && dV.titulo === null && dV.meta === '0 canciones' && !dV.sinCanciones, dV);
  if (SHOTS) await p.screenshot({ path: join(OUT, `vacia-tras-quitar-${w}.png`) });

  // Fila APAGADA (available false / null, interceptado): sólo "Quitar", y quitar funciona de verdad.
  const PO = await nueva(`v8e apagada ${w}`, [], [FAST.id, MOOV.id]);
  await p.route(`**/api/playlists/${PO}/videos`, async (r) => {
    if (r.request().method() !== 'GET') return r.continue();
    const real = await (await r.fetch()).json();
    real.videos = real.videos.map((v) => (v.id === FAST.id ? { ...v, available: false, has_cover: false } : { ...v, available: null, has_cover: null }));
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(real) });
  });
  await abrir(p, PO);
  await p.waitForSelector('.pl-videos .pl-video-row.off');
  const itemsOff = await menuFila(FAST.title);
  ok(`menu_fila_apagada_solo_quitar_${w}`, JSON.stringify(itemsOff) === JSON.stringify([LQ.quitar]), { items: itemsOff });
  await elegirMenu(LQ.quitar);
  await sleep(600);
  const dO = await detalle(p);
  ok(`quitar_fila_apagada_${w}`, dO.titulo === 'Videos · 1' && !dO.filas.some((f) => f.titulo === FAST.title) && !(await videosEnServidor(PO)).includes(FAST.id), dO);
  await p.unroute(`**/api/playlists/${PO}/videos`);

  // Error al quitar (interceptado): la fila se queda y sale el aviso.
  await p.route(`**/api/playlists/${PO}/videos/**`, (r) => (r.request().method() === 'DELETE'
    ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Internal error"}' })
    : r.continue()));
  await abrir(p, PO);
  await p.waitForSelector('.pl-videos .pl-video-row');
  await menuFila(MOOV.title);
  await elegirMenu(LQ.quitar);
  await sleep(600);
  const dE = await detalle(p);
  const tE = await toasts(p);
  ok(`quitar_error_no_saca_la_fila_${w}`, dE.filas.some((f) => f.titulo === MOOV.title) && tE.includes('No se pudo quitar. Intenta de nuevo.'), { filas: dE.filas, toasts: tE });
  await p.unroute(`**/api/playlists/${PO}/videos/**`);

  // ── Lista de playlists: contador ──
  await p.goto(BASE + '/playlists');
  await p.waitForSelector('.playlist-item');
  const lista = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.playlist-item')].map((li) => [li.querySelector('.playlist-name')?.textContent, li.querySelector('.playlist-meta')?.textContent])));
  ok(`lista_contador_${w}`, lista['pl-videos con canciones'] === '2 canciones · 2 videos' && lista['pl-videos sin canciones'] === '0 canciones · 2 videos' && lista['pl-videos solo canciones'] === '2 canciones', lista);

  ok(`cero_peticiones_invalidas_${w}`, malas(reqs).length === 0, { malas: malas(reqs) });
  await ctx.close();
}

// Limpieza: lo creado acá (y el video que se le agregó a "Mis favoritos").
await api(`/api/playlists/${FAV}/videos/${LARGO.id}`, { method: 'DELETE' });
for (const id of creadas) await api(`/api/playlists/${id}`, { method: 'DELETE' });

const fails = Object.entries(R).filter(([, v]) => v === false || (v && typeof v === 'object' && v.ok === false)).map(([k]) => k);
console.log(JSON.stringify(R, null, 1));
console.log(`tiempos de red al abrir (ms, responseEnd desde el inicio de cada pedido): ${JSON.stringify(tiempos)}`);
console.log(`\npl-videos-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
