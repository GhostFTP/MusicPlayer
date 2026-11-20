// dj-matriz.mjs — MATRIZ VISUAL del Modo DJ (h5a: E1 × 3 ventanas; h5b: 11 estados × 6 ventanas + la cola abierta).
// El mismo /dj medido en varios estados y tamaños de ventana, para atrapar desbordes antes de que los vea Oscar.
//
//   SNAP_BASE=http://localhost:4173 node dj-matriz.mjs        (lo normal: por el runner, con su baseline aparte)
//   node regresion.mjs --baseline baseline-dj-matriz.json      (build + servidores aislados + esta matriz)
//
// LAS DOS MÉTRICAS (las de h5a, sin cambios; solapes, texto cortado, alto y objetivos táctiles son de h5c):
//   · sin_scroll_horizontal: .main-content y document.scrollingElement con scrollWidth ≤ clientWidth.
//   · nada_fuera_del_area: todo descendiente de .dj-page con caja de ancho > 0 queda entre el borde izquierdo y el
//     derecho del CONTENIDO de .main-content (sin su padding), con 0,5 px de margen (generaliza dj-func.mjs:1521–1523
//     a los dos lados). Se nombran las clases de los que se salen (las 8 primeras, como ce12).
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
// ARREGLADO y FALLA (así la línea n/m obliga a quitarlo a mano de la lista, en el mismo commit que lo arregló).
//
// Los falsos (AudioContext/setSinkId, MIDI mínimo, mediaDevices) son una COPIA de dj-func: dj-falsos.mjs.
// Salida: el tablero estado × ventana, el detalle de lo que no pasa, el registro, y la línea «dj-matriz: n/m» (modo
// name-line de regresion.mjs); exit 0 o 1. Con DJ_MATRIZ_SALIDA=<archivo>, el resultado completo va también a ese
// archivo (lo usa mutar.mjs --suites dj-matriz: `fallan` = lo que FALLA o sale ARREGLADO, nunca lo CONOCIDO).
import { writeFileSync } from 'node:fs';
import { BASE } from '../session.mjs';
import { preparar, instalarFalsos } from './dj-falsos.mjs';
import { PISTAS, servirBiblioteca, TITULO_LARGO, ARTISTA_LARGO, BUSQUEDA, BUSQUEDA_N, NADA } from './dj-biblioteca-fija.mjs';

const SIN_COLA = [[900, 800], [1024, 768], [1280, 800], [1366, 768], [1440, 900], [1920, 1080]];
const CON_COLA = [[1280, 800], [1366, 768], [1440, 900], [1920, 1080]];
const CON_COLA_REG = [[900, 800], [1024, 768]];

// { estado, ventana ('1280x800' o 'cola_1280x800'), metrica ('sin_scroll_horizontal' | 'nada_fuera_del_area'), id, motivo }
const CONOCIDOS = [];

