// radio-unit.mjs — la lógica de la Radio web (music-client/src/utils/radioSync.js) y sus cuatro
// funciones de red (music-client/src/api/client.js: radioCrear/radioPublicar/radioLeer/radioTerminar).
// Node puro, sin navegador y sin servidor: la hora entra por parámetro y la red es un fetch FALSO.
//
// Tres partes:
//   (a) ios.*   LOS VECTORES DE iOS, transcritos COMO DATOS (no se importa nada de sonorarev-ios: el
//               import sin extensión de un .ts rompe en Node — la lección de share-unit). Salen de
//               sonorarev-ios scripts/test-radio-sincronia.mts, commit 18d7790 (repo en 55580e2), en
//               el mismo orden y con el mismo nombre de caso. Si iOS cambia una regla, este bloque
//               NO se entera solo: hay que volver a copiarlo.
//   (b) web.*   las reglas con sus bordes, la puerta de publicación (puente-anfitrion.tsx 2a3bc86),
//               la espera del sondeo (puente-oyente.tsx 2a3bc86) y que las constantes coincidan con
//               las del servidor (music-server/src/radio/reglas.js, mismo repo).
//   (c) red.*   client.js con fetch falso: códigos, cuerpo exacto, 401 sin bucle, Retry-After,
//               timeout de 6 s de la radio contra los 10 s del resto (esos dos casos tardan ~16 s).
//
// Uso: node radio-unit.mjs     (sale con 1 si algo falla)
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const importar = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

// client.js lee el token de localStorage al pedir; en Node no existe.
globalThis.localStorage = { getItem: (k) => (k === 'token' ? 'tok-prueba' : null), setItem() {}, removeItem() {} };
let respuestas = [];
const pedidos = [];
globalThis.fetch = async (url, opts) => {
  pedidos.push({ url, method: opts?.method, body: opts?.body ?? null, auth: opts?.headers?.Authorization ?? null });
  const f = respuestas.shift();
  if (!f) throw new Error('fetch inesperado: ' + url);
  return f(url, opts);
};

const S = await importar('music-client/src/utils/radioSync.js');
const C = await importar('music-client/src/api/client.js');
const SERVIDOR = await importar('music-server/src/radio/reglas.js');

const R = {};
let n = 0;
const igual = (grupo, a, b, nombre) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  R[`${grupo}.${String(++n).padStart(3, '0')} ${nombre}`] = ok ? true : { ok: false, esperaba: b, dio: a };
};

