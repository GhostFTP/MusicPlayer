// radio-mod-func.mjs — la moderación de punta a punta (1.43.0, W3): el ANFITRIÓN (SNAP_USER) y la
// MODERADORA (SNAP2) en DOS navegadores, contra el backend REAL del runner (:3100, copia de la base) y el
// build de producción (:4173). El audio es un WAV sintético por /stream (como radio-func).
//
// El anfitrión transmite desde la app: su puente (W3) ejecuta las órdenes. La moderadora ESCUCHA desde la
// app (su puente de oyente) y, mientras no exista su cara (W5), lee la sala con ?cap=mod y manda las
// órdenes con fetch DESDE SU PÁGINA y con su sesión; al anfitrión la nombra la API (su botón es W4).
// La cola del anfitrión se arma desde la prueba con el valor de PlayerContext (ubicado por la fibra, como
// fin-de-cola.mjs): la app no expone nada.
//
// Comprueba, con cada orden: que el motor del anfitrión hace lo pedido, que el evento aparece para la
// moderadora (con su id) y, donde cambia lo que suena, que su reproductor de oyente lo sigue. Más:
// el intervalo de 2 s del anfitrión con moderadores, "siguiente" con aleatorio+repetir todo (aplicada),
// con aleatorio y el ciclo agotado y con repetir una en la última (descartadas: sin evento), "a
// continuación" y "ahora" al final de la cola (suenan), y una "siguiente" vieja (409 obsoleta).
// MIDE (en "medidas", fuera del conteo): de la orden al motor del anfitrión, al evento y al oyente.
// W5b-1 (q, r, s): los BOTONES de su tarjeta ("Pausar la radio", "Reanudar la radio", "Siguiente canción de
// la radio"), REPS veces cada uno: el motor del anfitrión cambia, el evento llega a SU región (un nodo nuevo
// cada vez: los textos se repiten), la línea de estado queda vacía y el foco sigue en el botón. Mide del clic
// al motor y del clic al evento (mínimo, mediana y máximo, en "medidas").
//
// Uso: SNAP_BASE=http://localhost:4173 SNAP2_USER=… SNAP2_PASS=… node radio-mod-func.mjs
// RADIO_MOD_SALIDA=<archivo>: deja ahí los resultados con sus valores.
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';

await preflight();
const T0 = Date.now();
const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? !!v : { ok: !!v, ...extra }; };
const NO_MEDIDO = [];
const medidas = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esperar = async (fn, ms = 6000, paso = 100) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return { v, ms: Date.now() - t }; await sleep(paso); } return { v: null, ms: null }; };

const tokHost = await getToken();
const login2 = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: process.env.SNAP2_USER, password: process.env.SNAP2_PASS }) });
const tokMod = (await login2.json()).token;
if (!tokMod) { console.error('[radio-mod-func] no entra la segunda cuenta (SNAP2_USER/SNAP2_PASS)'); process.exit(1); }
const api = async (tok, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
};
const idMod = (await api(tokMod, 'GET', '/api/me')).j?.id;

const albums = (await api(tokHost, 'GET', '/api/albums')).j ?? [];
const alb = albums.find((a) => (a.track_count ?? a.tracks ?? a.count ?? 0) >= 5 && a.album) ?? albums.find((a) => (a.track_count ?? a.tracks ?? a.count ?? 3) >= 3 && a.album) ?? albums[0];
const RUTA_ALBUM = `/albums/${alb.album_artist ? encodeURIComponent(alb.album_artist) : '@'}/${encodeURIComponent(alb.album)}`;

