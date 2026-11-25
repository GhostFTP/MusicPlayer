// radio-barra-func.mjs — «Anterior» y «Siguiente» del reproductor en una radio (1.45.2), contra el BUILD DE
// PRODUCCIÓN (preview :4173) y el backend REAL del runner (:3100, copia de la base).
//
// Montaje: el de radio-oyente-comun.mjs (la página es la SEGUNDA cuenta; la radio es un SERVIDOR FALSO por
// page.route sobre /api/radio/FK… y …/ordenes, con «Anfitriona» transmitiendo A y B de siguiente).
//
// Casos:
//   RB_fuera_de_la_radio_igual                 sin radio: los botones de siempre (sin data-paso, sin aria-disabled) y
//        «Siguiente» de la barra pasa a la siguiente de la cola propia.
//   RB_oyente_barra_bloqueada                  oyente sin rol, barra de escritorio: Anterior y Siguiente con
//        aria-disabled (enfocables, no `disabled`), el motivo «Estás en la radio de Anfitriona» como descripción y en
//        el tooltip; tocarlos no cambia la canción ni manda nada; el foco se ve.
//   RB_oyente_expandido_bloqueado              lo mismo en el reproductor expandido, con el motivo como title.
//   RB_modera_barra_siguiente_manda_la_orden   quien modera (con órdenes): Siguiente de la barra (nombre «Siguiente»,
//        descripción y tooltip «Siguiente canción de la radio») manda UNA orden 'siguiente' con su seqBase (una segunda en vuelo no sale); Anterior bloqueado
//        con «La radio no tiene anterior».
//   RB_modera_expandido_siguiente_manda_la_orden   lo mismo desde el expandido.
//   RB_390_modera_mini_siguiente_manda_la_orden    a 390 px, la mini-barra: Siguiente manda la orden y NO abre el
//        expandido.
//   RB_390_oyente_mini_y_expandido_bloqueados      a 390 px y sin rol: la mini-barra y el expandido, bloqueados con su
//        motivo; tocar la mini-barra no abre el expandido ni cambia la canción.
//   RB_fuera_otra_vez_igual                    después de salir: los botones de siempre.
//   RB_sin_errores_de_pagina
// Lo que dice la radio al resolver cada orden (sus toasts de siempre) se REGISTRA, no cuenta.
//
// CONTROL NEGATIVO (a mano): con pasosDeLaBarra devolviendo siempre 'motor' caen todos los RB_oyente_*, RB_modera_*
// y RB_390_*; sin el stopPropagation de la mini-barra cae RB_390_modera_mini.
// Uso: SNAP_BASE=http://localhost:4173 SNAP2_USER=… SNAP2_PASS=… node radio-barra-func.mjs
// BARRA_DUMP=<archivo>: deja ahí los resultados con sus valores.
import {
  R, ok, REG, sleep, A, B, C, PROPIAS, ctx, p, errores, esperar, foto, FK, YO_FK, estadoFk, entrarFk, salirFk,
  BASE, browser,
} from './radio-oyente-comun.mjs';

const T0 = Date.now();
const EN_LA_RADIO = 'Estás en la radio de Anfitriona';
const SIN_ANTERIOR = 'La radio no tiene anterior';
const SIG_RADIO = 'Siguiente canción de la radio';

const boton = (sel) => p.evaluate((s) => {
  const b = [...document.querySelectorAll(s)].find((x) => x.offsetWidth || x.offsetHeight) ?? document.querySelector(s);
  if (!b) return null;
  const d = b.getAttribute('aria-describedby');
  const tip = b.parentElement?.classList.contains('bar-tip-wrap') ? b.parentElement.querySelector('.bar-tip')?.textContent ?? null : null;
  return {
    paso: b.dataset.paso ?? 'motor', label: b.getAttribute('aria-label'), disabled: b.disabled, ariaDisabled: b.getAttribute('aria-disabled'),
    title: b.getAttribute('title'), motivo: d ? document.getElementById(d)?.textContent ?? null : null, tip, tab: b.tabIndex,
    visible: !!(b.offsetWidth || b.offsetHeight),
  };
}, sel);
const bloqueado = (b, motivo, conTitle) => !!b && b.paso === 'bloqueado' && b.ariaDisabled === 'true' && b.disabled === false && b.tab >= 0
  && b.motivo === motivo && (conTitle ? b.title === motivo : b.tip === motivo);
