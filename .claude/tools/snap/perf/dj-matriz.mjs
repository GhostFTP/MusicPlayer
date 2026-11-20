// dj-matriz.mjs — MATRIZ VISUAL del Modo DJ (h5a: E1 × 3 ventanas; h5b: 11 estados × 6 ventanas + la cola abierta).
// El mismo /dj medido en varios estados y tamaños de ventana, para atrapar desbordes antes de que los vea Oscar.
//
//   SNAP_BASE=http://localhost:4173 node dj-matriz.mjs        (lo normal: por el runner, abajo)
//   node regresion.mjs --solo dj-matriz                         (build + servidores aislados + esta matriz; está en baseline.json)
//
// MÉTRICAS, cada una un caso por celda (estado × ventana que cuenta). Las de h5a, sin cambios:
//   · sin_scroll_horizontal: .main-content y document.scrollingElement con scrollWidth ≤ clientWidth.
//   · nada_fuera_del_area: todo descendiente de .dj-page con caja de ancho > 0 queda entre el borde izquierdo y el
//     derecho del CONTENIDO de .main-content (sin su padding), con 0,5 px de margen (generaliza dj-func.mjs:1521–1523
//     a los dos lados). Se nombran las clases de los que se salen (las 8 primeras, como ce12).
// Las de h5c (sólo escritorio con ratón; la tablet es h5d). «Visible» = checkVisibility (sin display:none propio ni de
// un ancestro), visibility 'visible' y caja de ancho y alto > 0:
//   · sin_solapes: en CADA elemento de .dj-page (y .dj-page misma) con dos o más hijos visibles, ningún par de hermanos se
//     intersecta en más de 0,5 px de ancho Y de alto; se reporta el par de clases, los px y el contenedor. Contenedores de
//     filas que hay en /dj (leídos en DjPage.jsx, CueDj.jsx, ControlDj.jsx y main.css:6252–6470; todos se revisan solos,
//     porque se recorren TODOS): .dj-page, .section-header › .lib-heading › .lib-headtext, .dj-decks, .dj-deck y sus hijos
//     .dj-deck-cabeza (lado, pista, chip), .dj-deck-pista (título, artista), .dj-deck-tiempos, .dj-deck-controles
//     (Play, Al inicio, Cue, estado), .dj-deck-aviso y .dj-deck-aviso-acciones; .dj-mezcla, .dj-mezcla-cabeza, .dj-midi,
//     .dj-mezcla-controles, .dj-control / .dj-cue-control, .dj-control-cabeza, .dj-control-extremos; .dj-cue,
//     .dj-cue-cabeza, .dj-cue-fila, .dj-cue-canales (leyenda flotante y las dos etiquetas), .dj-cue-ajustes,
//     .dj-cue-desfase-caja, .dj-cue-pasos, .dj-cue-aviso; .dj-biblioteca, .dj-lista (filas y espaciadoras), .dj-fila,
//     .dj-fila-texto y el QualityChip. EXCLUSIONES, cada una con su motivo:
//       1. el CONTENIDO de un control (button, select, option, a, [role=button], input): el texto y los íconos de un
//          botón forman UN objetivo y se superponen a propósito; las <option> no se pintan en la página.
//       2. los hijos con position absolute o fixed: son capas que se apoyan encima a propósito (no participan del flujo).
//       3. los pulgares de los range: viven en el shadow DOM del <input> y no son hijos de nadie (no se recorren).
//       4. lo no visible (arriba): no puede tapar a nadie.
//   · sin_texto_cortado: cada elemento visible de .dj-page con overflow ≠ visible cuyo contenido no entra
//     (scrollWidth > clientWidth + 1 o scrollHeight > clientHeight + 1). FALLA si su text-overflow no es ellipsis
//     (texto perdido sin aviso); con ellipsis sólo se REGISTRA (conElipsis: clase, texto y px; en V1 se aceptan los
//     nombres largos con puntos suspensivos). EXCLUSIÓN 5: el eje con overflow auto o scroll (la lista de la biblioteca):
//     ese contenido se alcanza scrolleando, no se pierde.
//   · objetivos_24px: todo control visible y HABILITADO (button, select, input que no sea range, a, [role=button]) mide
//     al menos 24×24 px (WCAG 2.2, 2.5.8). Red: los medidos (por selector) CUADRAN con los contados aparte (recorriendo
//     todos los elementos por tagName/role) y hay alguno. Los range se miden por su CAJA y sólo van al registro
//     (rangos < 44 y sus cajas). Registro: cuántos controles miden menos de 44×44 (menos44).
//   · sin_colapsados: todo control (range incluido, habilitado o no) visible por CSS con caja de menos de 1 px de ancho
//     o de alto FALLA.
//   · decks_a_la_vista (sólo ventanas SIN cola y de 768 px de alto o más): la PROMESA literal de main.css:6278–6280,
//     «La lista de la biblioteca scrollea en su PROPIA caja (.dj-lista-scroll, el scroller de useWindowedRows): los
//     decks quedan siempre a la vista.» → con el scroll de .main-content arriba, los dos .dj-deck enteros dentro de lo
//     visible de .main-content. main.css:6435–6437 (el 807) no promete nada visible: es la medida de cs12 (dj-func), que
//     no se duplica; acá sólo se REGISTRAN el scroll vertical de .main-content (scrollV) y la X fuera de la lista
//     (la fórmula de medirAlto, dj-func.mjs:1072–1083).
//   Antes de medir cada celda, el scroll de .main-content se pone arriba (el clic de Playwright al armar el estado lo
//   puede mover; no cambia nada en horizontal).
//   Red anti pase en falso, DENTRO de cada métrica: .dj-page existe, se midió al menos un elemento y la medida se
//   estabilizó. Espera estable: tras cada setViewportSize, dos frames y dos medidas IGUALES seguidas (no un sleep).
//
// VENTANAS (con ratón): 900×800, 1024×768, 1280×800, 1366×768, 1440×900 y 1920×1080 con la cola cerrada; con la COLA
// ABIERTA (showQueue: Layout.jsx:266 y :292, la 3.ª columna del grid de main.css:5809, ancho --queue-w de main.css:29)
// cuentan 1280×800, 1366×768, 1440×900 y 1920×1080; 900×800 y 1024×768 con la cola se miden pero van al REGISTRO (el
// contenido queda por debajo de lo usable: es una decisión de producto, no un fallo de la matriz).
//
// CÓMO SE LLEGA A CADA ESTADO. Cada estado se arma UNA vez, desde cero (visita()):
//   1. limpia localStorage 'djCue' y sessionStorage '__fdCfg'/'__fmCfg' (o escribe los del estado), ventana 1280×800;
//   2. carga / (la Biblioteca, con la barra del reproductor) y ABRE LA COLA con su botón (.queue-btn), como un usuario:
//      dentro de /dj la barra está oculta (.layout--dj), así que la cola sólo se abre desde otra vista;
//   3. entra a /dj con «Modo DJ» de la barra lateral (navegación de la app: showQueue vive en Layout y sigue abierta);
//   4. arma el estado con la interfaz (abajo), lo AFIRMA (caso <estado>_alcanzado) y recorre las ventanas con la cola;
//   5. cierra la cola con su «Cerrar cola» (.queue-close: la consola no se desmonta) y recorre las 6 ventanas;
//   6. vuelve a afirmar el estado al final (si algo lo cambió durante el recorrido, el caso _alcanzado falla).
//   E1  sin salida: nada guardado, permiso de micrófono sin dar → cue 'sin-salida', lista 'inactivo', «Ver salidas de
//       audio», los dos motivos «Para usar Cue…» (como cs0 de dj-func).
//   E2  salida lista con decks vacíos: «Ver salidas de audio» (getUserMedia falso → nombres) y «Usar» con
//       «Headphones (Elgato Wave:XLR)» (wave-0001) y 1-2 → 'lista'; los dos decks 'vacio'.
//   E3  E2 + A = la pista del título largo y B = la del artista largo (buscador + botón A/B, en pausa) y Cue en A.
//   E4  la salida que falta: guardada wave-0001 y desenchufada (__fdCfg { permiso: 'granted', quitados: ['wave-0001'] },
//       como cr13 de dj-func) → el aviso ámbar «La salida de audífonos guardada … no está conectada» y los motivos
//       «Cue no disponible: conecta …» en los dos decks.
//   E5  E4 con una salida guardada de 120 caracteres que no existe (id 'largo-0001'): el nombre en el aviso y en los dos
//       motivos del botón Cue.
//   E7a biblioteca llena: E1 con la lista de la biblioteca bajada hasta el fondo (la fila 40, la del artista largo).
//   E7b búsqueda con resultados: E1 con «corazon» en el buscador → las 4 pistas que coinciden (una con tildes y eñe).
//   E7c E1 con una búsqueda sin resultados → «Nada coincide con la búsqueda.» y la lista vacía.
//   E8  error del motor: «Ver salidas» y «Usar» con hp-0002 («Headphones (2)», setSinkId falso → NotFoundError) →
//       'error', el aviso del motor y el motivo «la salida de audífonos falló» en los dos decks.
//   E9  confirmación: «Usar» con sb-0001 (la del master) y 1-2 → «Esa salida es la misma del master…» con «Usarla
//       igual» y «Cancelar», SIN confirmar (el motor sigue 'sin-salida').
//   E10 el peor caso de ce12: la DDJ (ddj-0001) con 3-4 (el «Ojo» de 3-4, volumen y desfase), A y B cargadas en pausa
//       (título largo y artista largo) y los dos Cue encendidos (con su nota de V1).
// La BIBLIOTECA es la fija de dj-biblioteca-fija.mjs (40 pistas, ctx.route): no se lee la base real.
//
// CONOCIDOS (abajo): los fallos REALES del estado limpio, cada uno con su hallazgo (H1, H2…). Un caso que falla y está
// ahí se imprime CONOCIDO y cuenta como pasado; uno que falla y no está, FALLA; un CONOCIDO que ahora pasa se imprime
// ARREGLADO y FALLA (así la línea n/m obliga a quitarlo a mano de la lista, en el mismo commit que lo arregló). Una entrada
// cuyo caso no existe FALLA como conocido_sin_caso_<clave>. Desde h5c una entrada puede llevar `evidencia` (sólo esa
// evidencia es conocida: si el caso falla con algo más, FALLA) y abarcar varios estados y ventanas (ver CONOCIDOS).
// DJ_MATRIZ_CONOCIDOS=<arreglo JSON> (h5c, para PROBAR el mecanismo): entradas que se SUMAN a CONOCIDOS sólo en esa
// corrida; se lee únicamente si la variable está puesta (sin ella, nada cambia). mutar.mjs y regresion.mjs pasan su
// entorno a los hijos (mutar.mjs:74, regresion.mjs:341), así que llega puesta desde `DJ_MATRIZ_CONOCIDOS=… node mutar.mjs`.
//
// Los falsos (AudioContext/setSinkId, MIDI mínimo, mediaDevices) son una COPIA de dj-func: dj-falsos.mjs.
// Salida: el tablero estado × ventana, el detalle de lo que no pasa, el registro, y la línea «dj-matriz: n/m» (modo
// name-line de regresion.mjs); exit 0 o 1. Con DJ_MATRIZ_SALIDA=<archivo>, el resultado completo va también a ese
// archivo (lo usa mutar.mjs --suites dj-matriz: `fallan` = lo que FALLA o sale ARREGLADO, nunca lo CONOCIDO).
import { writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE } from '../session.mjs';
import { preparar, instalarFalsos } from './dj-falsos.mjs';
import { PISTAS, servirBiblioteca, TITULO_LARGO, ARTISTA_LARGO, BUSQUEDA, BUSQUEDA_N, NADA } from './dj-biblioteca-fija.mjs';

