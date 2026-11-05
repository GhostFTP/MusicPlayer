// radio-func.mjs — la Radio web, ANFITRIÓN (fase 1, sub-paso 3), contra el BUILD DE PRODUCCIÓN (preview
// :4173) y el backend REAL del runner (:3100, copia de la base). El audio sale de un WAV sintético por
// /stream (page.route, como fav-bar-desktop-func); los videos son los sintéticos del runner (VIDEO_DIR).
// La segunda cuenta (SNAP2_USER/SNAP2_PASS) la crea el runner en su copia: es el "oyente" que lee la sala.
//
// Dos partes:
//   · 1-10  contra el servidor de radio REAL: crear, publicar (pausa, salto, pista, latido), oyentes,
//           terminar con confirmación, reemplazada, video, pagehide.
//   · 11-18 con un servidor de radio FALSO (page.route sobre /api/radio): cómo reacciona la app a 429,
//           403, 410, 401, 409, red caída, 422 y terminar sin red. No toca el límite de 6 salas/min.
// Además: que Layout y la vista NO se re-rendericen con el reloj mientras se transmite (gancho de
// DevTools sobre el build de producción, ubicando los componentes por su DOM), y que al salir no
// quede vivo ningún intervalo de la radio.
//
// RADIO_SOLO=2,11 corre sólo esos escenarios (lo usan las mutaciones de control; el conteo no cuadra
// con el baseline a propósito). Lo que no se puede medir va en "NO MEDIDO", fuera del conteo.
// Uso: SNAP_BASE=http://localhost:4173 SNAP2_USER=… SNAP2_PASS=… node radio-func.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';

await preflight();
const T0 = Date.now();
const SOLO = process.env.RADIO_SOLO ? new Set(process.env.RADIO_SOLO.split(',').map(Number)) : null;
const corre = (n) => !SOLO || SOLO.has(n);
const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? !!v : { ok: !!v, ...extra }; };
const NO_MEDIDO = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tokHost = await getToken();
const login2 = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: process.env.SNAP2_USER, password: process.env.SNAP2_PASS }) });
const tokOye = (await login2.json()).token;
if (!tokOye) { console.error('[radio-func] no entra la segunda cuenta (SNAP2_USER/SNAP2_PASS)'); process.exit(1); }

const api = async (tok, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
};
const sala = (c) => api(tokHost, 'GET', `/api/radio/${c}`);   // el anfitrión lee sin contarse como oyente

// Un álbum con al menos 3 pistas, para tener siguiente y poder saltar.
const albums = (await api(tokHost, 'GET', '/api/albums')).j ?? [];
const alb = albums.find((a) => (a.track_count ?? a.tracks ?? a.count ?? 3) >= 3 && a.album) ?? albums[0];
const RUTA_ALBUM = `/albums/${alb.album_artist ? encodeURIComponent(alb.album_artist) : '@'}/${encodeURIComponent(alb.album)}`;

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

// Init de cada página: token; intervalos vivos (para ver que la radio no deja ninguno al salir); y un
// gancho de DevTools que cuenta los renders de Layout y de la vista de <main>, ubicados por su DOM
// (el build de producción no tiene nombres de componentes).
const INIT = (t) => {
  localStorage.setItem('token', t);
  const si = window.setInterval.bind(window), ci = window.clearInterval.bind(window);
  window.__intervalos = new Map();
  window.setInterval = (fn, ms, ...a) => { const id = si(fn, ms, ...a); window.__intervalos.set(id, ms); return id; };
  window.clearInterval = (id) => { window.__intervalos.delete(id); return ci(id); };
  window.__renders = { layout: 0, vista: 0 }; window.__contar = false;
  const fibra = (el) => { if (!el) return null; const k = Object.keys(el).find((x) => x.startsWith('__reactFiber$')); return k ? el[k] : null; };
  const funcionArriba = (f, n) => { let x = f; let c = 0; while (x) { x = x.return; if (x && typeof x.type === 'function' && ++c === n) return x; } return null; };
  const funcionAbajo = (f) => { let x = f?.child; while (x && typeof x.type !== 'function') x = x.child; return x; };
  const previo = new Map();
  const mirar = (nombre, f) => {
    if (!f) return;
    const p = previo.get(nombre);
    const cambio = !p || (p.f !== f && p.f !== f.alternate) || p.props !== f.memoizedProps || p.state !== f.memoizedState;
    if (p && cambio && window.__contar) window.__renders[nombre]++;
    previo.set(nombre, { f, props: f.memoizedProps, state: f.memoizedState });
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers: new Map(), inject() { return 1; }, isDisabled: false,
    onCommitFiberRoot() {
      try {
        // Layout: la 2.ª función hacia arriba desde div.layout (la 1.ª es DragQueueProvider).
        mirar('layout', funcionArriba(fibra(document.querySelector('.layout')), 2));
        // La vista: la 1.ª función dentro de <main class="main-content">.
        mirar('vista', funcionAbajo(fibra(document.querySelector('.main-content'))));
      } catch { /* sin DOM todavía */ }
    },
    onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {},
  };
};

