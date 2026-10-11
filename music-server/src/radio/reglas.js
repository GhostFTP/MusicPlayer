// LAS REGLAS DEL MODO RADIO (1.29.0): las constantes de vida y de seguridad, el código corto
// y la lectura del cuerpo que publica el anfitrión. PURO: sin base, sin Express y sin reloj
// propio (la hora entra siempre por parámetro). Lo prueba `npm run test:radio`.
//
// Una radio es lo que escucha UNA persona (el anfitrión), publicado para que los demás lo
// sigan a la par. El estado vive EN MEMORIA (radio/almacen.js): un reinicio o un redeploy
// borra todas las radios, a propósito. No hay tabla.

// ---- Vida ----
//
// Todas las constantes de tiempo están ACÁ y en ningún otro lado. Cada una se puede acortar
// con una variable de entorno, que existe para el smoke (no para producción: el compose no
// las nombra, así que al contenedor no le llegan).
function ms(nombre, defecto) {
  const v = Number(process.env[nombre]);
  return Number.isInteger(v) && v > 0 ? v : defecto;
}

export const REGLAS = Object.freeze({
  /** Sin publicación del anfitrión este tiempo, la radio se ve "stale" (sin señal). */
  STALE_MS: ms('RADIO_STALE_MS', 30_000),
  /** Sin publicación del anfitrión este tiempo, la radio se cierra. */
  CIERRE_SIN_ANFITRION_MS: ms('RADIO_CIERRE_MS', 5 * 60_000),
  /** En pausa (playing=false) este tiempo seguido, la radio se cierra, aunque el anfitrión
   *  siga mandando latidos. */
  CIERRE_EN_PAUSA_MS: ms('RADIO_PAUSA_MS', 30 * 60_000),
  /** Lo mismo cuando la pausa es porque el anfitrión está viendo un video: un concierto dura
   *  más que media hora. */
  CIERRE_EN_VIDEO_MS: ms('RADIO_VIDEO_MS', 3 * 60 * 60_000),
  /** Cuánto se sigue contestando "ended" después de cerrarse, antes de borrarla (404). */
  ENDED_VISIBLE_MS: ms('RADIO_ENDED_MS', 2 * 60_000),
  /** Cuánto dura alguien en la lista de oyentes después de su último GET (la app pregunta
   *  cada ~2 s). */
  OYENTE_MS: ms('RADIO_OYENTE_MS', 10_000),

  // ---- Seguridad (pensado para ~12 personas) ----
  /** Radios abiertas a la vez en todo el servidor. */
  MAX_RADIOS: 6,
  /** Oyentes a la vez en una radio. */
  MAX_OYENTES: 20,
  /** Publicaciones del anfitrión por ventana. Un latido cada ~10 s más los cambios de
   *  canción, pausas y saltos no llegan ni cerca. */
  MAX_PUBLICACIONES: 20,
  VENTANA_PUBLICACIONES_MS: ms('RADIO_VENTANA_MS', 10_000),
  /** Radios que una misma cuenta puede crear por minuto. */
  MAX_CREACIONES: 6,
  VENTANA_CREACIONES_MS: 60_000,
  /** El cuerpo de una petición a /api/radio. El más grande posible mide ~120 bytes. */
  CUERPO_MAX_BYTES: 512,
  /** Tope de posición para una pista sin duración en la base (24 h). */
  POSICION_MAX_MS: 24 * 60 * 60_000,
});

// ---- El código ----

/** Sin 0/O, 1/I/L: los que se confunden al dictarlo o leerlo. 31 símbolos. */
export const ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const LARGO_CODIGO = 6;
const FORMA = new RegExp(`^[${ALFABETO}]{${LARGO_CODIGO}}$`);

/** Un código nuevo. `azar(n)` devuelve un entero en [0, n). */
export function nuevoCodigo(azar) {
  let c = '';
  for (let i = 0; i < LARGO_CODIGO; i++) c += ALFABETO[azar(ALFABETO.length)];
  return c;
}

/** El código como se guarda (mayúsculas, sin espacios), o null si no tiene forma de código.
 *  Quien lo escribe a mano puede ponerlo en minúsculas. */
export function leerCodigo(v) {
  if (typeof v !== 'string') return null;
  const c = v.trim().toUpperCase();
  return FORMA.test(c) ? c : null;
}

// ---- Lo que publica el anfitrión ----

const esId = (v) => Number.isSafeInteger(v) && v > 0;

