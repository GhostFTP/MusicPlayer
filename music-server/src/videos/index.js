import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseFile } from 'music-metadata';

// EL ÍNDICE DE VIDEOS. No pasa por el escáner ni por music.db a propósito: los videos son
// pocos, se suben con scp y nadie va a correr un rescan, así que el índice vive en memoria
// y se rehace solo (ver `obtenerIndice`).
//
// LA CARPETA: VIDEO_DIR (en Docker, /videos, montada SOLO LECTURA y FUERA de /music, para
// que el escáner de música no la recorra). La forma es
// VIDEO_DIR/<Artista>/<Título (año)>.mp4, con la portada al lado: <Título (año)>.jpg.
// Solo se miran DOS niveles; un archivo suelto en la raíz no tiene artista y se ignora.
//
// SIN VIDEO_DIR, o con la carpeta inexistente, el servidor arranca igual: la lista sale
// vacía y queda un aviso en el log. Los videos son opcionales; la música no.

const RAIZ = (process.env.VIDEO_DIR ?? '').trim();

// Solo lo que los teléfonos reproducen sin transcodificar (H.264/AAC en MP4 o MOV). Un
// .mkv o un .avi no aparecen: en iOS no se reproducirían.
const MIME = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
};

// Cada cuánto se rehace el índice. VIDEO_INDEX_TTL_MS existe SOLO para el smoke, que no
// puede esperar un minuto; no se documenta como variable de despliegue.
const TTL_MS = Number(process.env.VIDEO_INDEX_TTL_MS) || 60_000;

if (!RAIZ) {
  console.warn('[videos] VIDEO_DIR sin definir: GET /api/videos responde una lista vacía.');
}

// ID ESTABLE: los 16 primeros hex del sha1 de la ruta RELATIVA, con '/' de separador.
// No es un contador: reiniciar el servidor o agregar un video no cambia los demás ids.
export function idDeRuta(rutaRelativa) {
  return createHash('sha1').update(rutaRelativa).digest('hex').slice(0, 16);
}

