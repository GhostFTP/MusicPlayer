// Prueba de las REGLAS y del ALMACÉN del modo radio (src/radio/reglas.js y almacen.js,
// 1.29.0). Puro: sin base, sin servidor y con el RELOJ INYECTADO, así la expiración se prueba
// sin esperar minutos.
//
//   npm run test:radio
//
// Sale con código 1 si algo falla.
import { crearAlmacen } from '../src/radio/almacen.js';
import {
  ALFABETO, REGLAS, TIPOS_ORDEN, acotarPosicion, contar, leerCodigo, leerOrden, leerPublicacion, nombrePublico, nuevoCodigo, tituloPublico, vidaDe,
} from '../src/radio/reglas.js';

let pass = 0;
let fail = 0;
function check(ok, label, detalle = '') {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FALLA ${label}${detalle ? `  → ${detalle}` : ''}`); }
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Un almacén con su reloj a mano. */
function mundo(reglas = REGLAS) {
  const reloj = { t: 1_000_000 };
  const a = crearAlmacen({ ahora: () => reloj.t, reglas });
  return { a, reloj, pasar: (ms) => { reloj.t += ms; } };
}
const SUENA = { trackId: 7, positionMs: 1000, playing: true, nextTrackId: 8, enPausaPorVideo: false };
const PAUSA = { ...SUENA, playing: false };
const VIDEO = { trackId: null, positionMs: 0, playing: false, nextTrackId: null, enPausaPorVideo: true };

console.log('el código');
{
  check(!/[01OIL]/.test(ALFABETO) && ALFABETO.length === 31, 'el alfabeto no tiene 0, O, 1, I ni L');
  let n = 0;
  const c = nuevoCodigo(() => (n++) % ALFABETO.length);
  check(c === '234567', 'seis caracteres del alfabeto', c);
  const { a } = mundo();
  const codigos = new Set();
  for (let i = 0; i < 200; i++) codigos.add(nuevoCodigo((k) => Math.floor(Math.random() * k)));
  check([...codigos].every((x) => /^[2-9A-HJKMNP-Z]{6}$/.test(x)), '200 códigos al azar con la forma correcta');
  check(a.crear(1).codigo.length === 6, 'el almacén devuelve uno de seis');
  check(leerCodigo(' ab2cd3 ') === 'AB2CD3', 'se lee en minúsculas y con espacios');
  check(igual([leerCodigo('ABC'), leerCodigo('ABCDE0'), leerCodigo('ABCDEL'), leerCodigo('ABCDEFG'), leerCodigo(123456), leerCodigo(null)],
    [null, null, null, null, null, null]), 'lo que no tiene forma de código es null');
}

console.log('leer lo que publica el anfitrión');
{
  const L = (b) => leerPublicacion(b);
  check(igual(L({ trackId: 7, positionMs: 1500.4, playing: true }).pedido,
    { trackId: 7, positionMs: 1500.4, playing: true, nextTrackId: null, enPausaPorVideo: false }), 'lo mínimo');
  check(L({ trackId: 7, positionMs: 0, playing: false, nextTrackId: 9 }).pedido.nextTrackId === 9, 'con la siguiente');
  check(!L(null).ok && !L([]).ok && !L('x').ok, 'sin cuerpo, un arreglo o un texto: no');
  check(!L({ positionMs: 0, playing: true }).ok, 'sin trackId: no');
  check(!L({ trackId: '7', positionMs: 0, playing: true }).ok, 'trackId como texto: no');
  check(!L({ trackId: 7.5, positionMs: 0, playing: true }).ok && !L({ trackId: 0, positionMs: 0, playing: true }).ok && !L({ trackId: -3, positionMs: 0, playing: true }).ok,
    'trackId con decimales, cero o negativo: no');
  check(!L({ trackId: 7, playing: true }).ok, 'sin positionMs: no');
  check(!L({ trackId: 7, positionMs: '10', playing: true }).ok && !L({ trackId: 7, positionMs: NaN, playing: true }).ok && !L({ trackId: 7, positionMs: Infinity, playing: true }).ok,
    'positionMs que no es un número finito: no');
  check(!L({ trackId: 7, positionMs: 0 }).ok && !L({ trackId: 7, positionMs: 0, playing: 1 }).ok && !L({ trackId: 7, positionMs: 0, playing: 'true' }).ok,
    'playing que no es booleano: no');
  check(!L({ trackId: 7, positionMs: 0, playing: true, nextTrackId: 'x' }).ok, 'nextTrackId que no es entero: no');
  check(!L({ trackId: 7, positionMs: 0, playing: true, enPausaPorVideo: 'si' }).ok, 'enPausaPorVideo que no es booleano: no');
  check(igual(L({ enPausaPorVideo: true }).pedido, VIDEO), 'viendo un video puede no haber canción');
  check(L({ trackId: 7, positionMs: 5, playing: true, enPausaPorVideo: true }).pedido.playing === false, 'viendo un video, playing es false aunque el cliente diga true');
  const conReloj = L({ trackId: 7, positionMs: 5, playing: true, clientNow: 1, publishedAtServerMs: 1, seq: 99, serverNow: 5 }).pedido;
  check(!('clientNow' in conReloj) && !('publishedAtServerMs' in conReloj) && !('seq' in conReloj), 'un reloj o una secuencia del cliente se ignoran');
}

console.log('leer una orden de un moderador (1.43.0)');
{
  const O = (b) => leerOrden(b);
  const ID = 'k3J9x2';
  check(igual(O({ tipo: 'siguiente', seqBase: 41, idCliente: ID }).orden, { tipo: 'siguiente', trackId: null, seqBase: 41, idCliente: ID }), 'siguiente');
  check(igual(O({ tipo: 'pausa', seqBase: 41, idCliente: ID }).orden, { tipo: 'pausa', trackId: null, seqBase: null, idCliente: ID }), 'pausa (un seqBase se ignora)');
  check(igual(O({ tipo: 'reanudar', seqBase: 41, idCliente: ID }).orden, { tipo: 'reanudar', trackId: null, seqBase: null, idCliente: ID }), 'reanudar (un seqBase se ignora)');
  check(igual(O({ tipo: 'a-continuacion', trackId: 7, idCliente: ID }).orden, { tipo: 'a-continuacion', trackId: 7, seqBase: null, idCliente: ID }), 'a continuación');
  check(igual(O({ tipo: 'ahora', trackId: 7, seqBase: 41, idCliente: ID }).orden, { tipo: 'ahora', trackId: 7, seqBase: null, idCliente: ID }), 'ahora (un seqBase se ignora)');
  check(igual(Object.keys(TIPOS_ORDEN), ['siguiente', 'pausa', 'reanudar', 'a-continuacion', 'ahora']) && Object.isFrozen(TIPOS_ORDEN), 'los cinco tipos, congelados');

  check(!O(null).ok && !O([]).ok && !O('siguiente').ok && !O(undefined).ok, 'sin cuerpo, un arreglo o un texto: no');
  check(!O({ seqBase: 1, idCliente: ID }).ok && !O({ tipo: 'saltar', seqBase: 1, idCliente: ID }).ok && !O({ tipo: 7, seqBase: 1, idCliente: ID }).ok
    && !O({ tipo: 'SIGUIENTE', seqBase: 1, idCliente: ID }).ok, 'sin tipo, uno que no existe, un número o en mayúsculas: no');
  check(['__proto__', 'constructor', 'toString', 'hasOwnProperty'].every((t) => !O({ tipo: t, seqBase: 1, trackId: 7, idCliente: ID }).ok),
    'un nombre del prototipo como tipo: no');

  check(!O({ tipo: 'a-continuacion', idCliente: ID }).ok && !O({ tipo: 'ahora', seqBase: 1, idCliente: ID }).ok, 'a continuación o ahora sin trackId: no');
  check(['7', 7.5, 0, -3, null, NaN, 2 ** 53].every((t) => !O({ tipo: 'ahora', trackId: t, seqBase: 1, idCliente: ID }).ok),
    'trackId como texto, con decimales, cero, negativo, null, NaN o fuera de rango: no');

  check(!O({ tipo: 'siguiente', idCliente: ID }).ok, 'siguiente sin seqBase: no');
  check(O({ tipo: 'pausa', idCliente: ID }).ok && O({ tipo: 'reanudar', idCliente: ID }).ok && O({ tipo: 'ahora', trackId: 7, idCliente: ID }).ok
    && O({ tipo: 'a-continuacion', trackId: 7, idCliente: ID }).ok, 'pausa, reanudar, ahora y a continuación sin seqBase: sí (son absolutas)');
  check(['1', 1.5, -1, null, Infinity, 2 ** 53].every((b) => !O({ tipo: 'siguiente', seqBase: b, idCliente: ID }).ok),
    'seqBase como texto, con decimales, negativo, null, infinito o fuera de rango: no');
  check(O({ tipo: 'siguiente', seqBase: 0, idCliente: ID }).ok, 'seqBase 0 (el anfitrión todavía no publicó): sí');

  check(O({ tipo: 'siguiente', seqBase: 1, trackId: 'basura', idCliente: ID }).orden?.trackId === null, 'un trackId en una orden que no lo lleva se ignora');
  check(O({ tipo: 'a-continuacion', trackId: 7, seqBase: 'basura', idCliente: ID }).orden?.seqBase === null, 'un seqBase en una orden que no lo lleva se ignora');

  check([undefined, null, 123456, 'abc12', 'x'.repeat(25), 'con espacio', 'k3J9x2"', 'ñandú12', ''].every((i) => !O({ tipo: 'siguiente', seqBase: 1, idCliente: i }).ok),
    'idCliente que falta, no es texto, es corto o largo, o trae espacios, comillas o acentos: no');
  check(O({ tipo: 'siguiente', seqBase: 1, idCliente: 'a-b_C9' }).ok && O({ tipo: 'siguiente', seqBase: 1, idCliente: 'Z'.repeat(24) }).ok, 'idCliente de 6 y de 24: sí');

  const conDeMas = O({ tipo: 'ahora', trackId: 7, seqBase: 3, idCliente: ID, trackBase: 99, por: 1, quien: 1, clientNow: 5, serverNow: 5, id: 8 }).orden;
  check(igual(Object.keys(conDeMas), ['tipo', 'trackId', 'seqBase', 'idCliente']), 'trackBase, quién la manda, un id o un reloj del cliente se ignoran');

  const mayor = JSON.stringify({ tipo: 'a-continuacion', trackId: Number.MAX_SAFE_INTEGER, seqBase: Number.MAX_SAFE_INTEGER, idCliente: 'Z'.repeat(24) });
  check(Buffer.byteLength(mayor) <= REGLAS.CUERPO_MAX_BYTES, `la orden más grande cabe en ${REGLAS.CUERPO_MAX_BYTES} bytes`, `${Buffer.byteLength(mayor)} bytes`);
}

console.log('las reglas de la moderación (1.43.0)');
check(igual([REGLAS.MAX_MODERADORES, REGLAS.MAX_ORDENES, REGLAS.ORDEN_TTL_MS, REGLAS.MAX_ORDENES_PERSONA, REGLAS.VENTANA_ORDENES_MS, REGLAS.MAX_EVENTOS],
  [3, 10, 30_000, 10, 10_000, 20]), 'los valores por defecto: 3 moderadores, 10 órdenes, 30 s, 10 por persona cada 10 s, 20 eventos');
check(Object.isFrozen(REGLAS), 'REGLAS sigue congelado');

console.log('acotar la posición');
{
  check(acotarPosicion(1500.4, 200) === 1500, 'dentro de la pista, redondeada');
  check(acotarPosicion(-50, 200) === 0, 'negativa: 0');
  check(acotarPosicion(999_999, 200.5) === 200_500, 'pasada del final: la duración');
  check(acotarPosicion(5000, null) === 5000 && acotarPosicion(5000, 0) === 5000 && acotarPosicion(5000, NaN) === 5000, 'sin duración en la base: tal cual');
  check(acotarPosicion(9e12, null) === REGLAS.POSICION_MAX_MS, 'sin duración, con el tope de seguridad');
}

console.log('en qué está una radio');
{
  const r = (o) => ({ ultimaDelAnfitrion: 0, enPausaDesde: null, estado: { enPausaPorVideo: false }, ...o });
  check(vidaDe(r(), REGLAS.STALE_MS - 1) === 'live', 'un milisegundo antes de stale: live');
  check(vidaDe(r(), REGLAS.STALE_MS) === 'stale', 'a los 30 s sin publicar: stale');
  check(vidaDe(r(), REGLAS.CIERRE_SIN_ANFITRION_MS - 1) === 'stale', 'un milisegundo antes del cierre: stale');
  check(igual(vidaDe(r(), REGLAS.CIERRE_SIN_ANFITRION_MS), { cerrar: 'sin-anfitrion' }), 'a los 5 min sin publicar: se cierra');
  const t = REGLAS.CIERRE_EN_PAUSA_MS;
  check(vidaDe(r({ ultimaDelAnfitrion: t - 1, enPausaDesde: 0 }), t - 1) === 'live', 'en pausa con latidos, antes del tope: live');
  check(igual(vidaDe(r({ ultimaDelAnfitrion: t, enPausaDesde: 0 }), t), { cerrar: 'pausa' }), 'en pausa 30 min, aun con latidos: se cierra');
  check(vidaDe(r({ ultimaDelAnfitrion: t, enPausaDesde: 0, estado: { enPausaPorVideo: true } }), t) === 'live', 'viendo un video, a los 30 min sigue');
  const v = REGLAS.CIERRE_EN_VIDEO_MS;
  check(igual(vidaDe(r({ ultimaDelAnfitrion: v, enPausaDesde: 0, estado: { enPausaPorVideo: true } }), v), { cerrar: 'pausa' }), 'viendo un video 3 h: se cierra');
  check(igual([REGLAS.STALE_MS, REGLAS.CIERRE_SIN_ANFITRION_MS, REGLAS.CIERRE_EN_PAUSA_MS], [30_000, 300_000, 1_800_000]), 'los valores por defecto: 30 s, 5 min, 30 min');
}

console.log('la ventana de frecuencia');
{
  let c = null;
  const pasos = [];
  for (let i = 0; i < 4; i++) { const r = contar(c, 100, 3, 1000); c = r.cubeta; pasos.push(r.pasa); }
  check(igual(pasos, [true, true, true, false]), 'pasan las primeras tres y la cuarta no');
  check(contar(c, 1099, 3, 1000).pasa === false && contar(c, 1100, 3, 1000).pasa === true, 'al vencer la ventana vuelve a pasar');
}

console.log('el nombre que ven los demás');
check(igual([nombrePublico('oscar'), nombrePublico('ana.perez@gmail.com'), nombrePublico('@raro'), nombrePublico(null)],
  ['oscar', 'ana.perez', '@raro', '']), 'un correo se corta en la arroba; lo demás, tal cual');

console.log('crear, publicar y leer');
{
  const { a, pasar } = mundo();
  const c = a.crear(1);
  check(c.ok && c.serverNow === 1_000_000, 'crear devuelve el código y la hora del servidor');
  const vacia = a.leer(c.codigo, 2);
  check(vacia.ok && vacia.status === 'live' && vacia.estado === null && vacia.anfitrion === 1, 'recién creada: live y sin estado');
  pasar(500);
  const p1 = a.publicar(c.codigo, 1, SUENA);
  check(p1.ok && p1.estado.seq === 1 && p1.estado.publishedAtServerMs === 1_000_500, 'la primera publicación es la secuencia 1, con la hora del servidor');
  pasar(700);
  const p2 = a.publicar(c.codigo, 1, PAUSA);
  check(p2.estado.seq === 2 && p2.estado.publishedAtServerMs === 1_001_200 && p2.estado.playing === false, 'la segunda sube a 2');
  const l = a.leer(c.codigo, 2);
  check(igual(l.estado, p2.estado) && l.serverNow === 1_001_200, 'el oyente lee lo último');
  check(igual(Object.keys(l.estado).sort(), ['enPausaPorVideo', 'nextTrackId', 'playing', 'positionMs', 'publishedAtServerMs', 'seq', 'trackId']), 'el estado tiene esos campos y ninguno más');
  check(igual(a.leer(c.codigo, 3).oyentes, [2, 3]), 'los que leen quedan de oyentes');
  check(igual(a.leer(c.codigo, 1).oyentes, [2, 3]), 'el anfitrión no cuenta como oyente');
  pasar(REGLAS.OYENTE_MS - 1);
  a.leer(c.codigo, 3);
  pasar(1);
  check(igual(a.leer(c.codigo, 1).oyentes, [3]), 'quien deja de preguntar sale de la lista');
}

console.log('solo el anfitrión');
{
  const { a } = mundo();
  const { codigo } = a.crear(1);
  check(igual(a.publicar(codigo, 2, SUENA), { ok: false, motivo: 'no-es-tuya' }), 'otro no puede publicar');
  check(a.leer(codigo, 2).estado === null, 'y su intento no dejó estado');
  check(igual(a.terminar(codigo, 2), { ok: false, motivo: 'no-es-tuya' }), 'otro no puede terminar');
  check(a.leer(codigo, 2).status === 'live', 'y la radio sigue viva');
  check(a.terminar(codigo, 2, { esAdmin: true }).motivo === 'admin', 'un admin sí');
  check(a.leer(codigo, 2).status === 'ended' && a.leer(codigo, 2).motivo === 'admin', 'queda "ended", con el motivo');
  check(igual(a.publicar(codigo, 1, SUENA), { ok: false, motivo: 'terminada', razon: 'admin' }), 'a una terminada no se publica');
  check(a.terminar(codigo, 1).ok, 'terminar una terminada no es un error');
  check(a.leer(codigo, 2).motivo === 'admin', 'y conserva el primer motivo');
  check(igual([a.publicar('ZZZZZZ', 1, SUENA).motivo, a.leer('ZZZZZZ', 1).motivo, a.terminar('ZZZZZZ', 1).motivo], ['no-existe', 'no-existe', 'no-existe']), 'un código que no existe');
}

console.log('una sola radio por anfitrión');
{
  const { a } = mundo();
  const uno = a.crear(1).codigo;
  a.publicar(uno, 1, SUENA);
  const dos = a.crear(1).codigo;
  check(uno !== dos, 'la segunda tiene otro código');
  const vieja = a.leer(uno, 2);
  check(vieja.status === 'ended' && vieja.motivo === 'reemplazada', 'la anterior terminó sola');
  check(a.leer(dos, 2).status === 'live' && a.leer(dos, 2).estado === null, 'la nueva empieza vacía');
  check(a.publicar(uno, 1, SUENA).motivo === 'terminada', 'el código viejo ya no publica');
}

console.log('expiración');
{
  const { a, pasar } = mundo();
  const { codigo } = a.crear(1);
  a.publicar(codigo, 1, SUENA);
  pasar(REGLAS.STALE_MS - 1);
  check(a.leer(codigo, 2).status === 'live', '29,999 s sin publicar: live');
  pasar(1);
  check(a.leer(codigo, 2).status === 'stale', '30 s: stale');
  check(a.publicar(codigo, 1, SUENA).ok && a.leer(codigo, 2).status === 'live', 'un latido la devuelve a live');
  pasar(REGLAS.CIERRE_SIN_ANFITRION_MS);
  const fin = a.leer(codigo, 2);
  check(fin.status === 'ended' && fin.motivo === 'sin-anfitrion' && fin.oyentes.length === 0, '5 min sin publicar: ended, sin oyentes');
  check(fin.estado?.seq === 2, 'y todavía dice qué fue lo último');
  pasar(REGLAS.ENDED_VISIBLE_MS - 1);
  check(a.leer(codigo, 2).status === 'ended', 'sigue diciendo ended un rato');
  pasar(1);
  check(a.leer(codigo, 2).motivo === 'no-existe' && a.cuantas() === 0, 'después se borra: no existe');
}
{
  const { a, pasar } = mundo();
  const { codigo } = a.crear(1);
  check(a.leer(codigo, 2).status === 'live', 'sin publicar nunca: live al principio');
  pasar(REGLAS.STALE_MS);
  check(a.leer(codigo, 2).status === 'stale', 'a los 30 s de creada sin publicar: stale');
  pasar(REGLAS.CIERRE_SIN_ANFITRION_MS);
  check(a.leer(codigo, 2).status === 'ended', 'y a los 5 min se cierra');
}
{
  // En pausa con latidos cada 10 s: la cierra la pausa, no el silencio.
  const { a, pasar } = mundo();
  const { codigo } = a.crear(1);
  a.publicar(codigo, 1, PAUSA);
  let cerro = null;
  for (let s = 10; s <= 1800 && cerro === null; s += 10) {
    pasar(10_000);
    const r = a.publicar(codigo, 1, PAUSA);
    if (!r.ok) cerro = { s, motivo: r.motivo, razon: r.razon };
  }
  check(igual(cerro, { s: 1800, motivo: 'terminada', razon: 'pausa' }), 'en pausa con latidos: se cierra a los 30 min justos', JSON.stringify(cerro));
}
{
  // Volver a sonar reinicia la cuenta de la pausa.
  const { a, pasar } = mundo();
  const { codigo } = a.crear(1);
  // 29 min en pausa (con latidos, para que no la cierre el silencio), suena, y otros 29.
  const latidos = (estado, minutos) => { let ok = true; for (let s = 0; s < minutos * 6; s++) { pasar(10_000); ok = a.publicar(codigo, 1, estado).ok && ok; } return ok; };
  a.publicar(codigo, 1, PAUSA);
  const antes = latidos(PAUSA, 29);
  a.publicar(codigo, 1, SUENA);
  check(antes && latidos(PAUSA, 29), 'sonar un momento reinicia la cuenta de la pausa');
  check(!latidos(PAUSA, 2), 'y desde ahí vuelve a contar los 30 min');
}
{
  // Viendo un video: no la cierran los 30 min de la pausa.
  const { a, pasar } = mundo();
  const { codigo } = a.crear(1);
  a.publicar(codigo, 1, VIDEO);
  let ok = true;
  for (let s = 10; s <= 2400; s += 10) { pasar(10_000); ok = a.publicar(codigo, 1, VIDEO).ok && ok; }
  check(ok && a.leer(codigo, 2).estado.enPausaPorVideo === true, 'viendo un video 40 min con latidos: sigue abierta');
}

console.log('límites');
{
  const { a, pasar } = mundo();
  const codigos = [];
  for (let u = 1; u <= REGLAS.MAX_RADIOS; u++) codigos.push(a.crear(u).codigo);
  check(codigos.every(Boolean), `${REGLAS.MAX_RADIOS} radios a la vez: sí`);
  check(igual(a.crear(99), { ok: false, motivo: 'demasiadas' }), 'una más: no');
  check(a.crear(1).ok, 'pero quien ya tiene una puede reemplazarla');
  a.terminar(codigos[1], 2);
  check(a.crear(99).ok, 'y al terminar una, entra otra');
  pasar(REGLAS.VENTANA_CREACIONES_MS);
}
{
  const { a } = mundo();
  let ultimo = null;
  for (let i = 0; i < REGLAS.MAX_CREACIONES; i++) ultimo = a.crear(1);
  check(ultimo.ok, `${REGLAS.MAX_CREACIONES} creaciones seguidas de la misma cuenta: sí`);
  const r = a.crear(1);
  check(!r.ok && r.motivo === 'frecuencia' && r.esperaMs > 0, 'la siguiente en el mismo minuto: no');
  check(a.leer(ultimo.codigo, 2).status === 'live', 'y la radio que ya tenía sigue viva');
}
{
  const { a, pasar } = mundo();
  const { codigo } = a.crear(1);
  for (let u = 100; u < 100 + REGLAS.MAX_OYENTES; u++) a.leer(codigo, u);
  check(igual(a.leer(codigo, 999), { ok: false, motivo: 'llena' }), `con ${REGLAS.MAX_OYENTES} oyentes, uno más no entra`);
  check(a.leer(codigo, 100).ok, 'los que ya estaban siguen leyendo');
  check(a.leer(codigo, 1).ok, 'y el anfitrión también');
  pasar(REGLAS.OYENTE_MS);
  check(a.leer(codigo, 999).ok, 'cuando los demás se van, entra');
}
{
  const { a, pasar } = mundo();
  const { codigo } = a.crear(1);
  let ok = 0;
  let r = null;
  for (let i = 0; i <= REGLAS.MAX_PUBLICACIONES; i++) { r = a.publicar(codigo, 1, SUENA); if (r.ok) ok++; }
  check(ok === REGLAS.MAX_PUBLICACIONES && r.motivo === 'frecuencia', `${REGLAS.MAX_PUBLICACIONES} publicaciones en la ventana, y la siguiente no`);
  check(a.leer(codigo, 2).estado.seq === REGLAS.MAX_PUBLICACIONES, 'la rechazada no subió la secuencia');
  pasar(REGLAS.VENTANA_PUBLICACIONES_MS);
  check(a.publicar(codigo, 1, SUENA).estado?.seq === REGLAS.MAX_PUBLICACIONES + 1, 'al vencer la ventana vuelve a publicar');
}

console.log('moderadores (1.43.0)');
const MOD = { capacidades: { moderar: true } };
/** Desde S3, leer() da moderadores y capacidades solo a pedido: así lo pide el anfitrión. */
const PIDE = { desde: 0 };
/** Una radio de 1 con 2, 3, 4 y 5 escuchando desde un cliente que sabe moderar. */
function salaConOyentes() {
  const m = mundo();
  const { codigo } = m.a.crear(1, { capacidades: { ordenes: true } });
  for (const u of [2, 3, 4, 5]) m.a.leer(codigo, u, MOD);
  return { ...m, codigo };
}
{
  const { a, codigo } = salaConOyentes();
  check(igual(a.leer(codigo, 1, PIDE).moderadores, []), 'una radio nueva no tiene moderadores');
  const r = a.otorgar(codigo, 1, 2, { nombre: 'Sonia' });
  check(r.ok && igual(r.moderadores, [2]) && r.nombre === 'Sonia', 'el anfitrión nombra a quien escucha, y vuelve su nombre');
  check(igual(a.leer(codigo, 3, MOD).moderadores, [2]), 'leer lo muestra');
  const otra = a.otorgar(codigo, 1, 2, { nombre: 'Otro' });
  check(otra.ok && igual(otra.moderadores, [2]) && otra.nombre === 'Sonia', 'nombrarlo otra vez no es un error ni cambia nada');
}
{
  const { a, codigo } = salaConOyentes();
  const r = a.otorgar(codigo, 3, 4);
  check(igual(r, { ok: false, motivo: 'sin-permiso' }), 'un oyente no puede nombrar: sin-permiso');
  check(r.motivo !== 'no-es-tuya', 'y no es no-es-tuya (ese es solo de publicar: la app abandona la radio)');
  a.otorgar(codigo, 1, 2);
  check(igual(a.otorgar(codigo, 2, 3), { ok: false, motivo: 'sin-permiso' }), 'un moderador no puede nombrar a otro');
  check(igual(a.otorgar(codigo, 3, 3), { ok: false, motivo: 'sin-permiso' }), 'nadie se nombra a sí mismo');
  check(igual(a.otorgar(codigo, 99, 4), { ok: false, motivo: 'sin-permiso' }), 'alguien de afuera tampoco');
  check(igual(a.otorgar(codigo, 1, 1), { ok: false, motivo: 'es-el-anfitrion' }), 'el anfitrión no se nombra a sí mismo');
  check(igual(a.leer(codigo, 1, PIDE).moderadores, [2]), 'nada de eso cambió la lista');
}
{
  const { a, codigo, pasar } = salaConOyentes();
  check(igual(a.otorgar(codigo, 1, 77), { ok: false, motivo: 'no-escucha' }), 'a quien nunca escuchó: no-escucha');
  pasar(REGLAS.OYENTE_MS);
  a.leer(codigo, 3, MOD);
  check(igual(a.otorgar(codigo, 1, 2), { ok: false, motivo: 'no-escucha' }), 'a quien dejó de escuchar hace 10 s: no-escucha');
  check(a.otorgar(codigo, 1, 3).ok, 'a quien sigue escuchando: sí');
  a.leer(codigo, 6);
  check(igual(a.otorgar(codigo, 1, 6), { ok: false, motivo: 'sin-soporte' }), 'a quien escucha desde un cliente que no sabe moderar: sin-soporte');
  a.leer(codigo, 7, { capacidades: { moderar: 'true' } });
  check(igual(a.otorgar(codigo, 1, 7), { ok: false, motivo: 'sin-soporte' }), 'un "true" en texto no cuenta como soporte');
  a.leer(codigo, 6, MOD);
  check(a.otorgar(codigo, 1, 6).ok, 'si vuelve a leer desde uno que sí, entonces sí');
}
{
  const { a, codigo } = salaConOyentes();
  for (const u of [2, 3, 4]) a.otorgar(codigo, 1, u);
  check(igual(a.leer(codigo, 1, PIDE).moderadores, [2, 3, 4]), `${REGLAS.MAX_MODERADORES} moderadores: sí`);
  check(igual(a.otorgar(codigo, 1, 5), { ok: false, motivo: 'moderadores-llenos' }), 'uno más: moderadores-llenos');
  check(a.otorgar(codigo, 1, 3).ok, 'con la lista llena, nombrar otra vez a uno que ya está no es un error');
  a.quitar(codigo, 1, 3);
  check(a.otorgar(codigo, 1, 5).ok, 'al quitar uno, entra otro');
}
{
  const { a, codigo } = salaConOyentes();
  a.otorgar(codigo, 1, 2, { nombre: 'Sonia' });
  a.otorgar(codigo, 1, 3, { nombre: 'Beto' });
  check(igual(a.quitar(codigo, 4, 2), { ok: false, motivo: 'sin-permiso' }), 'un oyente no puede quitar: sin-permiso');
  check(igual(a.quitar(codigo, 3, 2), { ok: false, motivo: 'sin-permiso' }), 'un moderador no puede quitar a otro');
  check(igual(a.leer(codigo, 1, PIDE).moderadores, [2, 3]), 'y la lista sigue igual');
  const q = a.quitar(codigo, 1, 2);
  check(q.ok && igual(q.moderadores, [3]) && q.nombre === 'Sonia', 'el anfitrión quita, y vuelve el nombre');
  const otra = a.quitar(codigo, 1, 2);
  check(otra.ok && igual(otra.moderadores, [3]) && otra.nombre === null, 'quitárselo a quien no lo tiene no es un error');
}
{
  const { a, codigo, pasar } = salaConOyentes();
  a.otorgar(codigo, 1, 2, { nombre: 'Sonia' });
  pasar(REGLAS.OYENTE_MS);
  a.leer(codigo, 3, MOD);
  const l = a.leer(codigo, 1, PIDE);
  check(!l.oyentes.includes(2) && igual(l.moderadores, [2]), 'quien deja de escuchar sale de los oyentes pero conserva el rol');
  pasar(REGLAS.OYENTE_MS * 5);
  a.publicar(codigo, 1, SUENA);
  check(igual(a.leer(codigo, 1, PIDE).moderadores, [2]), 'aunque pase un buen rato');
  a.leer(codigo, 2, MOD);
  const v = a.leer(codigo, 1, PIDE);
  check(v.oyentes.includes(2) && igual(v.moderadores, [2]), 'al volver a unirse sigue siendo moderador');
  pasar(REGLAS.OYENTE_MS);
  a.leer(codigo, 1);
  check(a.quitar(codigo, 1, 2).ok && igual(a.leer(codigo, 1, PIDE).moderadores, []), 'y se le puede quitar estando ausente');
}
{
  const { a, codigo } = salaConOyentes();
  a.otorgar(codigo, 1, 2);
  a.terminar(codigo, 1);
  const l = a.leer(codigo, 2, MOD);
  check(l.status === 'ended' && igual(l.moderadores, []), 'al terminar, los moderadores se van con la radio');
  check(igual(a.otorgar(codigo, 1, 3), { ok: false, motivo: 'terminada', razon: 'anfitrion' }), 'nombrar en una radio terminada: terminada');
  check(igual(a.quitar(codigo, 1, 2), { ok: false, motivo: 'terminada', razon: 'anfitrion' }), 'quitar en una radio terminada: terminada');
}
{
  const { a, codigo, pasar } = salaConOyentes();
  a.otorgar(codigo, 1, 2);
  pasar(REGLAS.CIERRE_SIN_ANFITRION_MS);
  const l = a.leer(codigo, 2, MOD);
  check(l.status === 'ended' && l.motivo === 'sin-anfitrion' && igual(l.moderadores, []), 'al cerrarse sola (sin anfitrión), también');
}
{
  const { a, codigo } = salaConOyentes();
  a.otorgar(codigo, 1, 2);
  const nueva = a.crear(1, { capacidades: { ordenes: true } }).codigo;
  check(a.leer(codigo, 2).motivo === 'reemplazada' && igual(a.leer(codigo, 2, MOD).moderadores, []), 'si el anfitrión crea otra radio, la vieja se cierra sin moderadores');
  a.leer(nueva, 2, MOD);
  check(igual(a.leer(nueva, 1, PIDE).moderadores, []), 'y la nueva empieza sin ninguno');
  check(a.otorgar(nueva, 1, 2).ok, 'en la nueva hay que volver a nombrarlo');
}
{
  const { a } = mundo();
  check(igual(a.otorgar('ZZZZZZ', 1, 2), { ok: false, motivo: 'no-existe' }) && igual(a.quitar('ZZZZZZ', 1, 2), { ok: false, motivo: 'no-existe' }),
    'en una radio que no existe: no-existe');
  const sin = a.crear(1).codigo;
  check(igual(a.leer(sin, 2, MOD).capacidades, { ordenes: false }), 'un anfitrión que no declara nada (la app de iOS de hoy): no ejecuta órdenes');
  const con = a.crear(3, { capacidades: { ordenes: true } }).codigo;
  check(igual(a.leer(con, 2, MOD).capacidades, { ordenes: true }), 'uno que lo declara: sí');
  const raro = a.crear(4, { capacidades: { ordenes: 'true' } }).codigo;
  check(igual(a.leer(raro, 2, MOD).capacidades, { ordenes: false }), 'un "true" en texto no cuenta');
}

// ════ S3 (1.43.0): órdenes, confirmación, eventos, cursor, título, a pedido ════
let nCli = 0;
/** Una orden como la deja leerOrden. */
const ORD = (tipo, extra = {}) => ({ tipo, trackId: null, seqBase: null, idCliente: `cli${String(++nCli).padStart(4, '0')}`, ...extra });
/** Radio de 1 ("Ana", ejecuta órdenes) con 2, 3 y 4 escuchando, la pista 7 sonando (seq 1) y 2 ("Sonia") de moderadora. */
function salaModerada({ ordenes = true } = {}) {
  const m = mundo();
  const { codigo } = m.a.crear(1, { capacidades: { ordenes }, nombre: 'Ana' });
  for (const u of [2, 3, 4]) m.a.leer(codigo, u, MOD);
  m.a.publicar(codigo, 1, SUENA);
  m.a.otorgar(codigo, 1, 2, { nombre: 'Sonia' });
  return { ...m, codigo };
}
const ANF = { desde: 0 };

console.log('a pedido: sin pedirlo, lo de 1.42.0 (1.43.0)');
{
  const { a, codigo } = salaModerada();
  const CLAVES = ['ok', 'serverNow', 'codigo', 'status', 'motivo', 'estado', 'anfitrion', 'oyentes'];
  check(igual(Object.keys(a.leer(codigo, 5)), CLAVES), 'un oyente que no pide nada (la app de iOS): las claves de 1.42.0');
  check(igual(Object.keys(a.leer(codigo, 1)), CLAVES), 'el anfitrión sin pedir nada: las mismas');
  check(igual(Object.keys(a.publicar(codigo, 1, SUENA)), ['ok', 'serverNow', 'estado']), 'publicar sin confirmación: lo de 1.42.0');
  const m = a.leer(codigo, 3, MOD);
  check(['moderadores', 'capacidades', 'eventos', 'eventosHasta', 'eventosPerdidos'].every((k) => k in m) && !('ordenes' in m),
    'con ?cap=mod: lo nuevo, sin las órdenes (no es el anfitrión)');
  check('ordenes' in a.leer(codigo, 1, ANF) && 'eventos' in a.leer(codigo, 5, { desde: 0 }), 'con ?desde=: también; el anfitrión ve las órdenes');
  check('ordenes' in a.publicar(codigo, 1, SUENA, { ordenHasta: 0, aplicadas: [] }), 'publicar con confirmación devuelve las órdenes');
  a.terminar(codigo, 1);
  check(igual(Object.keys(a.leer(codigo, 5)), CLAVES), 'una radio terminada, sin pedir nada: lo de 1.42.0');
  const fin = a.leer(codigo, 1, ANF);
  check(igual([fin.moderadores, fin.eventos, fin.ordenes], [[], [], []]), 'terminada, a pedido: sin moderadores, eventos ni órdenes');
}

console.log('órdenes (1.43.0)');
{
  const { a, codigo } = salaModerada();
  const r1 = a.ordenar(codigo, 2, ORD('siguiente', { seqBase: 1 }));
  const r2 = a.ordenar(codigo, 2, ORD('a-continuacion', { trackId: 9 }), { titulo: 'Nueve' });
  check(r1.ok && r1.id === 1 && r1.repetida === false && r2.ok && r2.id === 2, 'un moderador que escucha ordena; ids crecientes');
  check(igual(a.leer(codigo, 1, ANF).ordenes, [
    { id: 1, tipo: 'siguiente', trackId: null, seqBase: 1, trackBase: 7, por: 2, titulo: null },
    { id: 2, tipo: 'a-continuacion', trackId: 9, seqBase: null, trackBase: 7, por: 2, titulo: 'Nueve' },
  ]), 'el anfitrión las ve en orden, con trackBase = la pista al llegar y sin el idCliente');
  check(!('ordenes' in a.leer(codigo, 3, MOD)), 'un oyente, aunque pida, no ve las órdenes');
}
{
  const { a, codigo } = salaModerada();
  const r = a.ordenar(codigo, 3, ORD('pausa'));
  check(igual(r, { ok: false, motivo: 'sin-permiso' }) && r.motivo !== 'no-es-tuya', 'un oyente sin el rol: sin-permiso (no no-es-tuya)');
  check(igual(a.ordenar(codigo, 1, ORD('pausa')), { ok: false, motivo: 'sin-permiso' }), 'el anfitrión no ordena (actúa en su equipo): sin-permiso');
  check(igual(a.ordenar(codigo, 99, ORD('pausa')), { ok: false, motivo: 'sin-permiso' }), 'alguien de afuera: sin-permiso');
  check(igual(a.leer(codigo, 1, ANF).ordenes, []), 'nada de eso quedó pendiente');
}
{
  const { a, codigo, pasar } = salaModerada();
  pasar(REGLAS.OYENTE_MS);
  a.leer(codigo, 3, MOD);
  check(igual(a.ordenar(codigo, 2, ORD('pausa')), { ok: false, motivo: 'no-escucha' }), 'un moderador que no escucha: no-escucha');
  check(igual(a.leer(codigo, 1, ANF).moderadores, [2]), 'y conserva el rol');
  a.leer(codigo, 2, MOD);
  check(a.ordenar(codigo, 2, ORD('pausa')).ok, 'al volver a escuchar, ordena');
}
{
  const { a, codigo } = salaModerada({ ordenes: false });
  check(igual(a.ordenar(codigo, 2, ORD('pausa')), { ok: false, motivo: 'sin-soporte' }), 'un anfitrión que no ejecuta órdenes (la app de iOS): sin-soporte');
}
{
  const { a, codigo } = salaModerada();
  a.publicar(codigo, 1, { ...SUENA, trackId: 8 });   // seq 2: empieza la 8
  check(igual(a.ordenar(codigo, 2, ORD('siguiente', { seqBase: 1 })), { ok: false, motivo: 'obsoleta' }),
    'siguiente con el seq de la canción anterior: obsoleta (si no, doble salto)');
  a.publicar(codigo, 1, { ...SUENA, trackId: 8, playing: false });   // seq 3: la misma, en pausa
  check(a.ordenar(codigo, 2, ORD('siguiente', { seqBase: 2 })).ok, 'con un seq viejo pero de la MISMA canción: sí');
  check(igual(a.ordenar(codigo, 2, ORD('siguiente', { seqBase: 99 })), { ok: false, motivo: 'obsoleta' }), 'con un seq que esta radio no publicó: obsoleta');
  check(a.ordenar(codigo, 2, ORD('ahora', { trackId: 9 })).ok && a.ordenar(codigo, 2, ORD('pausa')).ok, 'ahora y pausa no miran el seq: son absolutas');
}
{
  const m = mundo();
  const { codigo } = m.a.crear(1, { capacidades: { ordenes: true } });
  m.a.leer(codigo, 2, MOD);
  m.a.otorgar(codigo, 1, 2);
  check(igual(m.a.ordenar(codigo, 2, ORD('siguiente', { seqBase: 0 })), { ok: false, motivo: 'obsoleta' }), 'siguiente sin nada publicado todavía: obsoleta');
}
{
  const { a, codigo } = salaModerada();
  a.otorgar(codigo, 1, 3, { nombre: 'Beto' });
  for (let i = 0; i < REGLAS.MAX_ORDENES; i++) a.ordenar(codigo, 2, ORD('pausa'));
  check(a.leer(codigo, 1, ANF).ordenes.length === REGLAS.MAX_ORDENES, `${REGLAS.MAX_ORDENES} pendientes: sí`);
  check(igual(a.ordenar(codigo, 3, ORD('pausa')), { ok: false, motivo: 'ordenes-llenas' }), 'una más (de otro moderador): ordenes-llenas');
  a.quitar(codigo, 1, 2);
  check(a.leer(codigo, 1, ANF).ordenes.length === 0, 'al quitarle el rol, sus órdenes sin confirmar se borran: no se entregan nunca');
  check(a.ordenar(codigo, 3, ORD('pausa')).ok, 'y ya no ocupan lugar: el otro moderador ordena');
}
{
  const { a, codigo, pasar } = salaModerada();
  for (let i = 0; i < REGLAS.MAX_ORDENES_PERSONA; i++) a.ordenar(codigo, 2, ORD('pausa'));
  a.publicar(codigo, 1, SUENA, { ordenHasta: 99, aplicadas: [] });   // confirma todo: la lista queda vacía
  const r = a.ordenar(codigo, 2, ORD('pausa'));
  check(r.ok === false && r.motivo === 'frecuencia' && r.esperaMs > 0,
    `la orden ${REGLAS.MAX_ORDENES_PERSONA + 1} de la misma persona en la ventana: frecuencia, con su espera (429)`);
  pasar(REGLAS.VENTANA_ORDENES_MS);
  a.leer(codigo, 2, MOD);
  a.publicar(codigo, 1, SUENA);
  check(a.ordenar(codigo, 2, ORD('pausa')).ok, 'al vencer la ventana, vuelve a ordenar');
}
{
  const { a, codigo, pasar } = salaModerada();
  a.ordenar(codigo, 2, ORD('pausa'));
  pasar(REGLAS.ORDEN_TTL_MS - 1);
  check(a.leer(codigo, 1, ANF).ordenes.length === 1, 'un milisegundo antes del TTL: sigue pendiente');
  pasar(1);
  check(igual(a.leer(codigo, 1, ANF).ordenes, []), 'a los 30 s sin confirmar: se descarta');
}
{
  const { a, codigo } = salaModerada();
  a.terminar(codigo, 1);
  check(igual(a.ordenar(codigo, 2, ORD('pausa')), { ok: false, motivo: 'terminada', razon: 'anfitrion' }), 'en una radio terminada: terminada');
  check(igual(a.ordenar('ZZZZZZ', 2, ORD('pausa')), { ok: false, motivo: 'no-existe' }), 'en una que no existe: no-existe');
}

console.log('órdenes repetidas (1.43.0)');
{
  const { a, codigo, pasar } = salaModerada();
  a.otorgar(codigo, 1, 3, { nombre: 'Beto' });
  const X = ORD('pausa');
  const p = a.ordenar(codigo, 2, X);
  const q = a.ordenar(codigo, 2, { ...X });
  check(p.ok && q.ok && q.id === p.id && q.repetida === true && a.leer(codigo, 1, ANF).ordenes.length === 1,
    'el mismo moderador con el mismo idCliente: la misma orden, repetida, sin otra pendiente');
  const otro = a.ordenar(codigo, 3, { ...X });
  check(otro.ok && otro.id !== p.id && otro.repetida === false, 'otra persona con el mismo idCliente: otra orden');
  a.publicar(codigo, 1, SUENA, { ordenHasta: otro.id, aplicadas: [p.id, otro.id] });
  const hasta = a.leer(codigo, 1, ANF).eventosHasta;
  const tras = a.ordenar(codigo, 2, { ...X });
  const h = a.leer(codigo, 1, ANF);
  check(tras.ok && tras.id === p.id && tras.repetida === true && h.ordenes.length === 0 && h.eventosHasta === hasta,
    'un reintento DESPUÉS de confirmada y borrada: el mismo id, sin otra orden ni otro evento');
  pasar(REGLAS.ORDEN_TTL_MS);
  a.leer(codigo, 2, MOD);
  a.publicar(codigo, 1, SUENA);
  const nueva = a.ordenar(codigo, 2, { ...X });
  check(nueva.ok && nueva.id > otro.id && nueva.repetida === false, 'pasado el TTL, el mismo idCliente es una orden nueva');
}
{
  const { a, codigo } = salaModerada();
  const X = ORD('pausa');
  a.ordenar(codigo, 2, X);
  a.quitar(codigo, 1, 2);
  check(igual(a.ordenar(codigo, 2, { ...X }), { ok: false, motivo: 'sin-permiso' }), 'el reintento de quien perdió el rol: sin-permiso, no repetida');
}

console.log('confirmación y eventos (1.43.0)');
{
  const { a, codigo } = salaModerada();
  const base = a.leer(codigo, 1, ANF).eventosHasta;
  a.ordenar(codigo, 2, ORD('siguiente', { seqBase: 1 }));
  const ya = a.ordenar(codigo, 2, ORD('ahora', { trackId: 9 }), { titulo: 'Nueve  ​ de\nprueba ' });
  const sigue = a.ordenar(codigo, 2, ORD('a-continuacion', { trackId: 10 }), { titulo: 'Diez' });
  check(a.leer(codigo, 1, ANF).ordenes[1].titulo === 'Nueve de prueba', 'el título llega limpio (sin invisibles ni saltos, espacios juntados)');
  const r = a.publicar(codigo, 1, SUENA, { ordenHasta: ya.id, aplicadas: [ya.id, sigue.id] });
  check(igual(r.ordenes.map((o) => o.id), [sigue.id]), 'ordenHasta saca lo confirmado; lo de después sigue pendiente y vuelve en la respuesta');
  const ev = a.leer(codigo, 3, { ...MOD, desde: base }).eventos;
  check(ev.length === 1 && igual({ ...ev[0], id: 0, en: 0 },
    { id: 0, tipo: 'ahora', por: 2, porNombre: 'Sonia', sobre: null, sobreNombre: null, trackId: 9, titulo: 'Nueve de prueba', en: 0 }),
    'solo la aplicada queda como evento (quién, su nombre, la pista y el título); la descartada no deja rastro');
  check(!ev.some((e) => e.trackId === 10), 'una "aplicada" fuera de ordenHasta no genera evento');
  const r2 = a.publicar(codigo, 1, SUENA, { ordenHasta: 999, aplicadas: [] });
  check(igual(r2.ordenes, []) && a.ordenar(codigo, 2, ORD('pausa')).id === sigue.id + 1, 'un ordenHasta pasado del último se recorta, y los ids siguen');
}
{
  const { a, codigo } = salaModerada();
  const h0 = a.leer(codigo, 1, ANF);
  check(h0.eventos.length === 1 && igual({ ...h0.eventos[0], id: 0, en: 0 },
    { id: 0, tipo: 'moderador', por: 1, porNombre: 'Ana', sobre: 2, sobreNombre: 'Sonia', trackId: null, titulo: null, en: 0 }),
    'nombrar moderador deja un evento, con el nombre del anfitrión y el guardado en S2');
  a.otorgar(codigo, 1, 2, { nombre: 'Sonia' });
  check(a.leer(codigo, 1, ANF).eventosHasta === h0.eventosHasta, 'nombrarlo otra vez no deja otro');
  a.quitar(codigo, 1, 2);
  a.quitar(codigo, 1, 2);
  const e1 = a.leer(codigo, 1, { desde: h0.eventosHasta }).eventos;
  check(e1.length === 1 && e1[0].tipo === 'sin-moderador' && e1[0].sobre === 2 && e1[0].sobreNombre === 'Sonia' && e1[0].porNombre === 'Ana',
    'quitarlo deja uno; quitárselo a quien ya no lo tiene, no');
  check(igual(a.ordenar(codigo, 2, ORD('pausa')), { ok: false, motivo: 'sin-permiso' }), 'el rol quitado ya no ordena');
}

console.log('el cursor de los eventos (1.43.0)');
{
  const { a, codigo } = salaModerada();   // evento 1: otorgar a 2
  a.otorgar(codigo, 1, 3, { nombre: 'Beto' });   // evento 2
  const entra = a.leer(codigo, 4, MOD);
  check(igual(entra.eventos, []) && entra.eventosHasta === 2 && entra.eventosPerdidos === false, 'al entrar (sin desde): ningún evento viejo, solo dónde va la cuenta');
  check(igual(a.leer(codigo, 4, { ...MOD, desde: entra.eventosHasta }).eventos, []), 'con su cursor: nada nuevo');
  a.quitar(codigo, 1, 3);
  const nuevos = a.leer(codigo, 4, { ...MOD, desde: entra.eventosHasta });
  check(nuevos.eventos.length === 1 && nuevos.eventos[0].tipo === 'sin-moderador' && nuevos.eventosHasta === 3, 'después, solo lo nuevo');
  const otro = a.leer(codigo, 4, { ...MOD, desde: 50 });
  check(igual(otro.eventos, []) && otro.eventosHasta === 3 && !otro.eventosPerdidos, 'un cursor mayor que el último (de otra radio con el mismo código): como recién entrado');
  check(!('eventos' in a.leer(codigo, 5)), 'quien no pide (la app de iOS) no recibe eventos');
}
{
  const { a, codigo } = salaModerada();   // 1 evento
  for (let i = 0; i < 12; i++) { a.otorgar(codigo, 1, 3); a.quitar(codigo, 1, 3); }   // 24 más: 25
  const todo = a.leer(codigo, 4, { ...MOD, desde: 0 });
  check(todo.eventos.length === REGLAS.MAX_EVENTOS && todo.eventos[0].id === 6 && todo.eventosHasta === 25 && todo.eventosPerdidos === true,
    `con más de ${REGLAS.MAX_EVENTOS} sin leer: los últimos ${REGLAS.MAX_EVENTOS} y eventosPerdidos`);
  check(a.leer(codigo, 4, { ...MOD, desde: 5 }).eventosPerdidos === false, 'desde justo antes del más viejo guardado: nada perdido');
}

console.log('el título de los eventos (1.43.0)');
{
  check(REGLAS.TITULO_MAX === 100, 'el tope: 100 caracteres');
  check(tituloPublico('x'.repeat(150)).length === 100, 'uno de 150 se corta a 100');
  const t = tituloPublico('🎧'.repeat(150));
  check([...t].length === 100 && t === '🎧'.repeat(100), 'por caracteres: 100 emoji enteros, ninguno partido');
  check(tituloPublico('a\u0000b​c‮d\n\te   f') === 'a b c d e f', 'controles, ancho cero, marcas de dirección y saltos: un espacio');
  check(tituloPublico(42) === '' && tituloPublico(null) === '', 'lo que no es texto: vacío');
  const { a, codigo } = salaModerada();
  a.ordenar(codigo, 2, ORD('ahora', { trackId: 9 }), { titulo: 'y'.repeat(300) });
  a.ordenar(codigo, 2, ORD('ahora', { trackId: 9 }), { titulo: '​ \n' });
  const o = a.leer(codigo, 1, ANF).ordenes;
  check(o[0].titulo.length === 100 && o[1].titulo === null, 'en una orden: cortado, y un título que queda vacío va como null');
}

console.log('publicar sin confirmación: como en 1.42.0 (1.43.0)');
{
  const L = (b) => leerPublicacion(b);
  const viejos = [
    { trackId: 7, positionMs: 1500.4, playing: true }, { trackId: 7, positionMs: 0, playing: false, nextTrackId: 9 }, { enPausaPorVideo: true },
    null, [], 'x', { positionMs: 0, playing: true }, { trackId: '7', positionMs: 0, playing: true }, { trackId: 7, playing: true },
    { trackId: 7, positionMs: 0 }, { trackId: 7, positionMs: 0, playing: true, nextTrackId: 'x' }, { trackId: 7, positionMs: 0, playing: true, enPausaPorVideo: 'si' },
  ];
  check(viejos.every((b) => { const r = L(b); return igual(Object.keys(r), r.ok ? ['ok', 'pedido'] : ['ok', 'error']); }),
    'sin ordenHasta ni aplicadas: las mismas claves de siempre, sin confirmacion');
  check(viejos.every((b) => (b && typeof b === 'object' && !Array.isArray(b) ? igual(L({ ...b, ordenHasta: null, aplicadas: null }), L(b)) : true)),
    'con los dos en null: igual que sin ellos');
  check(L({ trackId: 'x', positionMs: 0, playing: true, ordenHasta: -1 }).error === 'trackId tiene que ser un entero.',
    'con un error viejo y uno nuevo, sale el viejo (mismo orden de validación)');
  const c = L({ trackId: 7, positionMs: 0, playing: true, ordenHasta: 4, aplicadas: [4, 3, 4] });
  check(igual(c.pedido, L({ trackId: 7, positionMs: 0, playing: true }).pedido) && igual(c.confirmacion, { ordenHasta: 4, aplicadas: [4, 3] }),
    'con confirmación: el mismo pedido, y la confirmación aparte (sin repetidas)');
  check(igual(L({ trackId: 7, positionMs: 0, playing: true, ordenHasta: 0 }).confirmacion, { ordenHasta: 0, aplicadas: [] }), 'ordenHasta solo: aplicadas vacía');
  check([-1, '3', 1.5, Infinity].every((h) => L({ trackId: 7, positionMs: 0, playing: true, ordenHasta: h }).error === 'ordenHasta tiene que ser un entero.'),
    'ordenHasta que no es un entero ≥ 0: no');
  check(!L({ trackId: 7, positionMs: 0, playing: true, aplicadas: [1] }).ok, 'aplicadas sin ordenHasta: no');
  check([5, 'x', [0], [1.5], ['1'], Array.from({ length: 11 }, (_, i) => i + 1)].every((ap) => !L({ trackId: 7, positionMs: 0, playing: true, ordenHasta: 1, aplicadas: ap }).ok),
    'aplicadas que no es una lista de hasta 10 ids: no');
}

console.log(`\n${pass} de ${pass + fail} en verde`);
process.exit(fail ? 1 : 0);
