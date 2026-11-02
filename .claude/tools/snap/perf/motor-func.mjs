// motor-func.mjs — funcional de los cambios chicos al MOTOR del reproductor (PlayerContext.jsx) que pide
// la Radio web (fase 1, sub-paso 4). Un archivo para todos, así cada cambio suma sus casos acá y no
// hace falta levantar dos cuentas ni la radio (eso es radio-func, 2 min) para probar el motor:
//   · P-a  seek() sin duración todavía (NaN antes de los metadatos) NO recorta a 0: el navegador
//          guarda el punto pedido y lo aplica al cargar. Con duración, igual que antes.
//          Y seek(Infinity) / seek(NaN) no hacen nada (antes lanzaban TypeError al asignar).
//   · P-b  play(lista, i, { sonar: false }) deja la pista cargada y EN PAUSA (no llama a el.play() e
//          isPlaying queda en false aunque antes sonara). Sin tercer argumento, o con {}, suena como siempre.
//   · P-e  setRepeatMode(m) pone 'off' | 'all' | 'one' (la radio lo apaga al unirse y lo devuelve al salir);
//          un valor que no sea uno de esos no hace nada. Se mide en lo que hace playNext al TERMINAR la pista.
//
// El audio es el WAV sintético de tablet-util (120 s). Para que el seek caiga ANTES de los metadatos
// de forma segura, el stream contesta con DEMORA_MS de retraso: la pista arranca (play), se llama
// seek(30) enseguida y recién después llegan los bytes. Se instrumenta el prototipo de HTMLMediaElement
// para quedarse con el elemento que usa el reproductor y contar cuántos distintos hubo (uno solo).
//
// CONTROL NEGATIVO: con el recorte viejo (`Math.min(time, el.duration || 0)`) tienen que FALLAR los
// pa_* que siguen al seek antes de los metadatos (la pista va a 0 y suena desde el principio); los de
// duración conocida pasan igual. Sin la guarda de `Number.isFinite(time)` tiene que FALLAR pa_11.
// Si playIndex ignora `sonar` (siempre suena) tienen que FALLAR pb_1, pb_1b, pb_2, pb_2b y pb_4; sin el
// setIsPlaying(false) de sonar:false, isPlaying queda en true (el src nuevo pausa sin evento 'pause') y
// fallan pb_1, pb_1b, pb_2 y pb_4. Si setRepeatMode no actualiza repeatRef.current (sólo el estado), el
// estado dice el modo pero playNext no: fallan pe_1, pe_3 y pe_4.
// Uso: SNAP_BASE=http://localhost:4173 node motor-func.mjs
import { BASE } from '../session.mjs';
import { preparar, sleep } from './tablet-util.mjs';

const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? !!v : { ok: !!v, ...extra }; };
const DEMORA_MS = 1200;

const { browser, abrir } = await preparar();
const { ctx, p, errores } = await abrir(BASE, '/', { esperar: '.player-bar' });
// Después de la de tablet-util: ésta se evalúa PRIMERO, espera y le pasa el pedido a aquélla.
await ctx.route('**/stream/**', async (r) => { if (!r.request().url().includes('/stream/video/')) await sleep(DEMORA_MS); return r.fallback(); });

await p.evaluate(() => {
  const M = HTMLMediaElement.prototype; const play0 = M.play;
  window.__medios = new Set();
  M.play = function (...a) { window.__medios.add(this); if (!(this instanceof HTMLVideoElement)) window.__el = this; return play0.apply(this, a); };
});
const pistas = await p.evaluate(async () => {
  const r = await fetch('/api/tracks', { headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } });
  const l = await r.json(); return (Array.isArray(l) ? l : (l.tracks ?? [])).slice(0, 3);
});

