// teclado-func.mjs — funcional del atajo GLOBAL de teclado del reproductor (PlayerContext.jsx, «Keyboard»):
// Espacio = play/pausa y ←/→ = ±10 s. Paso 1: el atajo NO actúa si (a) la tecla ya vino con
// defaultPrevented, (b) es repetición (repeat), (c) se está componiendo texto (isComposing), (d) lleva
// Ctrl/Alt/Meta/Shift, o (e) el foco está en input (cualquiera, incluye sliders), textarea, select,
// contenteditable o role textbox/combobox/searchbox. Si no, todo sigue como antes.
// Paso 2 (casos p2_*): Espacio sobre un botón (o summary, o role button/radio/menuitem*/tab/option/
// switch/checkbox) al que se llegó con Tab es del botón: se activa y la música no se pausa. El modo lo
// pone un keydown de Tab (con o sin Shift) y lo quita cualquier pointerdown; las flechas no lo cambian.
// Sigue siendo play/pausa: después de un clic o un toque (también si el foco volvió al botón por código
// tras un clic, o al cerrar un menú con Esc), dentro del reproductor (.player-bar, .player-expanded,
// .queue-panel, .lyrics-panel; el «+» incluido) salvo el menú «+» ya abierto (.ptp-menu), y en los
// enlaces siempre (ahí Espacio desplazaría la página).
//
// Teclado, ratón y dedo REALES de Playwright (keyboard.press/down, mouse.click). ÚNICA excepción: la
// composición (c). Con el teclado real sólo hay composición dentro de un campo editable, y ahí ya corta (e);
// para que (c) tenga un caso que la delate, ese caso despacha un keydown sintético con isComposing:true
// sobre el body. Está marcado en su clave.
// La app no tiene textarea, select, contenteditable, role=textbox ni enlaces: se inyectan SOLO en la
// página de prueba (no en la app) para probar el handler genérico.
// Si Espacio activó el control se mide contando los click que llegan al elemento que tenía el foco.
// Qué hizo el reproductor se cuenta en el prototipo de HTMLMediaElement (play/pause y escrituras de
// currentTime), así no importa si el <audio> está en el DOM. Cuenta también cuántos elementos de media
// distintos tocó el atajo: tiene que ser UNO (nunca un segundo player).
//
// CONTROL NEGATIVO: contra un build SIN el Paso 1 (p. ej. v1.41.0) tienen que FALLAR los casos de campos,
// modificadores, repeat, composición y defaultPrevented; los de control (body) y el slider pasan igual.
// Contra un build SIN el Paso 2 (p. ej. v1.41.1) tienen que FALLAR los p2_* donde Espacio activa el
// control (Tab al chip, al vecino, Shift+Tab y el menú «+» abierto); los p2_* que esperan pausa pasan igual.
// ⚠️ Reproduce pistas y crea (y borra) dos playlists propias: correr contra la COPIA de la base.
// Uso: SNAP_BASE=http://localhost:4173 node teclado-func.mjs
import { BASE } from '../session.mjs';
import { preparar, sleep } from './tablet-util.mjs';

const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? !!v : { ok: !!v, ...extra }; };
const seccion = async (claves, fn) => { try { await fn(); } catch (e) { for (const k of claves) if (!(k in R)) ok(k, false, { excepcion: String(e.message).split('\n')[0].slice(0, 160) }); } };

const { token, browser, abrir } = await preparar();
const HJ = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const api = async (path, opts = {}) => { const r = await fetch(BASE + path, { ...opts, headers: HJ }); return r.status === 204 ? null : r.json(); };

