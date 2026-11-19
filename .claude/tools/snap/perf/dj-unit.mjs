// dj-unit.mjs — unitaria del Modo DJ (sub-paso b), con node y sin navegador, como routes-unit.mjs.
// Prueba lo PURO del motor: music-client/src/dj/motor/mezcla.js (crossfader de igual potencia y filtro
// bipolar) y music-client/src/dj/motor/carga.js (antesDeBajar, clasificarRespuesta y cargarPista con
// un fetch y un decodeAudioData falsos: que nunca lance, que use Bearer y no ?token=, y el registro) y
// motor.js con un AudioContext falso: la tasa del contexto (TASA_DJ = 44 100) y la mezcla del sub-paso c
// (grafo, valores iniciales, rampas con TAU sin escribir .value, crossfader, filtro sin cambiar .type), y
// midi.js (sub-paso d): interpretar, 14 bits, solo MSB / solo LSB, duplicados, el mapa del DDJ-400, el
// colector del retraso y la conexión con un navigator.requestMIDIAccess falso, y cue.js (sub-paso e1, lo
// puro del cue a audífonos): desfase, volumen, relojes master/cue, plan de una fuente de cue, lista de
// salidas (con las 8 salidas reales de la máquina de Oscar), salida recordada y avisos.
// Uso: node dj-unit.mjs
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const desde = (p) => import(pathToFileURL(join(ROOT, p)).href);
const { potenciaIgual, filtroBipolar, ZONA_MUERTA, PASO_BAJO, PASO_ALTO, gananciaVolumen, filtroFrecuencias, LP_NEUTRA, HP_NEUTRA } = await desde('music-client/src/dj/motor/mezcla.js');
const { antesDeBajar, clasificarRespuesta, cargarPista, MAX_SEG, MEMORIA_AVISO_B, TASA_PEOR_CASO } = await desde('music-client/src/dj/motor/carga.js');
const { crearMotor, TASA_DJ, TAU, Q_FILTRO, GUARDA_CUE } = await desde('music-client/src/dj/motor/motor.js');
const { interpretar, crearCombinador, crearDeduplicador, valorParaMotor, aplicar, crearColector, crearConexionMidi, MAPA_DDJ400 } = await desde('music-client/src/dj/motor/midi.js');
const { recortarDesfase, volumenCue, offsetRelojes, planCue, filtrarSalidas, hayNombres, elegirGuardada, textoAviso, validarCanales, DESFASE_MAX_MS, VOLUMEN_CUE_INICIAL,
  nombresVisibles, decidirEleccion, textoListaSalidas, textoEstadoCue,
  textoCuesActivos, estadoBotonCue, textoNotaCue, textoDesfase, crearDiferido, buscarVuelta, pistaMezcladora,
  CLAVE_CUE, TOPE_SALIDAS, crearAlmacen, leerCueGuardado, serializarCue, cueVacio, recordarActual, olvidarActual, recordarDesfase, migrarId,
  desfaseGuardado, decidirRestauracion, decidirVuelta } = await desde('music-client/src/dj/motor/cue.js');
const { crearListaSalidas } = await desde('music-client/src/dj/motor/salidas.js');

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

// ── Volumen (sub-paso c): ganancia = v² ──
{
  let monotona = true, salto = 0, prev = gananciaVolumen(0);
  for (let i = 1; i <= 1000; i++) {
    const g = gananciaVolumen(i / 1000);
    if (g < prev) monotona = false;
    salto = Math.max(salto, g - prev);
    prev = g;
  }
  // Continua: entre vecinos a 0,001 la ganancia no cambia más que la derivada máxima (2v ≤ 2) × 0,001.
  ok('volumen_curva_cuadratica', gananciaVolumen(0) === 0 && gananciaVolumen(1) === 1 && gananciaVolumen(0.5) === 0.25 && monotona && salto <= 0.002 + 1e-12
    && gananciaVolumen(-1) === 0 && gananciaVolumen(2) === 1 && gananciaVolumen(NaN) === 1, { salto, monotona });
}

// ── filtroFrecuencias (sub-paso c): dos biquad fijos, sólo se mueven sus frecuencias ──
{
  const cen = filtroFrecuencias(0);
  const borde = [filtroFrecuencias(-0.04), filtroFrecuencias(0.04)];
  const fuera = [filtroFrecuencias(-0.041), filtroFrecuencias(0.041)];
  ok('filtro_frecuencias_centro_y_zona_muerta_neutros', LP_NEUTRA === 20000 && HP_NEUTRA === 20 && cen.lp === 20000 && cen.hp === 20
    && borde.every((r) => r.lp === 20000 && r.hp === 20) && fuera[0].lp < 20000 && fuera[0].hp === 20 && fuera[1].lp === 20000 && fuera[1].hp > 20
    && filtroFrecuencias(undefined).lp === 20000 && filtroFrecuencias('0.5').hp === 20, { cen, borde, fuera });
  const e0 = filtroFrecuencias(-1), e1 = filtroFrecuencias(1);
  ok('filtro_frecuencias_extremos', e0.lp === 60 && e0.hp === 20 && e1.lp === 20000 && e1.hp === 12000
    && filtroFrecuencias(-5).lp === 60 && filtroFrecuencias(5).hp === 12000, { e0, e1 });
  // Nunca «cambia de tipo»: siempre devuelve SÓLO lp y hp, y a lo sumo uno de los dos se aparta de su neutro
  // (el negativo mueve el lowpass, el positivo el highpass).
  let unLado = true, saltoLp = 0, saltoHp = 0, prev = null;
  for (let i = -1000; i <= 1000; i++) {
    const pos = i / 1000;
    const r = filtroFrecuencias(pos);
    const claves = Object.keys(r).sort().join(',');
    const mueveLp = r.lp !== LP_NEUTRA, mueveHp = r.hp !== HP_NEUTRA;
    if (claves !== 'hp,lp' || (mueveLp && mueveHp) || (mueveLp && pos >= 0) || (mueveHp && pos <= 0) || r.lp > 20000 || r.lp < 60 || r.hp < 20 || r.hp > 12000) unLado = false;
    if (prev) { saltoLp = Math.max(saltoLp, Math.abs(Math.log2(r.lp / prev.lp))); saltoHp = Math.max(saltoHp, Math.abs(Math.log2(r.hp / prev.hp))); }
    prev = r;
  }
  ok('filtro_frecuencias_un_solo_biquad_se_mueve', unLado);
  // Sin saltos: entre posiciones vecinas (0,001) el corte se mueve < 0,02 octavas, también al salir de la
  // zona muerta (8,4 octavas del lowpass y 9,2 del highpass repartidas en 0,96 de recorrido: ~0,01 por paso).
  ok('filtro_frecuencias_sin_saltos', saltoLp < 0.02 && saltoHp < 0.02, { saltoLp, saltoHp });
}

