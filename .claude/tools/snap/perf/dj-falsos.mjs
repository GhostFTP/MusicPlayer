// dj-falsos.mjs — los FALSOS del Modo DJ para scripts que no son dj-func (hoy: dj-matriz.mjs). COPIA, no import.
//
// Copiados el 2026-11-19 del commit f7cc333, de .claude/tools/snap/perf/dj-func.mjs:
//   · instalarAudio: AudioContext que cuenta construcciones y vivos, y el setSinkId FALSO para los ids del
//     mediaDevices falso (dj-func.mjs:107–114 y :119–135). NO se copió la instrumentación de la mezcla
//     (dj-func.mjs:115–118 y :136–174: aristas, escrituras de .value, rampas, tipos, grafo): la matriz no la usa.
//   · instalarMidi: lo mínimo para que /dj monte como en Edge con el permiso sin dar («Conectar DDJ-400» visible):
//     la config y el permiso (dj-func.mjs:183–187) y requestMIDIAccess + permissions.query (dj-func.mjs:227–239).
//     ADAPTADO: el acceso no tiene entradas (dj-func arma dos puertos en :192–226); nadie hace clic en «Conectar».
//   · instalarMediaDevices: el mediaDevices FALSO completo, con sus 9 dispositivos y __fdCfg (dj-func.mjs:241–299).
// Cada función agrega un init script al contexto: vale desde la PRÓXIMA navegación (como en dj-func, que recarga
// después de instalarlos, dj-func.mjs:315).
//
// ⚠ SINCRONIZAR A MANO: si dj-func.mjs cambia estos falsos (ids, nombres, __fdCfg, el setSinkId), esta copia NO se
// entera. Se actualiza en el mismo commit, citando de nuevo las líneas de origen.
import { preparar } from './tablet-util.mjs';

// El navegador (Chromium con --autoplay-policy=no-user-gesture-required), la sesión y el WAV sintético en
// /stream/** son los de tablet-util.mjs (preparar/abrir, tablet-util.mjs:23–79): no se copian.
export { preparar };

// dj-func.mjs:107–114 y :119–135.
export const instalarAudio = (ctx) => ctx.addInitScript(() => {
  const AC = window.AudioContext;
  if (!AC || window.__ac) return;
  const reg = { creados: 0, lista: [], opciones: [], maxVivos: 0 };
  reg.vivos = () => reg.lista.filter((c) => c.state !== 'closed').length;
  window.__ac = reg;
  window.AudioContext = class extends AC {
    constructor(...a) { super(...a); reg.creados++; reg.lista.push(this); reg.opciones.push(a[0] === undefined ? null : JSON.parse(JSON.stringify(a[0]))); reg.maxVivos = Math.max(reg.maxVivos, reg.vivos()); }
  };
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
});

// dj-func.mjs:183–187 y :227–239 (acceso ADAPTADO: sin entradas).
export const instalarMidi = (ctx) => ctx.addInitScript(() => {
  if (window.__fm) return;
  let cfg = {};
  try { cfg = JSON.parse(sessionStorage.getItem('__fmCfg') || '{}') || {}; } catch { cfg = {}; }
  const fm = { pedidos: [], permiso: cfg.permiso ?? 'prompt', enviados: 0 };
  window.__fm = fm;
  const acceso = { inputs: new Map(), outputs: new Map(), sysexEnabled: false, onstatechange: null, addEventListener() {}, removeEventListener() {} };   // adaptado
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
export const instalarMediaDevices = (ctx) => ctx.addInitScript(() => {
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
  const quitados = new Set(Array.isArray(cfg.quitados) ? cfg.quitados : []);   // e4a: { quitados: [id] } = desenchufadas al cargar
  const nuevosIds = new Map();   // e4a: __fd.cambiarId(id, nuevo) → la salida se enumera con OTRO id (mismo nombre)
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
      return Promise.resolve(conNombres ? LISTA.filter((d) => !quitados.has(d.deviceId)).map((d) => ({ ...d, deviceId: nuevosIds.get(d.deviceId) ?? d.deviceId }))
        : [{ kind: 'audioinput', deviceId: '', label: '', groupId: '' }, { kind: 'audiooutput', deviceId: '', label: '', groupId: '' }]);
    },
    addEventListener(tipo, fn, o) { if (tipo === 'devicechange') oy.add(fn); t.addEventListener(tipo, fn, o); },
    removeEventListener(tipo, fn, o) { if (tipo === 'devicechange') oy.delete(fn); t.removeEventListener(tipo, fn, o); },
  };
  fd.oyentes = () => oy.size;
  fd.quitar = (id) => { quitados.add(id); t.dispatchEvent(new Event('devicechange')); };
  fd.poner = (id) => { quitados.delete(id); t.dispatchEvent(new Event('devicechange')); };
  fd.cambiarId = (id, nuevo) => { nuevosIds.set(id, nuevo); };   // sin devicechange: lo dispara el próximo poner/quitar
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: medios });
  if (navigator.permissions) {
    const q0 = navigator.permissions.query.bind(navigator.permissions);   // ya envuelto por el MIDI falso
    Object.defineProperty(navigator.permissions, 'query', { configurable: true, value: (d) => (d?.name === 'microphone' ? Promise.resolve({ state: fd.permiso, onchange: null }) : q0(d)) });
  }
});

export async function instalarFalsos(ctx) { await instalarAudio(ctx); await instalarMidi(ctx); await instalarMediaDevices(ctx); }
