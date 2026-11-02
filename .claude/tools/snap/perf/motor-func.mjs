// motor-func.mjs — funcional de los cambios chicos al MOTOR del reproductor (PlayerContext.jsx) que pide
// la Radio web (fase 1, sub-paso 4). Un archivo para todos, así cada cambio suma sus casos acá y no
// hace falta levantar dos cuentas ni la radio (eso es radio-func, 2 min) para probar el motor:
//   · P-a  seek() sin duración todavía (NaN antes de los metadatos) NO recorta a 0: el navegador
//          guarda el punto pedido y lo aplica al cargar. Con duración, igual que antes.
//          Y seek(Infinity) / seek(NaN) no hacen nada (antes lanzaban TypeError al asignar).
//
// El audio es el WAV sintético de tablet-util (120 s). Para que el seek caiga ANTES de los metadatos
// de forma segura, el stream contesta con DEMORA_MS de retraso: la pista arranca (play), se llama
// seek(30) enseguida y recién después llegan los bytes. Se instrumenta el prototipo de HTMLMediaElement
// para quedarse con el elemento que usa el reproductor y contar cuántos distintos hubo (uno solo).
//
// CONTROL NEGATIVO: con el recorte viejo (`Math.min(time, el.duration || 0)`) tienen que FALLAR los
// pa_* que siguen al seek antes de los metadatos (la pista va a 0 y suena desde el principio); los de
// duración conocida pasan igual. Sin la guarda de `Number.isFinite(time)` tiene que FALLAR pa_11.
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
