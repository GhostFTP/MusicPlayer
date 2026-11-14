// dj-func.mjs — funcional del Modo DJ, sub-paso a (music-client/src/dj/DjPage.jsx + Layout + routes.js):
// la ruta /dj y la CONVIVENCIA con el reproductor normal. Todavía no hay AudioContext ni MIDI.
//   · d1  entrar a /dj (desde el menú) con música sonando deja isPlaying=false y el <audio> en pausa;
//         la barra del reproductor se oculta (display:none) y el aviso «solo escritorio» no se ve a 1280 px.
//   · d2  dentro de /dj, Espacio, ←, →, M y F (sin foco en un campo) no llaman al play() nativo, no
//         mueven el tiempo (←/→), no cambian la cola (M) ni abren pantalla completa (F).
//   · d3  salir de /dj NO reanuda: sigue en pausa, vuelve la barra y sale el aviso «Reanuda con play».
//         CONTROL: fuera de /dj, Espacio SÍ llama a play() (si no, d2 no probaría nada).
//   · d4  F5 en /dj restaura /dj; «atrás» desde /dj vuelve a la vista anterior y «adelante» a /dj;
//         ningún history.back()/go() se llama DENTRO de un popstate (regla dura #3 de nav-lab).
//   · d5  a 800 px de ancho sale «El Modo DJ es solo para escritorio».
//   · m   (sub-paso b, el motor) entrar a /dj no crea AudioContext; el primer «Cargar» crea UNO, a
//         44 100 Hz con latencyHint 'interactive' (m1d), y queda 'running'; cargar el WAV en A y en B
//         muestra la duración y el registro (bytes, ms de bajada y de decodificación, sampleRate 44 100
//         del buffer, canales, memoria) y pide /stream con Bearer, sin ?token=;
//         play/pausa/seek/al inicio mueven la posición (tolerancia TOL_S, justificada abajo); en la
//         barra de posición F y M se tapan y las flechas no; > 900 s avisa y no baja; 96 kHz avisa antes
//         de bajar; la pista más larga (≤ 900 s) a la tasa del contexto (44 100) queda bajo 400 MB y se
//         baja sin aviso de memoria (el aviso en sí lo prueba dj-unit con 96 000); 401 y HTML con 200 avisan sin tocar el deck ni dar error de página; salir de /dj
//         cierra el contexto, volver crea otro sólo al cargar, y nunca hay dos vivos.
//   · d6  con radio activa (anfitrión de una radio REAL, creada con «Iniciar radio» como radio-func) /dj
//         no pausa nada (ni isPlaying ni el pause() nativo), muestra «Sal de la radio para usar el Modo
//         DJ» y deja la barra visible; tampoco tapa teclas: Espacio llega al reproductor normal y lo
//         pausa (d6_4); no monta la consola ni construye ningún AudioContext (d6_5). Después termina la
//         radio desde la interfaz.
// El audio es el WAV sintético de tablet-util (120 s). El play()/pause() nativo y history.back/go se
// cuentan instrumentando los prototipos en la página.
//
// CONTROL NEGATIVO del sub-paso a (cuando la suite tenía 26 casos; medido el 2026-11-13 con el runner): DjPage sin el keydown de captura Y sin la
// guarda de radio → 18/26 (fallan 8; el runner no imprime cuáles). Lo esperado, SIN medir por nombre:
// d2_1..d2_4 y d2_6 (las teclas llegan al motor), d3_1 y d3_4 (queda sonando por el Espacio) y d6_2
// (pausa con radio). Además d3_4 es el control propio: fuera de /dj, Espacio SÍ llama a play().
// Uso: SNAP_BASE=http://localhost:4173 node dj-func.mjs
import { writeFileSync } from 'node:fs';
import { BASE } from '../session.mjs';
import { preparar, sleep } from './tablet-util.mjs';

const R = {};
const REG = {};   // lo que sólo se registra (no cuenta en el n/m)
const ok = (k, v, extra) => { R[k] = extra === undefined ? !!v : { ok: !!v, ...extra }; };
const esperar = async (fn, ms = 6000, paso = 150) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(paso); } return null; };

const { browser, abrir } = await preparar();
const { ctx, p, errores } = await abrir(BASE, '/', { esperar: '.player-bar' });

