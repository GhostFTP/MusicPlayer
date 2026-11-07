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
//   · 19    las ÓRDENES de quien modera (1.43.0, W3), con otro servidor FALSO que las entrega como el
//           real: aplicar cada tipo, repetida, 429 y red caída en la confirmación, obsoleta, sin
//           siguiente (en orden y en aleatorio, verificando el cambio de pista), video, "a continuación"
//           y "ahora" al final de la cola (que de verdad suenan), tandas de 10, el intervalo de 2 s solo
//           con moderadores, que van de a una (la segunda ve lo que dejó la primera, y espera su turno aunque
//           llegue en otra lectura), que una orden a
//           medio traer su pista se abandone al terminar, y que la espera del motor se corte al terminar,
//           al ser reemplazada y al cerrar sesión. Mide cuánto tarda el motor en mostrar el cambio de pista.
// Además: que Layout y la vista NO se re-rendericen con el reloj mientras se transmite (gancho de
// DevTools sobre el build de producción, ubicando los componentes por su DOM), y que al salir no
// quede vivo ningún intervalo de la radio.
//
// 20 (1.43.0, W4): la cara del anfitrión con la lista de quién escucha, contra un servidor FALSO.
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

async function abrir({ mobile = false, falso = null, init = null } = {}) {
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
  if (init) await ctx.addInitScript(init);
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

// ══════════════════════════ 19: ÓRDENES (1.43.0, W3), servidor de radio FALSO ══════════════════════════
// Entrega órdenes como el real: en el GET con ?desde= (que suma moderators) y en la respuesta del PUT
// que confirma (ordenHasta saca de la lista todo hasta ahí). La cola del anfitrión se ARMA desde la
// prueba con el valor de PlayerContext (ubicado por la fibra, como fin-de-cola.mjs); la app no expone nada.
let MEDIDAS_19 = null;   // lo que se mide (no cuenta como caso): va a RADIO_FUNC_SALIDA y a la consola
const FM = { seq: 0, ordenes: [], moderadores: [{ id: 2, name: 'Sonia', avatar: null }], log: [], falla: {}, id: 0, entregas: new Map(), veces: new Map() };
async function falsoMod(route) {
  const q = route.request(); const m = q.method(); const t = Date.now(); const u = new URL(q.url());
  let body = null; try { body = q.postData() ? JSON.parse(q.postData()) : null; } catch {}
  const reg = { t, m, ruta: u.pathname + u.search, body, respuesta: null };
  FM.log.push(reg);
  const f = FM.falla[m];
  if (f) {
    const x = typeof f === 'function' ? f(q, body) : f;
    if (x) {
      reg.respuesta = x.abort ? 'red' : x.status;
      if (x.abort) return route.abort('failed');
      return route.fulfill({ status: x.status, contentType: 'application/json', headers: x.headers ?? {}, body: JSON.stringify(x.body ?? { error: 'x' }) });
    }
  }
  reg.respuesta = 200;
  const json = (status, b) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
  const salen = () => FM.ordenes.slice(0, 10).map((o) => { if (!FM.entregas.has(o.id)) FM.entregas.set(o.id, t); FM.veces.set(o.id, (FM.veces.get(o.id) ?? 0) + 1); return o; });
  const code = 'K7M2QX';
  if (m === 'POST') return json(201, { code, serverNow: t, status: 'live' });
  if (m === 'PUT') {
    const b = body ?? {};
    FM.ultimo = b;
    const state = { seq: ++FM.seq, trackId: b.trackId ?? null, positionMs: b.positionMs ?? 0, playing: b.playing ?? false, nextTrackId: b.nextTrackId ?? null, enPausaPorVideo: !!b.enPausaPorVideo, publishedAtServerMs: t };
    const conf = b.ordenHasta !== undefined;
    if (conf) FM.ordenes = FM.ordenes.filter((o) => o.id > b.ordenHasta);
    return json(200, { serverNow: t, status: 'live', state, ...(conf ? { orders: salen() } : {}) });
  }
  if (m === 'GET') {
    const mod = u.searchParams.has('desde') || u.searchParams.get('cap') === 'mod';
    return json(200, { serverNow: t, code, status: 'live', state: null, host: { id: 1, name: 'h' }, listeners: [{ id: 2, name: 'Sonia', avatar: null }],
      ...(mod ? { moderators: FM.moderadores, capabilities: { orders: true }, events: [], eventsUntil: 0, eventsLost: false, orders: salen() } : {}) });
  }
  if (m === 'DELETE') return json(200, { serverNow: t, status: 'ended', endedReason: 'anfitrion' });
  return route.continue();
}
// En la página: los medios que suenan, el valor del motor y de la sesión (por la fibra), y los
// setTimeout de 1000 ms (la espera del motor del puente): cuándo se crearon y si se limpiaron o dispararon.
const INIT_MOD = () => {
  window.__els = new Set();
  const op = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...a) { window.__els.add(this); return op.apply(this, a); };
  const valor = (cumple) => {
    const root = document.getElementById('root');
    const key = Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
    const pila = [root[key]?.stateNode?.current ?? root[key]];
    while (pila.length) {
      const f = pila.pop(); if (!f) continue;
      const v = f.memoizedProps?.value;
      if (v && cumple(v)) return v;
      if (f.sibling) pila.push(f.sibling);
      if (f.child) pila.push(f.child);
    }
    return null;
  };
  window.__player = () => valor((v) => typeof v.play === 'function' && typeof v.addToQueue === 'function');
  window.__sesion = () => valor((v) => typeof v.signOut === 'function');
  window.__motor = () => {
    const v = window.__player();
    const s = [...window.__els].filter((e) => !e.paused && !e.ended);
    return { id: v.currentTrack?.id ?? null, qid: v.currentTrack?._qid ?? null, idx: v.queueIndex, len: v.queue.length, playing: v.isPlaying, shuffle: v.shuffle, repeat: v.repeat, sonando: s.length, t: s[0] ? s[0].currentTime : null };
  };
  const st = window.setTimeout.bind(window), ct = window.clearTimeout.bind(window);
  window.__esperas = new Map();
  window.setTimeout = (fn, ms, ...a) => {
    if (ms !== 1000 || typeof fn !== 'function') return st(fn, ms, ...a);
    const r = { creado: Date.now(), estado: 'viva', fin: null };
    const id = st((...x) => { r.estado = 'disparada'; r.fin = Date.now(); fn(...x); }, ms, ...a);
    window.__esperas.set(id, r);
    return id;
  };
  window.clearTimeout = (id) => { const r = window.__esperas.get(id); if (r && r.estado === 'viva') { r.estado = 'limpiada'; r.fin = Date.now(); } return ct(id); };
};