const SIN_COLA = [[900, 800], [1024, 768], [1280, 800], [1366, 768], [1440, 900], [1920, 1080]];
const CON_COLA = [[1280, 800], [1366, 768], [1440, 900], [1920, 1080]];
const CON_COLA_REG = [[900, 800], [1024, 768]];

// { estado, ventana, metrica, id, motivo [, evidencia] }. estado: 'e2' o un arreglo; ventana: '1280x800', 'cola_1280x800', un
// arreglo o '*' (las 10 que cuentan); metrica: uno de los sufijos de METRICAS. Cada entrada se EXPANDE a sus casos.
// Con `evidencia` (h5c: un arreglo de textos EXACTOS de la evidencia del caso, p. ej. 'INPUT[radio] [13×13]'), el caso
// sale CONOCIDO sólo si falla y TODA su evidencia está en esa lista: si aparece algo más (otro control chico, otro
// solape), FALLA igual. Sin `evidencia`, el caso entero (como en h5b). Así un hallazgo conocido no tapa uno nuevo.
const CONOCIDOS = [
  { estado: ['e2', 'e3', 'e4', 'e5', 'e8', 'e9', 'e10'], ventana: '*', metrica: 'objetivos_24px', id: 'H1', evidencia: ['INPUT[radio] [13×13]'],
    motivo: 'los dos botones de opción de «Canales» (.dj-cue-canales input[type=radio], 1-2 y 3-4) miden 13×13 px: el tamaño del navegador, main.css no les da ninguno; su <label class="dj-cue-canal"> también los marca' },
];
// DJ_MATRIZ_CONOCIDOS (h5c): un arreglo JSON de entradas con el MISMO formato, que se SUMAN a CONOCIDOS sólo en esa
// corrida (para probar CONOCIDO/ARREGLADO sin editar la lista). Sólo se lee si la variable está puesta; sin ella, nada
// cambia. Si no es un arreglo JSON, el script corta antes de abrir el navegador (sin línea n/m: el runner lo ve).
const CONOCIDOS_ENV = (() => {
  const t = process.env.DJ_MATRIZ_CONOCIDOS;
  if (t === undefined) return [];
  const v = JSON.parse(t);
  if (!Array.isArray(v)) throw new Error('DJ_MATRIZ_CONOCIDOS tiene que ser un arreglo JSON');
  return v;
})();

const R = {};
const REG = { celdas: {}, cola_registro: {}, tablet: {} };   // lo que sólo se registra (no cuenta en el n/m)

