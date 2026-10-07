// EL HEADER Range, de UN rango, según RFC 9110 §14.1.2 y §14.2. Lo usan el stream de audio
// y el de video (los dos pasan por `enviarConRange`, stream/stream.js).
//
//   'completo'       → 200 con el archivo entero. Sin Range, y también cuando el Range está
//                      malformado, es de otra unidad, trae varios rangos o es "a-b" con a > b:
//                      el RFC deja IGNORARLO, y es lo más seguro.
//   'parcial'        → 206 con { start, end } ya dentro del archivo: un fin más allá del
//                      final se recorta, y un sufijo "-N" con N mayor que el archivo da todo.
//   'insatisfacible' → 416: el inicio está en o después del final, o el sufijo es "-0".
//
// Hasta la 1.24.0 esto era un split('-') + parseInt: "bytes=-100" daba start = NaN, pasaba la
// validación (toda comparación con NaN es falsa) y createReadStream lanzaba. En el video,
// que es async, eso mataba el proceso. Acá no hay número que no se haya validado.
export function parsearRange(header, size) {
  if (header == null) return { tipo: 'completo' };
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(String(header));
  if (!m || (m[1] === '' && m[2] === '')) return { tipo: 'completo' };

  if (m[1] === '') { // sufijo: los últimos N bytes
    const n = Number(m[2]);
    if (!Number.isSafeInteger(n)) return { tipo: 'completo' };
    if (n === 0 || size === 0) return { tipo: 'insatisfacible' };
    return { tipo: 'parcial', start: Math.max(0, size - n), end: size - 1 };
  }

  const start = Number(m[1]);
  const end = m[2] === '' ? size - 1 : Number(m[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return { tipo: 'completo' };
  if (m[2] !== '' && end < start) return { tipo: 'completo' };
  if (start >= size) return { tipo: 'insatisfacible' };
  return { tipo: 'parcial', start, end: Math.min(end, size - 1) };
}
