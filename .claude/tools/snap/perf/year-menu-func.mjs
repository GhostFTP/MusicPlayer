// year-menu-func.mjs — funcional del MENÚ CONTEXTUAL y el ARRASTRE de una fila de AÑO (Years.jsx, 1.32.0).
//
// La fila de un año abre el menú con clic derecho (escritorio) y con pulsación larga (teléfono),
// igual que la tarjeta de un género, con SÓLO «Reproducir año» y «Agregar a la cola»; y se arrastra
// a la cola como las demás. Siempre lleva el año COMPLETO, también con texto en el buscador.
//
// Lo esperado NO está escrito a mano: sale de GET /api/browse/years y de la biblioteca real
// (GET /api/tracks?limit=10000), en el orden en que la devuelve el servidor.
//
// Comprueba, a 1440:
//   · clic derecho en una fila: el menú se llama «Acciones del año», trae exactamente las dos
//     opciones y no cambia de ruta;
//   · «Reproducir año»: la cola son las pistas del año, en orden, y suena la primera;
//   · «Agregar a la cola» sobre OTRO año: se suman sus pistas al final, sigue sonando la misma y sale
//     el aviso «2003» a la cola · N pistas;
//   · con texto en el buscador (un álbum que NO es todo su año) el menú lleva el año completo;
//   · la fila es arrastrable y soltarla en la cola abierta, o en la barra, encola el año y avisa;
//   · el clic normal sigue abriendo el año; el detalle no tiene buscador, sus tarjetas son las de
//     siempre y el clic derecho en una abre el menú de ÁLBUM.
// A 390 con touch:
//   · un toque corto no abre ningún menú (abre el año);
//   · el evento 'contextmenu' abre los TILES, nunca la lista de escritorio, igual que en una tarjeta
//     de Géneros: a 700 px o menos useLongPress lo trata como la pulsación larga, porque así es como
//     Android avisa de una (utils/useLongPress.js). No es una puerta nueva de Años;
//   · la pulsación larga abre los tiles «Reproducir» y «A la cola» y NO navega; «Reproducir» deja la
//     cola con el año;
//   · la fila no es arrastrable; el toque corto sigue abriendo el año.
// Con SNAP_REF (un build SIN el menú, p. ej. el de v1.31.1 en otro puerto): control negativo (ahí el
// clic derecho no abre nada y la fila no se arrastra) y el detalle de un año es IDÉNTICO al de la
// referencia. Sin SNAP_REF esas comprobaciones NO se corren ni se cuentan, y se avisa.
// Contra un build sin el menú las comprobaciones fallan una por una (no se corta con un timeout).
// Sólo lee: no escribe nada en la base.
// Uso: SNAP_BASE=http://localhost:4173 [SNAP_REF=http://localhost:4174] node year-menu-func.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';

const REF = process.env.SNAP_REF ?? null;
await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Lo esperado, de los datos reales ──
const H = { Authorization: `Bearer ${token}` };
const YEARS = await (await fetch(BASE + '/api/browse/years', { headers: H })).json();
const LIB = (await (await fetch(BASE + '/api/tracks?limit=10000', { headers: H })).json()).filter((t) => t.year != null);
const idsDe = (y) => LIB.filter((t) => t.year === y).map((t) => t.id);
const fold = (s) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Dos años chicos (2 pistas o más) para reproducir y encolar, y uno donde un álbum NO es todo el año.
const porTamano = YEARS.filter((y) => y.track_count >= 2).sort((a, b) => a.track_count - b.track_count || a.year - b.year);
const A = porTamano[0].year, B = porTamano[1].year;
const hay = (t) => fold(`${t.album ?? ''}\n${t.album_artist ?? ''}\n${t.artist ?? ''}`);
let BUSQ = null;   // { texto, anio, coinciden }
for (const y of porTamano) {
  const delAnio = LIB.filter((t) => t.year === y.year);
  const album = [...new Set(delAnio.map((t) => t.album).filter((a) => typeof a === 'string' && /[a-z]/i.test(a) && a.trim().length >= 5))]
    .find((a) => { const n = delAnio.filter((t) => hay(t).includes(fold(a))).length; return n >= 1 && n < delAnio.length; });
  if (album) { BUSQ = { texto: album, anio: y.year, coinciden: delAnio.filter((t) => hay(t).includes(fold(album))).length }; break; }
}

