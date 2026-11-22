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
const S = await import(pathToFileURL(join(ROOT, 'music-client/src/utils/sondeoServidor.js')).href);

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
    [3599, 'hace 59 min'], [3600, 'hace 1 h'], [3660, 'hace 1 h 1 min'], [3659, 'hace 1 h'],
    [86399, 'hace 23 h 59 min'], [86400, 'hace 1 d'], [3 * 86400 + 4 * 3600 + 59 * 60, 'hace 3 d 4 h'],
  ];
  const mal = casos.filter(([s, esp]) => t(s) !== esp).map(([s, esp]) => ({ s, esp, dio: t(s) }));
  ok('encendido_bordes', mal.length === 0, { mal });
  // 3b: la unidad menor se omite cuando vale 0 (nunca «0 min» ni «0 h»).
  const ceros = [[7200, 'hace 2 h'], [7260, 'hace 2 h 1 min'], [3 * 86400, 'hace 3 d'], [3 * 86400 + 3599, 'hace 3 d'], [90000, 'hace 1 d 1 h']];
  const malCero = ceros.filter(([s, esp]) => t(s) !== esp).map(([s, esp]) => ({ s, esp, dio: t(s) }));
  ok('encendido_sin_cero_menor', malCero.length === 0 && [3600, 86400, 7200, 3 * 86400].every((s) => !/ 0 (min|h)$/.test(t(s))), { malCero });
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

// ── 12. Textos del detalle de admin (3c) ──
{
  ok('adm_falla_403_prohibido', U.claveDeFalloAdmin(Object.assign(new Error('admin required'), { status: 403 })) === 'prohibido'
    && U.claveDeFallo(Object.assign(new Error('x'), { status: 403 })) === 'sin_respuesta');
  let sintaxis; try { JSON.parse(HTML); } catch (err) { sintaxis = err; }
  ok('adm_falla_resto_igual', U.claveDeFalloAdmin(Object.assign(new Error('x'), { status: 401 })) === 'sesion'
    && U.claveDeFalloAdmin(sintaxis) === 'respuesta_invalida' && U.claveDeFalloAdmin(null) === 'respuesta_invalida'
    && U.claveDeFalloAdmin(new TypeError('Failed to fetch')) === 'sin_respuesta' && U.claveDeFalloAdmin(Object.assign(new Error('x'), { status: 500 })) === 'sin_respuesta');
  ok('txt_event_loop', U.textoEventLoop({ p50: 11.1, p99: 12.9, max: 14.5 }) === 'p50 11 ms · p99 13 ms · máx 15 ms (últimos 10 s)'
    && U.textoEventLoop({ p50: 0, p99: 0.4, max: 195.48 }) === 'p50 0 ms · p99 0 ms · máx 195 ms (últimos 10 s)', { dio: U.textoEventLoop({ p50: 11.1, p99: 12.9, max: 14.5 }) });
  ok('txt_event_loop_null', U.textoEventLoop(null) === 'Sin datos todavía');
  ok('txt_memoria', U.textoMemoria({ rss: 63029248, heap: 18874368 }) === '60 MB (heap 18 MB)', { dio: U.textoMemoria({ rss: 63029248, heap: 18874368 }) });
  ok('txt_base', U.textoBase({ bytes: 94208, wal_bytes: 395552 }) === '92 KB · WAL 386 KB' && U.textoBase({ bytes: 94208, wal_bytes: 0 }) === '92 KB · WAL 0 B'
    && U.textoBase({ bytes: null, wal_bytes: null }) === 'no disponible' && U.textoBase({ bytes: 5 * 1024 ** 3, wal_bytes: null }) === '5 GB · WAL no disponible');
  ok('txt_contadores', U.textoContadores({ sqlite_busy: 3, errores_500: 12 }) === 'SQLITE_BUSY 3 · errores 500 12');
  const loc = (circuito) => ({ cliente: { encendido: true, circuito, fallosSeguidos: 0 }, servicio: { cache: 3, cola: 2, trabajando: false, generadas: 5, descartadas: 1, sinCupo: 0, errores: 1, rechazos: {} } });
  ok('txt_locutor_apagado', U.textoLocutor(null) === 'Apagado' && U.textoLocutor({ ...loc('cerrado'), cliente: { encendido: false, circuito: 'cerrado', fallosSeguidos: 0 } }) === 'Apagado');
  ok('txt_locutor_circuitos', U.textoLocutor(loc('cerrado')) === 'Encendido · circuito normal · generadas 5 · errores 1 · cola 2'
    && U.textoLocutor(loc('abierto')) === 'Encendido · circuito en pausa por fallos · generadas 5 · errores 1 · cola 2'
    && U.textoLocutor(loc('semi')) === 'Encendido · circuito probando · generadas 5 · errores 1 · cola 2', { dio: U.textoLocutor(loc('abierto')) });
  ok('txt_version_paquete', U.versionPaqueteDistinta({ version: '1.43.0', version_paquete: '1.40.2' }) === '1.40.2'
    && U.versionPaqueteDistinta({ version: '1.43.0', version_paquete: '1.43.0' }) === null && U.versionPaqueteDistinta({ version: '1.43.0', version_paquete: null }) === null);
  // Hora local (TZ fijada a UTC−6): 20:05 UTC = 14:05.
  const t = Date.UTC(2026, 10, 20, 20, 5, 30);
  ok('txt_hora_y_pico', U.horaLocal(t) === '14:05' && U.horaLocal(t, { zona: 'UTC' }) === '20:05' && U.textoPico({ valor: 619.6, t }) === 'Pico: 620 ms a las 14:05', { hora: U.horaLocal(t) });
  const g = U.puntosGrafica([muestra(0, 12, 33.4)]);
  ok('txt_aria_grafica', U.ariaGrafica(g) === `Atraso en la última hora. Pico: 33 ms a las ${U.horaLocal(T0)}` && U.ariaGrafica(null) === 'Atraso en la última hora: todavía no hay muestras', { dio: U.ariaGrafica(g) });
  ok('txt_videos_reusa', U.TEXTO_VIDEOS.unavailable === 'Sin consultar o no disponible');
}

