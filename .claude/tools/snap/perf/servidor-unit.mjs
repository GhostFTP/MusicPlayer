// servidor-unit.mjs — prueba UNITARIA de las funciones puras del estado del servidor en Ajustes
// (music-client/src/utils/estadoServidor.js, sub-paso 3a), sin navegador ni servidor.
// Cubre: los dos validadores (formas buenas y malas: campos que faltan, null, HTML, arrays con
// basura), etiquetaEstado y claveDeFallo, cada rama de los textos con sus bordes (59/60 s,
// 3599/3600 s, 86399/86400 s), la fecha de SQLite como UTC (y null → «nunca»), la gráfica con
// 0/1/360 muestras y valores > 500, el diagnóstico sin el token de localStorage e idDelBuild.
// La zona horaria se FIJA a America/Mexico_City (UTC−6, sin horario de verano desde 2022) antes de
// usar fechas: así «tratar la fecha como local» da otro número en cualquier máquina.
// Termina con la línea `servidor-unit: N/N` y código 0/1 (lo que lee regresion.mjs, modo name-line).
// Uso: node servidor-unit.mjs
process.env.TZ = 'America/Mexico_City';

import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const U = await import(pathToFileURL(join(ROOT, 'music-client/src/utils/estadoServidor.js')).href);

const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clon = (x) => JSON.parse(JSON.stringify(x));

// ── Fixtures: las formas exactas que manda el servidor (sub-paso 1) ──

const PUBLICO = { estado: 'ok', version: '1.43.0', uptime_s: 37, admin: false };
const T0 = Date.UTC(2026, 10, 20, 16, 0, 0);
const muestra = (i, p99 = 12.9, max = 13.4) => ({ t: T0 + i * 10_000, p99, max, rss: 63029248 });
const ADMIN = {
  version: '1.43.0', version_paquete: '1.40.2', node: 'v22.18.0', uptime_s: 37,
  memoria: { rss: 63029248, heap: 18874368 },
  event_loop: { p50: 11.1, p99: 12.9, max: 13.42 },
  muestras: [muestra(0), muestra(1), muestra(2)],
  base: { bytes: 94208, wal_bytes: 395552, pistas: 653, ultimo_escaneo: '2026-11-20 10:00:02' },
  videos: 'unavailable',
  locutor: null,
  sqlite_busy: 0, errores_500: 0,
};
const LOCUTOR = {
  cliente: { encendido: true, circuito: 'cerrado', fallosSeguidos: 0 },
  servicio: { cache: 3, cola: 0, trabajando: false, generadas: 5, descartadas: 1, sinCupo: 0, errores: 0, rechazos: { extraccion: 2 } },
};
const HTML = '<!doctype html><html><head><title>Cloudflare Access</title></head><body>login</body></html>';

// ── 1. validarServidor ──
{
  const v = U.validarServidor(PUBLICO);
  ok('pub_forma_buena', igual(v, PUBLICO) && v !== PUBLICO, { v });
  ok('pub_los_4_estados', U.ESTADOS.every((e) => U.validarServidor({ ...PUBLICO, estado: e })?.estado === e) && igual(U.ESTADOS, ['ok', 'lento', 'mal', 'sin_datos']));
  ok('pub_estado_desconocido', U.validarServidor({ ...PUBLICO, estado: 'regular' }) === null && U.validarServidor({ ...PUBLICO, estado: 'OK' }) === null);
  const faltan = ['estado', 'version', 'uptime_s', 'admin'].every((k) => { const x = { ...PUBLICO }; delete x[k]; return U.validarServidor(x) === null; });
  ok('pub_campo_que_falta', faltan);
  ok('pub_tipos_malos', [
    { uptime_s: -1 }, { uptime_s: '37' }, { uptime_s: NaN }, { uptime_s: Infinity }, { admin: 'true' }, { admin: 1 }, { version: 143 }, { version: 'v1.43' },
  ].every((c) => U.validarServidor({ ...PUBLICO, ...c }) === null));
  ok('pub_version_null_se_acepta', U.validarServidor({ ...PUBLICO, version: null })?.version === null);
  ok('pub_null_html_array', [null, undefined, HTML, 42, [], [PUBLICO], 'ok'].every((x) => U.validarServidor(x) === null));
  const extra = U.validarServidor({ ...PUBLICO, token: 'x', ruta: '/data' });
  ok('pub_solo_claves_conocidas', igual(Object.keys(extra), ['estado', 'version', 'uptime_s', 'admin']));
}

