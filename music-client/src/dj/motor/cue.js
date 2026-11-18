// MODO DJ · cue a audífonos (sub-paso e). PURO: sin AudioContext, sin DOM y sin localStorage (lo prueba
// dj-unit.mjs con node). Sub-paso e1: nadie lo importa todavía; el motor (e2) y la página (e3) lo usarán.
//
// EL CUE: un segundo AudioContext, con setSinkId a la salida de audífonos, donde suena cada deck CRUDO
// (antes del volumen, del crossfader y del filtro). Cada fuente de cue se crea en la posición que el deck
// tiene en el master, más un desfase manual. Este archivo tiene sólo las cuentas y los textos:
//   · recortarDesfase, volumenCue: los dos controles del cue.
//   · offsetRelojes, planCue: dónde y cuándo arranca una fuente de cue.
//   · filtrarSalidas, hayNombres, elegirGuardada: la lista de salidas y la salida recordada.
//   · validarCanales: por qué canales de la salida va el cue ('1-2' o '3-4', sub-paso e2c).
//   · textoAviso: los avisos cortos de la página.
//   · nombresVisibles, decidirEleccion, textoListaSalidas, textoEstadoCue: el selector de audífonos de la
//     página (sub-paso e3a, CueDj.jsx); la parte de navegador de la lista está en salidas.js.
//   · textoCuesActivos, estadoBotonCue, textoNotaCue, textoDesfase, crearDiferido, buscarVuelta,
//     pistaMezcladora: los botones Cue de los decks, el volumen y el desfase (sub-paso e3b). crearDiferido
//     usa setTimeout sólo si no se le inyectan timers.

import { gananciaVolumen } from './mezcla.js';

// Desfase manual de los audífonos, en ms: de −DESFASE_MAX_MS a +DESFASE_MAX_MS, paso 1 ms. POSITIVO =
// los audífonos suenan MÁS TARDE que el master; negativo = más temprano. El navegador reporta la misma
// latencia para todas las salidas (medido por Oscar en Edge 157), así que la diferencia real entre la
// salida del master y la de audífonos sólo se puede ajustar a oído.
export const DESFASE_MAX_MS = 250;
// Volumen de cue al abrir la página (0..1; ganancia 0,25 = −12 dB). Por seguridad auditiva no se guarda:
// siempre arranca acá.
export const VOLUMEN_CUE_INICIAL = 0.5;

const finito = (v) => typeof v === 'number' && Number.isFinite(v);

// El desfase redondeado al ms (Math.round: el medio va hacia +∞) y recortado a ±DESFASE_MAX_MS. Lo que no
// es un número finito (también un string como '12') → null: el control lo descarta y no cambia nada.
export function recortarDesfase(ms) {
  if (!finito(ms)) return null;
  const r = Math.round(ms);
  const x = r < -DESFASE_MAX_MS ? -DESFASE_MAX_MS : r > DESFASE_MAX_MS ? DESFASE_MAX_MS : r;
  return x === 0 ? 0 : x;   // sin −0 (Math.round(−0,4) da −0)
}

// Ganancia del volumen de cue: la misma curva v² con recorte a 0..1 de los decks (gananciaVolumen de
// mezcla.js). A diferencia de ésa, lo que no es finito → null (no 1): en audífonos, ante la duda, no
// se sube nada.
export function volumenCue(v) {
  return finito(v) ? gananciaVolumen(v) : null;
}

// RELOJES. El master y el cue son dos AudioContext: cada uno con su currentTime, que arranca en 0 al
// crearse y avanza con SU dispositivo. K = tiempo del master − tiempo del cue, en el MISMO instante:
//   · fuente 'salida' (la preferida): con getOutputTimestamp() de cada contexto, { contextTime,
//     performanceTime (ms, reloj de performance.now) }. contextTime − performanceTime/1000 es el tiempo
//     del contexto cuando performance.now valía 0; la resta de los dos da K. Alinea lo que SALE por cada
//     dispositivo (con la latencia que el navegador cree que tiene cada uno).
//   · fuente 'currentTime' (respaldo): tiempoMaster − tiempoCue, los currentTime leídos en la MISMA
//     tarea. Alinea el grafo, no la salida, y salta de a un bloque de render (128 muestras, 2,9 ms a
//     44 100 Hz). Se usa si alguna salida no sirve: un contexto recién creado da performanceTime 0.
// Sin datos válidos de ninguna de las dos → null.
const salidaValida = (o) => !!o && finito(o.contextTime) && finito(o.performanceTime) && o.performanceTime !== 0;

