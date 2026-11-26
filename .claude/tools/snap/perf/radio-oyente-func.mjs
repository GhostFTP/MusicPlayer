// radio-oyente-func.mjs — la Radio web, OYENTE (fase 1, sub-paso 4), contra el BUILD DE PRODUCCIÓN
// (preview :4173) y el backend REAL del runner (:3100, copia de la base). Archivo aparte de radio-func
// (el anfitrión) a propósito, para no inflarlo.
//
// Montaje: la PÁGINA es el oyente, con la segunda cuenta (SNAP2_USER/SNAP2_PASS, la crea el runner en su
// copia). El ANFITRIÓN es la cuenta principal, manejada POR API desde node: crear, PUT /state con
// posiciones controladas, terminar. El audio sale de un WAV sintético de 180 s por /stream (page.route).
// La vista Radio todavía no tiene cara de oyente: el test llama unirse()/salir() del provider, que
// encuentra por la fibra de React (window.__radio(), igual que window.__player() en tablet-util).
// La posición esperada se calcula en node: la publicada + lo que pasó desde el PUT (mismo equipo, así
// que el reloj del servidor y el local son el mismo).
//
// Casos, primera tanda (contra el servidor de radio REAL):
//   1   unirse → fase 'oyente' y el anfitrión ve al oyente, con el id de la segunda cuenta.
//   2   arranca la canción del anfitrión, sonando, con cola [pista, siguiente], en la posición proyectada.
//   L   lecturas: en 10 s, ~1 GET de la sala cada SONDEO_MS (2 s), sin ráfagas; y play/seek/pause/
//       resume/setRepeatMode con la MISMA identidad al principio y al final de la sala (si cambiaran,
//       el efecto del puente se reiniciaría y leería de más).
//   3   el anfitrión pausa (el oyente se pausa en esa posición) y reanuda (el oyente reanuda en vivo).
//   4   salto del anfitrión → seek a la posición nueva.
//   8   un desfase local de +5 s se corrige; uno de +1,2 s (menos que TOLERANCIA_MS) no.
//   6   pausa propia → silenciada; un salto del anfitrión no lo mueve; al darle play salta al vivo.
//   7   desajuste: el oyente pone otra canción → a los DESAJUSTE_MS vuelve la de la radio.
//   7b  con OTRA canción puesta, la radio pausa y reanuda: no la mueve (ni seek ni resume) — la guarda
//       enLaDeLaRadio. (pause() sí la calla: la radio está en pausa.)
//   5   cambio de pista → arranca la nueva, con su siguiente.
//   11  video del anfitrión → en pausa con aviso 'video'; al volver una canción, arranca.
//   10  el anfitrión termina → texto de fin del oyente y la foto restaurada (en pausa, sin play()).
//   9   (otra sala) salir restaura la foto: misma cola, índice y posición, EN PAUSA, sin llamar a
//       play() y con el repeat devuelto.
//   H   higiene: tras salir, 0 lecturas en 5 s y ningún temporizador del sondeo pendiente; un solo
//       elemento de media; sin errores de página.
//   12  la sala propia se rechaza con "Esta radio es tuya." y no deja al oyente anotado.
//   14  quiereSonar (lo que lee "Toca para escuchar"): true con el anfitrión sonando, false en pausa y
//       con video, true otra vez al reanudar y al volver de un video.
//   13  logout siendo oyente: el reproductor queda EN PAUSA (no restaura la cola), con el repeat de la foto,
//       y la radio sin lecturas ni sondeo.
// Fuera del conteo ("registro"): cómo queda un oyente que venía de un VIDEO al salir.
//
// Casos, segunda tanda (contra un SERVIDOR FALSO: page.route sobre /api/radio/FK…, /api/tracks/:id y
// /api/users/:id/avatar; se entra con el botón "Escuchar" de la vista, en /radio/CÓDIGO):
//   U_*  al unirse con 404, 409 (llena), 410, 200 con ended y la sala propia: el texto de .radio-estado,
//        fase 'sin-radio', la cola propia intacta (sin play()) y el foco de vuelta en "Escuchar".
//   (D_*, el sondeo cuando algo falla durante la sala, vive en radio-oyente-sondeo-func.)
//   B_*  autoplay bloqueado (stub: un play() fuera de un clic de verdad rechaza con NotAllowedError):
//        "Toca para escuchar" está en la vista Radio y no en la barra; el clic suena en vivo (desfase
//        < 2 s) y el botón se va; con el anfitrión en pausa no aparece aunque playBlocked siga en true.
//   V_*  la vista: la ficha /radio/CÓDIGO no lee la sala antes del clic (0 lecturas en 3 s); "Uniéndose…"
//        (ocupado, con Cancelar) mientras la primera lectura tarda, y Cancelar vuelve a la ficha con el
//        foco en "Escuchar" sin que la respuesta tardía lo meta en la radio; los avisos en la región viva
//        (el mismo nodo, role=status), el texto de silenciada, "Iniciar radio" y el campo de unirse
//        bloqueados con sus notas siendo oyente, y "Salir de la radio" → cara "sin radio" con el foco en
//        el h1.
//   (F_* y G_*, las órdenes de quien modera de W5b-1, viven en radio-ordenes-func; el montaje, en radio-oyente-comun.)
//   A    avatares: foto con ?v= → &token=, foto sin ?v= → ?token=, foto que falla → la inicial, emoji.
//   401  (al final: cierran la sesión) al unirse y durante. Un 401 pasa por onUnauthorized → logout: el
//        provider se desmonta y aparece el Login, así que el texto de fin no se ve. Al unirse, la cola
//        propia queda intacta; durante, la foto SÍ vuelve (finOyente('sesion') corre en microtareas,
//        antes de que React desmonte), con el repeat, y no hay más lecturas.
//
// CONTROL NEGATIVO: sin la restauración de finOyente, falla el 9 (y el 10); sin la guarda de sala propia,
// falla el 12; sin el desajuste, falla el 7; sin aplicar la corrección, falla el 8; sin marcar
// silenciada, falla el 6; sin la guarda enLaDeLaRadio en pausar/reanudar/saltar, falla el 7b; sin la pausa
// del desmontaje del provider, falla el 13; con quiereSonar fijo en true, falla el 14.
// Segunda tanda: sin el seek de tocarParaEscuchar, falla B_el_clic_suena_en_vivo; con el botón sin la condición
// quiereSonar, falla B_con_el_anfitrion_en_pausa; con la ficha leyendo la sala al montarse, falla V_ficha_sin_leer;
// con Cancelar sin invalidar el unirse en curso, falla V_uniendose_y_cancelar. (Los controles de los D_* están en
// radio-oyente-sondeo-func.)
// Uso: SNAP_BASE=http://localhost:4173 SNAP2_USER=… SNAP2_PASS=… node radio-oyente-func.mjs
import {
  R, ok, REG, sleep, TOLERANCIA_S, SONDEO_MS, DESAJUSTE_MS, TXT_FIN, tokHost, login2, tokOye, idOye, api, lista,
  todas, largas, A, B, C, D, PROPIAS, wav, WAV, chromium, browser, ctx, p, errores, lecturas, esperar, foto, r2,
  mismo, salaComoHost, pub, publicar, proyectada, medir, sondeoPendiente, abrirSala, prepararFoto, restaurada,
  ALFA, FK, nFk, seqFk, HOST_FK, YO_FK, salaFalsa, estadoFk, vivoFk, json, esFk, rutaFk, idOrdenFk, esOrdenFk,
  rutaOrdenFk, TRK, pedidosTrk, PNG, AVATAR_ROTO, pedidosAvatar, sinToken, irA, escuchar, vista, sonandoEn,
  medirFk, entrarFk, salirFk, TXT_SIN_RESPUESTA, TXT_BLOQUEADO, TXT_SILENCIADA, sinSesion, volverAEntrar, salas,
  BASE
} from './radio-oyente-comun.mjs';