// ── CAPTURAS (h5e): sólo con DJ_MATRIZ_CAPTURAS=1; sin la variable no se escribe nada y la corrida es la de siempre ──
// PNG del VIEWPORT (lo que ve el usuario, sin scroll; scale 'css' = 1 px por px de CSS, deviceScaleFactor 1 en todos los
// contextos) en .claude/tools/snap/shots/dj-matriz/<AAAA-MM-DD-HHmmss><DJ_MATRIZ_CAPTURAS_SUFIJO>/<estado>_<ventana>.png.
// ANTES de escribir, git check-ignore sobre esa carpeta (como regresion.mjs:227–228); si NO está ignorada, el script
// corta sin abrir el navegador (exit 2, sin línea n/m). Determinismo: decks en pausa, la biblioteca fija, el cursor de
// texto oculto (caret 'hide'), animaciones desactivadas y el ratón llevado a (0, 0) justo antes de capturar (DESPUÉS de
// medir: la medida es la misma con o sin capturas).
// Qué se captura: por defecto E1, E3, E5, E7a, E8 y E10 × 900x800, 1366x768, 1920x1080, cola_1366x768 y cola_900x800;
// con DJ_MATRIZ_CAPTURAS_TODAS=1, los 11 estados × las 12 ventanas; DJ_MATRIZ_CAPTURAS_ESTADOS y
// DJ_MATRIZ_CAPTURAS_VENTANAS (listas separadas por comas) reemplazan el subconjunto. La tablet (abajo) captura siempre
// sus tres estados. Junto a las PNG, medidas.json: por captura, la caja de .dj-cue-fila y de cada hijo, y del select
// (caja, scrollWidth/clientWidth, el texto elegido y su ancho con la fuente del select) — para el experimento D2.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..');
const CAPT = process.env.DJ_MATRIZ_CAPTURAS === '1';
const deComas = (v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : null);
const TODAS = process.env.DJ_MATRIZ_CAPTURAS_TODAS === '1';
const CAPT_ESTADOS = deComas(process.env.DJ_MATRIZ_CAPTURAS_ESTADOS) ?? (TODAS ? null : ['e1', 'e3', 'e5', 'e7a', 'e8', 'e10']);
const CAPT_VENTANAS = deComas(process.env.DJ_MATRIZ_CAPTURAS_VENTANAS) ?? (TODAS ? null : ['900x800', '1366x768', '1920x1080', 'cola_1366x768', 'cola_900x800']);
let CAPT_DIR = null;
const capturas = [], medidasCaptura = {};
if (CAPT) {
  const d = new Date(), dos = (n) => String(n).padStart(2, '0');
  const sello = `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}-${dos(d.getHours())}${dos(d.getMinutes())}${dos(d.getSeconds())}`;
  CAPT_DIR = join(REPO, '.claude', 'tools', 'snap', 'shots', 'dj-matriz', sello + (process.env.DJ_MATRIZ_CAPTURAS_SUFIJO ?? ''));
  const ign = spawnSync('git', ['check-ignore', '-q', join(CAPT_DIR, 'x.png')], { cwd: REPO });
  if (ign.status !== 0) { console.log(`⚠ ${CAPT_DIR} NO está ignorada por git: no escribo capturas y corto acá`); process.exit(2); }
  mkdirSync(CAPT_DIR, { recursive: true });
}
const ok = (k, v, extra) => { R[k] = extra === undefined ? !!v : { ok: !!v, ...extra }; };
const t0 = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esperar = async (fn, ms = 6000, paso = 100) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(paso); } return null; };

// Textos esperados, escritos acá (no importados de cue.js): si el código cambia uno, la matriz no mide la página equivocada.
const WAVE = 'Headphones (Elgato Wave:XLR)';
const LARGO = 'Salida de audífonos con un nombre larguísimo de ciento veinte caracteres para ver cómo se parte el aviso y el motivo, sí';
const TXT = {
  inactivo: 'Para mostrar los nombres de las salidas de audio, el navegador pide permiso de micrófono. No se graba nada: el micrófono se cierra al instante.',
  misma: 'Esa salida es la misma del master: el cue sonaría por los mismos altavoces.',
  motivoSin: 'Para usar Cue, elige una salida de audífonos abajo, en «Audífonos (cue)».',
  motivoErr: 'Cue no disponible: la salida de audífonos falló. Quítala o elige otra.',
  motivoAus: (n) => `Cue no disponible: conecta «${n}» o elige otra salida.`,
  ausente: (n) => `La salida de audífonos guardada «${n}» no está conectada. Conéctala o elige otra.`,
  noEncontro2: 'No se encontró la salida «Headphones (2)». Cue apagado; el master sigue igual.',
  listoWave: (cue = '') => `Listo: «${WAVE}» · canales 1-2${cue}.`,   // con un Cue encendido: « · cue A» (cue.js, textoEstadoCue)
  listoDdj34: 'Listo: «Línea (2- DDJ-400)» · canales 3-4 · cue A y B.',
  notaPausa: 'Cue activo: dale play para preescuchar. En esta versión el cue no suena en pausa: baja el volumen del deck o el crossfader para que no salga por el master.',
  nada: 'Nada coincide con la búsqueda.',
};
const G = (actual) => JSON.stringify({ v: 1, actual, salidas: [] });
const P_LARGO = PISTAS[0], P_ARTISTA = PISTAS[39];

