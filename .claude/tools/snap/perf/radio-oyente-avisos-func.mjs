// radio-oyente-avisos-func.mjs — los dos avisos de quien escucha la radio (1.45.1), contra el BUILD DE PRODUCCIÓN
// (preview :4173) y el backend REAL del runner (:3100, copia de la base).
//
// Montaje: el de radio-oyente-comun.mjs (la página es la SEGUNDA cuenta, SNAP2_USER/SNAP2_PASS; la radio es un
// SERVIDOR FALSO por page.route sobre /api/radio/FK…, con «Anfitriona» transmitiendo; las pistas son las reales de la
// copia y el audio es el WAV sintético de 180 s). La radio arranca con A sonando y B de siguiente.
//
// Casos (en este orden: los dos "sin aviso" van ANTES del primero con aviso, porque el tope de 30 s los taparía):
//   AV1_oyente_sin_acciones_de_cola_y_con_la_linea   el menú de una pista (no la que suena), siendo oyente sin rol:
//        sin "Reproducir a continuación" ni "Agregar a la cola"; la línea «Estás en la radio de Anfitriona» no es un
//        botón ni un menuitem, y tocarla no cierra el menú ni avisa nada.
//   AV1_la_que_suena_tambien                         el menú de la pista que suena: lo mismo.
//   AV1_en_el_telefono_la_linea_ocupa_la_fila        el menú de tiles (long-press, 390 px): la línea ocupa la fila entera
//        de la cuadrícula y no es un tile; las dos de cola tampoco están.
//   AV1_quien_modera_sigue_con_en_la_radio           con el rol (y órdenes): "En la radio", sin la línea ni las de cola.
//   AV2_la_radio_cambia_de_cancion_sin_aviso         la anfitriona pasa a B: el oyente la sigue y NO hay aviso.
//   AV2_termina_sola_sin_aviso                       B termina sola en el oyente antes que en la anfitriona (el motor
//        pasa a C, la siguiente, y el desajuste lo devuelve a B): NO hay aviso. Que el desajuste actuó se ve en que el
//        oyente vuelve a pedir /api/tracks/B (arrancar → resolverColaDelOyente): B dura un instante, porque vuelve
//        al final del WAV y termina otra vez.
//   AV2_otra_cancion_vuelve_con_el_aviso             el oyente pone otra canción: a los DESAJUSTE_MS vuelve la de la
//        radio y sale UNA vez «Volviste a la radio de Anfitriona. Para escuchar otra cosa, sal de la radio.».
//   AV2_no_se_repite_en_30_s                         lo mismo enseguida: vuelve, sin otro aviso.
//   AV1_fuera_de_la_radio_todo_igual                 después de salir: las dos de cola están y la línea no.
//   AV_sin_errores_de_pagina
// Los toasts se cuentan una vez por NODO (.toast).
//
// CONTROL NEGATIVO (a mano): sin la rama `if (vr)` de pushQueueActions caen los AV1 del oyente (vuelven las dos de
// cola); sin el alVuelta del desajuste cae AV2_otra_cancion; sin el tope de 30 s cae AV2_no_se_repite; avisando en
// cualquier desajuste cae AV2_termina_sola.
// Uso: SNAP_BASE=http://localhost:4173 SNAP2_USER=… SNAP2_PASS=… node radio-oyente-avisos-func.mjs
// AVISOS_DUMP=<archivo>: deja ahí los resultados con sus valores.
import {
  R, ok, sleep, SONDEO_MS, DESAJUSTE_MS, A, B, C, D, ctx, p, errores, esperar, foto, FK, YO_FK, estadoFk, irA,
  entrarFk, salirFk, BASE, browser, pedidosTrk,
} from './radio-oyente-comun.mjs';

const T0 = Date.now();
const EN_LA_RADIO = 'Estás en la radio de Anfitriona';
const VUELTA = 'Volviste a la radio de Anfitriona. Para escuchar otra cosa, sal de la radio.';
const COLA = ['Reproducir a continuación', 'Agregar a la cola'];