// Contadores en el prototipo de media + el último elemento tocado (para leer su currentTime).
const INSTRUMENTAR = () => {
  if (window.__c) return;
  const M = HTMLMediaElement.prototype; const c = window.__c = { play: 0, pause: 0, seek: 0 };
  const vistos = window.__medios = new Set();
  const op = M.play, opa = M.pause; const d = Object.getOwnPropertyDescriptor(M, 'currentTime');
  M.play = function () { c.play++; vistos.add(this); window.__ultimo = this; return op.call(this); };
  M.pause = function () { c.pause++; vistos.add(this); window.__ultimo = this; return opa.call(this); };
  Object.defineProperty(M, 'currentTime', { get() { return d.get.call(this); }, set(v) { c.seek++; vistos.add(this); window.__ultimo = this; d.set.call(this, v); }, configurable: true });
  // Click que llegan al control que tenía el foco cuando se apretó Espacio (= Espacio lo activó).
  window.__clicsFoco = 0;
  window.addEventListener('keydown', (e) => { if (e.code === 'Space') window.__focoEsp = document.activeElement; }, true);
  document.addEventListener('click', (e) => { const a = window.__focoEsp; if (a && a !== document.body && a.contains(e.target)) window.__clicsFoco++; }, true);
};
const INYECTAR = () => {
  if (document.getElementById('kf')) return;
  const box = document.createElement('div'); box.id = 'kf';
  box.style.cssText = 'position:fixed;top:6px;left:320px;z-index:99999;background:#222;padding:6px;display:flex;gap:8px;align-items:center';
  box.innerHTML = '<textarea id="kf-ta" rows="1"></textarea>'
    + '<select id="kf-sel"><option>uno</option><option>dos</option><option>tres</option></select>'
    + '<div id="kf-ce" contenteditable="true" style="min-width:60px;color:#fff;border:1px solid #888">ab</div>'
    + '<div id="kf-tb" role="textbox" tabindex="0" style="min-width:60px;height:20px;border:1px solid #888"></div>'
    + '<a id="kf-a" href="#kf-ancla" style="color:#9cf">enlace</a>';
  document.body.appendChild(box);
};
const ARRANCAR = async () => {
  const r = await fetch('/api/tracks', { headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } });
  const l = await r.json(); const arr = Array.isArray(l) ? l : (l.tracks ?? []);
  window.__player().play(arr.slice(0, 5), 0);
};

const reset = (p) => p.evaluate(() => { window.__c.play = 0; window.__c.pause = 0; window.__c.seek = 0; });
const leer = (p) => p.evaluate(() => ({ ...window.__c, t: window.__ultimo ? +window.__ultimo.currentTime.toFixed(2) : null, medios: window.__medios.size, ruta: location.pathname }));
// Poner el reproductor en un punto fijo y en pausa, sin teclado (por la API del contexto).
const fijar = async (p, t = 30) => { await p.evaluate((t) => { const v = window.__player(); if (v.isPlaying) v.togglePlay(); v.seek(t); }, t); await sleep(300); };
const clic = async (p, sel) => { const b = await p.locator(sel).first().boundingBox(); if (!b) throw new Error(`sin caja: ${sel}`); await p.mouse.click(b.x + Math.min(b.width / 2, 20), b.y + b.height / 2); await sleep(150); };
const neutro = (p) => clic(p, '.main-content .section-title, .main-content h1');
const tabHasta = async (p, sel, max = 160) => { for (let i = 0; i < max; i++) { await p.keyboard.press('Tab'); if (await p.evaluate((s) => document.activeElement?.matches(s), sel)) return i + 1; } return -1; };
const foco = (p) => p.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
// Pulsa y mide: cuánto alternó (play+pause), cuántos saltos y el delta de tiempo.
const medir = async (p, tecla, espera = 350) => {
  await reset(p); const a = await leer(p);
  await p.keyboard.press(tecla); await sleep(espera);
  const b = await leer(p);
  return { alterna: b.play + b.pause, saltos: b.seek, delta: a.t != null && b.t != null ? +(b.t - a.t).toFixed(2) : null };
};
// Paso 2: Espacio y qué pasó (alternó la música / el control recibió el click).
const espacio = async (p, espera = 450) => {
  await reset(p); await p.evaluate(() => { window.__clicsFoco = 0; });
  await p.keyboard.press('Space'); await sleep(espera);
  const b = await leer(p);
  return { alterna: b.play + b.pause, clics_al_foco: await p.evaluate(() => window.__clicsFoco) };
};
const CHIP = '.library-actions .recientes-chip';
const SIG = '.player-bar button[aria-label="Siguiente"]';
const MAS = '.player-bar .ptp-btn';
const chipEstado = (p) => p.evaluate((s) => document.querySelector(s)?.getAttribute('aria-pressed') ?? null, CHIP);
const pista = (p) => p.evaluate(() => window.__player()?.currentTrack?.id ?? null);
const enfocado = (p, sel) => p.evaluate((s) => !!document.activeElement?.matches(s), sel);
const panelFiltrar = (p) => p.evaluate(() => document.querySelectorAll('.af-panel').length);
// Un punto de `raiz` que no cae en ningún control (para un clic "neutro" dentro del reproductor).
const puntoNeutro = (p, raiz) => p.evaluate((raiz) => {
  const r = document.querySelector(raiz)?.getBoundingClientRect(); if (!r) return null;
  for (let y = r.top + 8; y < r.bottom - 4; y += 12) for (let x = r.left + 8; x < r.right - 4; x += 12) {
    const e = document.elementFromPoint(x, y);
    if (e && e.closest(raiz) && !e.closest('button, input, a, [role], [tabindex], .player-bar-link, .exp-link, .ptp, .exp-art, .exp-art-placeholder')) return { x, y };
  }
  return null;
}, raiz);
// Una página por grupo de casos; antes de cerrarla se anota cuántos elementos de media usó.
const mediosPorPagina = [];
const anotarMedios = async (p, donde) => { mediosPorPagina.push({ donde, medios: (await leer(p)).medios }); };
const abrirSonando = async (ruta, esperar, opts = {}) => {
  const o = await abrir(BASE, ruta, { w: 1280, h: 800, esperar, ...opts });
  await o.p.evaluate(INSTRUMENTAR); await o.p.evaluate(ARRANCAR); await sleep(1500);
  return o;
};

