// Estado del servidor en Ajustes (sub-paso 3): FUNCIONES PURAS, sin imports, para que la vista y
// la suite (.claude/tools/snap/perf/servidor-unit.mjs, con Node directo) usen exactamente lo mismo.
//
// Contrato del servidor (music-server/src/api/servidor.js y admin-servidor.js, sub-paso 1):
//   GET /api/servidor        → { estado, version, uptime_s, admin }
//   GET /api/admin/servidor  → { version, version_paquete, node, uptime_s, memoria, event_loop,
//                                muestras, base, videos, locutor, sqlite_busy, errores_500 }
// Los dos VALIDADORES devuelven un objeto NUEVO con sólo las claves conocidas, o null si algo no
// cuadra. null = "Sin respuesta" en la vista: Cloudflare Access puede contestar 200 con su página
// de login (api/client.js, comentario de radioPedir), y un JSON con otra forma tampoco se pinta.
//
// Nada de esto lee localStorage, el token ni el DOM, salvo idDelBuild, que recibe el documento.

// ── Validadores ──

const esObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const esNumNoNeg = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const esEnteroNoNeg = (x) => Number.isInteger(x) && x >= 0;
const esBool = (x) => typeof x === 'boolean';
// La versión sale de «## [1.43.0]» del CHANGELOG (estado/version.js): o eso, o null si el servidor
// no encontró el archivo. null se acepta: un servidor sano sin CHANGELOG no es "sin respuesta".
const esVersion = (x) => x === null || (typeof x === 'string' && /^\d+\.\d+\.\d+$/.test(x));

export const ESTADOS = ['ok', 'lento', 'mal', 'sin_datos'];

/** GET /api/servidor → { estado, version, uptime_s, admin } o null. */
export function validarServidor(x) {
  if (!esObj(x)) return null;
  if (!ESTADOS.includes(x.estado)) return null;
  if (!esVersion(x.version)) return null;
  if (!esNumNoNeg(x.uptime_s)) return null;
  if (!esBool(x.admin)) return null;
  return { estado: x.estado, version: x.version, uptime_s: x.uptime_s, admin: x.admin };
}

function validarMuestra(m) {
  if (!esObj(m)) return null;
  if (!(typeof m.t === 'number' && Number.isFinite(m.t))) return null;
  if (!esNumNoNeg(m.p99) || !esNumNoNeg(m.max) || !esNumNoNeg(m.rss)) return null;
  return { t: m.t, p99: m.p99, max: m.max, rss: m.rss };
}

function validarEventLoop(e) {
  if (e === null) return { ok: true, valor: null };   // antes de la primera ventana de 10 s
  if (!esObj(e) || !esNumNoNeg(e.p50) || !esNumNoNeg(e.p99) || !esNumNoNeg(e.max)) return { ok: false };
  return { ok: true, valor: { p50: e.p50, p99: e.p99, max: e.max } };
}

const FECHA_SQLITE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

function validarBase(b) {
  if (!esObj(b)) return null;
  // bytes y wal_bytes pueden ser null: base en memoria o sin ruta (estado/base.js).
  const tamOk = (v) => v === null || esEnteroNoNeg(v);
  if (!tamOk(b.bytes) || !tamOk(b.wal_bytes)) return null;
  if (!esEnteroNoNeg(b.pistas)) return null;
  if (!(b.ultimo_escaneo === null || (typeof b.ultimo_escaneo === 'string' && FECHA_SQLITE.test(b.ultimo_escaneo)))) return null;
  return { bytes: b.bytes, wal_bytes: b.wal_bytes, pistas: b.pistas, ultimo_escaneo: b.ultimo_escaneo };
}

const CIRCUITOS = ['cerrado', 'abierto', 'semi'];
// Los motivos de rechazo son claves cortas del locutor (locutor/servicio.js: 'extraccion', …).
// El patrón y el largo las acotan: un JWT (con puntos, >100 caracteres) no cabe ni como clave.
const CLAVE_RECHAZO = /^[a-z_]{1,32}$/i;

