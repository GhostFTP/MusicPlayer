// search-changelog-func.mjs — funcional del BUSCADOR de Novedades (Changelog.jsx).
//
// Lo esperado NO está escrito a mano: el script pide el mismo GET /api/changelog que la vista, lo
// parsea por su cuenta con las mismas reglas (## versión, ### sección, - punto, líneas de
// continuación) y calcula qué puntos tienen que quedar para cada búsqueda. Así sigue valiendo cuando
// el CHANGELOG crece. La regla: un punto queda si la búsqueda (sin mayúsculas ni acentos) está en su
// texto SIN `**` ni backticks, o en "v<versión>" o en la fecha de su entrada.
//
// Comprueba, a 1440:
//   · sin buscar se ve todo, y el campo está en la cabecera junto al título;
//   · por palabra de un punto: quedan sólo los puntos que la tienen, con su versión y su sección; las
//     secciones y versiones sin puntos visibles no están;
//   · por versión («1.28») y por fecha («2026-09»): salen esas entradas COMPLETAS;
//   · con acento, sin acento y en mayúsculas da lo mismo;
//   · un texto que cruza el borde de una **negrita**, uno dentro de `código` con <trackId> y la URL de
//     un link markdown coinciden, y el <trackId> se pinta como texto (no como etiqueta);
//   · sin resultados: «Sin resultados para «…»», con el título y el campo todavía arriba;
//   · limpiar con la ✕ y con Esc devuelve todo;
//   · tocar «Novedades» estando en Novedades borra la búsqueda.
// A 360, 390 y 430 con touch: el campo no se pisa con el engrane ni con la campana flotantes, no se
// sale de la pantalla, la página no desborda y escribir filtra. Los números van en `medidas`.
// Con SNAP_REF (el build de main en otro puerto): en main no hay buscador y, sin buscar, la rama pinta
// lo mismo que main. Sin SNAP_REF esas dos NO se corren ni se cuentan, y se avisa.
// Sólo lee: no escribe nada en la base.
// Uso: SNAP_BASE=http://localhost:4173 [SNAP_REF=http://localhost:4174] node search-changelog-func.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';

const REF = process.env.SNAP_REF ?? null;
await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();