// ── 13. «Copiar diagnóstico»: el texto plano (3d) ──
{
  const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6OTAwMDAxLCJ1c2VybmFtZSI6InNuYXBAbG9jYWwifQ.firma-del-token-de-prueba';
  globalThis.localStorage = { getItem: (k) => (k === 'token' ? TOKEN : null), setItem() {}, removeItem() {} };
  const AHORA = Date.UTC(2026, 10, 20, 20, 30, 5);            // 14:30:05 en UTC−6
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
  const base = { ahora: AHORA, zona: 'America/Mexico_City', clave: 'ok', publico: { ...PUBLICO, uptime_s: 3 * 86400 + 4 * 3600 }, recibidoEn: AHORA - 12_000, build: 'CBdG0aEW', navegador: UA, visible: true };
  const lineas = (t) => Object.fromEntries(t.split('\n').map((l) => { const i = l.indexOf(': '); return [l.slice(0, i), l.slice(i + 2)]; }));
  const pub = U.textoDiagnostico(base);
  const L = lineas(pub);
  ok('dx_formato_clave_valor', pub.split('\n').every((l) => /^[a-záéíóúñ ]+: \S.*$/.test(l)) && !pub.includes('{') && !pub.includes('"'), { texto: pub });
  ok('dx_publico', L['fecha'] === '2026-11-20 14:30:05 UTC-06:00 (America/Mexico_City)' && L['estado'] === 'Funciona con normalidad' && L['última lectura'] === 'hace 12 s'
    && L['versión del servidor'] === '1.43.0' && L['versión del cliente'] === 'CBdG0aEW' && L['encendido'] === 'hace 3 d 4 h' && L['navegador'] === UA && L['pestaña'] === 'visible', { L });
  ok('dx_sin_admin_sin_lineas_admin', !['event loop', 'memoria', 'base', 'desde el arranque', 'locutor', 'videos', 'pico de la hora', 'detalle leído'].some((k) => k in L));
  // Sin respuesta, con lo último que hubo; y sin ningún dato nunca.
  const sr = lineas(U.textoDiagnostico({ ...base, clave: 'sin_respuesta', recibidoEn: AHORA - 95_000, visible: false }));
  ok('dx_sin_respuesta_con_lo_ultimo', sr['estado'] === 'Sin respuesta' && sr['última lectura'] === 'hace 1 min' && sr['versión del servidor'] === '1.43.0' && sr['pestaña'] === 'oculta', { sr });
  const nada = lineas(U.textoDiagnostico({ ...base, clave: 'sin_respuesta', publico: null, recibidoEn: null }));
  ok('dx_sin_datos_nunca', nada['estado'] === 'Sin respuesta' && nada['última lectura'] === 'nunca' && nada['versión del servidor'] === '—' && nada['encendido'] === '—' && nada['versión del cliente'] === 'CBdG0aEW', { nada });
  const cargando = lineas(U.textoDiagnostico({ ...base, clave: 'cargando', publico: null, recibidoEn: null }));
  ok('dx_cargando', cargando['estado'] === 'Consultando el servidor…' && cargando['última lectura'] === 'nunca');
  ok('dx_html_y_sesion', lineas(U.textoDiagnostico({ ...base, clave: 'respuesta_invalida' }))['estado'] === 'Sin respuesta' && lineas(U.textoDiagnostico({ ...base, clave: 'sesion' }))['estado'] === 'Sin respuesta');
  // Con el detalle de admin (abierto y cargado).
  const adm = adminCon({ pico: 600 });
  const A = lineas(U.textoDiagnostico({ ...base, admin: adm, adminEn: AHORA - 4_000 }));
  ok('dx_admin', A['detalle leído'] === 'hace 4 s' && A['event loop'] === 'p50 11 ms · p99 13 ms · máx 13 ms (últimos 10 s)'   // el ADMIN de arriba: máx 13,42 && A['pico de la hora'] === `600 ms a las ${U.horaLocal(adm.muestras[1].t)}`
    && A['memoria'] === '60 MB (heap 18 MB)' && A['base'] === '92 KB · WAL 386 KB' && A['desde el arranque'] === 'SQLITE_BUSY 0 · errores 500 0'
    && A['locutor'] === 'Apagado' && A['videos'] === 'Sin consultar o no disponible', { A });
  // Envuelto: si el validador dejara pasar la muestra mala, puntosGrafica lanzaría; el caso tiene que
  // FALLAR, no tumbar la suite.
  const seguro = (f) => { try { return f(); } catch { return false; } };
  ok('dx_admin_invalido_no_va', seguro(() => !('event loop' in lineas(U.textoDiagnostico({ ...base, admin: { ...adm, muestras: [null] } }))) && !('event loop' in lineas(U.textoDiagnostico({ ...base, admin: HTML })))));
  ok('dx_version_cliente', lineas(U.textoDiagnostico({ ...base, build: 'dev' }))['versión del cliente'] === 'dev' && lineas(U.textoDiagnostico({ ...base, build: TOKEN }))['versión del cliente'] === 'desconocido'
    && U.buildSeguro('CBdG0aEW') === 'CBdG0aEW' && U.buildSeguro(undefined) === 'desconocido');
  ok('dx_fecha_sin_zona', U.fechaConZona(AHORA, null) === '2026-11-20 14:30:05 UTC-06:00' && U.fechaConZona(AHORA, 'x; rm -rf') === '2026-11-20 14:30:05 UTC-06:00');
  ok('dx_navegador_acotado', lineas(U.textoDiagnostico({ ...base, navegador: `a\nb${'x'.repeat(500)}` }))['navegador'].length === 300 && lineas(U.textoDiagnostico({ ...base, navegador: '' }))['navegador'] === 'desconocido');
  // Sin secretos: el token puesto en localStorage, en el JSON (público y admin) y en el build; el
  // usuario y el correo en el público. Nada de eso sale, ni rastros de URL, cookie o header.
  const sucioPub = { ...PUBLICO, token: TOKEN, username: 'snap@local', email: 'alguien@correo.com' };
  const sucioAdm = { ...adm, token: TOKEN, base: { ...adm.base, ruta: 'C:/data/music.db' }, locutor: { ...LOCUTOR, url: 'http://127.0.0.1:11434' } };
  const todo = U.textoDiagnostico({ ...base, publico: sucioPub, admin: sucioAdm, adminEn: AHORA, build: TOKEN });
  ok('dx_sin_secretos', TOKEN.split('.').every((p) => !todo.includes(p)) && !/snap@local|alguien@|correo|music\.db|127\.0\.0\.1|11434|bearer|cookie|authorization|token|https?:\/\/|\?/i.test(todo.replace(UA, '')) && 'event loop' in lineas(todo),
    { texto: todo });
  ok('dx_no_lee_localstorage', (() => {
    let leido = false;
    globalThis.localStorage = { getItem: () => { leido = true; return TOKEN; } };
    U.textoDiagnostico(base);
    return !leido;
  })());
  delete globalThis.localStorage;
}
function adminCon({ pico }) {
  const muestras = [muestra(0), { ...muestra(1), p99: Math.round(pico * 0.85), max: pico }, muestra(2)];
  return { ...clon(ADMIN), muestras };
}

