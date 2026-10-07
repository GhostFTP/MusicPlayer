// regresion.mjs — la REGRESIÓN COMPLETA en un comando, con veredicto determinista contra baseline.json.
// El conteo lo hace este código, no un modelo: cada script se normaliza a {ok,total} y se compara con
// lo esperado; lo que no se puede leer es NO CORRIÓ, nunca PASA ni FALLA.
//
//   node regresion.mjs [--solo a,b] [--sin-build] [--baseline <ruta>]
//
// Qué hace (calca perf-lab §3 y §5):
//   1. Preflight: 3100 y 4173 tienen que estar LIBRES (conexión rechazada). Si alguno responde, no se
//      toca nada: NO CORRIÓ y código 2. Anota qué responde :3000 (otro proyecto: no se toca).
//   2. npm run build en music-client (fila "build"; --sin-build la omite).
//   3. BASE AISLADA POR CORRIDA: copia la base (MUSIC_DB_PATH si viene; si no, music-server/data/music.db)
//      byte a byte —con su -wal si existe; el original no se abre con SQLite— a un directorio temporal
//      ÚNICO, y el backend arranca contra la COPIA (fav-func, plays-func, nav-real… escriben, y la
//      creación perezosa de "Mis favoritos" no es determinista contra una base ya usada). La copia se
//      borra al cerrar. Crea en la copia la SEGUNDA CUENTA que necesita albview-func con el CLI que el
//      backend ya trae (src/admin/users.js create --generate, lo mismo que `npm run users`): usuario
//      aleatorio, contraseña generada por el CLI, pasadas al script por env (SNAP2_USER/SNAP2_PASS);
//      nunca se imprimen ni se escriben. Levanta SU backend (node server.js, PORT=3100) y SU preview
//      (vite preview en 4173, config en el mismo directorio temporal, proxy a :3100). Nunca sonorarev.com.
//      VIDEOS: genera los 3 fixtures sintéticos de video-fixtures.mjs en <temporal>/videos y le pasa
//      VIDEO_DIR=<esa carpeta> al backend SIEMPRE (pisa cualquier VIDEO_DIR del entorno o del .env: el
//      real nunca se lee). Se borran con el resto del temporal. Sin ffmpeg: fila "video-fixtures" NO
//      CORRIÓ, VIDEO_DIR queda apuntando a la carpeta vacía y los demás scripts corren igual.
//   4. Corre los scripts del baseline en orden, uno por vez (cwd = esta carpeta, SNAP_BASE=:4173, CPU=1),
//      con tope de 5 min cada uno.
//   5. Apaga SÓLO lo que lanzó (taskkill /T /F sobre los PIDs de SUS hijos; nunca por puerto ni por
//      nombre), en finally y en Ctrl+C. Al cerrar: 3100/4173 en 000 y :3000 igual que al empezar.
//   6. Tabla en stdout y reporte .md en shots/reports/ (sólo si git confirma que la carpeta está
//      ignorada).
// Código de salida: 0 todo PASA · 1 alguna FALLA · 2 algún NO CORRIÓ o preflight.
import { spawn, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync, rmSync, copyFileSync, mkdtempSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearFixtures, SinFfmpeg } from './video-fixtures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..');
const CLIENT = join(REPO, 'music-client');
const SERVER = join(REPO, 'music-server');
const PORT_API = 3100;
const PORT_WEB = 4173;
const BASE = `http://localhost:${PORT_WEB}`;
const SCRIPT_TIMEOUT_MS = 5 * 60 * 1000;
const WIN = process.platform === 'win32';

// ── argumentos ──
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const SOLO = arg('--solo')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;
const SIN_BUILD = argv.includes('--sin-build');
const BASELINE_PATH = resolve(arg('--baseline') ?? join(HERE, 'baseline.json'));

const t0 = Date.now();
const log = (...a) => console.log('[regresion]', ...a);
const rows = [];   // { nombre, esperado, obtenido, estado, detalle, ms }
const add = (r) => { rows.push(r); log(`${r.nombre.padEnd(14)} ${r.estado}${r.detalle ? ' · ' + r.detalle : ''}`); };

