// teclado-func.mjs — funcional del atajo GLOBAL de teclado del reproductor (PlayerContext.jsx, «Keyboard»):
// Espacio = play/pausa y ←/→ = ±10 s. Paso 1: el atajo NO actúa si (a) la tecla ya vino con
// defaultPrevented, (b) es repetición (repeat), (c) se está componiendo texto (isComposing), (d) lleva
// Ctrl/Alt/Meta/Shift, o (e) el foco está en input (cualquiera, incluye sliders), textarea, select,
// contenteditable o role textbox/combobox/searchbox. Si no, todo sigue como antes. Botones y enlaces
// SIGUEN capturados (Paso 2, aparte): esta prueba no los mira.
//
// Teclado, ratón y dedo REALES de Playwright (keyboard.press/down, mouse.click). ÚNICA excepción: la
// composición (c). Con el teclado real sólo hay composición dentro de un campo editable, y ahí ya corta (e);
// para que (c) tenga un caso que la delate, ese caso despacha un keydown sintético con isComposing:true
// sobre el body. Está marcado en su clave.
// La app no tiene textarea, select, contenteditable ni role=textbox: se inyectan SOLO en la página de
// prueba (no en la app) para probar el handler genérico.
// Qué hizo el reproductor se cuenta en el prototipo de HTMLMediaElement (play/pause y escrituras de
// currentTime), así no importa si el <audio> está en el DOM. Cuenta también cuántos elementos de media
// distintos tocó el atajo: tiene que ser UNO (nunca un segundo player).
//
// CONTROL NEGATIVO: contra un build SIN el Paso 1 (p. ej. v1.41.0) tienen que FALLAR los casos de campos,
// modificadores, repeat, composición y defaultPrevented; los de control (body) y el slider pasan igual.
// ⚠️ Reproduce pistas y crea (y borra) una playlist propia: correr contra la COPIA de la base.
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
};
const INYECTAR = () => {
  if (document.getElementById('kf')) return;
  const box = document.createElement('div'); box.id = 'kf';
  box.style.cssText = 'position:fixed;top:6px;left:320px;z-index:99999;background:#222;padding:6px;display:flex;gap:8px;align-items:center';
  box.innerHTML = '<textarea id="kf-ta" rows="1"></textarea>'
    + '<select id="kf-sel"><option>uno</option><option>dos</option><option>tres</option></select>'
    + '<div id="kf-ce" contenteditable="true" style="min-width:60px;color:#fff;border:1px solid #888">ab</div>'
    + '<div id="kf-tb" role="textbox" tabindex="0" style="min-width:60px;height:20px;border:1px solid #888"></div>';
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

// ── (a) defaultPrevented: Espacio sobre una tarjeta de playlist en Búsqueda la abre (Search.jsx) y NO pausa ──
let plId = null;
await seccion(['busqueda_tarjeta_playlist_espacio_abre_y_no_alterna'], async () => {
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

// ── Un solo elemento de audio en toda la corrida (el <video> no se usó) ──
const m = await leer(p);
ok('un_solo_elemento_de_media', m.medios === 1, { medios: m.medios });
ok('sin_errores_de_pagina', errores.length === 0, { errores });

await ctx.close();
const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
// KF_DUMP=<archivo>: deja el detalle también en un archivo (el runner de regresión sólo muestra el conteo).
if (process.env.KF_DUMP) (await import('node:fs')).writeFileSync(process.env.KF_DUMP, JSON.stringify(R, null, 1));
console.log(`\nteclado-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
