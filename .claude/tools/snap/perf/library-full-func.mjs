// library-full-func.mjs — LA BIBLIOTECA COMPLETA, SIN TOPE (1.33.0).
//
// Hasta la 1.32.1 la app pedía GET /api/tracks con un `limit` fijo (10000) y todo lo de más allá no
// aparecía ni sonaba, sin aviso. Ahora un cargador único (utils/libraryLoader.js) pagina hasta
// agotar (la primera página de 5000 y las siguientes de 20000). Este script comprueba que nada queda cortado y que paginar no rompe nada.
//
// DOS MODOS:
//   · por defecto, la biblioteca se FABRICA: se interceptan los pedidos a /api/tracks y se responde
//     como respondería el servidor (filtros, limit, offset y un ETag por respuesta) con N pistas
//     hechas repitiendo las reales con otros ids, otro álbum y otro artista. Así corre con la base de
//     siempre, sin escribir nada. LIB_N (por defecto 4646) es el tamaño "de todos los días"; aparte,
//     SIEMPRE corre una de 12 000 (dos páginas, y más que el tope viejo).
//   · con LIB_REAL=1 no se intercepta nada: usa el backend tal cual. Es para correrlo contra un clon
//     de verdad hecho con lib-clones.mjs (4646, 25 000, 50 000 pistas). Los casos que necesitan
//     manipular las respuestas (e, f) no corren en ese modo, y se avisa.
//
// Comprueba, a 1440:
//   (a) Biblioteca muestra el total exacto;
//   (b) el Mix de Álbumes, Artistas, Géneros y Años deja en cola todas las pistas de su vista;
//   (c) «Reproducir año» (el año más grande) y «Reproducir género» (el más grande) las llevan todas;
//   (d) salir de Biblioteca a mitad de la carga: no se pide ni una página más, sin errores;
//   (e) la biblioteca cambia entre dos páginas (entra una pista al principio): no hay repetidos y
//       nada se rompe;
//   (f) revalidación: si no cambió nada, la lista no se toca; si cambió un título, aparece;
//       y con respuestas SIN ETag funciona igual (firma propia);
//   (g) un servidor que ignora el `offset` no deja a la app pidiendo para siempre.
// Con SNAP_REF (un build con el tope, p. ej. v1.32.1 en otro puerto): control negativo — ahí la de
// 12 000 se corta en 10 000. Sin SNAP_REF ese control NO se corre ni se cuenta, y se avisa.
// No escribe nada en la base.
// Uso: SNAP_BASE=http://localhost:4173 [SNAP_REF=http://localhost:4174] [LIB_N=4646] [LIB_REAL=1] node library-full-func.mjs
import { createHash } from 'node:crypto';
import { preflight, BASE } from '../session.mjs';
import { preparar, sleep } from './tablet-util.mjs';

const REF = process.env.SNAP_REF ?? null;
const REAL = process.env.LIB_REAL === '1';
const LIB_N = Number(process.env.LIB_N ?? 4646);
const GRANDE = 12000;
await preflight();
const { token, browser, abrir } = await preparar();
const R = {}; const ok = (k, v, extra = {}) => { R[k] = { ok: !!v, ...extra }; };
const medidas = {};
const H = { Authorization: `Bearer ${token}` };
const FILTROS = ['album', 'artist', 'album_artist', 'genre', 'year', 'search'];

// La biblioteca real, paginando (como lo haría cualquiera que no confíe en un tope).
async function todasLasReales() {
  const out = []; for (let off = 0; ; off += 5000) { const p = await (await fetch(`${BASE}/api/tracks?limit=5000&offset=${off}`, { headers: H })).json(); out.push(...p); if (p.length < 5000) break; }
  return out;
}
const REALES = await todasLasReales();
function fabricar(n) {
  const out = [];
  for (let k = 0; out.length < n; k++) for (const t of REALES) {
    if (out.length >= n) break;
    out.push(k === 0 ? { ...t } : { ...t, id: t.id + k * 1_000_000, album: t.album == null ? null : `${t.album} [${k}]`, album_artist: t.album_artist == null ? null : `${t.album_artist} ${k}` });
  }
  return out;
}
const hasText = (v) => v != null && v !== '';
// Lo que tiene que haber en cada cola, con las mismas reglas que las vistas (utils/viewTracks.js).
const esperado = (lib) => {
  const porAnio = new Map(), porGenero = new Map();
  for (const t of lib) { if (t.year != null) porAnio.set(t.year, (porAnio.get(t.year) ?? 0) + 1); if (hasText(t.genre)) porGenero.set(t.genre, (porGenero.get(t.genre) ?? 0) + 1); }
  const mayor = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0];
  return { total: lib.length, albumes: lib.filter((t) => t.album != null).length, artistas: lib.filter((t) => hasText(t.album_artist)).length, generos: lib.filter((t) => hasText(t.genre)).length,
    anios: lib.filter((t) => t.year != null).length, anio: mayor(porAnio), genero: mayor(porGenero) };
};