const { ctx, p, errores } = await abrir(BASE, '/', { w: 1280, h: 800, esperar: '.library-tracks .track-row' });
await p.evaluate(INSTRUMENTAR);
await p.evaluate(ARRANCAR); await sleep(1500);
await p.evaluate(INYECTAR);

// ── Control: con el foco en el body el atajo sigue funcionando ──
await seccion(['control_body_espacio_alterna', 'control_body_flecha_derecha_salta_10', 'control_body_flecha_izquierda_salta_10'], async () => {
  await fijar(p); await neutro(p);
  const esp = await medir(p, 'Space');
  ok('control_body_espacio_alterna', esp.alterna === 1, { ...esp, foco: await foco(p) });
  await fijar(p); await neutro(p);
  const der = await medir(p, 'ArrowRight');
  ok('control_body_flecha_derecha_salta_10', der.saltos === 1 && Math.abs(der.delta - 10) < 0.6, der);
  const izq = await medir(p, 'ArrowLeft');
  ok('control_body_flecha_izquierda_salta_10', izq.saltos === 1 && Math.abs(izq.delta + 10) < 0.6, izq);
});

// ── (e) Campos: la tecla es del campo ──
await seccion(['textarea_espacio_escribe_y_no_alterna', 'textarea_flecha_no_salta'], async () => {
  await fijar(p); await clic(p, '#kf-ta');
  const esp = await medir(p, 'Space');
  const val = await p.evaluate(() => document.getElementById('kf-ta').value);
  ok('textarea_espacio_escribe_y_no_alterna', esp.alterna === 0 && val === ' ', { ...esp, valor: JSON.stringify(val) });
  const fl = await medir(p, 'ArrowRight');
  ok('textarea_flecha_no_salta', fl.saltos === 0, fl);
});
await seccion(['select_flecha_cambia_la_opcion_y_no_salta', 'select_espacio_no_alterna'], async () => {
  await fijar(p); await clic(p, '#kf-ta'); await p.keyboard.press('Tab');   // al select con Tab (un clic abre su lista)
  const f = await foco(p);
  const a = await p.evaluate(() => document.getElementById('kf-sel').value);
  const fl = await medir(p, 'ArrowDown');
  const fr = await medir(p, 'ArrowRight');
  const b = await p.evaluate(() => document.getElementById('kf-sel').value);
  ok('select_flecha_cambia_la_opcion_y_no_salta', f === 'kf-sel' && a !== b && fl.saltos === 0 && fr.saltos === 0, { foco: f, antes: a, despues: b, abajo: fl, derecha: fr });
  const esp = await medir(p, 'Space');
  ok('select_espacio_no_alterna', esp.alterna === 0, esp);
  await p.keyboard.press('Escape'); await sleep(150);
});
await seccion(['contenteditable_espacio_escribe_y_no_alterna', 'contenteditable_flecha_no_salta'], async () => {
  await fijar(p); await clic(p, '#kf-ce'); await p.keyboard.press('End');
  const a = await p.evaluate(() => document.getElementById('kf-ce').textContent);
  const esp = await medir(p, 'Space');
  const b = await p.evaluate(() => document.getElementById('kf-ce').textContent);
  ok('contenteditable_espacio_escribe_y_no_alterna', esp.alterna === 0 && b.length === a.length + 1, { ...esp, antes: a, despues: JSON.stringify(b) });
  const fl = await medir(p, 'ArrowRight');
  ok('contenteditable_flecha_no_salta', fl.saltos === 0, fl);
});
await seccion(['role_textbox_espacio_no_alterna', 'role_textbox_flecha_no_salta'], async () => {
  await fijar(p); await clic(p, '#kf-tb');
  const f = await foco(p);
  const esp = await medir(p, 'Space');
  ok('role_textbox_espacio_no_alterna', f === 'kf-tb' && esp.alterna === 0, { foco: f, ...esp });
  const fl = await medir(p, 'ArrowRight');
  ok('role_textbox_flecha_no_salta', fl.saltos === 0, fl);
});

