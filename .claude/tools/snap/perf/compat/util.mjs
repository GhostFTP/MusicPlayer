// compat/util.mjs — perfiles y primitivas del arnés de compatibilidad (compat-matrix.mjs).
//
// QUÉ ES CADA PERFIL (y qué no): ver .claude/skills/compat-lab/SKILL.md. En corto: `pixel7` es
// Chromium de escritorio con el descriptor de un Pixel 7 (toque real por CDP, NO Chrome de Android);
// los tres `webkit` son el WebKit de Playwright para Windows con descriptores de iPhone/iPad (NO
// Safari de iOS: no hay sesión de audio de iOS, ni callout, ni barra dinámica, ni safe-areas).
//
// EL TOQUE:
//   · tap()           → page.touchscreen.tap en los perfiles con touch (toque de verdad para el motor:
//                       genera touch + pointer + click y cuenta como gesto del usuario); click si no.
//   · pulsacionLarga()→ pixel7: Input.dispatchTouchEvent por CDP (touchStart, esperar, touchEnd): es
//                       el camino real de Chromium, que además reconoce el long-press y manda el
//                       'contextmenu' como Android.
//                       webkit con touch: Playwright no tiene cómo sostener un dedo en WebKit, así que
//                       se despachan PointerEvent sintéticos (pointerdown · esperar · pointerup · click).
//                       Prueba el camino del TIMER de useLongPress (el de iOS, que no manda
//                       'contextmenu'), pero NO es un dedo: no hay callout ni selección de texto.
//                       sin touch: clic derecho.
//   Cada resultado dice con qué se hizo (`toque`).

export const PERFILES = {
  pixel7:           { motor: 'chromium', dispositivo: 'Pixel 7', touch: true, etiqueta: 'MEDIDO-pixel7-emulado' },
  iphone15:         { motor: 'webkit', dispositivo: 'iPhone 15', touch: true, etiqueta: 'MEDIDO-webkit-emulado' },
  ipad:             { motor: 'webkit', dispositivo: 'iPad (gen 7)', touch: true, etiqueta: 'MEDIDO-webkit-emulado' },
  'desktop-webkit': { motor: 'webkit', viewport: { width: 1440, height: 900 }, touch: false, etiqueta: 'MEDIDO-webkit-emulado' },
  firefox:          { motor: 'firefox', viewport: { width: 1440, height: 900 }, touch: false, etiqueta: 'MEDIDO-firefox', opcional: true },
};
export const POR_DEFECTO = ['pixel7', 'iphone15', 'ipad', 'desktop-webkit'];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const fold = (s) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
export const ETIQUETAS = '.ctx-menu .ctx-item span:first-of-type, .ctx-menu .ctx-tile-label';

