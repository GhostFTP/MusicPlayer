// tablet-longpress-func.mjs — la PULSACIÓN LARGA abre el menú también en una tablet (1.32.1).
//
// Hasta la 1.32.0 la pulsación larga sólo existía a 700 px o menos. En una tablet (dedo + layout de
// escritorio) no hay clic derecho, así que las tarjetas no tenían ninguna puerta al menú. Ahora
// cuenta el puntero: un dedo o un lápiz a cualquier ancho (utils/useLongPress.js).
//
// Comprueba, con dedo (Chromium táctil, toque real por CDP):
//   · a 1280: mantener el dedo en un género, un año, un álbum, un artista, una fila de Biblioteca y un
//     video abre el menú de tiles con su fondo (scrim), y al soltar NO navega ni reproduce;
//   · a 1024 y 1366: lo mismo en un género y en un álbum;
//   · los tiles están bien formados (44 px o más de alto, dentro de la pantalla);
//   · una opción funciona: «Reproducir» de un género deja en cola sus pistas;
//   · tocar afuera cierra el menú y NO activa lo que hay debajo;
//   · el toque corto sigue navegando;
//   · en el teléfono (390) todo sigue igual.
// Con ratón: el clic derecho sigue abriendo la LISTA de escritorio (a 1440 y también a 1280), y
// mantener apretado el botón del ratón no abre nada.
// ⚠️ El dedo emulado abre por el camino del timer (el de iOS). El de Android (pointercancel +
// contextmenu) no se prueba acá: requiere Chrome de Android real.
// Con SNAP_REF (un build sin esto, p. ej. v1.32.0 en otro puerto): control negativo. Sin SNAP_REF ese
// control NO se corre ni se cuenta, y se avisa. Sólo lee: no escribe nada en la base.
// Uso: SNAP_BASE=http://localhost:4173 [SNAP_REF=http://localhost:4174] node tablet-longpress-func.mjs
import { preflight, BASE } from '../session.mjs';
import { preparar, sleep, same } from './tablet-util.mjs';

const REF = process.env.SNAP_REF ?? null;
await preflight();
const { token, browser, abrir } = await preparar();
const R = {}; const ok = (k, v, extra = {}) => { R[k] = { ok: !!v, ...extra }; };
const H = { Authorization: `Bearer ${token}` };
const hayVideos = ((await (await fetch(BASE + '/api/videos', { headers: H })).json()).videos ?? []).length > 0;
const SUP = { genero: ['/genres', '.main-content .genre-item'], anio: ['/years', '.main-content .browse-list .browse-item'], album: ['/albums', '.main-content .album-grid .album-card'],
  artista: ['/artists', '.main-content .artist-portrait'], pista: ['/', '.library-tracks .track-row'], ...(hayVideos ? { video: ['/videos', '.video-card'] } : {}) };

// Mantiene el dedo en el primer elemento de la superficie y dice qué pasó.
async function larga(base, clave, w, h) {
  const [ruta, sel] = SUP[clave];
  const o = await abrir(base, ruta, { w, h, tactil: true, esperar: sel });
  await o.mantener(o.p.locator(sel).nth(clave === 'pista' ? 3 : 0)); await o.esperarMenu();
  const e1 = await o.estado(); const et = await o.etiquetas();
  const geo = await o.p.evaluate(() => { const m = document.querySelector('.ctx-menu'); if (!m) return null; const r = m.getBoundingClientRect(); const ts = [...m.querySelectorAll('.ctx-tile')].map((t) => t.getBoundingClientRect());
    return { dentro: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, tiles: ts.length, alto_min: ts.length ? Math.round(Math.min(...ts.map((t) => t.height))) : 0, ancho_min: ts.length ? Math.round(Math.min(...ts.map((t) => t.width))) : 0 }; });
  await sleep(600); const e2 = await o.estado();
  return { o, ruta, abre: e1.menu === 1 && e1.tiles === 1 && e1.scrim === 1 && et.length >= 2, quieto: e2.ruta === ruta && e2.actual === null && e2.ids.length === 0, etiquetas: et, geo, estado: { menu: e1.menu, tiles: e1.tiles, scrim: e1.scrim, ruta: e2.ruta, suena: e2.titulo } };
}

