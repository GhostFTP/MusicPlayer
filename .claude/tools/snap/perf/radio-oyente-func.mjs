// radio-oyente-func.mjs — la Radio web, OYENTE (fase 1, sub-paso 4), contra el BUILD DE PRODUCCIÓN
// (preview :4173) y el backend REAL del runner (:3100, copia de la base). Archivo aparte de radio-func
// (el anfitrión) a propósito, para no inflarlo.
//
// Montaje: la PÁGINA es el oyente, con la segunda cuenta (SNAP2_USER/SNAP2_PASS, la crea el runner en su
// copia). El ANFITRIÓN es la cuenta principal, manejada POR API desde node: crear, PUT /state con
// posiciones controladas, terminar. El audio sale de un WAV sintético de 180 s por /stream (page.route).
// La vista Radio todavía no tiene cara de oyente: el test llama unirse()/salir() del provider, que
// encuentra por la fibra de React (window.__radio(), igual que window.__player() en tablet-util).
// La posición esperada se calcula en node: la publicada + lo que pasó desde el PUT (mismo equipo, así
// que el reloj del servidor y el local son el mismo).
//
// Casos, primera tanda (contra el servidor de radio REAL):
//   1   unirse → fase 'oyente' y el anfitrión ve al oyente, con el id de la segunda cuenta.
//   2   arranca la canción del anfitrión, sonando, con cola [pista, siguiente], en la posición proyectada.
//   L   lecturas: en 10 s, ~1 GET de la sala cada SONDEO_MS (2 s), sin ráfagas; y play/seek/pause/
//       resume/setRepeatMode con la MISMA identidad al principio y al final de la sala (si cambiaran,
//       el efecto del puente se reiniciaría y leería de más).
//   3   el anfitrión pausa (el oyente se pausa en esa posición) y reanuda (el oyente reanuda en vivo).
//   4   salto del anfitrión → seek a la posición nueva.
//   8   un desfase local de +5 s se corrige; uno de +1,2 s (menos que TOLERANCIA_MS) no.
//   6   pausa propia → silenciada; un salto del anfitrión no lo mueve; al darle play salta al vivo.
//   7   desajuste: el oyente pone otra canción → a los DESAJUSTE_MS vuelve la de la radio.
//   7b  con OTRA canción puesta, la radio pausa y reanuda: no la mueve (ni seek ni resume) — la guarda
//       enLaDeLaRadio. (pause() sí la calla: la radio está en pausa.)
//   5   cambio de pista → arranca la nueva, con su siguiente.
//   11  video del anfitrión → en pausa con aviso 'video'; al volver una canción, arranca.
//   10  el anfitrión termina → texto de fin del oyente y la foto restaurada (en pausa, sin play()).
//   9   (otra sala) salir restaura la foto: misma cola, índice y posición, EN PAUSA, sin llamar a
//       play() y con el repeat devuelto.
//   H   higiene: tras salir, 0 lecturas en 5 s y ningún temporizador del sondeo pendiente; un solo
//       elemento de media; sin errores de página.
//   12  la sala propia se rechaza con "Esta radio es tuya." y no deja al oyente anotado.
//   14  quiereSonar (lo que lee "Toca para escuchar"): true con el anfitrión sonando, false en pausa y
//       con video, true otra vez al reanudar y al volver de un video.
//   13  logout siendo oyente: el reproductor queda EN PAUSA (no restaura la cola), con el repeat de la foto,
//       y la radio sin lecturas ni sondeo.
// Fuera del conteo ("registro"): cómo queda un oyente que venía de un VIDEO al salir.
//
// CONTROL NEGATIVO: sin la restauración de finOyente, falla el 9 (y el 10); sin la guarda de sala propia,
// falla el 12; sin el desajuste, falla el 7; sin aplicar la corrección, falla el 8; sin marcar
// silenciada, falla el 6; sin la guarda enLaDeLaRadio en pausar/reanudar/saltar, falla el 7b; sin la pausa
// del desmontaje del provider, falla el 13; con quiereSonar fijo en true, falla el 14.
// Uso: SNAP_BASE=http://localhost:4173 SNAP2_USER=… SNAP2_PASS=… node radio-oyente-func.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';