export function offsetRelojes({ salidaMaster, salidaCue, tiempoMaster, tiempoCue } = {}) {
  if (salidaValida(salidaMaster) && salidaValida(salidaCue)) {
    const K = (salidaMaster.contextTime - salidaMaster.performanceTime / 1000) - (salidaCue.contextTime - salidaCue.performanceTime / 1000);
    return { K, fuente: 'salida' };
  }
  if (finito(tiempoMaster) && finito(tiempoCue)) return { K: tiempoMaster - tiempoCue, fuente: 'currentTime' };
  return null;
}

// PLAN DE UNA FUENTE DE CUE. `cero` es el del deck en motor.js: el currentTime DEL MASTER que corresponde a
// la posición 0 de la pista mientras suena (cero = currentTime − desde, justo después de start(0, desde)),
// así que la posición en el instante T del master es T − cero. `cuandoCue` es el instante, en el reloj
// DEL CUE, en que se quiere arrancar la fuente (currentTime del cue + una guarda: lo elige el motor).
//   pos    = cuandoCue + K − cero    (la posición del deck en ese instante)
//   offset = pos − d                 (d = desfaseMs/1000; d > 0 = los audífonos suenan más tarde, así
//                                     que se reproduce una parte ANTERIOR de la pista)
//   · offset < 0 (el deck todavía no llegó a esa parte): la fuente arranca más tarde, en
//     cuando = cuandoCue − offset, desde 0.
//   · offset ≥ duracion (ya pasó el final), o algún dato no es un número finito → { crear: false }.
// → { crear: false } · { crear: true, cuando, offset } (cuando en el reloj del cue; offset en s de pista).
export function planCue({ cero, K, desfaseMs, cuandoCue, duracion } = {}) {
  if (![cero, K, desfaseMs, cuandoCue, duracion].every(finito)) return { crear: false };
  const pos = cuandoCue + K - cero;
  let offset = pos - desfaseMs / 1000;
  let cuando = cuandoCue;
  if (offset < 0) { cuando = cuandoCue - offset; offset = 0; }
  if (offset >= duracion) return { crear: false };
  return { crear: true, cuando, offset };
}

// SALIDAS. De navigator.mediaDevices.enumerateDevices(): sólo kind 'audiooutput', sin los ALIAS de Windows
// ('default' = la predeterminada, 'communications' = la de comunicaciones: los dos repiten una salida
// real que ya está en la lista) ni las entradas sin id o sin nombre (sin permiso de micrófono el
// navegador las da así: no sirven para elegir).
// esMaster: su groupId es el de la entrada 'default', o sea, es la misma salida por la que suena el
// master (el master no llama a setSinkId: va por la predeterminada). Sin entrada 'default' → false.
// → [{ id, nombre, grupo, esMaster }] en el orden del navegador. Lo que no es un arreglo → [].
const ALIAS = new Set(['default', 'communications']);
const texto = (s) => (typeof s === 'string' ? s.trim() : '');
const esSalida = (d) => !!d && d.kind === 'audiooutput';

export function filtrarSalidas(dispositivos) {
  if (!Array.isArray(dispositivos)) return [];
  const pred = dispositivos.find((d) => esSalida(d) && d.deviceId === 'default');
  const grupoMaster = pred && texto(pred.groupId) ? pred.groupId : null;
  const salidas = [];
  for (const d of dispositivos) {
    if (!esSalida(d)) continue;
    const id = typeof d.deviceId === 'string' ? d.deviceId : '';
    const nombre = texto(d.label);
    if (!id || ALIAS.has(id) || !nombre) continue;
    const grupo = typeof d.groupId === 'string' ? d.groupId : '';
    salidas.push({ id, nombre, grupo, esMaster: grupoMaster !== null && grupo === grupoMaster });
  }
  return salidas;
}

// ¿El navegador ya da los nombres? (sin permiso de micrófono, las salidas vienen sin label). Lo que no
// es un arreglo → false.
export function hayNombres(dispositivos) {
  return Array.isArray(dispositivos) && dispositivos.some((d) => esSalida(d) && texto(d.label) !== '');
}

