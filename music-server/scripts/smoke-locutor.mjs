// Smoke test del LOCUTOR (GET /api/tracks/:id/locutor), por HTTP contra servidores REALES y
// un Ollama FALSO. Cubre el cableado que test:locutor-servicio no ve: el router, la base, la
// auth, el montaje en server.js y que las rutas que ya existían en /api/tracks no cambian.
//
// CÓMO SE CORRE
//   npm run smoke:locutor
// No hace falta levantar nada antes: el script levanta SUS PROPIOS servidores.
//
// CORRE SOBRE UNA BASE TEMPORAL, como los demás smokes: MUSIC_DB_PATH se pone ANTES de importar
// nada del servidor y los servidores hijos reciben la misma variable. Los usuarios llevan ids
// desde 900001. Todo se borra al terminar, también si algo falla.
//
// DETERMINISMO. Los límites por tiempo (hora, día, 25 min de frío, negativas) los prueba
// test:locutor-servicio con un reloj inyectado; acá no se duerme para eso. Lo que sí hay es:
//   · un CERROJO en el Ollama falso (`retener`): la respuesta se guarda hasta que la prueba la
//     suelta, así "generando" se observa de verdad y no por carrera;
//   · sondeos acotados (hasta ~8 s, cada 60 ms) para esperar el paso a "lista"/"sin-frase";
//   · para afirmar que algo NO pasó (ninguna petición extra), una pausa corta de 250 ms.
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'sonorarev-locutor-'));
process.env.MUSIC_DB_PATH = join(dir, 'test.db');
const SECRETO = 'smoke-locutor';
process.env.JWT_SECRET = SECRETO;

const { default: db } = await import('../src/db/database.js');
const { signToken } = await import('../src/auth/jwt.js');

const U1 = 900001;
const U2 = 900002;

let pass = 0;
let fail = 0;
function check(ok, label, detalle = '') {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FALLA ${label}${detalle ? `  → ${detalle}` : ''}`); }
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- Preparación ----

console.log(`[SMOKE-LOCUTOR] carpeta temporal: ${dir}`);

const usuario = (id, username) => {
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(id, username, 'x');
  return signToken({ id, username });
};
const t1 = usuario(U1, 'smoke-locutor-1');
const t2 = usuario(U2, 'smoke-locutor-2');

// Seis pistas con datos completos. La 1 es "instrumental" para que /lyrics conteste sin salir
// a internet (LRCLIB).
for (let i = 1; i <= 6; i++) {
  db.prepare(`INSERT INTO tracks (id, title, artist, album_artist, album, genre, year, track_number, disc_total, duration, file_path, vocals)
              VALUES (?, ?, 'Daft Punk', 'Daft Punk', 'Discovery', 'Electronic', 2001, ?, 1, 200, ?, ?)`)
    .run(i, `Tema ${i}`, i, `/music/smoke-locutor-${i}.flac`, i === 1 ? 'instrumental' : null);
}
let nPlay = 0;
const escucha = (user, track) =>
  db.prepare('INSERT INTO plays (user_id, track_id, played_at, ms_played, client_id) VALUES (?, ?, ?, ?, ?)')
    .run(user, track, Date.now() - 1000, 100000, `smoke-locutor-${nPlay++}`);

// ---- Ollama falso ----

const fake = { modo: 'ok', retener: false, esperando: [], peticiones: [] };
const servidorFalso = http.createServer((req, res) => {
  const trozos = [];
  req.on('data', (c) => trozos.push(c));
  req.on('end', () => {
    let cuerpo = null;
    try { cuerpo = JSON.parse(Buffer.concat(trozos).toString('utf8')); } catch { /* queda null */ }
    fake.peticiones.push({ url: req.url, cuerpo });
    const responder = () => {
      if (res.destroyed) return;
      if (fake.modo === '500') { res.writeHead(500); return res.end('{"error":"x"}'); }
      let contenido = 'hola';
      const user = cuerpo?.messages?.[1]?.content;
      if (typeof user === 'string' && user.includes('<<<DATOS')) {
        const datos = JSON.parse(user.split('<<<DATOS\n')[1].split('\nDATOS>>>')[0]);
        const frase = fake.modo === 'mala'
          ? 'Metallica suena esta noche.'
          : `Suena ${datos.artista}, una noche tranquila para dejarse llevar.`;
        contenido = JSON.stringify({ frase });
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: { role: 'assistant', content: contenido } }));
    };
    if (fake.retener) fake.esperando.push(responder); else responder();
  });
});
await new Promise((r) => servidorFalso.listen(0, '127.0.0.1', r));
const URL_FAKE = `http://127.0.0.1:${servidorFalso.address().port}`;
const liberar = () => { fake.retener = false; for (const r of fake.esperando.splice(0)) r(); };
const FRASE_ESPERADA = 'Suena Daft Punk, una noche tranquila para dejarse llevar.';

// ---- Servidores hijos ----

const env = { ...process.env };
for (const k of Object.keys(env)) if (k.startsWith('LOCUTOR_') || k === 'OLLAMA_URL') delete env[k];
for (const k of ['GOOGLE_IOS_CLIENT_ID', 'GOOGLE_FAKE', 'CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD', 'PORT', 'VIDEO_DIR']) delete env[k];
const hijos = [];

function levantar(nombre, port, extra = {}) {
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
  console.error(`[SMOKE-LOCUTOR] El servidor "${srv.nombre}" no levantó:\n${srv.salida()}`);
  return false;
}

async function pedir(srv, path, tok = t1) {
  const res = await fetch(`${srv.base}${path}`, { headers: tok ? { Authorization: `Bearer ${tok}` } : {} });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* no es JSON */ }
  return { status: res.status, data, text, headers: res.headers };
}
const locutor = (srv, id, tok = t1) => pedir(srv, `/api/tracks/${id}/locutor`, tok);

