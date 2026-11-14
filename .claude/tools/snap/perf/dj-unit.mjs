// dj-unit.mjs — unitaria del Modo DJ (sub-paso b), con node y sin navegador, como routes-unit.mjs.
// Prueba lo PURO del motor: music-client/src/dj/motor/mezcla.js (crossfader de igual potencia y filtro
// bipolar) y music-client/src/dj/motor/carga.js (antesDeBajar, clasificarRespuesta y cargarPista con
// un fetch y un decodeAudioData falsos: que nunca lance, que use Bearer y no ?token=, y el registro) y
// motor.js sólo en la tasa del contexto (TASA_DJ = 44 100, con un AudioContext falso).
// Uso: node dj-unit.mjs
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const desde = (p) => import(pathToFileURL(join(ROOT, p)).href);
const { potenciaIgual, filtroBipolar, ZONA_MUERTA, PASO_BAJO, PASO_ALTO } = await desde('music-client/src/dj/motor/mezcla.js');
const { antesDeBajar, clasificarRespuesta, cargarPista, MAX_SEG, MEMORIA_AVISO_B, TASA_PEOR_CASO } = await desde('music-client/src/dj/motor/carga.js');
const { crearMotor, TASA_DJ } = await desde('music-client/src/dj/motor/motor.js');

const R = {};
// `ok` va DESPUÉS del detalle: varios detalles son resultados { ok: false, error } y no deben pisar el veredicto.
const ok = (k, v, extra) => { R[k] = extra === undefined ? !!v : { ...extra, ok: !!v }; };
console.info = () => {};   // cargarPista registra cada carga con console.info: acá no hace falta verlo

// ── Crossfader de igual potencia ──
{
  let peor = 0;
  let monotona = true;
  let prev = null;
  for (let i = 0; i <= 100; i++) {
    const g = potenciaIgual(i / 100);
    peor = Math.max(peor, Math.abs(g.a * g.a + g.b * g.b - 1));
    if (prev && !(g.a <= prev.a && g.b >= prev.b)) monotona = false;
    prev = g;
  }
  ok('potencia_101_puntos_a2_mas_b2_es_1', peor <= 1e-6, { peor });
  ok('potencia_monotona', monotona);
  const g0 = potenciaIgual(0), g1 = potenciaIgual(1);
  ok('potencia_extremos_exactos', g0.a === 1 && g0.b === 0 && g1.a === 0 && g1.b === 1, { g0, g1 });
  const gm = potenciaIgual(0.5);
  ok('potencia_centro_raiz_de_un_medio', Math.abs(gm.a - Math.SQRT1_2) < 1e-12 && Math.abs(gm.b - Math.SQRT1_2) < 1e-12, gm);
  const gn = potenciaIgual(-3), gx = potenciaIgual(7), gnan = potenciaIgual(NaN);
  ok('potencia_fuera_de_rango_se_recorta', gn.a === 1 && gn.b === 0 && gx.a === 0 && gx.b === 1 && gnan.a === gm.a && gnan.b === gm.b);
}