if (corre(19)) {
  const { ctx, p, errores } = await abrir({ falso: falsoMod, init: INIT_MOD });
  await ctx.route('**/api/plays', (r) => r.fulfill({ status: 201, contentType: 'application/json', body: '{"added":0,"already":0,"skipped":0}' }));
  await sonar(p); await irA(p, 'Radio');
  const motor = () => p.evaluate(() => window.__motor());
  const Q = await p.evaluate(() => window.__player().queue.map(({ _qid, ...t }) => t));
  if (Q.length < 3) NO_MEDIDO.push(`19 órdenes: el álbum de prueba tiene ${Q.length} pistas (hacen falta 3)`);
  else {
    const X = Q[3] ?? Q[0];   // la que se pone "a continuación" / "ahora"
    const intervalos = (ms) => p.evaluate((x) => [...window.__intervalos.values()].filter((v) => v === x).length, ms);
    const poner = async (cola, i, { shuffle = false } = {}) => {
      await p.evaluate(([q, i, sh]) => {
        const v = window.__player();
        v.play(q, i);
        if (v.shuffle !== sh) v.toggleShuffle();
        const orden = ['off', 'all', 'one'];
        for (let k = 0; k < (3 - orden.indexOf(v.repeat)) % 3; k++) v.cycleRepeat();
      }, [cola, i, shuffle]);
      return esperar(async () => { const m = await motor(); return m.playing && m.sonando === 1 && m.t > 0.2 && m.idx === i ? m : null; }, 8000, 100);
    };
    const avanza = async () => { const a = await motor(); await sleep(400); const b = await motor(); return a.sonando === 1 && b.sonando === 1 && b.t > a.t + 0.2; };
    const alFinal = async () => {   // deja que la pista actual TERMINE sola (la última de la cola)
      // Sin nada sonando (p. ej. el caso anterior falló), no revienta: deja que el caso lo marque.
      await p.evaluate(() => { const e = [...window.__els].find((x) => !x.paused); if (e) e.currentTime = e.duration - 0.3; });
      return esperar(async () => { const m = await motor(); return !m.playing && m.sonando === 0 ? m : null; }, 5000, 100);
    };
    const dar = (type, extra = {}) => { const o = { id: ++FM.id, type, trackId: null, seqBase: 1, trackBase: null, by: 2, title: null, ...extra }; FM.ordenes.push(o); return o; };
    const confirmada = (id, ms = 8000) => esperar(async () => FM.log.find((x) => x.m === 'PUT' && x.respuesta === 200 && x.body?.ordenHasta >= id) ?? null, ms, 40).then((r) => r.v);
    const aplicada = (put, id) => !!put && Array.isArray(put.body.aplicadas) && put.body.aplicadas.includes(id);
    const espera = (desde) => p.evaluate((d) => [...window.__esperas.values()].filter((r) => r.creado >= d).map((r) => ({ estado: r.estado, ms: r.fin != null ? r.fin - r.creado : null })), desde);
    const listo = async (id) => { const r = await esperar(async () => FM.entregas.get(id) ?? null, 8000, 40); return r.v; };
    const medidas = {};

    // a/b/c: crear, leer, lo publicado sin órdenes y el intervalo de 2 s
    FM.log.length = 0;
    await poner(Q.slice(0, 3), 0);
    const iAntes = { i500: await intervalos(500), i5000: await intervalos(5000), i2000: await intervalos(2000) };
    await iniciar(p);
    await sleep(2500);
    const post = FM.log.find((x) => x.m === 'POST');
    const get0 = FM.log.find((x) => x.m === 'GET');
    ok('19a_crea_con_capabilities_y_lee_con_desde', JSON.stringify(post?.body) === '{"capabilities":{"orders":true}}' && /\?desde=0$/.test(get0?.ruta ?? ''), { cuerpo: post?.body, ruta: get0?.ruta });
    const putsSin = FM.log.filter((x) => x.m === 'PUT');
    const permitidas = new Set(['trackId', 'positionMs', 'playing', 'nextTrackId']);
    ok('19b_sin_ordenes_el_put_es_el_de_1_42', putsSin.length >= 1 && putsSin.every((x) => Object.keys(x.body).every((k) => permitidas.has(k))) && putsSin[0].body.trackId === Q[0].id && putsSin[0].body.nextTrackId === Q[1].id,
      { puts: putsSin.length, primero: putsSin[0]?.body });
    const con = await esperar(async () => (await intervalos(2000)) === iAntes.i2000 + 1, 6000);
    FM.moderadores = [];
    const sin = await esperar(async () => (await intervalos(2000)) === iAntes.i2000, 8000);
    FM.moderadores = [{ id: 2, name: 'Sonia', avatar: null }];
    const otraVez = await esperar(async () => (await intervalos(2000)) === iAntes.i2000 + 1, 8000);
    ok('19c_intervalo_de_2s_solo_con_moderadores', !!con.v && !!sin.v && !!otraVez.v && (await intervalos(500)) === iAntes.i500 + 1 && (await intervalos(5000)) === iAntes.i5000 + 1,
      { con: !!con.v, sin: !!sin.v, otraVez: !!otraVez.v });

    // d: pausa y reanudar — el PUT que confirma lleva el estado nuevo
    { const o = dar('pausa');
      const c = await confirmada(o.id);
      const m = await motor();
      const o2 = dar('reanudar');
      const c2 = await confirmada(o2.id);
      const m2 = await motor();
      medidas.pausa_ms = c && FM.entregas.get(o.id) ? c.t - FM.entregas.get(o.id) : null;
      medidas.reanudar_ms = c2 && FM.entregas.get(o2.id) ? c2.t - FM.entregas.get(o2.id) : null;
      ok('19d_pausa_y_reanudar_se_aplican_y_se_confirman_con_su_estado', aplicada(c, o.id) && c.body.playing === false && !m.playing && aplicada(c2, o2.id) && c2.body.playing === true && m2.playing,
        { pausa: c?.body, reanudar: c2?.body, ms: [medidas.pausa_ms, medidas.reanudar_ms] }); }

    // e: obsoleta — se descarta, se confirma sin evento y sin esperar al latido
    { const antes = await motor();
      const o = dar('siguiente', { trackBase: 999_999 });
      const c = await confirmada(o.id);
      const m = await motor();
      const ms = c && FM.entregas.get(o.id) ? c.t - FM.entregas.get(o.id) : null;
      ok('19e_obsoleta_se_descarta_y_se_confirma_sin_evento', !!c && !aplicada(c, o.id) && c.body.aplicadas === undefined && m.qid === antes.qid && ms < 1500, { cuerpo: c?.body, ms }); }

    // f: sin siguiente en orden (la última, repeat apagado) — ni se llama a next()
    { await poner(Q.slice(0, 3), 2);
      const antes = await motor();
      const o = dar('siguiente', { trackBase: antes.id });
      const t0 = await listo(o.id);
      const c = await confirmada(o.id);
      const m = await motor();
      const e = await espera(t0 ?? Date.now());
      ok('19f_sin_siguiente_en_orden_se_descarta_sin_tocar_el_motor', !!c && !aplicada(c, o.id) && m.qid === antes.qid && m.playing && e.length === 0 && c.t - t0 < 1500,
        { cuerpo: c?.body, ms: c ? c.t - t0 : null, esperas: e }); }

    // g: orden REPETIDA (vuelve a llegar mientras su confirmación espera un 429) — se aplica una vez
    { let primera = true;
      FM.falla.PUT = (q, b) => (b?.ordenHasta !== undefined && primera ? (primera = false, { status: 429, headers: { 'Retry-After': '4' } }) : null);
      const antes = await motor();
      const o = dar('a-continuacion', { trackId: X.id, title: X.title ?? null });
      const c = await confirmada(o.id, 12_000);
      FM.falla = {};
      const rechazado = FM.log.find((x) => x.m === 'PUT' && x.respuesta === 429 && x.body?.ordenHasta >= o.id);
      FM.ordenes.push(o);   // y otra vez después de confirmada: el Set la reconoce
      await sleep(4500);
      FM.ordenes = FM.ordenes.filter((x) => x.id !== o.id);
      const m = await motor();
      const exitos = FM.log.filter((x) => x.m === 'PUT' && x.respuesta === 200 && aplicada(x, o.id)).length;
      ok('19g_repetida_se_aplica_una_vez', m.len === antes.len + 1 && FM.veces.get(o.id) >= 3 && exitos === 1, { largo: [antes.len, m.len], entregas: FM.veces.get(o.id), confirmaciones: exitos });
      ok('19h_429_en_la_confirmacion_se_reenvia_igual_despues', !!rechazado && !!c && JSON.stringify(rechazado.body.aplicadas) === JSON.stringify(c.body.aplicadas) && rechazado.body.ordenHasta === c.body.ordenHasta && c.t - rechazado.t >= 3900,
        { rechazado: rechazado?.body, despues: c?.body, espera_ms: c && rechazado ? c.t - rechazado.t : null }); }

    // i: confirmación PERDIDA (red caída) — se reintenta a los 3 s con la misma
    { let primera = true;
      FM.falla.PUT = (q, b) => (b?.ordenHasta !== undefined && primera ? (primera = false, { abort: true }) : null);
      const o = dar('pausa');
      const c = await confirmada(o.id);
      FM.falla = {};
      const perdido = FM.log.find((x) => x.m === 'PUT' && x.respuesta === 'red' && x.body?.ordenHasta >= o.id);
      const gap = c && perdido ? c.t - perdido.t : null;
      ok('19i_confirmacion_perdida_se_reintenta_con_la_misma', !!perdido && aplicada(perdido, o.id) && aplicada(c, o.id) && perdido.body.ordenHasta === c.body.ordenHasta && gap >= 2800 && gap < 4500, { espera_ms: gap, perdido: perdido?.body, despues: c?.body });
      const o2 = dar('reanudar'); await confirmada(o2.id); }

    // j: siguiente EN ORDEN (se sabe que hay): se aplica; el PUT trae la pista nueva y la confirmación
    { await poner(Q.slice(0, 3), 0);
      const o = dar('siguiente', { trackBase: Q[0].id });
      const t0 = await listo(o.id);
      const c = await confirmada(o.id);
      const m = await motor();
      const e = await espera(t0);
      medidas.motor_en_orden_ms = e[0]?.ms ?? null;
      ok('19j_siguiente_en_orden_se_aplica_y_confirma_con_la_pista_nueva', aplicada(c, o.id) && c.body.trackId === Q[1].id && m.idx === 1 && e[0]?.estado === 'limpiada',
        { cuerpo: c?.body, espera: e[0] }); }

    // k: siguiente en ALEATORIO con a dónde ir (no se sabe de antemano): cambió → aplicada
    { await poner(Q.slice(0, 3), 0, { shuffle: true });
      const antes = await motor();
      const o = dar('siguiente', { trackBase: antes.id });
      const t0 = await listo(o.id);
      const c = await confirmada(o.id);
      const m = await motor();
      const e = await espera(t0);
      medidas.motor_aleatorio_ms = e[0]?.ms ?? null;
      ok('19k_aleatorio_con_a_donde_cambia_y_se_da_por_aplicada', m.shuffle && aplicada(c, o.id) && m.qid !== antes.qid && c.body.trackId === m.id && e[0]?.estado === 'limpiada' && e[0].ms < 1000,
        { cuerpo: c?.body, espera: e[0] });

      // l: el ciclo agotado (las 3 sonaron): next() no hace nada → sin-siguiente, sin evento
      await p.evaluate(() => window.__player().next()); await sleep(600);
      const agotado = await motor();
      const o2 = dar('siguiente', { trackBase: agotado.id });
      const t2 = await listo(o2.id);
      const c2 = await confirmada(o2.id);
      const m2 = await motor();
      const e2 = await espera(t2);
      ok('19l_aleatorio_sin_a_donde_se_descarta_tras_verificar', !!c2 && !aplicada(c2, o2.id) && m2.qid === agotado.qid && m2.playing && e2[0]?.estado === 'disparada' && c2.t - t2 >= 1000 && c2.t - t2 < 2000,
        { cuerpo: c2?.body, ms: c2 ? c2.t - t2 : null, espera: e2[0] }); }

    // m/n: al FINAL de la cola, "a continuación" y "ahora" suenan de verdad
    { await poner(Q.slice(0, 2), 1);
      const fin = await alFinal();
      const o = dar('a-continuacion', { trackId: X.id });
      const t0 = await listo(o.id);
      const r = await esperar(async () => { const m = await motor(); return m.id === X.id && m.playing && m.sonando === 1 && m.t > 0.2 ? m : null; }, 8000, 50);
      const suena = r.v ? await avanza() : false;
      const c = await confirmada(o.id);
      medidas.a_continuacion_al_final_suena_ms = r.v ? Date.now() - t0 - 400 : null;
      ok('19m_a_continuacion_al_final_de_la_cola_suena_ya', !!fin.v && !!r.v && suena && aplicada(c, o.id) && c.body.trackId === X.id && c.body.playing === true,
        { fin: fin.v && { idx: fin.v.idx, playing: fin.v.playing }, ahora: r.v && { idx: r.v.idx, t: r.v.t }, cuerpo: c?.body });
      const fin2 = await alFinal();
      const o2 = dar('ahora', { trackId: Q[0].id });
      const t2 = await listo(o2.id);
      const r2 = await esperar(async () => { const m = await motor(); return m.id === Q[0].id && m.playing && m.sonando === 1 && m.t > 0.2 ? m : null; }, 8000, 50);
      const suena2 = r2.v ? await avanza() : false;
      const c2 = await confirmada(o2.id);
      medidas.ahora_al_final_suena_ms = r2.v ? Date.now() - t2 - 400 : null;
      ok('19n_ahora_al_final_de_la_cola_suena_ya', !!fin2.v && !!r2.v && suena2 && aplicada(c2, o2.id) && c2.body.trackId === Q[0].id && c2.body.playing === true, { cuerpo: c2?.body }); }

    // o: "a continuación" en pausa a MITAD de la cola: entra después, no suena ya
    { await poner(Q.slice(0, 3), 0);
      await p.evaluate(() => window.__player().pause()); await sleep(500);
      const antes = await motor();
      const o = dar('a-continuacion', { trackId: X.id });
      const c = await confirmada(o.id);
      await sleep(600);
      const m = await motor();
      ok('19o_a_continuacion_en_pausa_a_mitad_entra_despues_y_no_suena', aplicada(c, o.id) && m.len === antes.len + 1 && m.qid === antes.qid && !m.playing && m.sonando === 0, { antes, despues: m });
      await p.evaluate(() => window.__player().resume()); await sleep(500); }

    // p: tandas de 10 (12 resueltas mientras los PUT rebotan)
    { let bloqueado = true;
      FM.falla.PUT = () => (bloqueado ? { status: 429, headers: { 'Retry-After': '1' } } : null);
      const diez = Array.from({ length: 10 }, () => dar('pausa'));
      await esperar(async () => FM.veces.get(diez[9].id) >= 1, 6000); await sleep(2500);
      FM.ordenes = [];
      const dos = Array.from({ length: 2 }, () => dar('pausa'));
      await esperar(async () => FM.veces.get(dos[1].id) >= 1, 6000); await sleep(2500);
      const tLibre = Date.now();
      bloqueado = false;
      const c2 = await confirmada(dos[1].id);
      FM.falla = {};
      const exitos = FM.log.filter((x) => x.m === 'PUT' && x.respuesta === 200 && x.t >= tLibre && x.body?.ordenHasta !== undefined).map((x) => x.body);
      ok('19p_tandas_de_10', exitos.length >= 2 && exitos[0].ordenHasta === diez[9].id && JSON.stringify(exitos[0].aplicadas) === JSON.stringify(diez.map((o) => o.id))
        && exitos[1].ordenHasta === dos[1].id && JSON.stringify(exitos[1].aplicadas) === JSON.stringify(dos.map((o) => o.id)) && !!c2,
        { tandas: exitos.slice(0, 3) });
      const o = dar('reanudar'); await confirmada(o.id); }

    // q: video — se descarta
    { const vids = (await api(tokHost, 'GET', '/api/videos')).j?.videos ?? [];
      if (!vids.length) NO_MEDIDO.push('19q video: no hay videos sintéticos (¿sin ffmpeg?)');
      else {
        await irA(p, 'Videos'); await p.waitForSelector('.video-card', { timeout: 10_000 });   // sin recargar: la radio sigue
        await p.locator('.video-card').first().click();
        await esperar(async () => FM.ultimo?.enPausaPorVideo === true, 6000);
        const o = dar('pausa');
        const c = await confirmada(o.id);
        ok('19q_viendo_un_video_se_descarta', !!c && !aplicada(c, o.id) && c.body.enPausaPorVideo === true, { cuerpo: c?.body });
        await irA(p, 'Radio');
      } }

    // u: de a UNA — dos "siguiente" sobre la misma pista, juntas: la segunda ve la pista nueva (obsoleta)
    { await poner(Q.slice(0, 3), 0);
      const a = dar('siguiente', { trackBase: Q[0].id });
      const b = dar('siguiente', { trackBase: Q[0].id });
      const c = await confirmada(b.id);
      await sleep(800);
      const m = await motor();
      const aplicadasTodas = FM.log.filter((x) => x.m === 'PUT' && x.respuesta === 200 && Array.isArray(x.body?.aplicadas)).flatMap((x) => x.body.aplicadas);
      ok('19u_de_a_una_la_segunda_ve_la_pista_nueva', !!c && m.idx === 1 && aplicadasTodas.includes(a.id) && !aplicadasTodas.includes(b.id) && FM.veces.get(a.id) >= 1 && FM.entregas.get(a.id) === FM.entregas.get(b.id),
        { idx: m.idx, aplicadaLaPrimera: aplicadasTodas.includes(a.id), aplicadaLaSegunda: aplicadasTodas.includes(b.id), juntas: FM.entregas.get(a.id) === FM.entregas.get(b.id) }); }

    // w: SERIAL con entregas separadas — la 2.ª llega mientras la 1.ª sigue en vuelo (esperando su pista):
    // espera su turno. Sin la serialización, la pausa se aplicaría ya y se confirmaría antes (ordenHasta
    // saltándose a la primera). 19u no lo ve: ahí las dos llegan juntas y van en el mismo bucle.
    { await poner(Q.slice(0, 3), 0);
      const antes = await motor();
      let pedida = 0, soltar;
      const puerta = new Promise((r) => { soltar = r; });
      const ruta = `**/api/tracks/${X.id}`;
      await p.route(ruta, async (r) => { pedida = Date.now(); await puerta; await r.continue().catch(() => {}); });
      const tA = Date.now();
      const a = dar('a-continuacion', { trackId: X.id });
      await esperar(async () => pedida > 0, 8000, 30);
      const b = dar('pausa');
      const llego = await esperar(async () => FM.entregas.has(b.id) || null, 6000, 30);
      await sleep(400);
      const enVuelo = await motor();
      soltar();
      const c = await confirmada(b.id);
      await p.unroute(ruta);
      await sleep(300);
      const m = await motor();
      const primera = FM.log.find((x) => x.m === 'PUT' && x.respuesta === 200 && x.t >= tA && x.body?.ordenHasta !== undefined);
      ok('19w_serial_la_segunda_espera_aunque_llegue_aparte', !!llego.v && FM.entregas.get(b.id) > FM.entregas.get(a.id) && enVuelo.playing && !!c && !m.playing && m.len === antes.len + 1
        && primera?.body.ordenHasta === a.id && aplicada(primera, a.id),
        { llegoAparte: !!llego.v, enVueloSonaba: enVuelo.playing, primera: primera?.body, final: { playing: m.playing, largo: [antes.len, m.len] } });
      const o = dar('reanudar'); await confirmada(o.id); }

    // x: dos "a continuación" con pistas DISTINTAS, juntas (el mismo bucle): la 2.ª llama a
    // playAfterCurrent DESPUÉS de que la 1.ª cambió la cola, y tiene que ver la cola que dejó la 1.ª.
    // Con un playAfterCurrent viejo (que leyera la cola del render donde arrancó el bucle) la 2.ª
    // pisaría a la 1.ª y el largo sería +1. Esperado: +2, en orden de PILA: es la conducta documentada
    // de playAfterCurrent (inserta tras la actual + forcedNext.unshift): la última pedida suena primero.
    // Si en 1.43.1 se pasa a orden de llegada (FIFO), esta expectativa se actualiza.
    { await poner(Q.slice(0, 3), 0);
      const A = Q[3] ?? Q[1], B = Q[4] ?? Q[2];
      const antes = await motor();
      const a = dar('a-continuacion', { trackId: A.id });
      const b = dar('a-continuacion', { trackId: B.id });
      const c = await confirmada(b.id);
      await sleep(400);
      const m = await motor();
      const cola = await p.evaluate(() => { const v = window.__player(); return { ids: v.queue.map((t) => t.id), idx: v.queueIndex }; });
      const detras = cola.ids.slice(cola.idx + 1, cola.idx + 3);
      const aplicadasTodas = FM.log.filter((x) => x.m === 'PUT' && x.respuesta === 200 && Array.isArray(x.body?.aplicadas)).flatMap((x) => x.body.aplicadas);
      ok('19x_dos_a_continuacion_juntas_crecen_2_en_orden_de_pila',A.id !== B.id && !!c && FM.entregas.get(a.id) === FM.entregas.get(b.id)
        && aplicadasTodas.includes(a.id) && aplicadasTodas.includes(b.id) && m.len === antes.len + 2 && m.qid === antes.qid
        && detras[0] === B.id && detras[1] === A.id,
        { juntas: FM.entregas.get(a.id) === FM.entregas.get(b.id), largo: [antes.len, m.len], esperado: [B.id, A.id], detras, cola: cola.ids, idx: cola.idx }); }

    // v: termina la radio mientras llega la pista de "a continuación": no se toca el motor
    { await poner(Q.slice(0, 3), 0);
      const antes = await motor();
      let pedida = 0;
      const ruta = `**/api/tracks/${X.id}`;
      await p.route(ruta, async (r) => { pedida = Date.now(); await sleep(1500); await r.continue().catch(() => {}); });
      dar('a-continuacion', { trackId: X.id });
      await esperar(async () => pedida > 0, 8000, 30);
      await terminarUI(p);
      await sleep(2500);
      await p.unroute(ruta);
      const m = await motor();
      ok('19v_terminar_mientras_llega_la_pista_no_toca_el_motor', pedida > 0 && m.len === antes.len && m.qid === antes.qid, { pedida: pedida > 0, largo: [antes.len, m.len] });
      FM.ordenes = [];
      await iniciar(p); await sleep(1500); }

    // r/s/t: la espera del motor se corta al desmontar el puente
    const agotarAleatorio = async () => {
      await poner(Q.slice(0, 3), 0, { shuffle: true });
      for (let k = 0; k < 2; k++) { await p.evaluate(() => window.__player().next()); await sleep(500); }
      return motor();
    };
    const conEspera = async () => {   // una "siguiente" sin a dónde: la espera de 1 s queda viva
      const a = await agotarAleatorio();
      const o = dar('siguiente', { trackBase: a.id });
      const t0 = await listo(o.id);
      const r = await esperar(async () => { const e = await espera(t0); return e.find((x) => x.estado === 'viva') ? e : null; }, 1500, 20);
      return { t0, viva: !!r.v };
    };
    const tras = async (t0) => { const tCorte = Date.now(); await sleep(2500); return { esperas: await espera(t0), despues: FM.log.filter((x) => x.t > tCorte).map((x) => x.m) }; };
    { const { t0, viva } = await conEspera();
      await terminarUI(p);
      const r = await tras(t0);
      ok('19r_terminar_corta_la_espera_del_motor', viva && r.esperas.length === 1 && r.esperas[0].estado === 'limpiada' && r.despues.length === 0, { viva, ...r }); }
    { await iniciar(p); await sleep(1500);
      const { t0, viva } = await conEspera();
      FM.falla.PUT = { status: 410, body: { error: 'x', status: 'ended', endedReason: 'reemplazada' } };
      await tecla(p, 'ArrowRight');
      const sale = await esperar(async () => (await vista(p)).estado === TXT.reemplazada, 3000, 50);
      FM.falla = {};
      const r = await tras(t0);
      ok('19s_reemplazada_corta_la_espera_del_motor', viva && !!sale.v && r.esperas.length === 1 && r.esperas[0].estado === 'limpiada' && r.despues.length === 0, { viva, sale: !!sale.v, ...r }); }
    { await iniciar(p); await sleep(1500);
      const { t0, viva } = await conEspera();
      await p.evaluate(() => window.__sesion().signOut());
      const login = await esperar(async () => (await vista(p)).login, 3000, 50);
      const r = await tras(t0);
      ok('19t_cerrar_sesion_corta_la_espera_del_motor', viva && !!login.v && r.esperas.length === 1 && r.esperas[0].estado === 'limpiada' && r.despues.length === 0, { viva, login: !!login.v, ...r }); }

    console.log('[radio-func] 19 medido:', JSON.stringify(medidas));
    MEDIDAS_19 = medidas;
  }
  if (errores.length) ok('19_sin_errores_de_pagina', false, { errores });
  await ctx.close();
}