// ── motor.js con un AudioContext falso: anota opciones, nodos, conexiones, escrituras de .value, rampas
// y cambios de .type ──
{
  const creados = [];
  const param = (ini) => {
    const p = { _v: ini, escrituras: 0, rampas: [] };
    Object.defineProperty(p, 'value', { get() { return p._v; }, set(v) { p._v = v; p.escrituras++; } });
    p.setTargetAtTime = (v, t, tau) => { p.rampas.push({ v, t, tau }); };
    p.objetivo = () => (p.rampas.length ? p.rampas.at(-1).v : p._v);
    return p;
  };
  class Nodo {
    constructor(ctx, clase) { this.context = ctx; this.clase = clase; this.salidas = []; ctx.nodos.push(this); }
    connect(d) { this.salidas.push(d); return d; }
    disconnect() {}
  }
  class ACFalso {
    constructor(opciones) {
      this.opciones = opciones; this.sampleRate = opciones?.sampleRate ?? 96000; this.state = 'running'; this.currentTime = 1.25;
      this.nodos = []; this.destination = new Nodo(this, 'destination'); creados.push(this);
    }
    createGain() { const n = new Nodo(this, 'gain'); n.gain = param(1); return n; }
    createBiquadFilter() {
      const n = new Nodo(this, 'biquad'); let tipo = 'lowpass'; n.tiposEscritos = 0;
      Object.defineProperty(n, 'type', { get: () => tipo, set: (v) => { tipo = v; n.tiposEscritos++; } });
      n.frequency = param(350); n.Q = param(1); return n;
    }
    createBufferSource() { const n = new Nodo(this, 'fuente'); n.start = () => {}; n.stop = () => {}; return n; }
    resume() { return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }
  const AC0 = globalThis.AudioContext;
  globalThis.AudioContext = ACFalso;
  const cerca = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
  // El grafo por TOPOLOGÍA (no por orden de creación): el vol de A es al que se conecta la fuente de A.
  const grafo = (c) => {
    const entra = (n) => c.nodos.filter((x) => x.salidas.includes(n));
    const master = entra(c.destination)[0], hp = master && entra(master)[0], lp = hp && entra(hp)[0], bus = lp && entra(lp)[0];
    const fuentes = c.nodos.filter((n) => n.clase === 'fuente');
    const volA = fuentes.find((f) => f.deck === 'A')?.salidas[0] ?? null;
    const xfs = bus ? entra(bus) : [];
    const volB = xfs.map((x) => entra(x)[0]).find((v) => v && v !== volA) ?? null;
    const cadena = (n) => { const out = []; for (let x = n, i = 0; x && i < 12; x = x.salidas[0], i++) out.push(x.clase === 'biquad' ? 'biquad:' + x.type : x.clase); return out.join(' → '); };
    return { master, hp, lp, bus, volA, volB, xfA: volA?.salidas[0], xfB: volB?.salidas[0], cadenaA: volA && cadena(volA), cadenaB: volB && cadena(volB) };
  };
  const tocarA = (m, c) => { m.decks.A.cargarBuffer({ duration: 10 }); m.decks.A.play(); const f = c.nodos.filter((n) => n.clase === 'fuente').at(-1); if (f) f.deck = 'A'; };
  try {
    // Tasa del contexto (sub-paso b).
    const m0 = crearMotor();
    const sinGesto = creados.length;
    const c0 = m0.asegurarContexto();
    ok('motor_por_defecto_44100_interactive', sinGesto === 0 && creados.length === 1 && c0.sampleRate === 44100
      && JSON.stringify(c0.opciones) === JSON.stringify({ sampleRate: 44100, latencyHint: 'interactive' }), { opciones: c0.opciones, sinGesto });
    m0.cerrar();
    const m48 = crearMotor({ sampleRate: 48000 });
    const c48 = m48.asegurarContexto();
    m48.cerrar();
    const mNat = crearMotor({ sampleRate: null });
    const cNat = mNat.asegurarContexto();
    mNat.cerrar();
    ok('motor_sampleRate_se_puede_cambiar', c48.opciones.sampleRate === 48000 && c48.opciones.latencyHint === 'interactive'
      && JSON.stringify(cNat.opciones) === JSON.stringify({ latencyHint: 'interactive' }) && cNat.sampleRate === 96000, { c48: c48.opciones, nativo: cNat.opciones });

    ok('tau_es_0_01', TAU === 0.01 && Q_FILTRO === 0.707, { TAU, Q_FILTRO });

    // Antes del contexto: los setters sólo guardan.
    const m = crearMotor();
    const antes = creados.length;
    const r0 = [m.fijarVolumen('A', 0.8), m.fijarVolumen('B', 0.3), m.fijarCrossfader(0.25), m.fijarFiltro(-0.5)];
    const mz0 = m.mezcla();
    ok('motor_mezcla_sin_contexto_solo_guarda', r0.every(Boolean) && creados.length === antes && m.contexto() === null
      && mz0.volumen.A === 0.8 && mz0.volumen.B === 0.3 && mz0.crossfader === 0.25 && mz0.filtro === -0.5 && cerca(mz0.ganancias.volA, 0.64), mz0);

    // Al crear el contexto, esos valores son los INICIALES de cada nodo.
    const c = m.asegurarContexto();
    tocarA(m, c);
    const g = grafo(c);
    const pi = potenciaIgual(0.25), fr = filtroFrecuencias(-0.5);
    ok('motor_valores_guardados_son_iniciales_al_crear', !!g.volA && !!g.volB && cerca(g.volA.gain.value, 0.64) && cerca(g.volB.gain.value, 0.09)
      && cerca(g.xfA.gain.value, pi.a) && cerca(g.xfB.gain.value, pi.b) && cerca(g.lp.frequency.value, fr.lp) && g.hp.frequency.value === 20
      && g.lp.type === 'lowpass' && g.hp.type === 'highpass' && g.lp.Q.value === 0.707 && g.hp.Q.value === 0.707 && g.bus.gain.value === 1 && g.master.gain.value === 1,
    { volA: g.volA?.gain.value, volB: g.volB?.gain.value, lp: g.lp?.frequency.value });
    const esperada = 'gain → gain → gain → biquad:lowpass → biquad:highpass → gain → destination';
    ok('motor_grafo_vol_xf_bus_lp_hp_master', g.cadenaA === esperada && g.cadenaB === esperada && g.xfA !== g.xfB
      && c.nodos.filter((n) => n.clase === 'biquad').length === 2, { A: g.cadenaA, B: g.cadenaB });

    // Con contexto: rampas con TAU y currentTime, ninguna escritura de .value.
    const params = [g.volA.gain, g.volB.gain, g.xfA.gain, g.xfB.gain, g.lp.frequency, g.hp.frequency, g.lp.Q, g.hp.Q, g.bus.gain, g.master.gain];
    const escr0 = params.map((p) => p.escrituras);
    const tipos0 = g.lp.tiposEscritos + g.hp.tiposEscritos;
    c.currentTime = 3.5;
    m.fijarVolumen('A', 0.5); m.fijarVolumen('B', 1); m.fijarCrossfader(0.75); m.fijarFiltro(0.6);
    const ult = (p) => p.rampas.at(-1);
    const pi75 = potenciaIgual(0.75), fr6 = filtroFrecuencias(0.6);
    const rampasOk = [[g.volA.gain, 0.25], [g.volB.gain, 1], [g.xfA.gain, pi75.a], [g.xfB.gain, pi75.b], [g.lp.frequency, 20000], [g.hp.frequency, fr6.hp]]
      .every(([p, v]) => ult(p) && cerca(ult(p).v, v) && ult(p).t === 3.5 && ult(p).tau === TAU);
    ok('motor_setters_rampa_con_tau_sin_escribir_value', rampasOk && params.every((p, i) => p.escrituras === escr0[i]), { rampasOk, escrituras: params.map((p, i) => p.escrituras - escr0[i]) });

    // Crossfader: igual potencia en 5 posiciones (a² + b² = 1), sobre xfA / xfB.
    const xs = [0, 0.25, 0.5, 0.75, 1].map((x) => { m.fijarCrossfader(x); const a = g.xfA.gain.objetivo(), b = g.xfB.gain.objetivo(); return { x, a, b, p: a * a + b * b }; });
    ok('motor_crossfader_potencia_igual', xs.every((r) => cerca(r.p, 1, 1e-12) && cerca(r.a, potenciaIgual(r.x).a) && cerca(r.b, potenciaIgual(r.x).b)) && xs[0].b === 0 && xs[4].a === 0, { xs });

    // Filtro: sólo frecuencias; el .type no se toca después de crear.
    const fs = [-1, -0.5, 0, 0.5, 1].map((f) => { m.fijarFiltro(f); return { f, lp: g.lp.frequency.objetivo(), hp: g.hp.frequency.objetivo() }; });
    ok('motor_filtro_mueve_frecuencias_sin_cambiar_tipo', g.lp.tiposEscritos + g.hp.tiposEscritos === tipos0 && g.lp.type === 'lowpass' && g.hp.type === 'highpass'
      && fs.every((r) => cerca(r.lp, filtroFrecuencias(r.f).lp) && cerca(r.hp, filtroFrecuencias(r.f).hp)) && fs[0].lp === 60 && fs[4].hp === 12000,
    { fs, tipos: g.lp.tiposEscritos + g.hp.tiposEscritos - tipos0 });

    // Sobreviven a play, seek y cargar otra pista: no se recrean nodos y la fuente nueva va al mismo vol.
    m.fijarVolumen('A', 0.4); m.fijarVolumen('B', 0.7); m.fijarCrossfader(0.3); m.fijarFiltro(-0.25);
    const antesMz = JSON.stringify(m.mezcla());
    const nodosMezcla = c.nodos.filter((n) => n.clase !== 'fuente').length;
    m.decks.A.pausa(); m.decks.A.play(); m.decks.A.seek(4); m.decks.A.cargarBuffer({ duration: 20 }); m.decks.A.play();
    m.decks.B.cargarBuffer({ duration: 30 });
    const fuenteNueva = c.nodos.filter((n) => n.clase === 'fuente').at(-1);
    ok('motor_valores_sobreviven_play_seek_cargar', JSON.stringify(m.mezcla()) === antesMz && c.nodos.filter((n) => n.clase !== 'fuente').length === nodosMezcla
      && fuenteNueva.salidas[0] === g.volA && cerca(g.volA.gain.objetivo(), 0.16), { mezcla: m.mezcla() });

    // Valores fuera de rango se recortan; los que no son números se descartan.
    const rInv = [m.fijarVolumen('A', NaN), m.fijarVolumen('C', 1), m.fijarCrossfader('0.3'), m.fijarFiltro(Infinity), m.fijarVolumen('B', undefined)];
    const mInv = JSON.stringify(m.mezcla());
    m.fijarVolumen('A', 2); m.fijarFiltro(-3); m.fijarCrossfader(-1);
    const mRec = m.mezcla();
    ok('motor_valores_invalidos_se_descartan_y_se_recortan', rInv.every((r) => r === false) && mInv === antesMz
      && mRec.volumen.A === 1 && mRec.filtro === -1 && mRec.crossfader === 0, { rInv, mRec });

    // Contexto cerrado (por fuera) y motor cerrado: los setters no lanzan y sólo guardan.
    try {
      c.state = 'closed';
      const n0 = g.volA.gain.rampas.length;
      m.fijarVolumen('A', 0.2); m.fijarCrossfader(0.6); m.fijarFiltro(0.1);
      const sinRampa = g.volA.gain.rampas.length === n0;
      m.cerrar();
      m.fijarVolumen('B', 0.1); m.fijarCrossfader(0.9); m.fijarFiltro(-0.9);
      ok('motor_setters_no_lanzan_con_contexto_cerrado', sinRampa && m.mezcla().volumen.A === 0.2 && m.mezcla().volumen.B === 0.1 && m.mezcla().filtro === -0.9, { sinRampa });
    } catch (e) { ok('motor_setters_no_lanzan_con_contexto_cerrado', false, { lanzo: String(e) }); }
  } finally {
    globalThis.AudioContext = AC0;
  }
}

// ── motor.js · cue a audífonos (sub-paso e2), con AudioContext falsos ──
// ACCue: como ACFalso, más sinkId en el constructor, setSinkId configurable (ACCue.modo: resuelve |
// rechaza con un name | pendiente; vuelve: false = se queda en 'suspended'), getOutputTimestamp (ots),
// start(when, offset) y stop(t) registrados, estados con statechange y oyentes contados. Como Chromium,
// al resolver setSinkId el contexto pasa por 'suspended' y vuelve a 'running' en la tarea siguiente.
{
  const creados = [];
  const err = (name) => Object.assign(new Error(name), { name });
  const espera = (ms = 0) => new Promise((r) => setTimeout(r, ms));
  const listo = async () => { await espera(); await espera(); };
  let sinAtrapar = 0;
  const alRechazo = () => { sinAtrapar++; };
  process.on('unhandledRejection', alRechazo);
  const param = (ini) => {
    const p = { _v: ini, escrituras: 0, rampas: [] };
    Object.defineProperty(p, 'value', { get() { return p._v; }, set(v) { p._v = v; p.escrituras++; } });
    p.setTargetAtTime = (v, t, tau) => { p.rampas.push({ v, t, tau }); };
    return p;
  };
  // e2c: connect(d, salida, entrada) también queda en ctx.conexiones (con los índices); `salidas` sigue igual.
  class Nodo {
    constructor(ctx, clase) { this.context = ctx; this.clase = clase; this.salidas = []; this.desconexiones = 0; ctx.nodos.push(this); }
    connect(d, o = 0, i = 0) {
      this.salidas.push(d);
      (this.context.conexiones ??= []).push({ de: this, a: d, o, i });
      if (d === this.context.destination) this.context.eventos?.push(['conectar-destino', this.clase]);
      return d;
    }
    disconnect() { this.desconexiones++; }
  }
  // e2c: el destination tiene channelCount (2), maxChannelCount (ACCue.maxPorId[sinkId] al aplicar
  // setSinkId; 2 sin dato) y channelInterpretation ('speakers'). Sus escrituras y los setSinkId quedan en
  // ctx.eventos, con el estado del contexto. ACCue.setter: 'lanza' (como el navegador: IndexSizeError si
  // pasa del máximo) | 'recorta' (lo deja en el máximo sin lanzar) | 'lanza-siempre' (lanza con cualquier valor > 2).
  class ACCue {
    constructor(op) {
      this.opciones = op === undefined ? null : JSON.parse(JSON.stringify(op));
      this.sampleRate = op?.sampleRate ?? 96000; this.state = 'running'; this.currentTime = 1.25;
      this.sinkId = op && 'sinkId' in op ? op.sinkId : '';
      this.nodos = []; this.destination = new Nodo(this, 'destination');
      this.sinks = []; this.pendientes = []; this.oy = {}; this.ots = { contextTime: 0, performanceTime: 0 }; this.cierres = 0;
      this.modo = ACCue.modo;
      this.eventos = []; this.conexiones = []; this.maxCanales = 2;
      const yo = this;
      let cuenta = 2, interp = 'speakers';
      Object.defineProperties(this.destination, {
        maxChannelCount: { get: () => yo.maxCanales },
        channelCount: {
          get: () => cuenta,
          set: (v) => {
            yo.eventos.push(['channelCount', v, yo.state]);
            if (ACCue.setter === 'lanza-siempre' && v > 2) throw err('IndexSizeError');
            if (v > yo.maxCanales) { if (ACCue.setter === 'recorta') { cuenta = yo.maxCanales; return; } throw err('IndexSizeError'); }
            cuenta = v;
          },
        },
        channelInterpretation: { get: () => interp, set: (v) => { yo.eventos.push(['channelInterpretation', v, yo.state]); interp = v; } },
      });
      creados.push(this);
    }
    createChannelSplitter(n) { const x = new Nodo(this, 'splitter'); x.n = n; return x; }
    createChannelMerger(n) { const x = new Nodo(this, 'merger'); x.n = n; return x; }
    addEventListener(t, fn) { (this.oy[t] ??= new Set()).add(fn); }
    removeEventListener(t, fn) { this.oy[t]?.delete(fn); }
    emitir(t) { for (const fn of [...(this.oy[t] ?? [])]) fn({ type: t }); }
    ponerEstado(s) { this.state = s; this.emitir('statechange'); }
    oyentes() { return Object.values(this.oy).reduce((s, x) => s + x.size, 0); }
    setSinkId(id) {
      this.sinks.push(id);
      this.eventos.push(['setSinkId', id, this.state]);
      const m = this.modo;
      if (this.state === 'closed') return Promise.reject(err('InvalidStateError'));
      if (m.tipo === 'rechaza') return Promise.reject(err(m.name));
      const aplicar = () => {
        this.sinkId = id;
        this.maxCanales = ACCue.maxPorId[id] ?? 2;
        this.ponerEstado('suspended');
        if (m.vuelve !== false) setTimeout(() => { if (this.state === 'suspended') this.ponerEstado('running'); }, 0);
      };
      if (m.tipo === 'pendiente') return new Promise((res, rej) => this.pendientes.push({ id, resolver: () => { aplicar(); res(); }, rechazar: (n) => rej(err(n)) }));
      aplicar();
      return Promise.resolve();
    }
    getOutputTimestamp() { return { ...this.ots }; }
    createGain() { const n = new Nodo(this, 'gain'); n.gain = param(1); return n; }
    createBiquadFilter() { const n = new Nodo(this, 'biquad'); n.type = 'lowpass'; n.frequency = param(350); n.Q = param(1); return n; }
    createBufferSource() {
      const n = new Nodo(this, 'fuente'); n.inicios = []; n.paradas = [];
      n.start = (when, offset) => { n.inicios.push([when, offset]); };
      n.stop = (t) => { n.paradas.push(t); };
      return n;
    }
    resume() { this.resumes = (this.resumes ?? 0) + 1; return Promise.resolve(); }
    close() { this.cierres++; for (const p of this.pendientes.splice(0)) p.rechazar('InvalidStateError'); this.ponerEstado('closed'); return Promise.resolve(); }
  }
  ACCue.modo = { tipo: 'resuelve' };
  ACCue.setter = 'lanza';
  const AC0 = globalThis.AudioContext;
  globalThis.AudioContext = ACCue;
  const cerca = (a, b, tol = 1e-9) => typeof a === 'number' && Math.abs(a - b) <= tol;
  const ID = 'e21c0e98', NOMBRE = 'Headphones (Elgato Wave:XLR)', ID2 = '9d69141a', NOMBRE2 = 'Altavoces (Sound Blaster AE-7)';
  // e2c: la DDJ-400 con 4 canales (como la midió Oscar en Edge) y la Sound Blaster con 8; los demás, 2.
  const ID_DDJ = 'ddj40001', NOMBRE_DDJ = 'Línea (2- DDJ-400)';
  ACCue.maxPorId = { [ID_DDJ]: 4, [ID2]: 8 };
  const fuentes = (c) => c.nodos.filter((n) => n.clase === 'fuente');
  const gains = (c) => c.nodos.filter((n) => n.clase === 'gain');
  // Un motor con el master creado, una pista en A sonando desde el master t = 10 (cero = 10) y la salida
  // elegida. Relojes: master en 50 (posición 40), cue en 3.
  // (e2c: `salida` = [id, nombre, opciones] de fijarSalidaCue; por defecto los auriculares, sin opciones.)
  const armar = async ({ modo = { tipo: 'resuelve' }, opciones = {}, activar = true, salida = [ID, NOMBRE] } = {}) => {
    ACCue.modo = modo;
    const m = crearMotor(opciones);
    const cm = m.asegurarContexto();
    const buf = { duration: 240 };
    m.decks.A.cargarBuffer(buf);
    cm.currentTime = 10;
    m.decks.A.play();
    cm.currentTime = 50; cm.ots = { contextTime: 49.958, performanceTime: 120000 };
    await m.fijarSalidaCue(...salida);
    let cc = null;
    if (activar) {
      m.fijarCue('A', true);
      cc = m.contextoCue();
      if (cc) { cc.currentTime = 3; cc.ots = { contextTime: 2.95, performanceTime: 120010 }; }
      await listo();
    }
    return { m, cm, cc, buf };
  };
  // Lo que tiene que dar planCue con esos relojes (cue.js, probado en e1).
  const esperado = (desfaseMs, cc, cm, cero = 10, duracion = 240) => {
    const k = offsetRelojes({ salidaMaster: cm.getOutputTimestamp(), salidaCue: cc.getOutputTimestamp(), tiempoMaster: cm.currentTime, tiempoCue: cc.currentTime });
    return planCue({ cero, K: k.K, desfaseMs, cuandoCue: cc.currentTime + GUARDA_CUE, duracion });
  };
  try {
    // Antes de activar un cue no hay contexto de cue: 0 al crear el motor, 1 (el master) al cargar,
    // y elegir la salida sólo la guarda.
    {
      ACCue.modo = { tipo: 'resuelve' };
      const n0 = creados.length;
      const m = crearMotor();
      const alCrear = creados.length - n0;
      m.asegurarContexto();
      const alCargar = creados.length - n0;
      const r = await m.fijarSalidaCue(ID, NOMBRE);
      const e = m.cue();
      ok('motor_cue_sin_contexto_antes_de_activar', alCrear === 0 && alCargar === 1 && creados.length - n0 === 1 && r.ok === true && m.contextoCue() === null
        && e.estado === 'lista' && e.salida === ID && e.nombre === NOMBRE && e.activo.A === false && e.volumen === 0.5 && e.desfaseMs === 0 && e.aviso === null, { alCrear, alCargar, r, e });
      m.cerrar();
    }
    // e4a: abrirSalidaCue() abre la salida elegida SIN contexto (la restaurada) con UN setSinkId; sin salida, ya
    // abierta o en 'error' no hace nada. Cuenta contextos de cue (los creados con sinkId en las opciones).
    const contextosCue = (n0) => creados.slice(n0).filter((c) => c.opciones && 'sinkId' in c.opciones);
    {
      ACCue.modo = { tipo: 'resuelve' };
      const n0 = creados.length;
      const m = crearMotor();
      m.asegurarContexto();
      const sinSalida = await m.abrirSalidaCue();
      const ctxSinSalida = contextosCue(n0).length;
      await m.fijarSalidaCue(ID, NOMBRE, { canales: '1-2' });
      const antes = { ctx: contextosCue(n0).length, estado: m.cue().estado };
      const r = await m.abrirSalidaCue(); await listo();
      const cc = contextosCue(n0);
      const e = m.cue();
      const otra = await m.abrirSalidaCue();
      const tras = contextosCue(n0);
      ok('motor_cue_abrir_salida_pendiente', sinSalida.ok === false && sinSalida.error === 'nada' && ctxSinSalida === 0 && antes.ctx === 0 && antes.estado === 'lista'
        && r.ok === true && cc.length === 1 && JSON.stringify(cc[0].sinks) === JSON.stringify([ID]) && e.estado === 'lista' && m.contextoCue() === cc[0]
        && e.activo.A === false && e.activo.B === false && otra.ok === false && otra.error === 'nada' && tras.length === 1 && tras[0].sinks.length === 1,
      { sinSalida, ctxSinSalida, antes, r, e, sinks: cc.map((c) => c.sinks), otra });
      m.cerrar();
    }
    // abrirSalidaCue y fijarCue en el MISMO gesto, en los dos órdenes: UN contexto y UN setSinkId; el cue queda activo.
    // Y en 'error' (la salida falló) abrirSalidaCue no reintenta.
    {
      const orden = async (primeroCargar) => {
        ACCue.modo = { tipo: 'resuelve' };
        const n0 = creados.length;
        const m = crearMotor();
        m.asegurarContexto();
        await m.fijarSalidaCue(ID, NOMBRE);
        if (primeroCargar) { m.abrirSalidaCue(); m.fijarCue('A', true); } else { m.fijarCue('A', true); m.abrirSalidaCue(); }
        await listo(); await listo();
        const cc = contextosCue(n0);
        const res = { ctx: cc.length, sinks: cc.reduce((s, c) => s + c.sinks.length, 0), estado: m.cue().estado, A: m.cue().activo.A };
        m.cerrar();
        return res;
      };
      const a = await orden(true), b = await orden(false);
      ACCue.modo = { tipo: 'rechaza', name: 'NotFoundError' };
      const n0 = creados.length;
      const m = crearMotor();
      m.asegurarContexto();
      await m.fijarSalidaCue(ID, NOMBRE, { abrir: true });
      const enError = m.cue().estado;
      const ctx0 = contextosCue(n0).length;
      const r = await m.abrirSalidaCue();
      const ctx1 = contextosCue(n0).length;
      m.cerrar();
      ACCue.modo = { tipo: 'resuelve' };
      ok('motor_cue_abrir_salida_y_fijarcue_no_se_pisan', [a, b].every((x) => x.ctx === 1 && x.sinks === 1 && x.estado === 'lista' && x.A === true)
        && enError === 'error' && r.ok === false && r.error === 'nada' && ctx1 === ctx0, { a, b, enError, r, ctx0, ctx1 });
    }
    // fijarSalidaCue sólo acepta un string no vacío (o null); fijarCue sin salida o con otro lado → false.
    {
      const n0 = creados.length;
      const m = crearMotor();
      m.asegurarContexto();
      const sinSalida = m.fijarCue('A', true);
      const malas = await Promise.all(['', 42, undefined, {}, ['x']].map((v) => m.fijarSalidaCue(v)));
      const tras = m.cue();
      await m.fijarSalidaCue(ID, NOMBRE);
      const otroLado = m.fijarCue('C', true);
      const rNull = await m.fijarSalidaCue(null);
      const e = m.cue();
      ok('motor_cue_fijar_salida_valida', sinSalida === false && malas.every((r) => r.ok === false && r.error === 'valor-invalido') && tras.estado === 'sin-salida' && tras.salida === null
        && otroLado === false && rNull.ok === true && e.estado === 'sin-salida' && e.salida === null && e.nombre === '' && creados.length - n0 === 1 && m.contextoCue() === null, { malas, e });
      m.cerrar();
    }
    // Al activar: el 2.º contexto se crea EN EL MISMO clic con sinkId { type: 'none' }, 44 100 e
    // 'interactive'; setSinkId con el id elegido; NO crea nodos hasta que vuelve a 'running'.
    {
      const { m, cm } = await armar({ modo: { tipo: 'resuelve', vuelve: false }, activar: false });
      const n0 = creados.length;
      const act = m.fijarCue('A', true);
      const cc = m.contextoCue();
      const enElClic = { creados: creados.length - n0, estado: m.cue().estado };
      await listo();
      const antesDeRunning = { estado: m.cue().estado, state: cc?.state, gains: cc ? gains(cc).length : null, fuentes: cc ? fuentes(cc).length : null };
      cc?.ponerEstado('running');
      await listo();
      ok('motor_cue_none_y_setSinkId', act === true && enElClic.creados === 1 && enElClic.estado === 'abriendo' && !!cc && cc !== cm
        && JSON.stringify(cc.opciones) === JSON.stringify({ sampleRate: 44100, latencyHint: 'interactive', sinkId: { type: 'none' } })
        && JSON.stringify(cc.sinks) === JSON.stringify([ID]) && antesDeRunning.estado === 'abriendo' && antesDeRunning.state === 'suspended' && antesDeRunning.gains === 0
        && antesDeRunning.fuentes === 0 && m.cue().estado === 'lista' && gains(cc).length === 3 && fuentes(cc).length === 1, { opciones: cc?.opciones, sinks: cc?.sinks, enElClic, antesDeRunning, estado: m.cue().estado });
      m.cerrar();
    }
    // Grafo del cue: fuente ─ cueA ─ cueVol ─ destination, todo en el contexto de cue, sin biquad y sin
    // ninguna conexión con el master (PRE-fader); la fuente usa el MISMO AudioBuffer del deck.
    const { m, cm, cc, buf } = await armar();
    {
      const f = fuentes(cc).at(-1);
      const cadena = []; for (let x = f, i = 0; x && i < 6; x = x.salidas[0], i++) cadena.push(x);
      const cruzadas = [...cc.nodos.flatMap((n) => n.salidas.filter((d) => d.context !== cc)), ...cm.nodos.flatMap((n) => n.salidas.filter((d) => d.context !== cm))];
      ok('motor_cue_pre_fader', !!f && cadena.map((x) => x.clase).join(' → ') === 'fuente → gain → gain → destination' && cadena.every((x) => x.context === cc)
        && cadena[3] === cc.destination && cc.nodos.every((n) => n.clase !== 'biquad') && cruzadas.length === 0 && gains(cc).length === 3,
      { cadena: cadena.map((x) => `${x.clase}@${x.context === cc ? 'cue' : 'master'}`), cruzadas: cruzadas.length });
      ok('motor_cue_mismo_buffer', !!f && f.buffer === buf && fuentes(cm).at(-1).buffer === buf, {});
      // start(when, offset) = planCue con los relojes falsos: K por getOutputTimestamp.
      const e0 = esperado(0, cc, cm);
      ok('motor_cue_start_segun_planCue', !!f && f.inicios.length === 1 && e0.crear && cerca(f.inicios[0][0], e0.cuando) && cerca(f.inicios[0][1], e0.offset)
        && cerca(e0.offset, 40.043, 1e-9) && cerca(e0.cuando, 3.025), { inicio: f?.inicios, e0 });
    }
    // Desfase: + atrasa (offset menor), − adelanta; mismo instante; se resincroniza YA.
    {
      const base = esperado(0, cc, cm);
      const n0 = fuentes(cc).length;
      const r1 = m.fijarDesfaseCue(100);
      const f1 = fuentes(cc).at(-1).inicios[0];
      const r2 = m.fijarDesfaseCue(-100);
      const f2 = fuentes(cc).at(-1).inicios[0];
      ok('motor_cue_desfase_mas_atrasa_menos_adelanta', r1 && r2 && fuentes(cc).length === n0 + 2 && cerca(f1[0], base.cuando) && cerca(f2[0], base.cuando)
        && cerca(base.offset - f1[1], 0.1) && cerca(f2[1] - base.offset, 0.1) && m.cue().desfaseMs === -100, { base, f1, f2 });
      const rec = [m.fijarDesfaseCue(400), m.cue().desfaseMs, m.fijarDesfaseCue(-999), m.cue().desfaseMs, m.fijarDesfaseCue(12.6), m.cue().desfaseMs];
      const n1 = fuentes(cc).length;
      const malas = [m.fijarDesfaseCue(NaN), m.fijarDesfaseCue('12'), m.fijarDesfaseCue(undefined), m.fijarDesfaseCue(Infinity)];
      ok('motor_cue_desfase_recorte_y_basura', JSON.stringify(rec) === JSON.stringify([true, 250, true, -250, true, 13]) && malas.every((x) => x === false)
        && m.cue().desfaseMs === 13 && fuentes(cc).length === n1 && cerca(fuentes(cc).at(-1).inicios[0][1], base.offset - 0.013), { rec, malas });
      m.fijarDesfaseCue(0);
    }
    // Volumen de cue: v², 0,25 inicial (la única escritura de .value), rampas con TAU; basura → false.
    const [cueA, , cueVol] = (() => { const g = gains(cc); const vol = g.find((x) => x.salidas[0] === cc.destination); const ab = g.filter((x) => x !== vol); return [ab[0], ab[1], vol]; })();
    {
      const ini = { v: cueVol.gain.value, escr: cueVol.gain.escrituras };
      cc.currentTime = 4;
      const r = [m.fijarVolumenCue(0.8), m.fijarVolumenCue(NaN), m.fijarVolumenCue('1'), m.fijarVolumenCue(2)];
      const rampas = cueVol.gain.rampas.slice(-2);
      ok('motor_cue_volumen_v2', ini.v === 0.25 && ini.escr === 1 && JSON.stringify(r) === JSON.stringify([true, false, false, true]) && cerca(rampas[0].v, 0.64) && rampas[0].t === 4
        && rampas[0].tau === TAU && rampas[1].v === 1 && m.cue().volumen === 1, { ini, r, rampas });
      m.fijarVolumenCue(0.5);
    }
    // Apagar: rampa a 0 con TAU y stop(currentTime + 6·TAU); volver a activar: rampa a 1 y fuente nueva
    // (la vieja se para de golpe).
    {
      cc.currentTime = 7;
      const fAntes = fuentes(cc).at(-1);
      const n0 = fuentes(cc).length;
      const r = m.fijarCue('A', false);
      const rOff = cueA.gain.rampas.at(-1);
      const tras = { n: fuentes(cc).length, paradas: [...fAntes.paradas] };
      const r2 = m.fijarCue('A', true);
      const rOn = cueA.gain.rampas.at(-1);
      ok('motor_cue_apagar_rampa_y_stop', r && rOff.v === 0 && rOff.t === 7 && rOff.tau === TAU && tras.n === n0 && tras.paradas.length === 1 && cerca(tras.paradas[0], 7 + 6 * TAU)
        && m.cue().activo.A === true && r2 && rOn.v === 1 && rOn.tau === TAU && fuentes(cc).length === n0 + 1 && fAntes.paradas.length === 2 && fAntes.paradas[1] === undefined && fAntes.desconexiones >= 1,
      { rOff, tras, rOn, paradas: fAntes.paradas });
    }
    // Resincroniza (una fuente nueva por evento) en play, seek, «Al inicio», activar, desfase, cambio de
    // salida y vuelta a 'running'; pausa no crea.
    {
      const n = () => fuentes(cc).length;
      const pasos = {};
      let k = n();
      const paso = (nombre) => { pasos[nombre] = n() - k; k = n(); };
      m.decks.A.pausa(); paso('pausa');
      m.decks.A.play(); paso('play');
      m.decks.A.seek(30); paso('seek');
      m.decks.A.alInicio(); paso('alInicio');
      m.fijarCue('A', false); m.fijarCue('A', true); paso('activar');
      m.fijarDesfaseCue(5); paso('desfase');
      const rs = await m.fijarSalidaCue(ID2, NOMBRE2); await listo(); paso('salida');
      cc.ponerEstado('suspended'); paso('suspended');
      cc.ponerEstado('running'); paso('running');
      ok('motor_cue_resincroniza_en_eventos', JSON.stringify(pasos) === JSON.stringify({ pausa: 0, play: 1, seek: 1, alInicio: 1, activar: 1, desfase: 1, salida: 1, suspended: 0, running: 1 })
        && rs.ok === true && JSON.stringify(cc.sinks) === JSON.stringify([ID, ID2]) && m.contextoCue() === cc && m.cue().salida === ID2 && m.cue().nombre === NOMBRE2, { pasos, rs, sinks: cc.sinks });
      m.fijarDesfaseCue(0);
    }
    // NUNCA en continuo: pasa el tiempo, se mueven los relojes y la mezcla, y no aparece ninguna fuente.
    {
      const n0 = fuentes(cc).length;
      await espera(40);
      cm.currentTime = 80; cc.currentTime = 33;
      m.fijarVolumen('A', 0.3); m.fijarCrossfader(0.9); m.fijarFiltro(0.4); m.fijarVolumen('B', 0.2);
      await espera(40);
      ok('motor_cue_sin_resincronizacion_continua', fuentes(cc).length === n0, { n0, n: fuentes(cc).length });
    }
    // Pausa y fin del deck: la fuente de cue se para de golpe y no se crea otra; con el deck en pausa,
    // activar el cue no crea fuente.
    {
      const f0 = fuentes(cc).at(-1);
      m.decks.A.pausa();
      const n0 = fuentes(cc).length;
      m.fijarCue('A', false); m.fijarCue('A', true);
      const enPausa = fuentes(cc).length - n0;
      m.decks.A.play();
      const f1 = fuentes(cc).at(-1);
      fuentes(cm).at(-1).onended();   // la fuente del master llega al final
      ok('motor_cue_pausa_y_fin_quitan_la_fuente', f0.paradas.includes(undefined) && f0.desconexiones >= 1 && enPausa === 0 && f1 !== f0 && f1.paradas.includes(undefined)
        && f1.desconexiones >= 1 && fuentes(cc).length === n0 + 1 && m.decks.A.estado().sonando === false, { enPausa, p0: f0.paradas, p1: f1.paradas });
      cm.currentTime = 50; m.decks.A.seek(40); m.decks.A.play();
    }
    // Los nodos del cue no reciben escrituras de .value después de crearlos.
    {
      const ps = gains(cc).map((g) => g.gain.escrituras);
      ok('motor_cue_sin_escrituras_value_tras_crear', ps.length === 3 && ps.every((x) => x === 1), { ps });
    }
    // Cerrar: los DOS contextos cerrados, sin oyentes en el de cue.
    {
      m.cerrar();
      ok('motor_cue_cerrar_cierra_los_dos', cm.state === 'closed' && cc.state === 'closed' && cc.cierres === 1 && m.contextoCue() === null && cc.oyentes() === 0, { cm: cm.state, cc: cc.state, oy: cc.oyentes() });
    }
    // Con el volumen elegido ANTES de abrir el cue, ése es el inicial del nodo. (Cada motor nuevo que crea
    // su contexto cierra al anterior —duenoActual—, así que estos van después de cerrar el principal.)
    {
      const otro = await armar({ activar: false });
      otro.m.fijarVolumenCue(0.6);
      otro.m.fijarCue('A', true); await listo();
      const occ = otro.m.contextoCue();
      const ovol = gains(occ).find((x) => x.salidas[0] === occ.destination);
      ok('motor_cue_volumen_guardado_es_el_inicial', cerca(ovol.gain.value, 0.36, 1e-12) && ovol.gain.escrituras === 1 && ovol.gain.rampas.length === 0, { v: ovol.gain.value });
      otro.m.cerrar();
    }
    // setSinkId que rechaza (NotFoundError): estado 'error', aviso exacto, contexto de cue cerrado, y el
    // master igual (estado, nodos, mezcla, deck sonando).
    {
      const x = await armar({ modo: { tipo: 'rechaza', name: 'NotFoundError' }, activar: false });
      const antes = { state: x.cm.state, nodos: x.cm.nodos.length, mezcla: JSON.stringify(x.m.mezcla()), sonando: x.m.decks.A.estado().sonando, rampas: x.cm.nodos.filter((n) => n.gain).reduce((s, n) => s + n.gain.rampas.length, 0) };
      const act = x.m.fijarCue('A', true);
      const xc = x.m.contextoCue();
      await listo();
      const e = x.m.cue();
      const despues = { state: x.cm.state, nodos: x.cm.nodos.length, mezcla: JSON.stringify(x.m.mezcla()), sonando: x.m.decks.A.estado().sonando, rampas: x.cm.nodos.filter((n) => n.gain).reduce((s, n) => s + n.gain.rampas.length, 0) };
      ok('motor_cue_rechazo_apaga_y_no_toca_master', act === true && !!xc && JSON.stringify(xc.opciones?.sinkId) === JSON.stringify({ type: 'none' }) && e.estado === 'error'
        && e.aviso === 'No se encontró la salida «Headphones (Elgato Wave:XLR)». Cue apagado; el master sigue igual.' && xc.state === 'closed' && x.m.contextoCue() === null
        && e.activo.A === false && e.activo.B === false && xc.oyentes() === 0 && gains(xc).length === 0 && JSON.stringify(antes) === JSON.stringify(despues) && x.cm.sinks.length === 0,
      { e, xc: xc?.state, antes, despues });
      // Volver a activar con la salida aún elegida: otro intento (contexto nuevo).
      ACCue.modo = { tipo: 'resuelve' };
      const n0 = creados.length;
      x.m.fijarCue('A', true); await listo();
      ok('motor_cue_tras_error_se_puede_reintentar', creados.length - n0 === 1 && x.m.cue().estado === 'lista' && x.m.cue().aviso === null && x.m.contextoCue() !== xc, { e: x.m.cue() });
      x.m.cerrar();
    }
    // No vuelve a 'running' dentro del tope → error genérico (TimeoutError), contexto cerrado.
    {
      const x = await armar({ modo: { tipo: 'resuelve', vuelve: false }, opciones: { esperaCueMs: 30 }, activar: false });
      x.m.fijarCue('A', true);
      const xc = x.m.contextoCue();
      await espera(80);
      const e = x.m.cue();
      ok('motor_cue_no_llega_a_running', e.estado === 'error' && e.aviso === 'No se pudo abrir la salida de audífonos (TimeoutError). Cue apagado; el master sigue igual.'
        && xc.state === 'closed' && x.m.contextoCue() === null && gains(xc).length === 0 && x.cm.state === 'running', { e, xc: xc.state });
      x.m.cerrar();
    }
    // Dos setSinkId seguidos: gana el ÚLTIMO aunque el primero conteste después de pedido el segundo.
    {
      const x = await armar({ modo: { tipo: 'pendiente' }, activar: false });
      const n0 = creados.length;
      x.m.fijarCue('A', true);
      const xc = x.m.contextoCue();
      const p2 = x.m.fijarSalidaCue(ID2, NOMBRE2);
      const sinks = [...xc.sinks];
      xc.pendientes[0].resolver();
      await listo();
      const trasPrimero = { estado: x.m.cue().estado, gains: gains(xc).length };
      xc.pendientes[1].resolver();
      await listo();
      const r2 = await p2;
      ok('motor_cue_dos_setSinkId_gana_el_ultimo', creados.length - n0 === 1 && JSON.stringify(sinks) === JSON.stringify([ID, ID2]) && trasPrimero.estado === 'abriendo' && trasPrimero.gains === 0
        && r2.ok === true && x.m.cue().estado === 'lista' && x.m.cue().salida === ID2 && gains(xc).length === 3 && fuentes(xc).length === 1, { sinks, trasPrimero, r2, e: x.m.cue() });
      x.m.cerrar();
    }
    // cerrar() con un setSinkId pendiente: el contexto de cue se cierra y no queda ningún rechazo sin atrapar.
    {
      const x = await armar({ modo: { tipo: 'pendiente' }, activar: false });
      const s0 = sinAtrapar;
      x.m.fijarCue('A', true);
      const xc = x.m.contextoCue();
      let lanzo = null;
      try { x.m.cerrar(); } catch (e) { lanzo = String(e); }
      await espera(20);
      ok('motor_cue_cerrar_con_setSinkId_pendiente', lanzo === null && xc.state === 'closed' && x.cm.state === 'closed' && sinAtrapar === s0 && xc.pendientes.length === 0 && xc.oyentes() === 0,
        { lanzo, xc: xc.state, sinAtrapar: sinAtrapar - s0 });
    }
    // Un motor nuevo que crea su contexto cierra los DOS del anterior (duenoActual).
    {
      const x = await armar();
      const xc = x.m.contextoCue();
      const m2 = crearMotor();
      m2.asegurarContexto();
      ok('motor_cue_dueno_nuevo_cierra_los_dos', x.cm.state === 'closed' && xc.state === 'closed' && x.m.contextoCue() === null && m2.contexto().state === 'running', { cm: x.cm.state, cc: xc.state });
      m2.cerrar();
    }
    // sinkchange que no se pidió → cue apagado ('desconectada'); el de nuestro setSinkId se ignora.
    {
      const x = await armar();
      const xc = x.m.contextoCue();
      xc.emitir('sinkchange');   // sinkId === el pedido: es el nuestro
      const sigue = x.m.cue().estado;
      xc.sinkId = 'otro-id';
      xc.emitir('sinkchange');
      const e = x.m.cue();
      ok('motor_cue_sinkchange_no_pedido_apaga', sigue === 'lista' && e.estado === 'error' && e.aviso === 'Se desconectó «Headphones (Elgato Wave:XLR)». Cue apagado; el master sigue igual.'
        && xc.state === 'closed' && e.activo.A === false && x.cm.state === 'running' && x.m.decks.A.estado().sonando, { sigue, e });
      x.m.cerrar();
    }
    // 'error' y 'closed' inesperados → cue apagado con el mismo aviso; el master sigue.
    {
      const x = await armar();
      const xc = x.m.contextoCue();
      xc.emitir('error');
      const e1 = x.m.cue();
      ACCue.modo = { tipo: 'resuelve' };
      x.m.fijarCue('A', true); await listo();
      const yc = x.m.contextoCue();
      yc.ponerEstado('closed');
      const e2 = x.m.cue();
      const txt = 'Se desconectó «Headphones (Elgato Wave:XLR)». Cue apagado; el master sigue igual.';
      ok('motor_cue_error_y_closed_inesperados', e1.estado === 'error' && e1.aviso === txt && xc.state === 'closed' && yc !== xc && e2.estado === 'error' && e2.aviso === txt
        && x.m.contextoCue() === null && x.cm.state === 'running', { e1, e2 });
      x.m.cerrar();
    }
    // Los cambios de estado del cue avisan por suscribir(): abriendo → lista, activar, volumen, desfase.
    {
      const x = await armar({ activar: false });
      const vistos = [];
      x.m.suscribir(() => vistos.push(x.m.cue().estado));
      x.m.fijarCue('A', true);
      await listo();
      const n1 = vistos.length;
      x.m.fijarVolumenCue(0.3); x.m.fijarDesfaseCue(10);
      ok('motor_cue_notifica_por_suscribir', vistos.includes('abriendo') && vistos.includes('lista') && vistos.indexOf('abriendo') < vistos.lastIndexOf('lista') && vistos.length === n1 + 2, { vistos });
      x.m.cerrar();
    }
    // ── diagCue (sub-paso e2b) ──
    // Sin contexto de cue → null: motor recién creado, con el master y con la salida elegida (sólo guardada).
    {
      const m = crearMotor();
      const d0 = m.diagCue();
      m.asegurarContexto();
      const d1 = m.diagCue();
      await m.fijarSalidaCue(ID, NOMBRE);
      const d2 = m.diagCue();
      ok('motor_cue_diag_sin_contexto_null', d0 === null && d1 === null && d2 === null && m.contextoCue() === null, { d0, d1, d2 });
      m.cerrar();
    }
    // Con el cue lista: K = la de offsetRelojes con los relojes falsos (por getOutputTimestamp), deriva 0
    // justo tras sincronizar; si el timestamp falso del cue avanza 4 ms más que el del master, deriva −4 ms.
    // Y lo que dice cada contexto.
    {
      const x = await armar();
      const kEsp = offsetRelojes({ salidaMaster: x.cm.getOutputTimestamp(), salidaCue: x.cc.getOutputTimestamp(), tiempoMaster: x.cm.currentTime, tiempoCue: x.cc.currentTime });
      const d0 = x.m.diagCue();
      x.cc.ots = { contextTime: 2.95 + 0.004, performanceTime: 120010 };
      const d1 = x.m.diagCue();
      const fuentesAntes = fuentes(x.cc).length;
      ok('motor_cue_diag_K_y_deriva', !!d0 && d0.fuente === 'salida' && kEsp.fuente === 'salida' && cerca(d0.K, kEsp.K, 1e-12) && cerca(d0.K, 47.018, 1e-9)
        && cerca(d0.derivaMs, 0, 1e-9) && d0.desdeS >= 0 && d0.desdeS < 1
        && !!d1 && cerca(d1.K, kEsp.K - 0.004, 1e-9) && cerca(d1.derivaMs, -4, 1e-6) && d1.derivaMs !== 0
        && d0.contextos.master.state === 'running' && d0.contextos.master.sampleRate === 44100 && d0.contextos.master.sinkId === ''
        && d0.contextos.cue.state === 'running' && d0.contextos.cue.sampleRate === 44100 && d0.contextos.cue.sinkId === ID
        && fuentes(x.cc).length === fuentesAntes && x.m.cue().estado === 'lista', { kEsp, d0, d1 });
      // Después de cerrar() → null.
      x.m.cerrar();
      ok('motor_cue_diag_tras_cerrar_null', x.m.diagCue() === null && x.cc.state === 'closed', { cc: x.cc.state });
    }
    // Sin ninguna sincronización en ESTE contexto de cue (la del contexto anterior no cuenta): deriva y
    // desdeS null, K igual.
    {
      const x = await armar();
      const conSync = x.m.diagCue();
      await x.m.fijarSalidaCue(null);
      x.m.decks.A.pausa();
      await x.m.fijarSalidaCue(ID, NOMBRE);
      x.m.fijarCue('A', true);
      const yc = x.m.contextoCue();
      yc.currentTime = 3; yc.ots = { contextTime: 2.95, performanceTime: 120010 };
      await listo();
      const d = x.m.diagCue();
      ok('motor_cue_diag_sin_sincronizar_deriva_null', conSync?.derivaMs === 0 && yc !== x.cc && x.m.cue().estado === 'lista' && fuentes(yc).length === 0
        && !!d && d.derivaMs === null && d.desdeS === null && cerca(d.K, 47.018, 1e-9) && d.fuente === 'salida', { conSync, d });
      x.m.cerrar();
    }
    // Nunca lanza: con baseLatency/outputLatency/sinkId que lanzan al leerse y getOutputTimestamp roto, el
    // campo queda en null y K cae al respaldo currentTime (50 − 3).
    {
      const x = await armar();
      const boom = () => { throw new Error('leer en un contexto cerrado'); };
      for (const c of [x.cm, x.cc]) {
        Object.defineProperty(c, 'baseLatency', { configurable: true, get: boom });
        Object.defineProperty(c, 'outputLatency', { configurable: true, get: boom });
        c.getOutputTimestamp = boom;
      }
      Object.defineProperty(x.cc, 'sinkId', { configurable: true, get: boom });
      let lanzo = null, d = null;
      try { d = x.m.diagCue(); } catch (e) { lanzo = String(e); }
      ok('motor_cue_diag_no_lanza', lanzo === null && !!d && d.contextos.cue.baseLatency === null && d.contextos.master.baseLatency === null
        && d.contextos.cue.outputLatency === null && d.contextos.cue.sinkId === null && d.contextos.cue.state === 'running'
        && d.fuente === 'currentTime' && cerca(d.K, 47, 1e-12) && cerca(d.derivaMs, (47 - 47.018) * 1000, 1e-6), { lanzo, d });
      x.m.cerrar();
    }
    // ── Canales 3-4 (sub-paso e2c) ──
    const x34 = (extra = {}) => armar({ salida: [ID_DDJ, NOMBRE_DDJ, { canales: '3-4' }], ...extra });
    const escrituras = (c) => c.eventos.filter((e) => e[0] === 'channelCount' || e[0] === 'channelInterpretation');
    // cueVol = el Gain al que se conectan cueA y cueB (dos conexiones desde un Gain).
    const volDe = (c) => gains(c).find((g) => c.conexiones.filter((k) => k.a === g && k.de.clase === 'gain').length === 2) ?? null;
    // Sin opciones, o con '1-2' (también null), el cue es el de siempre: cueVol ─ destination, sin
    // splitter ni merger y SIN una sola escritura en el destination, aunque la salida tenga 4 canales.
    {
      const res = [];
      for (const salida of [[ID, NOMBRE], [ID_DDJ, NOMBRE_DDJ], [ID_DDJ, NOMBRE_DDJ, { canales: '1-2' }], [ID_DDJ, NOMBRE_DDJ, null]]) {
        const x = await armar({ salida });
        const v = volDe(x.cc);
        res.push({
          canales: x.m.cue().canales, estado: x.m.cue().estado, escr: escrituras(x.cc).length, cuenta: x.cc.destination.channelCount, interp: x.cc.destination.channelInterpretation,
          volA: v ? v.salidas.map((n) => n.clase).join() : null, aDestino: x.cc.conexiones.filter((k) => k.a === x.cc.destination).map((k) => k.de.clase).join(),
          clases: [...new Set(x.cc.nodos.map((n) => n.clase))].sort().join(),
        });
        x.m.cerrar();
      }
      ok('motor_cue_canales_por_defecto_igual', res.every((r) => r.canales === '1-2' && r.estado === 'lista' && r.escr === 0 && r.cuenta === 2 && r.interp === 'speakers'
        && r.volA === 'destination' && r.aDestino === 'gain' && r.clases === 'destination,fuente,gain'), { res });
    }
    // `opciones` inválidas → 'valor-invalido' y no cambia nada (ni canales, ni setSinkId, ni el destination).
    {
      const x = await armar({ salida: [ID_DDJ, NOMBRE_DDJ] });
      const s0 = x.cc.sinks.length;
      const malas = await Promise.all([{ canales: '5-6' }, { canales: 34 }, { canales: '3-4 ' }, { canales: null }, '3-4', ['3-4'], 7].map((o) => x.m.fijarSalidaCue(ID_DDJ, NOMBRE_DDJ, o)));
      const e = x.m.cue();
      ok('motor_cue_canales_valor_invalido', malas.every((r) => r.ok === false && r.error === 'valor-invalido') && e.canales === '1-2' && e.estado === 'lista'
        && x.cc.sinks.length === s0 && escrituras(x.cc).length === 0 && x.m.contextoCue() === x.cc, { malas, e });
      x.m.cerrar();
    }
    // '3-4' en la DDJ (4 canales): cueVol → adaptador → splitter(2) → merger(4) en las entradas 2 y 3 (0 y 1
    // vacías) → destination con 4 canales 'discrete'; el orden; el adaptador; y diagCue.
    {
      const x = await x34();
      const c = x.cc, d = c.destination;
      const vol = volDe(c);
      const de = (n) => c.conexiones.filter((k) => k.de === n);
      const ad = vol ? de(vol)[0]?.a : null;
      const sp = ad ? de(ad)[0]?.a : null;
      const mg = sp ? de(sp)[0]?.a : null;
      const spSal = sp ? de(sp).map((k) => [k.a.clase, k.o, k.i]) : [];
      const alMerger = c.conexiones.filter((k) => k.a === mg).map((k) => k.i).sort();
      const alDestino = c.conexiones.filter((k) => k.a === d).map((k) => k.de.clase);
      ok('motor_cue_canales_34_grafo', x.m.cue().estado === 'lista' && x.m.cue().canales === '3-4' && !!vol && de(vol).length === 1 && ad?.clase === 'gain' && sp?.clase === 'splitter' && sp.n === 2
        && mg?.clase === 'merger' && mg.n === 4 && JSON.stringify(spSal) === JSON.stringify([['merger', 0, 2], ['merger', 1, 3]]) && JSON.stringify(alMerger) === '[2,3]'
        && JSON.stringify(de(mg).map((k) => [k.a.clase, k.o, k.i])) === JSON.stringify([['destination', 0, 0]]) && JSON.stringify(alDestino) === '["merger"]'
        && d.channelCount === 4 && d.channelInterpretation === 'discrete' && fuentes(c).length === 1,
      { spSal, alMerger, alDestino, cuenta: d.channelCount, interp: d.channelInterpretation });
      // Orden: setSinkId → (running) channelCount 4 y 'discrete' → recién entonces la 1.ª conexión al destination.
      const ev = c.eventos.map((e) => e.join(':'));
      const iCuenta = ev.indexOf('channelCount:4:running'), iInterp = ev.indexOf('channelInterpretation:discrete:running');
      const iCon = ev.findIndex((e) => e.startsWith('conectar-destino'));
      ok('motor_cue_canales_34_orden', ev[0] === `setSinkId:${ID_DDJ}:running` && iCuenta > 0 && iInterp > 0 && iCon > iCuenta && iCon > iInterp
        && ev.filter((e) => e.startsWith('conectar-destino')).length === 1, { ev });
      // El adaptador: 2 canales 'explicit' 'speakers' (una pista mono suena en los dos oídos), sin escribir .value.
      ok('motor_cue_canales_34_mono_a_los_dos', ad?.clase === 'gain' && !!ad.gain && ad.channelCount === 2 && ad.channelCountMode === 'explicit' && ad.channelInterpretation === 'speakers'
        && ad.gain.escrituras === 0 && ad.gain.value === 1 && ad.gain.rampas.length === 0, { ad: ad ? { clase: ad.clase, cuenta: ad.channelCount, modo: ad.channelCountMode, interp: ad.channelInterpretation, escr: ad.gain?.escrituras ?? null } : null });
      const dg = x.m.diagCue();
      ok('motor_cue_diag_canales', !!dg && dg.canales === '3-4' && dg.contextos.cue.channelCount === 4 && dg.contextos.cue.maxChannelCount === 4 && dg.contextos.cue.channelInterpretation === 'discrete'
        && dg.contextos.master.channelCount === 2 && dg.contextos.master.maxChannelCount === 2 && dg.contextos.master.channelInterpretation === 'speakers', { dg });
      x.m.cerrar();
    }
    // '3-4' en una salida de 2 canales: fallo controlado ANTES de escribir el destination (con un setter que
    // recorta sin lanzar, sin el chequeo el cue quedaría «andando» en canales que no existen).
    {
      ACCue.setter = 'recorta';
      const s0 = sinAtrapar;
      const x = await armar({ salida: [ID, NOMBRE, { canales: '3-4' }], activar: false });
      const foto = () => JSON.stringify({ mezcla: x.m.mezcla(), nodos: x.cm.nodos.length, state: x.cm.state, sinks: x.cm.sinks.length, escr: escrituras(x.cm).length });
      const antes = foto();
      let lanzo = null, act = null;
      try { act = x.m.fijarCue('A', true); } catch (e) { lanzo = String(e); }
      const xc = x.m.contextoCue();
      await listo(); await espera(5);
      const e = x.m.cue();
      ACCue.setter = 'lanza';
      ok('motor_cue_canales_34_sin_4_falla', lanzo === null && act === true && !!xc && e.estado === 'error'
        && e.aviso === 'La salida «Headphones (Elgato Wave:XLR)» no tiene canales 3-4. Cue apagado; el master sigue igual.' && e.activo.A === false
        && xc.state === 'closed' && x.m.contextoCue() === null && escrituras(xc).length === 0 && !xc.nodos.some((n) => n.clase === 'merger')
        && foto() === antes && x.m.decks.A.estado().sonando && sinAtrapar === s0, { e, xc: xc?.state, ev: xc?.eventos.map((v) => v.join(':')), antes, despues: foto() });
      x.m.cerrar();
    }
    // Si el setter lanza aunque maxChannelCount diga 4: aviso genérico con el name (IndexSizeError), cerrado.
    {
      ACCue.setter = 'lanza-siempre';
      const x = await x34();
      const e = x.m.cue();
      ACCue.setter = 'lanza';
      ok('motor_cue_canales_34_setter_lanza', e.estado === 'error' && e.aviso === 'No se pudo abrir la salida de audífonos (IndexSizeError). Cue apagado; el master sigue igual.'
        && x.cc.state === 'closed' && x.m.contextoCue() === null && x.cm.state === 'running' && escrituras(x.cm).length === 0, { e });
      x.m.cerrar();
    }
    // En caliente sobre la misma salida: '1-2' → '3-4' y vuelta. Sólo se rearma la etapa: sin setSinkId, sin
    // contexto nuevo, sin fuentes nuevas (no resincroniza) y sin tocar el master.
    {
      const x = await armar({ salida: [ID_DDJ, NOMBRE_DDJ] });
      const c = x.cc, vol = volDe(c);
      const foto = () => ({ sinks: c.sinks.length, creados: creados.length, fuentes: fuentes(c).length, inicios: JSON.stringify(fuentes(c).map((f) => f.inicios)), cm: x.cm.eventos.length + ':' + x.cm.nodos.length, mezcla: JSON.stringify(x.m.mezcla()) });
      const antes = foto();
      const dVol = vol.desconexiones, n0 = c.conexiones.length;
      const r = await x.m.fijarSalidaCue(ID_DDJ, NOMBRE_DDJ, { canales: '3-4' });
      const nuevas = c.conexiones.slice(n0).map((k) => [k.de.clase, k.a.clase, k.o, k.i]);
      ok('motor_cue_canales_caliente_12_a_34', r.ok === true && x.m.cue().canales === '3-4' && x.m.cue().estado === 'lista' && x.m.contextoCue() === c
        && JSON.stringify(foto()) === JSON.stringify(antes) && vol.desconexiones === dVol + 1
        && JSON.stringify(nuevas) === JSON.stringify([['gain', 'gain', 0, 0], ['gain', 'splitter', 0, 0], ['splitter', 'merger', 0, 2], ['splitter', 'merger', 1, 3], ['merger', 'destination', 0, 0]])
        && c.destination.channelCount === 4 && c.destination.channelInterpretation === 'discrete', { r, nuevas, antes, despues: foto() });
      const ad = c.conexiones[n0 + 1]?.de, sp = c.conexiones[n0 + 2]?.de, mg = c.conexiones[n0 + 4]?.de;
      const d1 = [ad, sp, mg, vol].map((n) => n?.desconexiones ?? -1);
      const n1 = c.conexiones.length;
      const r2 = await x.m.fijarSalidaCue(ID_DDJ, NOMBRE_DDJ);   // sin opciones = '1-2'
      const nuevas2 = c.conexiones.slice(n1).map((k) => [k.de.clase, k.a.clase]);
      ok('motor_cue_canales_caliente_34_a_12', r2.ok === true && x.m.cue().canales === '1-2' && x.m.cue().estado === 'lista'
        && JSON.stringify([ad, sp, mg, vol].map((n) => n?.desconexiones ?? -1)) === JSON.stringify(d1.map((v) => v + 1))
        && JSON.stringify(nuevas2) === JSON.stringify([['gain', 'destination']]) && c.destination.channelCount === 2 && c.destination.channelInterpretation === 'speakers'
        && JSON.stringify(foto()) === JSON.stringify(antes), { r2, nuevas2, d1 });
      x.m.cerrar();
    }
    // Con '3-4', cambiar a OTRA salida: el destination vuelve a 2 canales 'speakers' ANTES del setSinkId y se
    // vuelve a mirar maxChannelCount: unos auriculares de 2 canales fallan; la Sound Blaster (8) arma.
    {
      const x = await x34();
      const c = x.cc;
      ACCue.setter = 'recorta';
      const ev0 = c.eventos.length;
      const r = await x.m.fijarSalidaCue(ID, NOMBRE, { canales: '3-4' });
      await listo();
      const ev = c.eventos.slice(ev0).map((e) => e.slice(0, 2).join(':'));
      const e = x.m.cue();
      ACCue.setter = 'lanza';
      x.m.cerrar();
      const y = await x34();
      const r2 = await y.m.fijarSalidaCue(ID2, NOMBRE2, { canales: '3-4' });
      await listo();
      const e2 = y.m.cue();
      ok('motor_cue_canales_otra_salida_rechequea', r.ok === false && r.error === 'sin-canales-3-4' && e.estado === 'error'
        && e.aviso === 'La salida «Headphones (Elgato Wave:XLR)» no tiene canales 3-4. Cue apagado; el master sigue igual.'
        && JSON.stringify(ev) === JSON.stringify(['channelCount:2', 'channelInterpretation:speakers', `setSinkId:${ID}`]) && c.state === 'closed'
        && r2.ok === true && e2.estado === 'lista' && e2.salida === ID2 && y.cc.destination.channelCount === 4 && y.cc.destination.channelInterpretation === 'discrete' && y.m.contextoCue() === y.cc,
      { r, ev, e, r2, e2 });
      y.m.cerrar();
    }
    // K, planCue y la resincronización no cambian con '3-4': mismo start(when, offset) que con '1-2' y que planCue.
    {
      const a = await armar({ salida: [ID_DDJ, NOMBRE_DDJ] });
      const ia = fuentes(a.cc).map((f) => f.inicios);
      a.m.cerrar();
      const b = await x34();
      const ib = fuentes(b.cc).map((f) => f.inicios);
      const e0 = esperado(0, b.cc, b.cm);
      ok('motor_cue_canales_planCue_igual', ia.length === 1 && JSON.stringify(ia) === JSON.stringify(ib) && e0.crear && cerca(ib[0][0][0], e0.cuando) && cerca(ib[0][0][1], e0.offset), { ia, ib, e0 });
      b.m.cerrar();
    }
    // fijarSalidaCue(null) vuelve los canales a '1-2'; una salida nueva sin opciones también es '1-2'.
    {
      const x = await x34();
      await x.m.fijarSalidaCue(null);
      const e1 = x.m.cue();
      await x.m.fijarSalidaCue(ID_DDJ, NOMBRE_DDJ);
      const e2 = x.m.cue();
      ok('motor_cue_canales_null_resetea', e1.canales === '1-2' && e1.estado === 'sin-salida' && e2.canales === '1-2' && e2.estado === 'lista' && x.cc.state === 'closed' && x.m.contextoCue() === null, { e1, e2 });
      x.m.cerrar();
    }
    // ── e3a: fijarSalidaCue(id, nombre, { abrir: true }) abre el contexto de cue al ELEGIR la salida ──
    // Un motor con el master creado y A sonando (como armar, sin elegir salida todavía).
    const conMaster = () => {
      const m = crearMotor();
      const cm = m.asegurarContexto();
      m.decks.A.cargarBuffer({ duration: 240 });
      cm.currentTime = 10;
      m.decks.A.play();
      cm.currentTime = 50;
      return { m, cm };
    };
    // Lo que el cue NO debe tocar del master: sus setSinkId, estado y cada AudioParam (valor, escrituras y rampas).
    const fotoMaster = (cm) => JSON.stringify({ sinks: cm.sinks, state: cm.state, params: cm.nodos.map((n) => [n.clase, ...['gain', 'frequency', 'Q'].map((k) => (n[k] ? [n[k].value, n[k].escrituras, n[k].rampas.length] : null))]) });
    // abrir: el contexto de cue se crea EN LA LLAMADA (dentro del clic) con sinkId { type: 'none' }, UN setSinkId
    // con el id, y la promesa resuelve con 'lista' y el contexto abierto; ningún cue activo, sin fuentes de cue,
    // cueA/cueB en 0 (sin rampas) y cueVol al destination.
    {
      ACCue.modo = { tipo: 'resuelve' };
      const n0 = creados.length;
      const { m, cm } = conMaster();
      const p = m.fijarSalidaCue(ID, NOMBRE, { abrir: true });
      const cc = m.contextoCue();
      const enLaLlamada = { creados: creados.length - n0, estado: m.cue().estado };
      const r = await p;
      const e = m.cue();
      const g = cc ? gains(cc) : [];
      const vol = g.find((n) => n.salidas.includes(cc?.destination));
      const AB = g.filter((n) => n !== vol);
      ok('motor_cue_abrir_crea_contexto', r.ok === true && enLaLlamada.creados === 2 && enLaLlamada.estado === 'abriendo' && !!cc && cc !== cm
        && JSON.stringify(cc.opciones) === JSON.stringify({ sampleRate: 44100, latencyHint: 'interactive', sinkId: { type: 'none' } })
        && JSON.stringify(cc.sinks) === JSON.stringify([ID]) && cc.state === 'running' && m.contextoCue() === cc && e.estado === 'lista' && e.salida === ID && e.nombre === NOMBRE
        && e.canales === '1-2' && e.activo.A === false && e.activo.B === false && e.aviso === null && fuentes(cc).length === 0 && g.length === 3 && !!vol
        && AB.length === 2 && AB.every((n) => n.gain.value === 0 && n.gain.rampas.length === 0) && cm.sinks.length === 0,
      { r, enLaLlamada, sinks: cc?.sinks, e, fuentes: cc ? fuentes(cc).length : null, gains: g.length, AB: AB.map((n) => [n.gain.value, n.gain.rampas.length]) });
      m.cerrar();
    }
    // abrir con '3-4' en la DDJ-400: la etapa se arma ya (destination a 4 canales 'discrete'), con un solo setSinkId.
    {
      ACCue.modo = { tipo: 'resuelve' };
      const { m } = conMaster();
      const r = await m.fijarSalidaCue(ID_DDJ, NOMBRE_DDJ, { canales: '3-4', abrir: true });
      const cc = m.contextoCue();
      ok('motor_cue_abrir_34_arma_la_etapa', r.ok === true && !!cc && m.cue().estado === 'lista' && m.cue().canales === '3-4' && JSON.stringify(cc.sinks) === JSON.stringify([ID_DDJ])
        && cc.destination.channelCount === 4 && cc.destination.channelInterpretation === 'discrete' && fuentes(cc).length === 0,
      { r, sinks: cc?.sinks, cuenta: cc?.destination.channelCount, interp: cc?.destination.channelInterpretation });
      m.cerrar();
    }
    // abrir con una salida que falla (NotFoundError): 'error' con el aviso de textoAviso, contexto de cue cerrado
    // y el master intacto (sin setSinkId, mismo estado, mismos AudioParam, A sigue sonando). Nunca rechaza.
    {
      const { m, cm } = conMaster();
      const antes = fotoMaster(cm);
      ACCue.modo = { tipo: 'rechaza', name: 'NotFoundError' };
      let lanzo = null, r = null;
      try { r = await m.fijarSalidaCue(ID, NOMBRE, { abrir: true }); } catch (x) { lanzo = String(x); }
      ACCue.modo = { tipo: 'resuelve' };
      const cc = creados.at(-1);
      const e = m.cue();
      ok('motor_cue_abrir_falla_error_y_master_intacto', lanzo === null && r?.ok === false && r.error === 'NotFoundError' && e.estado === 'error'
        && e.aviso === 'No se encontró la salida «Headphones (Elgato Wave:XLR)». Cue apagado; el master sigue igual.' && e.salida === ID
        && m.contextoCue() === null && cc !== cm && cc.state === 'closed' && JSON.stringify(cc.sinks) === JSON.stringify([ID])
        && fotoMaster(cm) === antes && cm.state === 'running' && m.decks.A.estado().sonando === true,
      { lanzo, r, e, cc: cc?.state, master: fotoMaster(cm) === antes });
      m.cerrar();
    }
    // Sin `abrir` (o con false), perezoso como hasta e2c: elegir sólo guarda, ningún contexto de cue.
    {
      ACCue.modo = { tipo: 'resuelve' };
      const n0 = creados.length;
      const { m } = conMaster();
      const rs = [await m.fijarSalidaCue(ID, NOMBRE), await m.fijarSalidaCue(ID2, NOMBRE2, { abrir: false }), await m.fijarSalidaCue(ID_DDJ, NOMBRE_DDJ, { canales: '3-4' })];
      const e = m.cue();
      ok('motor_cue_sin_abrir_igual_que_antes', rs.every((r) => r.ok === true) && creados.length - n0 === 1 && m.contextoCue() === null && e.estado === 'lista'
        && e.salida === ID_DDJ && e.canales === '3-4', { rs, creados: creados.length - n0, e });
      m.cerrar();
    }
    // `abrir` que no es booleano → 'valor-invalido' y NADA cambia (ni la salida, ni los canales, ni el estado),
    // sin contexto de cue.
    {
      ACCue.modo = { tipo: 'resuelve' };
      const n0 = creados.length;
      const { m } = conMaster();
      await m.fijarSalidaCue(ID, NOMBRE);
      const antes = JSON.stringify(m.cue());
      const malos = ['si', 'true', 1, 0, null, {}, []];
      const rs = [];
      for (const v of malos) rs.push(await m.fijarSalidaCue(ID2, NOMBRE2, { canales: '3-4', abrir: v }));
      ok('motor_cue_abrir_no_booleano_valor_invalido', rs.every((r) => r.ok === false && r.error === 'valor-invalido') && JSON.stringify(m.cue()) === antes
        && creados.length - n0 === 1 && m.contextoCue() === null, { rs, antes, despues: m.cue() });
      m.cerrar();
    }
    // e3b · cargar OTRA pista en un deck con su cue activo: el cue SIGUE activo, la fuente de cue vieja se para
    // (de golpe, con la del master: cargarBuffer → 'solto') y no se crea otra hasta el play; al dar play, la
    // fuente de cue nueva usa el buffer NUEVO (el mismo objeto que el master).
    {
      const { m, cc } = await armar();
      const f0 = fuentes(cc).at(-1);
      const n0 = fuentes(cc).length;
      const buf2 = { duration: 180 };
      m.decks.A.cargarBuffer(buf2);
      const tras = { activo: m.cue().activo.A, nuevas: fuentes(cc).length - n0, paradaVieja: f0.paradas.includes(undefined), sonando: m.decks.A.estado().sonando };
      m.decks.A.play();
      const f1 = fuentes(cc).at(-1);
      ok('motor_cue_cargar_otra_pista_conserva_activo', tras.activo === true && tras.nuevas === 0 && tras.paradaVieja && tras.sonando === false
        && fuentes(cc).length === n0 + 1 && f1 !== f0 && f1.buffer === buf2 && m.cue().activo.A === true && m.cue().estado === 'lista',
      { tras, nuevaConBuf2: f1?.buffer === buf2 });
      m.cerrar();
    }
    // e3b · cambiar de salida («Usar» otra) con cues activos: el motor los CONSERVA (la UI deja los botones
    // activos); mismo contexto, un setSinkId más, 'lista'.
    {
      const { m, cc } = await armar();
      m.fijarCue('B', true);
      const r = await m.fijarSalidaCue(ID2, NOMBRE2, { abrir: true }); await listo();
      const e = m.cue();
      ok('motor_cue_activo_se_conserva_al_cambiar_salida', r.ok === true && e.activo.A === true && e.activo.B === true && e.estado === 'lista' && e.salida === ID2
        && m.contextoCue() === cc && JSON.stringify(cc.sinks) === JSON.stringify([ID, ID2]), { r, e, sinks: cc.sinks });
      m.cerrar();
    }
    // El master NUNCA recibió setSinkId (todos los contextos sin sinkId en el constructor son masters).
    {
      const masters = creados.filter((c) => !(c.opciones && 'sinkId' in c.opciones));
      const cues = creados.filter((c) => c.opciones && 'sinkId' in c.opciones);
      ok('motor_cue_master_nunca_recibe_setSinkId', masters.length >= 10 && masters.every((c) => c.sinks.length === 0) && cues.length >= 8 && cues.every((c) => c.opciones.sinkId?.type === 'none'),
        { masters: masters.length, cues: cues.length, conSink: masters.filter((c) => c.sinks.length).length });
    }
  } catch (e) {
    ok('motor_cue_sin_excepciones', false, { lanzo: String(e?.stack ?? e) });
  } finally {
    globalThis.AudioContext = AC0;
    await espera(5);
    process.off('unhandledRejection', alRechazo);
  }
}

// ── midi.js (sub-paso d): lo puro ──
{
  const cc = [interpretar([0xb0, 19, 64]), interpretar(new Uint8Array([0xb6, 31, 0])), interpretar([0xbf, 63, 127]), interpretar([0xb1, 51, 5, 99])];
  ok('midi_interpretar_cc_canal_desde_1', JSON.stringify(cc) === JSON.stringify([{ canal: 1, cc: 19, valor: 64 }, { canal: 7, cc: 31, valor: 0 }, { canal: 16, cc: 63, valor: 127 }, { canal: 2, cc: 51, valor: 5 }]), { cc });
  const otros = [[0x90, 60, 100], [0x80, 60, 0], [0x96, 11, 127], [0xe0, 0, 64], [0xc0, 5, 0], [0xa0, 1, 1], [0xd0, 3, 0], [0xf0, 0x7e, 0xf7], [0xf8, 0, 0], [0xfe],
    [0xb0, 19], [], null, undefined, [0xb0, 128, 0], [0xb0, 19, 200], [0xaf, 19, 64]];
  ok('midi_interpretar_ignora_lo_que_no_es_cc', otros.every((b) => interpretar(b) === null));
}
{
  const c = crearCombinador();
  const r = (b) => c.recibir(interpretar(b));
  // Volumen A (1:19): MSB cc 19, LSB cc 51.
  r([0xb0, 19, 0]); const cero = r([0xb0, 51, 0]);
  r([0xb0, 19, 64]); const centro = r([0xb0, 51, 0]);
  r([0xb0, 19, 127]); const max = r([0xb0, 51, 127]);
  r([0xb0, 19, 100]); const medio = r([0xb0, 51, 50]);
  ok('midi_14_bits', cero.pos === 0 && cero.clave === '1:19' && centro.pos === 8192 / 16383 && Math.abs(centro.pos - 0.50003) < 1e-5 && max.pos === 1
    && medio.pos === (100 * 128 + 50) / 16383 && medio.modo === '14 bits', { cero, centro, max, medio });
  // Con 14 bits ya vistos, un MSB solo pone el LSB en 0 (MIDI 1.0) y se aplica ya; el LSB lo completa.
  const soloMsbEn14 = r([0xb0, 19, 64]);
  const completa = r([0xb0, 51, 10]);
  ok('midi_msb_pone_el_lsb_en_0', soloMsbEn14.pos === 8192 / 16383 && completa.pos === 8202 / 16383, { soloMsbEn14, completa });
  // «Solo MSB»: un control que nunca mandó LSB → MSB / 127.
  const c2 = crearCombinador();
  const sm = [c2.recibir(interpretar([0xb1, 19, 64])), c2.recibir(interpretar([0xb1, 19, 127]))];
  ok('midi_solo_msb_es_msb_entre_127', sm[0].pos === 64 / 127 && sm[1].pos === 1 && sm[0].modo === 'solo MSB' && sm[0].clave === '2:19', { sm });
  // «Solo LSB»: un control que nunca mandó MSB → LSB / 127, con la clave del MSB (cc − 32).
  const c3 = crearCombinador();
  const sl = [c3.recibir(interpretar([0xb6, 63, 64])), c3.recibir(interpretar([0xb6, 63, 127]))];
  // … y si después llega el MSB, pasa a 14 bits.
  c3.recibir(interpretar([0xb6, 31, 64])); const despues = c3.recibir(interpretar([0xb6, 63, 1]));
  ok('midi_solo_lsb_es_lsb_entre_127', sl[0].pos === 64 / 127 && sl[1].pos === 1 && sl[0].modo === 'solo LSB' && sl[0].clave === '7:31'
    && despues.pos === 8193 / 16383 && despues.modo === '14 bits', { sl, despues });
  const c4 = crearCombinador();
  const siete = c4.recibir(interpretar([0xb0, 80, 127]));
  ok('midi_cc_64_en_adelante_es_7_bits', siete.pos === 1 && siete.clave === '1:80' && siete.modo === '7 bits', siete);
}
{
  const d = crearDeduplicador();
  const seq = [d.nuevo('1:19', 0.5), d.nuevo('1:19', 0.5), d.nuevo('2:19', 0.5), d.nuevo('1:19', 0.6), d.nuevo('1:19', 0.5)];
  ok('midi_duplicados_mismo_valor_se_descarta', JSON.stringify(seq) === JSON.stringify([true, false, true, true, true]), { seq });
}
// El mapa del DDJ-400 → el setter correcto, con un motor falso que anota las llamadas.
const motorFalso = (log = []) => ({
  log,
  fijarVolumen: (lado, v) => { log.push(['fijarVolumen', lado, v]); return true; },
  fijarCrossfader: (v) => { log.push(['fijarCrossfader', v]); return true; },
  fijarFiltro: (v) => { log.push(['fijarFiltro', v]); return true; },
  contexto: () => ({ state: 'running', sampleRate: 44100, baseLatency: 0.01, outputLatency: 0.04 }),
  decks: { A: { estado: () => ({ sonando: true }) }, B: { estado: () => ({ sonando: false }) } },
  opciones: { latencyHint: 'interactive' },
  _cierre: null,
  alCerrar(fn) { this._cierre = fn; return () => {}; },
});
{
  const mf = motorFalso();
  const f = (clave) => MAPA_DDJ400[clave];
  aplicar(mf, f('1:19'), 0.25); aplicar(mf, f('2:19'), 0.75); aplicar(mf, f('7:31'), 0.1); aplicar(mf, f('7:23'), 1); aplicar(mf, f('7:23'), 0);
  const sinMapa = aplicar(mf, MAPA_DDJ400['1:7'], 0.5);
  ok('midi_mapa_ddj400_al_setter_correcto', JSON.stringify(mf.log) === JSON.stringify([['fijarVolumen', 'A', 0.25], ['fijarVolumen', 'B', 0.75], ['fijarCrossfader', 0.1], ['fijarFiltro', 1], ['fijarFiltro', -1]])
    && sinMapa === false && Object.keys(MAPA_DDJ400).length === 4, { log: mf.log });
  // El centro de la perilla (MSB 64, LSB 0 = 8192) y su vecino 8191 caen en la zona muerta del filtro.
  const centro = filtroFrecuencias(valorParaMotor('filtro', 8192 / 16383));
  const vecino = filtroFrecuencias(valorParaMotor('filtro', 8191 / 16383));
  ok('midi_centro_del_filtro_en_zona_muerta', centro.lp === LP_NEUTRA && centro.hp === HP_NEUTRA && vecino.lp === LP_NEUTRA && vecino.hp === HP_NEUTRA
    && Math.abs(valorParaMotor('filtro', 8192 / 16383) - 0.000061) < 1e-6, { f: valorParaMotor('filtro', 8192 / 16383), centro });
}
{
  const col = crearColector();
  for (let i = 1; i <= 100; i++) col.agregar(101 - i);   // desordenado a propósito
  const r100 = col.resumen();
  const circ = crearColector(5000);
  for (let i = 1; i <= 6000; i++) circ.agregar(i);         // se quedan los últimos 5000: 1001..6000
  const r6000 = circ.resumen();
  const impar = crearColector(); [5, 1, 3].forEach((x) => impar.agregar(x));
  circ.reiniciar();
  ok('midi_colector_mediana_p95_circular', r100.n === 100 && r100.mediana === 50.5 && r100.p95 === 95 && r100.max === 100
    && r6000.n === 5000 && r6000.mediana === 3500.5 && r6000.p95 === 5750 && r6000.max === 6000 && impar.resumen().mediana === 3
    && circ.resumen().n === 0 && circ.resumen().mediana === null, { r100, r6000 });
}

// ── midi.js: la conexión, con un navigator.requestMIDIAccess falso ──
{
  const fake = ({ permiso = 'prompt', nombres = ['Otro teclado', 'PIONEER ddj-400 MIDI 1'], rechazo = null } = {}) => {
    const n = { pedidos: [], query: [], permiso };
    class Puerto {
      constructor(nombre, i) { this.id = `in-${i}`; this.name = nombre; this.state = 'connected'; this.oy = new Set(); this.abiertos = 0; }
      addEventListener(t, fn) { if (t === 'midimessage') this.oy.add(fn); }
      removeEventListener(t, fn) { if (t === 'midimessage') this.oy.delete(fn); }
      open() { this.abiertos++; return Promise.resolve(this); }
      enviar(bytes, timeStamp = 100) { for (const fn of [...this.oy]) fn({ data: Uint8Array.from(bytes), timeStamp }); }
    }
    const entradas = new Map(nombres.map((x, i) => [`in-${i}`, new Puerto(x, i)]));
    const acc = { inputs: entradas, outputs: new Map(), oy: new Set(),
      addEventListener(t, fn) { if (t === 'statechange') this.oy.add(fn); }, removeEventListener(t, fn) { if (t === 'statechange') this.oy.delete(fn); },
      cambio(p) { for (const fn of [...this.oy]) fn({ port: p }); } };
    n.requestMIDIAccess = (op) => { n.pedidos.push(op); if (rechazo) return Promise.reject(Object.assign(new Error('no'), { name: rechazo })); n.permiso = 'granted'; return Promise.resolve(acc); };
    n.permissions = { query: async (d) => { n.query.push(d); return { state: n.permiso }; } };
    return { nav: n, acc, entradas, ddj: [...entradas.values()][1], otro: [...entradas.values()][0] };
  };
  const tic = () => new Promise((r) => setTimeout(r, 0));

  // Sin soporte: sin error y con el estado dicho.
  {
    let lanzo = null, est = null;
    try { const cx = crearConexionMidi({ motor: motorFalso(), nav: {} }); est = cx.estado().estado; await cx.conectar(); await cx.autoConectar(); cx.cerrar(); } catch (e) { lanzo = String(e); }
    ok('midi_conexion_sin_soporte_no_lanza', est === 'sin-soporte' && lanzo === null, { est, lanzo });
  }
  // Conectar: un solo requestMIDIAccess({ sysex: false }), la entrada «ddj-400» sin distinguir mayúsculas,
  // UN oyente en ella y ninguno en la otra; el mensaje llega al setter ANTES de medir.
  {
    const F = fake();
    const orden = [];
    const mf = motorFalso(orden);
    const cx = crearConexionMidi({ motor: mf, diag: true, nav: F.nav, ahora: () => { orden.push(['medir']); return 107.75; } });
    const antes = F.nav.pedidos.length;
    await cx.autoConectar();   // permiso 'prompt': NO pide nada
    const trasAuto = F.nav.pedidos.length;
    const p = cx.conectar(); cx.conectar(); await p; await tic();
    const est = cx.estado();
    F.ddj.enviar([0xb0, 19, 64]); F.ddj.enviar([0xb0, 51, 0]);
    ok('midi_conexion_pide_al_clic_y_elige_ddj400', antes === 0 && trasAuto === 0 && F.nav.pedidos.length === 1 && JSON.stringify(F.nav.pedidos[0]) === JSON.stringify({ sysex: false })
      && est.estado === 'conectado' && est.nombre === 'PIONEER ddj-400 MIDI 1' && F.ddj.oy.size === 1 && F.otro.oy.size === 0 && F.acc.oy.size === 1 && F.ddj.abiertos === 1,
    { est, pedidos: F.nav.pedidos, oyentes: [F.ddj.oy.size, F.otro.oy.size, F.acc.oy.size] });
    ok('midi_manejador_setter_antes_de_medir', JSON.stringify(orden) === JSON.stringify([['fijarVolumen', 'A', 64 / 127], ['medir'], ['fijarVolumen', 'A', 8192 / 16383], ['medir']])
      && cx.stats().n === 2 && cx.stats().mediana === 7.75 && cx.stats().sampleRate === 44100 && cx.stats().latencyHint === 'interactive'
      && cx.stats().baseLatency === 0.01 && cx.stats().outputLatency === 0.04, { orden, stats: cx.stats() });
    // Duplicados: el mismo mensaje dos veces → un solo setter.
    const n0 = orden.length;
    F.ddj.enviar([0xb0, 51, 0]); F.ddj.enviar([0xb0, 51, 1]); F.ddj.enviar([0xb0, 51, 1]);
    ok('midi_manejador_descarta_duplicados', orden.length - n0 === 2 && orden[n0 + 1][0] === 'medir', { nuevos: orden.slice(n0) });
    // Desconexión y reconexión por statechange.
    F.ddj.state = 'disconnected'; F.acc.cambio(F.ddj);
    const desc = { ...cx.estado(), oy: F.ddj.oy.size };
    const n1 = orden.length; F.ddj.enviar([0xb0, 51, 9]); const trasDesc = orden.length - n1;
    F.ddj.state = 'connected'; F.acc.cambio(F.ddj);
    const reco = { ...cx.estado(), oy: F.ddj.oy.size };
    F.ddj.enviar([0xb0, 51, 9]);
    ok('midi_conexion_desconecta_y_reconecta', desc.estado === 'desconectado' && desc.oy === 0 && trasDesc === 0 && reco.estado === 'conectado' && reco.oy === 1
      && orden.at(-2)[0] === 'fijarVolumen', { desc, reco });
    // Cerrar el MOTOR cierra la conexión (alCerrar): sin oyentes.
    mf._cierre?.();
    ok('midi_cerrar_el_motor_quita_los_oyentes', F.ddj.oy.size === 0 && F.acc.oy.size === 0 && typeof mf._cierre === 'function', { oy: [F.ddj.oy.size, F.acc.oy.size] });
  }
  // Doble montaje (StrictMode): crear → cerrar → crear, con el permiso ya concedido (autoConectar), y
  // también con el pedido en vuelo al cerrar: al final hay UN oyente de cada uno.
  {
    const F = fake({ permiso: 'granted' });
    const c0 = crearConexionMidi({ motor: motorFalso(), nav: F.nav });
    const pedido = c0.conectar();   // requestMIDIAccess en vuelo…
    c0.cerrar();                    // … y se desmonta antes de que conteste
    await pedido; await tic();
    const c1 = crearConexionMidi({ motor: motorFalso(), nav: F.nav });
    const vuelo = c1.autoConectar();
    c1.cerrar();
    await vuelo; await tic();
    const c2 = crearConexionMidi({ motor: motorFalso(), nav: F.nav });
    await c2.autoConectar(); await tic();
    ok('midi_doble_montaje_un_solo_oyente', F.ddj.oy.size === 1 && F.acc.oy.size === 1 && c2.estado().estado === 'conectado' && c1.estado().estado !== 'conectado'
      && c0.estado().estado !== 'conectado', { oy: [F.ddj.oy.size, F.acc.oy.size], c0: c0.estado(), c1: c1.estado(), c2: c2.estado() });
    c2.cerrar();
  }
  // Permiso denegado y sin DDJ-400; sin diag no hay stats.
  {
    const F = fake({ rechazo: 'NotAllowedError' });
    const cx = crearConexionMidi({ motor: motorFalso(), nav: F.nav });
    let lanzo = null; try { await cx.conectar(); } catch (e) { lanzo = String(e); }
    const G = fake({ nombres: ['Otro teclado'] });
    const cy = crearConexionMidi({ motor: motorFalso(), nav: G.nav });
    await cy.conectar();
    ok('midi_denegado_y_sin_ddj400', cx.estado().estado === 'denegado' && lanzo === null && cy.estado().estado === 'esperando' && cx.stats === undefined && cx.reiniciar === undefined,
      { cx: cx.estado(), cy: cy.estado() });
  }
}

// ── cue.js (sub-paso e1): lo puro del cue a audífonos ──
{
  const cerca = (a, b, tol = 1e-12) => typeof a === 'number' && Math.abs(a - b) <= tol;
  ok('cue_constantes', DESFASE_MAX_MS === 250 && VOLUMEN_CUE_INICIAL === 0.5, { DESFASE_MAX_MS, VOLUMEN_CUE_INICIAL });

  // recortarDesfase: redondeo al ms, ±250, basura → null.
  const dentro = [0, 1, -1, 12, -120, 249, -249, 250, -250].map(recortarDesfase);
  ok('cue_desfase_dentro_del_rango', JSON.stringify(dentro) === JSON.stringify([0, 1, -1, 12, -120, 249, -249, 250, -250]), { dentro });
  const fuera = [251, 1000, -251, -1e9].map(recortarDesfase);
  ok('cue_desfase_recorta_a_250', JSON.stringify(fuera) === JSON.stringify([250, 250, -250, -250]), { fuera });
  const red = [12.4, 12.5, -12.4, -12.6, 0.4, -0.4, 249.6, -249.6].map(recortarDesfase);
  ok('cue_desfase_redondea_al_ms', JSON.stringify(red) === JSON.stringify([12, 13, -12, -13, 0, 0, 250, -250]) && Object.is(recortarDesfase(-0.4), 0), { red });
  const basura = [NaN, Infinity, -Infinity, undefined, null, '12', {}, []].map(recortarDesfase);
  ok('cue_desfase_no_finito_es_null', basura.every((x) => x === null), { basura });

  // volumenCue: v² con recorte a 0..1; basura → null.
  const vols = [0, 0.5, 1, 0.3, -0.2, 1.7].map(volumenCue);
  ok('cue_volumen_v2_y_recorte', vols[0] === 0 && vols[1] === 0.25 && vols[2] === 1 && cerca(vols[3], 0.09) && vols[4] === 0 && vols[5] === 1
    && volumenCue(VOLUMEN_CUE_INICIAL) === 0.25, { vols });
  const volsMal = [NaN, Infinity, undefined, null, '0.5'].map(volumenCue);
  ok('cue_volumen_no_finito_es_null', volsMal.every((x) => x === null), { volsMal });

  // offsetRelojes: master en 10,000 s cuando performance.now = 2000 ms; cue en 3,000 s cuando
  // performance.now = 2500 ms → master a perf 0 = 8,0; cue a perf 0 = 0,5 → K = 7,5.
  const oM = { contextTime: 10, performanceTime: 2000 }, oC = { contextTime: 3, performanceTime: 2500 };
  const r1 = offsetRelojes({ salidaMaster: oM, salidaCue: oC, tiempoMaster: 99, tiempoCue: 1 });
  ok('cue_relojes_por_salida', r1?.fuente === 'salida' && cerca(r1.K, 7.5), r1);
  const r2 = offsetRelojes({ salidaMaster: oM, salidaCue: { contextTime: 0, performanceTime: 0 }, tiempoMaster: 10.2, tiempoCue: 2.7 });
  ok('cue_relojes_fallback_performance_cero', r2?.fuente === 'currentTime' && cerca(r2.K, 7.5), r2);
  const r3 = [
    offsetRelojes({ salidaMaster: { contextTime: NaN, performanceTime: 5 }, salidaCue: oC, tiempoMaster: 4, tiempoCue: 1 }),
    offsetRelojes({ salidaMaster: oM, salidaCue: { contextTime: 3, performanceTime: Infinity }, tiempoMaster: 4, tiempoCue: 1 }),
    offsetRelojes({ salidaCue: oC, tiempoMaster: 4, tiempoCue: 1 }),
  ];
  ok('cue_relojes_fallback_dato_no_finito', r3.every((r) => r?.fuente === 'currentTime' && r.K === 3), { r3 });
  const r4 = [offsetRelojes({}), offsetRelojes(), offsetRelojes({ salidaMaster: oM, tiempoMaster: 4, tiempoCue: NaN }), offsetRelojes({ tiempoMaster: 4 })];
  ok('cue_relojes_sin_datos_null', r4.every((r) => r === null), { r4 });

  // planCue. Deck que empezó (posición 0) en t = 100 del master; K = 7,5; se quiere arrancar en el cue en
  // t = 93,025 → en el master es 100,525 → posición 0,525 s.
  const base = { cero: 100, K: 7.5, desfaseMs: 0, cuandoCue: 93.025, duracion: 240 };
  const p0 = planCue(base);
  ok('cue_plan_caso_base', p0.crear === true && p0.cuando === 93.025 && cerca(p0.offset, 0.525, 1e-9), p0);
  const pMas = planCue({ ...base, desfaseMs: 120 });
  ok('cue_plan_desfase_positivo_atrasa', pMas.crear && pMas.cuando === p0.cuando && cerca(p0.offset - pMas.offset, 0.12) && pMas.offset < p0.offset, { p0, pMas, dif: p0.offset - pMas.offset });
  const pMenos = planCue({ ...base, desfaseMs: -80 });
  ok('cue_plan_desfase_negativo_adelanta', pMenos.crear && pMenos.cuando === p0.cuando && cerca(pMenos.offset - p0.offset, 0.08) && pMenos.offset > p0.offset, { p0, pMenos, dif: pMenos.offset - p0.offset });
  // Borde: posición 0,525 y desfase +700 ms → offset −0,175: arranca 0,175 s más tarde, desde 0.
  const pBorde = planCue({ ...base, desfaseMs: 700 });
  ok('cue_plan_offset_negativo_retrasa_cuando', pBorde.crear && pBorde.offset === 0 && cerca(pBorde.cuando, 93.025 + 0.175, 1e-9), pBorde);
  // Exactamente en el final (offset = duración, sin error de coma flotante: 2 + 0 − 0 − 0 = 2) también es no crear.
  const pFin = [planCue({ cero: 0, K: 0, desfaseMs: 0, cuandoCue: 2, duracion: 2 }), planCue({ ...base, duracion: 0.4 }), planCue({ ...base, cuandoCue: 400 })];
  ok('cue_plan_pasado_el_final_no_crea', pFin.every((p) => p.crear === false && Object.keys(p).length === 1), { pFin });
  const pMal = ['cero', 'K', 'desfaseMs', 'cuandoCue', 'duracion'].flatMap((k) => [NaN, Infinity, undefined, '1'].map((v) => planCue({ ...base, [k]: v })));
  ok('cue_plan_datos_no_finitos_no_crea', pMal.length === 20 && pMal.every((p) => p.crear === false) && planCue().crear === false, { n: pMal.length });

  // filtrarSalidas con las 8 salidas REALES de la máquina de Oscar (Edge 157, ids recortados a 8; los
  // groupId son los medidos).
  const S = (deviceId, label, groupId) => ({ kind: 'audiooutput', deviceId, label, groupId });
  const OSCAR = [
    S('default', 'Predeterminado - Altavoces (Sound Blaster AE-7)', '34ddd597'),
    S('communications', 'Comunicaciones - Línea (2- DDJ-400) (2b73:0026)', '2c8d69b7'),
    S('dbc8637d', 'Línea (2- DDJ-400) (2b73:0026)', '2c8d69b7'),
    S('e21c0e98', 'Headphones (Elgato Wave:XLR)', '7ce09e67'),
    S('6d69ac2a', 'LG ULTRAWIDE (NVIDIA High Definition Audio)', '6d0c49ac'),
    S('9d69141a', 'Altavoces (Sound Blaster AE-7)', '34ddd597'),
    S('f01f9a0d', 'System (Elgato Virtual Audio)', '756a660f'),
    S('3f2f5763', 'Elgato Wave:XLR (Elgato Virtual Audio)', '494ffa45'),
  ];
  const fs8 = filtrarSalidas(OSCAR);
  ok('cue_salidas_fixture_real_6', fs8.length === 6 && !fs8.some((s) => s.id === 'default' || s.id === 'communications')
    && JSON.stringify(fs8.map((s) => s.id)) === JSON.stringify(['dbc8637d', 'e21c0e98', '6d69ac2a', '9d69141a', 'f01f9a0d', '3f2f5763'])
    && fs8.every((s) => Object.keys(s).join() === 'id,nombre,grupo,esMaster'), { ids: fs8.map((s) => s.id) });
  const masters = fs8.filter((s) => s.esMaster);
  ok('cue_salidas_esmaster_solo_la_ae7', masters.length === 1 && masters[0].id === '9d69141a' && masters[0].nombre === 'Altavoces (Sound Blaster AE-7)' && masters[0].grupo === '34ddd597'
    && fs8.find((s) => s.id === 'dbc8637d').esMaster === false, { masters });
  const sinDefault = filtrarSalidas(OSCAR.slice(1));
  ok('cue_salidas_sin_default_nadie_es_master', sinDefault.length === 6 && sinDefault.every((s) => s.esMaster === false), { n: sinDefault.length });
  // Sin permiso de micrófono: una salida sin id ni nombre (así la da el navegador).
  const sinNombres = [{ kind: 'audiooutput', deviceId: '', label: '', groupId: '' }];
  const conIdSinNombre = [S('9d69141a', '', '34ddd597'), S('e21c0e98', '   ', '7ce09e67')];
  ok('cue_salidas_sin_nombres', filtrarSalidas(sinNombres).length === 0 && hayNombres(sinNombres) === false && filtrarSalidas(conIdSinNombre).length === 0 && hayNombres(conIdSinNombre) === false
    && hayNombres(OSCAR) === true);
  const mixtos = [{ kind: 'audioinput', deviceId: 'mic1', label: 'Micrófono (Elgato Wave:XLR)', groupId: '7ce09e67' }, { kind: 'videoinput', deviceId: 'cam1', label: 'Cámara', groupId: 'x' },
    S('e21c0e98', 'Headphones (Elgato Wave:XLR)', '7ce09e67'), null, 42, { deviceId: 'sinkind', label: 'Sin kind' }];
  const fm = filtrarSalidas(mixtos);
  ok('cue_salidas_ignora_otros_kind', fm.length === 1 && fm[0].id === 'e21c0e98' && hayNombres([mixtos[0], mixtos[1]]) === false, { fm });
  const noArr = [undefined, null, 'x', {}, 42].map(filtrarSalidas);
  ok('cue_salidas_no_arreglo', noArr.every((l) => Array.isArray(l) && l.length === 0) && [undefined, null, {}].every((x) => hayNombres(x) === false));

  // elegirGuardada.
  const ae7 = fs8.find((s) => s.id === '9d69141a'), elg = fs8.find((s) => s.id === 'e21c0e98');
  const g1 = elegirGuardada({ id: 'e21c0e98', nombre: 'Headphones (Elgato Wave:XLR)' }, fs8);
  ok('cue_guardada_por_id', g1.motivo === 'id' && g1.salida === elg, g1);
  const g1b = elegirGuardada({ id: 'e21c0e98', nombre: 'Otro nombre' }, fs8);
  ok('cue_guardada_por_id_gana_al_nombre', g1b.motivo === 'id' && g1b.salida === elg, g1b);
  const g2 = elegirGuardada({ id: 'idviejo1', nombre: 'Altavoces (Sound Blaster AE-7)' }, fs8);
  ok('cue_guardada_por_nombre_si_cambio_el_id', g2.motivo === 'nombre' && g2.salida === ae7, g2);
  const dos = [...fs8, { id: 'zz000001', nombre: 'Headphones (Elgato Wave:XLR)', grupo: '11111111', esMaster: false }];
  const g3 = elegirGuardada({ id: 'idviejo2', nombre: 'Headphones (Elgato Wave:XLR)' }, dos);
  ok('cue_guardada_nombre_ambiguo', g3.motivo === 'ambigua' && g3.salida === null, g3);
  const g4 = [elegirGuardada({ id: 'idviejo3', nombre: 'Audífonos Bluetooth' }, fs8), elegirGuardada({ id: 'idviejo3' }, fs8),
    elegirGuardada({ nombre: 'Headphones (Elgato Wave:XLR)' }, []), elegirGuardada({ id: 'e21c0e98' }, 'no es lista')];
  ok('cue_guardada_ausente', g4.every((g) => g.motivo === 'ausente' && g.salida === null), { g4 });
  const g5 = [null, undefined, 'e21c0e98', 42, [], {}, { id: 5, nombre: null }, { id: '', nombre: '  ' }].map((x) => elegirGuardada(x, fs8));
  ok('cue_guardada_basura_y_sin_guardada', g5.every((g) => g.motivo === 'sin-guardada' && g.salida === null), { g5 });

  // ── e4a: recordar el cue (lo puro) ──
  {
    const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const J = (o) => JSON.stringify(o);
    // u1: leer y validar. Lo ilegible → null (sin borrar: la página lo ignora). activo, volumen y maxChannelCount no se leen.
    const ilegibles = [null, undefined, 42, '', '{roto', '[]', '"x"', 'null', J({ actual: { id: 'a' } }), J({ v: 2, actual: { id: 'a', canales: '1-2' } }), J({ v: '1', actual: { id: 'a' } })];
    const malLeidos = ilegibles.filter((x) => leerCueGuardado(x) !== null);
    const lv = leerCueGuardado(J({ v: 1, activo: { A: true }, volumen: 0.9,
      actual: { id: 'a1', nombre: '  Headphones  ', canales: '3-4', activo: { A: true, B: true }, volumen: 0.9, maxChannelCount: 4 },
      salidas: [{ id: 'a1', nombre: 'H', desfaseMs: 300, usada: 5, activo: true }, { id: 'b', nombre: 'B', desfaseMs: '12' }, { id: '', nombre: ' ' , desfaseMs: 3 }, null, 7,
        { id: 'c', desfaseMs: 12.6 }, { nombre: 'Sólo nombre', desfaseMs: -4, usada: 'x' }] }));
    const sinCanales = leerCueGuardado(J({ v: 1, actual: { id: 'a1', nombre: 'H', maxChannelCount: 4 } }));
    const canalesMalos = ['x', '3-4 ', 34, null, ['3-4']].map((c) => leerCueGuardado(J({ v: 1, actual: { id: 'a1', nombre: 'H', canales: c } })));
    const sinIdNiNombre = leerCueGuardado(J({ v: 1, actual: { id: '', nombre: '  ', canales: '1-2' }, salidas: 'no' }));
    ok('cue_e4_leer_valida_y_descarta', malLeidos.length === 0
      && igual(lv, { actual: { id: 'a1', nombre: 'Headphones', canales: '3-4' }, salidas: [{ id: 'a1', nombre: 'H', desfaseMs: 250, usada: 5 }, { id: 'c', nombre: '', desfaseMs: 13, usada: 0 }, { id: '', nombre: 'Sólo nombre', desfaseMs: -4, usada: 0 }] })
      && igual(sinCanales.actual, { id: 'a1', nombre: 'H', canales: '1-2' }) && canalesMalos.every((g) => g && g.actual === null)
      && igual(sinIdNiNombre, { actual: null, salidas: [] }) && CLAVE_CUE === 'djCue', { malLeidos, lv, sinCanales, canalesMalos, sinIdNiNombre });
    const diez = Array.from({ length: 10 }, (_, i) => ({ id: `s${i + 1}`, nombre: `S${i + 1}`, desfaseMs: i, usada: i + 1 }));
    const l8 = leerCueGuardado(J({ v: 1, actual: null, salidas: diez }));
    ok('cue_e4_tope_de_salidas', TOPE_SALIDAS === 8 && l8.salidas.length === 8 && igual(l8.salidas.map((s) => s.id), ['s10', 's9', 's8', 's7', 's6', 's5', 's4', 's3']), { ids: l8.salidas.map((s) => s.id) });

    // La lista de Oscar (fs8) y una con DOS «Headphones» crudos iguales (sus visibles: «Headphones» y «Headphones (2)»).
    const D = (deviceId, label, groupId) => ({ kind: 'audiooutput', deviceId, label, groupId });
    const gem = filtrarSalidas([D('default', 'Predeterminado - Altavoces', 'gm'), D('h1', 'Headphones', 'g1'), D('h2', 'Headphones', 'g2'), D('sb', 'Altavoces', 'gm'),
      D('ddj', 'Línea (2- DDJ-400)', 'gm'), D('w', 'Wave', 'gw')]);
    const ACT = (actual, salidas = []) => ({ actual, salidas });
    const res = (g, salidas = gem, estadoLista = 'lista') => decidirRestauracion({ guardado: g, estadoLista, salidas });
    // u2: emparejar. Por id; por nombre CRUDO único (el id cambió → idNuevo); ambigua; ausente; y la trampa del visible.
    const r1 = res(ACT({ id: 'e21c0e98', nombre: 'Headphones (Elgato Wave:XLR)', canales: '1-2' }), fs8);
    const r2 = res(ACT({ id: 'viejo', nombre: 'Headphones (Elgato Wave:XLR)', canales: '1-2' }), fs8);
    const r3 = res(ACT({ id: 'hx', nombre: 'Headphones', canales: '1-2' }));
    const r4 = res(ACT({ id: 'nada', nombre: 'Audífonos Bluetooth', canales: '1-2' }));
    const r5 = res(ACT({ id: 'hx', nombre: 'Headphones (2)', canales: '1-2' }));   // el VISIBLE de h2: no es un nombre crudo
    const r6 = res(ACT({ id: 'h2', nombre: 'Headphones', canales: '1-2' }));        // por id, aunque el nombre esté repetido
    ok('cue_e4_restaurar_empareja', r1.accion === 'restaurar' && r1.salida === elg && r1.idNuevo === null && r1.canales === '1-2'
      && r2.accion === 'restaurar' && r2.salida === elg && r2.idNuevo === 'e21c0e98'
      && r3.accion === 'ambigua' && r3.nombre === 'Headphones' && !r3.salida && r4.accion === 'ausente' && r4.nombre === 'Audífonos Bluetooth' && !r4.salida
      && r5.accion === 'ausente' && !r5.salida && r6.accion === 'restaurar' && r6.salida?.id === 'h2' && r6.idNuevo === null,
    { r1: [r1.accion, r1.salida?.id, r1.idNuevo], r2: [r2.accion, r2.salida?.id, r2.idNuevo], r3: r3.accion, r4: r4.accion, r5: [r5.accion, r5.salida?.id], r6: [r6.accion, r6.salida?.id] });
    // decidirVuelta: mismo id → rearmar (o confirmar con '1-2' en la del master); sólo nombre → pedir «Usar»; ambigua o ausente → nada.
    const v = [decidirVuelta({ id: 'w', nombre: 'Wave', canales: '1-2' }, gem), decidirVuelta({ id: 'w-viejo', nombre: 'Wave', canales: '1-2' }, gem),
      decidirVuelta({ id: 'hx', nombre: 'Headphones', canales: '1-2' }, gem), decidirVuelta({ id: 'zz', nombre: 'Otra', canales: '1-2' }, gem),
      decidirVuelta({ id: 'sb', nombre: 'Altavoces', canales: '1-2' }, gem), decidirVuelta({ id: 'ddj', nombre: 'Línea (2- DDJ-400)', canales: '3-4' }, gem),
      decidirVuelta({ id: 'h2', nombre: 'Headphones', canales: '1-2' }, gem), decidirVuelta(null, gem), decidirVuelta({ id: 'w', nombre: 'Wave' }, 'no')];
    ok('cue_e4_vuelta_por_id_o_nombre', v[0].accion === 'rearmar' && v[0].salida.id === 'w' && v[0].canales === '1-2' && v[1].accion === 'pedir-usar' && v[1].salida.id === 'w'
      && v[2].accion === 'nada' && v[3].accion === 'nada' && v[4].accion === 'confirmar' && v[4].salida.id === 'sb' && v[5].accion === 'rearmar' && v[5].canales === '3-4'
      && v[6].accion === 'rearmar' && v[6].salida.id === 'h2' && v[7].accion === 'nada' && v[8].accion === 'nada', { v: v.map((x) => [x.accion, x.salida?.id, x.canales]) });
    // u3: permiso (sin la lista leída no se decide), master con '1-2' → confirmar, '3-4' sin preguntar, y los canales
    // NUNCA se deducen (ni del nombre «DDJ» ni de un maxChannelCount 4 en la salida o en lo guardado).
    const esperan = ['inactivo', 'pidiendo', 'denegado', 'sin-microfono', 'error', 'sin-nombres', 'sin-soporte', undefined]
      .map((e) => decidirRestauracion({ guardado: ACT({ id: 'w', nombre: 'Wave', canales: '1-2' }), estadoLista: e, salidas: gem }).accion);
    const vacia = res(ACT({ id: 'w', nombre: 'Wave', canales: '1-2' }), [], 'vacia');
    const nadas = [res(null), res(cueVacio()), res(ACT(null, [{ id: 'w', nombre: 'Wave', desfaseMs: 3, usada: 1 }])), decidirRestauracion()].map((x) => x.accion);
    const m12 = res(ACT({ id: 'sb', nombre: 'Altavoces', canales: '1-2' })), m34 = res(ACT({ id: 'ddj', nombre: 'Línea (2- DDJ-400)', canales: '3-4' }));
    const gemMax = gem.map((s) => ({ ...s, maxChannelCount: 4 }));
    const deducir = res(leerCueGuardado(J({ v: 1, actual: { id: 'ddj', nombre: 'Línea (2- DDJ-400)', maxChannelCount: 4 } })), gemMax);
    const deducirW = res(ACT({ id: 'w', nombre: 'Wave', canales: '1-2' }), gemMax);
    ok('cue_e4_restaurar_permiso_master_y_canales', esperan.every((a) => a === 'esperar') && vacia.accion === 'ausente' && nadas.every((a) => a === 'nada')
      && m12.accion === 'confirmar' && m12.salida.id === 'sb' && m12.canales === '1-2' && m34.accion === 'restaurar' && m34.canales === '3-4'
      && deducir.accion === 'confirmar' && deducir.canales === '1-2' && deducirW.accion === 'restaurar' && deducirW.canales === '1-2',
    { esperan, vacia: vacia.accion, nadas, m12: [m12.accion, m12.canales], m34: [m34.accion, m34.canales], deducir: [deducir.accion, deducir.canales], deducirW: deducirW.canales });

    // u4: el desfase por salida. Por id; si no, por nombre crudo único entre lo guardado; repetido o ninguno → null.
    const gd = ACT({ id: 'w', nombre: 'Wave', canales: '1-2' }, [{ id: 'w', nombre: 'Wave', desfaseMs: 12, usada: 2 }, { id: 'h1', nombre: 'Headphones', desfaseMs: 5, usada: 1 },
      { id: 'h2', nombre: 'Headphones', desfaseMs: -7, usada: 1 }, { id: 'x', nombre: 'Altavoces', desfaseMs: 30, usada: 1 }]);
    const sal = (id) => gem.find((s) => s.id === id);
    const dg = [desfaseGuardado(gd, sal('w')), desfaseGuardado(gd, { id: 'w-nuevo', nombre: 'Wave' }), desfaseGuardado(gd, sal('h2')), desfaseGuardado(gd, { id: 'h3', nombre: 'Headphones' }),
      desfaseGuardado(gd, sal('sb')), desfaseGuardado(gd, sal('ddj')), desfaseGuardado(null, sal('w')), desfaseGuardado(gd, null)];
    const conDes = res(gd), porNombre = res(ACT({ id: 'w-viejo', nombre: 'Wave', canales: '1-2' }, [{ id: 'w-viejo', nombre: 'Wave', desfaseMs: -9, usada: 1 }]));
    const rd1 = recordarDesfase(gd, { id: 'w', nombre: 'Wave' }, 999, 50);
    const rd2 = recordarDesfase(gd, { id: 'w', nombre: 'Wave' }, 'x', 50);
    const rd3 = recordarDesfase(null, { id: '', nombre: 'Sólo nombre' }, 4, 9);
    let lleno = cueVacio();
    for (let i = 1; i <= 9; i++) lleno = recordarDesfase(lleno, { id: `s${i}`, nombre: `S${i}` }, i, i);
    ok('cue_e4_desfase_por_salida', igual(dg, [12, 12, -7, null, 30, null, null, null]) && conDes.desfaseMs === 12 && porNombre.desfaseMs === -9 && porNombre.idNuevo === 'w'
      && rd1.salidas.length === 4 && igual(rd1.salidas[0], { id: 'w', nombre: 'Wave', desfaseMs: 250, usada: 50 }) && rd1.salidas.filter((s) => s.id === 'w').length === 1
      && rd2 === gd && igual(rd3.salidas, [{ id: '', nombre: 'Sólo nombre', desfaseMs: 4, usada: 9 }])
      && lleno.salidas.length === 8 && !lleno.salidas.some((s) => s.id === 's1') && lleno.salidas[0].id === 's9', { dg, rd1: rd1.salidas, lleno: lleno.salidas.map((s) => s.id) });
    // migrarId: actual y su entrada pasan al id nuevo; si ya había una entrada con el nuevo, gana ésa.
    const mg = migrarId(ACT({ id: 'w-viejo', nombre: 'Wave', canales: '3-4' }, [{ id: 'w-viejo', nombre: 'Wave', desfaseMs: -9, usada: 1 }, { id: 'o', nombre: 'O', desfaseMs: 1, usada: 1 }]), 'w-viejo', 'w');
    const mg2 = migrarId(ACT({ id: 'w-viejo', nombre: 'Wave', canales: '1-2' }, [{ id: 'w-viejo', nombre: 'Wave', desfaseMs: -9, usada: 1 }, { id: 'w', nombre: 'Wave', desfaseMs: 4, usada: 2 }]), 'w-viejo', 'w');
    const mgNada = [migrarId(gd, 'w', ''), migrarId(gd, 'w', 'w'), migrarId(gd, 'w', null)];
    ok('cue_e4_migrar_id', igual(mg, ACT({ id: 'w', nombre: 'Wave', canales: '3-4' }, [{ id: 'w', nombre: 'Wave', desfaseMs: -9, usada: 1 }, { id: 'o', nombre: 'O', desfaseMs: 1, usada: 1 }]))
      && mg2.actual.id === 'w' && igual(mg2.salidas, [{ id: 'w', nombre: 'Wave', desfaseMs: 4, usada: 2 }]) && mgNada.every((x) => x === gd), { mg, mg2 });

    // u5: el almacén nunca lanza: obtener el storage lanza (cookies bloqueadas), no hay storage, getItem lanza, setItem
    // lanza (lleno); y con uno que funciona, ida y vuelta.
    const lanza = (name) => () => { throw Object.assign(new Error(name), { name }); };
    const mapa = new Map();
    const bueno = { getItem: (k) => (mapa.has(k) ? mapa.get(k) : null), setItem: (k, v) => { mapa.set(k, String(v)); } };
    const casos = {
      getterLanza: crearAlmacen(lanza('SecurityError')),
      sinStorage: crearAlmacen(() => undefined),
      noEsStorage: crearAlmacen(() => ({ getItem: 1 })),
      getItemLanza: crearAlmacen(() => ({ getItem: lanza('SecurityError'), setItem: () => {} })),
      setItemLanza: crearAlmacen(() => ({ getItem: () => 'x', setItem: lanza('QuotaExceededError') })),
      noEsTexto: crearAlmacen(() => ({ getItem: () => 42, setItem: () => {} })),
    };
    let lanzo = null;
    const vistos = {};
    try { for (const [k, a] of Object.entries(casos)) vistos[k] = [a.leer(CLAVE_CUE), a.escribir(CLAVE_CUE, 'v')]; } catch (e) { lanzo = String(e?.name ?? e); }
    const ab = crearAlmacen(() => bueno);
    const escrito = ab.escribir(CLAVE_CUE, serializarCue(recordarActual(cueVacio(), { id: 'w', nombre: 'Wave', canales: '3-4' })));
    const vuelta = leerCueGuardado(ab.leer(CLAVE_CUE));
    ok('cue_e4_almacen_nunca_lanza', lanzo === null && igual(vistos, { getterLanza: [null, false], sinStorage: [null, false], noEsStorage: [null, false], getItemLanza: [null, true],
      setItemLanza: ['x', false], noEsTexto: [null, true] }) && escrito === true && igual(vuelta, ACT({ id: 'w', nombre: 'Wave', canales: '3-4' })), { lanzo, vistos, vuelta });

    // u6: se serializa SÓLO el esquema: nunca activo, volumen ni maxChannelCount (ni arriba, ni en actual, ni en salidas).
    const sucio = { activo: { A: true }, volumen: 0.9, maxChannelCount: 4,
      actual: { id: 'w', nombre: 'Wave', canales: '3-4', activo: { A: true }, volumen: 0.9, maxChannelCount: 4 },
      salidas: [{ id: 'w', nombre: 'Wave', desfaseMs: 5, usada: 1, activo: true, volumen: 1, maxChannelCount: 4 }] };
    const txt = serializarCue(sucio);
    const o = JSON.parse(txt);
    const vacio = JSON.parse(serializarCue(undefined));
    const ra = [recordarActual(gd, { id: 'w', nombre: 'Wave', canales: 'x' }), recordarActual(gd, { id: '', nombre: '' , canales: '1-2' })];
    const olv = olvidarActual(gd);
    ok('cue_e4_serializa_solo_el_esquema', igual(Object.keys(o), ['v', 'actual', 'salidas']) && o.v === 1 && igual(Object.keys(o.actual), ['id', 'nombre', 'canales'])
      && igual(Object.keys(o.salidas[0]), ['id', 'nombre', 'desfaseMs', 'usada']) && !/activo|volumen|maxChannelCount/.test(txt)
      && igual(leerCueGuardado(txt), { actual: { id: 'w', nombre: 'Wave', canales: '3-4' }, salidas: [{ id: 'w', nombre: 'Wave', desfaseMs: 5, usada: 1 }] })
      && igual(vacio, { v: 1, actual: null, salidas: [] }) && ra.every((x) => x === gd) && olv.actual === null && igual(olv.salidas, gd.salidas),
    { txt, vacio });
    // Los avisos de e4a.
    const av4 = [textoAviso('guardada-ausente', 'Wave'), textoAviso('guardada-ausente', ''), textoAviso('guardada-ambigua', 'Headphones'), textoAviso('guardada-ambigua', null),
      textoAviso('volvio-lista', 'Wave'), textoAviso('volvio-lista', ' ')];
    ok('cue_e4_avisos', igual(av4, ['La salida de audífonos guardada «Wave» no está conectada. Conéctala o elige otra.', 'La salida de audífonos guardada no está conectada. Conéctala o elige otra.',
      'Hay más de una salida llamada «Headphones». Elige cuál y pulsa «Usar».', 'Hay más de una salida con ese nombre. Elige cuál y pulsa «Usar».',
      'Volvió «Wave». Cue listo (apagado).', 'Volvió la salida de audífonos. Cue listo (apagado).']), { av4 });
  }

  // textoAviso.
  const N = 'Headphones (Elgato Wave:XLR)';
  const avisos = {
    'no-conectada': 'La salida de audífonos «Headphones (Elgato Wave:XLR)» no está conectada. Cue apagado.',
    desconectada: 'Se desconectó «Headphones (Elgato Wave:XLR)». Cue apagado; el master sigue igual.',
    NotFoundError: 'No se encontró la salida «Headphones (Elgato Wave:XLR)». Cue apagado; el master sigue igual.',
    NotAllowedError: 'El navegador no dejó usar la salida «Headphones (Elgato Wave:XLR)». Cue apagado; el master sigue igual.',
    'misma-salida': 'Esa salida es la misma del master: el cue sonaría por los mismos altavoces.',
    AbortError: 'No se pudo abrir la salida de audífonos (AbortError). Cue apagado; el master sigue igual.',
  };
  const malos = Object.entries(avisos).filter(([m, t]) => textoAviso(m, N) !== t).map(([m]) => [m, textoAviso(m, N)]);
  ok('cue_aviso_textos', malos.length === 0, { malos });
  ok('cue_aviso_invalidstate_es_null', textoAviso('InvalidStateError', N) === null && textoAviso('InvalidStateError', '') === null);
  // Sin nombre: la frase habla de «la salida de audífonos», sin comillas ni «esa salida».
  const sinNombre = {
    'no-conectada': 'La salida de audífonos no está conectada. Cue apagado.',
    desconectada: 'Se desconectó la salida de audífonos. Cue apagado; el master sigue igual.',
    NotFoundError: 'No se encontró la salida de audífonos. Cue apagado; el master sigue igual.',
    NotAllowedError: 'El navegador no dejó usar la salida de audífonos. Cue apagado; el master sigue igual.',
    AbortError: 'No se pudo abrir la salida de audífonos (AbortError). Cue apagado; el master sigue igual.',
  };
  const malosVacio = Object.entries(sinNombre).flatMap(([m, t]) => ['', '   ', undefined, null].filter((n) => textoAviso(m, n) !== t).map((n) => [m, n, textoAviso(m, n)]));
  ok('cue_aviso_nombre_vacio', malosVacio.length === 0
    && textoAviso(undefined, N) === 'No se pudo abrir la salida de audífonos (error desconocido). Cue apagado; el master sigue igual.', { malosVacio });
  // e2c: los canales del cue y su aviso.
  const canalesMalos = [null, '', '3-4 ', '5-6', '1-2,3-4', 34, 3, {}, ['3-4']].filter((v) => validarCanales(v) !== null);
  ok('cue_validar_canales', validarCanales(undefined) === '1-2' && validarCanales('1-2') === '1-2' && validarCanales('3-4') === '3-4' && canalesMalos.length === 0, { canalesMalos });
  const sin34 = ['', '   ', undefined, null].map((n) => textoAviso('sin-canales-3-4', n));
  ok('cue_aviso_sin_canales_3_4', textoAviso('sin-canales-3-4', N) === `La salida «${N}» no tiene canales 3-4. Cue apagado; el master sigue igual.`
    && sin34.every((t) => t === 'La salida de audífonos no tiene canales 3-4. Cue apagado; el master sigue igual.'), { conNombre: textoAviso('sin-canales-3-4', N), sin34 });
}

// ── cue.js (sub-paso e3a): lo puro del selector de audífonos ──
{
  // Repetidos: la 1.ª conserva el nombre, las siguientes « (2)», « (3)» en el orden dado; un sufijo que choca
  // con otra salida salta al número siguiente; el nombre se recorta como en filtrarSalidas.
  const sal = (...ns) => ns.map((nombre, i) => ({ id: `id${i}`, nombre }));
  const v1 = nombresVisibles(sal('Altavoces', 'Headphones', 'Headphones', 'Línea (2- DDJ-400)', 'Headphones'));
  const v2 = nombresVisibles(sal('X', 'X (2)', 'X', 'X'));
  const v3 = nombresVisibles(sal(' Y ', 'Y'));
  ok('cue_nombres_visibles_repetidos', JSON.stringify(v1) === JSON.stringify(['Altavoces', 'Headphones', 'Headphones (2)', 'Línea (2- DDJ-400)', 'Headphones (3)'])
    && JSON.stringify(v2) === JSON.stringify(['X', 'X (2)', 'X (3)', 'X (4)']) && JSON.stringify(v3) === JSON.stringify(['Y', 'Y (2)'])
    && JSON.stringify(nombresVisibles(sal('A', 'B'))) === JSON.stringify(['A', 'B']) && nombresVisibles(null).length === 0 && nombresVisibles('x').length === 0, { v1, v2, v3 });
  // Misma salida que el master: con '1-2' se confirma; con '3-4' (la DDJ) no; una salida que no es la del master, no.
  const master = { id: 'sb', nombre: 'Altavoces', esMaster: true }, otra = { id: 'w', nombre: 'Headphones', esMaster: false };
  const dec = [decidirEleccion(master, '1-2'), decidirEleccion(master, undefined), decidirEleccion(master, '3-4'), decidirEleccion(otra, '1-2'), decidirEleccion(otra, '3-4'),
    decidirEleccion(null, '1-2'), decidirEleccion(master, '5-6'), decidirEleccion('sb', '1-2')];
  ok('cue_decidir_misma_salida', JSON.stringify(dec) === JSON.stringify(['confirmar-misma-salida', 'confirmar-misma-salida', 'ok', 'ok', 'ok', null, null, null]), { dec });
  // Los textos de la lista, exactos.
  const esperados = {
    inactivo: 'Para mostrar los nombres de las salidas de audio, el navegador pide permiso de micrófono. No se graba nada: el micrófono se cierra al instante.',
    pidiendo: 'Pidiendo permiso de micrófono…',
    denegado: 'Permiso de micrófono denegado. Sin él, el navegador no muestra los nombres de las salidas. Puedes permitirlo desde el candado de la barra de direcciones.',
    'sin-microfono': 'No hay ningún micrófono conectado, y sin micrófono el navegador no muestra los nombres de las salidas.',
    'sin-nombres': 'El navegador no dio los nombres de las salidas aunque hay permiso. Prueba a recargar la página.',
    vacia: 'No se encontró ninguna salida de audio.',
  };
  const malosLista = Object.entries(esperados).filter(([e, t]) => textoListaSalidas(e) !== t).map(([e]) => e);
  ok('cue_textos_lista_salidas', malosLista.length === 0 && textoListaSalidas('error', 'NotReadableError') === 'No se pudo pedir el permiso de micrófono (NotReadableError).'
    && textoListaSalidas('error') === 'No se pudo pedir el permiso de micrófono (error desconocido).' && textoListaSalidas('lista') === null && textoListaSalidas('otra') === null,
  { malosLista, error: textoListaSalidas('error', 'NotReadableError') });
  ok('cue_texto_sin_soporte', textoListaSalidas('sin-soporte') === 'Este navegador no puede mandar el cue a otra salida.', { t: textoListaSalidas('sin-soporte') });
  // La línea de estado del cue: 'lista' con o sin contexto; 'error' → null (el aviso del motor va aparte).
  const est = [textoEstadoCue('sin-salida', '', '1-2', false), textoEstadoCue('abriendo', 'Línea (2- DDJ-400)', '3-4', true), textoEstadoCue('lista', 'Línea (2- DDJ-400)', '3-4', true),
    textoEstadoCue('lista', 'Headphones', '1-2', false), textoEstadoCue('error', 'Headphones', '1-2', false), textoEstadoCue('otro', 'x', '1-2', true)];
  ok('cue_texto_estado_cue', JSON.stringify(est) === JSON.stringify(['Sin salida de audífonos.', 'Abriendo «Línea (2- DDJ-400)»…', 'Listo: «Línea (2- DDJ-400)» · canales 3-4.',
    '«Headphones» · canales 1-2. Se abre al activar un cue.', null, null]), { est });
}

// ── cue.js (sub-paso e3b): botones Cue, volumen y desfase; la vuelta de una salida y la pista DDJ ──
// Los textos esperados se escriben acá, no se importan.
{
  const act = [textoCuesActivos({ A: true, B: false }), textoCuesActivos({ A: false, B: true }), textoCuesActivos({ A: true, B: true }), textoCuesActivos({ A: false, B: false }),
    textoCuesActivos(null), textoCuesActivos({ A: 1, B: 'si' })];
  const est = [textoEstadoCue('lista', 'Línea (2- DDJ-400)', '3-4', true, { A: true, B: true }), textoEstadoCue('lista', 'Headphones', '1-2', false, { A: false, B: true }),
    textoEstadoCue('lista', 'Headphones', '1-2', true, { A: false, B: false }), textoEstadoCue('abriendo', 'Headphones', '1-2', true, { A: true, B: false })];
  ok('cue_texto_cues_activos_y_estado', JSON.stringify(act) === JSON.stringify(['cue A', 'cue B', 'cue A y B', '', '', ''])
    && JSON.stringify(est) === JSON.stringify(['Listo: «Línea (2- DDJ-400)» · canales 3-4 · cue A y B.', '«Headphones» · canales 1-2 · cue B. Se abre al activar un cue.',
      'Listo: «Headphones» · canales 1-2.', 'Abriendo «Headphones»…']), { act, est });
  const SIN = 'Elige la salida de audífonos en «Audífonos (cue)»', ERR = 'La salida falló: quítala o elige otra';
  const bot = ['sin-salida', 'abriendo', 'lista', 'error', null, 'otro'].map((e) => estadoBotonCue(e));
  ok('cue_boton_cue_estados', JSON.stringify(bot) === JSON.stringify([{ habilitado: false, titulo: SIN }, { habilitado: true, titulo: null }, { habilitado: true, titulo: null },
    { habilitado: false, titulo: ERR }, { habilitado: false, titulo: SIN }, { habilitado: false, titulo: SIN }]), { bot });
  const VACIO = 'Cue activo: carga una canción y dale play para oírla en los audífonos.';
  const PAUSA = 'Cue activo: dale play para preescuchar. En esta versión el cue no suena en pausa: baja el volumen del deck o el crossfader para que no salga por el master.';
  const notas = [textoNotaCue({ activo: true, cargado: false, sonando: false }), textoNotaCue({ activo: true, cargado: true, sonando: false }),
    textoNotaCue({ activo: true, cargado: true, sonando: true }), textoNotaCue({ activo: false, cargado: true, sonando: false }), textoNotaCue({ activo: false, cargado: false, sonando: false }),
    textoNotaCue(), textoNotaCue({ activo: 1, cargado: true })];
  ok('cue_nota_cue', JSON.stringify(notas) === JSON.stringify([VACIO, PAUSA, null, null, null, null, null]), { notas });
  const des = [12, -8, 0, -0, 0.4, -0.4, 2.5, -2.5, 300, -300, 250, -250, NaN, '12', null, Infinity].map((v) => textoDesfase(v));
  ok('cue_texto_desfase', JSON.stringify(des) === JSON.stringify(['+12 ms', '−8 ms', '0 ms', '0 ms', '0 ms', '0 ms', '+3 ms', '−2 ms', '+250 ms', '−250 ms', '+250 ms', '−250 ms', '', '', '', '']), { des });
  // El diferido con timers FALSOS: una ráfaga → UNA llamada con el último valor, a los ms pedidos.
  {
    const timers = new Map(); let sig = 1; const quitados = [];
    const t = { poner: (f, ms) => { const id = sig++; timers.set(id, { f, ms }); return id; }, quitar: (id) => { quitados.push(id); timers.delete(id); } };
    const llamadas = [];
    const d = crearDiferido((v) => llamadas.push(v), 150, t);
    d.pedir(1); d.pedir(2); d.pedir(3);
    const antes = { llamadas: llamadas.length, vivos: timers.size, ms: [...timers.values()].map((x) => x.ms), pendiente: d.pendiente() };
    for (const [id, x] of [...timers]) { timers.delete(id); x.f(); }
    const tras = { llamadas: [...llamadas], pendiente: d.pendiente() };
    d.pedir(7); d.cancelar();
    const cancelado = { vivos: timers.size, pendiente: d.pendiente(), llamadas: llamadas.length };
    const malo = crearDiferido(() => { throw new Error('x'); }, 10, t);
    malo.pedir(1);
    let lanzo = false;
    try { for (const [id, x] of [...timers]) { timers.delete(id); x.f(); } } catch { lanzo = true; }
    ok('cue_diferido_junta_la_rafaga', antes.llamadas === 0 && antes.vivos === 1 && antes.ms[0] === 150 && antes.pendiente === true && quitados.length >= 2
      && JSON.stringify(tras.llamadas) === JSON.stringify([3]) && tras.pendiente === false, { antes, tras, quitados: quitados.length });
    ok('cue_diferido_cancelar_y_fn_que_lanza', cancelado.vivos === 0 && cancelado.pendiente === false && cancelado.llamadas === 1 && lanzo === false && malo.pendiente() === false, { cancelado, lanzo });
  }
  // El diferido con los timers REALES (los de la página): a 50 ms nada; a los ~150, una vez.
  {
    const llamadas = [];
    const d = crearDiferido((v) => llamadas.push([v, Date.now()]), 150);
    const t0 = Date.now();
    d.pedir(4); await new Promise((r) => setTimeout(r, 30)); d.pedir(5);
    await new Promise((r) => setTimeout(r, 50));
    const a50 = llamadas.length;
    await new Promise((r) => setTimeout(r, 250));
    const dt = llamadas[0] ? llamadas[0][1] - t0 : null;
    ok('cue_diferido_timers_reales', a50 === 0 && llamadas.length === 1 && llamadas[0][0] === 5 && dt >= 170 && dt < 330, { a50, llamadas: llamadas.length, dt });
  }
  const LISTA_V = [{ id: 'hp-1', nombre: 'Headphones' }, { id: 'hp-2', nombre: 'Headphones' }, { id: 'ddj', nombre: 'Línea (2- DDJ-400)' }];
  const vu = [buscarVuelta({ id: 'hp-2', nombre: 'Headphones (2)' }, LISTA_V), buscarVuelta({ id: 'otro-id', nombre: 'Línea (2- DDJ-400)' }, LISTA_V),
    buscarVuelta({ id: 'nuevo', nombre: 'Headphones (2)' }, LISTA_V), buscarVuelta({ id: 'x', nombre: 'Headphones (3)' }, LISTA_V), buscarVuelta({ id: 'x', nombre: '' }, LISTA_V),
    buscarVuelta(null, LISTA_V), buscarVuelta({ id: 'hp-1' }, 'no'), buscarVuelta({ id: 'x', nombre: 'línea (2- ddj-400)' }, LISTA_V)];
  ok('cue_buscar_vuelta', JSON.stringify(vu) === JSON.stringify(['hp-2', 'ddj', 'hp-2', null, null, null, null, null]), { vu });
  ok('cue_aviso_volvio', textoAviso('volvio', 'Headphones') === '«Headphones» volvió: pulsa «Usar» para activarla.'
    && textoAviso('volvio', '') === 'La salida de audífonos volvió: pulsa «Usar» para activarla.', { t: textoAviso('volvio', 'Headphones') });
  const PISTA = 'Parece una mezcladora DJ: sus audífonos suelen ir por los canales 3-4.';
  const pis = [pistaMezcladora('Línea (2- DDJ-400)', '1-2'), pistaMezcladora('Línea (2- DDJ-400)', '3-4'), pistaMezcladora('Headphones', '1-2'), pistaMezcladora('mi ddj', '1-2'),
    pistaMezcladora(null, '1-2'), pistaMezcladora('DDJ-FLX4', '5-6')];
  ok('cue_pista_mezcladora', JSON.stringify(pis) === JSON.stringify([PISTA, null, null, null, null, null]), { pis });
}

// ── salidas.js (sub-paso e3a): la lista de salidas con mediaDevices y permissions FALSOS ──
// El falso: getUserMedia cuenta sus llamadas y da 2 pistas que cuentan sus stop() (o rechaza con `gum`, un
// name); enumerateDevices da la lista con nombres sólo con permiso ('granted') y `nombres`; sin permiso, como
// Chromium: una entrada por tipo, sin id ni nombre. devicechange con disparar(); oyentes contados.
{
  const err = (name) => Object.assign(new Error(name), { name });
  const espera = () => new Promise((r) => setTimeout(r, 0));
  const LISTA = [
    { kind: 'audioinput', deviceId: 'default', label: 'Predeterminado - Micrófono (Wave:XLR)', groupId: 'gw' },
    { kind: 'audiooutput', deviceId: 'default', label: 'Predeterminado - Altavoces (Sound Blaster AE-7)', groupId: 'gsb' },
    { kind: 'audiooutput', deviceId: 'communications', label: 'Comunicaciones - Headphones (Elgato Wave:XLR)', groupId: 'gw' },
    { kind: 'audiooutput', deviceId: 'sb1', label: 'Altavoces (Sound Blaster AE-7)', groupId: 'gsb' },
    { kind: 'audiooutput', deviceId: 'w1', label: 'Headphones (Elgato Wave:XLR)', groupId: 'gw' },
    { kind: 'audiooutput', deviceId: 'ddj1', label: 'Línea (2- DDJ-400)', groupId: 'gddj' },
  ];
  const SIN_PERMISO = [{ kind: 'audioinput', deviceId: '', label: '', groupId: '' }, { kind: 'audiooutput', deviceId: '', label: '', groupId: '' }];
  const falso = ({ permiso = 'prompt', gum = 'ok', nombres = true, lista = LISTA } = {}) => {
    const f = { permiso, lista, gum, gumLlamadas: [], pistas: [], enumeraciones: 0, oy: new Set(), consultas: [] };
    f.getUserMedia = (c) => {
      f.gumLlamadas.push(c);
      if (f.gum !== 'ok') return Promise.reject(err(f.gum));
      f.permiso = 'granted';
      const t = [0, 1].map(() => ({ stops: 0, stop() { this.stops++; } }));
      f.pistas.push(...t);
      return Promise.resolve({ getTracks: () => t });
    };
    f.enumerateDevices = () => { f.enumeraciones++; return Promise.resolve(f.permiso === 'granted' && nombres ? f.lista.map((d) => ({ ...d })) : SIN_PERMISO.map((d) => ({ ...d }))); };
    f.addEventListener = (t, fn) => { if (t === 'devicechange') f.oy.add(fn); };
    f.removeEventListener = (t, fn) => { if (t === 'devicechange') f.oy.delete(fn); };
    f.disparar = () => { for (const fn of [...f.oy]) fn({ type: 'devicechange' }); };
    f.permisos = { query: (d) => { f.consultas.push(d); return Promise.resolve({ state: f.permiso }); } };
    return f;
  };
  const crear = (f, extra = {}) => {
    const cambios = [];
    const l = crearListaSalidas({ medios: f, permisos: f?.permisos, puedeSink: () => true, alCambiar: () => cambios.push(l.estado().estado), ...extra });
    return { l, cambios };
  };
  const ids = (l) => l.estado().salidas.map((s) => s.id);
  try {
    // Sin mediaDevices, o sin setSinkId: 'sin-soporte', y pedir/autoListar no hacen nada.
    {
      const sin = crearListaSalidas({ medios: undefined, permisos: undefined, puedeSink: () => true });
      const f = falso({ permiso: 'granted' });
      const { l } = crear(f, { puedeSink: () => false });
      await l.pedir(); await l.autoListar(); await sin.pedir(); await sin.autoListar();
      ok('salidas_sin_soporte', sin.estado().estado === 'sin-soporte' && l.estado().estado === 'sin-soporte' && f.gumLlamadas.length === 0 && f.enumeraciones === 0 && f.oy.size === 0,
        { sin: sin.estado().estado, l: l.estado().estado, gum: f.gumLlamadas.length, enumeraciones: f.enumeraciones });
      l.cerrar(); sin.cerrar();
    }
    // Permiso ya dado: autoListar enumera SIN getUserMedia; filtra los alias; esMaster por el groupId de 'default'.
    {
      const f = falso({ permiso: 'granted' });
      const { l } = crear(f);
      await l.autoListar();
      const s = l.estado().salidas;
      ok('salidas_granted_lista_sin_getUserMedia', l.estado().estado === 'lista' && f.gumLlamadas.length === 0 && JSON.stringify(f.consultas) === JSON.stringify([{ name: 'microphone' }])
        && JSON.stringify(ids(l)) === JSON.stringify(['sb1', 'w1', 'ddj1']) && JSON.stringify(s.map((x) => x.esMaster)) === JSON.stringify([true, false, false]),
      { estado: l.estado().estado, gum: f.gumLlamadas.length, ids: ids(l) });
      l.cerrar();
    }
    // 'prompt': autoListar no pide ni enumera; 'denied': 'denegado' sin pedir nada.
    {
      const f = falso();
      const { l } = crear(f);
      await l.autoListar();
      const fd = falso({ permiso: 'denied' });
      const { l: ld } = crear(fd);
      await ld.autoListar();
      ok('salidas_prompt_no_hace_nada_hasta_pedir', l.estado().estado === 'inactivo' && f.gumLlamadas.length === 0 && f.enumeraciones === 0
        && ld.estado().estado === 'denegado' && fd.gumLlamadas.length === 0 && fd.enumeraciones === 0, { prompt: l.estado().estado, denied: ld.estado().estado });
      l.cerrar(); ld.cerrar();
    }
    // pedir(): getUserMedia UNA vez, en la llamada (síncrono, dentro del clic), con { audio: true }; un 2.º pedir
    // en vuelo no pide otra vez; cada pista se para UNA vez; después la lista.
    {
      const f = falso();
      const { l, cambios } = crear(f);
      const p1 = l.pedir();
      const enLaLlamada = { gum: f.gumLlamadas.length, estado: l.estado().estado };
      const p2 = l.pedir();
      await p1; await p2;
      ok('salidas_pedir_una_vez_y_para_las_pistas', enLaLlamada.gum === 1 && enLaLlamada.estado === 'pidiendo' && p1 === p2 && f.gumLlamadas.length === 1
        && JSON.stringify(f.gumLlamadas[0]) === JSON.stringify({ audio: true }) && f.pistas.length === 2 && f.pistas.every((t) => t.stops === 1)
        && l.estado().estado === 'lista' && JSON.stringify(ids(l)) === JSON.stringify(['sb1', 'w1', 'ddj1']) && JSON.stringify(cambios) === JSON.stringify(['pidiendo', 'lista']),
      { enLaLlamada, gum: f.gumLlamadas, stops: f.pistas.map((t) => t.stops), cambios });
      l.cerrar();
    }
    // NotAllowedError → 'denegado' (sin lista); se puede volver a pedir.
    {
      const f = falso({ gum: 'NotAllowedError' });
      const { l } = crear(f);
      await l.pedir();
      const e1 = l.estado();
      await l.pedir();
      ok('salidas_not_allowed', e1.estado === 'denegado' && e1.salidas.length === 0 && f.gumLlamadas.length === 2 && l.estado().estado === 'denegado', { e1, gum: f.gumLlamadas.length });
      l.cerrar();
    }
    // NotFoundError (sin micrófono) → 'sin-microfono'.
    {
      const f = falso({ gum: 'NotFoundError' });
      const { l } = crear(f);
      await l.pedir();
      ok('salidas_not_found', l.estado().estado === 'sin-microfono' && l.estado().salidas.length === 0, { e: l.estado() });
      l.cerrar();
    }
    // Un error con los nombres ya disponibles (permiso dado, micrófono ocupado) da la lista sin aviso; sin
    // nombres, 'error' con el name.
    {
      const f = falso({ permiso: 'granted', gum: 'NotReadableError' });
      const { l } = crear(f);
      await l.pedir();
      const f2 = falso({ gum: 'NotReadableError' });
      const { l: l2 } = crear(f2);
      await l2.pedir();
      ok('salidas_error_con_nombres_da_lista', l.estado().estado === 'lista' && l.estado().error === null && JSON.stringify(ids(l)) === JSON.stringify(['sb1', 'w1', 'ddj1'])
        && l2.estado().estado === 'error' && l2.estado().error === 'NotReadableError' && l2.estado().salidas.length === 0, { l: l.estado().estado, l2: l2.estado() });
      l.cerrar(); l2.cerrar();
    }
    // Permiso dado pero las salidas vienen sin nombre → 'sin-nombres', sin lista.
    {
      const f = falso({ nombres: false });
      const { l } = crear(f);
      await l.pedir();
      ok('salidas_sin_nombres', l.estado().estado === 'sin-nombres' && l.estado().salidas.length === 0 && f.permiso === 'granted', { e: l.estado() });
      l.cerrar();
    }
    // Lista vacía: sólo los alias (nada que elegir) o ninguna salida.
    {
      const f = falso({ lista: LISTA.slice(0, 3) });
      const { l } = crear(f);
      await l.pedir();
      const f2 = falso({ lista: [LISTA[0]] });
      const { l: l2 } = crear(f2);
      await l2.pedir();
      ok('salidas_vacia', l.estado().estado === 'vacia' && l.estado().salidas.length === 0 && l2.estado().estado === 'vacia', { l: l.estado().estado, l2: l2.estado().estado });
      l.cerrar(); l2.cerrar();
    }
    // devicechange: con la lista leída vuelve a enumerar (sin pedir) y avisa; antes del permiso no enumera;
    // cerrar() quita el oyente (había UNO) y después nada.
    {
      const f0 = falso();
      const { l: l0 } = crear(f0);
      f0.disparar(); await espera();
      const antesDelPermiso = f0.enumeraciones;
      l0.cerrar();
      const f = falso();
      const { l, cambios } = crear(f);
      const oyAlCrear = f.oy.size;
      await l.pedir();
      const e0 = f.enumeraciones;
      f.lista = LISTA.filter((d) => d.deviceId !== 'w1');
      f.disparar(); await espera(); await espera();
      const tras = { enumeraciones: f.enumeraciones - e0, ids: ids(l), cambios: cambios.length };
      l.cerrar();
      const oyTrasCerrar = f.oy.size;
      f.disparar(); await espera();
      ok('salidas_devicechange_reenumera_y_cerrar_quita', antesDelPermiso === 0 && oyAlCrear === 1 && tras.enumeraciones === 1 && JSON.stringify(tras.ids) === JSON.stringify(['sb1', 'ddj1'])
        && tras.cambios === 3 && f.gumLlamadas.length === 1 && oyTrasCerrar === 0 && f.enumeraciones - e0 === 1,
      { antesDelPermiso, oyAlCrear, tras, oyTrasCerrar });
    }
    // cerrar() con el permiso en vuelo (doble montaje de StrictMode): las pistas igual se paran; no enumera ni avisa.
    {
      const f = falso();
      const { l, cambios } = crear(f);
      const p = l.pedir();
      l.cerrar();
      await p;
      ok('salidas_cerrar_en_vuelo', f.pistas.length === 2 && f.pistas.every((t) => t.stops === 1) && f.enumeraciones === 0 && JSON.stringify(cambios) === JSON.stringify(['pidiendo']),
        { stops: f.pistas.map((t) => t.stops), enumeraciones: f.enumeraciones, cambios });
    }
  } catch (e) {
    ok('salidas_sin_excepciones', false, { lanzo: String(e?.stack ?? e) });
  }
}

const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
console.log(`\ndj-unit: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
process.exit(fails.length ? 1 : 0);
