// paint.mjs — experimento de PINTADO en Biblioteca (sólo medición: el CSS se INYECTA, no se aplica
// al código). Mide 5 s sonando por variante, a CPU 1x/4x, con y sin GPU, y revisa comportamiento con
// content-visibility. Uso: SNAP_BASE=http://localhost:4173 CPU=1 GPU=0|1 node paint.mjs [--behavior]
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';

const CPU = Number(process.env.CPU ?? 1);
const GPU = process.env.GPU === '1';
const BEHAVIOR = process.argv.includes('--behavior');
await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const args = ['--autoplay-policy=no-user-gesture-required'];
if (GPU) args.push('--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization');
const browser = await chromium.launch({ args });

function wav(sec = 900, sr = 8000) {
  const n = sec * sr, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const WAV = wav();
const log = (...a) => console.log(`[cpu x${CPU}${GPU ? ' gpu' : ''}]`, ...a);

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**/stream/**', (r) => {
    const h = r.request().headers().range; const total = WAV.length;
    if (!h) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV });
    const [, a, b] = h.match(/bytes=(\d*)-(\d*)/); const start = a ? +a : 0; const end = b ? +b : total - 1;
    r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: WAV.subarray(start, end + 1) });
  });
  await ctx.addInitScript((t) => localStorage.setItem('token', t), token);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  await page.goto(BASE + '/');
  await page.waitForSelector('.library-tracks .track-row');
  await page.locator('.library-tracks .track-row').nth(5).click();
  await page.waitForTimeout(CPU > 1 ? 5000 : 3000);
  return { ctx, page, cdp };
}
const metrics = async (cdp) => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));

const { ctx, page, cdp } = await newPage();

// Renderer real: SwiftShader = rasterizado por SOFTWARE.
const renderer = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  return gl ? gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : 'sin WebGL';
});
log('renderer WebGL:', renderer);

// Altura REAL de la fila (del DOM, no supuesta).
const rowH = await page.evaluate(() => Math.round(document.querySelector('.library-tracks .track-row').getBoundingClientRect().height * 100) / 100);
const CV = `.track-table .track-row{content-visibility:auto;contain-intrinsic-size:auto ${rowH}px}`;
const SPARK = '.lyrics-glyph-sparkle{animation:none!important}';
const STRICT = '.main-content{contain:strict}';
const ANIMS = '.lyrics-glyph-sparkle,.seek-shimmer{animation:none!important}';
const BAR = '.lyrics-glyph-sparkle,.seek-shimmer,.time-tick{animation:none!important}.seek-fill{transition:none!important}';
log('altura real de .track-row:', rowH, 'px');

// Nodos DOM por fila.
const perRow = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.library-tracks .track-row')];
  const count = (r) => r.querySelectorAll('*').length + 1;
  const withCover = rows.find((r) => r.querySelector('img'));
  const noCover = rows.find((r) => !r.querySelector('img'));
  const list = (r) => [r, ...r.querySelectorAll('*')].map((n) => n.tagName.toLowerCase() + (typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\s+/).join('.') : '')).join(' > ');
  return {
    total: document.querySelectorAll('*').length,
    filas: rows.length,
    enFilas: rows.reduce((s, r) => s + count(r), 0),
    conCaratula: withCover && count(withCover), sinCaratula: noCover && count(noCover),
    detalle: withCover && list(withCover),
  };
});
log('DOM:', JSON.stringify(perRow));

async function window5(label, css) {
  const tags = [];
  for (const c of css) tags.push(await page.addStyleTag({ content: c }));
  await page.waitForTimeout(600);
  const reps = [];
  for (let k = 0; k < 2; k++) {
    const a = await metrics(cdp); await page.waitForTimeout(5000); const z = await metrics(cdp);
    reps.push({ task: Math.round((z.TaskDuration - a.TaskDuration) * 1000), script: Math.round((z.ScriptDuration - a.ScriptDuration) * 1000), layout: Math.round((z.LayoutDuration - a.LayoutDuration) * 1000), style: Math.round((z.RecalcStyleDuration - a.RecalcStyleDuration) * 1000) });
  }
  const extra = css.includes(CV) ? await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.library-tracks .track-row')];
    return { cv: getComputedStyle(rows[0]).contentVisibility, saltadas: rows.filter((r) => !r.checkVisibility({ contentVisibilityAuto: true })).length };
  }) : null;
  for (const t of tags) await t.evaluate((n) => n.remove());
  log(`${label.padEnd(36)}`, reps.map((r) => `task ${r.task} · script ${r.script} · layout ${r.layout} · style ${r.style}`).join('  |  '), extra ? JSON.stringify(extra) : '');
}

if (!BEHAVIOR) {
  await window5('sin CSS inyectado', []);
  await window5('content-visibility filas', [CV]);
  await window5('sparkle sin animar', [SPARK]);
  await window5('sparkle sin animar + content-visibility', [SPARK, CV]);
  await window5('sparkle + shimmer sin animar', [ANIMS]);
  await window5('las 4 animaciones de la barra apagadas', [BAR]);
  await window5('4 apagadas + contain:strict', [BAR, STRICT]);
  await window5('(ref) main-content contain:strict', [STRICT]);
} else {
  // ── Comportamiento con content-visibility inyectado ──
  const before = await page.evaluate(() => { const sc = document.querySelector('.main-content'); return { scrollH: sc.scrollHeight }; });
  await page.addStyleTag({ content: CV });
  await page.waitForTimeout(500);
  const r = {};
  r.scrollHeight = `${before.scrollH} → ${await page.evaluate(() => document.querySelector('.main-content').scrollHeight)}`;
  r.cvAplica = await page.evaluate(() => getComputedStyle(document.querySelector('.library-tracks .track-row')).contentVisibility);
  // scroll a una fila lejana
  r.filaLejana = await page.evaluate(async () => {
    const row = document.querySelectorAll('.library-tracks .track-row')[600];
    row.scrollIntoView({ block: 'center' });
    await new Promise((res) => setTimeout(res, 400));
    const b = row.getBoundingClientRect();
    return { top: Math.round(b.top), alto: Math.round(b.height), visible: b.top >= 0 && b.bottom <= innerHeight, texto: row.querySelector('.track-title').textContent.slice(0, 30) };
  });
  // scroll-anchoring: ¿se mueve solo el scroll en 2 s con música sonando?
  r.anclaje = await page.evaluate(async () => {
    const sc = document.querySelector('.main-content'); sc.scrollTop = 9000;
    await new Promise((res) => setTimeout(res, 300));
    const t0 = sc.scrollTop; await new Promise((res) => setTimeout(res, 2000));
    return { antes: Math.round(t0), despues: Math.round(sc.scrollTop) };
  });
  // scroll rápido de punta a punta: ¿salta el thumb / cambia scrollHeight?
  r.barrido = await page.evaluate(async () => {
    const sc = document.querySelector('.main-content'); const hs = new Set();
    for (let y = 0; y <= sc.scrollHeight; y += 1500) { sc.scrollTop = y; await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))); hs.add(sc.scrollHeight); }
    return { scrollHeightsVistos: [...hs] };
  });
  // resaltado de la fila activa (la 5 suena)
  r.filaActiva = await page.evaluate(async () => {
    const sc = document.querySelector('.main-content'); sc.scrollTop = 0; await new Promise((res) => setTimeout(res, 300));
    const row = document.querySelector('.library-tracks .track-row.playing');
    return { existe: !!row, fondo: row && getComputedStyle(row).backgroundColor, indicador: row?.querySelector('.track-num')?.textContent };
  });
  // siguiente canción con CV: el indicador se mueve
  await page.click('.player-bar .ctrl-next'); await page.waitForTimeout(600);
  r.trasSiguiente = await page.evaluate(() => [...document.querySelectorAll('.library-tracks .track-row')].findIndex((x) => x.classList.contains('playing')));
  // arrastrar una fila (lejana) a la cola
  await page.click('.player-bar [aria-label="Cola"]');
  await page.waitForSelector('.queue-panel .queue-row');
  const q0 = await page.locator('.queue-panel .queue-row').count();
  const far = page.locator('.library-tracks .track-row').nth(300);
  await far.scrollIntoViewIfNeeded();
  await far.dragTo(page.locator('.queue-panel'));
  await page.waitForTimeout(800);
  r.dragACola = `${q0} → ${await page.locator('.queue-panel .queue-row').count()}`;
  await page.click('.player-bar [aria-label="Cola"]');
  // TrackTable: auto-scroll a la pista que suena al abrir un detalle (Álbumes → un álbum con la actual)
  r.autoScrollDetalle = 'ver func2 (Biblioteca no tiene auto-scroll; TrackTable sí)';
  // modo lista (<=1024px): ¿la fila deja de ser table-row y el content-visibility pasa a aplicar?
  await page.setViewportSize({ width: 900, height: 900 }); await page.waitForTimeout(600);
  await page.evaluate(() => { document.querySelector('.main-content').scrollTop = 0; });
  await page.waitForTimeout(400);
  r.modoLista900 = await page.evaluate(() => { const rows = [...document.querySelectorAll('.library-tracks .track-row')]; return { display: getComputedStyle(rows[0]).display, alto: Math.round(rows[0].getBoundingClientRect().height), saltadas: rows.filter((x) => !x.checkVisibility({ contentVisibilityAuto: true })).length, de: rows.length }; });
  log('COMPORTAMIENTO con content-visibility:', JSON.stringify(r, null, 1));
}
await ctx.close();
await browser.close();
