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
//   · sonorarev-ios components/radio/puente-oyente.tsx (2a3bc86) — la espera entre sondeos.
//   · sonorarev-ios lib/radio/vista.ts (18d7790) — qué publica el anfitrión según su reproductor
//     (estadoDelAnfitrion) y el texto de por qué terminó la radio (textoDeFin).
// Si se cambia una regla acá, hay que cambiarla allá (o decidir a propósito que divergen).
//
// El backend es music-server/src/api/radio.js (1.29.0): POST /api/radio,
// PUT /api/radio/:code/state, GET /api/radio/:code y DELETE /api/radio/:code. El estado vive en
// la memoria del servidor: un redeploy cierra las radios.

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
  return {
    serverNow: r.serverNow,
    code,
    status: r.status,
    endedReason: r.status === 'ended' ? leerRazon(r.endedReason) ?? 'otro' : null,
    state,
    host: leerPersona(r.host),
    listeners,
  };
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
  return state ? { serverNow: r.serverNow, state } : null;
}

/** La respuesta de DELETE /api/radio/:code. */
export function leerTerminada(json) {
  const r = objeto(json);
  if (!r || !finito(r.serverNow) || r.serverNow <= 0 || r.status !== 'ended') return null;
  return { serverNow: r.serverNow, endedReason: leerRazon(r.endedReason) ?? 'otro' };
}

// ---- Los errores, como valores ----
//
// { error: 'sin-respuesta' | 'sesion' | 'invalido' | 'no-es-tuya' | 'no-existe' | 'sin-servicio'
//          | 'demasiadas' | 'llena' | 'cuerpo' | 'cancion' }
// | { error: 'terminada', razon } | { error: 'frecuencia', esperaMs } | { error: 'servidor', status }
//
// ruta: 'crear' | 'publicar' | 'leer' | 'terminar'.

/** Un status que no es el de éxito → su fallo. `retryAfterS` es la cabecera Retry-After (s). */
export function falloDeStatus(ruta, status, data, retryAfterS) {
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
 *  | 'latido' | null. Sin canción y sin video no se publica nada (el servidor exige una de dos). */
export function debePublicar(ultimo, actual, ahoraMs) {
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
