// radio-menu-func.mjs — el menú "En la radio" de quien modera (1.43.0, W5b-2), contra el BUILD DE PRODUCCIÓN
// (preview :4173) y el backend REAL del runner (:3100, copia de la base). Salió de radio-oyente-func (su bloque H,
// tal cual) para que ninguna de las dos pase el tope de 5 min del runner.
//
// Montaje: el mismo de radio-oyente-func, copiado tal cual: la página es la SEGUNDA cuenta (SNAP2_USER/SNAP2_PASS) y la
// radio es un SERVIDOR FALSO por page.route sobre /api/radio/FK… y /api/radio/FK…/ordenes; las pistas, las playlists y
// los videos son los reales de la copia. La cola de la radio es [A, B]; la página escucha A.
//
// Casos (con la radio ACTIVA):
//   H_conteos_del_menu_con_la_radio_activa   los menús EN PANTALLA de pista, la que suena, pista de playlist, filas de
//        la cola y tarjeta de video, sin el rol y con él: para quien modera "En la radio" reemplaza a "Reproducir a
//        continuación" y "Agregar a la cola"; en la que suena no hay panel; la cola y el video no cambian.
//   H_panel_en_la_radio_y_su_foco             el panel (dos acciones), el foco al entrar y al volver con Esc.
//   H_poner_a_continuacion_lleva_la_pista_y_avisa_con_toast   el cuerpo lleva trackId; fuera de la vista Radio el aviso
//        es el toast de RadioProvider (no "Enviando…"); los temporizadores 5 s / 30 s vuelven a cero.
//   H_una_en_vuelo_por_tipo_y_ahora_resuelta_por_el_estado    la segunda del mismo tipo no sale y lo dice; "ahora" (otro
//        tipo) sale y la resuelve el estado.
//   H_sin_panel_sobre_la_que_suena_en_la_radio · H_422_video_y_sin_pista_con_su_texto (y su toast con la variante de
//        aviso, no la de éxito; el de éxito sigue con ✓) · H_perder_el_rol_con_el_panel_abierto
//   H_radio_sin_ordenes_sin_panel · H_temporizadores_de_vuelta (ninguno de órdenes vivo; el sondeo, UNO de 2000 ms).
// Los toasts se cuentan una vez por NODO (.toast): dos toasts iguales son dos nodos y cuentan dos.
//
// CONTROL NEGATIVO: sin trackId en la orden caen H_poner_a_continuacion, H_una_en_vuelo y H_422; con el panel para quien
// no modera cae H_conteos; sin bloquear la segunda en vuelo caen H_una_en_vuelo y H_temporizadores; con los errores en la
// variante de éxito cae H_422.
// Uso: SNAP_BASE=http://localhost:4173 SNAP2_USER=… SNAP2_PASS=… node radio-menu-func.mjs
// MENU_DUMP=<archivo>: deja ahí los resultados con sus valores.
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
const lecturas = [];   // GET /api/radio/:codigo de la página: { t, codigo, cap, query }
p.on('request', (q) => { const u = new URL(q.url()); const m = u.pathname.match(/^\/api\/radio\/([A-Z0-9]{6})$/); if (m && q.method() === 'GET') lecturas.push({ t: Date.now(), codigo: m[1], cap: u.searchParams.get('cap'), query: u.search }); });

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
// Las salas FK…: GET /api/radio/FK… lo contesta node con FK[código]. Con `mod` ({ moderators, events, until,
// lost }) suma lo de la moderación como el servidor real (W5a); con `queries` (una lista) anota el ?… de cada lectura. `modo`: 'ok' (200 live), 'ended'
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
const esFk = (u) => /^\/api\/radio\/FK[A-Z0-9]{4}$/.test(u.pathname);
const rutaFk = async (route) => {
  const code = new URL(route.request().url()).pathname.split('/').pop();
  const s = FK[code];
  if (!s || route.request().method() !== 'GET') return route.fulfill(json(404, { error: 'Radio not found' }));
  s.lecturas.push(Date.now());
  const qs = new URL(route.request().url()).searchParams;
  if (s.queries) s.queries.push(new URL(route.request().url()).search);
  if (s.demora) { const d = s.demora; s.demora = 0; await sleep(d); }
  const m = typeof s.modo === 'function' ? s.modo() : s.modo;
  if (m === 'abort') return route.abort('internetdisconnected');
  if (m && typeof m === 'object') return route.fulfill(json(m.status, m.body ?? { error: 'falso' }, m.headers));
  const ended = m === 'ended';
  return route.fulfill(json(200, {
    serverNow: Date.now(), code, status: ended ? 'ended' : 'live', endedReason: ended ? s.razon : null,
    state: s.estado, host: s.host, listeners: s.listeners ?? [s.host, YO_FK],
    ...(s.mod && (qs.get('cap') === 'mod' || qs.has('desde')) ? {
      moderators: s.mod.moderators, capabilities: { orders: s.mod.orders !== false }, eventsUntil: s.mod.until, eventsLost: s.mod.lost,
      events: qs.has('desde') ? s.mod.events.filter((x) => x.id > Number(qs.get('desde'))) : [],
    } : {}),
  }));
};
await p.route(esFk, rutaFk);
// W5b-1: POST /api/radio/FK…/ordenes. En la sala: `ordenar` = (cuerpo) → { status, body?, headers? } o nada
// (202); `demoraOrden` (ms) retrasa cada respuesta. Cada cuerpo queda en `ordenes`.
let idOrdenFk = 0;
const esOrdenFk = (u) => /^\/api\/radio\/FK[A-Z0-9]{4}\/ordenes$/.test(u.pathname);
const rutaOrdenFk = async (route) => {
  const s = FK[new URL(route.request().url()).pathname.split('/')[3]];
  if (!s || route.request().method() !== 'POST') return route.fulfill(json(404, { error: 'Radio not found' }));
  const b = JSON.parse(route.request().postData() ?? '{}');
  (s.ordenes ??= []).push(b);
  if (s.demoraOrden) await sleep(s.demoraOrden);
  const r = typeof s.ordenar === 'function' ? s.ordenar(b) : null;
  if (r) return route.fulfill(json(r.status, r.body ?? { error: 'falso' }, r.headers));
  return route.fulfill(json(202, { id: ++idOrdenFk, repeated: false, serverNow: Date.now() }));
};
await p.route(esOrdenFk, rutaOrdenFk);
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
  // ── H. (1.43.0, W5b-2) el menú "En la radio" con la radio activa ──
  {
    const evH = (id, type, by, extra = {}) => ({ id, type, by, byName: by === HOST_FK.id ? 'Anfitriona' : 'Yo', target: null, targetName: null, trackId: null, title: null, at: Date.now(), ...extra });
    const leerMenu = () => p.evaluate(() => {
      const m = document.querySelector('.ctx-menu'); if (!m) return null;
      const a = document.activeElement;
      return { label: m.getAttribute('aria-label'), acciones: [...m.querySelectorAll('.ctx-item, .ctx-tile')].map((x) => x.getAttribute('aria-label') ?? x.textContent.trim()),
        volver: m.querySelector('.ctx-back')?.textContent.trim() ?? null, foco: a && m.contains(a) ? (a.getAttribute('aria-label') ?? a.textContent.trim()) : null };
    });
    const cerrarMenu = async () => { for (let k = 0; k < 3 && (await p.$('.ctx-menu')); k++) { await p.keyboard.press('Escape'); await sleep(200); } };
    const menuDe = async (loc) => { await cerrarMenu(); await loc.click({ button: 'right' }); await sleep(300); return leerMenu(); };
    const radioV = () => p.evaluate(() => { const r = window.__radio(); return { modera: r?.vistaMod?.modera ?? null, admite: r?.vistaMod?.admite ?? null, linea: r?.lineaOrden?.texto ?? null }; });
    const pendientesDe = (lst) => p.evaluate((l) => [...window.__pendientes.values()].filter((ms) => l.includes(ms)).length, lst);
    const nOrd = () => s.ordenes?.length ?? 0;
    const toasts = () => p.evaluate(() => window.__toasts.slice());
    const llegaToast = (t, desde, ms = 8000) => esperar(async () => ((await toasts()).slice(desde).some((x) => x === t || (typeof t === 'function' && t(x))) ? true : null), ms, 40);
    const enAlbum = () => irA(A.album_artist ? `/albums/${encodeURIComponent(A.album_artist)}/${encodeURIComponent(A.album)}` : `/albums/@/${encodeURIComponent(A.album)}`);
    const filaOtra = () => p.locator('.main-content .track-row:not(.playing)').first();
    const filaSuena = () => p.locator('.main-content .track-row.playing').first();
    const COLA = ['Reproducir a continuación', 'Agregar a la cola'];
    let pl = null; let s = null;
    try {
      const e = await entrarFk({ mod: { moderators: [], events: [], until: 0, lost: false } });
      s = FK[e.code];
      await p.evaluate(() => {
        window.__toasts = []; window.__variantes = []; const vistos = new WeakSet();   // cada toast una vez (por nodo)
        new MutationObserver(() => { for (const t of document.querySelectorAll('.toast')) {
          if (vistos.has(t)) continue; vistos.add(t); window.__toasts.push(t.querySelector('.toast-text')?.textContent ?? '');
          // la variante: 'warning' (clase .warning, ícono ⚠️) o la normal (ícono ✓, la de éxito)
          window.__variantes.push({ texto: t.querySelector('.toast-text')?.textContent ?? '', aviso: t.classList.contains('warning'), icono: t.querySelector('.toast-icon')?.textContent ?? null });
        } }).observe(document.body, { childList: true, subtree: true });
      });
      pl = (await api(tokOye, 'POST', '/api/playlists', { name: 'W5b-2 prueba', emoji: '🎵' })).j;
      await api(tokOye, 'POST', `/api/playlists/${pl.id}/tracks`, { track_id: B.id });
      await sleep(2500);

      // Los menús de las filas, en pantalla (la radio sonando A; la cola de la radio es [A, B]).
      const contar = async () => {
        const m = {};
        await enAlbum(); await p.waitForSelector('.main-content .track-row', { timeout: 8000 }); await sleep(400);
        const tOtra = (await filaOtra().locator('.track-title').textContent()).trim();
        m.pista = await menuDe(filaOtra());
        m.suena = (await filaSuena().count()) ? await menuDe(filaSuena()) : null;
        await cerrarMenu();
        await irA(`/playlists/${pl.id}`); await p.waitForSelector('.main-content .track-row', { timeout: 8000 }); await sleep(400);
        m.playlist = await menuDe(p.locator('.main-content .track-row').first());
        await cerrarMenu();
        const btnCola = p.locator('.player-bar button[aria-label="Cola"]').first();
        await btnCola.click(); await p.waitForSelector('.queue-row', { timeout: 5000 }); await sleep(300);
        m.colaActual = await menuDe(p.locator('.queue-row.current').first());
        m.colaOtra = await menuDe(p.locator('.queue-row:not(.current)').first());
        await cerrarMenu(); await btnCola.click(); await sleep(300);
        await irA('/videos');
        const hayVideo = await esperar(async () => ((await p.locator('.video-grid > *').count()) > 0 ? true : null), 5000, 100);
        m.video = hayVideo.v ? await menuDe(p.locator('.video-grid > *').first()) : 'sin videos en la base';
        await cerrarMenu();
        return { m, tOtra };
      };
      const sinRol = await contar();
      s.mod.moderators = [YO_FK];
      const rol = await esperar(async () => ((await radioV()).modera === true ? true : null), 8000, 100);
      await sleep(3800);   // que pase el toast de "Puedes moderar esta radio"
      const conRol = await contar();
      const A0 = sinRol.m, A1 = conRol.m;
      const quitar = (l, fuera) => l.filter((x) => !fuera.includes(x));
      const conPanel = (l) => { const i = l.indexOf(COLA[0]) >= 0 ? l.indexOf(COLA[0]) : l.indexOf(COLA[1]); const r = quitar(l, COLA); r.splice(i, 0, 'En la radio'); return r; };
      const n = (x) => (x && typeof x === 'object' ? x.acciones.length : x);
      const igualL = (a, b) => JSON.stringify(a?.acciones) === JSON.stringify(b);
      ok('H_conteos_del_menu_con_la_radio_activa', !!rol.v
        && A0.pista.acciones.includes(COLA[0]) && A0.pista.acciones.includes(COLA[1]) && !A0.pista.acciones.includes('En la radio')
        && igualL(A1.pista, conPanel(A0.pista.acciones)) && igualL(A1.playlist, conPanel(A0.playlist.acciones))
        && !!A0.suena && igualL(A1.suena, quitar(A0.suena.acciones, COLA)) && !A1.suena.acciones.includes('En la radio')
        && igualL(A1.colaActual, A0.colaActual.acciones) && igualL(A1.colaOtra, A0.colaOtra.acciones)
        && (typeof A0.video === 'string' || igualL(A1.video, A0.video.acciones)),
        { sinRol: Object.fromEntries(Object.entries(A0).map(([k, v]) => [k, n(v)])), conRol: Object.fromEntries(Object.entries(A1).map(([k, v]) => [k, n(v)])),
          pierdeQuienModera: { pista: quitar(A0.pista.acciones, A1.pista.acciones), suena: quitar(A0.suena?.acciones ?? [], A1.suena?.acciones ?? []), playlist: quitar(A0.playlist.acciones, A1.playlist.acciones) },
          acciones: { sinRol: A0, conRol: A1 } });

      // El panel: "En la radio" → dos acciones, foco en la primera; Esc vuelve a la lista con el foco en "En la radio"; Esc cierra.
      await enAlbum(); await p.waitForSelector('.main-content .track-row', { timeout: 8000 }); await sleep(300);
      await menuDe(filaOtra());
      await p.getByRole('menuitem', { name: 'En la radio' }).click(); await sleep(250);
      const panel = await leerMenu();
      await p.keyboard.press('Escape'); await sleep(250);
      const vuelta = await leerMenu();
      await p.keyboard.press('Escape'); await sleep(250);
      const cerrado = await leerMenu();
      ok('H_panel_en_la_radio_y_su_foco', panel?.label === 'En la radio' && panel.volver === 'En la radio' && JSON.stringify(panel.acciones) === '["Poner a continuación","Poner ahora"]'
        && panel.foco === 'Poner a continuación' && vuelta?.foco === 'En la radio' && vuelta.acciones.includes('En la radio') && cerrado === null, { panel, vuelta, cerrado });

      const poner = async (cual, fila = filaOtra()) => {
        await menuDe(fila);
        await p.getByRole('menuitem', { name: 'En la radio' }).click(); await sleep(200);
        const acc = (await leerMenu())?.acciones ?? null;
        await p.getByRole('menuitem', { name: cual }).click(); await sleep(150);
        return acc;
      };
      // La pista de esa fila, por su título dentro del álbum de A (no del cuerpo de la orden: así una orden que no
      // lleve la pista no arrastra a los demás casos).
      const delAlbum = (await api(tokOye, 'GET', `/api/tracks?limit=500&album=${encodeURIComponent(A.album)}${A.album_artist ? `&album_artist=${encodeURIComponent(A.album_artist)}` : ''}`)).j;
      const idOtra = (Array.isArray(delAlbum) ? delAlbum : (delAlbum?.tracks ?? [])).find((t) => t.title === conRol.tOtra)?.id ?? null;

      // "Poner a continuación": lleva la pista; fuera de la vista Radio el aviso es el toast de RadioProvider (no "Enviando…")
      const pend0 = await pendientesDe([5000, 30000]);
      const t0 = (await toasts()).length; const n0 = nOrd();
      await poner('Poner a continuación');
      const cerroAlPoner = (await leerMenu()) === null;
      await esperar(async () => (nOrd() > n0 ? true : null), 4000, 30);
      const cuerpoC = nOrd() > n0 ? s.ordenes[nOrd() - 1] : null;
      await sleep(300);
      const timersC = (await pendientesDe([5000, 30000])) - pend0;
      s.mod.events.push(evH(1, 'a-continuacion', idOye, { trackId: idOtra, title: conRol.tOtra })); s.mod.until = 1;
      const avisoC = await llegaToast((x) => x.includes(conRol.tOtra) && x.includes('a continuación'), t0);
      await sleep(300);
      const tsC = (await toasts()).slice(t0);
      ok('H_poner_a_continuacion_lleva_la_pista_y_avisa_con_toast', cerroAlPoner && cuerpoC?.type === 'a-continuacion' && Number.isSafeInteger(idOtra) && cuerpoC.trackId === idOtra
        && typeof cuerpoC.clientId === 'string' && !('seqBase' in cuerpoC) && timersC === 2 && !!avisoC.v && !tsC.includes('Enviando…')
        && (await radioV()).linea === null && (await pendientesDe([5000, 30000])) === pend0,
        { cuerpo: cuerpoC, idOtra, temporizadores: timersC, toasts: tsC, linea: (await radioV()).linea });

      // Una en vuelo por tipo: la segunda "a continuación" no sale y lo dice; "ahora" (otro tipo) sí sale y la resuelve el estado.
      const n1 = nOrd(); const t1 = (await toasts()).length;
      await poner('Poner a continuación');
      await esperar(async () => (nOrd() > n1 ? true : null), 4000, 30);
      const accSegunda = await poner('Poner a continuación');
      const espera = await llegaToast('Espera a que se aplique la anterior', t1, 3000);
      await sleep(300);
      const salieronC = nOrd() - n1;
      const lineaSeg = (await radioV()).linea;
      await poner('Poner ahora');
      await esperar(async () => (nOrd() > n1 + 1 ? true : null), 4000, 30);
      const cuerpoA = nOrd() > n1 + 1 ? s.ordenes[nOrd() - 1] : null;
      s.mod.events.push(evH(2, 'a-continuacion', idOye, { trackId: idOtra, title: conRol.tOtra })); s.mod.until = 2;
      const t2 = (await toasts()).length;
      estadoFk(e.code, { trackId: idOtra, positionMs: 0, playing: true, nextTrackId: B.id });
      const yaSuena = await llegaToast('Ya suena en la radio', t2);
      await esperar(async () => ((await pendientesDe([5000, 30000])) === pend0 ? true : null), 6000, 50);
      ok('H_una_en_vuelo_por_tipo_y_ahora_resuelta_por_el_estado', !!espera.v && salieronC === 1 && lineaSeg === 'Espera a que se aplique la anterior'
        && JSON.stringify(accSegunda) === '["Poner a continuación","Poner ahora"]' && cuerpoA?.type === 'ahora' && cuerpoA.trackId === idOtra
        && !!yaSuena.v && (await pendientesDe([5000, 30000])) === pend0,
        { salieronAContinuacion: salieronC, linea: lineaSeg, accionesDelPanelConUnaEnVuelo: accSegunda, cuerpoAhora: cuerpoA, toasts: (await toasts()).slice(t1) });

      // La que suena en la radio (ahora idOtra): sin panel y sin acciones de cola
      await enAlbum(); await esperar(async () => ((await p.locator('.main-content .track-row.playing .track-title').count()) ? true : null), 8000, 100);
      const tSuena = (await p.locator('.main-content .track-row.playing .track-title').first().textContent()).trim();
      const mSuena = await menuDe(filaSuena());
      await cerrarMenu();
      ok('H_sin_panel_sobre_la_que_suena_en_la_radio', tSuena === conRol.tOtra && !!mSuena && !mSuena.acciones.includes('En la radio') && !mSuena.acciones.some((x) => COLA.includes(x)),
        { titulo: tSuena, acciones: mSuena?.acciones });

      // 422: video y sin-pista, con su texto (toast fuera de la vista Radio y la línea)
      const f422 = [];
      for (const [reason, texto] of [['video', 'Los videos no se pueden poner en la radio.'], ['sin-pista', 'Esa canción ya no está en la biblioteca.']]) {
        s.ordenar = () => ({ status: 422, body: { error: 'falso', reason } });
        const tt = (await toasts()).length;
        await poner('Poner ahora');
        const r = await llegaToast(texto, tt, 4000);
        f422.push({ reason, toast: !!r.v, linea: (await radioV()).linea });
      }
      s.ordenar = null;
      // La variante: los dos errores con la de aviso (⚠️), nunca con la de éxito (✓); el de éxito ("Tú pusiste…") sigue con ✓.
      const variantes = await p.evaluate(() => window.__variantes.slice());
      const errores422 = variantes.filter((x) => x.texto === 'Los videos no se pueden poner en la radio.' || x.texto === 'Esa canción ya no está en la biblioteca.');
      const exito = variantes.filter((x) => x.texto.startsWith('Tú pusiste'));
      ok('H_422_video_y_sin_pista_con_su_texto', f422[0].toast && f422[0].linea === 'Los videos no se pueden poner en la radio.' && f422[1].toast && f422[1].linea === 'Esa canción ya no está en la biblioteca.'
        && errores422.length === 2 && errores422.every((x) => x.aviso && x.icono !== '✓') && exito.length > 0 && exito.every((x) => !x.aviso && x.icono === '✓'),
        { f422, errores: errores422, exito });

      // Perder el rol con el panel abierto: el menú no se refresca; "Poner ahora" cierra, no manda nada y no da error
      await menuDe(filaOtra());
      await p.getByRole('menuitem', { name: 'En la radio' }).click(); await sleep(200);
      s.mod.moderators = []; s.mod.events.push(evH(3, 'sin-moderador', HOST_FK.id, { target: idOye, targetName: 'Yo' })); s.mod.until = 3;
      const sinElRol = await esperar(async () => ((await radioV()).modera === false ? true : null), 8000, 100);
      const panelAbierto = await leerMenu();
      const n3 = nOrd(); const t3 = (await toasts()).length;
      await p.getByRole('menuitem', { name: 'Poner ahora' }).click();
      await sleep(1200);
      const tsR = (await toasts()).slice(t3);
      ok('H_perder_el_rol_con_el_panel_abierto', !!sinElRol.v && JSON.stringify(panelAbierto?.acciones) === '["Poner a continuación","Poner ahora"]' && (await leerMenu()) === null
        && nOrd() === n3 && tsR.length === 0 && (await radioV()).linea === null, { panelAbierto, mandadas: nOrd() - n3, cuerpos: (s.ordenes ?? []).slice(n3), toasts: tsR, linea: (await radioV()).linea });

      // Sin órdenes (orders: false) y con el rol: sin panel, el menú de siempre
      s.mod.orders = false; s.mod.moderators = [YO_FK];
      const sinOrd = await esperar(async () => { const v = await radioV(); return v.modera === true && v.admite === false ? true : null; }, 8000, 100);
      await sleep(3800);
      const mSin = await menuDe(filaOtra());
      await cerrarMenu();
      ok('H_radio_sin_ordenes_sin_panel', !!sinOrd.v && !!mSin && !mSin.acciones.includes('En la radio') && COLA.every((x) => mSin.acciones.includes(x)), { acciones: mSin?.acciones, vio: !!sinOrd.v, radio: await radioV() });

      // Los temporizadores: ninguno de órdenes vivo, el sondeo sigue siendo UNO de 2000 ms
      ok('H_temporizadores_de_vuelta', (await pendientesDe([5000, 30000])) === pend0 && (await sondeoPendiente()) === 1,
        { ordenes: (await pendientesDe([5000, 30000])) - pend0, de2000: await sondeoPendiente() });
      await salirFk();
    } catch (x) { ok('H_excepcion', false, { error: String(x.message).split('\n')[0].slice(0, 200) }); }
    await cerrarMenu().catch(() => {});
    if (pl?.id) await api(tokOye, 'DELETE', `/api/playlists/${pl.id}`);
  }

} catch (e) {
  ok('excepcion', false, { error: String(e.message).split('\n')[0].slice(0, 200) });
} finally {
  for (const [tok, c] of salas) if (c) await api(tok, 'DELETE', `/api/radio/${c}`).catch(() => {});
}

await ctx.close();
const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
console.log('registro (fuera del conteo):', JSON.stringify(REG, null, 1));
if (process.env.MENU_DUMP) (await import('node:fs')).writeFileSync(process.env.MENU_DUMP, JSON.stringify({ ...R, _registro: REG }, null, 1));
console.log(`\nradio-menu-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
