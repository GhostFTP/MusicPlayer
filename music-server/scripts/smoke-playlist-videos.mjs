// Smoke test de los VIDEOS EN PLAYLISTS (1.21.0): GET, POST y DELETE en
// /api/playlists/:id/videos, y la tabla playlist_videos. Desde la 1.21.1, también
// `video_count` en GET /api/playlists y `year` en GET /:id/videos (sección [9b]).
//
// CÓMO SE CORRE
//   npm run smoke:playlist-videos
// No hace falta levantar nada antes: el script levanta SUS PROPIOS servidores, porque la
// carpeta de videos se lee de VIDEO_DIR al arrancar y la de esta prueba es temporal.
//
// CORRE SOBRE UNA BASE Y UNA CARPETA TEMPORALES, como smoke:videos: MUSIC_DB_PATH se pone
// ANTES de importar nada del servidor (db/database.js abre el archivo al evaluarse) y los
// servidores hijos reciben la misma variable. Los usuarios llevan ids desde 900001. Todo
// se borra al terminar, también si algo falla.
//
// TRES SERVIDORES sobre la MISMA base: uno con la carpeta de videos, uno sin VIDEO_DIR y
// uno con una carpeta que no existe. Los dos últimos son el "índice no disponible".
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'sonorarev-plvideos-'));
process.env.MUSIC_DB_PATH = join(dir, 'test.db');
const SECRETO = 'smoke-playlist-videos';
process.env.JWT_SECRET = SECRETO;

const { default: db } = await import('../src/db/database.js');
const { signToken } = await import('../src/auth/jwt.js');
const { idDeRuta } = await import('../src/videos/index.js');

const U = 900001;       // dueño de las playlists
const OTRO = 900002;    // otra cuenta: sus playlists tienen que dar 404

let pass = 0;
let fail = 0;

