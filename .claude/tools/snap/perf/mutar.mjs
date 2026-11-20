// mutar.mjs — MUTACIONES DE CONTROL de un sub-paso: aplica cada mutación de un archivo de datos, corre las suites,
// restaura SIEMPRE y dice qué casos la detectaron. Reemplaza al driver que cada sub-paso armaba a mano en el scratchpad.
//
//   node mutar.mjs mutaciones/<sub-paso>.mjs [--ids A,B] [--revisar] [--suites a,b]
//   node mutar.mjs --restaurar [--sin-build]
//
// ARCHIVO DE MUTACIONES (mutaciones/*.mjs): SÓLO DATOS LITERALES, sin lógica. Exporta
//   · suites: las suites a correr, de SUITES ('dj-unit', 'dj-func' y, desde h5a, 'dj-matriz').
//   · mutaciones: [{ id, que, cambios: [{ archivo, ancla, reemplazo }], esperados? }]
//     archivo = ruta relativa al repo bajo music-client/src/ (nunca las suites, regresion.mjs ni baseline.json);
//     ancla = texto que tiene que aparecer EXACTAMENTE UNA vez (contado sobre el texto ya cambiado por los cambios
//     anteriores de la MISMA mutación); reemplazo = el texto nuevo ('' borra). esperados = los casos que deberían
//     detectarla (de cualquier suite); sin esperados no hay aviso COLATERAL.
//
// QUÉ HACE
//   1. Antes de empezar: valida el archivo; se NIEGA si quedó un respaldo de una corrida cortada (hay que correr
//      --restaurar) o si 3100 o 4173 responden (un runner a la vez). Copia los archivos que se van a mutar y guarda sus
//      sha256 en RESPALDO (bajo shots/, ignorada por git: se comprueba con git check-ignore).
//   2. Por mutación: verifica que los archivos sigan idénticos al respaldo; cuenta cada ancla y, si alguna no aparece
//      exactamente una vez, NO APLICÓ y no escribe nada. Si no, escribe, corre dj-unit DIRECTO (node dj-unit.mjs) y
//      dj-func POR EL RUNNER (regresion.mjs --solo dj-func, con build, DJ_FUNC_SALIDA para el detalle) y restaura en un
//      finally, verificando el hash. Ctrl+C (o SIGTERM): restaura YA, verifica, espera al hijo y sale con 130.
//   3. Al terminar, si se aplicó alguna: regresion.mjs --solo build para dejar el dist limpio, y busca en dist/assets los
//      textos entre comillas que trae cada reemplazo y que no existen en ningún archivo de music-client/src: si alguno
//      está, el dist quedó sucio.
//   Nunca restaura con git (ni checkout, ni stash, ni reset): sólo con los bytes del respaldo.
//   --revisar: sólo cuenta las anclas (no escribe, no corre nada). --restaurar: vuelve a dejar los archivos desde el
//   respaldo de una corrida cortada (verifica el hash), borra el respaldo y corre --solo build (salvo --sin-build).
//   MUSIC_DB_PATH se pasa tal cual al runner (un worktree sin base la necesita).
//
// ESTADOS: DETECTADA (las dos suites) · SOLO UNIT · SOLO FUNC · SOBREVIVE (ninguna) · NO APLICÓ · POR EXCEPCIÓN (sólo la
// detectó 'excepcion', un build roto, un timeout o una suite sin resultados: detección débil). AVISOS que acompañan al
// estado: POR EXCEPCIÓN (una de las suites detectó sólo así) y COLATERAL (con `esperados`: cayó un caso de más o no cayó
// uno esperado).
// SALIDA: tabla markdown en stdout y en shots/mutar/<sub-paso>-<fecha>/resultado.md, más resultado.json y la salida
// completa de cada suite.
// CÓDIGO: 0 bien (avisos incluidos) · 1 alguna SOBREVIVE o NO APLICÓ · 2 no corrió (validación, respaldo, puertos,
// runner) · 3 el dist quedó sucio o el build final falló · 4 un hash no coincide al restaurar (el respaldo queda) · 130.
// --suites a,b (h5a): corre ESAS suites en lugar de las que exporta el archivo. Sin la opción, las del archivo, igual
// que antes. 'dj-matriz' = build + la matriz visual por el runner con el baseline normal (h5f: regresion.mjs --solo
// dj-matriz, DJ_MATRIZ_SALIDA para el detalle). Con --suites, o con 'dj-matriz' entre las suites, el
// estado es GENÉRICO: DETECTADA (la detectaron todas las suites corridas, aunque sea una sola) · SOLO <suites> ·
// SOBREVIVE · POR EXCEPCIÓN, y la tabla trae una columna por suite corrida. Sin eso, la tabla y los estados de siempre.
import { spawn, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..');
const CARPETA = join(REPO, '.claude', 'tools', 'snap', 'shots', 'mutar');
const RESPALDO = join(CARPETA, 'respaldo');
const MANIFIESTO = join(RESPALDO, 'manifiesto.json');
const SUITES = ['dj-unit', 'dj-func', 'dj-matriz'];
const CORTO = { 'dj-unit': 'UNIT', 'dj-func': 'FUNC', 'dj-matriz': 'MATRIZ' };
const PSEUDO = new Set(['excepcion', '(build)', '(timeout)', '(sin resultados)']);
const T_UNIT = 3 * 60 * 1000, T_RUNNER = 15 * 60 * 1000;
const WIN = process.platform === 'win32';

const argv = process.argv.slice(2);
const opcion = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const log = (...a) => console.log('[mutar]', ...a);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const relRepo = (p) => relative(REPO, p).split(sep).join('/');   // ruta relativa al repo, con /
class Aborto extends Error { constructor(msg, codigo = 2) { super(msg); this.codigo = codigo; } }

// ── hijos: async (las señales se atienden mientras corren); el timeout mata SÓLO el árbol del hijo, por su PID ──
let hijo = null;
const matarArbol = (p) => { if (!p?.pid) return; if (WIN) spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); else p.kill('SIGKILL'); };
function correr(cmd, args, { cwd, env, ms }) {
  return new Promise((ok) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    hijo = p;
    let out = '', vencido = false;
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    const t = setTimeout(() => { vencido = true; matarArbol(p); }, ms);
    p.on('close', (code) => { clearTimeout(t); if (hijo === p) hijo = null; ok({ code, out, vencido }); });
    p.on('error', (e) => { clearTimeout(t); if (hijo === p) hijo = null; ok({ code: -1, out: out + String(e), vencido }); });
  });
}
const puertoLibre = (puerto) => new Promise((ok) => {
  const s = createConnection({ host: 'localhost', port: puerto });
  const fin = (libre) => { s.destroy(); ok(libre); };
  s.setTimeout(1500, () => fin(false));   // sin respuesta clara: se trata como ocupado
  s.on('connect', () => fin(false));
  s.on('error', (e) => fin(e.code === 'ECONNREFUSED'));
});
async function puertosLibres() {
  for (const p of [3100, 4173]) if (!(await puertoLibre(p))) throw new Aborto(`el puerto ${p} responde: hay otro runner o servidor (un runner a la vez). No toco nada.`);
}
function carpetaIgnorada() {
  const r = spawnSync('git', ['check-ignore', '-q', join(CARPETA, 'x')], { cwd: REPO });
  if (r.status !== 0) throw new Aborto(`${relRepo(CARPETA)} no está ignorada por git: no guardo respaldos ahí.`);
}