// Lo que se mide, en la página (h5a). Sin .dj-page → { pagina: false } (y los casos fallan).
const medir = () => {
  const sc = document.querySelector('.main-content'), pg = document.querySelector('.dj-page');
  if (!sc || !pg) return { pagina: !!pg, main: !!sc };
  const cs = getComputedStyle(sc), r = sc.getBoundingClientRect();
  const izq = r.left + sc.clientLeft + parseFloat(cs.paddingLeft);
  const der = r.left + sc.clientLeft + sc.clientWidth - parseFloat(cs.paddingRight);
  const nombre = (e) => (typeof e.className === 'string' && e.className ? e.className : e.tagName);
  let medidos = 0;
  const fuera = [];
  for (const e of pg.querySelectorAll('*')) {
    const q = e.getBoundingClientRect();
    if (!(q.width > 0)) continue;
    medidos++;
    if (q.left < izq - 0.5 || q.right > der + 0.5) fuera.push(`${nombre(e)} [${Math.round(q.left)}–${Math.round(q.right)}]`);
  }
  const d = document.scrollingElement;
  const px = (v) => Math.round(v * 10) / 10;

  // h5c · visible = checkVisibility (sin display:none propio ni de un ancestro), visibility 'visible' y caja de ancho y
  // alto > 0. `visCss` es lo mismo SIN mirar la caja (para la red de colapsados).
  const visCss = (e) => e.checkVisibility({ checkVisibilityCSS: true }) && getComputedStyle(e).visibility === 'visible';
  const vis = (e) => { if (!visCss(e)) return false; const q = e.getBoundingClientRect(); return q.width > 0 && q.height > 0; };
  const todos = [pg, ...pg.querySelectorAll('*')];
  // Exclusión 1 de los solapes: dentro de un control no se buscan solapes (ver la cabecera). Dentro de medir: corre en la página.
  const EXCL_CONTENEDOR = 'button, select, option, a, [role="button"], input';

  // (A) SOLAPES entre hermanos visibles de cada contenedor (ver la cabecera: contenedores y exclusiones).
  const solapes = [];
  let contenedores = 0;
  for (const c of todos) {
    if (c.matches(EXCL_CONTENEDOR)) continue;   // exclusión 1: el contenido de un control (texto e íconos de un botón…)
    const hijos = [...c.children].filter((h) => vis(h) && !['absolute', 'fixed'].includes(getComputedStyle(h).position));   // exclusión 2
    if (hijos.length < 2) continue;
    contenedores++;
    const cajas = hijos.map((h) => h.getBoundingClientRect());
    for (let i = 0; i < hijos.length; i++) for (let j = i + 1; j < hijos.length; j++) {
      const a = cajas[i], b = cajas[j];
      const iw = Math.min(a.right, b.right) - Math.max(a.left, b.left), ih = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (iw > 0.5 && ih > 0.5) solapes.push(`${nombre(hijos[i])} × ${nombre(hijos[j])} [${px(iw)}×${px(ih)} px] en ${nombre(c)}`);
    }
  }

  // (B) TEXTO CORTADO: overflow ≠ visible y contenido mayor que la caja (+1 px). El eje que SCROLLEA (auto/scroll) se
  // excluye: ese contenido se alcanza scrolleando, no se pierde (exclusión 3, la lista de la biblioteca).
  const cortados = [], conElipsis = [];
  for (const e of todos) {
    const cs = getComputedStyle(e);
    if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
    if (!vis(e)) continue;
    const scrollea = (o) => o === 'auto' || o === 'scroll';
    const h = e.scrollWidth > e.clientWidth + 1 && !scrollea(cs.overflowX), v = e.scrollHeight > e.clientHeight + 1 && !scrollea(cs.overflowY);
    if (!h && !v) continue;
    const dato = `${nombre(e)} «${(e.textContent ?? '').trim().slice(0, 48)}» [${h ? `ancho ${e.scrollWidth}>${e.clientWidth}` : ''}${h && v ? ' · ' : ''}${v ? `alto ${e.scrollHeight}>${e.clientHeight}` : ''}]`;
    (cs.textOverflow === 'ellipsis' ? conElipsis : cortados).push(dato);
  }

  // (C) OBJETIVOS: los controles visibles y habilitados (no range) por un selector, y CONTADOS APARTE recorriendo todos
  // los elementos por tagName/role (la red: si uno de los dos caminos se salta controles, no cuadran).
  const SEL_CTRL = 'button, select, input:not([type="range"]), a, [role="button"]';
  const habil = (e) => vis(e) && !e.matches(':disabled');
  const medidosCtrl = [...pg.querySelectorAll(SEL_CTRL)].filter(habil);
  const esCtrl = (e) => ['BUTTON', 'SELECT', 'A'].includes(e.tagName) || (e.tagName === 'INPUT' && e.type !== 'range') || e.getAttribute('role') === 'button';
  const contados = todos.filter((e) => esCtrl(e) && habil(e)).length;
  const caja = (e) => { const q = e.getBoundingClientRect(); return [px(q.width), px(q.height)]; };
  const chicos = medidosCtrl.filter((e) => { const [w, h] = caja(e); return w < 24 || h < 24; })
    .map((e) => `${nombre(e)}${e.type && e.tagName === 'INPUT' ? `[${e.type}]` : ''} [${caja(e).join('×')}]`);
  const menos44 = medidosCtrl.filter((e) => { const [w, h] = caja(e); return w < 44 || h < 44; }).length;
  const lista44 = [...new Set(medidosCtrl.filter((e) => { const [w, h] = caja(e); return w < 44 || h < 44; }).map((e) => `${nombre(e)}${e.tagName === 'INPUT' ? `[${e.type}]` : ''} [${caja(e).join('×')}]`))];   // h5e: para la tablet
  const rangos = [...pg.querySelectorAll('input[type="range"]')].filter(vis);
  const rangosMenos44 = rangos.filter((e) => { const [w, h] = caja(e); return w < 44 || h < 44; }).length;
  const altoRango = rangos.length ? Math.min(...rangos.map((e) => caja(e)[1])) : null;
  const cajasRango = [...new Set(rangos.map((e) => `${nombre(e)} ${caja(e).join('×')}`))];
  const etiquetasCanales = [...new Set([...pg.querySelectorAll('label.dj-cue-canal')].filter(vis).map((e) => caja(e).join('×')))];   // para H1
  // Red de colapsados: TODO control (range incluido, habilitado o no) visible por CSS con caja < 1 px de ancho o de alto.
  const colapsados = [...pg.querySelectorAll('button, select, input, a, [role="button"]')].filter((e) => visCss(e) && (() => { const [w, h] = caja(e); return w < 1 || h < 1; })())
    .map((e) => `${nombre(e)} [${caja(e).join('×')}]`);

  // (D) ALTO, con el scroll de .main-content arriba (la matriz nunca lo mueve): scroll vertical, X fuera de la lista
  // (la fórmula de medirAlto, dj-func.mjs:1072–1083) y los decks enteros dentro de lo visible de .main-content.
  const lista = document.querySelector('.dj-lista-scroll')?.getBoundingClientRect().height ?? null;
  const vTop = r.top + sc.clientTop, vBot = vTop + sc.clientHeight;
  const decks = [...pg.querySelectorAll('.dj-deck')].map((e) => { const q = e.getBoundingClientRect(); return { top: Math.round(q.top - vTop), bottom: Math.round(q.bottom - vTop), dentro: q.top >= vTop - 0.5 && q.bottom <= vBot + 0.5 }; });

  return {
    pagina: true, vw: innerWidth, vh: innerHeight, area: [Math.round(izq), Math.round(der)], medidos, nFuera: fuera.length, fuera: fuera.slice(0, 8),
    main: { sw: sc.scrollWidth, cw: sc.clientWidth }, doc: { sw: d.scrollWidth, cw: d.clientWidth },
    contenedores, solapes,
    cortados, conElipsis,
    ctrl: { medidos: medidosCtrl.length, contados, chicos, menos44, lista44, rangos: rangos.length, rangosMenos44, altoRango, cajasRango, etiquetasCanales }, colapsados,
    alto: { scrollTop: sc.scrollTop, scrollV: sc.scrollHeight - sc.clientHeight, visible: sc.clientHeight, X: lista === null ? null : Math.round(innerHeight - sc.clientHeight + (sc.scrollHeight - lista)), decks },
  };
};

// Dos frames y dos medidas iguales seguidas; a lo sumo 30 intentos. → { m, intentos } o { m, intentos, inestable: true }.
async function medirEstable(p) {
  let prev = null;
  for (let i = 1; i <= 30; i++) {
    await p.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
    const m = await p.evaluate(medir);
    if (prev !== null && JSON.stringify(m) === JSON.stringify(prev)) return { m, intentos: i };
    prev = m;
  }
  return { m: prev, intentos: 30, inestable: true };
}

const { browser, abrir } = await preparar();
const { ctx, p: p0, errores } = await abrir(BASE, '/', { w: 1280, h: 800, esperar: '.player-bar' });
let p = p0;   // la página ACTIVA: la de escritorio, o la de un contexto de tablet mientras se mide (h5e)