// LA SALIDA RECORDADA. `guardada` = { id, nombre } (lo que la página guarde); `salidas` = filtrarSalidas.
// Primero por id. Si el id ya no está (los ids son por origen y el navegador los cambia, por ejemplo al
// borrar los permisos del sitio), por NOMBRE EXACTO, sólo si hay UNA salida con ese nombre: con dos
// (dos audífonos iguales) no se adivina.
// → { salida, motivo }: 'id' · 'nombre' (salida elegida) · 'ambigua' · 'ausente' · 'sin-guardada'
// (salida null). Una guardada que no es un objeto con id o nombre de texto es 'sin-guardada'.
export function elegirGuardada(guardada, salidas) {
  const id = typeof guardada?.id === 'string' ? guardada.id : '';
  const nombre = texto(guardada?.nombre);
  if (!guardada || typeof guardada !== 'object' || (!id && !nombre)) return { salida: null, motivo: 'sin-guardada' };
  const lista = Array.isArray(salidas) ? salidas : [];
  if (id) {
    const porId = lista.find((s) => s?.id === id);
    if (porId) return { salida: porId, motivo: 'id' };
  }
  if (nombre) {
    const porNombre = lista.filter((s) => s?.nombre === nombre);
    if (porNombre.length === 1) return { salida: porNombre[0], motivo: 'nombre' };
    if (porNombre.length > 1) return { salida: null, motivo: 'ambigua' };
  }
  return { salida: null, motivo: 'ausente' };
}

// CANALES DEL CUE (sub-paso e2c). '1-2' = el cue sale por los canales 1-2 de la salida (lo de siempre);
// '3-4' = por los canales 3-4 (la DDJ-400 tiene ahí su jack de audífonos; los 1-2 son su master). Es
// OPT-IN: nunca se deduce de maxChannelCount (una Sound Blaster AE-7 reporta 6 u 8 canales y ahí los
// 3-4 son centro y subwoofer). Sin valor (undefined) → '1-2'; '1-2' o '3-4' → ése; lo demás → null.
export function validarCanales(v) {
  if (v === undefined) return '1-2';
  return v === '1-2' || v === '3-4' ? v : null;
}

// AVISOS. `motivo`: un caso de la página ('no-conectada', 'desconectada', 'misma-salida'), del motor
// ('sin-canales-3-4': se pidió '3-4' y la salida tiene menos de 4 canales) o el name del
// error de setSinkId ('NotFoundError', 'NotAllowedError', 'InvalidStateError', …). `nombre`: el de la
// salida, entre comillas; SIN nombre, la frase habla de «la salida de audífonos», sin comillas.
// InvalidStateError → null: sólo pasa con el contexto ya cerrado (el motor se está cerrando), no hay nada
// que avisar. Un motivo desconocido va entre paréntesis en el aviso genérico.
export function textoAviso(motivo, nombre) {
  const n = texto(nombre);
  const q = `«${n}»`;
  switch (motivo) {
    case 'no-conectada': return n ? `La salida de audífonos ${q} no está conectada. Cue apagado.` : 'La salida de audífonos no está conectada. Cue apagado.';
    case 'desconectada': return `Se desconectó ${n ? q : 'la salida de audífonos'}. Cue apagado; el master sigue igual.`;
    case 'NotFoundError': return `No se encontró la salida ${n ? q : 'de audífonos'}. Cue apagado; el master sigue igual.`;
    case 'NotAllowedError': return `El navegador no dejó usar la salida ${n ? q : 'de audífonos'}. Cue apagado; el master sigue igual.`;
    case 'InvalidStateError': return null;
    case 'misma-salida': return 'Esa salida es la misma del master: el cue sonaría por los mismos altavoces.';
    case 'sin-canales-3-4': return `${n ? `La salida ${q}` : 'La salida de audífonos'} no tiene canales 3-4. Cue apagado; el master sigue igual.`;
    case 'volvio': return `${n ? q : 'La salida de audífonos'} volvió: pulsa «Usar» para activarla.`;   // e3b: no es un fallo
    default: return `No se pudo abrir la salida de audífonos (${texto(motivo) || 'error desconocido'}). Cue apagado; el master sigue igual.`;
  }
}

// ── Selector de audífonos (sub-paso e3a) ──