// ¿`p` queda DENTRO de `raiz`? (y no es la raíz misma)
function dentro(raiz, p) {
  const rel = relative(raiz, p);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

// "NPR Music Tiny Desk Concert (2017)" → título y año. Sin "(YYYY)" al final, el título es
// el nombre entero y el año queda null.
function tituloYAnio(base) {
  const m = /^(.*?)\s*\((\d{4})\)\s*$/.exec(base);
  return m ? { title: m[1], year: Number(m[2]) } : { title: base, year: null };
}

// La duración la lee music-metadata, que ya es dependencia del escáner. ⚠️ En la 10.9 NO
// sale del `mvhd` de la película sino del `mdhd` de la primera pista de AUDIO
// (lib/mp4/MP4Parser.js): un video sin audio sale con null. Se recuerda por ruta +
// tamaño + fecha, así reconstruir el índice no vuelve a abrir cada archivo. Si no se
// puede leer, null: el video se lista igual.
const duraciones = new Map();

async function duracion(ruta, st) {
  const clave = `${ruta}|${st.size}|${st.mtimeMs}`;
  if (duraciones.has(clave)) return duraciones.get(clave);
  let d = null;
  try {
    const meta = await parseFile(ruta, { skipCovers: true });
    const v = meta.format.duration;
    d = typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
  } catch { /* archivo raro o cortado: sin duración */ }
  duraciones.set(clave, d);
  return d;
}

// Una entrada de un directorio, siguiendo symlinks solo si el destino sigue DENTRO de la
// raíz. Devuelve la ruta real y su stat, o null si hay que ignorarla.
async function resolverEntrada(raizReal, ruta) {
  try {
    const real = await realpath(ruta);
    if (!dentro(raizReal, real)) return null;
    return { real, st: await stat(real) };
  } catch {
    return null;
  }
}

/** Arma el índice desde cero. `raiz` es una carpeta que existe; lanza si no se puede leer. */
export async function construirIndice(raiz) {
  const raizReal = await realpath(resolve(raiz));
  const videos = [];
  const porId = new Map();

  const artistas = await readdir(raizReal, { withFileTypes: true });
  for (const a of artistas) {
    if (a.name.startsWith('.')) continue;
    const carpeta = await resolverEntrada(raizReal, join(raizReal, a.name));
    if (!carpeta || !carpeta.st.isDirectory()) continue;

    const archivos = await readdir(join(raizReal, a.name), { withFileTypes: true });
    for (const f of archivos) {
      if (f.name.startsWith('.')) continue;
      const ext = extname(f.name).toLowerCase();
      const mime = MIME[ext];
      if (!mime) continue;

      const archivo = await resolverEntrada(raizReal, join(raizReal, a.name, f.name));
      if (!archivo || !archivo.st.isFile()) continue;

      const base = f.name.slice(0, -ext.length);
      const rutaRelativa = `${a.name}/${f.name}`;
      const id = idDeRuta(rutaRelativa);
      if (porId.has(id)) {
        console.error(`[videos] ID REPETIDO ${id}: "${rutaRelativa}" choca con "${porId.get(id).rutaRelativa}". Se ignora el segundo.`);
        continue;
      }

      const portada = await resolverEntrada(raizReal, join(raizReal, a.name, `${base}.jpg`));
      const { title, year } = tituloYAnio(base);
      const video = {
        id,
        title,
        artist: a.name,
        year,
        ext: ext.slice(1),
        size: archivo.st.size,
        mime,
        duration: await duracion(archivo.real, archivo.st),
        has_cover: Boolean(portada?.st.isFile()),
        // Lo de abajo NO sale en la API: son rutas del disco.
        rutaRelativa,
        ruta: archivo.real,
        portada: portada?.st.isFile() ? portada.real : null,
      };
      porId.set(id, video);
      videos.push(video);
    }
  }

  // Artista A→Z (sin distinguir mayúsculas ni acentos), luego año del más nuevo al más
  // viejo (sin año al final) y luego título.
  videos.sort((x, y) =>
    x.artist.localeCompare(y.artist, 'es', { sensitivity: 'base' })
    || (y.year ?? -Infinity) - (x.year ?? -Infinity)
    || x.title.localeCompare(y.title, 'es', { sensitivity: 'base' }));

  return { videos, porId };
}

// ---- El índice en memoria ----

const VACIO = { videos: [], porId: new Map() };
let cache = null;          // { indice, armadoEn, mtime }
let enVuelo = null;        // la reconstrucción en curso, si hay una
let avisado = null;        // el último aviso, para no repetirlo en cada petición

function avisar(msg) {
  if (avisado === msg) return;
  avisado = msg;
  console.warn(`[videos] ${msg}`);
}

async function reconstruir() {
  try {
    const st = await stat(RAIZ);
    if (!st.isDirectory()) throw new Error('no es una carpeta');
    const indice = await construirIndice(RAIZ);
    cache = { indice, armadoEn: Date.now(), mtime: st.mtimeMs };
    avisado = null;
  } catch (e) {
    avisar(`no se pudo leer VIDEO_DIR (${RAIZ}): ${e.message}. La lista sale vacía.`);
    cache = { indice: VACIO, armadoEn: Date.now(), mtime: null };
  }
}

function reconstruirUnaVez() {
  enVuelo ??= reconstruir().finally(() => { enVuelo = null; });
  return enVuelo;
}

// Devuelve el índice. La PRIMERA vez espera a armarlo; después devuelve siempre el que
// hay y, si venció (pasó el TTL o cambió el mtime de la carpeta, que cambia cuando se
// agrega un ARTISTA), lo rehace por detrás: una petición nunca espera a que se relean
// los archivos, y nunca corren dos reconstrucciones a la vez.
export async function obtenerIndice() {
  if (!RAIZ) return VACIO;
  if (!cache) {
    await reconstruirUnaVez();
    return cache.indice;
  }
  let mtime = null;
  try { mtime = (await stat(RAIZ)).mtimeMs; } catch { /* la carpeta desapareció */ }
  if (Date.now() - cache.armadoEn > TTL_MS || mtime !== cache.mtime) reconstruirUnaVez();
  return cache.indice;
}

/** ¿El índice que devolvió `obtenerIndice()` es uno bueno? 'ok' si se leyó la carpeta;
 *  'unavailable' sin VIDEO_DIR, o si la última lectura falló. Se llama DESPUÉS de
 *  `await obtenerIndice()`. No cambia nada de lo que devuelve /api/videos: solo deja
 *  distinguir "la carpeta está vacía" de "no se pudo leer", que para las playlists no es
 *  lo mismo (con la carpeta caída, un video guardado no "desapareció"). Una lectura
 *  fallida deja `mtime` en null (ver `reconstruir`), y por eso alcanza con mirarlo. */
export function estadoIndice() {
  if (!RAIZ || !cache) return 'unavailable';
  return cache.mtime === null ? 'unavailable' : 'ok';
}

/** Lo que ve la API de un video: sin rutas del disco. */
export function publico(v) {
  const { rutaRelativa, ruta, portada, ...resto } = v;
  return resto;
}

/** El video de un id, o null. El id se busca SOLO en el índice: nunca se arma una ruta con
 *  lo que manda el cliente. Y la ruta guardada se vuelve a comprobar contra la raíz. */
export async function buscarVideo(id) {
  if (!/^[0-9a-f]{16}$/.test(String(id))) return null;
  const v = (await obtenerIndice()).porId.get(id);
  if (!v) return null;
  try {
    const raizReal = realpathSync(resolve(RAIZ));
    if (!dentro(raizReal, v.ruta)) return null;
    if (v.portada && !dentro(raizReal, v.portada)) return { ...v, portada: null };
  } catch {
    return null;
  }
  return v;
}
