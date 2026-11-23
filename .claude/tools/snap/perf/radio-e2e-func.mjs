// radio-e2e-func.mjs — la moderación de la radio web DE PUNTA A PUNTA (1.45.0) con TRES navegadores, contra el BUILD
// DE PRODUCCIÓN (preview :4173) y el backend REAL del runner (:3100, copia de la base). Nada de servidor falso y nada
// por API que la app haga con un botón: el anfitrión transmite, nombra y quita desde su lista, y cierra la pestaña.
//
// Cuentas (las tres por el mismo POST /api/auth/login que la app; nunca se fabrican tokens):
//   · anfitrión  la principal (SNAP_USER/SNAP_PASS o el .env de snap), escritorio 1440×900
//   · moderador  SNAP2 — la página `p` de radio-oyente-comun.mjs, achicada a 390×844
//   · tercero    SNAP3 — otro oyente, sin rol, en un contexto de teléfono (390×844, isMobile, hasTouch)
// El audio es el WAV sintético de radio-oyente-comun (page.route sobre /stream) en los tres contextos.
// Lo que pasa por la región viva y por los toasts se anota con un MutationObserver (un toast dura 3,5 s).
// Sin setInterval y sin esperas fijas: todo espera por condición (esperar(), pasos de 100 ms).
//
// Casos:
//   e2e_1   el anfitrión inicia la radio con una canción sonando; el moderador y el tercero se unen y suenan con
//           ella; la lista del anfitrión los muestra con "Hacer moderador".
//   e2e_2a  el anfitrión pulsa "Hacer moderador a <moderador>": sale el PUT /moderadores/<id> y su fila pasa a
//           «Modera» con "Quitar".
//   e2e_2b  el moderador recibe "Puedes moderar esta radio" (región y toast), ve la insignia «Modera» y los botones
//           "Siguiente canción de la radio" y "Pausar la radio".
//   e2e_2c  el tercero ve "<anfitrión> nombró a <moderador> para moderar" y ningún control (ni botones, ni insignia,
//           ni nota de órdenes).
//   e2e_3a  el moderador pulsa "Pausar la radio": el motor del anfitrión se pausa, el botón pasa a "Reanudar la radio"
//           y el tercero ve "<moderador> pausó".
//   e2e_3b  el moderador pulsa "Reanudar la radio": el anfitrión vuelve a sonar y el tercero ve "<moderador> reanudó".
//   e2e_4a  el anfitrión pulsa "Quitar a <moderador> de moderar": sale el DELETE y la fila vuelve a "Hacer moderador".
//   e2e_4b  el moderador recibe "Ya no puedes moderar esta radio" y pierde la insignia y los botones.
//   e2e_4c  el tercero ve "<anfitrión> le quitó el control a <moderador>".
//   e2e_5   el anfitrión CIERRA la pestaña (page.close con runBeforeUnload, que dispara pagehide): la sala queda
//           ended por 'anfitrion' y los dos oyentes ven "El anfitrión terminó la radio." y salen de la radio.
//   e2e_objetivos_de_44px              los botones de la lista del anfitrión y los del moderador miden ≥ 44 px.
//   e2e_sin_scroll_horizontal_a_390px  moderador y tercero, en cada paso.
//   e2e_sin_errores_de_pagina          en las tres páginas.
// Si el navegador no dispara pagehide al cerrar, e2e_5 no se puede probar: va a NO MEDIDO (sale 1), como 10c.
// e2e_5 ES INTERMITENTE CONOCIDA: falló 5 de 33 corridas y no se le encontró la causa. Probablemente es el mismo
// mecanismo que hace intermitente a 10c (radio-func), pero eso es una SUPOSICIÓN, no está medido. Regla: si es la
// ÚNICA falla de la suite, se repite una vez, igual que 10c; no se marca como tolerada. Ya descartado: Chromium, el
// proxy de vite preview, la espera y un límite de frecuencia. La investigación va aparte, después de 1.45.0.
//
// CONTROL NEGATIVO: con el botón de nombrar sin marcar la insignia en la cara del moderador (modera = false) caen
// e2e_2b y, por arrastre, e2e_3a/e2e_3b (no hay botones que pulsar); con "quitar" que no apaga los botones, cae e2e_4b.
// Uso: SNAP_BASE=http://localhost:4173 SNAP2_USER=… SNAP2_PASS=… SNAP3_USER=… SNAP3_PASS=… node radio-e2e-func.mjs
// E2E_DUMP=<archivo>: deja ahí los resultados con sus valores.
import {
  BASE, R, ok, tokHost, tokOye, idOye, api, largas, WAV, browser, p, errores, esperar, salas, TXT_FIN,
} from './radio-oyente-comun.mjs';

