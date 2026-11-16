// MODO DJ · motor de audio (Web Audio). Sin React. Independiente del reproductor normal: no toca el
// <audio> de PlayerContext ni MediaSession.
//
// GRAFO (sub-paso c, la mezcla; con ratón y, desde el sub-paso d, con el DDJ-400 por midi.js):
//   deck A: fuente ─ volA ─ xfA ─┐
//                                ├─ bus ─ lp ─ hp ─ master ─ destination
//   deck B: fuente ─ volB ─ xfB ─┘
//   · volA/volB (GainNode): volumen del deck, ganancia = v² (gananciaVolumen de mezcla.js).
//   · xfA/xfB (GainNode): crossfader de igual potencia (potenciaIgual: cos / sin).
//   · bus (GainNode, 1): suma los dos decks. lp y hp (BiquadFilterNode 'lowpass' y 'highpass', en
//     serie, SIEMPRE conectados): el filtro, sobre la mezcla, en el mismo punto que el prototipo. El
//     control sólo mueve sus frecuencias (filtroFrecuencias); el .type se pone al crearlos y nunca más.
//   · master (GainNode, 1). SIN limitador ni compresor: dos pistas fuertes sumadas pueden pasar de 0 dBFS.
//
// LOS VALORES DE MEZCLA (fijarVolumen, fijarCrossfader, fijarFiltro) viven en el motor, no en el
// contexto: antes del primer «Cargar» sólo se guardan, y se usan como valor inicial al crear los nodos.
// Con el contexto vivo, todo cambio va con setTargetAtTime(valor, currentTime, TAU): una rampa
// exponencial corta en vez de un salto (un salto de ganancia o de frecuencia se oye como clic o
// «zipper»). Después de crear un nodo NUNCA se escribe .value. Los nodos de mezcla no se recrean con
// play, seek ni al cargar otra pista (cada fuente nueva se conecta al vol de su deck), así que los
// valores siguen.
//
// EL AudioContext:
//   · Se crea PEREZOSO, en asegurarContexto(), que DjPage llama dentro del clic de «Cargar» (gesto del
//     usuario: sin gesto Chrome lo deja 'suspended'). Crear el motor NO crea el contexto: por eso el
//     doble montaje de StrictMode (crear → cerrar → crear) no abre ninguno.
//   · UNO SOLO en toda la página: si al crear uno hay otro motor con su contexto abierto, primero se
//     cierra ése (duenoActual). DjPage además cierra el suyo al desmontarse (cerrar()).
//   · Opciones: sampleRate (por defecto TASA_DJ = 44 100, ver abajo; se puede pedir otra) y
//     latencyHint 'interactive'.
//
// UN DECK: un AudioBufferSourceNode es de UN SOLO USO (start() una vez), así que cada play y cada seek
// sonando crean uno nuevo; pausar es pararlo y recordar dónde iba.
// posicion() = context.currentTime − (momento en que «empezó» la posición 0), recortada a [0, duración].
// Es la posición en el GRAFO; lo que se OYE va atrasado en context.outputLatency (no se descuenta).
//
// CUE A AUDÍFONOS (sub-paso e2). Un SEGUNDO AudioContext, sólo para los audífonos; el master no cambia
// (sigue en la salida predeterminada y NUNCA se le llama setSinkId):
//   deck A: fuenteCueA ─ cueA (Gain 0|1) ─┐
//                                          ├─ cueVol (Gain v², volumenCue) ─ destination (audífonos)
//   deck B: fuenteCueB ─ cueB (Gain 0|1) ─┘
//   · PRE-fader: el cue no pasa por vol, xf ni el filtro, y no se conecta a ningún nodo del master.
//     fuenteCue.buffer es el MISMO AudioBuffer del deck (decodificado una vez, con el master).
//   · PEREZOSO: se crea al activar el primer cue (fijarCue, dentro de un clic) con sinkId { type: 'none' }
//     (no abre ningún dispositivo), después setSinkId(id) y se espera 'running' (tope ESPERA_CUE_MS).
//     Desde e3a también al ELEGIR la salida con fijarSalidaCue(id, nombre, { abrir: true }) (el «Usar» de
//     la página, otro clic): se abre sin activar ningún cue y queda abierto y en silencio (cueA/cueB en 0).
//     Recién entonces se crean los nodos. Si setSinkId falla, el contexto queda en 'none' (mudo) y se
//     cierra: nunca suena por la salida predeterminada, que es la del master. (Un contexto creado SIN
//     sinkId que falla setSinkId se queda en la predeterminada: medido en Chromium, ver cue.js.)
//   · SINCRONÍA: cada fuente de cue se crea con planCue (cue.js) en play, seek, «Al inicio», al activar
//     el cue, al cambiar el desfase o la salida y cuando el contexto de cue vuelve a 'running'. NUNCA en
//     continuo (recrear la fuente se oye). Deck en pausa o terminado → sin fuente de cue.
//   · FALLOS (setSinkId que rechaza, no llega a 'running', 'error', sinkchange que no se pidió, 'closed'
//     inesperado): el cue se apaga, su contexto se cierra, estado 'error' con un aviso (textoAviso) y el
//     master no se toca. El motor nunca lanza.
//   · Lo cierra cerrar(), junto con el master; duenoActual no cambia (cerrar un motor cierra los dos).
//   · CANALES (sub-paso e2c; opt-in con fijarSalidaCue(id, nombre, { canales })). '1-2' (por defecto):
//     cueVol ─ destination, sin tocar el destination. '3-4' (el jack de audífonos de la DDJ-400):
//       cueVol ─ adaptador (Gain, 2 canales 'explicit' 'speakers') ─ ChannelSplitter(2) ─┬─ 0 → entrada 2 ─ ChannelMerger(4) ─ destination
//                                                                                        └─ 1 → entrada 3 ─┘   (entradas 0 y 1 sin conectar = silencio)
//     destination.channelCount = 4 y channelInterpretation = 'discrete' se ponen con el contexto ya en
//     'running', después de setSinkId y ANTES de conectar nada al destination; con maxChannelCount < 4 →
//     fallo 'sin-canales-3-4'. El adaptador NO es opcional: el splitter es 'discrete' y fijo, así que una
//     pista mono le llegaría sólo al canal 0 (un oído); 'speakers' la copia a los dos (medido en Chromium
//     con un OfflineAudioContext). La etapa está DESPUÉS de cueA/cueB, donde se conectan las fuentes: no
//     cambia K, planCue ni cuándo se resincroniza. Cambiar `canales` en la misma salida rearma sólo esta
//     etapa (sin setSinkId, sin contexto nuevo, sin resincronizar); antes de un setSinkId a otra salida la
//     etapa '3-4' se desmonta y el destination vuelve a 2 canales 'speakers'.