// ============================ (a) iOS: test-radio-sincronia.mts @ 18d7790 ============================
{
  const I = (a, b, nombre) => igual('ios', a, b, nombre);
  const R_ = S.RADIO;

  I([R_.TOLERANCIA_MS, R_.REVISAR_CADA_MS, R_.MIN_ENTRE_CORRECCIONES_MS, R_.LATIDO_MS, R_.SONDEO_MS], [2000, 5000, 10_000, 10_000, 2000],
    'tolerancia 2 s, revisar cada 5 s, una corrección cada 10 s, latido 10 s, sondeo 2 s');

  // el código
  I(S.normalizarCodigo('K7M2QX'), 'K7M2QX', 'un código bien escrito');
  I([S.normalizarCodigo(' k7m 2qx '), S.normalizarCodigo('K7M-2QX'), S.normalizarCodigo('k7m2qx\n')], ['K7M2QX', 'K7M2QX', 'K7M2QX'], 'perdona minúsculas, espacios y guiones');
  I(['K7M2Q0', 'K7M2QO', 'K7M2Q1', 'K7M2QI', 'K7M2QL'].map(S.normalizarCodigo), [null, null, null, null, null], 'con 0, O, 1, I o L no es un código');
  I([S.normalizarCodigo('K7M2Q'), S.normalizarCodigo('K7M2QXX'), S.normalizarCodigo(''), S.normalizarCodigo('K7M2Q!'), S.normalizarCodigo('K7M2QÑ')], [null, null, null, null, null], 'largo distinto o un carácter raro: no');
  I([S.normalizarCodigo(null), S.normalizarCodigo(123456), S.normalizarCodigo({}), S.normalizarCodigo(undefined)], [null, null, null, null], 'lo que no es texto: no');
  I(S.limpiarCodigoEscrito('k7m 2q0oilx9zz'), 'K7M2QX', 'al escribir: mayúsculas, sin ambiguas ni espacios, seis como mucho');
  I([S.limpiarCodigoEscrito(''), S.limpiarCodigoEscrito(null), S.limpiarCodigoEscrito('0o1il')], ['', '', ''], 'al escribir, lo que no sirve queda vacío');
  I(S.ALFABETO_CODIGO.length === 31 && !/[01OIL]/.test(S.ALFABETO_CODIGO), true, 'el alfabeto es el del servidor: 31, sin ambiguas');

  // el código pegado
  I(S.codigoPegado('K7M2QX'), 'K7M2QX', 'el código solo');
  I([S.codigoPegado('k7m2qx'), S.codigoPegado(' k7m 2qx '), S.codigoPegado('K7M-2QX'), S.codigoPegado('K7M2QX\n')], ['K7M2QX', 'K7M2QX', 'K7M2QX', 'K7M2QX'],
    'si el texto ENTERO es un código: perdona minúsculas, espacios, guiones y un salto de línea');
  I(S.codigoPegado('Entra a mi radio: K7M2QX, te espero'), 'K7M2QX', 'el código con más cosas alrededor');
  I([S.codigoPegado('*K7M2QX*'), S.codigoPegado('(K7M2QX)'), S.codigoPegado('código→K7M2QX'), S.codigoPegado('K7M2QX 🎧')], ['K7M2QX', 'K7M2QX', 'K7M2QX', 'K7M2QX'],
    'asteriscos, paréntesis, una flecha pegada o un emoji no lo esconden');
  I(S.codigoPegado('el código es K7M2QX y otra vez K7M2QX'), 'K7M2QX', 'el mismo código dos veces es un código');
  I(S.codigoPegado('uno es K7M2QX y otro es P9R4ST'), null, 'dos códigos distintos: no se adivina');
  I(S.codigoPegado('ENTRAR con K7M2QX'), null, 'una palabra de seis en MAYÚSCULAS al lado es otro candidato: no se adivina');
  I(S.codigoPegado('entrar con K7M2QX'), 'K7M2QX', 'la misma palabra en minúsculas no compite');
  I(S.codigoPegado('mi código es k7m2qx'), null, 'en minúsculas DENTRO de un texto no cuenta (sería cualquier palabra)');
  I(S.codigoPegado('mi código es K7M-2QX'), null, 'partido con un guion DENTRO de un texto: tampoco');
  I([S.codigoPegado('K7M2Q'), S.codigoPegado('K7M2QXX'), S.codigoPegado('pasa K7M2Q ya'), S.codigoPegado('pasa K7M2QXX ya')], [null, null, null, null], '5 o 7 caracteres: no');
  I([S.codigoPegado('XK7M2QXY'), S.codigoPegado('K7M2QXá'), S.codigoPegado('ñK7M2QX')], [null, null, null], 'pegado a otras letras (también con tilde o ñ) no es una palabra aislada');
  I(['K7M2Q0', 'K7M2QO', 'K7M2Q1', 'K7M2QI', 'K7M2QL', 'K7M2Q!', 'K7M2QÑ'].map(S.codigoPegado), [null, null, null, null, null, null, null], 'con un carácter fuera del alfabeto: no');
  I(['pasa K7M2Q0 ya', 'MUSICA', 'CODIGO', 'UNIRSE'].map(S.codigoPegado), [null, null, null, null], 'y dentro de un texto tampoco (CODIGO y UNIRSE llevan O o I)');
  I([S.codigoPegado(''), S.codigoPegado('   '), S.codigoPegado('hola, ¿cómo estás?'), S.codigoPegado('https://ejemplo.com/a?b=1')], [null, null, null, null], 'vacío, espacios o un texto cualquiera: no');
  I([S.codigoPegado(null), S.codigoPegado(undefined), S.codigoPegado(123456), S.codigoPegado({}), S.codigoPegado(['K7M2QX'])], [null, null, null, null, null], 'lo que no es texto: no');
  I(S.codigoPegado('x'.repeat(5000) + ' K7M2QX'), null, 'solo se miran los primeros 2000 caracteres');
  I(S.codigoPegado('K7M2QX ' + 'x'.repeat(5000)), 'K7M2QX', 'y dentro de esos, sí');

  // el reloj
  {
    const m = { enviadoMs: 1000, recibidoMs: 1200, serverNow: 6100 };
    I(S.relojDeMuestra(m), { offsetMs: 5000, demoraMs: 200, tomadaMs: 1200 }, 'el punto medio del viaje');
    I(S.relojDeMuestra({ enviadoMs: 1000, recibidoMs: 1000, serverNow: 400 }), { offsetMs: -600, demoraMs: 0, tomadaMs: 1000 }, 'un servidor atrasado da offset negativo');
    I([
      S.relojDeMuestra(null), S.relojDeMuestra({ enviadoMs: 1200, recibidoMs: 1000, serverNow: 5 }),
      S.relojDeMuestra({ enviadoMs: 0, recibidoMs: R_.DEMORA_MAX_MS + 1, serverNow: 5 }),
      S.relojDeMuestra({ enviadoMs: 0, recibidoMs: 10, serverNow: NaN }), S.relojDeMuestra({ enviadoMs: 0, recibidoMs: 10, serverNow: 0 }),
      S.relojDeMuestra({ enviadoMs: '0', recibidoMs: 10, serverNow: 5 }), S.relojDeMuestra({ enviadoMs: 0, recibidoMs: Infinity, serverNow: 5 }),
    ], [null, null, null, null, null, null, null], 'muestras absurdas: vuelta antes que ida, viaje eterno, hora que no es número');
    const lenta = { enviadoMs: 2000, recibidoMs: 2900, serverNow: 7000 };
    const rapida = { enviadoMs: 3000, recibidoMs: 3050, serverNow: 8030 };
    const a = S.mejorReloj(null, lenta);
    I(a?.demoraMs, 900, 'la primera muestra vale, aunque sea lenta');
    const b = S.mejorReloj(a, rapida);
    I([b?.demoraMs, b?.offsetMs], [50, 5005], 'una más rápida la reemplaza');
    I(S.mejorReloj(b, lenta) === b, true, 'una más lenta NO la reemplaza');
    I(S.mejorReloj(b, { enviadoMs: 5, recibidoMs: 1, serverNow: 9 }) === b, true, 'una absurda no cambia nada');
    I(S.mejorReloj(null, null), null, 'sin muestras no hay reloj');
    const vieja = { enviadoMs: 3000 + R_.MUESTRA_CADUCA_MS, recibidoMs: 3050 + R_.MUESTRA_CADUCA_MS + 400, serverNow: 9_000_000 };
    I(S.mejorReloj(b, vieja)?.demoraMs, 450, 'pasados 5 min, la mejor muestra caduca y entra la nueva aunque sea más lenta');
    I([S.horaServidor(b, 10_000), S.horaServidor(null, 10_000), S.horaServidor(b, NaN)], [15_005, null, null], 'la hora del servidor, o null sin reloj');
  }

  // la posición del oyente
  {
    const e = { positionMs: 30_000, playing: true, publishedAtServerMs: 100_000 };
    I(S.posicionProyectada(e, 104_500), 34_500, 'si suena: la publicada más lo que pasó');
    I(S.posicionProyectada({ ...e, playing: false }, 104_500), 30_000, 'si no suena: la publicada');
    I(S.posicionProyectada(e, 99_000), 30_000, 'con el reloj atrasado no retrocede');
    I(S.posicionProyectada(e, 104_500, 32_000), 32_000, 'no pasa del final de la canción');
    I(S.posicionProyectada(e, NaN), 30_000, 'sin hora, la publicada');
    I(S.posicionProyectada({ positionMs: -50, playing: false, publishedAtServerMs: 1 }, 5), 0, 'nunca negativa');
    I(S.posicionProyectada(e, 104_500, 0), 34_500, 'una duración 0 no acota');
  }

  // cuándo corregir
  {
    const D = (o) => S.decidirCorreccion({ sincro: S.SINCRO_INICIAL, ahoraMs: 0, objetivoMs: 60_000, posicionMs: 60_000, sonando: true, duracionMs: 200_000, ...o });
    I(D({ sonando: false }).motivo, 'no-suena', 'cargando o en pausa: no se mide');
    const ok = D({ posicionMs: 61_999 });
    I([ok.seekMs, ok.motivo, ok.desfaseMs], [null, 'en-tolerancia', 1999], '1,999 s adelantado: no se corrige');
    I(D({ posicionMs: 58_001 }).motivo, 'en-tolerancia', '1,999 s atrasado: tampoco');
    const c = D({ posicionMs: 62_000 });
    I([c.seekMs, c.motivo, c.desfaseMs], [60_000, 'corregir', 2000], '2 s adelantado: se corrige, al objetivo');
    I(c.sincro, { ultimaRevisionMs: 0, ultimaCorreccionMs: 0, esperandoSonar: true, seguidas: 1 }, 'y queda esperando a que vuelva a sonar');
    I(D({ posicionMs: 3000 }).seekMs, 60_000, '57 s atrasado (acaba de arrancar): se corrige en el acto');
    const e1 = D({ sincro: c.sincro, ahoraMs: 300, posicionMs: 0, sonando: false });
    I([e1.motivo, e1.seekMs, e1.sincro === c.sincro], ['esperando-seek', null, true], 'después de un seek, mientras carga: nada');
    const e2 = D({ sincro: c.sincro, ahoraMs: 1500, posicionMs: 10_000, sonando: true });
    I([e2.motivo, e2.seekMs, e2.sincro.esperandoSonar, e2.sincro.ultimaRevisionMs], ['volvio-a-sonar', null, false, 1500], 'cuando vuelve a sonar NO se juzga todavía');
    I(D({ sincro: e2.sincro, ahoraMs: 1500 + R_.REVISAR_CADA_MS - 1, posicionMs: 0 }).motivo, 'pronto', 'ni antes de la revisión siguiente');
    const r0 = D({ ahoraMs: 1000 }).sincro;
    I(D({ sincro: r0, ahoraMs: 1000 + R_.REVISAR_CADA_MS - 1, posicionMs: 0 }).motivo, 'pronto', 'a los 4,999 s de la última revisión: todavía no');
    I(D({ sincro: r0, ahoraMs: 1000 + R_.REVISAR_CADA_MS, posicionMs: 0 }).motivo, 'corregir', 'a los 5 s: se mide');
    const tras = { ...e2.sincro, ultimaRevisionMs: 1500 };
    const pronto = D({ sincro: tras, ahoraMs: 6500, posicionMs: 50_000 });
    I([pronto.motivo, pronto.seekMs, pronto.desfaseMs], ['espaciando', null, -10_000], 'a los 6,5 s de corregir, aunque siga desfasado: espera');
    I(D({ sincro: pronto.sincro, ahoraMs: 11_500, posicionMs: 50_000 }).motivo, 'corregir', 'pasados 10 s: corrige de nuevo');
    I([0, 1, 2, 3, 4, 5, 50].map(S.esperaEntreCorrecciones), [10_000, 10_000, 20_000, 40_000, 80_000, 80_000, 80_000], 'la espera se duplica con cada corrección seguida, hasta 80 s');
    const dos = { ultimaRevisionMs: 0, ultimaCorreccionMs: 0, esperandoSonar: false, seguidas: 2 };
    I(D({ sincro: dos, ahoraMs: 19_999, posicionMs: 0 }).motivo, 'espaciando', 'con dos seguidas, a los 19,999 s todavía espera');
    const tres = D({ sincro: dos, ahoraMs: 20_000, posicionMs: 0 });
    I([tres.motivo, tres.sincro.seguidas], ['corregir', 3], 'a los 20 s corrige, y van tres');
    const bien = D({ sincro: { ...dos, ultimaRevisionMs: 0 }, ahoraMs: 5000, posicionMs: 60_500 });
    I([bien.motivo, bien.sincro.seguidas], ['en-tolerancia', 0], 'una revisión buena pone la racha en cero');
    I(D({ objetivoMs: 198_000, posicionMs: 190_000 }).motivo, 'casi-termina', 'si al objetivo le faltan menos de 3 s para terminar, no se corrige');
    I(D({ objetivoMs: 196_000, posicionMs: 100_000 }).seekMs, 196_000, 'a 4 s del final sí');
    I(D({ objetivoMs: 300_000, posicionMs: 0, duracionMs: null }).seekMs, 300_000, 'sin duración conocida, al objetivo');
    I(D({ objetivoMs: -500, posicionMs: 5000 }).seekMs, 0, 'nunca un seek negativo');
    I(R_.ADELANTO_SEEK_MS, 0, 'el adelanto del seek está en 0 hasta que se mida');
  }

  // leer lo que contesta el servidor
  const ESTADO = { seq: 4, trackId: 501, positionMs: 12_345, playing: true, nextTrackId: 502, enPausaPorVideo: false, publishedAtServerMs: 1_791_693_000_120 };
  const RADIO_OK = {
    serverNow: 1_791_693_002_000, code: 'K7M2QX', status: 'live', state: ESTADO,
    host: { id: 3, name: 'oscar', avatar: { kind: 'emoji', value: '🎧' } },
    listeners: [{ id: 7, name: 'ana.perez', avatar: null }, { id: 8, name: 'Beto', avatar: { kind: 'photo', url: '/api/users/8/avatar?v=1791000000', updatedAt: '2026-10-01 10:00:00' } }],
  };
  {
    const { serverNow, code, status, state, host, listeners } = RADIO_OK;
    I(S.leerRadio(RADIO_OK), { serverNow, code, status, endedReason: null, state, host, listeners }, 'una respuesta buena sale igual, con endedReason null');
    I(S.leerRadio({ ...RADIO_OK, state: null })?.state, null, 'sin estado todavía (el anfitrión no publicó)');
    I(S.leerRadio({ ...RADIO_OK, status: 'ended', endedReason: 'pausa' })?.endedReason, 'pausa', 'terminada, con su razón');
    I([S.leerRadio({ ...RADIO_OK, status: 'ended', endedReason: 'algo-nuevo' })?.endedReason, S.leerRadio({ ...RADIO_OK, status: 'ended' })?.endedReason], ['otro', 'otro'], 'una razón desconocida o ausente es "otro"');
    I(S.leerRadio({ ...RADIO_OK, status: 'live', endedReason: 'pausa' })?.endedReason, null, 'una radio viva no tiene razón de fin');
    I([
      S.leerRadio(null), S.leerRadio('<html>Cloudflare Access</html>'), S.leerRadio([]), S.leerRadio(42), S.leerRadio({}),
      S.leerRadio({ ...RADIO_OK, serverNow: '1791693002000' }), S.leerRadio({ ...RADIO_OK, serverNow: -1 }),
      S.leerRadio({ ...RADIO_OK, code: 'K7M2Q0' }), S.leerRadio({ ...RADIO_OK, code: 123456 }),
      S.leerRadio({ ...RADIO_OK, status: 'zombie' }), S.leerRadio({ ...RADIO_OK, state: 'x' }), S.leerRadio({ ...RADIO_OK, state: [] }),
    ], Array(12).fill(null), 'lo que no tiene la forma es null: la página de Access, tipos cambiados, un estado inventado');
    const malos = [
      { ...ESTADO, seq: 0 }, { ...ESTADO, seq: 1.5 }, { ...ESTADO, seq: '4' }, { ...ESTADO, trackId: '501' }, { ...ESTADO, trackId: -1 },
      { ...ESTADO, trackId: null }, { ...ESTADO, positionMs: NaN }, { ...ESTADO, positionMs: '0' }, { ...ESTADO, playing: 1 },
      { ...ESTADO, publishedAtServerMs: 0 }, { ...ESTADO, publishedAtServerMs: Infinity }, { ...ESTADO, trackId: 2 ** 60 },
    ];
    I(malos.map(S.leerEstado), Array(malos.length).fill(undefined), 'doce estados mal formados: ninguno pasa');
    I(malos.map((st) => S.leerRadio({ ...RADIO_OK, state: st })), Array(malos.length).fill(null), 'y con uno de esos la respuesta entera se descarta');
    I(S.leerEstado({ ...ESTADO, positionMs: -500 })?.positionMs, 0, 'una posición negativa se acota a 0');
    I(S.leerEstado({ ...ESTADO, positionMs: 9e15 })?.positionMs, R_.POSICION_MAX_MS, 'una gigante, al tope');
    I(S.leerEstado({ ...ESTADO, positionMs: 1234.6 })?.positionMs, 1235, 'con decimales, redondeada');
    I([S.leerEstado({ ...ESTADO, nextTrackId: 'x' })?.nextTrackId, S.leerEstado({ ...ESTADO, nextTrackId: -2 })?.nextTrackId, S.leerEstado({ ...ESTADO, nextTrackId: undefined })?.nextTrackId], [null, null, null], 'una "siguiente" rara es null, sin tirar el estado');
    I(S.leerEstado({ seq: 2, trackId: null, positionMs: 0, playing: true, enPausaPorVideo: true, publishedAtServerMs: 5 }),
      { seq: 2, trackId: null, positionMs: 0, playing: false, nextTrackId: null, enPausaPorVideo: true, publishedAtServerMs: 5 }, 'en pausa por video: sin canción, y playing en false aunque diga true');
    I(Object.keys(S.leerEstado({ ...ESTADO, __proto__: { x: 1 }, admin: true, token: 'secreto' }) ?? {}).sort(),
      ['enPausaPorVideo', 'nextTrackId', 'playing', 'positionMs', 'publishedAtServerMs', 'seq', 'trackId'], 'los campos de más no pasan');
    I(S.leerPersona({ id: 3, name: 'oscar', avatar: null, email: 'x@y.com', role: 'admin' }), { id: 3, name: 'oscar', avatar: null }, 'de una persona pasan id, nombre y avatar, nada más');
    I([S.leerPersona(null), S.leerPersona({ id: '3', name: 'a' }), S.leerPersona({ id: 0, name: 'a' }), S.leerPersona({ name: 'a' })], [null, null, null, null], 'sin un id entero no hay persona');
    I(S.leerNombre('  Ana\n\tPérez\u0000 ' + String.fromCodePoint(0x202e, 0x2028, 0x200b) + '  '), 'Ana Pérez', 'el nombre sale sin saltos, controles ni marcas de dirección');
    I(S.leerNombre('ana.perez@gmail.com'), 'ana.perez', 'si trae un correo, se corta en la arroba');
    I([...S.leerNombre('😀'.repeat(100))].length, R_.NOMBRE_MAX, 'un nombre larguísimo se acota (por caracteres, sin partir un emoji)');
    I([S.leerNombre(null), S.leerNombre(42), S.leerNombre({})], ['', '', ''], 'lo que no es texto es un nombre vacío');
    I(S.leerAvatar({ kind: 'emoji', value: '🎧' }), { kind: 'emoji', value: '🎧' }, 'un emoji');
    I(S.leerAvatar({ kind: 'emoji', value: '👨‍👩‍👧‍👦' })?.kind, 'emoji', 'un emoji compuesto');
    I([S.leerAvatar({ kind: 'emoji', value: '' }), S.leerAvatar({ kind: 'emoji', value: 'hola' }), S.leerAvatar({ kind: 'emoji', value: '😀'.repeat(20) }), S.leerAvatar({ kind: 'emoji', value: 5 })], [null, null, null, null], 'un texto, uno vacío o uno larguísimo no es un emoji');
    I(S.leerAvatar({ kind: 'photo', url: '/api/users/8/avatar?v=1791000000', updatedAt: '2026-10-01 10:00:00' }), { kind: 'photo', url: '/api/users/8/avatar?v=1791000000', updatedAt: '2026-10-01 10:00:00' }, 'una foto del servidor');
    I(S.leerAvatar({ kind: 'photo', url: '/api/users/8/avatar' })?.updatedAt, '', 'sin fecha, vacía');
    const urlsMalas = [
      'https://malo.example/x.jpg', '//malo.example/api/users/8/avatar', '/api/users/8/avatar/../../admin/users', '/api/users/8/avatar?v=1&token=x',
      'javascript:alert(1)', '/api/users/abc/avatar', '/api/admin/users', 'file:///etc/passwd', '/api/users/8/avatar#x', ' /api/users/8/avatar', '',
    ];
    I(urlsMalas.map((url) => S.leerAvatar({ kind: 'photo', url, updatedAt: 'x' })), Array(urlsMalas.length).fill(null), 'once URLs de foto que no son la ruta de avatar: ninguna pasa');
    I([S.leerAvatar(null), S.leerAvatar('emoji'), S.leerAvatar({ kind: 'video', url: '/api/users/8/avatar' }), S.leerAvatar({})], [null, null, null, null], 'otra forma de avatar es null');
    I(S.leerRadio({ ...RADIO_OK, host: { id: 3, name: 'x', avatar: { kind: 'photo', url: 'https://malo.example/x.jpg' } } })?.host, { id: 3, name: 'x', avatar: null }, 'un avatar no válido no tira la respuesta: queda sin avatar');
    I(S.leerRadio({ ...RADIO_OK, listeners: 'muchos' })?.listeners, [], 'oyentes que no son una lista: lista vacía');
    I(S.leerRadio({ ...RADIO_OK, listeners: [null, { id: 7, name: 'a' }, { id: 7, name: 'repetido' }, 'x', { id: -1 }] })?.listeners, [{ id: 7, name: 'a', avatar: null }], 'se descartan los rotos y los repetidos');
    I(S.leerRadio({ ...RADIO_OK, listeners: Array.from({ length: 500 }, (_, i) => ({ id: i + 1, name: 'x' })) })?.listeners.length, R_.OYENTES_MAX, 'y una lista enorme se corta');
    I(S.leerRadio({ ...RADIO_OK, host: 'nadie' })?.host, null, 'un anfitrión roto es null (la cuenta ya no existe)');
    I(S.leerCreada({ code: 'K7M2QX', serverNow: 5, status: 'live' }), { code: 'K7M2QX', serverNow: 5 }, 'crear');
    I([S.leerCreada({ code: 'K7M2Q0', serverNow: 5 }), S.leerCreada({ code: 'K7M2QX' }), S.leerCreada('<html>'), S.leerCreada(null)], [null, null, null, null], 'crear, sin la forma');
    I(S.leerPublicada({ serverNow: 9, status: 'live', state: ESTADO }), { serverNow: 9, state: ESTADO }, 'publicar');
    I([S.leerPublicada({ serverNow: 9, state: null }), S.leerPublicada({ state: ESTADO }), S.leerPublicada({})], [null, null, null], 'publicar, sin la forma (acá el estado no puede faltar)');
    I(S.leerTerminada({ serverNow: 9, status: 'ended', endedReason: 'anfitrion' }), { serverNow: 9, endedReason: 'anfitrion' }, 'terminar');
    I([S.leerTerminada({ serverNow: 9, status: 'live' }), S.leerTerminada({ status: 'ended' }), S.leerTerminada(null)], [null, null, null], 'terminar, sin la forma');
  }

  // los errores
  {
    const F = S.falloDeStatus;
    I([400, 401, 403, 404, 413, 422].map((s) => F('publicar', s, null, null).error), ['invalido', 'sesion', 'no-es-tuya', 'no-existe', 'cuerpo', 'cancion'], 'cada código, su error');
    I([F('crear', 404, null, null), F('crear', 404, '<html>', null)], [{ error: 'sin-servicio' }, { error: 'sin-servicio' }], '404 al crear: el servidor no tiene la radio');
    I(['publicar', 'leer', 'terminar'].map((r) => F(r, 404, null, null).error), ['no-existe', 'no-existe', 'no-existe'], '404 con un código: no existe');
    I([F('publicar', 403, null, null), F('terminar', 403, null, null)], [{ error: 'no-es-tuya' }, { error: 'no-es-tuya' }], '403 al publicar o terminar: no es tuya');
    I([F('crear', 403, null, null), F('leer', 403, null, null)], [{ error: 'servidor', status: 403 }, { error: 'servidor', status: 403 }], '403 al crear o al leer: no es del servidor de la radio');
    I([F('crear', 409, null, null).error, F('leer', 409, null, null).error, F('publicar', 409, null, null)], ['demasiadas', 'llena', { error: 'servidor', status: 409 }], 'el 409 depende de la ruta');
    I(F('publicar', 410, { status: 'ended', endedReason: 'pausa' }, null), { error: 'terminada', razon: 'pausa' }, '410 con su razón');
    I([F('publicar', 410, null, null), F('publicar', 410, '<html>', null)], [{ error: 'terminada', razon: 'otro' }, { error: 'terminada', razon: 'otro' }], '410 sin cuerpo: razón "otro"');
    I(F('publicar', 429, null, 7), { error: 'frecuencia', esperaMs: 7000 }, '429 con Retry-After');
    I([F('publicar', 429, null, null), F('publicar', 429, null, -3), F('publicar', 429, null, NaN), F('publicar', 429, null, 99_999)].map((f) => f.esperaMs), [5000, 5000, 5000, 120_000], 'sin Retry-After (o absurdo): 5 s; uno enorme: 2 min');
    I([F('leer', 500, null, null), F('leer', 200, null, null), F('leer', 530, null, null)], [{ error: 'servidor', status: 500 }, { error: 'servidor', status: 200 }, { error: 'servidor', status: 530 }], 'lo demás es "servidor", con su código');
  }

  // qué hace el oyente con cada lectura
  {
    const lee = (o = {}, estado = {}) => ({ ok: true, radio: S.leerRadio({ ...RADIO_OK, ...o, state: estado === null ? null : { ...ESTADO, ...estado } }) });
    const previo = S.pasoDelOyente(null, lee()).seguido;
    const entra = S.pasoDelOyente(null, lee());
    I([entra.orden, entra.aviso], [{ tipo: 'arrancar', trackId: 501, nextTrackId: 502, sonando: true }, null], 'al entrar: arrancar lo que suena');
    I(previo, { seq: 4, trackId: 501, playing: true, enPausaPorVideo: false, positionMs: 12_345, publishedAtServerMs: ESTADO.publishedAtServerMs }, 'y recordar lo seguido');
    I(S.pasoDelOyente(null, lee({}, { playing: false })).orden, { tipo: 'arrancar', trackId: 501, nextTrackId: 502, sonando: false }, 'entrar con el anfitrión en pausa: cargarla en pausa');
    I(S.pasoDelOyente(null, lee({}, null)).orden, { tipo: 'esperar-anfitrion' }, 'entrar antes de que el anfitrión publique: esperar');
    const mismo = S.pasoDelOyente(previo, lee());
    I([mismo.orden, mismo.seguido === previo], [{ tipo: 'nada' }, true], 'el mismo seq: nada');
    I(S.pasoDelOyente(previo, lee({}, { seq: 3, trackId: 999 })).orden, { tipo: 'nada' }, 'un seq más viejo (una respuesta que llegó tarde): nada');
    const otra = S.pasoDelOyente(previo, lee({}, { seq: 5, trackId: 502, nextTrackId: null, positionMs: 0 }));
    I([otra.orden, otra.seguido?.trackId], [{ tipo: 'arrancar', trackId: 502, nextTrackId: null, sonando: true }, 502], 'otra canción: arrancar esa');
    I(S.pasoDelOyente(previo, lee({}, { seq: 5, playing: false, positionMs: 20_000 })).orden, { tipo: 'pausar', positionMs: 20_000 }, 'el anfitrión pausó: pausar, en su posición');
    const enPausa = S.pasoDelOyente(previo, lee({}, { seq: 5, playing: false, positionMs: 20_000 })).seguido;
    I(S.pasoDelOyente(enPausa, lee({}, { seq: 6, playing: true, positionMs: 20_000 })).orden, { tipo: 'reanudar' }, 'reanudó: reanudar');
    I(S.pasoDelOyente(enPausa, lee({}, { seq: 6, playing: false, positionMs: 20_000, publishedAtServerMs: ESTADO.publishedAtServerMs + 10_000 })).orden, { tipo: 'nada' }, 'un latido en pausa: nada');
    I(S.pasoDelOyente(enPausa, lee({}, { seq: 6, playing: false, positionMs: 90_000 })).orden, { tipo: 'pausar', positionMs: 90_000 }, 'movió la barra estando en pausa: pausar en la posición nueva');
    const t10 = ESTADO.publishedAtServerMs + 10_000;
    I(S.pasoDelOyente(previo, lee({}, { seq: 5, positionMs: 22_345, publishedAtServerMs: t10 })).orden, { tipo: 'nada' }, 'un latido que coincide con lo proyectado: nada');
    I(S.pasoDelOyente(previo, lee({}, { seq: 5, positionMs: 22_345 + R_.SALTO_MS, publishedAtServerMs: t10 })).orden, { tipo: 'nada' }, 'desviado justo el umbral: todavía nada');
    I(S.pasoDelOyente(previo, lee({}, { seq: 5, positionMs: 22_345 + R_.SALTO_MS + 1, publishedAtServerMs: t10 })).orden, { tipo: 'saltar' }, 'pasado el umbral hacia adelante: el anfitrión saltó');
    I(S.pasoDelOyente(previo, lee({}, { seq: 5, positionMs: 0, publishedAtServerMs: t10 })).orden, { tipo: 'saltar' }, 'y hacia atrás (repitió la canción)');
    const video = S.pasoDelOyente(previo, lee({}, { seq: 5, trackId: null, enPausaPorVideo: true, playing: false }));
    I([video.orden, video.seguido?.enPausaPorVideo], [{ tipo: 'pausar-por-video' }, true], 'el anfitrión se puso a ver un video: pausar y avisar');
    I(S.pasoDelOyente(video.seguido, lee({}, { seq: 6, trackId: null, enPausaPorVideo: true, playing: false })).orden, { tipo: 'nada' }, 'un latido durante el video: nada');
    I(S.pasoDelOyente(video.seguido, lee({}, { seq: 7 })).orden, { tipo: 'arrancar', trackId: 501, nextTrackId: 502, sonando: true }, 'al volver del video, aunque sea la misma canción: arrancarla');
    const stale = S.pasoDelOyente(previo, lee({ status: 'stale' }));
    I([stale.orden, stale.aviso, stale.seguido === previo], [{ tipo: 'nada' }, 'sin-senal', true], '"stale": lo que suena sigue, con el aviso de sin señal');
    I(S.pasoDelOyente(previo, lee({ status: 'stale' }, { seq: 5, trackId: 777 })).aviso, 'sin-senal', 'y el aviso acompaña a cualquier orden');
    I(S.pasoDelOyente(previo, lee()).aviso, null, 'al volver a "live" el aviso se va');
    I(S.pasoDelOyente(previo, lee({ status: 'ended', endedReason: 'anfitrion' })), { orden: { tipo: 'salir', razon: 'anfitrion' }, aviso: null, seguido: null }, '"ended": salir, con la razón');
    I(S.pasoDelOyente(previo, lee({ status: 'ended', endedReason: 'sin-anfitrion' }, { seq: 99, trackId: 5 })).orden, { tipo: 'salir', razon: 'sin-anfitrion' }, 'aunque traiga un estado nuevo');
    I(S.pasoDelOyente(previo, { ok: false, error: 'no-existe' }).orden, { tipo: 'salir', razon: 'no-existe' }, '404: salir');
    I(S.pasoDelOyente(previo, { ok: false, error: 'terminada', razon: 'pausa' }).orden, { tipo: 'salir', razon: 'pausa' }, '410: salir, con la razón');
    I(S.pasoDelOyente(previo, { ok: false, error: 'llena' }).orden, { tipo: 'salir', razon: 'llena' }, 'llena: salir');
    I(S.pasoDelOyente(previo, { ok: false, error: 'sesion' }).orden, { tipo: 'salir', razon: 'sesion' }, 'sesión vencida: salir');
    for (const f of [{ error: 'sin-respuesta' }, { error: 'frecuencia', esperaMs: 5000 }, { error: 'servidor', status: 500 }]) {
      const p = S.pasoDelOyente(previo, { ok: false, ...f });
      I([p.orden, p.aviso, p.seguido === previo], [{ tipo: 'nada' }, 'sin-respuesta', true], `${f.error}: lo que suena sigue, y no se olvida lo seguido`);
    }
  }

  // cuándo publica el anfitrión
  {
    const A = { trackId: 501, positionMs: 30_000, playing: true, nextTrackId: 502, enPausaPorVideo: false };
    const P = { ...A, enMs: 100_000 };
    I(S.debePublicar(null, A, 0), 'primero', 'la primera vez');
    I(S.debePublicar(null, { ...A, trackId: null }, 0), null, 'sin canción y sin video: nada que publicar');
    I(S.debePublicar(P, { ...A, positionMs: 32_000 }, 102_000), null, '2 s después, 2 s más adelante: nada');
    I(S.debePublicar(P, { ...A, trackId: 502, positionMs: 0 }, 100_050), 'cancion', 'cambió la canción (aunque hayan pasado 50 ms)');
    I(S.debePublicar(P, { ...A, playing: false }, 100_050), 'pausa', 'pausó');
    I(S.debePublicar({ ...P, playing: false }, A, 100_050), 'pausa', 'reanudó');
    I(S.debePublicar(P, { ...A, positionMs: 32_000, nextTrackId: 777 }, 102_000), 'siguiente', 'cambió la siguiente (reordenó la cola)');
    I(S.debePublicar(P, { ...A, positionMs: 90_000 }, 102_000), 'salto', 'movió la barra');
    I(S.debePublicar(P, { ...A, positionMs: 32_000 + R_.SALTO_MS }, 102_000), null, 'desviado justo el umbral: no es un salto');
    I(S.debePublicar(P, { ...A, positionMs: 32_000 - R_.SALTO_MS - 1 }, 102_000), 'salto', 'hacia atrás también');
    I(S.debePublicar(P, { ...A, positionMs: 90_000 }, 100_000 + R_.MIN_ENTRE_SALTOS_MS - 1), null, 'arrastrando la barra: no más de un salto por segundo');
    I(S.debePublicar({ ...P, playing: false }, { ...A, playing: false, positionMs: 30_000 }, 105_000), null, 'en pausa la posición no avanza: no es un salto');
    I(S.debePublicar(P, { ...A, positionMs: 30_000 + R_.LATIDO_MS - 1 }, 100_000 + R_.LATIDO_MS - 1), null, 'a los 9,999 s sin cambios: todavía no');
    I(S.debePublicar(P, { ...A, positionMs: 30_000 + R_.LATIDO_MS }, 100_000 + R_.LATIDO_MS), 'latido', 'a los 10 s: el latido');
    I(S.debePublicar({ ...P, playing: false }, { ...A, playing: false }, 100_000 + R_.LATIDO_MS), 'latido', 'en pausa también hay latido');
    const V = { trackId: null, positionMs: 0, playing: false, nextTrackId: null, enPausaPorVideo: true };
    I(S.debePublicar(P, V, 100_050), 'video', 'se puso a ver un video');
    I(S.debePublicar({ ...V, enMs: 100_000 }, V, 105_000), null, 'durante el video, nada');
    I(S.debePublicar({ ...V, enMs: 100_000 }, V, 100_000 + R_.LATIDO_MS), 'latido', 'salvo el latido');
    I(S.debePublicar({ ...V, enMs: 100_000 }, A, 100_050), 'video', 'y al volver a la música');
    I(S.cuerpoDePublicacion({ ...A, positionMs: 30_000.7 }), { trackId: 501, positionMs: 30_001, playing: true, nextTrackId: 502 }, 'el cuerpo: enteros y sin relojes');
    I(S.cuerpoDePublicacion({ ...A, nextTrackId: null, positionMs: -5 }), { trackId: 501, positionMs: 0, playing: true }, 'sin siguiente no se manda; la posición nunca negativa');
    I(S.cuerpoDePublicacion(V), { enPausaPorVideo: true }, 'viendo un video: solo eso');
    I(JSON.stringify(S.cuerpoDePublicacion({ ...A, trackId: 2 ** 40, nextTrackId: 2 ** 40, positionMs: 86_400_000 })).length < 512, true, 'el cuerpo más grande posible entra en los 512 bytes del servidor');
    const ida = S.leerEstado({ ...S.cuerpoDePublicacion(A), seq: 1, enPausaPorVideo: false, publishedAtServerMs: 9 });
    I([ida?.trackId, ida?.positionMs, ida?.playing, ida?.nextTrackId], [501, 30_000, true, 502], 'lo publicado se lee de vuelta igual');
  }

  // todo junto: un oyente que entra tarde
  {
    const publicado = 1_000_000;
    const local = 999_000;
    const muestra = { enviadoMs: local - 200, recibidoMs: local, serverNow: publicado + 4000 - 100 };
    const reloj = S.mejorReloj(null, muestra);
    const ahora = S.horaServidor(reloj, local);
    I(ahora, publicado + 4000, 'el reloj estimado da la hora del servidor');
    const objetivo = S.posicionProyectada({ positionMs: 30_000, playing: true, publishedAtServerMs: publicado }, ahora, 200_000);
    I(objetivo, 34_000, 'el anfitrión va por el segundo 34');
    const d = S.decidirCorreccion({ sincro: S.SINCRO_INICIAL, ahoraMs: local, objetivoMs: objetivo, posicionMs: 400, sonando: true, duracionMs: 200_000 });
    I([d.seekMs, d.desfaseMs], [34_000, -33_600], 'y el oyente, que acaba de arrancar, salta ahí');
  }
}

