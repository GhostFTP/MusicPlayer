// recientes-func.mjs — funcional del chip «Recién añadidas» de la BIBLIOTECA (1.41.0, sub-paso 1 de 2).
//
// «Recién» = las N=50 pistas de id más alto (AUTOINCREMENT) de la biblioteca completa. Sin fechas, sin
// backend. El conjunto esperado se calcula APARTE, desde GET /api/tracks (ids ordenados de mayor a
// menor, los 50 primeros): no se reusa el código de la vista ni utils/recientes.js para decidir qué es
// «reciente». La lista que se ve se lee de la COLA: tocar una fila hace play(listaVisible, i), así que
// la cola ES la lista visible, entera y en orden (en el DOM sólo hay las filas de la ventana).
//
// UNIDAD (utils/recientes.js, importado directo, sin navegador): el umbral es el id de la 50ª pista y el
// conjunto reciente coincide con el top 50 de un calculo independiente; con menos de 50 pistas cuentan
// todas; lista vacía → ninguna; empates (nunca menos de N); lo que no es un número se ignora; el filtro
// conserva el orden, no muta y devuelve un array nuevo. RECIENTES_UTIL=<ruta> prueba otra copia del
// módulo (así se hacen las mutaciones del control negativo).
//
// E2E, escritorio 1440: el chip está apagado por defecto; encendido muestra EXACTAMENTE el top 50 (cola,
// conteo «50 recientes» y filas del DOM); apagado devuelve la lista idéntica (mismo orden); con el
// orden (Título ↑ y ↓) el conjunto es el mismo y el orden se respeta; con la búsqueda se combina en AND
// (el conjunto es top50 ∩ coincidencias); estado vacío claro cuando no queda nada; el Mix mezcla sólo lo
// que se ve (50) y apagado toda la biblioteca; se reinicia al salir de la vista y volver, y al tocar la
// pestaña activa; no persiste (localStorage, sessionStorage ni URL sin cambios); Enter lo
// alternan sin perder el foco (Espacio NO: lo consume el atajo global de play/pausa, como en todos los botones
// de la app; se registra como dato y no cuenta); el riel de orden sigue con sus 5 segmentos.
// FILA DE ACCIONES (Mix · conteo · chip) a 390 (dedo), 700, 1024 y 1440, con el chip apagado y encendido:
// nada fuera de la pantalla ni scroll horizontal, nada se pisa, no choca con los FABs de Buscar, Ajustes
// y Novedades (sólo ≤700) y el riel queda debajo; el chip mide ≥44 de alto donde hay dedo o ≤700.
// A 390 el chip pasa a una segunda línea (Mix + conteo + chip no caben en 358 px; sin wrap el chip se
// salía de la pantalla). Un toque lo alterna.
//
// CONTROL NEGATIVO: correr este mismo script con SNAP_BASE apuntando a un build SIN el chip (p. ej. v1.40.1 en
// otro puerto): los escenarios E2E tienen que FALLAR ahí (la unidad prueba el módulo del árbol, no el build).
// Para probar la unidad contra una copia mutada del módulo: SOLO_UNIDAD=1 RECIENTES_UTIL=<ruta>.
// ⚠️ Reproduce pistas (la cola): correr contra la COPIA de la base. No escribe en la base.
// Uso: SNAP_BASE=http://localhost:4173 node recientes-func.mjs
import { preflight, BASE } from '../session.mjs';
import { preparar, sleep } from './tablet-util.mjs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const UTIL = process.env.RECIENTES_UTIL ?? resolve(HERE, '..', '..', '..', '..', 'music-client', 'src', 'utils', 'recientes.js');
const U = await import(pathToFileURL(UTIL).href);