import { potenciaIgual, gananciaVolumen, filtroFrecuencias } from './mezcla.js';
import { VOLUMEN_CUE_INICIAL, volumenCue, recortarDesfase, offsetRelojes, planCue, textoAviso, validarCanales } from './cue.js';

// TASA DEL CONTEXTO DEL MODO DJ: 44 100 Hz, no la nativa de la salida. decodeAudioData remuestrea a la
// tasa del contexto, así que ésta decide cuánto tarda decodificar y cuánto ocupa cada deck.
// Medido en Edge 157 con el prototipo DJ (ronda 4, fuera del repo), frente al contexto a 96 kHz nativo
// de la máquina de desarrollo:
//   · decodificar es ≈ 3 veces más rápido y ocupa 2,18 veces menos memoria (96 000 / 44 100 = 2,18);
//   · la latencia que REPORTA el navegador es idéntica a 44 100, 48 000 y 96 000 (10 ms base, 42 ms
//     de salida; es lo que dice el navegador, no una medición física);
//   · los latencyHint numéricos (0, 3, 5, 10 ms) no cambian nada, así que latencyHint sigue en
//     'interactive'.
export const TASA_DJ = 44100;

// Constante de tiempo de las rampas de mezcla (s): en 5·TAU = 50 ms el parámetro recorre el 99,3 % del
// salto. Es la del prototipo (sección 5, «sin zipper»).
export const TAU = 0.01;
// Q de los dos biquad, la del prototipo. En 'lowpass'/'highpass' la Q de BiquadFilterNode es una
// resonancia en dB en el corte, no la Q clásica: 0,707 dB es un pico chico, no un Butterworth.
export const Q_FILTRO = 0.707;
// Valores de mezcla de un motor nuevo: volumen al máximo, crossfader al centro, filtro plano.
export const MEZCLA_INICIAL = Object.freeze({ volumen: Object.freeze({ A: 1, B: 1 }), crossfader: 0.5, filtro: 0 });
// Cue: cada fuente de cue arranca GUARDA_CUE s después de programarla (así el instante no queda en el
// pasado del reloj del cue), y el contexto de cue tiene ESPERA_CUE_MS para volver a 'running' después
// de setSinkId (en Chromium pasa ~5 ms por 'suspended'); si no vuelve, es un error.
export const GUARDA_CUE = 0.025;
export const ESPERA_CUE_MS = 2000;

let duenoActual = null;   // el motor que tiene un AudioContext abierto ahora (a lo sumo uno)

const recortar = (x, min, max) => (x < min ? min : x > max ? max : x);
const finito = (v) => typeof v === 'number' && Number.isFinite(v);

