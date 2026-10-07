// virt-check.mjs — verificación de la VENTANA de Biblioteca (Frente 1, sub-paso 9): parpadeo y
// comportamiento con filas fuera de la ventana. "Hueco" = un punto de la vista de filas que cae en una
// fila espaciadora (se vería vacío). Uso: SNAP_BASE=http://localhost:4173 [SCALE=3000] node virt-check.mjs
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
const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };
const ROWS = '.library-tracks .track-row';

async function session(opts = { viewport: { width: 1440, height: 900 } }) {
  const ctx = await browser.newContext(opts);
  await ctx.route('**/stream/**', (r) => r.fulfill({ status: 200, contentType: 'audio/wav', body: WAV }));
  await ctx.addInitScript((t) => localStorage.setItem('token', t), token);
  if (SCALE) {
    const real = await fetch(`${BASE}/api/tracks?limit=10000`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
    const tracks = []; for (let k = 0; tracks.length < SCALE; k++) for (const t of real) { if (tracks.length >= SCALE) break; tracks.push({ ...t, id: t.id + k * 1_000_000 }); }
    await ctx.route((url) => { const u = new URL(url); return u.pathname === '/api/tracks' && u.searchParams.get('limit') === '10000' && [...u.searchParams.keys()].length === 1; },
      (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tracks) }));
  }
  const p = await ctx.newPage();
  await p.goto(BASE + '/');
  await p.waitForSelector(ROWS);
  await p.waitForTimeout(1200);
  return { ctx, p };
}
// En página: instala un muestreador por frame que cuenta frames con algún punto de la vista en un hueco.
// Mide DESPUÉS del pintado (rAF → setTimeout 0): un chequeo dentro del rAF puede correr antes que el rAF
// de la ventana en el mismo frame y ver el DOM viejo, aunque lo pintado ya esté completo.
const installProbe = (p) => p.evaluate(() => {
  window.__holes = 0; window.__frames = 0; window.__run = true;
  const sc = document.querySelector('.main-content');
  const check = () => {
    const body = document.querySelector('.library-tracks tbody');
    if (!sc.isConnected || !body) { window.__frames++; return; }   // tabla aún no montada
    const r = sc.getBoundingClientRect();
    const tb = body.getBoundingClientRect();
    const y0 = Math.max(r.top + 4, tb.top + 4), y1 = Math.min(r.bottom - 4, tb.bottom - 4);
    let hole = false;
    for (let k = 0; k <= 8 && y1 > y0; k++) {
      const el = document.elementFromPoint(r.left + r.width / 2, y0 + (y1 - y0) * k / 8);
      if (el && el.closest('tr[aria-hidden="true"]')) { hole = true; break; }
    }
    window.__frames++; if (hole) window.__holes++;
  };
  const f = () => { setTimeout(check, 0); if (window.__run) requestAnimationFrame(f); };
  requestAnimationFrame(f);
});
const stopProbe = (p) => p.evaluate(() => { window.__run = false; return { frames: window.__frames, framesConHueco: window.__holes }; });

