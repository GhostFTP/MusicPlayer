// radio-oyente-comun.mjs — el MONTAJE compartido de las suites del oyente de la radio web: radio-oyente-func,
// radio-ordenes-func y radio-menu-func. Es el preámbulo que tenía radio-oyente-func, TAL CUAL, con `export` delante
// de cada declaración: la sesión de la segunda cuenta, el navegador y su página `p` (con los espías de media, de
// setTimeout y del autoplay), la sala REAL por la API (abrirSala, publicar…) y el SERVIDOR FALSO por page.route
// (salaFalsa, estadoFk, rutaFk, rutaOrdenFk, entrarFk, salirFk…), más R/ok/REG para los resultados.
// Como módulo ES corre UNA vez por proceso, al importarlo, y en el mismo orden que antes. No es una suite: no está
// en baseline.json. Las suites no reasignan nada de acá (`pub`, `nFk`, `seqFk`, `idOrdenFk` cambian solo dentro
// de las funciones de este módulo). También lo usa radio-oyente-aleatorio-func (la deuda del aleatorio, 1.44.0).
export { BASE };
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';

await preflight();
export const R = {};
export const ok = (k, v, extra) => { R[k] = extra === undefined ? !!v : { ok: !!v, ...extra }; };
export const REG = {};   // lo que sólo se registra (no cuenta en el n/m)
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const TOLERANCIA_S = 2;      // RADIO.TOLERANCIA_MS de radioSync
export const SONDEO_MS = 2000;      // RADIO.SONDEO_MS
export const DESAJUSTE_MS = 6000;   // DESAJUSTE_MS
export const TXT_FIN = 'El anfitrión terminó la radio.';

export const tokHost = await getToken();
export const login2 = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: process.env.SNAP2_USER, password: process.env.SNAP2_PASS }) });
export const tokOye = (await login2.json()).token;
if (!tokOye) { console.error('[radio-oyente-func] no entra la segunda cuenta (SNAP2_USER/SNAP2_PASS)'); process.exit(1); }
export const idOye = JSON.parse(Buffer.from(tokOye.split('.')[1], 'base64url').toString()).id;

export const api = async (tok, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
};

// Pistas largas (≥ 150 s en la base): las posiciones del test llegan hasta 120 s y arrancar recorta a
// la duración de la pista. El audio de verdad es el WAV de 180 s.
export const lista = (await api(tokHost, 'GET', '/api/tracks?limit=400')).j;
export const todas = Array.isArray(lista) ? lista : (lista?.tracks ?? []);
export const largas = todas.filter((t) => t.duration >= 150);
if (largas.length < 7) { console.error(`[radio-oyente-func] hacen falta 7 pistas de ≥150 s en la copia (hay ${largas.length})`); process.exit(1); }
export const [A, B, C, D] = largas;             // A, B, C: las de la radio; D: la "otra canción" del oyente
export const PROPIAS = largas.slice(4, 7);      // la cola del oyente antes de entrar (la foto)

export function wav(sec = 180, sr = 8000) {
  const n = sec * sr, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
export const WAV = wav();

export const { chromium } = await loadPlaywright();
export const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
export const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
export const p = await ctx.newPage();
export const errores = []; p.on('pageerror', (e) => errores.push(String(e.message).slice(0, 160)));
export const lecturas = [];   // GET /api/radio/:codigo de la página: { t, codigo, cap, query }
p.on('request', (q) => { const u = new URL(q.url()); const m = u.pathname.match(/^\/api\/radio\/([A-Z0-9]{6})$/); if (m && q.method() === 'GET') lecturas.push({ t: Date.now(), codigo: m[1], cap: u.searchParams.get('cap'), query: u.search }); });

export const esperar = async (fn, ms = 8000, paso = 150) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return { v, ms: Date.now() - t }; await sleep(paso); } return { v: null, ms: null }; };
export const foto = () => p.evaluate(() => {
  const v = window.__player(); const r = window.__radio(); const el = window.__audio;
  return {
    fase: r?.fase ?? null, codigo: r?.codigo ?? null, error: r?.error ?? null, fin: r?.fin?.texto ?? null, aviso: r?.aviso ?? null,
    silenciada: r?.silenciada ?? null, quiereSonar: r?.quiereSonar ?? null,
    actual: v.currentTrack?.id ?? null, kind: v.currentTrack?.kind ?? 'track', cola: v.queue.map((t) => t.id), indice: v.queueIndex,
    isPlaying: v.isPlaying, repeat: v.repeat, paused: el ? el.paused : null, bloqueado: v.playBlocked,
    ct: el ? Math.round(el.currentTime * 100) / 100 : null, nPlay: window.__nPlay,
  };
});
export const r2 = (x) => Math.round(x * 100) / 100;
export const mismo = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const salaComoHost = (tok, c) => api(tok, 'GET', `/api/radio/${c}`);   // el anfitrión lee sin contarse

