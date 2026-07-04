// Deriva un hue (0-359) del emoji de una playlist, de forma PURA y determinista.
// Multiplicativo de Knuth sobre el primer code point → buen spread angular, así
// los emoji "de música" no se agrupan en un rango de color angosto. Se pasa por
// card/fila como CSS var `--h` (hereda a tile, borde y degradado). No es dato
// nuevo de DB: se calcula en el cliente a partir del emoji ya guardado.
export function emojiHue(emoji) {
  const c = (emoji || '🎵').codePointAt(0) || 0;
  return (c * 2654435761 >>> 0) % 360;
}
