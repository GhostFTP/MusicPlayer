// Smoke del REESCANEO que conserva escuchas (1.25.0): escaneo real con music-metadata sobre FLAC
// REALES generados con ffmpeg (tonos senoidales), base temporal y carpeta temporal. Sin servidor,
// sin mocks de la base y sin tocar la base real.
//
//   npm run smoke:rescan        (necesita ffmpeg en el PATH)
//
// MUSIC_DB_PATH se pone ANTES de importar nada del servidor (db/database.js abre el archivo al
// evaluarse). Los usuarios llevan ids desde 900001. Todo se borra al terminar.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, openSync, readSync, renameSync, rmSync, unlinkSync, writeSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sonorarev-rescan-'));
process.env.MUSIC_DB_PATH = join(dir, 'test.db');
const musica = join(dir, 'musica');
mkdirSync(musica, { recursive: true });

const { default: db } = await import('../src/db/database.js');
const { scanLibrary } = await import('../src/scanner/index.js');
const { huellaDeArchivo } = await import('../src/scanner/huella.js');

let pass = 0;
let fail = 0;
function check(ok, label, detalle = '') {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FALLA ${label}${detalle ? `  → ${detalle}` : ''}`); }
}

// ---- Archivos ----

/** Un FLAC real con ffmpeg: un tono de `freq` Hz, `seg` segundos y estos tags. */
function flac(ruta, freq, seg, tags) {
  mkdirSync(join(ruta, '..'), { recursive: true });
  const meta = Object.entries(tags).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${seg}`,
    ...meta, '-c:a', 'flac', ruta]);
}
/** Pone en ceros el MD5 de STREAMINFO (lo que deja un codificador que no lo calcula). */
function md5EnCeros(ruta) {
  const fd = openSync(ruta, 'r+');
  const cab = Buffer.alloc(4);
  readSync(fd, cab, 0, 4, 0);
  if (cab.toString('latin1') !== 'fLaC') throw new Error('no es FLAC');
  writeSync(fd, Buffer.alloc(16), 0, 16, 26);
  closeSync(fd);
}
const p = (...partes) => join(musica, ...partes);

// ---- Base: un usuario, una playlist ----

const U = 900001;
db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(U, 'smoke-rescan', 'x');
const PL = db.prepare('INSERT INTO playlists (name, user_id) VALUES (?, ?)').run('Mis favoritos', U).lastInsertRowid;

let nCliente = 0;
const escuchar = (trackId, veces = 1) => {
  for (let i = 0; i < veces; i++) {
    db.prepare('INSERT INTO plays (user_id, track_id, played_at, ms_played, client_id) VALUES (?, ?, ?, ?, ?)')
      .run(U, trackId, Date.now() - i * 1000, 90000, `smoke-${++nCliente}`);
  }
};
const idDe = (ruta) => db.prepare('SELECT id FROM tracks WHERE file_path = ?').get(ruta)?.id ?? null;
const playsDe = (id) => db.prepare('SELECT COUNT(*) c FROM plays WHERE track_id = ?').get(id).c;
const posEnPl = (id) => db.prepare('SELECT position FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?').get(PL, id)?.position ?? null;
const enPl = (pos, id) => db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)').run(PL, id, pos);
const cuenta = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;

/** Un escaneo, capturando lo que imprime. */
async function escanear(opts = {}) {
  const lineas = [];
  const [log, warn] = [console.log, console.warn];
  console.log = (...a) => { lineas.push(a.join(' ')); };
  console.warn = (...a) => { lineas.push(a.join(' ')); };
  const w = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  try {
    const r = await scanLibrary(opts.dir ?? musica, { thumbs: false, ...opts });
    return { r, lineas };
  } finally {
    console.log = log; console.warn = warn; process.stdout.write = w;
  }
}