// El anfitrión publica; se guarda lo publicado y la hora (punto medio del PUT) para proyectar.
export let pub = null;
export async function publicar(code, estado) {
  const t0 = Date.now(); const r = await api(tokHost, 'PUT', `/api/radio/${code}/state`, estado); const t1 = Date.now();
  pub = { ...estado, t: (t0 + t1) / 2 };
  return r.status;
}
export const proyectada = () => (pub.playing ? pub.positionMs / 1000 + (Date.now() - pub.t) / 1000 : pub.positionMs / 1000);
/** El oyente: lo que suena y su desfase con el anfitrión (positivo = adelantado). */
export const medir = async () => { const f = await foto(); return { ...f, esperado: r2(proyectada()), desfase: r2(f.ct - proyectada()) }; };
export const sondeoPendiente = () => p.evaluate(() => [...window.__pendientes.values()].filter((ms) => ms === 2000).length);

export async function abrirSala() {
  const cr = await api(tokHost, 'POST', '/api/radio');
  salas.push([tokHost, cr.j?.code]);
  return { status: cr.status, code: cr.j?.code };
}
/** La cola propia del oyente (la foto): PROPIAS, la del medio, en pausa en 30 s, con `repeat`. */
export async function prepararFoto(repeat = 'all') {
  await p.evaluate((l) => window.__player().play(l, 1), PROPIAS);
  await esperar(() => p.evaluate(() => !!window.__audio && !window.__audio.paused && window.__audio.currentTime > 0.2));
  await p.evaluate((rp) => { window.__player().seek(30); window.__player().pause(); window.__player().setRepeatMode(rp); }, repeat);
  await sleep(800);
  return foto();
}
export const restaurada = (f, antes) => mismo(f.cola, antes.cola) && f.indice === antes.indice && f.actual === PROPIAS[1].id
  && Math.abs(f.ct - 30) < 1 && f.paused === true && f.isPlaying === false && f.nPlay === 0 && f.repeat === antes.repeat;

