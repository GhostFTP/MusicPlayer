// Smoke del CONTRATO de los 404 de las pistas de una playlist (hallazgo de la playlist 14, v1.43.0).
//
// CÓMO SE CORRE
//   node scripts/smoke-playlist-404.mjs        (desde music-server/)
// Levanta SU PROPIO servidor (puerto 3994) sobre una BASE TEMPORAL, como smoke-renovar.mjs:
// MUSIC_DB_PATH y JWT_SECRET se ponen ANTES de importar nada del servidor.
//
// QUÉ FIJA. El web (music-client/src/utils/playlistActions.js, motivoFalloAgregar) decide el aviso
// por el CUERPO del 404, así que ese cuerpo es contrato:
//   · POST /api/playlists/:id/tracks con UN id que no está en `tracks` → 404 { error: 'Track not found' }
//     (la playlist sí es tuya: un reescaneo le cambió el id a la pista);
//   · la playlist no existe o es de OTRA cuenta → 404 { error: 'Playlist not found' }, en GET, POST y DELETE;
//   · una pista borrada que ya estaba en la playlist NO hace fallar el GET (el JOIN la omite).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'sonorarev-pl404-'));
process.env.MUSIC_DB_PATH = join(dir, 'test.db');
const SECRETO = 'smoke-playlist-404';
process.env.JWT_SECRET = SECRETO;

const { default: db } = await import('../src/db/database.js');

const PUERTO = '3994';
const BASE = `http://localhost:${PUERTO}`;

