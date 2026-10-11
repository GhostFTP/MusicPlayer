// Smoke test del MODO RADIO (1.29.0): POST /api/radio, PUT /api/radio/:code/state,
// GET /api/radio/:code y DELETE /api/radio/:code, por HTTP y con varios clientes falsos
// (anfitrión, oyente, admin).
//
// CÓMO SE CORRE
//   npm run smoke:radio
// No hace falta levantar nada antes: el script levanta SUS PROPIOS servidores.
//
// CORRE SOBRE UNA BASE TEMPORAL, como los demás smokes: MUSIC_DB_PATH se pone ANTES de
// importar nada del servidor (db/database.js abre el archivo al evaluarse) y los servidores
// hijos reciben la misma variable. Los usuarios llevan ids desde 900001. Todo se borra al
// terminar, también si algo falla. Las radios viven en la memoria de cada servidor hijo.
//
// DOS SERVIDORES sobre la MISMA base: "normal", con los tiempos de verdad, y "corto", con
// los tiempos de vida achicados por variables de entorno (RADIO_*_MS, src/radio/reglas.js)
// para ver stale → ended → borrada sin esperar minutos. La expiración con los tiempos reales
// la prueba `npm run test:radio`, con el reloj inyectado.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'sonorarev-radio-'));
process.env.MUSIC_DB_PATH = join(dir, 'test.db');
const SECRETO = 'smoke-radio';
process.env.JWT_SECRET = SECRETO;

const { default: db } = await import('../src/db/database.js');
const { signToken } = await import('../src/auth/jwt.js');
const { REGLAS } = await import('../src/radio/reglas.js');

const ANFITRION = 900001;
const OYENTE = 900002;
const ADMIN = 900003;
const CORREO = 900004;   // una cuenta que se llama como su correo