async function abrir({ mobile = false, falso = null } = {}) {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
  await ctx.route('**/stream/**', (r) => {
    if (r.request().url().includes('/stream/video/')) return r.continue();   // los videos sintéticos, de verdad
    const h = r.request().headers().range; const total = WAV.length;
    if (!h) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV });
    const [, a, b] = h.match(/bytes=(\d*)-(\d*)/); const start = a ? +a : 0; const end = b ? +b : total - 1;
    r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: WAV.subarray(start, end + 1) });
  });
  if (falso) await ctx.route('**/api/radio**', falso);
  await ctx.addInitScript(INIT, tokHost);
  const p = await ctx.newPage();
  const pedidos = []; p.on('request', (q) => { if (new URL(q.url()).pathname.startsWith('/api/radio')) pedidos.push({ t: Date.now(), m: q.method(), u: new URL(q.url()).pathname }); });
  const errores = []; p.on('pageerror', (e) => errores.push(e.message));
  return { ctx, p, pedidos, errores };
}
const vista = (p) => p.evaluate(() => ({
  path: location.pathname,
  codigo: document.querySelector('.radio-codigo')?.textContent ?? null,
  anfitrion: !!document.querySelector('.radio-terminar'),
  estado: document.querySelector('.radio-estado')?.textContent ?? null,
  oyentes: document.querySelector('.radio-oyentes')?.textContent ?? null,
  iniciar: (() => { const b = [...document.querySelectorAll('.main-content .radio-btn')].find((x) => /Iniciar|Creando/.test(x.textContent)); return b ? { texto: b.textContent.trim(), off: b.disabled } : null; })(),
  notas: [...document.querySelectorAll('.main-content .radio-nota')].map((n) => n.textContent),
  foco: document.activeElement?.textContent?.trim().slice(0, 30) ?? null,
  login: !!document.querySelector('input[type="password"]'),
  intervalosRadio: [...window.__intervalos.values()].filter((ms) => ms === 500 || ms === 5000).length,
}));
const esperar = async (fn, ms = 6000, paso = 150) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return { v, ms: Date.now() - t }; await sleep(paso); } return { v: null, ms: null }; };
async function sonar(p) {
  await p.goto(BASE + RUTA_ALBUM);
  await p.waitForSelector('.track-row', { timeout: 10_000 });
  await p.locator('.track-row').first().click();
  await sleep(1200);
}
const irA = async (p, nombre) => { await p.locator('.sidebar-nav button', { hasText: new RegExp(`^${nombre}$`) }).click(); await sleep(600); };
const iniciar = async (p) => { await p.locator('.main-content .radio-btn', { hasText: 'Iniciar radio' }).click(); return esperar(async () => (await vista(p)).anfitrion, 5000); };
const espacio = async (p) => { await p.evaluate(() => document.activeElement?.blur()); await p.keyboard.press('Space'); };
const tecla = async (p, k) => { await p.evaluate(() => document.activeElement?.blur()); await p.keyboard.press(k); };
const terminarUI = async (p) => {
  await p.getByRole('button', { name: 'Terminar radio' }).click(); await sleep(250);
  await p.getByRole('button', { name: 'Sí, terminar' }).click();
  return esperar(async () => !(await vista(p)).anfitrion, 5000);
};
const pedidosDesde = (pedidos, t) => pedidos.filter((x) => x.t > t).map((x) => `${x.m} ${x.u}`);
const TXT = {
  terminaste: 'Terminaste la radio.',
  reemplazada: 'Empezaste otra radio desde otra pestaña o dispositivo.',
  noEsTuya: 'Esta radio ya no es tuya.',
  pausa: 'La radio se cerró por estar mucho tiempo en pausa.',
  demasiadas: 'Hay demasiadas radios en vivo ahora. Intenta más tarde.',
  frecuencia: 'Demasiados intentos. Espera unos segundos e intenta de nuevo.',
  conexion: 'No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.',
  noTerminar: 'No se pudo terminar la radio. Intenta de nuevo.',
};

