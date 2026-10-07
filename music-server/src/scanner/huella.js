// LA HUELLA DEL AUDIO (1.25.0): el MD5 de las muestras que el codificador FLAC escribe en la
// cabecera STREAMINFO. No cambia al mover, renombrar ni retaguear el archivo (los tags van en
// otros bloques), así que es lo que identifica "el mismo audio" cuando cambia la ruta.
//
// ⚠️ Se lee A MANO y no con music-metadata: la 10.9.1 lo parsea (`fileMD5`, en
// lib/flac/FlacParser.js) pero solo lo publica como `format.audioMD5` para WavPack. Medido con un
// FLAC de ffmpeg: el archivo trae el MD5 y `audioMD5` sale vacío.
//
// El formato (especificación de FLAC): "fLaC", y el PRIMER bloque de metadatos es SIEMPRE
// STREAMINFO: 4 bytes de cabecera de bloque + 34 de datos. El MD5 son los últimos 16 de esos 34,
// o sea los bytes 26 a 41 desde "fLaC". Algunos archivos traen una etiqueta ID3v2 ANTES de
// "fLaC": se salta con su tamaño (sincrosafe, 4 × 7 bits) más los 10 de su cabecera.
//
// Un MD5 en ceros quiere decir "el codificador no lo calculó": se trata como sin huella.
import { closeSync, openSync, readSync } from 'node:fs';

const LEER = 64; // alcanza para "fLaC" + STREAMINFO entero (42 bytes)

/** El MD5 en hex de una cabecera FLAC ya leída (desde "fLaC" o desde una ID3 previa), o null. */
export function md5DeCabecera(buf) {
  if (!buf || buf.length < 42) return null;
  if (buf.toString('latin1', 0, 4) !== 'fLaC') return null;
  // Tipo de bloque: los 7 bits bajos del byte 4 tienen que ser 0 (STREAMINFO).
  if ((buf[4] & 0x7f) !== 0) return null;
  const md5 = buf.subarray(26, 42);
  if (md5.every((b) => b === 0)) return null;
  return md5.toString('hex');
}

/** El tamaño de una etiqueta ID3v2 al principio (cabecera incluida), o 0 si no hay. */
export function largoId3(buf) {
  if (!buf || buf.length < 10 || buf.toString('latin1', 0, 3) !== 'ID3') return 0;
  const t = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
  const pie = buf[5] & 0x10 ? 10 : 0; // ID3v2.4 con pie
  return 10 + t + pie;
}

/** La huella de un archivo: el MD5 del audio si es un FLAC que lo trae, si no null. Nunca lanza. */
export function huellaDeArchivo(ruta) {
  let fd;
  try {
    fd = openSync(ruta, 'r');
    const cab = Buffer.alloc(10);
    readSync(fd, cab, 0, 10, 0);
    const salto = largoId3(cab);
    const buf = Buffer.alloc(LEER);
    const n = readSync(fd, buf, 0, LEER, salto);
    return md5DeCabecera(buf.subarray(0, n));
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { closeSync(fd); } catch { /* nada */ }
  }
}
