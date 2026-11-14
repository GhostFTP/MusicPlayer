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
//   · x   (sub-paso c, la mezcla con ratón) mover la mezcla antes de «Cargar» no crea AudioContext y
//         esos valores son los iniciales de los nodos; grafo vol → xf → bus → lowpass → highpass →
//         master por deck; cada control llega a SU AudioParam tras ≥ 0,12 s de currentTime (volumen
//         v², crossfader de igual potencia en 5 posiciones, frecuencia de cada biquad); 0 escrituras
//         directas de .value y 0 cambios de .type mientras se mueve, con setTargetAtTime; doble clic al
//         valor por defecto; sobreviven a play, seek y cargar otra pista; F y M tapadas en sus range.
//   · k   (sub-paso d, el DDJ-400 por Web MIDI, con un requestMIDIAccess FALSO del init script) el permiso
//         se pide con el clic (k0); cada control llega a su AudioParam y la UI lo sigue (k1); 14 bits y el
//         centro del filtro en la zona muerta (k2); duplicados sin rampas extra (k3); 0 escrituras de .value
//         (k4); desconexión y reconexión (k5); salir y volver no duplica oyentes (k6); UI agrupada por cuadro
//         (k10); al final, con recargas: sin Web MIDI (k7), permiso denegado (k8), ?diag=1 (k9, k9b).
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
  // Mezcla (sub-paso c): conexiones entre nodos, escrituras DIRECTAS de AudioParam.value, llamadas a
  // setTargetAtTime y cambios de BiquadFilterNode.type. Los getters quedan nativos (leer .value da el
  // valor que el AudioParam tiene en ese momento, con la rampa aplicada).
  reg.aristas = []; reg.escrituras = 0; reg.rampas = 0; reg.tipos = 0; reg.volA = null;
  const con = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (d, ...r) { reg.aristas.push([this, d]); return con.call(this, d, ...r); };
  const dv = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'value');
  Object.defineProperty(AudioParam.prototype, 'value', { configurable: true, enumerable: dv.enumerable, get: dv.get, set(v) { reg.escrituras++; dv.set.call(this, v); } });
  const sta = AudioParam.prototype.setTargetAtTime;
  AudioParam.prototype.setTargetAtTime = function (...a) { reg.rampas++; return sta.apply(this, a); };
  const dt = Object.getOwnPropertyDescriptor(BiquadFilterNode.prototype, 'type');
  Object.defineProperty(BiquadFilterNode.prototype, 'type', { configurable: true, enumerable: dt.enumerable, get: dt.get, set(v) { reg.tipos++; dt.set.call(this, v); } });
  // El grafo del contexto vivo por TOPOLOGÍA, no por orden de creación. volA = el nodo al que se conectó
  // la fuente del deck A (marcarA, llamado justo después del play de A); volB = el otro vol.
  reg.marcarA = () => {
    const c = reg.lista.at(-1);
    const f = reg.aristas.filter(([s]) => s instanceof AudioBufferSourceNode && s.context === c).at(-1);
    reg.volA = f ? f[1] : null;
    return !!reg.volA;
  };
  reg.grafo = () => {
    const c = reg.lista.at(-1);
    if (!c) return null;
    const ar = reg.aristas.filter(([s]) => s.context === c && !(s instanceof AudioBufferSourceNode));
    const entra = (n) => [...new Set(ar.filter(([, d]) => d === n).map(([s]) => s))];
    const uno = (n) => (n ? entra(n)[0] ?? null : null);
    const master = uno(c.destination), hp = uno(master), lp = uno(hp), bus = uno(lp);
    const xfs = bus ? entra(bus) : [];
    const vols = xfs.map((x) => uno(x));
    const iA = reg.volA ? vols.indexOf(reg.volA) : -1;
    const iB = iA < 0 ? -1 : 1 - iA;
    const nombre = (n) => (n instanceof BiquadFilterNode ? `BiquadFilterNode:${n.type}` : n.constructor.name);
    const cadena = (n) => { const out = []; for (let x = n, i = 0; x && i < 12; i++) { out.push(nombre(x)); x = ar.find(([s]) => s === x)?.[1] ?? null; } return out.join(' → '); };
    return { c, master, hp, lp, bus, nXf: xfs.length, volA: iA < 0 ? null : vols[iA], volB: vols[iB] ?? null, xfA: xfs[iA] ?? null, xfB: xfs[iB] ?? null, cadena };
  };
  reg.leer = () => {
    const g = reg.grafo();
    if (!g || !g.volA || !g.volB || !g.lp || !g.hp) return null;
    return {
      t: g.c.currentTime, volA: g.volA.gain.value, volB: g.volB.gain.value, xfA: g.xfA.gain.value, xfB: g.xfB.gain.value,
      lp: g.lp.frequency.value, hp: g.hp.frequency.value, lpTipo: g.lp.type, hpTipo: g.hp.type, lpQ: g.lp.Q.value, hpQ: g.hp.Q.value,
    };
  };
});
// Web MIDI FALSO (sub-paso d): navigator.requestMIDIAccess y navigator.permissions.query({ name: 'midi' })
// con dos entradas, «Teclado MIDI» y «DDJ-400»; el test dispara los mensajes del DDJ-400 con
// window.__fm.enviar. Cuenta los oyentes REALES de cada entrada y del acceso (Set de funciones). Siempre
// devuelve EL MISMO acceso y las mismas entradas: un oyente que no se quitó al desmontar se acumula y se ve.
// Configuración por página en sessionStorage '__fmCfg': { soporte: false } quita Web MIDI;
// { permiso: 'denied' | 'granted' } fija el permiso inicial (por defecto 'prompt').
await ctx.addInitScript(() => {
  if (window.__fm) return;
  let cfg = {};
  try { cfg = JSON.parse(sessionStorage.getItem('__fmCfg') || '{}') || {}; } catch { cfg = {}; }
  const fm = { pedidos: [], permiso: cfg.permiso ?? 'prompt', enviados: 0 };
  window.__fm = fm;
  if (cfg.soporte === false) {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    return;
  }
  const crearPuerto = (id, name) => {
    const t = new EventTarget();
    const oy = new Set();
    const p = {
      id, name, manufacturer: 'Pioneer DJ', type: 'input', state: 'connected', connection: 'closed', onmidimessage: null,
      addEventListener(tipo, fn, o) { if (tipo === 'midimessage') oy.add(fn); t.addEventListener(tipo, fn, o); },
      removeEventListener(tipo, fn, o) { if (tipo === 'midimessage') oy.delete(fn); t.removeEventListener(tipo, fn, o); },
      open() { p.connection = 'open'; return Promise.resolve(p); },
      close() { p.connection = 'closed'; return Promise.resolve(p); },
      get oyentes() { return oy.size; },
      enviar(bytes) {
        if (p.state !== 'connected') return;
        const ev = new Event('midimessage');   // su timeStamp es el instante de creación, como el de un MIDIMessageEvent
        Object.defineProperty(ev, 'data', { value: Uint8Array.from(bytes) });
        fm.enviados++;
        t.dispatchEvent(ev);
      },
    };
    return p;
  };
  const otro = crearPuerto('in-otro', 'Teclado MIDI');
  const ddj = crearPuerto('in-ddj', 'DDJ-400');
  const oyEstado = new Set();
  const acceso = {
    inputs: new Map([[otro.id, otro], [ddj.id, ddj]]), outputs: new Map(), sysexEnabled: false, onstatechange: null,
    addEventListener(tipo, fn) { if (tipo === 'statechange') oyEstado.add(fn); },
    removeEventListener(tipo, fn) { if (tipo === 'statechange') oyEstado.delete(fn); },
  };
  const cambio = (port) => { for (const fn of [...oyEstado]) fn({ port }); };
  fm.oyentes = () => ({ ddj: ddj.oyentes, otro: otro.oyentes, estado: oyEstado.size });
  fm.desconectar = () => { ddj.state = 'disconnected'; cambio(ddj); };
  fm.reconectar = () => { ddj.state = 'connected'; cambio(ddj); };
  fm.enviar = (lista) => { for (const b of lista) ddj.enviar(b); };
  // Cada mensaje en SU tarea (como llegan del driver), todos programados de una vez.
  fm.enviarEnTareas = (lista) => new Promise((res) => { let k = 0; for (const b of lista) setTimeout(() => { ddj.enviar(b); if (++k === lista.length) res(); }, 0); });
  Object.defineProperty(navigator, 'requestMIDIAccess', {
    configurable: true,
    value: (op) => {
      fm.pedidos.push(op ?? null);
      if (fm.permiso === 'denied') return Promise.reject(new DOMException('Permiso denegado', 'NotAllowedError'));
      fm.permiso = 'granted';
      return Promise.resolve(acceso);
    },
  });
  if (navigator.permissions) {
    const q0 = navigator.permissions.query.bind(navigator.permissions);
    Object.defineProperty(navigator.permissions, 'query', { configurable: true, value: (d) => (d?.name === 'midi' ? Promise.resolve({ state: fm.permiso, onchange: null }) : q0(d)) });
  }
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

  // ── Mezcla (sub-paso c): helpers ──
  // Los valores esperados se calculan ACÁ, con la fórmula escrita aparte (no importando mezcla.js): si la
  // curva del código se rompe, el test no se rompe con ella.
  const LADOS_X = ['A', 'B'];
  const MZ = { 'vol-a': '.dj-vol-a input', 'vol-b': '.dj-vol-b input', xf: '.dj-crossfader input', fil: '.dj-filtro input' };
  const lpEsperada = (f) => (f < -0.04 ? 20000 * Math.pow(60 / 20000, Math.min(1, (-f / 2 - 0.02) / 0.48)) : 20000);
  const hpEsperada = (f) => (f > 0.04 ? 20 * Math.pow(12000 / 20, Math.min(1, (f / 2 - 0.02) / 0.48)) : 20);
  const cercaAbs = (a, b, tol = 1e-3) => typeof a === 'number' && Math.abs(a - b) <= tol;
  const cercaRel = (a, b, tol = 1e-3) => typeof a === 'number' && Math.abs(a - b) <= tol * Math.abs(b);
  const moverMezcla = (cual, v) => p.evaluate(({ s, v }) => {
    const el = document.querySelector(s);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, { s: MZ[cual], v });
  const valoresUi = () => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.dj-control')].map((c) => [c.classList[1], Number(c.querySelector('.dj-control-valor')?.dataset.valor)])));
  // Espera ≥ 0,12 s de reloj de AUDIO (currentTime) después del último cambio: 12·TAU, el AudioParam está a
  // e^−12 ≈ 6e-6 del objetivo. Después lee los AudioParam reales del grafo.
  const asentarYLeer = () => p.evaluate(async () => {
    const c = window.__ac.lista.at(-1);
    const t0 = c.currentTime, w0 = performance.now();
    while (c.currentTime < t0 + 0.12 && performance.now() - w0 < 3000) await new Promise((r) => setTimeout(r, 20));
    return { ...window.__ac.leer(), espera: c.currentTime - t0 };
  });
  const contadores = () => p.evaluate(() => ({ escrituras: window.__ac.escrituras, rampas: window.__ac.rampas, tipos: window.__ac.tipos }));

  await p.waitForSelector('.dj-fila', { timeout: 15000 }).catch(() => {});
  const a0 = await ac();
  ok('m0_sin_audiocontext_al_entrar', a0.creados === 0 && !!(await deck('A')) && (await deck('A')).estado === 'vacio', a0);

  // x0: mover la mezcla ANTES del primer «Cargar» sólo guarda el valor: no crea AudioContext ni da error.
  // (x1 comprueba que esos valores son los iniciales de los nodos al crearse el contexto.)
  const errX0 = errores.length;
  await moverMezcla('vol-a', 0.8); await moverMezcla('fil', -0.5); await sleep(200);
  const ax0 = await ac(), ux0 = await valoresUi();
  ok('x0_mezcla_antes_de_cargar_no_crea_contexto', ax0.creados === 0 && ux0['dj-vol-a'] === 0.8 && ux0['dj-filtro'] === -0.5 && errores.length === errX0,
    { creados: ax0.creados, ui: ux0, errores: errores.slice(errX0) });


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
  // x1: con A sonando se identifica su vol (la fuente de A se conecta a él). Los valores de x0 son los
  // INICIALES de los nodos (nadie movió la mezcla desde que se creó el contexto).
  const marcado = await p.evaluate(() => window.__ac.marcarA());
  const iniX1 = await p.evaluate(() => window.__ac.leer());
  ok('x1_valores_previos_son_iniciales_al_crear', marcado && !!iniX1 && cercaAbs(iniX1.volA, 0.64, 1e-6) && cercaAbs(iniX1.volB, 1, 1e-6)
    && cercaAbs(iniX1.xfA, Math.SQRT1_2, 1e-6) && cercaAbs(iniX1.xfB, Math.SQRT1_2, 1e-6) && cercaRel(iniX1.lp, lpEsperada(-0.5), 1e-4) && cercaAbs(iniX1.hp, 20, 1e-4)
    && iniX1.lpTipo === 'lowpass' && iniX1.hpTipo === 'highpass', { marcado, iniX1, lpEsperada: lpEsperada(-0.5) });
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

  // ── x: la mezcla con el contexto vivo (A en pausa, B con n2) ──
  // x2: el grafo por deck: vol → xf → bus → lowpass → highpass → master → destination; un xf por deck.
  const gr = await p.evaluate(() => { const g = window.__ac.grafo(); return g && { A: g.volA && g.cadena(g.volA), B: g.volB && g.cadena(g.volB), nXf: g.nXf, distintos: g.xfA !== g.xfB && g.volA !== g.volB }; });
  const cadenaEsperada = 'GainNode → GainNode → GainNode → BiquadFilterNode:lowpass → BiquadFilterNode:highpass → GainNode → AudioDestinationNode';
  ok('x2_grafo_vol_xf_bus_lp_hp_master', !!gr && gr.A === cadenaEsperada && gr.B === cadenaEsperada && gr.nXf === 2 && gr.distintos, gr);

  // Las lecturas van con los DOS decks sonando: Chromium sólo actualiza el .value de un AudioParam cuando
  // procesa su nodo, y un GainNode sin audio que le llegue (deck en pausa) no se procesa: su .value se queda
  // en el último valor calculado aunque la rampa ya esté programada (medido: en la 1.ª corrida, con A en
  // pausa, volA y xfA seguían en su valor inicial y volB, xfB y los filtros sí cambiaban).
  const tocarAmbos = async (sonar) => { for (const lado of LADOS_X) { const d = await deck(lado); if ((d.estado === 'sonando') !== sonar) { await p.locator(sel(lado, '.dj-play')).click(); await esperarDeck(lado, (x) => x.estado === (sonar ? 'sonando' : 'pausa'), 2000); } } };
  await tocarAmbos(true);
  // x3..x6 en una ventana: se cuentan las escrituras directas de .value, las rampas y los cambios de .type.
  const kx0 = await contadores();
  await moverMezcla('vol-a', 0.5);
  const lx3 = await asentarYLeer(), ux3 = await valoresUi();
  ok('x3_volumen_a_llega_a_su_gain', cercaAbs(lx3.volA, 0.25) && cercaAbs(lx3.volB, 1) && ux3['dj-vol-a'] === 0.5, { leido: lx3, ui: ux3['dj-vol-a'] });
  await moverMezcla('vol-b', 0.3);
  const lx4 = await asentarYLeer(), ux4 = await valoresUi();
  ok('x4_volumen_b_llega_a_su_gain', cercaAbs(lx4.volB, 0.09) && cercaAbs(lx4.volA, 0.25) && ux4['dj-vol-b'] === 0.3, { leido: lx4, ui: ux4['dj-vol-b'] });
  const xs = [];
  for (const x of [0, 0.25, 0.5, 0.75, 1]) {
    await moverMezcla('xf', x);
    const l = await asentarYLeer();
    xs.push({ x, a: l.xfA, b: l.xfB, potencia: l.xfA * l.xfA + l.xfB * l.xfB, ui: (await valoresUi())['dj-crossfader'] });
  }
  ok('x5_crossfader_igual_potencia_5_posiciones', xs.every((r) => cercaAbs(r.potencia, 1, 2e-3) && cercaAbs(r.a, Math.cos(r.x * Math.PI / 2)) && cercaAbs(r.b, Math.sin(r.x * Math.PI / 2)) && r.ui === r.x), { xs });
  const filtrosX6 = [];
  for (const f of [-1, -0.5, -0.03, 0.5, 1, 0]) {
    await moverMezcla('fil', f);
    const l = await asentarYLeer();
    filtrosX6.push({ f, lp: l.lp, hp: l.hp, lpEsp: lpEsperada(f), hpEsp: hpEsperada(f), tipos: [l.lpTipo, l.hpTipo] });
  }
  const extremosFiltro = await p.evaluate(() => [...document.querySelectorAll('.dj-filtro .dj-control-extremos span')].map((s) => s.textContent));
  ok('x6_filtro_mueve_la_frecuencia_de_cada_biquad', filtrosX6.every((r) => cercaRel(r.lp, r.lpEsp) && cercaRel(r.hp, r.hpEsp) && r.tipos[0] === 'lowpass' && r.tipos[1] === 'highpass')
    && JSON.stringify(extremosFiltro) === JSON.stringify(['Paso bajo', 'Paso alto']), { filtros: filtrosX6, extremosFiltro });
  const kx1 = await contadores();
  // 2 (vol) + 5×2 (crossfader) + 6×2 (filtro) = 24 rampas como mínimo.
  ok('x7_sin_escrituras_directas_y_con_setTargetAtTime', kx1.escrituras - kx0.escrituras === 0 && kx1.rampas - kx0.rampas >= 24 && kx1.tipos - kx0.tipos === 0,
    { escrituras: kx1.escrituras - kx0.escrituras, rampas: kx1.rampas - kx0.rampas, tipos: kx1.tipos - kx0.tipos });

  // x8: doble clic vuelve al valor por defecto (vol 1, crossfader 0,5, filtro 0).
  await moverMezcla('vol-a', 0.3); await moverMezcla('vol-b', 0.2); await moverMezcla('xf', 0.9); await moverMezcla('fil', 0.7);
  for (const s of Object.values(MZ)) await p.locator(s).dispatchEvent('dblclick');
  const lx8 = await asentarYLeer(), ux8 = await valoresUi();
  ok('x8_doble_clic_vuelve_al_valor_por_defecto', cercaAbs(lx8.volA, 1) && cercaAbs(lx8.volB, 1) && cercaAbs(lx8.xfA, Math.SQRT1_2) && cercaAbs(lx8.xfB, Math.SQRT1_2)
    && cercaRel(lx8.lp, 20000) && cercaRel(lx8.hp, 20) && ux8['dj-vol-a'] === 1 && ux8['dj-vol-b'] === 1 && ux8['dj-crossfader'] === 0.5 && ux8['dj-filtro'] === 0, { leido: lx8, ui: ux8 });

  // x10: en un control de la mezcla (range), F y M se tapan y las flechas no (como en la barra de posición).
  await p.evaluate(() => { window.__teclasRango = []; });
  await p.locator(MZ.xf).focus();
  for (const k of ['KeyF', 'KeyM', 'ArrowRight']) { await p.keyboard.press(k); await sleep(120); }
  const trx = await p.evaluate(() => window.__teclasRango);
  ok('x10_en_la_mezcla_f_y_m_tapadas_flechas_no', JSON.stringify(trx) === JSON.stringify([['KeyF', true], ['KeyM', true], ['ArrowRight', false]]), { trx });
  await p.evaluate(() => document.activeElement?.blur());
  await moverMezcla('xf', 0.5);
  await tocarAmbos(false);

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

  // x9: los valores de la mezcla sobreviven a play, seek y cargar otra pista (los nodos no se recrean).
  // Con los dos decks sonando (ver tocarAmbos); cargar otra pista en B la deja en pausa, con su gain ya aplicado.
  await tocarAmbos(true);
  await moverMezcla('vol-a', 0.5); await moverMezcla('vol-b', 0.3); await moverMezcla('xf', 0.25); await moverMezcla('fil', 0.4);
  const antesX9 = await asentarYLeer();
  await fijar('A', 30); await sleep(150);
  await cargarEn('B', n3);
  const dx9 = await esperarDeck('B', (d) => d.estado === 'pausa' && d.titulo === n3.title);
  const despuesX9 = await asentarYLeer(), ux9 = await valoresUi();
  const esperadoX9 = { volA: 0.25, volB: 0.09, xfA: Math.cos(0.25 * Math.PI / 2), xfB: Math.sin(0.25 * Math.PI / 2), lp: 20000, hp: hpEsperada(0.4) };
  const igualX9 = (l) => cercaAbs(l.volA, esperadoX9.volA) && cercaAbs(l.volB, esperadoX9.volB) && cercaAbs(l.xfA, esperadoX9.xfA) && cercaAbs(l.xfB, esperadoX9.xfB) && cercaRel(l.lp, esperadoX9.lp) && cercaRel(l.hp, esperadoX9.hp);
  ok('x9_mezcla_sobrevive_play_seek_cargar', igualX9(antesX9) && igualX9(despuesX9) && !!dx9
    && ux9['dj-vol-a'] === 0.5 && ux9['dj-vol-b'] === 0.3 && ux9['dj-crossfader'] === 0.25 && ux9['dj-filtro'] === 0.4,
  { antes: antesX9, despues: despuesX9, esperado: esperadoX9, ui: ux9, b: dx9?.titulo });
  await p.locator(sel('A', '.dj-play')).click(); await esperarDeck('A', (d) => d.estado === 'pausa', 2000);

  // ── k: el DDJ-400 por Web MIDI (sub-paso d), con el requestMIDIAccess FALSO del init script ──
  // Mensajes: MSB en cc N, LSB en cc N + 32. par(status, N, v14) → [MSB, LSB].
  const par = (st, n, v14) => [[st, n, v14 >> 7], [st, n + 32, v14 & 127]];
  const MIDI = { volA: [0xb0, 19], volB: [0xb1, 19], xf: [0xb6, 31], fil: [0xb6, 23] };
  const midi = (cual, v14) => par(MIDI[cual][0], MIDI[cual][1], v14);
  const enviarMidi = (lista) => p.evaluate((l) => window.__fm.enviar(l), lista);
  const oyentesMidi = () => p.evaluate(() => window.__fm.oyentes());
  const textoMidi = () => p.evaluate(() => ({ estado: document.querySelector('.dj-midi')?.dataset.estado ?? null, texto: document.querySelector('.dj-midi-estado')?.textContent ?? null, boton: !!document.querySelector('.dj-midi-conectar') }));
  const esperarMidi = (estadoQuerido, ms = 4000) => esperar(async () => { const t = await textoMidi(); return t.estado === estadoQuerido ? t : null; }, ms);
  const dosCuadros = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const pos14 = (v) => v / 16383;

  // k0: el permiso se pide con el clic, no al cargar: hasta acá, 0 pedidos. Clic → requestMIDIAccess({ sysex: false })
  // una vez, entrada «DDJ-400» (no la otra), un oyente en ella y uno de statechange en el acceso.
  const k0antes = await p.evaluate(() => window.__fm.pedidos.length);
  const t0 = await textoMidi();
  await p.locator('.dj-midi-conectar').click();
  const tk0 = await esperarMidi('conectado');
  const pedidos = await p.evaluate(() => window.__fm.pedidos);
  const oy0 = await oyentesMidi();
  ok('k0_conectar_pide_permiso_al_clic', k0antes === 0 && t0.boton && t0.estado === 'inactivo' && pedidos.length === 1 && JSON.stringify(pedidos[0]) === JSON.stringify({ sysex: false })
    && tk0?.texto === 'Conectado: DDJ-400' && !tk0.boton && oy0.ddj === 1 && oy0.otro === 0 && oy0.estado === 1, { antes: k0antes, t0, tk0, pedidos, oy0 });

  // k1..k3 con los dos decks sonando (el .value de un AudioParam no se actualiza sin audio, ver x).
  await tocarAmbos(true);
  const kk0 = await contadores();
  // k1: cada control llega a SU AudioParam, y la UI lo sigue (data-valor = la posición exacta).
  await enviarMidi([...midi('volA', 12000), ...midi('volB', 4000), ...midi('xf', 3000), ...midi('fil', 13000)]);
  const lk1 = await asentarYLeer(); await dosCuadros(); const uk1 = await valoresUi();
  await enviarMidi(midi('fil', 2000));
  const lk1b = await asentarYLeer(); await dosCuadros(); const uk1b = await valoresUi();
  const fA = 2 * pos14(13000) - 1, fB = 2 * pos14(2000) - 1;
  ok('k1_cada_control_llega_a_su_audioparam', cercaAbs(lk1.volA, pos14(12000) ** 2) && cercaAbs(lk1.volB, pos14(4000) ** 2)
    && cercaAbs(lk1.xfA, Math.cos(pos14(3000) * Math.PI / 2)) && cercaAbs(lk1.xfB, Math.sin(pos14(3000) * Math.PI / 2))
    && cercaRel(lk1.hp, hpEsperada(fA)) && cercaRel(lk1.lp, 20000) && cercaRel(lk1b.lp, lpEsperada(fB)) && cercaRel(lk1b.hp, 20)
    && uk1['dj-vol-a'] === pos14(12000) && uk1['dj-vol-b'] === pos14(4000) && uk1['dj-crossfader'] === pos14(3000) && cercaAbs(uk1['dj-filtro'], fA, 1e-12) && cercaAbs(uk1b['dj-filtro'], fB, 1e-12),
  { lk1, lk1b, uk1, uk1b, esperado: { volA: pos14(12000) ** 2, volB: pos14(4000) ** 2, hp: hpEsperada(fA), lp: lpEsperada(fB) } });
  // k2: los 14 bits: 0 → 0, 16383 → 1, (100 << 7 | 50) = 12850; el centro 8192 del crossfader = 0,50003 y
  // el del filtro cae en la zona muerta (lp 20 000, hp 20).
  const v = [];
  for (const [cual, v14] of [['volA', 0], ['volA', 16383], ['volA', 12850]]) { await enviarMidi(midi(cual, v14)); await dosCuadros(); v.push((await valoresUi())['dj-vol-a']); }
  await enviarMidi([...midi('xf', 8192), ...midi('fil', 8192)]);
  const lk2 = await asentarYLeer(); await dosCuadros(); const uk2 = await valoresUi();
  ok('k2_14_bits_y_centro_del_filtro_en_zona_muerta', v[0] === 0 && v[1] === 1 && v[2] === pos14(12850) && uk2['dj-crossfader'] === pos14(8192)
    && Math.abs(uk2['dj-crossfader'] - 0.50003) < 1e-5 && cercaAbs(uk2['dj-filtro'], 2 * pos14(8192) - 1, 1e-12) && cercaRel(lk2.lp, 20000) && cercaRel(lk2.hp, 20)
    && cercaAbs(lk2.volA, pos14(12850) ** 2) && cercaAbs(lk2.xfA, Math.cos(pos14(8192) * Math.PI / 2)), { v, uk2, lk2 });
  // k3: duplicados: MSB, MSB, LSB, LSB idénticos de a pares → 2 setTargetAtTime (uno por valor nuevo), no 4.
  const r3a = (await contadores()).rampas;
  await enviarMidi([[0xb0, 19, 90], [0xb0, 19, 90], [0xb0, 51, 33], [0xb0, 51, 33]]);
  const r3b = (await contadores()).rampas;
  const lk3 = await asentarYLeer();
  ok('k3_duplicados_no_generan_rampas_extra', r3b - r3a === 2 && cercaAbs(lk3.volA, pos14(90 * 128 + 33) ** 2), { rampas: r3b - r3a, volA: lk3.volA });
  // k4: durante todo k1..k3, 0 escrituras directas de .value y 0 cambios de .type; sí setTargetAtTime.
  const kk1 = await contadores();
  ok('k4_midi_sin_escrituras_directas_con_setTargetAtTime', kk1.escrituras - kk0.escrituras === 0 && kk1.tipos - kk0.tipos === 0 && kk1.rampas - kk0.rampas >= 20,
    { escrituras: kk1.escrituras - kk0.escrituras, tipos: kk1.tipos - kk0.tipos, rampas: kk1.rampas - kk0.rampas });

  // k10: avisos agrupados por cuadro: 60 mensajes, cada uno en su tarea → la UI cambia a lo sumo un par de
  // veces (no 60) y termina en el último valor.
  await enviarMidi([[0xb0, 19, 50]]);
  await dosCuadros();
  const k10 = await p.evaluate(async () => {
    const el = document.querySelector('.dj-vol-a .dj-control-valor');
    let cambios = 0;
    const mo = new MutationObserver((rs) => { cambios += rs.length ? 1 : 0; });
    mo.observe(el, { attributes: true, attributeFilter: ['data-valor'] });
    await window.__fm.enviarEnTareas(Array.from({ length: 60 }, (_, i) => [0xb0, 51, i + 1]));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
    mo.disconnect();
    return { cambios, final: Number(el.dataset.valor) };
  });
  ok('k10_ui_agrupada_por_cuadro', k10.cambios >= 1 && k10.cambios <= 4 && k10.final === pos14(50 * 128 + 60), k10);

  // k5: desconexión (statechange) → «desconectado», sin oyente, y un mensaje no mueve nada; vuelve → reconecta.
  await p.evaluate(() => window.__fm.desconectar());
  const tk5 = await esperarMidi('desconectado');
  const oy5 = await oyentesMidi();
  const r5a = (await contadores()).rampas;
  await enviarMidi(midi('volA', 1000));
  const r5b = (await contadores()).rampas;
  await p.evaluate(() => window.__fm.reconectar());
  const tk5b = await esperarMidi('conectado');
  const oy5b = await oyentesMidi();
  await enviarMidi(midi('volA', 6000));
  const lk5 = await asentarYLeer();
  ok('k5_desconecta_y_reconecta', tk5?.texto === 'DDJ-400 desconectado' && oy5.ddj === 0 && r5b === r5a && tk5b?.texto === 'Conectado: DDJ-400' && oy5b.ddj === 1 && oy5b.estado === 1
    && cercaAbs(lk5.volA, pos14(6000) ** 2), { tk5, oy5, rampasDesconectado: r5b - r5a, tk5b, oy5b, volA: lk5.volA });
  await tocarAmbos(false);

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
  const oyFuera = await oyentesMidi();
  await irA('Modo DJ'); await p.waitForSelector('.dj-fila', { timeout: 15000 }).catch(() => {}); await sleep(300);
  const vuelta0 = await ac();
  await cargarEn('A', n1);
  const dv = await esperarDeck('A', (d) => d.estado === 'pausa');
  const vuelta1 = await ac();
  const tasa2 = await p.evaluate(() => ({ opciones: window.__ac?.opciones[1] ?? null, tasa: window.__ac?.lista[1]?.sampleRate ?? null }));
  ok('m15_volver_crea_uno_nuevo_al_cargar', vuelta0.creados === 1 && vuelta0.vivos === 0 && !!dv && vuelta1.creados === 2 && vuelta1.vivos === 1
    && tasa2.opciones?.sampleRate === 44100 && tasa2.tasa === 44100, { vuelta0, vuelta1, tasa2 });
  ok('m16_nunca_dos_contextos_vivos', vuelta1.maxVivos === 1, { maxVivos: vuelta1.maxVivos });
  // k6: salir de /dj quita los oyentes MIDI; al volver (permiso ya concedido) conecta solo y hay UNO de cada uno.
  const tk6 = await esperarMidi('conectado');
  const oyVuelta = await oyentesMidi();
  ok('k6_salir_y_volver_no_duplica_oyentes', oyFuera.ddj === 0 && oyFuera.estado === 0 && tk6?.texto === 'Conectado: DDJ-400' && oyVuelta.ddj === 1 && oyVuelta.estado === 1 && oyVuelta.otro === 0, { oyFuera, oyVuelta, tk6 });
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

  // ── k (final): recargas con otra configuración del MIDI falso. Van al final porque recargan la página.
  const recargarDj = async (cfg, ruta = '/dj') => {
    await p.evaluate((c) => { if (c) sessionStorage.setItem('__fmCfg', JSON.stringify(c)); else sessionStorage.removeItem('__fmCfg'); }, cfg);
    await p.goto(BASE + ruta);
    await p.waitForSelector('.dj-mezcla', { timeout: 15000 }).catch(() => {});
    await sleep(400);
  };
  // k7: sin Web MIDI → sin botón, un texto corto y sin errores de página.
  const errK7 = errores.length;
  await recargarDj({ soporte: false });
  const tk7 = await textoMidi();
  ok('k7_sin_web_midi_sin_boton_ni_error', !tk7.boton && tk7.estado === 'sin-soporte' && tk7.texto === 'Este navegador no tiene Web MIDI' && errores.length === errK7, { tk7, errores: errores.slice(errK7) });
  // k8: permiso denegado → el aviso (ya al montar, por permissions.query) y, con el clic, sigue el aviso; sin errores.
  const errK8 = errores.length;
  await recargarDj({ permiso: 'denied' });
  const tk8a = await textoMidi();
  await p.locator('.dj-midi-conectar').click(); await sleep(300);
  const tk8b = await textoMidi();
  const ped8 = await p.evaluate(() => window.__fm.pedidos.length);
  ok('k8_permiso_denegado_avisa_sin_error', tk8a.texto === 'Permiso de MIDI denegado' && tk8b.texto === 'Permiso de MIDI denegado' && tk8b.boton && ped8 === 1 && errores.length === errK8,
    { tk8a, tk8b, pedidos: ped8, errores: errores.slice(errK8) });
  // k9: /dj?diag=1 expone window.__djMidi; mide (con un deck sonando) un retraso por cada mensaje que llega al
  // setter; reiniciar() vacía. Layout canoniza la URL a /dj (la query desaparece de la barra).
  await recargarDj(null, '/dj?diag=1');
  const d9 = await p.evaluate(() => ({ hay: typeof window.__djMidi?.stats === 'function' && typeof window.__djMidi?.reiniciar === 'function', url: location.pathname + location.search, stats: window.__djMidi?.stats() ?? null }));
  await cargarEn('A', n1);
  await esperarDeck('A', (d) => d.estado === 'pausa');
  await p.locator(sel('A', '.dj-play')).click();
  await esperarDeck('A', (d) => d.estado === 'sonando', 2000);
  await p.locator('.dj-midi-conectar').click();
  await esperarMidi('conectado');
  // 5 pares con LSB ≠ 0: cada MSB aplica (con LSB = 0) y cada LSB completa → 10 llamadas al setter = 10 mediciones.
  await enviarMidi([1000, 2000, 3000, 4000, 5000].flatMap((x) => midi('volA', x)));
  const s9 = await p.evaluate(() => window.__djMidi.stats());
  await p.evaluate(() => window.__djMidi.reiniciar());
  const s9b = await p.evaluate(() => window.__djMidi.stats());
  ok('k9_diag_expone_y_mide', d9.hay && d9.url === '/dj' && d9.stats?.n === 0 && s9.n === 10 && s9.mediana >= 0 && s9.p95 >= s9.mediana && s9.max >= s9.p95
    && s9.sampleRate === 44100 && s9.latencyHint === 'interactive' && typeof s9.baseLatency === 'number' && typeof s9.outputLatency === 'number' && s9b.n === 0,
  { d9, s9, s9b });
  await p.locator(sel('A', '.dj-play')).click(); await esperarDeck('A', (d) => d.estado === 'pausa', 2000);
  // k9b: sin ?diag=1 no existe.
  await recargarDj(null, '/dj');
  const d9b = await p.evaluate(() => ({ existe: '__djMidi' in window, url: location.pathname + location.search }));
  ok('k9b_sin_diag_no_hay_djMidi', !d9b.existe && d9b.url === '/dj', d9b);
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