const T0 = Date.now();
const NO_MEDIDO = [];
const login3 = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: process.env.SNAP3_USER, password: process.env.SNAP3_PASS }) });
const tok3 = (await login3.json().catch(() => ({}))).token;
if (!tok3) { console.error('[radio-e2e-func] no entra la tercera cuenta (SNAP3_USER/SNAP3_PASS)'); process.exit(1); }
const idTer = JSON.parse(Buffer.from(tok3.split('.')[1], 'base64url').toString()).id;
const COLA = largas.slice(0, 3);

// ── las tres páginas ──
const rutaWav = (r) => {
  if (r.request().url().includes('/stream/video/')) return r.continue();
  const h = r.request().headers().range; const total = WAV.length;
  if (!h) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV });
  const [, a, b] = h.match(/bytes=(\d*)-(\d*)/); const start = a ? +a : 0; const end = b ? Math.min(+b, total - 1) : total - 1;
  return r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: WAV.subarray(start, end + 1) });
};
// Token, el motor (por la fibra), los medios que suenan y el registro de la región viva y de los toasts.
const INIT = (t) => {
  localStorage.setItem('token', t);
  const buscar = (es) => {
    const root = document.getElementById('root');
    const key = root && Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
    if (!key) return null;
    const pila = [root[key]?.stateNode?.current ?? root[key]];
    while (pila.length) {
      const f = pila.pop(); if (!f) continue;
      const v = f.memoizedProps?.value;
      if (v && es(v)) return v;
      if (f.sibling) pila.push(f.sibling);
      if (f.child) pila.push(f.child);
    }
    return null;
  };
  window.__player = () => buscar((v) => typeof v.play === 'function' && typeof v.addToQueue === 'function');
  window.__radio = () => buscar((v) => typeof v.unirse === 'function' && typeof v.salir === 'function');
  window.__els = new Set();
  const op = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...a) { window.__els.add(this); return op.apply(this, a); };
};
const OBSERVAR = () => {
  window.__toastsE2E = []; window.__regionE2E = [];
  new MutationObserver(() => {
    for (const n of document.querySelectorAll('.toast-text')) if (!n.dataset.e2e) { n.dataset.e2e = '1'; window.__toastsE2E.push(n.textContent); }
    const r = document.querySelector('.radio-evento'); const tx = r?.textContent ?? null;
    if (r && tx && window.__regionE2E[window.__regionE2E.length - 1] !== tx) window.__regionE2E.push(tx);
  }).observe(document.body, { subtree: true, childList: true, characterData: true });
};
async function abrir(tok, opciones) {
  const ctx = await browser.newContext(opciones);
  await ctx.route('**/stream/**', rutaWav);
  await ctx.addInitScript(INIT, tok);
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  return { ctx, pg, errs };
}
const H = await abrir(tokHost, { viewport: { width: 1440, height: 900 } });
const T = await abrir(tok3, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await p.setViewportSize({ width: 390, height: 844 });
// el moderador es `p` (la de radio-oyente-comun): le sumo lo que no trae
await p.addInitScript(() => {
  window.__els = new Set();
  const op = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...a) { window.__els.add(this); return op.apply(this, a); };
});

