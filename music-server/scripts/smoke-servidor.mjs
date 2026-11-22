// Smoke test del ESTADO DEL SERVIDOR: GET /api/servidor y GET /api/admin/servidor, el
// muestreador del event loop (src/estado/muestreo.js), el estado ok/lento/mal/sin_datos
// (src/estado/salud.js) y los contadores de 500 y SQLITE_BUSY (src/estado/contadores.js).
//
// CÓMO SE CORRE
//   node scripts/smoke-servidor.mjs        (desde music-server/; sin script de npm todavía)
// No hace falta levantar nada: monta los routers en un express propio, en un puerto libre
// (listen(0)), dentro de este proceso. No usa 3000, 3100 ni 4173.
//
// CORRE SOBRE UNA BASE TEMPORAL, como los otros smokes: MUSIC_DB_PATH se pone ANTES de
// importar nada del servidor. Los usuarios llevan ids desde 900001. Todo se borra al
// terminar, también si algo falla.
//
// El caso del locutor ENCENDIDO corre en un proceso hijo (este mismo archivo con
// --locutor-encendido), porque el cliente de Ollama lee OLLAMA_URL al importarse. La URL
// apunta a un puerto cerrado de 127.0.0.1: nunca se le pide nada, solo se mira que el
// endpoint diga "encendido" sin dejar salir la URL. El mismo hijo le tapa db.location() a la
// conexión antes de su primer pedido, para probar el respaldo a DB_PATH por el endpoint real
// (los agregados se cachean 5 s, y en el padre ya se leyeron con location()).
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HIJO = process.argv.includes('--locutor-encendido');
const URL_OLLAMA = 'http://127.0.0.1:9/ollama-smoke';

const dir = mkdtempSync(join(tmpdir(), 'sonorarev-servidor-'));
const DB_PATH = join(dir, 'test.db');
const SECRETO = 'smoke-servidor-secreto-que-no-debe-salir';
process.env.MUSIC_DB_PATH = DB_PATH;
process.env.JWT_SECRET = SECRETO;
if (HIJO) process.env.OLLAMA_URL = URL_OLLAMA;
else delete process.env.OLLAMA_URL;

const { default: express } = await import('express');
const { DatabaseSync } = await import('node:sqlite');
const { default: db } = await import('../src/db/database.js');
const { signToken } = await import('../src/auth/jwt.js');
const { default: servidorRoutes } = await import('../src/api/servidor.js');
const { default: adminServidorRoutes } = await import('../src/api/admin-servidor.js');
const { default: adminUsersRoutes } = await import('../src/api/admin-users.js');
const { default: playsRoutes } = await import('../src/api/plays.js');
const { muestreador, crearMuestreador, CAPACIDAD, RESOLUCION_MS } = await import('../src/estado/muestreo.js');
const { crearLectorBase } = await import('../src/estado/base.js');
const { contarErrores500, esBusy } = await import('../src/estado/contadores.js');
const { estadoDe, LENTO_MS, MAL_MS } = await import('../src/estado/salud.js');
const { VERSION } = await import('../src/estado/version.js');