try {
  // ======== 1. Escaneo inicial ========
  console.log('escaneo inicial');
  flac(p('Alb', '01 Uno.flac'), 440, 2, { title: 'Uno', artist: 'A', album: 'Alb', track: 1 });
  flac(p('Alb', '02 Dos.flac'), 550, 2, { title: 'Dos', artist: 'A', album: 'Alb', track: 2 });
  flac(p('Alb', '03 Tres.flac'), 660, 2, { title: 'Tres', artist: 'A', album: 'Alb', track: 3 });
  // Sin md5 (como un archivo cuyo codificador no lo calculó): el caso del RESPALDO.
  flac(p('Viejo', '01 Sin huella.flac'), 700, 2.5, { title: 'Sin huella', artist: 'B', album: 'Viejo', track: 1 });
  md5EnCeros(p('Viejo', '01 Sin huella.flac'));
  // Dos archivos DISTINTOS con la misma duración y formato: el que se borra no tiene que
  // emparejar con el otro.
  flac(p('Gemelas', '01 Una.flac'), 810, 2.5, { title: 'Gemela Una', artist: 'C', album: 'Gemelas', track: 1 });
  flac(p('Gemelas', '02 Otra.flac'), 820, 2.5, { title: 'Gemela Otra', artist: 'C', album: 'Gemelas', track: 2 });
  md5EnCeros(p('Gemelas', '01 Una.flac'));
  md5EnCeros(p('Gemelas', '02 Otra.flac'));
  // La misma canción en su álbum y en una recopilación: el mismo audio (mismo md5).
  flac(p('Original', '01 Hit.flac'), 900, 2, { title: 'Hit', artist: 'D', album: 'Original', track: 1 });
  copyFileSync(p('Original', '01 Hit.flac'), p('Original', '..', 'Hit (copia).flac'));
  mkdirSync(p('Recopilacion'), { recursive: true });
  renameSync(p('Hit (copia).flac'), p('Recopilacion', '05 Hit.flac'));

  const e1 = await escanear();
  check(cuenta('tracks') === 8, 'ocho pistas indexadas', String(cuenta('tracks')));
  const md5Uno = db.prepare('SELECT audio_md5 FROM tracks WHERE id = ?').get(idDe(p('Alb', '01 Uno.flac'))).audio_md5;
  check(/^[0-9a-f]{32}$/.test(md5Uno ?? ''), 'el FLAC de ffmpeg trae su md5 y queda guardado', String(md5Uno));
  check(md5Uno === huellaDeArchivo(p('Alb', '01 Uno.flac')), 'el md5 guardado es el de la cabecera');
  check(db.prepare('SELECT audio_md5 FROM tracks WHERE id = ?').get(idDe(p('Viejo', '01 Sin huella.flac'))).audio_md5 === null,
    'md5 en ceros: audio_md5 null');
  const hitA = idDe(p('Original', '01 Hit.flac'));
  const hitC = idDe(p('Recopilacion', '05 Hit.flac'));
  check(db.prepare('SELECT audio_md5 FROM tracks WHERE id = ?').get(hitA).audio_md5 === db.prepare('SELECT audio_md5 FROM tracks WHERE id = ?').get(hitC).audio_md5,
    'el álbum y la recopilación tienen el mismo md5');
  check(e1.lineas.some((l) => l.includes('[PRUNE] Sin huérfanas.')), 'primer escaneo: sin huérfanas');

  // Escuchas y playlist.
  const uno = idDe(p('Alb', '01 Uno.flac'));
  const dos = idDe(p('Alb', '02 Dos.flac'));
  const tres = idDe(p('Alb', '03 Tres.flac'));
  const sinH = idDe(p('Viejo', '01 Sin huella.flac'));
  const gemUna = idDe(p('Gemelas', '01 Una.flac'));
  escuchar(uno, 5); escuchar(dos, 3); escuchar(tres, 2); escuchar(sinH, 4); escuchar(gemUna, 6); escuchar(hitA, 7);
  enPl(1, dos); enPl(2, uno); enPl(3, sinH); enPl(4, tres);

  // ======== 2. Idempotencia ========
  console.log('\nidempotencia');
  const antes = ['tracks', 'plays', 'playlist_tracks', 'plays_archivo'].map(cuenta);
  const e2 = await escanear();
  const despues = ['tracks', 'plays', 'playlist_tracks', 'plays_archivo'].map(cuenta);
  check(JSON.stringify(antes) === JSON.stringify(despues), 'un segundo escaneo no cambia nada', `${antes} → ${despues}`);
  check(e2.lineas.some((l) => l.includes('[PRUNE] Sin huérfanas.')), 'y no hay huérfanas');
  check(idDe(p('Alb', '01 Uno.flac')) === uno, 'los ids no cambian');

  // ======== 3. Retag sin mover y reemplazo en la misma ruta ========
  console.log('\nmisma ruta');
  const tmpRetag = p('Alb', 'tmp.flac');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', p('Alb', '03 Tres.flac'), '-c', 'copy', '-metadata', 'title=Tres (remaster)', tmpRetag]);
  unlinkSync(p('Alb', '03 Tres.flac'));
  renameSync(tmpRetag, p('Alb', '03 Tres.flac'));
  const md5Tres = db.prepare('SELECT audio_md5 FROM tracks WHERE id = ?').get(tres).audio_md5;
  const e3 = await escanear();
  const filaTres = db.prepare('SELECT id, title, audio_md5 FROM tracks WHERE file_path = ?').get(p('Alb', '03 Tres.flac'));
  check(filaTres.id === tres && filaTres.title === 'Tres (remaster)', 'retag sin mover: misma fila, título nuevo');
  check(filaTres.audio_md5 === md5Tres, 'el retag no cambia el md5 del audio');
  check(playsDe(tres) === 2 && posEnPl(tres) === 4, 'sus escuchas y su lugar en la playlist siguen');
  check(e3.lineas.some((l) => l.includes('[PRUNE] Sin huérfanas.')), 'retag: no hay huérfana');

  flac(p('Alb', '02 Dos.flac'), 1234, 3, { title: 'Dos (otra)', artist: 'A', album: 'Alb', track: 2 });
  const md5DosViejo = huellaDeArchivo(p('Alb', '02 Dos.flac'));
  await escanear();
  const filaDos = db.prepare('SELECT id, audio_md5 FROM tracks WHERE file_path = ?').get(p('Alb', '02 Dos.flac'));
  check(filaDos.id === dos, 'archivo reemplazado en la misma ruta: misma fila (la identidad es la ruta, como antes)');
  check(filaDos.audio_md5 === md5DosViejo, 'y su md5 pasa a ser el del audio nuevo');
  check(playsDe(dos) === 3, 'sus escuchas siguen en esa fila (comportamiento de siempre)');

  // ======== 4. Mover y renombrar ========
  console.log('\nmover y renombrar');
  mkdirSync(p('Nuevo'), { recursive: true });
  renameSync(p('Alb', '01 Uno.flac'), p('Nuevo', '01 - Uno.flac'));               // por md5
  renameSync(p('Viejo', '01 Sin huella.flac'), p('Nuevo', 'Sin huella.flac'));     // sin md5: respaldo
  // Una fila escaneada ANTES de la 1.25.0 (sin md5 en la base) cuyo archivo se mueve antes del
  // primer escaneo nuevo: la vieja no tiene md5, así que solo la cubre el respaldo.
  db.prepare('UPDATE tracks SET audio_md5 = NULL WHERE id = ?').run(dos);
  renameSync(p('Alb', '02 Dos.flac'), p('Nuevo', '02 Dos.flac'));                   // fila vieja sin md5: respaldo
  unlinkSync(p('Gemelas', '01 Una.flac'));                                          // borrada: archiva
  renameSync(p('Original', '01 Hit.flac'), p('Nuevo', 'Hit.flac'));                 // ambiguo: archiva
  const e4 = await escanear();
  const unoN = idDe(p('Nuevo', '01 - Uno.flac'));
  const sinHN = idDe(p('Nuevo', 'Sin huella.flac'));
  const hitN = idDe(p('Nuevo', 'Hit.flac'));
  check(unoN && unoN !== uno && idDe(p('Alb', '01 Uno.flac')) === null, 'el archivo movido es otra fila y la vieja se borró');
  check(playsDe(unoN) === 5, 'por md5: las 5 escuchas pasaron a la fila nueva', String(playsDe(unoN)));
  check(posEnPl(unoN) === 2, 'y conserva su posición en la playlist (2)', String(posEnPl(unoN)));
  check(playsDe(sinHN) === 4 && posEnPl(sinHN) === 3, 'sin md5, por el respaldo (duración + título): escuchas y posición movidas');
  const dosN = idDe(p('Nuevo', '02 Dos.flac'));
  check(playsDe(dosN) === 3 && posEnPl(dosN) === 1, 'fila de antes de la 1.25.0 (sin md5) movida: el respaldo la cubre');
  check(playsDe(hitN) === 0 && playsDe(hitC) === 0, 'mismo md5 en álbum y recopilación: NO se reasigna a ninguna');
  check(playsDe(gemUna) === 0 && idDe(p('Gemelas', '02 Otra.flac')) !== null && playsDe(idDe(p('Gemelas', '02 Otra.flac'))) === 0,
    'la gemela borrada NO empareja con la otra (misma duración, otro título)');
  const arch = db.prepare('SELECT track_id_viejo, COUNT(*) c, MAX(title) t FROM plays_archivo GROUP BY track_id_viejo').all();
  const archDe = (id) => arch.find((a) => a.track_id_viejo === id);
  check(archDe(hitA)?.c === 7 && archDe(hitA)?.t === 'Hit', 'las 7 escuchas del Hit ambiguo quedaron archivadas, con su título');
  check(archDe(gemUna)?.c === 6 && archDe(gemUna)?.t === 'Gemela Una', 'las 6 de la gemela borrada, archivadas');
  check(!archDe(uno) && !archDe(sinH), 'lo reasignado no se archiva');
  const lineaR = e4.lineas.find((l) => l.includes('[PRUNE] Reasignadas'));
  check(lineaR === '  [PRUNE] Reasignadas: 3 (md5 1 · respaldo 2) · escuchas movidas 12 · filas de playlist movidas 3 · escuchas archivadas 13',
    'la línea [PRUNE] dice lo que pasó', String(lineaR));
  check(e4.lineas.some((l) => l === '  [PRUNE] Huérfanas borradas: 5'), 'y la de borradas: 5, sin filas de playlist perdidas',
    e4.lineas.filter((l) => l.includes('[PRUNE]')).join(' | '));
  check(e4.r.reasignadas === 3 && e4.r.playsArchivadas === 13, 'scanLibrary devuelve los números');

  // ======== 5. La fila nueva YA estaba en la playlist ========
  console.log('\nla fila nueva ya estaba en la playlist');
  renameSync(p('Alb', '03 Tres.flac'), p('Nuevo', '03 Tres.flac'));
  await escanear({ prune: false });                     // crea la fila nueva sin barrer
  const tresN = idDe(p('Nuevo', '03 Tres.flac'));
  enPl(9, tresN);                                       // alguien la agrega a la playlist
  const e5 = await escanear();
  const filasTres = db.prepare('SELECT track_id, position FROM playlist_tracks WHERE playlist_id = ? AND track_id IN (?, ?)').all(PL, tres, tresN);
  check(filasTres.length === 1 && filasTres[0].track_id === tresN && filasTres[0].position === 9,
    'UPDATE OR IGNORE: queda UNA fila (la que ya estaba), sin duplicar', JSON.stringify(filasTres));
  check(playsDe(tresN) === 2, 'las escuchas sí se movieron');
  check(e5.lineas.some((l) => l.includes('(+1 filas de playlist por CASCADE)')), 'la fila vieja se fue por CASCADE y lo dice el log',
    e5.lineas.filter((l) => l.includes('[PRUNE]')).join(' | '));

  // ======== 6. Los guardas ========
  console.log('\nlos guardas');
  const vacio = join(dir, 'vacio');
  mkdirSync(vacio);
  const totalAntes = cuenta('tracks');
  const g1 = await escanear({ dir: vacio });
  check(g1.lineas.some((l) => l.includes('0 archivos hallados: barrido OMITIDO')) && cuenta('tracks') === totalAntes,
    'Guard 1: carpeta vacía → no se borra nada');
  // Guard 2: más de la mitad y más de 10 filas.
  for (let i = 0; i < 12; i++) flac(p('Masivo', `${String(i).padStart(2, '0')}.flac`), 200 + i * 10, 0.5, { title: `M${i}`, album: 'Masivo', track: i + 1 });
  await escanear();
  const total2 = cuenta('tracks');
  // Un montaje PARCIAL: la carpeta de verdad "desaparece" y en su lugar queda una con UN solo
  // archivo. El barrido mira si cada ruta existe en disco, así que casi todo queda huérfano.
  const apagada = join(dir, 'musica-apagada');
  renameSync(musica, apagada);
  mkdirSync(musica);
  copyFileSync(join(apagada, 'Masivo', '00.flac'), join(musica, 'solo.flac'));
  const archAntes = cuenta('plays_archivo');
  const playsAntes = cuenta('plays');
  const g2 = await escanear();
  check(g2.lineas.some((l) => l.includes('[PRUNE] ABORTADO')), 'Guard 2: barrido masivo → ABORTADO',
    g2.lineas.filter((l) => l.includes('[PRUNE]')).join(' | '));
  check(cuenta('tracks') === total2 + 1 && cuenta('plays_archivo') === archAntes && cuenta('plays') === playsAntes,
    'y no se borró, reasignó ni archivó nada');
  rmSync(musica, { recursive: true, force: true });
  renameSync(apagada, musica);
} finally {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${pass} ok · ${fail} fallas`);
if (fail) process.exit(1);