function check(ok, label, detalle = '') {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FALLA ${label}${detalle ? `  → ${detalle}` : ''}`); }
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Preparación ----

console.log(`[SMOKE-PLAYLIST-VIDEOS] carpeta temporal: ${dir}`);

db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(U, 'smoke-plv', 'x');
db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(OTRO, 'smoke-plv-otro', 'x');
const token = signToken({ id: U, username: 'smoke-plv' });

const crearPlaylist = (id, nombre, dueno = U) =>
  db.prepare('INSERT INTO playlists (id, name, user_id) VALUES (?, ?, ?)').run(id, nombre, dueno);
crearPlaylist(700001, 'Conciertos');
crearPlaylist(700002, 'Llena');
crearPlaylist(700003, 'Para borrar');
crearPlaylist(700004, 'Sin índice');
crearPlaylist(700009, 'Ajena', OTRO);

// La carpeta de videos, con la forma real (Artista/Título (año).ext).
const VIDEOS = join(dir, 'videos');
const ALICIA = 'Alicia Keys/NPR Music Tiny Desk Concert (2020).mp4';
const TYLER = 'Tyler, the Creator/NPR Music Tiny Desk Concert (2017).mp4';
const BORRABLE = 'Tyler, the Creator/Se va (2018).mp4';
const SIN_ANIO = 'Alicia Keys/Ensayo.mp4'; // sin "(AAAA)": disponible, pero sin año
const ID_ALICIA = idDeRuta(ALICIA);
const ID_TYLER = idDeRuta(TYLER);
const ID_BORRABLE = idDeRuta(BORRABLE);
const ID_SIN_ANIO = idDeRuta(SIN_ANIO);
const ID_FANTASMA = 'ffffffffffffffff'; // forma válida, pero no es ningún video

// Un MP4 mínimo con una pista de audio, para que music-metadata saque la duración (125,5 s).
// Es el mismo de smoke:videos.
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
  tkhd.writeUInt32BE(1, 12);
  const mdhd = Buffer.alloc(24);
  mdhd.writeUInt32BE(1000, 12);
  mdhd.writeUInt32BE(125500, 16);
  const hdlr = Buffer.alloc(25);
  hdlr.write('soun', 8, 'latin1');
  const mp4a = Buffer.alloc(28);
  mp4a.writeUInt16BE(1, 6);
  mp4a.writeUInt16BE(2, 16);
  mp4a.writeUInt16BE(16, 18);
  mp4a.writeUInt32BE(44100 * 65536, 24);
  const stsd = Buffer.alloc(8);
  stsd.writeUInt32BE(1, 4);
  const moov = atomo('moov', atomo('trak', atomo('tkhd', tkhd), atomo('mdia',
    atomo('mdhd', mdhd), atomo('hdlr', hdlr), atomo('minf', atomo('stbl', atomo('stsd', stsd, atomo('mp4a', mp4a)))))));
  return Buffer.concat([ftyp, moov]);
}

for (const sub of ['Alicia Keys', 'Tyler, the Creator']) mkdirSync(join(VIDEOS, sub), { recursive: true });
writeFileSync(join(VIDEOS, ALICIA), mp4Minimo());
writeFileSync(join(VIDEOS, 'Alicia Keys/NPR Music Tiny Desk Concert (2020).jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
writeFileSync(join(VIDEOS, TYLER), Buffer.alloc(2000));
writeFileSync(join(VIDEOS, BORRABLE), Buffer.alloc(300));
writeFileSync(join(VIDEOS, SIN_ANIO), Buffer.alloc(100));

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
    await espera(100);
  }
  console.error(`[SMOKE-PLAYLIST-VIDEOS] El servidor "${srv.nombre}" no levantó:\n${srv.salida()}`);
  return false;
}

async function pedir(srv, method, path, { body, tok = token } = {}) {
  const res = await fetch(`${srv.base}${path}`, {
    method,
    headers: {
      ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* no es JSON */ }
  return { status: res.status, data, text };
}

const filas = (pl) => db.prepare('SELECT video_id, position, title, artist FROM playlist_videos WHERE playlist_id = ? ORDER BY position').all(pl);

process.on('exit', () => {
  for (const h of hijos) if (h.exitCode === null) h.kill();
  rmSync(dir, { recursive: true, force: true });
});

const principal = levantar('con videos', '3992', { VIDEO_DIR: VIDEOS, VIDEO_INDEX_TTL_MS: '300' });
const sinVariable = levantar('sin VIDEO_DIR', '3993', {});
const sinCarpeta = levantar('VIDEO_DIR que no existe', '3994', { VIDEO_DIR: join(dir, 'no-existe') });

try {
  const vivos = await Promise.all([listo(principal), listo(sinVariable), listo(sinCarpeta)]);
  if (vivos.includes(false)) throw new Error('algún servidor no levantó');

  // ---- [1] La tabla ----
  console.log('\n[1] la tabla playlist_videos');
  {
    const t = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'playlist_videos'").get();
    check(Boolean(t), 'existe');
    let rechazado = false;
    try { db.prepare('INSERT INTO playlist_videos (playlist_id, video_id, position) VALUES (700001, ?, 1)').run('NO-ES-UN-ID-0000'); }
    catch { rechazado = true; }
    check(rechazado, 'el CHECK rechaza un id que no son 16 hex');
    rechazado = false;
    try { db.prepare('INSERT INTO playlist_videos (playlist_id, video_id, position) VALUES (700001, ?, 1)').run('abc'); }
    catch { rechazado = true; }
    check(rechazado, 'el CHECK rechaza un id corto');
    check(filas(700001).length === 0, 'no quedó nada insertado');
  }

  // ---- [2] Autenticación y dueño ----
  console.log('\n[2] autenticación y playlists ajenas');
  {
    const sin = await pedir(principal, 'GET', '/api/playlists/700001/videos', { tok: null });
    check(sin.status === 401, 'sin token → 401', String(sin.status));
    const g = await pedir(principal, 'GET', '/api/playlists/700009/videos');
    check(g.status === 404 && g.data?.error === 'Playlist not found', 'GET de una ajena → 404', g.text);
    const p = await pedir(principal, 'POST', '/api/playlists/700009/videos', { body: { video_id: ID_ALICIA } });
    check(p.status === 404 && p.data?.error === 'Playlist not found', 'POST a una ajena → 404', p.text);
    const d = await pedir(principal, 'DELETE', `/api/playlists/700009/videos/${ID_ALICIA}`);
    check(d.status === 404, 'DELETE en una ajena → 404', String(d.status));
    const inexistente = await pedir(principal, 'GET', '/api/playlists/123456/videos');
    check(inexistente.status === 404, 'GET de una que no existe → 404', String(inexistente.status));
    check(filas(700009).length === 0, 'la ajena sigue vacía');
  }

  // ---- [3] Lote ----
  console.log('\n[3] POST en lote');
  {
    const r = await pedir(principal, 'POST', '/api/playlists/700001/videos', {
      body: { video_ids: [ID_ALICIA, ID_TYLER, ID_ALICIA, 'no-es-un-id', 42, ID_FANTASMA] },
    });
    check(r.status === 201, 'lote → 201', `${r.status} ${r.text}`);
    check(r.data?.added === 2 && r.data?.already === 0 && r.data?.skipped === 1,
      'added 2 · already 0 · skipped 1 (repetido y formatos malos se descartan antes)', r.text);
    const f = filas(700001);
    check(f.map((x) => x.video_id).join() === `${ID_ALICIA},${ID_TYLER}` && f.map((x) => x.position).join() === '1,2',
      'en el orden pedido, posiciones 1 y 2', JSON.stringify(f));
    check(f[0].title === 'NPR Music Tiny Desk Concert' && f[0].artist === 'Alicia Keys', 'guarda la copia de título y artista', JSON.stringify(f[0]));

    const g = await pedir(principal, 'GET', '/api/playlists/700001/videos');
    check(g.status === 200 && g.data?.index === 'ok', 'GET → 200 con index ok', g.text);
    const [a, t] = g.data?.videos ?? [];
    check(a?.id === ID_ALICIA && a?.available === true && a?.duration === 125.5 && a?.has_cover === true && a?.position === 1,
      'Alicia: disponible, con duración y portada', JSON.stringify(a));
    check(t?.id === ID_TYLER && t?.available === true && t?.size === 2000 && t?.has_cover === false,
      'Tyler: disponible, tamaño 2000 y sin portada', JSON.stringify(t));
    check(a?.year === 2020 && t?.year === 2017, 'year (1.21.1): el del índice, 2020 y 2017', `${a?.year} ${t?.year}`);
    const claves = Object.keys(a ?? {}).sort().join();
    check(claves === 'added_at,artist,available,duration,has_cover,id,position,size,title,year',
      'cada video trae exactamente sus diez campos (y ninguna ruta del disco)', claves);
    check(typeof a?.added_at === 'string' && a.added_at.length > 0, 'added_at viene', String(a?.added_at));

    const otra = await pedir(principal, 'POST', '/api/playlists/700001/videos', { body: { video_ids: [ID_TYLER, ID_BORRABLE] } });
    check(otra.status === 201 && otra.data?.added === 1 && otra.data?.already === 1 && otra.data?.skipped === 0,
      'repetir uno: already 1, y el nuevo entra', otra.text);
    check(filas(700001).map((x) => x.position).join() === '1,2,3', 'el nuevo va al final, en la 3');
  }

  // ---- [4] La forma simple y los errores ----
  console.log('\n[4] POST simple y errores');
  {
    const n = await pedir(principal, 'POST', '/api/playlists/700003/videos', { body: { video_id: ID_TYLER } });
    check(n.status === 201 && n.data?.position === 1, 'simple nuevo → 201 { position: 1 }', `${n.status} ${n.text}`);
    const y = await pedir(principal, 'POST', '/api/playlists/700003/videos', { body: { video_id: ID_TYLER } });
    check(y.status === 200 && y.data?.already === true, 'simple repetido → 200 { already: true }', `${y.status} ${y.text}`);
    const f = await pedir(principal, 'POST', '/api/playlists/700003/videos', { body: { video_id: ID_FANTASMA } });
    check(f.status === 404 && f.data?.error === 'Video not found', 'simple que no está en el índice → 404', `${f.status} ${f.text}`);
    for (const [nombre, body] of [['vacío', {}], ['formato malo', { video_id: 'x' }], ['número', { video_id: 12 }], ['lote vacío', { video_ids: [] }]]) {
      const r = await pedir(principal, 'POST', '/api/playlists/700003/videos', { body });
      check(r.status === 400 && r.data?.error === 'video_id or video_ids required', `${nombre} → 400`, `${r.status} ${r.text}`);
    }
    const muchos = Array.from({ length: 201 }, (_, i) => i.toString(16).padStart(16, '0'));
    const t = await pedir(principal, 'POST', '/api/playlists/700003/videos', { body: { video_ids: muchos } });
    check(t.status === 413 && t.data?.error === 'too many video_ids (max 200)', '201 ids → 413', `${t.status} ${t.text}`);
    const justo = await pedir(principal, 'POST', '/api/playlists/700003/videos', { body: { video_ids: muchos.slice(0, 200) } });
    check(justo.status === 201 && justo.data?.skipped === 200 && justo.data?.added === 0, '200 ids justos pasan el tope (y no están en el índice)', `${justo.status} ${justo.text}`);
    check(filas(700003).length === 1, 'la playlist sigue con su único video');
  }

  // ---- [5] El tope por playlist ----
  console.log('\n[5] tope de 500 por playlist');
  {
    const ins = db.prepare('INSERT INTO playlist_videos (playlist_id, video_id, position, title, artist) VALUES (700002, ?, ?, ?, ?)');
    db.exec('BEGIN');
    for (let i = 0; i < 499; i++) ins.run((i + 1000).toString(16).padStart(16, '0'), i + 1, `Viejo ${i}`, 'Nadie');
    db.exec('COMMIT');
    const dos = await pedir(principal, 'POST', '/api/playlists/700002/videos', { body: { video_ids: [ID_ALICIA, ID_TYLER] } });
    check(dos.status === 409 && dos.data?.error === 'playlist video limit reached (max 500)', '499 + 2 → 409', `${dos.status} ${dos.text}`);
    check(filas(700002).length === 499, 'el 409 no inserta NINGUNO', String(filas(700002).length));
    const uno = await pedir(principal, 'POST', '/api/playlists/700002/videos', { body: { video_id: ID_ALICIA } });
    check(uno.status === 201 && uno.data?.position === 500, '499 + 1 → 201, en la 500', `${uno.status} ${uno.text}`);
    const mas = await pedir(principal, 'POST', '/api/playlists/700002/videos', { body: { video_id: ID_TYLER } });
    check(mas.status === 409, 'con 500, uno más → 409', `${mas.status} ${mas.text}`);
    const repetido = await pedir(principal, 'POST', '/api/playlists/700002/videos', { body: { video_id: ID_ALICIA } });
    check(repetido.status === 200 && repetido.data?.already === true, 'con 500, repetir uno que ya está no cuenta → 200 already', `${repetido.status} ${repetido.text}`);
    const g = await pedir(principal, 'GET', '/api/playlists/700002/videos');
    const ausentes = (g.data?.videos ?? []).filter((v) => v.available === false);
    check(g.data?.videos?.length === 500 && ausentes.length === 499 && ausentes[0].title === 'Viejo 0',
      'GET con 500: los que no están en el índice salen available:false con su título guardado', `${g.data?.videos?.length} ${ausentes.length}`);
    check(ausentes[0].duration === null && ausentes[0].size === null && ausentes[0].has_cover === false,
      'un ausente trae duration y size null y has_cover false', JSON.stringify(ausentes[0]));
    check(ausentes[0].year === null, 'un ausente trae year null (1.21.1)', JSON.stringify(ausentes[0]));
  }

  // ---- [6] DELETE ----
  console.log('\n[6] DELETE');
  {
    const d = await pedir(principal, 'DELETE', `/api/playlists/700001/videos/${ID_TYLER}`);
    check(d.status === 204 && d.text === '', 'quitar uno → 204 sin cuerpo', `${d.status} ${d.text}`);
    check(filas(700001).map((x) => x.video_id).join() === `${ID_ALICIA},${ID_BORRABLE}`, 'quedan los otros dos');
    check(filas(700001).map((x) => x.position).join() === '1,3', 'no se recompactan las posiciones (como /tracks)');
    const otra = await pedir(principal, 'DELETE', `/api/playlists/700001/videos/${ID_TYLER}`);
    check(otra.status === 204, 'quitar uno que ya no está → 204', String(otra.status));
    const basura = await pedir(principal, 'DELETE', '/api/playlists/700001/videos/no-es-un-id');
    check(basura.status === 204, 'quitar un id con forma rara → 204, sin tocar nada', String(basura.status));
    const vuelve = await pedir(principal, 'POST', '/api/playlists/700001/videos', { body: { video_id: ID_TYLER } });
    check(vuelve.status === 201 && vuelve.data?.position === 4, 'volver a agregarlo lo manda al final (4)', `${vuelve.status} ${vuelve.text}`);
  }

  // ---- [7] Un video que desaparece del disco ----
  console.log('\n[7] un video que se borra del disco');
  {
    unlinkSync(join(VIDEOS, BORRABLE));
    // El índice se rehace por detrás al vencer el TTL (300 ms): la primera petición
    // dispara la reconstrucción y la siguiente ya ve el índice nuevo.
    await espera(400);
    await pedir(principal, 'GET', '/api/playlists/700001/videos');
    await espera(300);
    const g = await pedir(principal, 'GET', '/api/playlists/700001/videos');
    const b = (g.data?.videos ?? []).find((v) => v.id === ID_BORRABLE);
    check(g.data?.index === 'ok', 'el índice sigue ok', g.data?.index);
    check(b?.available === false && b?.title === 'Se va' && b?.artist === 'Tyler, the Creator',
      'sale available:false con el título y el artista guardados', JSON.stringify(b));
    check(b?.year === null, 'available:false → year null (la fila no guarda el año)', JSON.stringify(b));
    const a = (g.data?.videos ?? []).find((v) => v.id === ID_ALICIA);
    check(a?.available === true, 'los demás siguen disponibles', JSON.stringify(a));
  }

  // ---- [8] El índice no disponible ----
  console.log('\n[8] índice no disponible');
  db.prepare('INSERT INTO playlist_videos (playlist_id, video_id, position, title, artist) VALUES (700004, ?, 1, ?, ?)')
    .run(ID_ALICIA, 'NPR Music Tiny Desk Concert', 'Alicia Keys');
  for (const srv of [sinVariable, sinCarpeta]) {
    const g = await pedir(srv, 'GET', '/api/playlists/700004/videos');
    const v = g.data?.videos?.[0];
    check(g.status === 200 && g.data?.index === 'unavailable', `${srv.nombre}: GET → 200 con index unavailable`, `${g.status} ${g.text}`);
    check(v?.available === null && v?.title === 'NPR Music Tiny Desk Concert' && v?.duration === null && v?.has_cover === null,
      `${srv.nombre}: el video sale available:null (no se sabe), con su título guardado`, JSON.stringify(v));
    check(v?.year === null, `${srv.nombre}: available:null → year null`, JSON.stringify(v));
    const p = await pedir(srv, 'POST', '/api/playlists/700004/videos', { body: { video_id: ID_TYLER } });
    check(p.status === 503 && p.data?.error === 'video index unavailable', `${srv.nombre}: POST → 503`, `${p.status} ${p.text}`);
    const pl = await pedir(srv, 'POST', '/api/playlists/700004/videos', { body: { video_ids: [ID_TYLER] } });
    check(pl.status === 503, `${srv.nombre}: POST en lote → 503`, `${pl.status} ${pl.text}`);
    check(filas(700004).length === 1, `${srv.nombre}: el 503 no inserta nada`);
    const d = await pedir(srv, 'DELETE', `/api/playlists/700004/videos/${ID_TYLER}`);
    check(d.status === 204, `${srv.nombre}: DELETE sigue andando sin índice`, String(d.status));
  }

  // ---- [9] Lo que NO tiene que cambiar ----
  console.log('\n[9] lo que no cambia');
  {
    const lista = await pedir(principal, 'GET', '/api/playlists');
    const claves = [...new Set((lista.data ?? []).flatMap((p) => Object.keys(p)))].join();
    check(claves === 'id,name,emoji,user_id,created_at,track_count,sample_covers,video_count',
      'GET /api/playlists: los campos de siempre, en su orden, y video_count AL FINAL (1.21.1)', claves);
    const c = (lista.data ?? []).find((p) => p.id === 700001);
    check(c?.track_count === 0, 'los videos no cuentan como pistas (track_count 0)', JSON.stringify(c));
    const v = await pedir(principal, 'GET', '/api/videos');
    check(Object.keys(v.data ?? {}).join() === 'videos' && v.data.videos.length === 3, '/api/videos sigue igual: { videos }, con los 3 que quedan', v.text);
    const tracks = await pedir(principal, 'GET', '/api/playlists/700001/tracks');
    check(tracks.status === 200 && tracks.text === '[]', 'GET /:id/tracks no ve los videos', tracks.text);
  }

  // ---- [9b] video_count y year (1.21.1) ----
  console.log('\n[9b] video_count y year (1.21.1)');
  {
    // Una playlist con 2 CANCIONES y 3 VIDEOS: si video_count fuera otro LEFT JOIN, el GROUP BY
    // multiplicaría las filas y track_count daría 6. Una vacía, para el 0.
    crearPlaylist(700005, 'Mezcla');
    crearPlaylist(700006, 'Vacía');
    const pista = db.prepare('INSERT INTO tracks (id, title, file_path) VALUES (?, ?, ?)');
    pista.run(800001, 'Pista 1', join(dir, 'p1.flac'));
    pista.run(800002, 'Pista 2', join(dir, 'p2.flac'));
    const pt = db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (700005, ?, ?)');
    pt.run(800001, 1); pt.run(800002, 2);
    const r = await pedir(principal, 'POST', '/api/playlists/700005/videos', { body: { video_ids: [ID_ALICIA, ID_TYLER, ID_SIN_ANIO] } });
    check(r.status === 201 && r.data?.added === 3, 'la playlist de prueba recibe 3 videos', `${r.status} ${r.text}`);

    const fila = async (id) => ((await pedir(principal, 'GET', '/api/playlists')).data ?? []).find((p) => p.id === id);
    const m = await fila(700005);
    check(m?.video_count === 3, 'video_count cuenta los videos (3)', JSON.stringify(m));
    check(m?.track_count === 2, 'track_count INTACTO con videos en la playlist (2, no 6)', JSON.stringify(m));
    check(m?.sample_covers === '[]', 'sample_covers igual que antes (las pistas no tienen carátula)', JSON.stringify(m));
    const vacia = await fila(700006);
    check(vacia?.video_count === 0 && vacia?.track_count === 0, 'playlist sin nada → video_count 0 y track_count 0', JSON.stringify(vacia));
    const c1 = await fila(700001);
    check(c1?.video_count === filas(700001).length && c1?.track_count === 0,
      'una playlist solo con videos: video_count = sus filas, track_count 0 (incluye los que ya no existen)', JSON.stringify(c1));

    const d = await pedir(principal, 'DELETE', `/api/playlists/700005/videos/${ID_TYLER}`);
    check(d.status === 204, 'quitar un video → 204', String(d.status));
    const m2 = await fila(700005);
    check(m2?.video_count === 2 && m2?.track_count === 2, 'video_count baja a 2 tras el DELETE; track_count sigue en 2', JSON.stringify(m2));

    const g = await pedir(principal, 'GET', '/api/playlists/700005/videos');
    const sinAnio = (g.data?.videos ?? []).find((v) => v.id === ID_SIN_ANIO);
    check(sinAnio?.available === true && sinAnio?.year === null,
      'disponible sin "(AAAA)" en el nombre → year null', JSON.stringify(sinAnio));
    const conAnio = (g.data?.videos ?? []).find((v) => v.id === ID_ALICIA);
    check(conAnio?.year === 2020, 'disponible con "(2020)" → year 2020', JSON.stringify(conAnio));

    const ajena = await pedir(principal, 'GET', '/api/playlists');
    check(!(ajena.data ?? []).some((p) => p.id === 700009), 'video_count no cambia el filtro por dueño (la ajena no aparece)');
  }

  // ---- [10] Borrar la playlist se lleva sus videos ----
  console.log('\n[10] borrar la playlist');
  {
    check(filas(700003).length === 1, 'antes: tiene un video');
    const d = await pedir(principal, 'DELETE', '/api/playlists/700003');
    check(d.status === 204, 'DELETE de la playlist → 204', String(d.status));
    check(filas(700003).length === 0, 'el ON DELETE CASCADE se llevó sus videos');
  }

  // ---- [11] Un error de la base no tumba el servidor ----
  // Se provoca SIN tocar el código del servidor, desde la conexión de esta prueba:
  //   - renombrar la tabla hace que el SELECT de después del `await` lance "no such
  //     table". En Express 4 un throw así dentro de una ruta async es una promesa
  //     rechazada sin dueño, y Node 22 MATA EL PROCESO (medido);
  //   - tomar el lock de escritura (BEGIN IMMEDIATE) hace que el INSERT del servidor
  //     lance SQLITE_BUSY a mitad de la transacción, que tiene que deshacerse entera.
  console.log('\n[11] errores de la base');
  const vivo = async () => {
    try { return (await fetch(`${principal.base}/api/health`)).ok; } catch { return false; }
  };
  const intento = async (method, path, body) => {
    try { return await pedir(principal, method, path, body !== undefined ? { body } : {}); }
    catch (e) { return { status: `sin respuesta (${e.name})`, data: null, text: '' }; }
  };
  {
    db.exec('ALTER TABLE playlist_videos RENAME TO playlist_videos_fuera');
    try {
      const g = await intento('GET', '/api/playlists/700001/videos');
      check(g.status === 500 && g.data?.error === 'Internal error', 'tabla caída: GET → 500 Internal error', `${g.status} ${g.text}`);
      const p = await intento('POST', '/api/playlists/700001/videos', { video_id: ID_TYLER });
      check(p.status === 500 && p.data?.error === 'Internal error', 'tabla caída: POST → 500 Internal error', `${p.status} ${p.text}`);
      check(await vivo(), 'el servidor sigue vivo después de los dos errores');
    } finally {
      db.exec('ALTER TABLE playlist_videos_fuera RENAME TO playlist_videos');
    }
    // Tyler ya está en la 700001 desde [6]: se saca, para pedir uno que la playlist NO tiene.
    db.prepare('DELETE FROM playlist_videos WHERE playlist_id = 700001 AND video_id = ?').run(ID_TYLER);
    const sinTyler = filas(700001).map((x) => x.video_id).join();
    db.exec('BEGIN IMMEDIATE');
    let q;
    try {
      q = await intento('POST', '/api/playlists/700001/videos', { video_ids: [ID_TYLER] });
    } finally {
      db.exec('ROLLBACK');
    }
    check(q.status === 500 && q.data?.error === 'could not add videos', 'lock tomado: el INSERT falla → 500 could not add videos', `${q.status} ${q.text}`);
    check(filas(700001).map((x) => x.video_id).join() === sinTyler, 'y no quedó nada a medias');
    const r = await intento('POST', '/api/playlists/700001/videos', { video_ids: [ID_TYLER] });
    check(r.status === 201 && r.data?.added === 1, 'soltado el lock, el mismo POST entra (no quedó una transacción abierta)', `${r.status} ${r.text}`);
    check(await vivo(), 'el servidor sigue vivo al final');
  }
} catch (e) {
  fail++;
  console.error('[SMOKE-PLAYLIST-VIDEOS] se cortó:', e);
} finally {
  for (const h of hijos) h.kill();
  await Promise.all(hijos.map((h) => (h.exitCode === null ? new Promise((r) => h.on('exit', r)) : null)));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n[SMOKE-PLAYLIST-VIDEOS] ${pass} ok, ${fail} fallas\n`);
process.exit(fail ? 1 : 0);
