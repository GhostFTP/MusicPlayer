// citas-dj-lab.mjs — VERIFICADOR DE CITAS de la skill dj-lab (sub-paso h4; nace de la verificación de h2).
//
//   node .claude/tools/snap/perf/citas-dj-lab.mjs [ruta/a/SKILL.md]
//
// Para qué: dj-lab (.claude/skills/dj-lab/SKILL.md) cita `archivo:línea` en cada regla. Este script extrae cada
// cita del SKILL.md (`archivo:N` y los rangos `archivo:N`–`M`; .mjs, .jsx, .js y, desde h5f, .css y .json), comprueba que esa línea del worktree CONTENGA el
// texto esperado de la tabla E de abajo, e imprime cuántas coinciden, cuántas fallan (con la línea que encontró)
// y cuántas citas del SKILL.md no tienen texto esperado en la tabla. Exit 0 sólo con 0 fallas y 0 sin comprobar;
// exit 1 en cualquier otro caso. No escribe nada, no corre suites, no abre puertos.
// Sin argumento lee la skill del worktree; con uno, ese SKILL.md (para probar copias). Los archivos citados se
// leen SIEMPRE del worktree, con rutas relativas a su raíz (calculada desde la ubicación de este script).
//
// MANTENIMIENTO: la tabla E se actualiza en el MISMO commit que cambie una línea citada o una cita de dj-lab
// (número o texto). Una cita nueva en la skill sin su fila en E da exit 1 («sin comprobar»).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const R = fileURLToPath(new URL('../../../../', import.meta.url));   // .claude/tools/snap/perf/ → raíz del worktree
const SKILL = process.argv[2] ? path.resolve(process.argv[2]) : path.join(R, '.claude/skills/dj-lab/SKILL.md');
const F = {
  'motor.js': 'music-client/src/dj/motor/motor.js', 'cue.js': 'music-client/src/dj/motor/cue.js', 'CueDj.jsx': 'music-client/src/dj/CueDj.jsx',
  'DjPage.jsx': 'music-client/src/dj/DjPage.jsx', 'carga.js': 'music-client/src/dj/motor/carga.js', 'midi.js': 'music-client/src/dj/motor/midi.js',
  'salidas.js': 'music-client/src/dj/motor/salidas.js',
  'main.jsx': 'music-client/src/main.jsx', 'dj-func.mjs': '.claude/tools/snap/perf/dj-func.mjs', 'dj-unit.mjs': '.claude/tools/snap/perf/dj-unit.mjs',
  'regresion.mjs': '.claude/tools/snap/perf/regresion.mjs', 'mutar.mjs': '.claude/tools/snap/perf/mutar.mjs', 'tablet-util.mjs': '.claude/tools/snap/perf/tablet-util.mjs',
  // h5f: la matriz visual (sección 9 de dj-lab) y lo que cita del CSS y del baseline.
  'dj-matriz.mjs': '.claude/tools/snap/perf/dj-matriz.mjs', 'dj-hojas.mjs': '.claude/tools/snap/perf/dj-hojas.mjs',
  'dj-biblioteca-fija.mjs': '.claude/tools/snap/perf/dj-biblioteca-fija.mjs', 'dj-falsos.mjs': '.claude/tools/snap/perf/dj-falsos.mjs',
  'h5.mjs': '.claude/tools/snap/perf/mutaciones/h5.mjs', 'baseline.json': '.claude/tools/snap/perf/baseline.json', 'main.css': 'music-client/src/styles/main.css',
};
const E = [  // [archivo, línea, texto que tiene que estar en esa línea]
  ['motor.js', 38, 'NUNCA se le llama setSinkId'], ['motor.js', 489, 'ctx = new AudioContext('], ['motor.js', 450, 'await c.setSinkId(id)'],
  ['motor.js', 357, 'function crearCtxCue'], ['motor.js', 361, "sinkId: { type: 'none' }"], ['motor.js', 336, 'function esperarRunning'],
  ['motor.js', 99, 'ESPERA_CUE_MS = 2000'], ['motor.js', 50, "Si setSinkId falla, el contexto queda en 'none'"], ['motor.js', 52, 'sinkId que falla setSinkId'],
  ['motor.js', 482, 'asegurarContexto()'], ['motor.js', 587, 'fijarSalidaCue(deviceId'], ['motor.js', 632, 'fijarCue(lado, activo)'], ['motor.js', 625, 'abrirSalidaCue()'],
  ['DjPage.jsx', 229, 'asegurarContexto()'], ['DjPage.jsx', 233, 'm.abrirSalidaCue()'], ['DjPage.jsx', 510, "onCargar('A', t)"], ['DjPage.jsx', 511, "onCargar('B', t)"],
  ['DjPage.jsx', 408, 'Cargar igual'], ['DjPage.jsx', 263, 'm.fijarCue(lado'], ['DjPage.jsx', 385, 'onClick={() => onCue(lado)}'],
  ['CueDj.jsx', 243, 'abrir: true'], ['CueDj.jsx', 257, 'const usar = (e)'], ['CueDj.jsx', 265, 'const usarIgual = (e)'],
  ['CueDj.jsx', 351, 'onClick={usar}>Usar'], ['CueDj.jsx', 389, 'onClick={usarIgual}>Usarla igual'],
  ['CueDj.jsx', 217, 'motor.fijarSalidaCue(d.salida.id, visible, { canales: d.canales })'], ['CueDj.jsx', 155, 'm.fijarSalidaCue(v.salida.id, visible, { canales: v.canales })'],
  ['DjPage.jsx', 195, 'fijarSalidaCue: (deviceId'], ['DjPage.jsx', 196, 'fijarCue: (lado, activo)'], ['midi.js', 34, "MAPA_DDJ400 = Object.freeze({ '1:19': 'volA'"],
  ['motor.js', 55, 'Deck en pausa o terminado → sin fuente de cue'], ['motor.js', 279, 'if (!r.sonando || !r.buffer) return;'], ['cue.js', 288, 'NOTA_CUE_PAUSA'],
  ['CueDj.jsx', 246, 'desfaseAlUsar(leerGuardado()'], ['CueDj.jsx', 251, 'motor.fijarDesfaseCue(d)'], ['motor.js', 474, 'sincronizarCues();'], ['CueDj.jsx', 63, 'DESFASE AL «USAR»'],
  ['motor.js', 56, 'FALLOS'], ['motor.js', 329, 'function fallaCue'], ['motor.js', 375, "addEventListener('sinkchange'"],
  ['cue.js', 153, 'nunca se deduce de maxChannelCount'], ['cue.js', 155, 'export function validarCanales'], ['motor.js', 386, 'function montarSalidaCue'],
  ['motor.js', 396, "return 'sin-canales-3-4'"], ['cue.js', 176, "case 'sin-canales-3-4'"],
  ['cue.js', 31, 'no se guarda'], ['cue.js', 33, 'VOLUMEN_CUE_INICIAL = 0.5'], ['motor.js', 235, 'volumen: VOLUMEN_CUE_INICIAL'], ['motor.js', 234, 'activo: { A: false, B: false }'],
  ['cue.js', 343, '{ v: 1, actual: { id, nombre, canales } | null, salidas: [{ id, nombre, desfaseMs, usada }] }'], ['cue.js', 353, "CLAVE_CUE = 'djCue'"], ['cue.js', 355, 'TOPE_SALIDAS = 8'],
  ['cue.js', 349, 'NUNCA se guarda ni se lee'], ['cue.js', 430, 'export function serializarCue'], ['cue.js', 421, 'export function leerCueGuardado'], ['cue.js', 360, 'export function crearAlmacen'],
  ['CueDj.jsx', 254, 'if (r?.ok) guardar('], ['CueDj.jsx', 30, 'Una desconexión NUNCA toca lo guardado'], ['CueDj.jsx', 171, 'm.fijarSalidaCue(null)'],
  ['CueDj.jsx', 397, 'dj-cue-cerrar-error'], ['CueDj.jsx', 403, 'dj-cue-cerrar"'], ['CueDj.jsx', 352, 'Quitar salida'], ['CueDj.jsx', 236, 'const hayQuitar'],
  ['CueDj.jsx', 276, 'guardar(olvidarActual)'], ['cue.js', 441, 'export function olvidarActual'], ['cue.js', 134, 'export function elegirGuardada'], ['cue.js', 344, 'NO el'],
  ['cue.js', 495, 'export function decidirRestauracion'], ['CueDj.jsx', 203, "d.accion === 'ambigua' || d.accion === 'ausente'"], ['cue.js', 480, 'export function desfaseAlUsar'],
  ['cue.js', 214, 'export function decidirEleccion'], ['cue.js', 217, "'confirmar-misma-salida'"], ['cue.js', 99, 'esMaster'], ['CueDj.jsx', 262, "'confirmar-misma-salida'"],
  ['cue.js', 514, 'export function decidirVuelta'], ['CueDj.jsx', 151, "v.accion === 'rearmar'"], ['CueDj.jsx', 156, "'volvio-lista'"], ['CueDj.jsx', 162, "textoAviso('volvio', visible)"],
  ['cue.js', 278, 'export function estadoBotonCue'],
  ['DjPage.jsx', 64, "TECLAS_TAPADAS = new Set(['Space', 'ArrowLeft', 'ArrowRight', 'KeyM', 'KeyF'])"], ['DjPage.jsx', 112, 'e.preventDefault()'], ['DjPage.jsx', 114, "addEventListener('keydown', onKey, true)"],
  ['dj-func.mjs', 1410, 'Espacio NO lo conmuta'], ['dj-func.mjs', 1411, 'Enter SÍ'], ['DjPage.jsx', 59, 'Enter sí lo'], ['DjPage.jsx', 66, "TAPADAS_EN_RANGO = new Set(['KeyM', 'KeyF'])"], ['DjPage.jsx', 107, "t.type === 'range'"],
  ['DjPage.jsx', 108, 'TAPADAS_EN_RANGO.has'], ['DjPage.jsx', 109, 'closest?.(CAMPOS)'], ['DjPage.jsx', 105, 'e.ctrlKey || e.altKey || e.metaKey'], ['DjPage.jsx', 102, 'if (radioActiva) return undefined;'],
  ['DjPage.jsx', 69, 'usePlayer()'], ['carga.js', 20, 'MAX_SEG = 900'], ['motor.js', 85, 'TASA_DJ = 44100'], ['DjPage.jsx', 133, 'Sal de la radio para usar el Modo DJ'], ['DjPage.jsx', 83, 'if (radioActiva) return undefined;'],
  ['dj-unit.mjs', 1, 'unitaria del Modo DJ'], ['dj-unit.mjs', 10, 'salida recordada y avisos'], ['dj-func.mjs', 63, 'NO se prueba: el sonido, el corte al resincronizar, clics'],
  ['dj-func.mjs', 51, 'NO se prueba'], ['dj-func.mjs', 72, 'NO se prueba: el getter de'], ['dj-func.mjs', 73, 'dos pestañas'], ['regresion.mjs', 19, 'vite preview en 4173'],
  ['regresion.mjs', 325, "'vite', 'preview'"], ['tablet-util.mjs', 26, '--autoplay-policy=no-user-gesture-required'], ['dj-func.mjs', 1586, 'no-user-gesture-required'],
  ['main.jsx', 10, '<StrictMode>'], ['mutar.mjs', 4, 'node mutar.mjs mutaciones/<sub-paso>.mjs'], ['mutar.mjs', 5, 'node mutar.mjs --restaurar'], ['mutar.mjs', 27, '--revisar:'],
  ['mutar.mjs', 31, 'ESTADOS:'], ['mutar.mjs', 37, 'CÓDIGO:'], ['mutar.mjs', 22, 'Ctrl+C (o SIGTERM): restaura YA'], ['regresion.mjs', 9, ':3000 (otro proyecto: no se toca)'], ['regresion.mjs', 45, 'PORT_API = 3100'], ['regresion.mjs', 46, 'PORT_WEB = 4173'],
  ['CueDj.jsx', 75, 'Cada cambio corta el cue un instante'], ['cue.js', 28, 'medido por Oscar en Edge 157'], ['motor.js', 674, 'derivaMs'], ['motor.js', 697, 'derivaMs:'],
  // h4 · regla 4.4 (el motivo del botón Cue, exacto):
  ['cue.js', 279, "estado === 'abriendo' || estado === 'lista'"], ['DjPage.jsx', 391, 'className="dj-deck-cue-motivo" id={idMotivo}'],
  ['DjPage.jsx', 383, 'aria-describedby={botonCue.motivo ? idMotivo : undefined}'], ['DjPage.jsx', 345, 'estadoBotonCue(cueEstado, cueFalta)'],
  ['CueDj.jsx', 103, 'alFaltar?.(falta)'], ['DjPage.jsx', 295, 'cueFalta={cueFalta}'],
  ['cue.js', 277, 'motivoCueAusente = (nombre) => `Cue no disponible: conecta «${texto(nombre)}» o elige otra salida.`'],
  ['cue.js', 280, 'if (texto(ausente))'], ['cue.js', 276, "MOTIVO_CUE_ERROR = 'Cue no disponible: la salida de audífonos falló. Quítala o elige otra.'"],
  ['cue.js', 281, "if (estado === 'error') return { habilitado: false, titulo: TITULO_CUE_ERROR, motivo: MOTIVO_CUE_ERROR }"],
  ['cue.js', 275, "MOTIVO_CUE_SIN_SALIDA = 'Para usar Cue, elige una salida de audífonos abajo, en «Audífonos (cue)».'"],
  ['cue.js', 282, 'motivo: MOTIVO_CUE_SIN_SALIDA }'],
  // h4 · nota de la sección 2 (filtrarSalidas no copia maxChannelCount; M2a sólo con los datos falsos de dj-unit):
  ['cue.js', 106, 'export function filtrarSalidas(dispositivos)'], ['cue.js', 120, '}'],   // 120 = cierre de filtrarSalidas: ancla débil
  ['cue.js', 117, 'salidas.push({ id, nombre, grupo, esMaster: grupoMaster !== null && grupo === grupoMaster })'],
  ['salidas.js', 50, 'salidas = filtrarSalidas(lista)'],
  ['CueDj.jsx', 202, 'decidirRestauracion({ guardado: g, estadoLista: lista.estado, salidas: lista.salidas })'],
  ['cue.js', 501, "const canales = validarCanales(a.canales) ?? '1-2';"],
  ['dj-unit.mjs', 1600, 'const gemMax = gem.map((s) => ({ ...s, maxChannelCount: 4 }))'],
  ['dj-unit.mjs', 1603, "ok('cue_e4_restaurar_permiso_master_y_canales'"],
  // h5f · sección 7 (mutar --suites) y sección 9 (la matriz visual):
  ['mutar.mjs', 39, '--suites a,b (h5a): corre ESAS suites'], ['mutar.mjs', 43, 'SOBREVIVE · POR EXCEPCIÓN'],
  ['mutar.mjs', 192, "['regresion.mjs', '--solo', 'dj-matriz']"],
  ['baseline.json', 83, '"nombre": "dj-matriz", "archivo": "dj-matriz.mjs", "modo": "name-line", "esperado": { "ok": 739, "total": 739 }'],
  ['regresion.mjs', 249, "--solo con scripts que no están en el baseline"], ['regresion.mjs', 313, 'if (!SIN_BUILD) {'],
  ['dj-biblioteca-fija.mjs', 48, 'Array.from({ length: 40 }'], ['dj-falsos.mjs', 42, "const SINK_FALSO = { 'sb-0001': null"],
  ['dj-matriz.mjs', 147, "const CAPT = process.env.DJ_MATRIZ_CAPTURAS === '1'"], ['dj-matriz.mjs', 149, "process.env.DJ_MATRIZ_CAPTURAS_TODAS === '1'"],
  ['dj-matriz.mjs', 158, "spawnSync('git', ['check-ignore', '-q'"],
  ['dj-hojas.mjs', 5, 'node dj-hojas.mjs <carpeta>'], ['dj-hojas.mjs', 7, 'node dj-hojas.mjs --comparar <limpio> <otra>'],
  ['dj-matriz.mjs', 106, 'const SIN_COLA = [[900, 800], [1024, 768], [1280, 800], [1366, 768], [1440, 900], [1920, 1080]]'],
  ['dj-matriz.mjs', 107, 'const CON_COLA = [[1280, 800], [1366, 768], [1440, 900], [1920, 1080]]'], ['dj-matriz.mjs', 108, 'const CON_COLA_REG = [[900, 800], [1024, 768]]'],
  ['dj-matriz.mjs', 451, 'const TABLETS = [[820, 1180], [1180, 820]]'], ['dj-matriz.mjs', 452, "const TABLET_ESTADOS = ['e1', 'e3', 'e10']"],
  ['dj-matriz.mjs', 502, 'ok(`${E.e}_alcanzado`'],
  ['dj-matriz.mjs', 360, "{ e: 'e1',"], ['dj-matriz.mjs', 361, "{ e: 'e2',"], ['dj-matriz.mjs', 363, "{ e: 'e3',"], ['dj-matriz.mjs', 366, "{ e: 'e4',"],
  ['dj-matriz.mjs', 369, "{ e: 'e5', visita: { cue: G({ id: 'largo-0001', nombre: LARGO"], ['dj-matriz.mjs', 372, "{ e: 'e7a',"], ['dj-matriz.mjs', 376, "{ e: 'e7b',"],
  ['dj-matriz.mjs', 378, "{ e: 'e7c',"], ['dj-matriz.mjs', 380, "{ e: 'e8', armar: async () => { await verSalidas(); await usar('hp-0002', '1-2')"],
  ['dj-matriz.mjs', 382, "{ e: 'e9', armar: async () => { await verSalidas(); await usar('sb-0001', '1-2')"], ['dj-matriz.mjs', 384, "{ e: 'e10',"],
  ['dj-matriz.mjs', 281, 'async function medirEstable(p)'], ['dj-matriz.mjs', 286, 'JSON.stringify(m) === JSON.stringify(prev)'],
  ['dj-matriz.mjs', 436, '_sin_scroll_horizontal`, medido && m.main.sw <= m.main.cw && m.doc.sw <= m.doc.cw'],
  ['dj-matriz.mjs', 200, 'q.left < izq - 0.5 || q.right > der + 0.5'], ['dj-matriz.mjs', 437, '_nada_fuera_del_area`, medido && m.nFuera === 0'],
  ['dj-matriz.mjs', 211, `const EXCL_CONTENEDOR = 'button, select, option, a, [role="button"], input'`],
  ['dj-matriz.mjs', 218, "!['absolute', 'fixed'].includes(getComputedStyle(h).position)"], ['dj-matriz.mjs', 225, 'if (iw > 0.5 && ih > 0.5)'],
  ['dj-matriz.mjs', 441, '_sin_solapes`, medido && m.contenedores > 0 && m.solapes.length === 0'],
  ['dj-matriz.mjs', 237, 'e.scrollWidth > e.clientWidth + 1 && !scrollea(cs.overflowX)'], ['dj-matriz.mjs', 442, '_sin_texto_cortado`, medido && m.cortados.length === 0'],
  ['dj-matriz.mjs', 251, 'return w < 24 || h < 24;'], ['dj-matriz.mjs', 443, 'm.ctrl.medidos === m.ctrl.contados && m.ctrl.chicos.length === 0'],
  ['dj-matriz.mjs', 261, 'const colapsados ='], ['dj-matriz.mjs', 445, '_sin_colapsados`, medido && m.colapsados.length === 0'],
  ['dj-matriz.mjs', 447, 'if (!cola && h >= 768) ok(`${e}_${v}_decks_a_la_vista`'],
  ['main.css', 6278, 'La lista de la biblioteca scrollea'], ['main.css', 6280, 'vista. Las filas tienen alto fijo'],
  ['dj-matriz.mjs', 508, 'con el clic de Playwright: armar con el dedo'],
  ['h5.mjs', 22, 'id: "D1"'], ['h5.mjs', 33, 'id: "D2"'], ['h5.mjs', 44, 'id: "D3"'], ['h5.mjs', 55, 'id: "D4"'], ['h5.mjs', 66, 'id: "D5"'], ['h5.mjs', 77, 'id: "D6"'],
  ['main.css', 6391, '.dj-cue-salida {'], ['main.css', 6394, 'min-width: 0;'],   // 6394 = el min-width del select (ancla débil: la 6391 fija el bloque)
  ['main.css', 6404, '.dj-cue-canales { display: flex; align-items: center; gap: 12px; margin: 0; padding: 0; border: 0; min-width: 0;'],
  ['DjPage.jsx', 130, 'El Modo DJ es solo para escritorio'], ['main.css', 6269, '@media (max-width: 899px) {'], ['main.css', 6270, '.dj-solo-escritorio { display: block; }'],
  ['dj-matriz.mjs', 115, 'const CONOCIDOS = ['], ['dj-matriz.mjs', 116, "metrica: 'objetivos_24px', id: 'H1', evidencia: ['INPUT[radio] [13×13]']"],
  ['dj-matriz.mjs', 117, 'miden 13×13 px: el tamaño del navegador'],
  ['dj-matriz.mjs', 550, 'const cubre = (c, k) => !c.evidencia'], ['dj-matriz.mjs', 551, '`ARREGLADO ${c.id}`'], ['dj-matriz.mjs', 552, 'conocido_sin_caso_'],
  ['dj-matriz.mjs', 122, 'const CONOCIDOS_ENV = (() => {'], ['DjPage.jsx', 492, "useWindowedRows(filtered.length, { overscan: 8, scroller: '.dj-lista-scroll' })"],
];
const lineas = {};
const leer = (k) => (lineas[k] ??= fs.readFileSync(path.join(R, F[k]), 'utf8').split('\n'));
let bien = 0, mal = 0;
const enTabla = new Set();
for (const [k, n, t] of E) {
  const l = leer(k)[n - 1] ?? '';
  if (l.includes(t)) bien++;
  else { mal++; console.log(`FALLA ${k}:${n} esperaba «${t}» y dice: ${l.trim().slice(0, 140)}`); }
  enTabla.add(`${k}:${n}`);
}
// Todas las citas del SKILL.md (`archivo:N` y rangos `archivo:N`–`M`) tienen que tener su fila en E.
const sk = fs.readFileSync(SKILL, 'utf8');
const citas = new Set();
const re = /`([\w.-]+\.(?:mjs|jsx|js|css|json)):(\d+)`(?:–`(\d+)`)?/g;   // h5f: también .css y .json
for (const m of sk.matchAll(re)) { citas.add(`${m[1]}:${m[2]}`); if (m[3]) citas.add(`${m[1]}:${m[3]}`); }
const sinComprobar = [...citas].filter((c) => !enTabla.has(c));
for (const c of sinComprobar) console.log(`SIN COMPROBAR ${c}: está en el SKILL.md y no tiene texto esperado en la tabla E`);
// Red: un SKILL.md del que no sale NINGUNA cita es la regex rota o el archivo equivocado, no una skill al día.
if (!citas.size) console.log('FALLA: no se extrajo ninguna cita del SKILL.md');
console.log(`${path.relative(R, SKILL) || SKILL}: ${bien}/${E.length} coinciden · ${mal} fallan · ${citas.size} citas distintas en la skill · ${sinComprobar.length} sin texto esperado`);
process.exit(mal || sinComprobar.length || !citas.size ? 1 : 0);