// ── (d) Modificadores: ni Espacio ni flechas ──
for (const mod of ['Shift', 'Control', 'Alt', 'Meta']) {
  const k = `${mod.toLowerCase()}_con_espacio_y_flechas_no_actua`;
  await seccion([k], async () => {
    await fijar(p); await neutro(p);
    const r0 = await p.evaluate(() => location.pathname);
    const esp = await medir(p, `${mod}+Space`);
    const der = await medir(p, `${mod}+ArrowRight`);
    const izq = await medir(p, `${mod}+ArrowLeft`);
    const r1 = await p.evaluate(() => location.pathname);
    ok(k, esp.alterna === 0 && der.saltos === 0 && izq.saltos === 0, { espacio: esp.alterna, derecha: der.saltos, izquierda: izq.saltos, ruta: r0 === r1 ? r0 : [r0, r1] });
    if (r0 !== r1) { await p.goto(BASE + r0); await p.waitForSelector('.main-content h1', { timeout: 15000 }).catch(() => {}); await p.evaluate(INSTRUMENTAR); await p.evaluate(INYECTAR); await p.evaluate(ARRANCAR); await sleep(1500); }
  });
}

// ── (b) Repetición: mantener la tecla actúa UNA vez (el 1er keydown); los repetidos no ──
await seccion(['repeat_espacio_mantenido_alterna_una_vez', 'repeat_flecha_mantenida_salta_una_vez'], async () => {
  await fijar(p); await neutro(p);
  await reset(p);
  await p.keyboard.down('Space'); for (let i = 0; i < 4; i++) { await sleep(40); await p.keyboard.down('Space'); } await p.keyboard.up('Space'); await sleep(350);
  const e = await leer(p);
  ok('repeat_espacio_mantenido_alterna_una_vez', e.play + e.pause === 1, { alterna: e.play + e.pause, keydowns: 5 });
  await fijar(p); await neutro(p);
  await reset(p); const t0 = (await leer(p)).t;
  await p.keyboard.down('ArrowRight'); for (let i = 0; i < 4; i++) { await sleep(40); await p.keyboard.down('ArrowRight'); } await p.keyboard.up('ArrowRight'); await sleep(350);
  const f = await leer(p);
  ok('repeat_flecha_mantenida_salta_una_vez', f.seek === 1 && Math.abs(f.t - t0 - 10) < 0.6, { saltos: f.seek, delta: +(f.t - t0).toFixed(2), keydowns: 5 });
});

// ── (c) Composición (IME) — SINTÉTICO, ver cabecera ──
await seccion(['composicion_sintetica_no_actua'], async () => {
  await fijar(p); await neutro(p); await reset(p);
  await p.evaluate(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', isComposing: true, bubbles: true, cancelable: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', key: 'ArrowRight', isComposing: true, bubbles: true, cancelable: true }));
  });
  await sleep(350);
  const c = await leer(p);
  ok('composicion_sintetica_no_actua', c.play + c.pause === 0 && c.seek === 0, { alterna: c.play + c.pause, saltos: c.seek });
});

