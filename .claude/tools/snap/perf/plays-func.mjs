// plays-func.mjs — funcional del REGISTRO DE ESCUCHAS en el navegador (utils/usePlayLogger.js).
// Audio sintético: WAV de 40 s (umbral = 20 s) reproducido a 4x, así una escucha cuenta en ~5 s
// reales. A 4x el tick de timeupdate avanza ~1 s (< 2 s), igual que a 1x suma; el salto de seek no.
// POST /api/plays se intercepta: en modo 'ok' se reenvía al backend de la sesión (route.fetch) y se
// guarda la respuesta; en modo 'fail' se aborta como una red caída.
// Uso: SNAP_BASE=http://localhost:4173 node plays-func.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';

await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

function wav(sec, sr = 8000) {
  const n = sec * sr, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const WAVS = { 40: wav(40), 20: wav(20) };
let wavSec = 40;
await ctx.route('**/stream/**', (r) => {
  const W = WAVS[wavSec]; const h = r.request().headers().range; const total = W.length;
  if (!h) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: W });
  const [, a, b] = h.match(/bytes=(\d*)-(\d*)/); const start = a ? +a : 0; const end = b ? +b : total - 1;
  r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: W.subarray(start, end + 1) });
});

let mode = 'ok';
const posts = [];   // { t, body, status, resp, auth }
await ctx.route('**/api/plays', async (r) => {
  if (r.request().method() !== 'POST') return r.continue();
  const body = JSON.parse(r.request().postData() ?? '{}');
  const auth = r.request().headers().authorization ?? '';
  if (mode === 'fail') { posts.push({ t: Date.now(), body, status: 'abort' }); return r.abort('failed'); }
  const res = await r.fetch();
  const resp = await res.json().catch(() => null);
  posts.push({ t: Date.now(), body, status: res.status(), resp, bearer: auth.startsWith('Bearer ') });
  return r.fulfill({ response: res, json: resp ?? undefined });
});

