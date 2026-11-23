// EL PULSO DEL SERVIDOR: cuánto se atrasa el event loop, cada 10 s, la última hora.
//
// Node atiende TODAS las peticiones en un solo hilo, y node:sqlite es síncrono: una consulta
// lenta, un escaneo de carpetas o un JSON enorme no se ven como "CPU alta", se ven como que
// el loop deja de dar vueltas y todo lo demás espera. Eso es justo lo que mide
// perf_hooks.monitorEventLoopDelay: el retraso entre que un timer debía correr y que corrió.
//
// CÓMO SE MUESTREA. Un histograma acumula sin parar; cada INTERVALO_MS se lee p50/p99/máx,
// se guarda una muestra y se REINICIA, así cada muestra es "esos 10 s" y no "desde que
// arrancó". El buffer es circular, de CAPACIDAD muestras (360 × 10 s = 60 min): no crece.
//
// El timer va con unref(): no mantiene vivo el proceso. Un script que importe esto y
// termine, termina.
//
// Nada de esto toca la base ni el disco: solo memoria del proceso.
import { monitorEventLoopDelay } from 'node:perf_hooks';

export const INTERVALO_MS = 10_000;
export const CAPACIDAD = 360;
// Resolución del histograma (ms): cada cuánto el monitor mira el reloj. 20 es el default de
// Node; más fino cuesta más timers y no cambia lo que se quiere ver (atrasos de ≥100 ms).
export const RESOLUCION_MS = 20;

// LO QUE SE GUARDA ES EL ATRASO SOBRE EL INTERVALO ESPERADO, no lo que da el histograma.
// Medido (Node 22.18, Windows 11, proceso ocioso): el histograma guarda el intervalo ENTERO
// entre disparos del timer —la resolución incluida—, y Windows además lo redondea a su tick de
// ~15,6 ms. Crudo, con 20 ms, el reposo daba p50 ≈ 31 y p99 ≈ 33, y un bloqueo síncrono de
// 200 ms salía como 215. Por eso a p50, p99 y máx se les resta RESOLUCION_MS, con piso en 0
// (un disparo que llegó antes de tiempo no es un atraso negativo).
// Piso en reposo DESPUÉS del descuento, medido en Windows 11 (4 ventanas reales de 10 s, proceso
// ocioso): p50 ≈ 11, p99 12,6–13,1, máx 12,9–14,8 ms. No es 0 porque el tick de ~15,6 ms
// redondea los 20 hacia arriba (≈ 31). Un bloqueo de 200 ms sale como 195–197. En Linux, que
// es producción: [no medido].
// El atraso se anota cuando el timer del monitor vuelve a correr, o sea DESPUÉS del bloqueo:
// una toma en el mismo tick del bloqueo todavía no lo ve.
const ms = (ns) => Math.round((ns / 1e6) * 100) / 100;   // ns → ms con 2 decimales

/**
 * `ahora`, `histograma` y `rss` se inyectan para las pruebas. Sin argumentos usa el reloj,
 * el monitor real y la memoria del proceso.
 */
export function crearMuestreador({
  ahora = Date.now,
  rss = () => process.memoryUsage.rss(),
  intervaloMs = INTERVALO_MS,
  capacidad = CAPACIDAD,
  resolucionMs = RESOLUCION_MS,
  histograma = () => monitorEventLoopDelay({ resolution: resolucionMs }),
} = {}) {
  // Del valor crudo del histograma (ns) al atraso (ms): se resta la resolución, piso en 0.
  const atraso = (ns) => Math.max(0, ms(ns - resolucionMs * 1e6));
  const buf = new Array(capacidad);
  let n = 0;           // cuántas hay (≤ capacidad)
  let sig = 0;         // dónde va la próxima
  let ultima = null;   // { t, p50, p99, max } de la última ventana
  let h = null;
  let timer = null;
  let desde = null;    // cuándo arrancó: 'sin_datos' cuenta desde acá

  /** Cierra la ventana actual: lee, guarda y reinicia. Lo llama el timer; las pruebas, a mano. */
  function tomar() {
    if (!h) return null;
    // Un histograma sin lecturas (el loop no dio ni una vuelta de RESOLUCION_MS) da
    // percentiles en 0 y un min absurdo; se guarda igual, como 0, para no dejar hueco.
    const vacio = !(h.count > 0);
    const m = {
      t: ahora(),
      p50: vacio ? 0 : atraso(h.percentile(50)),
      p99: vacio ? 0 : atraso(h.percentile(99)),
      max: vacio ? 0 : atraso(h.max),
      rss: rss(),
    };
    h.reset();
    buf[sig] = m;
    sig = (sig + 1) % capacidad;
    if (n < capacidad) n++;
    ultima = { t: m.t, p50: m.p50, p99: m.p99, max: m.max };
    return m;
  }

  function iniciar() {
    if (timer) return;
    h = histograma();
    h.enable();
    desde = ahora();
    timer = setInterval(tomar, intervaloMs);
    timer.unref?.();
  }

  function detener() {
    if (timer) clearInterval(timer);
    timer = null;
    h?.disable();
  }

  /** Las muestras de los últimos `ventanaMs`, de la más vieja a la más nueva. */
  function muestras(ventanaMs = Infinity) {
    const corte = ahora() - ventanaMs;
    const out = [];
    for (let i = 0; i < n; i++) {
      const m = buf[(sig - n + i + capacidad) % capacidad];
      if (m.t >= corte) out.push({ t: m.t, p99: m.p99, max: m.max, rss: m.rss });
    }
    return out;
  }

  /** El p99 más alto de los últimos `ventanaMs`, o null si no hay muestras ahí. */
  function p99Max(ventanaMs) {
    const ms_ = muestras(ventanaMs);
    return ms_.length ? Math.max(...ms_.map((m) => m.p99)) : null;
  }

  /** ms desde iniciar(); null si no arrancó. */
  const edadMs = () => (desde === null ? null : ahora() - desde);

  return { iniciar, detener, tomar, muestras, p99Max, edadMs, ultima: () => ultima };
}

// La instancia del servidor. server.js la arranca; nadie más.
export const muestreador = crearMuestreador();
