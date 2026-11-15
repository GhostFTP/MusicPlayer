// MODO DJ · cue a audífonos (sub-paso e). PURO: sin AudioContext, sin DOM y sin localStorage (lo prueba
// dj-unit.mjs con node). Sub-paso e1: nadie lo importa todavía; el motor (e2) y la página (e3) lo usarán.
//
// EL CUE: un segundo AudioContext, con setSinkId a la salida de audífonos, donde suena cada deck CRUDO
// (antes del volumen, del crossfader y del filtro). Cada fuente de cue se crea en la posición que el deck
// tiene en el master, más un desfase manual. Este archivo tiene sólo las cuentas y los textos:
//   · recortarDesfase, volumenCue: los dos controles del cue.
//   · offsetRelojes, planCue: dónde y cuándo arranca una fuente de cue.
//   · filtrarSalidas, hayNombres, elegirGuardada: la lista de salidas y la salida recordada.
//   · textoAviso: los avisos cortos de la página.

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

// AVISOS. `motivo`: un caso de la página ('no-conectada', 'desconectada', 'misma-salida') o el name del
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
    default: return `No se pudo abrir la salida de audífonos (${texto(motivo) || 'error desconocido'}). Cue apagado; el master sigue igual.`;
  }
}
