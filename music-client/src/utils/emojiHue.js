// Hash multiplicativo de Knuth → hue 0-359. knuthHue toma los bits BAJOS (`% 360`): lo usa
// SOLO emojiHue, y queda congelado así para que los colores ya asignados en Playlists/
// Géneros no se muevan ni un grado. stringHue (abajo) usa los bits ALTOS del mismo hash,
// por eso NO comparte este core. Se pasa por card/fila como CSS var `--h` (hereda a tile,
// borde y degradado). No es dato de DB: se calcula en el cliente.
function knuthHue(seed) {
  return (seed * 2654435761 >>> 0) % 360;   // bits bajos: NO tocar, emojiHue depende de esta salida exacta
}

// Deriva un hue (0-359) del emoji de una playlist/género. Mira SOLO el primer code
// point: como el emoji es un único glifo, alcanza. (Salida idéntica a la versión
// previa → los colores ya asignados en Playlists/Géneros no se mueven.)
export function emojiHue(emoji) {
  const c = (emoji || '🎵').codePointAt(0) || 0;
  return knuthHue(c);
}

// Hue POR ARTISTA. El artista no tiene emoji ni la DB guarda MBID, así que la única semilla
// estable y real es el NOMBRE. Dos cosas lo separan de emojiHue:
//   1. Pliega TODO el nombre (rolling hash sobre todos los code points), no el primer code
//      point: si no, dos artistas con la misma inicial colisionan (Nujabes/NewJeans, 'N').
//   2. Toma los BITS ALTOS del hash de Knuth (Fibonacci hashing), NO `% 360`. El `% 360` se
//      queda con los bits BAJOS —los peor mezclados del método multiplicativo— y agrupaba
//      los 7 artistas en clusters con una colisión dura (Daft Punk = NewJeans = 208°). Con
//      los bits altos la separación mínima entre los 7 pasa de 0° a 23°.
// Por eso NO reusa knuthHue (que se queda en bits bajos para no mover Playlists/Géneros).
// Identidad ESTABLE: mismo nombre → mismo color, siempre. OJO: el color se DERIVA, no se
// persiste; si algún día se guardara el color de artista, cambiar esta derivación sería
// BREAKING (recolorea a todos). Cero backend/DB.
export function stringHue(name) {
  let acc = 0;
  for (const ch of (name || '')) acc = (acc * 31 + (ch.codePointAt(0) || 0)) >>> 0;
  // bits altos del hash de Knuth → hue 0-359 (ver nota arriba: por qué no `% 360`).
  return Math.floor(((acc * 2654435761 >>> 0) / 4294967296) * 360);
}