await ctx.addInitScript((t) => {
  localStorage.setItem('token', t);
  const A = window.Audio;
  window.Audio = function (...a) { const x = new A(...a); x.defaultPlaybackRate = 4; x.playbackRate = 4; window.__audio = x; return x; };
}, token);
const page = await ctx.newPage();
const wait = (ms) => page.waitForTimeout(ms);
const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };
const audio = () => page.evaluate(() => ({ t: +window.__audio.currentTime.toFixed(2), paused: window.__audio.paused }));
const outbox = () => page.evaluate(() => JSON.parse(localStorage.getItem('sonorarev.plays.outbox') ?? 'null'));
const toasts = () => page.locator('.toast').count();
const plays = () => posts.flatMap((p) => p.body.plays ?? []);
const waitAudio = async (sec, max = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < max) { if ((await audio()).t >= sec) return true; await wait(100); } return false; };
const seekTo = (sec) => page.evaluate((sec) => {
  const inp = document.querySelector('.player-bar .seek input[type=range]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, String(sec));
  inp.dispatchEvent(new Event('input', { bubbles: true }));
}, sec);
const playRow = async (i) => { await page.locator('.library-tracks .track-row').nth(i).click(); await wait(300); };
const next = () => page.click('.player-bar .ctrl-next');

await page.goto(BASE + '/');
await page.waitForSelector('.library-tracks .track-row');
await page.evaluate(() => localStorage.removeItem('sonorarev.plays.outbox'));

// 1) UMBRAL: no cuenta antes de 20 s; cuenta UNA vez al cruzarlo, con ms_played ≈ 20000.
await playRow(0);
await waitAudio(18.5);
const antes = plays().length;
await waitAudio(23);
await wait(800);
const p1 = plays();
const c1 = p1[0];
ok('umbral_no_antes', antes === 0, { antes });
ok('umbral_cuenta_una', p1.length === 1 && c1.ms_played >= 20000 && c1.ms_played <= 21000, { ms_played: c1?.ms_played });
ok('payload_formato', !!c1 && Number.isInteger(c1.track_id) && /^[0-9a-z]+-[0-9a-z]+-[0-9a-z]+$/.test(c1.client_id) && Math.abs(c1.played_at - Date.now()) < 15000
  && Object.keys(c1).sort().join() === 'client_id,ms_played,played_at,track_id', { keys: c1 && Object.keys(c1), client_id: c1?.client_id });
ok('backend_201_added', posts[0]?.status === 201 && posts[0]?.resp?.added === 1 && posts[0]?.bearer === true, { status: posts[0]?.status, resp: posts[0]?.resp });
ok('outbox_vacia_tras_2xx', (await outbox()) === null);

// 2) SEEK ATRÁS en la misma pasada: volver a 2 s y pasar el umbral otra vez NO recuenta.
await seekTo(2); await wait(300);
await waitAudio(25);
await wait(800);
ok('seek_atras_no_doble', plays().length === 1, { plays: plays().length });

// 3) SEEK ADELANTE: pista nueva, saltar a 30 s y escuchar hasta el final → NO cuenta.
await next(); await wait(500);
const nPre3 = plays().length;
await waitAudio(1);
await seekTo(30); await wait(300);
await waitAudio(38);
ok('seek_adelante_no_cuenta', plays().length === nPre3, { plays: plays().length - nPre3 });

// 4) SKIP antes del umbral: escuchar 12 s y pasar a otra → no cuenta.
await wait(3000);   // termina la anterior y pasa sola a la siguiente
await waitAudio(1);
const nPre4 = plays().length;
await waitAudio(12);
await next(); await wait(500);
ok('skip_antes_no_cuenta', plays().length === nPre4, { plays: plays().length - nPre4 });

// 5) PAUSA: pausar a los 10 s durante 3 s reales; al reanudar cuenta a los 20 s de audio, no antes.
await waitAudio(10);
await page.click('.player-bar .ctrl-btn.play'); await wait(3000);
const enPausa = plays().length;
await page.click('.player-bar .ctrl-btn.play');
await waitAudio(18.5);
const preUmbral5 = plays().length;
await waitAudio(23); await wait(800);
ok('pausa_no_suma', enPausa === nPre4 && preUmbral5 === nPre4 && plays().length === nPre4 + 1, { enPausa: enPausa - nPre4, final: plays().length - nPre4, ms: plays().at(-1)?.ms_played });

// 6) REPETIR UNA: la misma pista vuelve a empezar → cada vuelta cuenta.
const rbtn = page.locator('.player-bar button[aria-label^="Repetir"]');
for (let k = 0; k < 3 && !(await rbtn.getAttribute('aria-label')).match(/una|one|1/i); k++) { await rbtn.click(); await wait(200); }
const repLabel = await rbtn.getAttribute('aria-label');
await next(); await wait(500);
const nPre6 = plays().length;
const t6 = Date.now();
while (plays().length < nPre6 + 2 && Date.now() - t6 < 40000) await wait(250);
const rep = plays().slice(nPre6);
ok('repeat_one_cuenta_cada_vuelta', rep.length >= 2 && rep[0].track_id === rep[1].track_id && rep[0].client_id !== rep[1].client_id, { repLabel, vueltas: rep.length, ids: rep.map((p) => p.track_id) });
for (let k = 0; k < 3 && !(await rbtn.getAttribute('aria-label')).match(/no|off|desact/i); k++) { await rbtn.click(); await wait(200); }

// 7) FALLO DE RED: el POST falla → sin toast, la reproducción sigue, la escucha queda guardada;
//    al volver la red ('online') sale sola y la bandeja se vacía.
mode = 'fail';
await next(); await wait(500);
await waitAudio(1);
const nPre7 = posts.length;
await waitAudio(23); await wait(800);
const ob7 = await outbox();
const a7 = await audio(); await wait(600); const a7b = await audio();
ok('red_caida_guarda', posts.length > nPre7 && posts.at(-1).status === 'abort' && ob7?.plays?.length === 1, { guardadas: ob7?.plays?.length, owner: ob7?.owner });
ok('red_caida_sin_toast_y_sigue', (await toasts()) === 0 && !a7b.paused && a7b.t > a7.t, { toasts: await toasts(), t: `${a7.t}→${a7b.t}` });
mode = 'ok';
const savedId = ob7?.plays?.[0]?.client_id;
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await wait(1500);
const reenviado = posts.at(-1);
ok('online_reenvia_y_vacia', reenviado?.status === 201 && reenviado.body.plays.some((p) => p.client_id === savedId) && (await outbox()) === null, { status: reenviado?.status, resp: reenviado?.resp });

// 8) REINTENTO del mismo lote: el servidor no cuenta doble (client_id UNIQUE).
const dup = await page.evaluate(async (pl) => {
  const r = await fetch('/api/plays', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` }, body: JSON.stringify({ plays: pl }) });
  return { status: r.status, body: await r.json() };
}, reenviado?.body?.plays ?? []);
ok('reintento_idempotente', dup.status === 201 && dup.body.added === 0 && dup.body.already === (reenviado?.body?.plays?.length ?? -1), dup);

// 9) OTRA CUENTA: lo pendiente de otro usuario se descarta al entrar, sin mandarse.
await page.evaluate(() => localStorage.setItem('sonorarev.plays.outbox', JSON.stringify({ owner: 'id:999999', plays: [{ client_id: 'ajena-1-1', track_id: 1, played_at: Date.now(), ms_played: 99999 }] })));
const nPre9 = posts.length;
await page.reload();
await page.waitForSelector('.library-tracks .track-row');
await wait(1500);
const mandada = posts.slice(nPre9).some((p) => p.body.plays?.some((x) => x.client_id === 'ajena-1-1'));
ok('otra_cuenta_descarta', !mandada && (await outbox()) === null, { mandada, outbox: await outbox() });

// 10) PENDIENTE PROPIO al recargar: sale al montar.
const own = await page.evaluate(() => {
  const p = JSON.parse(atob(localStorage.getItem('token').split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  return `id:${p.id}`;
});
await page.evaluate(([o]) => localStorage.setItem('sonorarev.plays.outbox', JSON.stringify({ owner: o, plays: [] })), [own]);
const nPre10 = posts.length;
mode = 'fail';
await playRow(3); await waitAudio(23); await wait(800);
const guardada = (await outbox())?.plays?.[0]?.client_id;
mode = 'ok';
await page.reload();
await page.waitForSelector('.library-tracks .track-row');
await wait(1500);
ok('pendiente_propio_sale_al_montar', !!guardada && posts.slice(nPre10).some((p) => p.status === 201 && p.body.plays.some((x) => x.client_id === guardada)) && (await outbox()) === null, { guardada });

// 11) PISTA CORTA (< 30 s): no cuenta aunque se escuche entera.
wavSec = 20;
await playRow(5);
const nPre11 = plays().length;
await waitAudio(19.5); await wait(1200);
ok('pista_corta_no_cuenta', plays().length === nPre11, { plays: plays().length - nPre11 });
wavSec = 40;

ok('sin_toasts_en_toda_la_corrida', (await toasts()) === 0);

const added = posts.filter((p) => p.status === 201).reduce((s, p) => s + (p.resp?.added ?? 0), 0);
console.log(JSON.stringify(R, null, 1));
console.log(`posts: ${posts.length} · added total (backend): ${added}`);
const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(`\nplays-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