// ══════════════════════════ 1-10: servidor de radio REAL ══════════════════════════
if ([1, 2, 3, 4, 5, 6, 7].some(corre)) {
  const { ctx, p, pedidos, errores } = await abrir();
  if (corre(1)) {
    await p.goto(BASE + '/radio'); await sleep(1200);
    const v = await vista(p);
    ok('01_sin_cancion_iniciar_deshabilitado', v.iniciar?.off === true && v.iniciar.texto === 'Iniciar radio' && v.notas.includes('Pon una canción para empezar.'), { iniciar: v.iniciar, notas: v.notas });
  }
  await sonar(p);
  await irA(p, 'Radio');
  const intervalosAntes = (await vista(p)).intervalosRadio;
  // 2: retardo de ~800 ms en el POST (real) y dos clic en el mismo instante
  let codigo = null;
  {
    await p.route('**/api/radio', async (r) => { if (r.request().method() === 'POST') await sleep(800); return r.continue(); });
    const t = Date.now();
    await p.evaluate(() => { const b = [...document.querySelectorAll('.main-content .radio-btn')].find((x) => x.textContent.includes('Iniciar')); b.click(); b.click(); });
    await sleep(250);
    const creando = await vista(p);
    const listo = await esperar(async () => (await vista(p)).anfitrion, 5000);
    await p.unroute('**/api/radio');
    const v = await vista(p);
    codigo = v.codigo;
    const posts = pedidos.filter((x) => x.t >= t && x.m === 'POST').length;
    if (corre(2)) {
      ok('02a_creando_deshabilitado', creando.iniciar?.texto === 'Creando…' && creando.iniciar.off === true, { iniciar: creando.iniciar });
      ok('02b_doble_clic_un_solo_post', posts === 1 && !!listo.v && /^[2-9A-Z]{6}$/.test(codigo ?? ''), { posts, codigo });
      const s = await esperar(async () => { const x = await api(tokOye, 'GET', `/api/radio/${codigo}`); return x.j?.state?.seq >= 1 ? x : null; }, 3000);
      const st = s.v?.j?.state;
      ok('02c_primera_publicacion_y_oyente_lee', st && Number.isInteger(st.trackId) && st.playing === true && Number.isInteger(st.nextTrackId), { state: st });
    }
  }
  if (corre(6)) {
    await api(tokOye, 'GET', `/api/radio/${codigo}`);
    // Tope 8 s = un ciclo de lectura del anfitrión (OYENTES_CADA_MS, 5 s) + 3 s de holgura. Medido: ~5,1 s.
    const r = await esperar(async () => (await vista(p)).oyentes === '1 oyente', 8000, 200);
    ok('06_un_oyente_en_menos_de_8s', !!r.v, { ms: r.ms, oyentes: (await vista(p)).oyentes });
  }
  if (corre(3)) {
    const cambio = async (accion, prueba) => { const t = Date.now(); await accion(); return esperar(async () => { const x = (await sala(codigo)).j?.state; return x && prueba(x) ? x : null; }, 3000, 100).then((r) => ({ ...r, ms: r.v ? Date.now() - t : null })); };
    const pausa = await cambio(() => espacio(p), (x) => x.playing === false);
    const sigue = await cambio(() => espacio(p), (x) => x.playing === true);
    ok('03a_pausa_en_el_servidor_menos_de_1_5s', pausa.ms != null && pausa.ms < 1500, { ms: pausa.ms });
    ok('03b_reanuda_en_el_servidor_menos_de_1_5s', sigue.ms != null && sigue.ms < 1500, { ms: sigue.ms });
    await sleep(1200);
    const antes = (await sala(codigo)).j?.state;
    const tPut = Date.now();
    const salto = await cambio(() => tecla(p, 'ArrowRight'), (x) => x.seq > antes.seq && x.positionMs > antes.positionMs + 8000);
    const puts = pedidos.filter((x) => x.t >= tPut && x.m === 'PUT').length;
    ok('03c_salto_publica', salto.ms != null && salto.ms < 1500 && puts >= 1, { ms: salto.ms, antes: antes?.positionMs, despues: salto.v?.positionMs, puts });
    const pista = await cambio(() => p.locator('.player-bar .ctrl-next').click(), (x) => x.trackId !== antes.trackId);
    ok('03d_cambio_de_pista_cambia_trackId', pista.ms != null && pista.ms < 1500, { ms: pista.ms, antes: antes?.trackId, despues: pista.v?.trackId });
  }
  if (corre(4)) {
    await espacio(p); await sleep(800);
    const s0 = (await sala(codigo)).j?.state;
    await sleep(11_500);
    const s1 = (await sala(codigo)).j?.state;
    ok('04_latido_en_pausa', s0?.playing === false && s1?.seq > s0?.seq, { antes: s0?.seq, despues: s1?.seq });
    await espacio(p); await sleep(500);
  }
  if (corre(5)) {
    await irA(p, 'Biblioteca');
    const s0 = (await sala(codigo)).j?.state?.seq;
    // La Biblioteca re-renderiza al CARGAR (medido: 8 renders en los primeros segundos, también sin
    // radio). Se cuenta recién con la vista asentada: 3 s de espera y una ventana de 8 s sonando.
    await sleep(3000);
    await p.evaluate(() => { window.__renders = { layout: 0, vista: 0 }; window.__contar = true; });
    await sleep(8000);
    const ren = await p.evaluate(() => { window.__contar = false; return window.__renders; });
    const s1 = (await sala(codigo)).j?.state?.seq;
    ok('05a_en_biblioteca_sigue_publicando', s1 > s0, { antes: s0, despues: s1 });
    ok('05b_layout_y_vista_no_se_rerenderizan_con_el_reloj', ren.layout === 0 && ren.vista === 0, { renders_8s: ren });
    await irA(p, 'Radio');
  }
  if (corre(7)) {
    const intervalosDurante = (await vista(p)).intervalosRadio;
    await p.locator('.player-bar .queue-btn').click(); await sleep(500);
    const colaAbierta = await p.locator('.queue-panel').count();
    await p.getByRole('button', { name: 'Terminar radio' }).click(); await sleep(300);
    const conf = await vista(p);
    await p.keyboard.press('Escape'); await sleep(300);
    const tras = await vista(p);
    const colaSigue = await p.locator('.queue-panel').count();
    ok('07a_escape_cierra_la_confirmacion_y_no_la_cola', colaAbierta === 1 && conf.foco === 'No' && tras.anfitrion && tras.foco === 'Terminar radio' && colaSigue === 1,
      { colaAbierta, focoConfirmar: conf.foco, focoTras: tras.foco, colaSigue });
    const fin = await terminarUI(p);
    const sv = await sala(codigo);
    const v = await vista(p);
    const t = Date.now();
    await sleep(6000);
    const despues = pedidosDesde(pedidos, t);
    ok('07b_terminar_ended_anfitrion', !!fin.v && sv.j?.status === 'ended' && sv.j?.endedReason === 'anfitrion', { status: sv.j?.status, razon: sv.j?.endedReason });
    ok('07c_cara_sin_radio_con_texto', !v.anfitrion && v.estado === TXT.terminaste, { estado: v.estado });
    ok('07d_cero_pedidos_despues', despues.length === 0, { despues });
    const intervalosDespues = (await vista(p)).intervalosRadio;
    ok('07e_sin_intervalos_de_radio_vivos', intervalosDurante === intervalosAntes + 2 && intervalosDespues === intervalosAntes, { antes: intervalosAntes, durante: intervalosDurante, despues: intervalosDespues });
  }
  if (errores.length) ok('00_sin_errores_de_pagina_1_7', false, { errores });
  await ctx.close();
}