try {
  for (const clave of Object.keys(SUP)) {
    const r = await larga(BASE, clave, 1280, 800);
    ok(`larga_${clave}_1280`, r.abre && r.quieto && !r.o.errores.length, { etiquetas: r.etiquetas, ...r.estado, errores: r.o.errores });
    if (clave === 'pista') ok('tiles_bien_formados_1280', r.geo && r.geo.dentro && r.geo.tiles >= 6 && r.geo.alto_min >= 44 && r.geo.ancho_min >= 100, r.geo ?? {});
    await r.o.ctx.close();
  }
  if (!hayVideos) console.log('sin videos en /api/videos: la pulsación larga sobre un video NO se probó ni se cuenta.');
  for (const [w, h] of [[1024, 768], [1366, 1024]]) for (const clave of ['genero', 'album']) {
    const r = await larga(BASE, clave, w, h);
    ok(`larga_${clave}_${w}`, r.abre && r.quieto && r.geo?.dentro, { etiquetas: r.etiquetas, ...r.estado, geo: r.geo });
    await r.o.ctx.close();
  }
  // Una opción funciona, tocar afuera no activa, y el toque corto navega.
  {
    const o = await abrir(BASE, '/genres', { w: 1280, h: 800, tactil: true, esperar: SUP.genero[1] });
    const tarjeta = o.p.locator(SUP.genero[1]).first(); const genero = (await tarjeta.locator('.browse-item-name').textContent()).trim();
    const esperadas = (await (await fetch(`${BASE}/api/tracks?${new URLSearchParams({ genre: genero, limit: 100000 })}`, { headers: H })).json()).map((t) => t.id);
    await o.mantener(tarjeta); await o.esperarMenu();
    // (sin menú —un build sin esto— no hay tile que tocar: la fila falla, el script sigue)
    const tile = o.p.locator('.ctx-menu .ctx-tile', { hasText: 'Reproducir' }).first();
    if (await tile.count()) { await o.tocar(tile); await o.p.waitForFunction(() => window.__player().queue.length > 0, null, { timeout: 6000 }).catch(() => {}); await sleep(300); }
    const e = await o.estado();
    ok('menu_reproduce_el_genero_1280', same(e.ids, esperadas) && e.actual === esperadas[0] && e.ruta === '/genres' && e.menu === 0, { genero, en_cola: e.ids.length, pistas_del_genero: esperadas.length, ruta: e.ruta });
    await o.ctx.close();
  }
  {
    const o = await abrir(BASE, '/', { w: 1280, h: 800, tactil: true, esperar: SUP.pista[1] });
    await o.mantener(o.p.locator(SUP.pista[1]).nth(1)); await o.esperarMenu();
    const m = (await o.p.locator('.ctx-menu').count()) ? await o.p.locator('.ctx-menu').first().boundingBox() : null;
    // un punto de la lista que NO tapa el menú: una fila de más abajo, a la derecha
    const fila = await o.p.locator(SUP.pista[1]).nth(8).boundingBox();
    const x = Math.round(fila.x + fila.width - 260), y = Math.round(fila.y + fila.height / 2);
    const libre = !m || x > m.x + m.width + 8 || y > m.y + m.height + 8;
    await o.p.touchscreen.tap(x, y); await sleep(700);
    const e = await o.estado();
    ok('tocar_afuera_cierra_sin_activar_1280', !!m && libre && e.menu === 0 && e.actual === null && e.ruta === '/', { habia_menu: !!m, punto_fuera_del_menu: libre, menu: e.menu, suena: e.titulo, ruta: e.ruta });
    await o.ctx.close();
  }
  {
    const o = await abrir(BASE, '/genres', { w: 1280, h: 800, tactil: true, esperar: SUP.genero[1] });
    await o.tocar(o.p.locator(SUP.genero[1]).first()); await o.p.waitForFunction(() => location.pathname.startsWith('/genres/'), null, { timeout: 4000 }).catch(() => {});
    const e = await o.estado();
    ok('toque_corto_navega_1280', e.ruta.startsWith('/genres/') && e.menu === 0, { ruta: e.ruta, menu: e.menu });
    await o.ctx.close();
  }
  // Con ratón nada cambia.
  for (const w of [1440, 1280]) {
    const o = await abrir(BASE, '/genres', { w, h: 800, esperar: SUP.genero[1] });
    await o.mantener(o.p.locator(SUP.genero[1]).first()); await o.esperarMenu();
    const e = await o.estado(); const et = await o.etiquetas();
    ok(`raton_clic_derecho_abre_la_lista_${w}`, e.menu === 1 && e.tiles === 0 && e.scrim === 0 && same(et, ['Reproducir género', 'Agregar a la cola']) && e.ruta === '/genres', { menu: e.menu, tiles: e.tiles, scrim: e.scrim, etiquetas: et });
    await o.cerrarMenu();
    if (w === 1280) {
      const b = await o.p.locator(SUP.genero[1]).first().boundingBox();
      await o.p.mouse.move(b.x + 80, b.y + b.height / 2); await o.p.mouse.down(); await sleep(800);
      const durante = await o.estado(); await o.p.mouse.up(); await sleep(500); const despues = await o.estado();
      ok('raton_mantener_apretado_no_abre_menu_1280', durante.menu === 0 && despues.menu === 0 && despues.ruta.startsWith('/genres/'), { menu_con_el_boton_apretado: durante.menu, al_soltar: despues.ruta });
    }
    await o.ctx.close();
  }
  // El teléfono, igual que siempre.
  {
    const o = await abrir(BASE, '/genres', { w: 390, h: 780, tactil: true, esperar: SUP.genero[1] });
    await o.mantener(o.p.locator(SUP.genero[1]).first()); await o.esperarMenu();
    const e = await o.estado(); const et = await o.etiquetas(); await sleep(500); const e2 = await o.estado();
    ok('telefono_390_sin_cambios', e.menu === 1 && e.tiles === 1 && e.scrim === 1 && same(et, ['Reproducir', 'A la cola']) && e2.ruta === '/genres' && e2.actual === null, { etiquetas: et, tiles: e.tiles, ruta: e2.ruta });
    await o.ctx.close();
  }
  if (REF) {
    const r = await larga(REF, 'genero', 1280, 800);
    ok('control_ref_sin_menu_en_tablet', !r.abre && r.estado.menu === 0, { en_la_ref: r.estado });
    await r.o.ctx.close();
  }
} catch (e) {
  ok('sin_excepciones', false, { error: String(e.message).split('\n')[0].slice(0, 200) });
}

const fails = Object.entries(R).filter(([, v]) => !v.ok);
console.log(JSON.stringify(R, null, 1));
console.log(REF ? `referencia (un build sin la pulsación larga en tablet): ${REF}` : 'SIN SNAP_REF: el control contra la referencia (control_ref_sin_menu_en_tablet) NO se corrió ni se cuenta.');
console.log(`\ntablet-longpress-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