// NOMBRES REPETIDOS. Dos o más salidas con el mismo nombre (dos audífonos iguales) tienen ids distintos,
// pero en el selector se verían iguales. La 1.ª se queda con su nombre y las siguientes llevan « (2)»,
// « (3)»… en el orden del navegador (que puede cambiar entre sesiones). Un sufijo que choque con el
// nombre de otra salida salta al número siguiente: las etiquetas salen siempre distintas.
// → un nombre por salida, en el mismo orden. Lo que no es un arreglo → [].
export function nombresVisibles(salidas) {
  if (!Array.isArray(salidas)) return [];
  const originales = new Set(salidas.map((s) => texto(s?.nombre)));
  const usados = new Set();
  return salidas.map((s) => {
    const n = texto(s?.nombre);
    let v = n;
    if (usados.has(v)) {
      let k = 2;
      while (usados.has(`${n} (${k})`) || originales.has(`${n} (${k})`)) k++;
      v = `${n} (${k})`;
    }
    usados.add(v);
    return v;
  });
}

// ¿Hay que confirmar antes de usar esta salida? Con '1-2' en la salida del master (esMaster) el cue
// sonaría por los mismos altavoces → 'confirmar-misma-salida' (NO se bloquea: el mismo groupId es la misma
// tarjeta, no siempre el mismo jack). Con '3-4' no se pregunta: es el caso de la DDJ-400, cuyo master y
// audífonos son la misma salida. Lo demás → 'ok'. Sin salida o con canales inválidos → null.
export function decidirEleccion(salida, canales) {
  const c = validarCanales(canales);
  if (!salida || typeof salida !== 'object' || c === null) return null;
  return salida.esMaster === true && c === '1-2' ? 'confirmar-misma-salida' : 'ok';
}

// Lo que dice el bloque según el estado de la LISTA de salidas (salidas.js). 'lista' → null (se ve el
// selector). `nombreError`: el name del error de getUserMedia, sólo para 'error'. Estado desconocido → null.
export function textoListaSalidas(estado, nombreError) {
  switch (estado) {
    case 'sin-soporte': return 'Este navegador no puede mandar el cue a otra salida.';
    case 'inactivo': return 'Para mostrar los nombres de las salidas de audio, el navegador pide permiso de micrófono. No se graba nada: el micrófono se cierra al instante.';
    case 'pidiendo': return 'Pidiendo permiso de micrófono…';
    case 'denegado': return 'Permiso de micrófono denegado. Sin él, el navegador no muestra los nombres de las salidas. Puedes permitirlo desde el candado de la barra de direcciones.';
    case 'sin-microfono': return 'No hay ningún micrófono conectado, y sin micrófono el navegador no muestra los nombres de las salidas.';
    case 'error': return `No se pudo pedir el permiso de micrófono (${texto(nombreError) || 'error desconocido'}).`;
    case 'sin-nombres': return 'El navegador no dio los nombres de las salidas aunque hay permiso. Prueba a recargar la página.';
    case 'vacia': return 'No se encontró ninguna salida de audio.';
    default: return null;
  }
}

// La línea de estado del cue (motor.cue()). `conContexto`: si el motor ya abrió el contexto de cue
// (motor.contextoCue()); 'lista' sin contexto = elegida, se abre al activar un cue. 'error' → null: el
// aviso del motor se muestra aparte, tal cual. Estado desconocido → null.
// e3b: `activo` ({ A, B } de motor.cue()) suma los cues activos a la línea de 'lista' («· cue A y B»); sin
// ninguno (o sin `activo`), el texto es el de e3a.
export function textoEstadoCue(estado, nombre, canales, conContexto, activo) {
  const q = `«${texto(nombre) || 'la salida de audífonos'}»`;
  const c = `canales ${validarCanales(canales) ?? '1-2'}`;
  const a = textoCuesActivos(activo);
  const cues = a ? ` · ${a}` : '';
  switch (estado) {
    case 'sin-salida': return 'Sin salida de audífonos.';
    case 'abriendo': return `Abriendo ${q}…`;
    case 'lista': return conContexto ? `Listo: ${q} · ${c}${cues}.` : `${q} · ${c}${cues}. Se abre al activar un cue.`;
    default: return null;
  }
}

// ── Botones Cue, volumen y desfase (sub-paso e3b) ──

// Los cues activos en texto: 'cue A', 'cue B', 'cue A y B'; ninguno (o basura) → ''.
export function textoCuesActivos(activo) {
  const a = activo && typeof activo === 'object' && activo.A === true;
  const b = activo && typeof activo === 'object' && activo.B === true;
  return a && b ? 'cue A y B' : a ? 'cue A' : b ? 'cue B' : '';
}