// ── 2. validarAdminServidor ──
{
  const v = U.validarAdminServidor(ADMIN);
  ok('adm_forma_buena', igual(v, ADMIN), { v });
  ok('adm_con_locutor', igual(U.validarAdminServidor({ ...ADMIN, locutor: LOCUTOR })?.locutor, LOCUTOR));
  ok('adm_event_loop_null', U.validarAdminServidor({ ...ADMIN, event_loop: null })?.event_loop === null);
  ok('adm_base_tamanos_null', igual(U.validarAdminServidor({ ...ADMIN, base: { ...ADMIN.base, bytes: null, wal_bytes: null } })?.base,
    { bytes: null, wal_bytes: null, pistas: 653, ultimo_escaneo: '2026-11-20 10:00:02' }));
  ok('adm_ultimo_escaneo_null', U.validarAdminServidor({ ...ADMIN, base: { ...ADMIN.base, ultimo_escaneo: null } })?.base.ultimo_escaneo === null);
  ok('adm_muestras_vacias_y_360', U.validarAdminServidor({ ...ADMIN, muestras: [] })?.muestras.length === 0
    && U.validarAdminServidor({ ...ADMIN, muestras: Array.from({ length: 360 }, (_, i) => muestra(i)) })?.muestras.length === 360);
  const claves = ['version', 'version_paquete', 'node', 'uptime_s', 'memoria', 'event_loop', 'muestras', 'base', 'videos', 'locutor', 'sqlite_busy', 'errores_500'];
  ok('adm_campo_que_falta', claves.every((k) => {
    const x = clon(ADMIN); delete x[k];
    // version, version_paquete, event_loop y locutor aceptan null, pero NO que falten (undefined).
    return U.validarAdminServidor(x) === null;
  }));
  // Arrays con basura: una sola muestra mala invalida todo.
  const basura = [null, 42, 'x', [], {}, { ...muestra(1), t: 'ayer' }, { ...muestra(1), p99: -1 }, { ...muestra(1), max: NaN }, { ...muestra(1), rss: undefined }];
  ok('adm_muestra_basura', basura.every((b) => U.validarAdminServidor({ ...ADMIN, muestras: [muestra(0), b, muestra(2)] }) === null));
  ok('adm_muestras_no_array', [null, {}, 'x', { length: 1, 0: muestra(0) }].every((m) => U.validarAdminServidor({ ...ADMIN, muestras: m }) === null));
  ok('adm_tipos_malos', [
    { node: '22.18.0' }, { node: null }, { uptime_s: -5 }, { memoria: { rss: 1 } }, { memoria: { rss: 1.5, heap: 2 } }, { memoria: null },
    { event_loop: { p50: 1, p99: 2 } }, { event_loop: { p50: -1, p99: 2, max: 3 } }, { event_loop: [] },
    { base: null }, { base: { ...ADMIN.base, pistas: -1 } }, { base: { ...ADMIN.base, bytes: '94208' } }, { base: { ...ADMIN.base, wal_bytes: 1.5 } },
    { base: { ...ADMIN.base, ultimo_escaneo: '2026-11-20T10:00:02Z' } }, { base: { ...ADMIN.base, ultimo_escaneo: 'ayer' } },
    { videos: 'listo' }, { videos: null }, { sqlite_busy: -1 }, { sqlite_busy: 1.5 }, { errores_500: '0' }, { version_paquete: 'x' },
  ].every((c) => U.validarAdminServidor({ ...ADMIN, ...c }) === null));
  ok('adm_locutor_malo', [
    {}, [], 'apagado', { cliente: LOCUTOR.cliente }, { ...LOCUTOR, cliente: { ...LOCUTOR.cliente, circuito: 'roto' } },
    { ...LOCUTOR, cliente: { ...LOCUTOR.cliente, encendido: 'si' } }, { ...LOCUTOR, servicio: { ...LOCUTOR.servicio, cola: -1 } },
    { ...LOCUTOR, servicio: { ...LOCUTOR.servicio, rechazos: { 'eyJhbGciOi.x.y': 1 } } }, { ...LOCUTOR, servicio: { ...LOCUTOR.servicio, rechazos: { extraccion: -1 } } },
  ].every((l) => U.validarAdminServidor({ ...ADMIN, locutor: l }) === null));
  ok('adm_null_html_array', [null, undefined, HTML, 0, [], [ADMIN], PUBLICO].every((x) => U.validarAdminServidor(x) === null));
  const sucio = { ...clon(ADMIN), token: 'T', memoria: { ...ADMIN.memoria, ruta: '/data/music.db' }, base: { ...ADMIN.base, DB_PATH: 'C:/x' } };
  const limpio = U.validarAdminServidor(sucio);
  ok('adm_solo_claves_conocidas', igual(limpio, ADMIN) && !JSON.stringify(limpio).includes('music.db') && !('token' in limpio));
}