// ============================ (b) web: reglas con bordes, puerta, servidor ============================
{
  const W = (a, b, nombre) => igual('web', a, b, nombre);
  const R_ = S.RADIO;

  // Las mismas constantes que el servidor (mismo repo).
  W([S.ALFABETO_CODIGO, S.LARGO_CODIGO], [SERVIDOR.ALFABETO, SERVIDOR.LARGO_CODIGO], 'alfabeto y largo del código = los de music-server/src/radio/reglas.js');
  W(S.normalizarCodigo(SERVIDOR.nuevoCodigo(() => 0)), SERVIDOR.nuevoCodigo(() => 0), 'un código que fabrica el servidor se acepta tal cual');
  const pubPorVentana = Math.ceil(SERVIDOR.REGLAS.VENTANA_PUBLICACIONES_MS / R_.MIN_ENTRE_SALTOS_MS) + 1;
  W(pubPorVentana <= SERVIDOR.REGLAS.MAX_PUBLICACIONES, true, `arrastrando la barra sin parar: ≤ ${pubPorVentana} publicaciones por ventana, el servidor corta a las ${SERVIDOR.REGLAS.MAX_PUBLICACIONES}`);
  W(R_.LATIDO_MS < SERVIDOR.REGLAS.STALE_MS, true, 'el latido (10 s) llega antes de que el servidor marque "stale" (30 s)');
  W(R_.POSICION_MAX_MS, SERVIDOR.REGLAS.POSICION_MAX_MS, 'el tope de posición es el del servidor (24 h)');

  // Código: minúsculas, guion, malformados.
  W([S.normalizarCodigo('abc234'), S.normalizarCodigo('ABC-234'), S.normalizarCodigo('a-b-c-2-3-4'), S.normalizarCodigo('abc_234'), S.normalizarCodigo('ABC2345')], ['ABC234', 'ABC234', 'ABC234', null, null], 'minúsculas y guiones sí; guion bajo o siete caracteres no');

  // Reloj: empate de demora → gana la nueva; 8 s exactos sí, 8,001 no; caducidad al borde.
  {
    const a = S.mejorReloj(null, { enviadoMs: 0, recibidoMs: 100, serverNow: 5050 });
    const b = S.mejorReloj(a, { enviadoMs: 1000, recibidoMs: 1100, serverNow: 7050 });
    W([b.tomadaMs, b.offsetMs], [1100, 6000], 'empate de demora: gana la muestra NUEVA');
    W([S.relojDeMuestra({ enviadoMs: 0, recibidoMs: 8000, serverNow: 5 })?.demoraMs, S.relojDeMuestra({ enviadoMs: 0, recibidoMs: 8001, serverNow: 5 })], [8000, null], 'una muestra de 8 s exactos vale; de 8,001 s, no');
    // `a` se tomó en 100 con demora 100. Una más lenta (400) a 5 min exactos la reemplaza; 1 ms antes, no.
    // Con el número LITERAL (300 000 ms) y no con RADIO.MUESTRA_CADUCA_MS: si la constante cambia, el
    // caso tiene que fallar (el de iOS usa la constante y por eso no lo detecta).
    const justo = S.mejorReloj(a, { enviadoMs: 100 + 300_000 - 400, recibidoMs: 100 + 300_000, serverNow: 9 });
    const casi = S.mejorReloj(a, { enviadoMs: 100 + 300_000 - 401, recibidoMs: 100 + 300_000 - 1, serverNow: 9 });
    W([justo.demoraMs, casi === a], [400, true], 'la mejor caduca a los 5 min exactos (una más lenta entra); 1 ms antes, no');
  }

  // Posición: pausa y tope.
  W(S.posicionProyectada({ positionMs: 10_000, playing: false, publishedAtServerMs: 0 }, 999_999, 200_000), 10_000, 'en pausa no avanza, pase lo que pase');
  W(S.posicionProyectada({ positionMs: 199_000, playing: true, publishedAtServerMs: 0 }, 5000, 200_000), 200_000, 'sonando, se acota a la duración');

  // Corrección: bordes de 2 s, 10 s, 80 s y 3 s.
  {
    const D = (o) => S.decidirCorreccion({ sincro: S.SINCRO_INICIAL, ahoraMs: 0, objetivoMs: 60_000, posicionMs: 60_000, sonando: true, duracionMs: 200_000, ...o });
    W([D({ posicionMs: 61_999 }).motivo, D({ posicionMs: 62_000 }).motivo, D({ posicionMs: 58_000 }).motivo, D({ posicionMs: 58_001 }).motivo], ['en-tolerancia', 'corregir', 'corregir', 'en-tolerancia'], 'tolerancia: 1999 no, 2000 sí (adelante y atrás)');
    const una = { ultimaRevisionMs: 0, ultimaCorreccionMs: 0, esperandoSonar: false, seguidas: 1 };
    W([D({ sincro: una, ahoraMs: 9999, posicionMs: 0 }).motivo, D({ sincro: una, ahoraMs: 10_000, posicionMs: 0 }).motivo], ['espaciando', 'corregir'], 'una corrección cada 10 s: 9,999 s espera, 10 s corrige');
    const cuatro = { ultimaRevisionMs: 0, ultimaCorreccionMs: 0, esperandoSonar: false, seguidas: 4 };
    W([D({ sincro: cuatro, ahoraMs: 79_999, posicionMs: 0 }).motivo, D({ sincro: cuatro, ahoraMs: 80_000, posicionMs: 0 }).motivo], ['espaciando', 'corregir'], 'con cuatro seguidas: espera 80 s exactos');
    const muchas = { ultimaRevisionMs: 0, ultimaCorreccionMs: 0, esperandoSonar: false, seguidas: 12 };
    W(D({ sincro: muchas, ahoraMs: 80_000, posicionMs: 0 }).motivo, 'corregir', 'con doce seguidas la espera sigue en 80 s (tope)');
    W([D({ objetivoMs: 197_001, posicionMs: 100_000 }).motivo, D({ objetivoMs: 197_000, posicionMs: 100_000 }).motivo, D({ objetivoMs: 196_999, posicionMs: 100_000 }).seekMs], ['casi-termina', 'casi-termina', 196_999], 'últimos 3 s: a 3 s exactos del final ya no se corrige; a 3,001 s sí');
  }

  // Oyente: seq repetido y viejo con la radio en "stale".
  {
    const base = { serverNow: 10, code: 'ABC234', status: 'live', host: null, listeners: [] };
    const st = (seq, extra = {}) => ({ ok: true, radio: S.leerRadio({ ...base, state: { seq, trackId: 9, positionMs: 0, playing: true, nextTrackId: null, enPausaPorVideo: false, publishedAtServerMs: 5, ...extra } }) });
    const p = S.pasoDelOyente(null, st(7)).seguido;
    W([S.pasoDelOyente(p, st(7, { trackId: 10 })).orden.tipo, S.pasoDelOyente(p, st(6, { trackId: 10 })).orden.tipo, S.pasoDelOyente(p, st(8, { trackId: 10 })).orden.tipo], ['nada', 'nada', 'arrancar'], 'seq repetido o viejo con OTRA canción: nada; seq nuevo: arrancar');
  }

  // Anfitrión: 1,5 s exactos, 1 s entre saltos.
  {
    const A = { trackId: 1, positionMs: 0, playing: false, nextTrackId: null, enPausaPorVideo: false };
    const P = { ...A, enMs: 0 };
    W([S.debePublicar(P, { ...A, positionMs: 1500 }, 5000), S.debePublicar(P, { ...A, positionMs: 1501 }, 5000)], [null, 'salto'], 'en pausa, mover la barra 1,5 s exactos no publica; 1,501 s sí');
    W([S.debePublicar(P, { ...A, positionMs: 9000 }, 999), S.debePublicar(P, { ...A, positionMs: 9000 }, 1000)], [null, 'salto'], 'el salto espera 1 s exacto desde la publicación anterior');
    // Ráfaga: arrastrar la barra 10 s sin parar (un salto cada 100 ms), con publicaciones que salen bien.
    let ultimo = { ...A, playing: true, enMs: 0 }; let pubs = 0;
    for (let t = 100; t <= 10_000; t += 100) {
      const actual = { ...A, playing: true, positionMs: (t / 100) * 7000 };
      if (S.debePublicar(ultimo, actual, t)) { pubs++; ultimo = { ...actual, enMs: t }; }
    }
    W(pubs, 10, 'ráfaga: 100 saltos en 10 s → 10 publicaciones (una por segundo), lejos de las 20 del servidor');
  }

  // La puerta (puente-anfitrion.tsx).
  {
    const A = { trackId: 5, positionMs: 0, playing: true, nextTrackId: null, enPausaPorVideo: false };
    const P0 = S.PUERTA_INICIAL;
    W(S.puertaAbierta(P0, A, 0), true, 'la puerta arranca abierta');
    const enVuelo = S.alPublicar(P0);
    W([S.puertaAbierta(enVuelo, A, 0), S.puertaAbierta(enVuelo, A, 999_999)], [false, false], 'con una publicación en vuelo no sale otra, pase el tiempo que pase');
    const ok = S.alResponder(enVuelo, { ok: true }, A, 100, 180);
    W([ok.puerta.enVuelo, ok.publicado.enMs, ok.expulsar, S.puertaAbierta(ok.puerta, A, 180)], [false, 100, null, true], 'bien: se abre, y lo publicado lleva la hora de SALIDA');
    const r429 = S.alResponder(enVuelo, { ok: false, error: 'frecuencia', esperaMs: 10_000 }, A, 100, 200);
    W([S.puertaAbierta(r429.puerta, A, 10_199), S.puertaAbierta(r429.puerta, A, 10_200), r429.publicado], [false, true, null], '429 con Retry-After 10 s: nada hasta 10 s después de la RESPUESTA');
    const caido = S.alResponder(enVuelo, { ok: false, error: 'sin-respuesta' }, A, 100, 6100);
    W([S.puertaAbierta(caido.puerta, A, 9099), S.puertaAbierta(caido.puerta, A, 9100)], [false, true], 'sin respuesta: reintento a los 3 s');
    const r500 = S.alResponder(enVuelo, { ok: false, error: 'servidor', status: 500 }, A, 100, 200);
    W(r500.puerta.noAntesDe, 3200, 'error del servidor: también 3 s');
    const r422 = S.alResponder(enVuelo, { ok: false, error: 'cancion' }, A, 100, 200);
    W([S.puertaAbierta(r422.puerta, A, 999_999), S.puertaAbierta(r422.puerta, { ...A, trackId: 6 }, 200), S.puertaAbierta(r422.puerta, { ...A, trackId: null, enPausaPorVideo: true }, 200)], [false, true, true], '422: esa canción no se insiste; otra canción o un video sí');
    const vuelve = S.alResponder(S.alPublicar(r422.puerta), { ok: true }, { ...A, trackId: 6 }, 300, 350);
    W(vuelve.puerta.rechazada, null, 'una publicación buena olvida la canción rechazada');
    const expulsiones = [
      [{ ok: false, error: 'no-existe' }, 'no-existe'], [{ ok: false, error: 'terminada', razon: 'pausa' }, 'pausa'],
      [{ ok: false, error: 'no-es-tuya' }, 'no-es-tuya'], [{ ok: false, error: 'sesion' }, 'sesion'],
    ].map(([r]) => S.alResponder(enVuelo, r, A, 0, 0).expulsar);
    W(expulsiones, ['no-existe', 'pausa', 'no-es-tuya', 'sesion'], '404, 410, 403 y 401: el anfitrión sale, con la razón');
  }

  // El sondeo del oyente (puente-oyente.tsx).
  W([S.esperaDelSondeo(null), S.esperaDelSondeo({ error: 'frecuencia', esperaMs: 10_000 }), S.esperaDelSondeo({ error: 'frecuencia', esperaMs: 500 }), S.esperaDelSondeo({ error: 'sin-respuesta' })],
    [2000, 10_000, 2000, 2000], 'sondeo: 2 s; con 429, el Retry-After si es mayor');
}