const leerMenu = () => p.evaluate(() => {
  const m = document.querySelector('.ctx-menu'); if (!m) return null;
  const inf = m.querySelector('.ctx-info');
  return {
    acciones: [...m.querySelectorAll('.ctx-item, .ctx-tile')].map((x) => x.getAttribute('aria-label') ?? x.textContent.trim()),
    info: inf ? inf.textContent.trim() : null,
    infoEsBoton: inf ? (inf.tagName === 'BUTTON' || inf.getAttribute('role') === 'menuitem' || inf.tabIndex >= 0) : null,
    infoEnCuadricula: inf ? { tile: inf.classList.contains('ctx-tile'), columna: getComputedStyle(inf).gridColumnStart + ' / ' + getComputedStyle(inf).gridColumnEnd, ancho: Math.round(inf.getBoundingClientRect().width), anchoGrid: Math.round(m.querySelector('.ctx-grid')?.getBoundingClientRect().width ?? 0) } : null,
  };
});
const cerrarMenu = async () => { for (let k = 0; k < 3 && (await p.$('.ctx-menu')); k++) { await p.keyboard.press('Escape'); await sleep(200); } };
const menuDe = async (loc) => { await cerrarMenu(); await loc.click({ button: 'right' }); await sleep(300); return leerMenu(); };
const radioV = () => p.evaluate(() => ({ modera: window.__radio()?.vistaMod?.modera ?? null }));
const toasts = () => p.evaluate(() => window.__toasts.slice());
const enAlbum = async () => {
  await irA(A.album_artist ? `/albums/${encodeURIComponent(A.album_artist)}/${encodeURIComponent(A.album)}` : `/albums/@/${encodeURIComponent(A.album)}`);
  await p.waitForSelector('.main-content .track-row', { timeout: 8000 }); await sleep(400);
};
const filaOtra = () => p.locator('.main-content .track-row:not(.playing)').first();
const filaSuena = () => p.locator('.main-content .track-row.playing').first();
const sinCola = (m) => !!m && !m.acciones.some((x) => COLA.includes(x));
/** Espera a que suene `id` (en la radio) y devuelve cuánto tardó. */
const vuelveA = (id, ms) => esperar(async () => { const f = await foto(); return f.fase === 'oyente' && f.actual === id && !f.paused ? f : null; }, ms, 100);