function validarLocutor(l) {
  if (l === null) return { ok: true, valor: null };   // apagado
  if (!esObj(l) || !esObj(l.cliente) || !esObj(l.servicio)) return { ok: false };
  const c = l.cliente, s = l.servicio;
  if (!esBool(c.encendido) || !CIRCUITOS.includes(c.circuito) || !esEnteroNoNeg(c.fallosSeguidos)) return { ok: false };
  for (const k of ['cache', 'cola', 'generadas', 'descartadas', 'sinCupo', 'errores']) if (!esEnteroNoNeg(s[k])) return { ok: false };
  if (!esBool(s.trabajando) || !esObj(s.rechazos)) return { ok: false };
  const rechazos = {};
  for (const [k, v] of Object.entries(s.rechazos)) {
    if (!CLAVE_RECHAZO.test(k) || !esEnteroNoNeg(v)) return { ok: false };
    rechazos[k] = v;
  }
  return {
    ok: true,
    valor: {
      cliente: { encendido: c.encendido, circuito: c.circuito, fallosSeguidos: c.fallosSeguidos },
      servicio: {
        cache: s.cache, cola: s.cola, trabajando: s.trabajando, generadas: s.generadas,
        descartadas: s.descartadas, sinCupo: s.sinCupo, errores: s.errores, rechazos,
      },
    },
  };
}

/** GET /api/admin/servidor → el objeto normalizado o null. Una sola muestra mala invalida todo. */
export function validarAdminServidor(x) {
  if (!esObj(x)) return null;
  if (!esVersion(x.version) || !esVersion(x.version_paquete)) return null;
  if (!(typeof x.node === 'string' && /^v\d+\.\d+\.\d+$/.test(x.node))) return null;
  if (!esNumNoNeg(x.uptime_s)) return null;
  if (!esObj(x.memoria) || !esEnteroNoNeg(x.memoria.rss) || !esEnteroNoNeg(x.memoria.heap)) return null;
  const el = validarEventLoop(x.event_loop);
  if (!el.ok) return null;
  if (!Array.isArray(x.muestras)) return null;
  const muestras = [];
  for (const m of x.muestras) {
    const v = validarMuestra(m);
    if (!v) return null;
    muestras.push(v);
  }
  const base = validarBase(x.base);
  if (!base) return null;
  if (x.videos !== 'ok' && x.videos !== 'unavailable') return null;
  const loc = validarLocutor(x.locutor);
  if (!loc.ok) return null;
  if (!esEnteroNoNeg(x.sqlite_busy) || !esEnteroNoNeg(x.errores_500)) return null;
  return {
    version: x.version, version_paquete: x.version_paquete, node: x.node, uptime_s: x.uptime_s,
    memoria: { rss: x.memoria.rss, heap: x.memoria.heap },
    event_loop: el.valor, muestras, base, videos: x.videos, locutor: loc.valor,
    sqlite_busy: x.sqlite_busy, errores_500: x.errores_500,
  };
}

/**
 * Qué decir cuando el pedido NO trajo una respuesta válida. `error` es lo que lanzó api/client.js
 * (o null si llegó un JSON pero el validador lo rechazó):
 *   · 401 → 'sesion': la vista deja de sondear (client.js ya pidió reautenticar).
 *   · SyntaxError (res.json() sobre HTML, típicamente el login de Access) o JSON con otra forma
 *     → 'respuesta_invalida': «Sin respuesta» + «Si sigue, recarga la página».
 *   · cualquier otra cosa (red caída, timeout, 5xx) → 'sin_respuesta'.
 */
export function claveDeFallo(error) {
  if (error == null) return 'respuesta_invalida';
  if (error.status === 401) return 'sesion';
  if (error instanceof SyntaxError || error.name === 'SyntaxError') return 'respuesta_invalida';
  return 'sin_respuesta';
}

// ── Textos ──