// ============================ (c) red: client.js con fetch falso ============================
const resp = (status, body, headers = {}) => () => ({
  type: 'basic', status, ok: status >= 200 && status < 300, statusText: String(status),
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => { if (typeof body !== 'object' || body === null) throw new SyntaxError('no es JSON'); return body; },
});
const colgado = () => (_u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError'))));
{
  const N = (a, b, nombre) => igual('red', a, b, nombre);
  const A = { trackId: 5, positionMs: 1000.4, playing: true, nextTrackId: 7, enPausaPorVideo: false };
  const sin = (r) => { const { muestra, ...resto } = r; return resto; };
  let avisos = 0;
  C.setUnauthorizedHandler(() => avisos++);

  // 401 repetido en el latido, con la puerta: un solo aviso y el anfitrión sale.
  {
    let puerta = S.PUERTA_INICIAL, intentos = 0, expulsado = null;
    for (let t = 0; t < 60_000 && !expulsado; t += 500) {
      if (!S.puertaAbierta(puerta, A, t) || !S.debePublicar(null, A, t)) continue;
      respuestas.push(resp(401, { error: 'Invalid token' }));
      puerta = S.alPublicar(puerta); intentos++;
      const r = await C.api.radioPublicar('ABC234', A);
      const x = S.alResponder(puerta, r, A, t, t); puerta = x.puerta; expulsado = x.expulsar;
    }
    N({ intentos, avisos, expulsado }, { intentos: 1, avisos: 1, expulsado: 'sesion' }, '401 repetido en el latido: 1 intento, 1 onUnauthorized, sale con "sesion" (sin bucle)');
    avisos = 0;
    for (let i = 0; i < 3; i++) { respuestas.push(resp(401, { error: 'x' })); await C.api.radioLeer('ABC234'); }
    N(avisos, 3, 'sin la puerta, cada 401 avisa una vez (lo frena la capa de arriba, no client.js)');
  }

  respuestas.push(resp(429, { error: 'x' }, { 'retry-after': '10' }));
  N(await C.api.radioPublicar('ABC234', A), { ok: false, status: 429, error: 'frecuencia', esperaMs: 10_000 }, '429 con Retry-After 10 → esperaMs 10000');
  respuestas.push(resp(429, { error: 'x' }));
  N((await C.api.radioPublicar('ABC234', A)).esperaMs, 5000, '429 sin Retry-After → 5 s');
  respuestas.push(resp(410, { error: 'x', status: 'ended', endedReason: 'pausa' }));
  N(await C.api.radioPublicar('ABC234', A), { ok: false, status: 410, error: 'terminada', razon: 'pausa' }, '410 con su razón (sale del cuerpo del error)');
  respuestas.push(resp(422, { error: 'x' }));
  N(await C.api.radioPublicar('ABC234', A), { ok: false, status: 422, error: 'cancion' }, '422 → cancion');
  respuestas.push(resp(409, { error: 'x' }));
  N(await C.api.radioCrear(), { ok: false, status: 409, error: 'demasiadas' }, '409 al crear → demasiadas');
  respuestas.push(resp(409, { error: 'x' }));
  N(await C.api.radioLeer('ABC234'), { ok: false, status: 409, error: 'llena' }, '409 al leer → llena');
  respuestas.push(resp(404, { error: 'x' }));
  N(await C.api.radioCrear(), { ok: false, status: 404, error: 'sin-servicio' }, '404 al crear → sin-servicio');
  respuestas.push(resp(404, { error: 'x' }));
  N(await C.api.radioTerminar('ABC234'), { ok: false, status: 404, error: 'no-existe' }, '404 al terminar → no-existe');
  respuestas.push(resp(403, { error: 'x' }));
  N(await C.api.radioTerminar('ABC234'), { ok: false, status: 403, error: 'no-es-tuya' }, '403 al terminar → no-es-tuya');
  respuestas.push(resp(400, { error: 'x' }));
  N(await C.api.radioPublicar('ABC234', A), { ok: false, status: 400, error: 'invalido' }, '400 → invalido');
  respuestas.push(resp(200, { code: 'ABC234', serverNow: 5, status: 'live' }));
  N(await C.api.radioCrear(), { ok: false, status: 200, error: 'servidor' }, 'crear con 200 (no 201): servidor');
  respuestas.push(resp(201, '<html>Cloudflare Access</html>'));
  N(await C.api.radioCrear(), { ok: false, status: 201, error: 'servidor' }, 'crear con 201 y HTML: servidor');
  respuestas.push(resp(200, '<html>Cloudflare Access</html>'));
  N(await C.api.radioLeer('ABC234'), { ok: false, status: 200, error: 'servidor' }, 'leer con 200 y HTML (la página de Access): servidor');

  pedidos.length = 0;
  respuestas.push(resp(201, { code: 'abc234', serverNow: 99, status: 'live' }));
  const creada = await C.api.radioCrear();
  N([sin(creada), pedidos[0]], [{ ok: true, status: 201, code: 'ABC234', serverNow: 99 }, { url: '/api/radio', method: 'POST', body: null, auth: 'Bearer tok-prueba' }], 'crear con 201: POST sin cuerpo, con Bearer; el código vuelve normalizado');
  N([typeof creada.muestra.enviadoMs, creada.muestra.recibidoMs >= creada.muestra.enviadoMs, creada.muestra.serverNow], ['number', true, 99], 'y trae la muestra de reloj');

  pedidos.length = 0;
  const EST = { seq: 1, trackId: 5, positionMs: 1000, playing: true, nextTrackId: 7, enPausaPorVideo: false, publishedAtServerMs: 9 };
  respuestas.push(resp(200, { serverNow: 9, status: 'live', state: EST }));
  const pub = await C.api.radioPublicar('abc-234', A);
  N([sin(pub), pedidos[0]], [{ ok: true, status: 200, serverNow: 9, state: EST }, { url: '/api/radio/ABC234/state', method: 'PUT', body: '{"trackId":5,"positionMs":1000,"playing":true,"nextTrackId":7}', auth: 'Bearer tok-prueba' }], 'publicar: PUT al código normalizado, con el cuerpo de cuerpoDePublicacion');

  pedidos.length = 0;
  respuestas.push(resp(200, { serverNow: 20, code: 'ABC234', status: 'stale', state: EST, host: { id: 1, name: 'h' }, listeners: [] }));
  const leida = await C.api.radioLeer('abc234');
  N([leida.ok, leida.radio?.status, leida.serverNow, pedidos[0].url, pedidos[0].method], [true, 'stale', 20, '/api/radio/ABC234', 'GET'], 'leer: { radio, serverNow }');
  pedidos.length = 0;
  respuestas.push(resp(200, { serverNow: 30, status: 'ended', endedReason: 'anfitrion' }));
  N([sin(await C.api.radioTerminar('ABC234')), pedidos[0].method], [{ ok: true, status: 200, serverNow: 30, endedReason: 'anfitrion' }, 'DELETE'], 'terminar con 200');

  pedidos.length = 0;
  const malos = await Promise.all(['0O1IL!', '', null, 'ABC23'].map((c) => C.api.radioLeer(c)));
  const malos2 = [await C.api.radioPublicar('XYZ', A), await C.api.radioTerminar('ABCDEFG')];
  N([[...malos, ...malos2].every((r) => r.ok === false && r.error === 'no-existe' && !('status' in r)), pedidos.length], [true, 0], 'código malformado: no-existe SIN hacer ninguna petición');

  respuestas.push(() => { throw new TypeError('Failed to fetch'); });
  N(await C.api.radioLeer('ABC234'), { ok: false, error: 'sin-respuesta' }, 'red caída: sin-respuesta, sin status');

  respuestas.push(colgado());
  let t0 = Date.now();
  const tr = await C.api.radioLeer('ABC234');
  const msRadio = Date.now() - t0;
  N([tr, msRadio >= 5900 && msRadio < 7500], [{ ok: false, error: 'sin-respuesta' }, true], `timeout de la radio: ~6 s (midió ${msRadio} ms) → sin-respuesta`);
  respuestas.push(colgado());
  t0 = Date.now();
  let e = null; try { await C.api.track(1); } catch (err) { e = err; }
  const msResto = Date.now() - t0;
  N([e?.timeout, e?.message, msResto >= 9900 && msResto < 11_500], [true, 'La petición a /api/tracks/1 superó los 10 segundos', true], `el resto de la app sigue en 10 s (midió ${msResto} ms)`);
  N(respuestas.length, 0, 'no sobró ninguna respuesta preparada (cada caso pidió lo suyo)');
}

const fails = Object.entries(R).filter(([, v]) => v !== true);
console.log(JSON.stringify(R, null, 1));
for (const [k, v] of fails) console.log('FALLA', k, JSON.stringify(v));
console.log(`\nradio-unit: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
process.exit(fails.length ? 1 : 0);
