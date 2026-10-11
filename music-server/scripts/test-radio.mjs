// Prueba de las REGLAS y del ALMACÉN del modo radio (src/radio/reglas.js y almacen.js,
// 1.29.0). Puro: sin base, sin servidor y con el RELOJ INYECTADO, así la expiración se prueba
// sin esperar minutos.
//
//   npm run test:radio
//
// Sale con código 1 si algo falla.
import { crearAlmacen } from '../src/radio/almacen.js';
import {
  ALFABETO, REGLAS, acotarPosicion, contar, leerCodigo, leerPublicacion, nombrePublico, nuevoCodigo, vidaDe,
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

console.log(`\n${pass} de ${pass + fail} en verde`);
process.exit(fail ? 1 : 0);