let pass = 0;
let fail = 0;
function check(ok, label, detalle = '') {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FALLA ${label}${detalle ? `  → ${detalle}` : ''}`); }
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- Preparación ----

console.log(`[SMOKE-RADIO] carpeta temporal: ${dir}`);

const usuario = (id, username, extra = {}) => {
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(id, username, 'x');
  for (const [col, v] of Object.entries(extra)) db.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).run(v, id);
  return signToken({ id, username });
};
const tAnfitrion = usuario(ANFITRION, 'smoke-anfitrion', { avatar_emoji: '🎧', email: 'secreto-anfitrion@example.com' });
const tOyente = usuario(OYENTE, 'smoke-oyente');
const tAdmin = usuario(ADMIN, 'smoke-admin', { role: 'admin' });
const tCorreo = usuario(CORREO, 'ana.perez@example.com');
// Más cuentas, para los límites.
const extras = [];
for (let i = 0; i < REGLAS.MAX_RADIOS + 1; i++) extras.push(usuario(900100 + i, `smoke-extra-${i}`));
const tBorrada = signToken({ id: 999999, username: 'no-existe' });

const pista = (id, duration) =>
  db.prepare('INSERT INTO tracks (id, title, duration, file_path) VALUES (?, ?, ?, ?)').run(id, `Pista ${id}`, duration, `/music/smoke-${id}.flac`);
pista(501, 200.5);      // 200 500 ms
pista(502, 31);
pista(503, null);       // sin duración en la base
const FANTASMA = 777777; // no es ninguna pista

const env = { ...process.env };
for (const k of Object.keys(env)) if (k.startsWith('RADIO_')) delete env[k];
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
  console.error(`[SMOKE-RADIO] El servidor "${srv.nombre}" no levantó:\n${srv.salida()}`);
  return false;
}

/** `crudo`: un cuerpo ya serializado (para mandar JSON roto o enorme). */
async function pedir(srv, method, path, { body, crudo, tok = tAnfitrion } = {}) {
  const hayCuerpo = body !== undefined || crudo !== undefined;
  const res = await fetch(`${srv.base}${path}`, {
    method,
    headers: {
      ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
      ...(hayCuerpo ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(hayCuerpo ? { body: crudo ?? JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* no es JSON */ }
  return { status: res.status, data, text, headers: res.headers };
}

process.on('exit', () => {
  for (const h of hijos) if (h.exitCode === null) h.kill();
  rmSync(dir, { recursive: true, force: true });
});

const CORTO = { RADIO_STALE_MS: '600', RADIO_CIERRE_MS: '2000', RADIO_PAUSA_MS: '1500', RADIO_ENDED_MS: '1200', RADIO_OYENTE_MS: '600' };
const normal = levantar('normal', 3491);
const corto = levantar('corto', 3492, CORTO);

try {
  if (!(await listo(normal)) || !(await listo(corto))) { fail++; throw new Error('sin servidor'); }

  const SUENA = { trackId: 501, positionMs: 12_345, playing: true };

  // ---- [1] Sin sesión ----
  console.log('[1] sin sesión');
  {
    const r = await Promise.all([
      pedir(normal, 'POST', '/api/radio', { tok: null }),
      pedir(normal, 'PUT', '/api/radio/ABCDEF/state', { tok: null, body: SUENA }),
      pedir(normal, 'GET', '/api/radio/ABCDEF', { tok: null }),
      pedir(normal, 'DELETE', '/api/radio/ABCDEF', { tok: null }),
    ]);
    check(igual(r.map((x) => x.status), [401, 401, 401, 401]), 'las cuatro rutas dan 401 sin token', r.map((x) => x.status).join(','));
    check((await pedir(normal, 'POST', '/api/radio', { tok: tBorrada })).status === 401, 'con el token de una cuenta que no existe: 401');
  }

  // ---- [2] Crear ----
  console.log('[2] crear');
  const creada = await pedir(normal, 'POST', '/api/radio');
  const code = creada.data?.code;
  {
    const antes = Date.now();
    check(creada.status === 201 && /^[2-9A-HJKMNP-Z]{6}$/.test(code ?? ''), '201 con un código de 6 sin 0/O/1/I/L', `${creada.status} ${creada.text}`);
    check(creada.data?.status === 'live' && Math.abs(creada.data.serverNow - antes) < 5000, 'viene "live" y la hora del servidor');
    check(creada.headers.get('cache-control') === 'no-store', 'sin caché');
  }

  // ---- [3] Leer recién creada ----
  console.log('[3] leer');
  {
    const r = await pedir(normal, 'GET', `/api/radio/${code}`, { tok: tOyente });
    check(r.status === 200 && r.data.status === 'live' && r.data.state === null && r.data.code === code, 'el oyente la lee: live y sin estado todavía', r.text);
    check(igual(r.data.host, { id: ANFITRION, name: 'smoke-anfitrion', avatar: { kind: 'emoji', value: '🎧' } }), 'el anfitrión: id, nombre y avatar', JSON.stringify(r.data.host));
    check(igual(Object.keys(r.data).sort(), ['code', 'host', 'listeners', 'serverNow', 'state', 'status']), 'la respuesta tiene esos campos y ninguno más', Object.keys(r.data).join(','));
    check(igual(r.data.listeners, [{ id: OYENTE, name: 'smoke-oyente', avatar: null }]), 'quien lee queda de oyente', JSON.stringify(r.data.listeners));
    check(!/secreto-anfitrion|password|role|email/.test(r.text), 'ni correo, ni rol, ni nada privado en la respuesta');
    const min = await pedir(normal, 'GET', `/api/radio/${code.toLowerCase()}`, { tok: tOyente });
    check(min.status === 200 && min.data.code === code, 'el código vale también en minúsculas');
    const propio = await pedir(normal, 'GET', `/api/radio/${code}`);
    check(propio.data.listeners.length === 1 && propio.data.listeners[0].id === OYENTE, 'el anfitrión lee y no se cuenta como oyente');
    const c = await pedir(normal, 'GET', `/api/radio/${code}`, { tok: tCorreo });
    const yo = c.data.listeners.find((l) => l.id === CORREO);
    check(yo?.name === 'ana.perez' && !c.text.includes('example.com'), 'una cuenta que se llama como su correo sale sin el dominio', c.text);
  }

  // ---- [4] Publicar ----
  console.log('[4] publicar');
  {
    const antes = Date.now();
    const r = await pedir(normal, 'PUT', `/api/radio/${code}/state`, { body: { ...SUENA, nextTrackId: 502, publishedAtServerMs: 5, serverNow: 5, seq: 99, clientNow: 5 } });
    const despues = Date.now();
    check(r.status === 200 && r.data.state.seq === 1, '200 y secuencia 1', r.text);
    check(igual({ ...r.data.state, publishedAtServerMs: 0 }, { seq: 1, trackId: 501, positionMs: 12_345, playing: true, nextTrackId: 502, enPausaPorVideo: false, publishedAtServerMs: 0 }), 'devuelve el estado guardado');
    const p = r.data.state.publishedAtServerMs;
    check(p >= antes - 50 && p <= despues + 50 && r.data.serverNow >= p, 'la hora es la del SERVIDOR: el reloj y la secuencia que mandó el cliente se ignoran', String(p));
    const l = await pedir(normal, 'GET', `/api/radio/${code}`, { tok: tOyente });
    check(igual(l.data.state, r.data.state) && l.data.serverNow >= p, 'el oyente lee exactamente eso');
    const r2 = await pedir(normal, 'PUT', `/api/radio/${code}/state`, { body: { ...SUENA, playing: false } });
    const r3 = await pedir(normal, 'PUT', `/api/radio/${code}/state`, { body: SUENA });
    check(r2.data.state.seq === 2 && r3.data.state.seq === 3 && r3.data.state.publishedAtServerMs >= r2.data.state.publishedAtServerMs, 'la secuencia sube en cada publicación');
  }

  const seqDe = async () => (await pedir(normal, 'GET', `/api/radio/${code}`)).data.state?.seq;

  // ---- [5] Solo el anfitrión ----
  console.log('[5] solo el anfitrión publica y termina');
  {
    const antes = await seqDe();
    const p = await pedir(normal, 'PUT', `/api/radio/${code}/state`, { tok: tOyente, body: { trackId: 502, positionMs: 0, playing: true } });
    check(p.status === 403, 'el oyente no puede publicar: 403', `${p.status} ${p.text}`);
    const pa = await pedir(normal, 'PUT', `/api/radio/${code}/state`, { tok: tAdmin, body: { trackId: 502, positionMs: 0, playing: true } });
    check(pa.status === 403, 'un admin tampoco publica en la radio de otro: 403');
    const l = await pedir(normal, 'GET', `/api/radio/${code}`);
    check(l.data.state.seq === antes && l.data.state.trackId === 501, 'y el estado no cambió');
    const d = await pedir(normal, 'DELETE', `/api/radio/${code}`, { tok: tOyente });
    check(d.status === 403, 'el oyente no puede terminarla: 403', `${d.status} ${d.text}`);
    check((await pedir(normal, 'GET', `/api/radio/${code}`)).data.status === 'live', 'y sigue viva');
  }

  // ---- [6] Validación ----
  console.log('[6] validación de lo publicado');
  {
    const antes = await seqDe();
    const put = (body) => pedir(normal, 'PUT', `/api/radio/${code}/state`, { body });
    const f = await put({ trackId: FANTASMA, positionMs: 0, playing: true });
    check(f.status === 422, 'una canción que no existe: 422', `${f.status} ${f.text}`);
    const malos = await Promise.all([
      put({}), put({ positionMs: 0, playing: true }), put({ trackId: '501', positionMs: 0, playing: true }),
      put({ trackId: 501.5, positionMs: 0, playing: true }), put({ trackId: 501, playing: true }),
      put({ trackId: 501, positionMs: '0', playing: true }), put({ trackId: 501, positionMs: 0 }),
      put({ trackId: 501, positionMs: 0, playing: 'si' }), put({ trackId: 501, positionMs: 0, playing: true, nextTrackId: 'x' }),
      put({ trackId: 501, positionMs: 0, playing: true, enPausaPorVideo: 1 }), put([1, 2]),
    ]);
    check(malos.every((m) => m.status === 400 && typeof m.data?.error === 'string'), 'once cuerpos mal formados: 400 con su mensaje', malos.map((m) => m.status).join(','));
    check((await seqDe()) === antes, 'ninguno de esos subió la secuencia');

    const lejos = await put({ trackId: 501, positionMs: 999_999_999, playing: true });
    check(lejos.status === 200 && lejos.data.state.positionMs === 200_500, 'posición pasada del final: se acota a la duración', lejos.text);
    const negativa = await put({ trackId: 501, positionMs: -5000, playing: true });
    check(negativa.data.state.positionMs === 0, 'posición negativa: 0');
    const decimal = await put({ trackId: 502, positionMs: 1234.6, playing: true });
    check(decimal.data.state.positionMs === 1235, 'con decimales: redondeada');
    const sinDur = await put({ trackId: 503, positionMs: 600_000, playing: true });
    check(sinDur.data.state.positionMs === 600_000, 'una pista sin duración en la base: la posición tal cual');
    const sig = await put({ trackId: 501, positionMs: 0, playing: true, nextTrackId: FANTASMA });
    check(sig.status === 200 && sig.data.state.nextTrackId === null, 'una "siguiente" que no existe se publica como null, sin rechazar');
    const video = await put({ enPausaPorVideo: true });
    check(video.status === 200 && igual({ ...video.data.state, seq: 0, publishedAtServerMs: 0 }, { seq: 0, trackId: null, positionMs: 0, playing: false, nextTrackId: null, enPausaPorVideo: true, publishedAtServerMs: 0 }), 'en pausa por video, sin canción', video.text);
    const video2 = await put({ trackId: 501, positionMs: 5000, playing: true, enPausaPorVideo: true });
    check(video2.data.state.playing === false && video2.data.state.trackId === 501, 'en pausa por video, playing es false aunque el cliente diga true');
  }

  // ---- [7] El cuerpo ----
  console.log('[7] el cuerpo');
  {
    const grande = await pedir(normal, 'PUT', `/api/radio/${code}/state`, { crudo: JSON.stringify({ ...SUENA, relleno: 'x'.repeat(2000) }) });
    check(grande.status === 413 && typeof grande.data?.error === 'string', 'un cuerpo de 2 kB: 413, en JSON', `${grande.status} ${grande.text.slice(0, 80)}`);
    const roto = await pedir(normal, 'PUT', `/api/radio/${code}/state`, { crudo: '{"trackId": 501,' });
    check(roto.status === 400 && typeof roto.data?.error === 'string', 'JSON roto: 400, en JSON', `${roto.status} ${roto.text.slice(0, 80)}`);
    // El `express.json()` global sigue leyendo los cuerpos de las demás rutas.
    const pl = await pedir(normal, 'POST', '/api/playlists', { body: { name: 'Sigue andando' } });
    check(pl.status === 201 && pl.data?.name === 'Sigue andando', 'las demás rutas siguen leyendo su cuerpo (POST /api/playlists)', `${pl.status} ${pl.text}`);
  }

  // ---- [8] Códigos que no existen ----
  console.log('[8] códigos que no existen');
  {
    const r = await Promise.all([
      pedir(normal, 'GET', '/api/radio/ZZZZZZ'), pedir(normal, 'GET', '/api/radio/abc'), pedir(normal, 'GET', '/api/radio/ABCDE0'),
      pedir(normal, 'PUT', '/api/radio/ZZZZZZ/state', { body: SUENA }), pedir(normal, 'DELETE', '/api/radio/ZZZZZZ'),
      pedir(normal, 'DELETE', '/api/radio/ZZZZZZ', { tok: tAdmin }),
    ]);
    check(r.every((x) => x.status === 404), 'inexistente o mal formado: 404 en las tres rutas', r.map((x) => x.status).join(','));
    check(new Set(r.map((x) => x.text)).size === 1, 'siempre con el mismo mensaje');
  }

  // ---- [9] Una sola radio por anfitrión ----
  console.log('[9] una sola radio por anfitrión');
  const segunda = await pedir(normal, 'POST', '/api/radio');
  const code2 = segunda.data?.code;
  {
    check(segunda.status === 201 && code2 !== code, 'crear otra da un código nuevo');
    const vieja = await pedir(normal, 'GET', `/api/radio/${code}`, { tok: tOyente });
    check(vieja.status === 200 && vieja.data.status === 'ended' && vieja.data.endedReason === 'reemplazada' && vieja.data.listeners.length === 0, 'la anterior quedó "ended" (reemplazada)', vieja.text);
    const p = await pedir(normal, 'PUT', `/api/radio/${code}/state`, { body: SUENA });
    check(p.status === 410 && p.data.status === 'ended', 'publicar en la anterior: 410', `${p.status} ${p.text}`);
    check((await pedir(normal, 'GET', `/api/radio/${code2}`)).data.state === null, 'la nueva empieza sin estado');
  }

  // ---- [10] Terminar ----
  console.log('[10] terminar');
  {
    await pedir(normal, 'PUT', `/api/radio/${code2}/state`, { body: SUENA });
    const d = await pedir(normal, 'DELETE', `/api/radio/${code2}`, { tok: tAdmin });
    check(d.status === 200 && d.data.status === 'ended' && d.data.endedReason === 'admin', 'un admin la termina', `${d.status} ${d.text}`);
    const l = await pedir(normal, 'GET', `/api/radio/${code2}`, { tok: tOyente });
    check(l.data.status === 'ended' && l.data.endedReason === 'admin' && l.data.state?.seq === 1, 'el oyente ve "ended", con el motivo y lo último que sonó');
    check((await pedir(normal, 'PUT', `/api/radio/${code2}/state`, { body: SUENA })).status === 410, 'y el anfitrión ya no puede publicar: 410');

    const tercera = (await pedir(normal, 'POST', '/api/radio')).data.code;
    const propia = await pedir(normal, 'DELETE', `/api/radio/${tercera}`);
    check(propia.status === 200 && propia.data.endedReason === 'anfitrion', 'el anfitrión termina la suya');
    check((await pedir(normal, 'DELETE', `/api/radio/${tercera}`)).status === 200, 'terminarla dos veces no es un error');
  }

  // ---- [11] Expiración (servidor "corto") ----
  console.log('[11] expiración, con los tiempos achicados');
  {
    const c = (await pedir(corto, 'POST', '/api/radio')).data.code;
    await pedir(corto, 'PUT', `/api/radio/${c}/state`, { body: SUENA });
    const estado = async () => { const r = await pedir(corto, 'GET', `/api/radio/${c}`, { tok: tOyente }); return r.status === 200 ? r.data : { status: r.status }; };
    check((await estado()).status === 'live', 'recién publicada: live');
    await espera(800);
    check((await estado()).status === 'stale', 'sin publicar más que STALE: stale');
    await pedir(corto, 'PUT', `/api/radio/${c}/state`, { body: SUENA });
    check((await estado()).status === 'live', 'un latido la devuelve a live');
    await espera(2300);
    const fin = await estado();
    check(fin.status === 'ended' && fin.endedReason === 'sin-anfitrion', 'sin anfitrión más que el cierre: ended', JSON.stringify(fin));
    check((await pedir(corto, 'PUT', `/api/radio/${c}/state`, { body: SUENA })).status === 410, 'y ya no acepta publicaciones: 410');
    await espera(1500);
    check((await estado()).status === 404, 'pasado el rato de "ended", se borra: 404');

    // En pausa con latidos: la cierra la pausa.
    const p = (await pedir(corto, 'POST', '/api/radio')).data.code;
    let ultimo = null;
    for (let i = 0; i < 12; i++) {
      ultimo = await pedir(corto, 'PUT', `/api/radio/${p}/state`, { body: { ...SUENA, playing: false } });
      if (ultimo.status !== 200) break;
      await espera(200);
    }
    check(ultimo.status === 410 && ultimo.data.endedReason === 'pausa', 'en pausa con latidos: se cierra por la pausa', `${ultimo.status} ${ultimo.text}`);

    // Los oyentes que dejan de preguntar salen de la lista.
    const o = (await pedir(corto, 'POST', '/api/radio')).data.code;
    await pedir(corto, 'GET', `/api/radio/${o}`, { tok: tOyente });
    check((await pedir(corto, 'GET', `/api/radio/${o}`)).data.listeners.length === 1, 'el oyente aparece');
    await espera(900);
    check((await pedir(corto, 'GET', `/api/radio/${o}`)).data.listeners.length === 0, 'y sale de la lista cuando deja de preguntar');
  }

  // ---- [12] Límites ----
  console.log('[12] límites');
  {
    // Frecuencia de publicación.
    const c = (await pedir(normal, 'POST', '/api/radio', { tok: extras[0] })).data.code;
    const tandas = [];
    for (let i = 0; i <= REGLAS.MAX_PUBLICACIONES; i++) tandas.push(await pedir(normal, 'PUT', `/api/radio/${c}/state`, { tok: extras[0], body: SUENA }));
    const ult = tandas.at(-1);
    check(tandas.slice(0, -1).every((t) => t.status === 200) && ult.status === 429 && Number(ult.headers.get('retry-after')) >= 1,
      `${REGLAS.MAX_PUBLICACIONES} publicaciones seguidas pasan y la siguiente da 429 con Retry-After`, tandas.map((t) => t.status).join(','));
    check((await pedir(normal, 'GET', `/api/radio/${c}`, { tok: extras[0] })).data.state.seq === REGLAS.MAX_PUBLICACIONES, 'la rechazada no subió la secuencia');

    // Radios a la vez. extras[0] ya tiene una; se suman hasta el tope.
    const abiertas = [201];
    for (let i = 1; i < REGLAS.MAX_RADIOS; i++) abiertas.push((await pedir(normal, 'POST', '/api/radio', { tok: extras[i] })).status);
    const demas = await pedir(normal, 'POST', '/api/radio', { tok: extras[REGLAS.MAX_RADIOS] });
    check(abiertas.every((s) => s === 201) && demas.status === 409, `${REGLAS.MAX_RADIOS} radios a la vez, y la siguiente da 409`, `${abiertas.join(',')} → ${demas.status} ${demas.text}`);
    check((await pedir(normal, 'POST', '/api/radio', { tok: extras[1] })).status === 201, 'quien ya tiene una puede reemplazarla aunque esté lleno');

    // Creaciones por minuto de la misma cuenta (extras[1] lleva 2).
    const cr = [];
    for (let i = 0; i < REGLAS.MAX_CREACIONES - 1; i++) cr.push((await pedir(normal, 'POST', '/api/radio', { tok: extras[1] })).status);
    check(igual(cr, [...Array(REGLAS.MAX_CREACIONES - 2).fill(201), 429]), `la creación ${REGLAS.MAX_CREACIONES + 1} de la misma cuenta en un minuto: 429`, cr.join(','));
  }
} catch (e) {
  if (e.message !== 'sin servidor') { fail++; console.error('[SMOKE-RADIO] se cortó:', e); }
} finally {
  for (const h of hijos) h.kill();
  // Se espera a que los hijos suelten la base antes de borrar la carpeta (en Windows, si no,
  // el archivo sigue tomado).
  await Promise.all(hijos.map((h) => (h.exitCode === null ? new Promise((r) => h.on('exit', r)) : null)));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n[SMOKE-RADIO] ${pass} ok, ${fail} con falla`);
process.exit(fail ? 1 : 0);
