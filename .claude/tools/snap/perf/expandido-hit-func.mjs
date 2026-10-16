// expandido-hit-func.mjs — el botón «Ahora reproduciendo» (.exp-back) de la vista completa se puede
// picar ENTERO en todos sus estados, y un clic real en el centro la cierra.
// Uso: SNAP_BASE=http://localhost:4173 node expandido-hit-func.mjs   (lo corre regresion.mjs)
//
// El bug (1.34.1): con el cajón abierto (letra o cola) el cuerpo sube por el translateY inline de
// E2d; un transform pinta al cuerpo en la capa de los posicionados, encima de una cabecera static,
// y se comía el clic: sólo la franja izquierda del botón respondía (10 de 150 puntos).
//
// Qué mide por estado × ancho (cada combinación es UN chequeo, todo o nada):
//   · elementFromPoint en el CENTRO y en las 4 ESQUINAS INTERNAS del botón cae dentro del botón;
//   · un clic real (mouse) en el centro cierra .player-expanded.
// Esquinas: se entran `ceil(r·(1−1/√2)) + 3` px desde cada borde, con r = border-radius del botón
// (10px → 6px). Más afuera el punto puede quedar FUERA de la forma redondeada: con el borde derecho
// en coordenada fraccional (x 309,36 a 1280) Chromium deja la esquina inferior derecha a 3px fuera
// del arco y el hit cae en la propia .exp-header —no es un control tapado, es el radio—. WebKit, en
// cambio, la da por buena. Exigir ese punto sería medir el redondeo, no el bug.
// Estados: a = vista completa · b = + letra en el cajón · q = + cola en el cajón · d = con un video.
// b y q sólo en ≥701px: en el teléfono la letra es inmersiva (tapa la vista completa por diseño y se
// sale con su X) y la cola es la hoja móvil, otro gesto.
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';

await preflight();
const token = await getToken();
const H = { Authorization: `Bearer ${token}` };
const TRACKS = await (await fetch(BASE + '/api/tracks?limit=2', { headers: H })).json();
const VIDS = (await (await fetch(BASE + '/api/videos', { headers: H })).json()).videos ?? [];
const VID = VIDS.find((v) => v.title === 'Largo Para Seek') ?? VIDS[0];
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function wav(sec, sr = 8000) {
  const n = sec * sr; const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const W = wav(120);

async function newPage(w, h) {
  const mobile = w <= 700;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
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
  // El navegador no toca la base: /api/plays se responde acá.
  await ctx.route('**/api/plays', (r) => r.fulfill({ status: 201, contentType: 'application/json', body: '{}' }));
  const p = await ctx.newPage();
  await p.goto(BASE + '/');
  await p.waitForSelector('.player-bar');
  await p.waitForFunction(() => !!window.__player?.());
  return { ctx, p };
}

// Centro + 4 esquinas internas (dentro de la forma redondeada); devuelve qué cayó en cada punto.
const puntos = (p) => p.evaluate(() => {
  const back = document.querySelector('.player-expanded .exp-back');
  if (!back) return null;
  const r = back.getBoundingClientRect();
  const rad = parseFloat(getComputedStyle(back).borderTopLeftRadius) || 0;
  const d = Math.ceil(rad * (1 - Math.SQRT1_2)) + 3;
  const pts = { centro: [r.left + r.width / 2, r.top + r.height / 2], si: [r.left + d, r.top + d], sd: [r.right - d, r.top + d], ii: [r.left + d, r.bottom - d], id: [r.right - d, r.bottom - d] };
  const out = {};
  for (const [k, [x, y]] of Object.entries(pts)) {
    const e = document.elementFromPoint(x, y);
    out[k] = e && back.contains(e) ? 'ok' : (e ? e.tagName.toLowerCase() + '.' + [...e.classList].join('.') : 'null');
  }
  return out;
});

const R = {};
const CASOS = [];
for (const [w, h] of [[1280, 800], [1024, 768], [810, 1080]]) for (const st of ['a', 'b', 'q', 'd']) CASOS.push([w, h, st]);
for (const [w, h] of [[390, 844], [360, 780]]) for (const st of ['a', 'd']) CASOS.push([w, h, st]);

for (const [w, h, st] of CASOS) {
  const k = `${w}_${st}`;
  const { ctx, p } = await newPage(w, h);
  try {
    await p.evaluate((q) => window.__player().play(q, 0), st === 'd' ? [{ ...VID, kind: 'video' }] : [TRACKS[0]]);
    await sleep(800);
    await p.locator('.player-bar').click({ position: { x: 6, y: 6 } });
    await p.waitForSelector('.player-expanded', { timeout: 4000 });
    await sleep(600);
    if (st === 'b' || st === 'q') {
      await p.locator(`.player-expanded [aria-label="${st === 'b' ? 'Letra' : 'Cola'}"]`).filter({ visible: true }).first().click();
      await p.waitForSelector('.exp-drawer.open', { timeout: 3000 });
      await sleep(700);   // el slide del cajón y el lift del cuerpo (.3s) terminaron
    }
    const pts = await puntos(p);
    const box = await p.locator('.player-expanded .exp-back').boundingBox();
    await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const cierra = await p.waitForSelector('.player-expanded', { state: 'detached', timeout: 2000 }).then(() => true).catch(() => false);
    const okPts = pts && Object.values(pts).every((v) => v === 'ok');
    R[k] = { ok: !!okPts && cierra, cierra, ...(okPts ? {} : { puntos: pts }) };
  } catch (e) {
    R[k] = { ok: false, error: e.message.split('\n')[0] };
  }
  await ctx.close();
}
await browser.close();

console.log(JSON.stringify(R, null, 1));
const bools = Object.entries(R);
const bad = bools.filter(([, v]) => v.ok !== true).map(([k]) => k);
if (bad.length) console.log(`falla: ${bad.join(', ')}`);
console.log(`\nexpandido-hit-func: ${bools.length - bad.length}/${bools.length}`);
process.exit(bad.length ? 1 : 0);
