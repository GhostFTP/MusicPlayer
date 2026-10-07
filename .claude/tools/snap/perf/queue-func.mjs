// queue-func.mjs — pruebas funcionales de la COLA con ventana (frente 2 · sub-paso Q).
// Corre igual sobre el build sin ventana (baseline): los chequeos de "ventana" se informan como n/a.
// Escritorio 1440 (columna), drawer del expandido (escritorio) y hoja móvil 390 (dos alturas).
// Uso: SNAP_BASE=http://localhost:4173 [SCALE=3000] [SKIP_LONG=1] node queue-func.mjs
//   SKIP_LONG=1 salta "arrastrar la primera hasta el final" (~100 s de autoscroll con 3000).
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';

const SCALE = Number(process.env.SCALE ?? 0);
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
let tracks = null;
if (SCALE) {
  const real = await fetch(`${BASE}/api/tracks?limit=10000`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  tracks = []; for (let k = 0; tracks.length < SCALE; k++) for (const t of real) { if (tracks.length >= SCALE) break; tracks.push({ ...t, id: t.id + k * 1_000_000 }); }
}
async function newCtx(opts) {
  const ctx = await browser.newContext({ deviceScaleFactor: 1, ...opts });
  await ctx.route('**/stream/**', (r) => {
    const h = r.request().headers().range; const total = WAV.length;
    if (!h) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV });
    const [, a, b] = h.match(/bytes=(\d*)-(\d*)/); const start = a ? +a : 0; const end = b ? +b : total - 1;
    r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: WAV.subarray(start, end + 1) });
  });
  if (tracks) await ctx.route((url) => { const u = new URL(url); return u.pathname === '/api/tracks' && u.searchParams.get('limit') === '10000' && [...u.searchParams.keys()].length === 1; },
    (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tracks) }));
  await ctx.addInitScript((t) => {
    localStorage.setItem('token', t);
    const A = window.Audio;
    window.Audio = function (...a) { const x = new A(...a); window.__audio = x; return x; };
  }, token);
  const p = await ctx.newPage();
  await p.goto(BASE + '/');
  await p.waitForSelector('.library-tracks .track-row');
  await p.waitForTimeout(1500);
  return { ctx, p };
}
const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };
const frames = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

// Estado de la cola visible: alto de fila, filas montadas, espaciadoras, la actual y si las filas
// montadas CUBREN todo el área visible (sin hueco en blanco).
const qstate = (p) => p.evaluate(() => {
  const body = document.querySelector('.queue-body');
  const list = document.querySelector('.queue-list');
  if (!body || !list) return null;
  const rows = [...list.querySelectorAll(':scope > .queue-row')];
  const gaps = [...list.querySelectorAll(':scope > .queue-gap')];
  const kicker = document.querySelector('.queue-kicker')?.textContent ?? '';
  const count = Number((kicker.match(/(\d+)\s+pistas?/) ?? [])[1] ?? NaN);
  const br = body.getBoundingClientRect();
  // paso = distancia entre dos filas de índice CONSECUTIVO (con la ventana, la 1.ª montada puede ser
  // una fijada lejos del resto); sin data-index (baseline) todas son consecutivas
  let h = rows[0]?.offsetHeight ?? 0;
  for (let k = 0; k + 1 < rows.length; k++) {
    const a = rows[k].dataset.index, b = rows[k + 1].dataset.index;
    if (a == null || Number(b) === Number(a) + 1) { h = rows[k + 1].getBoundingClientRect().top - rows[k].getBoundingClientRect().top; break; }
  }
  const cur = list.querySelector('.queue-row.current');
  const cr = cur?.getBoundingClientRect();
  // cobertura: cada franja de alto h dentro del área visible tiene una fila montada encima
  let hueco = 0;
  for (let y = br.top + 1; y < br.bottom - 1; y += Math.max(8, h / 2)) {
    const el = document.elementFromPoint(br.left + br.width / 2, y);
    if (!el?.closest?.('.queue-row') && el?.closest?.('.queue-gap')) hueco++;
  }
  const lastRowBottom = rows.length ? rows.at(-1).getBoundingClientRect().bottom : 0;
  return {
    count, montadas: rows.length, espaciadoras: gaps.length, alto: Math.round(h * 10) / 10,
    scrollTop: Math.round(body.scrollTop), max: body.scrollHeight - body.clientHeight, clientH: body.clientHeight,
    actualIdx: cur ? Number(cur.dataset.index ?? rows.indexOf(cur)) : null,
    actualVisible: !!cr && cr.top >= br.top - 1 && cr.bottom <= br.bottom + 1,
    actualCentrada: cr ? Math.round(Math.abs((cr.top + cr.bottom) / 2 - (br.top + br.bottom) / 2)) : null,
    huecosEnBlanco: hueco,
    altoTotalOk: Math.abs((gaps.reduce((s, g) => s + g.getBoundingClientRect().height, 0) + rows.length * h) - count * h) <= 2 || !gaps.length,
    lastRowBottom: Math.round(lastRowBottom - br.top),
  };
});
const idxOfQid = (p, qid) => p.evaluate(async (qid) => {
  // Busca el _qid recorriendo la cola con scroll (con ventana no todas las filas están montadas)
  const body = document.querySelector('.queue-body');
  const top0 = body.scrollTop;
  const fr = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const find = () => { const li = document.querySelector(`.queue-row[data-qid="${qid}"]`); if (!li) return null; return Number(li.dataset.index ?? [...li.parentNode.querySelectorAll(':scope > .queue-row')].indexOf(li)); };
  let i = find();
  if (i == null || !document.querySelector(`.queue-row[data-qid="${qid}"]`).dataset.index) {
    body.scrollTop = 0; await fr();
    while ((i = find()) == null && body.scrollTop + body.clientHeight < body.scrollHeight - 1) { body.scrollTop += body.clientHeight; await fr(); }
  }
  body.scrollTop = top0; await fr();
  return i;
}, qid);
const playingTitle = (p) => p.evaluate(() => document.querySelector('.player-bar .player-track .track-title, .player-bar .player-title')?.textContent ?? null);