// ── respaldo ──
function leerManifiesto() { try { return JSON.parse(readFileSync(MANIFIESTO, 'utf8')); } catch { return null; } }
function crearRespaldo(archivos, origen) {
  mkdirSync(join(RESPALDO, 'archivos'), { recursive: true });
  const lista = archivos.map((ruta, i) => {
    const b = readFileSync(join(REPO, ruta));
    writeFileSync(join(RESPALDO, 'archivos', `${i}.bin`), b);
    return { ruta, copia: `${i}.bin`, sha256: sha(b) };
  });
  // El manifiesto va ÚLTIMO: si existe, las copias están completas.
  writeFileSync(MANIFIESTO, JSON.stringify({ inicio: new Date().toISOString(), pid: process.pid, origen, archivos: lista }, null, 1));
  return lista;
}
const fase = (datos) => { try { writeFileSync(join(RESPALDO, 'estado.json'), JSON.stringify({ ...datos, pid: process.pid, t: new Date().toISOString() })); } catch { /* informativo */ } };
const coincide = (lista) => lista.every((a) => existsSync(join(REPO, a.ruta)) && sha(readFileSync(join(REPO, a.ruta))) === a.sha256);
function restaurar(lista) {
  for (const a of lista) writeFileSync(join(REPO, a.ruta), readFileSync(join(RESPALDO, 'archivos', a.copia)));
  return coincide(lista);
}
const borrarRespaldo = () => rmSync(RESPALDO, { recursive: true, force: true });