// ══════════════════════════ 20: LA CARA DEL ANFITRIÓN (1.43.0, W4), servidor de radio FALSO ══════════════════════════
// La lista de quién escucha con "Hacer moderador" / "Quitar", el tope de 3, el 409 sin-soporte, la región
// viva de los eventos y el toast (solo con eventos AJENOS), y que la lectura de 2 s arranque al nombrar,
// sin esperar la de 5 s. Cuatro oyentes que admiten moderar (Sonia, Beto, Caro, Eva) y una que no (Dani).
const FW = { host: null, mods: [], sinSoporte: new Set([9005]), fuera: new Set(), eventos: [], evId: 0, log: [] };   // fuera: dejaron de escuchar
// Ids altos: que ninguno coincida con el anfitrión real (la lista lo saca por id).
const PERS = { 9002: 'Sonia', 9003: 'Beto', 9004: 'Caro', 9005: 'Dani', 9006: 'Eva' };
const persona = (id) => ({ id, name: PERS[id], avatar: null });
const evento = (type, by, byName, target = null) => {
  const e = { id: ++FW.evId, type, by, byName, target, targetName: target ? PERS[target] : null, trackId: null, title: null, at: Date.now() };
  FW.eventos.push(e); return e;
};
async function falsoW4(route) {
  const q = route.request(); const m = q.method(); const t = Date.now(); const u = new URL(q.url());
  FW.log.push({ t, m, ruta: u.pathname + u.search });
  const json = (status, b) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
  const code = 'K7M2QX';
  const mod = u.pathname.match(/\/moderadores\/(\d+)$/);
  if (mod) {
    const id = +mod[1];
    if (m === 'PUT') {
      if (FW.sinSoporte.has(id)) return json(409, { error: 'x', reason: 'sin-soporte' });
      if (!FW.mods.includes(id)) {
        if (FW.mods.length >= 3) return json(409, { error: 'x', reason: 'moderadores-llenos' });
        FW.mods.push(id); evento('moderador', FW.host, 'Yo', id);
      }
    } else if (FW.mods.includes(id)) { FW.mods = FW.mods.filter((x) => x !== id); evento('sin-moderador', FW.host, 'Yo', id); }
    return json(200, { serverNow: t, moderators: FW.mods.map(persona), name: PERS[id] });
  }
  if (m === 'POST') return json(201, { code, serverNow: t, status: 'live' });
  if (m === 'PUT') {
    const b = q.postData() ? JSON.parse(q.postData()) : {};
    return json(200, { serverNow: t, status: 'live', state: { seq: 1, trackId: b.trackId ?? null, positionMs: b.positionMs ?? 0, playing: !!b.playing, nextTrackId: b.nextTrackId ?? null, enPausaPorVideo: false, publishedAtServerMs: t } });
  }
  if (m === 'GET') {
    const desde = Number(u.searchParams.get('desde') ?? 0);
    return json(200, { serverNow: t, code, status: 'live', state: null, host: { id: FW.host, name: 'Yo' }, listeners: [9002, 9003, 9004, 9005, 9006].filter((id) => !FW.fuera.has(id)).map(persona),
      moderators: FW.mods.map(persona), capabilities: { orders: true }, events: FW.eventos.filter((e) => e.id > desde), eventsUntil: FW.evId, eventsLost: false, orders: [] });
  }
  if (m === 'DELETE') return json(200, { serverNow: t, status: 'ended', endedReason: 'anfitrion' });
  return route.continue();
}
// Lo que pasa por la región viva y por los toasts, anotado en la página (un toast dura 3,5 s: así no se escapa).
const OBSERVAR_W4 = () => {
  window.__toasts = []; window.__region = [];
  new MutationObserver(() => {
    for (const n of document.querySelectorAll('.toast-text')) if (!n.dataset.visto) { n.dataset.visto = '1'; window.__toasts.push(n.textContent); }
    const r = document.querySelector('.radio-evento'); const tx = r?.textContent ?? null;
    if (r && window.__region[window.__region.length - 1] !== tx) window.__region.push(tx);
  }).observe(document.body, { subtree: true, childList: true, characterData: true });
};

