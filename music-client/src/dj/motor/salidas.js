// MODO DJ · la LISTA de salidas de audio para el cue (sub-paso e3a). La parte de navegador: pide el permiso
// de micrófono (sólo para que el navegador dé los NOMBRES de las salidas: no se graba nada) y enumera.
// Lo puro (filtrarSalidas, hayNombres, los textos) está en cue.js. Sin React: la usa CueDj.jsx, con la misma
// forma que crearConexionMidi (midi.js). `medios` (navigator.mediaDevices) y `permisos`
// (navigator.permissions) se inyectan: dj-unit la prueba con falsos.
//
// ESTADOS: 'sin-soporte' (sin mediaDevices o sin AudioContext.prototype.setSinkId) · 'inactivo' (falta el
// clic) · 'pidiendo' · 'denegado' · 'sin-microfono' · 'error' (otro error de getUserMedia, con su name) ·
// 'sin-nombres' (hay permiso pero las salidas vienen sin nombre) · 'vacia' · 'lista'.
//   · autoListar(): al montar. permissions.query({ name: 'microphone' }): 'granted' → enumera sin pedir
//     nada; 'denied' → 'denegado'; 'prompt' (o sin respuesta) → se queda en 'inactivo'.
//   · pedir(): DENTRO DEL CLIC (el gesto que pide el permiso). getUserMedia({ audio: true }) y stop() de
//     cada pista en cuanto llega; después enumerateDevices. Si getUserMedia falla, igual enumera: con
//     nombres (permiso ya dado y el micrófono ocupado, por ejemplo) la lista sale sin aviso.
//   · devicechange: con la lista ya leída ('lista' o 'vacia'), vuelve a enumerar sin pedir nada. El oyente
//     se pone al crear y se quita en cerrar() (el doble montaje de StrictMode deja UNO).
//   · alCambiar(): después de cada cambio de estado y de cada enumeración (aunque el estado no cambie: la
//     lista pudo cambiar). Nunca lanza.
import { filtrarSalidas, hayNombres } from './cue.js';

const puedeSinkPorDefecto = () => typeof AudioContext === 'function' && typeof AudioContext.prototype.setSinkId === 'function';

export function crearListaSalidas({
  medios = globalThis.navigator?.mediaDevices,
  permisos = globalThis.navigator?.permissions,
  puedeSink = puedeSinkPorDefecto,
  alCambiar = () => {},
} = {}) {
  const soportado = !!medios && typeof medios.enumerateDevices === 'function' && typeof medios.getUserMedia === 'function' && !!puedeSink();
  let estado = soportado ? 'inactivo' : 'sin-soporte';
  let salidas = [];
  let error = null;
  let pidiendo = null;
  let cerrado = false;

  const avisar = () => { try { alCambiar(); } catch { /* la página no frena la lista */ } };
  const poner = (e, err = null) => { estado = e; error = err; avisar(); };

  // Para cada pista apenas llega: el micrófono queda abierto sólo un instante.
  const parar = (stream) => {
    try { for (const t of stream?.getTracks?.() ?? []) { try { t.stop(); } catch { /* ya parada */ } } } catch { /* sin pistas */ }
  };

  // `errorPedido`: el name del error de getUserMedia (null si no hubo error o no se pidió).
  async function enumerar(errorPedido = null) {
    let lista = null;
    try { lista = await medios.enumerateDevices(); } catch { lista = null; }
    if (cerrado) return;
    if (Array.isArray(lista) && hayNombres(lista)) {
      salidas = filtrarSalidas(lista);
      poner(salidas.length ? 'lista' : 'vacia');
      return;
    }
    salidas = [];
    if (errorPedido === 'NotAllowedError' || errorPedido === 'SecurityError') { poner('denegado'); return; }
    if (errorPedido === 'NotFoundError') { poner('sin-microfono'); return; }
    if (errorPedido) { poner('error', errorPedido); return; }
    const haySalidas = Array.isArray(lista) && lista.some((d) => d?.kind === 'audiooutput');
    poner(haySalidas ? 'sin-nombres' : 'vacia');
  }

  function pedir() {
    if (cerrado || !soportado) return Promise.resolve();
    if (pidiendo) return pidiendo;
    let pedido;
    try { pedido = medios.getUserMedia({ audio: true }); }   // SÍNCRONO dentro del clic
    catch (e) { pedido = Promise.reject(e); }
    poner('pidiendo');
    pidiendo = Promise.resolve(pedido)
      .then((stream) => { parar(stream); return null; }, (e) => e?.name || 'error')
      .then((errorPedido) => (cerrado ? undefined : enumerar(errorPedido)))
      .finally(() => { pidiendo = null; });
    return pidiendo;
  }

  async function autoListar() {
    if (cerrado || !soportado || typeof permisos?.query !== 'function') return;
    let st;
    try { st = (await permisos.query({ name: 'microphone' }))?.state; } catch { return; }
    if (cerrado || estado !== 'inactivo') return;
    if (st === 'granted') await enumerar();
    else if (st === 'denied') poner('denegado');
  }

  const alCambiarDispositivos = () => {
    if (cerrado || (estado !== 'lista' && estado !== 'vacia')) return;
    enumerar();
  };
  if (soportado) { try { medios.addEventListener?.('devicechange', alCambiarDispositivos); } catch { /* sin eventos */ } }

  function cerrar() {
    if (cerrado) return;
    cerrado = true;
    if (soportado) { try { medios.removeEventListener?.('devicechange', alCambiarDispositivos); } catch { /* sin eventos */ } }
  }

  return {
    autoListar,
    pedir,
    cerrar,
    estado: () => ({ estado, salidas, error }),
  };
}
