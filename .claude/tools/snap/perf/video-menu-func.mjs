// video-menu-func.mjs — funcional de V7 + V8d: el MENÚ CONTEXTUAL de la tarjeta de video (vista Videos)
// y su "Agregar a playlist" (selector sin "Mis favoritos", "Nueva playlist", avisos de iOS por cada
// respuesta, contador de la lista). Siembra con la API REAL sobre la COPIA de la base y borra lo que
// crea; las respuestas que no salen solas (skipped, 404, 409, 503, 401, un 200) se interceptan con route.
// Corre contra un backend con VIDEO_DIR = los 3 fixtures (como lo arma regresion.mjs). El audio es un
// WAV sintético servido por /stream/<id>; el video es el real del backend.
// La cola se LEE del value de PlayerContext en el árbol ACTUAL de React (stateNode.current del fiber
// raíz; sólo lectura) y se arma con su play(); la app no expone nada para esto.
//
// Comprueba, a 1440 (clic derecho) y 390 (pulsación larga):
//   · el menú de la tarjeta tiene EXACTAMENTE "Reproducir a continuación", "Agregar a la cola" y
//     "Agregar a playlist" (en el teléfono, sus versiones cortas);
//   · "a continuación" inserta el video justo después de lo que suena, lo marca como siguiente y
//     no corta lo que suena; avisa "Suena a continuación";
//   · "a la cola" lo agrega al final; avisa "Añadido a la cola";
//   · la pulsación larga no reproduce (el toque sí: lista de videos desde el tocado);
//   · sobre el video que YA suena, "a continuación" no aparece;
//   · cero peticiones con un id hex fuera de /api/videos y /stream/video.
// Con SHOTS=1 guarda el menú abierto a 390 y 1440 en shots/sub3/<OUT>.
// Uso: SNAP_BASE=http://localhost:4173 [SHOTS=1] node video-menu-func.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'shots', 'sub3', process.env.OUT ?? 'video-v7');
const SHOTS = !!process.env.SHOTS;
if (SHOTS) mkdirSync(OUT, { recursive: true });

const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const H = { Authorization: `Bearer ${token}` };
const VIDS = (await (await fetch(BASE + '/api/videos', { headers: H })).json()).videos ?? [];
const TRACKS = await (await fetch(BASE + '/api/tracks?limit=5', { headers: H })).json();
const byTitle = (t) => VIDS.find((v) => v.title === t);
const FAST = byTitle('Faststart'), MOOV = byTitle('Moov Al Final'), LARGO = byTitle('Largo Para Seek');
const A1 = TRACKS[0], A2 = TRACKS[1];
const HEX = new Set(VIDS.map((v) => v.id));

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
    // Lo que importa de la cola, sin portadas ni tokens.
    window.__cola = () => {
      const v = window.__player();
      return {
        cola: v.queue.map((t) => (t.kind === 'video' ? `video:${t.title}` : `audio:${t.title}`)),
        actual: v.currentTrack ? (v.currentTrack.kind === 'video' ? `video:${v.currentTrack.title}` : `audio:${v.currentTrack.title}`) : null,
        idx: v.queueIndex,
        siguientes: v.queue.filter((t) => v.upNext.has(t._qid)).map((t) => t.title),
      };
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

const toasts = (p) => p.evaluate(() => [...document.querySelectorAll('.toast .toast-text')].map((t) => t.textContent));

// ── V8d: siembra con la API real ──
const HJ = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
const apiJ = async (path, opts = {}) => { const r = await fetch(BASE + path, { ...opts, headers: HJ }); return r.status === 204 ? null : r.json(); };
const videosDe = async (id) => ((await apiJ(`/api/playlists/${id}/videos`)).videos ?? []).map((v) => v.id);
// "Mis favoritos": la más vieja con ese nombre; si no hay, se crea (y se borra al final).
const favs = (await apiJ('/api/playlists')).filter((pl) => pl.name.trim() === 'Mis favoritos')
  .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id - b.id);