// ── utilidades de red / procesos ──
function portOpen(port) {   // true = alguien escucha; false = conexión rechazada
  return new Promise((res) => {
    const s = createConnection({ host: '127.0.0.1', port });
    const done = (v) => { s.destroy(); res(v); };
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
    s.setTimeout(2000, () => done(true));
  });
}
async function httpCode(url) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(3000), redirect: 'manual' }); return String(r.status); }
  catch { return '000'; }
}
const children = [];   // { name, proc }
function launch(name, cmd, args, opts) {
  const proc = spawn(cmd, args, { ...opts, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; if (out.length > 20000) out = out.slice(-20000); });
  proc.stderr.on('data', (d) => { out += d; if (out.length > 20000) out = out.slice(-20000); });
  const c = { name, proc, get out() { return out; } };
  children.push(c);
  return c;
}
function killTree(pid) {
  if (!pid) return;
  if (WIN) spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true, stdio: 'ignore' });
  else { try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch {} } }
}
let stopped = false;
function stopAll() {
  if (stopped) return;
  stopped = true;
  for (const c of children) if (c.proc.exitCode == null) killTree(c.proc.pid);
}
async function waitFor(url, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if ((await httpCode(url)) === '200') return true; await new Promise((r) => setTimeout(r, 500)); }
  return false;
}
process.on('SIGINT', () => { log('Ctrl+C: apago lo que lancé'); stopAll(); process.exit(130); });

// Corre un comando y espera; mata su árbol si pasa el tope.
function runCmd(cmd, args, opts, timeoutMs) {
  return new Promise((res) => {
    const c = launch(opts.label ?? cmd, cmd, args, opts);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killTree(c.proc.pid); }, timeoutMs);
    c.proc.on('close', (code) => { clearTimeout(timer); res({ code, out: c.out, timedOut }); });
    c.proc.on('error', (e) => { clearTimeout(timer); res({ code: -1, out: c.out + '\n' + e.message, timedOut }); });
  });
}

// ── normalizadores: salida cruda → { ok, total, fallan[], info{} } o { error } ──
function jsonBlock(out) {
  // Los scripts imprimen JSON.stringify(R, null, 1): empieza con una línea "{" y cierra con "}" en col 0.
  const lines = out.split(/\r?\n/);
  const a = lines.indexOf('{');
  if (a < 0) return null;
  let b = -1;
  for (let i = lines.length - 1; i > a; i--) if (lines[i] === '}') { b = i; break; }
  if (b < 0) return null;
  try { return JSON.parse(lines.slice(a, b + 1).join('\n')); } catch { return null; }
}
const isPass = (v) => v === true || (v && typeof v === 'object' && !Array.isArray(v) && v.ok === true);
const isFail = (v) => v === false || (v && typeof v === 'object' && !Array.isArray(v) && v.ok === false);
const failKeys = (o) => (o ? Object.entries(o).filter(([, v]) => isFail(v)).map(([k]) => k) : []);

const PARSE = {
  'ok-line'(out) {
    const m = out.match(/^OK (\d+)\/(\d+)(?: · falla: (.*))?$/m);
    if (!m) return { error: 'no aparece la línea "OK n/m"' };
    return { ok: +m[1], total: +m[2], fallan: m[3] ? m[3].split(',').map((s) => s.trim()) : [] };
  },
  'name-line'(out, s, code) {
    const re = new RegExp(`^${s.nombre.replace(/[-]/g, '\\-')}: (\\d+)\\/(\\d+)\\s*$`, 'm');
    const m = out.match(re);
    if (!m) return { error: `no aparece la línea "${s.nombre}: n/m"` };
    const ok = +m[1], total = +m[2];
    if ((ok === total) !== (code === 0)) return { error: `código de salida ${code} no coincide con ${ok}/${total}` };
    return { ok, total, fallan: failKeys(jsonBlock(out)) };
  },
  json(out, s) {
    const o = jsonBlock(out);
    if (!o) return { error: 'no hay un JSON legible en la salida' };
    const info = s.informativos ?? {};
    let ok = 0, total = 0; const fallan = []; const raros = [];
    for (const [k, v] of Object.entries(o)) {
      if (k in info) continue;
      if (isPass(v)) { ok++; total++; } else if (isFail(v)) { total++; fallan.push(k); } else raros.push(k);
    }
    if (raros.length) return { error: `claves no booleanas fuera de "informativos": ${raros.join(', ')}` };
    const notas = [];
    for (const [k, rule] of Object.entries(info)) {
      const v = o[k];
      let bien = v !== undefined;
      if (rule.igual !== undefined) bien = v === rule.igual;
      if (rule.textoNoVacio) bien = typeof v === 'string' && v.trim() !== '';
      if (rule.algunaActiva) bien = Array.isArray(v) && v.some((x) => x && x.active != null);
      notas.push(`${k}=${bien ? 'ok' : '⚠ ' + JSON.stringify(v)?.slice(0, 60)}`);
    }
    return { ok, total, fallan, notas };
  },
  rows(out, s) {
    const got = {};
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^\[cpu x\d+\] (.+?)\s*: (\{.*\})\s*$/);
      if (!m) continue;
      try { got[m[1].trim()] = JSON.parse(m[2]).rerendered; } catch { /* línea sin JSON */ }
    }
    const exp = s.esperado;
    const faltan = Object.keys(exp).filter((k) => !(k in got));
    if (faltan.length) return { error: `faltan líneas de rows: ${faltan.join(', ')}` };
    const fallan = Object.entries(exp).filter(([k, v]) => got[k] !== v).map(([k, v]) => `${k} ${got[k]}≠${v}`);
    const notas = Object.entries(s.informativos ?? {}).map(([k, v]) => `${k}=${got[k] === v ? 'ok' : '⚠ ' + got[k]}`);
    return { ok: Object.keys(exp).length - fallan.length, total: Object.keys(exp).length, fallan, notas, rowsMode: true };
  },
};