// `alFuente(evento)`: el cue se entera cuando el deck arranca una fuente ('arranco': play, seek sonando)
// y cuando la suelta o termina ('solto': pausa, seek, cargar, descargar, fin). No cambia nada del master.
function crearDeck(avisar, alFuente = () => {}) {
  const avisarCue = (evento) => { try { alFuente(evento); } catch { /* el cue nunca frena al master */ } };
  let ctx = null;
  let entrada = null;   // el GainNode de volumen del deck: cada fuente nueva se conecta acá
  let buffer = null;
  let meta = null;
  let fuente = null;
  let sonando = false;
  let parado = 0;    // posición mientras NO suena (s)
  let cero = 0;      // context.currentTime que corresponde a la posición 0 mientras suena

  function soltarFuente() {
    if (!fuente) return;
    const f = fuente;
    fuente = null;
    f.onended = null;
    try { f.stop(); } catch { /* ya parada */ }
    f.disconnect();
    avisarCue('solto');
  }

  function arrancar(desde) {
    const f = ctx.createBufferSource();
    f.buffer = buffer;
    f.connect(entrada);
    // Llega al final: queda parado AL FINAL (play de nuevo arranca desde 0, ver play()).
    f.onended = () => {
      if (fuente !== f) return;
      fuente = null;
      sonando = false;
      parado = buffer ? buffer.duration : 0;
      avisarCue('solto');
      avisar();
    };
    f.start(0, desde);
    fuente = f;
    cero = ctx.currentTime - desde;
    sonando = true;
    avisarCue('arranco');
  }

  const deck = {
    _conectar(c, nodoEntrada) {
      ctx = c;
      entrada = nodoEntrada;
    },
    _soltar() { soltarFuente(); sonando = false; buffer = null; meta = null; parado = 0; ctx = null; entrada = null; },
    // Para el cue: el buffer (el MISMO que suena en el master), si suena y su `cero` (el currentTime DEL
    // MASTER que corresponde a la posición 0 mientras suena).
    _reloj() { return { buffer, sonando, cero }; },

    // Reemplaza lo cargado (lo que sonaba se para). `meta`: lo que la página quiera guardar (pista, registro).
    cargarBuffer(b, m = null) {
      soltarFuente();
      sonando = false;
      buffer = b;
      meta = m;
      parado = 0;
      avisar();
    },
    play() {
      if (!buffer || !ctx || sonando || ctx.state === 'closed') return false;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      arrancar(parado >= buffer.duration ? 0 : parado);
      avisar();
      return true;
    },
    pausa() {
      if (!sonando) return;
      parado = deck.posicion();
      soltarFuente();
      sonando = false;
      avisar();
    },
    // Mueve la posición; si sonaba sigue sonando desde ahí. Más allá del final = parado al final.
    seek(segundos) {
      if (!buffer) return;
      const t = recortar(Number(segundos) || 0, 0, buffer.duration);
      if (sonando) {
        soltarFuente();
        if (t >= buffer.duration) { sonando = false; parado = buffer.duration; }
        else arrancar(t);
      } else {
        parado = t;
      }
      avisar();
    },
    // Vuelve a 0 sin cambiar si suena o no (como seek(0)).
    alInicio() { deck.seek(0); },
    posicion() {
      if (!buffer) return 0;
      if (!sonando || !ctx) return parado;
      return recortar(ctx.currentTime - cero, 0, buffer.duration);
    },
    // Libera el buffer (y la memoria decodificada, cuando el GC lo recoja).
    descargar() {
      soltarFuente();
      sonando = false;
      buffer = null;
      meta = null;
      parado = 0;
      avisar();
    },
    estado() {
      return { cargado: !!buffer, sonando, duracion: buffer ? buffer.duration : 0, meta };
    },
  };
  return deck;
}