// Lo que la página muestra del cue, de los decks y de la biblioteca (para afirmar cada estado).
const foto = () => p.evaluate(() => {
  const s = document.querySelector('.dj-cue');
  const q = (x) => s?.querySelector(x)?.textContent ?? null;
  const decks = Object.fromEntries(['A', 'B'].map((l) => {
    const d = document.querySelector(`.dj-deck[data-lado="${l}"]`);
    return [l, d ? { estado: d.dataset.estado, cue: d.dataset.cue, titulo: d.querySelector('.dj-deck-titulo')?.textContent ?? null,
      artista: d.querySelector('.dj-deck-artista')?.textContent ?? null, motivo: d.querySelector('.dj-deck-cue-motivo')?.textContent ?? null,
      nota: d.querySelector('.dj-deck-cue-nota')?.textContent ?? null } : null];
  }));
  const ls = document.querySelector('.dj-lista-scroll');
  const filas = [...document.querySelectorAll('.dj-fila')];
  return {
    ruta: location.pathname, cola: !!document.querySelector('.layout--queue .queue-panel'), falsos: !!window.__fd && !!window.__ac,
    cue: s ? { estado: s.dataset.estado, lista: s.dataset.lista, salida: s.dataset.salida, canales: s.dataset.canales, textoEstado: q('.dj-cue-estado'),
      textoLista: q('.dj-cue-lista-texto'), ver: !!s.querySelector('.dj-cue-ver'), select: !!s.querySelector('.dj-cue-salida'), sel: s.querySelector('.dj-cue-salida')?.value ?? null,
      ojo: !!s.querySelector('.dj-cue-ojo'), ajustes: !!s.querySelector('.dj-cue-ajustes'), quitar: !!s.querySelector('.dj-cue-quitar'),
      confirmacion: q('.dj-cue-confirmacion p'), avisoMotor: q('.dj-cue-aviso-motor p'), avisoUi: q('.dj-cue-aviso-ui p') } : null,
    decks,
    lib: { query: document.querySelector('.dj-buscar')?.value ?? null, nota: document.querySelector('.dj-biblioteca-nota')?.textContent ?? null,
      filas: filas.length, primera: filas[0]?.dataset.id ?? null, indices: filas.map((f) => Number(f.dataset.index)), scrollTop: ls ? Math.round(ls.scrollTop) : null },
  };
});
const sel = (lado, s) => `.dj-deck[data-lado="${lado}"] ${s}`;
const esperarFoto = (cond, ms = 6000) => esperar(async () => { const f = await foto(); return cond(f) ? f : null; }, ms);

// 1–3 de la cabecera: storage del estado, / con la cola abierta por su botón, y /dj por la barra lateral.
async function visita({ cue = null, fd = null } = {}, { cola = true, w = 1280, h = 800 } = {}) {
  await p.setViewportSize({ width: w, height: h });
  await p.evaluate(({ cue, fd }) => {
    if (cue) localStorage.setItem('djCue', cue); else localStorage.removeItem('djCue');
    if (fd) sessionStorage.setItem('__fdCfg', JSON.stringify(fd)); else sessionStorage.removeItem('__fdCfg');
    sessionStorage.removeItem('__fmCfg');
  }, { cue, fd });
  await p.goto(BASE + '/');
  await p.waitForSelector('.player-bar', { timeout: 15000 });
  if (cola) {
    await p.waitForSelector('.player-bar .queue-btn', { timeout: 15000 });
    await p.locator('.player-bar .queue-btn').click();
    await p.waitForSelector('.layout--queue .queue-panel', { timeout: 5000 });
  }
  await p.locator('.sidebar-nav button', { hasText: /^Modo DJ$/ }).click();
  await p.waitForSelector('.dj-cue', { timeout: 15000 });
  await p.waitForSelector('.dj-fila', { timeout: 15000 });
  await esperarFoto((f) => f.ruta === '/dj' && f.lib.filas > 0 && f.lib.primera === String(PISTAS[0].id), 6000);
}
const verSalidas = async () => { await p.locator('.dj-cue-ver').click(); await esperarFoto((f) => f.cue?.lista === 'lista' && f.cue.select); };
const elegir = async (id, canales) => { await p.locator('.dj-cue-salida').selectOption(id); await p.locator(`.dj-cue-canales input[value="${canales}"]`).check(); };
const usar = async (id, canales) => { await elegir(id, canales); await p.locator('.dj-cue-usar').click(); };
const cargarEn = async (lado, pista) => {
  await p.locator('.dj-buscar').fill(pista.title);
  await p.locator(`.dj-fila[data-id="${pista.id}"] .dj-cargar-${lado.toLowerCase()}`).click();
  await esperarFoto((f) => f.decks[lado]?.estado === 'pausa' && f.decks[lado].titulo === pista.title, 8000);
  await p.locator('.dj-buscar').fill('');
  await esperarFoto((f) => f.lib.query === '' && f.lib.primera === String(PISTAS[0].id));
};
const cueEn = async (lado) => { await p.locator(sel(lado, '.dj-cue-btn')).click(); await esperarFoto((f) => f.decks[lado]?.cue === '1', 3000); };

// Cada estado: cómo se arma (después de visita()) y qué tiene que verse para aceptarlo. `visita` = sus storages.
const ambos = (f, k, v) => ['A', 'B'].every((l) => f.decks[l]?.[k] === v);
const sinSalida = (f) => f.cue?.estado === 'sin-salida' && f.cue.lista === 'inactivo' && f.cue.ver && f.cue.textoLista === TXT.inactivo && ambos(f, 'motivo', TXT.motivoSin) && ambos(f, 'estado', 'vacio');
const listaWave = (f, cue = '') => f.cue?.estado === 'lista' && f.cue.salida === 'wave-0001' && f.cue.canales === '1-2' && f.cue.textoEstado === TXT.listoWave(cue) && f.cue.select && f.cue.ajustes && f.cue.quitar;
const libArriba = (f) => f.lib.query === '' && f.lib.nota === null && f.lib.primera === String(PISTAS[0].id);
const ESTADOS = [
  { e: 'e1', armar: async () => {}, es: (f) => sinSalida(f) && libArriba(f) },
  { e: 'e2', armar: async () => { await verSalidas(); await usar('wave-0001', '1-2'); await esperarFoto(listaWave); },
    es: (f) => listaWave(f) && ambos(f, 'estado', 'vacio') && ambos(f, 'cue', '0') && libArriba(f) },
  { e: 'e3', armar: async () => { await verSalidas(); await usar('wave-0001', '1-2'); await esperarFoto(listaWave); await cargarEn('A', P_LARGO); await cargarEn('B', P_ARTISTA); await cueEn('A'); },
    es: (f) => listaWave(f, ' · cue A') && ambos(f, 'estado', 'pausa') && f.decks.A.titulo === TITULO_LARGO && f.decks.B.artista === ARTISTA_LARGO
      && f.decks.A.cue === '1' && f.decks.B.cue === '0' && f.decks.A.nota === TXT.notaPausa && f.decks.B.nota === null && libArriba(f) },
  { e: 'e4', visita: { cue: G({ id: 'wave-0001', nombre: WAVE, canales: '1-2' }), fd: { permiso: 'granted', quitados: ['wave-0001'] } },
    armar: async () => { await esperarFoto((f) => !!f.cue?.avisoUi); },
    es: (f) => f.cue?.estado === 'sin-salida' && f.cue.lista === 'lista' && f.cue.avisoUi === TXT.ausente(WAVE) && f.cue.quitar && ambos(f, 'motivo', TXT.motivoAus(WAVE)) && libArriba(f) },
  { e: 'e5', visita: { cue: G({ id: 'largo-0001', nombre: LARGO, canales: '1-2' }), fd: { permiso: 'granted' } },
    armar: async () => { await esperarFoto((f) => !!f.cue?.avisoUi); },
    es: (f) => f.cue?.estado === 'sin-salida' && f.cue.lista === 'lista' && f.cue.avisoUi === TXT.ausente(LARGO) && f.cue.quitar && ambos(f, 'motivo', TXT.motivoAus(LARGO)) && libArriba(f) },
  { e: 'e7a', armar: async () => {
    await p.evaluate(() => { const l = document.querySelector('.dj-lista-scroll'); l.scrollTop = l.scrollHeight; l.dispatchEvent(new Event('scroll')); });
    await esperarFoto((f) => f.lib.indices.includes(PISTAS.length - 1));
  }, es: (f) => f.cue?.estado === 'sin-salida' && f.cue.ver && f.lib.query === '' && f.lib.indices.includes(PISTAS.length - 1) && !f.lib.indices.includes(0) && f.lib.scrollTop > 0 },
  { e: 'e7b', armar: async () => { await p.locator('.dj-buscar').fill(BUSQUEDA); await esperarFoto((f) => f.lib.filas === BUSQUEDA_N); },
    es: (f) => f.cue?.estado === 'sin-salida' && f.cue.ver && f.lib.query === BUSQUEDA && f.lib.filas === BUSQUEDA_N && f.lib.nota === null },
  { e: 'e7c', armar: async () => { await p.locator('.dj-buscar').fill(NADA); await esperarFoto((f) => f.lib.nota === TXT.nada); },
    es: (f) => f.cue?.estado === 'sin-salida' && f.cue.ver && f.lib.query === NADA && f.lib.filas === 0 && f.lib.nota === TXT.nada },
  { e: 'e8', armar: async () => { await verSalidas(); await usar('hp-0002', '1-2'); await esperarFoto((f) => f.cue?.estado === 'error' && !!f.cue.avisoMotor); },
    es: (f) => f.cue?.estado === 'error' && f.cue.salida === 'hp-0002' && f.cue.avisoMotor === TXT.noEncontro2 && f.cue.quitar && ambos(f, 'motivo', TXT.motivoErr) && libArriba(f) },
  { e: 'e9', armar: async () => { await verSalidas(); await usar('sb-0001', '1-2'); await esperarFoto((f) => !!f.cue?.confirmacion); },
    es: (f) => f.cue?.estado === 'sin-salida' && f.cue.confirmacion === TXT.misma && f.cue.sel === 'sb-0001' && ambos(f, 'motivo', TXT.motivoSin) && libArriba(f) },
  { e: 'e10', armar: async () => {
    await verSalidas(); await usar('ddj-0001', '3-4'); await esperarFoto((f) => f.cue?.estado === 'lista' && f.cue.canales === '3-4');
    await cargarEn('A', P_LARGO); await cargarEn('B', P_ARTISTA); await cueEn('A'); await cueEn('B');
  }, es: (f) => f.cue?.estado === 'lista' && f.cue.salida === 'ddj-0001' && f.cue.canales === '3-4' && f.cue.textoEstado === TXT.listoDdj34 && f.cue.ojo && f.cue.ajustes
      && ambos(f, 'estado', 'pausa') && ambos(f, 'cue', '1') && ambos(f, 'nota', TXT.notaPausa) && f.decks.A.titulo === TITULO_LARGO && f.decks.B.artista === ARTISTA_LARGO && libArriba(f) },
];

