// MODO DJ · curvas de mezcla. PURO: sin AudioContext ni DOM (lo prueba dj-unit.mjs con node).
// Todavía no lo usa nadie en la página: el crossfader y el filtro llegan en el sub-paso c.

const MEDIO_PI = Math.PI / 2;

// Recorta a [0, 1]. Lo que no es un número finito cae al CENTRO (0,5): un control que manda basura
// no debe dejar un deck mudo ni el filtro cerrado.
function recortar(x) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return 0.5;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// CROSSFADER DE IGUAL POTENCIA. x = 0 → todo A; x = 1 → todo B.
//   a = cos(x·π/2), b = sin(x·π/2)  ⇒  a² + b² = 1 en todo el recorrido.
// Con dos pistas no correlacionadas la potencia suma a² + b², así que el volumen percibido no se hunde
// en el centro (con un fundido lineal a = 1 − x, b = x, en el centro queda a² + b² = ½: −3 dB).
// En el centro las dos valen √½ ≈ 0,7071 (−3 dB cada una).
// Los extremos se devuelven EXACTOS (cos(π/2) en coma flotante da 6e-17, no 0): con el crossfader a
// un lado, el otro deck tiene que quedar en silencio de verdad.
export function potenciaIgual(x) {
  const v = recortar(x);
  if (v === 0) return { a: 1, b: 0 };
  if (v === 1) return { a: 0, b: 1 };
  return { a: Math.cos(v * MEDIO_PI), b: Math.sin(v * MEDIO_PI) };
}

// FILTRO BIPOLAR (una sola perilla, como el FILTER de una mesa DJ). v = 0,5 es el centro.
//   · |v − 0,5| ≤ ZONA_MUERTA → 'plano': sin filtro (el motor lo puentea). La zona muerta existe
//     porque una perilla física o MIDI rara vez vuelve EXACTA al centro, y un filtro casi abierto
//     igual colorea un poco el sonido.
//   · Por debajo → paso bajo ('lowpass', el nombre de BiquadFilterNode): al girar a la izquierda el
//     corte BAJA de 20 000 Hz (justo al salir de la zona muerta: inaudible) a 60 Hz (v = 0, sólo
//     queda el bombo).
//   · Por encima → paso alto ('highpass'): el corte SUBE de 20 Hz (inaudible) a 12 000 Hz (v = 1,
//     sólo quedan los platillos).
// El recorrido es EXPONENCIAL (f = desde · (hasta/desde)^d, con d de 0 a 1 en cada mitad): el oído
// oye octavas, así que cada tramo igual de perilla mueve el corte las mismas octavas. Con un
// recorrido lineal casi toda la perilla quedaría en los agudos, donde casi no se nota.
// Los extremos de cada lado arrancan donde el filtro es transparente, así que no hay salto al
// cruzar el borde de la zona muerta.
export const ZONA_MUERTA = 0.02;
export const PASO_BAJO = Object.freeze({ desde: 20000, hasta: 60 });
export const PASO_ALTO = Object.freeze({ desde: 20, hasta: 12000 });

const exponencial = ({ desde, hasta }, d) => desde * Math.pow(hasta / desde, d);

// El borde de la zona muerta lleva una tolerancia de 1e-12: 0,5 − 0,02 da −0,020000000000000018 en coma
// flotante, y sin ella el borde exacto (0,48) caería fuera.
const TOL = 1e-12;

export function filtroBipolar(v) {
  const x = recortar(v);
  const dist = x - 0.5;
  if (Math.abs(dist) <= ZONA_MUERTA + TOL) return { tipo: 'plano', frecuencia: null };
  const d = Math.min(1, (Math.abs(dist) - ZONA_MUERTA) / (0.5 - ZONA_MUERTA));   // ~0 en el borde, 1 en el extremo
  // En los extremos, el valor exacto de la tabla (sin el error de Math.pow).
  if (dist < 0) return { tipo: 'lowpass', frecuencia: d === 1 ? PASO_BAJO.hasta : exponencial(PASO_BAJO, d) };
  return { tipo: 'highpass', frecuencia: d === 1 ? PASO_ALTO.hasta : exponencial(PASO_ALTO, d) };
}
