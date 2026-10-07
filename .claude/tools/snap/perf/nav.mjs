// nav.mjs — entrar a Biblioteca y a Álbumes: en frío (1ª visita) y al VOLVER (Frente 1, sub-paso 5).
// Por entrada, en página (rAF): clic→encabezado, clic→primera fila, clic→todas las filas (o
// tarjetas), si se vio el spinner, requests de la lista y si BLOQUEARON (la respuesta llegó antes
// que las filas) o fueron de fondo, y cuántas filas re-renderizó la revalidación (identidad de
// __reactProps$ en los 2.5 s siguientes) + commits de React.
// SCALE=1200|3000 multiplica /api/tracks (ids únicos) y /api/albums (nombres únicos).
// LATENCY=ms retrasa esas dos respuestas (simula la red de producción; en local tardan ~ms).
// Uso: SNAP_BASE=http://localhost:4173 CPU=1 [SCALE=3000] node nav.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';

const CPU = Number(process.env.CPU ?? 1);
const SCALE = Number(process.env.SCALE ?? 0);
const LATENCY = Number(process.env.LATENCY ?? 0);
await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript((t) => {
  localStorage.setItem('token', t);
  try { performance.setResourceTimingBufferSize(10000); } catch {}   // las carátulas no deben desbordarlo
  window.__commits = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers: new Map(), inject() { return 1; },
    onCommitFiberRoot() { window.__commits++; }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {},
  };
}, token);

let tracks = null, albums = null;
if (SCALE) {
  const H = { Authorization: `Bearer ${token}` };
  const real = await fetch(`${BASE}/api/tracks?limit=10000`, { headers: H }).then((r) => r.json());
  const realAlb = await fetch(`${BASE}/api/albums`, { headers: H }).then((r) => r.json());
  tracks = []; for (let k = 0; tracks.length < SCALE; k++) for (const t of real) { if (tracks.length >= SCALE) break; tracks.push({ ...t, id: t.id + k * 1_000_000 }); }
  const reps = Math.ceil(SCALE / real.length);
  albums = []; for (let k = 0; k < reps; k++) for (const a of realAlb) albums.push({ ...a, album: k ? `${a.album} · ${k}` : a.album });
}
if (SCALE || LATENCY) {
  const isList = (u) => (u.pathname === '/api/tracks' && u.searchParams.get('limit') === '10000' && [...u.searchParams.keys()].length === 1) || u.pathname === '/api/albums';
  await ctx.route((url) => isList(new URL(url)), async (r) => {
    const u = new URL(r.request().url());
    if (LATENCY) await new Promise((s) => setTimeout(s, LATENCY));
    const synth = u.pathname === '/api/albums' ? albums : tracks;
    if (synth) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(synth) });
    r.fallback();
  });
}

const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
const log = (...a) => console.log(`[cpu x${CPU}${SCALE ? ` · ${SCALE}` : ' · 680'}${LATENCY ? ` · +${LATENCY}ms red` : ''}]`, ...a);

// Arranca en otra vista (Artistas) para que la 1ª entrada a Biblioteca sea por clic, como las demás.
await page.goto(BASE + '/artists');
await page.waitForSelector('.sidebar');
await page.waitForTimeout(1500);

// Entra a `label` y mide. `rowSel` = filas/tarjetas; `expected` = cuántas debe haber (null = la 1ª
// vez se toma la cuenta final como referencia).
async function enter(label, rowSel, urlPart, expected) {
  return page.evaluate(async ([label, rowSel, urlPart, expected]) => {
    const btn = [...document.querySelectorAll('.sidebar button')].find((b) => b.textContent.trim().startsWith(label));
    performance.clearResourceTimings();
    const c0 = window.__commits;
    const t0 = performance.now();
    btn.click();
    let tHeader = null, tFirst = null, tAll = null, spinner = false, count = 0;
    await new Promise((res) => {
      const f = () => {
        const now = performance.now() - t0;
        const h = document.querySelector('.main-content .section-title');
        if (tHeader == null && h) tHeader = now;
        if (document.querySelector('.main-content .spinner')) spinner = true;
        count = document.querySelectorAll(rowSel).length;
        if (tFirst == null && count > 0) tFirst = now;
        if (count > 0 && (expected == null ? !document.querySelector('.main-content .spinner') : count === expected)) { tAll = now; return res(); }
        if (now > 20000) return res();
        requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
    // revalidación de fondo: ¿re-renderizó filas?
    const nodes = [...document.querySelectorAll(rowSel)];
    const key = (n) => Object.keys(n).find((k) => k.startsWith('__reactProps$'));
    const before = nodes.map((n) => n[key(n)]);
    const cMid = window.__commits;
    await new Promise((r) => setTimeout(r, 2500));
    const rerendered = nodes.filter((n, i) => n.isConnected && n[key(n)] !== before[i]).length;
    const reqs = performance.getEntriesByType('resource').filter((e) => e.name.includes(urlPart));
    const blocking = reqs.filter((e) => tAll == null || e.responseEnd - t0 <= tAll + 1).length;
    return {
      header: Math.round(tHeader), first: Math.round(tFirst), all: Math.round(tAll), count, spinner,
      reqs: reqs.length, blocking, background: reqs.length - blocking,
      rerendered, commitsEntrada: cMid - c0, commitsDespues: window.__commits - cMid,
    };
  }, [label, rowSel, urlPart, expected]);
}

const LIB = ['Biblioteca', '.library-tracks .track-row', '/api/tracks?limit=10000'];
const ALB = ['Álbumes', '.album-grid .album-card', '/api/albums'];
const fmt = (r) => `encabezado ${r.header} · 1ª fila ${r.first} · todas ${r.all} ms (${r.count}) · spinner ${r.spinner ? 'SÍ' : 'no'} · reqs ${r.reqs} (bloq ${r.blocking}, fondo ${r.background}) · re-render por revalidación ${r.rerendered} · commits ${r.commitsEntrada}+${r.commitsDespues}`;

const libCold = await enter(...LIB, null);
const albCold = await enter(...ALB, null);
log('Biblioteca 1ª visita:', fmt(libCold));
log('Álbumes    1ª visita:', fmt(albCold));
const libWarm = [], albWarm = [];
for (let k = 0; k < 3; k++) {
  libWarm.push(await enter(...LIB, libCold.count));
  albWarm.push(await enter(...ALB, albCold.count));
}
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const sum = (rs, k) => `${med(rs.map((r) => r[k]))} (${Math.min(...rs.map((r) => r[k]))}–${Math.max(...rs.map((r) => r[k]))})`;
for (const [name, rs] of [['Biblioteca al volver', libWarm], ['Álbumes al volver   ', albWarm]]) {
  log(`${name}: encabezado ${sum(rs, 'header')} · 1ª fila ${sum(rs, 'first')} · todas ${sum(rs, 'all')} ms · spinner ${rs.some((r) => r.spinner) ? 'SÍ' : 'no'} · reqs bloq ${med(rs.map((r) => r.blocking))} / fondo ${med(rs.map((r) => r.background))} · re-render por revalidación ${med(rs.map((r) => r.rerendered))} · commits ${med(rs.map((r) => r.commitsEntrada))}+${med(rs.map((r) => r.commitsDespues))}`);
}
await browser.close();