// WAV sintético para /stream/<id>: los escenarios no dependen de los FLAC reales.
function wav(sec = 120, sr = 8000) {
  const n = sec * sr, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const WAV = wav();

// Lo que se inyecta en cada página: el token, el acceso al PlayerContext (por el árbol de React,
// sin tocar la app) y el <audio> que crea el motor (new Audio()).
function inicio(t) {
  localStorage.setItem('token', t);
  const A = window.Audio;
  window.Audio = function (...a) { const x = new A(...a); window.__audio = x; return x; };
  window.Audio.prototype = A.prototype;
  window.__player = () => {
    const root = document.getElementById('root');
    const key = root && Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
    if (!key) return null;
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
}

/** Las herramientas que recibe cada escenario para UN perfil. */
export function herramientas({ nombre, perfil, browser, devices, token, BASE }) {
  const movil = (perfil.dispositivo ? devices[perfil.dispositivo].viewport.width : perfil.viewport.width) <= 700;
  const toque = perfil.touch ? (perfil.motor === 'chromium' ? 'toque real (CDP)' : 'tap real + pulsación larga sintética (PointerEvent)') : 'ratón';

  async function abrir(ruta = '/', { viewport, esperar, audio = true } = {}) {
    const base = perfil.dispositivo ? { ...devices[perfil.dispositivo] } : { viewport: perfil.viewport };
    const ctx = await browser.newContext({ ...base, ...(viewport ? { viewport } : {}) });
    if (audio) await ctx.route('**/stream/**', (r) => {
      if (r.request().url().includes('/stream/video/')) return r.fallback();   // los videos van al backend
      const hd = r.request().headers().range; const total = WAV.length;
      if (!hd) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV });
      const [, a, b] = hd.match(/bytes=(\d*)-(\d*)/); const s = a ? +a : 0; const e = b ? Math.min(+b, total - 1) : total - 1;
      r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${s}-${e}/${total}` }, body: WAV.subarray(s, e + 1) });
    });
    await ctx.addInitScript(inicio, token);
    const p = await ctx.newPage(); p.setDefaultTimeout(8000);
    const errores = []; p.on('pageerror', (e) => errores.push(String(e.message).slice(0, 140)));
    const pedidos = []; p.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) pedidos.push(u.pathname + u.search); });
    await p.goto(BASE + ruta);
    if (esperar) await p.waitForSelector(esperar, { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(500);
    return { ctx, p, errores, pedidos };
  }

  // Al CENTRO de la pantalla: con scrollIntoViewIfNeeded la fila puede quedar pegada abajo, detrás de
  // la barra del reproductor, y el toque caería en la barra.
  const centro = async (loc) => { await loc.evaluate((e) => e.scrollIntoView({ block: 'center', inline: 'nearest' })).catch(() => {}); await sleep(150); const b = await loc.boundingBox(); if (!b) throw new Error('el elemento no tiene caja'); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  async function tap(p, loc) {
    const c = await centro(loc);
    if (perfil.touch) await p.touchscreen.tap(c.x, c.y); else await p.mouse.click(c.x, c.y);
  }
  async function pulsacionLarga(p, loc, ms = 700) {
    const c = await centro(loc);
    if (!perfil.touch) { await p.mouse.click(c.x, c.y, { button: 'right' }); return; }
    if (perfil.motor === 'chromium') {
      const cdp = await p.context().newCDPSession(p);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(c.x), y: Math.round(c.y) }] });
      await sleep(ms);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach().catch(() => {});
      return;
    }
    await p.evaluate(async ({ x, y, ms }) => {
      const el = document.elementFromPoint(x, y);
      const o = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 };
      el.dispatchEvent(new PointerEvent('pointerdown', o));
      await new Promise((r) => setTimeout(r, ms));
      el.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));   // el click que sigue al soltar
    }, { x: c.x, y: c.y, ms });
  }

  const estado = (p) => p.evaluate(() => {
    const v = window.__player?.(); const a = window.__audio; const vid = document.querySelector('video');
    return { ruta: decodeURI(location.pathname), ids: v ? v.queue.map((t) => t.id) : [], actual: v?.currentTrack?.id ?? null, titulo: v?.currentTrack?.title ?? null, kind: v?.currentTrack?.kind ?? null,
      isPlaying: !!v?.isPlaying, audio: a ? { paused: a.paused, t: Math.round(a.currentTime * 100) / 100 } : null, video: vid ? { paused: vid.paused, t: Math.round(vid.currentTime * 100) / 100 } : null,
      menu: document.querySelectorAll('.ctx-menu').length, tiles: document.querySelectorAll('.ctx-menu--tiles').length };
  });
  const etiquetasMenu = (p) => p.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.trim()), ETIQUETAS);
  const esperarMenu = async (p) => { await p.waitForSelector('.ctx-menu', { timeout: 1500 }).catch(() => {}); await sleep(300); };
  const cerrarMenu = async (p) => { if (await p.locator('.ctx-menu').count()) { await p.keyboard.press('Escape'); await sleep(300); } if (await p.locator('.ctx-menu').count()) { await p.evaluate(() => document.querySelector('.ctx-scrim')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))); await sleep(300); } };
  async function elegirDelMenu(p, textos) {
    for (const t of [].concat(textos)) {
      const it = p.locator('.ctx-menu :is(.ctx-item, .ctx-tile)', { hasText: t }).first();
      if (await it.count()) { await tap(p, it); await p.waitForSelector('.ctx-menu', { state: 'detached', timeout: 3000 }).catch(() => {}); return t; }
    }
    return null;
  }
  const avisos = (p) => p.evaluate(() => [...document.querySelectorAll('.toast .toast-text')].map((t) => t.textContent));

  // ¿Este navegador puede hacer sonar el audio de prueba? El WebKit de Playwright para Windows NO
  // reproduce un <audio> servido por route() (NotSupportedError con WAV, AAC y MP3; el <video> del
  // backend sí). Donde no puede, "suena" no es medible: se anota aparte y no cuenta.
  let puedeAudio = null;
  async function audioSuena() {
    if (puedeAudio != null) return puedeAudio;
    const { ctx, p } = await abrir('/', {});
    await p.setContent('<button id="b" style="width:200px;height:80px">play</button>');
    await p.evaluate((src) => { const a = new Audio(src); window.__sonda = a; document.getElementById('b').onclick = () => { a.play().catch(() => {}); }; }, BASE + '/stream/0');
    await tap(p, p.locator('#b')); await p.waitForFunction(() => window.__sonda.currentTime > 0, null, { timeout: 3000 }).catch(() => {});
    puedeAudio = await p.evaluate(() => !window.__sonda.paused && window.__sonda.currentTime > 0);
    await ctx.close();
    return puedeAudio;
  }
  const noMedibles = [];
  const noMedible = (clave, motivo) => { noMedibles.push({ clave, motivo }); };

  return { nombre, perfil, movil, toque, BASE, audioSuena, noMedible, noMedibles, abrir, tap, pulsacionLarga, estado, etiquetasMenu, esperarMenu, cerrarMenu, elegirDelMenu, avisos, sleep };
}