if (corre(8)) {
  const { ctx, p, pedidos } = await abrir();
  await sonar(p); await irA(p, 'Radio');
  const intervalosAntes = (await vista(p)).intervalosRadio;
  await iniciar(p);
  const c1 = (await vista(p)).codigo;
  const intervalosDurante = (await vista(p)).intervalosRadio;
  const otra = await api(tokHost, 'POST', '/api/radio');
  // Tope 8 s = un ciclo de lectura del anfitrión (OYENTES_CADA_MS, 5 s) + 3 s de holgura. Medido: ~4,9 s.
  const r = await esperar(async () => (await vista(p)).estado === TXT.reemplazada, 8000, 200);
  const t = Date.now(); await sleep(6000);
  const despues = pedidosDesde(pedidos, t);
  ok('08a_reemplazada_sale_en_menos_de_8s', otra.status === 201 && !!r.v && !(await vista(p)).anfitrion, { ms: r.ms, estado: (await vista(p)).estado, viejo: c1, nuevo: otra.j?.code });
  ok('08b_reemplazada_cero_pedidos_despues', despues.length === 0, { despues });
  const intervalosDespues = (await vista(p)).intervalosRadio;
  ok('08c_reemplazada_sin_intervalos_vivos', intervalosDurante === intervalosAntes + 2 && intervalosDespues === intervalosAntes, { antes: intervalosAntes, durante: intervalosDurante, despues: intervalosDespues });
  if (otra.j?.code) await api(tokHost, 'DELETE', `/api/radio/${otra.j.code}`);
  await ctx.close();
}

