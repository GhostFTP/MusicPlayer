// dj-func.mjs — funcional del Modo DJ, sub-paso a (music-client/src/dj/DjPage.jsx + Layout + routes.js):
// la ruta /dj y la CONVIVENCIA con el reproductor normal. Todavía no hay AudioContext ni MIDI.
//   · d1  entrar a /dj (desde el menú) con música sonando deja isPlaying=false y el <audio> en pausa;
//         la barra del reproductor se oculta (display:none) y el aviso «solo escritorio» no se ve a 1280 px.
//   · d2  dentro de /dj, Espacio, ←, →, M y F (sin foco en un campo) no llaman al play() nativo, no
//         mueven el tiempo (←/→), no cambian la cola (M) ni abren pantalla completa (F).
//   · d3  salir de /dj NO reanuda: sigue en pausa, vuelve la barra y sale el aviso «Reanuda con play».
//         CONTROL: fuera de /dj, Espacio SÍ llama a play() (si no, d2 no probaría nada).
//   · d4  F5 en /dj restaura /dj; «atrás» desde /dj vuelve a la vista anterior y «adelante» a /dj;
//         ningún history.back()/go() se llama DENTRO de un popstate (regla dura #3 de nav-lab).
//   · d5  a 800 px de ancho sale «El Modo DJ es solo para escritorio».
//   · d6  con radio activa (anfitrión de una radio REAL, creada con «Iniciar radio» como radio-func) /dj
//         no pausa nada (ni isPlaying ni el pause() nativo), muestra «Sal de la radio para usar el Modo
//         DJ» y deja la barra visible; tampoco tapa teclas: Espacio llega al reproductor normal y lo
//         pausa (d6_4). Después termina la radio desde la interfaz.
// El audio es el WAV sintético de tablet-util (120 s). El play()/pause() nativo y history.back/go se
// cuentan instrumentando los prototipos en la página.
//
// CONTROL NEGATIVO (medido el 2026-11-13 con el runner): DjPage sin el keydown de captura Y sin la
// guarda de radio → 18/26 (fallan 8; el runner no imprime cuáles). Lo esperado, SIN medir por nombre:
// d2_1..d2_4 y d2_6 (las teclas llegan al motor), d3_1 y d3_4 (queda sonando por el Espacio) y d6_2
// (pausa con radio). Además d3_4 es el control propio: fuera de /dj, Espacio SÍ llama a play().
// Uso: SNAP_BASE=http://localhost:4173 node dj-func.mjs
import { BASE } from '../session.mjs';
import { preparar, sleep } from './tablet-util.mjs';

const R = {};
const REG = {};   // lo que sólo se registra (no cuenta en el n/m)
const ok = (k, v, extra) => { R[k] = extra === undefined ? !!v : { ok: !!v, ...extra }; };
const esperar = async (fn, ms = 6000, paso = 150) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(paso); } return null; };

const { browser, abrir } = await preparar();
const { p, errores } = await abrir(BASE, '/', { esperar: '.player-bar' });

// Contadores en la página. Se vuelve a llamar después de cada recarga (F5 borra la página).
const instrumentar = () => p.evaluate(() => {
  if (window.__djInstr) return;
  window.__djInstr = true;
  const M = HTMLMediaElement.prototype; const play0 = M.play; const pause0 = M.pause;
  window.__plays = 0; window.__pausas = 0;
  M.play = function (...a) { if (!(this instanceof HTMLVideoElement)) { window.__plays++; window.__el = this; } return play0.apply(this, a); };
  M.pause = function (...a) { if (!(this instanceof HTMLVideoElement)) window.__pausas++; return pause0.apply(this, a); };
  // history.back()/go() llamados DURANTE un popstate (window.event es el evento que se está despachando).
  window.__navEnPop = []; window.__navLlamadas = 0;
  for (const k of ['back', 'go']) {
    const f = history[k].bind(history);
    history[k] = (...a) => { window.__navLlamadas++; if (window.event?.type === 'popstate') window.__navEnPop.push(k); return f(...a); };
  }
});
const estado = () => p.evaluate(() => {
  const v = window.__player?.(); const el = window.__el;
  const barra = document.querySelector('.player-bar');
  const visible = (sel) => { const e = document.querySelector(sel); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0; };
  return {
    ruta: location.pathname,
    isPlaying: v?.isPlaying ?? null,
    paused: el ? el.paused : null,
    t: el ? Math.round(el.currentTime * 100) / 100 : null,
    cola: v ? v.queue.map((x) => x.id).join(',') : null,
    shuffle: v?.shuffle ?? null,
    plays: window.__plays, pausas: window.__pausas,
    barra: barra ? getComputedStyle(barra).display : 'sin-barra',
    titulo: document.querySelector('.dj-page h1')?.textContent ?? null,
    soloEscritorio: visible('.dj-solo-escritorio'),
    avisoRadio: document.querySelector('.dj-aviso-radio')?.textContent ?? null,
    activo: document.querySelector('.sidebar-nav button.active')?.textContent.trim() ?? null,
    toasts: [...document.querySelectorAll('.toast-text')].map((e) => e.textContent),
    fullscreen: !!document.fullscreenElement,
  };
});
const irA = async (nombre) => { await p.locator('.sidebar-nav button', { hasText: new RegExp(`^${nombre}$`) }).click(); await sleep(600); };
const tecla = async (k) => { await p.evaluate(() => document.activeElement?.blur()); await p.keyboard.press(k); await sleep(250); };