// ── Slider de posición: sigue ignorado (input, como siempre) ──
await seccion(['slider_posicion_espacio_no_alterna', 'slider_posicion_flecha_no_salta_10'], async () => {
  // Foco con un clic real del ratón sobre el slider (Tab desde el título recorre toda la Biblioteca);
  // el clic mueve la posición, así que se fija el punto DESPUÉS, sin teclado.
  const SLIDER = '.player-bar input[type="range"][aria-label="Posición"]';
  await clic(p, SLIDER); await fijar(p);
  const f = await p.evaluate((s) => document.activeElement?.matches(s), SLIDER);
  const esp = await medir(p, 'Space');
  ok('slider_posicion_espacio_no_alterna', f && esp.alterna === 0, { foco_en_slider: f, ...esp });
  const fl = await medir(p, 'ArrowRight');
  ok('slider_posicion_flecha_no_salta_10', fl.delta != null && Math.abs(fl.delta) < 5, { ...fl, nota: 'el slider mueve su propio paso (0.5 s); el atajo sumaría 10' });
});

// ══ Paso 2: Espacio sobre botones según cómo se llegó (Tab = teclado; clic o toque = puntero) ══
await seccion(['p2_tab_al_chip_espacio_lo_activa_sin_pausa'], async () => {
  await neutro(p); const tabs = await tabHasta(p, CHIP, 40);
  const c0 = await chipEstado(p); const e = await espacio(p); const c1 = await chipEstado(p);
  ok('p2_tab_al_chip_espacio_lo_activa_sin_pausa', tabs > 0 && c1 !== c0 && e.alterna === 0 && e.clics_al_foco === 1, { tabs, chip: [c0, c1], ...e });
});
await seccion(['p2_clic_en_el_chip_espacio_pausa_y_no_lo_cambia'], async () => {
  await neutro(p); await clic(p, CHIP); await sleep(400);
  const f = await enfocado(p, CHIP);
  const c0 = await chipEstado(p); const e = await espacio(p); const c1 = await chipEstado(p);
  ok('p2_clic_en_el_chip_espacio_pausa_y_no_lo_cambia', f && e.alterna === 1 && c1 === c0 && e.clics_al_foco === 0, { foco_en_chip: f, chip: [c0, c1], ...e });
});
await seccion(['p2_clic_y_tab_al_vecino_espacio_activa_el_vecino'], async () => {
  await neutro(p); await clic(p, CHIP); await sleep(400); await p.keyboard.press('Tab'); await sleep(150);
  const vecino = await p.evaluate(() => { const a = document.activeElement; return { etiqueta: a?.getAttribute('aria-label') || a?.textContent?.trim().slice(0, 30), boton: a?.tagName === 'BUTTON', en_reproductor: !!a?.closest('.player-bar, .player-expanded, .queue-panel, .lyrics-panel') }; });
  const e = await espacio(p);
  ok('p2_clic_y_tab_al_vecino_espacio_activa_el_vecino', vecino.boton && !vecino.en_reproductor && e.alterna === 0 && e.clics_al_foco === 1, { vecino, ...e });
});
await seccion(['p2_tab_al_chip_y_clic_espacio_pausa'], async () => {
  await neutro(p); const tabs = await tabHasta(p, CHIP, 40); await clic(p, CHIP); await sleep(400);
  const c0 = await chipEstado(p); const e = await espacio(p); const c1 = await chipEstado(p);
  ok('p2_tab_al_chip_y_clic_espacio_pausa', tabs > 0 && e.alterna === 1 && c1 === c0 && e.clics_al_foco === 0, { tabs, chip: [c0, c1], ...e });
});
await seccion(['p2_clic_en_el_chip_flecha_y_espacio_pausa'], async () => {
  await neutro(p); await clic(p, CHIP); await sleep(400); await p.keyboard.press('ArrowRight'); await sleep(200);
  const f = await enfocado(p, CHIP);
  const c0 = await chipEstado(p); const e = await espacio(p); const c1 = await chipEstado(p);
  ok('p2_clic_en_el_chip_flecha_y_espacio_pausa', f && e.alterna === 1 && c1 === c0 && e.clics_al_foco === 0, { foco_en_chip: f, chip: [c0, c1], ...e, nota: 'la flecha no cambia el modo' });
});
await seccion(['p2_shift_tab_cuenta_como_teclado'], async () => {
  // El vecino del chip se marca, se le hace clic con el mouse (modo puntero) y se vuelve al chip SÓLO con Shift+Tab.
  await neutro(p); await tabHasta(p, CHIP, 40); await p.keyboard.press('Tab'); await sleep(150);
  const marcado = await p.evaluate(() => { const a = document.activeElement; if (a?.tagName !== 'BUTTON') return false; a.setAttribute('data-kf-vecino', '1'); return true; });
  await clic(p, '[data-kf-vecino="1"]'); await sleep(300);
  const enVecino = await enfocado(p, '[data-kf-vecino="1"]');
  await p.keyboard.press('Shift+Tab'); await sleep(150);
  const enChip = await enfocado(p, CHIP);
  const c0 = await chipEstado(p); const e = await espacio(p); const c1 = await chipEstado(p);
  await p.evaluate(() => document.querySelector('[data-kf-vecino]')?.removeAttribute('data-kf-vecino'));
  ok('p2_shift_tab_cuenta_como_teclado', marcado && enVecino && enChip && c1 !== c0 && e.alterna === 0 && e.clics_al_foco === 1, { marcado, en_vecino_tras_clic: enVecino, en_chip_tras_shift_tab: enChip, chip: [c0, c1], ...e });
});
await seccion(['p2_tab_a_enlace_inyectado_espacio_pausa'], async () => {
  await clic(p, '#kf-tb'); await p.keyboard.press('Tab'); await sleep(150);
  const f = await foco(p); const h0 = await p.evaluate(() => location.hash);
  const e = await espacio(p); const h1 = await p.evaluate(() => location.hash);
  ok('p2_tab_a_enlace_inyectado_espacio_pausa', f === 'kf-a' && e.alterna === 1 && e.clics_al_foco === 0 && h0 === h1, { foco: f, hash: [h0, h1], ...e });
});

