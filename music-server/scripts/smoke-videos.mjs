// Smoke test de los VIDEOS (GET /api/videos, su portada y GET /stream/video/:id) y, antes,
// del stream de AUDIO (GET /stream/:id), que comparte con el de video el manejo de Range.
//
// CÓMO SE CORRE
//   npm run smoke:videos
// No hace falta levantar nada antes: el script levanta SU PROPIO servidor, porque la
// carpeta de videos se lee de VIDEO_DIR al arrancar y la de esta prueba es temporal.
//
// CORRE SOBRE UNA BASE Y UNA CARPETA TEMPORALES, como smoke:google: MUSIC_DB_PATH se pone
// ANTES de importar nada del servidor (db/database.js abre el archivo al evaluarse) y el
// servidor hijo recibe la misma variable. El usuario y el track de prueba llevan id
// 900001, alto a propósito, como los smokes de la 1.19. Todo se borra al terminar, también
// si algo falla.
//
// POR QUÉ EL AUDIO ESTÁ ACÁ: el stream de video reutiliza la autenticación y el manejo de
// Range del de audio (src/stream/stream.js). Estos casos son la línea base de ese archivo:
// tienen que dar lo mismo antes y después de cualquier cambio ahí.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'sonorarev-videos-'));
process.env.MUSIC_DB_PATH = join(dir, 'test.db');
// El MISMO secreto que el servidor hijo, y antes de importar: auth/jwt.js lo lee al
// evaluarse.
const SECRETO = 'smoke-videos';
process.env.JWT_SECRET = SECRETO;

const { default: db } = await import('../src/db/database.js');
const { signToken } = await import('../src/auth/jwt.js');
const { construirIndice, idDeRuta } = await import('../src/videos/index.js');

const PORT = '3995';
const BASE = `http://localhost:${PORT}`; // el servidor principal
const ID = 900001;

let pass = 0;
let fail = 0;

