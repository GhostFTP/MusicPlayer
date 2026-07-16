// Multiplicativo de Knuth sobre una semilla entera → hue 0-359, con buen spread
// angular (los valores parecidos no se agrupan en un rango de color angosto). Core
// compartido por emojiHue (semilla = 1 code point) y stringHue (semilla = todo el
// nombre). Se pasa por card/fila como CSS var `--h` (hereda a tile, borde y degradado).
// No es dato nuevo de DB: se calcula en el cliente.
function knuthHue(seed) {
  return (seed * 2654435761 >>> 0) % 360;
}

// Deriva un hue (0-359) del emoji de una playlist/género. Mira SOLO el primer code
// point: como el emoji es un único glifo, alcanza. (Salida idéntica a la versión
// previa → los colores ya asignados en Playlists/Géneros no se mueven.)
export function emojiHue(emoji) {
  const c = (emoji || '🎵').codePointAt(0) || 0;
  return knuthHue(c);
}

// Hue POR ARTISTA. El artista no tiene emoji ni la DB guarda MBID, así que la única
// semilla estable y real es el NOMBRE. No se puede reusar emojiHue tal cual: mira solo
// el primer code point → dos artistas con la misma inicial colisionan (Nujabes/NewJeans,
// ambos 'N', darían el mismo hue). Acá se pliega TODO el string (rolling hash sobre
// todos los code points) antes de pasar por el mismo core → spread real. Cero backend/DB.
export function stringHue(name) {
  let acc = 0;
  for (const ch of (name || '')) acc = (acc * 31 + (ch.codePointAt(0) || 0)) >>> 0;
  return knuthHue(acc);
}