function wav(sec = 180, sr = 8000) {
  const n = sec * sr, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const WAV = wav();

// En cada página: el token, los medios que suenan, el valor del motor (por la fibra) y los intervalos vivos.
const INIT = (t) => {
  localStorage.setItem('token', t);
  window.__els = new Set();
  const op = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...a) { window.__els.add(this); return op.apply(this, a); };
  const si = window.setInterval.bind(window), ci = window.clearInterval.bind(window);
  window.__intervalos = new Map();
  window.setInterval = (fn, ms, ...a) => { const id = si(fn, ms, ...a); window.__intervalos.set(id, ms); return id; };
  window.clearInterval = (id) => { window.__intervalos.delete(id); return ci(id); };
  window.__player = () => {
    const root = document.getElementById('root');
    const key = Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
    const pila = [root[key]?.stateNode?.current ?? root[key]];
    while (pila.length) {
      const f = pila.pop(); if (!f) continue;
      const v = f.memoizedProps?.value;
      if (v && typeof v.play === 'function' && typeof v.addToQueue === 'function') return v;
      if (f.sibling) pila.push(f.sibling);
      if (f.child) pila.push(f.child);
    }
    return null;
  };
  window.__motor = () => {
    const v = window.__player();
    const s = [...window.__els].filter((e) => !e.paused && !e.ended);
    return { id: v?.currentTrack?.id ?? null, qid: v?.currentTrack?._qid ?? null, idx: v?.queueIndex ?? -1, len: v?.queue.length ?? 0, ids: v?.queue.map((x) => x.id) ?? [],
      playing: !!v?.isPlaying, shuffle: !!v?.shuffle, repeat: v?.repeat ?? null, sonando: s.length, t: s[0] ? s[0].currentTime : null };
  };
};

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
async function abrir(tok) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**/stream/**', (r) => {
    const h = r.request().headers().range; const total = WAV.length;
    if (!h) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV });
    const [, a, b] = h.match(/bytes=(\d*)-(\d*)/); const start = a ? +a : 0; const end = b ? +b : total - 1;
    r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: WAV.subarray(start, end + 1) });
  });
  await ctx.route('**/api/plays', (r) => r.fulfill({ status: 201, contentType: 'application/json', body: '{"added":0,"already":0,"skipped":0}' }));
  await ctx.addInitScript(INIT, tok);
  const p = await ctx.newPage();
  const errores = []; p.on('pageerror', (e) => errores.push(e.message));
  return { ctx, p, errores };
}