function check(ok, label, detalle = '') {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FALLA ${label}${detalle ? `  → ${detalle}` : ''}`); }
}

// Bytes conocidos: el byte i vale i % 256, así un rango se puede comparar byte a byte.
function bytes(n) {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) b[i] = i % 256;
  return b;
}

async function get(path, { token, range } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(range ? { Range: range } : {}),
    },
  });
  const body = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, body };
}

// ---- Preparación ----

console.log(`[SMOKE-VIDEOS] carpeta temporal: ${dir}`);

const AUDIO = bytes(1000);
const audioPath = join(dir, 'pista.flac');
writeFileSync(audioPath, AUDIO);

db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(ID, 'smoke-videos', 'x');
db.prepare('INSERT INTO tracks (id, title, file_path, mime_type) VALUES (?, ?, ?, ?)')
  .run(ID, 'pista de prueba', audioPath, 'audio/flac');
const token = signToken({ id: ID, username: 'smoke-videos' });

// La carpeta de videos, con la forma real (Artista/Título (año).ext) y nombres con comas,
// puntos y paréntesis. Lo que NO tiene que aparecer: el .mkv, el .txt, el oculto y el
// suelto en la raíz. Afuera de la carpeta, un archivo que nadie tiene que poder leer.
const VIDEOS = join(dir, 'videos');
const ALICIA = 'Alicia Keys/NPR Music Tiny Desk Concert (2020).mp4';
const TYLER = 'Tyler, the Creator/NPR Music Tiny Desk Concert (2017).mp4';
const PAAK = 'Anderson .Paak/Live (2016).mov';
const NUEVO = 'Alicia Keys/Nuevo (2026).mp4';
const VIDEO = bytes(2000);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), bytes(60)]);

// Un MP4 MÍNIMO con cabecera de verdad y UNA pista de audio AAC sin muestras. Así lo lee
// music-metadata 10.9: la duración NO sale del `mvhd` de la película sino del `mdhd` de la
// primera pista de AUDIO (MP4Parser.js, al cerrar el parseo). Un video sin pista de audio
// saldría con duration null. Escala 1000, duración 125500 → 125,5 s.
function mp4Minimo() {
  const atomo = (tipo, ...cuerpo) => {
    const b = Buffer.concat(cuerpo);
    const h = Buffer.alloc(8);
    h.writeUInt32BE(8 + b.length, 0);
    h.write(tipo, 4, 'latin1');
    return Buffer.concat([h, b]);
  };
  const ftyp = atomo('ftyp', Buffer.from('isom'), Buffer.from([0, 0, 2, 0]), Buffer.from('isommp41'));
  const tkhd = Buffer.alloc(84);
  tkhd.writeUInt32BE(1, 12);                 // track_ID
  const mdhd = Buffer.alloc(24);
  mdhd.writeUInt32BE(1000, 12);              // escala
  mdhd.writeUInt32BE(125500, 16);            // duración
  const hdlr = Buffer.alloc(25);
  hdlr.write('soun', 8, 'latin1');           // es una pista de sonido
  const mp4a = Buffer.alloc(28);
  mp4a.writeUInt16BE(1, 6);                  // data_reference_index
  mp4a.writeUInt16BE(2, 16);                 // canales
  mp4a.writeUInt16BE(16, 18);                // bits por muestra
  mp4a.writeUInt32BE(44100 * 65536, 24);     // frecuencia (16.16)
  const stsd = Buffer.alloc(8);
  stsd.writeUInt32BE(1, 4);                  // una entrada
  const moov = atomo('moov', atomo('trak', atomo('tkhd', tkhd), atomo('mdia',
    atomo('mdhd', mdhd), atomo('hdlr', hdlr), atomo('minf', atomo('stbl', atomo('stsd', stsd, atomo('mp4a', mp4a)))))));
  return Buffer.concat([ftyp, moov]);
}

for (const sub of ['Alicia Keys', 'Tyler, the Creator', 'Anderson .Paak']) mkdirSync(join(VIDEOS, sub), { recursive: true });
writeFileSync(join(VIDEOS, ALICIA), mp4Minimo());
writeFileSync(join(VIDEOS, 'Alicia Keys/NPR Music Tiny Desk Concert (2020).jpg'), JPG);
writeFileSync(join(VIDEOS, TYLER), VIDEO);
writeFileSync(join(VIDEOS, PAAK), bytes(500));
writeFileSync(join(VIDEOS, 'Tyler, the Creator/Algo (2019).mkv'), bytes(100));
writeFileSync(join(VIDEOS, 'Tyler, the Creator/notas.txt'), 'notas');
writeFileSync(join(VIDEOS, 'Tyler, the Creator/.oculto.mp4'), bytes(100));
writeFileSync(join(VIDEOS, 'suelto.mp4'), bytes(100));
writeFileSync(join(dir, 'secreto.txt'), 'SECRETO-NO-SE-LEE');

// El entorno del hijo se arma a mano, borrando lo que cambia la prueba.
const env = { ...process.env };
for (const k of ['GOOGLE_IOS_CLIENT_ID', 'GOOGLE_FAKE', 'CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD', 'PORT', 'VIDEO_DIR']) delete env[k];
const hijos = [];

function levantar(nombre, port, extra) {
  const hijo = spawn(process.execPath, ['server.js'], {
    cwd: RAIZ,
    env: { ...env, NODE_ENV: 'development', JWT_SECRET: SECRETO, MUSIC_DB_PATH: process.env.MUSIC_DB_PATH, PORT: port, ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let salida = '';
  hijo.stdout.on('data', (d) => { salida += d; });
  hijo.stderr.on('data', (d) => { salida += d; });
  hijos.push(hijo);
  return { nombre, hijo, base: `http://localhost:${port}`, salida: () => salida };
}

