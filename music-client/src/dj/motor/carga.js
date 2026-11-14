// MODO DJ · bajar una pista entera y decodificarla a un AudioBuffer. Sin React. Lo importa dj-unit.mjs
// con node: nada del navegador se toca al importar (fetch, performance y console se usan al llamar).
//
// NUNCA LANZA. Toda función devuelve { ok: true, ... } o { ok: false, error: { tipo, mensaje, status? } },
// con `mensaje` listo para mostrar en pantalla. Tipos de error:
//   'sin-duracion' · 'larga'      → antesDeBajar: no se baja nada
//   'sesion'                      → 401 (o no hay token)
//   'html'                        → 200 con una página (Cloudflare Access con la sesión vencida contesta
//                                   200 con su login en HTML, no 401)
//   'formato'                     → 200 con otra cosa que no es audio/*
//   'no-existe' · 'http'          → 404 · cualquier otro código
//   'red' · 'decodificar' · 'cancelada'
//
// AUTENTICACIÓN: cabecera Authorization: Bearer, NUNCA ?token= en la URL (la URL queda en el historial
// del proxy y en los logs). El token lo pasa quien llama (DjPage lo saca de useAuth()).
// Un 401 NO dispara la reautenticación: el handler que la hace (setUnauthorizedHandler en
// api/client.js, que registra AuthContext) es privado del módulo y sólo lo llama request(), que
// tampoco se exporta. Por eso acá sólo se avisa («recarga la página»).

export const MAX_SEG = 900;          // 15 min: más que eso no se baja (una pista de 45 min en 96 kHz son
                                     // cientos de MB de descarga y de memoria decodificada)
export const HZ_AVISO = 88200;       // 88,2 kHz o más: se avisa antes de bajar (pesa y tarda más)
// MEMORIA. decodeAudioData remuestrea a la tasa del CONTEXTO, así que lo que ocupa un deck depende de
// esa tasa, no de la del archivo: duración × tasa del contexto × 2 canales × 4 B (Float32). Se cuentan
// 2 canales siempre (la base no guarda canales; casi todo es estéreo). Más de MEMORIA_AVISO_B = aviso
// con «Cargar igual»; NO hay rechazo por memoria (el único tope duro sigue siendo MAX_SEG).
// El contexto del Modo DJ va a 44 100 Hz (TASA_DJ en motor.js): con el tope de 900 s son ≈ 318 MB por
// deck, así que con esa tasa el aviso NO SALE NUNCA. Se queda como protección por si la tasa cambia
// (a 96 kHz, 900 s serían 691 MB y el aviso saldría desde los 521 s).
// Sin contexto todavía, se supone el peor caso TASA_PEOR_CASO. MB = 1 000 000 B.
export const MEMORIA_AVISO_B = 400_000_000;
export const TASA_PEOR_CASO = 96000;
const CANALES_SUPUESTOS = 2;
export const mbTexto = (bytes) => `${Math.round(bytes / 1_000_000)} MB`;

const fallo = (tipo, mensaje, status) => ({ ok: false, error: status === undefined ? { tipo, mensaje } : { tipo, mensaje, status } });
const CANCELADA = Object.freeze({ ok: false, error: Object.freeze({ tipo: 'cancelada', mensaje: 'Se canceló la carga.' }) });