// Un "servidor" de /api/tracks sobre `estado.lib`. `estado` deja manipularlo desde la prueba.
async function servir(ctx, estado) {
  await ctx.route((u) => u.pathname === '/api/tracks', async (r) => {
    const u = new URL(r.request().url()); const sp = u.searchParams;
    const esBib = !FILTROS.some((k) => sp.has(k));
    const limit = Number(sp.get('limit') ?? 50), offset = Number(sp.get('offset') ?? 0);
    estado.pedidos.push({ bib: esBib, limit, offset, t: Date.now() });
    if (esBib && estado.demora) await sleep(estado.demora);
    let lista = estado.lib;
    if (sp.has('genre')) lista = lista.filter((t) => t.genre === sp.get('genre'));
    if (sp.has('album_artist')) lista = lista.filter((t) => t.album_artist === sp.get('album_artist'));
    if (sp.has('year')) lista = lista.filter((t) => t.year === Number(sp.get('year')));
    if (sp.has('album')) lista = lista.filter((t) => t.album === sp.get('album'));
    const pagina = estado.ignoraOffset ? lista.slice(0, limit) : lista.slice(offset, offset + limit);
    const body = JSON.stringify(pagina);
    estado.alServir?.(esBib, offset);
    await r.fulfill({ status: 200, contentType: 'application/json', headers: estado.sinEtag ? {} : { etag: `W/"${createHash('sha1').update(body).digest('base64')}"` }, body }).catch(() => {});
  });
}
const nuevoEstado = (lib) => ({ lib, pedidos: [], demora: 0, sinEtag: false, ignoraOffset: false, alServir: null });
// El contador de Biblioteca sube ANIMADO hasta el total: se lee cuando deja de moverse.
async function contador(p) {
  const leer = () => p.locator('.library-count').first().textContent({ timeout: 20000 }).then((s) => Number(s.replace(/[^\d]/g, ''))).catch(() => null);
  let antes = await leer();
  for (let i = 0; i < 40; i++) { await sleep(300); const ahora = await leer(); if (ahora === antes) return ahora; antes = ahora; }
  return antes;
}
const ir = (p, nombre) => p.evaluate((n) => [...document.querySelectorAll('.sidebar button')].find((b) => b.textContent.trim().startsWith(n)).click(), nombre);
const cola = (p) => p.evaluate(() => { const q = window.__player().queue; return { n: q.length, unicos: new Set(q.map((t) => t.id)).size }; });
// Espera una cola NUEVA (otra primera pista que la que había) con n elementos.
const marca = (p) => p.evaluate(() => window.__player().queue[0]?._qid ?? null);
const esperarCola = (p, n, antes) => p.waitForFunction(({ n, antes }) => { const q = window.__player().queue; return q.length === n && (q[0]?._qid ?? null) !== antes; }, { n, antes }, { timeout: 30000 }).catch(() => {});

