// RADIO WEB, LA LÓGICA (fase 1, sub-paso 1): todo lo que se decide sin tocar la red, el
// reproductor ni la pantalla — el código de sala, el reloj del servidor, la posición del oyente,
// cuándo corregir, qué hacer con cada lectura, cuándo publica el anfitrión y la lectura de lo
// que contesta el servidor.
//
// PURO: sin React, sin DOM, sin Date.now() y sin timers. La hora entra SIEMPRE por parámetro.
// Lo prueba .claude/tools/snap/perf/radio-unit.mjs con Node.
//
// ES UN PORT FIEL de la app de iOS, con los mismos números y las mismas reglas:
//   · sonorarev-ios lib/radio/sincronia.ts (commit 18d7790) — casi todo este archivo.
//   · sonorarev-ios components/radio/puente-anfitrion.tsx (2a3bc86) — la "puerta" de
//     publicación (una sola en vuelo, Retry-After, reintento, canción rechazada), que allá son
//     variables sueltas del puente y acá funciones puras.
//   · sonorarev-ios components/radio/puente-oyente.tsx (2a3bc86) — la espera entre sondeos y
//     DESAJUSTE_MS.
//   · sonorarev-ios lib/radio/vista.ts (18d7790) — qué publica el anfitrión según su reproductor
//     (estadoDelAnfitrion), el texto de por qué terminó la radio (textoDeFin) y lo del oyente:
//     con qué cola arranca, la foto para devolverle lo suyo al salir y cuándo pausó él.
// Si se cambia una regla acá, hay que cambiarla allá (o decidir a propósito que divergen).
//
// El backend es music-server/src/api/radio.js (1.29.0): POST /api/radio,
// PUT /api/radio/:code/state, GET /api/radio/:code y DELETE /api/radio/:code. El estado vive en
// la memoria del servidor: un redeploy cierra las radios. Desde 1.43.0, además, moderadores y
// control remoto (PUT/DELETE /:code/moderadores/:userId, POST /:code/ordenes): ver "Moderación".

// ---- Las perillas ----
//
// ⚠️ Como en iOS: SON SUPOSICIONES, NO MEDICIONES (la deriva se midió una vez en Chromium, en una
// sola máquina: 40-55 ms constantes en 150 s; eso no es una red real).
export const RADIO = Object.freeze({
  // El oyente
  /** Cada cuánto pregunta el oyente por el estado. */
  SONDEO_MS: 2000,
  /** Con menos desfase que este, no se corrige: un seek cuesta un corte audible. */
  TOLERANCIA_MS: 2000,
  /** Cada cuánto se mide el desfase. */
  REVISAR_CADA_MS: 5000,
  /** Como mucho una corrección cada tanto. */
  MIN_ENTRE_CORRECCIONES_MS: 10_000,
  /** Con correcciones seguidas que no asientan, la espera se duplica cada vez, hasta este tope. */
  MAX_ENTRE_CORRECCIONES_MS: 80_000,
  /** Cuánto ADELANTE del objetivo se apunta el seek. En 0 hasta que se mida esa latencia. */
  ADELANTO_SEEK_MS: 0,
  /** Si al objetivo le falta menos que esto para el final, no se corrige: la canción termina sola. */
  MARGEN_FIN_MS: 3000,

  // El anfitrión
  /** El latido: una publicación aunque no haya cambiado nada. */
  LATIDO_MS: 10_000,
  /** Un salto de posición MAYOR que este se publica. */
  SALTO_MS: 1500,
  /** Mínimo entre dos publicaciones por SALTO (el servidor corta a las 20 cada 10 s). */
  MIN_ENTRE_SALTOS_MS: 1000,
  /** Después de un intento que no llegó (sin respuesta o error del servidor), cuánto esperar. */
  REINTENTO_MS: 3000,

  // El reloj
  /** Una petición que tardó más que esto no sirve de muestra. */
  DEMORA_MAX_MS: 8000,
  /** La mejor muestra se olvida pasado este tiempo: la red cambia. */
  MUESTRA_CADUCA_MS: 5 * 60_000,

  // La red
  /** Cuánto se espera cada petición de la radio. */
  TIMEOUT_MS: 6000,

  // Topes de lo que se acepta del servidor
  POSICION_MAX_MS: 24 * 60 * 60_000,
  OYENTES_MAX: 50,
  NOMBRE_MAX: 40,
  /** Retry-After más largo que se respeta, en segundos; sin cabecera (o absurda), 5 s. */
  RETRY_AFTER_MAX_S: 120,
  RETRY_AFTER_DEFECTO_S: 5,
});

const finito = (v) => typeof v === 'number' && Number.isFinite(v);
const esId = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const objeto = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

// ---- El código ----

/** Sin 0/O, 1/I/L: el alfabeto del servidor (music-server/src/radio/reglas.js). */
export const ALFABETO_CODIGO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const LARGO_CODIGO = 6;

/** Lo que se va escribiendo en el campo: mayúsculas, solo caracteres de código, seis como mucho. */
export function limpiarCodigoEscrito(texto) {
  if (typeof texto !== 'string') return '';
  let c = '';
  for (const ch of texto.toUpperCase()) {
    if (ALFABETO_CODIGO.includes(ch)) c += ch;
    if (c.length === LARGO_CODIGO) break;
  }
  return c;
}

/** El código listo para mandar, o null. Perdona minúsculas, espacios y guiones ("k7m 2qx",
 *  "K7M-2QX"); NO perdona un carácter que no es de código ni un largo distinto. */
export function normalizarCodigo(texto) {
  if (typeof texto !== 'string') return null;
  const c = texto.toUpperCase().replace(/[\s-]/g, '');
  if (c.length !== LARGO_CODIGO) return null;
  for (const ch of c) if (!ALFABETO_CODIGO.includes(ch)) return null;
  return c;
}

/** Cuánto de un texto pegado se mira, como mucho. */
const PEGADO_MAX = 2000;