// ── Filtro bipolar ──
{
  const c = filtroBipolar(0.5);
  ok('filtro_centro_plano', c.tipo === 'plano' && c.frecuencia === null, c);
  const zm = [0.5 - ZONA_MUERTA, 0.5 + ZONA_MUERTA, 0.49, 0.51].map(filtroBipolar);
  ok('filtro_zona_muerta_plano', zm.every((f) => f.tipo === 'plano'), { zm });
  const bajo = filtroBipolar(0.3), alto = filtroBipolar(0.7);
  ok('filtro_debajo_paso_bajo', bajo.tipo === 'lowpass' && bajo.frecuencia > PASO_BAJO.hasta && bajo.frecuencia < PASO_BAJO.desde, bajo);
  ok('filtro_encima_paso_alto', alto.tipo === 'highpass' && alto.frecuencia > PASO_ALTO.desde && alto.frecuencia < PASO_ALTO.hasta, alto);
  const f0 = filtroBipolar(0), f1 = filtroBipolar(1);
  ok('filtro_extremos', f0.tipo === 'lowpass' && f0.frecuencia === 60 && f1.tipo === 'highpass' && f1.frecuencia === 12000, { f0, f1 });
  // Al salir de la zona muerta el filtro arranca TRANSPARENTE (sin salto audible).
  const eps = 1e-9;
  const bordeB = filtroBipolar(0.5 - ZONA_MUERTA - eps), bordeA = filtroBipolar(0.5 + ZONA_MUERTA + eps);
  ok('filtro_borde_de_zona_muerta_transparente', bordeB.tipo === 'lowpass' && bordeB.frecuencia > 19990 && bordeA.tipo === 'highpass' && bordeA.frecuencia < 20.01, { bordeB, bordeA });
  // Más perilla = más filtro: el paso bajo CIERRA al ir a la izquierda y el paso alto al ir a la derecha.
  let monoB = true, monoA = true;
  for (let v = 0.01; v < 0.48; v += 0.01) if (!(filtroBipolar(v).frecuencia > filtroBipolar(v - 0.01).frecuencia)) monoB = false;
  for (let v = 0.53; v <= 1; v += 0.01) if (!(filtroBipolar(v).frecuencia > filtroBipolar(v - 0.01).frecuencia)) monoA = false;
  ok('filtro_monotono_a_cada_lado', monoB && monoA, { monoB, monoA });
  // Exponencial: el centro de cada mitad cae en la media GEOMÉTRICA (√(20000·60) ≈ 1095 Hz).
  const medioB = filtroBipolar(0.5 - ZONA_MUERTA - (0.5 - ZONA_MUERTA) / 2);
  ok('filtro_curva_exponencial', Math.abs(medioB.frecuencia - Math.sqrt(20000 * 60)) < 0.5, medioB);
  const basura = filtroBipolar(undefined);
  ok('filtro_entrada_no_numerica_plano', basura.tipo === 'plano');
}

// ── antesDeBajar ──
{
  const p = (duration, sample_rate = 44100) => ({ id: 1, duration, sample_rate });
  const r901 = antesDeBajar(p(901));
  ok('antes_rechaza_901', r901.ok === false && r901.error.tipo === 'larga', r901);
  ok('antes_acepta_899', antesDeBajar(p(899)).ok === true);
  ok('antes_acepta_900_justo', antesDeBajar(p(MAX_SEG)).ok === true);
  const r2731 = antesDeBajar(p(2731.07));
  ok('antes_rechaza_2731_con_mensaje_claro', r2731.ok === false && /45:31/.test(r2731.error.mensaje) && /15 minutos/.test(r2731.error.mensaje) && /no se baj/i.test(r2731.error.mensaje), { mensaje: r2731.error?.mensaje });
  const sin = [antesDeBajar(p(null)), antesDeBajar(p(undefined)), antesDeBajar(p('x')), antesDeBajar(p(0)), antesDeBajar(null)];
  ok('antes_sin_duracion_rechaza', sin.every((r) => r.ok === false && r.error.tipo === 'sin-duracion'));
  const a96 = antesDeBajar(p(300, 96000)), a48 = antesDeBajar(p(300, 48000)), a44 = antesDeBajar(p(300, 44100));
  ok('antes_avisa_96k_y_no_a_44_ni_48', a96.ok && /96 kHz/.test(a96.aviso ?? '') && a48.ok && a48.aviso === null && a44.aviso === null, { a96: a96.aviso });

  // Memoria estimada = duración × tasa del CONTEXTO × 2 canales × 4 B; aviso por encima de 400 MB.
  const m900 = antesDeBajar(p(900), { tasa: 96000 });
  ok('memoria_900s_a_96k_691_MB_avisa', m900.ok === true && m900.memoriaEstimadaBytes === 691_200_000 && m900.tasaUsada === 96000 && m900.tasaEsPeorCaso === false
    && /≈ 691 MB en memoria/.test(m900.aviso ?? '') && !/peor caso/.test(m900.aviso), { aviso: m900.aviso });
  const mSin = antesDeBajar(p(900));
  ok('memoria_sin_contexto_usa_96000_peor_caso', mSin.tasaUsada === TASA_PEOR_CASO && TASA_PEOR_CASO === 96000 && mSin.tasaEsPeorCaso === true && /peor caso/.test(mSin.aviso ?? ''), { aviso: mSin.aviso });
  const m48 = antesDeBajar(p(900, 44100), { tasa: 48000 });
  ok('memoria_900s_a_48k_345_MB_sin_aviso', m48.ok && m48.memoriaEstimadaBytes === 345_600_000 && m48.aviso === null && m48.avisos.length === 0, { memoria: m48.memoriaEstimadaBytes });
  const b520 = antesDeBajar(p(520), { tasa: 96000 }), b521 = antesDeBajar(p(521), { tasa: 96000 });
  ok('memoria_borde_400_MB', MEMORIA_AVISO_B === 400_000_000 && b520.memoriaEstimadaBytes === 399_360_000 && b520.aviso === null
    && b521.memoriaEstimadaBytes === 400_128_000 && /≈ 400 MB en memoria/.test(b521.aviso ?? ''), { b520: b520.aviso, b521: b521.aviso });
  const e520 = antesDeBajar(p(677), { tasa: 96000 });
  ok('memoria_texto_como_el_ejemplo_520_MB', /≈ 520 MB en memoria \(11:17 a 96 kHz, 2 canales\)/.test(e520.aviso ?? ''), { aviso: e520.aviso });
  const t901 = antesDeBajar(p(901), { tasa: 44100 }), t899 = antesDeBajar(p(899), { tasa: 192000 });
  ok('memoria_no_rechaza_y_el_tope_duro_sigue', t899.ok === true && /≈ 1381 MB/.test(t899.aviso ?? '') && t901.ok === false && t901.error.tipo === 'larga', { t899: t899.aviso });
  const ambos = antesDeBajar(p(600, 96000), { tasa: 96000 });
  ok('memoria_y_96k_juntos', ambos.avisos.length === 2 && /96 kHz: el archivo/.test(ambos.aviso) && /≈ 461 MB en memoria/.test(ambos.aviso), { aviso: ambos.aviso });
  // A la tasa del Modo DJ (44 100) el tope de 900 s da ≈ 318 MB: el aviso de memoria no puede salir.
  const m44 = antesDeBajar(p(900), { tasa: TASA_DJ });
  ok('memoria_900s_a_44100_318_MB_sin_aviso', TASA_DJ === 44100 && m44.ok && m44.memoriaEstimadaBytes === 317_520_000 && m44.memoriaEstimadaBytes < MEMORIA_AVISO_B
    && m44.aviso === null && m44.tasaUsada === 44100 && m44.tasaEsPeorCaso === false, { memoria: m44.memoriaEstimadaBytes, aviso: m44.aviso });
  const raras = [0, -1, NaN, '48000', null].map((t) => antesDeBajar(p(300), { tasa: t }).tasaUsada);
  ok('memoria_tasa_invalida_usa_peor_caso', raras.every((t) => t === 96000), { raras });
}