// ───────────── ESCRITORIO · columna ─────────────
{
  const { ctx, p } = await newCtx({ viewport: { width: 1440, height: 900 } });
  await p.click('.library-actions .mix-btn');
  await p.waitForTimeout(1200);
  // el mix arranca SIEMPRE en la 0 de la lista barajada: un "siguiente" (aleatorio) la lleva a mitad
  await p.click('.player-bar .ctrl-next'); await p.waitForTimeout(900);
  await p.click('.player-bar [aria-label="Cola"]');
  await p.waitForSelector('.queue-row.current');
  await p.waitForTimeout(600);
  let s = await qstate(p);
  ok('col_abrir_actual_visible', s.actualVisible && (s.actualCentrada <= s.alto || s.scrollTop === 0 || s.scrollTop >= s.max - 1), { actualIdx: s.actualIdx, centrada_px: s.actualCentrada, scrollTop: s.scrollTop });
  ok('col_ventana', s.montadas < s.count || s.count <= 60, { montadas: s.montadas, de: s.count, espaciadoras: s.espaciadoras, alto: s.alto, altoTotalOk: s.altoTotalOk });
  ok('col_sin_huecos_al_abrir', s.huecosEnBlanco === 0, { huecos: s.huecosEnBlanco });
  // scroll a mitad y al final: sin huecos
  for (const where of ['mid', 'end', 'top']) {
    await p.evaluate((w) => { const b = document.querySelector('.queue-body'); const m = b.scrollHeight - b.clientHeight; b.scrollTop = w === 'top' ? 0 : w === 'mid' ? m / 2 : m; }, where);
    await p.waitForTimeout(250);
    s = await qstate(p);
    ok(`col_sin_huecos_${where}`, s.huecosEnBlanco === 0 && s.altoTotalOk, { huecos: s.huecosEnBlanco, montadas: s.montadas, scrollTop: s.scrollTop });
  }
  // la actual sigue montada y marcada aunque la ventana esté en otro lado (arriba)
  s = await qstate(p);
  ok('col_actual_fijada_fuera_de_ventana', s.actualIdx != null, { actualIdx: s.actualIdx, scrollTop: s.scrollTop });
  // cambiar de canción (aleatorio) con la cola abierta → la nueva actual marcada y centrada
  const before = s.actualIdx;
  await p.click('.player-bar .ctrl-next'); await p.waitForTimeout(900);
  s = await qstate(p);
  ok('col_siguiente_resalta_y_centra', s.actualIdx != null && s.actualIdx !== before && s.actualVisible, { antes: before, ahora: s.actualIdx, visible: s.actualVisible, centrada_px: s.actualCentrada });
  ok('col_una_sola_actual', (await p.locator('.queue-row.current').count()) === 1);

  // "Quitar" NO se ofrece sobre la actual (regla de actions-lab)
  await p.locator('.queue-row.current').scrollIntoViewIfNeeded(); await frames(p);
  await p.locator('.queue-row.current').click({ button: 'right' });
  await p.waitForSelector('.ctx-menu [role="menuitem"]');
  const items = await p.locator('.ctx-menu [role="menuitem"]').allTextContents();
  ok('col_quitar_actual_no_se_ofrece', !items.some((t) => t.includes('Quitar')), { items });
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  // quitar otra (actual+2)
  s = await qstate(p);
  const rmRow = p.locator(`.queue-row[data-index="${s.actualIdx + 2}"]`);
  const hasIdx = await rmRow.count();
  const rmLoc = hasIdx ? rmRow : p.locator('.queue-row').nth(s.actualIdx + 2);
  const rmQid = await rmLoc.getAttribute('data-qid');
  await rmLoc.scrollIntoViewIfNeeded(); await frames(p);
  await rmLoc.click({ button: 'right' });
  await p.waitForSelector('.ctx-menu [role="menuitem"]'); await p.waitForTimeout(200);
  await p.locator('.ctx-menu [role="menuitem"]', { hasText: 'Quitar' }).click();
  await p.waitForTimeout(500);
  const s2 = await qstate(p);
  ok('col_quitar_otra', s2.count === s.count - 1 && (await p.locator(`.queue-row[data-qid="${rmQid}"]`).count()) === 0, { cola: `${s.count}→${s2.count}` });

  // "a continuación" desde Biblioteca con la cola abierta
  const libRow = p.locator('.library-tracks .track-row').nth(4);
  const libTitle = await libRow.locator('.track-title').textContent();
  await libRow.scrollIntoViewIfNeeded(); await frames(p);
  await libRow.click({ button: 'right' });
  await p.waitForSelector('.ctx-menu [role="menuitem"]'); await p.waitForTimeout(200);
  await p.locator('.ctx-menu [role="menuitem"]', { hasText: 'continuación' }).click();
  await p.waitForTimeout(500);
  const s3 = await qstate(p);
  const nextRow = await p.evaluate((i) => { const li = document.querySelector(`.queue-row[data-index="${i}"]`) ?? [...document.querySelectorAll('.queue-row')][i]; return li ? { t: li.querySelector('.queue-title-name')?.textContent, pill: !!li.querySelector('.queue-pill') } : null; }, s3.actualIdx + 1);
  ok('col_a_continuacion', s3.count === s2.count + 1 && nextRow?.t === libTitle && nextRow?.pill, { cola: `${s2.count}→${s3.count}`, siguiente: nextRow, esperado: libTitle });

  // arrastrar una fila con el aleatorio sonando (actual+3 → actual+6)
  const shuf = await p.evaluate(() => document.querySelector('.player-bar .shuffle-btn')?.getAttribute('aria-pressed'));
  if (shuf !== 'true') { await p.click('.player-bar .shuffle-btn'); await p.waitForTimeout(300); }
  s = await qstate(p);
  const from = s.actualIdx + 3, to = s.actualIdx + 6;
  const dragLoc = p.locator(`.queue-row[data-index="${from}"]`).or(p.locator('.queue-row').nth(from)).first();
  await dragLoc.scrollIntoViewIfNeeded(); await frames(p);
  const dragQid = await dragLoc.getAttribute('data-qid');
  const curQid = await p.locator('.queue-row.current').getAttribute('data-qid');
  const bb = await dragLoc.boundingBox();
  await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await p.mouse.down();
  for (let k = 1; k <= 12; k++) { await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2 + (3 * s.alto) * k / 12); await p.waitForTimeout(16); }
  await p.mouse.up();
  await p.waitForTimeout(500);
  const dragNow = await idxOfQid(p, dragQid);
  const a1 = await p.evaluate(() => ({ t: window.__audio.currentTime, paused: window.__audio.paused }));
  await p.waitForTimeout(600);
  const a2 = await p.evaluate(() => window.__audio.currentTime);
  ok('col_arrastre_con_aleatorio', dragNow === to && (await p.locator('.queue-row.current').getAttribute('data-qid')) === curQid && !a1.paused && a2 > a1.t, { de: from, a: dragNow, esperado: to, actualIntacta: true, sonando: !a1.paused });

  // Tab: ¿las filas reciben foco? (no son enfocables: se informa igual en los dos builds)
  await p.locator('.queue-close').focus();
  const focos = [];
  for (let k = 0; k < 8; k++) { await p.keyboard.press('Tab'); focos.push(await p.evaluate(() => { const a = document.activeElement; return a?.closest?.('.queue-row') ? 'fila' : (a?.className?.toString().split(' ')[0] || a?.tagName); })); }
  ok('col_tab_filas', true, { secuencia: focos.join(' > ') });

  // arrastrar la PRIMERA hasta el final con autoscroll y soltar FUERA del cuerpo de la cola
  if (!process.env.SKIP_LONG) {
    await p.evaluate(() => { document.querySelector('.queue-body').scrollTop = 0; });
    await p.waitForTimeout(300);
    const first = p.locator('.queue-row').first();
    const firstQid = await first.getAttribute('data-qid');
    const fb = await first.boundingBox();
    const body = await p.locator('.queue-body').boundingBox();
    const t0 = Date.now();
    await p.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
    await p.mouse.down();
    for (let k = 1; k <= 8; k++) { await p.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2 + 8 * k); await p.waitForTimeout(16); }
    await p.mouse.move(fb.x + fb.width / 2, body.y + body.height - 4, { steps: 10 });
    let siempreMontada = true, marcaVista = 0, muestras = 0;
    for (;;) {
      const st = await p.evaluate((q) => { const b = document.querySelector('.queue-body'); const li = document.querySelector(`.queue-row[data-qid="${q}"]`); return { top: b.scrollTop, max: b.scrollHeight - b.clientHeight, montada: !!li && li.classList.contains('queue-row--dragging'), marca: !!document.querySelector('.queue-row--drop-after, .queue-row--drop-before') }; }, firstQid);
      muestras++; if (!st.montada) siempreMontada = false; if (st.marca) marcaVista++;
      if (st.top >= st.max - 1 || Date.now() - t0 > 240000) break;
      await p.waitForTimeout(400);
    }
    // soltar FUERA del cuerpo (debajo)
    await p.mouse.move(fb.x + fb.width / 2, body.y + body.height + 40, { steps: 4 });
    await p.mouse.up();
    await p.waitForTimeout(600);
    const sEnd = await qstate(p);
    const finalIdx = await idxOfQid(p, firstQid);
    ok('col_arrastre_primera_al_final', finalIdx === sEnd.count - 1 && siempreMontada, { quedo_en: finalIdx, esperado: sEnd.count - 1, fila_fijada_todo_el_arrastre: siempreMontada, muestras_con_marca: `${marcaVista}/${muestras}`, seg: Math.round((Date.now() - t0) / 1000) });
  }
  await ctx.close();
}