// ── Dentro del reproductor Espacio sigue pausando aunque se llegue con Tab ──
// A un control de la barra con Tab: desde un clic en el slider de posición (que está en la barra), hacia
// adelante y, si no aparece, hacia atrás (Tab desde el título recorre toda la Biblioteca).
const SLIDER_POS = '.player-bar input[type="range"][aria-label="Posición"]';
const tabEnLaBarra = async (sel) => {
  for (const tecla of ['Tab', 'Shift+Tab']) {
    await clic(p, SLIDER_POS); await sleep(150);
    for (let i = 0; i < 25; i++) { await p.keyboard.press(tecla); if (await enfocado(p, sel)) return { tabs: i + 1, tecla }; }
  }
  return { tabs: -1, tecla: null };
};
await seccion(['p2_tab_a_siguiente_espacio_pausa_sin_cambiar_pista'], async () => {
  const t = await tabEnLaBarra(SIG);
  const t0 = await pista(p); const e = await espacio(p); const t1 = await pista(p);
  ok('p2_tab_a_siguiente_espacio_pausa_sin_cambiar_pista', t.tabs > 0 && e.alterna === 1 && e.clics_al_foco === 0 && t0 != null && t0 === t1, { ...t, pista: [t0, t1], ...e });
});
await seccion(['p2_clic_en_siguiente_tab_espacio_pausa'], async () => {
  await clic(p, SIG); await sleep(600); await p.keyboard.press('Tab'); await sleep(150);
  const destino = await p.evaluate(() => { const a = document.activeElement; return { etiqueta: a?.getAttribute('aria-label') ?? a?.tagName, en_barra: !!a?.closest('.player-bar'), control: !!a?.closest('button, [role]') }; });
  const e = await espacio(p);
  ok('p2_clic_en_siguiente_tab_espacio_pausa', destino.en_barra && destino.control && e.alterna === 1 && e.clics_al_foco === 0, { destino, ...e });
});
await seccion(['p2_tab_al_boton_mas_espacio_pausa_sin_abrir_el_menu'], async () => {
  const t = await tabEnLaBarra(MAS);
  const e = await espacio(p);
  const menu = await p.evaluate(() => [...document.querySelectorAll('.ptp-menu')].filter((m) => m.getClientRects().length).length);
  ok('p2_tab_al_boton_mas_espacio_pausa_sin_abrir_el_menu', t.tabs > 0 && e.alterna === 1 && e.clics_al_foco === 0 && menu === 0, { ...t, menus_abiertos: menu, ...e });
});
let plMas = null;
await seccion(['p2_menu_mas_abierto_con_teclado_espacio_activa_la_opcion'], async () => {
  const nombre = `kf-mas-${Date.now().toString(36)}`;
  plMas = (await api('/api/playlists', { method: 'POST', body: JSON.stringify({ name: nombre }) }))?.id ?? null;
  const t = await tabEnLaBarra(MAS);
  await p.keyboard.press('Enter'); await sleep(800);   // Enter abre el menú (el atajo no mira Enter)
  const abierto = await p.evaluate(() => [...document.querySelectorAll('.player-bar .ptp-menu')].some((m) => m.getClientRects().length));
  let tabs = -1;
  for (let i = 0; i < 80 && tabs < 0; i++) {
    await p.keyboard.press('Tab');
    if (await p.evaluate((n) => { const a = document.activeElement; return !!a?.matches('.ptp-menu .ptp-item-main') && a.textContent.includes(n); }, nombre)) tabs = i + 1;
  }
  const e = await espacio(p, 900);
  const lista = await api(`/api/playlists/${plMas}/tracks`).catch(() => null);
  const n = Array.isArray(lista) ? lista.length : (lista?.tracks?.length ?? null);
  ok('p2_menu_mas_abierto_con_teclado_espacio_activa_la_opcion', t.tabs > 0 && abierto && tabs > 0 && e.alterna === 0 && e.clics_al_foco === 1 && n === 1, { ...t, menu_abierto: abierto, tabs_en_menu: tabs, pistas_en_la_playlist: n, ...e });
  await p.keyboard.press('Escape'); await sleep(300);
});
if (plMas != null) await api(`/api/playlists/${plMas}`, { method: 'DELETE' }).catch(() => {});
await seccion(['p2_tab_a_un_exp_btn_del_expandido_espacio_pausa'], async () => {
  const pt = await puntoNeutro(p, '.player-bar'); if (!pt) throw new Error('sin punto neutro en la barra');
  await p.mouse.click(pt.x, pt.y); await p.waitForSelector('.player-expanded', { timeout: 5000 }); await sleep(800);
  const q = await puntoNeutro(p, '.player-expanded'); if (!q) throw new Error('sin punto neutro en el expandido');
  await p.mouse.click(q.x, q.y); await sleep(200);
  const tabs = await tabHasta(p, '.player-expanded .exp-btn', 60);
  const cual = await p.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null);
  const e = await espacio(p);
  ok('p2_tab_a_un_exp_btn_del_expandido_espacio_pausa', tabs > 0 && e.alterna === 1 && e.clics_al_foco === 0, { tabs, boton: cual, ...e });
  await p.keyboard.press('Escape'); await sleep(900);
});