function mmss(seg) {
  const s = Math.round(seg);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
const khz = (hz) => String(Math.round(hz / 100) / 10).replace('.', ',');

// ¿Se puede bajar? Sólo con los datos de /api/tracks (duration, sample_rate) y la tasa REAL del
// contexto (`tasa`, la sampleRate del AudioContext; sin ella, TASA_PEOR_CASO), sin pedir nada.
// → { ok: true, aviso: string|null, avisos: string[], memoriaEstimadaBytes, tasaUsada, tasaEsPeorCaso }
//   · { ok: false, error }. `aviso` junta los avisos (96 kHz, memoria) en un texto. Sin duración
// conocida NO se baja: el límite existe para no bajar a ciegas un archivo enorme. Exactamente 900 s
// se acepta.
export function antesDeBajar(pista, { tasa } = {}) {
  const dur = pista?.duration == null ? NaN : Number(pista.duration);
  if (!Number.isFinite(dur) || dur <= 0) {
    return fallo('sin-duracion', 'No se conoce la duración de esta pista, así que el Modo DJ no la carga.');
  }
  if (dur > MAX_SEG) {
    return fallo('larga', `Esta pista dura ${mmss(dur)}. El Modo DJ carga pistas de hasta 15 minutos: no se bajó nada.`);
  }
  const tasaReal = Number.isFinite(tasa) && tasa > 0;
  const tasaUsada = tasaReal ? tasa : TASA_PEOR_CASO;
  const memoriaEstimadaBytes = Math.round(dur * tasaUsada * CANALES_SUPUESTOS * 4);
  const avisos = [];
  const hz = Number(pista.sample_rate);
  if (Number.isFinite(hz) && hz >= HZ_AVISO) {
    avisos.push(`Esta pista es de ${khz(hz)} kHz: el archivo pesa más y tarda más en bajarse y decodificarse.`);
  }
  if (memoriaEstimadaBytes > MEMORIA_AVISO_B) {
    avisos.push(`Ocupará ≈ ${mbTexto(memoriaEstimadaBytes)} en memoria (${mmss(dur)} a ${khz(tasaUsada)} kHz${tasaReal ? '' : ', el peor caso'}, 2 canales).`);
  }
  return { ok: true, aviso: avisos.length ? avisos.join(' ') : null, avisos, memoriaEstimadaBytes, tasaUsada, tasaEsPeorCaso: !tasaReal };
}

// ¿La respuesta es audio? Puro: recibe el código y el Content-Type. Sólo 200 (no se pide Range).
export function clasificarRespuesta({ status, contentType } = {}) {
  const ct = String(contentType ?? '').trim().toLowerCase();
  if (status === 200) {
    if (ct.startsWith('audio/')) return { ok: true };
    if (ct.startsWith('text/html')) {
      return fallo('html', 'El servidor devolvió una página en vez del audio (puede que haya vencido la sesión de Cloudflare Access). Recarga la página y vuelve a intentarlo.', 200);
    }
    return fallo('formato', `El servidor no devolvió audio (${ct || 'sin tipo'}).`, 200);
  }
  if (status === 401) return fallo('sesion', 'Tu sesión venció. Recarga la página para volver a entrar y cargar pistas.', 401);
  if (status === 404) return fallo('no-existe', 'El archivo de esta pista no está en el servidor.', 404);
  return fallo('http', `El servidor respondió ${status} al pedir el audio.`, status);
}

// Lee el cuerpo entero avisando el progreso. `total` es null si no vino Content-Length.
//   · CON Content-Length: se reserva UN Uint8Array de ese tamaño y cada trozo se copia directo a su
//     lugar. Así nunca hay dos copias del archivo en memoria (antes: lista de trozos + la copia final).
//   · SIN Content-Length: lista de trozos y una copia al final (no hay otra forma de saber el tamaño).
//   · Si el Content-Length MIENTE (no debería: /stream no comprime y manda el tamaño del archivo):
//     con MENOS bytes se devuelve una copia recortada; con MÁS, lo que no cupo va a una lista y se
//     junta al final. En los dos casos `bytes` es lo recibido de verdad.
async function leerCuerpo(res, onProgreso) {
  const total = Number(res.headers.get('content-length')) || null;
  if (!res.body?.getReader) {
    const ab = await res.arrayBuffer();
    onProgreso?.({ recibidos: ab.byteLength, total });
    return ab;
  }
  const lector = res.body.getReader();
  let recibidos = 0;
  if (total) {
    const destino = new Uint8Array(total);
    let sobra = null;                     // trozos que ya no cupieron (Content-Length menor que el cuerpo)
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      if (!sobra && recibidos + value.byteLength <= total) destino.set(value, recibidos);
      else (sobra ??= []).push(value);
      recibidos += value.byteLength;
      onProgreso?.({ recibidos, total });
    }
    if (!sobra) return recibidos === total ? destino.buffer : destino.buffer.slice(0, recibidos);
    const todo = new Uint8Array(recibidos);
    let pos = recibidos - sobra.reduce((s, t) => s + t.byteLength, 0);
    todo.set(destino.subarray(0, pos), 0);
    for (const t of sobra) { todo.set(t, pos); pos += t.byteLength; }
    return todo.buffer;
  }
  const trozos = [];
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    trozos.push(value);
    recibidos += value.byteLength;
    onProgreso?.({ recibidos, total });
  }
  const todo = new Uint8Array(recibidos);
  let pos = 0;
  for (const t of trozos) { todo.set(t, pos); pos += t.byteLength; }
  return todo.buffer;
}

