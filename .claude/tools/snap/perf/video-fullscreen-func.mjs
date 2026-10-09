// video-fullscreen-func.mjs — funcional de T27: PANTALLA COMPLETA del video (envoltorio .player-video-layer
// + controles propios + tecla F). Corre contra un backend con VIDEO_DIR = los 3 fixtures (como lo arma
// regresion.mjs). El audio es un WAV sintético servido por /stream/<id>; el video es el real del backend.
// Como video-ui-func, arma la cola desde el value de PlayerContext (lectura del fiber de React).
//
// Comprueba, en Chromium a 1440 (y la presencia del botón a 390):
//   · el botón del expandido y la tecla F entran; document.fullscreenElement es el ENVOLTORIO;
//   · el <video> ocupa toda la pantalla con object-fit contain, sin transform y sin radio (también si
//     se entra con el expandido cerrado, desde el hueco del mini, que es cover);
//   · el foco va a la capa; los controles hacen play/pausa, anterior/siguiente y seek; clic sobre el
//     fondo = play/pausa; doble clic = salir;
//   · auto-ocultado a ~2,5 s sonando (y cursor oculto); con pausa no se ocultan; mover el puntero los trae;
//   · video→video sigue en pantalla completa; video→canción sale;
//   · el aviso de error de un video que no carga se ve DENTRO de la capa;
//   · al salir, el rAF devuelve el <video> al hueco del expandido;
//   · la F no hace nada sin video, con un campo de texto enfocado ni con el menú contextual abierto;
//   · un Esc SINTÉTICO (CDP: no pasa por la interfaz del navegador) con pantalla completa no cierra el
//     expandido de abajo. El Esc REAL de Chrome/Edge no se puede medir desde acá.
// HEADED=1 lo corre con ventana (para comparar headless contra una pantalla completa real).
// Con SHOTS=1 guarda la capa con controles visibles y ocultos en shots/sub3/<OUT>.
// Uso: SNAP_BASE=http://localhost:4173 [HEADED=1] [SHOTS=1] node video-fullscreen-func.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const HEADED = !!process.env.HEADED;
const browser = await chromium.launch({ headless: !HEADED, args: ['--autoplay-policy=no-user-gesture-required', ...(HEADED ? ['--window-size=1440,900'] : [])] });
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'shots', 'sub3', process.env.OUT ?? 'video-fullscreen');
const SHOTS = !!process.env.SHOTS;
if (SHOTS) mkdirSync(OUT, { recursive: true });

const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const H = { Authorization: `Bearer ${token}` };
const VIDS = (await (await fetch(BASE + '/api/videos', { headers: H })).json()).videos ?? [];
const TRACKS = await (await fetch(BASE + '/api/tracks?limit=5', { headers: H })).json();
const byTitle = (t) => VIDS.find((v) => v.title === t);
const LARGO = { ...byTitle('Largo Para Seek'), kind: 'video' };   // 30 s
const FAST  = { ...byTitle('Faststart'), kind: 'video' };         // 2,5 s
const ROTO  = { id: 'ffffffffffffffff', title: 'Video Roto', artist: 'Nadie', kind: 'video', has_cover: false };   // 404 → error
const A1 = TRACKS[0];

