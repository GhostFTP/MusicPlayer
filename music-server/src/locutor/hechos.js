// Hechos de catálogo de una pista para el locutor (frente "locutor").
//
// PURO: sin base, sin red, sin reloj implícito (la fecha entra por `contexto.ahora`).
// El endpoint lee la fila de `tracks` y se la pasa; acá solo se limpia y se decide qué
// es un hecho confiable. Lo que no es confiable sale como null, nunca como '' ni 0.
//
// Solo datos de catálogo. `escuchas` se extrae pero NO entra en permitidos(): su frase es
// una plantilla fija, sin modelo.

const MAX_TEXTO = 120;
const ANIO_MIN = 1000;

// Texto de un tag → una línea limpia. Un tag es dato, nunca instrucción: se colapsa a una
// línea y se le quitan controles, bidi y zero-width (\p{Cc} y \p{Cf}).
export function normalizar(s) {
  if (s == null) return '';
  return String(s)
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

// Trunca por code points (no corta un surrogate pair); el «…» cuenta dentro del máximo.
function truncar(s) {
  const cps = Array.from(s);
  return cps.length <= MAX_TEXTO ? s : cps.slice(0, MAX_TEXTO - 1).join('').trimEnd() + '…';
}

function texto(v) {
  const t = truncar(normalizar(v));
  return t === '' ? null : t;
}

function entero(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v === 'string' && /^\s*\d{1,9}\s*$/.test(v)) return Number(v);
  return null;
}

function anioValido(v, ahora) {
  const n = entero(v);
  const actual = (ahora instanceof Date && !Number.isNaN(ahora.getTime()) ? ahora : new Date()).getUTCFullYear();
  return n !== null && n >= ANIO_MIN && n <= actual + 1 ? n : null;
}

// Comparación de nombres: sin mayúsculas ni diacríticos.
const plegar = (s) => normalizar(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function extraerHechos(track, contexto = {}) {
  const t = track ?? {};
  const ctx = contexto ?? {};

  const titulo = texto(t.title);
  const artista = texto(t.album_artist) ?? texto(t.artist);
  let album = texto(t.album);
  // Sencillo: el álbum se llama como la canción. Repetirlo no aporta.
  if (album !== null && titulo !== null && plegar(album) === plegar(titulo)) album = null;

  // track_number no distingue discos: en un disco doble "pista 3" es ambigua.
  const discos = entero(t.disc_total);
  const n = entero(t.track_number);
  const pista = (discos === null || discos <= 1) && n !== null && n >= 1 ? n : null;

  const plays = entero(ctx.plays);

  return {
    titulo,
    artista,
    album,
    anio: anioValido(t.year, ctx.ahora),
    genero: texto(t.genre),
    pista,
    escuchas: plays !== null && plays >= 0 ? plays : null,
  };
}

// Lo único que el modelo puede nombrar o cifrar. Base de la validación de la frase.
// `escuchas` queda fuera a propósito.
export function permitidos(hechos) {
  const h = hechos ?? {};
  const cifras = new Set();
  const nombres = new Set();
  if (h.anio != null) cifras.add(String(h.anio));
  if (h.pista != null) cifras.add(String(h.pista));
  for (const k of ['titulo', 'artista', 'album', 'genero']) {
    if (h[k] != null) nombres.add(plegar(h[k]));
  }
  return { cifras, nombres };
}
