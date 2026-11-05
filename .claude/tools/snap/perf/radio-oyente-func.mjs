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
// Casos, segunda tanda (contra un SERVIDOR FALSO: page.route sobre /api/radio/FK…, /api/tracks/:id y
// /api/users/:id/avatar; se entra con el botón "Escuchar" de la vista, en /radio/CÓDIGO):
//   U_*  al unirse con 404, 409 (llena), 410, 200 con ended y la sala propia: el texto de .radio-estado,
//        fase 'sin-radio', la cola propia intacta (sin play()) y el foco de vuelta en "Escuchar".
//   D_*  durante: 410, ended y 409 (llena) salen con su texto de fin y la foto restaurada; 403
//        persistente: aviso sin-respuesta, no sale y sigue sonando; 429 con Retry-After: 6: el hueco
//        entre lecturas es ≥ 6 s y después vuelve a 2 s; red caída (route.abort): aviso, sigue sonando y
//        al volver la red se apaga; /api/tracks 404 y 500: falta-cancion / no-se-pudo-cargar, en pausa,
//        reintento en cada sondeo y, cuando responde bien, arranca.
//   B_*  autoplay bloqueado (stub: un play() fuera de un clic de verdad rechaza con NotAllowedError):
//        "Toca para escuchar" está en la vista Radio y no en la barra; el clic suena en vivo (desfase
//        < 2 s) y el botón se va; con el anfitrión en pausa no aparece aunque playBlocked siga en true.
//   V_*  la vista: la ficha /radio/CÓDIGO no lee la sala antes del clic (0 lecturas en 3 s); "Uniéndose…"
//        (ocupado, con Cancelar) mientras la primera lectura tarda, y Cancelar vuelve a la ficha con el
//        foco en "Escuchar" sin que la respuesta tardía lo meta en la radio; los avisos en la región viva
//        (el mismo nodo, role=status), el texto de silenciada, "Iniciar radio" y el campo de unirse
//        bloqueados con sus notas siendo oyente, y "Salir de la radio" → cara "sin radio" con el foco en
//        el h1.
//   A    avatares: foto con ?v= → &token=, foto sin ?v= → ?token=, foto que falla → la inicial, emoji.
//   401  (al final: cierran la sesión) al unirse y durante. Un 401 pasa por onUnauthorized → logout: el
//        provider se desmonta y aparece el Login, así que el texto de fin no se ve. Al unirse, la cola
//        propia queda intacta; durante, la foto SÍ vuelve (finOyente('sesion') corre en microtareas,
//        antes de que React desmonte), con el repeat, y no hay más lecturas.
//
// CONTROL NEGATIVO: sin la restauración de finOyente, falla el 9 (y el 10); sin la guarda de sala propia,
// falla el 12; sin el desajuste, falla el 7; sin aplicar la corrección, falla el 8; sin marcar
// silenciada, falla el 6; sin la guarda enLaDeLaRadio en pausar/reanudar/saltar, falla el 7b; sin la pausa
// del desmontaje del provider, falla el 13; con quiereSonar fijo en true, falla el 14.
// Segunda tanda: sin devolver `seguido` cuando falla api.track, fallan los dos D_track; con el sondeo fijo
// en 2 s (sin esperaDelSondeo), falla el D_429; con el 403 tratado como salida, falla el D_403; sin el seek
// de tocarParaEscuchar, falla B_el_clic_suena_en_vivo; con el botón sin la condición quiereSonar, falla
// B_con_el_anfitrion_en_pausa; con un aviso de red que no se apaga, falla D_red; con la ficha leyendo la
// sala al montarse, falla V_ficha_sin_leer; con Cancelar sin invalidar el unirse en curso, falla
// V_uniendose_y_cancelar.
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
  // Autoplay bloqueado a pedido (window.__bloquear): un play() que NO corre dentro de un clic de verdad
  // rechaza con NotAllowedError, como el navegador sin gesto. El clic se marca en captura y se desmarca
  // al final del burbujeo (los handlers de React corren en el medio, en #root).
  window.__bloquear = false; window.__enClick = false;
  addEventListener('click', (e) => { if (e.isTrusted) window.__enClick = true; }, true);
  addEventListener('click', () => { window.__enClick = false; });
  M.play = function (...a) {
    window.__nPlay++;
    if (window.__bloquear && !window.__enClick) return Promise.reject(new DOMException('bloqueado (prueba)', 'NotAllowedError'));
    return play0.apply(this, a);
  };
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
    isPlaying: v.isPlaying, repeat: v.repeat, paused: el ? el.paused : null, bloqueado: v.playBlocked,
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