function wav(sec, sr = 8000) {
  const n = sec * sr; const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const W = wav(60);

async function newPage(w, h, mobile) {
  // HEADED en escritorio: sin viewport emulado (viewport: null), así la pantalla completa cambia de
  // verdad el tamaño de la ventana y se puede comparar contra headless.
  const ctx = await browser.newContext(HEADED && !mobile ? { viewport: null } : { viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
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
  await ctx.route('**/api/plays', (r) => r.fulfill({ status: 201, contentType: 'application/json', body: '{"added":0,"already":0,"skipped":0}' }));
  const p = await ctx.newPage();
  return { ctx, p };
}

const suenaVideo = (p) => p.evaluate(() => window.__player()?.currentTrack?.kind === 'video');
const fsClass = (p) => p.evaluate(() => (document.fullscreenElement ?? document.webkitFullscreenElement)?.className ?? null);
const isFsLayer = async (p) => (await fsClass(p))?.split(' ').includes('player-video-layer') ?? false;
const waitVideoTitle = (p, title) => p.waitForFunction((t) => {
  const v = document.querySelector('video.player-video');
  return document.querySelector('.player-title')?.textContent === t && v && !v.paused && v.currentTime > 0;
}, title, { timeout: 8000 });
// Geometría del <video> en pantalla completa contra el viewport.
const geo = (p) => p.evaluate(() => {
  const v = document.querySelector('video.player-video');
  const cs = getComputedStyle(v); const r = v.getBoundingClientRect();
  return { fit: cs.objectFit, transform: cs.transform, radius: cs.borderRadius, visibility: cs.visibility,
    rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], vp: [innerWidth, innerHeight] };
});
const llena = (g) => g.fit === 'contain' && g.transform === 'none' && g.radius === '0px' && g.visibility === 'visible'
  && g.rect[0] === 0 && g.rect[1] === 0 && g.rect[2] === g.vp[0] && g.rect[3] === g.vp[1];
// Despertar los controles antes de tocar uno (ocultos no reciben puntero: el clic caería en el fondo).
async function wake(p) { await p.mouse.move(700, 300); await p.mouse.move(720, 320); await sleep(150); }
async function ctl(p, label) { await wake(p); await p.locator(`.vfs button[aria-label="${label}"]`).click(); }
async function openExpanded(p) {
  await p.locator('[data-video-slot="mini"]').click();
  await p.waitForSelector('.player-expanded');
  await sleep(600);
}

// ── 1440: el recorrido completo ──
{
  const { ctx, p } = await newPage(1440, 900, false);
  await p.goto(BASE + '/');
  await p.waitForSelector('.player-bar');
  await p.evaluate((q) => window.__player().play(q, 0), [LARGO, FAST, A1]);
  await waitVideoTitle(p, LARGO.title);
  await openExpanded(p);

  // Entrar con el botón del expandido (fila de escritorio).
  const antes = await p.evaluate(() => [innerWidth, innerHeight, screen.width, screen.height]);
  ok('boton_en_fila_escritorio', await p.locator('.exp-actions .exp-fullscreen').isVisible());
  await p.locator('.exp-actions .exp-fullscreen').click();
  await p.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 4000 }).catch(() => {});
  await sleep(300);
  ok('boton_entra_envoltorio', await isFsLayer(p), { fullscreenElement: await fsClass(p),
    ventana_antes: antes, ventana_en_fs: await (HEADED ? sleep(2000) : Promise.resolve()).then(() => p.evaluate(() => [innerWidth, innerHeight, screen.width, screen.height])) });
  const g1 = await geo(p);
  ok('video_llena_contain_sin_transform_ni_radio', llena(g1), g1);
  ok('foco_en_la_capa', await p.evaluate(() => document.activeElement?.classList.contains('vfs') ?? false));
  ok('controles_dentro_del_envoltorio', await p.evaluate(() => !!document.querySelector('.player-video-layer > .vfs')));
  if (SHOTS) await p.screenshot({ path: join(OUT, 'fs-controles-1440.png') });

  // Esc sintético: no corre la escalera (el expandido sigue).
  await p.keyboard.press('Escape');
  await sleep(300);
  ok('esc_sintetico_no_cierra_expandido', await p.locator('.player-expanded').count() === 1);

  // Play/pausa desde el botón y desde el fondo.
  await ctl(p, 'Pausar');
  await sleep(250);
  ok('boton_pausa', await p.evaluate(() => document.querySelector('video.player-video').paused));
  await ctl(p, 'Reproducir');
  await sleep(400);
  ok('boton_reproduce', await p.evaluate(() => !document.querySelector('video.player-video').paused));
  await p.mouse.click(720, 450);
  await sleep(250);
  ok('clic_fondo_pausa', await p.evaluate(() => document.querySelector('video.player-video').paused));
  // Con pausa no se ocultan.
  await sleep(3000);
  ok('pausa_no_oculta', await p.evaluate(() => !document.querySelector('.vfs').classList.contains('vfs--hidden')));
  await p.mouse.click(720, 450);
  await sleep(300);
  ok('clic_fondo_reproduce', await p.evaluate(() => !document.querySelector('video.player-video').paused));

  // Seek con la barra.
  await wake(p);
  await p.evaluate(() => {
    const el = document.querySelector('.vfs-seek input[type="range"]');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, '20'); el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(400);
  const tSeek = await p.evaluate(() => document.querySelector('video.player-video').currentTime);
  ok('seek_barra', tSeek >= 19.5 && tSeek < 23, { currentTime: tSeek });
  ok('tiempo_visible', /^\d+:\d\d \/ 0:30$/.test(await p.locator('.vfs-time').textContent()), { texto: await p.locator('.vfs-time').textContent() });

  // Auto-ocultado sonando: sin mover el puntero > 2,5 s.
  await p.evaluate(() => window.__player().seek(2));
  await sleep(3100);
  const oculto = await p.evaluate(() => ({ vfs: document.querySelector('.vfs').classList.contains('vfs--hidden'),
    cursor: getComputedStyle(document.querySelector('.player-video-layer')).cursor }));
  ok('auto_oculta_y_sin_cursor', oculto.vfs && oculto.cursor === 'none', oculto);
  if (SHOTS) await p.screenshot({ path: join(OUT, 'fs-oculto-1440.png') });
  await wake(p);
  ok('mover_puntero_los_trae', await p.evaluate(() => !document.querySelector('.vfs').classList.contains('vfs--hidden')));

  // Video → video: sigue en pantalla completa.
  await ctl(p, 'Siguiente');
  await waitVideoTitle(p, FAST.title).catch(() => {});
  ok('video_a_video_sigue', await isFsLayer(p) && (await p.locator('.vfs-title').textContent()) === FAST.title,
    { titulo: await p.locator('.vfs-title').textContent().catch(() => null) });
  // Anterior: vuelve al largo, sigue en pantalla completa.
  await ctl(p, 'Anterior');
  await waitVideoTitle(p, LARGO.title).catch(() => {});
  ok('anterior', await isFsLayer(p) && (await p.locator('.vfs-title').textContent()) === LARGO.title);
  // Salir con el botón: el rAF devuelve el <video> al hueco del expandido.
  await ctl(p, 'Salir de pantalla completa');
  await p.waitForFunction(() => !document.fullscreenElement, null, { timeout: 4000 }).catch(() => {});
  await sleep(400);
  const back = await p.evaluate(() => {
    const v = document.querySelector('video.player-video'); const s = document.querySelector('[data-video-slot="exp"]');
    const a = v.getBoundingClientRect(); const b = s.getBoundingClientRect();
    return { slot: v.dataset.slot, d: Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.width - b.width), Math.abs(a.height - b.height)),
      vfs: !!document.querySelector('.vfs') };
  });
  ok('salir_vuelve_al_hueco', !(await fsClass(p)) && back.slot === 'exp' && back.d <= 1 && !back.vfs, back);

  // Doble clic sale.
  await p.locator('.exp-actions .exp-fullscreen').click();
  await p.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 4000 }).catch(() => {});
  await sleep(300);
  await p.mouse.dblclick(720, 450);
  await p.waitForFunction(() => !document.fullscreenElement, null, { timeout: 4000 }).catch(() => {});
  ok('doble_clic_sale', !(await fsClass(p)));

  // Aviso de error dentro de la capa: el siguiente no carga, se salta a un video y sigue en pantalla completa.
  await p.evaluate((q) => window.__player().play(q, 0), [LARGO, ROTO, FAST, A1]);
  await waitVideoTitle(p, LARGO.title);
  await p.locator('.exp-actions .exp-fullscreen').click();
  await p.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 4000 }).catch(() => {});
  await sleep(300);
  await ctl(p, 'Siguiente');
  const aviso = await p.waitForFunction(() => document.querySelector('.player-video-layer .vfs-notice')?.textContent ?? false, null, { timeout: 6000 })
    .then((h) => h.jsonValue()).catch(() => null);
  ok('aviso_error_dentro_de_la_capa', !!aviso && /No se pudo reproducir el video/.test(aviso) && await isFsLayer(p), { aviso });
  if (SHOTS) await p.screenshot({ path: join(OUT, 'fs-aviso-1440.png') });
  // Video → canción: sale sola (el corto de 2,5 s termina y pasa a A1, o se pide siguiente).
  await waitVideoTitle(p, FAST.title).catch(() => {});
  await ctl(p, 'Siguiente').catch(() => {});
  await p.waitForFunction(() => !document.fullscreenElement, null, { timeout: 6000 }).catch(() => {});
  await sleep(300);
  const tit = await p.locator('.player-expanded .exp-title').textContent().catch(() => null);
  ok('video_a_cancion_sale', tit === (A1.title || 'Sin título') && !(await fsClass(p)) && !(await p.locator('.vfs').count()), { titulo: tit });

  // ── Tecla F ──
  // Sin video (suena A1): no hace nada.
  await p.keyboard.press('Escape'); await sleep(400);   // cierra el expandido
  await p.keyboard.press('f'); await sleep(500);
  ok('f_sin_video_nada', !(await fsClass(p)));
  // Con video y el expandido CERRADO: entra desde el hueco del mini (cover) y queda contain.
  await p.evaluate((q) => window.__player().play(q, 0), [LARGO, A1]);
  await waitVideoTitle(p, LARGO.title);
  await p.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await p.evaluate(() => document.activeElement?.blur?.());
  await p.keyboard.press('f');
  await p.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 4000 }).catch(() => {});
  await sleep(300);
  const g2 = await geo(p);
  ok('f_entra_desde_mini_contain', await isFsLayer(p) && llena(g2), g2);
  await p.keyboard.press('f');
  await p.waitForFunction(() => !document.fullscreenElement, null, { timeout: 4000 }).catch(() => {});
  await sleep(300);
  ok('f_sale', !(await fsClass(p)) && await p.evaluate(() => document.querySelector('video.player-video').dataset.slot === 'mini'));
  // Con un campo de texto enfocado: escribe la "f", no entra.
  await p.locator('.search-box input').click();
  await p.keyboard.press('f'); await sleep(500);
  ok('f_con_campo_de_texto_nada', await suenaVideo(p) && !(await fsClass(p)) && (await p.locator('.search-box input').inputValue()).includes('f'));
  await p.locator('.search-box input').fill('');
  await p.evaluate(() => document.activeElement?.blur?.());
  // Con el menú contextual abierto: no entra.
  await p.locator('.sidebar :is(a, button)', { hasText: 'Videos' }).first().click().catch(async () => {
    await p.locator(':is(a, button)', { hasText: /^Videos$/ }).first().click();
  });
  await p.waitForSelector('.video-card');
  await p.locator('.video-card').first().click({ button: 'right' });
  await p.waitForSelector('.ctx-menu');
  await p.keyboard.press('f'); await sleep(500);
  ok('f_con_menu_abierto_nada', await suenaVideo(p) && !(await fsClass(p)) && await p.locator('.ctx-menu').count() === 1);
  await p.keyboard.press('Escape');
  await ctx.close();
}

