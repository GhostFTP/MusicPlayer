// video-mix-func.mjs — funcional del «Mix aleatorio» de la vista VIDEOS (el ShuffleButton de las demás
// vistas, con tracks = lo que se ve y noun="videos").
//
// Necesita más de tres videos: suma a la carpeta de fixtures de la corrida los cuatro EXTRAS de
// video-fixtures.mjs (mismo método, con ffmpeg) y los BORRA al terminar, esperando a que el backend
// vuelva a ver sólo los tres de siempre. Por eso pide VIDEO_DIR (la carpeta que se le pasó al backend;
// regresion.mjs la pasa sola) y se NIEGA a escribir si esa carpeta no es la de los fixtures: nunca
// toca una carpeta de videos de verdad.
//
// Comprueba, a 1440:
//   · el botón está en .view-actions junto al contador, con su nombre («Mix aleatorio») y el tooltip
//     de videos; con 1 y con 0 resultados del buscador queda deshabilitado y lo explica (con 0, igual
//     que el de Álbumes);
//   · al tocarlo la cola es EXACTAMENTE lo que se ve (mismo conjunto, todos kind:'video'), suena uno
//     de ellos, el aleatorio del reproductor queda encendido y nunca suenan dos elementos a la vez; en
//     5 intentos el orden difiere al menos una vez del de la lista;
//   · con el buscador puesto la cola son sólo los filtrados;
//   · la cola entera con «siguiente» (y una vez dejando terminar el video): ninguno se repite; con
//     repetir apagado, al terminar el último se detiene; con «repetir todo» arranca otro ciclo que no
//     empieza por el último que sonó ni repite hasta agotarse;
//   · «anterior» vuelve al que sonó antes;
//   · en pantalla completa «siguiente» avanza y sigue en pantalla completa;
//   · teclado: el botón toma foco, Enter lo activa y el foco se queda en él.
// A 360, 390 y 430 con touch: la fila de acciones no desborda ni se pisa, el tap arma la cola y no
// abre el expandido, ni un menú, ni cambia de ruta.
// Con SNAP_REF (el build de main en otro puerto): control negativo, en main el botón no existe. Sin
// SNAP_REF ese control NO se corre ni se cuenta, y se avisa.
// Uso: VIDEO_DIR=<fixtures del backend> SNAP_BASE=http://localhost:4173 [SNAP_REF=http://localhost:4174] node video-mix-func.mjs
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { FIXTURES, EXTRAS, crearExtras, borrarExtras, SinFfmpeg } from './video-fixtures.mjs';

const REF = process.env.SNAP_REF ?? null;
const NOMBRE = 'video-mix-func';
const noCorrio = (msg) => { console.error(`[${NOMBRE}] NO CORRIÓ: ${msg}`); process.exit(2); };

// La carpeta tiene que ser la de los fixtures: sólo sus artistas (o los extras de una corrida cortada).
const DIR = process.env.VIDEO_DIR ? resolve(process.env.VIDEO_DIR) : null;
if (!DIR || !existsSync(DIR)) noCorrio('falta VIDEO_DIR (la carpeta de fixtures que usa el backend de la prueba)');
const ARTISTAS_FIX = new Set(FIXTURES.map((f) => f.artista)), ARTISTAS_EXTRA = new Set(EXTRAS.map((f) => f.artista));
const enDisco = readdirSync(DIR);
if (!enDisco.length || enDisco.some((n) => !ARTISTAS_FIX.has(n) && !ARTISTAS_EXTRA.has(n))) noCorrio(`VIDEO_DIR no es una carpeta de fixtures (${enDisco.slice(0, 4).join(', ')}…): no escribo ahí`);