// ───────────── ESCRITORIO · drawer del expandido ─────────────
{
  const { ctx, p } = await newCtx({ viewport: { width: 1440, height: 900 } });
  await p.click('.library-actions .mix-btn'); await p.waitForTimeout(1200);
  await p.click('.player-bar .ctrl-next'); await p.waitForTimeout(900);
  // clic en la CARÁTULA (borde izquierdo): al centro puede caer el link "Ir al artista", que navega
  { const pb = await p.locator('.player-bar .player-track').boundingBox(); await p.mouse.click(pb.x + 12, pb.y + pb.height / 2); }
  await p.waitForTimeout(600);
  await p.locator('.exp-actions .exp-icon-btn[title="Cola"]').click();
  await p.waitForSelector('.exp-drawer .queue-row.current');
  await p.waitForTimeout(700);
  let s = await qstate(p);
  ok('drawer_abrir_actual_visible', s.actualVisible, { actualIdx: s.actualIdx, centrada_px: s.actualCentrada, montadas: s.montadas, de: s.count, alto: s.alto });
  for (const where of ['mid', 'end']) {
    await p.evaluate((w) => { const b = document.querySelector('.queue-body'); const m = b.scrollHeight - b.clientHeight; b.scrollTop = w === 'mid' ? m / 2 : m; }, where);
    await p.waitForTimeout(250);
    s = await qstate(p);
    ok(`drawer_sin_huecos_${where}`, s.huecosEnBlanco === 0 && s.altoTotalOk, { huecos: s.huecosEnBlanco, montadas: s.montadas });
  }
  await ctx.close();
}