try {
  await instrumentar();
  const pistas = await p.evaluate(async () => {
    const r = await fetch('/api/tracks', { headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } });
    const l = await r.json(); return (Array.isArray(l) ? l : (l.tracks ?? [])).slice(0, 3);
  });
  if (pistas.length < 2) throw new Error(`la base tiene ${pistas.length} pistas`);

  // ── d1: entrar a /dj con música sonando ──
  await p.evaluate((pistas) => window.__player().play(pistas, 0), pistas);
  const sonando = await esperar(async () => { const s = await estado(); return s.isPlaying && s.paused === false && s.t > 0.3 ? s : null; });
  ok('d1_0_antes_suena', !!sonando, { antes: sonando ?? await estado() });
  const pausasAntes = (await estado()).pausas;
  await irA('Modo DJ');
  const enDj = await esperar(async () => { const s = await estado(); return s.ruta === '/dj' && s.isPlaying === false ? s : null; }, 3000) ?? await estado();
  ok('d1_1_ruta_dj_con_titulo', enDj.ruta === '/dj' && enDj.titulo === 'Modo DJ' && enDj.activo === 'Modo DJ', enDj);
  ok('d1_2_pausa_isPlaying_false', enDj.isPlaying === false && enDj.paused === true && enDj.pausas > pausasAntes, { isPlaying: enDj.isPlaying, paused: enDj.paused, pausas: enDj.pausas - pausasAntes });
  ok('d1_3_barra_oculta', enDj.barra === 'none', { barra: enDj.barra });
  ok('d1_4_sin_aviso_escritorio_a_1280', enDj.soloEscritorio === false && enDj.avisoRadio === null, { soloEscritorio: enDj.soloEscritorio, avisoRadio: enDj.avisoRadio });

  // ── d2: teclas tapadas dentro de /dj ──
  const base = await estado();
  const porTecla = {};
  for (const k of ['Space', 'ArrowRight', 'ArrowLeft', 'KeyM', 'KeyF']) {
    const a = await estado(); await tecla(k); await sleep(k === 'KeyM' ? 900 : 0); const d = await estado();
    porTecla[k] = { plays: d.plays - a.plays, t: [a.t, d.t], cola: a.cola === d.cola, shuffle: [a.shuffle, d.shuffle], isPlaying: d.isPlaying, fullscreen: d.fullscreen };
  }
  ok('d2_1_espacio_no_llama_play', porTecla.Space.plays === 0 && porTecla.Space.isPlaying === false, porTecla.Space);
  ok('d2_2_flecha_derecha_no_llama_play_ni_mueve', porTecla.ArrowRight.plays === 0 && porTecla.ArrowRight.t[0] === porTecla.ArrowRight.t[1], porTecla.ArrowRight);
  ok('d2_3_flecha_izquierda_no_llama_play_ni_mueve', porTecla.ArrowLeft.plays === 0 && porTecla.ArrowLeft.t[0] === porTecla.ArrowLeft.t[1], porTecla.ArrowLeft);
  ok('d2_4_m_no_llama_play_ni_cambia_la_cola', porTecla.KeyM.plays === 0 && porTecla.KeyM.cola && porTecla.KeyM.shuffle[0] === porTecla.KeyM.shuffle[1], porTecla.KeyM);
  ok('d2_5_f_no_llama_play_ni_pantalla_completa', porTecla.KeyF.plays === 0 && porTecla.KeyF.fullscreen === false, porTecla.KeyF);
  const tras = await estado();
  ok('d2_6_sigue_en_pausa_en_dj', tras.isPlaying === false && tras.paused === true && tras.ruta === '/dj' && tras.cola === base.cola, { isPlaying: tras.isPlaying, ruta: tras.ruta });

  // ── d3: salir de /dj no reanuda; control negativo de Espacio fuera de /dj ──
  await irA('Biblioteca');
  const fuera = await estado();
  const toast = await esperar(async () => (await estado()).toasts.includes('Reanuda con play'), 1500);
  ok('d3_1_salir_no_reanuda', fuera.ruta === '/' && fuera.isPlaying === false && fuera.paused === true, { ruta: fuera.ruta, isPlaying: fuera.isPlaying });
  ok('d3_2_vuelve_la_barra', fuera.barra !== 'none', { barra: fuera.barra });
  ok('d3_3_aviso_reanuda_con_play', !!toast, { toasts: (await estado()).toasts });
  const c0 = await estado(); await tecla('Space');
  const c1 = await esperar(async () => { const s = await estado(); return s.isPlaying ? s : null; }, 2000) ?? await estado();
  ok('d3_4_control_espacio_fuera_de_dj_si_suena', c1.plays - c0.plays >= 1 && c1.isPlaying === true, { plays: c1.plays - c0.plays, isPlaying: c1.isPlaying });
  await p.evaluate(() => window.__player().pause());
  await sleep(300);

  // ── d4: F5 en /dj, atrás y adelante; nada de history.back()/go() dentro de popstate ──
  await irA('Modo DJ');
  await p.reload(); await p.waitForSelector('.dj-page', { timeout: 15000 }).catch(() => {}); await sleep(500);
  await instrumentar();
  const f5 = await estado();
  ok('d4_1_f5_restaura_dj', f5.ruta === '/dj' && f5.titulo === 'Modo DJ' && f5.activo === 'Modo DJ', { ruta: f5.ruta, titulo: f5.titulo, activo: f5.activo });
  await p.goBack(); await sleep(700);
  const atras = await estado();
  ok('d4_2_atras_vuelve_a_la_biblioteca', atras.ruta === '/' && atras.activo === 'Biblioteca' && atras.titulo === null, { ruta: atras.ruta, activo: atras.activo });
  await p.goForward(); await sleep(700);
  const adelante = await estado();
  ok('d4_3_adelante_vuelve_a_dj', adelante.ruta === '/dj' && adelante.titulo === 'Modo DJ', { ruta: adelante.ruta, titulo: adelante.titulo });
  await irA('Ajustes'); await p.goBack(); await sleep(700);
  const atras2 = await estado();
  ok('d4_4_atras_desde_otra_vista_a_dj', atras2.ruta === '/dj' && atras2.titulo === 'Modo DJ', { ruta: atras2.ruta });
  const nav = await p.evaluate(() => ({ enPop: window.__navEnPop, llamadas: window.__navLlamadas }));
  ok('d4_5_sin_back_ni_go_dentro_de_popstate', nav.enPop.length === 0, nav);

  // ── d5: aviso «solo escritorio» por debajo de 900 px ──
  await p.setViewportSize({ width: 800, height: 800 }); await sleep(300);
  const angosto = await estado();
  ok('d5_1_aviso_solo_escritorio_a_800', angosto.soloEscritorio === true
    && await p.locator('.dj-solo-escritorio').textContent() === 'El Modo DJ es solo para escritorio', { soloEscritorio: angosto.soloEscritorio });
  await p.setViewportSize({ width: 1280, height: 800 }); await sleep(300);

  // ── d6: con radio activa /dj no pausa nada ──
  await p.evaluate((pistas) => window.__player().play(pistas, 1), pistas);
  await esperar(async () => (await estado()).isPlaying, 4000);
  await irA('Radio');
  await p.locator('.main-content .radio-btn', { hasText: 'Iniciar radio' }).click();
  const anfitrion = await esperar(() => p.evaluate(() => !!document.querySelector('.radio-terminar')), 6000);
  ok('d6_0_radio_iniciada', !!anfitrion);
  if (anfitrion) {
    const r0 = await estado();
    await irA('Modo DJ'); await sleep(700);
    const r1 = await estado();
    ok('d6_1_aviso_sal_de_la_radio', r1.ruta === '/dj' && r1.avisoRadio === 'Sal de la radio para usar el Modo DJ', { ruta: r1.ruta, avisoRadio: r1.avisoRadio });
    ok('d6_2_no_pausa', r0.isPlaying === true && r1.isPlaying === true && r1.paused === false && r1.pausas === r0.pausas, { antes: r0.isPlaying, despues: r1.isPlaying, pausas: r1.pausas - r0.pausas });
    ok('d6_3_barra_visible', r1.barra !== 'none', { barra: r1.barra });
    // d6_4: con radio el Modo DJ tampoco tapa teclas. Calca d3_4 al revés (suena → Espacio → pausa):
    // el Espacio llega al atajo de PlayerContext, que llama al pause() nativo y deja isPlaying=false.
    const k0 = await estado(); await tecla('Space');
    const k1 = await esperar(async () => { const s = await estado(); return s.isPlaying === false ? s : null; }, 2000) ?? await estado();
    ok('d6_4_con_radio_espacio_llega_al_reproductor', k0.isPlaying === true && k1.pausas - k0.pausas >= 1 && k1.isPlaying === false && k1.ruta === '/dj', { antes: k0.isPlaying, despues: k1.isPlaying, pausas: k1.pausas - k0.pausas, ruta: k1.ruta });
    await irA('Radio');
    await p.getByRole('button', { name: 'Terminar radio' }).click(); await sleep(250);
    await p.getByRole('button', { name: 'Sí, terminar' }).click();
    const fin = await esperar(() => p.evaluate(() => !document.querySelector('.radio-terminar')), 6000);
    REG.radio_terminada = !!fin;
  }
  await p.evaluate(() => window.__player()?.pause());
  ok('d7_sin_errores_de_pagina', errores.length === 0, { errores });
} catch (e) {
  ok('excepcion', false, { error: String(e.message).split('\n')[0].slice(0, 200) });
}

const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
console.log('registro (fuera del conteo):', JSON.stringify(REG, null, 1));
console.log(`\ndj-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
