// radio-oyente-aleatorio-func.mjs — la DEUDA DEL ALEATORIO del oyente de la radio (RadioContext.jsx, «DEUDAS CONOCIDAS
// del oyente»), medida de punta a punta en el cliente: el BUILD DE PRODUCCIÓN (preview :4173), el PuenteOyente real y el
// motor real (PlayerContext) de la página del oyente, contra una radio SIMULADA (el servidor falso FK… de
// radio-oyente-comun.mjs: el anfitrión es node, que escribe el estado de la sala). Se entra con el botón «Escuchar» de la
// vista, como una persona.
//
// La deuda: el aleatorio NO se apaga al unirse (el repeat sí). El puente carga la cola de la radio [pista, siguiente] con
// play() sin opciones; si el oyente encola algo con el aleatorio encendido, al terminar la pista el motor de ANTES de M4
// sorteaba entre las no sonadas y podía saltar a lo encolado (medido a nivel motor: 13 de 20) hasta que el desajuste
// (DESAJUSTE_MS, 6 s) volvía a poner la de la radio. Con M4 el motor camina por posición y lo encolado va al final:
// medido a nivel motor, 0 de 20. Esto lo mide con la radio y el puente de verdad.
//
// Cada vuelta: «Escuchar» una sala falsa con A sonando a 6 s de su final (siguiente: B); el aleatorio encendido; el
// oyente encola X (addToQueue del motor, la misma función que llama «Agregar a la cola» del menú); se comprueba que la
// cola es [A, B, X] con el aleatorio encendido; A termina SOLA (un WAV de A del largo de A); se anota la PRIMERA pista
// que suena después y todo lo que suena en los 1,5 s siguientes; el anfitrión falso pasa a B; el oyente sigue en B; salir.
// Dos variantes, alternadas, VUELTAS de cada una:
//   · antes  — el aleatorio ya estaba encendido al unirse (la deuda tal cual: unirse no lo apaga);
//   · dentro — se enciende con el botón de la barra ya dentro de la radio.
// Casos:
//   precondicion_*       las 2·VUELTAS vueltas armaron [A, B, X] con el aleatorio encendido y A sonando (si no, la
//                        medición no vale);
//   *_al_terminar_a_suena_b   en cada variante, la primera después de A es B (la siguiente de la radio), nunca X;
//   lo_encolado_no_suena_*    X no suena en ningún momento entre el final de A y el paso del anfitrión a B;
//   al_pasar_*_a_b       con el anfitrión ya en B, el oyente suena B;
//   sin_errores_de_pagina.
// El conteo de cada vuelta (a B / a X / otra) queda en el registro (fuera del conteo).
//
// NO mide: el servidor de radio real ni dos navegadores (eso es radio-e2e-func, sin aleatorio), la app del anfitrión,
// ni el teléfono.
// Uso: SNAP_BASE=http://localhost:4173 SNAP2_USER=… SNAP2_PASS=… node radio-oyente-aleatorio-func.mjs
import {
  R, ok, REG, sleep, A, B, C, D, wav, p, errores, esperar, foto, salaFalsa, estadoFk, escuchar, sonandoEn, salirFk,
  prepararFoto, salas, api, browser, ctx, BASE,
} from './radio-oyente-comun.mjs';

const VUELTAS = 10;                       // por variante
const X = D;                              // lo que encola el oyente (no es ni A ni B)
const T = Math.floor(A.duration);         // segundos del WAV de A (A dura ≥ 150 s en la copia)
const INICIO_MS = (T - 6) * 1000;         // dónde va el anfitrión al entrar: a 6 s del final
const WAV_A = wav(T);
// A suena con un WAV de SU largo (el de radio-oyente-comun dura 180 s para todas): así termina sola en T y la
// proyección del puente, que recorta a la duración de la pista, no la manda más allá del final del audio.
await p.route((u) => u.pathname === `/stream/${A.id}`, (r) => {
  const h = r.request().headers().range; const total = WAV_A.length;
  if (!h) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV_A });
  const [, a, b] = h.match(/bytes=(\d*)-(\d*)/); const start = a ? +a : 0; const end = b ? Math.min(+b, total - 1) : total - 1;
  return r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: WAV_A.subarray(start, end + 1) });
});

const aleatorio = () => p.evaluate(() => window.__player().shuffle);
async function ponerAleatorio(on) {
  if ((await aleatorio()) === on) return;
  await p.locator('.player-bar .shuffle-btn').click();
  await esperar(async () => ((await aleatorio()) === on ? true : null), 3000, 50);
}