// ── clasificarRespuesta ──
{
  const c = (status, contentType) => clasificarRespuesta({ status, contentType });
  ok('resp_audio_200_ok', c(200, 'audio/flac').ok && c(200, 'audio/wav').ok && c(200, 'Audio/FLAC; x=1').ok);
  const h = c(200, 'text/html; charset=utf-8');
  ok('resp_html_200_es_html', h.ok === false && h.error.tipo === 'html' && h.error.status === 200 && /página/.test(h.error.mensaje), h);
  const s = c(401, 'application/json');
  ok('resp_401_es_sesion', s.ok === false && s.error.tipo === 'sesion' && s.error.status === 401, s);
  const n = c(404, 'application/json');
  ok('resp_404_no_existe', n.ok === false && n.error.tipo === 'no-existe');
  const otros = [500, 502, 403, 206].map((st) => c(st, 'audio/flac'));
  ok('resp_otros_codigos_http', otros.every((r, i) => r.ok === false && r.error.tipo === 'http' && r.error.status === [500, 502, 403, 206][i] && /\d{3}/.test(r.error.mensaje)));
  const j = c(200, 'application/json'), v = c(200, null);
  ok('resp_200_sin_audio_es_formato', j.ok === false && j.error.tipo === 'formato' && v.ok === false && v.error.tipo === 'formato');
}

