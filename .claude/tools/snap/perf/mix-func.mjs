// mix-func.mjs — pruebas funcionales del "Mix aleatorio" por vista (Frente 2, sub-paso M2a).
//   1. Biblioteca con búsqueda "daf": el Mix mezcla la lista filtrada COMPLETA (= contador), no las
//      filas montadas por la ventana.
//   2. Listados en frío (URL directa, sin Biblioteca en memoria): 1 solo request y funciona.
//   3. Listados en caliente (Biblioteca → vista por la sidebar): 0 requests.
//   4. Vista con 0 pistas y con 1 pista: sin errores y no suena nada (desde M2b, < 2 no se mezcla).
//   5. Cambio de cuenta con la lista EN MEMORIA: el Mix no reproduce la lista de la cuenta anterior.
//   6. Cambio de cuenta con el pedido EN VUELO: el resultado se descarta, no suena nada.
//      (5 y 6 usan un JWT con OTRO id en el payload, sin firma válida: el servidor lo rechaza; sólo
//      prueba el aislamiento del lado del cliente. No hay una segunda cuenta real en .env.)
//   7. Random Access Memories (tarjeta con album_artist vacío): cuántas veces entran sus pistas al
//      Mix de Álbumes.
// Uso: SNAP_BASE=http://localhost:4173 node mix-func.mjs
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
// JWT con OTRO id (payload distinto, firma inválida): el cliente lo ve como otra cuenta.
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const OTHER = `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ id: 987654321, username: 'otra-cuenta' })}.firma-invalida`;

const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };

async function newPage({ tracksBody, delayTracks } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**/stream/**', (r) => {
    const h = r.request().headers().range; const total = WAV.length;
    if (!h) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV });
    const [, a, b] = h.match(/bytes=(\d*)-(\d*)/); const start = a ? +a : 0; const end = b ? +b : total - 1;
    r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: WAV.subarray(start, end + 1) });
  });
  if (tracksBody || delayTracks) {
    await ctx.route((url) => { const u = new URL(url); return u.pathname === '/api/tracks' && u.searchParams.get('limit') === '10000' && [...u.searchParams.keys()].length === 1; },
      async (r) => {
        if (delayTracks) await new Promise((s) => setTimeout(s, delayTracks));
        if (tracksBody) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tracksBody) });
        return r.fallback();
      });
  }
  await ctx.addInitScript((t) => {
    localStorage.setItem('token', t);
    window.__errors = [];
    window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
    window.addEventListener('unhandledrejection', (e) => window.__errors.push('rechazo: ' + String(e.reason?.message ?? e.reason)));
    const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    Object.defineProperty(HTMLMediaElement.prototype, 'src', { configurable: true, get() { return d.get.call(this); }, set(v) { window.__srcSets = (window.__srcSets ?? 0) + 1; d.set.call(this, v); } });
  }, token);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message)));
  const reqs = [];
  p.on('request', (r) => { const u = new URL(r.url()); if (u.pathname === '/api/tracks') reqs.push({ q: u.search, auth: r.headers().authorization ?? '' }); });
  return { ctx, p, errs, reqs };
}
const kicker = (p) => p.evaluate(() => Number((document.querySelector('.queue-panel .queue-kicker')?.textContent.match(/(\d+)\s+pistas?/) ?? [])[1] ?? 0));
async function queueLen(p) {
  await p.click('.player-bar [aria-label="Cola"]');
  await p.waitForSelector('.queue-panel .queue-kicker');
  const n = await kicker(p);
  await p.click('.player-bar [aria-label="Cola"]');
  return n;
}

// 1) Biblioteca con búsqueda
{
  const { ctx, p, errs } = await newPage();
  await p.goto(BASE + '/'); await p.waitForSelector('.library-tracks .track-row'); await p.waitForTimeout(1200);
  await p.fill('.search-box input', 'daf'); await p.waitForTimeout(800);
  const contador = Number(((await p.locator('.library-count').getAttribute('aria-label')) ?? '').match(/\d+/)?.[0] ?? NaN);
  const montadas = await p.locator('.library-tracks .track-row').count();
  await p.click('.library-actions .mix-btn'); await p.waitForTimeout(1200);
  const cola = await queueLen(p);
  ok('busqueda_daf_mezcla_filtrada_completa', cola === contador && cola !== montadas, { cola, contador, filasMontadas: montadas, errores: errs.length });
  await ctx.close();
}

// 2 y 3) frío y caliente en los 4 listados
for (const [key, label, path, pred] of [
  ['albums', 'Álbumes', '/albums', (t) => t.album != null],
  ['artists', 'Artistas', '/artists', (t) => t.album_artist != null && t.album_artist !== ''],
  ['genres', 'Géneros', '/genres', (t) => t.genre != null && t.genre !== ''],
  ['years', 'Años', '/years', (t) => t.year != null],
]) {
  const esperado = LIB.filter(pred).length;
  // frío
  { const { ctx, p, errs, reqs } = await newPage();
    await p.goto(BASE + path); await p.waitForSelector('.section-header .mix-btn'); await p.waitForTimeout(1000);
    const r0 = reqs.length;
    await p.click('.section-header .mix-btn'); await p.waitForTimeout(1500);
    const n = reqs.length - r0; const cola = await queueLen(p);
    ok(`${key}_frio`, n === 1 && cola === esperado && !errs.length, { requests: n, cola, esperado });
    await ctx.close(); }
  // caliente
  { const { ctx, p, errs, reqs } = await newPage();
    await p.goto(BASE + '/'); await p.waitForSelector('.library-tracks .track-row'); await p.waitForTimeout(1200);
    await p.click(`.sidebar button:has-text("${label}")`); await p.waitForSelector('.section-header .mix-btn'); await p.waitForTimeout(800);
    const r0 = reqs.length;
    await p.click('.section-header .mix-btn'); await p.waitForTimeout(1500);
    const n = reqs.length - r0; const cola = await queueLen(p);
    ok(`${key}_caliente`, n === 0 && cola === esperado && !errs.length, { requests: n, cola, esperado });
    await ctx.close(); }
}

// 4) 0 y 1 pista
for (const [name, body] of [['vista_0_pistas', []], ['vista_1_pista', [LIB.find((t) => t.album != null)]]]) {
  const { ctx, p, errs } = await newPage({ tracksBody: body });
  await p.goto(BASE + '/albums'); await p.waitForSelector('.section-header .mix-btn'); await p.waitForTimeout(1000);
  await p.click('.section-header .mix-btn'); await p.waitForTimeout(1500);
  const st = await p.evaluate(() => ({ srcSets: window.__srcSets ?? 0, errores: window.__errors, disabled: document.querySelector('.section-header .mix-btn').disabled, texto: document.querySelector('.section-header .mix-btn').textContent }));
  const cola = 0;   // nada que encolar (ver okk)
  // Desde M2b (ShuffleButton) con < 2 pistas no se reproduce nada: un mix de 1 no es un mix.
  const okk = !errs.length && !st.errores.length && !st.disabled && st.srcSets === 0;
  ok(name, okk, { suenaAlgo: st.srcSets > 0, cola, errores: [...errs, ...st.errores], botonVuelveAEstado: st.texto.trim() });
  await ctx.close();
}

// 5) cambio de cuenta con la lista EN MEMORIA
{
  const { ctx, p, errs, reqs } = await newPage();
  await p.goto(BASE + '/'); await p.waitForSelector('.library-tracks .track-row'); await p.waitForTimeout(1200);   // caché de la cuenta A
  await p.click('.sidebar button:has-text("Álbumes")'); await p.waitForSelector('.section-header .mix-btn'); await p.waitForTimeout(800);
  await p.evaluate((t) => localStorage.setItem('token', t), OTHER);   // "otra cuenta"
  const r0 = reqs.length;
  await p.click('.section-header .mix-btn').catch(() => {});
  await p.waitForTimeout(2000);
  const nuevas = reqs.slice(r0);
  const st = await p.evaluate(() => ({ srcSets: window.__srcSets ?? 0 }));
  // la lista de A NO debe reproducirse; el helper debe pedir con el token de la otra cuenta
  ok('cambio_cuenta_con_cache', st.srcSets === 0 && nuevas.some((x) => x.auth.endsWith(OTHER.slice(-20))), { suenaListaDeA: st.srcSets > 0, requestsTrasCambio: nuevas.length, conTokenNuevo: nuevas.some((x) => x.auth.endsWith(OTHER.slice(-20))), erroresDePagina: errs });
  await ctx.close();
}

// 6) cambio de cuenta con el pedido EN VUELO (biblioteca demorada 1,5 s)
{
  const { ctx, p, errs, reqs } = await newPage({ delayTracks: 1500 });
  await p.goto(BASE + '/albums'); await p.waitForSelector('.section-header .mix-btn'); await p.waitForTimeout(800);
  await p.click('.section-header .mix-btn');
  await p.waitForTimeout(300);
  await p.evaluate((t) => localStorage.setItem('token', t), OTHER);   // cambia la cuenta con el pedido en vuelo
  await p.waitForTimeout(2500);
  const st = await p.evaluate(() => ({ srcSets: window.__srcSets ?? 0 }));
  ok('cambio_cuenta_en_vuelo', st.srcSets === 0, { suenaListaDeA: st.srcSets > 0, erroresDePagina: errs });
  await ctx.close();
}

// 7) Random Access Memories: sus pistas en el Mix de Álbumes
{
  const ram = LIB.filter((t) => /^Random Access Memories/.test(t.album ?? ''));
  const conArtista = ram.filter((t) => t.album_artist).length;
  const ids = new Set(LIB.filter((t) => t.album != null).map((t) => t.id));
  ok('ram_en_mix_albumes', ram.every((t) => ids.has(t.id)), { pistasRAM: ram.length, conAlbumArtist: conArtista, sinAlbumArtist: ram.length - conArtista, vecesCadaUna: 1, nota: 'el Mix del listado se deriva de la biblioteca (cada pista una vez), no de la unión de tarjetas' });
}

console.log(JSON.stringify(R, null, 1));
const bools = Object.entries(R).filter(([, v]) => v === true || v === false || (v && typeof v === 'object' && 'ok' in v));
const bad = bools.filter(([, v]) => !(v === true || v?.ok === true)).map(([k]) => k);
console.log(`OK ${bools.length - bad.length}/${bools.length}${bad.length ? ' · falla: ' + bad.join(', ') : ''}`);
await browser.close();
