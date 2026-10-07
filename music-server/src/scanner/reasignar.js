// EMPAREJAR HUÉRFANAS (1.25.0): cuando el barrido va a borrar las filas cuyo archivo ya no
// existe, primero se busca, para cada una, la fila VIVA que es el mismo audio (el archivo se movió
// o se renombró). PURO: recibe filas y devuelve parejas; no toca la base. Lo prueba
// scripts/test-reasignar.mjs.
//
// Dos llaves, en orden:
//   1. `audio_md5` (la huella del FLAC, scanner/huella.js). Empareja SOLO si ese MD5 lo tiene
//      exactamente UNA huérfana y exactamente UNA viva. Si son más de un lado —la misma canción
//      en un álbum y en una recopilación—, es ambiguo y no se empareja.
//   2. RESPALDO para las huérfanas SIN md5 (filas escaneadas antes de la 1.25.0, o archivos que no
//      lo traen): misma `duration` exacta (sale de las muestras del archivo, así que un archivo
//      movido da el mismo número), misma `sample_rate` y `bits_per_sample`, y además el mismo
//      título, o el mismo álbum y número de pista (comparando sin mayúsculas ni espacios de más).
//      También tiene que ser única de los dos lados.
// Una viva solo puede recibir UNA huérfana. Lo que no empareja se archiva (no se reasigna).

const norm = (s) => (typeof s === 'string' ? s.trim().replace(/\s+/g, ' ').toLowerCase() : '');

function baseRespaldo(f) {
  if (typeof f.duration !== 'number' || !Number.isFinite(f.duration) || f.duration <= 0) return null;
  return `${f.duration}|${f.sample_rate ?? ''}|${f.bits_per_sample ?? ''}`;
}

/** ¿Estas dos filas son "el mismo" por el respaldo (más allá de la base)? */
function mismaPorDatos(a, b) {
  const ta = norm(a.title);
  if (ta && ta === norm(b.title)) return true;
  const alb = norm(a.album);
  return !!alb && alb === norm(b.album) && a.track_number != null && a.track_number === b.track_number;
}

/** Map(idHuérfana → idViva), y por qué llave se emparejó cada una. */
export function emparejar(huerfanas, vivas) {
  const pares = new Map();
  const llave = new Map();
  const vivaTomada = new Set();

  // 1. Por md5.
  const porMd5 = (lista) => {
    const m = new Map();
    for (const f of lista) if (f.audio_md5) m.set(f.audio_md5, [...(m.get(f.audio_md5) ?? []), f]);
    return m;
  };
  const hMd5 = porMd5(huerfanas);
  const vMd5 = porMd5(vivas);
  for (const [md5, hs] of hMd5) {
    const vs = vMd5.get(md5) ?? [];
    if (hs.length === 1 && vs.length === 1) {
      pares.set(hs[0].id, vs[0].id);
      llave.set(hs[0].id, 'md5');
      vivaTomada.add(vs[0].id);
    }
  }

  // 2. Respaldo, solo para huérfanas SIN md5. Las vivas que ya tomó el md5 no cuentan.
  const sinMd5 = huerfanas.filter((h) => !h.audio_md5 && !pares.has(h.id));
  const candidatas = new Map(); // idHuérfana → [vivas]
  const pretendientes = new Map(); // idViva → cuántas huérfanas la eligen
  for (const h of sinMd5) {
    const base = baseRespaldo(h);
    if (!base) continue;
    const cs = vivas.filter((v) => !vivaTomada.has(v.id) && baseRespaldo(v) === base && mismaPorDatos(h, v));
    candidatas.set(h.id, cs);
    for (const v of cs) pretendientes.set(v.id, (pretendientes.get(v.id) ?? 0) + 1);
  }
  for (const [hId, cs] of candidatas) {
    if (cs.length === 1 && pretendientes.get(cs[0].id) === 1) {
      pares.set(hId, cs[0].id);
      llave.set(hId, 'respaldo');
    }
  }
  return { pares, llave };
}