// AudioContext: cuenta las construcciones y cuántos quedan vivos (state distinto de 'closed'). Init
// script → vale desde la recarga de abajo y se rearma solo en cada F5 (los contadores vuelven a 0).
await ctx.addInitScript(() => {
  const AC = window.AudioContext;
  if (!AC || window.__ac) return;
  const reg = { creados: 0, lista: [], opciones: [], maxVivos: 0 };
  reg.vivos = () => reg.lista.filter((c) => c.state !== 'closed').length;
  window.__ac = reg;
  window.AudioContext = class extends AC {
    constructor(...a) { super(...a); reg.creados++; reg.lista.push(this); reg.opciones.push(a[0] === undefined ? null : JSON.parse(JSON.stringify(a[0]))); reg.maxVivos = Math.max(reg.maxVivos, reg.vivos()); }
  };
});
await p.reload(); await p.waitForSelector('.player-bar', { timeout: 15000 }).catch(() => {}); await sleep(500);
// Pedidos a /stream/ de audio (no video): URL y cabecera Authorization.
const streams = [];
p.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/stream/') && !u.pathname.startsWith('/stream/video/')) streams.push({ path: u.pathname, query: u.search, auth: r.headers().authorization ?? null }); });
const ac = () => p.evaluate(() => ({ creados: window.__ac?.creados ?? null, vivos: window.__ac?.vivos() ?? null, maxVivos: window.__ac?.maxVivos ?? null, estados: window.__ac?.lista.map((c) => c.state) ?? [] }));

// Contadores en la página. Se vuelve a llamar después de cada recarga (F5 borra la página).
const instrumentar = () => p.evaluate(() => {
  if (window.__djInstr) return;
  window.__djInstr = true;
  const M = HTMLMediaElement.prototype; const play0 = M.play; const pause0 = M.pause;
  window.__plays = 0; window.__pausas = 0;
  M.play = function (...a) { if (!(this instanceof HTMLVideoElement)) { window.__plays++; window.__el = this; } return play0.apply(this, a); };
  M.pause = function (...a) { if (!(this instanceof HTMLVideoElement)) window.__pausas++; return pause0.apply(this, a); };
  // history.back()/go() llamados DURANTE un popstate (window.event es el evento que se está despachando).
  window.__navEnPop = []; window.__navLlamadas = 0;
  for (const k of ['back', 'go']) {
    const f = history[k].bind(history);
    history[k] = (...a) => { window.__navLlamadas++; if (window.event?.type === 'popstate') window.__navEnPop.push(k); return f(...a); };
  }
});
const estado = () => p.evaluate(() => {
  const v = window.__player?.(); const el = window.__el;
  const barra = document.querySelector('.player-bar');
  const visible = (sel) => { const e = document.querySelector(sel); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0; };
  return {
    ruta: location.pathname,
    isPlaying: v?.isPlaying ?? null,
    paused: el ? el.paused : null,
    t: el ? Math.round(el.currentTime * 100) / 100 : null,
    cola: v ? v.queue.map((x) => x.id).join(',') : null,
    shuffle: v?.shuffle ?? null,
    plays: window.__plays, pausas: window.__pausas,
    barra: barra ? getComputedStyle(barra).display : 'sin-barra',
    titulo: document.querySelector('.dj-page h1')?.textContent ?? null,
    soloEscritorio: visible('.dj-solo-escritorio'),
    avisoRadio: document.querySelector('.dj-aviso-radio')?.textContent ?? null,
    activo: document.querySelector('.sidebar-nav button.active')?.textContent.trim() ?? null,
    toasts: [...document.querySelectorAll('.toast-text')].map((e) => e.textContent),
    fullscreen: !!document.fullscreenElement,
  };
});
const irA = async (nombre) => { await p.locator('.sidebar-nav button', { hasText: new RegExp(`^${nombre}$`) }).click(); await sleep(600); };
const tecla = async (k) => { await p.evaluate(() => document.activeElement?.blur()); await p.keyboard.press(k); await sleep(250); };