if (corre(9)) {
  const vids = (await api(tokHost, 'GET', '/api/videos')).j?.videos ?? [];
  if (!vids.length) NO_MEDIDO.push('09 video: no hay videos sintéticos (¿sin ffmpeg?)');
  else {
    const { ctx, p } = await abrir();
    await p.goto(BASE + '/videos'); await p.waitForSelector('.video-card', { timeout: 10_000 });
    await p.locator('.video-card').first().click(); await sleep(1500);
    await irA(p, 'Radio');
    await iniciar(p);
    const c = (await vista(p)).codigo;
    const s = await esperar(async () => { const x = (await sala(c)).j?.state; return x?.enPausaPorVideo === true ? x : null; }, 3000);
    ok('09_video_publica_enPausaPorVideo', !!s.v && s.v.trackId === null, { state: s.v });
    await api(tokHost, 'DELETE', `/api/radio/${c}`);
    await ctx.close();
  }
}

if (corre(10)) {
  // 10a: el evento pagehide SINTÉTICO (prueba el cableado, no la descarga real)
  { const { ctx, p } = await abrir();
    await sonar(p); await irA(p, 'Radio');
    await iniciar(p);
    const c = (await vista(p)).codigo;
    await p.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    const s = await esperar(async () => { const x = await sala(c); return x.j?.status === 'ended' ? x : null; }, 3000);
    ok('10a_pagehide_sintetico_deja_ended', !!s.v && s.v.j.endedReason === 'anfitrion', { status: s.v?.j?.status, razon: s.v?.j?.endedReason });
    // La página sigue viva (como al volver de la caché del navegador): el próximo latido recibe 410 y sale limpio.
    const sale = await esperar(async () => (await vista(p)).estado === TXT.terminaste, 13_000, 300);
    ok('10b_tras_pagehide_la_pagina_viva_sale_limpia', !!sale.v && !(await vista(p)).anfitrion, { ms: sale.ms, estado: (await vista(p)).estado });
    await ctx.close(); }
  // 10c: cerrar la página de verdad
  { const { ctx, p } = await abrir();
    await sonar(p); await irA(p, 'Radio');
    await iniciar(p);
    const c = (await vista(p)).codigo;
    let vio = false;
    await p.exposeFunction('__vioPagehide', () => { vio = true; });
    await p.evaluate(() => window.addEventListener('pagehide', () => window.__vioPagehide()));
    await p.close({ runBeforeUnload: true });
    const s = await esperar(async () => { const x = await sala(c); return x.j?.status === 'ended' ? x : null; }, 3000);
    // Sólo es NO MEDIDO si el navegador no disparó pagehide al cerrar: entonces no hay nada que probar.
    // Si lo disparó y la sala no quedó ended, es un fallo de la app.
    if (vio) ok('10c_cerrar_la_pagina_deja_ended', s.v?.j?.endedReason === 'anfitrion', { razon: s.v?.j?.endedReason ?? null, vioPagehide: vio });
    else NO_MEDIDO.push('10c cerrar la página de verdad: page.close({runBeforeUnload:true}) no disparó pagehide');
    if (!s.v) await api(tokHost, 'DELETE', `/api/radio/${c}`);
    await ctx.close(); }
}