await preflight();
const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? !!v : { ok: !!v, ...extra }; };
const REG = {};   // lo que sólo se registra (no cuenta en el n/m)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOLERANCIA_S = 2;      // RADIO.TOLERANCIA_MS de radioSync
const SONDEO_MS = 2000;      // RADIO.SONDEO_MS
const DESAJUSTE_MS = 6000;   // DESAJUSTE_MS
const TXT_FIN = 'El anfitrión terminó la radio.';

const tokHost = await getToken();
const login2 = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: process.env.SNAP2_USER, password: process.env.SNAP2_PASS }) });
const tokOye = (await login2.json()).token;
if (!tokOye) { console.error('[radio-oyente-func] no entra la segunda cuenta (SNAP2_USER/SNAP2_PASS)'); process.exit(1); }
const idOye = JSON.parse(Buffer.from(tokOye.split('.')[1], 'base64url').toString()).id;

const api = async (tok, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
};

// Pistas largas (≥ 150 s en la base): las posiciones del test llegan hasta 120 s y arrancar recorta a
// la duración de la pista. El audio de verdad es el WAV de 180 s.
const lista = (await api(tokHost, 'GET', '/api/tracks?limit=400')).j;
const todas = Array.isArray(lista) ? lista : (lista?.tracks ?? []);
const largas = todas.filter((t) => t.duration >= 150);
if (largas.length < 7) { console.error(`[radio-oyente-func] hacen falta 7 pistas de ≥150 s en la copia (hay ${largas.length})`); process.exit(1); }
const [A, B, C, D] = largas;             // A, B, C: las de la radio; D: la "otra canción" del oyente
const PROPIAS = largas.slice(4, 7);      // la cola del oyente antes de entrar (la foto)

function wav(sec = 180, sr = 8000) {
  const n = sec * sr, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const WAV = wav();

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.route('**/stream/**', (r) => {
  if (r.request().url().includes('/stream/video/')) return r.continue();
  const h = r.request().headers().range; const total = WAV.length;
  if (!h) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV });
  const [, a, b] = h.match(/bytes=(\d*)-(\d*)/); const start = a ? +a : 0; const end = b ? Math.min(+b, total - 1) : total - 1;
  r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: WAV.subarray(start, end + 1) });
});
await ctx.addInitScript((t) => {
  localStorage.setItem('token', t);
  // El provider cuyo value cumple `es`, buscado por la fibra (el build de producción no tiene nombres).
  const buscar = (es) => {
    const root = document.getElementById('root');
    const key = root && Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
    if (!key) return null;
    const stack = [root[key]?.stateNode?.current ?? root[key]];
    while (stack.length) {
      const f = stack.pop();
      if (!f) continue;
      const v = f.memoizedProps?.value;
      if (v && es(v)) return v;
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
    return null;
  };
  window.__player = () => buscar((v) => typeof v.play === 'function' && typeof v.addToQueue === 'function');
  window.__radio = () => buscar((v) => typeof v.unirse === 'function' && typeof v.salir === 'function');
  window.__auth = () => buscar((v) => typeof v.logout === 'function' && typeof v.login === 'function');
  // El <audio> del motor (el último con src que no es un video), los elementos de media que recibieron
  // un src, y cuántas veces se llamó al play() nativo.
  const M = HTMLMediaElement.prototype;
  const d = Object.getOwnPropertyDescriptor(M, 'src');
  window.__medios = new Set();
  Object.defineProperty(M, 'src', { configurable: true, get() { return d.get.call(this); }, set(v) { window.__medios.add(this); if (!(this instanceof HTMLVideoElement)) window.__audio = this; d.set.call(this, v); } });
  const play0 = M.play; window.__nPlay = 0;
  M.play = function (...a) { window.__nPlay++; return play0.apply(this, a); };
  // Temporizadores pendientes, por demora: el sondeo del oyente es una cadena de setTimeout de 2000 ms.
  const st = window.setTimeout.bind(window), ct = window.clearTimeout.bind(window);
  window.__pendientes = new Map();
  window.setTimeout = (fn, ms, ...a) => { const id = st((...x) => { window.__pendientes.delete(id); if (typeof fn === 'function') fn(...x); }, ms, ...a); window.__pendientes.set(id, ms); return id; };
  window.clearTimeout = (id) => { window.__pendientes.delete(id); return ct(id); };
}, tokOye);
const p = await ctx.newPage();
const errores = []; p.on('pageerror', (e) => errores.push(String(e.message).slice(0, 160)));
const lecturas = [];   // GET /api/radio/:codigo de la página: { t, codigo }
p.on('request', (q) => { const u = new URL(q.url()); const m = u.pathname.match(/^\/api\/radio\/([A-Z0-9]{6})$/); if (m && q.method() === 'GET') lecturas.push({ t: Date.now(), codigo: m[1] }); });

const esperar = async (fn, ms = 8000, paso = 150) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return { v, ms: Date.now() - t }; await sleep(paso); } return { v: null, ms: null }; };
const foto = () => p.evaluate(() => {
  const v = window.__player(); const r = window.__radio(); const el = window.__audio;
  return {
    fase: r?.fase ?? null, codigo: r?.codigo ?? null, error: r?.error ?? null, fin: r?.fin?.texto ?? null, aviso: r?.aviso ?? null,
    silenciada: r?.silenciada ?? null, quiereSonar: r?.quiereSonar ?? null,
    actual: v.currentTrack?.id ?? null, kind: v.currentTrack?.kind ?? 'track', cola: v.queue.map((t) => t.id), indice: v.queueIndex,
    isPlaying: v.isPlaying, repeat: v.repeat, paused: el ? el.paused : null,
    ct: el ? Math.round(el.currentTime * 100) / 100 : null, nPlay: window.__nPlay,
  };
});
const r2 = (x) => Math.round(x * 100) / 100;
const mismo = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const salaComoHost = (tok, c) => api(tok, 'GET', `/api/radio/${c}`);   // el anfitrión lee sin contarse