// ── Servidor falso (segunda tanda) ──
// Las salas FK…: GET /api/radio/FK… lo contesta node con FK[código]. `modo`: 'ok' (200 live), 'ended'
// (200 con status ended y `razon`), 'abort' (red caída), { status, headers?, body? } (un error), o una
// función que devuelve uno de ésos en cada lectura; `demora` (ms) retrasa sólo la próxima respuesta. El estado lo escribe estadoFk(), con la hora de node
// (el mismo equipo: el reloj del "servidor" y el de la página son el mismo).
const ALFA = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const FK = {};
let nFk = 0, seqFk = 0;
const HOST_FK = { id: 990001, name: 'Anfitriona', avatar: null };
const YO_FK = { id: idOye, name: 'Yo', avatar: null };
function salaFalsa(extra = {}) {
  const code = `FK${ALFA[nFk % 31]}${ALFA[Math.floor(nFk / 31) % 31]}22`; nFk++;
  FK[code] = { modo: 'ok', estado: null, host: HOST_FK, listeners: null, razon: 'anfitrion', lecturas: [], ...extra };
  return code;
}
function estadoFk(code, e) {
  FK[code].estado = { seq: ++seqFk, enPausaPorVideo: false, nextTrackId: null, ...e, publishedAtServerMs: Date.now() };
}
/** Dónde va el anfitrión falso en el instante `t` (s). */
const vivoFk = (code, t = Date.now()) => { const e = FK[code].estado; return e.positionMs / 1000 + (e.playing ? (t - e.publishedAtServerMs) / 1000 : 0); };
const json = (status, body, headers = {}) => ({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
await p.route((u) => /^\/api\/radio\/FK[A-Z0-9]{4}$/.test(u.pathname), async (route) => {
  const code = new URL(route.request().url()).pathname.split('/').pop();
  const s = FK[code];
  if (!s || route.request().method() !== 'GET') return route.fulfill(json(404, { error: 'Radio not found' }));
  s.lecturas.push(Date.now());
  if (s.demora) { const d = s.demora; s.demora = 0; await sleep(d); }
  const m = typeof s.modo === 'function' ? s.modo() : s.modo;
  if (m === 'abort') return route.abort('internetdisconnected');
  if (m && typeof m === 'object') return route.fulfill(json(m.status, m.body ?? { error: 'falso' }, m.headers));
  const ended = m === 'ended';
  return route.fulfill(json(200, {
    serverNow: Date.now(), code, status: ended ? 'ended' : 'live', endedReason: ended ? s.razon : null,
    state: s.estado, host: s.host, listeners: s.listeners ?? [s.host, YO_FK],
  }));
});
// /api/tracks/:id: TRK[id] = { fallos, status } → las próximas `fallos` lecturas contestan `status`; el resto, la real.
const TRK = {};
const pedidosTrk = {};
await p.route((u) => /^\/api\/tracks\/\d+$/.test(u.pathname), (route) => {
  const id = Number(new URL(route.request().url()).pathname.split('/').pop());
  pedidosTrk[id] = (pedidosTrk[id] ?? 0) + 1;
  const f = TRK[id];
  if (f && f.fallos > 0) { f.fallos--; return route.fulfill(json(f.status, { error: 'falso' })); }
  return route.fallback();
});
// Avatares: un PNG de 1×1, salvo AVATAR_ROTO (404, para la caída a la inicial).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const AVATAR_ROTO = 990078;
const pedidosAvatar = [];
await p.route((u) => /^\/api\/users\/\d+\/avatar$/.test(u.pathname), (route) => {
  const u = new URL(route.request().url());
  pedidosAvatar.push(u.pathname + u.search);
  return Number(u.pathname.split('/')[3]) === AVATAR_ROTO ? route.fulfill(json(404, { error: 'Avatar not found' }))
    : route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
});
const sinToken = (x) => (typeof x === 'string' ? x.split(tokOye).join('<token>') : x);   // el token no va al reporte

const irA = (ruta) => p.evaluate((r) => { history.pushState({}, '', r); dispatchEvent(new PopStateEvent('popstate')); }, ruta);
/** La ficha /radio/CÓDIGO y un clic de verdad en "Escuchar". */
async function escuchar(code) {
  await irA(`/radio/${code}`);
  await p.waitForSelector('.radio-btn--escuchar:not([disabled])', { timeout: 5000 });
  await p.click('.radio-btn--escuchar');
}
/** Lo que muestra la vista Radio. `region.mismo`: la región viva es el nodo guardado al entrar (window.__region). */
const vista = () => p.evaluate(() => {
  const a = document.activeElement; const r = document.querySelector('.radio-aviso-vivo');
  return {
    estado: document.querySelector('.radio-estado')?.textContent ?? null,
    foco: a ? `${a.tagName.toLowerCase()}${[...a.classList].map((c) => `.${c}`).join('')}` : null,
    avisoVivo: r ? r.textContent : null,
    region: r ? { mismo: r === window.__region, role: r.getAttribute('role'), live: r.getAttribute('aria-live') } : null,
    toca: !!document.querySelector('.radio-btn--toca'),
    tocaEnBarra: (document.querySelector('.player-bar')?.textContent ?? '').includes('Toca para escuchar'),
    oyente: !!document.querySelector('.radio-card--oyente'),
  };
});
const sonandoEn = (id, ms = 8000) => esperar(async () => { const f = await foto(); return f.fase === 'oyente' && f.actual === id && !f.paused && f.ct > 0 ? f : null; }, ms);
const medirFk = async (code) => { const f = await foto(); return { ...f, desfase: r2(f.ct - vivoFk(code)) }; };
/** La foto propia, una sala falsa con A sonando desde 40 s, "Escuchar" y esperar a que suene. */
async function entrarFk(extra = {}, repeat = 'all') {
  const antes = await prepararFoto(repeat);
  const code = salaFalsa(extra);
  estadoFk(code, { trackId: A.id, positionMs: 40_000, playing: true, nextTrackId: B.id });
  await escuchar(code);
  const s = await sonandoEn(A.id);
  await p.evaluate(() => { window.__nPlay = 0; window.__region = document.querySelector('.radio-aviso-vivo'); });
  return { antes, code, sono: !!s.v };
}
const salirFk = async () => { await p.evaluate(() => window.__radio().salir()); await sleep(800); };
const TXT_SIN_RESPUESTA = 'Sin conexión con la radio. Reintentando…';
const TXT_BLOQUEADO = 'Tu navegador necesita un toque para empezar a sonar.';
const TXT_SILENCIADA = 'En pausa para ti. Dale play para volver al vivo.';
/** Tras un 401: la página sin sesión (sin token) → se vuelve a cargar y la init script siembra el token. */
const sinSesion = () => p.evaluate(() => !!document.querySelector('input[type="password"]') && !window.__radio?.());
const volverAEntrar = async () => {
  await p.goto(BASE + '/');
  await p.waitForSelector('.player-bar', { timeout: 15000 });
  await p.waitForFunction(() => !!window.__player?.() && !!window.__radio?.());
};

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

  // ════ Segunda tanda: servidor falso ════

  // ── U. al unirse: el fallo deja la ficha como estaba ──
  const TXT_U = {
    '404': 'No hay ninguna radio con ese código. Revísalo e intenta de nuevo.',
    '409_llena': 'Esa radio está llena. Intenta más tarde.',
    '410': 'Esa radio ya terminó.',
    ended: TXT_FIN,
    propia: 'Esta radio es tuya.',
  };
  const antesU = await prepararFoto('all');
  for (const [k, extra] of [
    ['404', { modo: { status: 404, body: { error: 'Radio not found' } } }],
    ['409_llena', { modo: { status: 409, body: { error: 'Radio full' } } }],
    ['410', { modo: { status: 410, body: { error: 'Radio ended', endedReason: 'admin' } } }],
    ['ended', { modo: 'ended', razon: 'anfitrion' }],
    ['propia', { host: { id: idOye, name: 'Yo', avatar: null } }],
  ]) {
    const code = salaFalsa(extra);
    estadoFk(code, { trackId: A.id, positionMs: 40_000, playing: true, nextTrackId: B.id });
    await p.evaluate(() => { window.__nPlay = 0; });
    await escuchar(code);
    const listo = await esperar(async () => { const f = await foto(); const v = await vista(); return f.fase === 'sin-radio' && v.estado ? true : null; }, 5000);
    await sleep(300);
    const f = await foto(); const v = await vista();
    ok(`U_${k}_al_unirse`, !!listo.v && f.fase === 'sin-radio' && v.estado === TXT_U[k] && v.foco === 'button.radio-btn.radio-btn--escuchar'
      && mismo(f.cola, antesU.cola) && f.indice === antesU.indice && f.paused && Math.abs(f.ct - 30) < 1 && f.nPlay === 0 && f.repeat === 'all'
      && FK[code].lecturas.length === 1,
      { estado: v.estado, foco: v.foco, fase: f.fase, colaIntacta: mismo(f.cola, antesU.cola), indice: f.indice, ct: f.ct, paused: f.paused, nPlay: f.nPlay, repeat: f.repeat, lecturas: FK[code].lecturas.length });
  }

  // ── V. la ficha no lee la sala antes del clic; "Uniéndose…" + Cancelar ──
  {
    const code = salaFalsa();
    estadoFk(code, { trackId: A.id, positionMs: 40_000, playing: true, nextTrackId: B.id });
    await p.evaluate(() => { window.__nPlay = 0; });
    await irA(`/radio/${code}`);
    await p.waitForSelector('.radio-btn--escuchar:not([disabled])', { timeout: 5000 });
    await sleep(3000);
    const ficha = await p.evaluate(() => ({
      escuchar: document.querySelector('.radio-btn--escuchar')?.textContent ?? null,
      nota: document.getElementById('radio-escuchar-nota')?.textContent ?? null,
      cancelar: [...document.querySelectorAll('.radio-btn')].some((b) => b.textContent.trim() === 'Cancelar'),
      enPagina: document.body.textContent.includes(location.pathname.split('/').pop()),
    }));
    const fF = await foto();
    ok('V_ficha_sin_leer_la_sala_antes_del_clic', FK[code].lecturas.length === 0 && fF.fase === 'sin-radio' && fF.nPlay === 0
      && ficha.escuchar === 'Escuchar' && !ficha.cancelar && ficha.enPagina
      && ficha.nota === 'Vas a escuchar lo mismo que el anfitrión, en vivo. Al salir, vuelve tu cola, en pausa.',
      { lecturasEn3s: FK[code].lecturas.length, fase: fF.fase, nPlay: fF.nPlay, ficha });

    // La primera lectura tarda 3 s: "Uniéndose…" ocupado + Cancelar; Cancelar vuelve a la ficha y la
    // respuesta que llega después no lo mete en la radio.
    FK[code].demora = 3000;
    await p.click('.radio-btn--escuchar');
    await sleep(600);
    const uni = await p.evaluate(() => {
      const b = document.querySelector('.radio-btn--escuchar');
      return { texto: b?.textContent ?? null, disabled: b?.disabled ?? null, busy: b?.getAttribute('aria-busy') ?? null,
        cancelar: [...document.querySelectorAll('.radio-btn')].some((x) => x.textContent.trim() === 'Cancelar') };
    });
    const fU = await foto();
    await p.locator('.radio-btn', { hasText: 'Cancelar' }).click();
    await sleep(500);
    const fC = await foto(); const vC = await vista();
    const cancel = { fase: fC.fase, foco: vC.foco, cancelar: await p.evaluate(() => [...document.querySelectorAll('.radio-btn')].some((x) => x.textContent.trim() === 'Cancelar')) };
    await sleep(4000);   // llega la respuesta demorada (200 live)
    const fT = await foto(); const vT = await vista();
    ok('V_uniendose_y_cancelar', uni.texto === 'Uniéndose…' && uni.disabled === true && uni.busy === 'true' && uni.cancelar && fU.fase === 'uniendose'
      && cancel.fase === 'sin-radio' && cancel.foco === 'button.radio-btn.radio-btn--escuchar' && !cancel.cancelar
      && fT.fase === 'sin-radio' && !vT.oyente && FK[code].lecturas.length === 1
      && mismo(fT.cola, antesU.cola) && fT.indice === antesU.indice && fT.paused && Math.abs(fT.ct - 30) < 1 && fT.nPlay === 0 && fT.repeat === 'all',
      { uniendose: { ...uni, fase: fU.fase }, alCancelar: cancel, trasLaRespuesta: { fase: fT.fase, oyente: vT.oyente, lecturas: FK[code].lecturas.length, colaIntacta: mismo(fT.cola, antesU.cola), ct: fT.ct, paused: fT.paused, nPlay: fT.nPlay } });
  }

  // ── D. durante: 410, ended y llena salen con su texto de fin y la foto restaurada ──
  for (const [k, modo, razon, texto] of [
    ['410', { status: 410, body: { error: 'Radio ended', endedReason: 'admin' } }, null, 'Un administrador terminó la radio.'],
    ['ended', 'ended', 'pausa', 'La radio se cerró por estar mucho tiempo en pausa.'],
    ['409_llena', { status: 409, body: { error: 'Radio full' } }, null, 'La radio está llena.'],
  ]) {
    const e = await entrarFk();
    if (razon) FK[e.code].razon = razon;
    FK[e.code].modo = modo;
    const fuera = await esperar(async () => ((await foto()).fase === 'sin-radio' ? true : null), 6000);
    await sleep(1200);
    const m = await foto(); const v = await vista();
    ok(`D_${k}_durante_sale_y_restaura`, e.sono && !!fuera.v && m.fin === texto && v.estado === texto && restaurada(m, e.antes),
      { sono: e.sono, ms: fuera.ms, fin: m.fin, estado: v.estado, cola: m.cola, indice: m.indice, ct: m.ct, paused: m.paused, nPlay: m.nPlay, repeat: m.repeat });
  }

  // ── D. 403 persistente: aviso sin-respuesta, no sale, lo que suena sigue sonando ──
  {
    const e = await entrarFk();
    const ct0 = (await foto()).ct; const t0 = Date.now();
    FK[e.code].modo = { status: 403, body: { error: 'Forbidden' } };
    const av = await esperar(async () => ((await foto()).aviso === 'sin-respuesta' ? true : null), 5000);
    const vAv = await vista();
    await sleep(7000);
    const m = await foto();
    const n403 = FK[e.code].lecturas.filter((t) => t > t0).length;
    ok('D_403_persistente_avisa_y_sigue_sonando', e.sono && !!av.v && vAv.avisoVivo === TXT_SIN_RESPUESTA && m.fase === 'oyente' && m.aviso === 'sin-respuesta'
      && m.actual === A.id && m.isPlaying && !m.paused && m.ct - ct0 > 7 && n403 >= 4,
      { avisoEnMs: av.ms, avisoVivo: vAv.avisoVivo, fase: m.fase, aviso: m.aviso, paused: m.paused, avanzoS: r2(m.ct - ct0), lecturas403: n403 });
    await salirFk();
  }

  // ── D. 429 con Retry-After: 6 → el hueco es ≥ 6 s y después vuelve a 2 s ──
  {
    const e = await entrarFk();
    await sleep(2500);
    let n = 0; const t0 = Date.now();
    FK[e.code].modo = () => (n++ === 0 ? { status: 429, headers: { 'Retry-After': '6' }, body: { error: 'Too many requests' } } : 'ok');
    await sleep(12_500);
    const ls = FK[e.code].lecturas.filter((t) => t >= t0);
    const huecos = ls.slice(1).map((t, i) => t - ls[i]);
    const m = await foto();
    ok('D_429_respeta_retry_after_y_vuelve_a_2s', e.sono && huecos.length >= 3 && huecos[0] >= 6000 && huecos[0] < 7500
      && huecos.slice(1, 3).every((h) => h >= SONDEO_MS - 300 && h <= SONDEO_MS + 700) && m.fase === 'oyente' && !m.paused,
      { huecosMs: huecos, fase: m.fase, paused: m.paused });
    await salirFk();
  }

  // ── D. red caída: aviso, sigue sonando; al volver la red el aviso se apaga ──
  {
    const e = await entrarFk();
    const ct0 = (await foto()).ct;
    FK[e.code].modo = 'abort';
    const av = await esperar(async () => ((await foto()).aviso === 'sin-respuesta' ? true : null), 5000);
    const vAv = await vista();
    await sleep(4000);
    const mCaida = await foto();
    FK[e.code].modo = 'ok';
    const off = await esperar(async () => ((await foto()).aviso === null ? true : null), 5000);
    await sleep(200);
    const vOff = await vista();
    ok('D_red_caida_avisa_sigue_sonando_y_se_apaga', e.sono && !!av.v && vAv.avisoVivo === TXT_SIN_RESPUESTA && mCaida.fase === 'oyente'
      && mCaida.aviso === 'sin-respuesta' && !mCaida.paused && mCaida.ct - ct0 > 4 && !!off.v && vOff.avisoVivo === '',
      { avisoEnMs: av.ms, avisoVivo: vAv.avisoVivo, caida: { fase: mCaida.fase, paused: mCaida.paused, avanzoS: r2(mCaida.ct - ct0) }, apagadoEnMs: off.ms, avisoVivoDespues: vOff.avisoVivo });
    await salirFk();
  }

  // ── D. /api/tracks 404 y 500: aviso, en pausa, reintento en cada sondeo y, al responder, arranca ──
  // (y V: esos avisos entran en la región viva, el mismo nodo de la entrada)
  {
    const e = await entrarFk();
    const region = async () => { const v = await vista(); return { ...v.region, texto: v.avisoVivo }; };
    const R0 = await region();
    const caso = async (t, siguiente, status, aviso) => {
      const p0 = pedidosTrk[t.id] ?? 0;
      TRK[t.id] = { fallos: 3, status };
      estadoFk(e.code, { trackId: t.id, positionMs: 20_000, playing: true, nextTrackId: siguiente.id });
      const falla = await esperar(async () => { const f = await foto(); return f.aviso === aviso && f.paused ? f : null; }, 5000);
      const Rf = await region();
      const arranca = await sonandoEn(t.id, 12_000);
      await sleep(600);
      const m = await medirFk(e.code);
      return { falla: !!falla.v, Rf, arrancaEnMs: arranca.ms, pedidos: (pedidosTrk[t.id] ?? 0) - p0, pendientes: TRK[t.id].fallos,
        m: { actual: m.actual, cola: m.cola, aviso: m.aviso, paused: m.paused, desfase: m.desfase }, okArranca: !!arranca.v && mismo(m.cola, [t.id, siguiente.id]) && m.aviso === null && Math.abs(m.desfase) < TOLERANCIA_S };
    };
    const c404 = await caso(B, C, 404, 'falta-cancion');
    ok('D_track_404_falta_cancion_pausa_y_reintenta', e.sono && c404.falla && c404.pedidos >= 4 && c404.pendientes === 0 && c404.okArranca, c404);
    const c500 = await caso(C, A, 500, 'no-se-pudo-cargar');
    ok('D_track_500_no_se_pudo_cargar_pausa_y_reintenta', e.sono && c500.falla && c500.pedidos >= 4 && c500.pendientes === 0 && c500.okArranca, c500);
    const R1 = await region();
    const enRegion = (r, texto) => r.mismo === true && r.role === 'status' && r.live === 'polite' && r.texto === texto;
    ok('V_avisos_entran_en_la_region_viva', enRegion(R0, '') && enRegion(c404.Rf, 'No se encontró la canción que suena en la radio. Reintentando…')
      && enRegion(c500.Rf, 'No se pudo cargar la canción. Reintentando…') && enRegion(R1, ''),
      { alEntrar: R0, falta: c404.Rf, noSePudo: c500.Rf, alFinal: R1 });
    await salirFk();
  }

  // ── V. silenciada, "Iniciar radio" bloqueado siendo oyente y "Salir de la radio" → foco en el h1 ──
  {
    const e = await entrarFk();
    await p.evaluate(() => window.__player().pause());
    const s = await esperar(async () => ((await foto()).silenciada === true ? true : null), 9000);
    const vS = await vista();
    ok('V_silenciada_en_la_region_viva', e.sono && !!s.v && vS.avisoVivo === TXT_SILENCIADA && vS.region?.mismo === true,
      { ms: s.ms, avisoVivo: vS.avisoVivo, region: vS.region });
    const iniciarRadio = () => p.evaluate(() => {
      const b = [...document.querySelectorAll('.radio-card .radio-btn')].find((x) => x.textContent.trim() === 'Iniciar radio');
      const nota = b && b.getAttribute('aria-describedby') ? document.getElementById(b.getAttribute('aria-describedby')) : null;
      const campo = document.getElementById('radio-codigo-campo');
      return { hay: !!b, disabled: b ? b.disabled : null, nota: nota?.textContent ?? null, campoDisabled: campo ? campo.disabled : null,
        notaUnirse: document.getElementById('radio-unirse-nota')?.textContent ?? null, oyente: !!document.querySelector('.radio-card--oyente') };
    });
    await irA('/radio');
    await sleep(500);
    const ini = await iniciarRadio();
    ok('V_iniciar_bloqueado_con_su_nota_siendo_oyente', ini.hay && ini.disabled === true && ini.nota === 'Sal de la radio para iniciar la tuya.'
      && ini.oyente && ini.campoDisabled === true && ini.notaUnirse === 'Sal de la radio para unirte a otra.', ini);
    await p.click('.radio-card--oyente .radio-terminar .radio-btn');
    await esperar(async () => ((await foto()).fase === 'sin-radio' ? true : null), 3000);
    await sleep(1200);
    const fSal = await foto(); const vSal = await vista(); const iniSal = await iniciarRadio();
    ok('V_salir_deja_sin_radio_con_el_foco_en_el_h1', fSal.fase === 'sin-radio' && vSal.foco === 'h1.section-title' && !vSal.oyente
      && iniSal.hay && iniSal.disabled === false && iniSal.nota === null && iniSal.campoDisabled === false && restaurada(fSal, e.antes),
      { fase: fSal.fase, foco: vSal.foco, cara: { oyente: vSal.oyente, iniciar: iniSal }, restaurada: restaurada(fSal, e.antes) });
  }

  // ── B. autoplay bloqueado: "Toca para escuchar" ──
  {
    await prepararFoto('all');
    const code = salaFalsa();
    estadoFk(code, { trackId: A.id, positionMs: 40_000, playing: true, nextTrackId: B.id });
    await p.evaluate(() => { window.__bloquear = true; });
    await escuchar(code);
    const ap = await esperar(async () => { const v = await vista(); return v.toca ? v : null; }, 8000);
    const f1 = await foto();
    ok('B_toca_para_escuchar_en_la_vista_y_no_en_la_barra', !!ap.v && f1.fase === 'oyente' && f1.actual === A.id && f1.bloqueado === true && f1.quiereSonar === true
      && f1.paused && !ap.v.tocaEnBarra && ap.v.avisoVivo === TXT_BLOQUEADO,
      { msHastaElBoton: ap.ms, fase: f1.fase, bloqueado: f1.bloqueado, quiereSonar: f1.quiereSonar, paused: f1.paused, enLaBarra: ap.v?.tocaEnBarra ?? null, avisoVivo: ap.v?.avisoVivo ?? null });
    // Que el vivo se aleje de donde quedó el elemento; el 'playing' del clic dice dónde arrancó de verdad.
    await sleep(5000);
    const ctAntes = (await foto()).ct; const atrasS = r2(vivoFk(code) - ctAntes);
    await p.evaluate(() => { window.__alSonar = null; window.__audio.addEventListener('playing', (ev) => { window.__alSonar = { t: Date.now(), ct: ev.target.currentTime }; }, { once: true }); });
    await p.click('.radio-btn--toca');
    const son = await esperar(() => p.evaluate(() => window.__alSonar), 4000, 50);
    await sleep(800);
    const v2 = await vista(); const f2 = await foto();
    const desfase = son.v ? r2(son.v.ct - vivoFk(code, son.v.t)) : null;
    ok('B_el_clic_suena_en_vivo_y_el_boton_se_va', !!son.v && atrasS > 4 && Math.abs(desfase) < TOLERANCIA_S && !v2.toca && !f2.paused && f2.bloqueado === false,
      { atrasAntesDelClicS: atrasS, desfaseAlSonar: desfase, botonDespues: v2.toca, paused: f2.paused, bloqueado: f2.bloqueado });
    // El anfitrión pausa y reanuda (el resume rechaza: no hay clic → vuelve el botón) y pausa otra vez.
    const pos = Math.round(vivoFk(code) * 1000);
    estadoFk(code, { trackId: A.id, positionMs: pos, playing: false, nextTrackId: B.id });
    await esperar(async () => { const f = await foto(); return f.paused && f.quiereSonar === false ? true : null; }, 5000);
    estadoFk(code, { trackId: A.id, positionMs: pos, playing: true, nextTrackId: B.id });
    const vuelve = await esperar(async () => { const v = await vista(); return v.toca ? true : null; }, 5000);
    estadoFk(code, { trackId: A.id, positionMs: pos, playing: false, nextTrackId: B.id });
    const pausa = await esperar(async () => { const f = await foto(); return f.quiereSonar === false ? f : null; }, 5000);
    await sleep(600);
    const v3 = await vista(); const f3 = await foto();
    ok('B_con_el_anfitrion_en_pausa_no_aparece', !!vuelve.v && !!pausa.v && f3.bloqueado === true && f3.quiereSonar === false && !v3.toca,
      { volvioElBotonAlReanudar: !!vuelve.v, bloqueado: f3.bloqueado, quiereSonar: f3.quiereSonar, boton: v3.toca });
    await p.evaluate(() => { window.__bloquear = false; });
    await salirFk();
  }

  // ── A. avatares: foto con y sin ?v= (con el token), foto que falla → la inicial, emoji ──
  {
    const host = { id: 990077, name: 'Fotito', avatar: { kind: 'photo', url: '/api/users/990077/avatar?v=123', updatedAt: '2026-11-01' } };
    const listeners = [host, YO_FK,
      { id: AVATAR_ROTO, name: 'Bea', avatar: { kind: 'photo', url: `/api/users/${AVATAR_ROTO}/avatar?v=5` } },
      { id: 990079, name: 'Ciro', avatar: { kind: 'emoji', value: '🎧' } },
      { id: 990080, name: 'Dani', avatar: { kind: 'photo', url: '/api/users/990080/avatar' } }];
    const e = await entrarFk({ host, listeners });
    // [anfitrión, yo, Bea, Ciro, Dani]; se espera a que carguen las dos fotos y caiga la rota.
    const caras = await esperar(() => p.evaluate(() => {
      const c = [...document.querySelectorAll('.radio-card--oyente .radio-avatar')].map((el) => {
        const img = el.querySelector('img');
        return { src: img ? img.getAttribute('src') : null, cargada: img ? img.complete && img.naturalWidth > 0 : null,
          emoji: el.querySelector('.radio-avatar-emoji')?.textContent ?? null, texto: el.textContent, grande: el.classList.contains('radio-avatar--grande') };
      });
      return c.length === 5 && c[0].cargada && c[4].cargada && c[2].src === null ? c : null;
    }), 6000);
    const c = caras.v ?? [];
    const conTok = (u) => `${u}${u.includes('?') ? '&' : '?'}token=${tokOye}`;
    const pidio = (u) => pedidosAvatar.includes(conTok(u));
    ok('A_avatares_foto_con_token_inicial_si_falla_y_emoji', e.sono && c.length === 5
      && c[0].grande && c[0].src === conTok(host.avatar.url) && c[0].cargada
      && c[1].src === null && c[1].texto === 'Y'
      && c[2].src === null && c[2].texto === 'B'
      && c[3].emoji === '🎧'
      && c[4].src === conTok('/api/users/990080/avatar') && c[4].cargada
      && pidio(host.avatar.url) && pidio(`/api/users/${AVATAR_ROTO}/avatar?v=5`) && pidio('/api/users/990080/avatar'),
      { caras: c.map((x) => ({ ...x, src: sinToken(x.src) })), pedidos: pedidosAvatar.map(sinToken) });
    await salirFk();
  }
  REG.errores_tras_la_segunda_tanda = errores.slice();

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

  // ── 401 al unirse y durante (lo de HOY: onUnauthorized → logout; ver el encabezado) ──
  const estadoSinSesion = () => p.evaluate(() => {
    const v = window.__player(); const el = window.__audio;
    return { radio: !!window.__radio?.(), actual: v.currentTrack?.id ?? null, cola: v.queue.map((t) => t.id), indice: v.queueIndex,
      isPlaying: v.isPlaying, paused: el ? el.paused : null, ct: el ? Math.round(el.currentTime * 100) / 100 : null, repeat: v.repeat, nPlay: window.__nPlay };
  });
  await volverAEntrar();
  {
    const antes = await prepararFoto('all');
    const code = salaFalsa({ modo: { status: 401, body: { error: 'Unauthorized' } } });
    await p.evaluate(() => { window.__nPlay = 0; });
    await escuchar(code);
    const fuera = await esperar(sinSesion, 6000);
    await sleep(1500);
    const f = await estadoSinSesion();
    ok('U_401_al_unirse_cierra_la_sesion', !!fuera.v && !f.radio && mismo(f.cola, antes.cola) && f.indice === antes.indice && f.paused
      && Math.abs(f.ct - 30) < 1 && f.nPlay === 0 && FK[code].lecturas.length === 1,
      { login: !!fuera.v, ...f, lecturas: FK[code].lecturas.length });
  }
  await volverAEntrar();
  {
    const e = await entrarFk({}, 'one');
    FK[e.code].modo = { status: 401, body: { error: 'Unauthorized' } };
    const fuera = await esperar(sinSesion, 6000);
    const t = Date.now();
    await sleep(3000);
    const f = await estadoSinSesion();
    const tras = FK[e.code].lecturas.filter((x) => x > t + 100).length;
    ok('D_401_durante_cierra_la_sesion_y_restaura', e.sono && !!fuera.v && !f.radio && restaurada(f, e.antes) && tras === 0,
      { login: !!fuera.v, ...f, lecturasTrasElLogin: tras });
  }
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