// ── validación del archivo de mutaciones ──
async function cargar(ruta) {
  const abs = resolve(ruta);
  if (!existsSync(abs)) throw new Aborto(`no existe ${ruta}`);
  const m = await import(pathToFileURL(abs).href);
  const extra = Object.keys(m).filter((k) => !['suites', 'mutaciones'].includes(k));
  if (extra.length) throw new Aborto(`el archivo sólo exporta suites y mutaciones (sobra: ${extra.join(', ')})`);
  const { suites, mutaciones } = m;
  if (!Array.isArray(suites) || !suites.length || suites.some((s) => !SUITES.includes(s))) throw new Aborto(`suites tiene que ser un subconjunto no vacío de ${SUITES.join(', ')}`);
  if (!Array.isArray(mutaciones) || !mutaciones.length) throw new Aborto('mutaciones tiene que ser un arreglo no vacío');
  const ids = new Set();
  for (const x of mutaciones) {
    const id = x?.id;
    if (typeof id !== 'string' || !/^[\w-]+$/.test(id) || ids.has(id)) throw new Aborto(`id inválido o repetido: ${JSON.stringify(id)}`);
    ids.add(id);
    if (typeof x.que !== 'string' || !x.que.trim()) throw new Aborto(`${id}: falta «que»`);
    if (!Array.isArray(x.cambios) || !x.cambios.length) throw new Aborto(`${id}: cambios vacío`);
    for (const c of x.cambios) {
      const r = typeof c?.archivo === 'string' ? normalize(c.archivo).split(sep).join('/') : '';
      if (!r || isAbsolute(c.archivo) || r.includes('..') || !r.startsWith('music-client/src/')) throw new Aborto(`${id}: archivo fuera de music-client/src/: ${JSON.stringify(c?.archivo)}`);
      if (!existsSync(join(REPO, r)) || !statSync(join(REPO, r)).isFile()) throw new Aborto(`${id}: no existe ${r}`);
      if (typeof c.ancla !== 'string' || !c.ancla) throw new Aborto(`${id}: ancla vacía en ${r}`);
      if (typeof c.reemplazo !== 'string' || c.reemplazo === c.ancla) throw new Aborto(`${id}: reemplazo inválido o igual al ancla en ${r}`);
      c.archivo = r;
    }
    if (x.esperados !== undefined && (!Array.isArray(x.esperados) || x.esperados.some((e) => typeof e !== 'string'))) throw new Aborto(`${id}: esperados tiene que ser una lista de nombres de caso`);
  }
  return { suites, mutaciones };
}
// El texto de cada archivo tras los cambios, o los conteos de las anclas que no aparecen exactamente una vez.
function aplicarEnMemoria(m, originales) {
  const txt = {}, malas = [];
  for (const c of m.cambios) {
    const t = txt[c.archivo] ?? originales[c.archivo];
    const n = t.split(c.ancla).length - 1;
    if (n !== 1) { malas.push(`${c.archivo.split('/').pop()}: ancla ${n} veces`); continue; }
    txt[c.archivo] = t.replace(c.ancla, () => c.reemplazo);
  }
  return malas.length ? { malas } : { txt };
}

