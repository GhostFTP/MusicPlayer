// tablet-util.mjs — lo común de los scripts de la 1.32.1 (tablet e inputs): contextos táctiles, el
// dedo y la medida del área de toque efectiva.
//
// EL DEDO: en Chromium es real (Input.dispatchTouchEvent por CDP). OJO: Chromium emulado no manda
// 'pointercancel' ni 'contextmenu' con el dedo puesto, así que la pulsación larga se prueba por el
// camino del TIMER (el de iOS). El camino de Android (pointercancel + contextmenu) no se puede
// probar acá: requiere Chrome de Android real.
import { getToken, loadPlaywright } from '../session.mjs';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const ETIQUETAS = '.ctx-menu .ctx-item span:first-of-type, .ctx-menu .ctx-tile-label';

function wav(sec = 120, sr = 8000) {
  const n = sec * sr, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const WAV = wav();

export async function preparar() {
  const token = await getToken();
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  // `tactil`: dedo (hasTouch + isMobile → pointer: coarse, hover: none). Sin él, ratón.
  async function abrir(base, ruta, { w = 1280, h = 800, tactil = false, esperar, sesion = true } = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(tactil ? { hasTouch: true, isMobile: true } : {}) });
    await ctx.route('**/stream/**', (r) => {
      if (r.request().url().includes('/stream/video/')) return r.fallback();
      const hd = r.request().headers().range; const total = WAV.length;
      if (!hd) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV });
      const [, a, b] = hd.match(/bytes=(\d*)-(\d*)/); const s = a ? +a : 0; const e = b ? Math.min(+b, total - 1) : total - 1;
      r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${s}-${e}/${total}` }, body: WAV.subarray(s, e + 1) });
    });
    await ctx.addInitScript(({ t, sesion }) => {
      if (sesion) localStorage.setItem('token', t);
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
    }, { t: token, sesion });
    const p = await ctx.newPage(); p.setDefaultTimeout(8000);
    const errores = []; p.on('pageerror', (e) => errores.push(String(e.message).slice(0, 140)));
    const pedidos = []; p.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) pedidos.push(u.pathname + u.search); });
    await p.goto(base + ruta);
    if (esperar) await p.waitForSelector(esperar, { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(500);
    const centro = async (loc) => { await loc.evaluate((e) => e.scrollIntoView({ block: 'center', inline: 'nearest' })).catch(() => {}); await sleep(150); const b = await loc.boundingBox(); if (!b) throw new Error('el elemento no tiene caja'); return { x: Math.round(b.x + Math.min(b.width / 2, 140)), y: Math.round(b.y + b.height / 2) }; };
    const tocar = async (loc) => { const c = await centro(loc); if (tactil) await p.touchscreen.tap(c.x, c.y); else await p.mouse.click(c.x, c.y); };
    // Dedo puesto `ms` y soltar (o clic derecho, sin dedo).
    const mantener = async (loc, ms = 700) => {
      const c = await centro(loc);
      if (!tactil) { await p.mouse.click(c.x, c.y, { button: 'right' }); return; }
      const cdp = await ctx.newCDPSession(p);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] }); await sleep(ms);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach().catch(() => {});
    };
    const estado = () => p.evaluate(() => { const v = window.__player?.(); return { ruta: decodeURI(location.pathname), ids: v ? v.queue.map((t) => t.id) : [], actual: v?.currentTrack?.id ?? null, titulo: v?.currentTrack?.title ?? null,
      menu: document.querySelectorAll('.ctx-menu').length, tiles: document.querySelectorAll('.ctx-menu--tiles').length, scrim: document.querySelectorAll('.ctx-scrim').length }; });
    const etiquetas = () => p.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.trim()), ETIQUETAS);
    const esperarMenu = async () => { await p.waitForSelector('.ctx-menu', { timeout: 1500 }).catch(() => {}); await sleep(300); };
    const cerrarMenu = async () => { if (await p.locator('.ctx-menu').count()) { await p.keyboard.press('Escape'); await sleep(300); } };
    return { ctx, p, errores, pedidos, tocar, mantener, estado, etiquetas, esperarMenu, cerrarMenu };
  }
  return { token, browser, abrir };
}

// Área de toque EFECTIVA de cada control dentro de `raiz`: desde su centro, hasta dónde un toque
// sigue cayendo en él (elementFromPoint). Cuenta un área ampliada con ::after y descuenta lo que le
// tapa un vecino. Devuelve una fila por tipo de control, con la peor medida. Sólo los que se ven
// enteros y con sus 44 px dentro de la zona que scrollea.
export const medirAreas = (p, raiz) => p.evaluate((raiz) => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.pointerEvents !== 'none' && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
  const dentro = (el, x, y) => { const t = document.elementFromPoint(x, y); return !!t && (t === el || el.contains(t)); };
  const out = new Map();
  for (const el of document.querySelectorAll(`${raiz} button, ${raiz} a[href], ${raiz} input[type="range"], ${raiz} [role="button"], ${raiz} [role="radio"], ${raiz} .exp-link`)) {
    if (!vis(el) || el.disabled) continue;
    const r = el.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (![[cx, cy], [cx, r.top + 1], [cx, r.bottom - 1], [r.left + 1, cy], [r.right - 1, cy]].every(([x, y]) => dentro(el, x, y))) continue;
    const zona = el.closest('.main-content, .queue-body')?.getBoundingClientRect();
    if (zona && (cy - 22 < zona.top || cy + 22 > Math.min(zona.bottom, innerHeight))) continue;
    const hasta = (dx, dy) => { let n = 0; while (n < 60 && dentro(el, cx + dx * (n + 1), cy + dy * (n + 1))) n++; return n; };
    const w = hasta(-1, 0) + hasta(1, 0) + 1, h = hasta(0, -1) + hasta(0, 1) + 1;
    const clave = (el.className?.toString().split(' ').filter((c) => c && !['active', 'playing', 'current', 'fav-on'].includes(c)).slice(0, 2).join('.') || el.tagName.toLowerCase())
      + (el.type === 'range' ? `[${el.closest('.seek') ? 'progreso' : 'volumen'}]` : '') + (el.getAttribute('role') === 'radio' ? '[vista]' : '');
    const o = out.get(clave) ?? { n: 0, toque: [w, h], caja: [Math.round(r.width), Math.round(r.height)] };
    o.n++; if (Math.min(w, h) < Math.min(...o.toque)) o.toque = [w, h]; out.set(clave, o);
  }
  return [...out.entries()].map(([control, o]) => ({ control, n: o.n, caja: o.caja, toque: o.toque }));
}, raiz);