const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? !!v : { ok: !!v, ...extra }; };
const seccion = async (claves, fn) => { try { await fn(); } catch (e) { for (const k of claves) if (!(k in R)) ok(k, false, { excepcion: String(e.message).split('\n')[0].slice(0, 160) }); } };
const mismoSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const igualesSeq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// ═══ UNIDAD: utils/recientes.js ═══
{
  // 680 ids únicos, desordenados y con huecos (como los de la base real), de un generador fijo.
  let s = 12345; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pool = new Set(); while (pool.size < 680) pool.add(1 + Math.floor(rnd() * 3300));
  const ids = [...pool];
  const top = (arr, n = 50) => [...arr].filter(Number.isFinite).sort((a, b) => b - a).slice(0, n);   // oráculo independiente
  const esperado = new Set(top(ids));
  const u = U.umbralRecientes(ids);
  const obtenido = new Set(ids.filter((id) => U.esReciente(id, u)));
  ok('u_umbral_es_el_id_de_la_50a_y_el_set_es_el_top50', mismoSet(esperado, obtenido) && obtenido.size === 50 && u === top(ids)[49], { umbral: u, esperado_50a: top(ids)[49], tamano: obtenido.size });
  const chicas = [7, 49, 50, 51].map((n) => { const a = ids.slice(0, n); const r = new Set(a.filter((id) => U.esReciente(id, U.umbralRecientes(a)))); return [n, r.size]; });
  ok('u_menos_de_50_pistas_cuentan_todas', chicas.every(([n, c]) => c === Math.min(n, 50)), { por_n: chicas });
  ok('u_lista_vacia_ninguna', U.umbralRecientes([]) === null && U.umbralDe([]) === null && U.umbralDe(undefined) === null && U.umbralDe(null) === null
    && U.esReciente(5, null) === false && U.filtrarRecientes([], null).length === 0 && U.filtrarRecientes([{ id: 3 }], null).length === 0 && U.filtrarRecientes(undefined, 1).length === 0);
  const e1 = U.umbralRecientes([1, 2, 3, 100, 100, 100, 99], 3), e2 = U.umbralRecientes([5, 5, 5, 5], 2), e3 = U.umbralRecientes([10, 9, 9, 9], 2);
  const cuenta = (arr, n) => { const t = U.umbralRecientes(arr, n); return arr.filter((id) => U.esReciente(id, t)).length; };
  ok('u_empates_nunca_menos_de_N', e1 === 100 && cuenta([1, 2, 3, 100, 100, 100, 99], 3) === 3 && e2 === 5 && cuenta([5, 5, 5, 5], 2) === 4 && e3 === 9 && cuenta([10, 9, 9, 9], 2) === 4, { e1, e2, e3 });
  const raros = [NaN, null, undefined, '7', Infinity, -Infinity, 4, 5, {}];
  ok('u_ignora_lo_que_no_es_un_numero_finito', U.umbralRecientes(raros) === 4 && U.umbralRecientes([NaN, null, 'x']) === null && U.esReciente('7', 4) === false && U.esReciente(undefined, 4) === false, { umbral: U.umbralRecientes(raros) });
  const d10 = [3, 9, 1, 8, 2, 7, 6, 10, 4, 5];
  ok('u_n_configurable', U.umbralRecientes(d10, 3) === 8 && U.umbralRecientes(d10, 1) === 10 && U.umbralRecientes(d10, 10) === 1 && U.umbralRecientes(d10, 0) === null && U.umbralRecientes(d10, 100) === 1 && U.N_RECIENTES === 50);
  const items = [{ id: 4, t: 'a' }, { id: 9, t: 'e' }, { id: 7, t: 'c' }, { id: 20, t: 'b' }, { id: 15, t: 'd' }];   // los recientes (9, 20, 15) NO vienen en orden de id
  const copia = JSON.stringify(items); const um = U.umbralDe(items, 3); const f = U.filtrarRecientes(items, um);
  const custom = U.umbralDe([{ k: 1 }, { k: 8 }, { k: 5 }], 2, (x) => x.k);
  ok('u_filtro_conserva_el_orden_no_muta_y_devuelve_array_nuevo', um === 9 && igualesSeq(f.map((x) => x.t), ['e', 'b', 'd']) && f !== items && JSON.stringify(items) === copia && custom === 5, { umbral: um, filtradas: f.map((x) => x.t) });
}

// SOLO_UNIDAD=1: sólo lo de arriba (sin navegador ni servidor). Sirve para las mutaciones de RECIENTES_UTIL.
if (process.env.SOLO_UNIDAD) {
  const fu = Object.entries(R).filter(([, x]) => (typeof x === 'object' ? !x.ok : !x));
  console.log(JSON.stringify(R, null, 1));
  console.log(`
recientes-func (sólo unidad): ${Object.keys(R).length - fu.length}/${Object.keys(R).length}`);
  process.exit(fu.length ? 1 : 0);
}