// Veredicto: PASA si el total coincide, no hay menos aciertos que los esperados y todo lo que falla
// está en "tolerados". Un tolerado que pasa sigue siendo PASA (con nota: el baseline se actualiza a mano).
function veredicto(s, r) {
  const exp = s.modo === 'rows' ? { ok: Object.keys(s.esperado).length, total: Object.keys(s.esperado).length } : s.esperado;
  const tol = new Set(s.tolerados ?? []);
  const noTolerados = r.fallan.filter((k) => !tol.has(k.split(' ')[0]));
  const notas = [...(r.notas ?? [])];
  let estado;
  if (r.total !== exp.total) estado = `FALLA(total ${r.total}≠${exp.total}${r.fallan.length ? ': ' + r.fallan.join(', ') : ''})`;
  else if (noTolerados.length) estado = `FALLA(${noTolerados.join(', ')})`;
  else if (r.ok < exp.ok) estado = `FALLA(${r.ok}<${exp.ok}${r.fallan.length ? ': ' + r.fallan.join(', ') : ''})`;
  else {
    estado = 'PASA';
    if (r.ok > exp.ok) notas.push('mejor que el baseline (un tolerado pasó): actualizar baseline A MANO');
    if (r.fallan.length) notas.push(`tolerado: ${r.fallan.join(', ')}`);
  }
  return { esperado: `${exp.ok}/${exp.total}`, obtenido: `${r.ok}/${r.total}`, estado, detalle: notas.join(' · ') };
}

function requisitos(s) {
  const q = s.requiere;
  if (!q) return null;
  if (q.env) { const faltan = q.env.filter((k) => !process.env[k]); if (faltan.length) return `falta ${faltan.join(' y ')} en el entorno`; }
  if (q.ruta) {
    const base = process.env[q.ruta.env] ?? q.ruta.defecto;
    if (!existsSync(join(base, q.ruta.archivo))) return `no está ${join(base, q.ruta.archivo)} (${q.ruta.env})`;
  }
  return null;
}