// ── 3. etiquetaEstado, claveDeFallo y textos fijos ──
{
  const e = (k) => U.etiquetaEstado(k);
  ok('etq_ok', igual(e('ok'), { texto: 'Funciona con normalidad', icono: 'check', tono: 'normal' }));
  ok('etq_lento_ambar_reloj', igual(e('lento'), { texto: 'Va lento', icono: 'reloj', tono: 'ambar' }));
  ok('etq_mal_ambar_fuerte_triangulo', igual(e('mal'), { texto: 'Con problemas', icono: 'triangulo', tono: 'ambar-fuerte' }));
  ok('etq_sin_datos_gris', igual(e('sin_datos'), { texto: 'Recién encendido, todavía midiendo', icono: 'puntos', tono: 'gris' }));
  ok('etq_sin_respuesta', igual(e('sin_respuesta'), { texto: 'Sin respuesta', icono: 'sin-senal', tono: 'gris' }));
  ok('etq_html_recarga', igual(e('respuesta_invalida'), { texto: 'Sin respuesta', icono: 'sin-senal', tono: 'gris', ayuda: 'Si sigue, recarga la página' }));
  ok('etq_desconocida_null', [undefined, null, 'regular', 'toString', '__proto__', 'constructor'].every((k) => e(k) === null));
  const a = e('ok'); a.texto = 'x';
  ok('etq_devuelve_copia', e('ok').texto === 'Funciona con normalidad');
  ok('etq_sin_rojo_ni_verde', ['ok', 'lento', 'mal', 'sin_datos', 'sin_respuesta', 'respuesta_invalida'].every((k) => !/rojo|verde|red|green/i.test(e(k).tono)));
  ok('fallo_401_sesion', U.claveDeFallo(Object.assign(new Error('x'), { status: 401 })) === 'sesion');
  let sintaxis; try { JSON.parse(HTML); } catch (err) { sintaxis = err; }
  ok('fallo_html_es_invalida', U.claveDeFallo(sintaxis) === 'respuesta_invalida' && U.claveDeFallo(null) === 'respuesta_invalida');
  ok('fallo_red_timeout_5xx', [new TypeError('Failed to fetch'), Object.assign(new Error('t'), { timeout: true }), Object.assign(new Error('x'), { status: 502 }), Object.assign(new Error('x'), { status: 403 })]
    .every((err) => U.claveDeFallo(err) === 'sin_respuesta'));
  ok('textos_fijos', U.PIE === 'Mide solo el servidor, no tu conexión' && U.TEXTO_VIDEOS.unavailable === 'Sin consultar o no disponible' && U.TEXTO_VIDEOS.ok === 'Índice listo');
}