// Arranca la pista `i` de la lista, llama seek(t) en el MISMO tick (antes de los metadatos) y muestrea
// currentTime cada 50 ms hasta `ms`. Devuelve lo que vio el elemento al momento del seek y la serie.
const arrancarYSaltar = (i, t, ms = 3500) => p.evaluate(async ({ pistas, i, t, ms }) => {
  const v = window.__player();
  v.play(pistas, i);
  const el = window.__el;
  const alSaltar = { duracion: String(el.duration), readyState: el.readyState };
  v.seek(t);
  const justoDespues = el.currentTime;
  let metaEn = null; const t0 = performance.now();
  el.addEventListener('loadedmetadata', () => { metaEn = Math.round(performance.now() - t0); }, { once: true });
  const serie = [];
  while (performance.now() - t0 < ms) { serie.push([Math.round(performance.now() - t0), Math.round(el.currentTime * 100) / 100, el.readyState]); await new Promise((r) => setTimeout(r, 50)); }
  return { alSaltar, justoDespues, metaEn, serie, paused: el.paused, duracion: el.duration };
}, { pistas, i, t, ms });

try {
  // ── P-a: seek(30) antes de los metadatos ──
  const a = await arrancarYSaltar(0, 30);
  const conDatos = a.serie.filter(([, , rs]) => rs >= 1);           // desde que hay metadatos
  const primero = conDatos[0]?.[1] ?? null;
  const ultimo = a.serie.at(-1)[1];
  ok('pa_1_el_seek_fue_antes_de_los_metadatos', a.alSaltar.duracion === 'NaN' && a.alSaltar.readyState === 0, { alSaltar: a.alSaltar, metaEn: a.metaEn });
  ok('pa_2_al_cargar_arranca_en_30', primero != null && primero >= 29.5 && primero <= 31, { primero, metaEn: a.metaEn });
  ok('pa_3_con_metadatos_nunca_suena_desde_el_principio', conDatos.length > 0 && conDatos.every(([, ct]) => ct >= 29.5), { min: Math.min(...conDatos.map(([, ct]) => ct)), muestras: conDatos.length });
  ok('pa_4_avanza_desde_30', !a.paused && ultimo > 30.5 && ultimo < 34, { ultimo, paused: a.paused, duracion: a.duracion });

  // ── Con duración conocida: igual que antes ──
  await sleep(300);
  const d = await p.evaluate(async () => {
    const v = window.__player(); const el = window.__el;
    const leer = async (t) => { v.seek(t); await new Promise((r) => setTimeout(r, 250)); return Math.round(el.currentTime * 10) / 10; };
    const a10 = await leer(10), menos = await leer(-5), a60 = await leer(60);
    // Al final se lee en el MISMO tick: después la pista termina y el reproductor pasa a la siguiente.
    v.seek(10_000); const fuera = el.currentTime;
    return { dur: el.duration, a10, menos, a60, fuera };
  });
  ok('pa_5_con_duracion_seek_normal', d.a10 >= 10 && d.a10 < 10.6 && d.a60 >= 60 && d.a60 < 60.6, d);
  ok('pa_6_con_duracion_negativo_va_a_0', d.menos >= 0 && d.menos < 0.6, d);
  ok('pa_7_con_duracion_recorta_al_final', d.dur === 120 && d.fuera === d.dur, d);

  // ── seek NEGATIVO antes de los metadatos: a 0, sin error ──
  const n = await arrancarYSaltar(1, -5, 2500);
  const nDatos = n.serie.filter(([, , rs]) => rs >= 1);
  ok('pa_8_negativo_sin_metadatos_va_a_0', n.alSaltar.duracion === 'NaN' && nDatos.length > 0 && nDatos[0][1] < 1, { alSaltar: n.alSaltar, primero: nDatos[0]?.[1] ?? null });

  // ── seek(Infinity) y seek(NaN), antes y después de los metadatos: no lanzan y no mueven nada ──
  const raro = await p.evaluate(async ({ pistas }) => {
    const v = window.__player();
    const probar = (el) => ['Infinity', 'NaN'].map((x) => {
      const antes = el.currentTime; let lanzo = null;
      try { v.seek(Number(x)); } catch (e) { lanzo = e.name; }
      return { x, lanzo, antes: Math.round(antes * 100) / 100, despues: Math.round(el.currentTime * 100) / 100 };
    });
    v.play(pistas, 2);
    const el = window.__el;
    const sinMeta = { readyState: el.readyState, duracion: String(el.duration), r: probar(el) };
    await new Promise((r) => el.readyState >= 1 ? r() : el.addEventListener('loadedmetadata', r, { once: true }));
    await new Promise((r) => setTimeout(r, 400));
    const alCargar = Math.round(el.currentTime * 100) / 100;            // sin salto: sigue cerca del principio
    const conMeta = { readyState: el.readyState, duracion: el.duration, r: probar(el) };
    return { sinMeta, alCargar, conMeta };
  }, { pistas });
  const quietos = (l) => l.every((o) => o.lanzo === null && Math.abs(o.despues - o.antes) < 0.1);
  ok('pa_11_seek_infinito_o_nan_no_lanza_ni_mueve', raro.sinMeta.readyState === 0 && raro.conMeta.readyState >= 1
    && quietos(raro.sinMeta.r) && quietos(raro.conMeta.r) && raro.alCargar < 1.5, raro);

  // ── P-b: play(lista, i, { sonar: false }) carga y deja en pausa ──
  await p.evaluate(() => {
    const M = HTMLMediaElement.prototype; const src = Object.getOwnPropertyDescriptor(M, 'src');
    window.__conSrc = new Set(); window.__plays = 0;
    Object.defineProperty(M, 'src', { get() { return src.get.call(this); }, set(v) { if (this instanceof HTMLAudioElement) { window.__conSrc.add(this); window.__audio = this; } src.set.call(this, v); }, configurable: true });
    const play0 = M.play; M.play = function (...a) { window.__plays++; return play0.apply(this, a); };
    // El valor de usePlayerTime (PlayerTimeContext): el provider cuyo value es { currentTime, duration }.
    window.__tiempo = () => {
      const root = document.getElementById('root'); const key = Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
      const stack = [root[key]?.stateNode?.current ?? root[key]];
      while (stack.length) { const f = stack.pop(); if (!f) continue; const v = f.memoizedProps?.value;
        if (v && Object.keys(v).length === 2 && 'currentTime' in v && 'duration' in v) return v;
        if (f.sibling) stack.push(f.sibling); if (f.child) stack.push(f.child); }
      return null;
    };
  });
  // Muestrea cada 25 ms durante `ms`: isPlaying, paused del <audio>, y los play() llamados.
  const muestrear = (ms) => p.evaluate(async (ms) => {
    const s = []; const t0 = performance.now();
    while (performance.now() - t0 < ms) { const v = window.__player(); s.push({ isPlaying: v.isPlaying, paused: window.__audio?.paused ?? null }); await new Promise((r) => setTimeout(r, 25)); }
    return s;
  }, ms);
  const ponerASonar = () => p.evaluate(async ({ pistas }) => {
    window.__player().play(pistas, 2);
    const t0 = performance.now(); while (!window.__player().isPlaying && performance.now() - t0 < 4000) await new Promise((r) => setTimeout(r, 50));
    return window.__player().isPlaying;
  }, { pistas });

  // (1) Desde una pista SONANDO: play(lista, 0, { sonar: false }) → nunca isPlaying true, nunca suena.
  const sonaba = await ponerASonar();
  await p.evaluate(({ pistas }) => { window.__plays = 0; window.__player().play(pistas, 0, { sonar: false }); }, { pistas });
  const s1 = await muestrear(1000);
  const e1 = await p.evaluate(() => { const v = window.__player(); return { plays: window.__plays, actual: v.currentTrack?.id, cola: v.queue.map((t) => t.id), queueIndex: v.queueIndex, ms: navigator.mediaSession?.playbackState }; });
  ok('pb_1_sin_sonar_queda_en_pausa_sin_parpadeo', sonaba && s1.length > 20 && s1.every((x) => x.isPlaying === false && x.paused === true) && e1.plays === 0,
    { sonaba, muestras: s1.length, algunaVezSonando: s1.some((x) => x.isPlaying || x.paused === false), plays: e1.plays });
  ok('pb_1b_sin_sonar_pone_pista_y_cola', e1.actual === pistas[0].id && JSON.stringify(e1.cola) === JSON.stringify(pistas.map((t) => t.id)) && e1.queueIndex === 0 && e1.ms === 'paused', e1);

  // (2) Con P-a: play(lista, 1, { sonar: false }) + seek(40) → tras cargar, en 40, en pausa, y usePlayerTime lo refleja.
  const e2 = await p.evaluate(async ({ pistas }) => {
    const v = window.__player(); window.__plays = 0;
    v.play(pistas, 1, { sonar: false }); v.seek(40);
    const el = window.__audio;
    await new Promise((r) => el.readyState >= 1 ? r() : el.addEventListener('loadedmetadata', r, { once: true }));
    await new Promise((r) => setTimeout(r, 800));
    const t = window.__tiempo();
    return { actual: window.__player().currentTrack?.id, ct: Math.round(el.currentTime * 100) / 100, paused: el.paused, isPlaying: window.__player().isPlaying, plays: window.__plays, tiempo: t && { currentTime: Math.round(t.currentTime * 100) / 100, duration: t.duration } };
  }, { pistas });
  ok('pb_2_sin_sonar_mas_seek_queda_en_40_en_pausa', e2.actual === pistas[1].id && e2.ct >= 39.9 && e2.ct <= 40.1 && e2.paused && !e2.isPlaying && e2.plays === 0, e2);
  ok('pb_2b_usePlayerTime_refleja_posicion_y_duracion', !!e2.tiempo && Math.abs(e2.tiempo.currentTime - 40) < 0.2 && e2.tiempo.duration === 120, e2);

  // (3) Sin tercer argumento y con {}: suenan como siempre.
  const e3 = [];
  for (const arg of ['ninguno', 'vacio']) {
    e3.push(await p.evaluate(async ({ pistas, arg }) => {
      const v = window.__player(); window.__plays = 0;
      if (arg === 'ninguno') v.play(pistas, 0); else v.play(pistas, 0, {});
      // isPlaying se prende con el evento 'play' (enseguida); el audio llega DEMORA_MS después: se espera a que avance.
      const t0 = performance.now(); while (window.__audio.currentTime < 0.1 && performance.now() - t0 < 4000) await new Promise((r) => setTimeout(r, 50));
      const a = window.__audio.currentTime; await new Promise((r) => setTimeout(r, 700));
      return { arg, isPlaying: window.__player().isPlaying, paused: window.__audio.paused, plays: window.__plays, avanza: window.__audio.currentTime > a + 0.3 };
    }, { pistas, arg }));
  }
  ok('pb_3_por_defecto_suena_como_siempre', e3.every((x) => x.isPlaying && !x.paused && x.plays === 1 && x.avanza), { e3 });

  // ── P-e: setRepeatMode(m) cambia lo que hace playNext cuando la pista TERMINA SOLA ──
  // Arranca la pista `i`, ya sonando le aplica los modos `modos` en orden, salta a 119,3 s (de 120) y
  // espera el 'ended' y la carga siguiente. Lo que decide es repeatRef (lo lee playNext), no el estado.
  const alTerminar = (i, modos) => p.evaluate(async ({ pistas, i, modos }) => {
    const espera = async (cond, ms) => { const t0 = performance.now(); while (!cond() && performance.now() - t0 < ms) await new Promise((r) => setTimeout(r, 50)); return cond(); };
    window.__player().play(pistas, i);
    const el = window.__audio;
    await espera(() => el.currentTime > 0.1, 4000);
    for (const m of modos) window.__player().setRepeatMode(m);
    await new Promise((r) => setTimeout(r, 150));
    const repeat = window.__player().repeat;
    let termino = false, cargas = 0;
    el.addEventListener('ended', () => { termino = true; }, { once: true });
    const alCargar = () => { cargas++; }; el.addEventListener('loadstart', alCargar);
    window.__player().seek(119.3);
    await espera(() => termino, 4000);
    // Lo que venga (la misma o la siguiente) vuelve a cargar y arranca desde el principio.
    await espera(() => cargas > 0 && el.currentTime > 0.1 && el.currentTime < 5, 4000);
    el.removeEventListener('loadstart', alCargar);
    const v = window.__player();
    return { modos: modos.map(String), repeat, termino, cargas, queueIndex: v.queueIndex, actual: v.currentTrack?.id, isPlaying: v.isPlaying, ct: Math.round(el.currentTime * 100) / 100 };
  }, { pistas, i, modos });

  const r1 = await alTerminar(0, ['one']);
  ok('pe_1_one_al_terminar_repite_la_misma', r1.repeat === 'one' && r1.termino && r1.cargas > 0 && r1.queueIndex === 0 && r1.actual === pistas[0].id && r1.isPlaying && r1.ct < 5, r1);
  const r2 = await alTerminar(0, ['off']);                       // viene de 'one': el cambio también tiene que llegar al ref
  ok('pe_2_off_al_terminar_avanza', r2.repeat === 'off' && r2.termino && r2.queueIndex === 1 && r2.actual === pistas[1].id && r2.isPlaying, r2);
  const r3 = await alTerminar(2, ['all']);                       // última de la cola: con 'all' vuelve a la primera
  ok('pe_3_all_en_la_ultima_vuelve_a_la_primera', r3.repeat === 'all' && r3.termino && r3.queueIndex === 0 && r3.actual === pistas[0].id && r3.isPlaying, r3);
  // Inválidos después de 'one': no cambian ni el estado ni lo que pasa al terminar (repite).
  const r4 = await alTerminar(0, ['one', 'loop', 'ONE', '', null, undefined, 1, true, {}]);
  ok('pe_4_invalido_no_cambia_nada', r4.repeat === 'one' && r4.termino && r4.queueIndex === 0 && r4.actual === pistas[0].id && r4.isPlaying, r4);
  // cycleRepeat sigue el ciclo desde el modo puesto a mano (all → one), y se deja en 'off' para lo que sigue.
  const r5 = await p.evaluate(async () => {
    const paso = async (f) => { f(window.__player()); await new Promise((r) => setTimeout(r, 100)); return window.__player().repeat; };
    const a = await paso((v) => v.setRepeatMode('all')); const b = await paso((v) => v.cycleRepeat()); const c = await paso((v) => v.setRepeatMode('off'));
    return { a, b, c };
  });
  ok('pe_5_cycleRepeat_sigue_desde_el_modo_puesto', r5.a === 'all' && r5.b === 'one' && r5.c === 'off', r5);

  // (4) sonar: false con un VIDEO (si hay videos): se registra qué pasa, sin exigir nada más que "no suena".
  const vids = await p.evaluate(async () => { const r = await fetch('/api/videos', { headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } }); return ((await r.json()).videos ?? []).slice(0, 1).map((v) => ({ ...v, kind: 'video' })); });
  if (vids.length) {
    await p.evaluate(({ vids }) => { window.__plays = 0; window.__player().play(vids, 0, { sonar: false }); }, { vids });
    const s4 = await muestrear(1500);
    const e4 = await p.evaluate(() => { const vd = document.querySelector('video.player-video'); const v = window.__player();
      return { plays: window.__plays, actual: v.currentTrack?.title, isPlaying: v.isPlaying, video: vd && { paused: vd.paused, readyState: vd.readyState, listo: vd.dataset.ready === '1', src: !!vd.getAttribute('src') }, audioSinSrc: !window.__audio?.getAttribute('src') }; });
    ok('pb_4_video_sin_sonar_no_suena', s4.every((x) => !x.isPlaying) && e4.plays === 0 && e4.video?.paused === true, { ...e4, algunaVezSonando: s4.some((x) => x.isPlaying) });
  } else ok('pb_4_video_sin_sonar_no_suena', false, { motivo: 'no hay videos en el catálogo (¿VIDEO_DIR?)' });

  const conSrc = await p.evaluate(() => window.__conSrc.size);
  ok('pb_5_un_solo_audio', conSrc === 1, { audiosConSrc: conSrc });

  const medios = await p.evaluate(() => window.__medios.size);
  ok('pa_9_un_solo_elemento_de_media', medios === 1, { medios });
  ok('pa_10_sin_errores_de_pagina', errores.length === 0, { errores });
} catch (e) {
  ok('excepcion', false, { error: String(e.message).split('\n')[0].slice(0, 200) });
}

await ctx.close();
const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
if (process.env.MOTOR_DUMP) (await import('node:fs')).writeFileSync(process.env.MOTOR_DUMP, JSON.stringify(R, null, 1));
console.log(`\nmotor-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
