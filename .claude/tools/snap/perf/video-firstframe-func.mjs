// video-firstframe-func.mjs — T30 · P2: el CUADRO NEGRO al arrancar un video. Hasta el primer fotograma
// el <video> queda oculto y el hueco (mini / expandido) muestra la portada del video, o el ♪ si no tiene.
// Corre contra un backend con VIDEO_DIR = los 3 fixtures (como lo arma regresion.mjs). El audio es un WAV
// sintético servido por /stream/<id>. Arma la cola desde el value de PlayerContext (fiber de React).
//
// Muestrea en CADA frame (rAF) la visibilidad del <video>, su readyState, data-ready y lo que hay en el
// hueco, con red LOCAL y con red LENTA (CDP: 4 Mbps, 150 ms). Comprueba:
//   · canción → video (con portada): antes del primer fotograma el <video> está oculto y el hueco del
//     mini muestra la portada del video (/api/videos/<id>/cover); después se ve el video;
//   · video sin portada: antes del primer fotograma, oculto y el hueco es el ♪;
//   · video → video: vuelve a ocultarse hasta el primer fotograma del nuevo, con la portada del nuevo;
//   · un video que falla nunca se muestra (y el siguiente sí, al tener fotograma);
//   · expandido: la portada del video en el hueco (contain), oculto hasta el primer fotograma;
//   · pantalla completa entrando ANTES del primer fotograma: el <video> se ve (como en 1.27.0) y al
//     tener fotograma sigue visible; al salir vuelve al hueco;
//   · video → canción: el <video> queda oculto y sin marca;
//   · ninguna petición a la portada de PISTA con el id de un video (/api/tracks/<hex>/…).
// "negro_ms" = tiempo en que el <video> estuvo VISIBLE sin fotograma (readyState < 2) sobre el hueco:
// es el cuadro negro. Se imprime para comparar antes/después.
// Uso: SNAP_BASE=http://localhost:4173 node video-firstframe-func.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';

await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const H = { Authorization: `Bearer ${token}` };
const VIDS = (await (await fetch(BASE + '/api/videos', { headers: H })).json()).videos ?? [];
const TRACKS = await (await fetch(BASE + '/api/tracks?limit=5', { headers: H })).json();
const byTitle = (t) => ({ ...VIDS.find((v) => v.title === t), kind: 'video' });
const LARGO = byTitle('Largo Para Seek');   // con portada, 30 s
const FAST  = byTitle('Faststart');         // con portada, 2,5 s
const MOOV  = byTitle('Moov Al Final');     // SIN portada
const ROTO  = { id: 'ffffffffffffffff', title: 'Video Roto', artist: 'Nadie', kind: 'video', has_cover: false };
const A1 = TRACKS[0];
const HEX = new Set([...VIDS.map((v) => v.id), ROTO.id]);