// ═══ E2E ═══
await preflight();
const { token, browser, abrir } = await preparar();
const H = { Authorization: `Bearer ${token}` };
const tracks = await (await fetch(BASE + '/api/tracks?limit=100000', { headers: H })).json();
const TOTAL = tracks.length;
const byId = new Map(tracks.map((t) => [t.id, t]));
const TOP = [...tracks].map((t) => t.id).sort((a, b) => b - a).slice(0, 50);   // oráculo: los 50 ids más altos
const TOPSET = new Set(TOP);
const fold = (x) => (x ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const coincide = (t, q) => fold(`${t.title ?? ''}\n${t.artist ?? ''}\n${t.album ?? ''}`).includes(fold(q.trim()));
// Consultas elegidas desde los datos: una que coincide con recientes Y con viejas (para probar el AND) y otra que sólo coincide con viejas.
const palabras = new Set(); for (const t of tracks) for (const w of `${t.artist ?? ''} ${t.album ?? ''}`.split(/[^\p{L}\p{N}]+/u)) if (w.length >= 4) palabras.add(w);
const stats = [...palabras].map((w) => ({ w, todas: tracks.filter((t) => coincide(t, w)).length, rec: tracks.filter((t) => TOPSET.has(t.id) && coincide(t, w)).length }));
const MIXTA = stats.filter((s) => s.rec > 0 && s.todas > s.rec).sort((a, b) => a.todas - b.todas)[0] ?? null;
const SOLO_VIEJA = stats.filter((s) => s.rec === 0 && s.todas > 0).sort((a, b) => b.todas - a.todas)[0] ?? null;

const open = (w = 1440, h = 900, tactil = false) => abrir(BASE, '/', { w, h, tactil, esperar: '.library-tracks .track-row' });
const chipSel = '.library-actions .recientes-chip';
const estado = (p) => p.evaluate(() => {
  const chip = document.querySelector('.library-actions .recientes-chip');
  return { chip: !!chip, pressed: chip?.getAttribute('aria-pressed') ?? null, texto: chip?.textContent.trim() ?? null,
    label: document.querySelector('.library-count')?.getAttribute('aria-label') ?? null,
    vacio: document.querySelector('.empty-state')?.innerText.replace(/\s+/g, ' ').trim() ?? null,
    mixDeshabilitado: !!document.querySelector('.library-actions .mix-btn')?.disabled,
    riel: [...document.querySelectorAll('.pl-sortbar .pl-sort-label')].map((e) => e.textContent.trim()),
    titulos: [...document.querySelectorAll('.library-tracks .track-row .track-title')].map((e) => e.textContent.trim()),
    url: location.pathname + location.search };
});
const cola = (p) => p.evaluate(() => (window.__player()?.queue ?? []).map((t) => t.id));
// La lista visible = la cola tras tocar la primera fila.
async function verLista(o) {
  await o.tocar(o.p.locator('.library-tracks .track-row').first());
  await o.p.waitForFunction(() => (window.__player()?.queue?.length ?? 0) > 0, null, { timeout: 5000 });
  await sleep(500);
  return cola(o.p);
}
const clickChip = async (o) => { await o.p.locator(chipSel).click(); await sleep(700); };
const buscar = async (o, q) => { await o.p.locator('.search-box input').first().fill(q); await sleep(800); };
const coll = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

await seccion(['chip_apagado_por_defecto', 'encendido_muestra_exactamente_el_top50', 'apagado_restaura_la_lista_identica', 'riel_de_orden_intacto'], async () => {
  const o = await open();
  const e0 = await estado(o.p);
  const orden0 = await verLista(o);
  ok('chip_apagado_por_defecto', e0.chip && e0.pressed === 'false' && e0.texto === 'Recién añadidas' && e0.label === `${TOTAL} canciones` && orden0.length === TOTAL, { estado: e0, cola: orden0.length, esperado: TOTAL });
  await clickChip(o);
  const e1 = await estado(o.p); const ids1 = await verLista(o); const e1b = await estado(o.p);
  ok('encendido_muestra_exactamente_el_top50', e1.pressed === 'true' && e1.label === '50 recientes' && ids1.length === 50 && mismoSet(new Set(ids1), TOPSET)
    && e1b.titulos.length > 0 && e1b.titulos.every((t) => TOP.some((id) => byId.get(id).title?.trim() === t)),
  { label: e1.label, cola: ids1.length, fuera_del_top: ids1.filter((id) => !TOPSET.has(id)).length, faltan: TOP.filter((id) => !ids1.includes(id)).length, filas_dom: e1b.titulos.length });
  ok('riel_de_orden_intacto', igualesSeq(e0.riel, ['Título', 'Artista', 'Álbum', 'Año', 'Duración']) && igualesSeq(e1.riel, e0.riel), { apagado: e0.riel, encendido: e1.riel });
  await clickChip(o);
  const e2 = await estado(o.p); const orden2 = await verLista(o);
  ok('apagado_restaura_la_lista_identica', e2.pressed === 'false' && e2.label === `${TOTAL} canciones` && igualesSeq(orden0, orden2), { total: orden2.length, mismo_orden: igualesSeq(orden0, orden2) });
  await o.ctx.close();
});

await seccion(['orden_titulo_ascendente_con_el_chip', 'orden_titulo_descendente_con_el_chip'], async () => {
  const o = await open();
  await clickChip(o);
  const seg = o.p.locator('.pl-sortbar button', { hasText: 'Título' });
  await seg.click(); await sleep(500);
  const asc = await verLista(o); const tAsc = asc.map((id) => byId.get(id).title ?? '');
  ok('orden_titulo_ascendente_con_el_chip', mismoSet(new Set(asc), TOPSET) && asc.length === 50 && tAsc.every((t, i) => i === 0 || coll.compare(tAsc[i - 1], t) <= 0), { n: asc.length, primeros: tAsc.slice(0, 3) });
  await seg.click(); await sleep(500);
  const desc = await verLista(o); const tDesc = desc.map((id) => byId.get(id).title ?? '');
  ok('orden_titulo_descendente_con_el_chip', mismoSet(new Set(desc), TOPSET) && desc.length === 50 && tDesc.every((t, i) => i === 0 || coll.compare(tDesc[i - 1], t) >= 0), { n: desc.length, primeros: tDesc.slice(0, 3) });
  await o.ctx.close();
});

await seccion(['busqueda_y_chip_en_AND', 'estado_vacio_claro_sin_resultados_entre_recientes'], async () => {
  if (!MIXTA || !SOLO_VIEJA) throw new Error('la biblioteca no tiene una consulta mixta y otra sólo de viejas para armar el caso');
  const o = await open();
  await clickChip(o);
  await buscar(o, MIXTA.w);
  const esp = new Set(TOP.filter((id) => coincide(byId.get(id), MIXTA.w)));
  const ids = await verLista(o); const e = await estado(o.p);
  const palabra = esp.size === 1 ? 'resultado' : 'resultados';
  ok('busqueda_y_chip_en_AND', esp.size > 0 && esp.size < MIXTA.todas && mismoSet(new Set(ids), esp) && ids.length === esp.size && e.label === `${esp.size} ${palabra}`,
    { consulta: MIXTA.w, esperado_con_chip: esp.size, sin_chip_serian: MIXTA.todas, obtenido: ids.length, label: e.label });
  await buscar(o, SOLO_VIEJA.w);
  const ev = await estado(o.p);
  ok('estado_vacio_claro_sin_resultados_entre_recientes', ev.vacio?.includes('Sin resultados') && ev.vacio.includes('recién añadidas') && ev.vacio.includes('Apaga «Recién añadidas»') && ev.chip && ev.pressed === 'true' && ev.mixDeshabilitado && ev.riel.length === 0,
    { consulta: SOLO_VIEJA.w, coinciden_en_toda_la_biblioteca: SOLO_VIEJA.todas, estado: ev });
  await o.ctx.close();
});

await seccion(['mix_respeta_el_set_de_recientes', 'mix_apagado_usa_toda_la_biblioteca'], async () => {
  const o = await open();
  await clickChip(o);
  await o.p.locator('.library-actions .mix-btn').click();
  await o.p.waitForFunction(() => (window.__player()?.queue?.length ?? 0) > 1, null, { timeout: 6000 }); await sleep(600);
  const q = await cola(o.p);
  ok('mix_respeta_el_set_de_recientes', q.length === 50 && mismoSet(new Set(q), TOPSET), { cola: q.length, fuera_del_top: q.filter((id) => !TOPSET.has(id)).length });
  await clickChip(o);
  await o.p.locator('.library-actions .mix-btn').click(); await sleep(1500);
  const q2 = await cola(o.p);
  ok('mix_apagado_usa_toda_la_biblioteca', q2.length === TOTAL, { cola: q2.length, esperado: TOTAL });
  await o.ctx.close();
});

await seccion(['se_reinicia_al_salir_y_volver', 'tocar_la_pestana_activa_lo_apaga', 'no_persiste_ni_va_en_la_url', 'teclado_enter_alterna_y_conserva_el_foco'], async () => {
  const o = await open();
  const nav = (t) => o.p.locator('.sidebar-nav button', { hasText: t });
  const snap = () => o.p.evaluate(() => JSON.stringify([Object.entries(localStorage).filter(([k]) => k !== 'token').sort(), Object.entries(sessionStorage).sort(), location.href]));
  const antes = await snap();
  await clickChip(o); await buscar(o, 'a');
  const durante = await snap();
  ok('no_persiste_ni_va_en_la_url', antes === durante && !(await o.p.evaluate(() => location.search)), { igual: antes === durante });
  await buscar(o, '');
  await nav('Álbumes').click(); await o.p.waitForSelector('.album-grid .album-card', { timeout: 8000 }); await sleep(400);
  await nav('Biblioteca').click(); await o.p.waitForSelector('.library-tracks .track-row', { timeout: 8000 }); await sleep(600);
  const e1 = await estado(o.p);
  ok('se_reinicia_al_salir_y_volver', e1.chip && e1.pressed === 'false' && e1.label === `${TOTAL} canciones`, { estado: e1 });
  await clickChip(o);
  await nav('Biblioteca').click(); await sleep(700);
  const e2 = await estado(o.p);
  ok('tocar_la_pestana_activa_lo_apaga', e2.pressed === 'false' && e2.label === `${TOTAL} canciones`, { estado: e2 });
  const chip = o.p.locator(chipSel);
  await chip.focus(); await o.p.keyboard.press('Enter'); await sleep(500);
  const k1 = (await estado(o.p)).pressed; const f1 = await o.p.evaluate(() => document.activeElement?.classList.contains('recientes-chip'));
  await o.p.keyboard.press('Enter'); await sleep(500);
  const k2 = (await estado(o.p)).pressed; const f2 = await o.p.evaluate(() => document.activeElement?.classList.contains('recientes-chip'));
  // Espacio: INFORMATIVO, no cuenta. El atajo global de play/pausa (PlayerContext.jsx:253) lo consume en cualquier
  // foco que no sea un <input> (preventDefault), así que Espacio no activa NINGÚN botón de la app, tampoco éste.
  const sonaba = () => o.p.evaluate(() => !!window.__player()?.isPlaying);
  const antesEsp = await sonaba(); await o.p.keyboard.press('Space'); await sleep(500);
  const espacio = { chip_tras_espacio: (await estado(o.p)).pressed, reproduccion: [antesEsp, await sonaba()] };
  ok('teclado_enter_alterna_y_conserva_el_foco', k1 === 'true' && k2 === 'false' && f1 && f2, { tras_enter_1: k1, tras_enter_2: k2, foco: [f1, f2], informativo_espacio: espacio });
  await o.ctx.close();
});

// ═══ La fila de acciones, a 390 (dedo), 700, 1024 y 1440 ═══
const medirFila = (p) => p.evaluate(() => {
  const r1 = (n) => Math.round(n * 10) / 10;
  const caja = (e) => { if (!e) return null; if (getComputedStyle(e).display === 'none') return null; const b = e.getBoundingClientRect(); return b.width ? { x: r1(b.left), y: r1(b.top), w: r1(b.width), h: r1(b.height), r: r1(b.right), b: r1(b.bottom) } : null; };
  const fila = document.querySelector('.library-actions');
  return { innerW: innerWidth, scrollW: document.documentElement.scrollWidth, fila: caja(fila), wrap: getComputedStyle(fila).flexWrap,
    mix: caja(fila.querySelector('.mix-btn')), conteo: caja(fila.querySelector('.library-count')), chip: caja(fila.querySelector('.recientes-chip')),
    fabs: ['.search-fab', '.settings-fab', '.changelog-bell'].map((s) => caja(document.querySelector(s))).filter(Boolean), riel: caja(document.querySelector('.pl-sortbar')) };
});
const pisa = (a, b) => a.x < b.r - 0.5 && b.x < a.r - 0.5 && a.y < b.b - 0.5 && b.y < a.b - 0.5;
for (const [w, h, tactil] of [[390, 844, true], [700, 900, false], [1024, 768, false], [1440, 900, false]]) {
  await seccion([`fila_sin_desborde_ni_solape_${w}`, ...(w === 390 ? ['tactil_390_un_toque_alterna'] : [])], async () => {
    const o = await open(w, h, tactil); await sleep(400);
    const cajas = {};
    for (const estadoChip of ['apagado', 'encendido']) {
      if (estadoChip === 'encendido') { await (tactil ? o.tocar(o.p.locator(chipSel)) : o.p.locator(chipSel).click()); await sleep(800); }
      cajas[estadoChip] = await medirFila(o.p);
    }
    const problemas = [];
    for (const [nombre, m] of Object.entries(cajas)) {
      const items = [['mix', m.mix], ['conteo', m.conteo], ['chip', m.chip]];
      if (items.some(([, c]) => !c)) { problemas.push(`${nombre}: falta un elemento de la fila`); continue; }
      if (m.scrollW > m.innerW) problemas.push(`${nombre}: scroll horizontal ${m.scrollW} > ${m.innerW}`);
      for (const [n, c] of items) if (c.x < 0 || c.r > m.innerW + 0.5) problemas.push(`${nombre}: ${n} fuera de la pantalla (x ${c.x}, r ${c.r})`);
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (pisa(items[i][1], items[j][1])) problemas.push(`${nombre}: ${items[i][0]} pisa a ${items[j][0]}`);
      for (const [n, c] of items) for (const f of m.fabs) if (pisa(c, f)) problemas.push(`${nombre}: ${n} pisa un FAB`);
      if (m.riel && m.riel.y < m.fila.b - 0.5) problemas.push(`${nombre}: el riel queda dentro de la fila`);
      const minAlto = tactil || w <= 700 ? 44 : 40;
      if (m.chip.h < minAlto) problemas.push(`${nombre}: el chip mide ${m.chip.h} de alto (<${minAlto})`);
    }
    const mm = cajas.apagado;
    ok(`fila_sin_desborde_ni_solape_${w}`, problemas.length === 0, { problemas, fabs_visibles: mm.fabs.length, linea_del_chip: mm.chip && mm.conteo ? (mm.chip.y > mm.conteo.b - 1 ? 'segunda' : 'misma') : null,
      cajas: { mix: mm.mix && [mm.mix.x, mm.mix.y, mm.mix.w, mm.mix.h], conteo: mm.conteo && [mm.conteo.x, mm.conteo.y, mm.conteo.w, mm.conteo.h], chip: mm.chip && [mm.chip.x, mm.chip.y, mm.chip.w, mm.chip.h], fila_alto: mm.fila?.h, riel_y: mm.riel?.y } });
    if (w === 390) {
      const e = await estado(o.p);   // quedó encendido por el bucle: un toque lo apaga y otro lo enciende
      await o.tocar(o.p.locator(chipSel)); await sleep(600); const off = (await estado(o.p)).pressed;
      await o.tocar(o.p.locator(chipSel)); await sleep(600); const on = await estado(o.p);
      ok('tactil_390_un_toque_alterna', e.pressed === 'true' && off === 'false' && on.pressed === 'true' && on.label === '50 recientes', { inicial: e.pressed, tras_toque_1: off, tras_toque_2: on.pressed, label: on.label });
    }
    await o.ctx.close();
  });
}

const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
console.log(`casos: ${TOTAL} pistas · top 50 por id (de ${Math.min(...TOP)} a ${Math.max(...TOP)}) · consulta mixta «${MIXTA?.w}» (${MIXTA?.rec} recientes de ${MIXTA?.todas}) · sólo viejas «${SOLO_VIEJA?.w}» (${SOLO_VIEJA?.todas})`);
console.log(`\nrecientes-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