// ── 4. textoEncendido, con los bordes ──
{
  const t = U.textoEncendido;
  const casos = [
    [0, 'hace menos de 1 min'], [59, 'hace menos de 1 min'], [59.9, 'hace menos de 1 min'], [60, 'hace 1 min'],
    [3599, 'hace 59 min'], [3600, 'hace 1 h 0 min'], [3660, 'hace 1 h 1 min'],
    [86399, 'hace 23 h 59 min'], [86400, 'hace 1 d 0 h'], [3 * 86400 + 4 * 3600 + 59 * 60, 'hace 3 d 4 h'],
  ];
  const mal = casos.filter(([s, esp]) => t(s) !== esp).map(([s, esp]) => ({ s, esp, dio: t(s) }));
  ok('encendido_bordes', mal.length === 0, { mal });
  ok('encendido_invalido_null', [-1, NaN, Infinity, '60', null, undefined].every((x) => t(x) === null));
}

// ── 5. textoBytes (base 1024) ──
{
  const b = U.textoBytes;
  const casos = [
    [0, '0 B'], [1023, '1023 B'], [1024, '1 KB'], [1536, '1,5 KB'], [10 * 1024, '10 KB'], [94208, '92 KB'], [395552, '386 KB'],
    [1048575, '1 MB'], [1048576, '1 MB'], [63029248, '60 MB'], [5 * 1024 ** 3, '5 GB'], [2.25 * 1024 ** 4, '2,3 TB'],
  ];
  const mal = casos.filter(([n, esp]) => b(n) !== esp).map(([n, esp]) => ({ n, esp, dio: b(n) }));
  ok('bytes_ramas', mal.length === 0, { mal });
  ok('bytes_base_1024', b(1000) === '1000 B' && b(1024) === '1 KB');
  ok('bytes_invalido_null', [null, undefined, -1, NaN, '1024'].every((x) => b(x) === null));
}

// ── 6. textoHace ──
{
  const h = U.textoHace;
  const casos = [[0, 'hace 0 s'], [12.7, 'hace 12 s'], [59, 'hace 59 s'], [60, 'hace 1 min'], [3599, 'hace 59 min'], [3600, 'hace 1 h'], [86399, 'hace 23 h'], [86400, 'hace 1 d'], [-5, 'hace 0 s']];
  const mal = casos.filter(([s, esp]) => h(s) !== esp).map(([s, esp]) => ({ s, esp, dio: h(s) }));
  ok('hace_ramas', mal.length === 0, { mal });
  ok('hace_invalido_null', [NaN, Infinity, null, '5', undefined].every((x) => h(x) === null));
}

// ── 7. Fecha del escaneo: UTC de SQLite → local ──
{
  const ms = U.msDeFechaUtc('2026-11-20 10:00:02');
  ok('fecha_es_utc', ms === Date.UTC(2026, 10, 20, 10, 0, 2), { ms });
  ok('fecha_no_es_local', ms !== new Date(2026, 10, 20, 10, 0, 2).getTime());   // con TZ = UTC−6 serían 6 h de diferencia
  // En la zona fijada (UTC−6): 10:00 UTC = 04:00 local. Y con zona explícita, lo mismo que Intl.
  const local = U.fechaEscaneoLocal('2026-11-20 10:00:02');
  const esperado = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(Date.UTC(2026, 10, 20, 10, 0, 2));
  ok('fecha_local_04', local === esperado && /04:00/.test(local) && /20/.test(local) && /2026/.test(local), { local });
  ok('fecha_zona_utc', /10:00/.test(U.fechaEscaneoLocal('2026-11-20 10:00:02', { zona: 'UTC' })));
  // Cruce de día: 03:30 UTC del 21 es el 20 a las 21:30 en UTC−6.
  const cruce = U.fechaEscaneoLocal('2026-11-21 03:30:00');
  ok('fecha_cruce_de_dia', /20/.test(cruce) && /21:30/.test(cruce), { cruce });
  ok('fecha_null_nunca', U.fechaEscaneoLocal(null) === 'nunca');
  ok('fecha_invalida_null', ['2026-11-20T10:00:02Z', '2026-13-01 00:00:00', '2026-02-30 00:00:00', '2026-11-20 24:00:00', '2026-11-20 10:00:60', '', 'ayer', undefined, 123]
    .every((x) => U.fechaEscaneoLocal(x) === null && U.msDeFechaUtc(x) === null));
}