// ── Álbumes: foco programático tras un clic, menú cerrado con Esc y Tab a «Filtrar» ──
await seccion(['p2_filtrar_abierto_y_cerrado_con_mouse_espacio_pausa', 'p2_filtrar_cerrado_con_esc_espacio_pausa', 'p2_tab_a_filtrar_espacio_abre_el_panel'], async () => {
  await anotarMedios(p, '/');
  await p.goto(BASE + '/albums'); await p.waitForSelector('.af-btn', { timeout: 15000 });
  await p.evaluate(INSTRUMENTAR); await p.evaluate(ARRANCAR); await sleep(1500);
  await neutro(p); await clic(p, '.af-btn'); await sleep(300); await clic(p, '.af-btn'); await sleep(300);
  const f1 = await enfocado(p, '.af-btn'); const e1 = await espacio(p); const pan1 = await panelFiltrar(p);
  ok('p2_filtrar_abierto_y_cerrado_con_mouse_espacio_pausa', f1 && e1.alterna === 1 && e1.clics_al_foco === 0 && pan1 === 0, { foco_vuelve: f1, paneles: pan1, ...e1 });
  await neutro(p); await clic(p, '.af-btn'); await sleep(300);
  const abierto = await panelFiltrar(p); await p.keyboard.press('Escape'); await sleep(300);
  const f2 = await enfocado(p, '.af-btn'); const e2 = await espacio(p); const pan2 = await panelFiltrar(p);
  ok('p2_filtrar_cerrado_con_esc_espacio_pausa', abierto > 0 && f2 && e2.alterna === 1 && e2.clics_al_foco === 0 && pan2 === 0, { se_abrio: abierto, foco_vuelve: f2, paneles: pan2, ...e2 });
  await neutro(p); const tabs = await tabHasta(p, '.af-btn', 30);
  const e3 = await espacio(p); const pan3 = await panelFiltrar(p);
  ok('p2_tab_a_filtrar_espacio_abre_el_panel', tabs > 0 && e3.alterna === 0 && e3.clics_al_foco === 1 && pan3 > 0, { tabs, paneles: pan3, ...e3 });
  await p.keyboard.press('Escape'); await sleep(300);
});

