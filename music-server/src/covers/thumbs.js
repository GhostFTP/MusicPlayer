// Miniaturas de carátula, generadas bajo demanda y cacheadas en disco.
//
// POR QUÉ EXISTE: el scanner extrae el arte embebido tal cual viene en los tags
// (scanner/index.js:45-51), y eso son 300-800 kB por pista. La grilla de Álbumes
// pinta 125 tarjetas de ~190px con esos originales: ~55 MB por render, suficiente
// para saturar el túnel y hacer que /api/albums se pase del timeout de 10s.
//
// DÓNDE VIVEN: data/thumbs/, hermano de data/covers/. Es el volumen nombrado
// `musicplayer-data` (docker-compose.yml:25), que sobrevive redeploys. NO se puede
// usar /mnt/storage: está montado :ro y el kernel lo impone.
//
// NOMBRE: siempre `<trackId>.jpg`, sin importar el formato de origen. Eso los hace
// inmunes al huérfano que sí sufre data/covers/, donde el nombre lleva la extensión
// del arte (`<id>.<ext>`) y un retag de jpeg a png deja el archivo viejo tirado.

import { statSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dir = dirname(fileURLToPath(import.meta.url));
const THUMBS_DIR = resolve(__dir, '../../data/thumbs');

// 480px de lado mayor. El caso que manda NO es el escritorio sino el teléfono:
// la grilla móvil (main.css:4685) da tarjetas de ~190px CSS y un DPR de 3 las
// lleva a ~576px reales. 480 se queda apenas corto ahí a propósito — cubrirlo
// costaría ~1.4x en bytes (el área va al cuadrado) para ganar un reescalado del
// 20% sobre arte fotográfico dentro de una tarjeta chica, que no se ve.
const THUMB_SIZE = 480;
const THUMB_QUALITY = 80;

// Tope de resizes en paralelo. El primer render de Álbumes pide 125 thumbs de
// golpe; sin techo, 125 decodificaciones simultáneas compiten con el Express que
// tiene que seguir sirviendo /api/albums — exactamente lo que vinimos a arreglar.
const MAX_CONCURRENT = 3;

mkdirSync(THUMBS_DIR, { recursive: true });

// ── Semáforo ────────────────────────────────────────────────────────────────
let active = 0;
const waiting = [];

function acquire() {
  if (active < MAX_CONCURRENT) { active++; return Promise.resolve(); }
  return new Promise((r) => waiting.push(r));
}

function release() {
  const next = waiting.shift();
  // Si hay alguien esperando le cedemos el turno SIN bajar `active`: el cupo no
  // se libera, cambia de dueño. Bajarlo y que el otro lo vuelva a subir abre una
  // ventana por la que se colaría un tercero.
  if (next) next();
  else active--;
}

// ── Single-flight ───────────────────────────────────────────────────────────
// Un mismo id pedido dos veces mientras se genera (un F5 a mitad de carga) no
// dispara dos resizes: el segundo se cuelga de la promesa del primero.
const pending = new Map();

/**
 * Devuelve la ruta del thumb de `trackId`, generándolo si falta o si venció.
 * Devuelve `null` si no se pudo — el llamador debe caer al original.
 */
export async function getThumb(trackId, coverPath) {
  if (!coverPath) return null;

  // throwIfNoEntry:false → undefined en vez de excepción si no está.
  const cover = statSync(coverPath, { throwIfNoEntry: false });
  if (!cover) return null;

  const dest = join(THUMBS_DIR, `${trackId}.jpg`);
  const thumb = statSync(dest, { throwIfNoEntry: false });

  // VENCIMIENTO: el scanner reescribe la carátula en CADA corrida
  // (scanner/index.js:168 → writeFileSync incondicional), así que su mtime sube
  // aunque el arte no haya cambiado. Comparar mtimes alcanza y sobra: si Oscar
  // retagueó y re-escaneó, el thumb queda viejo y se regenera solo.
  if (thumb && thumb.mtimeMs >= cover.mtimeMs) return dest;

  const inFlight = pending.get(trackId);
  if (inFlight) return inFlight;

  const job = (async () => {
    await acquire();
    // Escribimos a un temporal y renombramos. El rename es atómico dentro del
    // mismo filesystem, y hace falta de verdad: el calentador del scanner corre
    // en OTRO proceso (`npm run scan`) mientras el server puede estar sirviendo.
    // Sin esto, un thumb a medio escribir queda con mtime nuevo y se serviría
    // roto para siempre. El pid en el nombre evita que los dos procesos se pisen
    // el temporal entre sí.
    const tmp = `${dest}.${process.pid}.tmp`;
    try {
      await sharp(coverPath)
        .resize(THUMB_SIZE, THUMB_SIZE, {
          fit: 'inside',
          // No agrandar una carátula que ya sea menor a 480: sería pesar más
          // por una imagen que no gana un solo píxel de detalle.
          withoutEnlargement: true,
        })
        .jpeg({ quality: THUMB_QUALITY })
        .toFile(tmp);
      renameSync(tmp, dest);
      return dest;
    } catch (err) {
      // Un arte corrupto o un formato que libvips no entienda NO puede tumbar la
      // petición: el endpoint cae al original y el usuario ve su carátula.
      console.warn(`[thumbs] ${trackId}: ${err.message}`);
      try { unlinkSync(tmp); } catch { /* no llegó a crearse */ }
      return null;
    } finally {
      release();
      pending.delete(trackId);
    }
  })();

  pending.set(trackId, job);
  return job;
}

export { THUMBS_DIR, THUMB_SIZE };