const motor = (pg) => pg.evaluate(() => {
  const v = window.__player(); const s = [...(window.__els ?? [])].filter((e) => !e.paused && !e.ended);
  return { id: v?.currentTrack?.id ?? null, playing: !!v?.isPlaying, sonando: s.length, t: s[0] ? s[0].currentTime : null };
});
const oyente = (pg) => pg.evaluate(() => {
  const r = window.__radio(); const c = document.querySelector('.radio-card--oyente');
  return {
    fase: r?.fase ?? null, fin: r?.fin?.texto ?? null, estado: document.querySelector('.radio-estado')?.textContent ?? null,
    tarjeta: !!c, insignia: c?.querySelector('.radio-card-title .radio-insignia')?.textContent ?? null,
    botones: c ? [...c.querySelectorAll('.radio-btn--orden')].map((b) => b.getAttribute('aria-label')) : [],
    nota: c?.querySelector('.radio-ordenes-nota')?.textContent ?? null,
    region: document.querySelector('.radio-evento')?.textContent ?? null,
    registro: window.__regionE2E ?? [], toasts: window.__toastsE2E ?? [],
  };
});
const filas = () => H.pg.evaluate(() => [...document.querySelectorAll('.radio-persona')].map((li) => {
  const b = li.querySelector('.radio-btn--persona');
  return { nombre: li.querySelector('.radio-persona-nombre')?.textContent ?? null, insignia: li.querySelector('.radio-insignia')?.textContent ?? null,
    boton: b ? { texto: b.textContent, label: b.getAttribute('aria-label'), id: Number(b.dataset.persona) } : null };
}));
const fila = async (id) => (await filas()).find((f) => f.boton?.id === id) ?? null;
const scrollH = (pg) => pg.evaluate(() => { const e = document.scrollingElement; return { ancho: innerWidth, scroll: e.scrollWidth, sobra: e.scrollWidth - e.clientWidth }; });
const anchos = [];
const anotarAnchos = async (paso) => { for (const [quien, pg] of [['moderador', p], ['tercero', T.pg]]) anchos.push({ paso, quien, ...(await scrollH(pg)) }); };
const medidas = [];
const medir = async (pg, quien, selector) => {
  for (const m of await pg.evaluate((s) => [...document.querySelectorAll(s)].map((b) => { const r = b.getBoundingClientRect(); return { label: b.getAttribute('aria-label') ?? b.textContent, w: Math.round(r.width), h: Math.round(r.height) }; }), selector)) medidas.push({ quien, ...m });
};
const pedidos = [];   // lo que manda el anfitrión a /moderadores
H.pg.on('request', (q) => { if (q.url().includes('/moderadores/')) pedidos.push({ m: q.method(), ruta: new URL(q.url()).pathname, t: Date.now() }); });const unirse = async (pg, code) => {
  await pg.evaluate((r) => { history.pushState({}, '', r); dispatchEvent(new PopStateEvent('popstate')); }, `/radio/${code}`);
  await pg.waitForSelector('.radio-btn--escuchar:not([disabled])', { timeout: 10_000 });
  await pg.click('.radio-btn--escuchar');
};
const llega = (pg, texto, ms = 10_000) => esperar(async () => { const o = await oyente(pg); return o.registro.includes(texto) ? o : null; }, ms, 100);

