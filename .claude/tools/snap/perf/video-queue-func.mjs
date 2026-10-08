// video-queue-func.mjs — funcional de V4: el VIDEO como ítem de la cola del reproductor web.
// Corre contra un backend con VIDEO_DIR = los 3 fixtures de video-fixtures.mjs (como lo arma
// regresion.mjs). El audio es SINTÉTICO (WAV de 6 s servido por la ruta /stream/<id>, como
// plays-func); el video es el real del backend (/stream/video/<id>), salvo donde se aborta a propósito.
//
// Para armar colas MIXTAS (audio + video), que en V4 no tienen todavía un camino desde la UI, el
// script toma el value de PlayerContext del árbol de React (sólo lectura del fiber; la app no expone
// nada para esto) y llama a sus funciones públicas: play, next, prev, seek, setVolume.
//
// Comprueba: tocar un video suena en el <video> con el <audio> pausado; audio→video→audio por
// 'ended' y por siguiente/anterior sin que suenen dos a la vez; progreso y seek sobre el video;
// el MISMO nodo <video> sigue sonando al abrir y cerrar el expandido y se ve en el mini; cero
// POST /api/plays con video; Media Session con título y portada del video; stream abortado → salta
// con aviso; Espacio y volumen sobre el activo; un video que va a empezar con la página oculta se
// salta al siguiente audio. Con SHOTS=1 guarda mini y expandido a 390 y 1440 en shots/sub3/<OUT>.
// Uso: SNAP_BASE=http://localhost:4173 [SHOTS=1] node video-queue-func.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'shots', 'sub3', process.env.OUT ?? 'video-v4');
const SHOTS = !!process.env.SHOTS;
if (SHOTS) mkdirSync(OUT, { recursive: true });

const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const H = { Authorization: `Bearer ${token}` };
const VIDS = (await (await fetch(BASE + '/api/videos', { headers: H })).json()).videos ?? [];
const TRACKS = await (await fetch(BASE + '/api/tracks?limit=5', { headers: H })).json();
const byTitle = (t) => VIDS.find((v) => v.title === t);
const LARGO = byTitle('Largo Para Seek');     // 30 s, con portada
const CORTO = byTitle('Faststart');           // 2,5 s, con portada
const SINPORT = byTitle('Moov Al Final');     // 2,5 s, sin portada
const asVideo = (v) => ({ ...v, kind: 'video' });
const A1 = TRACKS[0], A2 = TRACKS[1];

