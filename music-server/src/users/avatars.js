// La FOTO de avatar: dónde vive, cómo se procesa y cómo se le arma la forma que ve la
// API. El emoji no pasa por acá — ese es una columna y lo valida users/service.js.
//
// DÓNDE VIVEN: data/avatars/, hermano de data/covers/ y data/thumbs/. Es el volumen
// nombrado `musicplayer-data` (docker-compose.yml), que sobrevive redeploys. Se eligió
// el mismo sitio que las miniaturas a propósito: ya está montado, ya está respaldado y
// ya es el lugar donde este repo guarda imágenes derivadas.
//
// NOMBRE: siempre `<id>.jpg`, sin importar qué formato subieron. Como el nombre no
// lleva la extensión de origen, cambiar de PNG a JPEG no deja un archivo viejo tirado
// —el mismo motivo por el que data/thumbs/ no sufre el huérfano que sí tiene
// data/covers/—, y además hace que borrar sea un solo unlink sin mirar nada.
import { mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dir = dirname(fileURLToPath(import.meta.url));
const AVATARS_DIR = resolve(__dir, '../../data/avatars');

// 256 de lado. Es una foto de perfil dentro de una tarjeta: el uso más grande que se
// le ve hoy es el círculo del panel de usuarios, de 44pt, y un DPR de 3 lo deja en
// 132px. 256 cubre eso con margen y deja sitio para un hero de perfil más grande sin
// tener que reprocesar lo ya subido.
export const AVATAR_SIZE = 256;
const AVATAR_QUALITY = 80;

// 6 MB de entrada. Una foto de un teléfono moderno ronda los 3-5 MB, así que esto
// entra sin recortar el caso normal; y lo que se guarda después son ~10-20 kB, porque
// lo que se sirve es el resultado y no lo que llegó.
export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

// Los tres formatos que un teléfono o un navegador producen hoy. No es la lista de lo
// que libvips sabe leer —sabe bastante más— sino la de lo que tiene sentido aceptar:
// cuanto más chica, menos superficie para darle a un decodificador algo raro.
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

mkdirSync(AVATARS_DIR, { recursive: true });

export const avatarPath = id => join(AVATARS_DIR, `${id}.jpg`);

/** Procesa lo que subieron y lo deja en disco. Devuelve la marca de tiempo que hay que
 *  guardar en `avatar_updated_at`, o lanza si la imagen no se puede leer.
 *
 *  QUÉ LE HACE, y cada paso está por algo:
 *   · `rotate()` sin argumentos aplica la orientación del EXIF. Sin esto, una foto
 *     sacada en vertical con un iPhone se guarda acostada: el sensor la captura
 *     apaisada y lo que la endereza es un tag que el recorte de abajo ignoraría.
 *   · `fit: 'cover'` + `position: 'centre'` es el recorte cuadrado centrado: llena los
 *     256×256 y se come lo que sobra del lado largo, en vez de deformar la cara.
 *   · `.jpeg()` sin `withMetadata()` TIRA los metadatos, y eso es lo que importa: una
 *     foto de teléfono trae GPS en el EXIF, y este archivo lo puede pedir cualquier
 *     usuario con sesión. La orientación ya se aplicó a los píxeles, así que perder el
 *     tag no cambia nada de cómo se ve.
 */
export async function writeAvatarPhoto(id, buffer) {
  const dest = avatarPath(id);
  // A temporal y rename, como las miniaturas: el rename es atómico dentro del mismo
  // filesystem. Acá el riesgo no es otro proceso sino la petición misma — si el
  // proceso muere a mitad de la escritura, sin esto quedaría un JPEG truncado que se
  // serviría roto hasta que alguien subiera otro.
  const tmp = `${dest}.${process.pid}.tmp`;
  try {
    await sharp(buffer)
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: AVATAR_QUALITY })
      .toFile(tmp);
    renameSync(tmp, dest);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* no llegó a crearse */ }
    throw err;
  }
  return sqliteAhora();
}

/** Borra la foto si está. Se traga el ENOENT: que no haya archivo es el estado normal
 *  de casi todas las cuentas, y quien llama siempre quiere lo mismo —que no quede
 *  ninguna—, no saber si había. */
export function deleteAvatarPhoto(id) {
  try { unlinkSync(avatarPath(id)); } catch { /* no había */ }
}

// La misma forma que usa `created_at` (`datetime('now')` de SQLite): UTC, sin la T y
// sin zona. Se escribe desde JS y no con un DEFAULT porque las escrituras del avatar
// son UPDATE y no INSERT.
function sqliteAhora() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/** El TEXT de SQLite a epoch en milisegundos, para el `?v=` y el ETag.
 *
 *  Se arma con Date.UTC y no con `new Date(texto)`: ese formato —espacio en vez de la
 *  T y sin zona— está fuera de la especificación, así que cada motor decide, y el modo
 *  más probable de fallar es tomarlo como hora LOCAL. Acá eso no se vería como una
 *  fecha corrida sino como un `?v=` que cambia de valor según el huso del servidor. */
const FECHA_SQLITE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;

export function epochDe(texto) {
  const m = FECHA_SQLITE.exec(String(texto ?? ''));
  if (!m) return 0;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/** La forma que ve la API, a partir de las dos columnas. UNA de tres:
 *    { kind: 'emoji', value }             · { kind: 'photo', url, updatedAt }  · null
 *
 *  El emoji gana si por lo que sea estuvieran las dos: el invariante dice que no puede
 *  pasar, pero de las dos es la que no depende de que haya un archivo en el disco, así
 *  que ante una base inconsistente esto muestra algo en vez de una foto rota.
 *
 *  LA URL LLEVA `?v=` Y NO ES `immutable`. Con la versión adentro, cambiar la foto
 *  cambia la URL y el navegador y la app piden la nueva sin que nadie invalide nada.
 *  `immutable` está descartado a propósito: le diría al cliente que NO revalide ni
 *  siquiera al recargar, y si alguna vez servimos la URL sin `?v=` —un enlace viejo,
 *  un caché intermedio— la foto vieja se quedaría pegada sin forma de echarla.
 */
export function avatarDe(row) {
  if (row?.avatar_emoji) return { kind: 'emoji', value: row.avatar_emoji };
  if (row?.avatar_updated_at) {
    return {
      kind: 'photo',
      url: `/api/users/${row.id}/avatar?v=${epochDe(row.avatar_updated_at)}`,
      updatedAt: row.avatar_updated_at,
    };
  }
  return null;
}
