// MODO DJ · Web MIDI (sub-paso d): el DDJ-400 mueve la mezcla del motor. Sin React. Al importar NO toca
// nada del navegador (lo importa dj-unit.mjs con node): navigator y performance se usan al llamar.
//
// QUÉ SE LEE: sólo Control Change (0xB0–0xBF). El canal se numera DESDE 1, como en el prototipo
// ((status & 0x0f) + 1): «7:31» es el canal 7 = status 0xB6, control 31.
//
// 14 BITS, como el prototipo (C:\Dev\dj-prototipo, LEEME §1 y valorDe() de dj.js). Un control se
// identifica por «canal:N», con N el número de su MSB:
//   · cc < 32 es el MSB del control N = cc; cc 32..63 es el LSB del control N = cc − 32 (en el
//     DDJ-400 el LSB es MSB + 32); cc ≥ 64 es un control de 7 bits (valor / 127).
//   · El modo sale de lo que ese control ya mandó (el «modoVisto» del prototipo):
//       MSB y LSB vistos → posición = (MSB << 7 | LSB) / 16383, de 0 a 1;
//       «solo MSB» (nunca mandó LSB) → MSB / 127;
//       «solo LSB» (nunca mandó MSB) → LSB / 127.
//   · Al llegar un MSB el LSB vuelve a 0 (como pide MIDI 1.0, y como el prototipo): el MSB se aplica
//     ya con LSB = 0 y el LSB que lo sigue completa el valor.
// DUPLICADOS: si la posición de 14 bits es IGUAL a la última que se APLICÓ a ese control, no se llama
// al setter (el prototipo descartaba, sólo con la casilla, el mismo mensaje con timeStamp a ≤ 1 ms; aquí
// el criterio es el valor, siempre activo). Un mensaje repetido por el driver cae acá.
//
// MAPA FIJO del DDJ-400 (el prototipo usaba MIDI-learn; estos números son los que aprendió):
//   volA 1:19 · volB 2:19 · crossfader 7:31 · filtro 7:23 (el LSB de cada uno es cc + 32).
//   volA/volB → fijarVolumen(lado, pos) · crossfader → fijarCrossfader(pos), 0 = sólo A ·
//   filtro → fijarFiltro(pos · 2 − 1): el centro de la perilla (MSB 64, LSB 0 = 8192 → 0,50003 → 0,00006)
//   cae en la zona muerta de filtroFrecuencias (±0,04).
//
// RETRASO MIDI → AudioParam (sólo con ?diag=1): la MISMA definición que el prototipo (sección 5, los
// 7,75 ms): performance.now() justo DESPUÉS de programar el AudioParam (el setter hace setTargetAtTime)
// − MIDIMessageEvent.timeStamp, por cada mensaje que llega al setter, con la mezcla sonando (el prototipo:
// «con el mix sonando»; acá: contexto 'running' y algún deck sonando). Es el retraso DENTRO del navegador:
// no incluye USB, ni la rampa de setTargetAtTime (TAU), ni el búfer de salida. Últimos 5000.

export const NOMBRE_DDJ = 'DDJ-400';
export const MAPA_DDJ400 = Object.freeze({ '1:19': 'volA', '2:19': 'volB', '7:31': 'crossfader', '7:23': 'filtro' });

const byte7 = (x) => Number.isInteger(x) && x >= 0 && x <= 127;

// bytes (Uint8Array o array) → { canal (1..16), cc, valor } · null si no es un Control Change válido.
export function interpretar(bytes) {
  if (!bytes || bytes.length < 3) return null;
  const st = bytes[0];
  if (!(st >= 0xb0 && st <= 0xbf)) return null;
  const cc = bytes[1], valor = bytes[2];
  if (!byte7(cc) || !byte7(valor)) return null;
  return { canal: (st & 0x0f) + 1, cc, valor };
}