/** ¿Es parte de una palabra? Letras y dígitos ASCII, y las letras con mayúscula y minúscula. */
function esDePalabra(ch) {
  if (ch.length !== 1) return false;
  if ((ch >= '0' && ch <= '9') || (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z')) return true;
  return ch.charCodeAt(0) > 0x7f && ch.toLowerCase() !== ch.toUpperCase();
}

/**
 * De un texto PEGADO, el código de una radio, o null. Dos reglas, en orden:
 *   1. El texto entero ES un código (`normalizarCodigo`).
 *   2. Si no, las palabras AISLADAS de seis caracteres del alfabeto y ya EN MAYÚSCULAS. Vale
 *      solo si hay exactamente UN código distinto; con ninguno o con dos distintos, null.
 */
export function codigoPegado(texto) {
  if (typeof texto !== 'string' || texto.length === 0) return null;
  const t = texto.length > PEGADO_MAX ? texto.slice(0, PEGADO_MAX) : texto;
  const entero = normalizarCodigo(t);
  if (entero) return entero;

  let hallado = null;
  let palabra = '';
  for (const ch of t + ' ') {
    if (esDePalabra(ch)) { palabra += ch; continue; }
    if (palabra.length === LARGO_CODIGO) {
      let vale = true;
      for (const c of palabra) if (!ALFABETO_CODIGO.includes(c)) { vale = false; break; }
      if (vale) {
        if (hallado != null && hallado !== palabra) return null;
        hallado = palabra;
      }
    }
    palabra = '';
  }
  return hallado;
}

// ---- El reloj ----
//
// Muestra: { enviadoMs, recibidoMs, serverNow } (los dos primeros, reloj LOCAL).
// Reloj:   { offsetMs, demoraMs, tomadaMs }, con horaServidor = horaLocal + offsetMs.

/** Una muestra → una estimación, o null si es absurda. Se supone ida = vuelta: el servidor
 *  contestó en el punto medio del viaje. */
export function relojDeMuestra(m) {
  if (!m || !finito(m.enviadoMs) || !finito(m.recibidoMs) || !finito(m.serverNow)) return null;
  const demoraMs = m.recibidoMs - m.enviadoMs;
  if (demoraMs < 0 || demoraMs > RADIO.DEMORA_MAX_MS || m.serverNow <= 0) return null;
  return { offsetMs: m.serverNow - (m.enviadoMs + m.recibidoMs) / 2, demoraMs, tomadaMs: m.recibidoMs };
}

/** Se queda con la muestra de MENOR demora (en empate, la nueva). La mejor caduca a los 5 min. */
export function mejorReloj(actual, muestra) {
  const nueva = relojDeMuestra(muestra);
  if (!nueva) return actual;
  if (!actual) return nueva;
  if (nueva.tomadaMs - actual.tomadaMs >= RADIO.MUESTRA_CADUCA_MS) return nueva;
  return nueva.demoraMs <= actual.demoraMs ? nueva : actual;
}

/** La hora del servidor ahora, o null si todavía no hay reloj. */
export function horaServidor(reloj, localMs) {
  return reloj && finito(localMs) ? localMs + reloj.offsetMs : null;
}

// ---- Lo que contesta el servidor, leído como dato de afuera ----
//
// Estado: { seq, trackId (null solo con enPausaPorVideo), positionMs, playing, nextTrackId,
//           enPausaPorVideo, publishedAtServerMs }.
// Razón de fin: 'anfitrion' | 'admin' | 'reemplazada' | 'sin-anfitrion' | 'pausa' | 'otro'
// ("otro" = un motivo que esta versión no conoce).

const RAZONES = ['anfitrion', 'admin', 'reemplazada', 'sin-anfitrion', 'pausa'];
function leerRazon(v) {
  if (v == null) return null;
  return typeof v === 'string' && RAZONES.includes(v) ? v : 'otro';
}

/** El estado publicado, `null` (el anfitrión todavía no publicó) o `undefined` (sin la forma). */
export function leerEstado(v) {
  if (v === null) return null;
  const e = objeto(v);
  if (!e) return undefined;
  if (!esId(e.seq) || typeof e.playing !== 'boolean') return undefined;
  if (!finito(e.positionMs) || !finito(e.publishedAtServerMs) || e.publishedAtServerMs <= 0) return undefined;
  const enPausaPorVideo = e.enPausaPorVideo === true;
  let trackId = null;
  if (e.trackId != null) {
    if (!esId(e.trackId)) return undefined;
    trackId = e.trackId;
  } else if (!enPausaPorVideo) return undefined;
  return {
    seq: e.seq,
    trackId,
    positionMs: Math.min(Math.max(0, Math.round(e.positionMs)), RADIO.POSICION_MAX_MS),
    // Viendo un video la música no suena, diga lo que diga el campo.
    playing: enPausaPorVideo ? false : e.playing,
    nextTrackId: esId(e.nextTrackId) ? e.nextTrackId : null,
    enPausaPorVideo,
    publishedAtServerMs: e.publishedAtServerMs,
  };
}

/** Solo la ruta de avatar del propio servidor, relativa, con su `?v=` opcional. */
const URL_AVATAR = /^\/api\/users\/\d{1,12}\/avatar(\?v=\d{1,16})?$/;

export function leerAvatar(v) {
  const a = objeto(v);
  if (!a) return null;
  if (a.kind === 'emoji') {
    return typeof a.value === 'string' && a.value.length > 0 && a.value.length <= 16 && !/[\u0000-\u007f]{2,}/.test(a.value)
      ? { kind: 'emoji', value: a.value } : null;
  }
  if (a.kind === 'photo') {
    if (typeof a.url !== 'string' || !URL_AVATAR.test(a.url)) return null;
    const updatedAt = typeof a.updatedAt === 'string' && a.updatedAt.length <= 40 ? a.updatedAt : '';
    return { kind: 'photo', url: a.url, updatedAt };
  }
  return null;
}

/** Controles, separadores de línea/párrafo, espacios de ancho cero y marcas de dirección. */
function esInvisible(cp) {
  return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029
    || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);
}

/** Un nombre para pintar: sin controles ni saltos, cortado en la arroba y acotado. */
export function leerNombre(v) {
  if (typeof v !== 'string') return '';
  let n = [...v].map((ch) => (esInvisible(ch.codePointAt(0) ?? 0) ? ' ' : ch)).join('').replace(/\s+/g, ' ').trim();
  const arroba = n.indexOf('@');
  if (arroba > 0) n = n.slice(0, arroba);
  return [...n].slice(0, RADIO.NOMBRE_MAX).join('');
}

export function leerPersona(v) {
  const p = objeto(v);
  if (!p || !esId(p.id)) return null;
  return { id: p.id, name: leerNombre(p.name), avatar: leerAvatar(p.avatar) };
}

/** La respuesta de GET /api/radio/:code, o null si no tiene la forma (por ejemplo, la página de
 *  login de Cloudflare Access con su 200). */
export function leerRadio(json) {
  const r = objeto(json);
  if (!r) return null;
  if (!finito(r.serverNow) || r.serverNow <= 0) return null;
  const code = normalizarCodigo(r.code);
  if (!code) return null;
  if (r.status !== 'live' && r.status !== 'stale' && r.status !== 'ended') return null;
  const state = leerEstado(r.state ?? null);
  if (state === undefined) return null;
  const listeners = [];
  if (Array.isArray(r.listeners)) {
    const vistos = new Set();
    for (const x of r.listeners) {
      const p = leerPersona(x);
      if (!p || vistos.has(p.id)) continue;
      vistos.add(p.id);
      listeners.push(p);
      if (listeners.length === RADIO.OYENTES_MAX) break;
    }
  }
  const leida = {
    serverNow: r.serverNow,
    code,
    status: r.status,
    endedReason: r.status === 'ended' ? leerRazon(r.endedReason) ?? 'otro' : null,
    state,
    host: leerPersona(r.host),
    listeners,
  };
  // 1.43.0, a pedido: sin `moderators` (una respuesta de 1.42.0), exactamente lo de siempre.
  const mod = leerModeracion(r);
  return mod ? { ...leida, ...mod } : leida;
}

/** La respuesta de POST /api/radio. */
export function leerCreada(json) {
  const r = objeto(json);
  if (!r || !finito(r.serverNow) || r.serverNow <= 0) return null;
  const code = normalizarCodigo(r.code);
  return code ? { code, serverNow: r.serverNow } : null;
}

/** La respuesta de PUT /api/radio/:code/state. */
export function leerPublicada(json) {
  const r = objeto(json);
  if (!r || !finito(r.serverNow) || r.serverNow <= 0) return null;
  const state = leerEstado(r.state);
  if (!state) return null;
  // 1.43.0: con una confirmación, el servidor devuelve las órdenes que siguen pendientes.
  return r.orders !== undefined ? { serverNow: r.serverNow, state, orders: leerOrdenes(r.orders) } : { serverNow: r.serverNow, state };
}

/** La respuesta de DELETE /api/radio/:code. */
export function leerTerminada(json) {
  const r = objeto(json);
  if (!r || !finito(r.serverNow) || r.serverNow <= 0 || r.status !== 'ended') return null;
  return { serverNow: r.serverNow, endedReason: leerRazon(r.endedReason) ?? 'otro' };
}

// ---- Moderación y control remoto (1.43.0) ----
//
// Lo nuevo del servidor (music-server/src/api/radio.js, S4) llega SOLO a pedido: el GET con ?cap=mod
// o ?desde=N trae moderators, capabilities, events, eventsUntil y eventsLost (y orders, solo al
// anfitrión); el PUT /state con una confirmación trae orders. Por eso estas lecturas también son a
// pedido: si la respuesta no trae `moderators` (una de 1.42.0), leerRadio devuelve EXACTAMENTE lo de
// siempre, sin una clave más; y si no trae `orders`, leerPublicada tampoco.
//
// Las claves viajan en inglés y los valores en español (type: 'pausa', reason: 'sin-permiso').

/** Los tipos de orden (los de music-server/src/radio/reglas.js, TIPOS_ORDEN). */
export const TIPOS_ORDEN = Object.freeze(['siguiente', 'pausa', 'reanudar', 'a-continuacion', 'ahora']);
const CON_PISTA = new Set(['a-continuacion', 'ahora']);
/** Los tipos de evento: los de las órdenes más nombrar y quitar a quien modera. */
export const TIPOS_EVENTO = Object.freeze([...TIPOS_ORDEN, 'moderador', 'sin-moderador']);
/** Topes de lo que se acepta (los del servidor: MAX_MODERADORES, MAX_ORDENES, MAX_EVENTOS, TITULO_MAX). */
export const MODERACION = Object.freeze({ MODERADORES_MAX: 3, ORDENES_MAX: 10, EVENTOS_MAX: 20, TITULO_MAX: 100 });

const esSeq = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/** El título de una canción en un evento o una orden: limpio y acotado, o null. */
function leerTitulo(v) {
  if (typeof v !== 'string') return null;
  const t = [...v].map((ch) => (esInvisible(ch.codePointAt(0) ?? 0) ? ' ' : ch)).join('').replace(/\s+/g, ' ').trim();
  const corto = [...t].slice(0, MODERACION.TITULO_MAX).join('').trim();
  return corto || null;
}

/** Una lista del servidor leída con `leer`: sin los que no tienen forma, sin ids repetidos y con tope. */
function lista(v, leer, max) {
  const out = [];
  if (!Array.isArray(v)) return out;
  const vistos = new Set();
  for (const x of v) {
    const e = leer(x);
    if (!e || vistos.has(e.id)) continue;
    vistos.add(e.id);
    out.push(e);
    if (out.length === max) break;
  }
  return out;
}

/** Un evento ("Sonia pausó"), o null si no tiene la forma o es de un tipo que esta versión no conoce. */
export function leerEvento(v) {
  const e = objeto(v);
  if (!e || !esId(e.id) || !TIPOS_EVENTO.includes(e.type) || !finito(e.at)) return null;
  return {
    id: e.id,
    type: e.type,
    by: esId(e.by) ? e.by : null,
    byName: leerNombre(e.byName),
    target: esId(e.target) ? e.target : null,
    targetName: leerNombre(e.targetName),
    trackId: esId(e.trackId) ? e.trackId : null,
    title: leerTitulo(e.title),
    at: e.at,
  };
}

/** Una orden como la recibe el anfitrión, o null. "siguiente" sin trackBase no se puede comprobar:
 *  se lee igual y planDeOrden la descarta. */
export function leerOrdenRecibida(v) {
  const o = objeto(v);
  if (!o || !esId(o.id) || !TIPOS_ORDEN.includes(o.type) || !esId(o.by)) return null;
  const trackId = esId(o.trackId) ? o.trackId : null;
  if (CON_PISTA.has(o.type) && trackId == null) return null;
  return {
    id: o.id,
    type: o.type,
    trackId: CON_PISTA.has(o.type) ? trackId : null,
    seqBase: esSeq(o.seqBase) ? o.seqBase : null,
    trackBase: esId(o.trackBase) ? o.trackBase : null,
    by: o.by,
    title: leerTitulo(o.title),
  };
}

/** La respuesta de POST /api/radio/:code/ordenes (202), o null. */
export function leerOrdenEnviada(json) {
  const r = objeto(json);
  if (!r || !esId(r.id) || !finito(r.serverNow) || r.serverNow <= 0) return null;
  return { id: r.id, repeated: r.repeated === true, serverNow: r.serverNow };
}

/** Lo de la moderación de una respuesta del GET, o null si no lo trae (una de 1.42.0). */
function leerModeracion(r) {
  if (r.moderators === undefined) return null;
  const caps = objeto(r.capabilities);
  return {
    moderators: lista(r.moderators, leerPersona, MODERACION.MODERADORES_MAX),
    // Solo un true de verdad: un "true" en texto o un 1 no cuentan (como el servidor).
    capabilities: { orders: caps?.orders === true },
    events: lista(r.events, leerEvento, MODERACION.EVENTOS_MAX).sort((a, b) => a.id - b.id),
    eventsUntil: esSeq(r.eventsUntil) ? r.eventsUntil : null,
    eventsLost: r.eventsLost === true,
    ...(r.orders !== undefined ? { orders: leerOrdenes(r.orders) } : {}),
  };
}

const leerOrdenes = (v) => lista(v, leerOrdenRecibida, MODERACION.ORDENES_MAX).sort((a, b) => a.id - b.id);

/**
 * Qué hace el reproductor del anfitrión con una orden, según lo que suena AHORA.
 * `actual`: lo de estadoDelAnfitrion ({ trackId, playing, enPausaPorVideo }) y, desde W3, dos datos
 * LOCALES del puente que NO se publican (lo publicado sigue siendo lo de 1.42.0):
 *   · haySiguiente: lo de siguienteDelMotor (true | false | null = no se sabe). Sin el dato
 *     (undefined), lo de W1: "siguiente" se aplica sin preguntar al motor.
 *   · alFinal: lo de alFinalDeLaCola (la cola terminó y no hay nada por sonar).
 * → { aplicar: true } o { aplicar: false, motivo }. Las dos se confirman (ordenHasta); solo las
 *   aplicadas van en `aplicadas` y quedan como evento.
 *   · Viendo un video no se aplica nada: la radio está en pausa por el video ('video').
 *   · "siguiente" salta LA canción que veía quien ordenó: si ya suena otra, 'obsoleta'. Si el motor
 *     no tiene a dónde ir (haySiguiente === false), 'sin-siguiente'. Si no se sabe (null),
 *     { aplicar: true, verificar: true }: el puente la aplica y solo la da por aplicada si la pista
 *     cambió. Desde M4 (aleatorio con orden fijo) siguienteDelMotor ya no devuelve null; el camino
 *     queda como red para un dato que no se pueda calcular.
 *   · pausa y reanudar son ABSOLUTAS: si ya estaba así, se aplica igual (no cambia nada y dos
 *     personas que pulsan a la vez dan el mismo resultado). Sin canción, 'sin-cancion'.
 *   · a continuación y ahora llevan su pista; sin ella, 'invalida'. Se aplican AUNQUE no suene nada
 *     (el anfitrión empieza a reproducir esa pista: playAfterCurrent arranca si la cola está vacía).
 *     Con la cola TERMINADA (alFinal), "a continuación" es "ahora" ({ aplicar: true, como: 'ahora' }):
 *     no hay nada después de lo que sonó, así que esperar a la siguiente sería esperar para siempre.
 * Al terminar la cola, el reproductor del anfitrión se queda en la ÚLTIMA pista, en pausa y al final
 * (medido en la web, 1.43.0): `actual` trae esa pista, no null. "reanudar" ahí vuelve a empezar esa
 * pista (medido): se deja así, es lo que haría el botón de play del anfitrión.
 */
export function planDeOrden(orden, actual) {
  const o = objeto(orden);
  const a = objeto(actual);
  if (!o || !a || !TIPOS_ORDEN.includes(o.type)) return { aplicar: false, motivo: 'invalida' };
  if (a.enPausaPorVideo === true) return { aplicar: false, motivo: 'video' };
  const suena = esId(a.trackId) ? a.trackId : null;
  switch (o.type) {
    case 'siguiente':
      if (suena == null) return { aplicar: false, motivo: 'sin-cancion' };
      if (o.trackBase !== suena) return { aplicar: false, motivo: 'obsoleta' };
      if (a.haySiguiente === false) return { aplicar: false, motivo: 'sin-siguiente' };
      return a.haySiguiente === null ? { aplicar: true, verificar: true } : { aplicar: true };
    case 'pausa':
    case 'reanudar':
      return suena == null ? { aplicar: false, motivo: 'sin-cancion' } : { aplicar: true };
    default:
      if (!esId(o.trackId)) return { aplicar: false, motivo: 'invalida' };
      return o.type === 'a-continuacion' && a.alFinal === true ? { aplicar: true, como: 'ahora' } : { aplicar: true };
  }
}

// ---- Lo LOCAL del anfitrión para las órdenes (W3). Nada de esto se publica. ----

/**
 * ¿Un "siguiente" MANUAL del motor (PlayerContext next() = playNext(false, true)) tiene a dónde ir?
 * p: { queue, queueIndex, shuffle, repeat, upNext } tal cual los expone usePlayer().
 * → true | false. Calca playNext, en su orden:
 *   1. lo de "a continuación" (upNext, por _qid) gana siempre, si sigue en la cola;
 *   2. la de después en la cola, o con 'all' la primera. Vale igual con el aleatorio encendido: desde
 *      M4 la cola ES el orden barajado y playNext camina por posición (antes sorteaba entre las no
 *      sonadas, que el motor no expone, y esto devolvía null = no se sabe). `shuffle` ya no cuenta.
 *   Repetir una ('one') no cuenta: un siguiente manual la ignora (solo vale al terminar sola).
 */
export function siguienteDelMotor(p) {
  const q = objeto(p) ?? {};
  const cola = Array.isArray(q.queue) ? q.queue : [];
  const len = cola.length;
  if (len === 0) return false;
  const pendientes = q.upNext instanceof Set ? [...q.upNext] : Array.isArray(q.upNext) ? q.upNext : [];
  if (pendientes.length && cola.some((t) => pendientes.includes(objeto(t)?._qid))) return true;
  const idx = Number.isInteger(q.queueIndex) ? q.queueIndex : -1;
  if (idx + 1 < len) return true;
  return q.repeat === 'all';
}

/** Cuánto antes del final una pista parada cuenta como "terminó" para alFinalDeLaCola. */
export const FIN_DE_COLA_MS = 1000;

/**
 * ¿La cola del anfitrión TERMINÓ? Es lo que deja el motor al acabarse la cola (medido): la última
 * pista en pausa, con la posición en su duración. La regla:
 *   en pausa  Y  duración conocida (> 0)  Y  posición ≥ duración − FIN_DE_COLA_MS
 *   Y  haySiguiente !== true (no hay nada por sonar, o no se sabe).
 * "No se sabe" (null; desde M4 siguienteDelMotor ya no lo da, ni con aleatorio) cuenta como
 * terminada: si la pista llegó al final y el motor
 * no pasó solo a otra, es que no tenía a dónde (playNext natural). Lo único que la confunde es
 * pausar a mano en el último segundo con canciones por sonar; ahí "a continuación" suena ya.
 * p: { playing, posicionMs, duracionMs, haySiguiente }.
 */
export function alFinalDeLaCola(p) {
  const q = objeto(p) ?? {};
  if (q.playing === true || q.haySiguiente === true) return false;
  if (!finito(q.duracionMs) || q.duracionMs <= 0 || !finito(q.posicionMs)) return false;
  return q.posicionMs >= q.duracionMs - FIN_DE_COLA_MS;
}

/**
 * Lo que va en el próximo PUT para confirmar órdenes, o null si no hay nada.
 * resueltas: [{ id, aplicada }] ya resueltas y sin confirmar (en cualquier orden).
 * → { ordenHasta, aplicadas }: el servidor saca de la lista TODO hasta ordenHasta y deja como evento
 *   solo las de `aplicadas`, que tiene tope (MODERACION.ORDENES_MAX, 10). Si hay más aplicadas, va
 *   una TANDA: ordenHasta corta en la décima aplicada (las descartadas de antes entran en la misma)
 *   y lo demás sale en el PUT siguiente. Ids repetidos o raros no cuentan dos veces.
 */
export function confirmacionDe(resueltas) {
  const vistos = new Set();
  const lista = (Array.isArray(resueltas) ? resueltas : [])
    .filter((r) => objeto(r) && esId(r.id) && !vistos.has(r.id) && vistos.add(r.id))
    .sort((a, b) => a.id - b.id);
  if (!lista.length) return null;
  const aplicadas = [];
  let ordenHasta = 0;
  for (const r of lista) {
    if (r.aplicada === true) {
      if (aplicadas.length === MODERACION.ORDENES_MAX) break;
      aplicadas.push(r.id);
    }
    ordenHasta = r.id;
  }
  return { ordenHasta, aplicadas };
}

/**
 * El texto de un evento, para la región viva y el aviso. Redacción NEUTRA de género. `yo`: mi id
 * (quien hizo la acción, o a quien se la hicieron, se nombra "Tú" / "te"). Sin nombre, "Alguien".
 * Un tipo que esta versión no conoce no llega acá (leerEvento lo descarta); por si acaso, null.
 */
export function textoDeEvento(e, yo) {
  const ev = objeto(e);
  if (!ev) return null;
  const soyYo = ev.by != null && ev.by === yo;
  const quien = soyYo ? 'Tú' : ev.byName || 'Alguien';
  const v = (el, tu) => (soyYo ? tu : el);
  const cancion = (t) => (t ? `«${t}»` : 'una canción');
  const aMi = ev.target != null && ev.target === yo;
  const aQuien = ev.targetName || 'alguien';
  switch (ev.type) {
    case 'siguiente': return `${quien} ${v('pasó', 'pasaste')} a la siguiente canción`;
    case 'pausa': return `${quien} ${v('pausó', 'pausaste')}`;
    case 'reanudar': return `${quien} ${v('reanudó', 'reanudaste')}`;
    case 'a-continuacion': return `${quien} ${v('puso', 'pusiste')} ${cancion(ev.title)} a continuación`;
    case 'ahora': return `${quien} ${v('puso', 'pusiste')} ${cancion(ev.title)}`;
    case 'moderador':
      return aMi ? `${quien} te nombró para moderar` : `${quien} ${v('nombró', 'nombraste')} a ${aQuien} para moderar`;
    case 'sin-moderador':
      return aMi ? `${quien} te quitó el control` : `${quien} le ${v('quitó', 'quitaste')} el control a ${aQuien}`;
    default: return null;
  }
}

/** ¿`miId` modera esta radio? (el anfitrión no: la radio es suya). Sin lo de la moderación, no. */
export function esModerador(radio, miId) {
  const r = objeto(radio);
  if (!r || !esId(miId) || !Array.isArray(r.moderators) || r.host?.id === miId) return false;
  return r.moderators.some((p) => p?.id === miId);
}

/** El rol de una persona en la radio: 'anfitrion', 'moderador' o null. */
export function rolEnLaRadio(radio, id) {
  const r = objeto(radio);
  if (!r || !esId(id)) return null;
  if (r.host?.id === id) return 'anfitrion';
  return esModerador(r, id) ? 'moderador' : null;
}

/** El texto de la insignia de cada rol (neutro): lo que se lee junto al nombre. */
export const INSIGNIA = Object.freeze({ anfitrion: 'Anfitrión', moderador: 'Modera' });

// ---- La lista de oyentes del anfitrión (W4) ----

const idsDe = (v) => new Set((v instanceof Set ? [...v] : Array.isArray(v) ? v : []).map((x) => (objeto(x) ? x.id : x)).filter(esId));

/** La nota de quien modera sin estar escuchando (neutra). */
export const TEXTO_NO_ESCUCHA = 'No está escuchando';

/**
 * Quiénes van en la lista del anfitrión: los oyentes, y AL FINAL los que moderan sin estar escuchando
 * (el rol dura hasta que el anfitrión lo quite: sin fila no se los podría quitar, y con 3 el tope quedaría
 * trabado). → [{ ...persona, ausente: boolean }]. Sin repetidos.
 */
export function personasDeLaLista(p) {
  const q = objeto(p) ?? {};
  const oyentes = (Array.isArray(q.oyentes) ? q.oyentes : []).filter((x) => objeto(x) && esId(x.id));
  const estan = new Set(oyentes.map((x) => x.id));
  const fuera = (Array.isArray(q.moderadores) ? q.moderadores : []).filter((x) => objeto(x) && esId(x.id) && !estan.has(x.id) && estan.add(x.id));
  return [...oyentes.map((x) => ({ ...x, ausente: false })), ...fuera.map((x) => ({ ...x, ausente: true }))];
}

/**
 * La fila de un oyente en la lista del anfitrión. p: { id, moderadores ([{ id }] o ids), sinSoporte
 * (Set o lista de ids que respondieron 409 sin-soporte en esta sala), ausente (modera sin escuchar) }.
 * → { insignia: 'Modera' | null, boton: 'quitar' | 'nombrar' | null, nota: texto | null }
 *   · Quien modera: la insignia y "Quitar" (si no está escuchando, además la nota TEXTO_NO_ESCUCHA).
 *   · Quien respondió sin-soporte: sin botón y con la nota; no se reintenta en esta sala.
 *   · Con el tope lleno, "Hacer moderador" se OCULTA (no se deshabilita): lo explica lineaDelTope.
 */
export function filaDeOyente(p) {
  const q = objeto(p) ?? {};
  const mods = idsDe(q.moderadores);
  if (esId(q.id) && mods.has(q.id)) return { insignia: INSIGNIA.moderador, boton: 'quitar', nota: q.ausente === true ? TEXTO_NO_ESCUCHA : null };
  if (esId(q.id) && idsDe(q.sinSoporte).has(q.id)) return { insignia: null, boton: null, nota: textoDeFallo('moderar', { error: 'sin-soporte' }) };
  if (!esId(q.id) || mods.size >= MODERACION.MODERADORES_MAX) return { insignia: null, boton: null, nota: null };
  return { insignia: null, boton: 'nombrar', nota: null };
}

/** La línea que explica por qué no hay "Hacer moderador", o null si todavía se puede nombrar. */
export function lineaDelTope(moderadores) {
  return idsDe(moderadores).size >= MODERACION.MODERADORES_MAX ? textoDeFallo('moderar', { error: 'moderadores-llenos' }) : null;
}

/** Los eventos vistos más los que llegan: sin repetidos (por id), en orden y solo los últimos EVENTOS_MAX. */
export function juntarEventos(previos, llegados) {
  const porId = new Map();
  for (const e of [...(Array.isArray(previos) ? previos : []), ...(Array.isArray(llegados) ? llegados : [])]) {
    if (objeto(e) && esId(e.id) && !porId.has(e.id)) porId.set(e.id, e);
  }
  return [...porId.values()].sort((a, b) => a.id - b.id).slice(-MODERACION.EVENTOS_MAX);
}

// ---- Los eventos y el aviso de rol del OYENTE (W5a) ----

/** El aviso al oyente cuando el anfitrión le da o le quita el rol (neutros). */
export const TEXTO_PUEDES_MODERAR = 'Puedes moderar esta radio';
export const TEXTO_YA_NO_MODERAS = 'Ya no puedes moderar esta radio';

/**
 * Lectura por lectura, qué anuncia el oyente. previo: { cursor, moderaba } | null (null = la PRIMERA
 * lectura, la de unirse: solo fija la base: el cursor en eventsUntil y si ya moderaba; no anuncia nada).
 * radio: lo de leerRadio. yo: mi id.
 * → { estado: { cursor, moderaba } | null, nuevos: [eventos], anuncios: [{ texto, toast }] }
 *   · Una respuesta sin moderación (moderators ausente): nada cambia.
 *   · Los eventos con id > cursor son nuevos; el cursor pasa a eventsUntil (nunca retrocede).
 *   · eventsLost: el cursor se adelanta y no se anuncia ningún evento (se perdió el hilo).
 *   · Nombrarme o quitarme no se anuncia como evento: lo dice el aviso de rol, que sale de comparar
 *     moderators entre esta lectura y la anterior (así no se anuncia dos veces).
 *   · toast: solo lo ajeno (avisarEvento) y el aviso de rol.
 */
export function pasoDeEventos(previo, radio, yo) {
  const r = objeto(radio);
  const p = objeto(previo);
  if (!r || !Array.isArray(r.moderators)) return { estado: p ? { cursor: p.cursor, moderaba: p.moderaba } : null, nuevos: [], anuncios: [] };
  const modera = esModerador(r, yo);
  const hasta = esSeq(r.eventsUntil) ? r.eventsUntil : (p && esSeq(p.cursor) ? p.cursor : 0);
  if (!p) return { estado: { cursor: hasta, moderaba: modera }, nuevos: [], anuncios: [] };
  const cursor = esSeq(p.cursor) ? Math.max(p.cursor, hasta) : hasta;
  const nuevos = r.eventsLost === true ? []
    : (Array.isArray(r.events) ? r.events : []).filter((e) => objeto(e) && esId(e.id) && e.id > (p.cursor ?? 0)).sort((a, b) => a.id - b.id);
  const anuncios = [];
  for (const e of nuevos) {
    if ((e.type === 'moderador' || e.type === 'sin-moderador') && e.target != null && e.target === yo) continue;
    const texto = textoDeEvento(e, yo);
    if (texto) anuncios.push({ texto, toast: avisarEvento(e, yo) });
  }
  if (modera && p.moderaba !== true) anuncios.push({ texto: TEXTO_PUEDES_MODERAR, toast: true });
  if (!modera && p.moderaba === true) anuncios.push({ texto: TEXTO_YA_NO_MODERAS, toast: true });
  return { estado: { cursor, moderaba: modera }, nuevos, anuncios };
}

// ---- Las órdenes de quien modera, desde su tarjeta de oyente (W5b-1) ----

/** Sin noticias de una orden: a los 5 s se avisa que se espera al anfitrión; a los 30 s (ORDEN_TTL_MS: el
 *  servidor la olvida ahí) se da por no aplicada. "No se aplicó" nunca antes de los 30 s. */
export const ORDEN_ESPERANDO_MS = 5000;
export const ORDEN_VENCE_MS = 30_000;
/** Los tipos que manda la tarjeta. "a-continuacion" y "ahora" son del menú "En la radio" (W5b-2). */
export const ORDENES_DE_LA_TARJETA = Object.freeze(['siguiente', 'pausa', 'reanudar']);
/** Los tipos del menú "En la radio" (W5b-2): llevan la pista (trackId). */
export const ORDENES_DEL_MENU = Object.freeze(['a-continuacion', 'ahora']);
export const TEXTOS_ORDEN = Object.freeze({
  enviando: 'Enviando…',
  esperando: 'Esperando al anfitrión…',
  yaCambio: 'Ya había cambiado',
  noSeAplico: 'No se aplicó',
  sinOrdenes: 'Esta radio no admite moderación',
  anterior: 'Espera a que se aplique la anterior',
  yaSuena: 'Ya suena en la radio',
});
/** La cuenta regresiva de un 429 (Retry-After). */
export const textoDeEspera = (s) => `Espera ${s} s`;

/**
 * ¿Cómo va una orden de quien modera? Pura: la llama el provider con cada lectura y con sus dos
 * temporizadores (5 s y 30 s).
 * orden: { tipo, baseTrackId (la canción que se veía al mandarla), cursor (eventsUntil de entonces),
 *          enviadaEn (ms), trackId (la pista pedida: solo "a-continuacion" y "ahora") }.
 * obs:   { ahoraMs, modera, estado (el de la radio que se ve: { trackId, playing } | null),
 *          eventos (los NUEVOS de esta lectura), yo }.
 * → 'cancelada' | 'aplicada' | 'ya-cambio' | 'no-se-aplico' | 'esperando' | 'en-vuelo'. En este orden:
 *  1. Sin el rol: 'cancelada' (sin error: lo dice el aviso de rol).
 *  2. Un evento MÍO de ese tipo, posterior al cursor con que salió: 'aplicada'.
 *  3. Lo que se ve: "siguiente" con otra canción que la base → 'ya-cambio' (cambió, pero no por mí; si
 *     fue por mí, el evento llega en la MISMA lectura y ganó el punto 2). Pausa o reanudar con la radio
 *     ya como se pidió → 'aplicada'. "ahora" con esa pista sonando → 'aplicada' ("a continuación" no se
 *     ve en el estado: solo la resuelve el evento).
 *  4. El tiempo, de respaldo: 30 s → 'no-se-aplico'; 5 s → 'esperando'; antes, 'en-vuelo'.
 */
export function resolverOrden(orden, obs) {
  const o = objeto(orden);
  const b = objeto(obs);
  if (!o || !b) return 'en-vuelo';
  if (b.modera !== true) return 'cancelada';
  if (eventoDeOrden(o, b.eventos, b.yo)) return 'aplicada';
  const e = objeto(b.estado);
  if (e) {
    if (o.tipo === 'siguiente' && o.baseTrackId != null && e.trackId !== o.baseTrackId) return 'ya-cambio';
    if (o.tipo === 'ahora' && o.trackId != null && e.trackId === o.trackId) return 'aplicada';
    if (o.tipo === 'pausa' && e.playing === false) return 'aplicada';
    if (o.tipo === 'reanudar' && e.playing === true) return 'aplicada';
  }
  const t = finito(b.ahoraMs) && finito(o.enviadaEn) ? b.ahoraMs - o.enviadaEn : 0;
  if (t >= ORDEN_VENCE_MS) return 'no-se-aplico';
  if (t >= ORDEN_ESPERANDO_MS) return 'esperando';
  return 'en-vuelo';
}

/** El evento MÍO que aplicó esta orden (de su tipo, posterior a su cursor y, si los dos la dicen, de la
 *  misma pista), o null. Con él el provider avisa una orden del menú con el texto del evento. */
export function eventoDeOrden(orden, eventos, yo) {
  const o = objeto(orden);
  if (!o) return null;
  const cursor = esSeq(o.cursor) ? o.cursor : 0;
  return (Array.isArray(eventos) ? eventos : []).find((e) => objeto(e) && esId(e.id) && e.id > cursor && e.type === o.tipo
    && e.by != null && e.by === yo && (o.trackId == null || e.trackId == null || e.trackId === o.trackId)) ?? null;
}

/** ¿Este evento va en el aviso breve (toast)? Solo los de OTROS, y con un texto que esta versión conozca:
 *  lo que hice yo ya lo vi al hacerlo (va igual a la región viva). */
export function avisarEvento(e, yo) {
  const ev = objeto(e);
  return !!ev && !(ev.by != null && ev.by === yo) && textoDeEvento(ev, yo) != null;
}

/**
 * ¿El submenú "En la radio" ofrece "Poner a continuación / Poner ahora" para este ítem?
 * p: { fase ('oyente' | 'anfitrion' | …), radio (lo de leerRadio), miId, item (una pista o un video) }.
 * Solo a quien modera, mientras escucha una radio abierta cuyo anfitrión ejecuta órdenes, y solo
 * con una CANCIÓN (un video no se puede poner en la radio).
 */
export function puedePonerEnRadio(p) {
  const q = objeto(p);
  if (!q || q.fase !== 'oyente') return false;
  const r = objeto(q.radio);
  if (!r || r.status === 'ended' || r.capabilities?.orders !== true) return false;
  return esModerador(r, q.miId) && idDeCancion(q.item) != null;
}

/**
 * ¿El submenú ofrece "Pedir en la radio"? Es de 1.43.1 (pedidos de los oyentes comunes): hoy el
 * servidor no declara esa capacidad (`capabilities.requests`), así que da false siempre. Queda la
 * regla para que el menú pregunte una sola vez: quien escucha y NO modera (quien modera pone directo).
 */
export function puedePedir(p) {
  const q = objeto(p);
  if (!q || q.fase !== 'oyente') return false;
  const r = objeto(q.radio);
  if (!r || r.status === 'ended' || r.capabilities?.requests !== true) return false;
  return esId(q.miId) && r.host?.id !== q.miId && !esModerador(r, q.miId) && idDeCancion(q.item) != null;
}

// ---- Los errores, como valores ----
//
// { error: 'sin-respuesta' | 'sesion' | 'invalido' | 'no-es-tuya' | 'no-existe' | 'sin-servicio'
//          | 'demasiadas' | 'llena' | 'cuerpo' | 'cancion' }
// | { error: 'terminada', razon } | { error: 'frecuencia', esperaMs } | { error: 'servidor', status }
// Desde 1.43.0, en 'moderar' y 'ordenar': 'sin-permiso' (403, NUNCA 'no-es-tuya': ese hace abandonar
// la radio), el motivo del 409 ('es-el-anfitrion' | 'no-escucha' | 'sin-soporte' | 'moderadores-llenos'
// | 'ordenes-llenas' | 'obsoleta') y el del 422 ('video' | 'sin-pista'). Lo demás, como las otras rutas.
//
// ruta: 'crear' | 'publicar' | 'leer' | 'terminar' | 'moderar' | 'ordenar'.

const MOTIVOS_409 = ['es-el-anfitrion', 'no-escucha', 'sin-soporte', 'moderadores-llenos', 'ordenes-llenas', 'obsoleta'];

/** Lo propio de las rutas de la moderación (lee `reason`), o null para caer al switch de siempre. */
function falloDeModeracion(status, data) {
  const reason = objeto(data)?.reason;
  if (status === 403) return { error: 'sin-permiso' };
  if (status === 409) return MOTIVOS_409.includes(reason) ? { error: reason } : { error: 'servidor', status };
  if (status === 422) return reason === 'video' ? { error: 'video' } : { error: 'sin-pista' };
  return null;
}

/** Un status que no es el de éxito → su fallo. `retryAfterS` es la cabecera Retry-After (s). */
export function falloDeStatus(ruta, status, data, retryAfterS) {
  if (ruta === 'moderar' || ruta === 'ordenar') {
    const propio = falloDeModeracion(status, data);
    if (propio) return propio;
  }
  switch (status) {
    case 400: return { error: 'invalido' };
    case 401: return { error: 'sesion' };
    // El servidor solo contesta 403 al publicar o terminar; al crear o al leer es de otra capa.
    case 403: return ruta === 'publicar' || ruta === 'terminar' ? { error: 'no-es-tuya' } : { error: 'servidor', status };
    // Al crear no se nombra ninguna radio: un 404 es que el servidor no tiene la ruta.
    case 404: return ruta === 'crear' ? { error: 'sin-servicio' } : { error: 'no-existe' };
    case 409: return ruta === 'crear' ? { error: 'demasiadas' } : ruta === 'leer' ? { error: 'llena' } : { error: 'servidor', status };
    case 410: return { error: 'terminada', razon: leerRazon(objeto(data)?.endedReason) ?? 'otro' };
    case 413: return { error: 'cuerpo' };
    case 422: return { error: 'cancion' };
    case 429: {
      const s = finito(retryAfterS) && retryAfterS > 0 ? Math.min(retryAfterS, RADIO.RETRY_AFTER_MAX_S) : RADIO.RETRY_AFTER_DEFECTO_S;
      return { error: 'frecuencia', esperaMs: Math.round(s * 1000) };
    }
    default: return { error: 'servidor', status };
  }
}

// ---- Dónde tiene que ir el oyente ----

/** La posición del anfitrión AHORA, en ms: la publicada más lo que pasó en el reloj del servidor
 *  si suena; la publicada si no. Nunca retrocede de la publicada ni pasa del final. */
export function posicionProyectada(estado, horaServidorMs, duracionMs) {
  const pasado = estado.playing && finito(horaServidorMs) ? Math.max(0, horaServidorMs - estado.publishedAtServerMs) : 0;
  const pos = Math.max(0, estado.positionMs + pasado);
  return finito(duracionMs) && duracionMs > 0 ? Math.min(pos, duracionMs) : pos;
}

// ---- Cuándo corregir ----
//
// Sincro: { ultimaRevisionMs, ultimaCorreccionMs, esperandoSonar, seguidas }.

/** El arranque (y la vuelta tras un salto del anfitrión o una reanudación). */
export const SINCRO_INICIAL = Object.freeze({ ultimaRevisionMs: null, ultimaCorreccionMs: null, esperandoSonar: false, seguidas: 0 });

/** Espera entre correcciones: 10 s, duplicada por cada corrección seguida que no asentó, hasta
 *  80 s → con 0, 1, 2, 3, 4 seguidas: 10, 10, 20, 40, 80 s. */
export function esperaEntreCorrecciones(seguidas) {
  const n = Math.max(0, Math.min(seguidas, 20));
  return Math.min(RADIO.MIN_ENTRE_CORRECCIONES_MS * 2 ** Math.max(0, n - 1), RADIO.MAX_ENTRE_CORRECCIONES_MS);
}

/**
 * ¿Hay que mover al oyente? → { seekMs (o null), motivo, desfaseMs, sincro }.
 *   objetivoMs  `posicionProyectada` del anfitrión, ahora
 *   posicionMs  dónde va el reproductor del oyente
 *   sonando     el reproductor del oyente suena de verdad (no cargando ni en pausa)
 * `desfaseMs` positivo = el oyente va ADELANTADO. Se corrige con |desfase| ≥ TOLERANCIA_MS.
 */
export function decidirCorreccion({ sincro, ahoraMs, objetivoMs, posicionMs, sonando, duracionMs }) {
  const nada = (motivo, s = sincro, desfaseMs = null) => ({ seekMs: null, motivo, desfaseMs, sincro: s });

  // Después de un seek no se mide hasta que vuelva a sonar; y cuando vuelve, se espera una
  // revisión entera antes de juzgar cómo quedó.
  if (sincro.esperandoSonar) {
    if (!sonando) return nada('esperando-seek');
    return nada('volvio-a-sonar', { ...sincro, esperandoSonar: false, ultimaRevisionMs: ahoraMs });
  }
  if (!sonando) return nada('no-suena');
  if (sincro.ultimaRevisionMs != null && ahoraMs - sincro.ultimaRevisionMs < RADIO.REVISAR_CADA_MS) return nada('pronto');

  const desfaseMs = Math.round(posicionMs - objetivoMs);
  const revisado = { ...sincro, ultimaRevisionMs: ahoraMs };

  if (Math.abs(desfaseMs) < RADIO.TOLERANCIA_MS) return nada('en-tolerancia', { ...revisado, seguidas: 0 }, desfaseMs);

  if (sincro.ultimaCorreccionMs != null && ahoraMs - sincro.ultimaCorreccionMs < esperaEntreCorrecciones(sincro.seguidas)) {
    return nada('espaciando', revisado, desfaseMs);
  }

  const dur = finito(duracionMs) && duracionMs > 0 ? duracionMs : null;
  if (dur != null && objetivoMs >= dur - RADIO.MARGEN_FIN_MS) return nada('casi-termina', revisado, desfaseMs);

  let seekMs = Math.max(0, Math.round(objetivoMs + RADIO.ADELANTO_SEEK_MS));
  if (dur != null) seekMs = Math.min(seekMs, Math.max(0, dur - RADIO.MARGEN_FIN_MS));
  return {
    seekMs,
    motivo: 'corregir',
    desfaseMs,
    sincro: { ultimaRevisionMs: ahoraMs, ultimaCorreccionMs: ahoraMs, esperandoSonar: true, seguidas: sincro.seguidas + 1 },
  };
}

// ---- Qué hace el oyente con cada lectura ----
//
// Lectura: { ok: true, radio } | { ok: false, ...fallo }.
// Seguido: { seq, trackId, playing, enPausaPorVideo, positionMs, publishedAtServerMs } (o null).
// Orden:   { tipo: 'nada' | 'esperar-anfitrion' | 'reanudar' | 'saltar' | 'pausar-por-video' }
//        | { tipo: 'arrancar', trackId, nextTrackId, sonando } | { tipo: 'pausar', positionMs }
//        | { tipo: 'salir', razon }.
// Aviso:   null | 'sin-senal' | 'sin-respuesta'.

const seguir = (e) => ({
  seq: e.seq, trackId: e.trackId, playing: e.playing, enPausaPorVideo: e.enPausaPorVideo,
  positionMs: e.positionMs, publishedAtServerMs: e.publishedAtServerMs,
});

/**
 * Una lectura nueva → { orden, aviso, seguido }. `previo` es lo último que siguió (null al entrar).
 *   · sin respuesta, 429 o un error raro: nada; lo que suena sigue sonando.
 *   · 404, 410, 401, llena, o `status: "ended"`: salir, con la razón.
 *   · "stale": NO cambia lo que suena; solo avisa "sin señal".
 *   · mismo `seq` (o uno más viejo, de una respuesta que llegó tarde): nada.
 */
export function pasoDelOyente(previo, lectura) {
  if (!lectura.ok) {
    switch (lectura.error) {
      case 'no-existe': return { orden: { tipo: 'salir', razon: 'no-existe' }, aviso: null, seguido: null };
      case 'terminada': return { orden: { tipo: 'salir', razon: lectura.razon }, aviso: null, seguido: null };
      case 'llena': return { orden: { tipo: 'salir', razon: 'llena' }, aviso: null, seguido: null };
      case 'sesion': return { orden: { tipo: 'salir', razon: 'sesion' }, aviso: null, seguido: null };
      default: return { orden: { tipo: 'nada' }, aviso: 'sin-respuesta', seguido: previo };
    }
  }
  const r = lectura.radio;
  if (r.status === 'ended') return { orden: { tipo: 'salir', razon: r.endedReason ?? 'otro' }, aviso: null, seguido: null };
  const aviso = r.status === 'stale' ? 'sin-senal' : null;
  const e = r.state;
  if (!e) return { orden: { tipo: previo ? 'nada' : 'esperar-anfitrion' }, aviso, seguido: previo };
  if (previo && e.seq <= previo.seq) return { orden: { tipo: 'nada' }, aviso, seguido: previo };

  const seguido = seguir(e);
  if (e.enPausaPorVideo) {
    return { orden: previo?.enPausaPorVideo ? { tipo: 'nada' } : { tipo: 'pausar-por-video' }, aviso, seguido };
  }
  // De acá en adelante hay canción (leerEstado no deja pasar un trackId null sin video).
  const trackId = e.trackId;
  if (!previo || previo.enPausaPorVideo || previo.trackId !== trackId) {
    return { orden: { tipo: 'arrancar', trackId, nextTrackId: e.nextTrackId, sonando: e.playing }, aviso, seguido };
  }
  if (previo.playing !== e.playing) {
    return { orden: e.playing ? { tipo: 'reanudar' } : { tipo: 'pausar', positionMs: e.positionMs }, aviso, seguido };
  }
  // Misma canción y mismo estado: un latido, o un salto del anfitrión (la posición nueva no es la
  // anterior proyectada al instante de la nueva, por más de SALTO_MS).
  const esperada = posicionProyectada(previo, e.publishedAtServerMs);
  if (Math.abs(e.positionMs - esperada) > RADIO.SALTO_MS) {
    return { orden: e.playing ? { tipo: 'saltar' } : { tipo: 'pausar', positionMs: e.positionMs }, aviso, seguido };
  }
  return { orden: { tipo: 'nada' }, aviso, seguido };
}

/** Cuánto esperar hasta el próximo sondeo del oyente: SONDEO_MS, o el Retry-After si es mayor
 *  (puente-oyente.tsx). `fallo` es el de la última lectura, o null si salió bien. */
export function esperaDelSondeo(fallo) {
  return fallo?.error === 'frecuencia' ? Math.max(RADIO.SONDEO_MS, fallo.esperaMs) : RADIO.SONDEO_MS;
}

// ---- Cuándo publica el anfitrión ----
//
// EstadoAnfitrion: { trackId (o null: nada cargado, o un video), positionMs, playing, nextTrackId,
//                    enPausaPorVideo }.
// Publicado: EstadoAnfitrion & { enMs } — lo último que se publicó BIEN, con la hora LOCAL.

/** ¿Hay algo que publicar? → 'primero' | 'video' | 'cancion' | 'pausa' | 'siguiente' | 'salto'
 *  | 'confirmar' | 'latido' | null. Sin canción y sin video no se publica nada (el servidor exige una
 *  de dos). `confirmar` (1.43.0, opcional): hay órdenes resueltas sin confirmar; sin ese argumento,
 *  exactamente lo de 1.42.0. Un cambio de estado tiene prioridad (la confirmación viaja igual). */
export function debePublicar(ultimo, actual, ahoraMs, confirmar = false) {
  if (actual.trackId == null && !actual.enPausaPorVideo) return null;
  if (!ultimo) return 'primero';
  if (ultimo.enPausaPorVideo !== actual.enPausaPorVideo) return 'video';
  const pasado = ahoraMs - ultimo.enMs;
  if (!actual.enPausaPorVideo) {
    if (ultimo.trackId !== actual.trackId) return 'cancion';
    if (ultimo.playing !== actual.playing) return 'pausa';
    if (ultimo.nextTrackId !== actual.nextTrackId) return 'siguiente';
    const esperada = ultimo.positionMs + (ultimo.playing ? Math.max(0, pasado) : 0);
    if (Math.abs(actual.positionMs - esperada) > RADIO.SALTO_MS && pasado >= RADIO.MIN_ENTRE_SALTOS_MS) return 'salto';
  }
  if (confirmar === true) return 'confirmar';
  return pasado >= RADIO.LATIDO_MS ? 'latido' : null;
}

/** El cuerpo de PUT /state. Sin relojes: la hora la pone el servidor. Mide ~100 bytes (tope 512). */
export function cuerpoDePublicacion(actual) {
  if (actual.enPausaPorVideo) return { enPausaPorVideo: true };
  return {
    trackId: actual.trackId,
    positionMs: Math.max(0, Math.round(finito(actual.positionMs) ? actual.positionMs : 0)),
    playing: actual.playing === true,
    ...(esId(actual.nextTrackId) ? { nextTrackId: actual.nextTrackId } : {}),
  };
}

// ---- Qué tiene el anfitrión en su reproductor (vista.ts) ----
//
// UNA DIFERENCIA CON iOS, a propósito: allá un video se marca `tipo: "video"` y el puente pasa
// además el `motor` activo; acá el reproductor marca el video con `kind: 'video'`
// (PlayerContext) y no expone el motor. Por eso se mira `kind`, y `motor` queda como parámetro
// opcional (si viene 'video', manda igual que en iOS).

/** ¿Es un video? (`kind: 'video'` de PlayerContext). */
const esVideoWeb = (item) => objeto(item)?.kind === 'video';

/** El id de una CANCIÓN (entero seguro ≥ 1), o null: un video, nada, o un id raro. Acepta el id
 *  como número o como texto de solo dígitos, igual que `idDeCancion` de iOS. */
export function idDeCancion(item) {
  const o = objeto(item);
  if (!o || esVideoWeb(o)) return null;
  let n;
  if (typeof o.id === 'number') n = o.id;
  else if (typeof o.id === 'string' && /^[0-9]+$/.test(o.id)) n = Number(o.id);
  else return null;
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/** Lo que el anfitrión tiene en su reproductor, listo para `debePublicar`.
 *  p: { current, queue, queueIndex, playing, posicionSeg, motor? ('audio' | 'video') }.
 *  Con un VIDEO no hay canción que seguir: `enPausaPorVideo`. La siguiente es la que está
 *  después en la cola, si es una canción (con aleatorio puede no ser la que de verdad suena
 *  después: solo sirve para precargar, como en iOS). */
export function estadoDelAnfitrion(p) {
  if (p.motor === 'video' || esVideoWeb(p.current)) {
    return { trackId: null, positionMs: 0, playing: false, nextTrackId: null, enPausaPorVideo: true };
  }
  const trackId = idDeCancion(p.current);
  const pos = finito(p.posicionSeg) ? Math.max(0, Math.round(p.posicionSeg * 1000)) : 0;
  const cola = Array.isArray(p.queue) ? p.queue : [];
  const sig = trackId != null && p.queueIndex >= 0 ? idDeCancion(cola[p.queueIndex + 1]) : null;
  return {
    trackId,
    positionMs: trackId == null ? 0 : pos,
    playing: trackId != null && p.playing === true,
    nextTrackId: sig,
    enPausaPorVideo: false,
  };
}

// ---- La puerta de publicación (puente-anfitrion.tsx, como funciones puras) ----
//
// Puerta: { enVuelo, noAntesDe, rechazada }. Nunca dos publicaciones en vuelo; después de un 429
// no se intenta antes del Retry-After; después de un intento que no llegó, REINTENTO_MS; una
// canción que el servidor no conoce (422) no se insiste hasta que cambie.

export const PUERTA_INICIAL = Object.freeze({ enVuelo: false, noAntesDe: 0, rechazada: null });

/** ¿Se puede intentar publicar `actual` ahora? (Si hay algo que publicar lo dice `debePublicar`.) */
export function puertaAbierta(puerta, actual, ahoraMs) {
  if (puerta.enVuelo) return false;
  if (ahoraMs < puerta.noAntesDe) return false;
  if (actual.trackId != null && actual.trackId === puerta.rechazada) return false;
  return true;
}

/** Sale la publicación: la puerta queda cerrada hasta la respuesta. */
export function alPublicar(puerta) {
  return { ...puerta, enVuelo: true };
}

/**
 * Volvió la respuesta. `resultado` = { ok: true } o { ok: false, ...fallo }; `actual` es lo que se
 * intentó publicar; `ahoraMs`, la hora local AL VOLVER.
 *   → { puerta, publicado (o null si no salió bien), expulsar (razón, o null) }.
 * `publicado.enMs` es la hora local en que SALIÓ (`salidaMs`), como en iOS.
 */
export function alResponder(puerta, resultado, actual, salidaMs, ahoraMs) {
  const p = { ...puerta, enVuelo: false };
  if (resultado.ok) return { puerta: { ...p, rechazada: null }, publicado: { ...actual, enMs: salidaMs }, expulsar: null };
  switch (resultado.error) {
    case 'no-existe': return { puerta: p, publicado: null, expulsar: 'no-existe' };
    case 'terminada': return { puerta: p, publicado: null, expulsar: resultado.razon };
    case 'no-es-tuya': return { puerta: p, publicado: null, expulsar: 'no-es-tuya' };
    case 'sesion': return { puerta: p, publicado: null, expulsar: 'sesion' };
    case 'cancion': return { puerta: { ...p, rechazada: actual.trackId }, publicado: null, expulsar: null };
    case 'frecuencia': return { puerta: { ...p, noAntesDe: ahoraMs + resultado.esperaMs }, publicado: null, expulsar: null };
    default: return { puerta: { ...p, noAntesDe: ahoraMs + RADIO.REINTENTO_MS }, publicado: null, expulsar: null };
  }
}

// ---- Por qué terminó la radio (vista.ts) ----
//
// rol: 'anfitrion' | 'oyente'. razon: las del servidor ('anfitrion', 'admin', 'reemplazada',
// 'sin-anfitrion', 'pausa'; 'otro' si no la conoce, ver leerRazon) o las locales ('no-existe',
// 'llena', 'sesion', 'no-es-tuya'). Los textos son los de iOS, con UNA divergencia a propósito:
// 'reemplazada' para el anfitrión dice "desde otra pestaña o dispositivo" (iOS: "desde otro
// dispositivo"), porque en la web el reemplazo suele venir de otra pestaña del mismo equipo.

/** Por qué se acabó la radio, para quien estaba adentro. */
export function textoDeFin(rol, razon) {
  const mia = rol === 'anfitrion';
  switch (razon) {
    case 'anfitrion': return mia ? 'Terminaste la radio.' : 'El anfitrión terminó la radio.';
    case 'admin': return 'Un administrador terminó la radio.';
    case 'reemplazada': return mia ? 'Empezaste otra radio desde otra pestaña o dispositivo.' : 'El anfitrión empezó otra radio.';
    case 'sin-anfitrion':
      return mia ? 'La radio se cerró porque dejó de recibir lo que escuchas.'
        : 'La radio se cerró porque el anfitrión dejó de transmitir.';
    case 'pausa': return 'La radio se cerró por estar mucho tiempo en pausa.';
    case 'no-existe': return 'La radio ya no existe.';
    case 'llena': return 'La radio está llena.';
    case 'sesion': return 'Tu sesión expiró. Cierra sesión y vuelve a entrar.';
    case 'no-es-tuya': return 'Esta radio ya no es tuya.';
    default: return 'La radio terminó.';
  }
}

// ---- Qué decirle a la persona (vista.ts) ----
//
// accion: 'iniciar' | 'unirse' | 'terminar' (y desde 1.43.0 'moderar' | 'ordenar'). `fallo` es un
// valor de falloDeStatus o el { error: 'sin-respuesta' } de client.js. Los textos son los de iOS, palabra por palabra. Una
// sola diferencia, de forma y no de texto: si no llega un fallo (null), no se rompe y cae al
// mensaje genérico de la acción (en iOS el tipo no lo permite).

const SIN_CONEXION = 'No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.';

/** Un error de la radio → qué decirle a la persona. */
export function textoDeFallo(accion, fallo) {
  switch (fallo?.error) {
    case 'sin-respuesta': return SIN_CONEXION;
    case 'sesion': return 'Tu sesión expiró. Cierra sesión y vuelve a entrar.';
    case 'no-existe':
      return accion === 'unirse'
        ? 'No hay ninguna radio con ese código. Revísalo e intenta de nuevo.'
        : 'Esa radio ya no existe.';
    case 'terminada': return 'Esa radio ya terminó.';
    case 'llena': return 'Esa radio está llena. Intenta más tarde.';
    case 'demasiadas': return 'Hay demasiadas radios en vivo ahora. Intenta más tarde.';
    case 'frecuencia': return 'Demasiados intentos. Espera unos segundos e intenta de nuevo.';
    case 'no-es-tuya': return 'Esa radio no es tuya.';
    case 'sin-servicio': return 'El servidor todavía no tiene la radio. Intenta más tarde.';
    // 1.43.0: moderar (el anfitrión nombra o quita) y ordenar (quien modera).
    case 'sin-permiso':
      return accion === 'moderar' ? 'Solo quien creó la radio puede elegir quién modera.' : 'Ya no puedes moderar esta radio.';
    case 'es-el-anfitrion': return 'La radio ya es tuya: no hace falta que la moderes.';
    case 'no-escucha':
      return accion === 'moderar' ? 'Esa persona ya no está escuchando.' : 'Tienes que estar escuchando la radio para moderar.';
    case 'sin-soporte':
      return accion === 'moderar' ? 'Su versión todavía no lo admite.' : 'La app del anfitrión todavía no acepta órdenes.';
    case 'moderadores-llenos': return `Ya hay ${MODERACION.MODERADORES_MAX} personas moderando. Quita a alguien primero.`;
    case 'ordenes-llenas': return 'Hay muchas órdenes pendientes. Espera un momento.';
    case 'obsoleta': return 'La canción ya cambió.';
    case 'sin-siguiente': return 'No hay una canción siguiente.';
    case 'video': return 'Los videos no se pueden poner en la radio.';
    case 'sin-pista': return 'Esa canción ya no está en la biblioteca.';
    default:
      // Un 5xx (o el 530 del túnel caído) es el servidor que no atiende: lo mismo que no haber
      // tenido respuesta, y "intenta de nuevo" a secas no diría qué revisar.
      if (fallo?.error === 'servidor' && fallo.status >= 500) return SIN_CONEXION;
      return accion === 'iniciar' ? 'No se pudo iniciar la radio. Intenta de nuevo.'
        : accion === 'unirse' ? 'No se pudo entrar a la radio. Intenta de nuevo.'
        : accion === 'moderar' ? 'No se pudo cambiar quién modera. Intenta de nuevo.'
        : accion === 'ordenar' ? 'No se pudo mandar la orden. Intenta de nuevo.'
        : 'No se pudo terminar la radio. Intenta de nuevo.';
  }
}

/** "3 oyentes", "1 oyente", "Nadie escuchando todavía" (igual que iOS). */
export function cuentaDeOyentes(n) {
  if (!(n > 0)) return 'Nadie escuchando todavía';
  return n === 1 ? '1 oyente' : `${n} oyentes`;
}

// ---- El oyente: con qué cola arranca, qué se le devuelve al salir y cuándo pausó él (vista.ts) ----
//
// Port de sonorarev-ios lib/radio/vista.ts (18d7790): colaDelOyente, fotoDeLaCola,
// planDeRestauracion, pausaDelOyente, GRACIA_ORDEN_MS y CERCA_DEL_FINAL_MS, con los mismos números.
// DIFERENCIAS CON iOS, a propósito:
//   · La cola. Allá `colaDelOyente` recibe `porId`, que busca la canción en la biblioteca que el
//     teléfono ya tiene en memoria (síncrono; null = "no está" → `falta-cancion`). La web no tiene
//     la biblioteca en memoria: `colaDelOyente` queda igual (con `porId` síncrono, para probarla
//     con los vectores de iOS) y se suma `resolverColaDelOyente`, que trae las dos pistas con un
//     `traer(id)` asíncrono (en la app, api.track) y distingue "no está" (404, o vino otra pista)
//     de "no se pudo" (red, timeout, 5xx). Ninguno de los dos saca al oyente: se reintenta en el
//     siguiente sondeo y se avisa "No se pudo cargar la canción" (decisión de Oscar).
//   · Las marcas. El motor de la web le pone a cada entrada sólo `_qid` (PlayerContext); el de
//     iOS, también `_local`. `limpia` quita las dos, como allá.
//   · Video. Acá es `kind: 'video'` (esVideoWeb), no `tipo: "video"`. La regla de la restauración
//     es la de iOS: si lo de la foto era un video, sólo se pausa (allá no se puede pausar un video
//     desde afuera; acá sí, pero arrancarlo para pausarlo sonaría un instante).
//   · DESAJUSTE_MS no está en vista.ts: es una constante suelta de
//     components/radio/puente-oyente.tsx (2a3bc86). Acá vive junto a las otras del oyente.

/** Cuánto se espera después de una orden propia (arrancar, pausar, un seek) antes de leer un
 *  silencio como del oyente. SUPOSICIÓN, no medición (igual que iOS). */
export const GRACIA_ORDEN_MS = 3000;
/** A menos que esto del final, una canción parada es una canción que TERMINÓ. */
export const CERCA_DEL_FINAL_MS = 2500;
/** Si lo que suena no es lo de la radio por más que esto, se vuelve a poner lo de la radio. Cubre
 *  también la pista local que termina antes de que el anfitrión publique la siguiente. */
export const DESAJUSTE_MS = 6000;

/** Sin las marcas que el motor le pone a cada entrada de la cola. */
function limpia(item) {
  if (item == null || typeof item !== 'object') return item;
  const { _qid, _local, ...resto } = item;
  return resto;
}

/** La cola con la que el oyente arranca una canción de la radio: ella y, de pista, la que sigue
 *  (así el paso a la siguiente no espera al próximo sondeo). `null` si la canción no está: no se
 *  inventa nada. Una siguiente que falta simplemente no va.
 *  porId(id) → la pista (un objeto de /api/tracks/:id), o null/undefined. */
export function colaDelOyente(porId, trackId, nextTrackId) {
  const t = porId(trackId);
  if (t == null || idDeCancion(t) !== trackId) return null;
  const cola = [limpia(t)];
  if (nextTrackId != null && nextTrackId !== trackId) {
    const n = porId(nextTrackId);
    if (n != null && idDeCancion(n) === nextTrackId) cola.push(limpia(n));
  }
  return cola;
}

/** Lo mismo, trayendo las pistas (SOLO WEB). `traer(id)` devuelve una promesa con la pista (en la
 *  app, api.track): las dos se piden A LA VEZ, así hay una sola espera entre la lectura de la
 *  sala y el play(). Devuelve { cola, motivo }:
 *    · { cola: [pista, siguiente?], motivo: null }
 *    · { cola: null, motivo: 'no-esta' }  el servidor no la tiene (404) o mandó otra pista
 *    · { cola: null, motivo: 'fallo' }    no se pudo (red, timeout, 5xx, 401)
 *  Si sólo falla la siguiente, la cola va sin ella (como en iOS). Nunca rechaza. */
export async function resolverColaDelOyente(traer, trackId, nextTrackId) {
  const conSiguiente = nextTrackId != null && nextTrackId !== trackId;
  const pedir = (id) => Promise.resolve().then(() => traer(id));
  const [a, b] = await Promise.allSettled([pedir(trackId), conSiguiente ? pedir(nextTrackId) : null]);
  if (a.status === 'rejected') return { cola: null, motivo: a.reason?.status === 404 ? 'no-esta' : 'fallo' };
  const porId = (id) => (id === trackId ? a.value : b.status === 'fulfilled' ? b.value : null);
  const cola = colaDelOyente(porId, trackId, conSiguiente ? nextTrackId : null);
  return cola ? { cola, motivo: null } : { cola: null, motivo: 'no-esta' };
}

/** La foto de la cola al entrar a una radio, o null si no había nada cargado.
 *  p: { queue, queueIndex, posicionSeg } — en la app, queue/queueIndex/currentTime de PlayerContext. */
export function fotoDeLaCola(p) {
  if (!Array.isArray(p.queue) || p.queue.length === 0) return null;
  if (!Number.isInteger(p.queueIndex) || p.queueIndex < 0 || p.queueIndex >= p.queue.length) return null;
  return {
    lista: p.queue.map(limpia),
    indice: p.queueIndex,
    posicionSeg: Number.isFinite(p.posicionSeg) && p.posicionSeg > 0 ? p.posicionSeg : 0,
  };
}

/** Qué se hace al salir de la radio, con la foto de la entrada. Es APROXIMADA, con funciones
 *  públicas del motor:
 *    · { tipo: 'pausar' }  no había nada, o lo que sonaba era un video: sólo se pausa lo de la radio;
 *    · { tipo: 'cola', lista, indice, posicionSeg }  volver a poner la lista en esa canción, en
 *      pausa, y llevarla a donde iba. Con aleatorio, el motor vuelve a barajar lo que va detrás. */
export function planDeRestauracion(foto) {
  if (!foto) return { tipo: 'pausar' };
  const actual = foto.lista[foto.indice];
  if (actual == null || esVideoWeb(actual) || idDeCancion(actual) == null) return { tipo: 'pausar' };
  return { tipo: 'cola', lista: foto.lista, indice: foto.indice, posicionSeg: foto.posicionSeg };
}

/** ¿El oyente pausó por su cuenta? ("en pausa para ti"). La radio quiere sonar, el reproductor
 *  está en pausa de verdad (`pausado`: no es una carga) y no fue por una orden nuestra reciente ni
 *  porque la canción terminó.
 *  p: { quiereSonar, pausado, sonando, posicionMs, duracionMs (o null), msDesdeOrden }.
 *  En la web `pausado` = !isPlaying y `sonando` = isPlaying con el tiempo avanzando (PlayerContext
 *  no expone la espera de carga del <audio>): lo arma el puente. */
export function pausaDelOyente(p) {
  if (!p.quiereSonar || !p.pausado || p.sonando) return false;
  if (p.msDesdeOrden < GRACIA_ORDEN_MS) return false;
  if (p.duracionMs != null && p.posicionMs >= p.duracionMs - CERCA_DEL_FINAL_MS) return false;
  return true;
}
