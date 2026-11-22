// Smoke de GET /api/browse/artists: la lista de artistas con su foto (has_image), después de
// quitarle el bloqueo del event loop (una consulta por artista → una sola; existsSync → access).
//
// CÓMO SE CORRE
//   node scripts/smoke-browse-artists.mjs        (desde music-server/)   ·   npm run smoke:browse-artists
// No levanta el servidor entero: monta el router de browse en un express propio, en un puerto
// libre (listen(0)), dentro de este proceso, como smoke-servidor.mjs. No usa 3000, 3100 ni 4173.
//
// CORRE SOBRE UNA BASE Y UNA BIBLIOTECA TEMPORALES: MUSIC_DB_PATH, MUSIC_DIR y VIDEO_DIR se ponen
// ANTES de importar nada del servidor. Las carpetas y las fotos son archivos de prueba (no hay
// audio de verdad). Todo se borra al terminar, también si algo falla.
//
// QUÉ FIJA
//   [1] la respuesta EXACTA (texto: mismo orden de claves y de elementos) con los casos borde:
//       foto .jpg/.png/.webp, sin carátula, pistas sueltas en la raíz, carpeta bajo un prefijo,
//       tag y carpeta en formas Unicode distintas (NFC/NFD), nombres inseguros, vacíos y nulos,
//       una carpeta con foto y sin pistas, y un artista que solo tiene videos;
//   [2] has_image dice lo mismo que /image para cada artista (las dos búsquedas son la misma);
//   [3] el número de consultas NO crece con los artistas (era una por artista);
//   [4] existe idx_tracks_album_artist y la consulta por artista lo usa;
//   [5] el orden de la respuesta no depende de qué consulta al disco termina primero;
//   [6] las consultas al disco van con concurrencia acotada (≤ 4 a la vez) y en paralelo;
//   [7] un error adentro es un 500 genérico (handle) y el servidor sigue atendiendo;
//   [8] con el lock de escritura tomado por otro proceso, el arranque NO se cae: se sigue sin
//       índice y el arranque siguiente lo crea.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'sonorarev-artists-'));
const MUSIC = join(dir, 'music');
const VIDEOS = join(dir, 'videos');
process.env.MUSIC_DB_PATH = join(dir, 'test.db');
process.env.MUSIC_DIR = MUSIC;
process.env.VIDEO_DIR = VIDEOS;
process.env.JWT_SECRET = 'smoke-browse-artists';

// El `access` de fs/promises, envuelto para poder contar cuántos hay en vuelo y demorarlos
// (casos [5] y [6]). Es el binding vivo que importa api/browse.js.
const fsp = createRequire(import.meta.url)('node:fs/promises');
const accessReal = fsp.access;
let enVuelo = 0, maxEnVuelo = 0, demora = null;
fsp.access = async (...a) => {
  enVuelo++; maxEnVuelo = Math.max(maxEnVuelo, enVuelo);
  try {
    if (demora) await new Promise((r) => setTimeout(r, demora()));
    return await accessReal(...a);
  } finally { enVuelo--; }
};
syncBuiltinESMExports();

const { default: express } = await import('express');
const { default: db } = await import('../src/db/database.js');
const { signToken } = await import('../src/auth/jwt.js');
const { default: browse } = await import('../src/api/browse.js');