// ── 390 (teléfono emulado): el botón vive en la fila del header (exp-head-actions) y entra ──
{
  const { ctx, p } = await newPage(390, 844, true);
  await p.goto(BASE + '/');
  await p.waitForSelector('.player-bar');
  await p.evaluate((q) => window.__player().play(q, 0), [LARGO, A1]);
  await waitVideoTitle(p, LARGO.title);
  await openExpanded(p);
  const vis = await p.evaluate(() => ({
    head: !!document.querySelector('.exp-head-actions .exp-fullscreen')?.offsetParent,
    desk: !!document.querySelector('.exp-actions .exp-fullscreen')?.offsetParent,
  }));
  ok('390_boton_en_header_movil', vis.head && !vis.desk, vis);
  await p.locator('.exp-head-actions .exp-fullscreen').click();
  await p.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 4000 }).catch(() => {});
  await sleep(300);
  const g3 = await geo(p);
  ok('390_entra_y_llena', await isFsLayer(p) && llena(g3), g3);
  if (SHOTS) await p.screenshot({ path: join(OUT, 'fs-controles-390.png') });
  await ctx.close();
}

const fails = Object.entries(R).filter(([, v]) => v === false || (v && typeof v === 'object' && v.ok === false)).map(([k]) => k);
console.log(JSON.stringify(R, null, 1));
console.log(`\nvideo-fullscreen-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