// Una celda: la medida estable y los dos casos (o sólo el registro).
// Las medidas de la fila del cue que acompañan cada captura (sólo con capturas).
const medirFilaCue = () => {
  const caja = (e) => { const q = e.getBoundingClientRect(); return [Math.round(q.left), Math.round(q.top), Math.round(q.width * 10) / 10, Math.round(q.height * 10) / 10]; };
  const nombre = (e) => (typeof e.className === 'string' && e.className ? e.className : e.tagName);
  const f = document.querySelector('.dj-cue-fila');
  const s = document.querySelector('.dj-cue-salida');
  let select = null;
  if (s) {
    const cs = getComputedStyle(s), c = document.createElement('canvas').getContext('2d');
    c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const texto = s.selectedOptions[0]?.textContent ?? '';
    select = { caja: caja(s), scrollWidth: s.scrollWidth, clientWidth: s.clientWidth, texto, anchoTexto: Math.round(c.measureText(texto).width), padding: [cs.paddingLeft, cs.paddingRight] };
  }
  return { fila: f ? { caja: caja(f), scrollWidth: f.scrollWidth, clientWidth: f.clientWidth, hijos: [...f.children].map((h) => ({ clase: nombre(h), caja: caja(h), scrollWidth: h.scrollWidth, clientWidth: h.clientWidth })) } : null, select };
};
async function capturar(nombreArchivo, estado, ventana) {
  if (!CAPT) return;
  if (!(ventana.startsWith('tablet_') || ((!CAPT_ESTADOS || CAPT_ESTADOS.includes(estado)) && (!CAPT_VENTANAS || CAPT_VENTANAS.includes(ventana))))) return;
  medidasCaptura[nombreArchivo] = await p.evaluate(medirFilaCue);
  await p.mouse.move(0, 0);
  await p.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
  await p.screenshot({ path: join(CAPT_DIR, nombreArchivo), animations: 'disabled', caret: 'hide', scale: 'css' });
  capturas.push(nombreArchivo);
}

