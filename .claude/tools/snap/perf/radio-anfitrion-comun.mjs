// radio-anfitrion-comun.mjs — el MONTAJE compartido de las suites del ANFITRIÓN de la radio web: radio-func (1-18)
// y radio-anfitrion-mod-func (19-20). Es el preámbulo que tenía radio-func, TAL CUAL, con `export` delante de cada
// declaración: las dos cuentas (tokHost, tokOye), api/sala, el álbum de prueba (RUTA_ALBUM), el WAV sintético, el
// navegador, el INIT de cada página (token, espía de setInterval y el gancho de DevTools que cuenta renders), abrir()
// y los ayudantes de la vista (vista, esperar, sonar, irA, iniciar, espacio, tecla, terminarUI, TXT), más
// R/ok/NO_MEDIDO, T0 y RADIO_SOLO (corre).
// Como módulo ES corre UNA vez por proceso, al importarlo, y en el mismo orden que antes. No es una suite: no está
// en baseline.json. Las suites no reasignan nada de acá.
export { BASE };
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';

await preflight();
export const T0 = Date.now();
export const SOLO = process.env.RADIO_SOLO ? new Set(process.env.RADIO_SOLO.split(',').map(Number)) : null;
export const corre = (n) => !SOLO || SOLO.has(n);
export const R = {};
export const ok = (k, v, extra) => { R[k] = extra === undefined ? !!v : { ok: !!v, ...extra }; };
export const NO_MEDIDO = [];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const tokHost = await getToken();
export const login2 = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: process.env.SNAP2_USER, password: process.env.SNAP2_PASS }) });
export const tokOye = (await login2.json()).token;
if (!tokOye) { console.error('[radio-func] no entra la segunda cuenta (SNAP2_USER/SNAP2_PASS)'); process.exit(1); }

export const api = async (tok, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
};
export const sala = (c) => api(tokHost, 'GET', `/api/radio/${c}`);   // el anfitrión lee sin contarse como oyente

// Un álbum con al menos 3 pistas, para tener siguiente y poder saltar.
export const albums = (await api(tokHost, 'GET', '/api/albums')).j ?? [];
export const alb = albums.find((a) => (a.track_count ?? a.tracks ?? a.count ?? 3) >= 3 && a.album) ?? albums[0];
export const RUTA_ALBUM = `/albums/${alb.album_artist ? encodeURIComponent(alb.album_artist) : '@'}/${encodeURIComponent(alb.album)}`;