// Sondea hasta que `pred` se cumpla (o se acabe el tiempo) y devuelve la última respuesta.
async function hasta(srv, id, tok, pred, ms = 8000) {
  const t0 = Date.now();
  for (;;) {
    const r = await locutor(srv, id, tok);
    if (pred(r.data)) return r;
    if (Date.now() - t0 > ms) return r;
    await espera(60);
  }
}
const sinNovedad = async (cuenta) => { await espera(250); return fake.peticiones.length === cuenta; };

// Borrar la carpeta mientras un hijo tiene la base abierta da EBUSY en Windows: primero se
// espera a que salgan. Si igual no se puede borrar, no es motivo para fallar la prueba.
const borrar = () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* lo limpia el sistema */ } };
process.on('exit', () => {
  for (const h of hijos) if (h.exitCode === null) h.kill();
  borrar();
});

const A = levantar('con-ollama', 3511, {
  OLLAMA_URL: URL_FAKE, LOCUTOR_TIMEOUT_MS: '3000', LOCUTOR_TIMEOUT_FRIO_MS: '5000', LOCUTOR_LIMITE_USUARIO_HORA: '3',
});
const B = levantar('apagado', 3512, { OLLAMA_URL: '' });
const C = levantar('con-fallos', 3513, { OLLAMA_URL: URL_FAKE, LOCUTOR_TIMEOUT_MS: '1500', LOCUTOR_TIMEOUT_FRIO_MS: '1500' });