// ── suites ──
function casosQueFallan(salida) {
  const i = salida.indexOf('{'), j = salida.lastIndexOf('}');
  try { return Object.entries(JSON.parse(salida.slice(i, j + 1))).filter(([, v]) => (typeof v === 'object' && v !== null ? !v.ok : !v)).map(([k]) => k); }
  catch { return null; }
}
async function correrUnit(dir, id) {
  const r = await correr(process.execPath, ['dj-unit.mjs'], { cwd: HERE, ms: T_UNIT });
  writeFileSync(join(dir, `${id}-dj-unit.txt`), r.out);
  if (r.vencido) return { casos: ['(timeout)'], linea: 'timeout' };
  const casos = casosQueFallan(r.out);
  return { casos: casos ?? ['(sin resultados)'], linea: (r.out.match(/dj-unit: \d+\/\d+/) ?? ['dj-unit: ?'])[0] };
}
async function correrFunc(dir, id) {
  const json = join(dir, `${id}-dj-func.json`);
  rmSync(json, { force: true });
  const r = await correr(process.execPath, ['regresion.mjs', '--solo', 'dj-func'], { cwd: HERE, ms: T_RUNNER, env: { DJ_FUNC_SALIDA: json } });
  writeFileSync(join(dir, `${id}-runner.txt`), r.out);
  if (/preflight|^base\s+·.*NO CORRIÓ|^servidores\s+·.*NO CORRIÓ/m.test(r.out)) throw new Aborto(`el runner no corrió (preflight, base o servidores): ver ${relRepo(join(dir, `${id}-runner.txt`))}`);
  if (r.vencido) return { casos: ['(timeout)'], linea: 'timeout' };
  if (/^build\s+·.*FALLA/m.test(r.out)) return { casos: ['(build)'], linea: 'build FALLA' };
  const linea = ((r.out.match(/^dj-func\s+·.*$/m) ?? ['dj-func ?'])[0]).replace(/\s+/g, ' ').trim();
  if (!/^dj-func\s+·/m.test(r.out)) throw new Aborto(`el runner no dio la fila de dj-func: ver ${relRepo(join(dir, `${id}-runner.txt`))}`);
  let casos = null;
  try { casos = JSON.parse(readFileSync(json, 'utf8')).fallan; } catch { /* sin archivo */ }
  return { casos: Array.isArray(casos) ? casos : ['(sin resultados)'], linea };
}
// h5a: la matriz visual, con build, por el runner (h5f: --solo dj-matriz del baseline normal). Mismos controles que correrFunc.
async function correrMatriz(dir, id) {
  const json = join(dir, `${id}-dj-matriz.json`);
  rmSync(json, { force: true });
  const r = await correr(process.execPath, ['regresion.mjs', '--solo', 'dj-matriz'], { cwd: HERE, ms: T_RUNNER, env: { DJ_MATRIZ_SALIDA: json } });
  writeFileSync(join(dir, `${id}-runner-matriz.txt`), r.out);
  if (/preflight|^base\s+·.*NO CORRIÓ|^servidores\s+·.*NO CORRIÓ/m.test(r.out)) throw new Aborto(`el runner no corrió (preflight, base o servidores): ver ${relRepo(join(dir, `${id}-runner-matriz.txt`))}`);
  if (r.vencido) return { casos: ['(timeout)'], linea: 'timeout' };
  if (/^build\s+·.*FALLA/m.test(r.out)) return { casos: ['(build)'], linea: 'build FALLA' };
  const linea = ((r.out.match(/^dj-matriz\s+·.*$/m) ?? ['dj-matriz ?'])[0]).replace(/\s+/g, ' ').trim();
  if (!/^dj-matriz\s+·/m.test(r.out)) throw new Aborto(`el runner no dio la fila de dj-matriz: ver ${relRepo(join(dir, `${id}-runner-matriz.txt`))}`);
  let casos = null;
  try { casos = JSON.parse(readFileSync(json, 'utf8')).fallan; } catch { /* sin archivo */ }
  return { casos: Array.isArray(casos) ? casos : ['(sin resultados)'], linea };
}
// h5a: el estado GENÉRICO (con --suites o con 'dj-matriz'). Con dj-unit y dj-func da lo mismo que clasificar().
function clasificarN(m, suites, res) {
  const todos = suites.map((s) => res[s]?.casos ?? []);
  const reales = todos.map((c) => c.filter((x) => !PSEUDO.has(x)));
  const avisos = [];
  let estado;
  if (todos.every((c) => !c.length)) estado = 'SOBREVIVE';
  else if (reales.every((c) => !c.length)) estado = 'POR EXCEPCIÓN';
  else {
    const det = suites.filter((s, i) => reales[i].length);
    estado = det.length === suites.length ? 'DETECTADA' : `SOLO ${det.map((s) => CORTO[s]).join(' + ')}`;
    if (todos.some((c, i) => c.length && !reales[i].length)) avisos.push('POR EXCEPCIÓN');
  }
  let colateral = null;
  if (m.esperados && estado !== 'SOBREVIVE') {
    const r = new Set(reales.flat());
    const deMas = [...r].filter((c) => !m.esperados.includes(c)), faltan = m.esperados.filter((c) => !r.has(c));
    if (deMas.length || faltan.length) { avisos.push('COLATERAL'); colateral = { deMas, faltan }; }
  }
  return { estado, avisos, colateral };
}
function clasificar(m, unit, func) {
  const u = unit?.casos ?? [], f = func?.casos ?? [];
  const ru = u.filter((c) => !PSEUDO.has(c)), rf = f.filter((c) => !PSEUDO.has(c));
  const avisos = [];
  let estado;
  if (!u.length && !f.length) estado = 'SOBREVIVE';
  else if (!ru.length && !rf.length) estado = 'POR EXCEPCIÓN';
  else {
    estado = ru.length && rf.length ? 'DETECTADA' : ru.length ? 'SOLO UNIT' : 'SOLO FUNC';
    if ((u.length && !ru.length) || (f.length && !rf.length)) avisos.push('POR EXCEPCIÓN');
  }
  let colateral = null;
  if (m.esperados && estado !== 'SOBREVIVE') {
    const reales = new Set([...ru, ...rf]);
    const deMas = [...reales].filter((c) => !m.esperados.includes(c)), faltan = m.esperados.filter((c) => !reales.has(c));
    if (deMas.length || faltan.length) { avisos.push('COLATERAL'); colateral = { deMas, faltan }; }
  }
  return { estado, avisos, colateral };
}

