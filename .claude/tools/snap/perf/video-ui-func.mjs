// video-ui-func.mjs — funcional de V5: la INTERFAZ con un video como ítem actual (y en la cola).
// Corre contra un backend con VIDEO_DIR = los 3 fixtures (como lo arma regresion.mjs). El audio es un
// WAV sintético servido por /stream/<id> (como plays-func); el video es el real del backend.
// Como video-queue-func, arma la cola desde el value de PlayerContext (lectura del fiber de React).
//
// Comprueba, a 1440 (escritorio) y 390 (teléfono):
//   · con VIDEO actual, en la barra/mini y en el expandido NO existen ♥, Compartir, "+", calidad,
//     letra ni Info; el título no enlaza al álbum ni el artista al artista; el fondo del expandido
//     usa la portada del video;
//   · cero peticiones con el id hex fuera de /api/videos y /stream/video (pista, letra, portada,
//     playlist/favoritos), y ninguna a /api/info (MusicBrainz);
//   · filas de video en la cola: portada que carga (naturalWidth>0) o el marcador 🎬, y su marca de
//     video; la fila de canción, sin marca;
//   · menú contextual de una fila de video: sólo "Quitar de la cola"; el de una canción, completo;
//   · con una CANCIÓN actual todo sigue visible como antes.
// Con SHOTS=1 guarda mini y expandido, con video y con canción, a 390 y 1440 en shots/sub3/<OUT>.
// Uso: SNAP_BASE=http://localhost:4173 [SHOTS=1] node video-ui-func.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'shots', 'sub3', process.env.OUT ?? 'video-v5');
const SHOTS = !!process.env.SHOTS;
if (SHOTS) mkdirSync(OUT, { recursive: true });

const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const H = { Authorization: `Bearer ${token}` };
const VIDS = (await (await fetch(BASE + '/api/videos', { headers: H })).json()).videos ?? [];
const TRACKS = await (await fetch(BASE + '/api/tracks?limit=5', { headers: H })).json();
const byTitle = (t) => VIDS.find((v) => v.title === t);
const LARGO = { ...byTitle('Largo Para Seek'), kind: 'video' };   // 30 s, con portada
const SINPORT = { ...byTitle('Moov Al Final'), kind: 'video' };   // sin portada
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
  await ctx.route((u) => u.pathname.startsWith('/stream/') && !u.pathname.startsWith('/stream/video/'), (r) => {
    const h = r.request().headers().range; const total = W.length;
    if (!h) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: W });
    const m = /bytes=(\d*)-(\d*)/.exec(h); const start = m[1] ? +m[1] : 0; const end = m[2] ? +m[2] : total - 1;
    r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: W.subarray(start, end + 1) });
  });
  // El navegador no debe tocar la base: /api/plays se responde acá (una canción de 60 s no llega
  // al umbral en esta prueba, pero así no depende de eso).
  await ctx.route('**/api/plays', (r) => r.fulfill({ status: 201, contentType: 'application/json', body: '{"added":0,"already":0,"skipped":0}' }));
  const reqs = [];
  ctx.on('request', (r) => reqs.push({ m: r.method(), u: r.url(), body: r.postData() ?? '' }));
  const p = await ctx.newPage();
  return { ctx, p, reqs };
}

// Peticiones inválidas: el id hex de un video en cualquier lugar que no sea /api/videos o /stream/video,
// o cualquier /api/info (Info → MusicBrainz) o /lyrics mientras suena un video.
function malas(reqs) {
  return reqs.filter(({ u, body }) => {
    const path = new URL(u).pathname;
    if (path.startsWith('/api/videos') || path.startsWith('/stream/video/')) return false;
    if (path.startsWith('/api/info/') || path.endsWith('/lyrics')) return true;
    for (const id of HEX) if (path.includes(id) || body.includes(id)) return true;
    return false;
  }).map((r) => `${r.m} ${new URL(r.u).pathname}`);
}