const radioV = () => p.evaluate(() => { const r = window.__radio(); return { modera: r?.vistaMod?.modera ?? null, admite: r?.vistaMod?.admite ?? null, conBase: r?.vistaMod?.conBase ?? null, enVuelo: !!r?.ordenando?.siguiente }; });
const expandido = () => p.locator('.player-expanded').count().then((n) => n > 0);
const abrirExpandido = async () => { await p.locator('.player-bar').click({ position: { x: 6, y: 6 } }); await p.waitForSelector('.player-expanded', { timeout: 4000 }); await sleep(600); };
const cerrarExpandido = async () => { if (await expandido()) { await p.locator('.player-expanded .exp-back').click(); await sleep(700); } };
const toasts = () => p.evaluate(() => window.__toasts.slice());
/** El foco con teclado (una tecla antes, para que el navegador lo cuente como foco visible). */
const focoVisible = async (sel) => { await p.keyboard.press('Shift'); return p.evaluate((s) => {
  const b = [...document.querySelectorAll(s)].find((x) => x.offsetWidth || x.offsetHeight); b.focus();
  const cs = getComputedStyle(b); return { activo: document.activeElement === b, visible: b.matches(':focus-visible'), outline: cs.outlineStyle };
}, sel); };

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

  // ── Fuera de la radio: lo de siempre ──
  await p.evaluate((q) => window.__player().play(q, 0), PROPIAS);
  await esperar(async () => ((await foto()).actual === PROPIAS[0].id ? true : null), 5000, 100);
  const f0n = await boton('.player-bar .ctrl-next'); const f0p = await boton('.player-bar .ctrl-prev');
  await p.locator('.player-bar .ctrl-next').click();
  const paso = await esperar(async () => ((await foto()).actual === PROPIAS[1].id ? true : null), 4000, 100);
  ok('RB_fuera_de_la_radio_igual', f0n?.paso === 'motor' && f0n.label === 'Siguiente' && f0n.ariaDisabled === null && f0n.tip === 'Siguiente'
    && f0p?.paso === 'motor' && f0p.label === 'Anterior' && f0p.ariaDisabled === null && !!paso.v, { siguiente: f0n, anterior: f0p, paso: !!paso.v });

  // ── En la radio, sin rol ──
  const e = await entrarFk({ mod: { moderators: [], events: [], until: 0, lost: false } });
  const s = FK[e.code];
  if (!e.sono) throw new Error('la radio falsa no empezó a sonar');
  const bn = await boton('.player-bar .ctrl-next'); const bp = await boton('.player-bar .ctrl-prev');
  const n0 = s.ordenes?.length ?? 0;
  // force: Playwright toma aria-disabled como "desactivado" y esperaría para siempre; el clic llega igual.
  await p.locator('.player-bar .ctrl-next').click({ force: true }); await p.locator('.player-bar .ctrl-prev').click({ force: true });
  await sleep(2000);
  const tras = await foto();
  const fv = await focoVisible('.player-bar .ctrl-next');
  ok('RB_oyente_barra_bloqueada', bloqueado(bn, EN_LA_RADIO, false) && bloqueado(bp, EN_LA_RADIO, false) && tras.actual === A.id && (s.ordenes?.length ?? 0) === n0
    && fv.activo && fv.visible && fv.outline === 'solid', { siguiente: bn, anterior: bp, sigueEnA: tras.actual === A.id, ordenes: (s.ordenes?.length ?? 0) - n0, foco: fv });

  await abrirExpandido();
  const en = await boton('.player-expanded .exp-next'); const ep = await boton('.player-expanded .exp-prev');
  await p.locator('.player-expanded .exp-next').click({ force: true }); await sleep(1500);
  const tras2 = await foto();
  await cerrarExpandido();
  ok('RB_oyente_expandido_bloqueado', bloqueado(en, EN_LA_RADIO, true) && bloqueado(ep, EN_LA_RADIO, true) && tras2.actual === A.id && (s.ordenes?.length ?? 0) === n0,
    { siguiente: en, anterior: ep, sigueEnA: tras2.actual === A.id });

  // ── Con el rol (y órdenes) ──
  s.mod.moderators = [YO_FK];
  const rol = await esperar(async () => { const v = await radioV(); return v.modera && v.admite && v.conBase ? v : null; }, 8000, 100);
  await sleep(3800);   // que pase el toast de "Puedes moderar esta radio"
  const mn = await boton('.player-bar .ctrl-next'); const mp = await boton('.player-bar .ctrl-prev');
  const n1 = s.ordenes?.length ?? 0;
  const t1 = (await toasts()).length;
  await p.locator('.player-bar .ctrl-next').click();
  const salio = await esperar(async () => ((s.ordenes?.length ?? 0) > n1 ? true : null), 4000, 50);
  await p.locator('.player-bar .ctrl-next').click();   // en vuelo: no sale otra
  await sleep(600);
  const cuerpo1 = s.ordenes?.[n1] ?? null;
  const nTrasDoble = (s.ordenes?.length ?? 0) - n1;
  estadoFk(e.code, { trackId: B.id, positionMs: 0, playing: true, nextTrackId: C.id });   // la anfitriona la aplica
  const resuelta1 = await esperar(async () => ((await radioV()).enVuelo ? null : true), 10_000, 100);
  REG.toasts_barra = (await toasts()).slice(t1);
  ok('RB_modera_barra_siguiente_manda_la_orden', !!rol.v && mn?.paso === 'radio' && mn.label === 'Siguiente' && mn.motivo === SIG_RADIO && mn.tip === SIG_RADIO && bloqueado(mp, SIN_ANTERIOR, false)
    && !!salio.v && cuerpo1?.type === 'siguiente' && Number.isInteger(cuerpo1?.seqBase) && nTrasDoble === 1 && !!resuelta1.v,
    { siguiente: mn, anterior: mp, cuerpo: cuerpo1, ordenesConDobleClic: nTrasDoble, resuelta: !!resuelta1.v });

  await abrirExpandido();
  const xn = await boton('.player-expanded .exp-next'); const xp = await boton('.player-expanded .exp-prev');
  const n2 = s.ordenes?.length ?? 0;
  await p.locator('.player-expanded .exp-next').click();
  const salio2 = await esperar(async () => ((s.ordenes?.length ?? 0) > n2 ? true : null), 4000, 50);
  const cuerpo2 = s.ordenes?.[n2] ?? null;
  estadoFk(e.code, { trackId: C.id, positionMs: 0, playing: true, nextTrackId: A.id });
  const resuelta2 = await esperar(async () => ((await radioV()).enVuelo ? null : true), 10_000, 100);
  await cerrarExpandido();
  ok('RB_modera_expandido_siguiente_manda_la_orden', xn?.paso === 'radio' && xn.label === 'Siguiente' && xn.motivo === SIG_RADIO && xn.title === SIG_RADIO && bloqueado(xp, SIN_ANTERIOR, true)
    && !!salio2.v && cuerpo2?.type === 'siguiente' && !!resuelta2.v, { siguiente: xn, anterior: xp, cuerpo: cuerpo2, resuelta: !!resuelta2.v });

  // ── A 390 px: la mini-barra ──
  await p.setViewportSize({ width: 390, height: 844 }); await sleep(800);
  const mini = await boton('.player-bar .mini-next');
  const n3 = s.ordenes?.length ?? 0;
  await p.locator('.player-bar .mini-next').click();
  const salio3 = await esperar(async () => ((s.ordenes?.length ?? 0) > n3 ? true : null), 4000, 50);
  await sleep(500);
  const abrio3 = await expandido();
  estadoFk(e.code, { trackId: A.id, positionMs: 0, playing: true, nextTrackId: B.id });
  const resuelta3 = await esperar(async () => ((await radioV()).enVuelo ? null : true), 10_000, 100);
  ok('RB_390_modera_mini_siguiente_manda_la_orden', mini?.paso === 'radio' && mini.visible && mini.label === 'Siguiente' && mini.motivo === SIG_RADIO && mini.title === SIG_RADIO && !!salio3.v
    && (s.ordenes?.[n3]?.type === 'siguiente') && !abrio3 && !!resuelta3.v, { mini, abrioElExpandido: abrio3, resuelta: !!resuelta3.v });

  s.mod.moderators = [];
  await esperar(async () => ((await radioV()).modera === false ? true : null), 8000, 100);
  await sleep(3800);   // que pase el toast de "Ya no puedes moderar esta radio"
  const actual4 = (await foto()).actual;
  const mini4 = await boton('.player-bar .mini-next');
  const n4 = s.ordenes?.length ?? 0;
  await p.locator('.player-bar .mini-next').click({ force: true }); await sleep(1500);
  const abrio4 = await expandido();
  const tras4 = await foto();
  await abrirExpandido();
  const yn = await boton('.player-expanded .exp-next'); const yp = await boton('.player-expanded .exp-prev');
  await cerrarExpandido();
  ok('RB_390_oyente_mini_y_expandido_bloqueados', bloqueado(mini4, EN_LA_RADIO, true) && mini4.visible && !abrio4 && tras4.actual === actual4 && (s.ordenes?.length ?? 0) === n4
    && bloqueado(yn, EN_LA_RADIO, true) && bloqueado(yp, EN_LA_RADIO, true), { mini: mini4, abrioElExpandido: abrio4, siguiente: yn, anterior: yp });
  await p.setViewportSize({ width: 1440, height: 900 }); await sleep(800);

  // ── Fuera otra vez ──
  await salirFk();
  const zn = await boton('.player-bar .ctrl-next'); const zp = await boton('.player-bar .ctrl-prev');
  ok('RB_fuera_otra_vez_igual', (await foto()).fase === 'sin-radio' && zn?.paso === 'motor' && zn.ariaDisabled === null && zp?.paso === 'motor' && zp.ariaDisabled === null,
    { siguiente: zn, anterior: zp });

  ok('RB_sin_errores_de_pagina', errores.length === 0, { errores });
} catch (x) {
  ok('RB_excepcion', false, { error: String(x?.message ?? x).split('\n')[0].slice(0, 200) });
}

await ctx.close();
const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
console.log('registro (fuera del conteo):', JSON.stringify(REG, null, 1));
if (process.env.BARRA_DUMP) (await import('node:fs')).writeFileSync(process.env.BARRA_DUMP, JSON.stringify({ R, REG, segundos: Math.round((Date.now() - T0) / 1000) }, null, 1));
console.log(`\n[radio-barra-func] ${Math.round((Date.now() - T0) / 1000)} s`);
console.log(`\nradio-barra-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