async function listo(srv) {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${srv.base}/api/health`);
      if (r.ok) return true;
    } catch { /* todavía no escucha */ }
    if (srv.hijo.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  console.error(`[SMOKE-VIDEOS] El servidor "${srv.nombre}" no levantó:\n${srv.salida()}`);
  return false;
}

// Si el script se cae por cualquier lado, igual se apagan los servidores y se borra la
// carpeta temporal (el `finally` de abajo cubre el caso normal).
process.on('exit', () => {
  for (const h of hijos) if (h.exitCode === null) h.kill();
  rmSync(dir, { recursive: true, force: true });
});

const principal = levantar('con videos', PORT, {
  VIDEO_DIR: VIDEOS,
  // El índice se rehace a los 300 ms y no al minuto, para poder probar que un video
  // nuevo aparece solo.
  VIDEO_INDEX_TTL_MS: '300',
});
const sinVariable = levantar('sin VIDEO_DIR', '3996', {});
const sinCarpeta = levantar('VIDEO_DIR que no existe', '3997', { VIDEO_DIR: join(dir, 'no-existe') });

try {
  const vivos = await Promise.all([listo(principal), listo(sinVariable), listo(sinCarpeta)]);
  if (vivos.includes(false)) throw new Error('algún servidor no levantó');

  // ---- [1] Audio: GET /stream/:id ----

  console.log('\n[1] stream de audio');
  {
    const r = await get(`/stream/${ID}`, { token });
    check(r.status === 200, 'sin Range → 200', String(r.status));
    check(r.headers.get('content-length') === '1000', 'Content-Length 1000', r.headers.get('content-length'));
    check(r.headers.get('accept-ranges') === 'bytes', 'Accept-Ranges: bytes', r.headers.get('accept-ranges'));
    check(r.headers.get('content-type') === 'audio/flac', 'Content-Type audio/flac', r.headers.get('content-type'));
    check(r.body.equals(AUDIO), 'el cuerpo es el archivo entero');
  }
  {
    const r = await get(`/stream/${ID}?token=${encodeURIComponent(token)}`);
    check(r.status === 200, 'con ?token= → 200', String(r.status));
  }
  {
    const r = await get(`/stream/${ID}`, { token, range: 'bytes=10-19' });
    check(r.status === 206, 'Range 10-19 → 206', String(r.status));
    check(r.headers.get('content-range') === 'bytes 10-19/1000', 'Content-Range bytes 10-19/1000', r.headers.get('content-range'));
    check(r.headers.get('content-length') === '10', 'Content-Length 10', r.headers.get('content-length'));
    check(r.body.equals(AUDIO.subarray(10, 20)), 'el cuerpo son esos 10 bytes');
  }
  {
    const r = await get(`/stream/${ID}`, { token, range: 'bytes=990-' });
    check(r.status === 206, 'Range 990- (abierto) → 206', String(r.status));
    check(r.headers.get('content-range') === 'bytes 990-999/1000', 'Content-Range bytes 990-999/1000', r.headers.get('content-range'));
    check(r.body.equals(AUDIO.subarray(990)), 'el cuerpo son los últimos 10 bytes');
  }
  {
    const r = await get(`/stream/${ID}`, { token, range: 'bytes=5000-6000' });
    check(r.status === 416, 'Range fuera del archivo → 416', String(r.status));
    check(r.headers.get('content-range') === 'bytes */1000', 'Content-Range bytes */1000', r.headers.get('content-range'));
  }
  {
    const r = await get(`/stream/${ID}`);
    check(r.status === 401, 'sin token → 401', String(r.status));
  }
  {
    const r = await get('/stream/987654321', { token });
    check(r.status === 404, 'id inexistente → 404', String(r.status));
  }

  // ---- [2] La lista ----

  console.log('\n[2] GET /api/videos');
  const idAlicia = idDeRuta(ALICIA);
  const idTyler = idDeRuta(TYLER);
  const idPaak = idDeRuta(PAAK);
  const lista = async (t) => fetch(`${BASE}/api/videos`, t ? { headers: { Authorization: `Bearer ${t}` } } : {});
  {
    const r = await lista(token);
    const data = await r.json();
    check(r.status === 200, '→ 200', String(r.status));
    const vs = data?.videos ?? [];
    check(vs.length === 3, 'solo los 3 videos (ni .mkv, ni .txt, ni oculto, ni suelto)', JSON.stringify(vs.map((v) => v.title)));
    check(vs.map((v) => v.artist).join('|') === 'Alicia Keys|Anderson .Paak|Tyler, the Creator',
      'orden por artista A→Z', vs.map((v) => v.artist).join('|'));
    const a = vs.find((v) => v.id === idAlicia);
    check(a?.title === 'NPR Music Tiny Desk Concert' && a?.year === 2020 && a?.artist === 'Alicia Keys',
      'título, año y artista salen de la carpeta y del nombre', JSON.stringify(a));
    check(a?.ext === 'mp4' && a?.mime === 'video/mp4' && a?.has_cover === true, 'ext, mime y portada', JSON.stringify(a));
    check(a?.duration === 125.5, 'duración leída del MP4 (125,5 s)', String(a?.duration));
    const t = vs.find((v) => v.id === idTyler);
    check(t?.size === 2000 && t?.has_cover === false && t?.duration === null,
      'Tyler: tamaño, sin portada y sin duración (bytes de relleno)', JSON.stringify(t));
    const p = vs.find((v) => v.id === idPaak);
    check(p?.mime === 'video/quicktime' && p?.year === 2016, '.mov → video/quicktime', JSON.stringify(p));
    const texto = JSON.stringify(data);
    check(!texto.includes('sonorarev-videos-'), 'la respuesta no trae rutas del disco');
    check(vs.every((v) => !('ruta' in v) && !('portada' in v) && !('rutaRelativa' in v)), 'ni campos internos');
  }
  {
    const r = await lista();
    check(r.status === 401, 'sin token → 401', String(r.status));
  }
  {
    const i1 = await construirIndice(VIDEOS);
    const i2 = await construirIndice(VIDEOS);
    const ids = (i) => i.videos.map((v) => v.id).join(',');
    check(ids(i1) === ids(i2) && i1.porId.has(idAlicia), 'id estable entre dos reconstrucciones (y = sha1 de la ruta)', `${ids(i1)} / ${ids(i2)}`);
  }

  // ---- [3] Portada ----

  console.log('\n[3] GET /api/videos/:id/cover');
  {
    const r = await get(`/api/videos/${idAlicia}/cover`, { token });
    check(r.status === 200, 'con portada → 200', String(r.status));
    check(r.headers.get('content-type') === 'image/jpeg', 'Content-Type image/jpeg', r.headers.get('content-type'));
    check(/max-age=\d+/.test(r.headers.get('cache-control') ?? ''), 'con Cache-Control', r.headers.get('cache-control'));
    check(r.body.equals(JPG), 'el cuerpo es el .jpg');
  }
  {
    const r = await get(`/api/videos/${idTyler}/cover`, { token });
    check(r.status === 404, 'sin portada → 404', String(r.status));
  }
  {
    const r = await get(`/api/videos/${idAlicia}/cover?token=${encodeURIComponent(token)}`);
    check(r.status === 200, 'con ?token= (para <img>) → 200', String(r.status));
  }
  {
    const r = await get(`/api/videos/${idAlicia}/cover`);
    check(r.status === 401, 'sin token → 401', String(r.status));
  }

  // ---- [4] Stream de video ----

  console.log('\n[4] GET /stream/video/:id');
  {
    const r = await get(`/stream/video/${idTyler}`, { token });
    check(r.status === 200, 'sin Range → 200', String(r.status));
    check(r.headers.get('content-type') === 'video/mp4', 'Content-Type video/mp4', r.headers.get('content-type'));
    check(r.headers.get('accept-ranges') === 'bytes', 'Accept-Ranges: bytes', r.headers.get('accept-ranges'));
    check(r.body.equals(VIDEO), 'el cuerpo es el archivo entero');
  }
  {
    const r = await get(`/stream/video/${idTyler}`, { token, range: 'bytes=100-199' });
    check(r.status === 206, 'Range 100-199 → 206', String(r.status));
    check(r.headers.get('content-range') === 'bytes 100-199/2000', 'Content-Range bytes 100-199/2000', r.headers.get('content-range'));
    check(r.body.equals(VIDEO.subarray(100, 200)), 'el cuerpo son esos 100 bytes');
  }
  {
    const r = await get(`/stream/video/${idTyler}`, { token, range: 'bytes=3000-' });
    check(r.status === 416, 'Range fuera del archivo → 416', String(r.status));
    check(r.headers.get('content-range') === 'bytes */2000', 'Content-Range bytes */2000', r.headers.get('content-range'));
  }
  {
    const r = await get(`/stream/video/${idPaak}`, { token });
    check(r.headers.get('content-type') === 'video/quicktime', '.mov → Content-Type video/quicktime', r.headers.get('content-type'));
  }
  {
    const r = await get(`/stream/video/${idTyler}`);
    check(r.status === 401, 'sin token → 401', String(r.status));
  }
  {
    const r = await get('/stream/video/0123456789abcdef', { token });
    check(r.status === 404, 'id con formato válido pero desconocido → 404', String(r.status));
  }

  // ---- [5] Path traversal ----

  console.log('\n[5] ids que intentan salir de la carpeta');
  const malos = [
    '..%2Fsecreto.txt',
    '..%2F..%2Fsecreto.txt',
    '%2e%2e%2fsecreto.txt',
    '%252e%252e%252fsecreto.txt',
    '..%5Csecreto.txt',
    encodeURIComponent(join(dir, 'secreto.txt')),
    encodeURIComponent(TYLER),
    '..',
  ];
  for (const m of malos) {
    for (const ruta of [`/stream/video/${m}`, `/api/videos/${m}/cover`]) {
      const r = await get(ruta, { token });
      const cuerpo = r.body.toString('latin1');
      check(r.status === 404 && !cuerpo.includes('SECRETO'), `${ruta.slice(0, 60)} → 404 sin leer afuera`, `${r.status} ${cuerpo.slice(0, 60)}`);
    }
  }

  // ---- [6] Un video nuevo aparece solo ----

  console.log('\n[6] subir un video sin reiniciar ni escanear');
  {
    writeFileSync(join(VIDEOS, NUEVO), bytes(300));
    await new Promise((r) => setTimeout(r, 400));
    await lista(token); // devuelve el índice viejo y dispara la reconstrucción por detrás
    await new Promise((r) => setTimeout(r, 300));
    const data = await (await lista(token)).json();
    const ids = (data?.videos ?? []).map((v) => v.id);
    check(ids.includes(idDeRuta(NUEVO)) && ids.length === 4, 'el nuevo aparece en la lista', JSON.stringify(ids));
    check(ids.includes(idAlicia) && ids.includes(idTyler) && ids.includes(idPaak), 'y los ids de los demás no cambiaron');
  }

  // ---- [7] Sin carpeta de videos, el servidor sigue andando ----

  console.log('\n[7] VIDEO_DIR sin definir o inexistente');
  for (const srv of [sinVariable, sinCarpeta]) {
    const r = await fetch(`${srv.base}/api/videos`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await r.json().catch(() => null);
    check(r.status === 200 && Array.isArray(data?.videos) && data.videos.length === 0,
      `${srv.nombre}: arranca y la lista sale vacía`, `${r.status} ${JSON.stringify(data)}`);
    const audio = await fetch(`${srv.base}/stream/${ID}`, { headers: { Authorization: `Bearer ${token}` } });
    check(audio.status === 200, `${srv.nombre}: el audio sigue andando`, String(audio.status));
    await audio.arrayBuffer();
  }
  check(/VIDEO_DIR sin definir/.test(sinVariable.salida()), 'sin VIDEO_DIR: queda el aviso en el log');
  check(/no se pudo leer VIDEO_DIR/.test(sinCarpeta.salida()), 'carpeta inexistente: queda el aviso en el log');
} catch (e) {
  fail++;
  console.error('[SMOKE-VIDEOS] se cortó:', e);
} finally {
  for (const h of hijos) h.kill();
  await Promise.all(hijos.map((h) => (h.exitCode === null ? new Promise((r) => h.on('exit', r)) : null)));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n[SMOKE-VIDEOS] ${pass} ok, ${fail} fallas\n`);
process.exit(fail ? 1 : 0);
