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
const { recortarDesfase, volumenCue, offsetRelojes, planCue, filtrarSalidas, hayNombres, elegirGuardada, textoAviso, DESFASE_MAX_MS, VOLUMEN_CUE_INICIAL } = await desde('music-client/src/dj/motor/cue.js');

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
  class Nodo {
    constructor(ctx, clase) { this.context = ctx; this.clase = clase; this.salidas = []; this.desconexiones = 0; ctx.nodos.push(this); }
    connect(d) { this.salidas.push(d); return d; }
    disconnect() { this.desconexiones++; }
  }
  class ACCue {
    constructor(op) {
      this.opciones = op === undefined ? null : JSON.parse(JSON.stringify(op));
      this.sampleRate = op?.sampleRate ?? 96000; this.state = 'running'; this.currentTime = 1.25;
      this.sinkId = op && 'sinkId' in op ? op.sinkId : '';
      this.nodos = []; this.destination = new Nodo(this, 'destination');
      this.sinks = []; this.pendientes = []; this.oy = {}; this.ots = { contextTime: 0, performanceTime: 0 }; this.cierres = 0;
      this.modo = ACCue.modo;
      creados.push(this);
    }
    addEventListener(t, fn) { (this.oy[t] ??= new Set()).add(fn); }
    removeEventListener(t, fn) { this.oy[t]?.delete(fn); }
    emitir(t) { for (const fn of [...(this.oy[t] ?? [])]) fn({ type: t }); }
    ponerEstado(s) { this.state = s; this.emitir('statechange'); }
    oyentes() { return Object.values(this.oy).reduce((s, x) => s + x.size, 0); }
    setSinkId(id) {
      this.sinks.push(id);
      const m = this.modo;
      if (this.state === 'closed') return Promise.reject(err('InvalidStateError'));
      if (m.tipo === 'rechaza') return Promise.reject(err(m.name));
      const aplicar = () => {
        this.sinkId = id;
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
  const AC0 = globalThis.AudioContext;
  globalThis.AudioContext = ACCue;
  const cerca = (a, b, tol = 1e-9) => typeof a === 'number' && Math.abs(a - b) <= tol;
  const ID = 'e21c0e98', NOMBRE = 'Headphones (Elgato Wave:XLR)', ID2 = '9d69141a', NOMBRE2 = 'Altavoces (Sound Blaster AE-7)';
  const fuentes = (c) => c.nodos.filter((n) => n.clase === 'fuente');
  const gains = (c) => c.nodos.filter((n) => n.clase === 'gain');
  // Un motor con el master creado, una pista en A sonando desde el master t = 10 (cero = 10) y la salida
  // elegida. Relojes: master en 50 (posición 40), cue en 3.
  const armar = async ({ modo = { tipo: 'resuelve' }, opciones = {}, activar = true } = {}) => {
    ACCue.modo = modo;
    const m = crearMotor(opciones);
    const cm = m.asegurarContexto();
    const buf = { duration: 240 };
    m.decks.A.cargarBuffer(buf);
    cm.currentTime = 10;
    m.decks.A.play();
    cm.currentTime = 50; cm.ots = { contextTime: 49.958, performanceTime: 120000 };
    await m.fijarSalidaCue(ID, NOMBRE);
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
}

const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
console.log(`\ndj-unit: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
process.exit(fails.length ? 1 : 0);
