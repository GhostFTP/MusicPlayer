// De las muestras del event loop a una palabra: ok | lento | mal | sin_datos.
//
// ⚠️ UMBRALES PROVISIONALES. Salieron de la propuesta, no de mediciones de producción:
// hay que revisarlos cuando haya una semana de muestras reales del X99.
//
// Se comparan contra el ATRASO que guarda estado/muestreo.js: lo que el event loop tardó POR
// ENCIMA del intervalo esperado (la resolución del monitor ya viene descontada, piso en 0).
// No contra el valor crudo del histograma, que en reposo ya trae ~20–33 ms de resolución.
export const LENTO_MS = 100;        // PROVISIONAL: atraso p99 ≥ esto en la ventana → 'lento'
export const MAL_MS = 500;          // PROVISIONAL: atraso p99 ≥ esto en la ventana → 'mal'
export const VENTANA_MS = 60_000;   // PROVISIONAL: se mira el p99 MÁS ALTO de los últimos 60 s
export const ARRANQUE_MS = 30_000;  // PROVISIONAL: los primeros 30 s siempre 'sin_datos'

/** `m` es un muestreador (estado/muestreo.js). */
export function estadoDe(m) {
  const edad = m.edadMs();
  if (edad === null || edad < ARRANQUE_MS) return 'sin_datos';
  const p99 = m.p99Max(VENTANA_MS);
  // Pasados 30 s sin ninguna muestra en el último minuto, el muestreador no está corriendo:
  // eso tampoco es 'ok'.
  if (p99 === null) return 'sin_datos';
  if (p99 >= MAL_MS) return 'mal';
  if (p99 >= LENTO_MS) return 'lento';
  return 'ok';
}