// El anfitrión publica; se guarda lo publicado y la hora (punto medio del PUT) para proyectar.
let pub = null;
async function publicar(code, estado) {
  const t0 = Date.now(); const r = await api(tokHost, 'PUT', `/api/radio/${code}/state`, estado); const t1 = Date.now();
  pub = { ...estado, t: (t0 + t1) / 2 };
  return r.status;
}
const proyectada = () => (pub.playing ? pub.positionMs / 1000 + (Date.now() - pub.t) / 1000 : pub.positionMs / 1000);
/** El oyente: lo que suena y su desfase con el anfitrión (positivo = adelantado). */
const medir = async () => { const f = await foto(); return { ...f, esperado: r2(proyectada()), desfase: r2(f.ct - proyectada()) }; };
const sondeoPendiente = () => p.evaluate(() => [...window.__pendientes.values()].filter((ms) => ms === 2000).length);

async function abrirSala() {
  const cr = await api(tokHost, 'POST', '/api/radio');
  salas.push([tokHost, cr.j?.code]);
  return { status: cr.status, code: cr.j?.code };
}
/** La cola propia del oyente (la foto): PROPIAS, la del medio, en pausa en 30 s, con `repeat`. */
async function prepararFoto(repeat = 'all') {
  await p.evaluate((l) => window.__player().play(l, 1), PROPIAS);
  await esperar(() => p.evaluate(() => !!window.__audio && !window.__audio.paused && window.__audio.currentTime > 0.2));
  await p.evaluate((rp) => { window.__player().seek(30); window.__player().pause(); window.__player().setRepeatMode(rp); }, repeat);
  await sleep(800);
  return foto();
}
const restaurada = (f, antes) => mismo(f.cola, antes.cola) && f.indice === antes.indice && f.actual === PROPIAS[1].id
  && Math.abs(f.ct - 30) < 1 && f.paused === true && f.isPlaying === false && f.nPlay === 0 && f.repeat === antes.repeat;