// { canal, cc, valor } → { clave, pos (0..1), modo } · null si todavía no hay valor.
export function crearCombinador() {
  const porControl = new Map();   // 'canal:N' → { msb, lsb, vioMsb, vioLsb }
  return {
    recibir({ canal, cc, valor }) {
      if (cc >= 64) return { clave: `${canal}:${cc}`, pos: valor / 127, modo: '7 bits' };
      const esLsb = cc >= 32;
      const clave = `${canal}:${esLsb ? cc - 32 : cc}`;
      let s = porControl.get(clave);
      if (!s) { s = { msb: null, lsb: 0, vioMsb: false, vioLsb: false }; porControl.set(clave, s); }
      if (!esLsb) {
        s.vioMsb = true; s.msb = valor; s.lsb = 0;
        return s.vioLsb ? { clave, pos: (valor << 7) / 16383, modo: '14 bits' } : { clave, pos: valor / 127, modo: 'solo MSB' };
      }
      s.vioLsb = true; s.lsb = valor;
      if (!s.vioMsb) return { clave, pos: valor / 127, modo: 'solo LSB' };
      return { clave, pos: ((s.msb << 7) | valor) / 16383, modo: '14 bits' };
    },
    reiniciar() { porControl.clear(); },
  };
}

// true si `pos` es distinta de la última aplicada a `clave` (y la anota); false = duplicado.
export function crearDeduplicador() {
  const ultima = new Map();
  return {
    nuevo(clave, pos) {
      if (ultima.get(clave) === pos) return false;
      ultima.set(clave, pos);
      return true;
    },
    reiniciar() { ultima.clear(); },
  };
}

// Posición 0..1 del control → el valor que recibe el setter del motor.
export function valorParaMotor(funcion, pos) {
  return funcion === 'filtro' ? pos * 2 - 1 : pos;
}

// Llama al setter del motor que corresponde a `funcion`. Devuelve lo que devuelve el setter (false si
// la función no existe o el valor no sirve).
export function aplicar(motor, funcion, pos) {
  const v = valorParaMotor(funcion, pos);
  switch (funcion) {
    case 'volA': return motor.fijarVolumen('A', v);
    case 'volB': return motor.fijarVolumen('B', v);
    case 'crossfader': return motor.fijarCrossfader(v);
    case 'filtro': return motor.fijarFiltro(v);
    default: return false;
  }
}

// Los últimos `tope` retrasos (ms) en un búfer circular. Mediana como el prototipo (promedio de los dos
// del medio si n es par); p95 por rango más cercano (el valor en la posición ⌈0,95·n⌉ de los ordenados).
export function crearColector(tope = 5000) {
  const buf = new Float64Array(tope);
  let n = 0, i = 0;
  return {
    agregar(ms) { buf[i] = ms; i = (i + 1) % tope; if (n < tope) n++; },
    resumen() {
      if (!n) return { n: 0, mediana: null, p95: null, max: null };
      const xs = Array.from(buf.subarray(0, n)).sort((a, b) => a - b);
      const m = n >> 1;
      return { n, mediana: n % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2, p95: xs[Math.ceil(0.95 * n) - 1], max: xs[n - 1] };
    },
    reiniciar() { n = 0; i = 0; },
  };
}

const esDdj = (p) => !!p && p.state !== 'disconnected' && String(p.name ?? '').toLowerCase().includes(NOMBRE_DDJ.toLowerCase());

