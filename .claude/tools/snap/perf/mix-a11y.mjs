// mix-a11y.mjs — accesibilidad, estados y robustez del botón "Mix aleatorio" (Frente 2, sub-paso M2b).
//   1. Deshabilitado con 0 y con 1 pista (listado de Álbumes simulado por red y detalle real de un
//      álbum de 1 pista), con el title que explica por qué; habilitado con 2+.
//   2. Fallo de red y 401 al pedir la lista: sin error sin atrapar, no suena nada, el botón vuelve.
//   3. Doble clic y clic repetido mientras pide la lista: 1 petición y 1 reproducción.
//   4. Tab + Enter activa el botón.
//   5. Árbol de accesibilidad (CDP): nombre, descripción, deshabilitado y aria-busy durante el pedido.
//   6. Espacio con el botón enfocado: se DOCUMENTA lo que pasa (es de M4, no se arregla acá).
//   M2c: el foco se conserva mientras pide la lista (aria-busy en vez de disabled); fallo de red →
//   UN toast ámbar (y uno solo con 3 clics seguidos); 401 → sin toast; la capa de toasts es anunciable.
// Uso: SNAP_BASE=http://localhost:4173 node mix-a11y.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';

await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
function wav(sec = 900, sr = 8000) {
  const n = sec * sr, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const WAV = wav();
const H = { Authorization: `Bearer ${token}` };
const ALBUMS = await fetch(`${BASE}/api/albums`, { headers: H }).then((r) => r.json());
const enc = encodeURIComponent;
const isLib = (u) => { const x = new URL(u); return x.pathname === '/api/tracks' && x.searchParams.get('limit') === '10000' && [...x.searchParams.keys()].length === 1; };

const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };

async function newPage({ albums, libRoute } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**/stream/**', (r) => {
    const h = r.request().headers().range; const total = WAV.length;
    if (!h) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV });
    const [, a, b] = h.match(/bytes=(\d*)-(\d*)/); const start = a ? +a : 0; const end = b ? +b : total - 1;
    r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: WAV.subarray(start, end + 1) });
  });
  if (albums) await ctx.route((u) => new URL(u).pathname === '/api/albums', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(albums) }));
  if (libRoute) await ctx.route((u) => isLib(u), libRoute);
  await ctx.addInitScript((t) => {
    localStorage.setItem('token', t);
    window.__errors = [];
    window.__toasts = [];
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList?.contains('toast')) window.__toasts.push({ texto: n.textContent.trim(), warning: n.classList.contains('warning') }); })
      .observe(document, { childList: true, subtree: true });
    window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
    window.addEventListener('unhandledrejection', (e) => window.__errors.push('rechazo: ' + String(e.reason?.message ?? e.reason)));
    const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    Object.defineProperty(HTMLMediaElement.prototype, 'src', { configurable: true, get() { return d.get.call(this); }, set(v) { window.__srcSets = (window.__srcSets ?? 0) + 1; d.set.call(this, v); } });
    const A = window.Audio;
    window.Audio = function (...a) { const x = new A(...a); window.__audio = x; return x; };
  }, token);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message)));
  let libReqs = 0;
  p.on('request', (r) => { if (isLib(r.url())) libReqs++; });
  return { ctx, p, errs, libReqs: () => libReqs };
}
const btnState = (p, sel = '.mix-btn') => p.evaluate((sel) => {
  const b = document.querySelector(sel);
  if (!b) return null;
  return { disabled: b.disabled, ariaDisabled: b.getAttribute('aria-disabled'), ariaBusy: b.getAttribute('aria-busy'), type: b.getAttribute('type'), title: b.title, texto: b.textContent.trim(), svgOculto: b.querySelector('svg')?.getAttribute('aria-hidden') };
}, sel);
const played = (p) => p.evaluate(() => window.__srcSets ?? 0);
const toasts = (p) => p.evaluate(() => window.__toasts ?? []);
const pageErrs = async (p, errs) => [...errs, ...(await p.evaluate(() => window.__errors ?? []))];

// 1) deshabilitado / habilitado
// 0 pistas: Biblioteca con una búsqueda sin resultados (con 0 álbumes, Álbumes muestra su estado
// vacío "Sin álbumes" y no pinta botón: no hay botón que deshabilitar).
{
  const { ctx, p, errs } = await newPage();
  await p.goto(BASE + '/'); await p.waitForSelector('.library-tracks .track-row'); await p.waitForTimeout(1200);
  await p.fill('.search-box input', 'zzzqqq'); await p.waitForTimeout(800);
  const st = await btnState(p, '.library-actions .mix-btn');
  await p.locator('.library-actions .mix-btn').click({ force: true }).catch(() => {});
  await p.waitForTimeout(800);
  const sono = await played(p);
  ok('biblioteca_0_resultados', st.disabled && st.ariaDisabled === 'true' && /suficientes/.test(st.title) && sono === 0 && !(await pageErrs(p, errs)).length, { ...st, sono: sono > 0 });
  await ctx.close();
}
for (const [name, albums] of [
  ['listado_1_pista', [{ ...ALBUMS.find((a) => a.album_artist), track_count: 1 }]],
  ['listado_2plus', null],
]) {
  const { ctx, p, errs } = await newPage({ albums: albums ?? undefined });
  await p.goto(BASE + '/albums'); await p.waitForSelector('.section-header .mix-btn'); await p.waitForTimeout(1000);
  const st = await btnState(p, '.section-header .mix-btn');
  await p.locator('.section-header .mix-btn').click({ force: true }).catch(() => {});
  await p.waitForTimeout(800);
  const sono = await played(p);
  const esperaDeshab = albums !== null;
  const good = esperaDeshab
    ? st.disabled && st.ariaDisabled === 'true' && /suficientes/.test(st.title) && sono === 0
    : !st.disabled && st.ariaDisabled === null && sono > 0;
  ok(name, good && !(await pageErrs(p, errs)).length, { ...st, sono: sono > 0 });
  await ctx.close();
}
for (const [name, path, esperaDeshab] of [
  ['detalle_album_1_pista', `/albums/${enc('Daft Punk')}/${enc('Alive 1997')}`, true],
  ['detalle_album_22_pistas', `/albums/${enc('Daft Punk')}/${enc('Random Access Memories (10th Anniversary Edition)')}`, false],
]) {
  const { ctx, p, errs } = await newPage();
  await p.goto(BASE + path); await p.waitForSelector('.detail-actions .mix-btn'); await p.waitForTimeout(1000);
  const st = await btnState(p, '.detail-actions .mix-btn');
  ok(name, st.disabled === esperaDeshab && !(await pageErrs(p, errs)).length, st);
  await ctx.close();
}

// 2) fallo de red y 401
for (const [name, route] of [
  ['fallo_de_red', (r) => r.abort('failed')],
  ['error_401', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Invalid token' }) })],
]) {
  const { ctx, p, errs } = await newPage({ libRoute: route });
  await p.goto(BASE + '/albums'); await p.waitForSelector('.section-header .mix-btn'); await p.waitForTimeout(1000);
  await p.click('.section-header .mix-btn');
  await p.waitForTimeout(1500);
  const st = await btnState(p, '.section-header .mix-btn');
  const e = await pageErrs(p, errs);
  const sesionCerrada = await p.locator('.section-header .mix-btn').count() === 0;
  const ts = await toasts(p);
  const toastOk = name === 'error_401' ? ts.length === 0 : (ts.length === 1 && ts[0].warning && ts[0].texto.includes('No se pudieron cargar las pistas'));
  ok(name, !e.length && (await played(p)) === 0 && toastOk && (sesionCerrada || (!st.disabled && st.texto === 'Mix aleatorio' && st.ariaBusy === null && st.ariaDisabled === null)),
    { erroresSinAtrapar: e, sono: (await played(p)) > 0, toasts: ts, boton: st, sesionCerrada });
  await ctx.close();
}

// 2b) tres clics seguidos con la red caída → UN solo toast (y ningún error sin atrapar)
{
  const { ctx, p, errs, libReqs } = await newPage({ libRoute: (r) => r.abort('failed') });
  await p.goto(BASE + '/albums'); await p.waitForSelector('.section-header .mix-btn'); await p.waitForTimeout(1000);
  for (let k = 0; k < 3; k++) { await p.click('.section-header .mix-btn'); await p.waitForTimeout(250); }
  await p.waitForTimeout(1200);
  const ts = await toasts(p);
  const capa = await p.evaluate(() => { const l = document.querySelector('.toast-layer'); const t = l?.querySelector('.toast'); return { ariaLive: l?.getAttribute('aria-live'), ariaAtomic: l?.getAttribute('aria-atomic'), role: t?.getAttribute('role') ?? null }; });
  ok('tres_clics_con_fallo_un_toast', ts.length === 1 && !(await pageErrs(p, errs)).length, { toasts: ts.length, pedidos: libReqs() });
  ok('toast_anunciable', capa.ariaLive === 'polite' && capa.role === 'status', capa);
  await ctx.close();
}

// 3) doble clic y clic repetido mientras pide (biblioteca demorada 1,2 s, en frío)
for (const [name, gesto] of [
  ['doble_clic', async (p) => { await p.dblclick('.section-header .mix-btn'); }],
  ['clic_repetido_mientras_pide', async (p) => { await p.click('.section-header .mix-btn'); await p.waitForTimeout(400); await p.click('.section-header .mix-btn', { force: true }).catch(() => {}); await p.waitForTimeout(400); await p.click('.section-header .mix-btn', { force: true }).catch(() => {}); }],
]) {
  const { ctx, p, errs, libReqs } = await newPage({ libRoute: async (r) => { await new Promise((s) => setTimeout(s, 1200)); return r.fallback(); } });
  await p.goto(BASE + '/albums'); await p.waitForSelector('.section-header .mix-btn'); await p.waitForTimeout(1000);
  const r0 = libReqs(); const s0 = await played(p);
  await gesto(p);
  await p.waitForTimeout(2500);
  ok(name, libReqs() - r0 === 1 && (await played(p)) - s0 === 1 && !(await pageErrs(p, errs)).length, { peticiones: libReqs() - r0, reproducciones: (await played(p)) - s0 });
  await ctx.close();
}
// doble clic con la lista YA en memoria (sin pedido): 0 peticiones y 1 reproducción
{
  const { ctx, p, errs, libReqs } = await newPage();
  await p.goto(BASE + '/'); await p.waitForSelector('.library-tracks .track-row'); await p.waitForTimeout(1200);
  await p.click('.sidebar button:has-text("Álbumes")'); await p.waitForSelector('.section-header .mix-btn'); await p.waitForTimeout(800);
  const r0 = libReqs(); const s0 = await played(p);
  await p.dblclick('.section-header .mix-btn'); await p.waitForTimeout(1500);
  ok('doble_clic_en_caliente', libReqs() - r0 === 0 && (await played(p)) - s0 === 1 && !(await pageErrs(p, errs)).length, { peticiones: libReqs() - r0, reproducciones: (await played(p)) - s0 });
  await ctx.close();
}

// 4) Tab + Enter
const tabTo = async (p, sel) => {
  for (let k = 0; k < 80; k++) {
    await p.keyboard.press('Tab');
    if (await p.evaluate((sel) => document.activeElement?.matches(sel), sel)) return true;
  }
  return false;
};
{
  const { ctx, p, errs } = await newPage();
  await p.goto(BASE + '/albums'); await p.waitForSelector('.section-header .mix-btn'); await p.waitForTimeout(1000);
  const llego = await tabTo(p, '.section-header .mix-btn');
  const focoVisible = await p.evaluate(() => { const b = document.activeElement; const cs = getComputedStyle(b); return { outline: `${cs.outlineStyle} ${cs.outlineWidth}`, matches: b.matches(':focus-visible') }; });
  const s0 = await played(p);
  await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
  ok('tab_enter', llego && (await played(p)) > s0 && !(await pageErrs(p, errs)).length, { llegoConTab: llego, focoVisible, sono: (await played(p)) > s0 });
  await ctx.close();
}

// 4b) el foco sigue en el botón tras activarlo por teclado mientras pide la lista (M2c)
{
  const { ctx, p } = await newPage({ libRoute: async (r) => { await new Promise((s) => setTimeout(s, 1200)); return r.fallback(); } });
  await p.goto(BASE + '/albums'); await p.waitForSelector('.section-header .mix-btn'); await p.waitForTimeout(1000);
  await tabTo(p, '.section-header .mix-btn');
  await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  const durante = await p.evaluate(() => { const a = document.activeElement; return { clase: a?.className || a?.tagName, busy: a?.getAttribute('aria-busy'), ariaDisabled: a?.getAttribute('aria-disabled'), disabled: a?.disabled ?? null, texto: a?.textContent?.trim() }; });
  await p.waitForTimeout(1800);
  const despues = await p.evaluate(() => document.activeElement?.className || document.activeElement?.tagName);
  ok('foco_se_conserva_mientras_pide', durante.clase === 'mix-btn' && durante.busy === 'true' && durante.ariaDisabled === 'true' && durante.disabled === false && despues === 'mix-btn',
    { focoDurante: durante, focoDespues: despues });
  await ctx.close();
}

// 5) árbol de accesibilidad (CDP): normal, deshabilitado y ocupado
{
  const ax = async (p) => {
    const cdp = await p.context().newCDPSession(p);
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const n = nodes.find((x) => x.role?.value === 'button' && /Mix aleatorio|Cargando/.test(x.name?.value ?? ''));
    if (!n) return null;
    const prop = (k) => n.properties?.find((q) => q.name === k)?.value?.value;
    return { nombre: n.name?.value, descripcion: n.description?.value ?? null, deshabilitado: prop('disabled') ?? false, ocupado: prop('busy') ?? false, foco: prop('focusable') ?? null };
  };
  let { ctx, p } = await newPage();
  await p.goto(BASE + '/albums'); await p.waitForSelector('.section-header .mix-btn'); await p.waitForTimeout(1000);
  const normal = await ax(p); await ctx.close();
  ({ ctx, p } = await newPage({ albums: [{ ...ALBUMS.find((a) => a.album_artist), track_count: 1 }] }));
  await p.goto(BASE + '/albums'); await p.waitForSelector('.section-header .mix-btn'); await p.waitForTimeout(1000);
  const deshab = await ax(p); await ctx.close();
  ({ ctx, p } = await newPage({ libRoute: async (r) => { await new Promise((s) => setTimeout(s, 2000)); return r.fallback(); } }));
  await p.goto(BASE + '/albums'); await p.waitForSelector('.section-header .mix-btn'); await p.waitForTimeout(1000);
  await p.click('.section-header .mix-btn'); await p.waitForTimeout(400);
  const ocupado = await ax(p); await ctx.close();
  ok('ax_nombre_deshabilitado_busy',
    normal?.nombre === 'Mix aleatorio' && !normal.deshabilitado && deshab?.deshabilitado === true && /suficientes/.test(deshab.descripcion ?? '') && !!ocupado?.ocupado,
    { normal, deshab, ocupado });
}

// 6) Espacio con el botón enfocado y música sonando (se documenta, no se arregla: M4)
{
  const { ctx, p } = await newPage();
  await p.goto(BASE + '/'); await p.waitForSelector('.library-tracks .track-row'); await p.waitForTimeout(1200);
  await p.locator('.library-tracks .track-row').nth(1).click(); await p.waitForTimeout(1000);
  const antes = await p.evaluate(() => ({ paused: window.__audio.paused, srcSets: window.__srcSets }));
  await tabTo(p, '.library-actions .mix-btn');
  await p.keyboard.press('Space'); await p.waitForTimeout(1200);
  const despues = await p.evaluate(() => ({ paused: window.__audio.paused, srcSets: window.__srcSets }));
  ok('espacio_con_foco_DOCUMENTA', true, { sonabaAntes: !antes.paused, pausadoDespues: despues.paused, mixSeActivo: despues.srcSets > antes.srcSets, nota: 'la guarda de teclado de PlayerContext.jsx sólo excluye INPUT → Espacio hace play/pausa y no activa el botón (M4)' });
  await ctx.close();
}

console.log(JSON.stringify(R, null, 1));
const bools = Object.entries(R).filter(([, v]) => v === true || v === false || (v && typeof v === 'object' && 'ok' in v));
const bad = bools.filter(([, v]) => !(v === true || v?.ok === true)).map(([k]) => k);
console.log(`OK ${bools.length - bad.length}/${bools.length}${bad.length ? ' · falla: ' + bad.join(', ') : ''}`);
await browser.close();