// ══════════════════════════ 11-18: servidor de radio FALSO ══════════════════════════
// Responde como el real; cada escenario pisa lo que necesita con `falla` (por método) y anota cada pedido.
const F = { seq: 0, falla: {}, log: [] };
const ahora = () => Date.now();
async function falso(route) {
  const q = route.request(); const m = q.method(); const t = ahora();
  F.log.push({ t, m });
  const f = F.falla[m];
  if (f) { const x = typeof f === 'function' ? f(q) : f; if (x) { if (x.abort) return route.abort('failed'); return route.fulfill({ status: x.status, contentType: 'application/json', headers: x.headers ?? {}, body: JSON.stringify(x.body ?? { error: 'x' }) }); } }
  const code = 'K7M2QX';
  if (m === 'POST') return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ code, serverNow: t, status: 'live' }) });
  if (m === 'PUT') {
    const b = JSON.parse(q.postData() || '{}');
    const state = { seq: ++F.seq, trackId: b.trackId ?? null, positionMs: b.positionMs ?? 0, playing: b.playing ?? false, nextTrackId: b.nextTrackId ?? null, enPausaPorVideo: !!b.enPausaPorVideo, publishedAtServerMs: t };
    F.ultimo = b;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ serverNow: t, status: 'live', state }) });
  }
  if (m === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ serverNow: t, code, status: 'live', state: null, host: { id: 1, name: 'h' }, listeners: [] }) });
  if (m === 'DELETE') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ serverNow: t, status: 'ended', endedReason: 'anfitrion' }) });
  return route.continue();
}
const puts = (desde) => F.log.filter((x) => x.m === 'PUT' && x.t >= desde);
const radioDesde = (desde) => F.log.filter((x) => x.t > desde).map((x) => x.m);