let pass = 0;
let fail = 0;
function check(ok, label, detalle = '') {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FALLA ${label}${detalle ? `  → ${detalle}` : ''}`); }
}
const corto = (x) => JSON.stringify(x)?.slice(0, 200);

// ---- Datos ----

const ADMIN = 900001;
const USER = 900002;
db.prepare("INSERT INTO users (id, username, password_hash, role) VALUES (?, 'smoke-srv-admin', 'x', 'admin')").run(ADMIN);
db.prepare("INSERT INTO users (id, username, password_hash, role) VALUES (?, 'smoke-srv-user', 'x', 'user')").run(USER);
const tok = (id) => signToken({ id, username: `u${id}` });
// Dos pistas: el conteo y el último escaneo tienen que salir de acá.
for (const id of [800001, 800002]) {
  // El segundo va como TEXTO: un número de JS se bindea como REAL y quedaría «…:02.0».
  db.prepare("INSERT INTO tracks (id, title, file_path, scanned_at) VALUES (?, ?, ?, '2026-11-20 10:00:0' || ?)")
    .run(id, `T${id}`, `/m/${id}.flac`, String(id - 800000));
}

// ---- Servidor propio: el mismo orden que server.js ----

const app = express();
app.use(contarErrores500);
app.use(express.json());
app.use('/api/plays', playsRoutes);
app.use('/api/admin/users', adminUsersRoutes);
app.use('/api/admin/servidor', adminServidorRoutes);
app.use('/api/servidor', servidorRoutes);
muestreador.iniciar();
const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const BASE = `http://127.0.0.1:${server.address().port}`;

async function pedir(path, { user, method = 'GET', body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      ...(user ? { Authorization: `Bearer ${tok(user)}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { status: r.status, data, text };
}

const esNum = (x) => typeof x === 'number' && Number.isFinite(x);
const esEnteroNoNeg = (x) => Number.isInteger(x) && x >= 0;
const tam = (p) => { try { return statSync(p).size; } catch { return null; } };

try {
  console.log(`[SMOKE-SERVIDOR${HIJO ? ' · hijo locutor encendido' : ''}] base temporal:`, dir);

  if (HIJO) {
    // ---- Solo el locutor encendido, y la base SIN db.location() ----
    // Una propiedad propia tapa el método del prototipo: para estado/base.js es un node:sqlite
    // sin location(), y tiene que caer a DB_PATH de database.js. Va antes del primer pedido
    // porque los agregados se cachean 5 s.
    db.location = undefined;
    check(typeof db.location !== 'function', 'doble: la conexión ya no tiene location()');
    const a = await pedir('/api/admin/servidor', { user: ADMIN });
    const b = a.data?.base ?? {};
    check(b.bytes === tam(DB_PATH) && b.bytes > 0 && b.wal_bytes === (tam(`${DB_PATH}-wal`) ?? 0),
      'sin location(): base.bytes y wal_bytes salen de DB_PATH (los mismos que un stat)', `${corto(b)} vs ${tam(DB_PATH)}/${tam(`${DB_PATH}-wal`)}`);
    const sinBarras = JSON.stringify(DB_PATH).slice(1, -1);
    check(!a.text.includes(DB_PATH) && !a.text.includes(sinBarras) && !a.text.includes('test.db'),
      'sin location(): la ruta tampoco sale en el JSON');
    const l = a.data?.locutor;
    check(a.status === 200 && l && typeof l === 'object', 'locutor encendido → objeto', corto(l));
    check(l?.cliente?.encendido === true && typeof l?.cliente?.circuito === 'string' && esEnteroNoNeg(l?.cliente?.fallosSeguidos),
      'locutor.cliente: { encendido: true, circuito, fallosSeguidos }', corto(l?.cliente));
    const s = l?.servicio;
    check(s && esEnteroNoNeg(s.cache) && esEnteroNoNeg(s.cola) && typeof s.trabajando === 'boolean'
      && esEnteroNoNeg(s.generadas) && esEnteroNoNeg(s.errores) && typeof s.rechazos === 'object',
    'locutor.servicio: contadores con sus tipos', corto(s));
    check(!a.text.includes('127.0.0.1:9') && !a.text.includes('ollama-smoke'), 'la URL de Ollama NO sale en el JSON');
  } else {
    // ---- 1. Sin sesión ----
    console.log('\n1. sin token');
    check((await pedir('/api/servidor')).status === 401, '/api/servidor sin token → 401');
    check((await pedir('/api/admin/servidor')).status === 401, '/api/admin/servidor sin token → 401');

    // ---- 2. Usuario normal ----
    console.log('\n2. usuario normal');
    {
      const r = await pedir('/api/servidor', { user: USER });
      check(r.status === 200, '/api/servidor → 200', String(r.status));
      check(r.data?.admin === false, 'admin: false', corto(r.data));
      check(r.data?.estado === 'sin_datos', 'recién arrancado (< 30 s) → estado sin_datos', r.data?.estado);
      check(typeof r.data?.version === 'string' && /^\d+\.\d+\.\d+$/.test(r.data.version) && r.data.version === VERSION,
        `version = la primera numerada del CHANGELOG (${VERSION})`, r.data?.version);
      check(esEnteroNoNeg(r.data?.uptime_s), 'uptime_s entero ≥ 0', String(r.data?.uptime_s));
      check(JSON.stringify(Object.keys(r.data ?? {})) === JSON.stringify(['estado', 'version', 'uptime_s', 'admin']),
        'solo las 4 claves', Object.keys(r.data ?? {}).join(','));
      const a = await pedir('/api/admin/servidor', { user: USER });
      check(a.status === 403, '/api/admin/servidor → 403', String(a.status));
    }

    // ---- 3. Admin: todos los campos con sus tipos ----
    console.log('\n3. admin');
    {
      const r = await pedir('/api/servidor', { user: ADMIN });
      check(r.status === 200 && r.data?.admin === true, '/api/servidor → admin: true', corto(r.data));

      muestreador.tomar();   // una ventana cerrada, para que event_loop no sea null
      const a = await pedir('/api/admin/servidor', { user: ADMIN });
      const d = a.data ?? {};
      check(a.status === 200, '/api/admin/servidor → 200', String(a.status));
      check(d.version === VERSION && typeof d.version_paquete === 'string' && /^\d+\.\d+\.\d+$/.test(d.version_paquete),
        'version (CHANGELOG) y version_paquete (package.json)', `${d.version} / ${d.version_paquete}`);
      check(d.node === process.version, 'node', d.node);
      check(esEnteroNoNeg(d.uptime_s), 'uptime_s', String(d.uptime_s));
      check(esEnteroNoNeg(d.memoria?.rss) && esEnteroNoNeg(d.memoria?.heap) && d.memoria.rss > 0,
        'memoria { rss, heap } en bytes', corto(d.memoria));
      const el = d.event_loop;
      check(el && esNum(el.p50) && esNum(el.p99) && esNum(el.max) && el.p50 >= 0 && el.p50 <= el.p99 && el.p99 <= el.max,
        'event_loop { 0 ≤ p50 ≤ p99 ≤ max } en ms (monitor real, ya descontado)', corto(el));
      const m = d.muestras;
      check(Array.isArray(m) && m.length >= 1 && m.every((x) => esNum(x.t) && esNum(x.p99) && esNum(x.max) && esEnteroNoNeg(x.rss))
        && m.every((x) => JSON.stringify(Object.keys(x)) === '["t","p99","max","rss"]'),
      'muestras [{ t, p99, max, rss }]', corto(m?.[0]));
      const b = d.base ?? {};
      check(esEnteroNoNeg(b.bytes) && b.bytes > 0 && esEnteroNoNeg(b.wal_bytes), 'base.bytes > 0 y base.wal_bytes ≥ 0', corto(b));
      check(typeof db.location === 'function' && b.bytes === tam(DB_PATH) && b.wal_bytes === (tam(`${DB_PATH}-wal`) ?? 0),
        'con location(): bytes y wal_bytes = un stat del archivo', `${corto(b)} vs ${tam(DB_PATH)}/${tam(`${DB_PATH}-wal`)}`);
      check(b.pistas === 2, 'base.pistas = 2', String(b.pistas));
      check(b.ultimo_escaneo === '2026-11-20 10:00:02', 'base.ultimo_escaneo = el scanned_at más nuevo', b.ultimo_escaneo);
      check(d.videos === 'unavailable', 'videos = estadoIndice() (sin VIDEO_DIR: unavailable)', d.videos);
      check(d.locutor === null, 'locutor apagado (sin OLLAMA_URL) → null', corto(d.locutor));
      check(esEnteroNoNeg(d.sqlite_busy) && esEnteroNoNeg(d.errores_500), 'sqlite_busy y errores_500 enteros', `${d.sqlite_busy} / ${d.errores_500}`);
      const claves = ['version', 'version_paquete', 'node', 'uptime_s', 'memoria', 'event_loop', 'muestras', 'base', 'videos', 'locutor', 'sqlite_busy', 'errores_500'];
      check(JSON.stringify(Object.keys(d)) === JSON.stringify(claves), 'exactamente las 12 claves', Object.keys(d).join(','));

      // ---- 4. Nada que no deba salir ----
      console.log('\n4. lo que no sale');
      const t = a.text;
      const conBarras = JSON.stringify(DB_PATH).slice(1, -1);   // la ruta como queda escapada en un JSON
      check(!t.includes(DB_PATH) && !t.includes(conBarras) && !t.includes('test.db') && !t.includes(dir.split(/[\\/]/).pop()),
        'el JSON admin NO trae la ruta de la base');
      check(!t.includes(SECRETO), 'el JSON admin NO trae JWT_SECRET');
      check(!/MUSIC_DB_PATH|JWT_SECRET|OLLAMA_URL|VIDEO_DIR|MUSIC_DIR/.test(t), 'ni nombres de variables de entorno');
      check(!t.includes('smoke-srv-') && !new RegExp(`\\b(${ADMIN}|${USER})\\b`).test(t), 'ni usuarios (nombres o ids)');
      check(!/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(t), 'ni IPs');
    }

    // ---- 5. El buffer no pasa de 360 ----
    console.log('\n5. buffer circular');
    {
      for (let i = 0; i < 400; i++) muestreador.tomar();
      const d = (await pedir('/api/admin/servidor', { user: ADMIN })).data;
      check(CAPACIDAD === 360 && d.muestras.length === 360, `tras 401 tomas, 360 muestras (no ${401})`, String(d.muestras.length));
      check(d.muestras.every((x, i, a) => i === 0 || a[i - 1].t <= x.t), 'en orden, de la más vieja a la más nueva');

      // Lo mismo con un reloj falso: el orden sobrevive a la vuelta del anillo, y la ventana corta.
      let ahora = 0;
      const f = crearMuestreador({ ahora: () => ahora, histograma: () => falso(), rss: () => 1, capacidad: 5 });
      f.iniciar();
      for (let i = 1; i <= 8; i++) { ahora = i * 10_000; f.tomar(); }
      const ts = f.muestras().map((x) => x.t / 10_000);
      check(JSON.stringify(ts) === '[4,5,6,7,8]', 'anillo de 5 tras 8 tomas: las 5 últimas, en orden', JSON.stringify(ts));
      check(JSON.stringify(f.muestras(25_000).map((x) => x.t / 10_000)) === '[6,7,8]', 'muestras(25 s) corta por tiempo');
      f.detener();
    }

    // ---- 6a. El descuento de la resolución y el piso en 0 ----
    console.log(`\n6a. descuento de la resolución (${RESOLUCION_MS} ms) y piso en 0`);
    {
      const una = (valores, extra = {}) => {
        const f = crearMuestreador({ histograma: () => crudo(valores), rss: () => 1, ...extra });
        f.iniciar(); const m = f.tomar(); f.detener();
        return { p50: m.p50, p99: m.p99, max: m.max };
      };
      const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      check(RESOLUCION_MS === 20, 'RESOLUCION_MS = 20');
      // El reposo crudo medido en Windows (sub-paso 1): 31,31 / 32,93 / 33,08.
      let r = una({ p50: 31.31, p99: 32.93, max: 33.08 });
      check(igual(r, { p50: 11.31, p99: 12.93, max: 13.08 }), 'crudo 31,31/32,93/33,08 → atraso 11,31/12,93/13,08', corto(r));
      // p99 MENOR que la resolución (un disparo que llegó antes): piso en 0, nunca negativo.
      r = una({ p50: 10, p99: 15, max: 40 });
      check(igual(r, { p50: 0, p99: 0, max: 20 }), 'p50 10 y p99 15 (< 20) → 0 y 0; máx 40 → 20', corto(r));
      r = una({ p50: 0.02, p99: 19.99, max: 20 });
      check(igual(r, { p50: 0, p99: 0, max: 0 }), 'justo en la resolución o por debajo → 0', corto(r));
      r = una({ p50: 20.01, p99: 215.48, max: 215.48 });
      check(igual(r, { p50: 0.01, p99: 195.48, max: 195.48 }), 'un bloqueo crudo de 215,48 → 195,48', corto(r));
      // La resolución es la del monitor: con otra, se descuenta esa.
      r = una({ p50: 12, p99: 15, max: 30 }, { resolucionMs: 10 });
      check(igual(r, { p50: 2, p99: 5, max: 20 }), 'con resolucionMs 10 se resta 10', corto(r));
      // Y el estado mira el atraso, no el crudo: un crudo de 115 es atraso 95 → ok; 120 → 100 → lento.
      let ahora = 0; let v = { p50: 21, p99: 115, max: 115 };
      const f = crearMuestreador({ ahora: () => ahora, histograma: () => crudo(() => v), rss: () => 1 });
      f.iniciar(); ahora = 31_000; f.tomar();
      check(estadoDe(f) === 'ok', 'crudo p99 115 (atraso 95) → ok, aunque 115 ≥ 100', estadoDe(f));
      v = { p50: 21, p99: LENTO_MS + RESOLUCION_MS, max: 130 }; ahora += 10_000; f.tomar();
      check(estadoDe(f) === 'lento', `crudo p99 ${LENTO_MS + RESOLUCION_MS} (atraso ${LENTO_MS}) → lento`, estadoDe(f));
      f.detener();
    }

    // ---- 6b. estado/base.js con dobles: con y sin db.location() ----
    console.log('\n6b. tamaño de la base: location() o DB_PATH');
    {
      const otro = join(dir, 'otro.db');
      writeFileSync(otro, Buffer.alloc(1234));
      writeFileSync(`${otro}-wal`, Buffer.alloc(77));
      const prepare = (sql) => db.prepare(sql);
      const leer = (conexion, rutaRespaldo) => crearLectorBase({ conexion, rutaRespaldo, cacheMs: 0 })();
      const conLoc = leer({ prepare, location: () => otro }, DB_PATH);
      check(conLoc.bytes === 1234 && conLoc.wal_bytes === 77, 'con location(): usa SU ruta y no el respaldo (1234 / 77)', corto(conLoc));
      const sinLoc = leer({ prepare }, otro);
      check(sinLoc.bytes === 1234 && sinLoc.wal_bytes === 77, 'sin location(): cae a la ruta de respaldo (1234 / 77)', corto(sinLoc));
      const real = leer({ prepare }, DB_PATH);
      check(real.bytes === tam(DB_PATH) && real.wal_bytes === (tam(`${DB_PATH}-wal`) ?? 0) && real.pistas === 2,
        'sin location() y respaldo = DB_PATH: los mismos números que un stat', corto(real));
      const enMemoria = leer({ prepare, location: () => null }, DB_PATH);
      check(enMemoria.bytes === null && enMemoria.wal_bytes === null, 'location() → null (en memoria): null, sin usar el respaldo', corto(enMemoria));
      const nada = leer({ prepare }, null);
      check(nada.bytes === null && nada.wal_bytes === null && nada.pistas === 2, 'ni location() ni respaldo: tamaños null, el resto igual', corto(nada));
      rmSync(`${otro}-wal`);
      const sinWal = leer({ prepare, location: () => otro }, null);
      check(sinWal.bytes === 1234 && sinWal.wal_bytes === 0, 'sin archivo -wal: wal_bytes 0, no null', corto(sinWal));
      const todo = JSON.stringify([conLoc, sinLoc, real, enMemoria, nada, sinWal]);
      check(!todo.includes('otro.db') && !todo.includes('test.db') && !todo.includes(JSON.stringify(dir).slice(1, -1)),
        'ninguna salida del lector trae una ruta');
      // La caché: dentro de los 5 s devuelve lo mismo aunque el archivo cambie.
      let t = 0;
      const lector = crearLectorBase({ conexion: { prepare, location: () => otro }, ahora: () => t });
      const a1 = lector().bytes; writeFileSync(otro, Buffer.alloc(99)); t = 4_999;
      const a2 = lector().bytes; t = 5_000;
      const a3 = lector().bytes;
      check(a1 === 1234 && a2 === 1234 && a3 === 99, 'caché de 5 s: 1234, 1234 a los 4,999 s, 99 a los 5 s', `${a1} ${a2} ${a3}`);
      rmSync(otro);
    }

    // ---- 6c. Estado: umbrales y ventana, con reloj e histograma falsos ----
    console.log('\n6c. estado ok/lento/mal/sin_datos (en atrasos)');
    {
      let ahora = 1_000_000;
      let p99 = 0;
      const f = crearMuestreador({ ahora: () => ahora, histograma: () => falso(() => p99), rss: () => 1 });
      check(estadoDe(f) === 'sin_datos', 'sin iniciar → sin_datos');
      f.iniciar();
      const paso = (s, valor) => { ahora += s * 1000; p99 = valor; f.tomar(); };
      paso(10, 5); paso(10, 5);
      check(estadoDe(f) === 'sin_datos', 'a los 20 s, aunque haya muestras → sin_datos');
      paso(10, 5);
      check(estadoDe(f) === 'ok', 'a los 30 s con p99 5 ms → ok', estadoDe(f));
      paso(10, LENTO_MS - 0.01);
      check(estadoDe(f) === 'ok', `p99 ${LENTO_MS - 0.01} → ok`);
      paso(10, LENTO_MS);
      check(estadoDe(f) === 'lento', `p99 ${LENTO_MS} → lento`, estadoDe(f));
      paso(10, MAL_MS);
      check(estadoDe(f) === 'mal', `p99 ${MAL_MS} → mal`, estadoDe(f));
      // El pico de 500 ms queda atrás: 60 s después de él ya no está en la ventana.
      for (let i = 0; i < 5; i++) paso(10, 5);
      check(estadoDe(f) === 'mal', 'a los 50 s del pico, sigue en la ventana → mal', estadoDe(f));
      paso(10, 5);
      check(estadoDe(f) === 'mal', 'a los 60 s justos del pico, el borde cuenta (t ≥ corte) → mal', estadoDe(f));
      paso(10, 5);
      check(estadoDe(f) === 'ok', 'a los 70 s del pico → ok');
      ahora += 120_000;   // dos minutos sin tomar (el timer no corre)
      check(estadoDe(f) === 'sin_datos', 'sin muestras en el último minuto → sin_datos', estadoDe(f));
      f.detener();
    }

    // ---- 7. SQLITE_BUSY provocado ----
    console.log('\n7. SQLITE_BUSY');
    {
      const antes = (await pedir('/api/admin/servidor', { user: ADMIN })).data;
      // Otra conexión a la MISMA base temporal toma el lock de escritura y no lo suelta.
      const otra = new DatabaseSync(DB_PATH);
      otra.exec('BEGIN IMMEDIATE');
      otra.exec("INSERT INTO plays (user_id, track_id, played_at, client_id) VALUES (900002, 800001, 1, 'smoke-srv-lock')");
      let plays, alta;
      try {
        // plays.js: la fila choca con el lock → skipped, y el lote sigue saliendo 201 (sin cambios).
        plays = await pedir('/api/plays', { user: USER, method: 'POST', body: { plays: [{ track_id: 800001, played_at: 2, client_id: 'smoke-srv-1' }] } });
        // admin-users → createUser → handle(): un BUSY no es UserError, sale 500 genérico.
        alta = await pedir('/api/admin/users', { user: ADMIN, method: 'POST', body: { username: 'smoke-srv-nuevo', password: 'clave-de-prueba-123' } });
      } finally {
        otra.exec('ROLLBACK');
        otra.close();
      }
      check(plays.status === 201 && JSON.stringify(plays.data) === '{"added":0,"already":0,"skipped":1}',
        'POST /api/plays con lock → 201 { skipped: 1 } (igual que antes)', `${plays.status} ${corto(plays.data)}`);
      check(alta.status === 500 && JSON.stringify(alta.data) === '{"error":"Internal error"}',
        'POST /api/admin/users con lock → 500 genérico (igual que antes)', `${alta.status} ${corto(alta.data)}`);
      const desp = (await pedir('/api/admin/servidor', { user: ADMIN })).data;
      check(desp.sqlite_busy - antes.sqlite_busy === 2, 'sqlite_busy +2 (plays.js y handle.js)', `${antes.sqlite_busy} → ${desp.sqlite_busy}`);
      check(desp.errores_500 - antes.errores_500 === 1, 'errores_500 +1 (el de admin-users)', `${antes.errores_500} → ${desp.errores_500}`);

      // Sin lock, lo mismo pasa sin contar nada.
      const ok = await pedir('/api/plays', { user: USER, method: 'POST', body: { plays: [{ track_id: 800001, played_at: 3, client_id: 'smoke-srv-2' }] } });
      const fin = (await pedir('/api/admin/servidor', { user: ADMIN })).data;
      check(ok.status === 201 && ok.data?.added === 1 && fin.sqlite_busy === desp.sqlite_busy, 'sin lock: added 1 y el contador no se mueve');

      // esBusy reconoce el extendido 517 (BUSY_SNAPSHOT) y no el 6 (LOCKED) ni otros.
      check(esBusy({ errcode: 5 }) && esBusy({ errcode: 517 }) && !esBusy({ errcode: 6 }) && !esBusy({ errcode: 19 }) && !esBusy(new Error('database is locked')) && !esBusy(null),
        'esBusy: 5 y 517 sí; 6, 19, un Error suelto y null no');
    }
  }
} finally {
  muestreador.detener();
  server.close();
  try { db.close(); } catch {}
  rmSync(dir, { recursive: true, force: true });
}

// Un histograma de mentira con valores CRUDOS en ms (lo que daría el monitor real, resolución
// incluida); el muestreador los pasa a ns → ms y les resta la resolución.
function crudo(v) {
  const x = typeof v === 'function' ? v : () => v;
  return {
    count: 1,
    enable() {}, disable() {}, reset() {},
    percentile: (q) => (q === 50 ? x().p50 : x().p99) * 1e6,
    get max() { return x().max * 1e6; },
  };
}
// Para pensar en ATRASOS: el histograma devuelve RESOLUCION_MS + atraso, con el p99 que diga la
// función, el p50 la mitad y el máx el doble. Tras el descuento quedan exactamente esos atrasos.
function falso(p99 = () => 1) {
  return crudo(() => ({ p50: RESOLUCION_MS + p99() / 2, p99: RESOLUCION_MS + p99(), max: RESOLUCION_MS + p99() * 2 }));
}

if (!HIJO) {
  console.log('\n8. proceso hijo: locutor encendido y la base sin db.location()');
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--locutor-encendido'], {
    encoding: 'utf8', env: { ...process.env, OLLAMA_URL: URL_OLLAMA }, timeout: 60_000,
  });
  const lineas = (r.stdout ?? '').split('\n').filter((l) => /^\s+(ok|FALLA)\s/.test(l));
  for (const l of lineas) console.log(l);
  const ok = lineas.filter((l) => l.trim().startsWith('ok')).length;
  const mal = lineas.length - ok;
  pass += ok; fail += mal;
  if (r.status !== 0 && !mal) { fail++; console.log(`  FALLA el hijo salió con ${r.status}: ${(r.stderr ?? '').slice(0, 300)}`); }
}

console.log(`\n[SMOKE-SERVIDOR${HIJO ? ' · hijo' : ''}] ${pass} ok · ${fail} fallas`);
if (fail) process.exit(1);
