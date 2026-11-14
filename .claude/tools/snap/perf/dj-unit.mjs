// dj-unit.mjs — unitaria del Modo DJ (sub-paso b), con node y sin navegador, como routes-unit.mjs.
// Prueba lo PURO del motor: music-client/src/dj/motor/mezcla.js (crossfader de igual potencia y filtro
// bipolar) y music-client/src/dj/motor/carga.js (antesDeBajar, clasificarRespuesta y cargarPista con
// un fetch y un decodeAudioData falsos: que nunca lance, que use Bearer y no ?token=, y el registro) y
// motor.js con un AudioContext falso: la tasa del contexto (TASA_DJ = 44 100) y la mezcla del sub-paso c
// (grafo, valores iniciales, rampas con TAU sin escribir .value, crossfader, filtro sin cambiar .type), y
// midi.js (sub-paso d): interpretar, 14 bits, solo MSB / solo LSB, duplicados, el mapa del DDJ-400, el
// colector del retraso y la conexión con un navigator.requestMIDIAccess falso.
// Uso: node dj-unit.mjs
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const desde = (p) => import(pathToFileURL(join(ROOT, p)).href);
const { potenciaIgual, filtroBipolar, ZONA_MUERTA, PASO_BAJO, PASO_ALTO, gananciaVolumen, filtroFrecuencias, LP_NEUTRA, HP_NEUTRA } = await desde('music-client/src/dj/motor/mezcla.js');
const { antesDeBajar, clasificarRespuesta, cargarPista, MAX_SEG, MEMORIA_AVISO_B, TASA_PEOR_CASO } = await desde('music-client/src/dj/motor/carga.js');
const { crearMotor, TASA_DJ, TAU, Q_FILTRO } = await desde('music-client/src/dj/motor/motor.js');
const { interpretar, crearCombinador, crearDeduplicador, valorParaMotor, aplicar, crearColector, crearConexionMidi, MAPA_DDJ400 } = await desde('music-client/src/dj/motor/midi.js');

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

const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
console.log(`\ndj-unit: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
process.exit(fails.length ? 1 : 0);