// ── Dedo: un toque es puntero ──
const erroresExtra = [];
await seccion(['p2_toque_en_el_chip_espacio_pausa'], async () => {
  const d = await abrirSonando('/', '.library-tracks .track-row', { tactil: true });
  try {
    const b = await d.p.locator(CHIP).boundingBox(); await d.p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); await sleep(500);
    const f = await enfocado(d.p, CHIP);
    const c0 = await chipEstado(d.p); const e = await espacio(d.p); const c1 = await chipEstado(d.p);
    ok('p2_toque_en_el_chip_espacio_pausa', f && e.alterna === 1 && c1 === c0 && e.clics_al_foco === 0, { foco_en_chip: f, chip: [c0, c1], ...e });
    await anotarMedios(d.p, 'toque');
    erroresExtra.push(...d.errores);
  } finally { await d.ctx.close(); }
});

// ── (a) defaultPrevented: Espacio sobre una tarjeta de playlist en Búsqueda la abre (Search.jsx) y NO pausa ──
let plId = null;
await seccion(['busqueda_tarjeta_playlist_espacio_abre_y_no_alterna'], async () => {
  await anotarMedios(p, '/albums');
  const nombre = `kf-teclado-${Date.now().toString(36)}`;
  const pl = await api('/api/playlists', { method: 'POST', body: JSON.stringify({ name: nombre }) });
  plId = pl?.id ?? null;
  await p.goto(BASE + '/search'); await p.waitForSelector('.search-view', { timeout: 15000 });
  await p.evaluate(INSTRUMENTAR); await p.evaluate(ARRANCAR); await sleep(1500);
  await fijar(p);
  const input = p.locator('.search-view input').first();
  await input.click(); await p.keyboard.type(nombre, { delay: 10 });
  await p.waitForSelector('.search-group[data-group="playlists"] .playlist-item', { timeout: 8000 });
  const tabs = await tabHasta(p, '.search-group[data-group="playlists"] .playlist-item', 60);
  const esp = await medir(p, 'Space', 600);
  const ruta = await p.evaluate(() => location.pathname);
  ok('busqueda_tarjeta_playlist_espacio_abre_y_no_alterna', tabs > 0 && esp.alterna === 0 && ruta === `/playlists/${plId}`, { tabs, alterna: esp.alterna, ruta, esperada: `/playlists/${plId}` });
});
if (plId != null) await api(`/api/playlists/${plId}`, { method: 'DELETE' }).catch(() => {});

// ── Un solo elemento de audio en cada página de la corrida (el <video> no se usó) ──
const m = await leer(p);
mediosPorPagina.push({ donde: '/search', medios: m.medios });
ok('un_solo_elemento_de_media', m.medios === 1 && mediosPorPagina.every((x) => x.medios <= 1), { mediosPorPagina });
ok('sin_errores_de_pagina', errores.length === 0 && erroresExtra.length === 0, { errores, erroresExtra });

await ctx.close();
const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
// KF_DUMP=<archivo>: deja el detalle también en un archivo (el runner de regresión sólo muestra el conteo).
if (process.env.KF_DUMP) (await import('node:fs')).writeFileSync(process.env.KF_DUMP, JSON.stringify(R, null, 1));
console.log(`\nteclado-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