let pass = 0;
let fail = 0;
function check(ok, label, detalle = '') {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FALLA ${label}${detalle ? `  → ${detalle}` : ''}`); }
}

// ---- La biblioteca de prueba ----
const carpeta = (...p) => { mkdirSync(join(MUSIC, ...p), { recursive: true }); return join(MUSIC, ...p); };
const foto = (nombre, ...p) => writeFileSync(join(carpeta(...p), nombre), 'x');
const insU = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
const uid = Number(insU.run('smoke-artists', 'x').lastInsertRowid);
const insT = db.prepare('INSERT INTO tracks (title, artist, album, album_artist, file_path, cover_path) VALUES (?, ?, ?, ?, ?, ?)');
const pista = (aa, rel, cover = 'c.jpg', album = 'Disco') => Number(insT.run('t', aa, album, aa, join(MUSIC, ...rel), cover).lastInsertRowid);

const NFC = 'Motörhead'.normalize('NFC');
const NFD = 'Motörhead'.normalize('NFD');
foto('artist.jpg', 'Alfa');                                  const alfa = pista('Alfa', ['Alfa', 'Disco', '1.flac']);
pista('Alfa', ['Alfa', 'Disco', '2.flac'], null, 'Otro');
foto('artist.jpg', 'Beta');                                  pista('Beta', ['Beta', 'Disco', '1.flac'], null);   // sin carátula
foto('artist.webp', 'Gama');                                 const gama = pista('Gama', ['suelta.flac']);   // suelta en la raíz…
pista('Gama', ['Gama', 'Disco', '2.flac']);                                                                  // …y una en su carpeta
const delta = pista('Delta', ['delta-suelta.flac']);                                                        // solo suelta: sin carpeta
foto('artist.png', 'Musica', 'Épsilon');                     const eps = pista('Épsilon', ['Musica', 'Épsilon', 'Disco', '1.flac']);
foto('artist.jpg', NFC);                                     const moto = pista(NFD, [NFC, 'Disco', '1.flac']);  // tag NFD, carpeta NFC
// Lo mismo bajo un prefijo, como producción (/music/Musica/<Artista>): ahí la carpeta SOLO sale de
// file_path, así que las rutas tienen que agruparse por el album_artist tal cual (bytes), no normalizado.
const BJ_NFC = 'Björk'.normalize('NFC');
const BJ_NFD = 'Björk'.normalize('NFD');
foto('artist.jpg', 'Musica', BJ_NFC);                        const bjork = pista(BJ_NFD, ['Musica', BJ_NFC, 'Disco', '1.flac']);
foto('artist.jpg', 'AC-DC');                                 const acdc = pista('AC/DC', ['AC-DC', 'Disco', '1.flac']);   // nombre inseguro
foto('artist.jpg', 'Puntos..Banda');                         const ptos = pista('Puntos..Banda', ['Puntos..Banda', 'Disco', '1.flac']);
carpeta('Zeta');                                             const zeta = pista('Zeta', ['Zeta', 'Disco', '1.flac']);   // carpeta sin foto
pista('', ['Vacio', 'Disco', '1.flac']);                                                                     // album_artist vacío
insT.run('t', 'Nulo', 'Disco', null, join(MUSIC, 'Nulo', 'Disco', '1.flac'), 'c.jpg');                       // album_artist NULL
foto('artist.jpg', 'Sin Pistas');                                                                            // foto y nada en la base
mkdirSync(join(VIDEOS, 'Solo Video'), { recursive: true });
writeFileSync(join(VIDEOS, 'Solo Video', 'Clip (2020).mp4'), 'x');

const ESPERADA = [   // ORDER BY album_artist COLLATE NOCASE
  { artist: 'AC/DC', album_count: 1, track_count: 1, sample_track_id: acdc, has_image: false },
  { artist: 'Alfa', album_count: 2, track_count: 2, sample_track_id: alfa, has_image: true },
  { artist: 'Beta', album_count: 1, track_count: 1, sample_track_id: null, has_image: true },
  { artist: BJ_NFD, album_count: 1, track_count: 1, sample_track_id: bjork, has_image: true },
  { artist: 'Delta', album_count: 1, track_count: 1, sample_track_id: delta, has_image: false },
  { artist: 'Gama', album_count: 1, track_count: 2, sample_track_id: gama, has_image: true },
  { artist: NFD, album_count: 1, track_count: 1, sample_track_id: moto, has_image: true },
  { artist: 'Puntos..Banda', album_count: 1, track_count: 1, sample_track_id: ptos, has_image: false },
  { artist: 'Zeta', album_count: 1, track_count: 1, sample_track_id: zeta, has_image: false },
  { artist: 'Épsilon', album_count: 1, track_count: 1, sample_track_id: eps, has_image: true },
];

// ---- El servidor ----
const app = express();
let capturado = null;
app.use((req, res, next) => { res.sendFile = (p) => { capturado = p; res.status(200).end(); }; next(); });
app.use('/api/browse', browse);
const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const BASE = `http://127.0.0.1:${server.address().port}/api/browse`;
const H = { Authorization: `Bearer ${signToken({ id: uid, username: 'smoke-artists' })}` };
async function pedir(ruta) {
  const r = await fetch(BASE + ruta, { headers: H, signal: AbortSignal.timeout(5000) });
  return { status: r.status, text: await r.text() };
}
const lista = async () => { const r = await pedir('/artists'); return { ...r, data: r.status === 200 ? JSON.parse(r.text) : null }; };

// Cuenta las consultas que se preparan durante una petición.
const prepareReal = db.prepare.bind(db);
let consultas = 0;
db.prepare = (sql) => { consultas++; return prepareReal(sql); };

try {
  console.log('[SMOKE-ARTISTS] base y biblioteca temporales:', dir);

  console.log('\n[1] la respuesta exacta, con los casos borde');
  {
    const r = await lista();
    check(r.status === 200, 'GET /artists → 200', String(r.status));
    check(r.text === JSON.stringify(ESPERADA), 'el cuerpo es EXACTAMENTE el esperado (claves, valores y orden)', r.text);
    const nombres = (r.data ?? []).map((a) => a.artist);
    check(!nombres.includes('Sin Pistas') && !nombres.includes('Solo Video'), 'ni la carpeta con foto sin pistas ni el artista de solo video aparecen');
    check(!nombres.includes('') && !nombres.includes(null), 'album_artist vacío o NULL no aparecen');
  }

  console.log('\n[2] has_image dice lo mismo que /image');
  {
    const { data } = await lista();
    for (const a of data ?? []) {
      capturado = null;
      const r = await pedir(`/artists/${encodeURIComponent(a.artist)}/image`);
      const tiene = r.status === 200 && capturado !== null;
      check(tiene === a.has_image, `${JSON.stringify(a.artist)}: has_image=${a.has_image} y /image → ${r.status}`);
    }
  }

  console.log('\n[3] las consultas no crecen con los artistas');
  {
    consultas = 0; await lista(); const antes = consultas;
    for (let i = 0; i < 25; i++) pista(`Extra ${i}`, [`Extra ${i}`, 'Disco', '1.flac']);
    consultas = 0; const r = await lista(); const despues = consultas;
    check(r.data?.length === ESPERADA.length + 25, `con 25 artistas más la lista trae ${ESPERADA.length + 25}`, String(r.data?.length));
    check(antes === despues && despues <= 2, `las mismas consultas con ${ESPERADA.length} y con ${ESPERADA.length + 25} artistas (${antes} → ${despues})`);
    db.prepare("DELETE FROM tracks WHERE album_artist LIKE 'Extra %'").run();
  }

  console.log('\n[4] el índice');
  {
    const idx = prepareReal("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_tracks_album_artist'").get();
    check(Boolean(idx), 'existe idx_tracks_album_artist después de abrir la base');
    const plan = prepareReal('EXPLAIN QUERY PLAN SELECT DISTINCT file_path FROM tracks WHERE album_artist = ? AND file_path IS NOT NULL')
      .all('x').map((p) => p.detail).join(' | ');
    check(/USING (COVERING )?INDEX idx_tracks_album_artist/.test(plan), 'la consulta por artista (/image) usa el índice', plan);
  }

  console.log('\n[5] el orden no depende de qué consulta termina primero');
  {
    let k = 0;
    demora = () => [9, 1, 6, 0, 3, 8, 2, 7, 4, 5][k++ % 10];
    const r = await lista();
    demora = null;
    check(r.text === JSON.stringify(ESPERADA), 'con demoras desparejas en el disco, el mismo cuerpo exacto', r.text);
  }

  console.log('\n[6] concurrencia acotada');
  {
    maxEnVuelo = 0;
    demora = () => 2;
    await lista();
    demora = null;
    check(maxEnVuelo >= 2 && maxEnVuelo <= 4, `entre 2 y 4 consultas al disco a la vez (fueron ${maxEnVuelo})`);
  }

  console.log('\n[7] un error adentro es un 500 genérico y el servidor sigue');
  {
    const errorAntes = console.error;
    const logs = [];
    console.error = (...a) => logs.push(a.map(String).join(' '));
    db.prepare = (sql) => { if (/GROUP BY album_artist/.test(sql)) throw new Error('falla de prueba'); return prepareReal(sql); };
    const r = await pedir('/artists').catch((e) => ({ status: 'sin respuesta', text: e.message }));
    db.prepare = (sql) => { consultas++; return prepareReal(sql); };
    console.error = errorAntes;
    check(r.status === 500 && r.text === JSON.stringify({ error: 'Internal error' }), '→ 500 { error: "Internal error" }', `${r.status} ${r.text}`);
    check(!r.text.includes('falla de prueba'), 'el mensaje interno no sale en la respuesta');
    check(logs.some((l) => l.includes('[api]')), 'queda en el log como [api]');
    const otra = await lista();
    check(otra.status === 200 && otra.text === JSON.stringify(ESPERADA), 'la petición siguiente responde normal');
  }

  console.log('\n[8] arranque con el lock de escritura tomado por otro proceso');
  {
    // Una copia de la base SIN el índice, como una base de producción antes de este cambio.
    const base2 = join(dir, 'arranque.db');
    prepareReal('PRAGMA wal_checkpoint(TRUNCATE)').get();
    copyFileSync(process.env.MUSIC_DB_PATH, base2);
    {
      const { DatabaseSync } = await import('node:sqlite');
      const d = new DatabaseSync(base2); d.exec('DROP INDEX idx_tracks_album_artist'); d.close();
    }
    const abrir = (ruta) => spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', `
      process.env.MUSIC_DB_PATH = ${JSON.stringify(ruta)};
      const { default: db } = await import(${JSON.stringify(pathToFileURL(fileURLToPath(new URL('../src/db/database.js', import.meta.url))).href)});
      const i = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_tracks_album_artist'").get();
      console.log(i ? 'CON-INDICE' : 'SIN-INDICE');`], { encoding: 'utf8' });
    const lock = spawn(process.execPath, ['--no-warnings', '-e', `
      const { DatabaseSync } = require('node:sqlite');
      const d = new DatabaseSync(${JSON.stringify(base2)});
      d.exec('BEGIN IMMEDIATE'); d.exec('UPDATE tracks SET title = title WHERE id = 1');
      process.stdout.write('tomado\\n');
      process.stdin.once('data', () => { d.exec('COMMIT'); d.close(); });`], { stdio: ['pipe', 'pipe', 'inherit'] });
    await new Promise((r) => lock.stdout.once('data', r));
    const a = abrir(base2);
    lock.stdin.end('\n');   // end y no write: con stdin abierto el hijo no termina nunca
    await new Promise((r) => lock.on('exit', r));
    check(a.status === 0, 'con el lock tomado, la base abre y el proceso termina bien', `exit ${a.status} ${a.stderr}`);
    check(a.stdout.includes('SIN-INDICE') && /\[migración\] no se pudo crear idx_tracks_album_artist/.test(a.stdout + a.stderr),
      'sigue sin índice y lo avisa en el log', (a.stdout + a.stderr).trim());
    const b = abrir(base2);
    check(b.status === 0 && b.stdout.includes('CON-INDICE'), 'sin el lock, el arranque siguiente lo crea', (b.stdout + b.stderr).trim());
  }
} catch (e) {
  fail++;
  console.error('[SMOKE-ARTISTS] se cortó:', e);
} finally {
  db.prepare = prepareReal;
  fsp.access = accessReal; syncBuiltinESMExports();
  await new Promise((r) => server.close(r));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n[SMOKE-ARTISTS] ${pass} ok, ${fail} fallas\n`);
process.exit(fail ? 1 : 0);