function wav(sec, sr = 8000) {
  const n = sec * sr; const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const W = wav(60);

async function newPage(lenta) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem('token', t);
    window.__player = () => {
      const root = document.getElementById('root');
      const key = Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
      const st = [root[key]];
      while (st.length) {
        const f = st.pop(); if (!f) continue;
        const v = f.memoizedProps?.value;
        if (v && typeof v.play === 'function' && typeof v.addToQueue === 'function') return v;
        if (f.sibling) st.push(f.sibling); if (f.child) st.push(f.child);
      }
      return null;
    };
    // Muestreo por frame: estado del <video> y del hueco activo.
    window.__sample = (label) => {
      window.__s = []; window.__on = true;
      const tick = () => {
        if (!window.__on) return;
        const v = document.querySelector('video.player-video');
        const slot = v.dataset.slot;
        const hueco = slot ? document.querySelector(`[data-video-slot="${slot}"]`) : null;
        window.__s.push({ t: performance.now(), vis: getComputedStyle(v).visibility, rs: v.readyState, ready: v.dataset.ready ?? null, slot,
          fs: !!document.fullscreenElement, hueco: hueco ? (hueco.tagName === 'IMG' ? 'img:' + (hueco.getAttribute('src') ?? '').split('?')[0] : 'placeholder:' + hueco.textContent) : null,
          huecoCls: hueco?.className ?? null, label });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    window.__stop = () => { window.__on = false; return window.__s; };
  }, token);
  await ctx.route((u) => u.pathname.startsWith('/stream/') && !u.pathname.startsWith('/stream/video/'), (r) => {
    const h = r.request().headers().range; const total = W.length;
    if (!h) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: W });
    const m = /bytes=(\d*)-(\d*)/.exec(h); const start = m[1] ? +m[1] : 0; const end = m[2] ? +m[2] : total - 1;
    r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: W.subarray(start, end + 1) });
  });
  await ctx.route('**/api/plays', (r) => r.fulfill({ status: 201, contentType: 'application/json', body: '{"added":0,"already":0,"skipped":0}' }));
  const reqs = [];
  ctx.on('request', (r) => reqs.push(new URL(r.url()).pathname));
  const p = await ctx.newPage();
  if (lenta) {
    const c = await ctx.newCDPSession(p);
    await c.send('Network.enable');
    await c.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 4e6 / 8, uploadThroughput: 1e6 / 8 });
  }
  return { ctx, p, reqs };
}

// Análisis de una tanda de muestras de UN video (desde que es el actual hasta que tiene fotograma).
function analizar(s, { cover }) {
  const pre = s.filter((x) => x.slot && x.rs < 2 && !x.fs);
  const post = s.filter((x) => x.ready === '1' && x.slot && !x.fs);
  const negro = s.filter((x) => x.slot && x.rs < 2 && x.vis === 'visible' && !x.fs);
  const negroMs = negro.length ? Math.round(negro.at(-1).t - negro[0].t + 16) : 0;
  // El hueco esperado: la portada del video nuevo o el ♪. Se toleran hasta 3 frames INICIALES con el
  // hueco anterior (la portada de lo que sonaba antes): playIndex oculta el <video> y cambia el src en
  // el acto, y el render de React con la pista nueva puede llegar un frame después. No es negro: el
  // <video> ya está oculto y se ve la portada anterior. Se cuentan y se reportan.
  const esperado = (x) => (cover ? x.hueco === 'img:' + cover : x.hueco?.startsWith('placeholder:'));
  let previos = 0;
  while (previos < pre.length && !esperado(pre[previos])) previos++;
  const huecoOk = previos <= 3 && pre.slice(previos).every(esperado);
  return {
    pre_frames: pre.length, pre_oculto: pre.length > 0 && pre.every((x) => x.vis === 'hidden'), pre_hueco_ok: pre.length > 0 && huecoOk,
    frames_hueco_anterior: previos,
    post_frames: post.length, post_visible: post.length > 0 && post.every((x) => x.vis === 'visible'), negro_ms: negroMs,
    hueco_visto: [...new Set(pre.map((x) => x.hueco))],
  };
}
const coverOf = (v) => `/api/videos/${v.id}/cover`;
const esperarListo = (p, ms = 15000) => p.waitForFunction(() => document.querySelector('video.player-video').dataset.ready === '1', null, { timeout: ms }).then(() => true).catch(() => false);
const tabla = [];

