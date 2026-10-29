// Smoke test de /.well-known/apple-app-site-association (universal links de iOS).
//
// CÓMO SE CORRE
//   npm run smoke:wellknown
// Levanta SU PROPIO servidor (node server.js) contra una base TEMPORAL, como smoke-login, y lo
// levanta DOS veces:
//   1. SIN music-server/public/ (desarrollo): el AASA y cualquier otra ruta de /.well-known/ dan 404
//      limpio y el servidor sigue vivo.
//   2. CON public/: server.js solo sirve el frontend si ese directorio existe (DIST no se puede
//      cambiar por variable), así que el test lo CREA con un index.html de relleno y el AASA REAL
//      del cliente (music-client/public/.well-known/), y lo BORRA al terminar. public/ está en
//      .gitignore: no ensucia git y no pide ninguna variable nueva. Si ya existe (alguien corrió
//      `npm run build`), el test se niega a tocarlo.
//
// Lo que NO prueba: que Apple acepte el archivo, ni que Vite y Docker lo lleven a la imagen. Eso
// solo se sabe desplegado.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(RAIZ, 'public');
const AASA_REAL = join(RAIZ, '..', 'music-client', 'public', '.well-known', 'apple-app-site-association');
const APP_ID = 'GV8L7367WN.com.sonorarev.app';
const INDEX = '<!doctype html><title>spa</title>';
const PORT = 3998;
const BASE = `http://localhost:${PORT}`;
const SECRETO = 'smoke-wellknown';

if (existsSync(PUBLIC)) {
  console.error(`Ya existe ${PUBLIC} (¿un 'npm run build' local?). No lo toco: bórralo o corre esto en otra copia.`);
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'sonorarev-wellknown-'));
let creamosPublic = false;
const limpiar = () => {
  if (creamosPublic) { rmSync(PUBLIC, { recursive: true, force: true }); creamosPublic = false; }
  rmSync(dir, { recursive: true, force: true });
};
process.on('exit', limpiar);

let pass = 0;
let fail = 0;
function check(ok, label, detalle = '') {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FALLA ${label}${detalle ? `  → ${detalle}` : ''}`); }
}

function entorno() {
  const env = { ...process.env };
  for (const k of ['GOOGLE_IOS_CLIENT_ID', 'GOOGLE_FAKE', 'CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD', 'PASSWORD_VIEW_KEY', 'OLLAMA_URL']) delete env[k];
  return { ...env, NODE_ENV: 'development', PORT: String(PORT), JWT_SECRET: SECRETO, MUSIC_DB_PATH: join(dir, 'test.db') };
}

let srv = null;
async function levantar() {
  const hijo = spawn(process.execPath, ['server.js'], { cwd: RAIZ, env: entorno(), stdio: ['ignore', 'pipe', 'pipe'] });
  let salida = '';
  hijo.stdout.on('data', (d) => { salida += d; });
  hijo.stderr.on('data', (d) => { salida += d; });
  srv = { hijo, salida: () => salida };
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* todavía no */ }
    if (hijo.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`el servidor no levantó:\n${salida}`);
}
function apagar() {
  if (!srv || srv.hijo.exitCode !== null) return Promise.resolve();
  return new Promise((r) => { srv.hijo.once('exit', r); srv.hijo.kill(); });
}
const pedir = (ruta, opts) => fetch(`${BASE}${ruta}`, { redirect: 'manual', ...opts });

try {
  // ---- 1. Sin public/ (desarrollo) ----
  console.log('\n[1] sin music-server/public/');
  await levantar();
  {
    const a = await pedir('/.well-known/apple-app-site-association');
    check(a.status === 404, 'el AASA da 404 (no hay DIST)', `status ${a.status}`);
    const o = await pedir('/.well-known/otra-cosa');
    check(o.status === 404, 'otra ruta de /.well-known/ da 404', `status ${o.status}`);
    check((await pedir('/api/health')).ok, 'el servidor sigue vivo y contesta /api/health');
    check(!/Error|ENOENT|TypeError/.test(srv.salida()), 'sin errores en la salida del servidor', srv.salida().slice(-200));
  }
  await apagar();

  // ---- 2. Con public/ (producción) ----
  console.log('\n[2] con music-server/public/ (index.html de relleno + el AASA real del cliente)');
  mkdirSync(join(PUBLIC, '.well-known'), { recursive: true });
  creamosPublic = true;
  writeFileSync(join(PUBLIC, 'index.html'), INDEX);
  copyFileSync(AASA_REAL, join(PUBLIC, '.well-known', 'apple-app-site-association'));
  // Un archivo de más bajo .well-known: tiene que dar 404 aunque exista en disco.
  writeFileSync(join(PUBLIC, '.well-known', 'assetlinks.json'), '[]');
  await levantar();
  {
    const a = await pedir('/.well-known/apple-app-site-association');
    const cuerpo = await a.text();
    check(a.status === 200, 'AASA: 200 (sin redirección)', `status ${a.status}`);
    check((a.headers.get('content-type') ?? '').startsWith('application/json'), 'AASA: Content-Type application/json', a.headers.get('content-type'));
    let json = null;
    try { json = JSON.parse(cuerpo); } catch { /* queda null */ }
    check(json !== null, 'AASA: JSON parseable', cuerpo.slice(0, 60));
    check(JSON.stringify(json).includes(APP_ID), `AASA: contiene el appID ${APP_ID}`);
    check(cuerpo === readFileSync(AASA_REAL, 'utf8'), 'AASA: es exactamente el archivo del cliente');
    check(a.headers.get('location') === null, 'AASA: sin cabecera Location');

    const o = await pedir('/.well-known/otra-cosa');
    check(o.status === 404 && !(await o.text()).includes('<title>'), 'otra ruta de /.well-known/ da 404 (no el index.html)', `status ${o.status}`);
    const al = await pedir('/.well-known/assetlinks.json');
    check(al.status === 404, '/.well-known/assetlinks.json da 404 aunque exista en disco (no se sirve todavía)', `status ${al.status}`);
    const p = await pedir('/.well-known/apple-app-site-association', { method: 'POST' });
    check(p.status === 404, 'el AASA no responde a POST', `status ${p.status}`);

    for (const ruta of ['/', '/albums/x/y', '/albums/Daft%20Punk/Discovery']) {
      const r = await pedir(ruta);
      const t = await r.text();
      check(r.status === 200 && (r.headers.get('content-type') ?? '').startsWith('text/html') && t === INDEX, `${ruta} sigue dando index.html con 200`, `status ${r.status}`);
    }
    const n = await pedir('/api/nada');
    check(n.status === 404, '/api/nada sigue dando 404', `status ${n.status}`);
    check((await pedir('/api/health')).ok, '/api/health sigue contestando');
  }
  await apagar();
} catch (e) {
  fail++;
  console.log(`  FALLA ${e.stack ?? e}`);
  await apagar();
}

limpiar();
console.log(`\nRESULTADO smoke:wellknown — ${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