const H = await abrir(tokHost);
const M = await abrir(tokMod);
const motor = (pg) => pg.evaluate(() => window.__motor());
let code = null;
try {
  // ── El anfitrión transmite ──
  await H.p.goto(BASE + RUTA_ALBUM);
  await H.p.waitForSelector('.track-row', { timeout: 10_000 });
  await H.p.locator('.track-row').first().click();
  await sleep(1200);
  const Q = await H.p.evaluate(() => window.__player().queue.map(({ _qid, ...t }) => t));
  if (Q.length < 3) throw Object.assign(new Error(`el álbum de prueba tiene ${Q.length} pistas (hacen falta 3)`), { noMedido: true });
  const X = Q[3] ?? Q[0];
  const Y = Q[4] ?? Q[1];
  const poner = async (cola, i, { shuffle = false, repeat = 'off' } = {}) => {
    await H.p.evaluate(([q, i, sh, rep]) => {
      const v = window.__player();
      v.play(q, i);
      if (v.shuffle !== sh) v.toggleShuffle();
      const orden = ['off', 'all', 'one'];
      for (let k = 0; k < (orden.indexOf(rep) - orden.indexOf(v.repeat) + 3) % 3; k++) v.cycleRepeat();
    }, [cola, i, shuffle, repeat]);
    return esperar(async () => { const m = await motor(H.p); return m.playing && m.sonando === 1 && m.t > 0.2 && m.idx === i ? m : null; }, 8000);
  };
  const alFinal = async () => {
    await H.p.evaluate(() => { const e = [...window.__els].find((x) => !x.paused); e.currentTime = e.duration - 0.3; });
    return esperar(async () => { const m = await motor(H.p); return !m.playing && m.sonando === 0 ? m : null; }, 5000);
  };
  const avanza = async (pg) => { const a = await motor(pg); await sleep(400); const b = await motor(pg); return a.sonando === 1 && b.sonando === 1 && b.t > a.t + 0.2; };

  await poner(Q.slice(0, 3), 0);
  await H.p.locator('.sidebar-nav button', { hasText: /^Radio$/ }).click(); await sleep(600);
  await H.p.locator('.main-content .radio-btn', { hasText: 'Iniciar radio' }).click();
  const r0 = await esperar(async () => H.p.evaluate(() => document.querySelector('.radio-codigo')?.textContent ?? null), 6000);
  code = r0.v;
  const caps = await api(tokHost, 'GET', `/api/radio/${code}?desde=0`);
  ok('a_el_anfitrion_crea_la_radio_aceptando_ordenes', /^[2-9A-Z]{6}$/.test(code ?? '') && caps.j?.capabilities?.orders === true, { code, capabilities: caps.j?.capabilities });

  // ── La moderadora escucha ──
  await M.p.goto(BASE + '/');
  await M.p.waitForSelector('.player-bar', { timeout: 10_000 });
  await M.p.evaluate((r) => { history.pushState({}, '', r); dispatchEvent(new PopStateEvent('popstate')); }, `/radio/${code}`);
  await M.p.waitForSelector('.radio-btn--escuchar:not([disabled])', { timeout: 8000 });
  await M.p.click('.radio-btn--escuchar');
  const sigue = (id, ms = 9000) => esperar(async () => { const m = await motor(M.p); return m.id === id && m.playing && m.sonando === 1 ? m : null; }, ms, 100);
  const escucha = await sigue(Q[0].id);
  ok('b_la_moderadora_escucha_la_radio', !!escucha.v, { motor: escucha.v });

  // lo que haría su cara (W5): leer con ?cap=mod y mandar órdenes con su sesión
  const leer = (desde) => M.p.evaluate(async ([c, d]) => {
    const r = await fetch(`/api/radio/${c}?cap=mod${d != null ? `&desde=${d}` : ''}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
    return { status: r.status, j: await r.json().catch(() => null) };
  }, [code, desde ?? null]);
  const ordenar = (o) => M.p.evaluate(async ([c, o]) => {
    const clientId = Math.random().toString(36).slice(2, 12).padEnd(8, 'x');
    const t = Date.now();
    const r = await fetch(`/api/radio/${c}/ordenes`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` }, body: JSON.stringify({ ...o, clientId }) });
    return { status: r.status, j: await r.json().catch(() => null), t };
  }, [code, o]);
  let cursor = (await leer()).j?.eventsUntil ?? 0;
  const evento = async (tipo, desdeT, ms = 9000) => esperar(async () => {
    const r = await leer(cursor);
    const e = (r.j?.events ?? []).find((x) => x.type === tipo && x.by === idMod);
    return e ? { e, t: Date.now() } : null;
  }, ms, 150).then((r) => { if (r.v) cursor = r.v.e.id; return r.v; });
  const sinEvento = async (ms = 6000) => { await sleep(ms); const r = await leer(cursor); const evs = (r.j?.events ?? []).filter((x) => x.by === idMod); return { evs, ordenes: (await api(tokHost, 'GET', `/api/radio/${code}?desde=0`)).j?.orders ?? null }; };

  // ── El anfitrión la nombra ──
  await leer();
  const nom = await api(tokHost, 'PUT', `/api/radio/${code}/moderadores/${idMod}`);
  const dos = await esperar(async () => (await H.p.evaluate(() => [...window.__intervalos.values()].filter((v) => v === 2000).length)) === 1, 8000);
  const eNom = await esperar(async () => { const r = await leer(cursor); const e = (r.j?.events ?? []).find((x) => x.type === 'moderador' && x.target === idMod); return e ?? null; }, 4000);
  if (eNom.v) cursor = eNom.v.id;
  ok('c_nombrada_y_el_anfitrion_lee_cada_2s', nom.status === 200 && !!dos.v && !!eNom.v, { status: nom.status, intervalo2s: !!dos.v, evento: eNom.v?.type ?? null });

  // Una orden: la manda, espera el efecto en el motor del anfitrión y el evento; mide los tiempos.
  const probar = async (nombre, o, efecto, { tipoEvento = o.type, oyente = null } = {}) => {
    const r = await ordenar(o);
    const e = await esperar(async () => { const m = await motor(H.p); return efecto(m) ? m : null; }, 9000, 50);
    const tMotor = e.v ? Date.now() : null;
    const ev = await evento(tipoEvento, r.t);
    const oy = oyente != null ? await sigue(oyente) : null;
    const tOy = oy?.v ? Date.now() : null;
    medidas[nombre] = { motor_ms: tMotor ? tMotor - r.t : null, evento_ms: ev ? ev.t - r.t : null, ...(oyente != null ? { oyente_ms: tOy ? tOy - r.t : null } : {}) };
    return { r, m: e.v, ev, oy: oy?.v ?? null };
  };
  const seqActual = async () => (await leer(cursor)).j?.state?.seq;

  { const x = await probar('pausa', { type: 'pausa' }, (m) => !m.playing);
    const oyPausa = await esperar(async () => !(await motor(M.p)).playing, 9000);
    ok('d_pausa', x.r.status === 202 && !!x.m && !!x.ev && !!oyPausa.v, { status: x.r.status, evento: x.ev?.e.type, oyenteEnPausa: !!oyPausa.v }); }
  { const x = await probar('reanudar', { type: 'reanudar' }, (m) => m.playing && m.sonando === 1, { oyente: Q[0].id });
    ok('e_reanudar', x.r.status === 202 && !!x.m && !!x.ev && !!x.oy, { status: x.r.status, evento: x.ev?.e.type }); }
  { const x = await probar('siguiente', { type: 'siguiente', seqBase: await seqActual() }, (m) => m.idx === 1 && m.playing, { oyente: Q[1].id });
    ok('f_siguiente_y_el_oyente_lo_sigue', x.r.status === 202 && !!x.m && !!x.ev && !!x.oy, { status: x.r.status, motor: x.m && { idx: x.m.idx, id: x.m.id } }); }
  { const antes = await motor(H.p);
    const x = await probar('a_continuacion', { type: 'a-continuacion', trackId: X.id }, (m) => m.len === antes.len + 1 && m.ids[m.idx + 1] === X.id && m.qid === antes.qid);
    ok('g_a_continuacion_entra_despues_de_la_actual', x.r.status === 202 && !!x.m && !!x.ev && x.ev.e.trackId === X.id && !!x.ev.e.title, { evento: x.ev?.e && { type: x.ev.e.type, trackId: x.ev.e.trackId, title: x.ev.e.title } }); }
  { const x = await probar('ahora', { type: 'ahora', trackId: Y.id }, (m) => m.id === Y.id && m.playing && m.sonando === 1, { oyente: Y.id });
    ok('h_ahora_suena_ya_y_el_oyente_lo_sigue', x.r.status === 202 && !!x.m && !!x.ev && !!x.oy, { evento: x.ev?.e.type }); }

  // ── Repetir y aleatorio ──
  { await poner(Q.slice(0, 3), 2, { shuffle: true, repeat: 'all' });
    await sleep(2500);
    const antes = await motor(H.p);
    const x = await probar('aleatorio_repetir_todo', { type: 'siguiente', seqBase: await seqActual() }, (m) => m.qid !== antes.qid && m.playing);
    ok('i_aleatorio_con_repetir_todo_pasa_a_otra', !!x.m && !!x.ev, { antes: antes.idx, despues: x.m?.idx }); }
  { await poner(Q.slice(0, 3), 0, { shuffle: true });
    for (let k = 0; k < 2; k++) { await H.p.evaluate(() => window.__player().next()); await sleep(500); }
    await sleep(2500);
    const antes = await motor(H.p);
    const r = await ordenar({ type: 'siguiente', seqBase: await seqActual() });
    const d = await sinEvento();
    const m = await motor(H.p);
    ok('j_aleatorio_con_el_ciclo_agotado_se_descarta_sin_evento', r.status === 202 && d.evs.length === 0 && m.qid === antes.qid && m.playing && Array.isArray(d.ordenes) && d.ordenes.length === 0,
      { status: r.status, eventos: d.evs.map((e) => e.type), pendientes: d.ordenes?.length ?? null }); }
  { await poner(Q.slice(0, 3), 2, { repeat: 'one' });
    await sleep(2500);
    const antes = await motor(H.p);
    const r = await ordenar({ type: 'siguiente', seqBase: await seqActual() });
    const d = await sinEvento();
    const m = await motor(H.p);
    ok('k_repetir_una_en_la_ultima_se_descarta_sin_evento', r.status === 202 && antes.repeat === 'one' && d.evs.length === 0 && m.qid === antes.qid && Array.isArray(d.ordenes) && d.ordenes.length === 0,
      { status: r.status, repeat: antes.repeat, eventos: d.evs.map((e) => e.type) }); }

  // ── Al final de la cola ──
  { await poner(Q.slice(0, 2), 1);
    const fin = await alFinal();
    await sleep(1500);
    const x = await probar('a_continuacion_al_final', { type: 'a-continuacion', trackId: X.id }, (m) => m.id === X.id && m.playing && m.sonando === 1 && m.t > 0.2, { oyente: X.id });
    const suena = x.m ? await avanza(H.p) : false;
    ok('l_a_continuacion_al_final_de_la_cola_suena', !!fin.v && !!x.m && suena && !!x.ev && !!x.oy, { fin: !!fin.v, suena, evento: x.ev?.e.type, oyente: !!x.oy }); }
  { const fin = await alFinal();
    await sleep(1500);
    const x = await probar('ahora_al_final', { type: 'ahora', trackId: Q[0].id }, (m) => m.id === Q[0].id && m.playing && m.sonando === 1 && m.t > 0.2, { oyente: Q[0].id });
    const suena = x.m ? await avanza(H.p) : false;
    ok('m_ahora_al_final_de_la_cola_suena', !!fin.v && !!x.m && suena && !!x.ev && !!x.oy, { fin: !!fin.v, suena, evento: x.ev?.e.type }); }

  // ── Una "siguiente" vieja: la rechaza el servidor ──
  { const viejo = await seqActual();
    await H.p.evaluate(() => window.__player().next()); await sleep(1500);
    const r = await ordenar({ type: 'siguiente', seqBase: Math.max(0, viejo - 50) });
    ok('n_siguiente_vieja_409_obsoleta', r.status === 409 && r.j?.reason === 'obsoleta', { status: r.status, reason: r.j?.reason }); }

  // ── W5b-1: los botones de la moderadora, contra el motor del anfitrión ──
  { const REPS = 3;
    await poner(Q.slice(0, 3), 0, { repeat: 'all' });
    await sleep(2500);
    // Cada anuncio de su región es un nodo nuevo (key): se cuentan, así un "Tú pausaste" repetido también se ve.
    await M.p.evaluate(() => {
      window.__anuncios = [];
      const r = document.querySelector('.radio-card--oyente .radio-evento');
      new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) window.__anuncios.push(n.textContent); }).observe(r, { childList: true });
    });
    const anuncios = () => M.p.evaluate(() => window.__anuncios.length);
    const ultimo = () => M.p.evaluate(() => window.__anuncios[window.__anuncios.length - 1] ?? null);
    const lineaM = () => M.p.evaluate(() => document.querySelector('.radio-orden-estado')?.textContent ?? null);
    const lat = { pausa: [], reanudar: [], siguiente: [] };
    const malas = { pausa: [], reanudar: [], siguiente: [] };
    const clic = async (tipo, nombre, efecto, texto, otro) => {
      const b = M.p.getByRole('button', { name: nombre, exact: true });
      await b.waitFor({ timeout: 9000 });
      const antes = await motor(H.p);
      const n0 = await anuncios();
      const t = Date.now();
      await b.click();
      const m = await esperar(async () => { const x = await motor(H.p); return efecto(x, antes) ? x : null; }, 9000, 20);
      const tM = m.v ? Date.now() - t : null;
      const ev = await esperar(async () => ((await anuncios()) > n0 && (await ultimo()) === texto ? true : null), 9000, 20);
      const tE = ev.v ? Date.now() - t : null;
      await sleep(150);
      const linea = await lineaM();
      const foco = await M.p.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null);
      lat[tipo].push({ motor_ms: tM, evento_ms: tE });
      if (!m.v || !ev.v || linea !== '' || ![nombre, otro].includes(foco)) malas[tipo].push({ motor: !!m.v, evento: !!ev.v, linea, foco });
      await sleep(1200);
    };
    for (let k = 0; k < REPS; k++) {
      await clic('pausa', 'Pausar la radio', (x) => !x.playing, 'Tú pausaste', 'Reanudar la radio');
      await clic('reanudar', 'Reanudar la radio', (x) => x.playing && x.sonando === 1, 'Tú reanudaste', 'Pausar la radio');
      await clic('siguiente', 'Siguiente canción de la radio', (x, a) => x.qid !== a.qid && x.playing, 'Tú pasaste a la siguiente canción', null);
    }
    const resumen = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? { min: v[0], mediana: v[Math.floor((v.length - 1) / 2)], max: v[v.length - 1], n: v.length } : null; };
    for (const tipo of Object.keys(lat)) medidas[`boton_${tipo}`] = { motor_ms: resumen(lat[tipo].map((x) => x.motor_ms)), evento_ms: resumen(lat[tipo].map((x) => x.evento_ms)), crudo: lat[tipo] };
    ok('q_boton_pausar_la_radio', lat.pausa.length === REPS && malas.pausa.length === 0, { malas: malas.pausa, medidas: medidas.boton_pausa });
    ok('r_boton_reanudar_la_radio', lat.reanudar.length === REPS && malas.reanudar.length === 0, { malas: malas.reanudar, medidas: medidas.boton_reanudar });
    ok('s_boton_siguiente_cancion_de_la_radio', lat.siguiente.length === REPS && malas.siguiente.length === 0, { malas: malas.siguiente, medidas: medidas.boton_siguiente }); }

  // ── Terminar ──
  await H.p.getByRole('button', { name: 'Terminar radio' }).click(); await sleep(250);
  await H.p.getByRole('button', { name: 'Sí, terminar' }).click();
  const finH = await esperar(async () => !(await H.p.evaluate(() => !!document.querySelector('.radio-terminar'))), 5000);
  const iv = await H.p.evaluate(() => [...window.__intervalos.values()].filter((v) => v === 500 || v === 5000 || v === 2000).length);
  ok('o_al_terminar_no_quedan_intervalos_de_la_radio', !!finH.v && iv === 0, { intervalos: iv });
  code = null;
  if (H.errores.length || M.errores.length) ok('p_sin_errores_de_pagina', false, { anfitrion: H.errores, moderadora: M.errores });
} catch (e) {
  if (e.noMedido) NO_MEDIDO.push(e.message); else { console.error(e); ok('00_sin_excepcion', false, { error: String(e?.message ?? e).slice(0, 300) }); }
} finally {
  if (code) await api(tokHost, 'DELETE', `/api/radio/${code}`);
  await browser.close();
}

const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
console.log('medidas (ms desde que la moderadora manda la orden):', JSON.stringify(medidas));
if (process.env.RADIO_MOD_SALIDA) (await import('node:fs')).writeFileSync(process.env.RADIO_MOD_SALIDA, JSON.stringify({ R, NO_MEDIDO, medidas, segundos: Math.round((Date.now() - T0) / 1000) }, null, 1));
for (const x of NO_MEDIDO) console.log('NO MEDIDO:', x);
console.log(`\n[radio-mod-func] ${Math.round((Date.now() - T0) / 1000)} s`);
console.log(`\nradio-mod-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
process.exit(fails.length || NO_MEDIDO.length ? 1 : 0);