const R = {};
const REG = { celdas: {}, cola_registro: {} };   // lo que sólo se registra (no cuenta en el n/m)
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
  return {
    pagina: true, vw: innerWidth, vh: innerHeight, area: [Math.round(izq), Math.round(der)], medidos, nFuera: fuera.length, fuera: fuera.slice(0, 8),
    main: { sw: sc.scrollWidth, cw: sc.clientWidth }, doc: { sw: d.scrollWidth, cw: d.clientWidth },
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
const { ctx, p, errores } = await abrir(BASE, '/', { w: 1280, h: 800, esperar: '.player-bar' });

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
async function visita({ cue = null, fd = null } = {}) {
  await p.setViewportSize({ width: 1280, height: 800 });
  await p.evaluate(({ cue, fd }) => {
    if (cue) localStorage.setItem('djCue', cue); else localStorage.removeItem('djCue');
    if (fd) sessionStorage.setItem('__fdCfg', JSON.stringify(fd)); else sessionStorage.removeItem('__fdCfg');
    sessionStorage.removeItem('__fmCfg');
  }, { cue, fd });
  await p.goto(BASE + '/');
  await p.waitForSelector('.player-bar .queue-btn', { timeout: 15000 });
  await p.locator('.player-bar .queue-btn').click();
  await p.waitForSelector('.layout--queue .queue-panel', { timeout: 5000 });
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
async function celda(e, w, h, cola, cuenta) {
  await p.setViewportSize({ width: w, height: h });
  const { m, intentos, inestable } = await medirEstable(p);
  const v = `${cola ? 'cola_' : ''}${w}x${h}`;
  const medido = !!m && m.pagina === true && m.medidos > 0 && !inestable;
  const red = { medidos: m?.medidos ?? null, intentos, inestable: !!inestable };
  if (!cuenta) { REG.cola_registro[e][v] = { ...red, area: m?.area ?? null, main: m?.main ?? null, nFuera: m?.nFuera ?? null, fuera: m?.fuera?.slice(0, 4) ?? null }; return; }
  REG.celdas[e][v] = [intentos, m?.medidos ?? null];
  ok(`${e}_${v}_sin_scroll_horizontal`, medido && m.main.sw <= m.main.cw && m.doc.sw <= m.doc.cw, { ...red, main: m?.main ?? null, doc: m?.doc ?? null });
  ok(`${e}_${v}_nada_fuera_del_area`, medido && m.nFuera === 0, { ...red, area: m?.area ?? null, nFuera: m?.nFuera ?? null, fuera: m?.fuera ?? null });
}

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
  ok('sin_errores_de_pagina', errores.length === 0, { errores });
} catch (e) {
  ok('excepcion', false, { error: String(e.message).split('\n')[0].slice(0, 200) });
}
REG.ms = Date.now() - t0;

// CONOCIDOS → CONOCIDO / ARREGLADO; el resto, PASA o FALLA.
const pasa = (v) => (typeof v === 'object' ? v.ok : v);
const clave = (c) => `${c.estado}_${c.ventana}_${c.metrica}`;
const conocido = new Map(CONOCIDOS.map((c) => [clave(c), c]));
const estadoDe = (k) => { const c = conocido.get(k); return pasa(R[k]) ? (c ? `ARREGLADO ${c.id}` : 'PASA') : (c ? `CONOCIDO ${c.id}` : 'FALLA'); };
for (const k of conocido.keys()) if (!(k in R)) ok(`conocido_sin_caso_${k}`, false, { nota: 'entrada de CONOCIDOS sin caso: quitarla o corregirla' });
const fallan = Object.keys(R).filter((k) => { const s = estadoDe(k); return s === 'FALLA' || s.startsWith('ARREGLADO'); });
const ESTADO = Object.fromEntries(Object.keys(R).map((k) => [k, estadoDe(k)]));

// El tablero: una fila por estado, una columna por ventana; cada celda junta sus dos métricas (S = scroll, F = fuera).
const corto = (s) => (s === 'PASA' ? '·' : s === 'FALLA' ? 'X' : s.replace('CONOCIDO ', 'c').replace('ARREGLADO ', 'a!'));
const cols = [...SIN_COLA.map(([w, h]) => `${w}x${h}`), ...CON_COLA.map(([w, h]) => `cola_${w}x${h}`)];
console.log(['estado'.padEnd(6), 'alc', ...cols.map((c) => c.replace('cola_', 'c').padEnd(10))].join(' '));
for (const E of ESTADOS) {
  const fila = cols.map((c) => { const s = ESTADO[`${E.e}_${c}_sin_scroll_horizontal`], f = ESTADO[`${E.e}_${c}_nada_fuera_del_area`]; return (s === undefined ? '—' : `S${corto(s)} F${corto(f)}`).padEnd(10); });
  console.log([E.e.padEnd(6), corto(ESTADO[`${E.e}_alcanzado`] ?? 'FALLA').padEnd(3), ...fila].join(' '));
}
console.log('(· pasa · X falla · cHn conocido · a!Hn arreglado · — sin medir)');
const noPasa = Object.keys(R).filter((k) => ESTADO[k] !== 'PASA');
if (noPasa.length) console.log('\nlo que no pasa:\n' + noPasa.map((k) => `  ${ESTADO[k].padEnd(12)} ${k} ${JSON.stringify(typeof R[k] === 'object' ? { ...R[k], ok: undefined } : R[k])}`).join('\n'));
console.log('\nregistro (fuera del conteo):', JSON.stringify(REG));
console.log(`\ndj-matriz: ${Object.keys(R).length - fallan.length}/${Object.keys(R).length}`);
if (process.env.DJ_MATRIZ_SALIDA) writeFileSync(process.env.DJ_MATRIZ_SALIDA, JSON.stringify({ fallan, estado: ESTADO, R, REG }, null, 1));
await browser.close();
process.exit(fallan.length ? 1 : 0);