const waitVideo = (p) => p.waitForFunction(() => { const v = document.querySelector('video.player-video'); return v && !v.paused && v.currentTime > 0; }, null, { timeout: 8000 });
const waitAudio = (p, title) => p.waitForFunction((t) => document.querySelector('.player-title')?.textContent === t && !document.querySelector('video.player-video')?.getAttribute('src'), title ?? 'Sin título', { timeout: 8000 });

// Lo que se busca en la barra/mini y en el expandido.
const SEL_BAR = { fav: '.fav-player', mas: '.ptp-player', letra: '.lyrics-btn', info: '.info-btn', calidad: '.player-bar .player-quality', letraMini: '.lyrics-mini', tituloLink: '.player-title .player-bar-link', artistaLink: '.player-artist .player-bar-link' };
const SEL_EXP = { fav: '.player-expanded .fav-exp', compartir: '.player-expanded .exp-share', mas: '.player-expanded .ptp-exp', letra: '.player-expanded [title="Letra"]', info: '.player-expanded .exp-info', calidad: '.player-expanded .player-quality', tituloLink: '.player-expanded .exp-title.exp-link', artistaLink: '.player-expanded .exp-artist.exp-link' };
const count = (p, sels) => p.evaluate((sels) => Object.fromEntries(Object.entries(sels).map(([k, s]) => [k, document.querySelectorAll(s).length])), sels);

async function openExpanded(p) {
  await p.locator('[data-video-slot="mini"]').click();
  await p.waitForSelector('.player-expanded');
  await sleep(600);
}
// Un Esc cierra UNA cosa (escalera dismissTop): con la cola abierta como panel del expandido, el
// primero cierra el panel y el segundo el expandido.
async function closeExpanded(p) {
  for (let i = 0; i < 3 && (await p.locator('.player-expanded').count()); i++) {
    await p.keyboard.press('Escape');
    await sleep(400);
  }
  await p.waitForSelector('.player-expanded', { state: 'detached' });
  await sleep(300);
}

