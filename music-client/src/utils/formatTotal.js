// Duración total en formato limpio ("48 min" / "1 h 12 min"). Devuelve null si el
// total es 0 (o no hay datos) → quien la use oculta el segmento en vez de mostrar
// "0 min". Piso de 1 min para totales muy cortos. Pura, cero backend.
// Compartida por el hero de playlist (Playlists.jsx) y el subtítulo de Biblioteca
// (Library.jsx) para no duplicar el formato.
export function fmtTotal(secs) {
  const total = Math.round(secs || 0);
  if (total <= 0) return null;
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  return `${Math.max(1, m)} min`;
}