async function celda(e, w, h, cola, cuenta) {
  await p.setViewportSize({ width: w, height: h });
  // h5c: el scroll de .main-content ARRIBA (la promesa de (D) es «con el scroll arriba»; el clic de Playwright en una fila
  // o en un botón lo puede haber movido al armar el estado). No cambia nada en horizontal.
  await p.evaluate(() => { const sc = document.querySelector('.main-content'); if (sc) sc.scrollTop = 0; });
  const { m, intentos, inestable } = await medirEstable(p);
  await capturar(`${e}_${cola ? 'cola_' : ''}${w}x${h}.png`, e, `${cola ? 'cola_' : ''}${w}x${h}`);
  const v = `${cola ? 'cola_' : ''}${w}x${h}`;
  const medido = !!m && m.pagina === true && m.medidos > 0 && !inestable;
  const red = { medidos: m?.medidos ?? null, intentos, inestable: !!inestable };
  // h5c: lo que sólo se registra en cada celda (también en las de la cola a 900 y 1024).
  const reg5c = m?.pagina ? { contenedores: m.contenedores, conElipsis: m.conElipsis, menos44: `${m.ctrl.menos44}/${m.ctrl.medidos}`, rangos: `${m.ctrl.rangosMenos44}/${m.ctrl.rangos}`, cajasRango: m.ctrl.cajasRango, etiquetasCanales: m.ctrl.etiquetasCanales,
    scrollV: m.alto.scrollV, X: m.alto.X, decks: m.alto.decks.map((d) => `${d.top}–${d.bottom}`).join(' ') } : null;
  if (!cuenta) {
    REG.cola_registro[e][v] = { ...red, area: m?.area ?? null, main: m?.main ?? null, nFuera: m?.nFuera ?? null, fuera: m?.fuera?.slice(0, 4) ?? null,
      solapes: m?.solapes?.slice(0, 4) ?? null, cortados: m?.cortados?.slice(0, 4) ?? null, chicos: m?.ctrl?.chicos.slice(0, 4) ?? null, colapsados: m?.colapsados ?? null, ...reg5c };
    return;
  }
  REG.celdas[e][v] = { i: intentos, medidos: m?.medidos ?? null, ...reg5c };
  ok(`${e}_${v}_sin_scroll_horizontal`, medido && m.main.sw <= m.main.cw && m.doc.sw <= m.doc.cw, { ...red, main: m?.main ?? null, doc: m?.doc ?? null });
  ok(`${e}_${v}_nada_fuera_del_area`, medido && m.nFuera === 0, { ...red, area: m?.area ?? null, nFuera: m?.nFuera ?? null, fuera: m?.fuera ?? null });
  // `evid` (h5c): TODA la evidencia del caso, para los CONOCIDOS con `evidencia` (ver CONOCIDOS).
  // h5c (A–C). La red de cada una: la medida estable de la página, y además, en (A) al menos un contenedor revisado y en
  // (C) que los controles medidos CUADREN con los contados aparte (y que haya alguno).
  ok(`${e}_${v}_sin_solapes`, medido && m.contenedores > 0 && m.solapes.length === 0, { ...red, contenedores: m?.contenedores ?? null, solapes: m?.solapes?.slice(0, 8) ?? null, nSolapes: m?.solapes?.length ?? null, evid: m?.solapes ?? null });
  ok(`${e}_${v}_sin_texto_cortado`, medido && m.cortados.length === 0, { ...red, cortados: m?.cortados?.slice(0, 8) ?? null, nCortados: m?.cortados?.length ?? null, evid: m?.cortados ?? null });
  ok(`${e}_${v}_objetivos_24px`, medido && m.ctrl.medidos > 0 && m.ctrl.medidos === m.ctrl.contados && m.ctrl.chicos.length === 0,
    { ...red, medidosCtrl: m?.ctrl?.medidos ?? null, contados: m?.ctrl?.contados ?? null, chicos: m?.ctrl?.chicos?.slice(0, 8) ?? null, nChicos: m?.ctrl?.chicos?.length ?? null, evid: m && m.ctrl && m.ctrl.medidos > 0 && m.ctrl.medidos === m.ctrl.contados ? m.ctrl.chicos : null });
  ok(`${e}_${v}_sin_colapsados`, medido && m.colapsados.length === 0, { ...red, colapsados: m?.colapsados ?? null, evid: m?.colapsados ?? null });
  // (D) La promesa de main.css:6278–6280 («los decks quedan siempre a la vista»): sólo sin cola y con 768 px de alto o más.
  if (!cola && h >= 768) ok(`${e}_${v}_decks_a_la_vista`, medido && m.alto.scrollTop === 0 && m.alto.decks.length === 2 && m.alto.decks.every((d) => d.dentro),
    { ...red, scrollTop: m?.alto?.scrollTop ?? null, visible: m?.alto?.visible ?? null, decks: m?.alto?.decks ?? null });
}
// h5e: las métricas de una celda RESUMIDAS para la tablet (los mismos criterios que los casos de celda()).
const TABLETS = [[820, 1180], [1180, 820]];
const TABLET_ESTADOS = ['e1', 'e3', 'e10'];
function resumenTablet(m) {
  if (!m?.pagina) return { pagina: false };
  return {
    sin_scroll_horizontal: m.main.sw <= m.main.cw && m.doc.sw <= m.doc.cw, main: m.main, doc: m.doc,
    nada_fuera_del_area: m.nFuera === 0, fuera: m.fuera,
    sin_solapes: m.solapes.length === 0, solapes: m.solapes.slice(0, 8),
    sin_texto_cortado: m.cortados.length === 0, cortados: m.cortados.slice(0, 8), conElipsis: m.conElipsis.length,
    objetivos_24px: m.ctrl.medidos > 0 && m.ctrl.medidos === m.ctrl.contados && m.ctrl.chicos.length === 0, chicos: m.ctrl.chicos,
    menos44: `${m.ctrl.menos44}/${m.ctrl.medidos}`, lista44: m.ctrl.lista44,
    sin_colapsados: m.colapsados.length === 0, colapsados: m.colapsados,
    decks_a_la_vista: m.alto.scrollTop === 0 && m.alto.decks.length === 2 && m.alto.decks.every((d) => d.dentro), decks: m.alto.decks, visible: m.alto.visible,
    scrollV: m.alto.scrollV, X: m.alto.X, area: m.area,
  };
}
const METRICAS = ['sin_scroll_horizontal', 'nada_fuera_del_area', 'sin_solapes', 'sin_texto_cortado', 'objetivos_24px', 'sin_colapsados', 'decks_a_la_vista'];
const LETRA = { sin_scroll_horizontal: 'S', nada_fuera_del_area: 'F', sin_solapes: 'P', sin_texto_cortado: 'T', objetivos_24px: 'O', sin_colapsados: 'C', decks_a_la_vista: 'D' };

try {
  await servirBiblioteca(ctx);
  await instalarFalsos(ctx);
  // La biblioteca fija: 40 pistas por /api/tracks y cada una con su WAV en /stream/<id> (sólo la cabecera, por rango).
  await p.goto(BASE + '/'); await p.waitForSelector('.player-bar', { timeout: 15000 });
  const fx = await p.evaluate(async (ids) => {
    const H = { Authorization: 'Bearer ' + localStorage.getItem('token') };
    const l = await (await fetch('/api/tracks?limit=5000&offset=0', { headers: H })).json();
    const s = await Promise.all(ids.map(async (id) => { const r = await fetch(`/stream/${id}`, { headers: { ...H, Range: 'bytes=0-43' } }); const b = await r.arrayBuffer(); return r.status === 206 && /audio\/wav/.test(r.headers.get('content-type') ?? '') && b.byteLength === 44; }));
    return { n: Array.isArray(l) ? l.length : null, ids: Array.isArray(l) ? l.map((t) => t.id).join(',') : null, streams: s.filter(Boolean).length };
  }, PISTAS.map((t) => t.id));
  ok('biblioteca_fija_40_pistas_con_stream', fx.n === 40 && fx.ids === PISTAS.map((t) => t.id).join(',') && fx.streams === 40, { n: fx.n, streams: fx.streams });

  for (const E of ESTADOS) {
    REG.celdas[E.e] = {}; REG.cola_registro[E.e] = {};
    let antes = null, despues = null, error = null;
    try {
      await visita(E.visita);
      await E.armar();
      antes = await esperarFoto(E.es, 3000) ?? await foto();
      if (E.es(antes) && antes.cola) {
        for (const [w, h] of CON_COLA) await celda(E.e, w, h, true, true);
        for (const [w, h] of CON_COLA_REG) await celda(E.e, w, h, true, false);
        await p.setViewportSize({ width: 1280, height: 800 });
        await p.locator('.queue-close').click();
        await esperarFoto((f) => !f.cola, 3000);
        for (const [w, h] of SIN_COLA) await celda(E.e, w, h, false, true);
        await p.setViewportSize({ width: 1280, height: 800 });
        despues = await foto();
      }
    } catch (e) { error = String(e.message).split('\n')[0].slice(0, 200); }
    // Si el estado no se alcanzó, NO se mide nada: sus celdas no existen y el n/m baja (el baseline lo ve).
    ok(`${E.e}_alcanzado`, !error && !!antes && E.es(antes) && antes.cola && !!despues && E.es(despues) && !despues.cola,
      { error, antes: antes && !E.es(antes) ? antes : undefined, cola: antes?.cola ?? null, despues: despues && !E.es(despues) ? despues : undefined });
  }
  // ── TABLET (h5e): SÓLO REGISTRO (REG.tablet), nunca un caso ni el n/m ──
  // Dos contextos con DEDO (hasTouch + isMobile, como tablet-util.mjs:29; deviceScaleFactor 1, el de Playwright):
  // 820×1180 (vertical, debajo de 900: sale «solo escritorio» pero la consola se monta) y 1180×820 (horizontal). En cada
  // uno, E1, E3 y E10 con el MISMO armado (visita sin cola + armar, con el clic de Playwright: armar con el dedo no se
  // probó) y las MISMAS métricas de las celdas, resumidas: lo que fallaría, con su evidencia, más los controles de
  // menos de 44×44 y el aviso «solo escritorio». Un error acá queda en el registro y no toca los casos.
  for (const [w, h] of TABLETS) {
    const k = `${w}x${h}`;
    const reg = (REG.tablet[k] = {});
    const anterior = p;
    let t = null;
    try {
      t = await abrir(BASE, '/', { w, h, tactil: true, esperar: '.player-bar' });
      p = t.p;
      await servirBiblioteca(t.ctx); await instalarFalsos(t.ctx);
      reg.contexto = await p.evaluate(() => ({ dpr: devicePixelRatio, dedo: matchMedia('(pointer: coarse)').matches, hover: matchMedia('(hover: hover)').matches, vw: innerWidth, vh: innerHeight }));
      for (const E of ESTADOS.filter((x) => TABLET_ESTADOS.includes(x.e))) {
        try {
          await visita(E.visita, { cola: false, w, h });
          await E.armar();
          const f = await esperarFoto(E.es, 3000) ?? await foto();
          await p.evaluate(() => { const sc = document.querySelector('.main-content'); if (sc) sc.scrollTop = 0; });
          const { m, intentos, inestable } = await medirEstable(p);
          await capturar(`${E.e}_tablet_${k}.png`, E.e, `tablet_${k}`);
          const aviso = await p.evaluate(() => { const a = document.querySelector('.dj-solo-escritorio'); const q = a?.getBoundingClientRect(); return { visible: !!a && a.checkVisibility() && q.height > 0, texto: a?.textContent ?? null, caja: q ? [Math.round(q.top), Math.round(q.height)] : null, consola: !!document.querySelector('.dj-mezcla') && !!document.querySelector('.dj-cue'), decksColumnas: getComputedStyle(document.querySelector('.dj-decks')).gridTemplateColumns }; });
          reg[E.e] = { alcanzado: E.es(f), intentos, inestable: !!inestable, ...resumenTablet(m), soloEscritorio: aviso };
        } catch (e) { reg[E.e] = { error: String(e.message).split('\n')[0].slice(0, 200) }; }
      }
      reg.errores = t.errores.slice();
    } catch (e) { reg.error = String(e.message).split('\n')[0].slice(0, 200); }
    finally { p = anterior; if (t) await t.ctx.close().catch(() => {}); }
  }
  ok('sin_errores_de_pagina', errores.length === 0, { errores });
} catch (e) {
  ok('excepcion', false, { error: String(e.message).split('\n')[0].slice(0, 200) });
}
REG.ms = Date.now() - t0;