// El botón «Cue» de un deck según el estado del cue (motor.cue().estado): habilitado con 'abriendo' y 'lista'
// (en 'abriendo' el motor guarda el pedido y lo aplica al quedar lista). Sin salida o en 'error' (el motor
// reintentaría abrir la salida sin avisar: el reintento es con «Usar»), deshabilitado con su explicación.
// Lo demás (sin motor, estado desconocido) → deshabilitado como sin salida.
export const TITULO_CUE_SIN_SALIDA = 'Elige la salida de audífonos en «Audífonos (cue)»';
export const TITULO_CUE_ERROR = 'La salida falló: quítala o elige otra';
export function estadoBotonCue(estado) {
  if (estado === 'abriendo' || estado === 'lista') return { habilitado: true, titulo: null };
  if (estado === 'error') return { habilitado: false, titulo: TITULO_CUE_ERROR };
  return { habilitado: false, titulo: TITULO_CUE_SIN_SALIDA };
}

// La nota bajo los controles de un deck con su cue activo: en V1 el cue sólo suena con el deck sonando (sin
// fuente en pausa). Cue apagado o deck sonando → null.
export const NOTA_CUE_VACIO = 'Cue activo: carga una canción y dale play para oírla en los audífonos.';
export const NOTA_CUE_PAUSA = 'Cue activo: dale play para preescuchar. En esta versión el cue no suena en pausa: baja el volumen del deck o el crossfader para que no salga por el master.';
export function textoNotaCue({ activo, cargado, sonando } = {}) {
  if (activo !== true || sonando === true) return null;
  return cargado === true ? NOTA_CUE_PAUSA : NOTA_CUE_VACIO;
}

// El desfase en pantalla: «+12 ms», «−8 ms» (signo menos tipográfico, como num() de los controles), «0 ms».
// Recortado y redondeado como lo aplica el motor (recortarDesfase); lo que no es un número finito → ''.
export function textoDesfase(ms) {
  const d = recortarDesfase(ms);
  if (d === null) return '';
  return d > 0 ? `+${d} ms` : d < 0 ? `−${-d} ms` : '0 ms';
}

// DIFERIDO (debounce al final de la ráfaga): pedir(v) guarda v y reinicia la espera; a los `ms` sin otro
// pedido llama fn(v) UNA vez con el último valor. cancelar() descarta lo pendiente; pendiente() dice si hay.
// Los timers se inyectan (dj-unit los prueba con unos falsos). fn que lanza no rompe el diferido.
export function crearDiferido(fn, ms, { poner = (f, t) => setTimeout(f, t), quitar = (id) => clearTimeout(id) } = {}) {
  let id = null;
  let valor;
  return {
    pedir(v) {
      valor = v;
      if (id !== null) quitar(id);
      id = poner(() => { id = null; try { fn(valor); } catch { /* el control sigue vivo */ } }, ms);
    },
    cancelar() { if (id !== null) { quitar(id); id = null; } },
    pendiente: () => id !== null,
  };
}

// ¿Volvió la salida que faltaba? `faltante` = { id, nombre } (el nombre VISIBLE con que se eligió); `salidas`
// = la lista nueva (filtrarSalidas). Primero por id; si no, por el nombre visible exacto (nombresVisibles: un
// nombre repetido lleva « (2)», así que el visible es único). → el id de la salida que volvió, o null.
export function buscarVuelta(faltante, salidas) {
  if (!faltante || typeof faltante !== 'object' || !Array.isArray(salidas)) return null;
  const id = typeof faltante.id === 'string' ? faltante.id : '';
  if (id && salidas.some((s) => s?.id === id)) return id;
  const n = texto(faltante.nombre);
  if (!n) return null;
  const vis = nombresVisibles(salidas);
  const i = vis.indexOf(n);
  return i >= 0 ? salidas[i].id : null;
}

// La pista de canales: con 1-2 marcado y una salida cuyo nombre contiene «DDJ» (la DDJ-400 es la única
// mezcladora probada). No elige nada; con 3-4 marcado no sale (ahí está el «Ojo» de la Sound Blaster).
export const PISTA_MEZCLADORA = 'Parece una mezcladora DJ: sus audífonos suelen ir por los canales 3-4.';
export function pistaMezcladora(nombre, canales) {
  return typeof nombre === 'string' && nombre.includes('DDJ') && canales === '1-2' ? PISTA_MEZCLADORA : null;
}