// Baja la pista y la decodifica con `contexto` (el AudioContext del motor: decodeAudioData remuestrea
// a SU sampleRate, así que el buffer queda a la tasa del contexto, no a la del archivo).
// → { ok: true, buffer, registro } · { ok: false, error }.
// `registro` (también va a console.info): bytes, ms de bajada, ms de decodificación, duración,
// sampleRate del buffer, canales y memoria estimada = muestras × canales × 4 B (Float32).
export async function cargarPista(pista, { contexto, token, signal, onProgreso } = {}) {
  const pre = antesDeBajar(pista, { tasa: contexto?.sampleRate });   // sólo importa el tope duro; los avisos ya los vio la página
  if (!pre.ok) return pre;
  if (!token) return fallo('sesion', 'No hay sesión. Recarga la página para volver a entrar.');
  if (signal?.aborted) return CANCELADA;

  const t0 = performance.now();
  let res;
  try {
    res = await fetch(`/stream/${encodeURIComponent(pista.id)}`, { headers: { Authorization: `Bearer ${token}` }, signal });
  } catch {
    return signal?.aborted ? CANCELADA : fallo('red', 'No se pudo conectar con el servidor para bajar la pista.');
  }
  const clase = clasificarRespuesta({ status: res.status, contentType: res.headers.get('content-type') });
  if (!clase.ok) {
    try { await res.body?.cancel?.(); } catch { /* el cuerpo ya no importa */ }
    return clase;
  }
  let datos;
  try {
    datos = await leerCuerpo(res, onProgreso);
  } catch {
    return signal?.aborted ? CANCELADA : fallo('red', 'Se cortó la descarga de la pista.');
  }
  const msBajada = performance.now() - t0;
  const bytes = datos.byteLength;   // ANTES de decodificar: decodeAudioData desprende (detach) el ArrayBuffer
  if (signal?.aborted) return CANCELADA;

  const t1 = performance.now();
  let buffer;
  try {
    buffer = await contexto.decodeAudioData(datos);
  } catch {
    return signal?.aborted ? CANCELADA : fallo('decodificar', 'El navegador no pudo decodificar este archivo de audio.');
  }
  const msDecodificacion = performance.now() - t1;
  if (signal?.aborted) return CANCELADA;

  const registro = {
    id: pista.id,
    bytes,
    msBajada: Math.round(msBajada),
    msDecodificacion: Math.round(msDecodificacion),
    duracion: buffer.duration,
    sampleRate: buffer.sampleRate,
    sampleRateArchivo: pista.sample_rate ?? null,
    canales: buffer.numberOfChannels,
    memoriaBytes: buffer.length * buffer.numberOfChannels * 4,
  };
  console.info('[dj] carga', registro);
  return { ok: true, buffer, registro };
}