// ───────────── MÓVIL 390 · hoja de dos alturas ─────────────
{
  const { ctx, p } = await newCtx({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await p.click('.library-actions .mix-btn'); await p.waitForTimeout(1200);
  // en móvil el "siguiente" de la mini barra: se usa el de MediaSession vía el contexto → se salta por la cola misma
  await p.click('.player-mini-controls .queue-mini');
  await p.waitForSelector('.exp-drawer .queue-row.current');
  await p.waitForTimeout(800);
  let s = await qstate(p);
  ok('movil_chica_actual_visible', s.actualVisible, { actualIdx: s.actualIdx, centrada_px: s.actualCentrada, montadas: s.montadas, de: s.count, alto: s.alto, alto_visible: s.clientH });
  ok('movil_chica_sin_huecos', s.huecosEnBlanco === 0 && s.altoTotalOk, { huecos: s.huecosEnBlanco });
  const chica = s;
  // agrandar: arrastrar el header de la cola hacia arriba (gesto de la hoja)
  const hb = await p.locator('.exp-drawer .queue-header').boundingBox();
  await p.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await p.mouse.down();
  for (let k = 1; k <= 15; k++) { await p.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2 - 30 * k); await p.waitForTimeout(16); }
  await p.mouse.up();
  await p.waitForTimeout(900);
  s = await qstate(p);
  ok('movil_grande_mas_filas_y_sin_huecos', s.clientH > chica.clientH && s.huecosEnBlanco === 0 && s.altoTotalOk, { alto_visible: `${chica.clientH}→${s.clientH}`, montadas: `${chica.montadas}→${s.montadas}`, huecos: s.huecosEnBlanco });
  for (const where of ['mid', 'end']) {
    await p.evaluate((w) => { const b = document.querySelector('.queue-body'); const m = b.scrollHeight - b.clientHeight; b.scrollTop = w === 'mid' ? m / 2 : m; }, where);
    await p.waitForTimeout(300);
    s = await qstate(p);
    ok(`movil_sin_huecos_${where}`, s.huecosEnBlanco === 0 && s.altoTotalOk, { huecos: s.huecosEnBlanco, montadas: s.montadas });
  }
  // actual a MITAD: tocar una fila a mitad (salta), cerrar la hoja y reabrirla → visible y centrada
  await p.evaluate(() => { const b = document.querySelector('.queue-body'); b.scrollTop = (b.scrollHeight - b.clientHeight) / 2; });
  await p.waitForTimeout(400);
  const midRow = p.locator('.exp-drawer .queue-row:not(.current)').nth(5);
  const midIdx = Number(await midRow.getAttribute('data-index') ?? -1);
  await midRow.click(); await p.waitForTimeout(900);
  await p.click('.exp-drawer .queue-close'); await p.waitForTimeout(700);
  await p.locator('.exp-head-actions .exp-icon-btn[title="Cola"]').click();
  await p.waitForSelector('.exp-drawer .queue-row.current'); await p.waitForTimeout(800);
  s = await qstate(p);
  ok('movil_reabrir_actual_a_mitad_visible', s.actualVisible && s.actualCentrada <= s.alto, { actualIdx: s.actualIdx, tocada: midIdx, centrada_px: s.actualCentrada, huecos: s.huecosEnBlanco });
  await ctx.close();
}

console.log(JSON.stringify(R, null, 1));
const bools = Object.entries(R).filter(([, v]) => v === true || v === false || (v && typeof v === 'object' && 'ok' in v));
const bad = bools.filter(([, v]) => !(v === true || v?.ok === true)).map(([k]) => k);
console.log(`[${SCALE || 680}] OK ${bools.length - bad.length}/${bools.length}${bad.length ? ' · falla: ' + bad.join(', ') : ''}`);
await browser.close();