// ── dist: los textos entre comillas de cada reemplazo que no existen en ningún archivo de music-client/src ──
function textosDeSrc() {
  const out = [];
  const ir = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) ir(p); else if (/\.(jsx?|tsx?|css|json)$/.test(e.name)) out.push(readFileSync(p, 'utf8')); } };
  ir(join(REPO, 'music-client', 'src'));
  return out.join('\n');
}
function revisarDist(aplicadas) {
  const dir = join(REPO, 'music-client', 'dist', 'assets');
  if (!existsSync(dir)) return { buscados: 0, encontrados: [{ id: '—', texto: 'no existe music-client/dist/assets' }] };
  const dist = readdirSync(dir).filter((n) => /\.(js|css)$/.test(n)).map((n) => readFileSync(join(dir, n), 'utf8')).join('\n');
  const src = textosDeSrc();
  let buscados = 0;
  const encontrados = [];
  // De un template literal se buscan sus tramos fijos: el build conserva el texto (en UTF-8) pero renombra las variables.
  const tramos = (s) => s.split(/\$\{[^}]*\}/).filter((x) => x.length >= 8);
  for (const m of aplicadas) for (const c of m.cambios) for (const [, , s] of c.reemplazo.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n]){8,}?)\1/g)) {
    for (const x of tramos(s)) {
      if (src.includes(x)) continue;   // ese texto existe en el código bueno: no prueba nada
      buscados++;
      if (dist.includes(x)) encontrados.push({ id: m.id, texto: x });
    }
  }
  return { buscados, encontrados };
}
async function buildFinal() {
  await puertosLibres();
  const r = await correr(process.execPath, ['regresion.mjs', '--solo', 'build'], { cwd: HERE, ms: T_RUNNER });
  return { ok: /^build\s+·.*PASA/m.test(r.out), out: r.out };
}