try {
  await p.goto(BASE + '/');
  await p.waitForSelector('.player-bar', { timeout: 15000 });
  await p.waitForFunction(() => !!window.__player?.() && !!window.__radio?.());
  await p.evaluate(() => {
    window.__toasts = []; const vistos = new WeakSet();
    new MutationObserver(() => { for (const t of document.querySelectorAll('.toast')) {
      if (vistos.has(t)) continue; vistos.add(t); window.__toasts.push(t.querySelector('.toast-text')?.textContent ?? '');
    } }).observe(document.body, { childList: true, subtree: true });
  });

  const e = await entrarFk({ mod: { moderators: [], events: [], until: 0, lost: false } });
  const s = FK[e.code];
  if (!e.sono) throw new Error('la radio falsa no empezó a sonar');

  // ── 1. El menú de una canción siendo oyente ──
  await enAlbum();
  const t0 = (await toasts()).length;
  const mOtra = await menuDe(filaOtra());
  // Tocar la línea: no pasa nada (el menú sigue abierto, ningún aviso).
  if (mOtra?.info) { await p.locator('.ctx-menu .ctx-info').click(); await sleep(400); }
  const sigueAbierto = !!(await leerMenu());
  const avisosAlTocar = (await toasts()).slice(t0);
  await cerrarMenu();
  ok('AV1_oyente_sin_acciones_de_cola_y_con_la_linea', sinCola(mOtra) && mOtra.info === EN_LA_RADIO && mOtra.infoEsBoton === false && sigueAbierto && avisosAlTocar.length === 0,
    { acciones: mOtra?.acciones, info: mOtra?.info, infoEsBoton: mOtra?.infoEsBoton, sigueAbierto, avisosAlTocar });

  const mSuena = (await filaSuena().count()) ? await menuDe(filaSuena()) : null;
  await cerrarMenu();
  ok('AV1_la_que_suena_tambien', sinCola(mSuena) && mSuena.info === EN_LA_RADIO, { acciones: mSuena?.acciones ?? 'sin fila sonando', info: mSuena?.info ?? null });

  // El menú de tiles: se abre por la misma puerta que el long-press (via: 'longpress'), a 390 px.
  await p.setViewportSize({ width: 390, height: 844 }); await sleep(600);
  await p.evaluate((t) => {
    const root = document.getElementById('root'); const key = Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
    const stack = [root[key]?.stateNode?.current ?? root[key]]; let menu = null;
    while (stack.length && !menu) { const f = stack.pop(); if (!f) continue; const v = f.memoizedProps?.value; if (v && typeof v.openMenu === 'function' && typeof v.registerHost === 'function') menu = v; if (f.sibling) stack.push(f.sibling); if (f.child) stack.push(f.child); }
    menu?.openMenu({ preventDefault() {}, stopPropagation() {}, clientX: 195, clientY: 420 }, { type: 'track', item: t, via: 'longpress' });
  }, C);
  await sleep(400);
  const mTiles = await leerMenu();
  await cerrarMenu();
  await p.setViewportSize({ width: 1440, height: 900 }); await sleep(600);
  const cu = mTiles?.infoEnCuadricula;
  ok('AV1_en_el_telefono_la_linea_ocupa_la_fila', !!mTiles && mTiles.info === EN_LA_RADIO && sinCola(mTiles) && !!cu && !cu.tile && cu.ancho > 0 && cu.ancho === cu.anchoGrid,
    { acciones: mTiles?.acciones, info: mTiles?.info, cuadricula: cu });

  // Con el rol: "En la radio", sin la línea.
  s.mod.moderators = [YO_FK];
  const rol = await esperar(async () => ((await radioV()).modera === true ? true : null), 8000, 100);
  await sleep(3800);   // que pase el toast de "Puedes moderar esta radio"
  await enAlbum();
  const mMod = await menuDe(filaOtra());
  await cerrarMenu();
  ok('AV1_quien_modera_sigue_con_en_la_radio', !!rol.v && !!mMod && mMod.acciones.includes('En la radio') && mMod.info === null && sinCola(mMod),
    { acciones: mMod?.acciones, info: mMod?.info, rol: !!rol.v });
  s.mod.moderators = [];
  await esperar(async () => ((await radioV()).modera === false ? true : null), 8000, 100);
  await sleep(3800);   // que pase el toast de "Ya no puedes moderar esta radio"

  // ── 2. El aviso de "volviste" ──
  // a) La anfitriona cambia de canción: el oyente la sigue, sin aviso.
  let tA = (await toasts()).length;
  estadoFk(e.code, { trackId: B.id, positionMs: 10_000, playing: true, nextTrackId: C.id });
  const aB = await vuelveA(B.id, 10_000);
  await sleep(SONDEO_MS + 500);
  const avisosA = (await toasts()).slice(tA);
  ok('AV2_la_radio_cambia_de_cancion_sin_aviso', !!aB.v && !avisosA.includes(VUELTA), { siguio: !!aB.v, avisos: avisosA });

  // b) B termina sola en el oyente (el WAV dura 180 s; la anfitriona "sigue" en B): el motor pasa a C y el desajuste
  //    lo devuelve a B. El oyente no hizo nada → sin aviso.
  tA = (await toasts()).length;
  estadoFk(e.code, { trackId: B.id, positionMs: 174_000, playing: true, nextTrackId: C.id });
  const pasoAC = await esperar(async () => ((await foto()).actual === C.id ? true : null), 15_000, 100);
  const nB = pedidosTrk[B.id] ?? 0;
  const corrigio = pasoAC.v ? await esperar(async () => ((pedidosTrk[B.id] ?? 0) > nB ? true : null), DESAJUSTE_MS + 2 * SONDEO_MS + 3000, 100) : { v: null };
  await sleep(1500);
  const avisosB = (await toasts()).slice(tA);
  ok('AV2_termina_sola_sin_aviso', !!pasoAC.v && !!corrigio.v && !avisosB.includes(VUELTA), { pasoAC: !!pasoAC.v, corrigio: !!corrigio.v, tardo: corrigio.ms, avisos: avisosB });
  // La anfitriona pasa a C (corta el ir y venir del final de B). Sin aviso: es un cambio de la radio.
  estadoFk(e.code, { trackId: C.id, positionMs: 20_000, playing: true, nextTrackId: B.id });
  await vuelveA(C.id, 10_000);
  await sleep(SONDEO_MS + 500);

  // c) El oyente pone otra canción: a los DESAJUSTE_MS vuelve C, con UN aviso.
  tA = (await toasts()).length;
  await p.evaluate((x) => window.__player().play([x], 0), D);
  const enD = await esperar(async () => ((await foto()).actual === D.id ? true : null), 5000, 100);
  const deVueltaC = await vuelveA(C.id, DESAJUSTE_MS + 2 * SONDEO_MS + 3000);
  const llega = await esperar(async () => ((await toasts()).slice(tA).includes(VUELTA) ? true : null), 3000, 100);
  await sleep(600);
  const avisosC = (await toasts()).slice(tA);
  ok('AV2_otra_cancion_vuelve_con_el_aviso', !!enD.v && !!deVueltaC.v && !!llega.v && avisosC.filter((x) => x === VUELTA).length === 1,
    { puso: !!enD.v, volvio: !!deVueltaC.v, tardo: deVueltaC.ms, avisos: avisosC });

  // d) Enseguida, otra vez: vuelve, pero sin un segundo aviso (como mucho uno cada 30 s).
  tA = (await toasts()).length;
  await p.evaluate((x) => window.__player().play([x], 0), D);
  const enD2 = await esperar(async () => ((await foto()).actual === D.id ? true : null), 5000, 100);
  const deVueltaC2 = await vuelveA(C.id, DESAJUSTE_MS + 2 * SONDEO_MS + 3000);
  await sleep(1500);
  const avisosD = (await toasts()).slice(tA);
  ok('AV2_no_se_repite_en_30_s', !!enD2.v && !!deVueltaC2.v && !avisosD.includes(VUELTA), { puso: !!enD2.v, volvio: !!deVueltaC2.v, avisos: avisosD });

  // ── Fuera de la radio, todo igual ──
  await salirFk();
  await enAlbum();
  const mFuera = await menuDe(filaOtra());
  await cerrarMenu();
  ok('AV1_fuera_de_la_radio_todo_igual', (await foto()).fase === 'sin-radio' && !!mFuera && COLA.every((x) => mFuera.acciones.includes(x)) && mFuera.info === null,
    { acciones: mFuera?.acciones, info: mFuera?.info });

  ok('AV_sin_errores_de_pagina', errores.length === 0, { errores });
} catch (x) {
  ok('AV_excepcion', false, { error: String(x?.message ?? x).split('\n')[0].slice(0, 200) });
}

await ctx.close();
const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
if (process.env.AVISOS_DUMP) (await import('node:fs')).writeFileSync(process.env.AVISOS_DUMP, JSON.stringify({ R, segundos: Math.round((Date.now() - T0) / 1000) }, null, 1));
console.log(`\n[radio-oyente-avisos-func] ${Math.round((Date.now() - T0) / 1000)} s`);
console.log(`\nradio-oyente-avisos-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