// ── cargarPista con fetch y decodeAudioData falsos ──
{
  const pista = { id: 42, duration: 120, sample_rate: 44100 };
  const pedidos = [];
  const respuesta = (status, ct, bytes = 1000) => ({
    status,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? ct : k.toLowerCase() === 'content-length' ? String(bytes) : null) },
    body: { cancel: async () => {} },
    arrayBuffer: async () => new ArrayBuffer(bytes),
  });
  let siguiente = null;
  globalThis.fetch = async (url, init) => { pedidos.push({ url, init }); if (siguiente instanceof Error) throw siguiente; return siguiente; };
  const contexto = {
    decodeAudioData: async (ab) => {
      if (ab.byteLength === 13) throw new Error('EncodingError');
      // Como el real: el buffer sale a la tasa del CONTEXTO (la del Modo DJ), no a la del archivo.
      return { duration: 120, sampleRate: TASA_DJ, numberOfChannels: 2, length: 120 * TASA_DJ };
    },
  };
  const intentar = async (opts) => { try { return await cargarPista(pista, { contexto, token: 'T0K', ...opts }); } catch (e) { return { lanzo: String(e) }; } };

  siguiente = respuesta(200, 'audio/flac', 5000);
  const bien = await intentar();
  const p0 = pedidos.at(-1);
  ok('carga_bearer_sin_token_en_url', p0.url === '/stream/42' && !/token/i.test(p0.url) && p0.init.headers.Authorization === 'Bearer T0K', { url: p0.url });
  ok('carga_registro_completo', bien.ok === true && bien.registro.bytes === 5000 && bien.registro.duracion === 120 && bien.registro.sampleRate === 44100
    && bien.registro.canales === 2 && bien.registro.memoriaBytes === 120 * 44100 * 2 * 4 && bien.registro.msBajada >= 0 && bien.registro.msDecodificacion >= 0, bien.registro ?? bien);

  siguiente = respuesta(401, 'application/json');
  const r401 = await intentar();
  ok('carga_401_error_tipado_sin_lanzar', r401.ok === false && r401.error?.tipo === 'sesion', r401);
  siguiente = respuesta(200, 'text/html');
  const rHtml = await intentar();
  ok('carga_html_200_error_tipado_sin_lanzar', rHtml.ok === false && rHtml.error?.tipo === 'html', rHtml);
  siguiente = new TypeError('Failed to fetch');
  const rRed = await intentar();
  ok('carga_red_caida_error_tipado_sin_lanzar', rRed.ok === false && rRed.error?.tipo === 'red', rRed);
  siguiente = respuesta(200, 'audio/flac', 13);
  const rDec = await intentar();
  ok('carga_no_decodifica_error_tipado_sin_lanzar', rDec.ok === false && rDec.error?.tipo === 'decodificar', rDec);
  const ac = new AbortController(); ac.abort();
  siguiente = respuesta(200, 'audio/flac');
  const rAb = await intentar({ signal: ac.signal });
  ok('carga_cancelada_sin_lanzar', rAb.ok === false && rAb.error?.tipo === 'cancelada', rAb);

  const antes = pedidos.length;
  const larga = await cargarPista({ id: 7, duration: 901 }, { contexto, token: 'T0K' });
  ok('carga_larga_no_llama_a_fetch', larga.ok === false && larga.error.tipo === 'larga' && pedidos.length === antes, { pedidos: pedidos.length - antes });
  const sinToken = await cargarPista(pista, { contexto, token: null });
  ok('carga_sin_token_no_pide', sinToken.ok === false && sinToken.error.tipo === 'sesion' && pedidos.length === antes);

  // Lectura por TROZOS (res.body.getReader). Los trozos son VISTAS con desplazamiento dentro de un
  // buffer más grande, como los de un stream real. Se compara byte a byte lo que llega a decodeAudioData.
  const fondo = new Uint8Array(64).map((_, i) => (i * 7 + 3) & 0xff);
  const vistas = [fondo.subarray(5, 9), fondo.subarray(20, 21), fondo.subarray(30, 37), fondo.subarray(40, 43)];   // 4 + 1 + 7 + 3 = 15
  const esperado = vistas.flatMap((v) => [...v]);
  const enTrozos = (cl) => ({
    status: 200,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'audio/flac' : k.toLowerCase() === 'content-length' ? (cl == null ? null : String(cl)) : null) },
    body: {
      getReader() { let i = 0; return { read: async () => (i < vistas.length ? { done: false, value: vistas[i++] } : { done: true, value: undefined }) }; },
      cancel: async () => {},
    },
    arrayBuffer: async () => { throw new Error('no debería usarse con getReader'); },
  });
  const captura = { recibido: null };
  const ctxCaptura = { decodeAudioData: async (ab) => { captura.recibido = { largo: ab.byteLength, bytes: [...new Uint8Array(ab)] }; return { duration: 1, sampleRate: 48000, numberOfChannels: 2, length: 48000 }; } };
  const leer = async (cl) => {
    captura.recibido = null;
    const prog = [];
    siguiente = enTrozos(cl);
    const r = await cargarPista(pista, { contexto: ctxCaptura, token: 'T0K', onProgreso: (x) => prog.push(x) });
    return { r, prog, rec: captura.recibido };
  };
  const igual = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const conCl = await leer(15);
  ok('carga_trozos_con_content_length_contenido_y_bytes', conCl.r.ok && conCl.r.registro.bytes === 15 && conCl.rec.largo === 15 && igual(conCl.rec.bytes, esperado)
    && conCl.prog.length === 4 && conCl.prog.at(-1).recibidos === 15 && conCl.prog.every((x) => x.total === 15), { bytes: conCl.r.registro?.bytes, largo: conCl.rec?.largo, progreso: conCl.prog.map((x) => x.recibidos) });
  const sinCl = await leer(null);
  ok('carga_trozos_sin_content_length', sinCl.r.ok && sinCl.r.registro.bytes === 15 && sinCl.rec.largo === 15 && igual(sinCl.rec.bytes, esperado) && sinCl.prog.every((x) => x.total === null), { bytes: sinCl.r.registro?.bytes });
  // Sin dos copias: con Content-Length el Uint8Array del tamaño total se reserva ANTES del primer read()
  // y UNA sola vez (la versión anterior juntaba los trozos y reservaba al final, con todo ya leído).
  const U8 = globalThis.Uint8Array;
  const eventos = [];
  const vistasOrig = vistas.slice();
  globalThis.Uint8Array = class extends U8 { constructor(...a) { super(...a); if (typeof a[0] === 'number' && a[0] >= 15) eventos.push(`reserva ${a[0]}`); } };
  const leerConEventos = async () => {
    captura.recibido = null;
    siguiente = enTrozos(15);
    const lector0 = siguiente.body.getReader;
    siguiente.body.getReader = () => { const l = lector0(); return { read: async () => { eventos.push('read'); return l.read(); } }; };
    return cargarPista(pista, { contexto: ctxCaptura, token: 'T0K' });
  };
  let rEv;
  try { rEv = await leerConEventos(); } finally { globalThis.Uint8Array = U8; }
  ok('carga_con_content_length_reserva_antes_de_leer_y_una_vez', rEv.ok && eventos[0] === 'reserva 15' && eventos.filter((e) => e.startsWith('reserva')).length === 1
    && eventos.filter((e) => e === 'read').length === vistasOrig.length + 1 && igual(captura.recibido.bytes, esperado), { eventos });
  const clMenor = await leer(10), clMayor = await leer(20);
  ok('carga_content_length_que_miente', clMenor.r.ok && clMenor.r.registro.bytes === 15 && igual(clMenor.rec.bytes, esperado)
    && clMayor.r.ok && clMayor.r.registro.bytes === 15 && clMayor.rec.largo === 15 && igual(clMayor.rec.bytes, esperado),
  { menor: clMenor.r.registro?.bytes, mayor: clMayor.r.registro?.bytes, largoMayor: clMayor.rec?.largo });
}