const vueltas = [];
try {
  await p.goto(BASE + '/');
  await p.waitForSelector('.player-bar', { timeout: 15000 });
  await p.waitForFunction(() => !!window.__player?.() && !!window.__radio?.());
  await prepararFoto('all');   // una cola propia en pausa: es lo que el oyente recupera al salir de cada vuelta

  for (let i = 0; i < 2 * VUELTAS; i++) {
    const modo = i % 2 === 0 ? 'antes' : 'dentro';
    const v = { i, modo };
    vueltas.push(v);
    await ponerAleatorio(modo === 'antes');
    const code = salaFalsa();
    estadoFk(code, { trackId: A.id, positionMs: INICIO_MS, playing: true, nextTrackId: B.id });
    await escuchar(code);
    v.sonoA = !!(await sonandoEn(A.id)).v;
    if (modo === 'dentro') await ponerAleatorio(true);
    await p.evaluate((x) => window.__player().addToQueue(x), X);
    await sleep(150);
    const f0 = await foto();
    v.antes = { cola: f0.cola, actual: f0.actual, indice: f0.indice, ct: f0.ct, aleatorio: await aleatorio() };
    v.armada = v.sonoA && f0.actual === A.id && f0.indice === 0 && JSON.stringify(f0.cola) === JSON.stringify([A.id, B.id, X.id]) && v.antes.aleatorio === true;
    // A termina sola: la primera pista distinta de A es la que eligió el motor (el desajuste tarda 6 s y el anfitrión
    // sigue en A, así que el puente no pone otra en este rato).
    const t0 = Date.now();
    const cambio = await esperar(async () => { const f = await foto(); return f.actual !== A.id && f.actual != null ? f : null; }, (T * 1000 - INICIO_MS) + 8000, 50);
    v.primera = cambio.v?.actual ?? null;
    v.msHastaElCambio = cambio.v ? Date.now() - t0 : null;
    const vistas = new Set(v.primera != null ? [v.primera] : []);
    const tv = Date.now();
    while (Date.now() - tv < 1500) { vistas.add((await foto()).actual); await sleep(50); }
    v.enLos15s = [...vistas];
    // El anfitrión pasa a B (como el real al terminar A) y el oyente sigue ahí.
    estadoFk(code, { trackId: B.id, positionMs: 500, playing: true, nextTrackId: C.id });
    const enB = await sonandoEn(B.id, 6000);
    v.enB = !!enB.v;
    v.xSono = vistas.has(X.id);
    await salirFk();
  }

  const de = (m) => vueltas.filter((v) => v.modo === m);
  const resumen = (vs) => ({ aB: vs.filter((v) => v.primera === B.id).length, aX: vs.filter((v) => v.primera === X.id).length, otra: vs.filter((v) => v.primera !== B.id && v.primera !== X.id).length, de: vs.length });
  REG.ids = { A: A.id, B: B.id, X: X.id, duracionA_s: T, inicio_s: INICIO_MS / 1000 };
  REG.resumen = { antes: resumen(de('antes')), dentro: resumen(de('dentro')), total: resumen(vueltas) };
  REG.vueltas = vueltas.map((v) => ({ i: v.i, modo: v.modo, armada: v.armada, primera: v.primera, ms: v.msHastaElCambio, en_1_5s: v.enLos15s, enB: v.enB, cola_antes: v.antes.cola, ct_antes: v.antes.ct }));

  ok('precondicion_cola_a_b_x_con_aleatorio_en_todas_las_vueltas', vueltas.length === 2 * VUELTAS && vueltas.every((v) => v.armada),
    { armadas: vueltas.filter((v) => v.armada).length, de: vueltas.length, sin_armar: vueltas.filter((v) => !v.armada).map((v) => ({ i: v.i, modo: v.modo, ...v.antes, sonoA: v.sonoA })) });
  ok('aleatorio_desde_antes_de_unirse_al_terminar_a_suena_b', de('antes').length === VUELTAS && de('antes').every((v) => v.primera === B.id), REG.resumen.antes);
  ok('aleatorio_encendido_en_la_radio_al_terminar_a_suena_b', de('dentro').length === VUELTAS && de('dentro').every((v) => v.primera === B.id), REG.resumen.dentro);
  ok('lo_encolado_no_suena_entre_el_final_de_a_y_b', vueltas.every((v) => !v.xSono), { vueltas_con_x: vueltas.filter((v) => v.xSono).map((v) => v.i) });
  ok('al_pasar_el_anfitrion_a_b_el_oyente_suena_b', vueltas.every((v) => v.enB), { en_b: vueltas.filter((v) => v.enB).length, de: vueltas.length });
  ok('sin_errores_de_pagina', !errores.length, { errores });
} catch (e) {
  ok('excepcion', false, { error: String(e.message).split('\n')[0].slice(0, 200), vueltas: vueltas.length });
} finally {
  for (const [tok, c] of salas) if (c) await api(tok, 'DELETE', `/api/radio/${c}`).catch(() => {});
}

const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
console.log('registro (fuera del conteo):', JSON.stringify(REG, null, 1));
console.log(`\nradio-oyente-aleatorio-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await ctx.close();
await browser.close();
process.exit(fails.length ? 1 : 0);