// WAV sintético (silencio de 8 kHz) para TODO /stream/<id> de audio; /stream/video/ no se toca.
function wav(sec, sr = 8000) {
  const n = sec * sr; const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const W = wav(6);

async function newPage(w, h, mobile) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript((t) => {
    localStorage.setItem('token', t);
    // Registro de TODOS los elementos de medios que alguna vez reproducen (el <audio> vive fuera
    // del DOM) y muestreo de cuántos suenan a la vez.
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
  const plays = [];
  await ctx.route('**/api/plays', (r) => { plays.push(r.request().method()); r.fulfill({ status: 201, contentType: 'application/json', body: '{"added":0,"already":0,"skipped":0}' }); });
  const p = await ctx.newPage();
  return { ctx, p, plays };
}

// Estado de los dos elementos.
const st = (p) => p.evaluate(() => {
  const v = document.querySelector('video.player-video');
  const a = [...window.__els].find((e) => e.tagName === 'AUDIO') ?? null;
  return {
    videos: document.querySelectorAll('video').length,
    audios: [...window.__els].filter((e) => e.tagName === 'AUDIO').length,
    v: v ? { paused: v.paused, t: v.currentTime, src: (v.getAttribute('src') ?? '').split('?')[0], slot: v.dataset.slot, vol: v.volume, dur: v.duration } : null,
    a: a ? { paused: a.paused, src: (a.getAttribute('src') ?? '').split('?')[0] } : null,
    maxBoth: window.__maxBoth,
  };
});
const waitFor = async (p, fn, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const s = await st(p); if (fn(s)) return s; await sleep(100); }
  return st(p);
};
const vPlaying = (id) => (s) => s.v && !s.v.paused && s.v.t > 0 && s.v.src.includes(`/stream/video/${id}`);
const aPlaying = (s) => s.a && !s.a.paused && s.a.src.includes('/stream/') && !(s.v?.src);

// ── 1) Tocar un video en la vista (1440): suena en el <video>, el <audio> pausado ──
{
  const { ctx, p, plays } = await newPage(1440, 900, false);
  await p.goto(BASE + '/videos');
  await p.waitForSelector('.video-card');
  // Primero una canción, para que el <audio> exista y esté sonando antes del video.
  await p.evaluate((t) => window.__player().play([t], 0), A1);
  const s0 = await waitFor(p, aPlaying);
  await p.locator('.video-card', { hasText: 'Largo Para Seek' }).click();
  const s1 = await waitFor(p, vPlaying(LARGO.id));
  ok('tocar_video_suena_en_video', vPlaying(LARGO.id)(s1) && s1.a?.paused === true && s1.a?.src === '', { antes: s0.a, despues: s1 });
  ok('un_solo_audio_y_un_solo_video', s1.videos === 1 && s1.audios === 1, { videos: s1.videos, audios: s1.audios });

  // ── 3) Progreso y seek sobre el video (fixture de 30 s) ──
  // La etiqueta va un timeupdate (~0,25 s) por detrás del elemento: se espera a que el video pase de
  // 2 s y se exige que lo que muestra la barra esté a menos de 1 s de la posición real.
  await waitFor(p, (s) => s.v && s.v.t >= 2);
  const bar = await p.evaluate(() => ({ total: document.querySelector('.time-total')?.textContent, elapsed: document.querySelector('.time-elapsed')?.textContent, t: document.querySelector('video.player-video')?.currentTime }));
  const [mm, ss] = (bar.elapsed ?? '').split(':').map(Number);
  ok('progreso_duracion_real', bar.total === '0:30' && Math.abs(mm * 60 + ss - bar.t) < 1.5 && bar.elapsed !== '0:00', bar);
  const tA = (await st(p)).v.t;
  await p.evaluate(() => window.__player().seek(20));
  await sleep(400);
  const tB = (await st(p)).v.t;
  ok('seek_sobre_video', tB >= 19.5 && tB < 25, { antes: tA, despues: tB });

  // ── 8) Espacio y volumen sobre el activo ──
  await p.locator('body').click({ position: { x: 700, y: 400 } }).catch(() => {});
  await p.keyboard.press('Space');
  await sleep(300);
  const sp1 = await st(p);
  await p.keyboard.press('Space');
  await sleep(300);
  const sp2 = await st(p);
  ok('espacio_pausa_y_reanuda_video', sp1.v.paused === true && sp2.v.paused === false && sp1.a.paused && sp2.a.paused, { pausa: sp1.v.paused, reanuda: !sp2.v.paused });
  const tC = (await st(p)).v.t;
  await p.keyboard.press('ArrowLeft');
  await sleep(300);
  const tD = (await st(p)).v.t;
  ok('flecha_seek_sobre_video', tD < tC - 5, { antes: tC, despues: tD });
  await p.evaluate(() => window.__player().setVolume(0.3));
  ok('volumen_sobre_video', Math.abs((await st(p)).v.vol - 0.3) < 0.01);
  await p.evaluate(() => window.__player().setVolume(1));

  // ── 6) Media Session ──
  const ms = await p.evaluate(() => { const m = navigator.mediaSession?.metadata; return m ? { title: m.title, artist: m.artist, art: m.artwork.map((a) => a.src.split('?')[0]) } : null; });
  ok('mediasession_video_con_portada', ms?.title === LARGO.title && ms?.artist === LARGO.artist && ms.art.length > 0 && ms.art.every((s) => s.includes(`/api/videos/${LARGO.id}/cover`)), ms);

  // ── 5) Cero POST /api/plays: el de 30 s a 4x pasa de sobra el umbral de una canción (15 s) ──
  await p.evaluate(() => { const v = document.querySelector('video.player-video'); v.currentTime = 0; v.playbackRate = 4; });
  await sleep(6500);
  const posPlays = (await st(p)).v.t;
  ok('cero_post_plays_con_video', plays.length === 0 && posPlays > 16, { posts: plays.length, posicion: posPlays });
  await p.evaluate(() => { document.querySelector('video.player-video').playbackRate = 1; });

  // ── 6b) Media Session sin portada ──
  await p.evaluate((v) => window.__player().play([v], 0), asVideo(SINPORT));
  await waitFor(p, vPlaying(SINPORT.id));
  const ms2 = await p.evaluate(() => { const m = navigator.mediaSession?.metadata; return m ? { title: m.title, art: m.artwork.length } : null; });
  ok('mediasession_video_sin_portada', ms2?.title === SINPORT.title && ms2.art === 0, ms2);
  ok('nunca_dos_a_la_vez_1', (await st(p)).maxBoth <= 1, { maxBoth: (await st(p)).maxBoth });
  await ctx.close();
}

// ── 2) audio→video→audio por 'ended' y por siguiente/anterior ──
{
  const { ctx, p } = await newPage(1440, 900, false);
  await p.goto(BASE + '/');
  await p.waitForSelector('.player-bar');
  await p.evaluate(({ a1, v, a2 }) => window.__player().play([a1, v, a2], 0), { a1: A1, v: asVideo(CORTO), a2: A2 });
  await waitFor(p, aPlaying);
  await p.evaluate(() => window.__player().seek(5));          // WAV de 6 s → 'ended' en ~1 s
  const e1 = await waitFor(p, vPlaying(CORTO.id));
  ok('ended_audio_a_video', vPlaying(CORTO.id)(e1) && e1.a.paused && e1.a.src === '', e1);
  const e2 = await waitFor(p, (s) => aPlaying(s) && s.v.src === '', 9000);   // el video de 2,5 s termina solo
  ok('ended_video_a_audio', aPlaying(e2) && e2.v.paused && e2.v.src === '', e2);
  await p.evaluate(() => window.__player().prev());            // < 3 s → la anterior (el video)
  const e3 = await waitFor(p, vPlaying(CORTO.id));
  ok('anterior_audio_a_video', vPlaying(CORTO.id)(e3) && e3.a.paused && e3.a.src === '', e3);
  await p.evaluate(() => window.__player().next());
  const e4 = await waitFor(p, aPlaying);
  ok('siguiente_video_a_audio', aPlaying(e4) && e4.v.paused, e4);
  await p.evaluate(() => window.__player().prev());
  await waitFor(p, vPlaying(CORTO.id));
  await p.evaluate(() => window.__player().prev());            // video < 3 s → la anterior (audio)
  const e5 = await waitFor(p, aPlaying);
  await p.evaluate(() => window.__player().next());
  const e6 = await waitFor(p, vPlaying(CORTO.id));
  ok('anterior_y_siguiente_ida_y_vuelta', aPlaying(e5) && vPlaying(CORTO.id)(e6), { e5: aPlaying(e5), e6: vPlaying(CORTO.id)(e6) });
  ok('nunca_dos_a_la_vez_2', (await st(p)).maxBoth <= 1, { maxBoth: (await st(p)).maxBoth });

  // ── 9) Página oculta: un video que va a EMPEZAR se salta al siguiente audio ──
  await p.evaluate(({ a1, v, a2 }) => window.__player().play([a1, v, a2], 0), { a1: A1, v: asVideo(CORTO), a2: A2 });
  await waitFor(p, aPlaying);
  await p.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
  await p.evaluate(() => window.__player().next());
  await sleep(800);
  const hid = await st(p);
  const titulo = await p.evaluate(() => document.querySelector('.player-title')?.textContent);
  ok('oculta_salta_video_a_audio', aPlaying(hid) && hid.v.src === '' && titulo === (A2.title ?? 'Sin título'), { titulo, a: hid.a, v: hid.v });
  await ctx.close();
}

// ── 7) Stream abortado: salta con aviso ──
{
  const { ctx, p } = await newPage(1440, 900, false);
  await ctx.route(`**/stream/video/${CORTO.id}**`, (r) => r.abort('failed'));
  await p.goto(BASE + '/');
  await p.waitForSelector('.player-bar');
  await p.evaluate(({ v1, v2 }) => window.__player().play([v1, v2], 0), { v1: asVideo(CORTO), v2: asVideo(LARGO) });
  const s = await waitFor(p, vPlaying(LARGO.id));
  const toasts = await p.evaluate(() => [...document.querySelectorAll('.toast.warning .toast-text')].map((t) => t.textContent));
  ok('stream_abortado_salta_con_aviso', vPlaying(LARGO.id)(s) && toasts.some((t) => t.includes('No se pudo reproducir el video')), { toasts, suena: s.v?.src });
  await ctx.close();
}

// ── 4) El MISMO nodo, sonando, al abrir y cerrar el expandido; visible en el mini (390 y 1440) ──
for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]]) {
  const { ctx, p } = await newPage(w, h, mobile);
  await p.goto(BASE + '/videos');
  await p.waitForSelector('.video-card');
  await p.locator('.video-card', { hasText: 'Largo Para Seek' }).click();
  await waitFor(p, vPlaying(LARGO.id));
  await sleep(300);
  const rectOk = (slot) => p.evaluate((slot) => {
    const v = document.querySelector('video.player-video');
    const s = document.querySelector(`[data-video-slot="${slot}"]`);
    if (!v || !s) return { ok: false };
    const a = v.getBoundingClientRect(), b = s.getBoundingClientRect();
    const d = Math.max(Math.abs(a.left - b.left), Math.abs(a.top - b.top), Math.abs(a.width - b.width), Math.abs(a.height - b.height));
    return { ok: d < 2 && getComputedStyle(v).visibility === 'visible', d: Math.round(d), slot: v.dataset.slot };
  }, slot);
  await p.evaluate(() => { window.__v = document.querySelector('video.player-video'); });
  const mini0 = await rectOk('mini');
  if (SHOTS) await p.screenshot({ path: join(OUT, `mini-${w}.png`) });
  const t0 = (await st(p)).v.t;
  await p.locator('[data-video-slot="mini"]').click();
  await p.waitForSelector('.player-expanded');
  await sleep(700);
  const exp = await rectOk('exp');
  const sE = await st(p);
  const same1 = await p.evaluate(() => document.querySelector('video.player-video') === window.__v);
  if (SHOTS) await p.screenshot({ path: join(OUT, `expandido-${w}.png`) });
  await p.keyboard.press('Escape');
  await p.waitForSelector('.player-expanded', { state: 'detached' });
  await sleep(500);
  const mini1 = await rectOk('mini');
  const sM = await st(p);
  const same2 = await p.evaluate(() => document.querySelector('video.player-video') === window.__v);
  ok(`expandido_mismo_nodo_sonando_${w}`, same1 && same2 && !sE.v.paused && !sM.v.paused && sM.v.t > t0, { same1, same2, t0, tExp: sE.v.t, tMini: sM.v.t });
  ok(`video_en_el_hueco_${w}`, mini0.ok && exp.ok && mini1.ok && exp.slot === 'exp' && mini1.slot === 'mini', { mini0, exp, mini1 });
  await ctx.close();
}

const fails = Object.entries(R).filter(([, v]) => v === false || (v && typeof v === 'object' && v.ok === false)).map(([k]) => k);
console.log(JSON.stringify(R, null, 1));
console.log(`\nvideo-queue-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
