// radio-menu-func.mjs — el menú "En la radio" de quien modera (1.45.0, W5b-2), contra el BUILD DE PRODUCCIÓN
// (preview :4173) y el backend REAL del runner (:3100, copia de la base). Salió de radio-oyente-func (su bloque H,
// tal cual) para que ninguna de las dos pase el tope de 5 min del runner.
//
// Montaje: el de radio-oyente-comun.mjs (compartido con radio-oyente-func): la página es la SEGUNDA cuenta (SNAP2_USER/SNAP2_PASS) y la
// radio es un SERVIDOR FALSO por page.route sobre /api/radio/FK… y /api/radio/FK…/ordenes; las pistas, las playlists y
// los videos son los reales de la copia. La cola de la radio es [A, B]; la página escucha A.
//
// Casos (con la radio ACTIVA):
//   H_conteos_del_menu_con_la_radio_activa   los menús EN PANTALLA de pista, la que suena, pista de playlist, filas de
//        la cola y tarjeta de video, sin el rol y con él: para quien modera "En la radio" reemplaza a "Reproducir a
//        continuación" y "Agregar a la cola"; en la que suena no hay panel; la cola y el video no cambian.
//   H_panel_en_la_radio_y_su_foco             el panel (dos acciones), el foco al entrar y al volver con Esc.
//   H_poner_a_continuacion_lleva_la_pista_y_avisa_con_toast   el cuerpo lleva trackId; fuera de la vista Radio el aviso
//        es el toast de RadioProvider (no "Enviando…"); los temporizadores 5 s / 30 s vuelven a cero.
//   H_una_en_vuelo_por_tipo_y_ahora_resuelta_por_el_estado    la segunda del mismo tipo no sale y lo dice; "ahora" (otro
//        tipo) sale y la resuelve el estado.
//   H_sin_panel_sobre_la_que_suena_en_la_radio · H_422_video_y_sin_pista_con_su_texto (y su toast con la variante de
//        aviso, no la de éxito; el de éxito sigue con ✓) · H_perder_el_rol_con_el_panel_abierto
//   H_radio_sin_ordenes_sin_panel · H_temporizadores_de_vuelta (ninguno de órdenes vivo; el sondeo, UNO de 2000 ms).
// Los toasts se cuentan una vez por NODO (.toast): dos toasts iguales son dos nodos y cuentan dos.
//
// CONTROL NEGATIVO: sin trackId en la orden caen H_poner_a_continuacion, H_una_en_vuelo y H_422; con el panel para quien
// no modera cae H_conteos; sin bloquear la segunda en vuelo caen H_una_en_vuelo y H_temporizadores; con los errores en la
// variante de éxito cae H_422.
// Uso: SNAP_BASE=http://localhost:4173 SNAP2_USER=… SNAP2_PASS=… node radio-menu-func.mjs
// MENU_DUMP=<archivo>: deja ahí los resultados con sus valores.
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
  // ── H. (1.45.0, W5b-2) el menú "En la radio" con la radio activa ──
  {
    const evH = (id, type, by, extra = {}) => ({ id, type, by, byName: by === HOST_FK.id ? 'Anfitriona' : 'Yo', target: null, targetName: null, trackId: null, title: null, at: Date.now(), ...extra });
    const leerMenu = () => p.evaluate(() => {
      const m = document.querySelector('.ctx-menu'); if (!m) return null;
      const a = document.activeElement;
      return { label: m.getAttribute('aria-label'), acciones: [...m.querySelectorAll('.ctx-item, .ctx-tile')].map((x) => x.getAttribute('aria-label') ?? x.textContent.trim()),
        volver: m.querySelector('.ctx-back')?.textContent.trim() ?? null, foco: a && m.contains(a) ? (a.getAttribute('aria-label') ?? a.textContent.trim()) : null };
    });
    const cerrarMenu = async () => { for (let k = 0; k < 3 && (await p.$('.ctx-menu')); k++) { await p.keyboard.press('Escape'); await sleep(200); } };
    const menuDe = async (loc) => { await cerrarMenu(); await loc.click({ button: 'right' }); await sleep(300); return leerMenu(); };
    const radioV = () => p.evaluate(() => { const r = window.__radio(); return { modera: r?.vistaMod?.modera ?? null, admite: r?.vistaMod?.admite ?? null, linea: r?.lineaOrden?.texto ?? null }; });
    const pendientesDe = (lst) => p.evaluate((l) => [...window.__pendientes.values()].filter((ms) => l.includes(ms)).length, lst);
    const nOrd = () => s.ordenes?.length ?? 0;
    const toasts = () => p.evaluate(() => window.__toasts.slice());
    const llegaToast = (t, desde, ms = 8000) => esperar(async () => ((await toasts()).slice(desde).some((x) => x === t || (typeof t === 'function' && t(x))) ? true : null), ms, 40);
    const enAlbum = () => irA(A.album_artist ? `/albums/${encodeURIComponent(A.album_artist)}/${encodeURIComponent(A.album)}` : `/albums/@/${encodeURIComponent(A.album)}`);
    const filaOtra = () => p.locator('.main-content .track-row:not(.playing)').first();
    const filaSuena = () => p.locator('.main-content .track-row.playing').first();
    const COLA = ['Reproducir a continuación', 'Agregar a la cola'];
    let pl = null; let s = null;
    try {
      const e = await entrarFk({ mod: { moderators: [], events: [], until: 0, lost: false } });
      s = FK[e.code];
      await p.evaluate(() => {
        window.__toasts = []; window.__variantes = []; const vistos = new WeakSet();   // cada toast una vez (por nodo)
        new MutationObserver(() => { for (const t of document.querySelectorAll('.toast')) {
          if (vistos.has(t)) continue; vistos.add(t); window.__toasts.push(t.querySelector('.toast-text')?.textContent ?? '');
          // la variante: 'warning' (clase .warning, ícono ⚠️) o la normal (ícono ✓, la de éxito)
          window.__variantes.push({ texto: t.querySelector('.toast-text')?.textContent ?? '', aviso: t.classList.contains('warning'), icono: t.querySelector('.toast-icon')?.textContent ?? null });
        } }).observe(document.body, { childList: true, subtree: true });
      });
      pl = (await api(tokOye, 'POST', '/api/playlists', { name: 'W5b-2 prueba', emoji: '🎵' })).j;
      await api(tokOye, 'POST', `/api/playlists/${pl.id}/tracks`, { track_id: B.id });
      await sleep(2500);

      // Los menús de las filas, en pantalla (la radio sonando A; la cola de la radio es [A, B]).
      const contar = async () => {
        const m = {};
        await enAlbum(); await p.waitForSelector('.main-content .track-row', { timeout: 8000 }); await sleep(400);
        const tOtra = (await filaOtra().locator('.track-title').textContent()).trim();
        m.pista = await menuDe(filaOtra());
        m.suena = (await filaSuena().count()) ? await menuDe(filaSuena()) : null;
        await cerrarMenu();
        await irA(`/playlists/${pl.id}`); await p.waitForSelector('.main-content .track-row', { timeout: 8000 }); await sleep(400);
        m.playlist = await menuDe(p.locator('.main-content .track-row').first());
        await cerrarMenu();
        const btnCola = p.locator('.player-bar button[aria-label="Cola"]').first();
        await btnCola.click(); await p.waitForSelector('.queue-row', { timeout: 5000 }); await sleep(300);
        m.colaActual = await menuDe(p.locator('.queue-row.current').first());
        m.colaOtra = await menuDe(p.locator('.queue-row:not(.current)').first());
        await cerrarMenu(); await btnCola.click(); await sleep(300);
        await irA('/videos');
        const hayVideo = await esperar(async () => ((await p.locator('.video-grid > *').count()) > 0 ? true : null), 5000, 100);
        m.video = hayVideo.v ? await menuDe(p.locator('.video-grid > *').first()) : 'sin videos en la base';
        await cerrarMenu();
        return { m, tOtra };
      };
      const sinRol = await contar();
      s.mod.moderators = [YO_FK];
      const rol = await esperar(async () => ((await radioV()).modera === true ? true : null), 8000, 100);
      await sleep(3800);   // que pase el toast de "Puedes moderar esta radio"
      const conRol = await contar();
      const A0 = sinRol.m, A1 = conRol.m;
      const quitar = (l, fuera) => l.filter((x) => !fuera.includes(x));
      const conPanel = (l) => { const i = l.indexOf(COLA[0]) >= 0 ? l.indexOf(COLA[0]) : l.indexOf(COLA[1]); const r = quitar(l, COLA); r.splice(i, 0, 'En la radio'); return r; };
      const n = (x) => (x && typeof x === 'object' ? x.acciones.length : x);
      const igualL = (a, b) => JSON.stringify(a?.acciones) === JSON.stringify(b);
      ok('H_conteos_del_menu_con_la_radio_activa', !!rol.v
        && A0.pista.acciones.includes(COLA[0]) && A0.pista.acciones.includes(COLA[1]) && !A0.pista.acciones.includes('En la radio')
        && igualL(A1.pista, conPanel(A0.pista.acciones)) && igualL(A1.playlist, conPanel(A0.playlist.acciones))
        && !!A0.suena && igualL(A1.suena, quitar(A0.suena.acciones, COLA)) && !A1.suena.acciones.includes('En la radio')
        && igualL(A1.colaActual, A0.colaActual.acciones) && igualL(A1.colaOtra, A0.colaOtra.acciones)
        && (typeof A0.video === 'string' || igualL(A1.video, A0.video.acciones)),
        { sinRol: Object.fromEntries(Object.entries(A0).map(([k, v]) => [k, n(v)])), conRol: Object.fromEntries(Object.entries(A1).map(([k, v]) => [k, n(v)])),
          pierdeQuienModera: { pista: quitar(A0.pista.acciones, A1.pista.acciones), suena: quitar(A0.suena?.acciones ?? [], A1.suena?.acciones ?? []), playlist: quitar(A0.playlist.acciones, A1.playlist.acciones) },
          acciones: { sinRol: A0, conRol: A1 } });

      // El panel: "En la radio" → dos acciones, foco en la primera; Esc vuelve a la lista con el foco en "En la radio"; Esc cierra.
      await enAlbum(); await p.waitForSelector('.main-content .track-row', { timeout: 8000 }); await sleep(300);
      await menuDe(filaOtra());
      await p.getByRole('menuitem', { name: 'En la radio' }).click(); await sleep(250);
      const panel = await leerMenu();
      await p.keyboard.press('Escape'); await sleep(250);
      const vuelta = await leerMenu();
      await p.keyboard.press('Escape'); await sleep(250);
      const cerrado = await leerMenu();
      ok('H_panel_en_la_radio_y_su_foco', panel?.label === 'En la radio' && panel.volver === 'En la radio' && JSON.stringify(panel.acciones) === '["Poner a continuación","Poner ahora"]'
        && panel.foco === 'Poner a continuación' && vuelta?.foco === 'En la radio' && vuelta.acciones.includes('En la radio') && cerrado === null, { panel, vuelta, cerrado });

      const poner = async (cual, fila = filaOtra()) => {
        await menuDe(fila);
        await p.getByRole('menuitem', { name: 'En la radio' }).click(); await sleep(200);
        const acc = (await leerMenu())?.acciones ?? null;
        await p.getByRole('menuitem', { name: cual }).click(); await sleep(150);
        return acc;
      };
      // La pista de esa fila, por su título dentro del álbum de A (no del cuerpo de la orden: así una orden que no
      // lleve la pista no arrastra a los demás casos).
      const delAlbum = (await api(tokOye, 'GET', `/api/tracks?limit=500&album=${encodeURIComponent(A.album)}${A.album_artist ? `&album_artist=${encodeURIComponent(A.album_artist)}` : ''}`)).j;
      const idOtra = (Array.isArray(delAlbum) ? delAlbum : (delAlbum?.tracks ?? [])).find((t) => t.title === conRol.tOtra)?.id ?? null;

      // "Poner a continuación": lleva la pista; fuera de la vista Radio el aviso es el toast de RadioProvider (no "Enviando…")
      const pend0 = await pendientesDe([5000, 30000]);
      const t0 = (await toasts()).length; const n0 = nOrd();
      await poner('Poner a continuación');
      const cerroAlPoner = (await leerMenu()) === null;
      await esperar(async () => (nOrd() > n0 ? true : null), 4000, 30);
      const cuerpoC = nOrd() > n0 ? s.ordenes[nOrd() - 1] : null;
      await sleep(300);
      const timersC = (await pendientesDe([5000, 30000])) - pend0;
      s.mod.events.push(evH(1, 'a-continuacion', idOye, { trackId: idOtra, title: conRol.tOtra })); s.mod.until = 1;
      const avisoC = await llegaToast((x) => x.includes(conRol.tOtra) && x.includes('a continuación'), t0);
      await sleep(300);
      const tsC = (await toasts()).slice(t0);
      ok('H_poner_a_continuacion_lleva_la_pista_y_avisa_con_toast', cerroAlPoner && cuerpoC?.type === 'a-continuacion' && Number.isSafeInteger(idOtra) && cuerpoC.trackId === idOtra
        && typeof cuerpoC.clientId === 'string' && !('seqBase' in cuerpoC) && timersC === 2 && !!avisoC.v && !tsC.includes('Enviando…')
        && (await radioV()).linea === null && (await pendientesDe([5000, 30000])) === pend0,
        { cuerpo: cuerpoC, idOtra, temporizadores: timersC, toasts: tsC, linea: (await radioV()).linea });

      // Una en vuelo por tipo: la segunda "a continuación" no sale y lo dice; "ahora" (otro tipo) sí sale y la resuelve el estado.
      const n1 = nOrd(); const t1 = (await toasts()).length;
      await poner('Poner a continuación');
      await esperar(async () => (nOrd() > n1 ? true : null), 4000, 30);
      const accSegunda = await poner('Poner a continuación');
      const espera = await llegaToast('Espera a que se aplique la anterior', t1, 3000);
      await sleep(300);
      const salieronC = nOrd() - n1;
      const lineaSeg = (await radioV()).linea;
      await poner('Poner ahora');
      await esperar(async () => (nOrd() > n1 + 1 ? true : null), 4000, 30);
      const cuerpoA = nOrd() > n1 + 1 ? s.ordenes[nOrd() - 1] : null;
      s.mod.events.push(evH(2, 'a-continuacion', idOye, { trackId: idOtra, title: conRol.tOtra })); s.mod.until = 2;
      const t2 = (await toasts()).length;
      estadoFk(e.code, { trackId: idOtra, positionMs: 0, playing: true, nextTrackId: B.id });
      const yaSuena = await llegaToast('Ya suena en la radio', t2);
      await esperar(async () => ((await pendientesDe([5000, 30000])) === pend0 ? true : null), 6000, 50);
      ok('H_una_en_vuelo_por_tipo_y_ahora_resuelta_por_el_estado', !!espera.v && salieronC === 1 && lineaSeg === 'Espera a que se aplique la anterior'
        && JSON.stringify(accSegunda) === '["Poner a continuación","Poner ahora"]' && cuerpoA?.type === 'ahora' && cuerpoA.trackId === idOtra
        && !!yaSuena.v && (await pendientesDe([5000, 30000])) === pend0,
        { salieronAContinuacion: salieronC, linea: lineaSeg, accionesDelPanelConUnaEnVuelo: accSegunda, cuerpoAhora: cuerpoA, toasts: (await toasts()).slice(t1) });

      // La que suena en la radio (ahora idOtra): sin panel y sin acciones de cola
      await enAlbum(); await esperar(async () => ((await p.locator('.main-content .track-row.playing .track-title').count()) ? true : null), 8000, 100);
      const tSuena = (await p.locator('.main-content .track-row.playing .track-title').first().textContent()).trim();
      const mSuena = await menuDe(filaSuena());
      await cerrarMenu();
      ok('H_sin_panel_sobre_la_que_suena_en_la_radio', tSuena === conRol.tOtra && !!mSuena && !mSuena.acciones.includes('En la radio') && !mSuena.acciones.some((x) => COLA.includes(x)),
        { titulo: tSuena, acciones: mSuena?.acciones });

      // 422: video y sin-pista, con su texto (toast fuera de la vista Radio y la línea)
      const f422 = [];
      for (const [reason, texto] of [['video', 'Los videos no se pueden poner en la radio.'], ['sin-pista', 'Esa canción ya no está en la biblioteca.']]) {
        s.ordenar = () => ({ status: 422, body: { error: 'falso', reason } });
        const tt = (await toasts()).length;
        await poner('Poner ahora');
        const r = await llegaToast(texto, tt, 4000);
        f422.push({ reason, toast: !!r.v, linea: (await radioV()).linea });
      }
      s.ordenar = null;
      // La variante: los dos errores con la de aviso (⚠️), nunca con la de éxito (✓); el de éxito ("Tú pusiste…") sigue con ✓.
      const variantes = await p.evaluate(() => window.__variantes.slice());
      const errores422 = variantes.filter((x) => x.texto === 'Los videos no se pueden poner en la radio.' || x.texto === 'Esa canción ya no está en la biblioteca.');
      const exito = variantes.filter((x) => x.texto.startsWith('Tú pusiste'));
      ok('H_422_video_y_sin_pista_con_su_texto', f422[0].toast && f422[0].linea === 'Los videos no se pueden poner en la radio.' && f422[1].toast && f422[1].linea === 'Esa canción ya no está en la biblioteca.'
        && errores422.length === 2 && errores422.every((x) => x.aviso && x.icono !== '✓') && exito.length > 0 && exito.every((x) => !x.aviso && x.icono === '✓'),
        { f422, errores: errores422, exito });

      // Perder el rol con el panel abierto: el menú no se refresca; "Poner ahora" cierra, no manda nada y no da error
      await menuDe(filaOtra());
      await p.getByRole('menuitem', { name: 'En la radio' }).click(); await sleep(200);
      s.mod.moderators = []; s.mod.events.push(evH(3, 'sin-moderador', HOST_FK.id, { target: idOye, targetName: 'Yo' })); s.mod.until = 3;
      const sinElRol = await esperar(async () => ((await radioV()).modera === false ? true : null), 8000, 100);
      const panelAbierto = await leerMenu();
      const n3 = nOrd(); const t3 = (await toasts()).length;
      await p.getByRole('menuitem', { name: 'Poner ahora' }).click();
      await sleep(1200);
      const tsR = (await toasts()).slice(t3);
      ok('H_perder_el_rol_con_el_panel_abierto', !!sinElRol.v && JSON.stringify(panelAbierto?.acciones) === '["Poner a continuación","Poner ahora"]' && (await leerMenu()) === null
        && nOrd() === n3 && tsR.length === 0 && (await radioV()).linea === null, { panelAbierto, mandadas: nOrd() - n3, cuerpos: (s.ordenes ?? []).slice(n3), toasts: tsR, linea: (await radioV()).linea });

      // Sin órdenes (orders: false) y con el rol: sin panel, el menú de siempre
      s.mod.orders = false; s.mod.moderators = [YO_FK];
      const sinOrd = await esperar(async () => { const v = await radioV(); return v.modera === true && v.admite === false ? true : null; }, 8000, 100);
      await sleep(3800);
      const mSin = await menuDe(filaOtra());
      await cerrarMenu();
      ok('H_radio_sin_ordenes_sin_panel', !!sinOrd.v && !!mSin && !mSin.acciones.includes('En la radio') && COLA.every((x) => mSin.acciones.includes(x)), { acciones: mSin?.acciones, vio: !!sinOrd.v, radio: await radioV() });

      // Los temporizadores: ninguno de órdenes vivo, el sondeo sigue siendo UNO de 2000 ms
      ok('H_temporizadores_de_vuelta', (await pendientesDe([5000, 30000])) === pend0 && (await sondeoPendiente()) === 1,
        { ordenes: (await pendientesDe([5000, 30000])) - pend0, de2000: await sondeoPendiente() });
      await salirFk();
    } catch (x) { ok('H_excepcion', false, { error: String(x.message).split('\n')[0].slice(0, 200) }); }
    await cerrarMenu().catch(() => {});
    if (pl?.id) await api(tokOye, 'DELETE', `/api/playlists/${pl.id}`);
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
if (process.env.MENU_DUMP) (await import('node:fs')).writeFileSync(process.env.MENU_DUMP, JSON.stringify({ ...R, _registro: REG }, null, 1));
console.log(`\nradio-menu-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