const salas = [];   // [token, código] para cerrarlas al final pase lo que pase
try {
  await p.goto(BASE + '/');
  await p.waitForSelector('.player-bar', { timeout: 15000 });
  await p.waitForFunction(() => !!window.__player?.() && !!window.__radio?.() && !!window.__auth?.());
  const sondeoAntes = await sondeoPendiente();

  // ════ Sala 1: casos 1-8, 7b, 5, 11 y 10 ════
  const antes = await prepararFoto('all');
  const s1 = await abrirSala();
  const st1 = await publicar(s1.code, { trackId: A.id, positionMs: 40_000, playing: true, nextTrackId: B.id });

  // ── 1. unirse ──
  const unido = await p.evaluate((c) => window.__radio().unirse(c), s1.code);
  const f1 = await foto();
  const anotado = await esperar(async () => { const s = await salaComoHost(tokHost, s1.code); return (s.j?.listeners ?? []).some((x) => x.id === idOye) ? s.j.listeners.map((x) => x.id) : null; }, 4000);
  ok('01_unirse_queda_oyente_y_anotado', s1.status === 201 && st1 === 200 && unido === true && f1.fase === 'oyente' && f1.codigo === s1.code && !!anotado.v,
    { crear: s1.status, publicar: st1, unido, fase: f1.fase, error: f1.error, oyentes: anotado.v, idOye });

  // ── 2. arranca en la posición proyectada ──
  const sonando = await esperar(async () => { const f = await foto(); return f.actual === A.id && !f.paused && f.ct > 0 ? f : null; });
  await sleep(600);
  const m2 = await medir();
  ok('02_arranca_en_la_posicion_proyectada', !!sonando.v && m2.actual === A.id && m2.isPlaying && !m2.paused
    && mismo(m2.cola, [A.id, B.id]) && Math.abs(m2.desfase) < TOLERANCIA_S && m2.repeat === 'off',
    { ms: sonando.ms, actual: m2.actual, cola: m2.cola, isPlaying: m2.isPlaying, repeat: m2.repeat, ct: m2.ct, esperado: m2.esperado, desfase: m2.desfase });
  // quiereSonar (caso 14): se lee en cada momento del anfitrión — sonando, en pausa, reanudado, video y vuelta.
  const quiere = (v) => esperar(async () => ((await foto()).quiereSonar === v ? true : null), 3000, 100).then((x) => x.v === true);
  const Q = { sonando: await quiere(true) };

  // ── L. lecturas en 10 s e identidad de las funciones del motor ──
  await p.evaluate(() => { const v = window.__player(); window.__fns = { play: v.play, seek: v.seek, pause: v.pause, resume: v.resume, setRepeatMode: v.setRepeatMode }; });
  const tL = Date.now(); await sleep(10_000);
  const enL = lecturas.filter((x) => x.t >= tL && x.t < tL + 10_000 && x.codigo === s1.code).map((x) => x.t);
  const huecosL = enL.slice(1).map((t, i) => t - enL[i]);
  const otrasL = lecturas.filter((x) => x.t >= tL && x.t < tL + 10_000 && x.codigo !== s1.code).length;
  // (la identidad se compara al final de la sala, después de pausas, saltos, cambios de pista y video)

  // ── 3. el anfitrión pausa y reanuda ──
  await publicar(s1.code, { trackId: A.id, positionMs: 60_000, playing: false, nextTrackId: B.id });
  const p3 = await esperar(async () => { const f = await foto(); return f.paused && f.isPlaying === false ? f : null; }, 5000);
  Q.enPausa = await quiere(false);
  await sleep(300);
  const m3a = await medir();
  await publicar(s1.code, { trackId: A.id, positionMs: 60_000, playing: true, nextTrackId: B.id });
  const r3 = await esperar(async () => { const f = await foto(); return !f.paused && f.isPlaying ? f : null; }, 5000);
  Q.reanudado = await quiere(true);
  await sleep(600);
  const m3b = await medir();
  ok('03_pausa_y_reanuda_en_vivo', !!p3.v && Math.abs(m3a.ct - 60) < 0.5 && m3a.actual === A.id
    && !!r3.v && m3b.actual === A.id && Math.abs(m3b.desfase) < TOLERANCIA_S && m3b.silenciada === false,
    { pausa: { ms: p3.ms, ct: m3a.ct }, reanuda: { ms: r3.ms, ct: m3b.ct, esperado: m3b.esperado, desfase: m3b.desfase } });

  // ── 4. salto del anfitrión ──
  await publicar(s1.code, { trackId: A.id, positionMs: 100_000, playing: true, nextTrackId: B.id });
  const s4 = await esperar(async () => { const m = await medir(); return Math.abs(m.desfase) < TOLERANCIA_S && m.ct > 90 ? m : null; }, 5000);
  await sleep(400);
  const m4 = await medir();
  ok('04_salto_del_anfitrion_hace_seek', !!s4.v && m4.actual === A.id && !m4.paused && Math.abs(m4.desfase) < TOLERANCIA_S,
    { ms: s4.ms, ct: m4.ct, esperado: m4.esperado, desfase: m4.desfase });

  // ── 8. corrección: +5 s se corrige; +1,2 s no ──
  // Se vuelve a una posición baja (el salto de 4 dejó la pista cerca de 100 s y faltan casos).
  await publicar(s1.code, { trackId: A.id, positionMs: 20_000, playing: true, nextTrackId: B.id });
  await esperar(async () => { const m = await medir(); return Math.abs(m.desfase) < 1 && m.ct < 40 ? m : null; }, 5000);
  await sleep(3000);
  const ct8 = (await foto()).ct;
  await p.evaluate((t) => window.__player().seek(t), ct8 + 5);
  await sleep(300);
  const m8a = await medir();
  const c8 = await esperar(async () => { const m = await medir(); return Math.abs(m.desfase) < 1 ? m : null; }, 14_000, 250);
  await sleep(3000);   // que la siguiente revisión vea el desfase dentro de la tolerancia
  const ct8b = (await foto()).ct;
  await p.evaluate((t) => window.__player().seek(t), ct8b + 1.2);
  await sleep(300);
  const m8c = await medir();
  await sleep(11_000);   // dos revisiones (REVISAR_CADA_MS = 5 s) con el desfase dentro de la tolerancia
  const m8d = await medir();
  ok('08_desfase_5s_se_corrige_y_1s_no', m8a.desfase > 4 && !!c8.v && Math.abs(m8c.desfase - 1.2) < 0.5 && Math.abs(m8d.desfase - m8c.desfase) < 0.4,
    { mas5: { desfaseInicial: m8a.desfase, corregidoEnMs: c8.ms, desfaseFinal: c8.v?.desfase ?? null },
      mas1_2: { desfaseInicial: m8c.desfase, desfase11sDespues: m8d.desfase } });

  // ── 6. pausa propia → silenciada; la radio no lo mueve; play → al vivo ──
  // El desfase de +1,2 s del 8 queda en el aire hasta acá: el play de este caso lo resuelve.
  await p.evaluate(() => window.__player().pause());
  const s6 = await esperar(async () => { const f = await foto(); return f.silenciada === true ? f : null; }, 9000);
  const ct6 = (await foto()).ct;
  await publicar(s1.code, { trackId: A.id, positionMs: 70_000, playing: true, nextTrackId: B.id });   // un salto
  await sleep(4500);   // dos sondeos
  const m6b = await foto();
  await p.evaluate(() => window.__player().togglePlay());   // el oyente le da play
  const v6 = await esperar(async () => { const f = await foto(); return !f.paused && f.isPlaying && f.ct > 60 ? f : null; }, 4000);
  await sleep(500);
  const m6c = await medir();
  ok('06_pausa_propia_silenciada_y_vuelve_al_vivo', !!s6.v && m6b.paused && m6b.silenciada === true && Math.abs(m6b.ct - ct6) < 0.05
    && !!v6.v && m6c.silenciada === false && Math.abs(m6c.desfase) < TOLERANCIA_S,
    { silenciadaEnMs: s6.ms, trasElSalto: { paused: m6b.paused, ct: m6b.ct, ctAntes: ct6, silenciada: m6b.silenciada },
      trasPlay: { ms: v6.ms, ct: m6c.ct, esperado: m6c.esperado, desfase: m6c.desfase, silenciada: m6c.silenciada } });

  // ── 7. desajuste: otra canción → a los DESAJUSTE_MS vuelve la de la radio ──
  await p.evaluate((d) => window.__player().play([d], 0), D);
  const t7 = Date.now();
  const enD = await esperar(async () => { const f = await foto(); return f.actual === D.id && !f.paused ? f : null; }, 3000);
  const v7 = await esperar(async () => { const f = await foto(); return f.actual === A.id && !f.paused ? f : null; }, 14_000, 200);
  const ms7 = v7.v ? Date.now() - t7 : null;
  await sleep(600);
  const m7 = await medir();
  ok('07_desajuste_vuelve_la_de_la_radio', !!enD.v && !!v7.v && ms7 >= DESAJUSTE_MS - 500 && ms7 <= DESAJUSTE_MS + 2 * SONDEO_MS + 2000
    && mismo(m7.cola, [A.id, B.id]) && Math.abs(m7.desfase) < TOLERANCIA_S,
    { sonoD: !!enD.v, volvioEnMs: ms7, cola: m7.cola, ct: m7.ct, esperado: m7.esperado, desfase: m7.desfase });

  // ── 7b. con otra canción puesta, la radio pausa y reanuda: no la mueve ──
  await p.evaluate((d) => window.__player().play([d], 0), D);
  await esperar(async () => { const f = await foto(); return f.actual === D.id && !f.paused && f.ct > 0.5 ? f : null; }, 4000);
  await publicar(s1.code, { trackId: A.id, positionMs: 50_000, playing: false, nextTrackId: B.id });
  const p7b = await esperar(async () => { const f = await foto(); return f.paused ? f : null; }, 3000, 100);
  await sleep(200);
  const m7bA = await foto();
  await publicar(s1.code, { trackId: A.id, positionMs: 50_000, playing: true, nextTrackId: B.id });
  const r7b = await esperar(async () => { const f = await foto(); return f.actual !== D.id || !f.paused || Math.abs(f.ct - m7bA.ct) > 0.05 ? f : null; }, 2600, 100);
  const m7bB = await foto();
  ok('07b_ordenes_no_mueven_otra_cancion', !!p7b.v && m7bA.actual === D.id && m7bA.ct < 15
    && !r7b.v && m7bB.actual === D.id && m7bB.paused && Math.abs(m7bB.ct - m7bA.ct) < 0.05,
    { trasPausa: { actual: m7bA.actual, paused: m7bA.paused, ct: m7bA.ct }, trasReanudar: { actual: m7bB.actual, paused: m7bB.paused, ct: m7bB.ct, seMovioEnMs: r7b.ms } });
  // El desajuste la devuelve (no cuenta: es lo del 7).
  await esperar(async () => { const f = await foto(); return f.actual === A.id && !f.paused ? f : null; }, 12_000, 200);

  // ── 5. cambio de pista → la nueva, con su siguiente ──
  await publicar(s1.code, { trackId: B.id, positionMs: 20_000, playing: true, nextTrackId: C.id });
  const c5 = await esperar(async () => { const f = await foto(); return f.actual === B.id && !f.paused && f.ct > 0 ? f : null; }, 5000);
  await sleep(600);
  const m5 = await medir();
  ok('05_cambio_de_pista_con_su_siguiente', !!c5.v && m5.actual === B.id && mismo(m5.cola, [B.id, C.id]) && m5.isPlaying && Math.abs(m5.desfase) < TOLERANCIA_S,
    { ms: c5.ms, cola: m5.cola, ct: m5.ct, esperado: m5.esperado, desfase: m5.desfase });

  // ── 11. video del anfitrión → pausa con aviso; vuelve una canción → arranca ──
  await publicar(s1.code, { enPausaPorVideo: true });
  const v11 = await esperar(async () => { const f = await foto(); return f.paused && f.aviso === 'video' ? f : null; }, 5000);
  Q.video = await quiere(false);
  await publicar(s1.code, { trackId: C.id, positionMs: 10_000, playing: true, nextTrackId: A.id });
  const c11 = await esperar(async () => { const f = await foto(); return f.actual === C.id && !f.paused && f.ct > 0 ? f : null; }, 6000);
  Q.vuelta = await quiere(true);
  await sleep(600);
  const m11 = await medir();
  ok('11_video_pausa_con_aviso_y_vuelve', !!v11.v && v11.v.actual === B.id && !!c11.v && mismo(m11.cola, [C.id, A.id]) && m11.aviso === null && Math.abs(m11.desfase) < TOLERANCIA_S,
    { video: v11.v && { ms: v11.ms, actual: v11.v.actual, paused: v11.v.paused, aviso: v11.v.aviso }, vuelta: { ms: c11.ms, cola: m11.cola, aviso: m11.aviso, desfase: m11.desfase } });

  // ── 14. quiereSonar sigue al anfitrión: true sonando, false en pausa, true al reanudar, false con video ──
  ok('14_quiereSonar_sigue_al_anfitrion', Object.values(Q).every(Boolean) && Object.keys(Q).length === 5, Q);

  // ── L (cierre): lecturas e identidad ──
  const fnsIguales = await p.evaluate(() => { const v = window.__player(); return Object.fromEntries(Object.entries(window.__fns).map(([k, f]) => [k, f === v[k]])); });
  ok('L_lecturas_cada_2s_y_motor_estable', enL.length >= 4 && enL.length <= 6 && huecosL.every((h) => h >= SONDEO_MS - 300) && otrasL === 0
    && Object.values(fnsIguales).every(Boolean),
    { lecturasEn10s: enL.length, huecosMs: huecosL, deOtraSala: otrasL, mismaIdentidad: fnsIguales });

  // ── 10. el anfitrión termina → fin + restauración ──
  await p.evaluate(() => { window.__nPlay = 0; });
  await api(tokHost, 'DELETE', `/api/radio/${s1.code}`);
  const f10 = await esperar(async () => { const f = await foto(); return f.fase === 'sin-radio' ? f : null; }, 5000);
  await sleep(1500);
  const m10 = await foto();
  ok('10_anfitrion_termina_fin_y_restauracion', !!f10.v && m10.fin === TXT_FIN && restaurada(m10, antes),
    { ms: f10.ms, fin: m10.fin, cola: m10.cola, indice: m10.indice, ct: m10.ct, paused: m10.paused, nPlay: m10.nPlay, repeat: m10.repeat });

  // ════ Sala 2: caso 9 e higiene ════
  await p.evaluate(() => window.__radio().limpiarFin());
  const antes9 = await prepararFoto('all');
  const s2 = await abrirSala();
  await publicar(s2.code, { trackId: A.id, positionMs: 40_000, playing: true, nextTrackId: B.id });
  await p.evaluate((c) => window.__radio().unirse(c), s2.code);
  await esperar(async () => { const f = await foto(); return f.actual === A.id && !f.paused ? f : null; });
  // Entre dos lecturas hay un setTimeout de 2000 ms pendiente (durante la lectura misma, no).
  const sondeoDentro = (await esperar(async () => { const n = await sondeoPendiente(); return n > sondeoAntes ? n : null; }, 3000, 50)).v ?? sondeoAntes;

  // ── 9. salir restaura la foto sin llamar a play() ──
  await p.evaluate(() => { window.__nPlay = 0; window.__radio().salir(); });
  const tSalir = Date.now();
  await sleep(1500);
  const f9 = await foto();
  ok('09_salir_restaura_la_foto_sin_play', f9.fase === 'sin-radio' && f9.fin === null && restaurada(f9, antes9),
    { antes: { cola: antes9.cola, indice: antes9.indice, ct: antes9.ct, repeat: antes9.repeat }, despues: f9 });

  // ── H. higiene ──
  await sleep(5000);
  const lecturasTras = lecturas.filter((x) => x.t > tSalir + 100).length;
  const sondeoTras = await sondeoPendiente();
  const medios = await p.evaluate(() => window.__medios.size);
  ok('H_tras_salir_sin_lecturas_ni_sondeo_un_medio_sin_errores', lecturasTras === 0 && sondeoDentro > sondeoAntes && sondeoTras === sondeoAntes && medios === 1 && errores.length === 0,
    { lecturasEn6sTrasSalir: lecturasTras, sondeoPendiente: { antesDeEntrar: sondeoAntes, dentro: sondeoDentro, trasSalir: sondeoTras }, medios, errores: errores.slice() });
  REG.oyentes_6s_despues_de_salir = ((await salaComoHost(tokHost, s2.code)).j?.listeners ?? []).map((x) => x.id);
  await api(tokHost, 'DELETE', `/api/radio/${s2.code}`);

  // ── 12. la sala propia ──
  const cr12 = await api(tokOye, 'POST', '/api/radio');
  const code12 = cr12.j?.code; salas.push([tokOye, code12]);
  const unido12 = await p.evaluate((c) => window.__radio().unirse(c), code12);
  await sleep(500);
  const f12 = await foto();
  const s12 = await salaComoHost(tokOye, code12);
  ok('12_sala_propia_rechazada', cr12.status === 201 && unido12 === false && f12.fase === 'sin-radio' && f12.error === 'Esta radio es tuya.'
    && (s12.j?.listeners ?? []).length === 0 && f12.actual === PROPIAS[1].id && f12.paused === true,
    { crear: cr12.status, unido: unido12, fase: f12.fase, error: f12.error, oyentes: s12.j?.listeners ?? null, actual: f12.actual });
  await api(tokOye, 'DELETE', `/api/radio/${code12}`);
  await p.evaluate(() => window.__radio().limpiarFin());

  // ════ Registro: un oyente que venía de un VIDEO ════
  const vids = await p.evaluate(async () => { const r = await fetch('/api/videos', { headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } }); return ((await r.json()).videos ?? []).slice(0, 1).map((v) => ({ ...v, kind: 'video' })); });
  if (vids.length) {
    const fotoVideo = () => p.evaluate(() => { const v = window.__player(); const vd = document.querySelector('video.player-video'); const el = window.__audio;
      return { fase: window.__radio().fase, actual: v.currentTrack?.id ?? null, kind: v.currentTrack?.kind ?? 'track', cola: v.queue.map((t) => `${t.kind ?? 'track'}:${t.id}`), indice: v.queueIndex,
        isPlaying: v.isPlaying, repeat: v.repeat, audioPaused: el?.paused ?? null, videoPaused: vd?.paused ?? null, videoCt: vd ? Math.round(vd.currentTime * 100) / 100 : null, nPlay: window.__nPlay }; });
    await p.evaluate((l) => window.__player().play(l, 0), vids);
    await sleep(2000);
    const vAntes = await fotoVideo();
    const s3 = await abrirSala();
    await publicar(s3.code, { trackId: A.id, positionMs: 40_000, playing: true, nextTrackId: B.id });
    await p.evaluate((c) => window.__radio().unirse(c), s3.code);
    await esperar(async () => { const f = await foto(); return f.actual === A.id && !f.paused ? f : null; });
    await sleep(1000);
    const vDentro = await fotoVideo();
    await p.evaluate(() => { window.__nPlay = 0; window.__radio().salir(); });
    await sleep(2000);
    REG.video_al_salir = { antes: vAntes, dentro: vDentro, despues: await fotoVideo() };
    await api(tokHost, 'DELETE', `/api/radio/${s3.code}`);
  } else REG.video_al_salir = 'no hay videos en el catálogo (¿VIDEO_DIR?)';

  // ── 13. logout con la radio de oyente abierta (va al final: deja la página sin sesión) ──
  // El reproductor vive por encima de la sesión: sin la pausa del desmontaje seguiría sonando lo de la
  // radio. Se exige en pausa, el repeat de la foto ('one') devuelto, y la radio sin lecturas ni sondeo.
  await prepararFoto('one');
  const s4s = await abrirSala();
  await publicar(s4s.code, { trackId: A.id, positionMs: 40_000, playing: true, nextTrackId: B.id });
  await p.evaluate((c) => window.__radio().unirse(c), s4s.code);
  await esperar(async () => { const f = await foto(); return f.actual === A.id && !f.paused ? f : null; });
  await sleep(1000);
  const lAntes = await p.evaluate(() => { const v = window.__player(); return { actual: v.currentTrack?.id, repeat: v.repeat, paused: window.__audio.paused, ct: Math.round(window.__audio.currentTime * 100) / 100 }; });
  await p.evaluate(() => window.__auth().logout());
  const tLogout = Date.now();
  await sleep(3000);
  const lDespues = await p.evaluate(() => { const v = window.__player(); return { actual: v.currentTrack?.id, repeat: v.repeat, paused: window.__audio.paused, ct: Math.round(window.__audio.currentTime * 100) / 100, isPlaying: v.isPlaying, radioMontada: !!window.__radio?.(), login: !!document.querySelector('input[type="password"]') }; });
  await sleep(3000);
  const ct6s = await p.evaluate(() => Math.round(window.__audio.currentTime * 100) / 100);
  const lecturasTrasLogout = lecturas.filter((x) => x.t > tLogout + 100).length;
  const sondeoTrasLogout = await sondeoPendiente();
  ok('13_logout_pausa_y_devuelve_repeat', lAntes.actual === A.id && lAntes.paused === false && lAntes.repeat === 'off'
    && lDespues.login && !lDespues.radioMontada && lDespues.paused === true && lDespues.isPlaying === false && ct6s === lDespues.ct
    && lDespues.repeat === 'one' && lecturasTrasLogout === 0 && sondeoTrasLogout === sondeoAntes,
    { antes: lAntes, a3s: lDespues, ct6s, lecturasTrasLogout, sondeoPendiente: sondeoTrasLogout });
  await api(tokHost, 'DELETE', `/api/radio/${s4s.code}`);
  REG.errores_de_pagina_al_final = errores.slice();
} catch (e) {
  ok('excepcion', false, { error: String(e.message).split('\n')[0].slice(0, 200) });
} finally {
  for (const [tok, c] of salas) if (c) await api(tok, 'DELETE', `/api/radio/${c}`).catch(() => {});
}

await ctx.close();
const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
console.log('registro (fuera del conteo):', JSON.stringify(REG, null, 1));
if (process.env.OYENTE_DUMP) (await import('node:fs')).writeFileSync(process.env.OYENTE_DUMP, JSON.stringify({ ...R, _registro: REG }, null, 1));
console.log(`\nradio-oyente-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
