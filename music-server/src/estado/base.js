// LO QUE /api/admin/servidor DICE DE LA BASE: tamaño, tamaño del WAL, pistas y último escaneo.
//
// ⚠️ LA RUTA DEL ARCHIVO SE USA SOLO ACÁ ADENTRO, para el stat. Lo que sale son números y una
// fecha; la ruta nunca.
//
// DE DÓNDE SALE LA RUTA. Primero db.location(), que es la verdad de la conexión abierta. Si el
// node:sqlite de la imagen no la trae (no es una función), cae a `rutaRespaldo`, que es la
// misma que usó db/database.js para abrirla (DB_PATH). Si location() existe pero devuelve null
// (base en memoria), no hay archivo y los tamaños salen null: el respaldo no aplica, porque esa
// conexión no es la de DB_PATH.
import { statSync } from 'node:fs';

export const CACHE_MS = 5_000;   // los agregados, a lo sumo cada 5 s

function tamano(ruta) {
  try { return statSync(ruta).size; } catch { return null; }
}

/** `conexion` es un DatabaseSync (o un doble con prepare y, opcionalmente, location). */
export function crearLectorBase({ conexion, rutaRespaldo = null, cacheMs = CACHE_MS, ahora = Date.now }) {
  const PISTAS = conexion.prepare('SELECT COUNT(*) AS n, MAX(scanned_at) AS ultimo FROM tracks');

  function ruta() {
    return typeof conexion.location === 'function' ? conexion.location() : rutaRespaldo;
  }

  function leer() {
    const r = ruta();
    const fila = PISTAS.get();
    return {
      bytes: r ? tamano(r) : null,
      // Sin archivo -wal (recién hecho un checkpoint completo, o sin WAL) son 0 bytes, no null.
      wal_bytes: r ? (tamano(`${r}-wal`) ?? 0) : null,
      pistas: Number(fila.n),
      // El scanner pone scanned_at en cada pista que inserta o actualiza: el más reciente es
      // cuándo pasó el último escaneo que tocó algo. Texto UTC de SQLite, o null sin pistas.
      ultimo_escaneo: fila.ultimo ?? null,
    };
  }

  let cache = null;
  let en = 0;
  return function enCache() {
    const t = ahora();
    if (!cache || t - en >= cacheMs) { cache = leer(); en = t; }
    return cache;
  };
}