// ── 8. Gráfica ──
{
  const g = U.puntosGrafica;
  ok('graf_0_muestras_null', g([]) === null && g(null) === null && g(undefined) === null);
  const uno = g([muestra(0, 12.9, 13.4)], { ancho: 600, alto: 160 });
  ok('graf_1_muestra_punto', uno.unPunto === true && uno.p99 === '600,146.2' && uno.max.split(' ').length === 1 && uno.pico.t === T0, { uno });
  const m360 = Array.from({ length: 360 }, (_, i) => muestra(i - 359, 12 + (i % 5), 14 + (i % 7)));
  const tres = g(m360, { ancho: 600, alto: 160 });
  const xs = tres.p99.split(' ').map((p) => Number(p.split(',')[0]));
  ok('graf_360_puntos', tres.unPunto === false && xs.length === 360 && tres.max.split(' ').length === 360, { n: xs.length });
  ok('graf_x_ultima_hora', xs.at(-1) === 600 && xs[0] > 0 && xs[0] < 2 && xs.every((x, i) => i === 0 || x >= xs[i - 1]), { primero: xs[0], ultimo: xs.at(-1) });
  ok('graf_techo_minimo_150', tres.techo === 150, { techo: tres.techo });
  const ys = [...tres.p99.split(' '), ...tres.max.split(' ')].map((p) => Number(p.split(',')[1]));
  ok('graf_y_en_rango', ys.every((y) => y >= 0 && y <= 160));
  ok('graf_guia_100_sin_500', igual(tres.guias.map((x) => x.valor), [100]) && tres.guias[0].y === 53.3 && tres.guias[0].etiqueta === 'lento · 100 ms', { guias: tres.guias });
  // Con un pico de 620 ms: techo 713, entra la guía de 500, y el pico se ubica con su hora.
  const conPico = [...m360.slice(0, 200), { ...m360[200], p99: 540, max: 620 }, ...m360.slice(201)];
  const gp = g(conPico, { ancho: 600, alto: 160 });
  ok('graf_techo_dinamico', gp.techo === 713, { techo: gp.techo });
  ok('graf_guia_500_si_cabe', igual(gp.guias.map((x) => x.valor), [100, 500]) && gp.guias[1].y === r1(160 - (500 / 713) * 160), { guias: gp.guias });
  ok('graf_pico_y_hora', gp.pico.valor === 620 && gp.pico.t === m360[200].t);
  const yPico = Number(gp.max.split(' ')[200].split(',')[1]);
  ok('graf_pico_no_toca_techo', yPico > 0 && yPico === r1(160 - (620 / 713) * 160), { yPico });
  // El borde de la guía de 500: con pico 434,7 el techo queda por debajo de 500 (no entra); con 434,8, sí.
  const borde = (p) => g([muestra(0, 1, p)]).guias.map((x) => x.valor);
  ok('graf_borde_guia_500', igual(borde(434.7), [100]) && igual(borde(434.8), [100, 500]), { bajo: borde(434.7), alto: borde(434.8) });
  // Valores > 500 en p99 y en max, por encima del mínimo: siguen dentro del lienzo.
  const altos = g([muestra(0, 900, 1200), muestra(1, 600, 800)]);
  ok('graf_valores_altos_dentro', [...altos.p99.split(' '), ...altos.max.split(' ')].every((p) => { const y = Number(p.split(',')[1]); return y >= 0 && y <= 160; }) && altos.techo === 1380);
}
function r1(n) { return Math.round(n * 10) / 10; }

