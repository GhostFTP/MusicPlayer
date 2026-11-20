// CONTADORES EN MEMORIA: cuántos 500 y cuántos SQLITE_BUSY desde que arrancó el proceso.
// Se pierden al reiniciar, y es a propósito: son para ver "¿está pasando AHORA?", no un
// historial. Nada de esto se escribe en la base ni en disco.

let busy = 0;
let e500 = 0;

// CÓMO SE RECONOCE UN SQLITE_BUSY EN node:sqlite — medido con una base temporal (Node
// 22.18, dos conexiones, una con BEGIN IMMEDIATE abierto), no supuesto:
//   · `code` es SIEMPRE 'ERR_SQLITE_ERROR', sea cual sea el error: no distingue nada.
//   · `errcode` es el código EXTENDIDO de SQLite: 5 para el BUSY simple y 517
//     (SQLITE_BUSY_SNAPSHOT) cuando una lectura en WAL quiere pasar a escritura y otra
//     conexión ya escribió. Por eso se mira el byte bajo (& 0xff), que es el código primario.
//   · `errstr`/`message` es 'database is locked' en los dos casos; no se usa el texto.
// SQLITE_LOCKED (6) es otra cosa —conflicto dentro de la MISMA conexión— y no cuenta.
const SQLITE_BUSY = 5;

export function esBusy(e) {
  return Number.isInteger(e?.errcode) && (e.errcode & 0xff) === SQLITE_BUSY;
}

/** Cuenta el error si es un SQLITE_BUSY. No cambia nada más: el catch que lo llama sigue igual. */
export function contarBusy(e) {
  if (esBusy(e)) busy++;
}

// Los 500 se cuentan en UN solo lugar, al terminar la respuesta, y no en cada catch: así
// entra cualquier 500, venga de handle(), de protegido() de playlists, de plays.js o de una
// ruta que no pasa por ninguno (stream.js). Solo 500 exacto: el 503 de "índice de videos no
// disponible" es una respuesta prevista, no un error del servidor.
export function contarErrores500(_req, res, next) {
  res.on('finish', () => { if (res.statusCode === 500) e500++; });
  next();
}

export const contadores = () => ({ sqlite_busy: busy, errores_500: e500 });
