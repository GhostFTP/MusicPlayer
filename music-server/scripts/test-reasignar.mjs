// Prueba de EMPAREJAR HUÉRFANAS (scanner/reasignar.js, 1.25.0) y de la lectura de la huella
// (scanner/huella.js). Puro: sin base y sin archivos.
//
//   npm run test:reasignar
//
// Sale con código 1 si algo falla.
import { emparejar } from '../src/scanner/reasignar.js';
import { largoId3, md5DeCabecera } from '../src/scanner/huella.js';

let pass = 0;
let fail = 0;
function check(ok, label, detalle = '') {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FALLA ${label}${detalle ? `  → ${detalle}` : ''}`); }
}
const pares = (h, v) => Object.fromEntries(emparejar(h, v).pares);
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const fila = (id, o = {}) => ({
  id, audio_md5: null, duration: 200.5, sample_rate: 44100, bits_per_sample: 16,
  title: `T${id}`, album: 'Alb', track_number: id, ...o,
});

console.log('por md5');
check(igual(pares([fila(1, { audio_md5: 'aa' })], [fila(9, { audio_md5: 'aa' })]), { 1: 9 }), 'md5 único de los dos lados: empareja');
{
  const e = emparejar([fila(1, { audio_md5: 'aa' })], [fila(9, { audio_md5: 'aa', title: 'Otro título' })]);
  check(igual(Object.fromEntries(e.pares), { 1: 9 }) && e.llave.get(1) === 'md5', 'retag (otro título) con el mismo md5: empareja por md5');
}
check(igual(pares([fila(1, { audio_md5: 'aa' })], [fila(9, { audio_md5: 'aa' }), fila(10, { audio_md5: 'aa' })]), {}),
  'mismo md5 en un álbum y en una recopilación (dos vivas): ambiguo, no empareja');
check(igual(pares([fila(1, { audio_md5: 'aa' }), fila(2, { audio_md5: 'aa' })], [fila(9, { audio_md5: 'aa' })]), {}),
  'dos huérfanas con el mismo md5: ambiguo, no empareja');
check(igual(pares([fila(1, { audio_md5: 'aa' })], [fila(9, { audio_md5: 'bb' })]), {}), 'md5 distinto: no empareja');
check(igual(pares([fila(1, { audio_md5: 'aa' })], [fila(9, { audio_md5: null })]), {}),
  'la huérfana tiene md5 y la viva no: no se usa el respaldo (el respaldo es solo para huérfanas sin md5)');

console.log('\nrespaldo (huérfanas sin md5)');
check(igual(pares([fila(1)], [fila(9, { title: 'T1', track_number: 7 })]), { 1: 9 }), 'misma duración + formato + título: empareja');
check(igual(pares([fila(1, { title: '  t1 ' })], [fila(9, { title: 'T1', track_number: 7 })]), { 1: 9 }), 'el título se compara sin mayúsculas ni espacios de más');
check(igual(pares([fila(1, { title: 'Viejo' })], [fila(9, { title: 'Nuevo', track_number: 1 })]), { 1: 9 }),
  'otro título pero mismo álbum y número de pista: empareja');
check(igual(pares([fila(1)], [fila(9, { title: 'Otra canción', album: 'Otro', track_number: 3 })]), {}),
  'dos canciones distintas con la misma duración y otro título: NO empareja');
check(igual(pares([fila(1)], [fila(9, { title: 'T1', duration: 200.6 })]), {}), 'duración distinta: no empareja');
check(igual(pares([fila(1)], [fila(9, { title: 'T1', sample_rate: 48000 })]), {}), 'frecuencia distinta: no empareja');
check(igual(pares([fila(1)], [fila(9, { title: 'T1', bits_per_sample: 24 })]), {}), 'bits distintos: no empareja');
check(igual(pares([fila(1, { duration: null })], [fila(9, { title: 'T1', duration: null })]), {}), 'sin duración: no hay respaldo');
check(igual(pares([fila(1)], [fila(9, { title: 'T1' }), fila(10, { title: 'T1' })]), {}), 'dos vivas candidatas: ambiguo, no empareja');
check(igual(pares([fila(1), fila(2, { title: 'T1', track_number: 1 })], [fila(9, { title: 'T1', track_number: 1 })]), {}),
  'dos huérfanas que eligen la misma viva: ambiguo, no empareja');
check(igual(pares([fila(1, { title: '', album: 'Alb', track_number: null })], [fila(9, { title: '', track_number: null })]), {}),
  'sin título y sin número de pista: no empareja');

console.log('\nlas dos llaves juntas');
{
  const e = emparejar(
    [fila(1, { audio_md5: 'aa' }), fila(2)],
    [fila(9, { audio_md5: 'aa', title: 'T2', track_number: 2 }), fila(10, { audio_md5: 'cc', title: 'T2', track_number: 2 })],
  );
  check(igual(Object.fromEntries(e.pares), { 1: 9, 2: 10 }), 'la viva que tomó el md5 no vuelve a contar para el respaldo', JSON.stringify(Object.fromEntries(e.pares)));
  check(e.llave.get(1) === 'md5' && e.llave.get(2) === 'respaldo', 'y cada pareja dice por qué llave');
}
check(igual(pares([], [fila(9)]), {}), 'sin huérfanas: nada');
check(igual(pares([fila(1)], []), {}), 'sin vivas: nada');

console.log('\nla huella (cabecera FLAC)');
const streaminfo = (md5) => {
  const b = Buffer.alloc(64);
  b.write('fLaC', 0, 'latin1');
  b[4] = 0x80; // último bloque + tipo 0 (STREAMINFO)
  Buffer.from(md5, 'hex').copy(b, 26);
  return b;
};
check(md5DeCabecera(streaminfo('4c0c7e808e13300a43183f63f1fde0a0')) === '4c0c7e808e13300a43183f63f1fde0a0', 'lee el md5 de STREAMINFO');
check(md5DeCabecera(streaminfo('00000000000000000000000000000000')) === null, 'md5 en ceros: sin huella');
check(md5DeCabecera(Buffer.from('ID3 no es flac')) === null, 'no es FLAC: sin huella');
{
  const b = streaminfo('aa'.repeat(16));
  b[4] = 0x04; // primer bloque que NO es STREAMINFO
  check(md5DeCabecera(b) === null, 'primer bloque que no es STREAMINFO: sin huella');
}
check(md5DeCabecera(Buffer.alloc(10)) === null, 'cabecera corta: sin huella');
{
  const id3 = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0x01, 0x00]); // 128 bytes de etiqueta
  check(largoId3(id3) === 10 + 128, 'tamaño de una etiqueta ID3v2 (sincrosafe)');
  check(largoId3(Buffer.from('fLaC0000000')) === 0, 'sin ID3: 0');
}

console.log(`\n${pass} ok · ${fail} fallas`);
if (fail) process.exit(1);