// `sampleRate`: TASA_DJ si no se pasa. Para volver a la nativa de la salida, pasar null o 0 (el
// AudioContext se crea sin sampleRate). `esperaCueMs`: el tope para que el contexto de cue vuelva a
// 'running' después de setSinkId (ESPERA_CUE_MS; las pruebas lo bajan).
export function crearMotor({ sampleRate = TASA_DJ, latencyHint = 'interactive', esperaCueMs = ESPERA_CUE_MS } = {}) {
  let ctx = null;
  let nodos = null;   // { A: { vol, xf }, B: { vol, xf }, bus, lp, hp, master } mientras hay contexto
  let cerrado = false;
  const oyentes = new Set();
  const alCierre = new Set();   // lo que hay que soltar al cerrar (alCerrar)
  const avisar = () => { for (const fn of oyentes) fn(); };
  // Estado del cue (ver la cabecera). `gen` crece con cada apertura/setSinkId y con cada cierre o fallo:
  // un resultado de setSinkId que llega con otra generación es viejo y se descarta (gana el último).
  const cue = {
    ctx: null, nodos: null,              // nodos = { A: Gain, B: Gain, vol: Gain } con el contexto en 'running'
    salida: null, nombre: '', pedido: null,   // pedido = el id del último setSinkId
    estado: 'sin-salida', aviso: null,
    activo: { A: false, B: false },
    volumen: VOLUMEN_CUE_INICIAL, desfaseMs: 0,
    fuentes: { A: null, B: null },
    gen: 0, quitarOyentes: null, cortarEspera: null,
    ultimaSync: null,   // { K, t (performance.now) } de la última fuente de cue creada; sólo lo lee diagCue
    canales: '1-2',     // los elegidos (e2c)
    etapa: null,        // { canales, nodos } = la salida armada entre cueVol y el destination
  };
  const ahora = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const decks = { A: crearDeck(avisar, (ev) => alFuenteDeck('A', ev)), B: crearDeck(avisar, (ev) => alFuenteDeck('B', ev)) };
  // Valores OBJETIVO de la mezcla (los del control, no lo que vale el AudioParam en este instante).
  const mezcla = { volumen: { ...MEZCLA_INICIAL.volumen }, crossfader: MEZCLA_INICIAL.crossfader, filtro: MEZCLA_INICIAL.filtro };

  // Con el contexto vivo, una rampa hacia `v`; sin contexto (o cerrado), nada: el valor ya quedó
  // guardado en `mezcla` y se aplica al crear los nodos. Nunca lanza.
  const vivo = () => !!ctx && !!nodos && ctx.state !== 'closed';
  function rampa(param, v) {
    try { param.setTargetAtTime(v, ctx.currentTime, TAU); } catch { /* contexto cerrándose */ }
  }

  // ── Cue (ver la cabecera) ──
  const cueListo = () => !!cue.ctx && !!cue.nodos && cue.estado === 'lista' && cue.ctx.state === 'running';
  function rampaCue(param, v) {
    try { param.setTargetAtTime(v, cue.ctx.currentTime, TAU); } catch { /* contexto cerrándose */ }
  }
  // Para la fuente de cue de un deck. `enRampa`: apagar el cue (la ganancia ya baja con TAU; la fuente
  // se para en 6·TAU, cuando ya no se oye). Si no, de golpe (resincronizar, pausa, fin, cierre).
  function pararFuenteCue(lado, enRampa = false) {
    const f = cue.fuentes[lado];
    if (!f) return;
    if (enRampa && cue.ctx) {
      try { f.stop(cue.ctx.currentTime + 6 * TAU); } catch { /* ya parada */ }
      return;   // sigue en cue.fuentes hasta su onended (o hasta que se pare de golpe)
    }
    cue.fuentes[lado] = null;
    f.onended = null;
    try { f.stop(); } catch { /* ya parada */ }
    try { f.disconnect(); } catch { /* ya desconectada */ }
  }
  // Crea la fuente de cue de un deck en la posición que el deck tiene en el master (planCue). Sólo con el
  // cue de ese deck activo, el contexto de cue en 'running' y el deck sonando.
  function sincronizarCue(lado) {
    pararFuenteCue(lado);
    if (cerrado || !cue.activo[lado] || !cueListo() || !ctx || ctx.state === 'closed') return;
    const r = decks[lado]._reloj();
    if (!r.sonando || !r.buffer) return;
    const cc = cue.ctx;
    const salida = (c) => { try { return c.getOutputTimestamp?.() ?? null; } catch { return null; } };
    // Los dos relojes en la MISMA tarea.
    const k = offsetRelojes({ salidaMaster: salida(ctx), salidaCue: salida(cc), tiempoMaster: ctx.currentTime, tiempoCue: cc.currentTime });
    if (!k) return;
    const plan = planCue({ cero: r.cero, K: k.K, desfaseMs: cue.desfaseMs, cuandoCue: cc.currentTime + GUARDA_CUE, duracion: r.buffer.duration });
    if (!plan.crear) return;
    try {
      const f = cc.createBufferSource();
      f.buffer = r.buffer;
      f.connect(cue.nodos[lado]);
      f.onended = () => {
        if (cue.fuentes[lado] !== f) return;
        cue.fuentes[lado] = null;
        try { f.disconnect(); } catch { /* ya desconectada */ }
      };
      f.start(plan.cuando, plan.offset);
      cue.fuentes[lado] = f;
      cue.ultimaSync = { K: k.K, t: ahora() };   // sólo para diagCue
    } catch { /* contexto cerrándose */ }
  }
  const sincronizarCues = () => { for (const lado of ['A', 'B']) sincronizarCue(lado); };
  function alFuenteDeck(lado, evento) {
    if (cerrado) return;
    if (evento === 'arranco') sincronizarCue(lado);
    else pararFuenteCue(lado);
  }
  function ponerEstadoCue(estado, aviso = null) {
    cue.estado = estado;
    cue.aviso = aviso;
    avisar();
  }
  // Cierra el contexto de cue (sin aviso). Invalida lo que esté en vuelo (gen) y corta la espera de 'running'.
  function cerrarCtxCue() {
    cue.gen++;
    cue.cortarEspera?.();
    cue.cortarEspera = null;
    for (const lado of ['A', 'B']) pararFuenteCue(lado);
    cue.quitarOyentes?.();
    cue.quitarOyentes = null;
    const c = cue.ctx;
    cue.ctx = null;
    cue.nodos = null;
    cue.etapa = null;
    cue.pedido = null;
    cue.ultimaSync = null;   // la K de otro contexto no vale para el próximo
    if (c) { try { c.close().catch(() => {}); } catch { /* ya cerrado */ } }
  }
  // Un fallo del cue: se apaga, se cierra su contexto y queda el aviso. El master no se toca.
  function fallaCue(motivo) {
    if (cue.nodos) rampaCue(cue.nodos.vol.gain, 0);
    cerrarCtxCue();
    cue.activo = { A: false, B: false };
    ponerEstadoCue('error', textoAviso(motivo, cue.nombre));
  }
  // Espera a que el contexto esté en 'running' (tope esperaCueMs). Rechaza con { name }.
  function esperarRunning(c) {
    if (c.state === 'running') return Promise.resolve();
    if (c.state === 'closed') return Promise.reject({ name: 'desconectada' });
    try { c.resume().catch(() => {}); } catch { /* sin resume */ }
    return new Promise((res, rej) => {
      let t = 0;
      const f = () => { if (c.state === 'running') fin(); else if (c.state === 'closed') fin({ name: 'desconectada' }); };
      const fin = (err) => {
        clearTimeout(t);
        c.removeEventListener('statechange', f);
        if (cue.cortarEspera === cortar) cue.cortarEspera = null;
        if (err) rej(err); else res();
      };
      const cortar = () => fin({ name: 'InvalidStateError' });
      cue.cortarEspera = cortar;
      t = setTimeout(() => fin({ name: 'TimeoutError' }), esperaCueMs);
      c.addEventListener('statechange', f);
    });
  }
  // Crea el contexto de cue (perezoso, DENTRO DEL GESTO): con sinkId { type: 'none' }, sin abrir ningún
  // dispositivo. Sus oyentes vigilan lo que no se pidió. Lanza si el navegador no puede (lo atrapa abrirCue).
  function crearCtxCue() {
    if (typeof AudioContext !== 'function' || typeof AudioContext.prototype.setSinkId !== 'function') {
      throw Object.assign(new Error('setSinkId no existe'), { name: 'NotSupportedError' });
    }
    const c = new AudioContext({ sampleRate: TASA_DJ, latencyHint: 'interactive', sinkId: { type: 'none' } });
    const alEstado = () => {
      if (cue.ctx !== c) return;
      if (c.state === 'closed') fallaCue('desconectada');
      else if (c.state === 'running' && cue.estado === 'lista') sincronizarCues();   // volvió a 'running'
    };
    const alError = () => { if (cue.ctx === c) fallaCue('desconectada'); };
    const alSink = () => {
      if (cue.ctx !== c || cue.estado === 'abriendo') return;
      if (typeof c.sinkId === 'string' && c.sinkId === cue.pedido) return;   // es el nuestro (tarde)
      fallaCue('desconectada');
    };
    c.addEventListener('statechange', alEstado);
    c.addEventListener('error', alError);
    c.addEventListener('sinkchange', alSink);
    cue.quitarOyentes = () => {
      c.removeEventListener('statechange', alEstado);
      c.removeEventListener('error', alError);
      c.removeEventListener('sinkchange', alSink);
    };
    cue.ctx = c;
  }
  // La etapa de salida del cue (ver CANALES en la cabecera), entre cueVol y el destination. Con el contexto
  // en 'running' y los nodos creados. → null si quedó armada; si no, el motivo del fallo (lo atiende quien
  // llama, con fallaCue: cierra el contexto, así que lo que haya quedado a medias no importa). No lanza.
  function montarSalidaCue(c) {
    const vol = cue.nodos.vol;
    if (cue.canales === '1-2') {
      vol.connect(c.destination);
      cue.etapa = { canales: '1-2', nodos: [] };
      return null;
    }
    const d = c.destination;
    let max = 0;
    try { max = d.maxChannelCount; } catch { /* sin dato = sin canales */ }
    if (!(max >= 4)) return 'sin-canales-3-4';
    try {
      d.channelCount = 4;
      d.channelInterpretation = 'discrete';
      const ad = c.createGain();   // ganancia 1 por defecto: sin escribir .value
      ad.channelCount = 2;
      ad.channelCountMode = 'explicit';
      ad.channelInterpretation = 'speakers';
      const sp = c.createChannelSplitter(2);
      const mg = c.createChannelMerger(4);
      vol.connect(ad);
      ad.connect(sp);
      sp.connect(mg, 0, 2);
      sp.connect(mg, 1, 3);
      mg.connect(d);
      cue.etapa = { canales: '3-4', nodos: [ad, sp, mg] };
      return null;
    } catch (e) {
      return e?.name || 'error';
    }
  }
  // Desarma la etapa: desconecta cueVol y sus nodos y, si era '3-4', el destination vuelve a 2 canales
  // 'speakers' (sus valores por defecto). No lanza.
  function desmontarSalidaCue(c) {
    const e = cue.etapa;
    cue.etapa = null;
    if (!e || !cue.nodos) return;
    try { cue.nodos.vol.disconnect(); } catch { /* ya desconectado */ }
    for (const n of e.nodos) { try { n.disconnect(); } catch { /* ya desconectado */ } }
    if (e.canales === '3-4') {
      try { c.destination.channelCount = 2; c.destination.channelInterpretation = 'speakers'; } catch { /* contexto cerrándose */ }
    }
  }
  // setSinkId a la salida elegida (creando el contexto si no hay), espera 'running', crea los nodos si
  // faltan, arma la etapa de salida (canales) y resincroniza. → { ok, error? }; NUNCA rechaza. Gana la
  // última llamada (gen).
  async function abrirCue() {
    const gen = ++cue.gen;
    const id = cue.salida;
    try {
      if (!cue.ctx) crearCtxCue();
    } catch (e) {
      cue.ctx = null;
      fallaCue(e?.name || 'error');
      return { ok: false, error: e?.name || 'error' };
    }
    const c = cue.ctx;
    // Con la etapa '3-4' armada, el destination vuelve a 2 canales ANTES de cambiar de dispositivo (la
    // salida nueva puede tener menos). La de '1-2' queda: la salida vieja suena hasta que la nueva esté.
    if (cue.etapa?.canales === '3-4') desmontarSalidaCue(c);
    cue.pedido = id;
    ponerEstadoCue('abriendo');
    let error = null;
    try {
      await c.setSinkId(id);
      if (gen === cue.gen && cue.ctx === c) await esperarRunning(c);
    } catch (e) {
      error = e?.name || 'error';
    }
    if (cerrado || gen !== cue.gen || cue.ctx !== c) return { ok: false, error: 'reemplazada' };
    if (error) { fallaCue(error); return { ok: false, error }; }
    if (!cue.nodos) {
      // Los valores iniciales son la ÚNICA escritura de .value: cueA/cueB en 0 (suben con rampa al
      // activarse), cueVol en la ganancia del volumen de cue.
      const ganancia = (v) => { const g = c.createGain(); g.gain.value = v; return g; };
      const vol = ganancia(volumenCue(cue.volumen));
      const A = ganancia(0), B = ganancia(0);
      A.connect(vol);
      B.connect(vol);
      cue.nodos = { A, B, vol };
    }
    if (!cue.etapa || cue.etapa.canales !== cue.canales) {
      desmontarSalidaCue(c);
      const motivo = montarSalidaCue(c);
      if (motivo) { fallaCue(motivo); return { ok: false, error: motivo }; }
    }
    ponerEstadoCue('lista');
    for (const lado of ['A', 'B']) if (cue.activo[lado]) rampaCue(cue.nodos[lado].gain, 1);
    sincronizarCues();
    return { ok: true };
  }

  const motor = {
    decks,
    // El AudioContext del motor, creándolo si hace falta. LLAMAR DENTRO DE UN GESTO. null si el motor
    // ya se cerró.
    asegurarContexto() {
      if (cerrado) return null;
      if (ctx) {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        return ctx;
      }
      if (duenoActual && duenoActual !== motor) duenoActual.cerrar();
      ctx = new AudioContext(sampleRate ? { sampleRate, latencyHint } : { latencyHint });
      // Los valores guardados son los INICIALES de cada nodo: es la única vez que se escribe .value.
      const xf = potenciaIgual(mezcla.crossfader);
      const fr = filtroFrecuencias(mezcla.filtro);
      const ganancia = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };
      const biquad = (tipo, hz) => { const f = ctx.createBiquadFilter(); f.type = tipo; f.frequency.value = hz; f.Q.value = Q_FILTRO; return f; };
      const bus = ganancia(1);
      const lp = biquad('lowpass', fr.lp);
      const hp = biquad('highpass', fr.hp);
      const master = ganancia(1);
      bus.connect(lp);
      lp.connect(hp);
      hp.connect(master);
      master.connect(ctx.destination);
      nodos = { bus, lp, hp, master };
      for (const lado of ['A', 'B']) {
        const vol = ganancia(gananciaVolumen(mezcla.volumen[lado]));
        const cruce = ganancia(lado === 'A' ? xf.a : xf.b);
        vol.connect(cruce);
        cruce.connect(bus);
        nodos[lado] = { vol, xf: cruce };
        decks[lado]._conectar(ctx, nodos[lado].vol);
      }
      duenoActual = motor;
      return ctx;
    },
    contexto() { return ctx; },
    suscribir(fn) { oyentes.add(fn); return () => { oyentes.delete(fn); }; },
    // Lo que se pidió al crear el motor (el sampleRate REAL es el del contexto): lo lee la medición MIDI.
    opciones: Object.freeze({ sampleRate: sampleRate || null, latencyHint }),
    // `fn` se llama UNA vez al cerrar el motor (sub-paso d: la conexión MIDI quita ahí sus oyentes).
    alCerrar(fn) {
      if (cerrado) { fn(); return () => {}; }
      alCierre.add(fn);
      return () => { alCierre.delete(fn); };
    },

    // ── Mezcla. Cada setter guarda el valor (recortado a su rango) y, si hay contexto, lo lleva al
    // AudioParam con una rampa. Un valor que no es un número finito se DESCARTA (devuelve false y no
    // cambia nada): un control roto no debe mover la mezcla.
    fijarVolumen(lado, v) {
      if (!(lado in decks) || !finito(v)) return false;
      mezcla.volumen[lado] = recortar(v, 0, 1);
      if (vivo()) rampa(nodos[lado].vol.gain, gananciaVolumen(mezcla.volumen[lado]));
      avisar();
      return true;
    },
    // x = 0 → sólo A; x = 1 → sólo B.
    fijarCrossfader(x) {
      if (!finito(x)) return false;
      mezcla.crossfader = recortar(x, 0, 1);
      if (vivo()) {
        const g = potenciaIgual(mezcla.crossfader);
        rampa(nodos.A.xf.gain, g.a);
        rampa(nodos.B.xf.gain, g.b);
      }
      avisar();
      return true;
    },
    // f de −1 (paso bajo al máximo) a 1 (paso alto al máximo); 0 = plano. Sólo frecuencias, nunca .type.
    fijarFiltro(f) {
      if (!finito(f)) return false;
      mezcla.filtro = recortar(f, -1, 1);
      if (vivo()) {
        const fr = filtroFrecuencias(mezcla.filtro);
        rampa(nodos.lp.frequency, fr.lp);
        rampa(nodos.hp.frequency, fr.hp);
      }
      avisar();
      return true;
    },
    // Los valores objetivo (copia): los del control y lo que se le pide a cada AudioParam.
    mezcla() {
      const g = potenciaIgual(mezcla.crossfader);
      const fr = filtroFrecuencias(mezcla.filtro);
      return {
        volumen: { ...mezcla.volumen },
        crossfader: mezcla.crossfader,
        filtro: mezcla.filtro,
        ganancias: { volA: gananciaVolumen(mezcla.volumen.A), volB: gananciaVolumen(mezcla.volumen.B), xfA: g.a, xfB: g.b },
        frecuencias: { lp: fr.lp, hp: fr.hp },
      };
    },

    // ── Cue a audífonos (sub-paso e2; ver la cabecera). Nada de esto lanza ni toca el master.
    // La salida de audífonos: un deviceId (string no vacío) y su nombre (para los avisos); null = sin
    // audífonos (cierra el contexto de cue y apaga los cues). Con el contexto de cue abierto, cambia la
    // salida con setSinkId y resincroniza; sin contexto sólo la guarda (se abre al activar un cue).
    // → Promise<{ ok, error? }> que NUNCA rechaza: error = el name del error, 'valor-invalido',
    // 'cerrado', 'reemplazada' (otra llamada más nueva ganó) o 'sin-canales-3-4'.
    // `opciones` (e2c): undefined, null o { canales: '1-2' | '3-4', abrir: boolean } (validarCanales; sin
    // canales = '1-2'). Cambiar SÓLO los canales de la salida que ya está lista rearma la etapa de salida:
    // sin setSinkId, sin contexto nuevo y sin resincronizar (las fuentes de cue están antes de esa etapa).
    // `abrir: true` (e3a, el botón «Usar» de la página; LLAMAR DENTRO DEL GESTO): sin contexto de cue, lo
    // abre YA (setSinkId, 'running' y la etapa de canales) sin activar ningún cue, así un error de la
    // salida se ve al elegirla y no al primer cue en plena sesión; la promesa resuelve con la salida
    // 'lista' con contexto, o con el error. Sin `abrir` (o false), perezoso como en e2. `abrir` que no es
    // booleano → 'valor-invalido' sin cambiar nada.
    fijarSalidaCue(deviceId, nombre = '', opciones) {
      if (cerrado) return Promise.resolve({ ok: false, error: 'cerrado' });
      if (deviceId === null) {
        cerrarCtxCue();
        cue.salida = null;
        cue.nombre = '';
        cue.canales = '1-2';
        cue.activo = { A: false, B: false };
        ponerEstadoCue('sin-salida');
        return Promise.resolve({ ok: true });
      }
      if (typeof deviceId !== 'string' || deviceId === '') return Promise.resolve({ ok: false, error: 'valor-invalido' });
      const op = opciones ?? {};
      const canales = typeof op === 'object' && !Array.isArray(op) ? validarCanales(op.canales) : null;
      if (canales === null) return Promise.resolve({ ok: false, error: 'valor-invalido' });
      const abrir = op.abrir;
      if (abrir !== undefined && typeof abrir !== 'boolean') return Promise.resolve({ ok: false, error: 'valor-invalido' });
      const soloCanales = !!cue.ctx && cueListo() && deviceId === cue.salida && canales !== cue.canales;
      cue.salida = deviceId;
      cue.nombre = typeof nombre === 'string' ? nombre : '';
      cue.canales = canales;
      if (soloCanales) {
        desmontarSalidaCue(cue.ctx);
        const motivo = montarSalidaCue(cue.ctx);
        if (motivo) { fallaCue(motivo); return Promise.resolve({ ok: false, error: motivo }); }
        avisar();
        return Promise.resolve({ ok: true });
      }
      if (cue.ctx || abrir) return abrirCue();
      ponerEstadoCue('lista');
      return Promise.resolve({ ok: true });
    },
    // Activa o apaga el cue de un deck (se pueden los dos). LLAMAR DENTRO DE UN GESTO: el primero crea el
    // contexto de cue. Sin salida elegida → false. Activar: la ganancia del deck sube con rampa y se crea
    // su fuente de cue; apagar: rampa a 0 y la fuente se para en 6·TAU.
    fijarCue(lado, activo) {
      if (cerrado || !(lado in decks) || !cue.salida) return false;
      const on = !!activo;
      cue.activo[lado] = on;
      if (on) {
        if (!cue.ctx) abrirCue();   // nunca rechaza; al quedar lista activa y sincroniza
        else if (cueListo()) { rampaCue(cue.nodos[lado].gain, 1); sincronizarCue(lado); }
      } else if (cue.nodos && cue.ctx) {
        rampaCue(cue.nodos[lado].gain, 0);
        pararFuenteCue(lado, true);
      } else {
        pararFuenteCue(lado);
      }
      avisar();
      return true;
    },
    // Volumen de los audífonos, 0..1 con curva v² (volumenCue). No finito → false (no cambia nada).
    fijarVolumenCue(v) {
      const g = volumenCue(v);
      if (g === null) return false;
      cue.volumen = recortar(v, 0, 1);
      if (cue.nodos && cue.ctx) rampaCue(cue.nodos.vol.gain, g);
      avisar();
      return true;
    },
    // Desfase de los audífonos en ms (+ = suenan más tarde), recortado a ±250 (recortarDesfase). Se aplica
    // y se resincroniza YA (el debounce al arrastrar es de la página). No finito → false.
    fijarDesfaseCue(ms) {
      const d = recortarDesfase(ms);
      if (d === null) return false;
      cue.desfaseMs = d;
      if (!cerrado) sincronizarCues();
      avisar();
      return true;
    },
    // Copia del estado del cue.
    cue() {
      return { salida: cue.salida, nombre: cue.nombre, canales: cue.canales, estado: cue.estado, activo: { ...cue.activo }, volumen: cue.volumen, desfaseMs: cue.desfaseMs, aviso: cue.aviso };
    },
    contextoCue() { return cue.ctx; },
    // Diagnóstico del cue (sub-paso e2b; lo expone DjPage con ?diag=1 en window.__djCue.diag). null sin
    // contexto de cue. Si hay: K y fuente de offsetRelojes con los dos relojes leídos AHORA (en la misma
    // tarea); derivaMs = (K ahora − K de la última sincronización) × 1000 y desdeS = segundos desde esa
    // sincronización (null los dos si todavía no hubo ninguna en este contexto de cue); y lo que dice cada
    // contexto (cada campo leído aparte: en un contexto cerrado puede lanzar → null). Sólo lee: no
    // resincroniza ni cambia nada. Nunca lanza.
    diagCue() {
      try {
        const cc = cue.ctx;
        if (!cc) return null;
        const leer = (f) => { try { const v = f(); return v === undefined ? null : v; } catch { return null; } };
        const salida = (c) => (c ? leer(() => c.getOutputTimestamp?.()) : null);
        const k = offsetRelojes({ salidaMaster: salida(ctx), salidaCue: salida(cc), tiempoMaster: ctx ? leer(() => ctx.currentTime) : null, tiempoCue: leer(() => cc.currentTime) });
        const u = cue.ultimaSync;
        const sink = (c) => { const s = c.sinkId; return s && typeof s === 'object' ? { type: s.type } : s; };
        const datos = (c) => (c ? {
          state: leer(() => c.state), sampleRate: leer(() => c.sampleRate), baseLatency: leer(() => c.baseLatency),
          outputLatency: leer(() => c.outputLatency), sinkId: leer(() => sink(c)),
          channelCount: leer(() => c.destination.channelCount), maxChannelCount: leer(() => c.destination.maxChannelCount),
          channelInterpretation: leer(() => c.destination.channelInterpretation),
        } : null);
        return {
          canales: cue.canales,
          K: k ? k.K : null,
          fuente: k ? k.fuente : null,
          derivaMs: k && u ? (k.K - u.K) * 1000 : null,
          desdeS: u ? (ahora() - u.t) / 1000 : null,
          contextos: { master: datos(ctx), cue: datos(cc) },
        };
      } catch {
        return null;
      }
    },

    // Para todo, suelta los buffers y cierra LOS DOS contextos (master y cue; un setSinkId pendiente del
    // cue rechaza con InvalidStateError y se descarta). Idempotente; después el motor no suena más (los
    // setters de mezcla siguen sin lanzar: sólo guardan).
    cerrar() {
      if (cerrado) return;
      cerrado = true;
      oyentes.clear();
      decks.A._soltar();
      decks.B._soltar();
      cerrarCtxCue();
      if (ctx) ctx.close().catch(() => {});
      ctx = null;
      nodos = null;
      if (duenoActual === motor) duenoActual = null;
      for (const fn of [...alCierre]) { try { fn(); } catch { /* uno que falla no frena a los demás */ } }
      alCierre.clear();
    },
    get cerrado() { return cerrado; },
  };
  return motor;
}