for (const red of ['local', 'lenta']) {
  const { ctx, p, reqs } = await newPage(red === 'lenta');
  await p.goto(BASE + '/');
  await p.waitForSelector('.player-bar');

  // canción → video con portada (mini)
  await p.evaluate((q) => window.__player().play(q, 0), [A1, LARGO, FAST]);
  await sleep(800);
  await p.evaluate(() => window.__sample('cancion_a_video'));
  await p.evaluate(() => window.__player().next());
  await esperarListo(p); await sleep(250);
  let a = analizar(await p.evaluate(() => window.__stop()), { cover: coverOf(LARGO) });
  ok(`${red}_cancion_a_video_oculto_con_portada`, a.pre_oculto && a.pre_hueco_ok && a.post_visible, a);
  tabla.push(`${red.padEnd(6)} · canción→video (portada)   · ${a.pre_frames} frames antes · negro ${a.negro_ms} ms · hueco anterior ${a.frames_hueco_anterior} fr`);

  // video → video (mini), con portada del nuevo
  await p.evaluate(() => window.__sample('video_a_video'));
  await p.evaluate(() => window.__player().next());
  await esperarListo(p); await sleep(150);
  a = analizar((await p.evaluate(() => window.__stop())).filter((x) => x.t > 0), { cover: coverOf(FAST) });
  // las primeras muestras pueden ser todavía del video anterior (ya listo): se cuentan desde que se borra la marca
  ok(`${red}_video_a_video_oculto_con_portada_nueva`, a.pre_oculto && a.pre_hueco_ok && a.post_visible, a);
  tabla.push(`${red.padEnd(6)} · video→video (portada)     · ${a.pre_frames} frames antes · negro ${a.negro_ms} ms · hueco anterior ${a.frames_hueco_anterior} fr`);

  // video SIN portada: el hueco es el ♪
  await p.evaluate(() => window.__sample('sin_portada'));
  await p.evaluate((q) => window.__player().play(q, 0), [MOOV, A1]);
  await esperarListo(p); await sleep(150);
  a = analizar(await p.evaluate(() => window.__stop()), { cover: null });
  ok(`${red}_sin_portada_oculto_con_nota`, a.pre_oculto && a.pre_hueco_ok && a.post_visible, a);
  tabla.push(`${red.padEnd(6)} · video sin portada (♪)     · ${a.pre_frames} frames antes · negro ${a.negro_ms} ms · hueco anterior ${a.frames_hueco_anterior} fr`);

  // video que FALLA: nunca visible; el siguiente sí
  await p.evaluate(() => window.__sample('falla'));
  await p.evaluate((q) => window.__player().play(q, 0), [ROTO, FAST, A1]);
  await p.waitForFunction((t) => document.querySelector('.player-title')?.textContent === t, FAST.title, { timeout: 15000 }).catch(() => {});
  await esperarListo(p); await sleep(150);
  const sF = await p.evaluate(() => window.__stop());
  const roto = sF.filter((x) => x.rs < 2 && x.slot && x.vis === 'visible');
  ok(`${red}_video_que_falla_no_se_ve`, roto.length === 0 && sF.some((x) => x.ready === '1' && x.vis === 'visible'), { visible_sin_fotograma: roto.length });

  // expandido: portada del video en el hueco (contain) y oculto hasta el primer fotograma
  await p.evaluate((q) => window.__player().play(q, 0), [A1, LARGO]);
  await sleep(500);
  await p.locator('.player-art, .player-art-placeholder').first().click();
  await p.waitForSelector('.player-expanded'); await sleep(600);
  await p.evaluate(() => window.__sample('expandido'));
  await p.evaluate(() => window.__player().next());
  await esperarListo(p); await sleep(250);
  const sE = await p.evaluate(() => window.__stop());
  a = analizar(sE.filter((x) => x.slot === 'exp'), { cover: coverOf(LARGO) });
  const contain = await p.evaluate(() => { const i = document.querySelector('[data-video-slot="exp"]'); return i?.classList.contains('exp-art--video') && getComputedStyle(i).objectFit === 'contain'; });
  ok(`${red}_expandido_oculto_con_portada_contain`, a.pre_oculto && a.pre_hueco_ok && a.post_visible && contain, { ...a, contain });
  tabla.push(`${red.padEnd(6)} · expandido (portada)       · ${a.pre_frames} frames antes · negro ${a.negro_ms} ms · hueco anterior ${a.frames_hueco_anterior} fr`);

  // pantalla completa ANTES del primer fotograma (sólo tiene sentido con red lenta: con red local el
  // primer fotograma llega antes de poder hacer clic). El <video> se ve en pantalla completa como en
  // 1.27.0, sigue visible al tener fotograma y al salir vuelve al hueco.
  if (red === 'lenta') {
    await p.evaluate((q) => window.__player().play(q, 0), [FAST, LARGO]);
    await esperarListo(p);
    await p.evaluate(() => window.__player().next());   // LARGO: tarda ~3 s en tener fotograma
    await sleep(100);
    const antes = await p.evaluate(() => document.querySelector('video.player-video').readyState);
    await p.locator('.exp-actions .exp-fullscreen').click();
    await p.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 4000 }).catch(() => {});
    const enFs = await p.evaluate(() => { const v = document.querySelector('video.player-video'); return { rs: v.readyState, vis: getComputedStyle(v).visibility, fs: document.fullscreenElement?.className ?? null }; });
    await esperarListo(p); await sleep(200);
    const listo = await p.evaluate(() => getComputedStyle(document.querySelector('video.player-video')).visibility);
    await p.evaluate(() => document.exitFullscreen());
    await p.waitForFunction(() => !document.fullscreenElement, null, { timeout: 4000 }).catch(() => {});
    await sleep(300);
    const fuera = await p.evaluate(() => { const v = document.querySelector('video.player-video'); return { vis: getComputedStyle(v).visibility, slot: v.dataset.slot }; });
    ok('lenta_pantalla_completa_antes_del_fotograma', antes < 2 && enFs.rs < 2 && enFs.fs === 'player-video-layer' && enFs.vis === 'visible' && listo === 'visible' && fuera.vis === 'visible' && fuera.slot === 'exp',
      { readyState_al_pedir: antes, en_fs: enFs, al_tener_fotograma: listo, al_salir: fuera });
    // Cuánto se ve negro EN pantalla completa en video→video (dato para decidir un poster).
    await p.locator('.exp-actions .exp-fullscreen').click();
    await p.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 4000 }).catch(() => {});
    await p.evaluate((q) => { const pl = window.__player(); pl.addToQueue(q); }, [FAST]);
    const t0 = Date.now();
    await p.evaluate(() => window.__player().next());
    await p.waitForFunction(() => document.querySelector('video.player-video').readyState < 2, null, { timeout: 3000 }).catch(() => {});
    await esperarListo(p);
    R.info_negro_en_pantalla_completa_video_a_video_ms = Date.now() - t0;
    await p.evaluate(() => document.exitFullscreen()).catch(() => {});
    await sleep(300);
    await p.keyboard.press('Escape'); await sleep(400);
  } else {
    await p.keyboard.press('Escape'); await sleep(400);
  }

  // video → canción: oculto y sin marca
  await p.evaluate((q) => window.__player().play(q, 0), [FAST, A1]);
  await esperarListo(p);
  await p.evaluate(() => window.__player().next());
  await p.waitForFunction((t) => document.querySelector('.player-title')?.textContent === t, A1.title || 'Sin título', { timeout: 8000 }).catch(() => {});
  await sleep(300);
  const vc = await p.evaluate(() => { const v = document.querySelector('video.player-video'); return { vis: getComputedStyle(v).visibility, ready: v.dataset.ready ?? null, slot: v.dataset.slot, src: v.getAttribute('src') }; });
  ok(`${red}_video_a_cancion_oculto_sin_marca`, vc.vis === 'hidden' && vc.ready === null && vc.slot === '' && !vc.src, vc);

  // ninguna portada de PISTA pedida con el id de un video
  const malas = reqs.filter((u) => u.startsWith('/api/tracks/') && [...HEX].some((id) => u.includes(id)));
  ok(`${red}_sin_portada_de_pista_con_id_de_video`, malas.length === 0, { malas });
  await ctx.close();
}

const fails = Object.entries(R).filter(([, v]) => v === false || (v && typeof v === 'object' && v.ok === false)).map(([k]) => k);
console.log(JSON.stringify(R, null, 1));
console.log('\nred    · caso                      · frames antes del 1er fotograma · cuadro negro');
for (const l of tabla) console.log(l);
console.log(`\nvideo-firstframe-func: ${Object.keys(R).filter((k) => !k.startsWith('info_')).length - fails.length}/${Object.keys(R).filter((k) => !k.startsWith('info_')).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