// ── tabla ──
const lista = (l) => (l?.length ? l.join(', ') : '—');
function tabla(filas) {
  const t = ['| Mutación | Qué | dj-unit | dj-func | Estado |', '|---|---|---|---|---|'];
  for (const f of filas) {
    const est = [f.estado, ...f.avisos].join(' · ');
    const nota = f.colateral ? ` (de más: ${lista(f.colateral.deMas)}; no cayó: ${lista(f.colateral.faltan)})` : f.malas ? ` (${f.malas.join('; ')})` : '';
    t.push(`| ${f.id} | ${f.que.replace(/\|/g, '\\|')} | ${lista(f.unit?.casos)} | ${lista(f.func?.casos)} | ${est}${nota} |`);
  }
  return t.join('\n');
}
// h5a: una columna por suite corrida (con --suites o con 'dj-matriz').
function tablaN(filas, suites) {
  const t = [`| Mutación | Qué | ${suites.join(' | ')} | Estado |`, `|---|---|${suites.map(() => '---|').join('')}---|`];
  for (const f of filas) {
    const est = [f.estado, ...f.avisos].join(' · ');
    const nota = f.colateral ? ` (de más: ${lista(f.colateral.deMas)}; no cayó: ${lista(f.colateral.faltan)})` : f.malas ? ` (${f.malas.join('; ')})` : '';
    t.push(`| ${f.id} | ${f.que.replace(/\|/g, '\\|')} | ${suites.map((s) => lista(f.res?.[s]?.casos)).join(' | ')} | ${est}${nota} |`);
  }
  return t.join('\n');
}

// ── modos ──
async function modoRestaurar() {
  if (!existsSync(RESPALDO)) { log('no hay respaldo: nada que restaurar.'); return 0; }
  const man = leerManifiesto();
  if (!man) { borrarRespaldo(); log('el respaldo estaba incompleto (sin manifiesto): los archivos no se llegaron a tocar. Lo borré.'); return 0; }
  const ok = restaurar(man.archivos);
  for (const a of man.archivos) log(`${ok ? 'OK ' : 'MAL'} ${a.ruta} ${a.sha256.slice(0, 12)}…`);
  if (!ok) { log('⚠ algún hash no coincide: dejo el respaldo para revisarlo.'); return 4; }
  borrarRespaldo();
  log(`restaurados ${man.archivos.length} archivos (corrida de ${man.inicio}, pid ${man.pid}). Respaldo borrado.`);
  if (argv.includes('--sin-build')) { log('--sin-build: el dist puede seguir con la mutación.'); return 0; }
  try { const b = await buildFinal(); log(b.ok ? 'build final PASA: dist limpio.' : '⚠ el build final no pasó'); return b.ok ? 0 : 3; }
  catch (e) { log(`⚠ ${e.message} (no corrí el build: el dist puede seguir con la mutación)`); return 3; }
}