let code = null;
try {
  // ── 1. el anfitrión transmite; el moderador y el tercero se unen ──
  await H.pg.goto(BASE + '/');
  await H.pg.waitForSelector('.player-bar', { timeout: 15_000 });
  await H.pg.waitForFunction(() => !!window.__player?.());
  await H.pg.evaluate((q) => window.__player().play(q, 0), COLA);
  const suena = await esperar(async () => { const m = await motor(H.pg); return m.playing && m.sonando === 1 && m.t > 0.2 ? m : null; }, 10_000, 100);
  await H.pg.locator('.sidebar-nav button', { hasText: /^Radio$/ }).click();
  await H.pg.locator('.main-content .radio-btn', { hasText: 'Iniciar radio' }).click();
  const r0 = await esperar(async () => H.pg.evaluate(() => document.querySelector('.radio-codigo')?.textContent ?? null), 8000, 100);
  code = r0.v;
  if (code) salas.push([tokHost, code]);
  for (const pg of [p, T.pg]) {
    await pg.goto(BASE + '/');
    await pg.waitForSelector('.player-bar', { timeout: 15_000 });
    await pg.waitForFunction(() => !!window.__player?.() && !!window.__radio?.());
    await pg.evaluate(OBSERVAR);
    await unirse(pg, code);
  }
  const conLaRadio = (pg) => esperar(async () => { const [o, m] = [await oyente(pg), await motor(pg)]; return o.fase === 'oyente' && m.id === COLA[0].id && m.playing && m.sonando === 1 ? m : null; }, 12_000, 100);
  const sMod = await conLaRadio(p); const sTer = await conLaRadio(T.pg);
  const lista1 = await esperar(async () => { const f = await filas(); const a = f.find((x) => x.boton?.id === idOye), b = f.find((x) => x.boton?.id === idTer);
    return a && b && a.boton.texto === 'Hacer moderador' && b.boton.texto === 'Hacer moderador' && !a.insignia && !b.insignia ? f : null; }, 15_000, 100);
  const sala = (await api(tokHost, 'GET', `/api/radio/${code}`)).j;
  const nom = (id) => sala?.listeners?.find((x) => x.id === id)?.name ?? null;
  const HOST = sala?.host?.name ?? null, MOD = nom(idOye), TER = nom(idTer);
  await anotarAnchos('1');
  ok('e2e_1_el_anfitrion_transmite_y_se_unen_los_dos_oyentes', /^[2-9A-Z]{6}$/.test(code ?? '') && !!suena.v && !!sMod.v && !!sTer.v && !!lista1.v && !!HOST && !!MOD && !!TER,
    { code, anfitrionSuena: !!suena.v, moderadorSuena: !!sMod.v, terceroSuena: !!sTer.v, lista: lista1.v ?? await filas(), nombres: { HOST: !!HOST, MOD: !!MOD, TER: !!TER } });
  await medir(H.pg, 'anfitrion', '.radio-btn--persona');

  // ── 2. el anfitrión nombra con SU BOTÓN ──
  const labelNombrar = (await fila(idOye))?.boton?.label;
  const t2 = Date.now();
  await H.pg.getByRole('button', { name: labelNombrar, exact: true }).click();
  const f2 = await esperar(async () => { const f = await fila(idOye); return f?.insignia === 'Modera' && f.boton?.texto === 'Quitar' ? f : null; }, 6000, 100);
  ok('e2e_2a_el_boton_de_nombrar_marca_modera_en_la_lista', labelNombrar === `Hacer moderador a ${MOD}` && pedidos.some((x) => x.t >= t2 && x.m === 'PUT' && x.ruta.endsWith(`/moderadores/${idOye}`)) && !!f2.v
    && f2.v.boton.label === `Quitar a ${MOD} de moderar`, { label: labelNombrar, pedidos: pedidos.filter((x) => x.t >= t2).map((x) => `${x.m} ${x.ruta}`), fila: f2.v ?? await fila(idOye) });

  const AVISO_NOMBRADO = 'Puedes moderar esta radio';
  const m2 = await esperar(async () => { const o = await oyente(p); return o.insignia === 'Modera' && o.registro.includes(AVISO_NOMBRADO)
    && o.botones.includes('Siguiente canción de la radio') && o.botones.includes('Pausar la radio') ? o : null; }, 10_000, 100);
  const o2 = m2.v ?? await oyente(p);
  ok('e2e_2b_el_moderador_recibe_el_aviso_la_insignia_y_los_botones', !!m2.v && o2.toasts.includes(AVISO_NOMBRADO),
    { insignia: o2.insignia, botones: o2.botones, region: o2.registro, toasts: o2.toasts });
  await medir(p, 'moderador', '.radio-card--oyente .radio-btn--orden');

  const EV_NOMBRO = `${HOST} nombró a ${MOD} para moderar`;
  const t2c = await llega(T.pg, EV_NOMBRO);
  const o2c = await oyente(T.pg);
  ok('e2e_2c_el_tercero_ve_el_aviso_y_ningun_control', !!t2c.v && o2c.toasts.includes(EV_NOMBRO) && o2c.tarjeta && o2c.insignia === null && o2c.botones.length === 0 && o2c.nota === null,
    { region: o2c.registro, toasts: o2c.toasts, insignia: o2c.insignia, botones: o2c.botones, nota: o2c.nota });
  await anotarAnchos('2');

  // ── 3. el moderador pausa y reanuda ──
  const clicMod = async (nombre) => { const b = p.getByRole('button', { name: nombre, exact: true }); await b.waitFor({ timeout: 8000 }); await b.click(); };
  await clicMod('Pausar la radio');
  const h3a = await esperar(async () => { const m = await motor(H.pg); return !m.playing && m.sonando === 0 ? m : null; }, 10_000, 100);
  const b3a = await esperar(async () => ((await oyente(p)).botones.includes('Reanudar la radio') ? true : null), 10_000, 100);
  const EV_PAUSO = `${MOD} pausó`;
  const t3a = await llega(T.pg, EV_PAUSO);
  ok('e2e_3a_pausar_del_moderador_pausa_al_anfitrion_y_avisa_al_tercero', !!h3a.v && !!b3a.v && !!t3a.v,
    { anfitrionEnPausa: !!h3a.v, botonReanudar: !!b3a.v, tercero: (await oyente(T.pg)).registro });

  await clicMod('Reanudar la radio');
  const h3b = await esperar(async () => { const m = await motor(H.pg); return m.playing && m.sonando === 1 ? m : null; }, 10_000, 100);
  const EV_REANUDO = `${MOD} reanudó`;
  const t3b = await llega(T.pg, EV_REANUDO);
  ok('e2e_3b_reanudar_del_moderador_reanuda_al_anfitrion_y_avisa_al_tercero', !!h3b.v && !!t3b.v,
    { anfitrionSuena: !!h3b.v, tercero: (await oyente(T.pg)).registro });
  await anotarAnchos('3');

  // ── 4. el anfitrión quita el rol con su botón ──
  const t4 = Date.now();
  await H.pg.getByRole('button', { name: `Quitar a ${MOD} de moderar`, exact: true }).click();
  const f4 = await esperar(async () => { const f = await fila(idOye); return f && f.insignia === null && f.boton?.texto === 'Hacer moderador' ? f : null; }, 6000, 100);
  ok('e2e_4a_el_boton_de_quitar_vuelve_a_hacer_moderador', pedidos.some((x) => x.t >= t4 && x.m === 'DELETE' && x.ruta.endsWith(`/moderadores/${idOye}`)) && !!f4.v,
    { pedidos: pedidos.filter((x) => x.t >= t4).map((x) => `${x.m} ${x.ruta}`), fila: f4.v ?? await fila(idOye) });

  const AVISO_QUITADO = 'Ya no puedes moderar esta radio';
  const m4 = await esperar(async () => { const o = await oyente(p); return o.registro.includes(AVISO_QUITADO) && o.insignia === null && o.botones.length === 0 ? o : null; }, 10_000, 100);
  const o4 = m4.v ?? await oyente(p);
  ok('e2e_4b_el_moderador_recibe_el_aviso_y_pierde_insignia_y_botones', !!m4.v && o4.toasts.includes(AVISO_QUITADO) && o4.fase === 'oyente',
    { insignia: o4.insignia, botones: o4.botones, region: o4.registro, toasts: o4.toasts, fase: o4.fase });

  const EV_QUITO = `${HOST} le quitó el control a ${MOD}`;
  const t4c = await llega(T.pg, EV_QUITO);
  const o4c = await oyente(T.pg);
  ok('e2e_4c_el_tercero_ve_el_aviso_de_quitar', !!t4c.v && o4c.botones.length === 0 && o4c.insignia === null, { region: o4c.registro, botones: o4c.botones });
  await anotarAnchos('4');

  // ── 5. el anfitrión CIERRA la pestaña ──
  let vio = false;
  await H.pg.exposeFunction('__vioPagehideE2E', () => { vio = true; });
  await H.pg.evaluate(() => window.addEventListener('pagehide', () => window.__vioPagehideE2E()));
  await H.pg.close({ runBeforeUnload: true });
  let ultima = null;
  const s5 = await esperar(async () => { const x = await api(tokHost, 'GET', `/api/radio/${code}`); ultima = { http: x.status, status: x.j?.status ?? null, razon: x.j?.endedReason ?? null, error: x.j?.error ?? null }; return x.j?.status === 'ended' ? x.j : null; }, 6000, 100);
  const fin = (pg) => esperar(async () => { const o = await oyente(pg); return o.estado === TXT_FIN && o.fin === TXT_FIN && o.fase === 'sin-radio' && !o.tarjeta ? o : null; }, 12_000, 100);
  const fM = await fin(p); const fT = await fin(T.pg);
  if (vio) {
    ok('e2e_5_cerrar_la_pestana_termina_la_radio_para_los_dos_oyentes', s5?.v?.endedReason === 'anfitrion' && !!fM.v && !!fT.v,
      { razon: s5.v?.endedReason ?? null, sala: ultima, moderador: fM.v ? fM.v.estado : await oyente(p), tercero: fT.v ? fT.v.estado : await oyente(T.pg) });
    if (s5.v) code = null;
  } else NO_MEDIDO.push('e2e_5: page.close({ runBeforeUnload: true }) no disparó pagehide');
  await anotarAnchos('5');

  // ── reglas de toda la suite ──
  const chicos = medidas.filter((m) => m.w < 44 || m.h < 44);
  ok('e2e_objetivos_de_44px', medidas.length >= 4 && chicos.length === 0, { medidos: medidas.length, chicos, minimo: medidas.reduce((a, m) => Math.min(a, m.w, m.h), Infinity) });
  const conScroll = anchos.filter((a) => a.ancho !== 390 || a.sobra > 0);
  ok('e2e_sin_scroll_horizontal_a_390px', anchos.length === 10 && conScroll.length === 0, { revisados: anchos.length, conScroll });
  const errs = { anfitrion: H.errs, moderador: errores, tercero: T.errs };
  ok('e2e_sin_errores_de_pagina', !H.errs.length && !errores.length && !T.errs.length, errs);
} catch (e) {
  console.error(e);
  ok('e2e_00_sin_excepcion', false, { error: String(e?.message ?? e).slice(0, 300) });
} finally {
  if (code) await api(tokHost, 'DELETE', `/api/radio/${code}`);
  await browser.close();
}

const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
const limpio = (x) => JSON.stringify(x, null, 1).split(tokOye).join('<token>').split(tok3).join('<token>').split(tokHost).join('<token>');
console.log(limpio(R));
if (process.env.E2E_DUMP) (await import('node:fs')).writeFileSync(process.env.E2E_DUMP, limpio({ R, NO_MEDIDO, segundos: Math.round((Date.now() - T0) / 1000) }));
for (const x of NO_MEDIDO) console.log('NO MEDIDO:', x);
console.log(`\n[radio-e2e-func] ${Math.round((Date.now() - T0) / 1000)} s`);
console.log(`\nradio-e2e-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
process.exit(fails.length || NO_MEDIDO.length ? 1 : 0);