// (a) (b) (c) para una biblioteca dada.
async function totales(base, lib, sufijo, fab) {
  const E = esperado(lib);
  const o = await abrir(base, '/', { w: 1440, h: 900 });
  const estado = nuevoEstado(lib); if (fab) { await servir(o.ctx, estado); await o.p.reload(); }
  o.p.setDefaultTimeout(30000);
  await o.p.waitForSelector('.library-tracks .track-row', { timeout: 30000 }).catch(() => {}); await sleep(600);
  const visto = await contador(o.p);
  ok(`biblioteca_total_${sufijo}`, visto === E.total, { contador: visto, pistas: E.total });
  const mix = {};
  for (const [nombre, ruta, sel, n] of [['Álbumes', '/albums', '.album-grid .album-card', E.albumes], ['Artistas', '/artists', '.artist-portrait', E.artistas], ['Géneros', '/genres', '.genre-item', E.generos], ['Años', '/years', '.browse-item', E.anios]]) {
    await ir(o.p, nombre); await o.p.waitForSelector(`.main-content ${sel}`, { timeout: 15000 }).catch(() => {}); await sleep(400);
    const antes = await marca(o.p);
    // Si la vista no llegó a pintarse (p. ej. /api/browse/artists tarda más que el tope del cliente
    // con cientos de artistas) no hay botón: se anota y se sigue con las demás.
    const hayBoton = await o.p.locator('.view-actions .mix-btn').first().click({ timeout: 15000 }).then(() => true, () => false);
    if (hayBoton) await esperarCola(o.p, n, antes); await sleep(200);
    const c = await cola(o.p); mix[nombre] = hayBoton ? { en_cola: c.n, sin_repetir: c.unicos, esperadas: n } : { en_cola: null, sin_repetir: null, esperadas: n, motivo: 'la vista no cargó' };
  }
  ok(`mix_de_las_cuatro_vistas_${sufijo}`, Object.values(mix).every((m) => m.en_cola === m.esperadas && m.sin_repetir === m.esperadas), mix);
  // «Reproducir año» (ya estamos en Años) y «Reproducir género»
  const fila = o.p.locator('.main-content .browse-list .browse-item').filter({ has: o.p.locator('.browse-item-name', { hasText: new RegExp(`^${E.anio[0]}$`) }) }).first();
  await fila.click({ button: 'right' }); await o.esperarMenu(); const m1 = await marca(o.p); await o.p.locator('.ctx-menu .ctx-item', { hasText: 'Reproducir año' }).click(); await esperarCola(o.p, E.anio[1], m1); await sleep(200);
  const ca = await cola(o.p);
  await ir(o.p, 'Géneros'); await o.p.waitForSelector('.main-content .genre-item', { timeout: 15000 }).catch(() => {}); await sleep(300);
  const tarjeta = o.p.locator('.main-content .genre-item').filter({ has: o.p.locator('.browse-item-name', { hasText: new RegExp(`^${E.genero[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) }).first();
  await tarjeta.click({ button: 'right' }); await o.esperarMenu(); const m2 = await marca(o.p); await o.p.locator('.ctx-menu .ctx-item', { hasText: 'Reproducir género' }).click(); await esperarCola(o.p, E.genero[1], m2); await sleep(200);
  const cg = await cola(o.p);
  ok(`reproducir_anio_y_genero_enteros_${sufijo}`, ca.n === E.anio[1] && cg.n === E.genero[1] && !o.errores.length, { anio: { cual: E.anio[0], en_cola: ca.n, esperadas: E.anio[1] }, genero: { cual: E.genero[0], en_cola: cg.n, esperadas: E.genero[1] }, errores: o.errores });
  medidas[sufijo] = { pistas: E.total, pedidos_de_biblioteca: fab ? estado.pedidos.filter((x) => x.bib).length : 'n/d (backend real)' };
  await o.ctx.close();
  return { visto, mix };
}

try {
  if (REAL) {
    await totales(BASE, REALES, `real_${REALES.length}`, false);
    console.log('LIB_REAL=1: los casos (d), (e), (f) y (g) manipulan las respuestas y NO se corrieron ni se cuentan en este modo.');
  } else {
    await totales(BASE, fabricar(LIB_N), String(LIB_N), true);
    await totales(BASE, fabricar(GRANDE), String(GRANDE), true);

    // (d) Salir de Biblioteca a mitad de la carga.
    {
      const o = await abrir(BASE, '/albums', { w: 1440, h: 900, esperar: '.album-grid .album-card' });
      const estado = nuevoEstado(fabricar(GRANDE)); estado.demora = 500; await servir(o.ctx, estado);
      const consola = []; o.p.on('console', (m) => { if (m.type() === 'error') consola.push(m.text().slice(0, 120)); });
      await ir(o.p, 'Biblioteca');
      for (let i = 0; i < 40 && !estado.pedidos.some((x) => x.bib); i++) await sleep(50);   // salió el pedido de la 1ª página
      await sleep(150);
      const alSalir = estado.pedidos.filter((x) => x.bib).length; const tSalida = Date.now();
      await ir(o.p, 'Álbumes'); await o.p.waitForSelector('.album-grid .album-card'); await sleep(2500);
      const despues = estado.pedidos.filter((x) => x.bib && x.t > tSalida).length;
      const errorUi = await o.p.locator('.main-content .empty-state').count();
      ok('salir_a_mitad_de_la_carga_no_deja_pedidos', alSalir === 1 && despues === 0 && !o.errores.length && consola.length === 0 && errorUi === 0, { pedidos_antes_de_salir: alSalir, pedidos_despues_de_salir: despues, quedaban_por_pedir: GRANDE - 5000, errores: o.errores, consola, cartel_de_error: errorUi });
      // y volver a entrar carga bien, entera
      estado.demora = 0; await ir(o.p, 'Biblioteca'); await o.p.waitForSelector('.library-tracks .track-row', { timeout: 30000 }).catch(() => {}); await sleep(500);
      const visto = await contador(o.p);
      ok('volver_a_entrar_carga_entera', visto === GRANDE, { contador: visto, pistas: GRANDE });
      await o.ctx.close();
    }
    // (e) La biblioteca cambia entre la 1ª y la 2ª página: entra una pista al principio, así que la
    //     2ª página empieza repitiendo la última de la 1ª.
    {
      const o = await abrir(BASE, '/albums', { w: 1440, h: 900, esperar: '.album-grid .album-card' });
      const lib = fabricar(GRANDE); const estado = nuevoEstado(lib); let metida = false;
      estado.alServir = (esBib, offset) => { if (esBib && offset === 0 && !metida) { metida = true; estado.lib = [{ ...lib[0], id: 999_000_001, title: 'Recién escaneada' }, ...lib]; } };
      await servir(o.ctx, estado);
      await ir(o.p, 'Biblioteca'); await o.p.waitForSelector('.library-tracks .track-row', { timeout: 30000 }).catch(() => {}); await sleep(600);
      const visto = await contador(o.p);
      await ir(o.p, 'Álbumes'); await o.p.waitForSelector('.album-grid .album-card'); await sleep(300);
      // el Mix de Álbumes usa la biblioteca que quedó en memoria: sin ids repetidos
      await o.p.locator('.view-actions .mix-btn').first().click(); await o.p.waitForFunction(() => window.__player().queue.length > 0, null, { timeout: 15000 }).catch(() => {}); await sleep(300);
      const c = await cola(o.p);
      ok('cambia_entre_paginas_sin_repetidos', metida && visto === GRANDE && c.n === c.unicos && c.n > 0 && !o.errores.length, { contador: visto, esperado: `${GRANDE} (la que se repite en el borde se descarta; la nueva entra en la siguiente revalidación)`, cola: c, errores: o.errores });
      await o.ctx.close();
    }
    // (f) Revalidación: sin cambios no toca la lista; con un cambio, aparece. Con ETag y sin ETag.
    for (const sinEtag of [false, true]) {
      const suf = sinEtag ? 'sin_etag' : 'con_etag';
      const o = await abrir(BASE, '/albums', { w: 1440, h: 900, esperar: '.album-grid .album-card' });
      const lib = fabricar(LIB_N); const estado = nuevoEstado(lib); estado.sinEtag = sinEtag; await servir(o.ctx, estado);
      await ir(o.p, 'Biblioteca'); await o.p.waitForSelector('.library-tracks .track-row', { timeout: 30000 }); await sleep(600);
      const primera = (await o.p.locator('.library-tracks .track-row .track-title').first().textContent()).trim();
      // vuelta 1: nada cambió
      await ir(o.p, 'Álbumes'); await o.p.waitForSelector('.album-grid .album-card'); await sleep(300);
      estado.demora = 400; const p0 = estado.pedidos.filter((x) => x.bib).length;
      await ir(o.p, 'Biblioteca'); await o.p.waitForSelector('.library-tracks .track-row'); await sleep(150);
      await o.p.evaluate(() => { window.__mut = 0; new MutationObserver((ms) => { window.__mut += ms.length; }).observe(document.querySelector('.main-content'), { subtree: true, childList: true, characterData: true }); });
      await sleep(1500);
      const quieto = await o.p.evaluate(() => window.__mut); const p1 = estado.pedidos.filter((x) => x.bib).length;
      ok(`revalidacion_sin_cambios_no_toca_la_lista_${suf}`, p1 > p0 && quieto === 0, { pedidos_de_la_revalidacion: p1 - p0, mutaciones_del_dom: quieto });
      // vuelta 2: cambió el título de la primera fila visible
      await ir(o.p, 'Álbumes'); await o.p.waitForSelector('.album-grid .album-card'); await sleep(300);
      estado.lib = lib.map((t) => (t.title === primera ? { ...t, title: 'TITULO-CAMBIADO' } : t));
      await ir(o.p, 'Biblioteca'); await o.p.waitForSelector('.library-tracks .track-row');
      const llego = await o.p.waitForFunction(() => [...document.querySelectorAll('.library-tracks .track-row')].some((r) => r.textContent.includes('TITULO-CAMBIADO')), null, { timeout: 5000 }).then(() => true).catch(() => false);
      ok(`revalidacion_con_un_cambio_lo_muestra_${suf}`, llego && !o.errores.length, { titulo_original: primera, aparecio_el_nuevo: llego, errores: o.errores });
      await o.ctx.close();
    }
    // (g) Un servidor que ignora el offset.
    {
      const o = await abrir(BASE, '/albums', { w: 1440, h: 900, esperar: '.album-grid .album-card' });
      const estado = nuevoEstado(fabricar(7000)); estado.ignoraOffset = true; await servir(o.ctx, estado);
      await ir(o.p, 'Biblioteca'); await o.p.waitForSelector('.library-tracks .track-row', { timeout: 30000 }).catch(() => {}); await sleep(1500);
      const n = estado.pedidos.filter((x) => x.bib).length; const visto = await contador(o.p);
      // 1ª página: las primeras 5000. La 2ª pide 20000 desde 5000 y el "servidor" le devuelve las 7000
      // desde el principio: 2000 nuevas y menos de lo pedido → termina. Lo que importa: 2 pedidos y fin.
      ok('servidor_que_ignora_el_offset_no_cuelga', n === 2 && visto === 7000 && !o.errores.length, { pedidos: n, contador: visto, errores: o.errores });
      await o.ctx.close();
    }
  }
  if (REF && !REAL) {
    const o = await abrir(REF, '/', { w: 1440, h: 900 }); const estado = nuevoEstado(fabricar(GRANDE)); await servir(o.ctx, estado); await o.p.reload();
    await o.p.waitForSelector('.library-tracks .track-row', { timeout: 30000 }).catch(() => {}); await sleep(600);
    const visto = await contador(o.p);
    ok('control_ref_corta_en_10000', visto === 10000, { contador_en_la_ref: visto, pistas: GRANDE });
    await o.ctx.close();
  }
  if (REF && REAL) {
    const o = await abrir(REF, '/', { w: 1440, h: 900, esperar: '.library-tracks .track-row' }); await sleep(800);
    const visto = await contador(o.p);
    ok('control_ref_corta_en_10000', REALES.length > 10000 ? visto === 10000 : visto === REALES.length, { contador_en_la_ref: visto, pistas: REALES.length, nota: REALES.length > 10000 ? 'cortada' : 'con 10 000 pistas o menos la referencia no corta nada' });
    await o.ctx.close();
  }
} catch (e) {
  ok('sin_excepciones', false, { error: String(e.message).split('\n')[0].slice(0, 200) });
}

const fails = Object.entries(R).filter(([, v]) => !v.ok);
console.log(JSON.stringify(R, null, 1));
console.log('medidas: ' + JSON.stringify(medidas));
console.log(REF ? `referencia (un build con el tope de 10000): ${REF}` : 'SIN SNAP_REF: el control contra la referencia (control_ref_corta_en_10000) NO se corrió ni se cuenta.');
console.log(`\nlibrary-full-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