let FAV = favs[0]?.id;
const borrar = [];
if (FAV == null) { FAV = (await apiJ('/api/playlists', { method: 'POST', body: JSON.stringify({ name: 'Mis favoritos' }) })).id; borrar.push(FAV); }

for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
  const { ctx, p, reqs } = await newPage(w, h, mobile);
  await p.goto(BASE + '/videos');
  await p.waitForSelector('.video-card');
  await p.evaluate((q) => window.__player().play(q, 0), [A1, A2]);
  await p.waitForFunction(() => window.__cola().actual?.startsWith('audio:'));

  const card = (title) => p.locator('.video-card', { hasText: title });
  // Abre el menú y devuelve sus etiquetas; deja el menú abierto.
  const abrir = async (title) => {
    if (mobile) {
      // Con la grilla de una columna (T30) una tarjeta puede quedar debajo del borde: se scrollea
      // hasta ella antes de mantener presionado, como haría el dedo.
      await card(title).scrollIntoViewIfNeeded();
      const b = await card(title).boundingBox();
      await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await p.mouse.down(); await sleep(650); await p.mouse.up();
    } else {
      await card(title).click({ button: 'right' });
    }
    await p.waitForSelector('.ctx-menu');
    await sleep(250);
    return p.evaluate(() => [...document.querySelectorAll('.ctx-menu .ctx-item span:first-of-type, .ctx-menu .ctx-tile-label')].map((e) => e.textContent));
  };
  const elegir = async (texto) => {
    await p.locator('.ctx-menu :is(.ctx-item, .ctx-tile)', { hasText: texto }).first().click();
    await p.waitForSelector('.ctx-menu', { state: 'detached' });
    await sleep(300);
  };
  const L = mobile
    ? { next: 'A continuación', queue: 'A la cola', pl: 'Playlist' }
    : { next: 'Reproducir a continuación', queue: 'Agregar a la cola', pl: 'Agregar a playlist' };

  // 1) El menú: exactamente las dos acciones. La pulsación larga / el clic derecho no reproducen.
  const items = await abrir(FAST.title);
  ok(`menu_tres_acciones_${w}`, items.length === 3 && items[0] === L.next && items[1] === L.queue && items[2] === L.pl, { items });
  const tras = await p.evaluate(() => window.__cola());
  ok(`abrir_menu_no_reproduce_${w}`, tras.actual === `audio:${A1.title}`, tras);
  if (SHOTS) await p.screenshot({ path: join(OUT, `menu-${w}.png`) });

  // 2) "A continuación": justo después de lo que suena, marcado, sin cortar lo que suena.
  await elegir(L.next);
  const c1 = await p.evaluate(() => window.__cola());
  const t1 = await toasts(p);
  ok(`a_continuacion_${w}`,
    JSON.stringify(c1.cola) === JSON.stringify([`audio:${A1.title}`, `video:${FAST.title}`, `audio:${A2.title}`])
      && c1.actual === `audio:${A1.title}` && c1.siguientes.includes(FAST.title) && t1.includes('Suena a continuación'),
    { ...c1, toasts: t1 });

  // 3) "A la cola": al final.
  await abrir(MOOV.title);
  await elegir(L.queue);
  const c2 = await p.evaluate(() => window.__cola());
  const t2 = await toasts(p);
  ok(`a_la_cola_${w}`,
    c2.cola.at(-1) === `video:${MOOV.title}` && c2.cola.length === 4 && c2.actual === `audio:${A1.title}` && t2.includes('Añadido a la cola'),
    { ...c2, toasts: t2 });

  // 4) El toque normal sigue reproduciendo la lista de videos desde el tocado.
  await card(LARGO.title).click();
  await p.waitForFunction((t) => window.__cola().actual === `video:${t}`, LARGO.title, { timeout: 8000 });
  const c3 = await p.evaluate(() => window.__cola());
  ok(`toque_reproduce_lista_de_videos_${w}`, c3.cola.every((x) => x.startsWith('video:')) && c3.cola.length === VIDS.length && c3.cola[c3.idx] === `video:${LARGO.title}`, c3);

  // 5) Sobre el video que YA suena no aparece "a continuación".
  const itemsAct = await abrir(LARGO.title);
  ok(`menu_video_actual_sin_a_continuacion_${w}`, itemsAct.length === 2 && itemsAct[0] === L.queue && itemsAct[1] === L.pl, { items: itemsAct });
  await p.keyboard.press('Escape');
  await p.waitForSelector('.ctx-menu', { state: 'detached' });

  // ── V8d: "Agregar a playlist" desde la tarjeta ──
  const DEST = (await apiJ('/api/playlists', { method: 'POST', body: JSON.stringify({ name: `v8d destino ${w}` }) })).id;
  borrar.push(DEST);
  await p.goto(BASE + '/videos');            // la lista de playlists del menú se pide al abrir el selector
  await p.waitForSelector('.video-card');
  const selector = async (title) => {
    await abrir(title);
    await p.locator('.ctx-menu :is(.ctx-item, .ctx-tile)', { hasText: L.pl }).first().click();
    await p.waitForSelector('.ctx-menu .ptp-new');
    await p.waitForFunction(() => !document.querySelector('.ctx-menu .ctx-loading'));
    return p.evaluate(() => [...document.querySelectorAll('.ctx-menu .ptp-item-name')].map((e) => e.textContent));
  };
  const elegirPl = async (name) => {
    await p.locator('.ctx-menu .ptp-item-main', { hasText: name }).click();
    await p.waitForSelector('.ctx-menu', { state: 'detached' });
    await sleep(400);
  };
  const ultimoToast = async () => (await toasts(p)).at(-1) ?? null;

  const nombres = await selector(MOOV.title);
  ok(`selector_sin_favoritos_${w}`, nombres.includes(`v8d destino ${w}`) && !nombres.some((x) => x.trim() === 'Mis favoritos'), { nombres });
  if (SHOTS) await p.screenshot({ path: join(OUT, `selector-${w}.png`) });
  await elegirPl(`v8d destino ${w}`);
  const plT1 = await ultimoToast();
  ok(`agregar_201_${w}`, plT1 === `Agregado a «v8d destino ${w}»` && (await videosDe(DEST)).includes(MOOV.id), { toast: plT1 });

  await selector(MOOV.title);
  await elegirPl(`v8d destino ${w}`);
  const plT2 = await ultimoToast();
  ok(`agregar_ya_estaba_${w}`, plT2 === `Ese video ya está en «v8d destino ${w}»` && (await videosDe(DEST)).length === 1, { toast: plT2 });

  // Respuestas interceptadas: cada una su texto, el menú se cierra y no queda nada a medias.
  const CASOS = [
    // En iOS es un Alert titulado "No se pudo agregar" (tipo error): el toast lleva ese encabezado.
    ['skipped', 201, { added: 0, already: 0, skipped: 1 }, 'No se pudo agregar. Ese video ya no está en el servidor.'],
    ['404', 404, { error: 'Playlist not found' }, 'No se pudo agregar. Esa playlist ya no existe.'],
    ['409', 409, { error: 'playlist video limit reached (max 500)' }, 'No se pudo agregar. Esta playlist ya llegó al máximo de 500 videos.'],
    ['503', 503, { error: 'video index unavailable' }, 'No se pudo agregar. Los videos no están disponibles ahora. Intenta más tarde.'],
    ['200_no_es_exito', 200, { added: 1, already: 0, skipped: 0 }, 'No se pudo agregar. Intenta de nuevo.'],
  ];
  for (const [nombre, status, body, texto] of CASOS) {
    await p.route(`**/api/playlists/${DEST}/videos`, (r) => (r.request().method() === 'POST'
      ? r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
      : r.continue()));
    await selector(FAST.title);
    await elegirPl(`v8d destino ${w}`);
    const t = await ultimoToast();
    const enDest = await videosDe(DEST);
    ok(`agregar_${nombre}_${w}`, t === texto && enDest.length === 1 && !enDest.includes(FAST.id) && !(await p.locator('.ctx-menu').count()), { toast: t, enDest: enDest.length });
    await p.unroute(`**/api/playlists/${DEST}/videos`);
  }

  // "Nueva playlist": crea y agrega.
  const nueva = `v8d nueva ${w}`;
  await selector(LARGO.title);
  await p.locator('.ctx-menu .ptp-new input').fill(nueva);
  await p.locator('.ctx-menu .ptp-new input').press('Enter');
  await p.waitForSelector('.ctx-menu', { state: 'detached' });
  await sleep(500);
  const plT3 = await ultimoToast();
  const creada = (await apiJ('/api/playlists')).find((pl) => pl.name === nueva);
  if (creada) borrar.push(creada.id);
  ok(`nueva_playlist_con_el_video_${w}`, plT3 === `Playlist «${nueva}» creada con el video` && !!creada && (await videosDe(creada.id)).includes(LARGO.id), { toast: plT3, creada: !!creada });

  // "Nueva playlist" que se crea pero el video no entra: existe igual y se dice por qué.
  const nuevaFalla = `v8d nueva falla ${w}`;
  await p.route('**/api/playlists/*/videos', (r) => (r.request().method() === 'POST'
    ? r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"video index unavailable"}' })
    : r.continue()));
  await selector(LARGO.title);
  await p.locator('.ctx-menu .ptp-new input').fill(nuevaFalla);
  await p.locator('.ctx-menu .ptp-new input').press('Enter');
  await p.waitForSelector('.ctx-menu', { state: 'detached' });
  await sleep(500);
  await p.unroute('**/api/playlists/*/videos');
  const plT4 = await ultimoToast();
  const creadaF = (await apiJ('/api/playlists')).find((pl) => pl.name === nuevaFalla);
  if (creadaF) borrar.push(creadaF.id);
  ok(`nueva_playlist_creada_pero_sin_video_${w}`,
    plT4 === `Playlist «${nuevaFalla}» creada, pero no se pudo agregar el video. Los videos no están disponibles ahora. Intenta más tarde.`
      && !!creadaF && (await videosDe(creadaF.id)).length === 0,
    { toast: plT4, creada: !!creadaF });

  // El contador de la lista de playlists, al volver a ella.
  await p.goto(BASE + '/playlists');
  await p.waitForSelector('.playlist-item');
  const meta = await p.evaluate((nm) => [...document.querySelectorAll('.playlist-item')].find((li) => li.querySelector('.playlist-name')?.textContent === nm)?.querySelector('.playlist-meta')?.textContent, `v8d destino ${w}`);
  ok(`lista_contador_actualizado_${w}`, meta === '0 canciones · 1 video', { meta });

  ok(`cero_peticiones_invalidas_${w}`, malas(reqs).length === 0, { malas: malas(reqs) });

  // 401 al final (la app reacciona a un 401 intentando reautenticar): sale su aviso.
  await p.goto(BASE + '/videos');
  await p.waitForSelector('.video-card');
  await p.route(`**/api/playlists/${DEST}/videos`, (r) => (r.request().method() === 'POST'
    ? r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Unauthorized"}' })
    : r.continue()));
  await selector(FAST.title);
  await elegirPl(`v8d destino ${w}`);
  const plT5 = await ultimoToast();
  ok(`agregar_401_${w}`, plT5 === 'No se pudo agregar. Sesión expirada. Sal y vuelve a entrar.', { toast: plT5 });
  await ctx.close();
}

for (const id of borrar) await apiJ(`/api/playlists/${id}`, { method: 'DELETE' });

const fails = Object.entries(R).filter(([, v]) => v === false || (v && typeof v === 'object' && v.ok === false)).map(([k]) => k);
console.log(JSON.stringify(R, null, 1));
console.log(`\nvideo-menu-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