// LA CONEXIÓN. Estados: 'sin-soporte' · 'inactivo' (falta el clic) · 'pidiendo' · 'denegado' · 'error' ·
// 'esperando' (hay permiso, no hay DDJ-400) · 'conectado' (con el nombre) · 'desconectado'.
//   · conectar(): requestMIDIAccess({ sysex: false }), llamado DENTRO del clic (es el gesto que pide
//     permiso). autoConectar(): sólo si navigator.permissions dice 'granted' (no pide nada).
//   · Engancha UN oyente 'midimessage' a la primera entrada conectada cuyo nombre contenga «DDJ-400»
//     (sin mayúsculas) y UN 'statechange' al acceso: si la entrada se va → 'desconectado' (se suelta);
//     si vuelve → se engancha otra vez.
//   · cerrar(): quita los dos oyentes. Se llama también al cerrar el motor (motor.alCerrar). Si se
//     cierra con el permiso pedido en vuelo, al llegar no se engancha nada (doble montaje de StrictMode).
//   · El manejador va DIRECTO al setter del motor, sin React; la medición va DESPUÉS del setter.
export function crearConexionMidi({ motor, diag = false, alCambiar = () => {}, nav = globalThis.navigator, ahora = () => performance.now() } = {}) {
  const soportado = typeof nav?.requestMIDIAccess === 'function';
  let estado = soportado ? 'inactivo' : 'sin-soporte';
  let nombre = null;
  let acceso = null;
  let entrada = null;
  let pidiendo = null;
  let cerrado = false;
  const combinador = crearCombinador();
  const dedup = crearDeduplicador();
  const colector = diag ? crearColector() : null;

  const poner = (e, n = nombre) => {
    if (estado === e && nombre === n) return;
    estado = e; nombre = n;
    alCambiar();
  };
  const midiendo = () => {
    const c = motor.contexto();
    return !!c && c.state === 'running' && (motor.decks.A.estado().sonando || motor.decks.B.estado().sonando);
  };

  function alMensaje(e) {
    const m = interpretar(e.data);
    if (!m) return;
    const r = combinador.recibir(m);
    if (!r) return;
    const funcion = MAPA_DDJ400[r.clave];
    if (!funcion) return;
    if (!dedup.nuevo(r.clave, r.pos)) return;
    if (!aplicar(motor, funcion, r.pos)) return;                     // 1.º el setter (setTargetAtTime)
    if (colector && midiendo()) colector.agregar(ahora() - e.timeStamp);   // 2.º la medición
  }

  function soltarEntrada() {
    if (!entrada) return;
    entrada.removeEventListener('midimessage', alMensaje);
    entrada = null;
  }
  function engancharEntrada(i) {
    if (entrada === i) return;
    soltarEntrada();
    entrada = i;
    i.addEventListener('midimessage', alMensaje);
    try { Promise.resolve(i.open?.()).catch(() => {}); } catch { /* el oyente igual la abre */ }
    // Entrada nueva (o la misma que volvió): sin estado viejo de 14 bits ni de duplicados.
    combinador.reiniciar();
    dedup.reiniciar();
  }
  function revisar() {
    if (cerrado || !acceso) return;
    let hallada = null;
    for (const i of acceso.inputs.values()) { if (esDdj(i)) { hallada = i; break; } }
    if (hallada) { engancharEntrada(hallada); poner('conectado', hallada.name); return; }
    const estaba = !!entrada || estado === 'conectado' || estado === 'desconectado';
    soltarEntrada();
    poner(estaba ? 'desconectado' : 'esperando', estaba ? nombre : null);
  }
  const alEstado = () => revisar();

  function conectar() {
    if (cerrado || !soportado) return Promise.resolve();
    if (acceso) { revisar(); return Promise.resolve(); }
    if (pidiendo) return pidiendo;
    let pedido;
    try { pedido = nav.requestMIDIAccess({ sysex: false }); }   // SÍNCRONO dentro del clic
    catch (err) { pedido = Promise.reject(err); }
    poner('pidiendo', null);
    pidiendo = Promise.resolve(pedido).then((a) => {
      pidiendo = null;
      if (cerrado) return;
      acceso = a;
      acceso.addEventListener('statechange', alEstado);
      revisar();
    }, (err) => {
      pidiendo = null;
      if (cerrado) return;
      poner(err?.name === 'NotAllowedError' || err?.name === 'SecurityError' ? 'denegado' : 'error', null);
    });
    return pidiendo;
  }

  async function autoConectar() {
    if (cerrado || !soportado || typeof nav.permissions?.query !== 'function') return;
    let st;
    try { st = (await nav.permissions.query({ name: 'midi', sysex: false }))?.state; } catch { return; }
    if (cerrado) return;
    if (st === 'granted') await conectar();
    else if (st === 'denied' && estado === 'inactivo') poner('denegado', null);
  }

  function cerrar() {
    if (cerrado) return;
    cerrado = true;
    soltarEntrada();
    acceso?.removeEventListener('statechange', alEstado);
    acceso = null;
  }
  motor.alCerrar?.(cerrar);

  const conexion = {
    conectar,
    autoConectar,
    cerrar,
    estado: () => ({ estado, nombre }),
  };
  if (colector) {
    conexion.stats = () => {
      const c = motor.contexto();
      return { ...colector.resumen(), sampleRate: c?.sampleRate ?? null, latencyHint: motor.opciones?.latencyHint ?? null,
        baseLatency: c?.baseLatency ?? null, outputLatency: c?.outputLatency ?? null };
    };
    conexion.reiniciar = () => colector.reiniciar();
  }
  return conexion;
}
