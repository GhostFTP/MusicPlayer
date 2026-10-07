// Verificación funcional del player (read-only). Mismo audio sintético que perf2.mjs.
// Uso: SNAP_BASE=http://localhost:4173 node func.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';

await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
function wav(sec = 120, sr = 8000) {
  const n = sec * sr, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const WAV = wav();
await ctx.route('**/stream/**', (r) => {
  const h = r.request().headers().range; const total = WAV.length;
  if (!h) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV });
  const [, a, b] = h.match(/bytes=(\d*)-(\d*)/); const start = a ? +a : 0; const end = b ? +b : total - 1;
  r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: WAV.subarray(start, end + 1) });
});
await ctx.addInitScript((t) => {
  localStorage.setItem('token', t);
  const A = window.Audio;
  window.Audio = function (...a) { const x = new A(...a); window.__audio = x; return x; };
  window.__pos = [];
  const ms = navigator.mediaSession;
  if (ms?.setPositionState) { const orig = ms.setPositionState.bind(ms); ms.setPositionState = (s) => { window.__pos.push(s); return orig(s); }; }
}, token);
const page = await ctx.newPage();
const wait = (ms) => page.waitForTimeout(ms);
async function menu(i, label) {
  for (let k = 0; k < 3; k++) {
    // Scroll a la fila y 2 frames de espera ANTES del clic derecho: el evento scroll llega en el frame
    // siguiente y ContextMenu se cierra con él (carrera del script, ya pasaba en baseline).
    const row = page.locator('.library-tracks .track-row').nth(i);
    await row.scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await row.click({ button: 'right' });
    if (await page.waitForSelector('.ctx-menu [role="menuitem"]', { timeout: 1500 }).then(() => true).catch(() => false)) break;
  }
  await wait(250);
  await page.locator('.ctx-menu [role="menuitem"]', { hasText: label }).first().click();
}
const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };
const audio = () => page.evaluate(() => ({ t: +window.__audio.currentTime.toFixed(1), paused: window.__audio.paused }));
const playingTitle = () => page.evaluate(() => document.querySelector('.track-row.playing .track-title')?.textContent ?? null);
const rowTitle = (i) => page.locator('.library-tracks .track-row .track-title').nth(i).textContent();
const barTime = () => page.locator('.player-bar .time-elapsed').textContent();
const seekPct = () => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.player-bar .seek')).getPropertyValue('--seek-pct')));
const seekTo = (sec, scope = '.player-bar') => page.evaluate(([sec, scope]) => {
  const inp = document.querySelector(`${scope} .seek input[type=range]`);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, String(sec));
  inp.dispatchEvent(new Event('input', { bubbles: true }));
}, [sec, scope]);

await page.goto(BASE + '/');
await page.waitForSelector('.library-tracks .track-row');
await page.locator('.library-tracks .track-row').first().click();
await wait(1500);

// 1) barra de progreso avanza
const a1 = await barTime(), p1 = await seekPct(); await wait(2200);
const a2 = await barTime(), p2 = await seekPct();
ok('barra_avanza', p2 > p1, { label: `${a1}→${a2}`, pct: `${p1.toFixed(2)}→${p2.toFixed(2)}` });
ok('barra_total', await page.locator('.player-bar .time-total').textContent());

// 2) seek
await seekTo(30); await wait(600);
const s = await audio();
ok('seek_30', s.t >= 30 && s.t < 32, { audioT: s.t, label: await barTime() });

// 3) MediaSession positionState
const pos = await page.evaluate(() => window.__pos.at(-1) ?? null);
ok('mediasession_pos', !!pos && pos.duration === 120 && pos.position >= 30, { last: pos, calls: await page.evaluate(() => window.__pos.length) });
ok('mediasession_meta', await page.evaluate(() => navigator.mediaSession.metadata?.title ?? null));

// 4) play / pausa
await page.click('.player-bar .ctrl-btn.play'); await wait(400);
const paused = (await audio()).paused;
const tP = (await audio()).t; await wait(1200); const tP2 = (await audio()).t;
await page.click('.player-bar .ctrl-btn.play'); await wait(400);
ok('play_pausa', paused && tP === tP2 && !(await audio()).paused, { pausedTimeFrozen: `${tP}→${tP2}` });

