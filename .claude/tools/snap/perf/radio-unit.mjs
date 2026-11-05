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
//   (d) ios.*   LOS VECTORES DE iOS de lo que publica el anfitrión y de los textos (estadoDelAnfitrion,
//               idDeCancion, textoDeFallo, textoDeFin, cuentaDeOyentes): sonorarev-ios
//               scripts/test-radio-vista.mts @ 18d7790, también como datos. Van AL FINAL para no
//               renumerar los casos de (a)-(c).
//   (e) web.*   lo que diverge de iOS a propósito, los bordes y el texto exacto de cada caso.
//   (f) red.*   radioTerminar con { keepalive } (cerrar la pestaña): qué recibe fetch, y que sin opciones
//               siga idéntico a antes.
//   (g) web.*   sin pista con la radio abierta: debePublicar no publica (nunca un trackId null al servidor).
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
const crudos = [];   // las opciones TAL CUAL las recibe fetch (las usa el bloque keepalive)
globalThis.fetch = async (url, opts) => {
  pedidos.push({ url, method: opts?.method, body: opts?.body ?? null, auth: opts?.headers?.Authorization ?? null });
  crudos.push(opts);
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

// ============================ (d) iOS: test-radio-vista.mts @ 18d7790 ============================
// Vectores de sonorarev-ios scripts/test-radio-vista.mts, commit 18d7790 (repo en 55580e2), COPIADOS
// COMO DATOS, en el mismo orden y con el mismo nombre. Si iOS cambia sus reglas, este bloque no se
// entera. Dos ajustes a propósito, nada más:
//   · el video de prueba va marcado como lo marca la WEB (kind: 'video'); allá es tipo: "video".
//   · "reemplazada, al anfitrión: otro dispositivo" NO se copia: la web dice "otra pestaña o
//     dispositivo" a propósito (ver radioSync.js) y su caso vive en (e).
// No se copian los de duracionMs, compartir ni guarda: esas funciones no están portadas. Los del
// oyente (colaDelOyente, foto, restauración, pausa) están en (h).
{
  const I = (a, b, nombre) => igual('ios', a, b, nombre);
  const cierto = (v, nombre) => I(v === true, true, nombre);
  const c = (id, extra = {}) => ({ id, title: `T${id}`, artist: 'A', duration: 200, ...extra });
  const video = { kind: 'video', id: '12', title: 'V', artist: 'A', duration: 300 };

  // idDeCancion
  I(S.idDeCancion(c(5)), 5, 'un número');
  I(S.idDeCancion(c('42')), 42, 'un texto de dígitos');
  I(S.idDeCancion(video), null, 'un video nunca es una canción, aunque su id sean dígitos');
  I(S.idDeCancion(c(0)), null, '0 no es un id');
  I(S.idDeCancion(c(-3)), null, 'negativo');
  I(S.idDeCancion(c(1.5)), null, 'decimal');
  I(S.idDeCancion(c('9007199254740993')), null, 'un texto que Number redondea');
  I(S.idDeCancion(c('5a')), null, 'texto con letras');
  I(S.idDeCancion(null), null, 'null');
  I(S.idDeCancion('5'), null, 'algo que no es un objeto');

  // estadoDelAnfitrion
  const cola = [c(1), c(2), c(3)];
  I(S.estadoDelAnfitrion({ current: cola[0], queue: cola, queueIndex: 0, playing: true, motor: 'audio', posicionSeg: 12.3456 }),
    { trackId: 1, positionMs: 12346, playing: true, nextTrackId: 2, enPausaPorVideo: false }, 'una canción sonando, con la siguiente');
  I(S.estadoDelAnfitrion({ current: cola[2], queue: cola, queueIndex: 2, playing: false, motor: 'audio', posicionSeg: 5 }),
    { trackId: 3, positionMs: 5000, playing: false, nextTrackId: null, enPausaPorVideo: false }, 'la última de la cola, en pausa: sin siguiente');
  I(S.estadoDelAnfitrion({ current: video, queue: [video], queueIndex: 0, playing: true, motor: 'video', posicionSeg: 40 }),
    { trackId: null, positionMs: 0, playing: false, nextTrackId: null, enPausaPorVideo: true }, 'un video: enPausaPorVideo, sin canción y sin sonar');
  I(S.estadoDelAnfitrion({ current: video, queue: [video], queueIndex: 0, playing: true, motor: 'audio', posicionSeg: 40 }).enPausaPorVideo,
    true, 'la entrada es un video aunque el motor todavía diga audio');
  I(S.estadoDelAnfitrion({ current: cola[0], queue: cola, queueIndex: 0, playing: true, motor: 'video', posicionSeg: 1 }).enPausaPorVideo,
    true, 'el motor de video manda aunque `current` sea una canción');
  I(S.estadoDelAnfitrion({ current: null, queue: [], queueIndex: -1, playing: true, motor: 'audio', posicionSeg: 9 }),
    { trackId: null, positionMs: 0, playing: false, nextTrackId: null, enPausaPorVideo: false }, 'nada cargado: ni canción, ni posición, ni sonando');
  I(S.estadoDelAnfitrion({ current: cola[0], queue: [cola[0], video], queueIndex: 0, playing: true, motor: 'audio', posicionSeg: 0 }).nextTrackId,
    null, 'si lo que sigue es un video, no hay siguiente');
  I(S.estadoDelAnfitrion({ current: cola[0], queue: cola, queueIndex: 0, playing: true, motor: 'audio', posicionSeg: NaN }).positionMs,
    0, 'una posición que no es número es 0');
  I(S.estadoDelAnfitrion({ current: cola[0], queue: cola, queueIndex: 0, playing: true, motor: 'audio', posicionSeg: -4 }).positionMs,
    0, 'una posición negativa es 0');

  // textoDeFallo
  const errores = [
    { error: 'sin-respuesta' }, { error: 'sesion' }, { error: 'invalido' }, { error: 'no-es-tuya' }, { error: 'no-existe' },
    { error: 'demasiadas' }, { error: 'llena' }, { error: 'terminada', razon: 'anfitrion' }, { error: 'cuerpo' },
    { error: 'cancion' }, { error: 'frecuencia', esperaMs: 5000 }, { error: 'servidor', status: 500 },
    { error: 'sin-servicio' }, { error: 'servidor', status: 403 }, { error: 'servidor', status: 530 },
  ];
  for (const accion of ['iniciar', 'unirse', 'terminar']) {
    for (const f of errores) {
      const t = S.textoDeFallo(accion, f);
      cierto(typeof t === 'string' && t.length > 10 && !/undefined|null|\d{3}/.test(t), `${accion} · ${f.error}: un texto, sin códigos`);
    }
  }
  cierto(/código/.test(S.textoDeFallo('unirse', { error: 'no-existe' })), 'unirse a una que no existe habla del código');
  I(/código/.test(S.textoDeFallo('terminar', { error: 'no-existe' })), false, 'terminar una que no existe NO habla del código');
  cierto(/conexión/.test(S.textoDeFallo('unirse', { error: 'sin-respuesta' })), 'sin respuesta habla de la conexión');
  cierto(/llena/.test(S.textoDeFallo('unirse', { error: 'llena' })), 'llena dice llena');
  cierto(/terminó/.test(S.textoDeFallo('unirse', { error: 'terminada', razon: 'pausa' })), 'terminada dice que terminó');
  cierto(/demasiadas radios/.test(S.textoDeFallo('iniciar', { error: 'demasiadas' })), 'demasiadas radios');
  cierto(S.textoDeFallo('iniciar', { error: 'servidor', status: 200 }) !== S.textoDeFallo('unirse', { error: 'servidor', status: 200 }), 'el genérico depende de la acción');
  I(S.textoDeFallo('iniciar', { error: 'sin-servicio' }), 'El servidor todavía no tiene la radio. Intenta más tarde.', 'crear contra un servidor sin radio');
  I(/ya no existe/.test(S.textoDeFallo('iniciar', { error: 'sin-servicio' })), false, 'y NO dice que la radio ya no existe');
  I(S.textoDeFallo('terminar', { error: 'no-existe' }), 'Esa radio ya no existe.', 'terminar una que no existe: ya no existe');
  I(S.textoDeFallo('iniciar', { error: 'servidor', status: 403 }), 'No se pudo iniciar la radio. Intenta de nuevo.', '403 al crear: el genérico de iniciar');
  I(S.textoDeFallo('unirse', { error: 'servidor', status: 403 }), 'No se pudo entrar a la radio. Intenta de nuevo.', '403 al unirse: el genérico de entrar');
  I(/no es tuya/.test(S.textoDeFallo('terminar', { error: 'no-es-tuya' })), true, 'no es tuya sigue para terminar');
  for (const s of [500, 502, 503, 530]) {
    I(S.textoDeFallo('iniciar', { error: 'servidor', status: s }), S.textoDeFallo('iniciar', { error: 'sin-respuesta' }), `${s}: el texto de la conexión`);
  }
  I(/conexión/.test(S.textoDeFallo('iniciar', { error: 'servidor', status: 409 })), false, 'un 4xx raro no habla de la conexión');

  // textoDeFin
  const razones = ['anfitrion', 'admin', 'reemplazada', 'sin-anfitrion', 'pausa', 'otro', 'no-existe', 'llena', 'sesion', 'no-es-tuya'];
  for (const rol of ['anfitrion', 'oyente']) {
    for (const r of razones) {
      const t = S.textoDeFin(rol, r);
      cierto(typeof t === 'string' && t.length > 10 && !/undefined|null/.test(t), `fin · ${rol} · ${r}`);
    }
  }
  cierto(S.textoDeFin('oyente', 'anfitrion') !== S.textoDeFin('anfitrion', 'anfitrion'), 'que la termine el anfitrión se dice distinto a cada uno');
  cierto(/sesión/.test(S.textoDeFin('oyente', 'sesion')), 'la sesión vencida dice qué hacer');

  // cuentaDeOyentes
  I(S.cuentaDeOyentes(0), 'Nadie escuchando todavía', '0 oyentes');
  I(S.cuentaDeOyentes(1), '1 oyente', '1 oyente');
  I(S.cuentaDeOyentes(4), '4 oyentes', '4 oyentes');
}

// ============================ (e) web: lo que diverge a propósito, bordes y textos exactos ============================
{
  const V = (a, b, nombre) => igual('web', a, b, nombre);
  const c = (id, extra = {}) => ({ id, title: `T${id}`, artist: 'A', duration: 200, ...extra });
  const vHex = { kind: 'video', id: 'a3f9c2', title: 'V', artist: 'A', duration: 300 };
  const est = (p) => S.estadoDelAnfitrion({ queue: [c(1), c(2), c(3)], queueIndex: 0, playing: true, posicionSeg: 1, ...p });
  const NADA = { trackId: null, positionMs: 0, playing: false, nextTrackId: null, enPausaPorVideo: false };
  const VIDEO = { trackId: null, positionMs: 0, playing: false, nextTrackId: null, enPausaPorVideo: true };

  // Divergencias a propósito
  V(est({ current: vHex, queue: [vHex] }), VIDEO, 'video por kind:"video", SIN motor: enPausaPorVideo');
  V(S.idDeCancion(vHex), null, 'un video con id hexadecimal no es canción');
  V(S.idDeCancion({ id: 'a3f9c2' }), null, 'un id hexadecimal (sin kind) tampoco vale como trackId');
  V(S.idDeCancion({ tipo: 'video', id: 5 }), 5, 'la marca de iOS (tipo:"video") NO es la de la web: ahí es una canción');
  V(est({ current: c(1) }), { trackId: 1, positionMs: 1000, playing: true, nextTrackId: 2, enPausaPorVideo: false }, 'sin motor (la web no lo expone): manda current');
  V(est({ current: c(1), motor: 'video' }), VIDEO, 'motor:"video" opcional: si viene, manda como en iOS');
  V(est({ current: c(1), motor: 'audio' }).trackId, 1, 'motor:"audio" no cambia nada');
  V([undefined, null, 'x', { 0: c(2) }].map((q) => est({ current: c(1), queue: q }).nextTrackId), [null, null, null, null], 'queue que no es array: sin siguiente y sin romperse');
  V(S.textoDeFin('anfitrion', 'reemplazada'), 'Empezaste otra radio desde otra pestaña o dispositivo.', 'reemplazada, al anfitrión: la frase de la web');
  V(S.textoDeFin('oyente', 'reemplazada'), 'El anfitrión empezó otra radio.', 'reemplazada, al oyente: igual que iOS');
  V(['iniciar', 'unirse', 'terminar'].map((a) => S.textoDeFallo(a, null)),
    ['No se pudo iniciar la radio. Intenta de nuevo.', 'No se pudo entrar a la radio. Intenta de nuevo.', 'No se pudo terminar la radio. Intenta de nuevo.'],
    'textoDeFallo con null: el genérico de cada acción, sin romperse');
  V(S.textoDeFallo('iniciar', undefined), 'No se pudo iniciar la radio. Intenta de nuevo.', 'textoDeFallo con undefined');
  V([-1, NaN, undefined, null, '3'].map(S.cuentaDeOyentes), ['Nadie escuchando todavía', 'Nadie escuchando todavía', 'Nadie escuchando todavía', 'Nadie escuchando todavía', '3 oyentes'],
    'cuentaDeOyentes con -1, NaN, undefined, null y "3"');
  V([2, 20].map(S.cuentaDeOyentes), ['2 oyentes', '20 oyentes'], 'cuentaDeOyentes: 2 y 20 en plural');

  // Bordes de estadoDelAnfitrion
  V(est({ current: c(3), queueIndex: 2 }).nextTrackId, null, 'queueIndex en la última: sin siguiente');
  V(est({ current: c(2), queueIndex: 1 }).nextTrackId, 3, 'queueIndex en la del medio: la siguiente es la de +1 (no +2)');
  V(est({ current: c(1), queueIndex: -1 }), { trackId: 1, positionMs: 1000, playing: true, nextTrackId: null, enPausaPorVideo: false }, 'queueIndex -1: canción sí, siguiente no');
  V(est({ current: c(1), queueIndex: undefined }).nextTrackId, null, 'queueIndex undefined: sin siguiente');
  V([-0.0004, -4, NaN, Infinity, -Infinity, '12', null].map((s) => est({ current: c(1), posicionSeg: s }).positionMs), [0, 0, 0, 0, 0, 0, 0],
    'posicionSeg negativa, NaN, ±Infinity, texto o null: 0');
  V([0.0004, 0.0006, 59.9994, 3600].map((s) => est({ current: c(1), posicionSeg: s }).positionMs), [0, 1, 59999, 3_600_000], 'posicionSeg a ms, redondeado');
  V([1, 'true', null, undefined].map((p) => est({ current: c(1), playing: p }).playing), [false, false, false, false], 'playing solo con true (1 o "true" no cuentan)');
  V(est({ current: null, playing: true }), NADA, 'sin canción: playing false aunque el reproductor diga true');
  V(est({ current: c(0) }), NADA, 'una canción con id 0 es como nada cargado');
  V(est({ current: vHex, queue: [vHex, c(2)], queueIndex: 0 }).nextTrackId, null, 'con un video sonando no se anuncia la siguiente');

  // Bordes de idDeCancion
  V([7, '7', 0, '0', '4.2', 4.2, '12abc', '', ' 7', '-3', 2 ** 53, Number.MAX_SAFE_INTEGER].map((id) => S.idDeCancion(c(id))),
    [7, 7, null, null, null, null, null, null, null, null, null, Number.MAX_SAFE_INTEGER],
    'ids: número, texto de dígitos, 0, "0", "4.2", 4.2, "12abc", "", " 7", "-3", 2^53 y el máximo seguro');
  V([undefined, [], { id: [7] }, { id: { n: 7 } }].map(S.idDeCancion), [null, null, null, null], 'lo que no es una canción con id');

  // textoDeFin: el texto EXACTO de cada caso
  const FIN = {
    anfitrion: ['Terminaste la radio.', 'El anfitrión terminó la radio.'],
    admin: ['Un administrador terminó la radio.', 'Un administrador terminó la radio.'],
    reemplazada: ['Empezaste otra radio desde otra pestaña o dispositivo.', 'El anfitrión empezó otra radio.'],
    'sin-anfitrion': ['La radio se cerró porque dejó de recibir lo que escuchas.', 'La radio se cerró porque el anfitrión dejó de transmitir.'],
    pausa: ['La radio se cerró por estar mucho tiempo en pausa.', 'La radio se cerró por estar mucho tiempo en pausa.'],
    'no-existe': ['La radio ya no existe.', 'La radio ya no existe.'],
    llena: ['La radio está llena.', 'La radio está llena.'],
    sesion: ['Tu sesión expiró. Cierra sesión y vuelve a entrar.', 'Tu sesión expiró. Cierra sesión y vuelve a entrar.'],
    'no-es-tuya': ['Esta radio ya no es tuya.', 'Esta radio ya no es tuya.'],
    otro: ['La radio terminó.', 'La radio terminó.'],
  };
  for (const [razon, [anf, oy]] of Object.entries(FIN)) {
    V([S.textoDeFin('anfitrion', razon), S.textoDeFin('oyente', razon)], [anf, oy], `textoDeFin exacto · ${razon}`);
  }
  V([S.textoDeFin('anfitrion', undefined), S.textoDeFin(undefined, 'anfitrion')], ['La radio terminó.', 'El anfitrión terminó la radio.'], 'textoDeFin sin razón o sin rol');

  // textoDeFallo: el texto EXACTO de cada error
  const CONEXION = 'No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.';
  const FALLO = [
    ['unirse', { error: 'sin-respuesta' }, CONEXION],
    ['unirse', { error: 'sesion' }, 'Tu sesión expiró. Cierra sesión y vuelve a entrar.'],
    ['unirse', { error: 'no-existe' }, 'No hay ninguna radio con ese código. Revísalo e intenta de nuevo.'],
    ['iniciar', { error: 'no-existe' }, 'Esa radio ya no existe.'],
    ['unirse', { error: 'terminada', razon: 'pausa' }, 'Esa radio ya terminó.'],
    ['unirse', { error: 'llena' }, 'Esa radio está llena. Intenta más tarde.'],
    ['iniciar', { error: 'demasiadas' }, 'Hay demasiadas radios en vivo ahora. Intenta más tarde.'],
    ['iniciar', { error: 'frecuencia', esperaMs: 5000 }, 'Demasiados intentos. Espera unos segundos e intenta de nuevo.'],
    ['terminar', { error: 'no-es-tuya' }, 'Esa radio no es tuya.'],
    ['iniciar', { error: 'sin-servicio' }, 'El servidor todavía no tiene la radio. Intenta más tarde.'],
    ['iniciar', { error: 'invalido' }, 'No se pudo iniciar la radio. Intenta de nuevo.'],
    ['unirse', { error: 'cuerpo' }, 'No se pudo entrar a la radio. Intenta de nuevo.'],
    ['terminar', { error: 'cancion' }, 'No se pudo terminar la radio. Intenta de nuevo.'],
  ];
  for (const [accion, f, texto] of FALLO) V(S.textoDeFallo(accion, f), texto, `textoDeFallo exacto · ${accion} · ${f.error}`);

  // Cada salida de falloDeStatus que textoDeFallo consume: un texto para cada una.
  const ACCION = { crear: 'iniciar', leer: 'unirse', terminar: 'terminar', publicar: 'iniciar' };
  for (const ruta of ['crear', 'publicar', 'leer', 'terminar']) {
    const textos = [400, 401, 403, 404, 409, 410, 413, 422, 429, 500, 530, 418].map((st) => {
      const t = S.textoDeFallo(ACCION[ruta], S.falloDeStatus(ruta, st, { endedReason: 'pausa' }, 3));
      return typeof t === 'string' && t.length > 10 && !/undefined|null|\d{3}/.test(t);
    });
    V(textos, Array(12).fill(true), `falloDeStatus(${ruta}, 400…530 y 418) → textoDeFallo: un texto para cada status`);
  }
  V([500, 530].map((st) => S.textoDeFallo('iniciar', S.falloDeStatus('crear', st, null, null))), [CONEXION, CONEXION], 'servidor 500 y 530: el texto de la conexión');
  V(['iniciar', 'unirse', 'terminar'].map((a) => S.textoDeFallo(a, S.falloDeStatus('crear', 418, null, null))),
    ['No se pudo iniciar la radio. Intenta de nuevo.', 'No se pudo entrar a la radio. Intenta de nuevo.', 'No se pudo terminar la radio. Intenta de nuevo.'],
    'servidor 418: el genérico de cada acción, sin hablar de conexión');
  V(S.textoDeFallo('iniciar', { error: 'servidor', status: 499 }), 'No se pudo iniciar la radio. Intenta de nuevo.', 'servidor 499: todavía no es de conexión (el borde es 500)');
}

// ============================ (f) red: radioTerminar con keepalive (client.js) ============================
// Lo que recibe fetch, con las opciones CRUDAS (`crudos`, arriba): radioTerminar(codigo, { keepalive })
// para cerrar la pestaña. Sin opciones tiene que quedar idéntico a antes de 3a96b2c: las claves
// headers, method y signal, y nada más.
{
  const K = (a, b, nombre) => igual('red', a, b, nombre);
  const FIN = { serverNow: 30, status: 'ended', endedReason: 'anfitrion' };
  const CLAVES_ANTES = ['headers', 'method', 'signal'];
  // Una llamada → lo que vio fetch (o null si no hubo fetch).
  const terminar = async (codigo, ...args) => {
    crudos.length = 0;
    respuestas.push(resp(200, FIN));
    const r = await C.api.radioTerminar(codigo, ...args);
    const o = crudos[0] ?? null;
    if (!o) respuestas.length = 0;   // no hubo fetch: la respuesta preparada sobra
    return { r, o, n: crudos.length };
  };
  const ver = (o) => o && ({
    claves: Object.keys(o).sort(), method: o.method, keepalive: o.keepalive, tieneBody: 'body' in o,
    auth: o.headers?.Authorization ?? null, tipo: o.headers?.['Content-Type'] ?? null,
  });

  // (1) con keepalive: keepalive:true, DELETE, Bearer y SIN cuerpo
  const k = await terminar('K7M2QX', { keepalive: true });
  K(ver(k.o), { claves: ['headers', 'keepalive', 'method', 'signal'], method: 'DELETE', keepalive: true, tieneBody: false, auth: 'Bearer tok-prueba', tipo: 'application/json' },
    'radioTerminar keepalive: keepalive:true, DELETE, Bearer y sin body');
  K([k.r.ok, k.n], [true, 1], 'radioTerminar keepalive: un solo fetch y la respuesta se lee igual (ok)');

  // (2) sin opciones y con {}: las MISMAS claves de antes, sin la clave keepalive
  const s0 = await terminar('K7M2QX');
  const s1 = await terminar('K7M2QX', {});
  K([ver(s0.o).claves, ver(s1.o).claves], [CLAVES_ANTES, CLAVES_ANTES], 'radioTerminar sin opciones y con {}: headers, method y signal (sin keepalive)');
  K([ver(s0.o), s0.r.ok], [{ claves: CLAVES_ANTES, method: 'DELETE', keepalive: undefined, tieneBody: false, auth: 'Bearer tok-prueba', tipo: 'application/json' }, true],
    'radioTerminar sin opciones: DELETE con Bearer, sin body, como antes');

  // (3) keepalive que no es exactamente true: no pone la clave
  const malos = [];
  for (const v of [false, 'true', 1, null, undefined, {}]) malos.push(ver((await terminar('K7M2QX', { keepalive: v })).o).claves);
  K(malos, Array(6).fill(CLAVES_ANTES), 'keepalive false, "true", 1, null, undefined u objeto: no ponen la clave');

  // (4) una opción ajena no llega al fetch
  const ctrl = new AbortController();
  const aj = await terminar('K7M2QX', { signal: ctrl.signal, body: '{"x":1}', method: 'GET', headers: { 'X-Otra': '1' } });
  K([ver(aj.o).claves, aj.o.method, 'body' in aj.o, aj.o.signal === ctrl.signal, aj.o.headers?.['X-Otra'] ?? null],
    [CLAVES_ANTES, 'DELETE', false, false, null], 'opciones ajenas (signal, body, method, headers): no llegan al fetch');
  const aj2 = await terminar('K7M2QX', { keepalive: true, body: '{"x":1}' });
  K([ver(aj2.o).claves, 'body' in aj2.o], [['headers', 'keepalive', 'method', 'signal'], false], 'keepalive con un body ajeno: keepalive sí, body no');

  // (5) código inválido con keepalive: sin fetch y no-existe
  const inv = [];
  for (const c of ['xx', '', null, 'K7M2Q0', 'K7M2QXA']) inv.push(await terminar(c, { keepalive: true }));
  K([inv.map((x) => x.n), inv.map((x) => x.r)], [[0, 0, 0, 0, 0], Array(5).fill({ ok: false, error: 'no-existe' })],
    'código inválido con keepalive: ningún fetch y { ok:false, error:"no-existe" }');

  // (6) crear, publicar y leer siguen sin keepalive
  const otras = [];
  crudos.length = 0;
  respuestas.push(resp(201, { code: 'ABC234', serverNow: 5, status: 'live' }));
  await C.api.radioCrear();
  respuestas.push(resp(200, { serverNow: 9, status: 'live', state: { seq: 1, trackId: 7, positionMs: 1000, playing: true, nextTrackId: null, enPausaPorVideo: false, publishedAtServerMs: 9 } }));
  await C.api.radioPublicar('ABC234', { trackId: 7, positionMs: 1000, playing: true, nextTrackId: null, enPausaPorVideo: false });
  respuestas.push(resp(200, { serverNow: 20, code: 'ABC234', status: 'live', state: null, host: { id: 1, name: 'h' }, listeners: [] }));
  await C.api.radioLeer('ABC234');
  for (const o of crudos) otras.push([o.method, 'keepalive' in o]);
  K(otras, [['POST', false], ['PUT', false], ['GET', false]], 'crear, publicar y leer: sin la clave keepalive');
  K(respuestas.length, 0, 'keepalive: no sobró ninguna respuesta preparada');
}

// ============================ (g) web: sin pista con la radio abierta ============================
// El anfitrión ya publicó y después no hay canción ni video (trackId null, enPausaPorVideo false):
// debePublicar NO publica nada, sea lo que sea lo último publicado y pase el tiempo que pase. Si
// publicara, el cuerpo sería { trackId: null, … } y el servidor contestaría 400 en cada reintento.
// La sala, sin latido, la cierra el servidor (stale a los 30 s, cerrada a los 5 min, 'sin-anfitrion').
{
  const G = (a, b, nombre) => igual('web', a, b, nombre);
  const NADA = { trackId: null, positionMs: 0, playing: false, nextTrackId: null, enPausaPorVideo: false };
  const SONANDO = { trackId: 501, positionMs: 30_000, playing: true, nextTrackId: 502, enPausaPorVideo: false, enMs: 100_000 };
  const PAUSA = { ...SONANDO, playing: false };
  const VIDEO = { trackId: null, positionMs: 0, playing: false, nextTrackId: null, enPausaPorVideo: true, enMs: 100_000 };
  const momentos = [100_000, 100_050, 101_000, 110_000, 200_000, 10_000_000];   // al instante, salto, latido y mucho después

  G(momentos.map((t) => S.debePublicar(SONANDO, NADA, t)), Array(momentos.length).fill(null), 'sin pista tras publicar SONANDO: nada, en ningún momento');
  G(momentos.map((t) => S.debePublicar(PAUSA, NADA, t)), Array(momentos.length).fill(null), 'sin pista tras publicar EN PAUSA: nada, en ningún momento');
  G(momentos.map((t) => S.debePublicar(VIDEO, NADA, t)), Array(momentos.length).fill(null), 'sin pista tras publicar un VIDEO: nada, en ningún momento');
  G([S.debePublicar(SONANDO, { ...NADA, trackId: undefined }, 110_000), S.debePublicar(SONANDO, { ...NADA, playing: true, positionMs: 99_000 }, 110_000)],
    [null, null], 'trackId undefined, o "sonando" sin pista: tampoco');
  // De punta a punta: lo que arma estadoDelAnfitrion con el reproductor vacío (o con una pista de id 0).
  const vacio = S.estadoDelAnfitrion({ current: null, queue: [], queueIndex: -1, playing: true, posicionSeg: 42 });
  const id0 = S.estadoDelAnfitrion({ current: { id: 0 }, queue: [{ id: 0 }], queueIndex: 0, playing: true, posicionSeg: 42 });
  G([S.debePublicar(SONANDO, vacio, 110_000), S.debePublicar(PAUSA, id0, 110_000), S.debePublicar(null, vacio, 0)], [null, null, null],
    'estadoDelAnfitrion sin pista (vacío o id 0) → debePublicar: nada, con o sin publicación previa');
  // Y lo que SÍ sigue publicándose: volver a tener canción o pasar a video.
  G([S.debePublicar(SONANDO, { ...NADA, trackId: 503 }, 100_050), S.debePublicar(SONANDO, { ...NADA, enPausaPorVideo: true }, 100_050)],
    ['cancion', 'video'], 'al volver una canción o pasar a un video, sí publica');
}

// ============================ (h) iOS: test-radio-vista.mts @ 18d7790, el oyente ============================
// Los vectores de colaDelOyente, fotoDeLaCola/planDeRestauracion y pausaDelOyente de sonorarev-ios
// scripts/test-radio-vista.mts, commit 18d7790 (repo en 84c18b6; el archivo no cambió desde 18d7790),
// COPIADOS COMO DATOS, en el mismo orden y con el mismo nombre. Un solo ajuste a propósito: el video
// de prueba va marcado como lo marca la WEB (kind: 'video'); allá es tipo: "video".
{
  const I = (a, b, nombre) => igual('ios', a, b, nombre);
  const cierto = (v, nombre) => I(v === true, true, nombre);
  const c = (id, extra = {}) => ({ id, title: `T${id}`, artist: 'A', duration: 200, ...extra });
  const video = { kind: 'video', id: '12', title: 'V', artist: 'A', duration: 300 };

  // colaDelOyente
  const biblio = new Map([[1, c(1, { _qid: 'q1', _local: true })], [2, c(2)], [7, c('7')]]);
  const porId = (id) => biblio.get(id);
  I(S.colaDelOyente(porId, 1, 2), [c(1), c(2)], 'la canción y la siguiente, sin las marcas del motor');
  I(S.colaDelOyente(porId, 1, null), [c(1)], 'sin siguiente');
  I(S.colaDelOyente(porId, 1, 99), [c(1)], 'una siguiente que no está simplemente no va');
  I(S.colaDelOyente(porId, 1, 1), [c(1)], 'la siguiente no es la misma dos veces');
  I(S.colaDelOyente(porId, 99, 2), null, 'la canción no está en la biblioteca: null, no se inventa');
  I(S.colaDelOyente(porId, 7, null), [c('7')], 'un id guardado como texto también se encuentra');
  I(S.colaDelOyente(() => c(3), 1, null), null, 'si la biblioteca devuelve OTRA canción, no vale');

  // fotoDeLaCola y planDeRestauracion
  const cq = [c(1, { _qid: 'a' }), c(2, { _qid: 'b', _local: true })];
  I(S.fotoDeLaCola({ queue: cq, queueIndex: 1, posicionSeg: 33.5 }), { lista: [c(1), c(2)], indice: 1, posicionSeg: 33.5 }, 'la lista limpia, el índice y la posición');
  I(S.fotoDeLaCola({ queue: [], queueIndex: -1, posicionSeg: 0 }), null, 'sin cola no hay foto');
  I(S.fotoDeLaCola({ queue: cq, queueIndex: 2, posicionSeg: 0 }), null, 'un índice fuera de la cola no es una foto');
  I(S.fotoDeLaCola({ queue: cq, queueIndex: 0, posicionSeg: NaN })?.posicionSeg, 0, 'una posición rara es 0');
  I(S.planDeRestauracion(null), { tipo: 'pausar' }, 'sin foto: solo pausar');
  I(S.planDeRestauracion({ lista: [c(1), c(2)], indice: 1, posicionSeg: 33.5 }),
    { tipo: 'cola', lista: [c(1), c(2)], indice: 1, posicionSeg: 33.5 }, 'con foto: la misma lista, la misma canción, su posición');
  I(S.planDeRestauracion({ lista: [c(1), video], indice: 1, posicionSeg: 5 }), { tipo: 'pausar' }, 'lo que había era un video: solo pausar');
  I(S.planDeRestauracion({ lista: [c(1), video], indice: 0, posicionSeg: 5 }).tipo, 'cola', 'un video en la lista no impide volver a la canción');

  // pausaDelOyente
  const base = { quiereSonar: true, pausado: true, sonando: false, posicionMs: 60_000, duracionMs: 200_000, msDesdeOrden: 10_000 };
  cierto(S.pausaDelOyente(base), 'en pausa de verdad, a mitad de canción, sin orden reciente: es suya');
  I(S.pausaDelOyente({ ...base, quiereSonar: false }), false, 'si el anfitrión está en pausa, no es suya');
  I(S.pausaDelOyente({ ...base, pausado: false }), false, 'cargando o con un corte (no pausado): no es suya');
  I(S.pausaDelOyente({ ...base, sonando: true }), false, 'sonando: no hay pausa');
  I(S.pausaDelOyente({ ...base, msDesdeOrden: S.GRACIA_ORDEN_MS - 1 }), false, 'justo después de una orden nuestra: no es suya');
  cierto(S.pausaDelOyente({ ...base, msDesdeOrden: S.GRACIA_ORDEN_MS }), 'pasada la gracia: sí');
  I(S.pausaDelOyente({ ...base, posicionMs: 200_000 - S.CERCA_DEL_FINAL_MS }), false, 'al final de la canción: terminó, no la pausó');
  cierto(S.pausaDelOyente({ ...base, posicionMs: 200_000 - S.CERCA_DEL_FINAL_MS - 1 }), 'un pelo antes del margen del final: sí');
  cierto(S.pausaDelOyente({ ...base, duracionMs: null, posicionMs: 999_999 }), 'sin duración conocida no se puede decir que terminó');
}

// ============================ (i) web: resolverColaDelOyente y bordes del oyente ============================
// resolverColaDelOyente es SOLO WEB (la web no tiene la biblioteca en memoria: trae las pistas con
// api.track). `traer` es falso: registra a quién se pidió y contesta lo que dice cada caso.
{
  const W = (a, b, nombre) => igual('web', a, b, nombre);
  const c = (id, extra = {}) => ({ id, title: `T${id}`, artist: 'A', duration: 200, ...extra });
  const err = (status, extra = {}) => Object.assign(new Error('x'), status == null ? {} : { status }, extra);
  // Una "biblioteca del servidor": id → pista, o una función que decide (lanzar, rechazar, otra…).
  const traerDe = (tabla) => {
    const pedidos = [];
    const traer = (id) => {
      pedidos.push(id);
      const v = tabla[id];
      if (typeof v === 'function') return v(id);
      return Promise.resolve(v === undefined ? null : v);
    };
    return { traer, pedidos };
  };
  const rechaza = (e) => () => Promise.reject(e);
  // Si resolverColaDelOyente rechazara (o lanzara), el caso FALLA con su nombre en vez de tumbar el script.
  const R1 = async (tabla, t, n) => {
    const x = traerDe(tabla);
    try { const r = await S.resolverColaDelOyente(x.traer, t, n); return { ...r, pedidos: x.pedidos }; }
    catch (e) { return { RECHAZO: String(e?.message ?? e), pedidos: x.pedidos }; }
  };

  W(await R1({ 1: c(1, { _qid: 4 }) }, 1, null), { cola: [c(1)], motivo: null, pedidos: [1] }, 'cola: sin siguiente, una pista y un solo pedido (sin _qid)');
  W(await R1({ 1: c(1), 2: c(2, { _qid: 9 }) }, 1, 2), { cola: [c(1), c(2)], motivo: null, pedidos: [1, 2] }, 'cola: con siguiente, las dos limpias');
  W(await R1({ 1: rechaza(err(404)), 2: c(2) }, 1, 2), { cola: null, motivo: 'no-esta', pedidos: [1, 2] }, 'cola: 404 en la primera → no-esta');
  W(await R1({ 1: rechaza(new TypeError('Failed to fetch')), 2: c(2) }, 1, 2), { cola: null, motivo: 'fallo', pedidos: [1, 2] }, 'cola: red caída en la primera (sin status) → fallo');
  W((await Promise.all([err(500), err(503), err(401), err(0, { gate: true }), err(undefined, { timeout: true })]
    .map((e) => R1({ 1: rechaza(e) }, 1, null)))).map((r) => r.motivo),
    ['fallo', 'fallo', 'fallo', 'fallo', 'fallo'], 'cola: 500, 503, 401, gate y timeout en la primera → fallo (solo el 404 es no-esta)');
  W(await R1({ 1: c(1), 2: rechaza(err(404)) }, 1, 2), { cola: [c(1)], motivo: null, pedidos: [1, 2] }, 'cola: falla SOLO la siguiente (404) → cola de 1');
  W(await R1({ 1: c(1), 2: rechaza(new TypeError('red')) }, 1, 2), { cola: [c(1)], motivo: null, pedidos: [1, 2] }, 'cola: la siguiente con la red caída → cola de 1');
  W(await R1({ 1: c(3) }, 1, null), { cola: null, motivo: 'no-esta', pedidos: [1] }, 'cola: traer devuelve OTRA pista → no-esta');
  W(await R1({ 1: c(1), 2: c(8) }, 1, 2), { cola: [c(1)], motivo: null, pedidos: [1, 2] }, 'cola: la siguiente vino cambiada → no va');
  W(await R1({ 1: null }, 1, null), { cola: null, motivo: 'no-esta', pedidos: [1] }, 'cola: traer devuelve null → no-esta');
  W(await R1({ 1: c(1), 2: null }, 1, 2), { cola: [c(1)], motivo: null, pedidos: [1, 2] }, 'cola: la siguiente null → cola de 1');
  W(await R1({ 1: () => { throw err(404); } }, 1, null), { cola: null, motivo: 'no-esta', pedidos: [1] }, 'cola: traer lanza SÍNCRONO un 404 → no-esta, sin rechazar');
  W(await R1({ 1: () => { throw new Error('boom'); } }, 1, null), { cola: null, motivo: 'fallo', pedidos: [1] }, 'cola: traer lanza SÍNCRONO otra cosa → fallo, sin rechazar');
  W(await R1({ 1: c(1), 2: () => { throw new Error('boom'); } }, 1, 2), { cola: [c(1)], motivo: null, pedidos: [1, 2] }, 'cola: la siguiente lanza síncrono → cola de 1');
  W(await R1({ 1: c(1) }, 1, 1), { cola: [c(1)], motivo: null, pedidos: [1] }, 'cola: nextTrackId igual a trackId → una pista y UN pedido');
  W(await R1({ 7: c('7') }, 7, null), { cola: [c('7')], motivo: null, pedidos: [7] }, 'cola: id como texto de dígitos también vale');

  // Las dos se piden A LA VEZ: la segunda sale antes de que conteste la primera.
  {
    let suelta; const pedidos = [];
    const traer = (id) => { pedidos.push(id); return id === 1 ? new Promise((r) => { suelta = () => r(c(1)); }) : Promise.resolve(c(2)); };
    const p = S.resolverColaDelOyente(traer, 1, 2);
    await new Promise((r) => setTimeout(r, 0));
    const antes = [...pedidos];
    suelta();
    W({ antes, r: await p }, { antes: [1, 2], r: { cola: [c(1), c(2)], motivo: null } }, 'cola: las dos pistas se piden a la vez (una sola espera)');
  }
  // NUNCA rechaza, pase lo que pase con traer.
  {
    const raros = [
      () => { throw null; }, () => Promise.reject(undefined), () => Promise.reject('texto'), () => undefined,
      () => 42, () => ({}), () => [c(1)], () => ({ id: 1, kind: 'video' }), () => new Promise((r) => r(Promise.reject(err(404)))),
    ];
    const res = [];
    for (const f of raros) {
      try { const r = await S.resolverColaDelOyente((id) => f(id), 1, 2); res.push(r.cola === null ? r.motivo : 'cola'); }
      catch { res.push('RECHAZÓ'); }
    }
    W(res, ['fallo', 'fallo', 'fallo', 'no-esta', 'no-esta', 'no-esta', 'no-esta', 'no-esta', 'no-esta'],
      'cola: nunca rechaza (throw null, reject sin valor, valores raros, un video con ese id, 404 anidado)');
  }

  // fotoDeLaCola: bordes.
  const q = [c(1, { _qid: 1 }), c(2, { _qid: 2 })];
  const foto = (queueIndex, posicionSeg, queue = q) => S.fotoDeLaCola({ queue, queueIndex, posicionSeg });
  W([foto(0, 5, []), foto(-1, 5), foto(2, 5), foto(99, 5), foto(0.5, 5), foto(NaN, 5), foto(undefined, 5), foto('0', 5)],
    [null, null, null, null, null, null, null, null], 'foto: cola vacía, índice -1, == largo, muy fuera, no entero, NaN, undefined o texto → null');
  W([null, undefined, { 0: c(1), length: 1 }].map((queue) => S.fotoDeLaCola({ queue, queueIndex: 0, posicionSeg: 5 })), [null, null, null], 'foto: queue que no es un array → null');
  W([NaN, -1, -0.001, Infinity, -Infinity, 0, undefined, null, '12'].map((s) => foto(1, s)?.posicionSeg), [0, 0, 0, 0, 0, 0, 0, 0, 0],
    'foto: posición NaN, negativa, infinita, 0, faltante o texto → 0');
  W([foto(1, 0.001).posicionSeg, foto(0, 3600.25).posicionSeg], [0.001, 3600.25], 'foto: una posición positiva se guarda tal cual');
  W(foto(1, 10), { lista: [c(1), c(2)], indice: 1, posicionSeg: 10 }, 'foto: el último índice vale, la lista sin _qid');
  W(q.map((t) => t._qid), [1, 2], 'foto: NO toca la cola del reproductor (los _qid siguen ahí)');
  W(S.planDeRestauracion({ lista: [c(1), c(0)], indice: 1, posicionSeg: 3 }), { tipo: 'pausar' }, 'plan: una entrada sin id de canción → pausar');
  W(S.planDeRestauracion({ lista: [c(1)], indice: 5, posicionSeg: 3 }), { tipo: 'pausar' }, 'plan: índice que no apunta a nada → pausar');

  // pausaDelOyente: los límites exactos y la duración desconocida.
  const base = { quiereSonar: true, pausado: true, sonando: false, posicionMs: 60_000, duracionMs: 200_000, msDesdeOrden: 10_000 };
  W([S.GRACIA_ORDEN_MS, S.CERCA_DEL_FINAL_MS, S.DESAJUSTE_MS], [3000, 2500, 6000], 'pausa: las perillas valen lo que en iOS (3000, 2500, 6000)');
  W([2999, 3000, 3001, 0, -5].map((ms) => S.pausaDelOyente({ ...base, msDesdeOrden: ms })), [false, true, true, false, false],
    'pausa: gracia de la orden — 2999 no, 3000 sí, 3001 sí; 0 y negativo no');
  W([197_499, 197_500, 197_501, 200_000, 250_000].map((pos) => S.pausaDelOyente({ ...base, posicionMs: pos })), [true, false, false, false, false],
    'pausa: cerca del final (200 s) — 197,499 s sí, 197,5 s en adelante no');
  W([0, 60_000, 10_000_000].map((pos) => S.pausaDelOyente({ ...base, duracionMs: null, posicionMs: pos })), [true, true, true],
    'pausa: duracionMs null → nunca "terminó", en cualquier posición');
  W(S.pausaDelOyente({ ...base, duracionMs: 2000, posicionMs: 0 }), false, 'pausa: canción más corta que el margen del final → no es suya');
  W(S.pausaDelOyente({ ...base, msDesdeOrden: 2999, duracionMs: null }), false, 'pausa: la gracia manda también sin duración');
}

// ============================ avatarUrl (client.js): el token por query, como coverUrl/streamUrl ============================
{
  const A = (a, b, nombre) => igual('avatar', a, b, nombre);
  A(C.avatarUrl('/api/users/7/avatar?v=1700000000'), '/api/users/7/avatar?v=1700000000&token=tok-prueba', 'con ?v= → &token=');
  A(C.avatarUrl('/api/users/7/avatar'), '/api/users/7/avatar?token=tok-prueba', 'sin ?v= → ?token=');
  A([null, undefined, '', 42].map((u) => C.avatarUrl(u)), [null, null, null, null], 'sin url (null, undefined, vacía, no texto) → null');
  A(C.avatarUrl(S.leerAvatar({ kind: 'photo', url: '/api/users/12/avatar?v=3', updatedAt: 'x' }).url), '/api/users/12/avatar?v=3&token=tok-prueba',
    'lo que deja pasar leerAvatar sale con su token');
}

const fails = Object.entries(R).filter(([, v]) => v !== true);
console.log(JSON.stringify(R, null, 1));
for (const [k, v] of fails) console.log('FALLA', k, JSON.stringify(v));
console.log(`\nradio-unit: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
process.exit(fails.length ? 1 : 0);