await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const H = { Authorization: `Bearer ${token}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const videosApi = async () => (await (await fetch(BASE + '/api/videos', { headers: H })).json()).videos ?? [];
// El índice se rehace por detrás: se pide hasta que tenga los que tiene que tener.
async function esperarIndice(n) {
  for (let i = 0; i < 60; i++) { const v = await videosApi(); if (v.length === n) return v; await sleep(250); }
  return null;
}

const R = {};
const ok = (k, v, extra = {}) => { R[k] = { ok: !!v, ...extra }; };
const medidas = {};
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

borrarExtras(DIR);   // restos de una corrida cortada
try { crearExtras(DIR); } catch (e) { borrarExtras(DIR); noCorrio(e instanceof SinFfmpeg ? 'no hay ffmpeg' : e.message); }
const TOTAL = FIXTURES.length + EXTRAS.length;
let browser;
try {
  const VIDS = await esperarIndice(TOTAL);
  if (!VIDS) throw new Error(`el backend no llegó a ver ${TOTAL} videos`);
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

  async function newPage(base, w, h, mobile) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
    await ctx.addInitScript((t) => {
      localStorage.setItem('token', t);
      window.__els = new Set();
      const op = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function (...a) { window.__els.add(this); return op.apply(this, a); };
      window.__maxBoth = 0;
      setInterval(() => { const n = [...window.__els].filter((e) => !e.paused).length; if (n > window.__maxBoth) window.__maxBoth = n; }, 25);
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
      window.__estado = () => {
        const v = window.__player();
        return { cola: v.queue.map((t) => t.title), kinds: [...new Set(v.queue.map((t) => t.kind ?? 'audio'))], actual: v.currentTrack?.title ?? null,
          kind: v.currentTrack?.kind ?? null, shuffle: v.shuffle, repeat: v.repeat, isPlaying: v.isPlaying };
      };
    }, token);
    await ctx.route('**/api/plays', (r) => r.fulfill({ status: 201, contentType: 'application/json', body: '{"added":0,"already":0,"skipped":0}' }));
    const p = await ctx.newPage();
    const errores = []; p.on('pageerror', (e) => errores.push(String(e.message).slice(0, 140)));
    await p.goto(base + '/videos');
    await p.waitForSelector('.video-card');
    return { ctx, p, errores };
  }
  const MIX = '.view-actions .mix-btn', INPUT = '.section-header .sbx input';
  const estado = (p) => p.evaluate(() => window.__estado());
  const visibles = (p) => p.locator('.video-grid .album-name').allTextContents().then((a) => a.map((s) => s.trim()));
  const boton = (p) => p.evaluate((sel) => {
    const b = document.querySelector(sel); if (!b) return null;
    return { texto: b.textContent.trim(), title: b.title, disabled: b.disabled, ariaDisabled: b.getAttribute('aria-disabled'), enFila: !!b.closest('.view-actions')?.querySelector('.section-count'),
      contador: b.closest('.view-actions')?.querySelector('.section-count')?.textContent ?? null };
  }, MIX);
  const escribir = async (p, t) => { await p.locator(INPUT).fill(t); await p.waitForTimeout(350); };
  const suena = (p) => p.waitForFunction(() => { const v = document.querySelector('video.player-video'); return v && !v.paused && v.currentTime > 0; }, null, { timeout: 8000 }).then(() => true, () => false);
  const cambia = async (p, antes) => { for (let i = 0; i < 80; i++) { const a = (await estado(p)).actual; if (a !== antes) return a; await p.waitForTimeout(100); } return antes; };
  const mezclar = async (p) => { await p.locator(MIX).click(); await p.waitForFunction(() => window.__player()?.currentTrack?.kind === 'video', null, { timeout: 5000 }); await p.waitForTimeout(300); };
  // Recorre la cola con «siguiente» desde el que suena: devuelve los títulos en el orden en que sonaron.
  async function recorrer(p, pasos) {
    const seq = [(await estado(p)).actual];
    for (let i = 0; i < pasos; i++) { await p.locator('.player-bar .ctrl-next').click(); seq.push(await cambia(p, seq[seq.length - 1])); }
    return seq;
  }

  // ── 1440: botón, cola, ciclo, anterior, teclado ──
  {
    const { ctx, p, errores } = await newPage(BASE, 1440, 900, false);
    const todos = await visibles(p);
    medidas.videos = todos;
    const b0 = await boton(p);
    const porRol = await p.getByRole('button', { name: 'Mix aleatorio' }).count();
    ok('boton_visible_con_videos', todos.length === TOTAL && b0 && !b0.disabled && b0.texto === 'Mix aleatorio' && porRol === 1 && b0.enFila && b0.contador === `${TOTAL} videos`
      && b0.title === 'Baraja estos videos y los reproduce al azar' && await p.locator(MIX).isVisible(), { boton: b0, porRol });

    await escribir(p, 'seek');
    const b1 = await boton(p);
    ok('deshabilitado_con_1', (await visibles(p)).length === 1 && b1.disabled && b1.contador === '1 video' && b1.title === 'No hay suficientes videos para mezclar', { boton: b1 });
    await p.locator(MIX).click({ force: true }).catch(() => {}); await p.waitForTimeout(300);
    ok('deshabilitado_no_reproduce', (await estado(p)).actual === null);
    await escribir(p, 'zzzzqq');
    const b00 = await boton(p);
    // El de Álbumes con 0 resultados, para comparar.
    const { ctx: ctxA, p: pa } = await newPage(BASE, 1440, 900, false);
    await pa.goto(BASE + '/albums'); await pa.waitForSelector(MIX);
    await pa.locator(INPUT).fill('zzzzqq'); await pa.waitForTimeout(400);
    const bAlb = await pa.evaluate((sel) => { const b = document.querySelector(sel); return b && { disabled: b.disabled, title: b.title, vacio: !!document.querySelector('.empty-state') }; }, MIX);
    await ctxA.close();
    ok('deshabilitado_con_0_como_albumes', b00 && b00.disabled && b00.contador === '0 videos' && b00.title === 'No hay suficientes videos para mezclar'
      && !!(await p.locator('.empty-state').count()) && bAlb?.disabled && bAlb.vacio, { videos: b00, albumes: bAlb });

    await escribir(p, '');
    await mezclar(p);
    const e1 = await estado(p);
    ok('mix_cola_exacta', same(e1.cola, todos) && e1.cola.length === TOTAL && same(e1.kinds, ['video']) && e1.kind === 'video' && todos.includes(e1.actual) && e1.cola[0] === e1.actual && await suena(p), { cola: e1.cola, actual: e1.actual });
    ok('aleatorio_queda_encendido', e1.shuffle === true && (await p.locator('.player-bar .shuffle-btn').getAttribute('class')).includes('active'));
    const ordenes = [e1.cola.join('|')];
    for (let i = 0; i < 4; i++) { await mezclar(p); ordenes.push((await estado(p)).cola.join('|')); }
    ok('orden_difiere_en_5', ordenes.some((o) => o !== todos.join('|')), { distintos_al_de_la_lista: ordenes.filter((o) => o !== todos.join('|')).length, de: ordenes.length });
    ok('aleatorio_sigue_encendido_tras_repetir_el_mix', (await estado(p)).shuffle === true);

    await escribir(p, 'mix');
    const filtrados = await visibles(p);
    await mezclar(p);
    const e2 = await estado(p);
    ok('con_buscador_solo_filtrados', filtrados.length === EXTRAS.length && same(e2.cola, filtrados) && filtrados.includes(e2.actual) && (await boton(p)).contador === `${EXTRAS.length} videos`, { filtrados, cola: e2.cola });

    // Ciclo completo con repetir APAGADO: la primera transición es por `ended`, las demás con «siguiente».
    await escribir(p, '');
    await mezclar(p);
    const s0 = (await estado(p)).actual;
    await p.evaluate(() => { const v = document.querySelector('video.player-video'); if (v.duration - v.currentTime > 2) v.currentTime = v.duration - 1.2; });
    const s1 = await cambia(p, s0);
    const resto = await recorrer(p, TOTAL - 2);
    const ciclo = [s0, ...resto];
    ok('ended_pasa_al_siguiente', s1 !== s0 && todos.includes(s1) && (await estado(p)).kind === 'video', { de: s0, a: s1 });
    ok('ciclo_sin_repetir', ciclo.length === TOTAL && new Set(ciclo).size === TOTAL && same(ciclo, todos), { ciclo });
    // El último termina solo: con repetir apagado se detiene ahí.
    const ultimo = ciclo[ciclo.length - 1];
    await suena(p);
    await p.evaluate(() => { const v = document.querySelector('video.player-video'); if (v.duration - v.currentTime > 2) v.currentTime = v.duration - 1.2; });
    await p.waitForFunction(() => document.querySelector('video.player-video').ended, null, { timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(600);
    const fin = await estado(p);
    const elFin = await p.evaluate(() => { const v = document.querySelector('video.player-video'); return { ended: v.ended, paused: v.paused }; });
    ok('repetir_apagado_se_detiene_al_final', fin.repeat === 'off' && fin.actual === ultimo && fin.isPlaying === false && elFin.ended && elFin.paused, { fin, elemento: elFin });

    // Repetir TODO: otro ciclo, que no empieza por el último que sonó ni repite hasta agotarse.
    await p.locator('.player-bar .repeat-btn, .player-bar [aria-label^="Repetir"]').first().click();
    const rep = (await estado(p)).repeat;
    await mezclar(p);
    const c1 = await recorrer(p, TOTAL - 1);
    const c2 = (await recorrer(p, TOTAL - 1)).slice(1);
    ok('repetir_todo_otro_ciclo_sin_repetir', rep === 'all' && new Set(c1).size === TOTAL && c2.length === TOTAL - 1 && new Set(c2).size === TOTAL - 1 && !c2.includes(c1[c1.length - 1]) && c2[0] !== c1[c1.length - 1]
      && (await estado(p)).kind === 'video', { repeat: rep, ciclo1: c1, ciclo2: c2 });
    for (let i = 0; i < 3 && (await estado(p)).repeat !== 'off'; i++) await p.locator('.player-bar .repeat-btn, .player-bar [aria-label^="Repetir"]').first().click();

    // Anterior en una cola barajada: vuelve al que sonó antes.
    await mezclar(p);
    const a = await recorrer(p, 2);
    await p.locator('.player-bar .ctrl-prev').click();
    const vuelve = await cambia(p, a[2]);
    await p.locator('.player-bar .ctrl-prev').click();
    const vuelve2 = await cambia(p, vuelve);
    ok('anterior_en_cola_barajada', vuelve === a[1] && vuelve2 === a[0] && (await estado(p)).kind === 'video', { sonaron: a, anterior: vuelve, anterior_otra_vez: vuelve2 });

    // Teclado: foco con Tab desde el buscador, Enter activa, el foco se queda.
    await p.locator(INPUT).focus();
    await p.keyboard.press('Tab');
    const conFoco = await p.evaluate((sel) => document.activeElement === document.querySelector(sel), MIX);
    const antesCola = (await estado(p)).cola.join('|');
    let cambio = false;
    for (let i = 0; i < 4 && !cambio; i++) { await p.keyboard.press('Enter'); await p.waitForTimeout(500); cambio = (await estado(p)).cola.join('|') !== antesCola; }
    const e3 = await estado(p);
    ok('teclado_foco_y_enter', conFoco && cambio && same(e3.cola, todos) && e3.kind === 'video' && await p.evaluate((sel) => document.activeElement === document.querySelector(sel), MIX), { foco_con_tab: conFoco, enter_mezcla: cambio });

    const maxBoth = await p.evaluate(() => window.__maxBoth);
    const nVideo = await p.locator('video').count();
    ok('una_sola_reproduccion_a_la_vez', maxBoth <= 1 && nVideo === 1 && !errores.length, { max_elementos_sonando: maxBoth, elementos_video: nVideo, errores });
    await ctx.close();
  }

  // ── 1440: pantalla completa ──
  {
    const { ctx, p } = await newPage(BASE, 1440, 900, false);
    await mezclar(p); await suena(p);
    await p.locator('[data-video-slot="mini"]').click(); await p.waitForSelector('.player-expanded'); await p.waitForTimeout(600);
    await p.locator('.exp-actions .exp-fullscreen').click();
    await p.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 4000 }).catch(() => {});
    const esCapa = () => p.evaluate(() => (document.fullscreenElement?.className ?? '').split(' ').includes('player-video-layer'));
    const entro = await esCapa();
    const antes = (await estado(p)).actual;
    await p.mouse.move(700, 300); await p.mouse.move(720, 320); await p.waitForTimeout(150);
    await p.locator('.vfs button[aria-label="Siguiente"]').click();
    const despues = await cambia(p, antes);
    await suena(p);
    ok('pantalla_completa_siguiente_la_mantiene', entro && despues !== antes && await esCapa() && (await estado(p)).kind === 'video' && (await p.locator('.vfs-title').textContent()) === despues, { entro, de: antes, a: despues });
    await ctx.close();
  }

  // ── Teléfono: 360, 390, 430 con touch ──
  for (const w of [360, 390, 430]) {
    const { ctx, p, errores } = await newPage(BASE, w, 844, true);
    const todos = await visibles(p);
    const g = await p.evaluate(() => {
      const fila = document.querySelector('.view-actions'); const r = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: Math.round(b.width), h: Math.round(b.height) }; };
      const hijos = [...fila.children].map(r); const f = r(fila);
      const pisa = hijos.some((a, i) => hijos.some((b, j) => j > i && a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5));
      return { fila: f, hijos, pisa, dentro: hijos.every((h) => h.l >= -0.5 && h.r <= innerWidth + 0.5), desbordePagina: document.documentElement.scrollWidth - innerWidth, vw: innerWidth };
    });
    ok(`movil_fila_sin_desborde_${w}`, !g.pisa && g.dentro && g.desbordePagina <= 0 && g.hijos.length === 2, { boton: `${g.hijos[0]?.w}×${g.hijos[0]?.h}`, desbordePagina: g.desbordePagina });
    medidas[`boton_${w}`] = `${g.hijos[0]?.w}×${g.hijos[0]?.h}`;
    await p.locator(MIX).tap();
    await p.waitForFunction(() => window.__player()?.currentTrack?.kind === 'video', null, { timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(700);
    const e = await estado(p);
    const raro = { expandido: await p.locator('.player-expanded').isVisible().catch(() => false), menu: await p.locator('.ctx-menu').count(), ruta: new URL(p.url()).pathname };
    ok(`movil_tap_mezcla_y_no_abre_nada_${w}`, same(e.cola, todos) && e.kind === 'video' && e.shuffle === true && !raro.expandido && raro.menu === 0 && raro.ruta === '/videos' && !errores.length, { cola: e.cola.length, ...raro, errores });
    await ctx.close();
  }

  // ── Control negativo: en main el botón no existe ──
  if (REF) {
    const { ctx, p } = await newPage(REF, 1440, 900, false);
    const n = await p.locator(MIX).count(); const cont = await p.locator('.view-actions .section-count').textContent().catch(() => null);
    ok('control_main_sin_boton', n === 0 && cont === `${TOTAL} videos`, { botones_en_main: n, contador_en_main: cont });
    await ctx.close();
  }
} catch (e) {
  ok('sin_excepciones', false, { error: String(e.message).split('\n')[0].slice(0, 200) });
} finally {
  await browser?.close().catch(() => {});
  borrarExtras(DIR);
  const vuelta = await esperarIndice(FIXTURES.length);
  ok('limpieza_quedan_los_tres_fixtures', !!vuelta && same(readdirSync(DIR), [...ARTISTAS_FIX]), { en_disco: readdirSync(DIR), en_el_backend: vuelta?.length ?? null });
}

const fails = Object.entries(R).filter(([, v]) => !v.ok);
console.log(JSON.stringify(R, null, 1));
console.log('medidas: ' + JSON.stringify(medidas));
console.log(REF ? `referencia (main): ${REF}` : 'SIN SNAP_REF: el control negativo contra main (control_main_sin_boton) NO se corrió ni se cuenta.');
console.log(`\n${NOMBRE}: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
process.exit(fails.length ? 1 : 0);
