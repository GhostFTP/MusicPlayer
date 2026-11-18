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
//   · cd  (sub-paso e2b, la puerta de diagnóstico del cue, sin hardware) sin ?diag=1 no hay window.__djCue,
//         ni con la consola montada ni tras recargar (cd0); con ?diag=1 está con sus 6 funciones y el cue
//         'sin-salida' (cd1); cargar en A crea UN contexto sin ningún setSinkId (cd2); con A sonando, una
//         salida que no existe: 2.º contexto, estado 'error' con el aviso exacto, sin contexto de cue
//         (diag() null) y el master intacto: 'running', A avanza, mezcla igual en la UI y en los AudioParam
//         (cd3); salir de /dj quita window.__djCue y deja los dos contextos 'closed' (cd4).
//   · cc  (sub-paso e2c, canales del cue) el envoltorio de __djCue pasa las opciones (cc0); con '3-4' y una
//         salida que no existe falla igual que cd3 y no toca el destination del master ni el del cue (cc1).
//         En el Chromium del runner NINGUNA salida acepta setSinkId (medido el 2026-11-14: una sola salida,
//         sin id; setSinkId('default') → NotFoundError), así que la etapa '3-4' (grafo, orden, adaptador y
//         el fallo por maxChannelCount < 4) sólo se prueba en dj-unit.
//   · cs  (sub-paso e3a, «Audífonos (cue)», con un mediaDevices FALSO y un setSinkId FALSO sólo para sus ids)
//         al montar no se pide el micrófono (cs0); el clic pide UNA vez y para la pista; la lista sin alias,
//         con los repetidos desambiguados y la marca del master (cs1); «Usar» abre el contexto de cue y otra
//         salida reusa el contexto (cs3); misma salida que el master: confirma con 1-2, no con 3-4 (cs4);
//         la etapa '3-4' armada sobre el destination REAL y el cambio de canales en caliente sin setSinkId
//         (cs10); las teclas y el selector no aplican nada (cs6); quitar (cs5); el error del motor con el
//         master intacto (cs9, cs9b); devicechange sin la salida con contexto abierto → null + aviso (cs7) y
//         en 'error' sin duplicar (cs7b); salir quita el oyente de devicechange (cs11); permiso ya dado al
//         montar (cs8); denegado y sin micrófono (cs2). Con el setSinkId falso NO se prueba: que el audio
//         salga por otro dispositivo, los sinkchange/error/'closed' reales al desenchufar, el maxChannelCount
//         real de la DDJ-400 (acá es el del destination por defecto, 6), el aviso de permisos de Edge, los
//         nombres y groupId reales.
//   · ce  (sub-paso e3b, botones «Cue», volumen y desfase) el Cue deshabilitado sin salida y en 'error' con su title
//         (ce1); activo en pausa: nota y sin fuente de cue (ce2); play crea UNA con el buffer del master (ce3); los dos
//         a la vez (ce4); cargar otra pista conserva el cue (ce5); volumen v al motor y doble clic (ce6); desfase: 5
//         flechas → una aplicación diferida en < 700 ms (ce7), ratón al soltar (ce8), ±1 juntos y doble clic al
//         instante (ce9), ±250 (ce13); teclas sobre Cue y los controles (ce10); otra salida conserva, quitar apaga
//         (ce11); sin desborde a 1024/1280/1366 (ce12) y a 900 (ce12b); la salida que vuelve quita el aviso de la página (ce14) y el
//         'error' del motor (ce15) sin armar nada, y un error con la salida siempre presente no se toca (ce16); la
//         pista DDJ sólo con 1-2 (ce17); con el deck vacío, la otra nota (ce18). El cue se cuenta por sus
//         AudioBufferSourceNode en el contexto de cue. NO se prueba: el sonido, el corte al resincronizar, clics.
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
  // Cue (sub-paso e2b): cada setSinkId con el índice de SU contexto en reg.lista (el master no debe recibir
  // ninguno). El master = el último contexto creado SIN sinkId en el constructor (el de cue lo trae: { type:
  // 'none' }); el grafo y las lecturas de la mezcla son siempre del master.
  reg.sinks = [];
  const ss = AC.prototype.setSinkId;
  // e3a: setSinkId FALSO sólo para los ids del mediaDevices falso (abajo): resuelve sin llamar al nativo (el
  // contexto de cue, creado con sinkId { type: 'none' }, sigue 'running' y su destination real tiene
  // maxChannelCount 6, medido en e2c), así que la etapa '3-4' se arma DE VERDAD en este Chromium. 'hp-0002'
  // rechaza con NotFoundError (una salida que falla al abrirla). Cualquier otro id va al nativo, como antes
  // (cd3 y cc1 usan uno que no existe y esperan el NotFoundError real).
  const SINK_FALSO = { 'sb-0001': null, 'wave-0001': null, 'hp-0001': null, 'hp-0002': 'NotFoundError', 'ddj-0001': null };
  if (typeof ss === 'function') AC.prototype.setSinkId = function (id, ...r) {
    reg.sinks.push({ i: reg.lista.indexOf(this), id: typeof id === 'string' ? id : JSON.stringify(id) });
    if (typeof id === 'string' && Object.hasOwn(SINK_FALSO, id)) return SINK_FALSO[id] ? Promise.reject(new DOMException('setSinkId falso', SINK_FALSO[id])) : Promise.resolve();
    return ss.call(this, id, ...r);
  };
  reg.master = () => reg.lista.filter((c, i) => !(reg.opciones[i] && typeof reg.opciones[i] === 'object' && 'sinkId' in reg.opciones[i])).at(-1) ?? null;
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
    const c = reg.master();
    const f = reg.aristas.filter(([s]) => s instanceof AudioBufferSourceNode && s.context === c).at(-1);
    reg.volA = f ? f[1] : null;
    return !!reg.volA;
  };
  reg.grafo = () => {
    const c = reg.master();
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
// mediaDevices FALSO (sub-paso e3a, el selector de audífonos): el runner no tiene salidas con nombre. Sólo el
// permiso de micrófono destapa los nombres (como en Edge): sin él, enumerateDevices da una entrada por tipo,
// sin id ni nombre. Salidas: los alias 'default' y 'communications', la Sound Blaster (mismo groupId que
// 'default' = la del master), unos audífonos Elgato, DOS «Headphones» con el mismo nombre y la DDJ-400 con el
// groupId de 'default' también (master y audífonos en la misma salida: con '3-4' no se confirma nada).
// getUserMedia cuenta sus llamadas y da una pista que cuenta sus stop(); devicechange con __fd.quitar(id) /
// __fd.poner(id); oyentes de devicechange contados. permissions.query({ name: 'microphone' }) da __fd.permiso.
// Configuración por página en sessionStorage '__fdCfg': { permiso: 'prompt' | 'granted' | 'denied' } (por
// defecto 'prompt'), { gum: '<name>' } hace rechazar getUserMedia, { nombres: false } = sin nombres aun con permiso.
await ctx.addInitScript(() => {
  if (window.__fd) return;
  let cfg = {};
  try { cfg = JSON.parse(sessionStorage.getItem('__fdCfg') || '{}') || {}; } catch { cfg = {}; }
  const fd = { gum: [], pistas: [], enumeraciones: 0, permiso: cfg.permiso ?? 'prompt' };
  window.__fd = fd;
  const LISTA = [
    { kind: 'audioinput', deviceId: 'default', label: 'Predeterminado - Micrófono (Elgato Wave:XLR)', groupId: 'g-wave' },
    { kind: 'audioinput', deviceId: 'mic-0001', label: 'Micrófono (Elgato Wave:XLR)', groupId: 'g-wave' },
    { kind: 'audiooutput', deviceId: 'default', label: 'Predeterminado - Altavoces (Sound Blaster AE-7)', groupId: 'g-sb' },
    { kind: 'audiooutput', deviceId: 'communications', label: 'Comunicaciones - Headphones (Elgato Wave:XLR)', groupId: 'g-wave' },
    { kind: 'audiooutput', deviceId: 'sb-0001', label: 'Altavoces (Sound Blaster AE-7)', groupId: 'g-sb' },
    { kind: 'audiooutput', deviceId: 'wave-0001', label: 'Headphones (Elgato Wave:XLR)', groupId: 'g-wave' },
    { kind: 'audiooutput', deviceId: 'hp-0001', label: 'Headphones', groupId: 'g-hp1' },
    { kind: 'audiooutput', deviceId: 'hp-0002', label: 'Headphones', groupId: 'g-hp2' },
    { kind: 'audiooutput', deviceId: 'ddj-0001', label: 'Línea (2- DDJ-400)', groupId: 'g-sb' },
  ];
  const quitados = new Set();
  const t = new EventTarget();
  const oy = new Set();
  const medios = {
    getUserMedia(c) {
      fd.gum.push(JSON.parse(JSON.stringify(c ?? null)));
      const g = cfg.gum ?? 'ok';
      if (g !== 'ok') { if (g === 'NotAllowedError') fd.permiso = 'denied'; return Promise.reject(new DOMException('getUserMedia falso', g)); }
      fd.permiso = 'granted';
      const pista = { stops: 0, stop() { this.stops++; } };
      fd.pistas.push(pista);
      return Promise.resolve({ getTracks: () => [pista] });
    },
    enumerateDevices() {
      fd.enumeraciones++;
      const conNombres = fd.permiso === 'granted' && cfg.nombres !== false;
      return Promise.resolve(conNombres ? LISTA.filter((d) => !quitados.has(d.deviceId)).map((d) => ({ ...d }))
        : [{ kind: 'audioinput', deviceId: '', label: '', groupId: '' }, { kind: 'audiooutput', deviceId: '', label: '', groupId: '' }]);
    },
    addEventListener(tipo, fn, o) { if (tipo === 'devicechange') oy.add(fn); t.addEventListener(tipo, fn, o); },
    removeEventListener(tipo, fn, o) { if (tipo === 'devicechange') oy.delete(fn); t.removeEventListener(tipo, fn, o); },
  };
  fd.oyentes = () => oy.size;
  fd.quitar = (id) => { quitados.add(id); t.dispatchEvent(new Event('devicechange')); };
  fd.poner = (id) => { quitados.delete(id); t.dispatchEvent(new Event('devicechange')); };
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: medios });
  if (navigator.permissions) {
    const q0 = navigator.permissions.query.bind(navigator.permissions);   // ya envuelto por el MIDI falso
    Object.defineProperty(navigator.permissions, 'query', { configurable: true, value: (d) => (d?.name === 'microphone' ? Promise.resolve({ state: fd.permiso, onchange: null }) : q0(d)) });
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
    const c = window.__ac.master();
    const t0 = c.currentTime, w0 = performance.now();
    while (c.currentTime < t0 + 0.12 && performance.now() - w0 < 3000) await new Promise((r) => setTimeout(r, 20));
    return { ...window.__ac.leer(), espera: c.currentTime - t0 };
  });
  const contadores = () => p.evaluate(() => ({ escrituras: window.__ac.escrituras, rampas: window.__ac.rampas, tipos: window.__ac.tipos }));

  await p.waitForSelector('.dj-fila', { timeout: 15000 }).catch(() => {});
  const a0 = await ac();
  ok('m0_sin_audiocontext_al_entrar', a0.creados === 0 && !!(await deck('A')) && (await deck('A')).estado === 'vacio', a0);
  // cd0 (1.ª mitad): la consola montada SIN ?diag=1 no expone el cue. La 2.ª mitad, tras recargar /dj (abajo).
  const cd0a = await p.evaluate(() => ({ existe: '__djCue' in window, consola: !!document.querySelector('.dj-mezcla'), url: location.pathname + location.search }));

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

  // cf1 (mini-paso c-fix): las perillas de los sliders de /dj se ven SIN hover (main.css, sección DJ:
  // .dj-page input[type="range"]::-webkit-slider-thumb { opacity: 1 }; la regla global las deja en 0 hasta el
  // :hover). getComputedStyle(el, '::-webkit-slider-thumb') NO sirve en este Chromium: ignora el pseudo y da el
  // estilo del <input> (opacity 1 y el ancho del input, con la regla o sin ella; medido el 2026-11-15). Se lee por
  // CDP: la perilla es el div#thumb del shadow root 'user-agent' del input (DOM.getDocument con pierce y
  // CSS.getComputedStyleForNode). Se exige UNA perilla por input y de 12 px, para no medir otra cosa si Chromium
  // cambia ese árbol interno.
  const pulgar = async (selector) => {
    await p.evaluate((s) => document.querySelector(s)?.setAttribute('data-pulgar', '1'), selector);
    const cdp = await p.context().newCDPSession(p);
    try {
      await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
      const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
      const hijos = (n) => [...(n.children ?? []), ...(n.shadowRoots ?? [])];
      const buscar = (n, f) => (f(n) ? n : hijos(n).reduce((x, c) => x ?? buscar(c, f), null));
      const attr = (n, k) => { const a = n.attributes ?? []; const i = a.indexOf(k); return i >= 0 && i % 2 === 0 ? a[i + 1] : null; };
      const input = buscar(root, (n) => attr(n, 'data-pulgar') === '1');
      if (!input) return { error: 'sin input' };
      const ua = (input.shadowRoots ?? []).find((r) => r.shadowRootType === 'user-agent');
      const pulgares = [];
      const juntar = (n) => { if (n.localName === 'div' && attr(n, 'id') === 'thumb') pulgares.push(n); hijos(n).forEach(juntar); };
      if (ua) juntar(ua);
      if (pulgares.length !== 1) return { error: `perillas: ${pulgares.length}` };
      const { computedStyle } = await cdp.send('CSS.getComputedStyleForNode', { nodeId: pulgares[0].nodeId });
      const v = (k) => computedStyle.find((x) => x.name === k)?.value ?? null;
      return { opacity: v('opacity'), width: v('width') };
    } finally {
      await cdp.detach().catch(() => {});
      await p.evaluate((s) => document.querySelector(s)?.removeAttribute('data-pulgar'), selector);
    }
  };
  await p.mouse.move(2, 2); await sleep(250);   // el puntero fuera de los sliders (y la transición de .15 s, terminada)
  const hover = await p.evaluate(() => document.querySelectorAll('input[type="range"]:hover').length);
  const pulgares = { mezcla: await pulgar('.dj-crossfader input'), seekA: await pulgar(sel('A', '.dj-deck-seek')) };
  ok('cf1_perillas_visibles_sin_hover', hover === 0 && Object.values(pulgares).every((x) => x.opacity === '1' && x.width === '12px'), { hover, pulgares });

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
  // cd1: con ?diag=1, window.__djCue con sus 6 funciones (y sólo ésas); el cue sin salida y sin contexto.
  const FN_CUE = ['fijarSalidaCue', 'fijarCue', 'fijarVolumenCue', 'fijarDesfaseCue', 'cue', 'diag'];
  const cd1 = await p.evaluate((fns) => {
    const c = window.__djCue;
    return { claves: c ? Object.keys(c).sort() : null, funciones: c ? fns.every((k) => typeof c[k] === 'function') : false, estado: c?.cue?.().estado ?? null, diag: c ? c.diag() : 'sin-djCue' };
  }, FN_CUE);
  ok('cd1_diag_expone_djCue', cd1.funciones && JSON.stringify(cd1.claves) === JSON.stringify([...FN_CUE].sort()) && cd1.estado === 'sin-salida' && cd1.diag === null, cd1);
  await cargarEn('A', n1);
  await esperarDeck('A', (d) => d.estado === 'pausa');
  // cd2: cargar en A crea UN contexto (el master) y nadie llama a setSinkId.
  const cd2 = await p.evaluate(() => ({ creados: window.__ac.creados, sinks: window.__ac.sinks.length, opciones: window.__ac.opciones[0] }));
  ok('cd2_cargar_un_contexto_sin_setSinkId', cd2.creados === 1 && cd2.sinks === 0 && !(cd2.opciones && 'sinkId' in cd2.opciones), cd2);
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
  // cd3: con A sonando, una salida de audífonos que NO existe. setSinkId rechaza (NotFoundError) → cue en
  // 'error' con el aviso exacto y sin contexto de cue; el master no se entera.
  const mezclaCd3 = async () => { const a = await asentarYLeer(); return { ui: await valoresUi(), audio: a && typeof a.volA === 'number' ? { volA: a.volA, volB: a.volB, xfA: a.xfA, xfB: a.xfB, lp: a.lp, hp: a.hp } : null }; };
  // Tras la recarga hay que volver a identificar el vol de A (su fuente es la última conectada en el master).
  const marcadoCd3 = await p.evaluate(() => window.__ac.marcarA());
  const antesCd3 = await mezclaCd3();
  const errCd3 = errores.length;
  const llamadasCd3 = await p.evaluate(async () => {
    const r1 = await window.__djCue.fijarSalidaCue('no-existe-0123456789abcdef', 'Salida falsa');
    const r2 = window.__djCue.fijarCue('A', true);
    return { r1, r2 };
  });
  const cueCd3 = await esperar(() => p.evaluate(() => { const e = window.__djCue.cue(); return e.estado === 'error' ? e : null; }), 5000);
  await esperar(() => p.evaluate(() => window.__ac.lista[1]?.state === 'closed'), 3000);
  const ctxCd3 = await p.evaluate(() => ({ creados: window.__ac.creados, estados: window.__ac.lista.map((c) => c.state), opciones1: window.__ac.opciones[1] ?? null,
    sinks: window.__ac.sinks, diag: window.__djCue.diag(), deck: document.querySelector('.dj-deck[data-lado="A"]')?.dataset.estado ?? null }));
  const avCd3 = await avance('A');
  const despuesCd3 = await mezclaCd3();
  const igualAudio = (x, y) => !!x && !!y && Object.keys(x).every((k) => cercaAbs(x[k], y[k], 1e-6 * Math.max(1, Math.abs(y[k]))));
  ok('cd3_salida_inexistente_error_y_master_intacto', marcadoCd3 && llamadasCd3.r1?.ok === true && llamadasCd3.r2 === true && !!cueCd3
    && cueCd3.aviso === 'No se encontró la salida «Salida falsa». Cue apagado; el master sigue igual.' && cueCd3.activo.A === false
    && ctxCd3.creados === 2 && ctxCd3.diag === null && ctxCd3.estados[0] === 'running' && ctxCd3.estados[1] === 'closed'
    && JSON.stringify(ctxCd3.opciones1?.sinkId) === JSON.stringify({ type: 'none' }) && ctxCd3.sinks.length >= 1 && ctxCd3.sinks.every((x) => x.i === 1)
    && ctxCd3.deck === 'sonando' && avCd3.p1 - avCd3.p0 > 0.5 && Math.abs((avCd3.p1 - avCd3.p0) - avCd3.pared) <= TOL_S
    && JSON.stringify(antesCd3.ui) === JSON.stringify(despuesCd3.ui) && igualAudio(despuesCd3.audio, antesCd3.audio) && errores.length === errCd3,
  { llamadas: llamadasCd3, cue: cueCd3, ctx: ctxCd3, avance: avCd3, antes: antesCd3, despues: despuesCd3, errores: errores.slice(errCd3) });
  await p.locator(sel('A', '.dj-play')).click(); await esperarDeck('A', (d) => d.estado === 'pausa', 2000);
  // cd4: salir de /dj (navegando, sin recargar: los contadores siguen) quita window.__djCue y los contextos
  // creados quedan 'closed'.
  await irA('Biblioteca');
  const leerCd4 = () => p.evaluate(() => ({ existe: '__djCue' in window, ruta: location.pathname, creados: window.__ac.creados, estados: window.__ac.lista.map((c) => c.state) }));
  const cd4 = await esperar(async () => { const r = await leerCd4(); return !r.existe && r.estados.every((s) => s === 'closed') ? r : null; }, 3000) ?? await leerCd4();
  ok('cd4_salir_quita_djCue_y_cierra_los_contextos', !cd4.existe && cd4.ruta === '/' && cd4.creados === 2 && cd4.estados.length === 2 && cd4.estados.every((s) => s === 'closed'), cd4);
  // k9b: sin ?diag=1 no existe.
  await recargarDj(null, '/dj');
  const d9b = await p.evaluate(() => ({ existe: '__djMidi' in window, url: location.pathname + location.search }));
  ok('k9b_sin_diag_no_hay_djMidi', !d9b.existe && d9b.url === '/dj', d9b);
  // cd0 (2.ª mitad): tras recargar /dj sin ?diag=1, con la consola montada, tampoco hay window.__djCue.
  const cd0b = await p.evaluate(() => ({ existe: '__djCue' in window, consola: !!document.querySelector('.dj-mezcla'), url: location.pathname + location.search }));
  ok('cd0_sin_diag_no_hay_djCue', !cd0a.existe && cd0a.consola && cd0a.url === '/dj' && !cd0b.existe && cd0b.consola && cd0b.url === '/dj', { cd0a, cd0b });
  // ── cc (sub-paso e2c): con ?diag=1 otra vez, A sonando.
  await recargarDj(null, '/dj?diag=1');
  await cargarEn('A', n1);
  await esperarDeck('A', (d) => d.estado === 'pausa');
  await p.locator(sel('A', '.dj-play')).click();
  await esperarDeck('A', (d) => d.estado === 'sonando', 2000);
  // cc0: el envoltorio pasa `opciones`: '3-4' queda elegido; '5-6' u opciones que no son un objeto →
  // 'valor-invalido' sin cambiar nada. Sin contexto de cue todavía (sólo se guarda).
  const cc0 = await p.evaluate(async () => {
    const c = window.__djCue;
    const r1 = await c.fijarSalidaCue('no-existe-0123456789abcdef', 'Salida falsa', { canales: '3-4' });
    const e1 = c.cue();
    const r2 = await c.fijarSalidaCue('no-existe-0123456789abcdef', 'Salida falsa', { canales: '5-6' });
    const r3 = await c.fijarSalidaCue('no-existe-0123456789abcdef', 'Salida falsa', '3-4');
    return { r1, canales1: e1.canales, estado1: e1.estado, r2, r3, canales3: c.cue().canales, creados: window.__ac.creados };
  });
  ok('cc0_djCue_pasa_opciones', cc0.r1?.ok === true && cc0.canales1 === '3-4' && cc0.estado1 === 'lista' && cc0.r2?.error === 'valor-invalido'
    && cc0.r3?.error === 'valor-invalido' && cc0.canales3 === '3-4' && cc0.creados === 1, cc0);
  // cc1: con '3-4' y la salida que no existe, el fallo es el de setSinkId (NotFoundError, antes de mirar los
  // canales): mismo aviso que cd3, contexto de cue cerrado, y NINGÚN destination tocado (2 canales 'speakers').
  const errCc1 = errores.length;
  const actCc1 = await p.evaluate(() => window.__djCue.fijarCue('A', true));
  const eCc1 = await esperar(() => p.evaluate(() => { const e = window.__djCue.cue(); return e.estado === 'error' ? e : null; }), 5000);
  await esperar(() => p.evaluate(() => window.__ac.lista[1]?.state === 'closed'), 3000);
  const cc1 = await p.evaluate(() => {
    const dest = (c) => { try { return { cuenta: c.destination.channelCount, interp: c.destination.channelInterpretation }; } catch (e) { return { error: e.name }; } };
    return { creados: window.__ac.creados, estados: window.__ac.lista.map((c) => c.state), sinks: window.__ac.sinks, master: dest(window.__ac.master()),
      cue: window.__ac.lista[1] ? dest(window.__ac.lista[1]) : null, diag: window.__djCue.diag(), deck: document.querySelector('.dj-deck[data-lado="A"]')?.dataset.estado ?? null };
  });
  const avCc1 = await avance('A');
  ok('cc1_34_salida_inexistente_falla_igual_y_master_intacto', actCc1 === true && !!eCc1 && eCc1.canales === '3-4'
    && eCc1.aviso === 'No se encontró la salida «Salida falsa». Cue apagado; el master sigue igual.' && eCc1.activo.A === false
    && cc1.creados === 2 && cc1.estados[0] === 'running' && cc1.estados[1] === 'closed' && cc1.sinks.length >= 1 && cc1.sinks.every((x) => x.i === 1)
    && cc1.master?.cuenta === 2 && cc1.master?.interp === 'speakers' && cc1.cue?.cuenta === 2 && cc1.cue?.interp === 'speakers' && cc1.diag === null
    && cc1.deck === 'sonando' && avCc1.p1 - avCc1.p0 > 0.5 && Math.abs((avCc1.p1 - avCc1.p0) - avCc1.pared) <= TOL_S && errores.length === errCc1,
  { cue: eCc1, cc1, avance: avCc1, errores: errores.slice(errCc1) });
  await p.locator(sel('A', '.dj-play')).click(); await esperarDeck('A', (d) => d.estado === 'pausa', 2000);

  // ── cs (sub-paso e3a): «Audífonos (cue)», con el mediaDevices y el setSinkId FALSOS de los init scripts ──
  // Los textos esperados se escriben acá, no se importan de cue.js: si el código cambia uno, el test lo ve.
  const TXT = {
    inactivo: 'Para mostrar los nombres de las salidas de audio, el navegador pide permiso de micrófono. No se graba nada: el micrófono se cierra al instante.',
    denegado: 'Permiso de micrófono denegado. Sin él, el navegador no muestra los nombres de las salidas. Puedes permitirlo desde el candado de la barra de direcciones.',
    sinMicro: 'No hay ningún micrófono conectado, y sin micrófono el navegador no muestra los nombres de las salidas.',
    misma: 'Esa salida es la misma del master: el cue sonaría por los mismos altavoces.',
  };
  const OPCIONES = [['', 'Elige una salida…'], ['sb-0001', 'Altavoces (Sound Blaster AE-7) · la misma del master'], ['wave-0001', 'Headphones (Elgato Wave:XLR)'],
    ['hp-0001', 'Headphones'], ['hp-0002', 'Headphones (2)'], ['ddj-0001', 'Línea (2- DDJ-400) · la misma del master']];
  const recargarCue = async (cfg, ruta = '/dj') => {
    await p.evaluate((c) => { sessionStorage.removeItem('__fmCfg'); if (c) sessionStorage.setItem('__fdCfg', JSON.stringify(c)); else sessionStorage.removeItem('__fdCfg'); }, cfg);
    await p.goto(BASE + ruta);
    await p.waitForSelector('.dj-cue', { timeout: 15000 }).catch(() => {});
    await sleep(400);
    await instrumentar();
  };
  const cueUi = () => p.evaluate(() => {
    const s = document.querySelector('.dj-cue');
    if (!s) return null;
    const q = (x) => s.querySelector(x)?.textContent ?? null;
    return {
      estado: s.dataset.estado, lista: s.dataset.lista, salida: s.dataset.salida, canales: s.dataset.canales, contexto: s.dataset.contexto,
      textoEstado: q('.dj-cue-estado'), textoLista: q('.dj-cue-lista-texto'), boton: !!s.querySelector('.dj-cue-ver'),
      opciones: [...s.querySelectorAll('.dj-cue-salida option')].map((o) => [o.value, o.textContent]),
      sel: s.querySelector('.dj-cue-salida')?.value ?? null, radio: s.querySelector('.dj-cue-canales input:checked')?.value ?? null,
      ojo: !!s.querySelector('.dj-cue-ojo'), quitar: !!s.querySelector('.dj-cue-quitar'),
      confirmacion: q('.dj-cue-confirmacion p'), avisoMotor: q('.dj-cue-aviso-motor p'), avisoUi: q('.dj-cue-aviso-ui p'),
      alertas: s.querySelectorAll('[role="alert"]').length, foco: document.activeElement?.tagName ?? null,
    };
  });
  // Un clic sólo si el control está: donde su AUSENCIA es lo que se prueba (una mutación no debe convertir el caso
  // en una excepción que corta el bloque). El resto de las acciones del bloque esperan a lo sumo 8 s.
  const clicSiHay = async (s) => { if (await p.locator(s).count()) await p.locator(s).click(); };
  p.setDefaultTimeout(8000);
  const esperarCue = (cond, ms = 4000) => esperar(async () => { const u = await cueUi(); return u && cond(u) ? u : null; }, ms);
  const fdEstado = () => p.evaluate(() => ({ gum: window.__fd.gum, stops: window.__fd.pistas.map((t) => t.stops), oyentes: window.__fd.oyentes(), enumeraciones: window.__fd.enumeraciones }));
  // Los contextos de cue (los que se crean con sinkId en las opciones) y los setSinkId pedidos.
  const cueCtx = () => p.evaluate(() => {
    const r = window.__ac;
    const cues = r.lista.filter((c, i) => r.opciones[i] && typeof r.opciones[i] === 'object' && 'sinkId' in r.opciones[i]);
    const c = cues.at(-1);
    const m = r.master();
    return { sinks: r.sinks.map((s) => s.id), sinksMaster: r.sinks.filter((s) => s.i === r.lista.indexOf(m)).length, cues: cues.length, master: m?.state ?? null,
      cue: c ? { state: c.state, cuenta: c.destination.channelCount, interp: c.destination.channelInterpretation, max: c.destination.maxChannelCount } : null };
  });
  const elegir = async (id, canales) => {
    await p.locator('.dj-cue-salida').selectOption(id);
    await p.locator(`.dj-cue-canales input[value="${canales}"]`).check();
  };
  const usar = async (id, canales) => { await elegir(id, canales); await p.locator('.dj-cue-usar').click(); };
  // Lo que ocupa la página fuera de la lista de la biblioteca: X tal que con height = calc(100vh − X) la lista
  // llena el alto sin scroll exterior (X = alto de la ventana − alto visible de .main-content + todo lo demás).
  const medirAlto = () => p.evaluate(() => {
    const l = document.querySelector('.dj-lista-scroll');
    const sc = document.querySelector('.main-content');
    if (!l || !sc) return null;
    const lista = l.getBoundingClientRect().height;
    // hueco: del borde inferior de la lista al de .main-content, con el scroll arriba (los paddings de abajo
    // si la página entra justo; más, si sobra alto).
    sc.scrollTop = 0;
    const hueco = Math.round(sc.getBoundingClientRect().bottom - l.getBoundingClientRect().bottom);
    return { vh: innerHeight, lista: Math.round(lista), scrollH: sc.scrollHeight, clientH: sc.clientHeight, X: Math.round(innerHeight - sc.clientHeight + (sc.scrollHeight - lista)), hueco,
      cue: Math.round(document.querySelector('.dj-cue')?.getBoundingClientRect().height ?? 0) };
  });

  // cs0: el bloque, la frase y el botón; al montar NO se pide el micrófono (0 getUserMedia) ni se enumera.
  await recargarCue(null);
  const u0 = await cueUi(), f0 = await fdEstado();
  REG.alto_inicial = await medirAlto();
  ok('cs0_bloque_frase_y_boton_sin_pedir', !!u0 && u0.lista === 'inactivo' && u0.textoLista === TXT.inactivo && u0.boton && u0.estado === 'sin-salida'
    && u0.textoEstado === 'Sin salida de audífonos.' && u0.opciones.length === 0 && f0.gum.length === 0 && f0.enumeraciones === 0 && f0.oyentes === 1, { u0, f0 });
  // Para «master intacto» (cs9): A cargada y sonando; B cargada.
  await cargarEn('A', n1); await esperarDeck('A', (d) => d.estado === 'pausa');
  await cargarEn('B', n2); await esperarDeck('B', (d) => d.estado === 'pausa');
  await p.locator('.dj-buscar').fill('');
  await p.locator(sel('A', '.dj-play')).click(); await esperarDeck('A', (d) => d.estado === 'sonando', 2000);

  // cs1: el clic → UNA getUserMedia({ audio: true }) y su pista parada; la lista sin los alias, con los dos
  // «Headphones» desambiguados y la marca del master (la Sound Blaster y la DDJ comparten el groupId de 'default').
  await clicSiHay('.dj-cue-ver');
  const u1 = await esperarCue((u) => u.lista === 'lista') ?? await cueUi();
  const f1 = await fdEstado();
  ok('cs1_lista_con_permiso_y_pista_parada', u1.lista === 'lista' && !u1.boton && JSON.stringify(u1.opciones) === JSON.stringify(OPCIONES) && u1.sel === ''
    && f1.gum.length === 1 && JSON.stringify(f1.gum[0]) === JSON.stringify({ audio: true }) && f1.stops.length === 1 && f1.stops[0] === 1 && u1.estado === 'sin-salida',
  { u1, f1 });

  // cs3: «Usar» con 1-2 → el motor tiene la salida, el nombre visible y los canales, y el contexto de cue QUEDA
  // ABIERTO (abrir: true) con un setSinkId; el foco sale del botón. Otra salida → UN setSinkId más en el MISMO
  // contexto (sin llamar a null antes: si no, sería un contexto nuevo).
  const q3 = await cueCtx();
  await usar('wave-0001', '1-2');
  const u3 = await esperarCue((u) => u.estado === 'lista' && u.contexto === '1') ?? await cueUi();
  const q3a = await cueCtx();
  await usar('hp-0001', '1-2');
  const u3b = await esperarCue((u) => u.salida === 'hp-0001' && u.estado === 'lista' && u.contexto === '1') ?? await cueUi();
  const q3b = await cueCtx();
  ok('cs3_usar_abre_y_otra_salida_mismo_contexto', u3.salida === 'wave-0001' && u3.canales === '1-2' && u3.textoEstado === 'Listo: «Headphones (Elgato Wave:XLR)» · canales 1-2.' && u3.quitar
    && u3.foco === 'BODY' && q3a.cues - q3.cues === 1 && JSON.stringify(q3a.sinks.slice(q3.sinks.length)) === JSON.stringify(['wave-0001']) && q3a.cue?.state === 'running'
    && u3b.textoEstado === 'Listo: «Headphones» · canales 1-2.' && q3b.cues === q3a.cues && JSON.stringify(q3b.sinks.slice(q3a.sinks.length)) === JSON.stringify(['hp-0001'])
    && q3b.cue?.state === 'running' && q3b.sinksMaster === 0,
  { u3, u3b, q3, q3a, q3b });

  // cs4: la salida del master con 1-2 pide confirmación y NO llama al motor hasta «Usarla igual»; con 3-4 (la DDJ,
  // también del master) no pide nada. El aviso de «Ojo» sale con 3-4 marcado.
  const q4 = await cueCtx();
  await usar('sb-0001', '1-2');
  const u4a = await esperarCue((u) => !!u.confirmacion, 2000) ?? await cueUi();
  const q4a = await cueCtx();
  await clicSiHay('.dj-cue-confirmar');
  const u4b = await esperarCue((u) => u.salida === 'sb-0001' && u.estado === 'lista') ?? await cueUi();
  const q4b = await cueCtx();
  await elegir('ddj-0001', '3-4');
  const ojo = (await cueUi()).ojo;
  await p.locator('.dj-cue-usar').click();
  const u4c = await esperarCue((u) => u.salida === 'ddj-0001' && u.estado === 'lista') ?? await cueUi();
  ok('cs4_misma_salida_confirma_con_12_y_no_con_34', u4a.confirmacion === TXT.misma && u4a.salida === 'hp-0001' && q4a.sinks.length === q4.sinks.length
    && u4b.confirmacion === null && JSON.stringify(q4b.sinks.slice(q4.sinks.length)) === JSON.stringify(['sb-0001']) && ojo
    && u4c.confirmacion === null && u4c.canales === '3-4' && u4c.alertas === 0,
  { u4a: { confirmacion: u4a.confirmacion, salida: u4a.salida }, u4b: u4b.salida, ojo, u4c: { salida: u4c.salida, canales: u4c.canales, confirmacion: u4c.confirmacion } });

  // cs10: la etapa '3-4' armada DE VERDAD (destination 4 canales 'discrete'); cambiar los canales en caliente
  // en la misma salida: 0 setSinkId nuevos y el mismo contexto, ida y vuelta.
  const q10 = await cueCtx();
  // La DDJ comparte el groupId de 'default' (es «la del master»): con 1-2 se confirma, como en cs4.
  await elegir('ddj-0001', '1-2'); await p.locator('.dj-cue-usar').click();
  await esperarCue((u) => !!u.confirmacion, 2000);
  await clicSiHay('.dj-cue-confirmar');
  const u10a = await esperarCue((u) => u.canales === '1-2' && u.estado === 'lista') ?? await cueUi();
  const q10a = await cueCtx();
  await elegir('ddj-0001', '3-4'); await p.locator('.dj-cue-usar').click();
  const u10b = await esperarCue((u) => u.canales === '3-4' && u.estado === 'lista') ?? await cueUi();
  const q10b = await cueCtx();
  ok('cs10_34_real_y_cambio_en_caliente_sin_setSinkId', q10.cue?.cuenta === 4 && q10.cue?.interp === 'discrete' && q10.cue?.max >= 4 && q10.cue?.state === 'running'
    && u10a.textoEstado === 'Listo: «Línea (2- DDJ-400)» · canales 1-2.' && q10a.cue?.cuenta === 2 && q10a.cue?.interp === 'speakers'
    && u10b.textoEstado === 'Listo: «Línea (2- DDJ-400)» · canales 3-4.' && q10b.cue?.cuenta === 4 && q10b.cue?.interp === 'discrete'
    && q10a.sinks.length === q10.sinks.length && q10b.sinks.length === q10.sinks.length && q10a.cues === q10.cues && q10b.cues === q10.cues,
  { q10, q10a, q10b, u10a: u10a.textoEstado, u10b: u10b.textoEstado });
  REG.alto_en_sesion = await medirAlto();
  // cs12: el alto de la biblioteca (main.css, .dj-lista-scroll = calc(100vh − 807px), medido en este mismo estado:
  // decks cargados con su registro, «Mezcla» y «Audífonos (cue)» con una salida lista, el aviso de 3-4 y, desde e3b,
  // la fila de volumen y desfase). A 1280×1080 la lista mide 1080 − 807 = 273 px, la página no scrollea por fuera y debajo de la lista sólo
  // quedan los paddings de abajo (el hueco a 800 px de alto, donde la lista está en su mínimo y la página
  // desborda, es el mismo: lo que hay debajo de la lista no depende del alto).
  await p.setViewportSize({ width: 1280, height: 1080 }); await sleep(300);
  const alto12 = await medirAlto();
  await p.setViewportSize({ width: 1280, height: 800 }); await sleep(300);
  const pie = REG.alto_en_sesion ? REG.alto_en_sesion.scrollH - (REG.alto_en_sesion.clientH - REG.alto_en_sesion.hueco) : null;   // lo que hay debajo de la lista, a 800
  ok('cs12_biblioteca_llena_el_alto_sin_scroll_exterior', !!alto12 && alto12.lista === 1080 - 807 && alto12.scrollH <= alto12.clientH && pie !== null && Math.abs(alto12.hueco - pie) <= 1,
    { alto12, pie });

  // cs6: con el foco en el selector, M, F, flechas y Espacio (y elegir otra opción) NO cambian la salida del
  // motor ni disparan atajos (ni play del reproductor normal ni pantalla completa); en los botones de opción,
  // una flecha cambia la marca pero no los canales del motor.
  const u6a = await cueUi(), q6a = await cueCtx(), e6a = await estado();
  await p.locator('.dj-cue-salida').focus();
  for (const k of ['KeyM', 'KeyF', 'ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Space']) { await p.keyboard.press(k); await sleep(120); }
  await p.evaluate(() => document.activeElement?.blur());
  await p.locator('.dj-cue-salida').selectOption('wave-0001'); await sleep(200);
  await p.locator('.dj-cue-canales input[value="3-4"]').focus();
  await p.keyboard.press('ArrowLeft'); await sleep(150);
  const radio6 = (await cueUi()).radio;
  await p.evaluate(() => document.activeElement?.blur());
  const u6b = await cueUi(), q6b = await cueCtx(), e6b = await estado();
  ok('cs6_teclas_y_selector_no_aplican', u6b.salida === u6a.salida && u6b.canales === u6a.canales && u6b.estado === u6a.estado && u6b.sel === 'wave-0001' && radio6 === '1-2'
    && q6b.sinks.length === q6a.sinks.length && q6b.cues === q6a.cues && q6b.cue?.cuenta === q6a.cue?.cuenta && e6b.plays === e6a.plays && e6b.fullscreen === false && e6b.ruta === '/dj',
  { antes: { salida: u6a.salida, canales: u6a.canales }, despues: { salida: u6b.salida, canales: u6b.canales, sel: u6b.sel }, radio6, plays: e6b.plays - e6a.plays, fullscreen: e6b.fullscreen });

  // cs5: «Quitar» → 'sin-salida' y el contexto de cue cerrado.
  await clicSiHay('.dj-cue-quitar');
  const u5 = await esperarCue((u) => u.estado === 'sin-salida') ?? await cueUi();
  const q5 = await cueCtx();
  ok('cs5_quitar_sin_salida_y_cierra', u5.estado === 'sin-salida' && u5.salida === '' && u5.canales === '1-2' && !u5.quitar && u5.textoEstado === 'Sin salida de audífonos.'
    && q5.cue?.state === 'closed' && u5.alertas === 0, { u5, q5 });

  // cs9: una salida que falla al abrir (setSinkId → NotFoundError): el aviso del motor tal cual, 'error', sin
  // contexto de cue, y el master intacto ('running', A avanza, sin setSinkId, la mezcla igual). «Quitar salida».
  const mezcla9 = await valoresUi();
  await usar('hp-0002', '1-2');
  const u9 = await esperarCue((u) => u.estado === 'error') ?? await cueUi();
  const q9 = await cueCtx();
  const av9 = await avance('A');
  const d9a = await deck('A');
  ok('cs9_error_del_motor_y_master_intacto', u9.estado === 'error' && u9.avisoMotor === 'No se encontró la salida «Headphones (2)». Cue apagado; el master sigue igual.'
    && u9.contexto === '0' && u9.textoEstado === null && u9.alertas === 1 && q9.cue?.state === 'closed' && q9.master === 'running' && q9.sinksMaster === 0
    && d9a.estado === 'sonando' && av9.p1 - av9.p0 > 0.5 && Math.abs((av9.p1 - av9.p0) - av9.pared) <= TOL_S && JSON.stringify(await valoresUi()) === JSON.stringify(mezcla9),
  { u9, q9, av9 });
  await clicSiHay('.dj-cue-quitar-error');
  const u9b = await esperarCue((u) => u.estado === 'sin-salida') ?? await cueUi();
  ok('cs9b_quitar_salida_tras_error', u9b.estado === 'sin-salida' && u9b.alertas === 0 && u9b.avisoMotor === null, { u9b });

  // cs7: devicechange SIN la salida elegida, con el contexto de cue ABIERTO: la página llama a null igual y
  // avisa 'no-conectada'; la lista se vuelve a leer sin pedir el micrófono.
  await usar('hp-0001', '1-2');
  await esperarCue((u) => u.salida === 'hp-0001' && u.estado === 'lista' && u.contexto === '1');
  const f7 = await fdEstado();
  await p.evaluate(() => window.__fd.quitar('hp-0001'));
  const u7 = await esperarCue((u) => u.estado === 'sin-salida') ?? await cueUi();
  const q7 = await cueCtx(), f7b = await fdEstado();
  ok('cs7_devicechange_con_contexto_quita_y_avisa', u7.estado === 'sin-salida' && u7.avisoUi === 'La salida de audífonos «Headphones» no está conectada. Cue apagado.'
    && u7.alertas === 1 && q7.cue?.state === 'closed' && !u7.opciones.some(([id]) => id === 'hp-0001') && f7b.enumeraciones - f7.enumeraciones >= 1 && f7b.gum.length === f7.gum.length,
  { u7: { estado: u7.estado, avisoUi: u7.avisoUi, alertas: u7.alertas, opciones: u7.opciones.map(([id]) => id) }, q7: q7.cue, enumeraciones: f7b.enumeraciones - f7.enumeraciones });
  // cs7b: con el cue en 'error', desaparecer la salida NO duplica el aviso: queda sólo el del motor.
  await p.evaluate(() => window.__fd.poner('hp-0001'));
  await esperarCue((u) => u.opciones.some(([id]) => id === 'hp-0001'));
  await clicSiHay('.dj-cue-cerrar');
  await usar('hp-0002', '1-2');
  await esperarCue((u) => u.estado === 'error');
  await p.evaluate(() => window.__fd.quitar('hp-0002'));
  await esperarCue((u) => !u.opciones.some(([id]) => id === 'hp-0002'));
  await sleep(300);
  const u7b = await cueUi();
  ok('cs7b_devicechange_en_error_sin_duplicar', u7b.estado === 'error' && u7b.salida === 'hp-0002' && u7b.avisoMotor === 'No se encontró la salida «Headphones (2)». Cue apagado; el master sigue igual.'
    && u7b.avisoUi === null && u7b.alertas === 1, { u7b });
  await clicSiHay('.dj-cue-quitar-error');
  await p.evaluate(() => window.__fd.poner('hp-0002'));
  await p.locator(sel('A', '.dj-play')).click(); await esperarDeck('A', (d) => d.estado === 'pausa', 2000);

  // ── ce (sub-paso e3b): botones «Cue», volumen y desfase; la salida que vuelve (i.1) y la pista DDJ (i.2) ──
  // Estado de entrada: A y B cargadas y en pausa, sin salida de cue, la lista completa. Los textos van escritos acá.
  const TXT_E = {
    sin: 'Elige la salida de audífonos en «Audífonos (cue)»', err: 'La salida falló: quítala o elige otra',
    vacio: 'Cue activo: carga una canción y dale play para oírla en los audífonos.',
    pausa: 'Cue activo: dale play para preescuchar. En esta versión el cue no suena en pausa: baja el volumen del deck o el crossfader para que no salga por el master.',
    pista: 'Parece una mezcladora DJ: sus audífonos suelen ir por los canales 3-4.',
    noEncontro2: 'No se encontró la salida «Headphones (2)». Cue apagado; el master sigue igual.',
  };
  const botones = () => p.evaluate(() => Object.fromEntries(['A', 'B'].map((l) => {
    const d = document.querySelector(`.dj-deck[data-lado="${l}"]`);
    const b = d?.querySelector('.dj-cue-btn');
    return [l, b ? { pressed: b.getAttribute('aria-pressed'), disabled: b.disabled, title: b.title, cue: d.dataset.cue,
      nota: d.querySelector('.dj-deck-cue-nota')?.textContent ?? null, foco: document.activeElement === b } : null];
  })));
  const ajustes = () => p.evaluate(() => {
    const s = document.querySelector('.dj-cue');
    const a = s?.querySelector('.dj-cue-ajustes');
    const q = (x) => a?.querySelector(x) ?? null;
    return { hay: !!a, activo: s?.dataset.activo ?? null, volumen: s ? Number(s.dataset.volumen) : null, desfase: s ? Number(s.dataset.desfase) : null,
      volTxt: q('.dj-cue-vol .dj-control-valor')?.textContent ?? null, desTxt: q('.dj-cue-desfase .dj-control-valor')?.textContent ?? null,
      desValor: q('.dj-cue-desfase input') ? Number(q('.dj-cue-desfase input').value) : null,
      pista: s?.querySelector('.dj-cue-pista')?.textContent ?? null, volvio: s?.querySelector('.dj-cue-volvio')?.textContent ?? null };
  });
  // Fuentes de cue creadas (AudioBufferSourceNode conectadas en el ÚLTIMO contexto de cue: una por resincronización)
  // y si la última usa el MISMO AudioBuffer que la última fuente del master.
  const fuentesCue = () => p.evaluate(() => {
    const r = window.__ac;
    const cues = r.lista.filter((c, i) => r.opciones[i] && typeof r.opciones[i] === 'object' && 'sinkId' in r.opciones[i]);
    const c = cues.at(-1), m = r.master();
    const fc = r.aristas.filter(([s]) => s instanceof AudioBufferSourceNode && s.context === c).map(([s]) => s);
    const fm = r.aristas.filter(([s]) => s instanceof AudioBufferSourceNode && s.context === m).map(([s]) => s);
    return { n: fc.length, mismoBuffer: !!fc.at(-1) && fc.at(-1).buffer === fm.at(-1)?.buffer };
  });
  const moverCue = (s, v) => p.evaluate(({ s, v }) => {
    const el = document.querySelector(s);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, { s, v });
  const conDesfase = (n) => esperar(async () => { const a = await ajustes(); return a.desfase === n ? a : null; }, 1500);
  const txtDes = (n) => (n > 0 ? `+${n} ms` : n < 0 ? `−${-n} ms` : '0 ms');

  {   // los casos ce en su propio bloque: sus nombres no chocan con los del resto
    // ce1: el botón Cue de cada deck, deshabilitado sin salida y en 'error' (cada uno con su title) y habilitado con
    // la salida lista; volumen (0,50) y desfase (0 ms) sólo con la salida elegida y sin error.
    const b1a = await botones();
    await usar('hp-0002', '1-2');
    await esperarCue((u) => u.estado === 'error');
    const b1b = await botones(), a1b = await ajustes();
    await clicSiHay('.dj-cue-quitar-error');
    await usar('wave-0001', '1-2');
    await esperarCue((u) => u.salida === 'wave-0001' && u.estado === 'lista' && u.contexto === '1');
    const b1c = await botones(), a1c = await ajustes();
    ok('ce1_cue_deshabilitado_sin_salida_y_en_error', ['A', 'B'].every((l) => b1a[l]?.disabled === true && b1a[l].title === TXT_E.sin && b1a[l].pressed === 'false'
        && b1b[l]?.disabled === true && b1b[l].title === TXT_E.err && b1c[l]?.disabled === false && b1c[l].pressed === 'false' && b1c[l].title === `Preescuchar el deck ${l} en los audífonos`)
      && a1b.hay === false && a1c.hay === true && a1c.volumen === 0.5 && a1c.volTxt === '0,50' && a1c.desfase === 0 && a1c.desTxt === '0 ms',
    { b1a, b1b, b1c, a1b: a1b.hay, a1c });

    // ce2: Cue A con A en pausa → activo (aria-pressed, data-cue, la línea de estado), la nota de V1 y NINGUNA fuente de
    // cue (en pausa no hay); el foco queda en el botón (sin blur).
    const s2 = await fuentesCue();
    await p.locator(sel('A', '.dj-cue-btn')).click();
    const b2 = await botones(), a2 = await ajustes(), u2 = await cueUi(), s2b = await fuentesCue();
    ok('ce2_cue_a_en_pausa_con_nota_y_sin_fuente', b2.A.pressed === 'true' && b2.A.cue === '1' && b2.A.nota === TXT_E.pausa && b2.A.foco && b2.B.pressed === 'false' && b2.B.nota === null
      && a2.activo === 'A' && u2.textoEstado === 'Listo: «Headphones (Elgato Wave:XLR)» · canales 1-2 · cue A.' && s2b.n === s2.n, { b2, activo: a2.activo, estado: u2.textoEstado, s2: s2.n, s2b: s2b.n });

    // ce3: play en A → UNA fuente de cue con el MISMO buffer del master, y la nota se va.
    await p.locator(sel('A', '.dj-play')).click(); await esperarDeck('A', (d) => d.estado === 'sonando', 2000);
    const s3 = await esperar(async () => { const s = await fuentesCue(); return s.n >= s2.n + 1 ? s : null; }, 2000) ?? await fuentesCue();
    await sleep(150);
    const s3b = await fuentesCue(), b3 = await botones();
    ok('ce3_play_crea_la_fuente_de_cue_y_quita_la_nota', s3b.n === s2.n + 1 && s3.mismoBuffer && b3.A.nota === null && b3.A.pressed === 'true', { s2: s2.n, s3b, nota: b3.A.nota });

    // ce4: los dos cues a la vez: «cue A y B»; Cue B en pausa no crea fuente; play en B, una.
    const s4 = await fuentesCue();
    await p.locator(sel('B', '.dj-cue-btn')).click();
    const b4 = await botones(), a4 = await ajustes(), u4 = await cueUi(), s4b = await fuentesCue();
    await p.locator(sel('B', '.dj-play')).click(); await esperarDeck('B', (d) => d.estado === 'sonando', 2000); await sleep(150);
    const s4c = await fuentesCue();
    await p.locator(sel('B', '.dj-play')).click(); await esperarDeck('B', (d) => d.estado === 'pausa', 2000);
    ok('ce4_cue_a_y_b_a_la_vez', b4.A.pressed === 'true' && b4.B.pressed === 'true' && a4.activo === 'AB' && b4.B.nota === TXT_E.pausa
      && u4.textoEstado === 'Listo: «Headphones (Elgato Wave:XLR)» · canales 1-2 · cue A y B.' && s4b.n === s4.n && s4c.n === s4.n + 1 && s4c.mismoBuffer,
    { b4, activo: a4.activo, estado: u4.textoEstado, s4: s4.n, s4b: s4b.n, s4c });

    // ce5 (ajuste del prompt): CARGAR OTRA PISTA en A con su cue activo y A sonando → el cue SIGUE activo (botón y
    // motor), sin fuente de cue hasta el play; al dar play, una fuente de cue con el buffer NUEVO (el del master).
    const s5 = await fuentesCue();
    await cargarEn('A', n3); await esperarDeck('A', (d) => d.titulo === n3.title && d.estado === 'pausa');
    await p.locator('.dj-buscar').fill('');
    const b5 = await botones(), a5 = await ajustes(), s5b = await fuentesCue();
    await p.locator(sel('A', '.dj-play')).click(); await esperarDeck('A', (d) => d.estado === 'sonando', 2000); await sleep(150);
    const s5c = await fuentesCue();
    ok('ce5_cargar_otra_pista_conserva_el_cue', b5.A.pressed === 'true' && b5.A.nota === TXT_E.pausa && a5.activo === 'AB' && s5b.n === s5.n && s5c.n === s5.n + 1 && s5c.mismoBuffer,
      { b5: b5.A, activo: a5.activo, s5: s5.n, s5b: s5b.n, s5c });

    // ce6: el volumen llega al motor como v (el motor aplica v²): 0,25 → 0,25; doble clic → 0,50.
    await moverCue('.dj-cue-vol input', 0.25); await sleep(150);
    const a6 = await ajustes();
    await p.locator('.dj-cue-vol input').dispatchEvent('dblclick'); await sleep(150);
    const a6b = await ajustes();
    ok('ce6_volumen_v_al_motor_y_doble_clic', a6.volumen === 0.25 && a6.volTxt === '0,25' && a6b.volumen === 0.5 && a6b.volTxt === '0,50', { a6, a6b });

    // ce7: cinco flechas seguidas sobre el desfase → «+5 ms» al instante, el motor sigue en 0 (diferido) y después
    // UNA sola aplicación (una fuente de cue nueva: sólo A suena con su cue).
    const s7 = await fuentesCue(), a7 = await ajustes();
    await p.locator('.dj-cue-desfase input').focus();
    const huecos7 = []; let t7 = Date.now();
    for (let i = 0; i < 5; i++) { await p.keyboard.press('ArrowRight'); huecos7.push(Date.now() - t7); t7 = Date.now(); }
    const tUlt7 = Date.now();
    const a7a = await ajustes();
    const a7c = await conDesfase(5) ?? await ajustes();
    const tAp7 = Date.now() - tUlt7;
    await sleep(400);
    const s7b = await fuentesCue();
    await p.evaluate(() => document.activeElement?.blur());
    ok('ce7_desfase_flechas_una_sola_aplicacion', a7.desfase === 0 && a7a.desTxt === '+5 ms' && a7a.desfase === 0 && a7c.desfase === 5 && a7c.desTxt === '+5 ms' && s7b.n === s7.n + 1 && tAp7 < 700,
      { a7a: [a7a.desTxt, a7a.desfase], a7c: [a7c.desTxt, a7c.desfase], fuentes: s7b.n - s7.n, huecos7, tAp7 });

    // ce8: arrastre con el ratón → mientras se arrastra (con pausas de 300 ms, más que el diferido) se mueve el número y
    // NO se aplica; al soltar, UNA aplicación con el valor final.
    const caja = await p.locator('.dj-cue-desfase input').boundingBox();
    const yM = caja.y + caja.height / 2;
    const xDe = (v) => caja.x + 6 + (caja.width - 12) * ((v + 250) / 500);
    const s8 = await fuentesCue(), a8 = await ajustes();
    await p.mouse.move(xDe(a8.desfase), yM); await p.mouse.down();
    await p.mouse.move(xDe(60), yM, { steps: 5 }); await sleep(300);
    const a8a = await ajustes(), s8a = await fuentesCue();
    await p.mouse.move(xDe(110), yM, { steps: 5 }); await sleep(300);
    const a8b = await ajustes();
    await p.mouse.up();
    const a8c = await conDesfase(a8b.desValor) ?? await ajustes();
    await sleep(300);
    const s8c = await fuentesCue();
    ok('ce8_desfase_raton_se_aplica_al_soltar', a8a.desfase === a8.desfase && a8a.desValor > a8.desfase && s8a.n === s8.n && a8b.desfase === a8.desfase && a8b.desValor > a8a.desValor
      && a8c.desfase === a8b.desValor && a8c.desTxt === txtDes(a8b.desValor) && s8c.n === s8.n + 1,
    { antes: a8.desfase, durante: [a8a.desValor, a8a.desfase, a8b.desValor, a8b.desfase], tras: [a8c.desfase, a8c.desTxt], fuentes: [s8a.n - s8.n, s8c.n - s8.n] });

    // ce9: +1 tres veces y −1 una, seguidos → el número cambia al instante, UNA aplicación (+2); doble clic → 0 al
    // instante (sin diferido) y una aplicación más.
    const s9 = await fuentesCue(), a9 = await ajustes();
    for (const b of ['.dj-cue-mas', '.dj-cue-mas', '.dj-cue-mas', '.dj-cue-menos']) await p.locator(b).click();
    const a9a = await ajustes();
    const a9b = await conDesfase(a9.desfase + 2) ?? await ajustes();
    await sleep(400);
    const s9b = await fuentesCue();
    await p.locator('.dj-cue-desfase input').dispatchEvent('dblclick');
    const a9c = await ajustes();
    await sleep(300);
    const s9c = await fuentesCue();
    ok('ce9_desfase_mas_menos_juntan_y_doble_clic_inmediato', a9a.desTxt === txtDes(a9.desfase + 2) && a9a.desfase === a9.desfase && a9b.desfase === a9.desfase + 2 && s9b.n === s9.n + 1
      && a9c.desfase === 0 && a9c.desTxt === '0 ms' && s9c.n === s9b.n + 1,
    { a9: a9.desfase, a9a: [a9a.desTxt, a9a.desfase], a9b: a9b.desfase, a9c: [a9c.desTxt, a9c.desfase], fuentes: [s9b.n - s9.n, s9c.n - s9b.n] });

    // ce13: Fin e Inicio sobre el desfase → ±250 (el recorte del control y del motor); vuelve a 0 con doble clic.
    await p.locator('.dj-cue-desfase input').focus(); await p.keyboard.press('End');
    const a13a = await conDesfase(250) ?? await ajustes();
    await p.keyboard.press('Home');
    const a13b = await conDesfase(-250) ?? await ajustes();
    await p.evaluate(() => document.activeElement?.blur());
    await p.locator('.dj-cue-desfase input').dispatchEvent('dblclick'); await sleep(150);
    ok('ce13_desfase_extremos_250', a13a.desfase === 250 && a13a.desTxt === '+250 ms' && a13b.desfase === -250 && a13b.desTxt === '−250 ms' && a13b.desValor === -250 && (await ajustes()).desfase === 0,
      { a13a: [a13a.desfase, a13a.desTxt], a13b: [a13b.desfase, a13b.desTxt, a13b.desValor] });

    // ce10: teclas. Con el foco en Cue A: Espacio NO lo conmuta (el keydown de captura lo tapa) y las flechas, M y F
    // tampoco hacen nada; Enter SÍ (dos veces: vuelve). M y F sobre volumen y desfase: tapadas (ni mix ni pantalla
    // completa), sin cambiar valores. Registro: Espacio sobre Play de A (el mismo filtro).
    const e10a = await estado(), a10a = await ajustes(), b10a = await botones();
    await p.locator(sel('A', '.dj-cue-btn')).focus();
    await p.keyboard.press('Space'); await sleep(150);
    const b10b = await botones();
    for (const k of ['ArrowRight', 'ArrowLeft', 'KeyM', 'KeyF']) { await p.keyboard.press(k); await sleep(120); }
    const b10c = await botones(), a10c = await ajustes();
    await p.keyboard.press('Enter'); await sleep(150);
    const b10d = await botones();
    await p.keyboard.press('Enter'); await sleep(150);
    const b10e = await botones();
    for (const s of ['.dj-cue-vol input', '.dj-cue-desfase input']) { await p.locator(s).focus(); for (const k of ['KeyM', 'KeyF']) { await p.keyboard.press(k); await sleep(120); } }
    await p.evaluate(() => document.activeElement?.blur());
    await sleep(300);
    const e10b = await estado(), a10b = await ajustes();
    const dA0 = await deck('A');
    await p.locator(sel('A', '.dj-play')).focus(); await p.keyboard.press('Space'); await sleep(200);
    const dA1 = await deck('A');
    await p.evaluate(() => document.activeElement?.blur());
    REG.espacio_sobre_play = { antes: dA0.estado, despues: dA1.estado };
    ok('ce10_teclas_en_cue_y_controles', b10a.A.pressed === 'true' && b10b.A.pressed === 'true' && b10c.A.pressed === 'true' && a10c.desfase === a10a.desfase
      && b10d.A.pressed === 'false' && b10e.A.pressed === 'true' && e10b.plays === e10a.plays && e10b.fullscreen === false && e10b.ruta === '/dj' && e10b.cola === e10a.cola
      && a10b.volumen === a10a.volumen && a10b.desfase === a10a.desfase,
    { pressed: [b10a.A.pressed, b10b.A.pressed, b10c.A.pressed, b10d.A.pressed, b10e.A.pressed], plays: e10b.plays - e10a.plays, fullscreen: e10b.fullscreen, espacioPlay: REG.espacio_sobre_play });

    // ce11: «Usar» con OTRA salida y los dos cues activos → siguen activos (el motor los conserva) y la línea lo dice;
    // «Quitar» → los dos apagados y deshabilitados, sin volumen ni desfase en pantalla.
    await usar('hp-0001', '1-2');
    const u11a = await esperarCue((u) => u.salida === 'hp-0001' && u.estado === 'lista' && u.contexto === '1') ?? await cueUi();
    const b11a = await botones(), a11a = await ajustes();
    await clicSiHay('.dj-cue-quitar');
    await esperarCue((u) => u.estado === 'sin-salida');
    const b11b = await botones(), a11b = await ajustes();
    ok('ce11_cambiar_salida_conserva_y_quitar_apaga', b11a.A.pressed === 'true' && b11a.B.pressed === 'true' && a11a.activo === 'AB' && u11a.textoEstado === 'Listo: «Headphones» · canales 1-2 · cue A y B.'
      && ['A', 'B'].every((l) => b11b[l].pressed === 'false' && b11b[l].disabled === true && b11b[l].title === TXT_E.sin && b11b[l].nota === null) && a11b.activo === '' && a11b.hay === false,
    { b11a, a11a: a11a.activo, estado: u11a.textoEstado, b11b, a11b: [a11b.activo, a11b.hay] });

    // ce14 (i.1): la salida desaparece con el cue A activo → apagado y deshabilitado, aviso de la página; VUELVE (mismo
    // id) → el aviso se quita solo, la salida queda preseleccionada con «… volvió: pulsa «Usar»…» y NO se arma nada
    // (ni setSinkId ni contexto de cue nuevos; el motor sigue sin salida).
    await usar('wave-0001', '1-2');
    await esperarCue((u) => u.salida === 'wave-0001' && u.estado === 'lista' && u.contexto === '1');
    await p.locator(sel('A', '.dj-cue-btn')).click();
    await p.evaluate(() => window.__fd.quitar('wave-0001'));
    const u14a = await esperarCue((u) => u.estado === 'sin-salida' && !!u.avisoUi) ?? await cueUi();
    const b14a = await botones(), q14 = await cueCtx();
    await p.evaluate(() => window.__fd.poner('wave-0001'));
    const u14b = await esperarCue((u) => u.opciones.some(([id]) => id === 'wave-0001') && u.avisoUi === null) ?? await cueUi();
    await sleep(200);
    const a14b = await ajustes(), q14b = await cueCtx(), b14b = await botones();
    ok('ce14_volvio_quita_el_aviso_de_la_pagina', u14a.avisoUi === 'La salida de audífonos «Headphones (Elgato Wave:XLR)» no está conectada. Cue apagado.' && b14a.A.pressed === 'false' && b14a.A.disabled === true
      && u14b.avisoUi === null && a14b.volvio === '«Headphones (Elgato Wave:XLR)» volvió: pulsa «Usar» para activarla.' && u14b.sel === 'wave-0001' && u14b.estado === 'sin-salida' && u14b.salida === ''
      && u14b.alertas === 0 && q14b.sinks.length === q14.sinks.length && q14b.cues === q14.cues && b14b.A.disabled === true && b14b.A.pressed === 'false',
    { u14a: u14a.avisoUi, u14b: { avisoUi: u14b.avisoUi, sel: u14b.sel, estado: u14b.estado, alertas: u14b.alertas }, volvio: a14b.volvio, sinks: q14b.sinks.length - q14.sinks.length, cues: q14b.cues - q14.cues });

    // ce15 (i.1): 'error' del motor con la salida que DESPUÉS falta y vuelve → el error se limpia (fijarSalidaCue(null)),
    // queda preseleccionada con el texto y no se arma nada.
    await usar('hp-0002', '1-2');
    await esperarCue((u) => u.estado === 'error');
    const q15 = await cueCtx();
    await p.evaluate(() => window.__fd.quitar('hp-0002'));
    const u15a = await esperarCue((u) => !u.opciones.some(([id]) => id === 'hp-0002')) ?? await cueUi();
    await p.evaluate(() => window.__fd.poner('hp-0002'));
    const u15b = await esperarCue((u) => u.estado === 'sin-salida') ?? await cueUi();
    await sleep(200);
    const a15b = await ajustes(), q15b = await cueCtx();
    ok('ce15_volvio_quita_el_error_del_motor', u15a.estado === 'error' && u15a.avisoMotor === TXT_E.noEncontro2 && u15b.estado === 'sin-salida' && u15b.avisoMotor === null && u15b.alertas === 0
      && a15b.volvio === '«Headphones (2)» volvió: pulsa «Usar» para activarla.' && u15b.sel === 'hp-0002' && q15b.sinks.length === q15.sinks.length && q15b.cues === q15.cues,
    { u15a: [u15a.estado, u15a.avisoMotor], u15b: [u15b.estado, u15b.avisoMotor, u15b.sel, u15b.alertas], volvio: a15b.volvio, sinks: q15b.sinks.length - q15.sinks.length });

    // ce16 (i.1): un 'error' con la salida que NUNCA faltó (cambia OTRA de la lista) no se toca.
    await usar('hp-0002', '1-2');
    await esperarCue((u) => u.estado === 'error');
    await p.evaluate(() => window.__fd.quitar('hp-0001'));
    await esperarCue((u) => !u.opciones.some(([id]) => id === 'hp-0001'));
    await p.evaluate(() => window.__fd.poner('hp-0001'));
    await esperarCue((u) => u.opciones.some(([id]) => id === 'hp-0001'));
    await sleep(300);
    const u16 = await cueUi(), a16 = await ajustes();
    ok('ce16_error_sin_faltar_no_se_toca', u16.estado === 'error' && u16.salida === 'hp-0002' && u16.avisoMotor === TXT_E.noEncontro2 && a16.volvio === null && u16.alertas === 1,
      { u16: [u16.estado, u16.salida, u16.avisoMotor, u16.alertas], volvio: a16.volvio });
    await clicSiHay('.dj-cue-quitar-error');
    await esperarCue((u) => u.estado === 'sin-salida');

    // ce17 (i.2): la pista DDJ sólo con «DDJ» en el nombre y 1-2 marcado; nunca junto al «Ojo»; no cambia nada.
    // Con 1-2 ya marcado, cambiar SÓLO el selector a la DDJ: la pista sale y los canales NO se mueven (no elige nada).
    await elegir('wave-0001', '1-2');
    await p.locator('.dj-cue-salida').selectOption('ddj-0001'); await sleep(100);
    const a17a = await ajustes(), u17a = await cueUi();
    await elegir('ddj-0001', '3-4'); await sleep(100);
    const a17b = await ajustes(), u17b = await cueUi();
    await elegir('wave-0001', '1-2'); await sleep(100);
    const a17c = await ajustes(), u17c = await cueUi();
    ok('ce17_pista_ddj_solo_con_12', a17a.pista === TXT_E.pista && !u17a.ojo && u17a.radio === '1-2' && u17a.sel === 'ddj-0001' && a17b.pista === null && u17b.ojo
      && a17c.pista === null && !u17c.ojo && u17c.salida === '' && u17c.estado === 'sin-salida',
    { a: [a17a.pista, u17a.ojo], b: [a17b.pista, u17b.ojo], c: [a17c.pista, u17c.ojo, u17c.salida] });

    // ce12: sin desborde a 1024, 1280 y 1366 px (800 de alto), en el peor caso: salida lista con volumen y desfase,
    // los dos Cue activos y los dos decks en pausa (con su nota). Nada de .dj-page pasa del borde derecho del contenido
    // de .main-content, .main-content no scrollea en horizontal y los controles de cada deck no salen de su tarjeta.
    await usar('wave-0001', '1-2');
    await esperarCue((u) => u.salida === 'wave-0001' && u.estado === 'lista' && u.contexto === '1');
    for (const l of ['A', 'B']) if ((await botones())[l].pressed !== 'true') await p.locator(sel(l, '.dj-cue-btn')).click();
    if ((await deck('A')).estado === 'sonando') { await p.locator(sel('A', '.dj-play')).click(); await esperarDeck('A', (d) => d.estado === 'pausa', 2000); }
    const medirAncho = () => p.evaluate(() => {
      const sc = document.querySelector('.main-content'), pg = document.querySelector('.dj-page');
      const der = sc.getBoundingClientRect().left + sc.clientLeft + sc.clientWidth - parseFloat(getComputedStyle(sc).paddingRight);
      const fuera = [...pg.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > der + 0.5; })
        .map((e) => (typeof e.className === 'string' && e.className ? e.className : e.tagName)).slice(0, 8);
      const decks = [...document.querySelectorAll('.dj-deck')].map((d) => {
        const r = d.getBoundingClientRect(), pr = parseFloat(getComputedStyle(d).paddingRight);
        const hijos = [...d.querySelectorAll('.dj-deck-controles > *')];
        const centro = (h) => { const q = h.getBoundingClientRect(); return Math.round((q.top + q.bottom) / 2); };   // align-items: center
      return { fuera: hijos.filter((h) => h.getBoundingClientRect().right > r.right - pr + 0.5).length, filas: new Set(hijos.map(centro)).size, ancho: Math.round(r.width) };
      });
      return { vw: innerWidth, scrollW: sc.scrollWidth, clientW: sc.clientWidth, fuera, decks };
    });
    const anchos12 = {};
    for (const w of [1024, 1280, 1366]) { await p.setViewportSize({ width: w, height: 800 }); await sleep(300); anchos12[w] = await medirAncho(); }
    // ce12b: 900 px, el ancho mínimo con los decks lado a lado (por debajo van uno sobre otro y sale el aviso).
    await p.setViewportSize({ width: 900, height: 800 }); await sleep(300);
    const a900 = await medirAncho();
    REG.controles_deck_filas_900 = a900.decks.map((d) => d.filas);
    ok('ce12b_sin_desborde_a_900', a900.scrollW <= a900.clientW && a900.fuera.length === 0 && a900.decks.length === 2 && a900.decks.every((d) => d.fuera === 0), { a900 });
    await p.setViewportSize({ width: 1280, height: 800 }); await sleep(300);
    REG.alto_con_notas_y_ajustes = await medirAlto();
    REG.controles_deck_filas = Object.fromEntries(Object.entries(anchos12).map(([w, m]) => [w, m.decks.map((d) => d.filas)]));
    ok('ce12_sin_desborde_a_1024_1280_1366', Object.values(anchos12).every((m) => m.scrollW <= m.clientW && m.fuera.length === 0 && m.decks.length === 2 && m.decks.every((d) => d.fuera === 0)),
      { anchos12 });
    await clicSiHay('.dj-cue-quitar');
    await esperarCue((u) => u.estado === 'sin-salida');

  }

  // cs11: salir de /dj quita el oyente de devicechange; volver pone UNO.
  const oy11a = (await fdEstado()).oyentes;
  await irA('Biblioteca');
  const oy11b = await p.evaluate(() => window.__fd.oyentes());
  await irA('Modo DJ'); await p.waitForSelector('.dj-cue', { timeout: 15000 }).catch(() => {});
  const oy11c = await p.evaluate(() => window.__fd.oyentes());
  ok('cs11_salir_quita_el_oyente_de_devicechange', oy11a === 1 && oy11b === 0 && oy11c === 1, { oy11a, oy11b, oy11c });

  {
    // ce18 (e3b): con el motor NUEVO (decks vacíos), Cue A activo → la nota «carga una canción…»; B sin nota.
    await clicSiHay('.dj-cue-ver');
    await esperarCue((u) => u.lista === 'lista');
    await usar('wave-0001', '1-2');
    await esperarCue((u) => u.salida === 'wave-0001' && u.estado === 'lista' && u.contexto === '1');
    await p.locator(sel('A', '.dj-cue-btn')).click();
    const b18 = await botones();
    ok('ce18_cue_con_el_deck_vacio_nota', b18.A.pressed === 'true' && b18.A.nota === TXT_E.vacio && b18.B.pressed === 'false' && b18.B.nota === null, { b18 });
    await clicSiHay('.dj-cue-quitar');
  }

  // cs8: permiso ya dado al montar → la lista sin botón y sin getUserMedia.
  await recargarCue({ permiso: 'granted' });
  const u8 = await esperarCue((u) => u.lista === 'lista') ?? await cueUi();
  const f8 = await fdEstado();
  ok('cs8_granted_al_montar_lista_sin_boton', u8.lista === 'lista' && !u8.boton && JSON.stringify(u8.opciones) === JSON.stringify(OPCIONES) && f8.gum.length === 0, { u8, f8 });
  // cs2: denegado (el botón queda para reintentar) y sin micrófono, con recargas.
  await recargarCue({ gum: 'NotAllowedError' });
  await clicSiHay('.dj-cue-ver');
  const u2a = await esperarCue((u) => u.lista === 'denegado') ?? await cueUi();
  await recargarCue({ gum: 'NotFoundError' });
  await clicSiHay('.dj-cue-ver');
  const u2b = await esperarCue((u) => u.lista === 'sin-microfono') ?? await cueUi();
  ok('cs2_denegado_y_sin_microfono', u2a.lista === 'denegado' && u2a.textoLista === TXT.denegado && u2a.boton && u2a.opciones.length === 0
    && u2b.lista === 'sin-microfono' && u2b.textoLista === TXT.sinMicro && u2b.opciones.length === 0, { u2a, u2b });
  await p.evaluate(() => sessionStorage.removeItem('__fdCfg'));

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