// ── motor.js: la tasa del contexto (AudioContext falso que anota con qué opciones se construye) ──
{
  const creados = [];
  class ACFalso {
    constructor(opciones) { this.opciones = opciones; this.sampleRate = opciones?.sampleRate ?? 96000; this.state = 'running'; this.destination = {}; creados.push(this); }
    createGain() { return { connect() {}, disconnect() {}, gain: { value: 1 } }; }
    resume() { return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }
  const AC0 = globalThis.AudioContext;
  globalThis.AudioContext = ACFalso;
  try {
    const m = crearMotor();
    const sinGesto = creados.length;
    const c = m.asegurarContexto();
    ok('motor_por_defecto_44100_interactive', sinGesto === 0 && creados.length === 1 && c.sampleRate === 44100
      && JSON.stringify(c.opciones) === JSON.stringify({ sampleRate: 44100, latencyHint: 'interactive' }), { opciones: c.opciones, sinGesto });
    m.cerrar();
    const m48 = crearMotor({ sampleRate: 48000 });
    const c48 = m48.asegurarContexto();
    m48.cerrar();
    const mNat = crearMotor({ sampleRate: null });
    const cNat = mNat.asegurarContexto();
    mNat.cerrar();
    ok('motor_sampleRate_se_puede_cambiar', c48.opciones.sampleRate === 48000 && c48.opciones.latencyHint === 'interactive'
      && JSON.stringify(cNat.opciones) === JSON.stringify({ latencyHint: 'interactive' }) && cNat.sampleRate === 96000, { c48: c48.opciones, nativo: cNat.opciones });
  } finally {
    globalThis.AudioContext = AC0;
  }
}

const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
console.log(`\ndj-unit: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
process.exit(fails.length ? 1 : 0);