let pass = 0;
let fail = 0;
function check(ok, label, detalle = '') {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FALLA ${label}${detalle ? `  → ${detalle}` : ''}`); }
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- El servidor ----
const env = { ...process.env };
for (const k of ['GOOGLE_IOS_CLIENT_ID', 'GOOGLE_FAKE', 'CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD', 'PORT']) delete env[k];
const hijo = spawn(process.execPath, ['server.js'], {
  cwd: RAIZ,
  env: { ...env, NODE_ENV: 'development', JWT_SECRET: SECRETO, MUSIC_DB_PATH: process.env.MUSIC_DB_PATH, PORT: PUERTO },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let salida = '';
hijo.stdout.on('data', (d) => { salida += d; });
hijo.stderr.on('data', (d) => { salida += d; });

async function listo() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* todavía no escucha */ }
    if (hijo.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  console.error(`[SMOKE-PL404] El servidor no levantó:\n${salida}`);
  return false;
}

async function pedir(metodo, ruta, token, body) {
  const res = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

// ---- Preparación: dos cuentas y tres pistas, directo en la base temporal ----
console.log(`[SMOKE-PL404] base temporal: ${process.env.MUSIC_DB_PATH}`);
const insU = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
const ana = Number(insU.run('ana', 'x').lastInsertRowid);
const beto = Number(insU.run('beto', 'x').lastInsertRowid);
const insT = db.prepare('INSERT INTO tracks (title, artist, album, file_path) VALUES (?, ?, ?, ?)');
const t1 = Number(insT.run('Uno', 'Grimes', 'Geidi Primes', '/tmp/smoke/uno.flac').lastInsertRowid);
const t2 = Number(insT.run('Dos', 'Grimes', 'Geidi Primes', '/tmp/smoke/dos.flac').lastInsertRowid);
const t3 = Number(insT.run('Tres', 'Grimes', 'Geidi Primes', '/tmp/smoke/tres.flac').lastInsertRowid);
const NO_EXISTE = 999999;
const tokAna = jwt.sign({ id: ana, username: 'ana' }, SECRETO, { expiresIn: '1h' });
const tokBeto = jwt.sign({ id: beto, username: 'beto' }, SECRETO, { expiresIn: '1h' });

const PISTA = { error: 'Track not found' };
const PLAYLIST = { error: 'Playlist not found' };

try {
  if (!(await listo())) throw new Error('el servidor no levantó');

  const c = await pedir('POST', '/api/playlists', tokAna, { name: 'De Ana' });
  check(c.status === 201 && Number.isInteger(c.data?.id), 'ana crea su playlist → 201', `${c.status} ${JSON.stringify(c.data)}`);
  const pl = c.data?.id;

  console.log('\n[1] la pista no existe (la playlist es tuya) → 404 Track not found');
  {
    const r = await pedir('POST', `/api/playlists/${pl}/tracks`, tokAna, { track_id: NO_EXISTE });
    check(r.status === 404 && igual(r.data, PISTA), 'POST { track_id } inexistente → 404 { error: "Track not found" }', `${r.status} ${JSON.stringify(r.data)}`);
    const g = await pedir('GET', `/api/playlists/${pl}/tracks`, tokAna);
    check(g.status === 200 && igual(g.data, []), 'y no dejó nada en la playlist', `${g.status} ${JSON.stringify(g.data)}`);
  }

  console.log('\n[2] el camino feliz no cambia');
  {
    const r = await pedir('POST', `/api/playlists/${pl}/tracks`, tokAna, { track_id: t1 });
    check(r.status === 201 && igual(r.data, { position: 1 }), 'POST { track_id } existente → 201 { position: 1 }', `${r.status} ${JSON.stringify(r.data)}`);
    const otra = await pedir('POST', `/api/playlists/${pl}/tracks`, tokAna, { track_id: t1 });
    check(otra.status === 200 && igual(otra.data, { already: true }), 'repetida → 200 { already: true }, no 404', `${otra.status} ${JSON.stringify(otra.data)}`);
  }

  console.log('\n[3] la playlist es de OTRA cuenta → 404 Playlist not found');
  {
    const p = await pedir('POST', `/api/playlists/${pl}/tracks`, tokBeto, { track_id: t2 });
    check(p.status === 404 && igual(p.data, PLAYLIST), 'POST ajeno (pista existente) → 404 Playlist not found', `${p.status} ${JSON.stringify(p.data)}`);
    const p2 = await pedir('POST', `/api/playlists/${pl}/tracks`, tokBeto, { track_id: NO_EXISTE });
    check(p2.status === 404 && igual(p2.data, PLAYLIST), 'POST ajeno con pista inexistente → gana Playlist not found', `${p2.status} ${JSON.stringify(p2.data)}`);
    const g = await pedir('GET', `/api/playlists/${pl}/tracks`, tokBeto);
    check(g.status === 404 && igual(g.data, PLAYLIST), 'GET ajeno → 404 Playlist not found', `${g.status} ${JSON.stringify(g.data)}`);
    const d = await pedir('DELETE', `/api/playlists/${pl}/tracks/${t1}`, tokBeto);
    check(d.status === 404 && igual(d.data, PLAYLIST), 'DELETE ajeno → 404 Playlist not found', `${d.status} ${JSON.stringify(d.data)}`);
    const g2 = await pedir('GET', `/api/playlists/${pl}/tracks`, tokAna);
    check(g2.status === 200 && igual(g2.data.map((t) => t.id), [t1]), 'y la de ana quedó como estaba', `${g2.status} ${JSON.stringify(g2.data)}`);
  }

  console.log('\n[4] la playlist no existe → 404 Playlist not found');
  {
    const g = await pedir('GET', `/api/playlists/${NO_EXISTE}/tracks`, tokAna);
    check(g.status === 404 && igual(g.data, PLAYLIST), 'GET inexistente → 404 Playlist not found', `${g.status} ${JSON.stringify(g.data)}`);
    const p = await pedir('POST', `/api/playlists/${NO_EXISTE}/tracks`, tokAna, { track_id: t2 });
    check(p.status === 404 && igual(p.data, PLAYLIST), 'POST inexistente → 404 Playlist not found', `${p.status} ${JSON.stringify(p.data)}`);
  }

  console.log('\n[5] el lote no es 404: cuenta la omitida');
  {
    const r = await pedir('POST', `/api/playlists/${pl}/tracks`, tokAna, { track_ids: [t2, NO_EXISTE] });
    check(r.status === 201 && igual(r.data, { added: 1, already: 0, skipped: 1 }), 'POST { track_ids } con una inexistente → 201 { added 1, skipped 1 }', `${r.status} ${JSON.stringify(r.data)}`);
  }

  console.log('\n[6] una pista que se borra DESPUÉS no rompe el GET');
  {
    await pedir('POST', `/api/playlists/${pl}/tracks`, tokAna, { track_id: t3 });
    db.prepare('DELETE FROM tracks WHERE id = ?').run(t3);   // como el PRUNE de un reescaneo sin pareja
    const g = await pedir('GET', `/api/playlists/${pl}/tracks`, tokAna);
    check(g.status === 200 && igual(g.data.map((t) => t.id), [t1, t2]), 'GET → 200 sin la borrada', `${g.status} ${JSON.stringify(g.data?.map?.((t) => t.id))}`);
    const r = await pedir('POST', `/api/playlists/${pl}/tracks`, tokAna, { track_id: t3 });
    check(r.status === 404 && igual(r.data, PISTA), 'y agregarla otra vez (id viejo en la pestaña) → 404 Track not found', `${r.status} ${JSON.stringify(r.data)}`);
  }
} catch (e) {
  fail++;
  console.error('[SMOKE-PL404] se cortó:', e);
} finally {
  if (hijo.exitCode === null) {
    hijo.kill();
    await new Promise((r) => hijo.on('exit', r));
  }
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n[SMOKE-PL404] ${pass} ok, ${fail} fallas\n`);
process.exit(fail ? 1 : 0);