const R = {};
const ok = (k, v, extra = {}) => { R[k] = { ok: !!v, ...extra }; };
const medidas = { anio_a: [A, idsDe(A).length], anio_b: [B, idsDe(B).length], busqueda: BUSQ };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ETIQUETAS = '.ctx-menu .ctx-item span:first-of-type, .ctx-menu .ctx-tile-label';

function wav(sec = 120, sr = 8000) {
  const n = sec * sr, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const WAV = wav();
async function abrir(base, w, h, mobile, ruta = '/years') {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
  await ctx.route('**/stream/**', (r) => {
    const hd = r.request().headers().range; const total = WAV.length;
    if (!hd) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV });
    const [, a, b] = hd.match(/bytes=(\d*)-(\d*)/); const s = a ? +a : 0; const e = b ? +b : total - 1;
    r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${s}-${e}/${total}` }, body: WAV.subarray(s, e + 1) });
  });
  await ctx.addInitScript((t) => {
    localStorage.setItem('token', t);
    window.__player = () => {
      const root = document.getElementById('root');
      const key = Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
      const stack = [root[key]?.stateNode?.current ?? root[key]];
      while (stack.length) {
        const f = stack.pop();
        if (!f) continue;
        const v = f.memoizedProps?.value;
        if (v && typeof v.play === 'function' && typeof v.addToQueue === 'function') return v;
        if (f.sibling) stack.push(f.sibling);
        if (f.child) stack.push(f.child);
      }
      return null;
    };
  }, token);
  const p = await ctx.newPage();
  const errores = []; p.on('pageerror', (e) => errores.push(String(e.message).slice(0, 120)));
  await p.goto(base + ruta); await p.waitForSelector('.main-content .browse-list .browse-item, .main-content .album-grid .album-card'); await p.waitForTimeout(500);
  return { ctx, p, errores };
}
const fila = (p, y) => p.locator('.main-content .browse-list .browse-item').filter({ has: p.locator('.browse-item-name', { hasText: new RegExp(`^${y}$`) }) }).first();
const cola = (p) => p.evaluate(() => { const v = window.__player(); return { ids: v.queue.map((t) => t.id), actual: v.currentTrack?.id ?? null, isPlaying: v.isPlaying }; });
const ruta = (p) => p.evaluate(() => location.pathname);
const toasts = (p) => p.evaluate(() => [...document.querySelectorAll('.toast .toast-text')].map((t) => t.textContent));
const hayMenu = (p) => p.locator('.ctx-menu').count().then((n) => n > 0);
// Abre el menú de la fila (clic derecho o pulsación larga) y devuelve sus etiquetas; [] si no abrió.
async function menu(p, y, largo = false) {
  await fila(p, y).scrollIntoViewIfNeeded().catch(() => {});
  if (largo) {
    const b = await fila(p, y).boundingBox();
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await p.mouse.down(); await sleep(650); await p.mouse.up();
  } else await fila(p, y).click({ button: 'right', timeout: 3000 }).catch(() => {});
  await p.waitForSelector('.ctx-menu', { timeout: 1500 }).catch(() => {});
  await sleep(250);
  return { etiquetas: await p.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.trim()), ETIQUETAS), rotulo: await p.locator('.ctx-menu').first().getAttribute('aria-label', { timeout: 500 }).catch(() => null),
    tiles: await p.locator('.ctx-menu--tiles').count() > 0 };
}
async function elegir(p, texto) {
  const it = p.locator('.ctx-menu :is(.ctx-item, .ctx-tile)', { hasText: texto }).first();
  if (!(await it.count())) return false;
  await it.click(); await p.waitForSelector('.ctx-menu', { state: 'detached', timeout: 3000 }).catch(() => {});
  return true;
}
const cerrar = async (p) => { if (await hayMenu(p)) { await p.keyboard.press('Escape'); await sleep(250); } };
const esperarCola = (p, n) => p.waitForFunction((n) => window.__player().queue.length === n, n, { timeout: 5000 }).catch(() => {});

try {
  // ── Escritorio 1440 ──
  {
    const { ctx, p, errores } = await abrir(BASE, 1440, 900, false);
    const m = await menu(p, A);
    ok('menu_clic_derecho', same(m.etiquetas, ['Reproducir año', 'Agregar a la cola']) && m.rotulo === 'Acciones del año' && !m.tiles && (await ruta(p)) === '/years', { ...m, ruta: await ruta(p) });
    await elegir(p, 'Reproducir año'); await esperarCola(p, idsDe(A).length);
    await p.waitForFunction(() => window.__player().isPlaying, null, { timeout: 5000 }).catch(() => {});
    const c1 = await cola(p);
    ok('reproducir_anio', same(c1.ids, idsDe(A)) && c1.actual === idsDe(A)[0] && c1.isPlaying && (await ruta(p)) === '/years', { en_cola: c1.ids.length, esperadas: idsDe(A).length, actual: c1.actual, primera: idsDe(A)[0], suena: c1.isPlaying });

    const mB = await menu(p, B);
    await elegir(p, 'Agregar a la cola'); await esperarCola(p, idsDe(A).length + idsDe(B).length); await sleep(300);
    const c2 = await cola(p); const t2 = await toasts(p); const nB = idsDe(B).length;
    const aviso = `«${B}» a la cola · ${nB} ${nB === 1 ? 'pista' : 'pistas'}`;
    ok('agregar_a_la_cola', same(mB.etiquetas, ['Reproducir año', 'Agregar a la cola']) && same(c2.ids, [...idsDe(A), ...idsDe(B)]) && c2.actual === idsDe(A)[0] && t2.includes(aviso), { en_cola: c2.ids.length, esperadas: idsDe(A).length + nB, actual: c2.actual, avisos: t2, esperado: aviso });

    // Con texto en el buscador: el año completo, no sólo las coincidencias.
    if (BUSQ) {
      const hayCampo = (await p.locator('.section-header .sbx input').count()) > 0;
      if (hayCampo) { await p.locator('.section-header .sbx input').fill(BUSQ.texto); await sleep(700); }
      await menu(p, BUSQ.anio); await elegir(p, 'Reproducir año'); await esperarCola(p, idsDe(BUSQ.anio).length); await sleep(200);
      const c3 = await cola(p);
      ok('con_busqueda_lleva_el_anio_completo', hayCampo && same(c3.ids, idsDe(BUSQ.anio)) && c3.ids.length > BUSQ.coinciden, { busqueda: BUSQ.texto, anio: BUSQ.anio, en_cola: c3.ids.length, del_anio: idsDe(BUSQ.anio).length, que_coinciden: BUSQ.coinciden });
      if (hayCampo) { await p.locator('.section-header .sbx input').fill(''); await sleep(400); }
    } else ok('con_busqueda_lleva_el_anio_completo', false, { motivo: 'la biblioteca no tiene un año con un álbum que sea sólo parte de él' });

    // Arrastre: a la cola abierta y a la barra.
    await p.evaluate((ids) => { const v = window.__player(); v.play(v.queue.slice(0, 1), 0); }, null); await esperarCola(p, 1);
    const base1 = (await cola(p)).ids;
    const arrastrable = await fila(p, A).getAttribute('draggable');
    await p.click('.player-bar .action-btn[aria-label="Cola"]'); await p.waitForSelector('.queue-panel', { timeout: 3000 }).catch(() => {}); await sleep(400);
    await fila(p, A).dragTo(p.locator('.queue-panel'), { timeout: 5000 }).catch(() => {});
    await esperarCola(p, base1.length + idsDe(A).length); await sleep(300);
    const c4 = await cola(p); const t4 = await toasts(p);
    ok('arrastre_a_la_cola', arrastrable === 'true' && same(c4.ids, [...base1, ...idsDe(A)]) && t4.some((t) => t.startsWith(`«${A}» a la cola · `)), { draggable: arrastrable, en_cola: c4.ids.length, esperadas: base1.length + idsDe(A).length, avisos: t4 });
    await p.click('.player-bar .action-btn[aria-label="Cola"]'); await sleep(400);
    await fila(p, B).dragTo(p.locator('.player-bar .player-progress'), { timeout: 5000 }).catch(() => {});
    await esperarCola(p, c4.ids.length + idsDe(B).length); await sleep(300);
    const c5 = await cola(p);
    ok('arrastre_a_la_barra', same(c5.ids, [...c4.ids, ...idsDe(B)]) && (await ruta(p)) === '/years', { en_cola: c5.ids.length, esperadas: c4.ids.length + idsDe(B).length });

    // El clic normal y el detalle.
    await fila(p, A).click(); await p.waitForSelector('.main-content .album-grid .album-card', { timeout: 5000 }).catch(() => {}); await sleep(400);
    const det = await p.evaluate(() => ({ ruta: location.pathname, titulo: document.querySelector('.main-content .section-title')?.textContent.trim(), buscadores: document.querySelectorAll('.main-content .sbx').length,
      tarjetas: document.querySelectorAll('.main-content .album-grid .album-card').length, filasAnio: document.querySelectorAll('.main-content .browse-item').length }));
    const albumesA = new Set(LIB.filter((t) => t.year === A).map((t) => `${t.album_artist ?? ''}\n${t.album ?? ''}`)).size;
    await p.locator('.main-content .album-grid .album-card').first().click({ button: 'right' }); await p.waitForSelector('.ctx-menu', { timeout: 1500 }).catch(() => {}); await sleep(200);
    const mAlbum = await p.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.trim()), ETIQUETAS);
    await cerrar(p);
    ok('clic_abre_el_anio_y_detalle_como_siempre', det.ruta === `/years/${A}` && det.titulo === String(A) && det.buscadores === 0 && det.tarjetas === albumesA && det.filasAnio === 0 && mAlbum[0] === 'Reproducir álbum' && !mAlbum.includes('Reproducir año') && !errores.length,
      { ...det, albumes_esperados: albumesA, menu_de_la_tarjeta: mAlbum, errores });
    await ctx.close();
  }

  // ── Teléfono 390 ──
  {
    const { ctx, p, errores } = await abrir(BASE, 390, 844, true);
    // Toque corto: registra en cada frame si aparece un menú; tiene que abrir el año y nada más.
    await p.evaluate(() => { window.__vioMenu = false; const f = () => { if (document.querySelector('.ctx-menu')) window.__vioMenu = true; requestAnimationFrame(f); }; requestAnimationFrame(f); });
    await fila(p, A).tap(); await p.waitForFunction((y) => location.pathname === `/years/${y}`, A, { timeout: 4000 }).catch(() => {}); await sleep(700);
    const vio = await p.evaluate(() => window.__vioMenu);
    ok('toque_corto_no_abre_menu_390', !vio && (await ruta(p)) === `/years/${A}`, { menu_en_algun_frame: vio, ruta: await ruta(p) });
    await p.goto(BASE + '/years'); await p.waitForSelector('.main-content .browse-list .browse-item'); await sleep(400);
    // 'contextmenu' a 390: tiles, como en Géneros (misma puerta de useLongPress).
    const mc = await menu(p, A); await cerrar(p);
    await p.goto(BASE + '/genres'); await p.waitForSelector('.main-content .genre-item'); await sleep(400);
    await p.locator('.main-content .genre-item').first().click({ button: 'right', timeout: 3000 }).catch(() => {}); await p.waitForSelector('.ctx-menu', { timeout: 1500 }).catch(() => {}); await sleep(250);
    const mg = { tiles: await p.locator('.ctx-menu--tiles').count() > 0, etiquetas: await p.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.trim()), ETIQUETAS) };
    await cerrar(p);
    ok('contextmenu_390_tiles_como_generos', mc.tiles && same(mc.etiquetas, ['Reproducir', 'A la cola']) && mg.tiles && same(mg.etiquetas, ['Reproducir', 'A la cola']), { anio: { tiles: mc.tiles, etiquetas: mc.etiquetas }, genero: mg });
    await p.goto(BASE + '/years'); await p.waitForSelector('.main-content .browse-list .browse-item'); await sleep(400);
    const m = await menu(p, A, true);
    ok('pulsacion_larga_390', same(m.etiquetas, ['Reproducir', 'A la cola']) && m.tiles && m.rotulo === 'Acciones del año' && (await ruta(p)) === '/years', { ...m, ruta: await ruta(p) });
    await elegir(p, 'Reproducir'); await esperarCola(p, idsDe(A).length); await sleep(300);
    const c = await cola(p);
    ok('reproducir_desde_los_tiles_390', same(c.ids, idsDe(A)) && c.actual === idsDe(A)[0] && (await ruta(p)) === '/years', { en_cola: c.ids.length, esperadas: idsDe(A).length, actual: c.actual });
    // (contra un build sin el menú la pulsación larga termina abriendo el año: se vuelve a la lista)
    if ((await ruta(p)) !== '/years') { await p.goto(BASE + '/years'); await p.waitForSelector('.main-content .browse-list .browse-item'); await sleep(400); }
    const dr = await fila(p, A).getAttribute('draggable', { timeout: 3000 }).catch(() => null);
    await fila(p, A).tap(); await p.waitForFunction((y) => location.pathname === `/years/${y}`, A, { timeout: 4000 }).catch(() => {});
    ok('toque_corto_abre_y_no_se_arrastra_390', (await ruta(p)) === `/years/${A}` && dr !== 'true' && !errores.length, { ruta: await ruta(p), draggable: dr, errores });
    await ctx.close();
  }

  // ── Contra la referencia: sin menú ni arrastre, y el detalle idéntico ──
  if (REF) {
    const r = await abrir(REF, 1440, 900, false);
    const mr = await menu(r.p, A);
    ok('control_ref_sin_menu_ni_arrastre', mr.etiquetas.length === 0 && (await fila(r.p, A).getAttribute('draggable')) !== 'true', { etiquetas_en_ref: mr.etiquetas, draggable_en_ref: await fila(r.p, A).getAttribute('draggable') });
    await r.ctx.close();
    const detalle = async (base) => { const o = await abrir(base, 1440, 900, false, `/years/${A}`); await o.p.waitForTimeout(500);
      const d = await o.p.evaluate(() => { const m = document.querySelector('.main-content'); const r = (e) => { const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
        return { html: m.innerHTML.replace(/token=[^"&]+/g, 'token=…'), cajas: [...m.querySelectorAll('.section-title, .view-actions, .album-card')].map(r) }; });
      await o.ctx.close(); return d; };
    const dn = await detalle(BASE), dref = await detalle(REF);
    ok('detalle_igual_a_la_ref', dn.html === dref.html && same(dn.cajas, dref.cajas), { html_igual: dn.html === dref.html, cajas_iguales: same(dn.cajas, dref.cajas), tarjetas: dn.cajas.length - 2, largo_html: [dn.html.length, dref.html.length] });
  }
} catch (e) {
  ok('sin_excepciones', false, { error: String(e.message).split('\n')[0].slice(0, 200) });
}

const fails = Object.entries(R).filter(([, v]) => !v.ok);
console.log(JSON.stringify(R, null, 1));
console.log('medidas: ' + JSON.stringify(medidas));
console.log(REF ? `referencia (un build sin el menú de Años): ${REF}` : 'SIN SNAP_REF: las comprobaciones contra la referencia (control_ref_sin_menu_ni_arrastre, detalle_igual_a_la_ref) NO se corrieron ni se cuentan.');
console.log(`\nyear-menu-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
