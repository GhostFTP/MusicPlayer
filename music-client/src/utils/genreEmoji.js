// Mapea el `genre` crudo de una pista/fila de la DB a un emoji de identidad, sin
// tocar la data (los duplicados de tag — "R&B" vs "R&B/General", "Soundtrack" vs
// "Soundtracks" vs "Soundtracks/General", "Latin" vs "Latin Music/General" — siguen
// siendo filas separadas con su propio track_count/album_count; esto SOLO decide
// qué emoji mostrar). normalizeGenreKey() colapsa el ruido del escaneo (sufijo
// "/General", plural de Soundtracks, alias "Latin Music") a una clave canónica;
// GENRE_EMOJI mapea esa clave a un emoji fijo. Género no mapeado → fallback 🎵
// (mismo valor que ya usa el proyecto como emoji por defecto de una playlist nueva).
export function normalizeGenreKey(raw) {
  let s = (raw || '').trim().toLowerCase();
  s = s.replace(/\/general$/, '');              // "R&B/General" → "r&b", "Pop/General" → "pop"...
  s = s.replace(/^soundtracks$/, 'soundtrack'); // plural → singular canónico
  s = s.replace(/^latin music$/, 'latin');      // alias: mismo género real que "Latin"
  return s.trim();
}

// Cuernos (Hard Rock & Metal) vs. rayo (Thrash Metal) es intencional: son dos
// filas distintas en la DB (cada una con su propio conteo) y comparten "familia"
// pero no son el mismo género — un emoji compartido los fusionaría visualmente,
// que es justo lo que la regla de "no tocar duplicados" busca evitar.
const GENRE_EMOJI = {
  'dance & dj':        '🪩',
  'electronic':        '🎧',
  'hard rock & metal': '🤘',
  'hip hop':           '🎤',
  'international':     '🌐',
  'k-pop':             '✨',
  'latin':             '💃',
  'pop':               '⭐',
  'r&b':               '🎷',
  'soundtrack':        '🎬',
  'thrash metal':      '⚡',
};

const FALLBACK_EMOJI = '🎵';

export function genreEmoji(raw) {
  return GENRE_EMOJI[normalizeGenreKey(raw)] || FALLBACK_EMOJI;
}