async function modoMutar(ruta) {
  const { suites: delArchivo, mutaciones: todas } = await cargar(ruta);
  // h5a: --suites a,b pisa las del archivo. Sin la opción, `suites` es exactamente la del archivo (como antes).
  const pedidas = argv.includes('--suites') ? (opcion('--suites') ?? '').split(',').map((s) => s.trim()).filter(Boolean) : null;
  if (pedidas && (!pedidas.length || pedidas.some((s) => !SUITES.includes(s)) || new Set(pedidas).size !== pedidas.length)) throw new Aborto(`--suites tiene que ser una lista sin repetidos de ${SUITES.join(', ')}`);
  const suites = pedidas ?? delArchivo;
  const generico = !!pedidas || suites.includes('dj-matriz');
  const ids = opcion('--ids')?.split(',').map((s) => s.trim()).filter(Boolean);
  const mutaciones = ids ? todas.filter((m) => ids.includes(m.id)) : todas;
  if (ids && mutaciones.length !== ids.length) throw new Aborto(`ids desconocidos: ${ids.filter((i) => !todas.some((m) => m.id === i)).join(', ')}`);
  const archivos = [...new Set(mutaciones.flatMap((m) => m.cambios.map((c) => c.archivo)))];
  const originales = Object.fromEntries(archivos.map((a) => [a, readFileSync(join(REPO, a), 'utf8')]));

  if (argv.includes('--revisar')) {
    let malas = 0;
    for (const m of mutaciones) { const r = aplicarEnMemoria(m, originales); if (r.malas) malas++; log(`${m.id} ${r.malas ? `NO APLICÓ (${r.malas.join('; ')})` : 'anclas OK'}`); }
    return malas ? 1 : 0;
  }

  carpetaIgnorada();
  if (existsSync(RESPALDO)) throw new Aborto(`quedó un respaldo de una corrida cortada en ${relRepo(RESPALDO)}: corré «node mutar.mjs --restaurar» antes.`);
  await puertosLibres();
  const sub = basename(ruta).replace(/\.mjs$/, '');
  const dir = join(CARPETA, `${sub}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
  mkdirSync(dir, { recursive: true });
  const respaldo = crearRespaldo(archivos, relRepo(resolve(ruta)));
  log(`${mutaciones.length} mutaciones de ${sub} sobre ${archivos.length} archivos · respaldo con sha256 en ${relRepo(RESPALDO)}`);
  if (generico) log(`suites: ${suites.join(', ')}${pedidas ? ' (--suites)' : ''} · estado genérico`);

  let cortado = false;
  const alCortar = (sen) => {
    if (cortado) return;
    cortado = true;
    const ok = restaurar(respaldo);
    log(`${sen}: restauré ${ok ? 'y los hashes coinciden' : 'PERO algún hash no coincide (dejo el respaldo)'}.`);
    if (ok) { borrarRespaldo(); log('el dist puede quedar con la mutación: corré «node regresion.mjs --solo build».'); }
    const h = hijo;
    const salir = () => process.exit(ok ? 130 : 4);
    if (!h) salir();
    const t = setTimeout(() => { matarArbol(h); salir(); }, 30000);   // el runner se apaga solo con su propio Ctrl+C
    h.on('close', () => { clearTimeout(t); salir(); });
  };
  process.on('SIGINT', () => alCortar('Ctrl+C'));
  process.on('SIGTERM', () => alCortar('SIGTERM'));

  const filas = [];
  try { await recorrer(); }
  catch (e) {
    // Un aborto a mitad (runner que no corrió, archivos editados por otro): si los archivos son los del respaldo, el
    // respaldo ya no hace falta; si no, queda para --restaurar.
    if (coincide(respaldo)) borrarRespaldo(); else log('⚠ los archivos no coinciden con el respaldo: lo dejo; corré --restaurar.');
    throw e;
  }
  async function recorrer() { for (const m of mutaciones) {
    if (!coincide(respaldo)) throw new Aborto(`antes de ${m.id} los archivos ya no son los del respaldo (¿alguien los editó?): no toco nada; revisá y corré --restaurar.`);
    const r = aplicarEnMemoria(m, originales);
    if (r.malas) { filas.push({ id: m.id, que: m.que, estado: 'NO APLICÓ', avisos: [], malas: r.malas }); log(`${m.id} NO APLICÓ: ${r.malas.join('; ')}`); continue; }
    let unit = null, func = null, matriz = null;
    try {
      fase({ mutacion: m.id, fase: 'aplicando' });
      for (const [a, t] of Object.entries(r.txt)) writeFileSync(join(REPO, a), t);
      if (suites.includes('dj-unit')) { fase({ mutacion: m.id, fase: 'dj-unit' }); unit = await correrUnit(dir, m.id); }
      if (suites.includes('dj-func')) { fase({ mutacion: m.id, fase: 'dj-func' }); func = await correrFunc(dir, m.id); }
      if (suites.includes('dj-matriz')) { fase({ mutacion: m.id, fase: 'dj-matriz' }); matriz = await correrMatriz(dir, m.id); }
    } finally {
      if (!cortado && !restaurar(respaldo)) { log(`⚠ tras ${m.id} el hash no coincide: dejo el respaldo; corré --restaurar.`); process.exit(4); }
      fase({ mutacion: m.id, fase: 'restaurada' });
    }
    const res = { 'dj-unit': unit, 'dj-func': func, 'dj-matriz': matriz };
    const c = generico ? clasificarN(m, suites, res) : clasificar(m, unit, func);
    const fila = generico ? { id: m.id, que: m.que, unit, func, matriz, res, ...c, hashRestaurado: true } : { id: m.id, que: m.que, unit, func, ...c, hashRestaurado: true };
    filas.push(fila);
    log(`${m.id} ${[c.estado, ...c.avisos].join(' · ')} · unit: ${lista(unit?.casos)} · func: ${lista(func?.casos)}${suites.includes('dj-matriz') ? ` · matriz: ${lista(matriz?.casos)}` : ''}`);
  } }

  const aplicadas = mutaciones.filter((m) => filas.find((f) => f.id === m.id)?.estado !== 'NO APLICÓ');
  let dist = null, build = null;
  if (aplicadas.length) {
    fase({ fase: 'build final' });
    build = await buildFinal();
    dist = revisarDist(aplicadas);
  }
  if (!coincide(respaldo)) { log('⚠ al final los hashes no coinciden: dejo el respaldo; corré --restaurar.'); return 4; }
  borrarRespaldo();

  const sobreviven = filas.filter((f) => f.estado === 'SOBREVIVE' || f.estado === 'NO APLICÓ');
  const avisos = filas.filter((f) => f.avisos.length || f.estado === 'POR EXCEPCIÓN');
  const md = [
    `# Mutaciones de ${sub} · ${new Date().toISOString()}`, '',
    generico ? tablaN(filas, suites) : tabla(filas), '',
    `- ${filas.length} mutaciones · ${sobreviven.length} SOBREVIVE o NO APLICÓ · ${avisos.length} con aviso · hashes restaurados y verificados tras cada una.`,
    build ? `- build final: ${build.ok ? 'PASA' : 'FALLA'} · dist: ${dist.buscados} textos de mutación buscados en dist/assets, ${dist.encontrados.length} encontrados${dist.encontrados.length ? ` (${dist.encontrados.map((e) => `${e.id}: ${e.texto}`).join('; ')})` : ''}.` : '- ninguna mutación se aplicó: no hizo falta build.',
  ].join('\n');
  writeFileSync(join(dir, 'resultado.md'), md + '\n');
  writeFileSync(join(dir, 'resultado.json'), JSON.stringify({ sub, archivo: relRepo(resolve(ruta)), filas, build: build && { ok: build.ok }, dist }, null, 1));
  console.log('\n' + md + `\n\nresultado: ${relRepo(dir)}`);
  if (build && (!build.ok || dist.encontrados.length)) return 3;
  return sobreviven.length ? 1 : 0;
}

try {
  const ruta = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--ids' && argv[i - 1] !== '--suites');
  if (argv.includes('--restaurar')) process.exitCode = await modoRestaurar();
  else if (!ruta) { console.log('uso: node mutar.mjs mutaciones/<sub-paso>.mjs [--ids A,B] [--revisar] [--suites a,b] · node mutar.mjs --restaurar [--sin-build]'); process.exitCode = 2; }
  else process.exitCode = await modoMutar(ruta);
} catch (e) {
  log(`NO CORRIÓ: ${e.message}`);
  process.exitCode = e instanceof Aborto ? e.codigo : 2;
}