// ── 9. Diagnóstico ──
{
  const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6OTAwMDAxfQ.firma-del-token-que-no-debe-salir';
  globalThis.localStorage = { getItem: (k) => (k === 'token' ? TOKEN : null), setItem() {}, removeItem() {} };
  const ahora = Date.UTC(2026, 10, 20, 16, 30, 0);
  const txt = U.armarDiagnostico({ admin: ADMIN, build: 'CBdG0aEW', ahora });
  const d = JSON.parse(txt);
  ok('diag_forma', d.generado === '2026-11-20T16:30:00.000Z' && d.cliente.build === 'CBdG0aEW' && igual(d.servidor, ADMIN) && igual(Object.keys(d), ['generado', 'cliente', 'servidor']));
  // El token puesto en TODOS lados por donde podría colarse: localStorage, una clave extra, un valor
  // extra anidado, el build y una clave de rechazos.
  const sucio = { ...clon(ADMIN), token: TOKEN, authorization: `Bearer ${TOKEN}`, base: { ...ADMIN.base, token: TOKEN },
    locutor: { ...LOCUTOR, servicio: { ...LOCUTOR.servicio, extra: TOKEN } } };
  const txt2 = U.armarDiagnostico({ admin: sucio, build: TOKEN, ahora });
  const partes = TOKEN.split('.');
  ok('diag_sin_token', typeof txt2 === 'string' && !txt.includes(TOKEN) && partes.every((p) => !txt2.includes(p)) && !/bearer/i.test(txt2), { muestra: txt2?.slice(0, 120) });
  ok('diag_build_raro_desconocido', JSON.parse(txt2).cliente.build === 'desconocido' && JSON.parse(U.armarDiagnostico({ admin: ADMIN, build: 'dev', ahora })).cliente.build === 'dev');
  ok('diag_admin_invalido_null', U.armarDiagnostico({ admin: HTML, build: 'dev', ahora }) === null && U.armarDiagnostico({ admin: { ...ADMIN, muestras: [null] }, build: 'dev', ahora }) === null);
  ok('diag_no_lee_localstorage', (() => {
    let leido = false;
    globalThis.localStorage = { getItem: () => { leido = true; return TOKEN; } };
    U.armarDiagnostico({ admin: ADMIN, build: 'dev', ahora });
    return !leido;
  })());
  delete globalThis.localStorage;
}

// ── 10. idDelBuild ──
{
  const doc = (srcs) => ({ querySelectorAll: () => srcs.map((s) => ({ getAttribute: () => s })) });
  ok('build_con_script', U.idDelBuild(doc(['/assets/index-CBdG0aEW.js'])) === 'CBdG0aEW');
  ok('build_entre_otros', U.idDelBuild(doc(['https://x/otro.js', '/assets/vendor-AAAA1111.js', '/assets/index-Ab_9-xYz.js'])) === 'Ab_9-xYz');
  ok('build_con_query_y_absoluta', U.idDelBuild(doc(['https://sonorarev.com/assets/index-CBdG0aEW.js?v=1'])) === 'CBdG0aEW');
  ok('build_sin_script_dev', U.idDelBuild(doc([])) === 'dev' && U.idDelBuild(doc(['/src/main.jsx', '/@vite/client'])) === 'dev');
  ok('build_sin_documento_dev', U.idDelBuild(null) === 'dev' && U.idDelBuild(undefined) === 'dev' && U.idDelBuild({}) === 'dev');
  ok('build_src_propiedad', U.idDelBuild({ querySelectorAll: () => [{ src: 'http://localhost:4173/assets/index-KLyDKkjF.js' }] }) === 'KLyDKkjF');
}

console.log(JSON.stringify(R, null, 1));
const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(`\nservidor-unit: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
process.exit(fails.length ? 1 : 0);