// ── 11. El sondeo (utils/sondeoServidor.js, 3b), con reloj, timers y documento falsos ──
// En el navegador un 401 desloguea y desmonta Ajustes, así que «el 401 corta» solo se ve acá.
{
  const flush = () => new Promise((r) => setImmediate(r));
  function entorno({ leer } = {}) {
    let t = 1_000_000;
    let sig = 1;
    const timers = new Map();
    const doc = {
      visibilityState: 'visible', ls: new Set(),
      addEventListener(n, f) { if (n === 'visibilitychange') this.ls.add(f); },
      removeEventListener(n, f) { if (n === 'visibilitychange') this.ls.delete(f); },
    };
    const e = {
      llamadas: 0, datos: [], fallos: [], timers, doc,
      // Por defecto cada lectura responde al toque con un JSON bueno; `respuestas` cambia eso.
      respuestas: [],
      leer: leer ?? (() => { e.llamadas++; const r = e.respuestas.shift(); return typeof r === 'function' ? r() : Promise.resolve(r ?? PUBLICO); }),
      get ahora() { return t; },
      async avanzar(ms) {
        const fin = t + ms;
        for (;;) {
          const [id, prox] = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0] ?? [];
          if (!prox || prox.at > fin) break;
          t = prox.at; timers.delete(id); prox.fn(); await flush();
        }
        t = fin; await flush();
      },
      async ver(v) { doc.visibilityState = v; for (const f of [...doc.ls]) f(); await flush(); },
    };
    e.arrancar = (extra = {}) => S.crearSondeo({
      leer: e.leer, validar: U.validarServidor, clasificar: U.claveDeFallo,
      alDato: (d, at) => e.datos.push({ d, at }), alFallo: (k) => e.fallos.push(k), documento: doc,
      ahora: () => t, programar: (fn, ms) => { const id = sig++; timers.set(id, { fn, at: t + ms }); return id; }, cancelar: (id) => timers.delete(id),
      ...extra,
    });
    return e;
  }
  const diferida = () => { let res, rej; const p = new Promise((a, b) => { res = a; rej = b; }); return { p, res, rej }; };

  ok('sond_cada_30s', S.CADA_MS === 30_000);
  {
    const e = entorno(); const s = e.arrancar(); await flush();
    const alArrancar = e.llamadas === 1 && e.datos.length === 1 && igual(e.datos[0].d, PUBLICO) && e.datos[0].at === e.ahora;
    await e.avanzar(29_999); const antes = e.llamadas;
    await e.avanzar(1); const justo = e.llamadas;
    await e.avanzar(30_000);
    ok('sond_pide_al_arrancar', alArrancar);
    ok('sond_cadena_30s', antes === 1 && justo === 2 && e.llamadas === 3 && e.timers.size === 1, { antes, justo, despues: e.llamadas, timers: e.timers.size });
    s.detener();
  }
  {
    // Oculta a los 10 s: se cancela el timer y en 2 min no sale nada. Visible a los 130 s → en el acto.
    const e = entorno(); const s = e.arrancar(); await flush();
    await e.avanzar(10_000); await e.ver('hidden');
    const timersOculta = e.timers.size;
    await e.avanzar(120_000); const enOculta = e.llamadas;
    await e.ver('visible'); const alVolver = e.llamadas;
    ok('sond_pausa_oculta', timersOculta === 0 && enOculta === 1, { timersOculta, enOculta });
    ok('sond_vuelve_visible_pide', alVolver === 2 && e.timers.size === 1, { alVolver });
    s.detener();
  }
  {
    // Oculta a los 10 s y visible a los 20 s: NO pide en el acto; agenda lo que falta (10 s).
    const e = entorno(); const s = e.arrancar(); await flush();
    await e.avanzar(10_000); await e.ver('hidden'); await e.avanzar(10_000); await e.ver('visible');
    const alVolver = e.llamadas;
    await e.avanzar(9_999); const casi = e.llamadas;
    await e.avanzar(1);
    ok('sond_visible_antes_de_30s_espera', alVolver === 1 && casi === 1 && e.llamadas === 2, { alVolver, casi, despues: e.llamadas });
    s.detener();
  }
  {
    // Una sola lectura en vuelo: con la primera colgada, ni la visibilidad ni el tiempo disparan otra.
    const d = diferida();
    const e = entorno(); e.respuestas.push(() => d.p);
    const s = e.arrancar(); await flush();
    await e.ver('hidden'); await e.ver('visible'); await e.avanzar(90_000);
    const enVuelo = e.llamadas;
    d.res(PUBLICO); await flush();
    const tras = e.llamadas;
    await e.avanzar(30_000);
    ok('sond_una_en_vuelo', enVuelo === 1 && tras === 1 && e.llamadas === 2 && e.datos.length === 2, { enVuelo, tras, despues: e.llamadas });
    s.detener();
  }
  {
    // 401 → 'sesion' y se corta: ni el tiempo ni volver a la pestaña piden otra vez.
    const e = entorno(); e.respuestas.push(() => Promise.reject(Object.assign(new Error('No token'), { status: 401 })));
    const s = e.arrancar(); await flush();
    await e.avanzar(120_000); await e.ver('hidden'); await e.ver('visible'); await e.avanzar(60_000);
    ok('sond_401_corta', e.llamadas === 1 && igual(e.fallos, ['sesion']) && e.timers.size === 0 && s.estado().cortado, { llamadas: e.llamadas, fallos: e.fallos });
    s.detener();
  }
  {
    // La respuesta pasa por validar: forma mala y HTML → respuesta_invalida; SyntaxError (res.json sobre
    // HTML) → respuesta_invalida; red caída → sin_respuesta. Y la cadena SIGUE (no es un 401).
    let sintaxis; try { JSON.parse(HTML); } catch (err) { sintaxis = err; }
    const e = entorno();
    e.respuestas.push({ ...PUBLICO, estado: 'regular' }, HTML, () => Promise.reject(sintaxis), () => Promise.reject(new TypeError('Failed to fetch')), PUBLICO);
    const s = e.arrancar(); await flush();
    for (let i = 0; i < 4; i++) await e.avanzar(30_000);
    ok('sond_valida_y_clasifica', igual(e.fallos, ['respuesta_invalida', 'respuesta_invalida', 'respuesta_invalida', 'sin_respuesta']) && e.datos.length === 1 && igual(e.datos[0].d, PUBLICO) && e.llamadas === 5,
      { fallos: e.fallos, datos: e.datos.length, llamadas: e.llamadas });
    s.detener();
  }
  {
    // detener(): sin timer, sin listener, y en 2 min no sale nada.
    const e = entorno(); const s = e.arrancar(); await flush();
    s.detener();
    const limpio = e.timers.size === 0 && e.doc.ls.size === 0;
    await e.avanzar(120_000); await e.ver('hidden'); await e.ver('visible');
    ok('sond_detener_limpia', limpio && e.llamadas === 1, { timers: e.timers.size, listeners: e.doc.ls.size, llamadas: e.llamadas });
  }
  {
    // detener() con la lectura en vuelo: cuando llega, nadie se entera y no se agenda nada.
    const d = diferida();
    const e = entorno(); e.respuestas.push(() => d.p);
    const s = e.arrancar(); await flush();
    s.detener(); d.res(PUBLICO); await flush(); await e.avanzar(60_000);
    ok('sond_detener_en_vuelo_calla', e.datos.length === 0 && e.fallos.length === 0 && e.timers.size === 0 && e.llamadas === 1);
  }
}

console.log(JSON.stringify(R, null, 1));
const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(`\nservidor-unit: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
process.exit(fails.length ? 1 : 0);