// Icono y texto mandan; el tono es un apoyo. Sin rojo ni verde: son colores de los tiers de calidad
// (ui-polish). 'normal' = color de texto de siempre.
const ETIQUETAS = {
  ok:                 { texto: 'Funciona con normalidad',            icono: 'check',     tono: 'normal' },
  lento:              { texto: 'Va lento',                           icono: 'reloj',     tono: 'ambar' },
  mal:                { texto: 'Con problemas',                      icono: 'triangulo', tono: 'ambar-fuerte' },
  sin_datos:          { texto: 'Recién encendido, todavía midiendo', icono: 'puntos',    tono: 'gris' },
  sin_respuesta:      { texto: 'Sin respuesta',                      icono: 'sin-senal', tono: 'gris' },
  respuesta_invalida: { texto: 'Sin respuesta',                      icono: 'sin-senal', tono: 'gris', ayuda: 'Si sigue, recarga la página' },
};

/** { texto, icono, tono, ayuda? } para un estado del servidor o una clave de claveDeFallo; null si no existe. */
export function etiquetaEstado(clave) {
  // hasOwnProperty y no Object.hasOwn: el build no fija target y Vite apunta a Chrome 87, que no
  // lo trae (CLAUDE.md, «build.target sin fijar»). Sin esto, 'toString' encontraría el prototipo.
  const e = Object.prototype.hasOwnProperty.call(ETIQUETAS, clave) ? ETIQUETAS[clave] : null;
  return e ? { ...e } : null;
}

export const PIE = 'Mide solo el servidor, no tu conexión';
export const TEXTO_VIDEOS = { ok: 'Índice listo', unavailable: 'Sin consultar o no disponible' };

/** uptime en segundos → «hace …». Cortes en 60 s, 1 h y 1 día; siempre hacia abajo. null si no es válido. */
export function textoEncendido(seg) {
  if (!esNumNoNeg(seg)) return null;
  const s = Math.floor(seg);
  if (s < 60) return 'hace menos de 1 min';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  return `hace ${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h`;
}

const UNIDADES = ['B', 'KB', 'MB', 'GB', 'TB'];
const coma = (n) => String(n).replace('.', ',');

/**
 * Bytes → texto, en BASE 1024 (1 KB = 1024 B, 1 MB = 1024 KB): es lo que reportan el disco y la
 * memoria del proceso. Menos de 10 en la unidad → un decimal (sin «,0»); desde 10 → entero.
 * null (o inválido) → null: la vista muestra «no disponible».
 */
export function textoBytes(n) {
  if (!esNumNoNeg(n)) return null;
  if (n < 1024) return `${Math.round(n)} B`;
  let v = n, u = 0;
  while (v >= 1024 && u < UNIDADES.length - 1) { v /= 1024; u++; }
  let r = v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
  if (r >= 1024 && u < UNIDADES.length - 1) { r = Math.round((r / 1024) * 10) / 10; u++; }   // 1023,7 KB → 1 MB
  return `${coma(r)} ${UNIDADES[u]}`;
}

/** Segundos desde el último dato → «hace N s/min/h/d». Negativo (reloj corrido) → 0. null si no es número. */
export function textoHace(seg) {
  if (typeof seg !== 'number' || !Number.isFinite(seg)) return null;
  const s = Math.max(0, Math.floor(seg));
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

/**
 * 'YYYY-MM-DD HH:MM:SS' de SQLite (datetime('now'), que es UTC) → epoch ms, o null.
 * Se arma con Date.UTC desde las partes, en vez de Date.parse: Safari no parsea la fecha con
 * espacio, y sin la «Z» otros navegadores la leerían como hora LOCAL.
 */
export function msDeFechaUtc(texto) {
  const m = typeof texto === 'string' ? texto.match(FECHA_SQLITE) : null;
  if (!m) return null;
  const [a, mes, d, h, mi, s] = m.slice(1).map(Number);
  const ms = Date.UTC(a, mes - 1, d, h, mi, s);
  const f = new Date(ms);
  // Date.UTC desborda en silencio (mes 13 → enero siguiente): se rechaza lo que no vuelve igual.
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== d || f.getUTCHours() !== h || f.getUTCMinutes() !== mi || f.getUTCSeconds() !== s) return null;
  return ms;
}