// ── Servidor falso (segunda tanda) ──
// Las salas FK…: GET /api/radio/FK… lo contesta node con FK[código]. Con `mod` ({ moderators, events, until,
// lost }) suma lo de la moderación como el servidor real (W5a); con `queries` (una lista) anota el ?… de cada lectura. `modo`: 'ok' (200 live), 'ended'
// (200 con status ended y `razon`), 'abort' (red caída), { status, headers?, body? } (un error), o una
// función que devuelve uno de ésos en cada lectura; `demora` (ms) retrasa sólo la próxima respuesta. El estado lo escribe estadoFk(), con la hora de node
// (el mismo equipo: el reloj del "servidor" y el de la página son el mismo).
export const ALFA = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const FK = {};
export let nFk = 0, seqFk = 0;
export const HOST_FK = { id: 990001, name: 'Anfitriona', avatar: null };
export const YO_FK = { id: idOye, name: 'Yo', avatar: null };
export function salaFalsa(extra = {}) {
  const code = `FK${ALFA[nFk % 31]}${ALFA[Math.floor(nFk / 31) % 31]}22`; nFk++;
  FK[code] = { modo: 'ok', estado: null, host: HOST_FK, listeners: null, razon: 'anfitrion', lecturas: [], ...extra };
  return code;
}
export function estadoFk(code, e) {
  FK[code].estado = { seq: ++seqFk, enPausaPorVideo: false, nextTrackId: null, ...e, publishedAtServerMs: Date.now() };
}
/** Dónde va el anfitrión falso en el instante `t` (s). */
export const vivoFk = (code, t = Date.now()) => { const e = FK[code].estado; return e.positionMs / 1000 + (e.playing ? (t - e.publishedAtServerMs) / 1000 : 0); };
export const json = (status, body, headers = {}) => ({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
export const esFk = (u) => /^\/api\/radio\/FK[A-Z0-9]{4}$/.test(u.pathname);
export const rutaFk = async (route) => {
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
export let idOrdenFk = 0;
export const esOrdenFk = (u) => /^\/api\/radio\/FK[A-Z0-9]{4}\/ordenes$/.test(u.pathname);
export const rutaOrdenFk = async (route) => {
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
export const TRK = {};
export const pedidosTrk = {};
await p.route((u) => /^\/api\/tracks\/\d+$/.test(u.pathname), (route) => {
  const id = Number(new URL(route.request().url()).pathname.split('/').pop());
  pedidosTrk[id] = (pedidosTrk[id] ?? 0) + 1;
  const f = TRK[id];
  if (f && f.fallos > 0) { f.fallos--; return route.fulfill(json(f.status, { error: 'falso' })); }
  return route.fallback();
});
// Avatares: un PNG de 1×1, salvo AVATAR_ROTO (404, para la caída a la inicial).
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
export const AVATAR_ROTO = 990078;
export const pedidosAvatar = [];
await p.route((u) => /^\/api\/users\/\d+\/avatar$/.test(u.pathname), (route) => {
  const u = new URL(route.request().url());
  pedidosAvatar.push(u.pathname + u.search);
  return Number(u.pathname.split('/')[3]) === AVATAR_ROTO ? route.fulfill(json(404, { error: 'Avatar not found' }))
    : route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
});
export const sinToken = (x) => (typeof x === 'string' ? x.split(tokOye).join('<token>') : x);   // el token no va al reporte

export const irA = (ruta) => p.evaluate((r) => { history.pushState({}, '', r); dispatchEvent(new PopStateEvent('popstate')); }, ruta);
/** La ficha /radio/CÓDIGO y un clic de verdad en "Escuchar". */
export async function escuchar(code) {
  await irA(`/radio/${code}`);
  await p.waitForSelector('.radio-btn--escuchar:not([disabled])', { timeout: 5000 });
  await p.click('.radio-btn--escuchar');
}
/** Lo que muestra la vista Radio. `region.mismo`: la región viva es el nodo guardado al entrar (window.__region). */
export const vista = () => p.evaluate(() => {
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
export const sonandoEn = (id, ms = 8000) => esperar(async () => { const f = await foto(); return f.fase === 'oyente' && f.actual === id && !f.paused && f.ct > 0 ? f : null; }, ms);
export const medirFk = async (code) => { const f = await foto(); return { ...f, desfase: r2(f.ct - vivoFk(code)) }; };
/** La foto propia, una sala falsa con A sonando desde 40 s, "Escuchar" y esperar a que suene. */
export async function entrarFk(extra = {}, repeat = 'all') {
  const antes = await prepararFoto(repeat);
  const code = salaFalsa(extra);
  estadoFk(code, { trackId: A.id, positionMs: 40_000, playing: true, nextTrackId: B.id });
  await escuchar(code);
  const s = await sonandoEn(A.id);
  await p.evaluate(() => { window.__nPlay = 0; window.__region = document.querySelector('.radio-aviso-vivo'); });
  return { antes, code, sono: !!s.v };
}
export const salirFk = async () => { await p.evaluate(() => window.__radio().salir()); await sleep(800); };
export const TXT_SIN_RESPUESTA = 'Sin conexión con la radio. Reintentando…';
export const TXT_BLOQUEADO = 'Tu navegador necesita un toque para empezar a sonar.';
export const TXT_SILENCIADA = 'En pausa para ti. Dale play para volver al vivo.';
/** Tras un 401: la página sin sesión (sin token) → se vuelve a cargar y la init script siembra el token. */
export const sinSesion = () => p.evaluate(() => !!document.querySelector('input[type="password"]') && !window.__radio?.());
export const volverAEntrar = async () => {
  await p.goto(BASE + '/');
  await p.waitForSelector('.player-bar', { timeout: 15000 });
  await p.waitForFunction(() => !!window.__player?.() && !!window.__radio?.());
};

export const salas = [];   // [token, código] para cerrarlas al final pase lo que pase
