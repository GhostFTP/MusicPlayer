// mix-shortcut.mjs — atajo de teclado "M" (Frente 2, sub-paso M3): mezcla TODA la biblioteca.
//   1. Mezcla N = total de la biblioteca (no la vista) en: Artistas (vista 679 de 680 en local),
//      Biblioteca con búsqueda activa, un detalle de álbum y con la cola abierta.
//   2. Con un BOTÓN enfocado (el Mix de la vista) también actúa, y mezcla la biblioteca entera.
//   3. Ignorada: escribiendo en el buscador, con Ctrl/Alt/Meta, con el menú contextual abierto y con
//      el panel de Info (diálogo) abierto.
//   4. Mantener M apretada (repeat) → una sola mezcla.
//   5. Errores: red caída → 1 toast y sin error sin atrapar; 3 M seguidas con la red caída → 1 toast;
//      401 → sin toast.
//   6. Lista fría (entrar directo por URL): 1 solo pedido.
//   7. Biblioteca con menos de 2 pistas: no hace nada.
// Uso: SNAP_BASE=http://localhost:4173 node mix-shortcut.mjs
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
const LIB = await fetch(`${BASE}/api/tracks?limit=10000`, { headers: H }).then((r) => r.json());
const TOTAL = LIB.length;
const isLib = (u) => { const x = new URL(u); return x.pathname === '/api/tracks' && x.searchParams.get('limit') === '10000' && [...x.searchParams.keys()].length === 1; };
const enc = encodeURIComponent;
const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };

async function newPage({ libRoute } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**/stream/**', (r) => {
    const h = r.request().headers().range; const total = WAV.length;
    if (!h) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV });
    const [, a, b] = h.match(/bytes=(\d*)-(\d*)/); const start = a ? +a : 0; const end = b ? +b : total - 1;
    r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: WAV.subarray(start, end + 1) });
  });
  if (libRoute) await ctx.route((u) => isLib(u), libRoute);
  await ctx.addInitScript((t) => {
    localStorage.setItem('token', t);
    window.__errors = []; window.__toasts = [];
    window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
    window.addEventListener('unhandledrejection', (e) => window.__errors.push('rechazo: ' + String(e.reason?.message ?? e.reason)));
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList?.contains('toast')) window.__toasts.push({ texto: n.textContent.trim(), warning: n.classList.contains('warning') }); })
      .observe(document, { childList: true, subtree: true });
    const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    Object.defineProperty(HTMLMediaElement.prototype, 'src', { configurable: true, get() { return d.get.call(this); }, set(v) { window.__srcSets = (window.__srcSets ?? 0) + 1; d.set.call(this, v); } });
  }, token);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message)));
  let libReqs = 0;
  p.on('request', (r) => { if (isLib(r.url())) libReqs++; });
  return { ctx, p, errs, libReqs: () => libReqs };
}
const played = (p) => p.evaluate(() => window.__srcSets ?? 0);
const toasts = (p) => p.evaluate(() => window.__toasts ?? []);
const pageErrs = async (p, errs) => [...errs, ...(await p.evaluate(() => window.__errors ?? []))];
const kicker = (p) => p.evaluate(() => Number((document.querySelector('.queue-panel .queue-kicker')?.textContent.match(/(\d+)\s+pistas?/) ?? [])[1] ?? 0));
async function queueLen(p) {
  const open = await p.locator('.queue-panel').count();
  if (!open) { await p.click('.player-bar [aria-label="Cola"]'); await p.waitForSelector('.queue-panel .queue-kicker'); }
  const n = await kicker(p);
  if (!open) await p.click('.player-bar [aria-label="Cola"]');
  return n;
}
const blurToBody = (p) => p.evaluate(() => { document.activeElement?.blur?.(); });
const tabTo = async (p, sel) => { for (let k = 0; k < 80; k++) { await p.keyboard.press('Tab'); if (await p.evaluate((s) => document.activeElement?.matches(s), sel)) return true; } return false; };

// 1) mezcla TODA la biblioteca desde distintos lugares
for (const [name, prep] of [
  ['artistas', async (p) => { await p.goto(BASE + '/artists'); await p.waitForSelector('.mix-btn'); }],
  ['biblioteca_con_busqueda', async (p) => { await p.goto(BASE + '/'); await p.waitForSelector('.library-tracks .track-row'); await p.waitForTimeout(800); await p.fill('.search-box input', 'daf'); await p.waitForTimeout(700); }],
  ['detalle_album', async (p) => { await p.goto(`${BASE}/albums/${enc('Daft Punk')}/${enc('Discovery')}`); await p.waitForSelector('.detail-hero'); }],
  ['cola_abierta', async (p) => { await p.goto(BASE + '/'); await p.waitForSelector('.library-tracks .track-row'); await p.locator('.library-tracks .track-row').nth(2).click(); await p.waitForTimeout(600); await p.click('.player-bar [aria-label="Cola"]'); await p.waitForSelector('.queue-panel .queue-row'); }],
]) {
  const { ctx, p, errs } = await newPage();
  await prep(p); await p.waitForTimeout(800);
  await blurToBody(p);
  const s0 = await played(p);
  await p.keyboard.press('m'); await p.waitForTimeout(1500);
  const cola = await queueLen(p);
  ok(`m_${name}`, (await played(p)) - s0 === 1 && cola === TOTAL && !(await pageErrs(p, errs)).length, { reproducciones: (await played(p)) - s0, cola, total: TOTAL });
  await ctx.close();
}
// 2) con el BOTÓN Mix enfocado: actúa el atajo (toda la biblioteca), no el botón (que mezclaría la vista)
{
  const { ctx, p, errs } = await newPage();
  await p.goto(BASE + '/artists'); await p.waitForSelector('.mix-btn'); await p.waitForTimeout(800);
  const llego = await tabTo(p, '.mix-btn');
  const s0 = await played(p);
  await p.keyboard.press('m'); await p.waitForTimeout(1500);
  const cola = await queueLen(p);
  ok('m_con_boton_enfocado', llego && (await played(p)) - s0 === 1 && cola === TOTAL && !(await pageErrs(p, errs)).length, { llegoConTab: llego, cola, total: TOTAL, vistaArtistas: LIB.filter((t) => t.album_artist).length });
  await ctx.close();
}
// 3) ignorada
{
  const { ctx, p } = await newPage();
  await p.goto(BASE + '/'); await p.waitForSelector('.library-tracks .track-row'); await p.waitForTimeout(800);
  await p.click('.search-box input'); await p.keyboard.type('m');
  await p.waitForTimeout(900);
  ok('ignorada_escribiendo_en_buscador', (await played(p)) === 0 && (await p.inputValue('.search-box input')) === 'm', { valor: await p.inputValue('.search-box input'), sono: (await played(p)) > 0 });
  await p.fill('.search-box input', ''); await blurToBody(p);
  for (const mod of ['Control', 'Alt', 'Meta']) await p.keyboard.press(`${mod}+KeyM`);
  await p.waitForTimeout(900);
  ok('ignorada_con_ctrl_alt_meta', (await played(p)) === 0, { sono: (await played(p)) > 0 });
  // menú contextual abierto
  await p.locator('.library-tracks .track-row').nth(3).click({ button: 'right' });
  await p.waitForSelector('.ctx-menu [role="menuitem"]');
  await p.keyboard.press('m'); await p.waitForTimeout(900);
  ok('ignorada_con_menu_contextual', (await played(p)) === 0 && (await p.locator('.ctx-menu').count()) === 1, { sono: (await played(p)) > 0, menuSigueAbierto: (await p.locator('.ctx-menu').count()) === 1 });
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await ctx.close();
}
{
  // panel de Info (diálogo): suena una pista, se abre Info desde la barra, M no actúa
  const { ctx, p } = await newPage();
  await p.goto(BASE + '/'); await p.waitForSelector('.library-tracks .track-row'); await p.waitForTimeout(800);
  await p.locator('.library-tracks .track-row').nth(1).click(); await p.waitForTimeout(800);
  await p.locator('.library-tracks .track-row').nth(5).click({ button: 'right' });
  await p.waitForSelector('.ctx-menu [role="menuitem"]'); await p.waitForTimeout(200);
  await p.locator('.ctx-menu [role="menuitem"]', { hasText: 'info' }).first().click();
  await p.waitForSelector('[role="dialog"]', { timeout: 5000 }).catch(() => {});
  const dialogo = await p.locator('[role="dialog"]').count();
  const s0 = await played(p);
  await blurToBody(p);
  await p.keyboard.press('m'); await p.waitForTimeout(900);
  ok('ignorada_con_dialogo_info', dialogo > 0 && (await played(p)) - s0 === 0, { dialogoAbierto: dialogo > 0, sono: (await played(p)) - s0 > 0 });
  await ctx.close();
}
// 4) mantener M apretada → 1 mezcla
{
  const { ctx, p, libReqs } = await newPage();
  await p.goto(BASE + '/albums'); await p.waitForSelector('.mix-btn'); await p.waitForTimeout(800);
  await blurToBody(p);
  const s0 = await played(p);
  await p.keyboard.down('m'); for (let k = 0; k < 6; k++) { await p.waitForTimeout(60); await p.keyboard.down('m'); } await p.keyboard.up('m');
  await p.waitForTimeout(1500);
  ok('mantener_m_una_sola_mezcla', (await played(p)) - s0 === 1, { reproducciones: (await played(p)) - s0, pedidos: libReqs() });
  await ctx.close();
}
// 5) errores
for (const [name, route, esperaToasts] of [
  ['red_caida_un_toast', (r) => r.abort('failed'), 1],
  ['error_401_sin_toast', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Invalid token' }) }), 0],
]) {
  const { ctx, p, errs } = await newPage({ libRoute: route });
  await p.goto(BASE + '/albums'); await p.waitForSelector('.mix-btn'); await p.waitForTimeout(800);
  await blurToBody(p);
  await p.keyboard.press('m'); await p.waitForTimeout(1500);
  const ts = await toasts(p);
  ok(name, ts.length === esperaToasts && (esperaToasts === 0 || (ts[0].warning && ts[0].texto.includes('No se pudieron cargar las pistas'))) && (await played(p)) === 0 && !(await pageErrs(p, errs)).length, { toasts: ts, erroresSinAtrapar: await pageErrs(p, errs) });
  await ctx.close();
}
{
  const { ctx, p, errs } = await newPage({ libRoute: (r) => r.abort('failed') });
  await p.goto(BASE + '/albums'); await p.waitForSelector('.mix-btn'); await p.waitForTimeout(800);
  await blurToBody(p);
  for (let k = 0; k < 3; k++) { await p.keyboard.press('m'); await p.waitForTimeout(250); }
  await p.waitForTimeout(1000);
  ok('tres_m_con_fallo_un_toast', (await toasts(p)).length === 1 && !(await pageErrs(p, errs)).length, { toasts: (await toasts(p)).length });
  await ctx.close();
}
// 6) lista fría: 1 solo pedido
{
  const { ctx, p, libReqs } = await newPage();
  await p.goto(BASE + '/albums'); await p.waitForSelector('.mix-btn'); await p.waitForTimeout(800);
  const r0 = libReqs();
  await blurToBody(p);
  await p.keyboard.press('m'); await p.waitForTimeout(1500);
  const cola = await queueLen(p);
  ok('lista_fria_un_pedido', libReqs() - r0 === 1 && cola === TOTAL, { pedidos: libReqs() - r0, cola });
  await ctx.close();
}
// 7) biblioteca de 1 pista: nada
{
  const { ctx, p, errs } = await newPage({ libRoute: (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LIB.slice(0, 1)) }) });
  await p.goto(BASE + '/albums'); await p.waitForSelector('.mix-btn'); await p.waitForTimeout(800);
  await blurToBody(p);
  await p.keyboard.press('m'); await p.waitForTimeout(1200);
  ok('biblioteca_de_1_pista_nada', (await played(p)) === 0 && !(await pageErrs(p, errs)).length, { sono: (await played(p)) > 0 });
  await ctx.close();
}

console.log(JSON.stringify(R, null, 1));
const bools = Object.entries(R).filter(([, v]) => v === true || v === false || (v && typeof v === 'object' && 'ok' in v));
const bad = bools.filter(([, v]) => !(v === true || v?.ok === true)).map(([k]) => k);
console.log(`OK ${bools.length - bad.length}/${bools.length}${bad.length ? ' · falla: ' + bad.join(', ') : ''}`);
await browser.close();