/** ultimo_escaneo → «20 nov 2026, 04:00» en la hora local (o `zona`); null → «nunca»; inválido → null. */
export function fechaEscaneoLocal(texto, { zona } = {}) {
  if (texto === null) return 'nunca';
  const ms = msDeFechaUtc(texto);
  if (ms === null) return null;
  return new Intl.DateTimeFormat('es', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    ...(zona ? { timeZone: zona } : {}),
  }).format(ms);
}

// ── Gráfica ──

export const VENTANA_GRAFICA_MS = 60 * 60_000;
export const TECHO_MIN_MS = 150;
export const HOLGURA_TECHO = 1.15;
export const GUIAS = [{ valor: 100, etiqueta: 'lento · 100 ms' }, { valor: 500, etiqueta: 'mal · 500 ms' }];

const r1 = (n) => Math.round(n * 10) / 10;

/**
 * Las muestras (ya validadas) → lo que dibuja el SVG, en coordenadas de 0..ancho y 0..alto (y=0
 * arriba). Escala LINEAL con techo = max(TECHO_MIN_MS, pico × HOLGURA_TECHO), donde pico es el
 * `max` más alto (lo peor que se vio). El eje x es la última hora hasta la muestra más nueva: con
 * menos de una hora de datos, la línea arranca a la derecha. Guía de 100 siempre; la de 500 solo
 * si cabe (500 ≤ techo).
 * 0 muestras → null. 1 muestra → `unPunto: true` y una sola coordenada en cada línea.
 */
export function puntosGrafica(muestras, { ancho = 600, alto = 160 } = {}) {
  if (!Array.isArray(muestras) || muestras.length === 0) return null;
  const fin = muestras[muestras.length - 1].t;
  const inicio = fin - VENTANA_GRAFICA_MS;
  let pico = muestras[0];
  for (const m of muestras) if (m.max > pico.max) pico = m;
  const techo = Math.max(TECHO_MIN_MS, pico.max * HOLGURA_TECHO);
  const x = (t) => r1((Math.min(Math.max(t, inicio), fin) - inicio) / VENTANA_GRAFICA_MS * ancho);
  const y = (v) => r1(alto - (Math.min(v, techo) / techo) * alto);
  const linea = (campo) => muestras.map((m) => `${x(m.t)},${y(m[campo])}`).join(' ');
  return {
    ancho, alto, techo: r1(techo),
    unPunto: muestras.length === 1,
    p99: linea('p99'),
    max: linea('max'),
    guias: GUIAS.filter((g) => g.valor <= techo).map((g) => ({ ...g, y: y(g.valor) })),
    pico: { valor: pico.max, t: pico.t },
  };
}

// ── Diagnóstico y build ──

/** El hash del bundle de Vite (<script src="/assets/index-HASH.js">) o 'dev' si no lo hay. */
export function idDelBuild(documento) {
  const scripts = documento?.querySelectorAll?.('script[src]') ?? [];
  for (const s of scripts) {
    const src = s.getAttribute?.('src') ?? s.src ?? '';
    const m = /\/assets\/index-([A-Za-z0-9_-]{4,64})\.js(?:$|\?)/.exec(src);
    if (m) return m[1];
  }
  return 'dev';
}

/**
 * Lo que copia «Copiar diagnóstico»: hora ISO + build + el JSON admin VALIDADO, como texto.
 * No puede llevar el token: no lee localStorage, el JSON pasa otra vez por validarAdminServidor
 * (que solo copia claves conocidas con forma acotada) y el build tiene que ser un hash o 'dev'.
 * null si el JSON admin no es válido.
 */
export function armarDiagnostico({ admin, build, ahora = Date.now() }) {
  const servidor = validarAdminServidor(admin);
  if (!servidor || !Number.isFinite(ahora)) return null;
  const b = typeof build === 'string' && /^(dev|[A-Za-z0-9_-]{4,64})$/.test(build) ? build : 'desconocido';
  return JSON.stringify({ generado: new Date(ahora).toISOString(), cliente: { build: b }, servidor }, null, 2);
}
