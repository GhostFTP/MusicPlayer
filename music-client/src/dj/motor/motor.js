// MODO DJ · motor de audio (Web Audio). Sin React. Independiente del reproductor normal: no toca el
// <audio> de PlayerContext ni MediaSession.
//
// GRAFO: deck A ─ GainNode ─┐
//                            ├─ master (GainNode) ─ destination
//        deck B ─ GainNode ─┘
// Sin crossfader, filtro ni MIDI todavía (sub-paso c; las curvas ya están en mezcla.js).
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

let duenoActual = null;   // el motor que tiene un AudioContext abierto ahora (a lo sumo uno)

const recortar = (x, min, max) => (x < min ? min : x > max ? max : x);

function crearDeck(avisar) {
  let ctx = null;
  let ganancia = null;
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
    f.connect(ganancia);
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
    _conectar(c, master) {
      ctx = c;
      ganancia = c.createGain();
      ganancia.connect(master);
    },
    _soltar() { soltarFuente(); sonando = false; buffer = null; meta = null; parado = 0; ctx = null; ganancia = null; },

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
  let master = null;
  let cerrado = false;
  const oyentes = new Set();
  const avisar = () => { for (const fn of oyentes) fn(); };
  const decks = { A: crearDeck(avisar), B: crearDeck(avisar) };

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
      master = ctx.createGain();
      master.connect(ctx.destination);
      decks.A._conectar(ctx, master);
      decks.B._conectar(ctx, master);
      duenoActual = motor;
      return ctx;
    },
    contexto() { return ctx; },
    suscribir(fn) { oyentes.add(fn); return () => { oyentes.delete(fn); }; },
    // Para todo, suelta los buffers y cierra el contexto. Idempotente; después el motor no sirve más.
    cerrar() {
      if (cerrado) return;
      cerrado = true;
      oyentes.clear();
      decks.A._soltar();
      decks.B._soltar();
      if (ctx) ctx.close().catch(() => {});
      ctx = null;
      master = null;
      if (duenoActual === motor) duenoActual = null;
    },
    get cerrado() { return cerrado; },
  };
  return motor;
}