// CONOCIDOS → CONOCIDO / ARREGLADO; el resto, PASA o FALLA.
const pasa = (v) => (typeof v === 'object' ? v.ok : v);
const VENTANAS_CUENTAN = [...SIN_COLA.map(([w, h]) => `${w}x${h}`), ...CON_COLA.map(([w, h]) => `cola_${w}x${h}`)];
const comoLista = (x, todo) => (x === '*' ? todo : Array.isArray(x) ? x : [x]);
const conocido = new Map();
for (const c of [...CONOCIDOS, ...CONOCIDOS_ENV]) for (const es of comoLista(c.estado, ESTADOS.map((E) => E.e))) for (const v of comoLista(c.ventana, VENTANAS_CUENTAN)) conocido.set(`${es}_${v}_${c.metrica}`, c);
if (CONOCIDOS_ENV.length) console.log(`DJ_MATRIZ_CONOCIDOS: ${CONOCIDOS_ENV.length} entradas sumadas a CONOCIDOS en esta corrida`);
const cubre = (c, k) => !c.evidencia || (Array.isArray(R[k]?.evid) && R[k].evid.length > 0 && R[k].evid.every((x) => c.evidencia.includes(x)));
const estadoDe = (k) => { const c = conocido.get(k); return pasa(R[k]) ? (c ? `ARREGLADO ${c.id}` : 'PASA') : (c && cubre(c, k) ? `CONOCIDO ${c.id}` : 'FALLA'); };
for (const k of conocido.keys()) if (!(k in R)) ok(`conocido_sin_caso_${k}`, false, { nota: 'entrada de CONOCIDOS sin caso: quitarla o corregirla' });
const fallan = Object.keys(R).filter((k) => { const s = estadoDe(k); return s === 'FALLA' || s.startsWith('ARREGLADO'); });
const ESTADO = Object.fromEntries(Object.keys(R).map((k) => [k, estadoDe(k)]));

// El tablero: una fila por estado, una columna por ventana. Celda «·» = todas sus métricas pasan; si no, la letra de cada
// métrica que no pasa (S scroll · F fuera · P solapes · T texto cortado · O objetivos · C colapsados · D decks a la vista)
// con X (falla), cHn (conocido) o a!Hn (arreglado). «—» = la celda no se midió.
const corto = (s) => (s === 'FALLA' ? 'X' : s.replace('CONOCIDO ', 'c').replace('ARREGLADO ', 'a!'));
const cols = [...SIN_COLA.map(([w, h]) => `${w}x${h}`), ...CON_COLA.map(([w, h]) => `cola_${w}x${h}`)];
console.log(['estado'.padEnd(6), 'alc', ...cols.map((c) => c.replace('cola_', 'c').padEnd(10))].join(' '));
for (const E of ESTADOS) {
  const fila = cols.map((c) => {
    const est = METRICAS.map((mt) => [mt, ESTADO[`${E.e}_${c}_${mt}`]]).filter(([, s]) => s !== undefined);
    if (!est.length) return '—'.padEnd(10);
    const mal = est.filter(([, s]) => s !== 'PASA');
    return (mal.length ? mal.map(([mt, s]) => LETRA[mt] + corto(s)).join(' ') : '·').padEnd(10);
  });
  console.log([E.e.padEnd(6), (ESTADO[`${E.e}_alcanzado`] === 'PASA' ? '·' : 'X').padEnd(3), ...fila].join(' '));
}
const noPasa = Object.keys(R).filter((k) => ESTADO[k] !== 'PASA');
if (noPasa.length) console.log('\nlo que no pasa:\n' + noPasa.map((k) => `  ${ESTADO[k].padEnd(12)} ${k} ${JSON.stringify(typeof R[k] === 'object' ? { ...R[k], ok: undefined } : R[k])}`).join('\n'));
console.log('\nregistro (fuera del conteo):', JSON.stringify(REG));
console.log(`\ndj-matriz: ${Object.keys(R).length - fallan.length}/${Object.keys(R).length}`);
if (CAPT) {
  writeFileSync(join(CAPT_DIR, 'medidas.json'), JSON.stringify(medidasCaptura, null, 1));
  console.log(`capturas: ${capturas.length} en ${CAPT_DIR}`);
}
if (process.env.DJ_MATRIZ_SALIDA) writeFileSync(process.env.DJ_MATRIZ_SALIDA, JSON.stringify({ fallan, estado: ESTADO, R, REG, ...(CAPT ? { capturas: { carpeta: CAPT_DIR, archivos: capturas } } : {}) }, null, 1));
await browser.close();
process.exit(fallan.length ? 1 : 0);