try {
  await p.goto(BASE + '/');
  await p.waitForSelector('.player-bar', { timeout: 15000 });
  await p.waitForFunction(() => !!window.__player?.() && !!window.__radio?.() && !!window.__auth?.());
  const sondeoAntes = await sondeoPendiente();

  // ════ Sala 1: casos 1-8, 7b, 5, 11 y 10 ════
  const antes = await prepararFoto('all');
  const s1 = await abrirSala();
  const st1 = await publicar(s1.code, { trackId: A.id, positionMs: 40_000, playing: true, nextTrackId: B.id });

  // ── 1. unirse ──
  const unido = await p.evaluate((c) => window.__radio().unirse(c), s1.code);
  const f1 = await foto();
  const anotado = await esperar(async () => { const s = await salaComoHost(tokHost, s1.code); return (s.j?.listeners ?? []).some((x) => x.id === idOye) ? s.j.listeners.map((x) => x.id) : null; }, 4000);
  ok('01_unirse_queda_oyente_y_anotado', s1.status === 201 && st1 === 200 && unido === true && f1.fase === 'oyente' && f1.codigo === s1.code && !!anotado.v,
    { crear: s1.status, publicar: st1, unido, fase: f1.fase, error: f1.error, oyentes: anotado.v, idOye });

  // ── 2. arranca en la posición proyectada ──
  const sonando = await esperar(async () => { const f = await foto(); return f.actual === A.id && !f.paused && f.ct > 0 ? f : null; });
  await sleep(600);
  const m2 = await medir();
  ok('02_arranca_en_la_posicion_proyectada', !!sonando.v && m2.actual === A.id && m2.isPlaying && !m2.paused
    && mismo(m2.cola, [A.id, B.id]) && Math.abs(m2.desfase) < TOLERANCIA_S && m2.repeat === 'off',
    { ms: sonando.ms, actual: m2.actual, cola: m2.cola, isPlaying: m2.isPlaying, repeat: m2.repeat, ct: m2.ct, esperado: m2.esperado, desfase: m2.desfase });
  // quiereSonar (caso 14): se lee en cada momento del anfitrión — sonando, en pausa, reanudado, video y vuelta.
  const quiere = (v) => esperar(async () => ((await foto()).quiereSonar === v ? true : null), 3000, 100).then((x) => x.v === true);
  const Q = { sonando: await quiere(true) };

  // ── L. lecturas en 10 s e identidad de las funciones del motor ──
  await p.evaluate(() => { const v = window.__player(); window.__fns = { play: v.play, seek: v.seek, pause: v.pause, resume: v.resume, setRepeatMode: v.setRepeatMode }; });
  const tL = Date.now(); await sleep(10_000);
  const enL = lecturas.filter((x) => x.t >= tL && x.t < tL + 10_000 && x.codigo === s1.code).map((x) => x.t);
  const huecosL = enL.slice(1).map((t, i) => t - enL[i]);
  const otrasL = lecturas.filter((x) => x.t >= tL && x.t < tL + 10_000 && x.codigo !== s1.code).length;
  // (la identidad se compara al final de la sala, después de pausas, saltos, cambios de pista y video)

  // ── 3. el anfitrión pausa y reanuda ──
  await publicar(s1.code, { trackId: A.id, positionMs: 60_000, playing: false, nextTrackId: B.id });
  const p3 = await esperar(async () => { const f = await foto(); return f.paused && f.isPlaying === false ? f : null; }, 5000);
  Q.enPausa = await quiere(false);
  await sleep(300);
  const m3a = await medir();
  await publicar(s1.code, { trackId: A.id, positionMs: 60_000, playing: true, nextTrackId: B.id });
  const r3 = await esperar(async () => { const f = await foto(); return !f.paused && f.isPlaying ? f : null; }, 5000);
  Q.reanudado = await quiere(true);
  await sleep(600);
  const m3b = await medir();
  ok('03_pausa_y_reanuda_en_vivo', !!p3.v && Math.abs(m3a.ct - 60) < 0.5 && m3a.actual === A.id
    && !!r3.v && m3b.actual === A.id && Math.abs(m3b.desfase) < TOLERANCIA_S && m3b.silenciada === false,
    { pausa: { ms: p3.ms, ct: m3a.ct }, reanuda: { ms: r3.ms, ct: m3b.ct, esperado: m3b.esperado, desfase: m3b.desfase } });

  // ── 4. salto del anfitrión ──
  await publicar(s1.code, { trackId: A.id, positionMs: 100_000, playing: true, nextTrackId: B.id });
  const s4 = await esperar(async () => { const m = await medir(); return Math.abs(m.desfase) < TOLERANCIA_S && m.ct > 90 ? m : null; }, 5000);
  await sleep(400);
  const m4 = await medir();
  ok('04_salto_del_anfitrion_hace_seek', !!s4.v && m4.actual === A.id && !m4.paused && Math.abs(m4.desfase) < TOLERANCIA_S,
    { ms: s4.ms, ct: m4.ct, esperado: m4.esperado, desfase: m4.desfase });

  // ── 8. corrección: +5 s se corrige; +1,2 s no ──
  // Se vuelve a una posición baja (el salto de 4 dejó la pista cerca de 100 s y faltan casos).
  await publicar(s1.code, { trackId: A.id, positionMs: 20_000, playing: true, nextTrackId: B.id });
  await esperar(async () => { const m = await medir(); return Math.abs(m.desfase) < 1 && m.ct < 40 ? m : null; }, 5000);
  await sleep(3000);
  const ct8 = (await foto()).ct;
  await p.evaluate((t) => window.__player().seek(t), ct8 + 5);
  await sleep(300);
  const m8a = await medir();
  const c8 = await esperar(async () => { const m = await medir(); return Math.abs(m.desfase) < 1 ? m : null; }, 14_000, 250);
  await sleep(3000);   // que la siguiente revisión vea el desfase dentro de la tolerancia
  const ct8b = (await foto()).ct;
  await p.evaluate((t) => window.__player().seek(t), ct8b + 1.2);
  await sleep(300);
  const m8c = await medir();
  await sleep(11_000);   // dos revisiones (REVISAR_CADA_MS = 5 s) con el desfase dentro de la tolerancia
  const m8d = await medir();
  ok('08_desfase_5s_se_corrige_y_1s_no', m8a.desfase > 4 && !!c8.v && Math.abs(m8c.desfase - 1.2) < 0.5 && Math.abs(m8d.desfase - m8c.desfase) < 0.4,
    { mas5: { desfaseInicial: m8a.desfase, corregidoEnMs: c8.ms, desfaseFinal: c8.v?.desfase ?? null },
      mas1_2: { desfaseInicial: m8c.desfase, desfase11sDespues: m8d.desfase } });

  // ── 6. pausa propia → silenciada; la radio no lo mueve; play → al vivo ──
  // El desfase de +1,2 s del 8 queda en el aire hasta acá: el play de este caso lo resuelve.
  await p.evaluate(() => window.__player().pause());
  const s6 = await esperar(async () => { const f = await foto(); return f.silenciada === true ? f : null; }, 9000);
  const ct6 = (await foto()).ct;
  await publicar(s1.code, { trackId: A.id, positionMs: 70_000, playing: true, nextTrackId: B.id });   // un salto
  await sleep(4500);   // dos sondeos
  const m6b = await foto();
  await p.evaluate(() => window.__player().togglePlay());   // el oyente le da play
  const v6 = await esperar(async () => { const f = await foto(); return !f.paused && f.isPlaying && f.ct > 60 ? f : null; }, 4000);
  await sleep(500);
  const m6c = await medir();
  ok('06_pausa_propia_silenciada_y_vuelve_al_vivo', !!s6.v && m6b.paused && m6b.silenciada === true && Math.abs(m6b.ct - ct6) < 0.05
    && !!v6.v && m6c.silenciada === false && Math.abs(m6c.desfase) < TOLERANCIA_S,
    { silenciadaEnMs: s6.ms, trasElSalto: { paused: m6b.paused, ct: m6b.ct, ctAntes: ct6, silenciada: m6b.silenciada },
      trasPlay: { ms: v6.ms, ct: m6c.ct, esperado: m6c.esperado, desfase: m6c.desfase, silenciada: m6c.silenciada } });

  // ── 7. desajuste: otra canción → a los DESAJUSTE_MS vuelve la de la radio ──
  await p.evaluate((d) => window.__player().play([d], 0), D);
  const t7 = Date.now();
  const enD = await esperar(async () => { const f = await foto(); return f.actual === D.id && !f.paused ? f : null; }, 3000);
  const v7 = await esperar(async () => { const f = await foto(); return f.actual === A.id && !f.paused ? f : null; }, 14_000, 200);
  const ms7 = v7.v ? Date.now() - t7 : null;
  await sleep(600);
  const m7 = await medir();
  ok('07_desajuste_vuelve_la_de_la_radio', !!enD.v && !!v7.v && ms7 >= DESAJUSTE_MS - 500 && ms7 <= DESAJUSTE_MS + 2 * SONDEO_MS + 2000
    && mismo(m7.cola, [A.id, B.id]) && Math.abs(m7.desfase) < TOLERANCIA_S,
    { sonoD: !!enD.v, volvioEnMs: ms7, cola: m7.cola, ct: m7.ct, esperado: m7.esperado, desfase: m7.desfase });

  // ── 7b. con otra canción puesta, la radio pausa y reanuda: no la mueve ──
  await p.evaluate((d) => window.__player().play([d], 0), D);
  await esperar(async () => { const f = await foto(); return f.actual === D.id && !f.paused && f.ct > 0.5 ? f : null; }, 4000);
  await publicar(s1.code, { trackId: A.id, positionMs: 50_000, playing: false, nextTrackId: B.id });
  const p7b = await esperar(async () => { const f = await foto(); return f.paused ? f : null; }, 3000, 100);
  await sleep(200);
  const m7bA = await foto();
  await publicar(s1.code, { trackId: A.id, positionMs: 50_000, playing: true, nextTrackId: B.id });
  const r7b = await esperar(async () => { const f = await foto(); return f.actual !== D.id || !f.paused || Math.abs(f.ct - m7bA.ct) > 0.05 ? f : null; }, 2600, 100);
  const m7bB = await foto();
  ok('07b_ordenes_no_mueven_otra_cancion', !!p7b.v && m7bA.actual === D.id && m7bA.ct < 15
    && !r7b.v && m7bB.actual === D.id && m7bB.paused && Math.abs(m7bB.ct - m7bA.ct) < 0.05,
    { trasPausa: { actual: m7bA.actual, paused: m7bA.paused, ct: m7bA.ct }, trasReanudar: { actual: m7bB.actual, paused: m7bB.paused, ct: m7bB.ct, seMovioEnMs: r7b.ms } });
  // El desajuste la devuelve (no cuenta: es lo del 7).
  await esperar(async () => { const f = await foto(); return f.actual === A.id && !f.paused ? f : null; }, 12_000, 200);

  // ── 5. cambio de pista → la nueva, con su siguiente ──
  await publicar(s1.code, { trackId: B.id, positionMs: 20_000, playing: true, nextTrackId: C.id });
  const c5 = await esperar(async () => { const f = await foto(); return f.actual === B.id && !f.paused && f.ct > 0 ? f : null; }, 5000);
  await sleep(600);
  const m5 = await medir();
  ok('05_cambio_de_pista_con_su_siguiente', !!c5.v && m5.actual === B.id && mismo(m5.cola, [B.id, C.id]) && m5.isPlaying && Math.abs(m5.desfase) < TOLERANCIA_S,
    { ms: c5.ms, cola: m5.cola, ct: m5.ct, esperado: m5.esperado, desfase: m5.desfase });

  // ── 11. video del anfitrión → pausa con aviso; vuelve una canción → arranca ──
  await publicar(s1.code, { enPausaPorVideo: true });
  const v11 = await esperar(async () => { const f = await foto(); return f.paused && f.aviso === 'video' ? f : null; }, 5000);
  Q.video = await quiere(false);
  await publicar(s1.code, { trackId: C.id, positionMs: 10_000, playing: true, nextTrackId: A.id });
  const c11 = await esperar(async () => { const f = await foto(); return f.actual === C.id && !f.paused && f.ct > 0 ? f : null; }, 6000);
  Q.vuelta = await quiere(true);
  await sleep(600);
  const m11 = await medir();
  ok('11_video_pausa_con_aviso_y_vuelve', !!v11.v && v11.v.actual === B.id && !!c11.v && mismo(m11.cola, [C.id, A.id]) && m11.aviso === null && Math.abs(m11.desfase) < TOLERANCIA_S,
    { video: v11.v && { ms: v11.ms, actual: v11.v.actual, paused: v11.v.paused, aviso: v11.v.aviso }, vuelta: { ms: c11.ms, cola: m11.cola, aviso: m11.aviso, desfase: m11.desfase } });

  // ── 14. quiereSonar sigue al anfitrión: true sonando, false en pausa, true al reanudar, false con video ──
  ok('14_quiereSonar_sigue_al_anfitrion', Object.values(Q).every(Boolean) && Object.keys(Q).length === 5, Q);

  // ── L (cierre): lecturas e identidad ──
  const fnsIguales = await p.evaluate(() => { const v = window.__player(); return Object.fromEntries(Object.entries(window.__fns).map(([k, f]) => [k, f === v[k]])); });
  ok('L_lecturas_cada_2s_y_motor_estable', enL.length >= 4 && enL.length <= 6 && huecosL.every((h) => h >= SONDEO_MS - 300) && otrasL === 0
    && Object.values(fnsIguales).every(Boolean),
    { lecturasEn10s: enL.length, huecosMs: huecosL, deOtraSala: otrasL, mismaIdentidad: fnsIguales });

  // ── M (1.45.0): TODAS las lecturas del oyente declaran ?cap=mod — la de unirse (la primera de la sala)
  // y las de cada vuelta. El servidor anota el soporte en cada lectura: una sola sin cap lo apaga.
  { const deS1 = lecturas.filter((x) => x.codigo === s1.code);
    const sinCap = deS1.filter((x) => x.cap !== 'mod').map((x) => x.query);
    ok('M_todas_las_lecturas_del_oyente_llevan_cap_mod', deS1.length >= 3 && deS1[0].cap === 'mod' && sinCap.length === 0,
      { lecturas: deS1.length, laDeUnirse: deS1[0]?.query ?? null, sinCap: sinCap.slice(0, 5) }); }

  // ── 10. el anfitrión termina → fin + restauración ──
  await p.evaluate(() => { window.__nPlay = 0; });
  await api(tokHost, 'DELETE', `/api/radio/${s1.code}`);
  const f10 = await esperar(async () => { const f = await foto(); return f.fase === 'sin-radio' ? f : null; }, 5000);
  await sleep(1500);
  const m10 = await foto();
  ok('10_anfitrion_termina_fin_y_restauracion', !!f10.v && m10.fin === TXT_FIN && restaurada(m10, antes),
    { ms: f10.ms, fin: m10.fin, cola: m10.cola, indice: m10.indice, ct: m10.ct, paused: m10.paused, nPlay: m10.nPlay, repeat: m10.repeat });

  // ════ Sala 2: caso 9 e higiene ════
  await p.evaluate(() => window.__radio().limpiarFin());
  const antes9 = await prepararFoto('all');
  const s2 = await abrirSala();
  await publicar(s2.code, { trackId: A.id, positionMs: 40_000, playing: true, nextTrackId: B.id });
  await p.evaluate((c) => window.__radio().unirse(c), s2.code);
  await esperar(async () => { const f = await foto(); return f.actual === A.id && !f.paused ? f : null; });
  // Entre dos lecturas hay un setTimeout de 2000 ms pendiente (durante la lectura misma, no).
  const sondeoDentro = (await esperar(async () => { const n = await sondeoPendiente(); return n > sondeoAntes ? n : null; }, 3000, 50)).v ?? sondeoAntes;

  // ── 9. salir restaura la foto sin llamar a play() ──
  await p.evaluate(() => { window.__nPlay = 0; window.__radio().salir(); });
  const tSalir = Date.now();
  await sleep(1500);
  const f9 = await foto();
  ok('09_salir_restaura_la_foto_sin_play', f9.fase === 'sin-radio' && f9.fin === null && restaurada(f9, antes9),
    { antes: { cola: antes9.cola, indice: antes9.indice, ct: antes9.ct, repeat: antes9.repeat }, despues: f9 });

  // ── H. higiene ──
  await sleep(5000);
  const lecturasTras = lecturas.filter((x) => x.t > tSalir + 100).length;
  const sondeoTras = await sondeoPendiente();
  const medios = await p.evaluate(() => window.__medios.size);
  ok('H_tras_salir_sin_lecturas_ni_sondeo_un_medio_sin_errores', lecturasTras === 0 && sondeoDentro > sondeoAntes && sondeoTras === sondeoAntes && medios === 1 && errores.length === 0,
    { lecturasEn6sTrasSalir: lecturasTras, sondeoPendiente: { antesDeEntrar: sondeoAntes, dentro: sondeoDentro, trasSalir: sondeoTras }, medios, errores: errores.slice() });
  REG.oyentes_6s_despues_de_salir = ((await salaComoHost(tokHost, s2.code)).j?.listeners ?? []).map((x) => x.id);
  await api(tokHost, 'DELETE', `/api/radio/${s2.code}`);

  // ── 12. la sala propia ──
  const cr12 = await api(tokOye, 'POST', '/api/radio');
  const code12 = cr12.j?.code; salas.push([tokOye, code12]);
  const unido12 = await p.evaluate((c) => window.__radio().unirse(c), code12);
  await sleep(500);
  const f12 = await foto();
  const s12 = await salaComoHost(tokOye, code12);
  ok('12_sala_propia_rechazada', cr12.status === 201 && unido12 === false && f12.fase === 'sin-radio' && f12.error === 'Esta radio es tuya.'
    && (s12.j?.listeners ?? []).length === 0 && f12.actual === PROPIAS[1].id && f12.paused === true,
    { crear: cr12.status, unido: unido12, fase: f12.fase, error: f12.error, oyentes: s12.j?.listeners ?? null, actual: f12.actual });
  await api(tokOye, 'DELETE', `/api/radio/${code12}`);
  await p.evaluate(() => window.__radio().limpiarFin());

  // ════ Registro: un oyente que venía de un VIDEO ════
  const vids = await p.evaluate(async () => { const r = await fetch('/api/videos', { headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } }); return ((await r.json()).videos ?? []).slice(0, 1).map((v) => ({ ...v, kind: 'video' })); });
  if (vids.length) {
    const fotoVideo = () => p.evaluate(() => { const v = window.__player(); const vd = document.querySelector('video.player-video'); const el = window.__audio;
      return { fase: window.__radio().fase, actual: v.currentTrack?.id ?? null, kind: v.currentTrack?.kind ?? 'track', cola: v.queue.map((t) => `${t.kind ?? 'track'}:${t.id}`), indice: v.queueIndex,
        isPlaying: v.isPlaying, repeat: v.repeat, audioPaused: el?.paused ?? null, videoPaused: vd?.paused ?? null, videoCt: vd ? Math.round(vd.currentTime * 100) / 100 : null, nPlay: window.__nPlay }; });
    await p.evaluate((l) => window.__player().play(l, 0), vids);
    await sleep(2000);
    const vAntes = await fotoVideo();
    const s3 = await abrirSala();
    await publicar(s3.code, { trackId: A.id, positionMs: 40_000, playing: true, nextTrackId: B.id });
    await p.evaluate((c) => window.__radio().unirse(c), s3.code);
    await esperar(async () => { const f = await foto(); return f.actual === A.id && !f.paused ? f : null; });
    await sleep(1000);
    const vDentro = await fotoVideo();
    await p.evaluate(() => { window.__nPlay = 0; window.__radio().salir(); });
    await sleep(2000);
    REG.video_al_salir = { antes: vAntes, dentro: vDentro, despues: await fotoVideo() };
    await api(tokHost, 'DELETE', `/api/radio/${s3.code}`);
  } else REG.video_al_salir = 'no hay videos en el catálogo (¿VIDEO_DIR?)';

  // ════ Segunda tanda: servidor falso ════

  // ── U. al unirse: el fallo deja la ficha como estaba ──
  const TXT_U = {
    '404': 'No hay ninguna radio con ese código. Revísalo e intenta de nuevo.',
    '409_llena': 'Esa radio está llena. Intenta más tarde.',
    '410': 'Esa radio ya terminó.',
    ended: TXT_FIN,
    propia: 'Esta radio es tuya.',
  };
  const antesU = await prepararFoto('all');
  for (const [k, extra] of [
    ['404', { modo: { status: 404, body: { error: 'Radio not found' } } }],
    ['409_llena', { modo: { status: 409, body: { error: 'Radio full' } } }],
    ['410', { modo: { status: 410, body: { error: 'Radio ended', endedReason: 'admin' } } }],
    ['ended', { modo: 'ended', razon: 'anfitrion' }],
    ['propia', { host: { id: idOye, name: 'Yo', avatar: null } }],
  ]) {
    const code = salaFalsa(extra);
    estadoFk(code, { trackId: A.id, positionMs: 40_000, playing: true, nextTrackId: B.id });
    await p.evaluate(() => { window.__nPlay = 0; });
    await escuchar(code);
    const listo = await esperar(async () => { const f = await foto(); const v = await vista(); return f.fase === 'sin-radio' && v.estado ? true : null; }, 5000);
    await sleep(300);
    const f = await foto(); const v = await vista();
    ok(`U_${k}_al_unirse`, !!listo.v && f.fase === 'sin-radio' && v.estado === TXT_U[k] && v.foco === 'button.radio-btn.radio-btn--escuchar'
      && mismo(f.cola, antesU.cola) && f.indice === antesU.indice && f.paused && Math.abs(f.ct - 30) < 1 && f.nPlay === 0 && f.repeat === 'all'
      && FK[code].lecturas.length === 1,
      { estado: v.estado, foco: v.foco, fase: f.fase, colaIntacta: mismo(f.cola, antesU.cola), indice: f.indice, ct: f.ct, paused: f.paused, nPlay: f.nPlay, repeat: f.repeat, lecturas: FK[code].lecturas.length });
  }

  // ── V. la ficha no lee la sala antes del clic; "Uniéndose…" + Cancelar ──
  {
    const code = salaFalsa();
    estadoFk(code, { trackId: A.id, positionMs: 40_000, playing: true, nextTrackId: B.id });
    await p.evaluate(() => { window.__nPlay = 0; });
    await irA(`/radio/${code}`);
    await p.waitForSelector('.radio-btn--escuchar:not([disabled])', { timeout: 5000 });
    await sleep(3000);
    const ficha = await p.evaluate(() => ({
      escuchar: document.querySelector('.radio-btn--escuchar')?.textContent ?? null,
      nota: document.getElementById('radio-escuchar-nota')?.textContent ?? null,
      cancelar: [...document.querySelectorAll('.radio-btn')].some((b) => b.textContent.trim() === 'Cancelar'),
      enPagina: document.body.textContent.includes(location.pathname.split('/').pop()),
    }));
    const fF = await foto();
    ok('V_ficha_sin_leer_la_sala_antes_del_clic', FK[code].lecturas.length === 0 && fF.fase === 'sin-radio' && fF.nPlay === 0
      && ficha.escuchar === 'Escuchar' && !ficha.cancelar && ficha.enPagina
      && ficha.nota === 'Vas a escuchar lo mismo que el anfitrión, en vivo. Al salir, vuelve tu cola, en pausa.',
      { lecturasEn3s: FK[code].lecturas.length, fase: fF.fase, nPlay: fF.nPlay, ficha });

    // La primera lectura tarda 3 s: "Uniéndose…" ocupado + Cancelar; Cancelar vuelve a la ficha y la
    // respuesta que llega después no lo mete en la radio.
    FK[code].demora = 3000;
    await p.click('.radio-btn--escuchar');
    await sleep(600);
    const uni = await p.evaluate(() => {
      const b = document.querySelector('.radio-btn--escuchar');
      return { texto: b?.textContent ?? null, disabled: b?.disabled ?? null, busy: b?.getAttribute('aria-busy') ?? null,
        cancelar: [...document.querySelectorAll('.radio-btn')].some((x) => x.textContent.trim() === 'Cancelar') };
    });
    const fU = await foto();
    await p.locator('.radio-btn', { hasText: 'Cancelar' }).click();
    await sleep(500);
    const fC = await foto(); const vC = await vista();
    const cancel = { fase: fC.fase, foco: vC.foco, cancelar: await p.evaluate(() => [...document.querySelectorAll('.radio-btn')].some((x) => x.textContent.trim() === 'Cancelar')) };
    await sleep(4000);   // llega la respuesta demorada (200 live)
    const fT = await foto(); const vT = await vista();
    ok('V_uniendose_y_cancelar', uni.texto === 'Uniéndose…' && uni.disabled === true && uni.busy === 'true' && uni.cancelar && fU.fase === 'uniendose'
      && cancel.fase === 'sin-radio' && cancel.foco === 'button.radio-btn.radio-btn--escuchar' && !cancel.cancelar
      && fT.fase === 'sin-radio' && !vT.oyente && FK[code].lecturas.length === 1
      && mismo(fT.cola, antesU.cola) && fT.indice === antesU.indice && fT.paused && Math.abs(fT.ct - 30) < 1 && fT.nPlay === 0 && fT.repeat === 'all',
      { uniendose: { ...uni, fase: fU.fase }, alCancelar: cancel, trasLaRespuesta: { fase: fT.fase, oyente: vT.oyente, lecturas: FK[code].lecturas.length, colaIntacta: mismo(fT.cola, antesU.cola), ct: fT.ct, paused: fT.paused, nPlay: fT.nPlay } });
  }

  // ── V. silenciada, "Iniciar radio" bloqueado siendo oyente y "Salir de la radio" → foco en el h1 ──
  {
    const e = await entrarFk();
    await p.evaluate(() => window.__player().pause());
    const s = await esperar(async () => ((await foto()).silenciada === true ? true : null), 9000);
    const vS = await vista();
    ok('V_silenciada_en_la_region_viva', e.sono && !!s.v && vS.avisoVivo === TXT_SILENCIADA && vS.region?.mismo === true,
      { ms: s.ms, avisoVivo: vS.avisoVivo, region: vS.region });
    const iniciarRadio = () => p.evaluate(() => {
      const b = [...document.querySelectorAll('.radio-card .radio-btn')].find((x) => x.textContent.trim() === 'Iniciar radio');
      const nota = b && b.getAttribute('aria-describedby') ? document.getElementById(b.getAttribute('aria-describedby')) : null;
      const campo = document.getElementById('radio-codigo-campo');
      return { hay: !!b, disabled: b ? b.disabled : null, nota: nota?.textContent ?? null, campoDisabled: campo ? campo.disabled : null,
        notaUnirse: document.getElementById('radio-unirse-nota')?.textContent ?? null, oyente: !!document.querySelector('.radio-card--oyente') };
    });
    await irA('/radio');
    await sleep(500);
    const ini = await iniciarRadio();
    // 1.46.0 (R3): mientras escuchas ya NO se muestra la tarjeta «Tu radio» apagada (problema 7 del ANTES): no hay
    // «Iniciar radio» en la cara. «Unirse con código» sigue, bloqueado con su nota.
    ok('V_iniciar_bloqueado_con_su_nota_siendo_oyente', !ini.hay && ini.disabled === null && ini.nota === null
      && ini.oyente && ini.campoDisabled === true && ini.notaUnirse === 'Sal de la radio para unirte a otra.', ini);
    await p.click('.radio-card--oyente .radio-terminar .radio-btn');
    await esperar(async () => ((await foto()).fase === 'sin-radio' ? true : null), 3000);
    await sleep(1200);
    const fSal = await foto(); const vSal = await vista(); const iniSal = await iniciarRadio();
    ok('V_salir_deja_sin_radio_con_el_foco_en_el_h1', fSal.fase === 'sin-radio' && vSal.foco === 'h1.section-title' && !vSal.oyente
      && iniSal.hay && iniSal.disabled === false && iniSal.nota === null && iniSal.campoDisabled === false && restaurada(fSal, e.antes),
      { fase: fSal.fase, foco: vSal.foco, cara: { oyente: vSal.oyente, iniciar: iniSal }, restaurada: restaurada(fSal, e.antes) });
  }

  // ── B. autoplay bloqueado: "Toca para escuchar" ──
  {
    await prepararFoto('all');
    const code = salaFalsa();
    estadoFk(code, { trackId: A.id, positionMs: 40_000, playing: true, nextTrackId: B.id });
    await p.evaluate(() => { window.__bloquear = true; });
    await escuchar(code);
    const ap = await esperar(async () => { const v = await vista(); return v.toca ? v : null; }, 8000);
    const f1 = await foto();
    ok('B_toca_para_escuchar_en_la_vista_y_no_en_la_barra', !!ap.v && f1.fase === 'oyente' && f1.actual === A.id && f1.bloqueado === true && f1.quiereSonar === true
      && f1.paused && !ap.v.tocaEnBarra && ap.v.avisoVivo === TXT_BLOQUEADO,
      { msHastaElBoton: ap.ms, fase: f1.fase, bloqueado: f1.bloqueado, quiereSonar: f1.quiereSonar, paused: f1.paused, enLaBarra: ap.v?.tocaEnBarra ?? null, avisoVivo: ap.v?.avisoVivo ?? null });
    // Que el vivo se aleje de donde quedó el elemento; el 'playing' del clic dice dónde arrancó de verdad.
    await sleep(5000);
    const ctAntes = (await foto()).ct; const atrasS = r2(vivoFk(code) - ctAntes);
    await p.evaluate(() => { window.__alSonar = null; window.__audio.addEventListener('playing', (ev) => { window.__alSonar = { t: Date.now(), ct: ev.target.currentTime }; }, { once: true }); });
    await p.click('.radio-btn--toca');
    const son = await esperar(() => p.evaluate(() => window.__alSonar), 4000, 50);
    await sleep(800);
    const v2 = await vista(); const f2 = await foto();
    const desfase = son.v ? r2(son.v.ct - vivoFk(code, son.v.t)) : null;
    ok('B_el_clic_suena_en_vivo_y_el_boton_se_va', !!son.v && atrasS > 4 && Math.abs(desfase) < TOLERANCIA_S && !v2.toca && !f2.paused && f2.bloqueado === false,
      { atrasAntesDelClicS: atrasS, desfaseAlSonar: desfase, botonDespues: v2.toca, paused: f2.paused, bloqueado: f2.bloqueado });
    // El anfitrión pausa y reanuda (el resume rechaza: no hay clic → vuelve el botón) y pausa otra vez.
    const pos = Math.round(vivoFk(code) * 1000);
    estadoFk(code, { trackId: A.id, positionMs: pos, playing: false, nextTrackId: B.id });
    await esperar(async () => { const f = await foto(); return f.paused && f.quiereSonar === false ? true : null; }, 5000);
    estadoFk(code, { trackId: A.id, positionMs: pos, playing: true, nextTrackId: B.id });
    const vuelve = await esperar(async () => { const v = await vista(); return v.toca ? true : null; }, 5000);
    estadoFk(code, { trackId: A.id, positionMs: pos, playing: false, nextTrackId: B.id });
    const pausa = await esperar(async () => { const f = await foto(); return f.quiereSonar === false ? f : null; }, 5000);
    await sleep(600);
    const v3 = await vista(); const f3 = await foto();
    ok('B_con_el_anfitrion_en_pausa_no_aparece', !!vuelve.v && !!pausa.v && f3.bloqueado === true && f3.quiereSonar === false && !v3.toca,
      { volvioElBotonAlReanudar: !!vuelve.v, bloqueado: f3.bloqueado, quiereSonar: f3.quiereSonar, boton: v3.toca });
    await p.evaluate(() => { window.__bloquear = false; });
    await salirFk();
  }

  // ── E. (1.45.0, W5a) eventos y aviso de rol para el oyente: el cursor, sin eventos viejos, lo ajeno con
  //    toast, lo propio sin toast, nombrado y quitado, eventsLost y que la región no repita anuncios ──
  {
    const T = { ajeno: 'Anfitriona nombró a Beto para moderar', propio: 'Tú pausaste', nombrado: 'Puedes moderar esta radio',
      quitado: 'Ya no puedes moderar esta radio', tras: 'Anfitriona pausó', teNombro: 'Anfitriona te nombró para moderar' };
    const evFk = (id, type, by, extra = {}) => ({ id, type, by, byName: by === HOST_FK.id ? 'Anfitriona' : 'Yo', target: null, targetName: null, trackId: null, title: null, at: Date.now(), ...extra });
    const observar = () => p.evaluate(() => {
      window.__toasts = []; window.__regEv = [];
      if (window.__obsEv) window.__obsEv.disconnect();
      window.__obsEv = new MutationObserver(() => {
        for (const n of document.querySelectorAll('.toast-text')) if (!n.dataset.visto) { n.dataset.visto = '1'; window.__toasts.push(n.textContent); }
        const r = document.querySelector('.radio-evento'); const t = r ? r.textContent : null;
        if (r && window.__regEv[window.__regEv.length - 1] !== t) window.__regEv.push(t);
      });
      window.__obsEv.observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    const region = () => p.evaluate(() => { const r = document.querySelector('.radio-evento'); return r ? { texto: r.textContent, rol: r.getAttribute('role') } : null; });
    const toasts = () => p.evaluate(() => window.__toasts.slice());
    const llega = (texto) => esperar(async () => ((await region())?.texto === texto ? true : null), 6000, 50);

    await observar();
    const e = await entrarFk({ mod: { moderators: [], events: [evFk(1, 'pausa', HOST_FK.id), evFk(2, 'reanudar', HOST_FK.id), evFk(3, 'siguiente', HOST_FK.id)], until: 3, lost: false }, queries: [] });
    const s = FK[e.code];
    await esperar(async () => (s.queries.length >= 3 ? true : null), 8000, 100);
    const r0 = await region(); const t0 = await toasts();
    ok('E_unirse_fija_el_cursor_y_las_siguientes_leen_con_desde', e.sono && s.queries[0] === '?cap=mod' && s.queries.length >= 3 && s.queries.slice(1).every((q) => q === '?cap=mod&desde=3'),
      { queries: s.queries.slice(0, 5) });
    ok('E_sin_eventos_viejos_al_entrar', r0?.rol === 'status' && r0.texto === '' && t0.length === 0, { region: r0, toasts: t0 });

    s.mod.events.push(evFk(4, 'moderador', HOST_FK.id, { target: 990002, targetName: 'Beto' })); s.mod.until = 4;
    const aj = await llega(T.ajeno); await sleep(300);
    const tA = await toasts();
    ok('E_evento_ajeno_en_la_region_y_en_el_toast', !!aj.v && tA.includes(T.ajeno), { region: await region(), toasts: tA });

    s.mod.events.push(evFk(5, 'pausa', idOye)); s.mod.until = 5;
    const pr = await llega(T.propio); await sleep(800);
    const tP = await toasts();
    ok('E_evento_propio_solo_en_la_region', !!pr.v && !tP.includes(T.propio), { region: await region(), toasts: tP });

    s.mod.moderators = [YO_FK]; s.mod.events.push(evFk(6, 'moderador', HOST_FK.id, { target: idOye, targetName: 'Yo' })); s.mod.until = 6;
    const nm = await llega(T.nombrado); await sleep(300);
    const tN = await toasts(); const regN = await p.evaluate(() => window.__regEv.slice());
    ok('E_aviso_al_ser_nombrado', !!nm.v && tN.includes(T.nombrado) && !regN.some((x) => x?.includes(T.teNombro)), { region: await region(), toasts: tN });

    s.mod.moderators = []; s.mod.events.push(evFk(7, 'sin-moderador', HOST_FK.id, { target: idOye, targetName: 'Yo' })); s.mod.until = 7;
    const qt = await llega(T.quitado); await sleep(300);
    const tQ = await toasts();
    ok('E_aviso_al_quitar_el_rol', !!qt.v && tQ.includes(T.quitado), { region: await region(), toasts: tQ });

    // eventsLost: el cursor salta a 21 sin anunciar los 20 y 21; después, el 22 se anuncia normal
    const regAntes = (await p.evaluate(() => window.__regEv.slice())).length; const toastsAntes = (await toasts()).length;
    const nq = s.queries.length;
    s.mod.events = [evFk(20, 'reanudar', HOST_FK.id), evFk(21, 'siguiente', HOST_FK.id)]; s.mod.until = 21; s.mod.lost = true;
    const salto = await esperar(async () => (s.queries.slice(nq).includes('?cap=mod&desde=21') ? true : null), 8000, 50);
    const regLost = (await p.evaluate(() => window.__regEv.slice())).length; const toastsLost = (await toasts()).length;
    s.mod.lost = false; s.mod.events.push(evFk(22, 'pausa', HOST_FK.id)); s.mod.until = 22;
    const sigue = await llega(T.tras);
    ok('E_events_lost_adelanta_el_cursor_sin_anunciar', !!salto.v && regLost === regAntes && toastsLost === toastsAntes && !!sigue.v,
      { saltoA21: !!salto.v, anunciosDuranteLost: regLost - regAntes, toastsDuranteLost: toastsLost - toastsAntes, siguio: !!sigue.v, queries: s.queries.slice(nq, nq + 4) });

    await sleep(2500);   // un par de vueltas más sin nada nuevo: la región no vuelve a anunciar
    const secuencia = (await p.evaluate(() => window.__regEv.slice())).filter((x) => x);
    ok('E_la_region_no_repite_anuncios', JSON.stringify(secuencia) === JSON.stringify([T.ajeno, T.propio, T.nombrado, T.quitado, T.tras]), { secuencia });
    await salirFk();

    await observar();
    const e2 = await entrarFk({ mod: { moderators: [YO_FK], events: [], until: 9, lost: false }, queries: [] });
    await esperar(async () => (FK[e2.code].queries.length >= 3 ? true : null), 8000, 100);
    await sleep(500);
    const r2 = await region(); const t2 = await toasts();
    ok('E_primera_lectura_no_avisa_si_ya_moderaba', e2.sono && r2?.texto === '' && !t2.includes('Puedes moderar esta radio'), { region: r2, toasts: t2, lecturas: FK[e2.code].queries.length });
    await salirFk();

    // Dos eventos seguidos con el MISMO texto ("Anfitriona pausó" dos veces) → la región monta DOS nodos (cada
    // anuncio es un hijo con key): si el texto solo se reescribiera igual, un lector de pantalla no anunciaría el 2º.
    const e3 = await entrarFk({ mod: { moderators: [], events: [], until: 0, lost: false }, queries: [] });
    const s3 = FK[e3.code];
    await esperar(async () => (s3.queries.length >= 2 ? true : null), 8000, 100);
    await p.evaluate(() => { window.__nodosEv = []; if (window.__obsNodos) window.__obsNodos.disconnect();
      const r = document.querySelector('.radio-evento');
      window.__obsNodos = new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) window.__nodosEv.push(n.textContent); });
      window.__obsNodos.observe(r, { childList: true }); });
    const nodosEv = () => p.evaluate(() => window.__nodosEv.slice());
    s3.mod.events.push(evFk(1, 'pausa', HOST_FK.id)); s3.mod.until = 1;
    const uno = await esperar(async () => ((await nodosEv()).length >= 1 ? true : null), 6000, 50);
    s3.mod.events.push(evFk(2, 'pausa', HOST_FK.id)); s3.mod.until = 2;
    const dosN = await esperar(async () => ((await nodosEv()).length >= 2 ? true : null), 6000, 50);
    await sleep(300);
    const nodos3 = await nodosEv();
    const vivo3 = await p.evaluate(() => document.querySelector('.radio-evento')?.getAttribute('aria-live') ?? null);
    ok('E_texto_repetido_monta_dos_nodos', e3.sono && !!uno.v && !!dosN.v && nodos3.length === 2 && nodos3.every((x) => x === T.tras) && vivo3 === 'polite',
      { nodos: nodos3, ariaLive: vivo3, region: await region() });
    await salirFk();
  }

  // ── A. avatares: foto con y sin ?v= (con el token), foto que falla → la inicial, emoji ──
  {
    const host = { id: 990077, name: 'Fotito', avatar: { kind: 'photo', url: '/api/users/990077/avatar?v=123', updatedAt: '2026-11-01' } };
    const listeners = [host, YO_FK,
      { id: AVATAR_ROTO, name: 'Bea', avatar: { kind: 'photo', url: `/api/users/${AVATAR_ROTO}/avatar?v=5` } },
      { id: 990079, name: 'Ciro', avatar: { kind: 'emoji', value: '🎧' } },
      { id: 990080, name: 'Dani', avatar: { kind: 'photo', url: '/api/users/990080/avatar' } }];
    const e = await entrarFk({ host, listeners });
    // 1.46.0 (R3): [anfitrión grande (cabecera), y la lista: anfitrión, Bea, Ciro, Dani y tú al final]; se espera a que
    // carguen las dos fotos y caiga la rota.
    const caras = await esperar(() => p.evaluate(() => {
      const c = [...document.querySelectorAll('.radio-card--oyente .radio-avatar')].map((el) => {
        const img = el.querySelector('img');
        return { src: img ? img.getAttribute('src') : null, cargada: img ? img.complete && img.naturalWidth > 0 : null,
          emoji: el.querySelector('.radio-avatar-emoji')?.textContent ?? null, texto: el.textContent, grande: el.classList.contains('radio-avatar--grande') };
      });
      return c.length === 6 && c[0].cargada && c[1].cargada && c[4].cargada && c[2].src === null ? c : null;
    }), 6000);
    const c = caras.v ?? [];
    const conTok = (u) => `${u}${u.includes('?') ? '&' : '?'}token=${tokOye}`;
    const pidio = (u) => pedidosAvatar.includes(conTok(u));
    ok('A_avatares_foto_con_token_inicial_si_falla_y_emoji', e.sono && c.length === 6
      && c[0].grande && c[0].src === conTok(host.avatar.url) && c[0].cargada
      && !c[1].grande && c[1].src === conTok(host.avatar.url) && c[1].cargada
      && c[2].src === null && c[2].texto === 'B'
      && c[3].emoji === '🎧'
      && c[4].src === conTok('/api/users/990080/avatar') && c[4].cargada
      && c[5].src === null && c[5].texto === 'Y'
      && pidio(host.avatar.url) && pidio(`/api/users/${AVATAR_ROTO}/avatar?v=5`) && pidio('/api/users/990080/avatar'),
      { caras: c.map((x) => ({ ...x, src: sinToken(x.src) })), pedidos: pedidosAvatar.map(sinToken) });
    await salirFk();
  }
  REG.errores_tras_la_segunda_tanda = errores.slice();

  // ── 13. logout con la radio de oyente abierta (va al final: deja la página sin sesión) ──
  // El reproductor vive por encima de la sesión: sin la pausa del desmontaje seguiría sonando lo de la
  // radio. Se exige en pausa, el repeat de la foto ('one') devuelto, y la radio sin lecturas ni sondeo.
  await prepararFoto('one');
  const s4s = await abrirSala();
  await publicar(s4s.code, { trackId: A.id, positionMs: 40_000, playing: true, nextTrackId: B.id });
  await p.evaluate((c) => window.__radio().unirse(c), s4s.code);
  await esperar(async () => { const f = await foto(); return f.actual === A.id && !f.paused ? f : null; });
  await sleep(1000);
  const lAntes = await p.evaluate(() => { const v = window.__player(); return { actual: v.currentTrack?.id, repeat: v.repeat, paused: window.__audio.paused, ct: Math.round(window.__audio.currentTime * 100) / 100 }; });
  await p.evaluate(() => window.__auth().logout());
  const tLogout = Date.now();
  await sleep(3000);
  const lDespues = await p.evaluate(() => { const v = window.__player(); return { actual: v.currentTrack?.id, repeat: v.repeat, paused: window.__audio.paused, ct: Math.round(window.__audio.currentTime * 100) / 100, isPlaying: v.isPlaying, radioMontada: !!window.__radio?.(), login: !!document.querySelector('input[type="password"]') }; });
  await sleep(3000);
  const ct6s = await p.evaluate(() => Math.round(window.__audio.currentTime * 100) / 100);
  const lecturasTrasLogout = lecturas.filter((x) => x.t > tLogout + 100).length;
  const sondeoTrasLogout = await sondeoPendiente();
  ok('13_logout_pausa_y_devuelve_repeat', lAntes.actual === A.id && lAntes.paused === false && lAntes.repeat === 'off'
    && lDespues.login && !lDespues.radioMontada && lDespues.paused === true && lDespues.isPlaying === false && ct6s === lDespues.ct
    && lDespues.repeat === 'one' && lecturasTrasLogout === 0 && sondeoTrasLogout === sondeoAntes,
    { antes: lAntes, a3s: lDespues, ct6s, lecturasTrasLogout, sondeoPendiente: sondeoTrasLogout });
  await api(tokHost, 'DELETE', `/api/radio/${s4s.code}`);

  // ── 401 al unirse y durante (lo de HOY: onUnauthorized → logout; ver el encabezado) ──
  const estadoSinSesion = () => p.evaluate(() => {
    const v = window.__player(); const el = window.__audio;
    return { radio: !!window.__radio?.(), actual: v.currentTrack?.id ?? null, cola: v.queue.map((t) => t.id), indice: v.queueIndex,
      isPlaying: v.isPlaying, paused: el ? el.paused : null, ct: el ? Math.round(el.currentTime * 100) / 100 : null, repeat: v.repeat, nPlay: window.__nPlay };
  });
  await volverAEntrar();
  {
    const antes = await prepararFoto('all');
    const code = salaFalsa({ modo: { status: 401, body: { error: 'Unauthorized' } } });
    await p.evaluate(() => { window.__nPlay = 0; });
    await escuchar(code);
    const fuera = await esperar(sinSesion, 6000);
    await sleep(1500);
    const f = await estadoSinSesion();
    ok('U_401_al_unirse_cierra_la_sesion', !!fuera.v && !f.radio && mismo(f.cola, antes.cola) && f.indice === antes.indice && f.paused
      && Math.abs(f.ct - 30) < 1 && f.nPlay === 0 && FK[code].lecturas.length === 1,
      { login: !!fuera.v, ...f, lecturas: FK[code].lecturas.length });
  }
  await volverAEntrar();
  {
    const e = await entrarFk({}, 'one');
    FK[e.code].modo = { status: 401, body: { error: 'Unauthorized' } };
    const fuera = await esperar(sinSesion, 6000);
    const t = Date.now();
    await sleep(3000);
    const f = await estadoSinSesion();
    const tras = FK[e.code].lecturas.filter((x) => x > t + 100).length;
    ok('D_401_durante_cierra_la_sesion_y_restaura', e.sono && !!fuera.v && !f.radio && restaurada(f, e.antes) && tras === 0,
      { login: !!fuera.v, ...f, lecturasTrasElLogin: tras });
  }
  REG.errores_de_pagina_al_final = errores.slice();
} catch (e) {
  ok('excepcion', false, { error: String(e.message).split('\n')[0].slice(0, 200) });
} finally {
  for (const [tok, c] of salas) if (c) await api(tok, 'DELETE', `/api/radio/${c}`).catch(() => {});
}

await ctx.close();
const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
console.log('registro (fuera del conteo):', JSON.stringify(REG, null, 1));
if (process.env.OYENTE_DUMP) (await import('node:fs')).writeFileSync(process.env.OYENTE_DUMP, JSON.stringify({ ...R, _registro: REG }, null, 1));
console.log(`\nradio-oyente-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