export function wav(sec = 180, sr = 8000) {
  const n = sec * sr, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
export const WAV = wav();

export const { chromium } = await loadPlaywright();
export const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

// Init de cada página: token; intervalos vivos (para ver que la radio no deja ninguno al salir); y un
// gancho de DevTools que cuenta los renders de Layout y de la vista de <main>, ubicados por su DOM
// (el build de producción no tiene nombres de componentes).
export const INIT = (t) => {
  localStorage.setItem('token', t);
  const si = window.setInterval.bind(window), ci = window.clearInterval.bind(window);
  window.__intervalos = new Map();
  window.setInterval = (fn, ms, ...a) => { const id = si(fn, ms, ...a); window.__intervalos.set(id, ms); return id; };
  window.clearInterval = (id) => { window.__intervalos.delete(id); return ci(id); };
  window.__renders = { layout: 0, vista: 0 }; window.__contar = false;
  const fibra = (el) => { if (!el) return null; const k = Object.keys(el).find((x) => x.startsWith('__reactFiber$')); return k ? el[k] : null; };
  const funcionArriba = (f, n) => { let x = f; let c = 0; while (x) { x = x.return; if (x && typeof x.type === 'function' && ++c === n) return x; } return null; };
  const funcionAbajo = (f) => { let x = f?.child; while (x && typeof x.type !== 'function') x = x.child; return x; };
  const previo = new Map();
  const mirar = (nombre, f) => {
    if (!f) return;
    const p = previo.get(nombre);
    const cambio = !p || (p.f !== f && p.f !== f.alternate) || p.props !== f.memoizedProps || p.state !== f.memoizedState;
    if (p && cambio && window.__contar) window.__renders[nombre]++;
    previo.set(nombre, { f, props: f.memoizedProps, state: f.memoizedState });
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers: new Map(), inject() { return 1; }, isDisabled: false,
    onCommitFiberRoot() {
      try {
        // Layout: la 2.ª función hacia arriba desde div.layout (la 1.ª es DragQueueProvider).
        mirar('layout', funcionArriba(fibra(document.querySelector('.layout')), 2));
        // La vista: la 1.ª función dentro de <main class="main-content">.
        mirar('vista', funcionAbajo(fibra(document.querySelector('.main-content'))));
      } catch { /* sin DOM todavía */ }
    },
    onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {},
  };
};

export async function abrir({ mobile = false, falso = null, init = null } = {}) {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
  await ctx.route('**/stream/**', (r) => {
    if (r.request().url().includes('/stream/video/')) return r.continue();   // los videos sintéticos, de verdad
    const h = r.request().headers().range; const total = WAV.length;
    if (!h) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV });
    const [, a, b] = h.match(/bytes=(\d*)-(\d*)/); const start = a ? +a : 0; const end = b ? +b : total - 1;
    r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: WAV.subarray(start, end + 1) });
  });
  if (falso) await ctx.route('**/api/radio**', falso);
  await ctx.addInitScript(INIT, tokHost);
  if (init) await ctx.addInitScript(init);
  const p = await ctx.newPage();
  const pedidos = []; p.on('request', (q) => { if (new URL(q.url()).pathname.startsWith('/api/radio')) pedidos.push({ t: Date.now(), m: q.method(), u: new URL(q.url()).pathname }); });
  const errores = []; p.on('pageerror', (e) => errores.push(e.message));
  return { ctx, p, pedidos, errores };
}
export const vista = (p) => p.evaluate(() => ({
  path: location.pathname,
  codigo: document.querySelector('.radio-codigo')?.textContent ?? null,
  anfitrion: !!document.querySelector('.radio-terminar'),
  estado: document.querySelector('.radio-estado')?.textContent ?? null,
  oyentes: document.querySelector('.radio-oyentes')?.textContent ?? null,
  iniciar: (() => { const b = [...document.querySelectorAll('.main-content .radio-btn')].find((x) => /Iniciar|Creando/.test(x.textContent)); return b ? { texto: b.textContent.trim(), off: b.disabled } : null; })(),
  notas: [...document.querySelectorAll('.main-content .radio-nota')].map((n) => n.textContent),
  foco: document.activeElement?.textContent?.trim().slice(0, 30) ?? null,
  login: !!document.querySelector('input[type="password"]'),
  intervalosRadio: [...window.__intervalos.values()].filter((ms) => ms === 500 || ms === 5000).length,
}));
export const esperar = async (fn, ms = 6000, paso = 150) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return { v, ms: Date.now() - t }; await sleep(paso); } return { v: null, ms: null }; };
export async function sonar(p) {
  await p.goto(BASE + RUTA_ALBUM);
  await p.waitForSelector('.track-row', { timeout: 10_000 });
  await p.locator('.track-row').first().click();
  await sleep(1200);
}
export const irA = async (p, nombre) => { await p.locator('.sidebar-nav button', { hasText: new RegExp(`^${nombre}$`) }).click(); await sleep(600); };
export const iniciar = async (p) => { await p.locator('.main-content .radio-btn', { hasText: 'Iniciar radio' }).click(); return esperar(async () => (await vista(p)).anfitrion, 5000); };
export const espacio = async (p) => { await p.evaluate(() => document.activeElement?.blur()); await p.keyboard.press('Space'); };
export const tecla = async (p, k) => { await p.evaluate(() => document.activeElement?.blur()); await p.keyboard.press(k); };
export const terminarUI = async (p) => {
  await p.getByRole('button', { name: 'Terminar radio' }).click(); await sleep(250);
  await p.getByRole('button', { name: 'Sí, terminar' }).click();
  return esperar(async () => !(await vista(p)).anfitrion, 5000);
};
export const pedidosDesde = (pedidos, t) => pedidos.filter((x) => x.t > t).map((x) => `${x.m} ${x.u}`);
export const TXT = {
  terminaste: 'Terminaste la radio.',
  reemplazada: 'Empezaste otra radio desde otra pestaña o dispositivo.',
  noEsTuya: 'Esta radio ya no es tuya.',
  pausa: 'La radio se cerró por estar mucho tiempo en pausa.',
  demasiadas: 'Hay demasiadas radios en vivo ahora. Intenta más tarde.',
  frecuencia: 'Demasiados intentos. Espera unos segundos e intenta de nuevo.',
  conexion: 'No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.',
  noTerminar: 'No se pudo terminar la radio. Intenta de nuevo.',
};