// 1) scroll rápido con la rueda
{
  const { ctx, p } = await session();
  const box = await p.locator('.main-content').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await installProbe(p);
  const tEnd = Date.now() + 2500; let dir = 1, k = 0;
  while (Date.now() < tEnd) { await p.mouse.wheel(0, 400 * dir); if (++k % 40 === 0) dir = -dir; await p.waitForTimeout(10); }
  const r = await stopProbe(p);
  ok('rueda_rapida_sin_huecos', r.framesConHueco === 0, r);
  // 2) saltos con la barra (scrollTop directo: lo que hace arrastrar el thumb)
  await installProbe(p);
  const jumps = await p.evaluate(async () => {
    const sc = document.querySelector('.main-content'); const out = [];
    for (const frac of [0.5, 1, 0.1, 0.75, 0]) {
      sc.scrollTop = (sc.scrollHeight - sc.clientHeight) * frac;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const vis = [...document.querySelectorAll('.library-tracks .track-row')].filter((tr) => { const b = tr.getBoundingClientRect(); const s = sc.getBoundingClientRect(); return b.bottom > s.top && b.top < s.bottom; });
      out.push({ frac, filasVisibles: vis.length });
    }
    return out;
  });
  const r2 = await stopProbe(p);
  // Los saltos se hacen con scrollTop desde el script: la sonda puede ver el estado intermedio (scroll
  // ya movido, ventana todavía no) que NUNCA llega a pintarse. Por eso acá sólo se exige que haya filas
  // visibles tras cada salto; los frames vacíos REALES los mide saltos-pintados.mjs (screencast).
  ok('saltos_barra', jumps.every((j) => j.filasVisibles > 0), { ...r2, nota: 'framesConHueco de sonda: incluye estados no pintados; ver saltos-pintados.mjs', jumps });
  // 3) a mitad: clic en una fila visible reproduce ESA pista
  await p.evaluate(() => { const sc = document.querySelector('.main-content'); sc.scrollTop = (sc.scrollHeight - sc.clientHeight) / 2; });
  await p.waitForTimeout(400);
  const target = await p.evaluate(() => { const sc = document.querySelector('.main-content').getBoundingClientRect(); const tr = [...document.querySelectorAll('.library-tracks .track-row')].find((t) => t.getBoundingClientRect().top > sc.top + 100); return { idx: tr.dataset.index, title: tr.querySelector('.track-title').textContent }; });
  await p.locator(`${ROWS}[data-index="${target.idx}"]`).click(); await p.waitForTimeout(700);
  const playing = await p.evaluate(() => document.querySelector('.library-tracks .track-row.playing .track-title')?.textContent);
  ok('clic_a_mitad_reproduce_esa', playing === target.title, { esperado: target.title, suena: playing, indice: target.idx });
  // 4) clic derecho en las filas visibles de los extremos (primera y última de la vista)
  const ext = await p.evaluate(() => { const s = document.querySelector('.main-content').getBoundingClientRect(); const vis = [...document.querySelectorAll('.library-tracks .track-row')].filter((tr) => { const b = tr.getBoundingClientRect(); return b.top >= s.top && b.bottom <= s.bottom; }); return [vis[0].dataset.index, vis.at(-1).dataset.index]; });
  const menus = [];
  for (const idx of ext) {
    let open = false;
    for (let k = 0; k < 3 && !open; k++) { await p.locator(`${ROWS}[data-index="${idx}"]`).click({ button: 'right' }); open = await p.waitForSelector('.ctx-menu [role="menuitem"]', { timeout: 1500 }).then(() => true).catch(() => false); }
    menus.push({ idx, menu: open });
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  }
  ok('clic_derecho_extremos', menus.every((m) => m.menu), { menus });
  // 5) foco: el "⋯" de una fila conserva el foco aunque se scrollee lejos
  const fIdx = ext[0];
  await p.locator(`${ROWS}[data-index="${fIdx}"] .ctx-row-btn`).focus();
  await p.evaluate(() => { document.querySelector('.main-content').scrollTop = 0; });
  await p.waitForTimeout(500);
  const foco = await p.evaluate((i) => ({ montada: !!document.querySelector(`.library-tracks tr[data-index="${i}"]`), conFoco: document.activeElement?.closest?.('tr')?.dataset.index }), fIdx);
  ok('foco_se_conserva_fuera_de_ventana', foco.montada && foco.conFoco === fIdx, foco);
  await p.keyboard.press('Tab'); await p.waitForTimeout(200);
  ok('tab_sigue_en_la_tabla', await p.evaluate(() => !!document.activeElement?.closest?.('.library-tracks') || document.activeElement?.tagName));
  // 6) arrastre con scroll a mitad del gesto: la fila de origen sigue montada y el drop encola
  await p.locator('body').click({ position: { x: 2, y: 2 } }).catch(() => {});
  await p.click('.player-bar [aria-label="Cola"]'); await p.waitForSelector('.queue-panel .queue-row');
  const q0 = await p.locator('.queue-panel .queue-row').count();
  await p.evaluate(() => { document.querySelector('.main-content').scrollTop = 0; }); await p.waitForTimeout(400);
  const src = p.locator(`${ROWS}[data-index="3"]`);
  const sb = await src.boundingBox(); const qb = await p.locator('.queue-panel').boundingBox();
  await p.mouse.move(sb.x + 200, sb.y + sb.height / 2); await p.mouse.down();
  await p.mouse.move(sb.x + 260, sb.y + sb.height / 2 + 10, { steps: 5 });
  await p.evaluate(() => { const sc = document.querySelector('.main-content'); sc.scrollTop = sc.scrollHeight; }); await p.waitForTimeout(400);
  const srcMounted = await p.evaluate(() => !!document.querySelector('.library-tracks tr[data-index="3"]'));
  await p.mouse.move(qb.x + qb.width / 2, qb.y + qb.height / 2, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(800);
  const q1 = await p.locator('.queue-panel .queue-row').count();
  const pinLibre = await p.evaluate(() => ({ fila3Montada: !!document.querySelector('.library-tracks tr[data-index="3"]') }));
  ok('arrastre_con_scroll', q1 === q0 + 1 && srcMounted, { cola: `${q0}→${q1}`, origenMontadoDuranteScroll: srcMounted, despuesDelDrop: pinLibre });
  // 7) cambio de modo con el scroll a mitad (la cola abierta pasa a modo lista a este ancho? → forzamos 1000px)
  await p.click('.player-bar [aria-label="Cola"]'); await p.waitForTimeout(300);
  await p.evaluate(() => { const sc = document.querySelector('.main-content'); sc.scrollTop = (sc.scrollHeight - sc.clientHeight) / 2; }); await p.waitForTimeout(300);
  await installProbe(p);
  await p.setViewportSize({ width: 900, height: 900 }); await p.waitForTimeout(600);
  await p.setViewportSize({ width: 1440, height: 900 }); await p.waitForTimeout(600);
  const r7 = await stopProbe(p);
  const vis7 = await p.evaluate(() => { const s = document.querySelector('.main-content').getBoundingClientRect(); return [...document.querySelectorAll('.library-tracks .track-row')].filter((tr) => { const b = tr.getBoundingClientRect(); return b.bottom > s.top && b.top < s.bottom; }).length; });
  ok('cambio_de_modo_a_mitad', vis7 > 0, { ...r7, filasVisiblesAlFinal: vis7 });
  // 8) volver a Biblioteca desde otra vista
  await p.click('.sidebar button:has-text("Álbumes")'); await p.waitForSelector('.album-grid .album-card');
  await installProbe(p);
  await p.click('.sidebar button:has-text("Biblioteca")'); await p.waitForSelector(ROWS); await p.waitForTimeout(600);
  const r8 = await stopProbe(p);
  ok('volver_a_biblioteca', r8.framesConHueco === 0, { ...r8, filas: await p.locator(ROWS).count() });
  // 9) búsqueda con el scroll al final: la lista se acorta y el scroll queda en rango
  await p.evaluate(() => { const sc = document.querySelector('.main-content'); sc.scrollTop = sc.scrollHeight; }); await p.waitForTimeout(400);
  await p.fill('.search-box input', 'daf'); await p.waitForTimeout(800);
  const r9 = await p.evaluate(() => { const sc = document.querySelector('.main-content'); const s = sc.getBoundingClientRect(); const vis = [...document.querySelectorAll('.library-tracks .track-row')].filter((tr) => { const b = tr.getBoundingClientRect(); return b.bottom > s.top && b.top < s.bottom; }); return { scrollTop: Math.round(sc.scrollTop), max: sc.scrollHeight - sc.clientHeight, filasVisibles: vis.length, contador: document.querySelector('.library-count')?.getAttribute('aria-label') }; });
  ok('busqueda_con_scroll_al_final', r9.filasVisibles > 0 && r9.scrollTop <= r9.max, r9);
  await ctx.close();
}
// 10) long-press en móvil con el scroll a mitad
{
  const { ctx, p } = await session({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await p.evaluate(() => { const sc = document.querySelector('.main-content'); sc.scrollTop = (sc.scrollHeight - sc.clientHeight) / 2; }); await p.waitForTimeout(500);
  const idx = await p.evaluate(() => { const s = document.querySelector('.main-content').getBoundingClientRect(); return [...document.querySelectorAll('.library-tracks .track-row')].find((tr) => tr.getBoundingClientRect().top > s.top + 150).dataset.index; });
  const b = await p.locator(`${ROWS}[data-index="${idx}"]`).boundingBox();
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); await p.waitForTimeout(700); await p.mouse.up(); await p.waitForTimeout(400);
  ok('longpress_a_mitad', (await p.locator('.ctx-menu.ctx-menu--tiles').count()) === 1, { indice: idx });
  await ctx.close();
}
console.log(JSON.stringify(R, null, 1));
await browser.close();