try {
  if (!(await listo(A)) || !(await listo(B)) || !(await listo(C))) { fail++; throw new Error('sin servidor'); }

  // ---- [1] Puerta ----
  console.log('[1] sin sesión, id inválido y pista inexistente');
  {
    check((await locutor(A, 1, null)).status === 401, 'sin token: 401');
    check((await locutor(A, 1, signToken({ id: 999999, username: 'no-existe' }))).status === 401, 'token de una cuenta que no existe: 401');
    for (const id of ['abc', '1e3', '12.5', '-1']) check((await locutor(A, id)).status === 400, `id ${JSON.stringify(id)}: 400`);
    const r = await locutor(A, 999999);
    check(r.status === 404 && igual(r.data, { error: 'Track not found' }), 'pista inexistente: 404 { error }');
  }

  // ---- [2] Las rutas que ya existían no cambian ----
  console.log('[2] las rutas existentes de /api/tracks siguen igual');
  {
    const uno = await pedir(A, '/api/tracks/1');
    check(uno.status === 200 && uno.data?.id === 1 && uno.data?.title === 'Tema 1' && uno.data?.artist === 'Daft Punk', 'GET /api/tracks/:id');
    check((await pedir(A, '/api/tracks/999999')).status === 404, 'GET /api/tracks/:id inexistente: 404');
    const letra = await pedir(A, '/api/tracks/1/lyrics');
    check(letra.status === 200 && igual(letra.data, { instrumental: true, synced: false, lyrics: null }), 'GET /api/tracks/:id/lyrics', letra.text);
    const lista = await pedir(A, '/api/tracks?search=Tema&limit=10');
    check(lista.status === 200 && Array.isArray(lista.data) && lista.data.length === 6, 'GET /api/tracks?search=', `${lista.status} ${lista.text.slice(0, 80)}`);
    const caratula = await pedir(A, '/api/tracks/1/cover');
    check(caratula.status === 404 && igual(caratula.data, { error: 'No cover' }), 'GET /api/tracks/:id/cover sin carátula: 404');
    check((await pedir(A, '/api/tracks/1', null)).status === 401, 'GET /api/tracks/:id sin token: 401');
  }

  // ---- [3] Generando → lista, con el modelo retenido ----
  console.log('[3] generando → lista (Ollama falso retenido por el cerrojo)');
  {
    fake.retener = true;
    const t0 = Date.now();
    const g = await locutor(A, 1);
    check(g.status === 200 && g.data?.estado === 'generando' && g.data.frase === null && g.data.escuchas === 'Primera vez que la escuchas.' && typeof g.data.reintentar_s === 'number', 'GET con el modelo ocupado: generando', g.text);
    check(Date.now() - t0 < 1000, `contesta al instante (${Date.now() - t0} ms) sin esperar a la IA`);
    check(g.headers.get('cache-control') === 'no-store', 'Cache-Control: no-store');
    for (let i = 0; i < 100 && fake.peticiones.length < 1; i++) await espera(30);
    check(fake.peticiones.length === 1 && fake.peticiones[0].cuerpo?.messages?.[0]?.content === 'hola' && fake.peticiones[0].cuerpo?.options?.num_predict === 1, 'la primera petición al modelo es el calentamiento (modelo frío)');
    const otro = await locutor(A, 1, t2);
    check(otro.data?.estado === 'generando', 'otro usuario, misma pista: generando');
    check(await sinNovedad(1), 'ninguna petición extra por pedir lo mismo (dedupe)');

    liberar();
    const lista = await hasta(A, 1, t1, (d) => d?.estado === 'lista');
    check(lista.data?.estado === 'lista' && lista.data.frase === FRASE_ESPERADA && !('reintentar_s' in lista.data), 'pasa a lista con la frase validada', lista.text);
    check(fake.peticiones.length === 2, 'en total: un calentamiento y una generación', String(fake.peticiones.length));
    const b = fake.peticiones[1].cuerpo;
    check(b.model === 'gemma4:12b' && b.stream === false && b.think === false && b.keep_alive === '30m' && b.format?.required?.[0] === 'frase' && !('num_ctx' in b.options), 'la generación lleva model, stream, think, keep_alive y format; sin num_ctx');
    check(!/pista|escuchas/.test(b.messages[1].content) && !b.messages[1].content.includes('Ya la'), 'el modelo no recibe ni pista ni escuchas');
    const o2 = await locutor(A, 1, t2);
    check(o2.data?.estado === 'lista' && o2.data.frase === FRASE_ESPERADA, 'el otro usuario la recibe de la caché compartida');
    check(await sinNovedad(2), 'sin más peticiones al modelo');
  }

  // ---- [4] El conteo de escuchas sale de la base y no del modelo ----
  console.log('[4] escuchas previas');
  {
    escucha(U1, 1); escucha(U1, 1);
    const r = await locutor(A, 1);
    check(r.data?.estado === 'lista' && r.data.escuchas === 'Ya la has escuchado 2 veces.', 'dos escuchas previas → plantilla', r.text);
    escucha(U2, 1);
    const q = await locutor(A, 1, t2);
    check(q.data?.escuchas === 'Ya la habías escuchado una vez.', 'cada usuario ve las suyas');
    check(await sinNovedad(2), 'cambiar el conteo no regenera nada');
  }

  // ---- [5] Frase que no valida ----
  console.log('[5] frase inválida del modelo');
  {
    fake.modo = 'mala';
    const g = await locutor(A, 2);
    check(g.data?.estado === 'generando', 'pista nueva: generando');
    const r = await hasta(A, 2, t1, (d) => d?.estado === 'sin-frase');
    check(r.data?.estado === 'sin-frase' && r.data.frase === null && r.data.escuchas === 'Primera vez que la escuchas.', 'frase rechazada por el validador: sin-frase (con escuchas)', r.text);
    check(fake.peticiones.length === 3, 'una sola generación (el modelo ya estaba caliente)', String(fake.peticiones.length));
    check((await locutor(A, 2)).data?.estado === 'sin-frase' && await sinNovedad(3), 'volver a preguntar no vuelve a pedirle al modelo (negativa)');
    fake.modo = 'ok';
  }

  // ---- [6] Cupo por usuario (3 por hora en este servidor) ----
  console.log('[6] límite');
  {
    // El usuario 1 ya pagó dos generaciones (pistas 1 y 2). La tercera es la última.
    await locutor(A, 3);
    check((await hasta(A, 3, t1, (d) => d?.estado === 'lista')).data?.estado === 'lista', 'tercera generación del usuario 1: lista');
    const l = await locutor(A, 4);
    check(l.data?.estado === 'limite' && l.data.frase === null && l.data.escuchas === 'Primera vez que la escuchas.', 'cuarto encargo: limite (con escuchas)', l.text);
    const antes = fake.peticiones.length;
    check(await sinNovedad(antes), 'limite no llega al modelo');
    const u2 = await locutor(A, 4, t2);
    check(u2.data?.estado === 'generando', 'el usuario 2 tiene su propio cupo');
    check((await hasta(A, 4, t2, (d) => d?.estado === 'lista')).data?.estado === 'lista', '…y su frase queda lista');
    check((await locutor(A, 4, t1)).data?.estado === 'lista', 'el usuario 1 recibe esa frase aunque esté sin cupo (la caché no cobra)');
  }

  // ---- [7] Apagado ----
  console.log('[7] OLLAMA_URL vacío');
  {
    const antes = fake.peticiones.length;
    const r = await locutor(B, 1);
    check(r.status === 200 && igual(r.data, { estado: 'apagado', frase: null, escuchas: null }), 'apagado: { estado:"apagado", frase:null, escuchas:null }', r.text);
    check((await locutor(B, 999999)).status === 404, 'apagado: una pista inexistente sigue dando 404');
    check(await sinNovedad(antes), 'apagado no hace ninguna petición');
    check((await pedir(B, '/api/tracks/1')).data?.title === 'Tema 1', 'y el resto de /api/tracks sigue funcionando con el locutor apagado');
  }

  // ---- [8] Fallos del modelo y circuito abierto ----
  console.log('[8] fallos seguidos abren el circuito');
  {
    fake.modo = '500';
    const antes = fake.peticiones.length;
    for (const id of [1, 2, 3]) {
      const g = await locutor(C, id);
      check(g.data?.estado === 'generando', `pista ${id}: generando`);
      const r = await hasta(C, id, t1, (d) => d?.estado === 'sin-frase');
      check(r.data?.estado === 'sin-frase', `pista ${id}: el modelo falla → sin-frase`, r.text);
    }
    check(fake.peticiones.length === antes + 3, 'tres peticiones fallidas', String(fake.peticiones.length - antes));
    const despues = fake.peticiones.length;
    const abierto = await locutor(C, 4);
    check(abierto.data?.estado === 'sin-frase' && abierto.data.escuchas === 'Primera vez que la escuchas.', 'circuito abierto: sin-frase al instante', abierto.text);
    check(await sinNovedad(despues), 'con el circuito abierto no se llama al modelo');
    check((await locutor(C, 5)).data?.estado === 'sin-frase' && await sinNovedad(despues), 'ni se encola otra pista');
    fake.modo = 'ok';
  }

  // ---- [9] Nada de frases ni mensajes en los logs ----
  console.log('[9] logs');
  {
    for (const s of [A, B, C]) {
      const out = s.salida();
      check(out.includes('Music server running'), `${s.nombre}: el servidor arrancó`);
      check(!out.includes('una noche tranquila') && !out.includes('Presenta esta canción') && !out.includes('Metallica') && !out.includes('<<<DATOS'), `${s.nombre}: ni frases ni mensajes en la salida`);
    }
  }
} catch (e) {
  if (e.message !== 'sin servidor') { fail++; console.error('[SMOKE-LOCUTOR] error:', e); }
} finally {
  liberar();
  await Promise.all(hijos.map((h) => (h.exitCode !== null ? null : new Promise((r) => { h.once('exit', r); h.kill(); }))));
  servidorFalso.closeAllConnections?.();
  await new Promise((r) => servidorFalso.close(r));
  try { db.close?.(); } catch { /* ya cerrada */ }
  borrar();
}

console.log(`\n${pass} ok, ${fail} fallas`);
process.exit(fail ? 1 : 0);