// ── reporte ──
function tabla() {
  const H = ['script', 'esperado', 'obtenido', 'estado'];
  const data = rows.map((r) => [r.nombre, r.esperado ?? '—', r.obtenido ?? '—', r.estado]);
  const w = H.map((h, i) => Math.max(h.length, ...data.map((d) => String(d[i]).length)));
  const line = (d) => d.map((c, i) => String(c).padEnd(w[i])).join(' · ');
  return [line(H), w.map((n) => '-'.repeat(n)).join('-·-'), ...data.map(line)].join('\n');
}
function writeReport(header, codigo) {
  const dir = join(REPO, '.claude', 'tools', 'snap', 'shots', 'reports');
  const d = new Date(); const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // HHmmss: con sólo HHmm dos corridas en el mismo minuto (p. ej. dos --solo seguidos) se pisaban.
  const hms = [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join('');
  const parcial = SOLO || arg('--baseline') ? '-parcial' : '';
  const file = join(dir, `${ymd}-${hms}-regresion${parcial}.md`);
  const ign = spawnSync('git', ['check-ignore', '-q', file], { cwd: REPO });
  if (ign.status !== 0) { log(`⚠ ${file} NO está ignorado por git: no escribo el reporte`); return null; }
  mkdirSync(dir, { recursive: true });
  const md = [
    `# Regresión · ${new Date().toISOString()}`, '', ...header.map((h) => `- ${h}`), '',
    '| script | esperado | obtenido | estado | notas |', '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.nombre} | ${r.esperado ?? '—'} | ${r.obtenido ?? '—'} | ${r.estado} | ${(r.detalle ?? '').replace(/\|/g, '/')} |`),
    '', `Código de salida: **${codigo}** · duración ${Math.round((Date.now() - t0) / 1000)} s`, '',
  ].join('\n');
  writeFileSync(file, md);
  return file;
}

// ── principal ──
let code3000Start = '000';
let tmpRun = null;       // directorio temporal de ESTA corrida (copia de la base + config): se borra al cerrar
const startCodes = {};   // cómo estaban 3100/4173 al empezar (si el preflight aborta, tienen que quedar IGUAL)
let exitCode = 2;
const header = [];
try {
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  const scripts = baseline.scripts.filter((s) => !SOLO || SOLO.includes(s.nombre));
  if (SOLO) { const desconocidos = SOLO.filter((n) => n !== 'build' && !baseline.scripts.some((s) => s.nombre === n)); if (desconocidos.length) throw new Error(`--solo con scripts que no están en el baseline: ${desconocidos.join(', ')}`); }

  // 1. Preflight
  code3000Start = await httpCode('http://localhost:3000/');
  startCodes[PORT_API] = await httpCode(`http://localhost:${PORT_API}/`);
  startCodes[PORT_WEB] = await httpCode(`${BASE}/`);
  log(`baseline: ${BASELINE_PATH}`);
  log(`:3000 al empezar responde ${code3000Start} (no se toca)`);
  for (const p of [PORT_API, PORT_WEB]) {
    if (await portOpen(p)) {
      add({ nombre: 'preflight', estado: 'NO CORRIÓ', detalle: `el puerto ${p} ya está ocupado: no toco nada` });
      exitCode = 2;
      throw Object.assign(new Error('preflight'), { preflight: true });
    }
  }
  // Base aislada: copia byte a byte (el original no se abre con SQLite: ni su -shm se toca).
  const dbSrc = resolve(process.env.MUSIC_DB_PATH ?? join(SERVER, 'data', 'music.db'));
  if (!existsSync(dbSrc)) { add({ nombre: 'base', estado: 'NO CORRIÓ', detalle: `no existe ${dbSrc}` }); throw Object.assign(new Error('base'), { preflight: true }); }
  tmpRun = mkdtempSync(join(tmpdir(), 'regresion-'));
  const dbCopy = join(tmpRun, 'music.db');
  copyFileSync(dbSrc, dbCopy);
  if (existsSync(dbSrc + '-wal')) copyFileSync(dbSrc + '-wal', dbCopy + '-wal');
  log(`base ORIGEN: ${dbSrc} (${statSync(dbSrc).size} bytes) ${process.env.MUSIC_DB_PATH ? '(MUSIC_DB_PATH)' : '(desarrollo)'} — no se escribe`);
  log(`base COPIA:  ${dbCopy} (se borra al cerrar)`);
  header.push(`:3000 al empezar: ${code3000Start}`, `base origen: ${dbSrc} (${statSync(dbSrc).size} bytes)`, `base copia: ${dbCopy}`, `SNAP_BASE: ${BASE}`);
  // Videos sintéticos en el MISMO temporal (se borran con él). VIDEO_DIR se pasa siempre, aunque la
  // generación falle: así el backend nunca cae al VIDEO_DIR del entorno o del .env.
  const videoDir = join(tmpRun, 'videos');
  try {
    const fx = crearFixtures(videoDir);
    log(`videos: ${fx.videos.length} fixtures en ${videoDir} (${fx.videos.map((v) => `${v.rel} ${v.atomos.join(',')}`).join(' · ')})`);
    header.push(`VIDEO_DIR: ${videoDir} (${fx.videos.length} fixtures sintéticos)`);
  } catch (e) {
    mkdirSync(videoDir, { recursive: true });
    add({ nombre: 'video-fixtures', estado: 'NO CORRIÓ', detalle: e.message });
    header.push(`VIDEO_DIR: ${videoDir} (VACÍA: ${e instanceof SinFfmpeg ? 'sin ffmpeg' : 'falló la generación'})`);
  }
  const serverEnv = { ...process.env, PORT: String(PORT_API), MUSIC_DB_PATH: dbCopy, VIDEO_DIR: videoDir };

  // Segunda cuenta para albview-func, creada EN LA COPIA con el CLI del backend (sin tocar el backend).
  const u2 = `regresion-${randomBytes(4).toString('hex')}@local`;
  const mk = spawnSync(process.execPath, ['--env-file-if-exists=.env', 'src/admin/users.js', 'create', u2, '--generate'], { cwd: SERVER, env: serverEnv, encoding: 'utf8', windowsHide: true, timeout: 60000 });
  // El CLI imprime: [USERS] Usuario "<u>" creado (id=…, rol=user).  <línea vacía>  "  <contraseña>"
  const pw = mk.status === 0 ? mk.stdout.match(/creado \(id=\d+[^)]*\)\.\s*\r?\n\s*\r?\n\s+(\S+)\s*\r?\n/)?.[1] : null;
  if (pw) { process.env.SNAP2_USER = u2; process.env.SNAP2_PASS = pw; log(`segunda cuenta creada en la copia: ${u2} (contraseña generada, no se muestra)`); }
  else { delete process.env.SNAP2_USER; delete process.env.SNAP2_PASS; log(`⚠ no se pudo crear la segunda cuenta en la copia (exit ${mk.status}): albview-func va a salir NO CORRIÓ`); }

  // 2. Build
  if (!SIN_BUILD) {
    const tb = Date.now();
    const b = await runCmd(WIN ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: CLIENT, shell: WIN, label: 'build' }, SCRIPT_TIMEOUT_MS);
    const ok = b.code === baseline.build.exit && !b.timedOut;
    add({ nombre: 'build', esperado: `exit ${baseline.build.exit}`, obtenido: b.timedOut ? 'timeout' : `exit ${b.code}`, estado: ok ? 'PASA' : 'FALLA(build)', detalle: ok ? '' : b.out.split(/\r?\n/).slice(-6).join(' | '), ms: Date.now() - tb });
    if (!ok) throw new Error('build');
  } else add({ nombre: 'build', estado: 'OMITIDO', detalle: '--sin-build' });

  // 3. Servidores (hijos directos de este proceso)
  launch('backend', process.execPath, ['--env-file-if-exists=.env', 'server.js'], { cwd: SERVER, env: serverEnv });
  const cfg = join(tmpRun, 'vite-preview-regresion.config.mjs');
  writeFileSync(cfg, `export default ${JSON.stringify({ root: CLIENT.replace(/\\/g, '/'), preview: { proxy: { '/api': `http://localhost:${PORT_API}`, '/stream': `http://localhost:${PORT_API}` } } })};\n`);
  launch('preview', WIN ? 'npx.cmd' : 'npx', ['vite', 'preview', '--config', cfg, '--port', String(PORT_WEB), '--strictPort'], { cwd: CLIENT, shell: WIN });
  const upApi = await waitFor(`http://localhost:${PORT_API}/api/auth/config`);
  const upWeb = upApi && await waitFor(`${BASE}/api/auth/config`);
  if (!upApi || !upWeb) {
    const c = children.find((x) => x.name === (upApi ? 'preview' : 'backend'));
    add({ nombre: 'servidores', estado: 'NO CORRIÓ', detalle: `${upApi ? 'preview' : 'backend'} no respondió 200 en 30 s: ${c?.out.split(/\r?\n/).slice(-3).join(' | ')}` });
    throw new Error('servidores');
  }
  log(`servidores arriba: backend pid ${children[0].proc.pid}, preview pid ${children[1].proc.pid}`);

  // 4. Scripts
  for (const s of scripts) {
    const falta = requisitos(s);
    if (falta) { add({ nombre: s.nombre, esperado: s.esperado.ok != null ? `${s.esperado.ok}/${s.esperado.total}` : '—', estado: 'NO CORRIÓ', detalle: falta }); continue; }
    const ts = Date.now();
    const env = { ...process.env, SNAP_BASE: BASE, CPU: String(s.cpu ?? 1) };
    const r = await runCmd(process.execPath, [s.archivo], { cwd: HERE, env, label: s.nombre }, SCRIPT_TIMEOUT_MS);
    const ms = Date.now() - ts;
    if (r.timedOut) { add({ nombre: s.nombre, estado: 'NO CORRIÓ', detalle: `pasó el tope de ${SCRIPT_TIMEOUT_MS / 60000} min`, ms }); continue; }
    if (/\b401\b|no se pudo llamar a .*\/api\/auth\/login|no hay credenciales/.test(r.out) && !/: \d+\/\d+|^OK \d+/m.test(r.out)) {
      add({ nombre: s.nombre, estado: 'NO CORRIÓ', detalle: 'login falló (ver credenciales en .claude/tools/snap/.env)', ms }); continue;
    }
    const n = PARSE[s.modo]?.(r.out, s, r.code);
    if (!n) { add({ nombre: s.nombre, estado: 'NO CORRIÓ', detalle: `modo desconocido "${s.modo}"`, ms }); continue; }
    if (n.error) { add({ nombre: s.nombre, estado: 'NO CORRIÓ', detalle: `${n.error} · exit ${r.code} · ${r.out.split(/\r?\n/).filter(Boolean).slice(-2).join(' | ').slice(0, 200)}`, ms }); continue; }
    add({ nombre: s.nombre, ...veredicto(s, n), ms });
  }
  const anyNo = rows.some((r) => r.estado.startsWith('NO CORRIÓ'));
  const anyFail = rows.some((r) => r.estado.startsWith('FALLA'));
  exitCode = anyNo ? 2 : anyFail ? 1 : 0;
} catch (e) {
  if (!e.preflight && !['build', 'servidores'].includes(e.message)) add({ nombre: 'runner', estado: 'NO CORRIÓ', detalle: e.message });
  exitCode = rows.some((r) => r.estado.startsWith('NO CORRIÓ')) || !rows.some((r) => r.estado.startsWith('FALLA')) ? 2 : 1;
} finally {
  stopAll();
  if (tmpRun) {
    await new Promise((r) => setTimeout(r, 800));   // que Windows suelte el archivo de la base
    try { rmSync(tmpRun, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 }); }
    catch (e) { log(`⚠ no pude borrar ${tmpRun}: ${e.message}`); }
    if (existsSync(tmpRun)) log(`⚠ quedó ${tmpRun}`);
  }
  // 5. Verificación de cierre
  await new Promise((r) => setTimeout(r, 1500));
  const a = await httpCode(`http://localhost:${PORT_API}/`), w = await httpCode(`${BASE}/`), c = await httpCode('http://localhost:3000/');
  // Si este runner levantó servidores, 3100/4173 tienen que quedar en 000; si no lanzó nada (preflight),
  // tienen que seguir como estaban (lo de otro no se toca).
  const lanzo = children.some((x) => x.name === 'backend' || x.name === 'preview');
  const espA = lanzo ? '000' : startCodes[PORT_API] ?? '000', espW = lanzo ? '000' : startCodes[PORT_WEB] ?? '000';
  const limpio = a === espA && w === espW && c === code3000Start;
  log(`cierre: ${PORT_API}=${a} · ${PORT_WEB}=${w} · 3000=${c} (al empezar ${code3000Start})${limpio ? '' : '  ⚠ NO quedó como al empezar'}`);
  header.push(`cierre: ${PORT_API}=${a} · ${PORT_WEB}=${w} · 3000=${c}${limpio ? '' : ' ⚠'}`);
  console.log('\n' + tabla());
  console.log(`\nresultado: ${exitCode === 0 ? 'TODO PASA' : exitCode === 1 ? 'HAY FALLAS' : 'HUBO NO CORRIÓ'} · código ${exitCode} · ${Math.round((Date.now() - t0) / 1000)} s`);
  const rep = rows.length && !rows.some((r) => r.nombre === 'preflight') ? writeReport(header, exitCode) : null;
  if (rep) console.log(`reporte: ${rep}`);
  process.exitCode = exitCode;
}