if (corre(20)) {
  const { ctx, p, errores } = await abrir({ falso: falsoW4, init: INIT_MOD });
  try {
  await sonar(p); await irA(p, 'Radio');
  FW.host = await p.evaluate(() => window.__sesion()?.user?.id ?? null);
  await p.evaluate(OBSERVAR_W4);
  const intervalos = (ms) => p.evaluate((x) => [...window.__intervalos.values()].filter((v) => v === x).length, ms);
  const filas = () => p.evaluate(() => [...document.querySelectorAll('.radio-persona')].map((li) => {
    const b = li.querySelector('.radio-btn--persona');
    return { nombre: li.querySelector('.radio-persona-nombre')?.textContent, insignia: li.querySelector('.radio-insignia')?.textContent ?? null,
      boton: b ? { texto: b.textContent, label: b.getAttribute('aria-label'), off: b.disabled, id: b.dataset.persona } : null,
      nota: li.querySelector('.radio-persona-nota')?.textContent ?? null };
  }));
  const fila = async (nombre) => (await filas()).find((x) => x.nombre === nombre);
  const foco = () => p.evaluate(() => { const a = document.activeElement; return { clase: a?.className ?? null, texto: a?.textContent ?? null, persona: a?.dataset?.persona ?? null, id: a?.id ?? null }; });
  const tras = (t, ruta) => FW.log.filter((x) => x.t >= t && x.ruta.includes(ruta));
  // Clic justo DESPUÉS de una lectura: la de 5 s queda a ~5 s, así lo que pase en el primer segundo es del clic.
  const gets = () => FW.log.filter((x) => x.m === 'GET').length;
  const trasUnaLectura = async () => { const n = gets(); await esperar(async () => gets() > n, 7000, 25); };

  await iniciar(p);
  const lista = await esperar(async () => ((await filas()).length === 6 ? true : null), 8000, 100);
  const f0 = await filas();
  const region0 = await p.evaluate(() => { const r = document.querySelector('.radio-evento'); return r ? { rol: r.getAttribute('role'), texto: r.textContent } : null; });
  ok('20a_lista_con_insignias_y_hacer_moderador', !!lista.v && f0[0].nombre === 'Tú' && f0[0].insignia === 'Anfitrión' && !f0[0].boton
    && f0.slice(1).every((x) => x.insignia === null && x.boton?.texto === 'Hacer moderador' && x.boton.label === `Hacer moderador a ${x.nombre}` && !x.boton.off)
    && region0?.rol === 'status' && region0.texto === '' && (await intervalos(2000)) === 0,
    { filas: f0, region: region0 });

  // b: nombrar a Sonia → insignia, "Quitar", el foco sigue en el botón y la lectura de 2 s ya está
  await trasUnaLectura();
  const tB = Date.now();
  await p.getByRole('button', { name: 'Hacer moderador a Sonia' }).click();
  const dos = await esperar(async () => ((await intervalos(2000)) === 1 ? true : null), 3000, 25);
  const msDos = dos.v ? Date.now() - tB : null;
  await sleep(200);
  const fB = await fila('Sonia'); const focoB = await foco();
  ok('20b_nombrar_marca_modera_y_arranca_la_lectura_de_2s_en_el_acto', tras(tB, '/moderadores/9002').some((x) => x.m === 'PUT') && fB.insignia === 'Modera' && fB.boton?.texto === 'Quitar'
    && fB.boton.label === 'Quitar a Sonia de moderar' && focoB.persona === '9002' && msDos != null && msDos < 1000,
    { fila: fB, foco: focoB, ms2s: msDos });

  // c/d: el evento propio (nombrar) va a la región y NO al toast; uno ajeno (Sonia pausa) va a los dos
  const propio = await esperar(async () => ((await p.evaluate(() => window.__region)).includes('Tú nombraste a Sonia para moderar') ? true : null), 5000, 50);
  evento('pausa', 9002, 'Sonia');
  const ajenoR = await esperar(async () => ((await p.evaluate(() => document.querySelector('.radio-evento')?.textContent)) === 'Sonia pausó' ? true : null), 5000, 50);
  const ajenoT = await esperar(async () => ((await p.evaluate(() => window.__toasts)).includes('Sonia pausó') ? true : null), 3000, 50);
  const toasts = await p.evaluate(() => window.__toasts);
  const region = await p.evaluate(() => window.__region);
  ok('20c_evento_ajeno_en_la_region_viva_y_en_el_toast', !!ajenoR.v && !!ajenoT.v, { region, toasts });
  ok('20d_evento_propio_solo_en_la_region_sin_toast', !!propio.v && !toasts.some((x) => /^Tú /.test(x)), { region, toasts });

  // e: quitar a Sonia → sin insignia, "Hacer moderador", el foco sigue ahí y se corta la lectura de 2 s
  const tE = Date.now();
  await p.getByRole('button', { name: 'Quitar a Sonia de moderar' }).click();
  const sinDos = await esperar(async () => ((await intervalos(2000)) === 0 ? true : null), 3000, 25);
  await sleep(200);
  const fE = await fila('Sonia'); const focoE = await foco();
  ok('20e_quitar_vuelve_a_hacer_moderador_y_corta_la_lectura_de_2s', tras(tE, '/moderadores/9002').some((x) => x.m === 'DELETE') && fE.insignia === null && fE.boton?.texto === 'Hacer moderador'
    && focoE.persona === '9002' && !!sinDos.v, { fila: fE, foco: focoE });

  // g: Dani no lo admite (409 sin-soporte) → sin botón, la nota con el foco, sin aviso de error, y no se reintenta
  const tG = Date.now();
  await p.getByRole('button', { name: 'Hacer moderador a Dani' }).click();
  await esperar(async () => ((await fila('Dani'))?.nota ? true : null), 3000, 50);
  await sleep(2500);
  const fG = await fila('Dani'); const focoG = await foco();
  const estadoG = await p.evaluate(() => document.querySelector('.radio-estado')?.textContent ?? null);
  ok('20g_sin_soporte_deja_la_nota_y_no_reintenta', fG.nota === 'Su versión todavía no lo admite.' && fG.boton === null && focoG.id === 'radio-persona-nota-9005'
    && tras(tG, '/moderadores/9005').length === 1 && estadoG === '', { fila: fG, foco: focoG, pedidos: tras(tG, '/moderadores/9005').length, estado: estadoG });

  // f: tres moderando → a Eva se le OCULTA el botón (no está en el DOM) y aparece la línea del tope
  for (const n of ['Sonia', 'Beto', 'Caro']) {
    await p.getByRole('button', { name: `Hacer moderador a ${n}` }).click();
    await esperar(async () => ((await fila(n))?.insignia === 'Modera' ? true : null), 3000, 50);
  }
  await sleep(300);
  const fF = await filas();
  const tope = await p.evaluate(() => document.querySelector('.radio-tope')?.textContent ?? null);
  const eva = fF.find((x) => x.nombre === 'Eva');
  const nodosEva = await p.evaluate(() => document.querySelectorAll('[data-persona="9006"]').length);
  ok('20f_con_3_moderando_se_oculta_hacer_moderador_y_sale_la_linea', FW.mods.length === 3 && !!eva && eva.boton === null && eva.nota === null
    && fF.every((x) => !x.boton?.off) && tope === 'Ya hay 3 personas moderando. Quita a alguien primero.' && nodosEva === 0,
    { filas: fF, tope, mods: FW.mods });

  // h: un moderador que DEJA DE ESCUCHAR sigue moderando (el servidor no lo saca). Con 3 (Caro ausente)
  // su fila sigue, al final, con "Modera", la nota y "Quitar"; quitarla libera el tope y el foco va a la lista.
  FW.fuera.add(9004);
  const ausente = await esperar(async () => { const f = await filas(); return f[f.length - 1]?.nombre === 'Caro' && f.filter((x) => x.nombre === 'Caro').length === 1 ? f : null; }, 8000, 100);
  const fH = ausente.v ?? await filas();
  const caro = fH[fH.length - 1];
  const cajaCaro = await p.evaluate(() => { const b = document.querySelector('[aria-label="Quitar a Caro de moderar"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
  const topeAntes = await p.evaluate(() => document.querySelector('.radio-tope')?.textContent ?? null);
  const tH = Date.now();
  let quitada = false;
  if (cajaCaro) {
    await p.getByRole('button', { name: 'Quitar a Caro de moderar' }).click();
    quitada = !!(await esperar(async () => ((await filas()).some((x) => x.nombre === 'Caro') ? null : true), 4000, 50)).v;
  }
  await sleep(300);
  const fH2 = await filas();
  const topeDespues = await p.evaluate(() => document.querySelector('.radio-tope')?.textContent ?? null);
  const focoH = await p.evaluate(() => document.activeElement?.className ?? null);
  ok('20h_moderador_ausente_tiene_fila_con_quitar_y_libera_el_tope', !!ausente.v && caro?.insignia === 'Modera' && caro.nota === 'No está escuchando' && caro.boton?.label === 'Quitar a Caro de moderar'
    && cajaCaro?.w >= 44 && cajaCaro?.h >= 44 && topeAntes === 'Ya hay 3 personas moderando. Quita a alguien primero.'
    && tras(tH, '/moderadores/9004').some((x) => x.m === 'DELETE') && quitada && topeDespues === null
    && fH2.find((x) => x.nombre === 'Eva')?.boton?.label === 'Hacer moderador a Eva' && focoH === 'radio-personas',
    { filas: fH, caja: cajaCaro, topeAntes, topeDespues, foco: focoH, despues: fH2.map((x) => [x.nombre, x.insignia, x.boton?.texto ?? null]) });

  } catch (e) { ok('20_excepcion', false, { error: String(e.message).split(/\r?\n/)[0].slice(0, 300), donde: String(e.stack).split(/\r?\n/).slice(1, 3).join(' | ') }); }
  if (errores.length) ok('20_sin_errores_de_pagina', false, { errores });
  await ctx.close();
}

await browser.close();
const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
// RADIO_FUNC_SALIDA=<archivo>: deja ahí los resultados con sus valores (el runner no guarda la salida).
if (process.env.RADIO_FUNC_SALIDA) (await import('node:fs')).writeFileSync(process.env.RADIO_FUNC_SALIDA, JSON.stringify({ R, NO_MEDIDO, medidas19: MEDIDAS_19, segundos: Math.round((Date.now() - T0) / 1000) }, null, 1));
for (const x of NO_MEDIDO) console.log('NO MEDIDO:', x);
console.log(`\n[radio-func] ${Math.round((Date.now() - T0) / 1000)} s`);
console.log(`\nradio-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
process.exit(fails.length ? 1 : 0);
