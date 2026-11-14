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

import { potenciaIgual, gananciaVolumen, filtroFrecuencias } from './mezcla.js';

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

let duenoActual = null;   // el motor que tiene un AudioContext abierto ahora (a lo sumo uno)

const recortar = (x, min, max) => (x < min ? min : x > max ? max : x);
const finito = (v) => typeof v === 'number' && Number.isFinite(v);

function crearDeck(avisar) {
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
      avisar();
    };
    f.start(0, desde);
    fuente = f;
    cero = ctx.currentTime - desde;
    sonando = true;
  }

  const deck = {
    _conectar(c, nodoEntrada) {
      ctx = c;
      entrada = nodoEntrada;
    },
    _soltar() { soltarFuente(); sonando = false; buffer = null; meta = null; parado = 0; ctx = null; entrada = null; },

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
// AudioContext se crea sin sampleRate).
export function crearMotor({ sampleRate = TASA_DJ, latencyHint = 'interactive' } = {}) {
  let ctx = null;
  let nodos = null;   // { A: { vol, xf }, B: { vol, xf }, bus, lp, hp, master } mientras hay contexto
  let cerrado = false;
  const oyentes = new Set();
  const alCierre = new Set();   // lo que hay que soltar al cerrar (alCerrar)
  const avisar = () => { for (const fn of oyentes) fn(); };
  const decks = { A: crearDeck(avisar), B: crearDeck(avisar) };
  // Valores OBJETIVO de la mezcla (los del control, no lo que vale el AudioParam en este instante).
  const mezcla = { volumen: { ...MEZCLA_INICIAL.volumen }, crossfader: MEZCLA_INICIAL.crossfader, filtro: MEZCLA_INICIAL.filtro };

  // Con el contexto vivo, una rampa hacia `v`; sin contexto (o cerrado), nada: el valor ya quedó
  // guardado en `mezcla` y se aplica al crear los nodos. Nunca lanza.
  const vivo = () => !!ctx && !!nodos && ctx.state !== 'closed';
  function rampa(param, v) {
    try { param.setTargetAtTime(v, ctx.currentTime, TAU); } catch { /* contexto cerrándose */ }
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

    // Para todo, suelta los buffers y cierra el contexto. Idempotente; después el motor no suena más
    // (los setters de mezcla siguen sin lanzar: sólo guardan).
    cerrar() {
      if (cerrado) return;
      cerrado = true;
      oyentes.clear();
      decks.A._soltar();
      decks.B._soltar();
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