// 5) siguiente / anterior
const t0 = await rowTitle(0), t1 = await rowTitle(1);
await page.click('.player-bar .ctrl-next'); await wait(800);
const afterNext = await playingTitle();
await page.click('.player-bar [aria-label="Anterior (←)"]'); await wait(800);
const afterPrev = await playingTitle();
ok('siguiente_anterior', afterNext === t1 && afterPrev === t0, { afterNext, afterPrev });
// anterior con >3s reinicia la misma
await seekTo(20); await wait(500);
await page.click('.player-bar [aria-label="Anterior (←)"]'); await wait(500);
const re = await audio();
ok('anterior_reinicia_>3s', re.t < 2 && (await playingTitle()) === t0, { t: re.t });

// 6) reproducir a continuación (playAfterCurrent) desde el menú
const t10 = await rowTitle(10);
await menu(10, 'Reproducir a continuación');
await wait(400);
const pill = await page.evaluate(() => document.querySelectorAll('.queue-row').length);
await page.click('.player-bar .ctrl-next'); await wait(800);
ok('playAfterCurrent', (await playingTitle()) === t10, { playing: await playingTitle(), esperado: t10 });

// 7) agregar a la cola + cola: abrir, progreso, saltar a una fila
await page.click('.player-bar [aria-label="Cola"]');
await page.waitForSelector('.queue-panel .queue-row');
const qn0 = await page.evaluate(() => Number((document.querySelector('.queue-panel .queue-kicker')?.textContent.match(/(\d+)\s+pistas?/) ?? [])[1] ?? 0));
await menu(20, 'Agregar a la cola'); await wait(400);
const qn1 = await page.evaluate(() => Number((document.querySelector('.queue-panel .queue-kicker')?.textContent.match(/(\d+)\s+pistas?/) ?? [])[1] ?? 0));
ok('addToQueue', qn1 === qn0 + 1, { cola: `${qn0}→${qn1}` });
const qw = () => page.evaluate(() => parseFloat(document.querySelector('.queue-progress-fill')?.style.width ?? 'NaN'));
const w1 = await qw(); await wait(2200); const w2 = await qw();
ok('progreso_cola_avanza', w2 > w1, { width: `${w1.toFixed(2)}%→${w2.toFixed(2)}%` });
const target = await page.locator('.queue-panel .queue-row').nth(5).locator('.queue-title, .queue-row-title').first().textContent().catch(() => null);
await page.locator('.queue-panel .queue-row').nth(5).click(); await wait(800);
const cur = await page.evaluate(() => document.querySelector('.queue-panel .queue-row.current')?.textContent ?? null);
ok('jumpTo_desde_cola', !!cur && (!target || cur.includes(target)), { target, cur: cur?.slice(0, 60) });
await page.click('.player-bar [aria-label="Cola"]'); await wait(400);

// 8) expandido: tiempo y duración
await page.click('.player-bar', { position: { x: 6, y: 6 } });
await page.waitForSelector('.exp-time-elapsed', { timeout: 4000 }).catch(() => {});
const e1 = await page.locator('.exp-time-elapsed').textContent().catch(() => null);
await wait(2200);
const e2 = await page.locator('.exp-time-elapsed').textContent().catch(() => null);
const eT = await page.locator('.exp-time-total').textContent().catch(() => null);
ok('expandido_tiempo', !!e1 && e1 !== e2 && eT === '2:00', { elapsed: `${e1}→${e2}`, total: eT });
// seek desde el expandido
await seekTo(75, '.player-expanded'); await wait(500);
ok('seek_expandido', Math.abs((await audio()).t - 75) < 2, { t: (await audio()).t, label: await page.locator('.exp-time-elapsed').textContent().catch(() => null) });
await page.keyboard.press('Escape'); await wait(500);

// 9) letra sincronizada: línea activa a tiempos fijos (se compara entre builds)
await page.click('.player-bar [aria-label="Letra"]');
const hasLines = await page.waitForSelector('.lyrics-line', { timeout: 12000 }).then(() => true).catch(() => false);
if (!hasLines) ok('letra', 'NO MEDÍ: la pista no trajo letra sincronizada en local');
else {
  const marks = [];
  for (const sec of [15, 40, 70, 100]) {
    await seekTo(sec); await wait(900);
    marks.push(await page.evaluate(() => {
      const a = document.querySelector('.lyrics-line.active') ?? [...document.querySelectorAll('.lyrics-line')].find((n) => /\bactive\b|current/.test(n.className));
      return { t: +window.__audio.currentTime.toFixed(1), active: a?.textContent?.slice(0, 40) ?? null };
    }));
  }
  ok('letra_lineas_activas', marks);
}
console.log(JSON.stringify(R, null, 1));
await browser.close();