/**
 * Lee el cuerpo de PUT /state como dato de AFUERA. No mira la base: eso (¿existe la pista?,
 * ¿cuánto dura?) lo hace `acotar`, con lo que la ruta haya leído.
 *
 * Devuelve `{ ok: true, pedido }` o `{ ok: false, error }` (un texto para un 400).
 * El reloj del cliente NO se lee nunca: si el cuerpo trae uno, se ignora.
 */
export function leerPublicacion(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Falta el estado.' };

  const enPausaPorVideo = body.enPausaPorVideo;
  if (enPausaPorVideo !== undefined && typeof enPausaPorVideo !== 'boolean') {
    return { ok: false, error: 'enPausaPorVideo tiene que ser true o false.' };
  }
  const video = enPausaPorVideo === true;

  // Con un video en pantalla puede no haber canción (la cola empezó por un video).
  let trackId = body.trackId ?? null;
  if (trackId === null) {
    if (!video) return { ok: false, error: 'Falta trackId.' };
  } else if (!esId(trackId)) {
    return { ok: false, error: 'trackId tiene que ser un entero.' };
  }

  let positionMs = body.positionMs;
  if (positionMs === undefined || positionMs === null) {
    if (!video) return { ok: false, error: 'Falta positionMs.' };
    positionMs = 0;
  } else if (typeof positionMs !== 'number' || !Number.isFinite(positionMs)) {
    return { ok: false, error: 'positionMs tiene que ser un número.' };
  }

  let playing = body.playing;
  if (playing === undefined && video) playing = false;
  if (typeof playing !== 'boolean') return { ok: false, error: 'playing tiene que ser true o false.' };
  // Viendo un video, la música no suena: lo dice el servidor, no el cliente.
  if (video) playing = false;

  const nextTrackId = body.nextTrackId ?? null;
  if (nextTrackId !== null && !esId(nextTrackId)) {
    return { ok: false, error: 'nextTrackId tiene que ser un entero.' };
  }

  return { ok: true, pedido: { trackId, positionMs, playing, nextTrackId, enPausaPorVideo: video } };
}

/**
 * La posición dentro de la pista: entre 0 y su duración. `duracionS` es la columna
 * `duration` de la base (segundos, puede faltar); sin ella, entre 0 y POSICION_MAX_MS.
 */
export function acotarPosicion(positionMs, duracionS, reglas = REGLAS) {
  const tope = typeof duracionS === 'number' && Number.isFinite(duracionS) && duracionS > 0
    ? Math.round(duracionS * 1000)
    : reglas.POSICION_MAX_MS;
  return Math.min(Math.max(0, Math.round(positionMs)), tope);
}

// ---- En qué está una radio ----

/**
 * "live", "stale" o, si le tocó cerrarse, `{ cerrar: motivo }`. No mira si ya terminó: eso
 * lo sabe el almacén.
 *
 *   radio.ultimaDelAnfitrion  la última publicación (o la creación, si no publicó nunca)
 *   radio.enPausaDesde        desde cuándo está en pausa sin interrupción, o null
 *   radio.estado              el último estado publicado, o null
 */
export function vidaDe(radio, ahora, reglas = REGLAS) {
  const callado = ahora - radio.ultimaDelAnfitrion;
  if (callado >= reglas.CIERRE_SIN_ANFITRION_MS) return { cerrar: 'sin-anfitrion' };
  if (radio.enPausaDesde != null) {
    const tope = radio.estado?.enPausaPorVideo ? reglas.CIERRE_EN_VIDEO_MS : reglas.CIERRE_EN_PAUSA_MS;
    if (ahora - radio.enPausaDesde >= tope) return { cerrar: 'pausa' };
  }
  return callado >= reglas.STALE_MS ? 'stale' : 'live';
}

/** Ventana fija: `{ n, hasta }` → ¿entra una más? Devuelve la cubeta nueva y si pasó. */
export function contar(cubeta, ahora, max, ventanaMs) {
  const c = !cubeta || cubeta.hasta <= ahora ? { n: 0, hasta: ahora + ventanaMs } : cubeta;
  const n = c.n + 1;
  return { cubeta: { n, hasta: c.hasta }, pasa: n <= max, esperaMs: c.hasta - ahora };
}

/** El nombre que ven los demás. Una cuenta puede llamarse como su correo (las que entran por
 *  Cloudflare o por Google nacen así): de esas se muestra solo lo de antes de la arroba. */
export function nombrePublico(username) {
  if (typeof username !== 'string') return '';
  const u = username.trim();
  const arroba = u.indexOf('@');
  return arroba > 0 ? u.slice(0, arroba) : u;
}
