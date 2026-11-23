// radio-ordenes-func.mjs — los BOTONES de quien modera y los estados de sus órdenes (1.45.0, W5b-1), contra el BUILD
// DE PRODUCCIÓN (preview :4173) y el backend REAL del runner (:3100, copia de la base). Salió de radio-oyente-func (sus
// bloques F y G, tal cual) para que ninguna suite se acerque al tope de 5 min del runner. El montaje (sesión, página,
// servidor falso FK…) es el de radio-oyente-comun.mjs, compartido con radio-oyente-func y radio-menu-func.
//
// Casos:
//   F_*  (1.45.0, W5b-1) los botones de quien modera, en vivo: solo con el rol y orders: true (insignia,
//        "Siguiente canción de la radio", "Pausar la radio", 44 px); "siguiente" lleva la base (seqBase) y
//        "Enviando…" con aria-busy; resuelta por el cambio de canción + mi evento; "Ya había cambiado"; pausa
//        resuelta por el estado (el foco sigue en el botón); los errores inmediatos en la línea; perder el rol
//        con una orden en vuelo la cancela sin error y sin temporizadores; orders: false → la nota; salir limpia.
//   G_*  (W5b-1) con el RELOJ de Playwright, en un contexto aparte (el de arriba envuelve setTimeout para
//        contar): 429 con Retry-After y su cuenta regresiva; "Esperando al anfitrión…" a los 5 s y "No se
//        aplicó" a los 30 s (a los 29 s todavía no).
//
// CONTROL NEGATIVO: "No se aplicó" a los 5 s en vez de 30 s → caen G_esperando y los de F que esperan una resolución;
// botones aunque capabilities.orders no sea true → F_radio_sin_ordenes y F_salir; "siguiente" sin base →
// F_siguiente_lleva_la_base y F_siguiente_sin_evento_mio_ya_habia_cambiado.
// Uso: SNAP_BASE=http://localhost:4173 SNAP2_USER=… SNAP2_PASS=… node radio-ordenes-func.mjs
// ORDENES_DUMP=<archivo>: deja ahí los resultados con sus valores.
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

  // ── F. (1.45.0, W5b-1) los botones de quien modera y los estados de sus órdenes (en vivo; lo del reloj, en G) ──
  {
    const evF = (id, type, by, extra = {}) => ({ id, type, by, byName: by === HOST_FK.id ? 'Anfitriona' : 'Yo', target: null, targetName: null, trackId: null, title: null, at: Date.now(), ...extra });
    const tarjeta = () => p.evaluate(() => {
      const c = document.querySelector('.radio-card--oyente'); if (!c) return null;
      const botones = [...c.querySelectorAll('.radio-btn--orden')].map((b) => { const r = b.getBoundingClientRect();
        return { texto: b.textContent.trim(), label: b.getAttribute('aria-label'), busy: b.getAttribute('aria-busy'), off: b.getAttribute('aria-disabled'), w: Math.round(r.width), h: Math.round(r.height) }; });
      const l = c.querySelector('.radio-orden-estado');
      return { botones, insignia: c.querySelector('.radio-card-title .radio-insignia')?.textContent ?? null, nota: c.querySelector('.radio-ordenes-nota')?.textContent ?? null,
        linea: l ? { texto: l.textContent, rol: l.getAttribute('role'), live: l.getAttribute('aria-live') } : null, foco: document.activeElement?.getAttribute('aria-label') ?? null };
    });
    const linea = async () => (await tarjeta())?.linea?.texto ?? null;
    const llegaLinea = (t, ms = 8000) => esperar(async () => ((await linea()) === t ? true : null), ms, 40);
    const pendientesDe = (lst) => p.evaluate((l) => [...window.__pendientes.values()].filter((ms) => l.includes(ms)).length, lst);
    const boton = (n) => p.getByRole('button', { name: n, exact: true });
    const nOrd = () => s.ordenes?.length ?? 0;   // cuántas órdenes llegaron a la sala falsa (sin ninguna: 0, no una excepción)
    const regionF = () => p.evaluate(() => document.querySelector('.radio-card--oyente .radio-evento')?.textContent ?? null);

    // sin el rol: nada nuevo; con el rol y orders: true, la insignia y los dos botones
    const e = await entrarFk({ mod: { moderators: [], events: [], until: 0, lost: false } });
    const s = FK[e.code];
    await sleep(2500);
    const t0 = await tarjeta();
    s.mod.moderators = [YO_FK];
    const con = await esperar(async () => { const t = await tarjeta(); return t?.botones.length === 2 ? t : null; }, 8000, 100);
    const t1 = con.v;
    ok('F_botones_solo_para_quien_modera_con_ordenes', e.sono && t0?.botones.length === 0 && t0.insignia === null && t0.nota === null && t0.linea?.texto === ''
      && t0.linea.rol === 'status' && t0.linea.live === 'polite'
      && !!t1 && t1.insignia === 'Modera' && t1.botones.map((b) => b.label).join('|') === 'Siguiente canción de la radio|Pausar la radio'
      && t1.botones.every((b) => b.w >= 44 && b.h >= 44 && b.texto === b.label && b.busy === null && b.off === null),
      { sinRol: t0, conRol: t1 });

    // "siguiente": lleva la base (el seq que se ve), "Enviando…" con aria-busy; la resuelven el cambio de canción y mi evento
    const pend0 = await pendientesDe([5000, 30000]);
    s.demoraOrden = 900;
    const seqVisto = s.estado.seq;
    await boton('Siguiente canción de la radio').click();
    const env = await esperar(async () => { const t = await tarjeta(); return t?.linea?.texto === 'Enviando…' && t.botones[0].busy === 'true' ? t : null; }, 3000, 30);
    await esperar(async () => ((await tarjeta())?.botones[0].busy === null ? true : null), 5000, 30);
    s.demoraOrden = 0;
    const cuerpo = s.ordenes?.[0] ?? null;
    const timersS = (await pendientesDe([5000, 30000])) - pend0;
    estadoFk(e.code, { trackId: B.id, positionMs: 0, playing: true, nextTrackId: C.id });
    s.mod.events.push(evF(1, 'siguiente', idOye)); s.mod.until = 1;
    const resuelta = await esperar(async () => ((await regionF()) === 'Tú pasaste a la siguiente canción' ? true : null), 8000, 40);
    await sleep(200);
    const tS = await tarjeta();
    ok('F_siguiente_lleva_la_base_y_la_resuelve_el_cambio_de_cancion', !!env.v && cuerpo?.type === 'siguiente' && cuerpo.seqBase === seqVisto && typeof cuerpo.clientId === 'string'
      && timersS === 2 && !!resuelta.v && tS.linea.texto === '' && tS.foco === 'Siguiente canción de la radio' && (await pendientesDe([5000, 30000])) === pend0,
      { enviando: env.v && { linea: env.v.linea.texto, busy: env.v.botones[0].busy }, cuerpo, seqVisto, temporizadores: timersS, linea: tS.linea.texto, foco: tS.foco });

    // otra canción sin evento mío → "Ya había cambiado"
    const nY = nOrd();
    await boton('Siguiente canción de la radio').click();
    await esperar(async () => (nOrd() > nY && (await tarjeta())?.botones[0].busy === null ? true : null), 4000, 30);
    estadoFk(e.code, { trackId: C.id, positionMs: 0, playing: true, nextTrackId: A.id });
    const ya = await llegaLinea('Ya había cambiado');
    ok('F_siguiente_sin_evento_mio_ya_habia_cambiado', !!ya.v, { linea: await linea() });

    // pausa resuelta por el ESTADO (sin evento): la línea se vacía y el botón pasa a "Reanudar la radio" con el foco
    const nP = nOrd();
    await boton('Pausar la radio').click();
    await esperar(async () => (nOrd() > nP && (await tarjeta())?.botones[1].busy === null ? true : null), 4000, 30);
    estadoFk(e.code, { trackId: C.id, positionMs: 5000, playing: false, nextTrackId: A.id });
    const rean = await esperar(async () => { const t = await tarjeta(); return t?.botones[1]?.label === 'Reanudar la radio' ? t : null; }, 8000, 40);
    const cuerpoP = nOrd() > nP ? s.ordenes[nOrd() - 1] : null;
    ok('F_pausa_resuelta_por_el_estado_y_el_foco_sigue_en_el_boton', cuerpoP?.type === 'pausa' && !('seqBase' in cuerpoP) && !!rean.v && rean.v.linea.texto === ''
      && rean.v.foco === 'Reanudar la radio' && rean.v.botones[1].texto === 'Reanudar la radio', { tarjeta: rean.v, cuerpo: cuerpoP });

    // errores inmediatos: el texto de textoDeFallo('ordenar') en la línea
    const fallos = [];
    for (const [st, reason, nombre, texto] of [
      [409, 'sin-soporte', 'Reanudar la radio', 'La app del anfitrión todavía no acepta órdenes.'],
      [409, 'no-escucha', 'Reanudar la radio', 'Tienes que estar escuchando la radio para moderar.'],
      // obsoleta y video van por el botón de pausa (la sala falsa contesta lo mismo): así este caso no depende de que
      // "siguiente" se pueda mandar (eso lo prueba F_siguiente_lleva_la_base…).
      [409, 'obsoleta', 'Reanudar la radio', 'La canción ya cambió.'],
      [422, 'video', 'Reanudar la radio', 'Los videos no se pueden poner en la radio.'],
      [403, null, 'Reanudar la radio', 'Ya no puedes moderar esta radio.'],
    ]) {
      s.ordenar = () => ({ status: st, body: { error: 'falso', ...(reason ? { reason } : {}) } });
      await boton(nombre).click();
      const r = await llegaLinea(texto, 4000);
      fallos.push({ status: st, reason, ok: !!r.v, linea: await linea() });
    }
    s.ordenar = null;
    ok('F_errores_inmediatos_en_la_linea_de_estado', fallos.every((x) => x.ok), { fallos });

    // perder el rol con una orden en vuelo: se cancela sin error, se van los botones y sus temporizadores
    const pend1 = await pendientesDe([5000, 30000]);
    await boton('Reanudar la radio').click();
    const enVuelo = await esperar(async () => ((await pendientesDe([5000, 30000])) - pend1 === 2 ? true : null), 4000, 30);
    s.mod.moderators = [];
    s.mod.events.push(evF(2, 'sin-moderador', HOST_FK.id, { target: idOye, targetName: 'Yo' })); s.mod.until = 2;
    const sinRol = await esperar(async () => { const t = await tarjeta(); return t?.botones.length === 0 && t.insignia === null ? t : null; }, 8000, 40);
    await sleep(300);
    const tR = await tarjeta();
    const pendR = (await pendientesDe([5000, 30000])) - pend1;
    ok('F_perder_el_rol_cancela_la_orden_sin_error', !!enVuelo.v && !!sinRol.v && tR.linea.texto === '' && pendR <= 0 && (await regionF()) === 'Ya no puedes moderar esta radio',
      { enVuelo: !!enVuelo.v, linea: tR.linea.texto, temporizadores: pendR, region: await regionF() });

    // orders: false → la nota, sin botones (la insignia sí: modera)
    s.mod.orders = false; s.mod.moderators = [YO_FK];
    const nota = await esperar(async () => { const t = await tarjeta(); return t?.nota ? t : null; }, 8000, 40);
    ok('F_radio_sin_ordenes_muestra_la_nota_y_ningun_boton', !!nota.v && nota.v.nota === 'Esta radio no admite moderación' && nota.v.botones.length === 0 && nota.v.insignia === 'Modera',
      { tarjeta: nota.v });

    // salir con una orden en vuelo: no queda ningún temporizador de la orden
    s.mod.orders = true;
    await esperar(async () => ((await tarjeta())?.botones.length === 2 ? true : null), 8000, 40);
    const pend2 = await pendientesDe([5000, 30000]);
    await boton('Reanudar la radio').click();   // la radio sigue en pausa: la orden queda en vuelo
    const enVuelo2 = await esperar(async () => ((await pendientesDe([5000, 30000])) - pend2 === 2 ? true : null), 4000, 30);
    await salirFk();
    const pendS = await pendientesDe([5000, 30000]);
    ok('F_salir_limpia_los_temporizadores_de_la_orden', !!enVuelo2.v && pendS <= pend2, { enVuelo: !!enVuelo2.v, antes: pend2, despues: pendS });
  }

  // ── G. (W5b-1) con el RELOJ de Playwright, en un contexto APARTE: el de arriba envuelve setTimeout para
  //    contar los pendientes, y el reloj lo reemplazaría. 429 con su cuenta, 5 s y 30 s ──
  {
    const ctxR = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctxR.route('**/stream/**', (r) => r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV }));
    await ctxR.clock.install();
    await ctxR.addInitScript((t) => localStorage.setItem('token', t), tokOye);
    const q = await ctxR.newPage();
    const erroresR = []; q.on('pageerror', (x) => erroresR.push(String(x.message).slice(0, 160)));
    await q.route(esFk, rutaFk);
    await q.route(esOrdenFk, rutaOrdenFk);
    try {
      const code = salaFalsa({ mod: { moderators: [YO_FK], events: [], until: 0, lost: false } });
      estadoFk(code, { trackId: A.id, positionMs: 40_000, playing: true, nextTrackId: B.id });
      const s = FK[code];
      await q.goto(`${BASE}/radio/${code}`);
      await q.waitForSelector('.radio-btn--escuchar:not([disabled])', { timeout: 15000 });
      await q.click('.radio-btn--escuchar');
      await q.waitForSelector('.radio-btn--orden', { timeout: 10000 });
      await q.clock.pauseAt((await q.evaluate(() => Date.now())) + 50);
      const lineaQ = () => q.evaluate(() => document.querySelector('.radio-orden-estado')?.textContent ?? null);
      const offQ = () => q.evaluate(() => [...document.querySelectorAll('.radio-btn--orden')].map((b) => b.getAttribute('aria-disabled')));
      const llegaQ = (t, ms = 4000) => esperar(async () => ((await lineaQ()) === t ? true : null), ms, 40);

      // 429 con Retry-After: 3 → "Espera 3 s", los botones aria-disabled (un clic no manda nada), 2, 1 y vacío
      s.ordenar = () => ({ status: 429, body: { error: 'Demasiadas' }, headers: { 'Retry-After': '3' } });
      await q.getByRole('button', { name: 'Pausar la radio', exact: true }).click();
      const c3 = await llegaQ('Espera 3 s');
      const off3 = await offQ();
      const n0 = s.ordenes.length;
      await q.getByRole('button', { name: 'Pausar la radio', exact: true }).click({ force: true });
      await sleep(300);
      const extra = s.ordenes.length - n0;
      const cuenta = [await lineaQ()];
      for (let k = 0; k < 3; k++) { await q.clock.runFor(1000); await sleep(150); cuenta.push(await lineaQ()); }
      const offFin = await offQ();
      s.ordenar = null;
      ok('G_429_cuenta_regresiva_con_retry_after', !!c3.v && off3.every((x) => x === 'true') && extra === 0
        && JSON.stringify(cuenta) === JSON.stringify(['Espera 3 s', 'Espera 2 s', 'Espera 1 s', '']) && offFin.every((x) => x === null),
        { cuenta, aria_disabled: off3, aria_disabled_al_final: offFin, clicsQueMandaron: extra });

      // sin respuesta del anfitrión: nada hasta los 5 s, "Esperando al anfitrión…" a los 5 s, todavía a los 29 s,
      // "No se aplicó" a los 30 s
      const n1 = s.ordenes.length;
      await q.getByRole('button', { name: 'Pausar la radio', exact: true }).click();
      await esperar(async () => (s.ordenes.length > n1 && (await lineaQ()) === '' ? true : null), 4000, 40);
      const pasos = {};
      await q.clock.runFor(4900); await sleep(200); pasos.s4_9 = await lineaQ();
      await q.clock.runFor(200); await sleep(200); pasos.s5_1 = await lineaQ();
      await q.clock.runFor(23_900); await sleep(200); pasos.s29 = await lineaQ();
      await q.clock.runFor(1100); await sleep(200); pasos.s30_1 = await lineaQ();
      ok('G_esperando_a_los_5s_y_no_se_aplico_a_los_30s', pasos.s4_9 === '' && pasos.s5_1 === 'Esperando al anfitrión…' && pasos.s29 === 'Esperando al anfitrión…'
        && pasos.s30_1 === 'No se aplicó', { pasos });
    } catch (x) { ok('G_excepcion', false, { error: String(x.message).split('\n')[0].slice(0, 200) }); }
    if (erroresR.length) ok('G_sin_errores_de_pagina', false, { errores: erroresR });
    await ctxR.close();
  }

} catch (e) {
  ok('excepcion', false, { error: String(e.message).split('\n')[0].slice(0, 200) });
} finally {
  for (const [tok, c] of salas) if (c) await api(tok, 'DELETE', `/api/radio/${c}`).catch(() => {});
}

await ctx.close();
const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
console.log('registro (fuera del conteo):', JSON.stringify(REG, null, 1));
if (process.env.ORDENES_DUMP) (await import('node:fs')).writeFileSync(process.env.ORDENES_DUMP, JSON.stringify({ ...R, _registro: REG }, null, 1));
console.log(`\nradio-ordenes-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