try {
  await instrumentar();
  const pistas = await p.evaluate(async () => {
    const r = await fetch('/api/tracks', { headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } });
    const l = await r.json(); return (Array.isArray(l) ? l : (l.tracks ?? [])).slice(0, 3);
  });
  if (pistas.length < 2) throw new Error(`la base tiene ${pistas.length} pistas`);

  // ── d1: entrar a /dj con música sonando ──
  await p.evaluate((pistas) => window.__player().play(pistas, 0), pistas);
  const sonando = await esperar(async () => { const s = await estado(); return s.isPlaying && s.paused === false && s.t > 0.3 ? s : null; });
  ok('d1_0_antes_suena', !!sonando, { antes: sonando ?? await estado() });
  const pausasAntes = (await estado()).pausas;
  await irA('Modo DJ');
  const enDj = await esperar(async () => { const s = await estado(); return s.ruta === '/dj' && s.isPlaying === false ? s : null; }, 3000) ?? await estado();
  ok('d1_1_ruta_dj_con_titulo', enDj.ruta === '/dj' && enDj.titulo === 'Modo DJ' && enDj.activo === 'Modo DJ', enDj);
  ok('d1_2_pausa_isPlaying_false', enDj.isPlaying === false && enDj.paused === true && enDj.pausas > pausasAntes, { isPlaying: enDj.isPlaying, paused: enDj.paused, pausas: enDj.pausas - pausasAntes });
  ok('d1_3_barra_oculta', enDj.barra === 'none', { barra: enDj.barra });
  ok('d1_4_sin_aviso_escritorio_a_1280', enDj.soloEscritorio === false && enDj.avisoRadio === null, { soloEscritorio: enDj.soloEscritorio, avisoRadio: enDj.avisoRadio });

  // ── d2: teclas tapadas dentro de /dj ──
  const base = await estado();
  const porTecla = {};
  for (const k of ['Space', 'ArrowRight', 'ArrowLeft', 'KeyM', 'KeyF']) {
    const a = await estado(); await tecla(k); await sleep(k === 'KeyM' ? 900 : 0); const d = await estado();
    porTecla[k] = { plays: d.plays - a.plays, t: [a.t, d.t], cola: a.cola === d.cola, shuffle: [a.shuffle, d.shuffle], isPlaying: d.isPlaying, fullscreen: d.fullscreen };
  }
  ok('d2_1_espacio_no_llama_play', porTecla.Space.plays === 0 && porTecla.Space.isPlaying === false, porTecla.Space);
  ok('d2_2_flecha_derecha_no_llama_play_ni_mueve', porTecla.ArrowRight.plays === 0 && porTecla.ArrowRight.t[0] === porTecla.ArrowRight.t[1], porTecla.ArrowRight);
  ok('d2_3_flecha_izquierda_no_llama_play_ni_mueve', porTecla.ArrowLeft.plays === 0 && porTecla.ArrowLeft.t[0] === porTecla.ArrowLeft.t[1], porTecla.ArrowLeft);
  ok('d2_4_m_no_llama_play_ni_cambia_la_cola', porTecla.KeyM.plays === 0 && porTecla.KeyM.cola && porTecla.KeyM.shuffle[0] === porTecla.KeyM.shuffle[1], porTecla.KeyM);
  ok('d2_5_f_no_llama_play_ni_pantalla_completa', porTecla.KeyF.plays === 0 && porTecla.KeyF.fullscreen === false, porTecla.KeyF);
  const tras = await estado();
  ok('d2_6_sigue_en_pausa_en_dj', tras.isPlaying === false && tras.paused === true && tras.ruta === '/dj' && tras.cola === base.cola, { isPlaying: tras.isPlaying, ruta: tras.ruta });

  // ── d3: salir de /dj no reanuda; control negativo de Espacio fuera de /dj ──
  await irA('Biblioteca');
  const fuera = await estado();
  const toast = await esperar(async () => (await estado()).toasts.includes('Reanuda con play'), 1500);
  ok('d3_1_salir_no_reanuda', fuera.ruta === '/' && fuera.isPlaying === false && fuera.paused === true, { ruta: fuera.ruta, isPlaying: fuera.isPlaying });
  ok('d3_2_vuelve_la_barra', fuera.barra !== 'none', { barra: fuera.barra });
  ok('d3_3_aviso_reanuda_con_play', !!toast, { toasts: (await estado()).toasts });
  const c0 = await estado(); await tecla('Space');
  const c1 = await esperar(async () => { const s = await estado(); return s.isPlaying ? s : null; }, 2000) ?? await estado();
  ok('d3_4_control_espacio_fuera_de_dj_si_suena', c1.plays - c0.plays >= 1 && c1.isPlaying === true, { plays: c1.plays - c0.plays, isPlaying: c1.isPlaying });
  await p.evaluate(() => window.__player().pause());
  await sleep(300);

  // ── d4: F5 en /dj, atrás y adelante; nada de history.back()/go() dentro de popstate ──
  await irA('Modo DJ');
  await p.reload(); await p.waitForSelector('.dj-page', { timeout: 15000 }).catch(() => {}); await sleep(500);
  await instrumentar();
  const f5 = await estado();
  ok('d4_1_f5_restaura_dj', f5.ruta === '/dj' && f5.titulo === 'Modo DJ' && f5.activo === 'Modo DJ', { ruta: f5.ruta, titulo: f5.titulo, activo: f5.activo });
  await p.goBack(); await sleep(700);
  const atras = await estado();
  ok('d4_2_atras_vuelve_a_la_biblioteca', atras.ruta === '/' && atras.activo === 'Biblioteca' && atras.titulo === null, { ruta: atras.ruta, activo: atras.activo });
  await p.goForward(); await sleep(700);
  const adelante = await estado();
  ok('d4_3_adelante_vuelve_a_dj', adelante.ruta === '/dj' && adelante.titulo === 'Modo DJ', { ruta: adelante.ruta, titulo: adelante.titulo });
  await irA('Ajustes'); await p.goBack(); await sleep(700);
  const atras2 = await estado();
  ok('d4_4_atras_desde_otra_vista_a_dj', atras2.ruta === '/dj' && atras2.titulo === 'Modo DJ', { ruta: atras2.ruta });
  const nav = await p.evaluate(() => ({ enPop: window.__navEnPop, llamadas: window.__navLlamadas }));
  ok('d4_5_sin_back_ni_go_dentro_de_popstate', nav.enPop.length === 0, nav);

  // ── d5: aviso «solo escritorio» por debajo de 900 px ──
  await p.setViewportSize({ width: 800, height: 800 }); await sleep(300);
  const angosto = await estado();
  ok('d5_1_aviso_solo_escritorio_a_800', angosto.soloEscritorio === true
    && await p.locator('.dj-solo-escritorio').textContent() === 'El Modo DJ es solo para escritorio', { soloEscritorio: angosto.soloEscritorio });
  await p.setViewportSize({ width: 1280, height: 800 }); await sleep(300);

  // ── m: el motor (sub-paso b). La página está en /dj, sin radio ──
  // Tolerancia de posición: TOL_S = 0,15 s por cada ~1 s medido. La sonda de Chromium sin ventana (ver
  // el reporte del sub-paso b) midió 0,97 s de reloj de audio por 1,01 s de pared: ~0,04 s de diferencia
  // en el arranque. A eso se suma que la barra se escribe en requestAnimationFrame (≤ 1 frame, 17 ms) en
  // las DOS lecturas. 0,15 s es ~3,5 veces lo medido y sigue siendo 7 veces menor que lo que avanza.
  const TOL_S = 0.15;
  const todas = await p.evaluate(async () => {
    const r = await fetch('/api/tracks?limit=100000', { headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } });
    const l = await r.json(); return Array.isArray(l) ? l : (l.tracks ?? []);
  });
  // «normales»: ≤ 500 s y < 88,2 kHz → sin aviso de 96 kHz ni de memoria.
  // «pesada»: la más larga ≤ 900 s y < 88,2 kHz → con el contexto a 44 100 Hz queda bajo 400 MB: sin aviso.
  //   (Con el contexto a 96 kHz nativo, como antes de fijar la tasa, pasaba de 400 MB y avisaba.)
  const normales = todas.filter((t) => t.duration > 0 && t.duration <= 500 && !(t.sample_rate >= 88200));
  const larga = todas.find((t) => t.duration > 900);
  const hires = todas.find((t) => t.sample_rate >= 88200 && t.duration > 0 && t.duration <= 500);
  const pesada = todas.filter((t) => t.duration > 500 && t.duration <= 900 && !(t.sample_rate >= 88200)).sort((a, b) => b.duration - a.duration)[0];
  if (normales.length < 3 || !larga || !hires || !pesada) throw new Error(`faltan pistas de prueba: normales=${normales.length} larga=${!!larga} hires=${!!hires} pesada=${!!pesada}`);
  const [n1, n2, n3] = normales;
  const sel = (lado, s) => `.dj-deck[data-lado="${lado}"] ${s}`;
  const deck = (lado) => p.evaluate(({ lado }) => {
    const d = document.querySelector(`.dj-deck[data-lado="${lado}"]`);
    if (!d) return null;
    const reg = d.querySelector('.dj-deck-registro');
    return {
      estado: d.dataset.estado,
      titulo: d.querySelector('.dj-deck-titulo')?.textContent ?? null,
      duracionTxt: d.querySelector('.dj-deck-duracion')?.textContent ?? null,
      pos: Number(d.querySelector('.dj-deck-seek')?.value),
      aviso: d.querySelector('.dj-deck-aviso p')?.textContent ?? null,
      confirmar: !!d.querySelector('.dj-confirmar'),
      registro: reg ? { ...reg.dataset } : null,
    };
  }, { lado });
  const cargarEn = async (lado, pista) => {
    await p.locator('.dj-buscar').fill(pista.title); await sleep(350);
    await p.locator(`.dj-fila[data-id="${pista.id}"] .dj-cargar-${lado.toLowerCase()}`).click();
  };
  const esperarDeck = (lado, cond, ms = 8000) => esperar(async () => { const d = await deck(lado); return d && cond(d) ? d : null; }, ms);
  // Avance de la posición en ~1 s, medido DENTRO de la página (pared con performance.now).
  const avance = (lado) => p.evaluate(async ({ lado }) => {
    const r = document.querySelector(`.dj-deck[data-lado="${lado}"] .dj-deck-seek`);
    // Dos frames antes de la 1.ª lectura: la barra la escribe el requestAnimationFrame de la página; leída
    // en el mismo frame del clic, todavía muestra el valor del frame anterior (medido: en m4 la 1.ª
    // corrida leyó 1,04 y luego 1,0507 tras pausar, 10,7 ms, menos de un frame).
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const p0 = Number(r.value), w0 = performance.now();
    await new Promise((res) => setTimeout(res, 1000));
    return { p0, p1: Number(r.value), pared: (performance.now() - w0) / 1000 };
  }, { lado });
  const fijar = (lado, v) => p.evaluate(({ lado, v }) => {
    const el = document.querySelector(`.dj-deck[data-lado="${lado}"] .dj-deck-seek`);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, { lado, v });

  await p.waitForSelector('.dj-fila', { timeout: 15000 }).catch(() => {});
  const a0 = await ac();
  ok('m0_sin_audiocontext_al_entrar', a0.creados === 0 && !!(await deck('A')) && (await deck('A')).estado === 'vacio', a0);

  // Cargar n1 en A: crea EL contexto, muestra duración (la del WAV sintético: 120 s) y el registro.
  const s0 = streams.length;
  await cargarEn('A', n1);
  const dA = await esperarDeck('A', (d) => d.estado === 'pausa');
  const a1 = await ac();
  const ctxEstado = await p.evaluate(() => window.__ac?.lista[0]?.state ?? null);
  const rg = dA?.registro;
  ok('m1_carga_a_duracion_y_registro', !!dA && dA.titulo === n1.title && dA.duracionTxt === '2:00' && rg
    && Number(rg.duracion) === 120 && Number(rg.bytes) === 1920044 && Number(rg.msBajada) >= 0 && Number(rg.msDecodificacion) >= 0
    && Number(rg.sampleRate) === 44100 && Number(rg.canales) === 1 && Number(rg.memoria) === 120 * 44100 * 4,
  { deck: dA, registro: rg });
  // El contexto se construye con sampleRate 44 100 (TASA_DJ) y latencyHint 'interactive', y da 44 100
  // (el WAV sintético es de otra tasa: el registro de m1 muestra el buffer ya remuestreado a 44 100).
  const opc = await p.evaluate(() => ({ opciones: window.__ac?.opciones[0] ?? null, tasa: window.__ac?.lista[0]?.sampleRate ?? null }));
  ok('m1d_contexto_a_44100', JSON.stringify(opc.opciones) === JSON.stringify({ sampleRate: 44100, latencyHint: 'interactive' }) && opc.tasa === 44100, opc);
  ok('m1b_un_contexto_running', a1.creados === 1 && a1.vivos === 1 && ctxEstado === 'running', { ...a1, ctxEstado });
  const pedidoA = streams.slice(s0).find((s) => s.path === `/stream/${n1.id}`);
  ok('m1c_bearer_sin_token_en_url', !!pedidoA && pedidoA.query === '' && /^Bearer \S+/.test(pedidoA.auth ?? ''), { pedido: pedidoA ? { path: pedidoA.path, query: pedidoA.query, bearer: /^Bearer /.test(pedidoA.auth ?? '') } : null });

  await cargarEn('B', n2);
  const dB = await esperarDeck('B', (d) => d.estado === 'pausa');
  const a2 = await ac();
  ok('m2_carga_b_mismo_contexto', !!dB && dB.titulo === n2.title && dB.duracionTxt === '2:00' && a2.creados === 1 && a2.vivos === 1, { titulo: dB?.titulo, ...a2 });

  // play / pausa / seek / al inicio en A
  await p.locator(sel('A', '.dj-play')).click();
  await esperarDeck('A', (d) => d.estado === 'sonando', 2000);
  const v1 = await avance('A');
  ok('m3_play_avanza', v1.p1 - v1.p0 > 0.5 && Math.abs((v1.p1 - v1.p0) - v1.pared) <= TOL_S, { ...v1, delta: v1.p1 - v1.p0 });
  await p.locator(sel('A', '.dj-play')).click();
  const pausado = await esperarDeck('A', (d) => d.estado === 'pausa', 2000);
  const v2 = await avance('A');
  ok('m4_pausa_congela', !!pausado && v2.p1 === v2.p0 && v2.p0 > 0, v2);
  await fijar('A', 60); await sleep(150);
  const sk = await deck('A');
  ok('m5_seek_en_pausa_va_a_60', Math.abs(sk.pos - 60) < 0.01 && sk.estado === 'pausa', { pos: sk.pos });
  await p.locator(sel('A', '.dj-play')).click();
  await esperarDeck('A', (d) => d.estado === 'sonando', 2000);
  const v3 = await avance('A');
  ok('m6_play_desde_60_avanza', v3.p0 >= 60 && v3.p0 < 60 + 2 * TOL_S + 0.5 && Math.abs((v3.p1 - v3.p0) - v3.pared) <= TOL_S, v3);
  await p.locator(sel('A', '.dj-inicio')).click(); await sleep(100);
  const ini = await deck('A');
  // < 0,5 s: entre el clic y la lectura pasan los 100 ms de espera más dos idas y vueltas a la página;
  // venía de ~61 s, así que sigue probando que volvió.
  ok('m7_al_inicio_vuelve_a_cero_y_sigue_sonando', ini.pos < 0.5 && ini.estado === 'sonando', { pos: ini.pos, estado: ini.estado });
  await p.locator(sel('A', '.dj-play')).click(); await esperarDeck('A', (d) => d.estado === 'pausa', 2000);

  // F con el foco en la barra de posición: se tapa (useVideoFullscreenShortcut no excluye los range);
  // las flechas NO se tapan (son del control).
  await p.evaluate(() => { window.__teclasRango = []; window.addEventListener('keydown', (e) => { if (['KeyF', 'KeyM', 'ArrowRight'].includes(e.code)) window.__teclasRango.push([e.code, e.defaultPrevented]); }); });
  await p.locator(sel('A', '.dj-deck-seek')).focus();
  for (const k of ['KeyF', 'KeyM', 'ArrowRight']) { await p.keyboard.press(k); await sleep(120); }
  const tr = await p.evaluate(() => window.__teclasRango);
  ok('m8_en_la_barra_f_y_m_tapadas_flechas_no', JSON.stringify(tr) === JSON.stringify([['KeyF', true], ['KeyM', true], ['ArrowRight', false]]), { tr });
  await p.evaluate(() => document.activeElement?.blur());

  // Más de 900 s: aviso y NO se baja nada; el deck queda como estaba.
  const s1 = streams.length;
  await cargarEn('A', larga); await sleep(400);
  const dl = await deck('A');
  ok('m9_larga_avisa_y_no_baja', /15 minutos/.test(dl.aviso ?? '') && dl.titulo === n1.title && dl.estado === 'pausa' && streams.length === s1, { aviso: dl.aviso, pedidos: streams.length - s1 });
  await p.locator(sel('A', '.dj-cancelar')).click();

  // 96 kHz: aviso ANTES de bajar; «Cancelar» no baja; «Cargar igual» carga.
  const s2 = streams.length;
  await cargarEn('B', hires); await sleep(400);
  const dh = await deck('B');
  await p.locator(sel('B', '.dj-cancelar')).click(); await sleep(200);
  const dhc = await deck('B');
  ok('m10_96k_avisa_antes_de_bajar', /kHz/.test(dh.aviso ?? '') && dh.confirmar && streams.length === s2 && dhc.aviso === null && dhc.titulo === n2.title, { aviso: dh.aviso, pedidos: streams.length - s2, despues: dhc.titulo });
  await cargarEn('B', hires); await sleep(300);
  await p.locator(sel('B', '.dj-confirmar')).click();
  const dhi = await esperarDeck('B', (d) => d.estado === 'pausa' && d.titulo === hires.title);
  ok('m11_96k_cargar_igual_carga', !!dhi && streams.slice(s2).some((s) => s.path === `/stream/${hires.id}`), { titulo: dhi?.titulo });

  // Memoria con la tasa REAL del contexto (44 100): la pista más larga ≤ 900 s queda bajo 400 MB, así que
  // NO avisa y se baja directo, sin «Cargar igual». La estimación sale de la tasa que tiene el contexto
  // de verdad, no de una constante del test.
  const tasaCtx = await p.evaluate(() => window.__ac?.lista.at(-1)?.sampleRate ?? null);
  const memEst = Math.round(pesada.duration * tasaCtx * 2 * 4);
  const s3 = streams.length;
  await cargarEn('B', pesada); await sleep(400);
  const dm = await deck('B');
  ok('m11b_memoria_a_44100_no_avisa', tasaCtx === 44100 && memEst < 400_000_000 && dm.aviso === null && !dm.confirmar,
    { tasaCtx, memEst, duracion: pesada.duration, aviso: dm.aviso, confirmar: dm.confirmar });
  const dmi = await esperarDeck('B', (d) => d.estado === 'pausa' && d.titulo === pesada.title);
  ok('m11c_pesada_se_baja_directo', !!dmi && streams.slice(s3).filter((s) => s.path === `/stream/${pesada.id}`).length === 1, { titulo: dmi?.titulo, registro: dmi?.registro });

  // 401 y HTML con 200: aviso en pantalla, deck A intacto, sin errores de página.
  const errAntes = errores.length;
  const regA = (await deck('A')).registro;
  for (const [nombre, resp, patron] of [
    ['m12_401_avisa_y_deck_intacto', { status: 401, contentType: 'application/json', body: '{"error":"Unauthorized"}' }, /sesión/],
    ['m13_html_200_avisa_y_deck_intacto', { status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>Sign in</title><p>Cloudflare Access</p>' }, /página/],
  ]) {
    await p.route('**/stream/**', (r) => r.fulfill(resp));
    await cargarEn('A', n3);
    const da = await esperarDeck('A', (d) => d.estado !== 'cargando' && !!d.aviso, 5000) ?? await deck('A');
    ok(nombre, patron.test(da.aviso ?? '') && da.titulo === n1.title && da.estado === 'pausa' && JSON.stringify(da.registro) === JSON.stringify(regA) && errores.length === errAntes,
      { aviso: da.aviso, titulo: da.titulo, estado: da.estado, errores: errores.slice(errAntes) });
    await p.unroute('**/stream/**');
    await p.locator(sel('A', '.dj-cancelar')).click().catch(() => {});
  }

  // Salir de /dj cierra el contexto; volver no crea uno hasta cargar; nunca hay dos vivos.
  await p.locator('.dj-buscar').fill('');
  await irA('Biblioteca'); await sleep(400);
  const fuera2 = await ac();
  ok('m14_salir_cierra_el_contexto', fuera2.creados === 1 && fuera2.vivos === 0 && fuera2.estados.every((s) => s === 'closed'), fuera2);
  await irA('Modo DJ'); await p.waitForSelector('.dj-fila', { timeout: 15000 }).catch(() => {}); await sleep(300);
  const vuelta0 = await ac();
  await cargarEn('A', n1);
  const dv = await esperarDeck('A', (d) => d.estado === 'pausa');
  const vuelta1 = await ac();
  const tasa2 = await p.evaluate(() => ({ opciones: window.__ac?.opciones[1] ?? null, tasa: window.__ac?.lista[1]?.sampleRate ?? null }));
  ok('m15_volver_crea_uno_nuevo_al_cargar', vuelta0.creados === 1 && vuelta0.vivos === 0 && !!dv && vuelta1.creados === 2 && vuelta1.vivos === 1
    && tasa2.opciones?.sampleRate === 44100 && tasa2.tasa === 44100, { vuelta0, vuelta1, tasa2 });
  ok('m16_nunca_dos_contextos_vivos', vuelta1.maxVivos === 1, { maxVivos: vuelta1.maxVivos });
  await p.locator('.dj-buscar').fill('');

  // ── d6: con radio activa /dj no pausa nada ──
  await p.evaluate((pistas) => window.__player().play(pistas, 1), pistas);
  await esperar(async () => (await estado()).isPlaying, 4000);
  await irA('Radio');
  await p.locator('.main-content .radio-btn', { hasText: 'Iniciar radio' }).click();
  const anfitrion = await esperar(() => p.evaluate(() => !!document.querySelector('.radio-terminar')), 6000);
  ok('d6_0_radio_iniciada', !!anfitrion);
  if (anfitrion) {
    const r0 = await estado();
    const acR0 = await ac();
    await irA('Modo DJ'); await sleep(700);
    const r1 = await estado();
    const acR1 = await ac();
    const decksConRadio = await p.locator('.dj-deck').count();
    ok('d6_1_aviso_sal_de_la_radio', r1.ruta === '/dj' && r1.avisoRadio === 'Sal de la radio para usar el Modo DJ', { ruta: r1.ruta, avisoRadio: r1.avisoRadio });
    ok('d6_2_no_pausa', r0.isPlaying === true && r1.isPlaying === true && r1.paused === false && r1.pausas === r0.pausas, { antes: r0.isPlaying, despues: r1.isPlaying, pausas: r1.pausas - r0.pausas });
    ok('d6_3_barra_visible', r1.barra !== 'none', { barra: r1.barra });
    // Sub-paso b: con radio NO se monta la consola y no se construye ningún AudioContext.
    ok('d6_5_con_radio_sin_consola_ni_audiocontext', acR1.creados === acR0.creados && acR1.vivos === 0 && decksConRadio === 0, { antes: acR0.creados, despues: acR1.creados, vivos: acR1.vivos, decks: decksConRadio });
    // d6_4: con radio el Modo DJ tampoco tapa teclas. Calca d3_4 al revés (suena → Espacio → pausa):
    // el Espacio llega al atajo de PlayerContext, que llama al pause() nativo y deja isPlaying=false.
    const k0 = await estado(); await tecla('Space');
    const k1 = await esperar(async () => { const s = await estado(); return s.isPlaying === false ? s : null; }, 2000) ?? await estado();
    ok('d6_4_con_radio_espacio_llega_al_reproductor', k0.isPlaying === true && k1.pausas - k0.pausas >= 1 && k1.isPlaying === false && k1.ruta === '/dj', { antes: k0.isPlaying, despues: k1.isPlaying, pausas: k1.pausas - k0.pausas, ruta: k1.ruta });
    await irA('Radio');
    await p.getByRole('button', { name: 'Terminar radio' }).click(); await sleep(250);
    await p.getByRole('button', { name: 'Sí, terminar' }).click();
    const fin = await esperar(() => p.evaluate(() => !document.querySelector('.radio-terminar')), 6000);
    REG.radio_terminada = !!fin;
  }
  await p.evaluate(() => window.__player()?.pause());
  ok('d7_sin_errores_de_pagina', errores.length === 0, { errores });
} catch (e) {
  ok('excepcion', false, { error: String(e.message).split('\n')[0].slice(0, 200) });
}

const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
console.log('registro (fuera del conteo):', JSON.stringify(REG, null, 1));
console.log(`\ndj-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
// El runner sólo imprime el conteo. Con DJ_FUNC_SALIDA=<archivo> en el entorno (el runner lo hereda),
// el resultado completo (casos con su detalle y el registro) queda en ese archivo. Sin la variable, nada.
if (process.env.DJ_FUNC_SALIDA) writeFileSync(process.env.DJ_FUNC_SALIDA, JSON.stringify({ fallan: fails.map(([k]) => k), R, REG }, null, 1));
await browser.close();
process.exit(fails.length ? 1 : 0);