if ([11, 12, 13, 15, 16, 17, 18, 14].some(corre)) {
  const { ctx, p } = await abrir({ falso });
  await sonar(p); await irA(p, 'Radio');
  const reset = () => { F.falla = {}; };

  if (corre(11)) {
    reset(); let una = true;
    F.falla.PUT = () => (una ? (una = false, { status: 429, headers: { 'Retry-After': '3' } }) : null);
    const t = ahora(); await iniciar(p);
    await sleep(5000);
    const ps = puts(t);
    const t429 = ps[0]?.t; const siguiente = ps[1]?.t;
    ok('11_retry_after_3s_sin_put_antes_y_luego_sigue', ps.length >= 2 && siguiente - t429 >= 2900 && siguiente - t429 < 4500 && (await vista(p)).anfitrion,
      { espera_ms: siguiente && t429 ? siguiente - t429 : null, puts: ps.length });
    reset(); await terminarUI(p);
  }
  if (corre(12)) {
    reset(); F.falla.PUT = { status: 403 };
    await iniciar(p);
    const r = await esperar(async () => (await vista(p)).estado === TXT.noEsTuya, 4000);
    const t = ahora(); await sleep(6000);
    ok('12_403_sale_no_es_tuya_y_cero_pedidos', !!r.v && !(await vista(p)).anfitrion && radioDesde(t).length === 0, { estado: (await vista(p)).estado, despues: radioDesde(t) });
  }
  if (corre(13)) {
    reset(); F.falla.GET = { status: 410, body: { error: 'x', status: 'ended', endedReason: 'pausa' } };
    await iniciar(p);
    const r = await esperar(async () => (await vista(p)).estado === TXT.pausa, 7000);
    ok('13_410_pausa_en_el_get_sale_con_su_texto', !!r.v && !(await vista(p)).anfitrion, { estado: (await vista(p)).estado });
  }
  if (corre(15)) {
    reset(); F.falla.POST = { status: 409 };
    await p.locator('.main-content .radio-btn', { hasText: 'Iniciar radio' }).click(); await sleep(800);
    const a = await vista(p);
    reset(); F.falla.POST = { status: 429, headers: { 'Retry-After': '5' } };
    await p.locator('.main-content .radio-btn', { hasText: 'Iniciar radio' }).click(); await sleep(800);
    const b = await vista(p);
    ok('15a_409_al_crear', a.estado === TXT.demasiadas && !a.anfitrion && a.iniciar?.off === false, { estado: a.estado, iniciar: a.iniciar });
    ok('15b_429_al_crear', b.estado === TXT.frecuencia && !b.anfitrion && b.iniciar?.off === false, { estado: b.estado, iniciar: b.iniciar });
  }
  if (corre(16)) {
    reset(); let una = true;
    F.falla.PUT = () => (una ? (una = false, { abort: true }) : null);
    const t = ahora(); await iniciar(p);
    await sleep(5000);
    const ps = puts(t);
    const esp = ps[1] && ps[0] ? ps[1].t - ps[0].t : null;
    ok('16_red_caida_reintenta_a_los_3s_y_no_sale', esp != null && esp >= 2800 && esp < 4500 && (await vista(p)).anfitrion && !(await vista(p)).estado, { espera_ms: esp, puts: ps.length });
    reset(); await terminarUI(p);
  }
  if (corre(17)) {
    reset(); let rechazada = null;
    F.falla.PUT = (q) => { const b = JSON.parse(q.postData() || '{}'); if (rechazada == null) rechazada = b.trackId; return b.trackId === rechazada ? { status: 422 } : null; };
    const t = ahora(); await iniciar(p);
    await sleep(6000);
    const n = puts(t).length;
    const t2 = ahora();
    await p.locator('.player-bar .ctrl-next').click();
    await sleep(1500);
    const n2 = puts(t2).length;
    ok('17_422_sin_bucle_y_vuelve_con_otra_pista', n === 1 && n2 >= 1 && (await vista(p)).anfitrion, { puts_misma_pista_6s: n, puts_tras_cambiar: n2, ultimo: F.ultimo?.trackId, rechazada });
    reset(); await terminarUI(p);
  }
  if (corre(18)) {
    reset();
    await iniciar(p); await sleep(500);
    F.falla.DELETE = { abort: true };
    const a = await terminarUI(p);
    const va = await vista(p);
    reset(); await iniciar(p); await sleep(500);
    F.falla.DELETE = { status: 400 };
    const b = await terminarUI(p);
    const vb = await vista(p);
    ok('18a_terminar_sin_red_acaba_sin_radio_con_texto_de_conexion', !!a.v && !va.anfitrion && va.estado === TXT.conexion, { estado: va.estado });
    ok('18b_terminar_con_otro_error_dice_no_se_pudo_terminar', !!b.v && !vb.anfitrion && vb.estado === TXT.noTerminar, { estado: vb.estado });
  }
  if (corre(14)) {
    reset(); F.falla.PUT = { status: 401 };
    await iniciar(p);
    const r = await esperar(async () => (await vista(p)).login, 5000);
    const t = ahora(); await sleep(6000);
    ok('14_401_lleva_al_login_y_cero_pedidos', !!r.v && radioDesde(t).length === 0, { login: !!r.v, despues: radioDesde(t) });
  }
  await ctx.close();
}

await browser.close();
const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
// RADIO_FUNC_SALIDA=<archivo>: deja ahí los resultados con sus valores (el runner no guarda la salida).
if (process.env.RADIO_FUNC_SALIDA) (await import('node:fs')).writeFileSync(process.env.RADIO_FUNC_SALIDA, JSON.stringify({ R, NO_MEDIDO, segundos: Math.round((Date.now() - T0) / 1000) }, null, 1));
for (const x of NO_MEDIDO) console.log('NO MEDIDO:', x);
console.log(`\n[radio-func] ${Math.round((Date.now() - T0) / 1000)} s`);
console.log(`\nradio-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
process.exit(fails.length ? 1 : 0);