// ── Lo esperado, calculado del markdown ──
const md = (await (await fetch(BASE + '/api/changelog', { headers: { Authorization: `Bearer ${token}` } })).json()).content ?? '';
function parse(texto) {
  const versiones = []; let cur = null, sec = null;
  for (const raw of texto.split('\n')) {
    const line = raw.trimEnd(); let m;
    if ((m = line.match(/^##\s+\[([^\]]+)\]\s*-\s*(.+)$/))) { cur = { version: m[1].trim(), date: m[2].trim(), sections: [] }; versiones.push(cur); sec = null; }
    else if (line.startsWith('## ')) { cur = { version: line.slice(3).replace(/[[\]]/g, '').trim(), date: '', sections: [] }; versiones.push(cur); sec = null; }
    else if (line.startsWith('### ')) { if (!cur) continue; sec = { title: line.slice(4).trim(), items: [] }; cur.sections.push(sec); }
    else if (line.startsWith('- ')) { if (sec) sec.items.push(line.slice(2).trim()); }
    else if (line.trim() && sec && sec.items.length) sec.items[sec.items.length - 1] += ' ' + line.trim();
  }
  return versiones;
}
const fold = (s) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const plano = (s) => s.replace(/\*\*|`/g, '');
const VERS = parse(md);
const badge = (v) => `v${v.version.replace(/^v/i, '')}`;
// Lo que tiene que verse para `q`: [{ badge, secciones: [{ titulo, n }] }]
function esperado(q) {
  const f = fold(q.trim());
  return VERS.map((v) => ({
    badge: badge(v),
    secciones: v.sections.map((s) => ({ titulo: s.title, n: s.items.filter((it) => !f || fold(`${plano(it)}\n${badge(v)}\n${v.date}`).includes(f)).length })).filter((s) => s.n),
  })).filter((v) => v.secciones.length);
}
const nPuntos = (lista) => lista.reduce((a, v) => a + v.secciones.reduce((b, s) => b + s.n, 0), 0);
const TODO = esperado('');

const R = {};
const ok = (k, v, extra = {}) => { R[k] = { ok: !!v, ...extra }; };
const medidas = { entradas: VERS.length, puntos: nPuntos(TODO) };
const INPUT = '.changelog .section-header .sbx input';

async function abrir(base, w, h, mobile) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript((t) => localStorage.setItem('token', t), token);
  const p = await ctx.newPage();
  const errores = []; p.on('pageerror', (e) => errores.push(String(e.message).slice(0, 140)));
  await p.goto(base + '/changelog');
  await p.waitForSelector('.cl-version');
  return { ctx, p, errores };
}
// Lo que se ve: mismas formas que `esperado`, más los textos de los puntos.
const visto = (p) => p.evaluate(() => [...document.querySelectorAll('.changelog .cl-version')].map((v) => ({
  badge: v.querySelector('.cl-badge')?.textContent.trim(),
  secciones: [...v.querySelectorAll('.cl-section')].map((s) => ({ titulo: s.querySelector('.cl-section-title')?.textContent.trim(), n: s.querySelectorAll('.cl-list > li').length })),
  textos: [...v.querySelectorAll('.cl-list > li')].map((li) => li.textContent),
})));
const forma = (lista) => JSON.stringify(lista.map((v) => ({ badge: v.badge, secciones: v.secciones })));
// Sin campo (el build de main) no se escribe nada y se devuelve lo que hay: las comprobaciones de
// búsqueda FALLAN una por una, en vez de cortarse el script con un timeout.
const hayCampo = (p) => p.locator(INPUT).count().then((n) => n > 0);
const valor = (p) => p.locator(INPUT).inputValue({ timeout: 1000 }).catch(() => null);
const buscar = async (p, q) => { if (await hayCampo(p)) { await p.locator(INPUT).fill(q); await p.waitForTimeout(350); } return visto(p); };
const resumen = (lista) => ({ versiones: lista.length, puntos: nPuntos(lista) });

// ── Escritorio 1440 ──
{
  const { ctx, p, errores } = await abrir(BASE, 1440, 900, false);
  const v0 = await visto(p);
  const cab = await p.evaluate((sel) => { const i = document.querySelector(sel); return { hay: !!i, enCabecera: !!i?.closest('.section-header')?.querySelector('.section-title'), placeholder: i?.placeholder, label: i?.getAttribute('aria-label'), valor: i?.value }; }, INPUT);
  ok('sin_buscar_se_ve_todo', forma(v0) === forma(TODO) && cab.hay && cab.enCabecera && cab.valor === '' && cab.label === 'Buscar en novedades', { visto: resumen(v0), esperado: resumen(TODO), campo: cab });

  // Por palabra de un punto.
  const Q = 'corazón';
  const e1 = esperado(Q); const v1 = await buscar(p, Q);
  const todosLaTienen = v1.every((v) => v.textos.every((t) => fold(t).includes(fold(Q))));
  ok('por_palabra_solo_los_puntos_que_coinciden', forma(v1) === forma(e1) && e1.length > 0 && nPuntos(e1) < nPuntos(TODO) && todosLaTienen, { busqueda: Q, visto: resumen(v1), esperado: resumen(e1) });
  // Alguna versión quedó con menos secciones o menos puntos que los que tiene: el recorte es por punto.
  const recortada = e1.find((v) => { const t = TODO.find((x) => x.badge === v.badge); return nPuntos([v]) < nPuntos([t]); });
  const secFuera = e1.some((v) => v.secciones.length < TODO.find((x) => x.badge === v.badge).secciones.length);
  ok('seccion_y_version_sin_puntos_no_se_muestran', !!recortada && secFuera && v1.every((v) => v.secciones.length > 0 && v.secciones.every((s) => s.n > 0)) && v1.length < TODO.length,
    { ejemplo: recortada && { version: recortada.badge, quedan: nPuntos([recortada]), de: nPuntos([TODO.find((x) => x.badge === recortada.badge)]) }, versiones: `${v1.length} de ${TODO.length}` });

  // Acentos y mayúsculas.
  const v1b = await buscar(p, 'corazon'); const v1c = await buscar(p, '  CORAZÓN ');
  ok('acentos_y_mayusculas_dan_lo_mismo', forma(v1b) === forma(e1) && forma(v1c) === forma(e1), { sin_acento: resumen(v1b), mayusculas_y_espacios: resumen(v1c) });

  // Por versión y por fecha: la entrada completa.
  const ev = esperado('1.28'); const vv = await buscar(p, '1.28');
  const completas = (lista) => lista.every((v) => forma([v]) === forma([TODO.find((x) => x.badge === v.badge)]));
  ok('por_version_la_entrada_completa', forma(vv) === forma(ev) && vv.some((v) => v.badge === 'v1.28.0') && completas(vv.filter((v) => v.badge.startsWith('v1.28'))), { visto: vv.map((v) => v.badge), puntos: nPuntos(vv) });
  const ef = esperado('2026-09'); const vf = await buscar(p, '2026-09');
  const deSep = VERS.filter((v) => v.date.includes('2026-09')).map(badge);
  ok('por_fecha_las_entradas_completas', forma(vf) === forma(ef) && deSep.length > 0 && deSep.every((b) => vf.some((v) => v.badge === b)) && completas(vf.filter((v) => deSep.includes(v.badge))), { entradas_de_2026_09: deSep.length, visto: vf.length });

  // Formato: negrita, código con <trackId>, link markdown.
  const conNegrita = VERS.flatMap((v) => v.sections.flatMap((s) => s.items)).map((it) => it.match(/([^\s*`]+)\*\* ([^\s*`]+ [^\s*`]+)/)).find(Boolean);
  const cruza = conNegrita ? `${conNegrita[1]} ${conNegrita[2]}` : null;   // p. ej. "vistas. Álbumes, Artistas": cruza el cierre de la negrita
  const vn = cruza ? await buscar(p, cruza) : [];
  ok('texto_que_cruza_una_negrita', !!cruza && nPuntos(vn) >= 1 && forma(vn) === forma(esperado(cruza)), { busqueda: cruza, visto: resumen(vn) });
  const vc = await buscar(p, 'lyricsHidden:<trackId>');
  const codigo = await p.evaluate(() => { const li = document.querySelector('.cl-list > li'); return { code: [...(li?.querySelectorAll('code') ?? [])].map((c) => c.textContent), etiquetaRara: !!li?.querySelector('trackid') }; });
  ok('codigo_con_trackid', nPuntos(vc) === 1 && forma(vc) === forma(esperado('lyricsHidden:<trackId>')) && codigo.code.includes('lyricsHidden:<trackId>') && !codigo.etiquetaRara, { visto: resumen(vc), ...codigo });
  const vl = await buscar(p, 'lrclib.net');
  ok('link_markdown', nPuntos(vl) >= 1 && forma(vl) === forma(esperado('lrclib.net')) && vl.every((v) => v.textos.every((t) => t.includes('lrclib.net'))) && (await p.locator('.cl-list a').count()) === 0, { visto: resumen(vl), texto: vl[0]?.textos[0]?.slice(0, 90) });

  // Sin resultados.
  const v0r = await buscar(p, 'zzzzqq');
  const vacio = await p.evaluate((sel) => ({ cartel: document.querySelector('.changelog .empty-state .empty-title')?.textContent ?? null, titulo: document.querySelector('.changelog .section-title')?.textContent, campo: document.querySelector(sel)?.value }), INPUT);
  ok('sin_resultados', v0r.length === 0 && vacio.cartel === 'Sin resultados para «zzzzqq»' && vacio.titulo === 'Novedades' && vacio.campo === 'zzzzqq', vacio);

  // Limpiar: con la ✕ y con Esc.
  await p.locator('.changelog .sbx-clear').click({ timeout: 1500 }).catch(() => {}); await p.waitForTimeout(350);
  const tras = await visto(p); const valX = await valor(p);
  await buscar(p, 'corazon'); if (await hayCampo(p)) await p.locator(INPUT).press('Escape'); await p.waitForTimeout(350);
  const trasEsc = await visto(p); const valEsc = await valor(p);
  ok('limpiar_devuelve_todo', valX === '' && forma(tras) === forma(TODO) && valEsc === '' && forma(trasEsc) === forma(TODO), { con_x: resumen(tras), con_esc: resumen(trasEsc) });

  // Tocar «Novedades» estando en Novedades borra la búsqueda.
  await buscar(p, 'corazon');
  await p.locator('.sidebar').getByText('Novedades', { exact: true }).first().click(); await p.waitForTimeout(450);
  const trasTab = await visto(p);
  ok('retocar_la_pestana_borra_la_busqueda', (await valor(p)) === '' && forma(trasTab) === forma(TODO) && new URL(p.url()).pathname === '/changelog', { visto: resumen(trasTab) });
  ok('sin_errores_de_pagina', errores.length === 0, { errores });
  await ctx.close();
}