for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
  const { ctx, p, reqs } = await newPage(w, h, mobile);
  await p.goto(BASE + '/');
  await p.waitForSelector('.player-bar');

  // ── Con VIDEO actual ──
  await p.evaluate((q) => window.__player().play(q, 0), [LARGO, SINPORT, A1, A2]);
  await waitVideo(p);
  await sleep(500);
  const bar = await count(p, SEL_BAR);
  const barTexto = await p.evaluate(() => ({ titulo: document.querySelector('.player-title')?.textContent, artista: document.querySelector('.player-artist')?.textContent }));
  ok(`video_barra_sin_acciones_de_pista_${w}`, Object.values(bar).every((n) => n === 0) && barTexto.titulo === LARGO.title && barTexto.artista === LARGO.artist, { ...bar, ...barTexto });
  if (SHOTS) await p.screenshot({ path: join(OUT, `video-mini-${w}.png`) });

  await openExpanded(p);
  const exp = await count(p, SEL_EXP);
  // Sin la query: lleva el token de la sesión de prueba y no tiene por qué quedar en la salida.
  const bg = await p.evaluate(() => document.querySelector('.player-expanded .exp-bg')?.style.backgroundImage.split('?')[0] ?? null);
  ok(`video_expandido_sin_acciones_de_pista_${w}`, Object.values(exp).every((n) => n === 0), exp);
  ok(`video_expandido_fondo_portada_video_${w}`, !!bg && bg.includes(`/api/videos/${LARGO.id}/cover`), { bg });
  if (SHOTS) await p.screenshot({ path: join(OUT, `video-expandido-${w}.png`) });
  await closeExpanded(p);

  // ── Cola: filas de video y de canción (escritorio: columna; teléfono: hoja del expandido) ──
  if (!mobile) {
    await p.locator('.queue-btn').click();
  } else {
    await p.locator('.queue-mini').click();
    await p.waitForSelector('.player-expanded');
  }
  await p.waitForSelector('.queue-row');
  await sleep(800);   // portadas lazy
  const filas = await p.evaluate(() => [...document.querySelectorAll('.queue-row')].map((r) => ({
    titulo: r.querySelector('.queue-title-name')?.textContent,
    img: r.querySelector('.queue-cover img') ? { src: r.querySelector('.queue-cover img').getAttribute('src').split('?')[0], cargo: r.querySelector('.queue-cover img').complete && r.querySelector('.queue-cover img').naturalWidth > 0 } : null,
    ph: r.querySelector('.queue-cover-ph')?.textContent ?? null,
    marca: !!r.querySelector('.queue-video-mark'),
  })));
  const fV = filas.find((f) => f.titulo === LARGO.title), fS = filas.find((f) => f.titulo === SINPORT.title), fA = filas.find((f) => f.titulo === A1.title);
  ok(`cola_fila_video_con_portada_${w}`, !!fV?.img?.cargo && fV.img.src.includes(`/api/videos/${LARGO.id}/cover`) && fV.marca, fV);
  ok(`cola_fila_video_sin_portada_${w}`, fS?.ph === '🎬' && !fS.img && fS.marca, fS);
  ok(`cola_fila_cancion_sin_marca_${w}`, !!fA && !fA.marca, fA);

  // Menú contextual de una fila de video que NO suena (clic derecho en escritorio, long-press en el teléfono).
  const rowS = p.locator('.queue-row', { hasText: SINPORT.title });
  const rowA = p.locator('.queue-row', { hasText: A1.title });
  const menuDe = async (row) => {
    if (mobile) {
      const b = await row.boundingBox();
      await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await p.mouse.down(); await sleep(650); await p.mouse.up();
    } else {
      await row.click({ button: 'right' });
    }
    await p.waitForSelector('.ctx-menu');
    const items = await p.evaluate(() => [...document.querySelectorAll('.ctx-menu .ctx-item span:first-of-type, .ctx-menu .ctx-tile-label')].map((e) => e.textContent));
    await p.keyboard.press('Escape');
    await p.waitForSelector('.ctx-menu', { state: 'detached' });
    return items;
  };
  const itemsV = await menuDe(rowS);
  ok(`menu_fila_video_solo_quitar_${w}`, itemsV.length === 1 && /Quitar/.test(itemsV[0]), { items: itemsV });
  const itemsA = await menuDe(rowA);
  ok(`menu_fila_cancion_completo_${w}`, itemsA.some((t) => /playlist/i.test(t)) && itemsA.some((t) => /avorit|♥/.test(t)) && itemsA.some((t) => /Compartir/.test(t)) && itemsA.some((t) => /Quitar/.test(t)), { items: itemsA });
  if (mobile) await closeExpanded(p);
  else await p.locator('.queue-btn').click();

  ok(`video_cero_peticiones_invalidas_${w}`, malas(reqs).length === 0, { malas: malas(reqs) });

  // ── Con CANCIÓN actual: todo como antes ──
  await p.evaluate((q) => window.__player().play(q, 0), [A1, LARGO]);
  await waitAudio(p, A1.title);
  await sleep(700);
  const barA = await count(p, SEL_BAR);
  const espBar = mobile
    ? { letraMini: 1, tituloLink: 1 }                                 // en el teléfono la barra mini es más corta
    : { fav: 1, mas: 1, letra: 1, info: 1, tituloLink: 1 };
  ok(`cancion_barra_como_antes_${w}`, Object.entries(espBar).every(([k, n]) => barA[k] >= n), barA);
  if (SHOTS) await p.screenshot({ path: join(OUT, `cancion-mini-${w}.png`) });
  await openExpanded(p);
  const expA = await count(p, SEL_EXP);
  ok(`cancion_expandido_como_antes_${w}`, ['fav', 'compartir', 'mas', 'letra', 'info', 'tituloLink'].every((k) => expA[k] >= 1), expA);
  if (SHOTS) await p.screenshot({ path: join(OUT, `cancion-expandido-${w}.png`) });
  await closeExpanded(p);
  await ctx.close();
}

const fails = Object.entries(R).filter(([, v]) => v === false || (v && typeof v === 'object' && v.ok === false)).map(([k]) => k);
console.log(JSON.stringify(R, null, 1));
console.log(`\nvideo-ui-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