// ── Teléfono: 360, 390, 430 ──
for (const w of [360, 390, 430]) {
  const { ctx, p, errores } = await abrir(BASE, w, 844, true);
  const g = await p.evaluate(() => {
    const r = (sel) => { const e = document.querySelector(sel); if (!e || !e.offsetParent && getComputedStyle(e).position !== 'fixed') return null; const b = e.getBoundingClientRect(); return b.width ? { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) } : null; };
    const choca = (a, b) => !!a && !!b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    const caja = r('.changelog .section-header .sbx'), titulo = r('.changelog .section-title'), fab = r('.settings-fab'), campana = r('.changelog-bell');
    return { caja, titulo, engrane: fab, campana, chocaEngrane: choca(caja, fab), chocaCampana: choca(caja, campana), tituloChocaEngrane: choca(titulo, fab),
      separacion_caja_engrane_px: caja && fab ? caja.t - fab.b : null, desbordePagina: document.documentElement.scrollWidth - innerWidth, vw: innerWidth };
  });
  medidas[`telefono_${w}`] = g;
  ok(`movil_sin_solape_${w}`, !!g.caja && !g.chocaEngrane && !g.chocaCampana && g.caja.l >= 0 && g.caja.r <= g.vw && g.desbordePagina <= 0 && g.caja.h >= 36,
    { caja: g.caja && `${g.caja.w}×${g.caja.h} en y ${g.caja.t}–${g.caja.b}`, engrane: g.engrane && `y ${g.engrane.t}–${g.engrane.b}, x ${g.engrane.l}–${g.engrane.r}`, campana: g.campana ? 'visible' : 'no está en esta vista', separacion_px: g.separacion_caja_engrane_px, desbordePagina: g.desbordePagina });
  if (await hayCampo(p)) await p.locator(INPUT).tap();
  const vm = await buscar(p, 'corazon');
  ok(`movil_escribir_filtra_${w}`, await hayCampo(p) && forma(vm) === forma(esperado('corazon')) && !errores.length, { visto: resumen(vm) });
  await ctx.close();
}

// ── Contra main: no hay buscador, y sin buscar se pinta lo mismo ──
if (REF) {
  const { ctx, p } = await abrir(REF, 1440, 900, false);
  const vr = await visto(p); const hay = await p.locator('.changelog .sbx').count();
  const { ctx: c2, p: p2 } = await abrir(BASE, 1440, 900, false);
  const vb = await visto(p2);
  ok('control_main_sin_buscador', hay === 0, { buscadores_en_main: hay });
  ok('sin_buscar_igual_a_main', JSON.stringify(vr) === JSON.stringify(vb) && vr.length === TODO.length, { main: resumen(vr), rama: resumen(vb) });
  await ctx.close(); await c2.close();
}

const fails = Object.entries(R).filter(([, v]) => !v.ok);
console.log(JSON.stringify(R, null, 1));
console.log('medidas: ' + JSON.stringify(medidas));
console.log(REF ? `referencia (main): ${REF}` : 'SIN SNAP_REF: las comprobaciones contra main (control_main_sin_buscador, sin_buscar_igual_a_main) NO se corrieron ni se cuentan.');
console.log(`\nsearch-changelog-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
