// servidor-func.mjs — funcional de la tarjeta «Servidor» de Ajustes (EstadoServidor.jsx, sub-paso 3b).
//
// GET /api/servidor se responde DESDE ACÁ con ctx.route (el resto de la app va al backend real), y el
// reloj de la página es falso (p.clock.install, como search-years-func): el sondeo de 30 s se adelanta
// con fastForward, no se espera. La pestaña oculta se simula redefiniendo document.visibilityState y
// disparando visibilitychange.
//
// Comprueba, a 1440 salvo donde se dice:
//   · los cuatro estados (texto, icono, tono; versión; «Encendido hace …»; pie fijo) y la primera carga;
//   · sin respuesta por red (con un dato previo: valores atenuados y «Último dato hace …»), por HTML de
//     Access (200 text/html) y por un JSON con otra forma: «Sin respuesta» + «Si sigue, recarga la página»;
//   · que NUNCA se pide /api/admin/servidor (eso es 3c), aunque la respuesta diga admin:true;
//   · el sondeo: un pedido al montar, otro a los 30 s; nada con la pestaña oculta; al volver tras más de
//     30 s pide en el acto; una sola lectura en vuelo; salir de Ajustes lo corta; un 401 lo corta;
//   · aria-live SOLO en el estado (no en «hace N s») y el foco no se mueve; el tic de «hace N s» no toca
//     la tarjeta; a 390 con touch no desborda;
//   · sin errores de página; y UN caso sin mock contra el backend de verdad (snap@local: admin:false).
// Con SERVIDOR_CAPTURAS=<carpeta> además guarda Ajustes a 390 y 960 en ok, lento, mal y sin respuesta
// (no cuentan como casos). Con SERVIDOR_FUNC_SALIDA=<archivo> escribe ahí el detalle de cada caso.
// Termina con `servidor-func: N/N` y código 0/1 (modo name-line).
// Sólo lee: no escribe nada en la base.
// Uso: SNAP_BASE=http://localhost:4173 node servidor-func.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';

await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();

const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };
const errores = [];

const PIE = 'Mide solo el servidor, no tu conexión';
const HTML = '<!doctype html><html><head><title>Cloudflare Access</title></head><body>Iniciar sesión</body></html>';
const pub = (estado, extra = {}) => ({ estado, version: '1.43.0', uptime_s: 3 * 86400 + 4 * 3600 + 5, admin: false, ...extra });
const json = (cuerpo, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(cuerpo) });
const esServidor = (u) => new URL(u).pathname === '/api/servidor';
const esAdmin = (u) => new URL(u).pathname === '/api/admin/servidor';
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Una página en Ajustes. `responder(n)` (n = número de pedido, desde 1) devuelve lo que contesta
// /api/servidor: { status, contentType, body }, 'abortar', o { demoraMs, ... }. Sin responder: backend real.
async function abrir({ responder, ancho = 1440, alto = 900, movil = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: alto }, isMobile: movil, hasTouch: movil });
  await ctx.addInitScript((t) => localStorage.setItem('token', t), token);
  const c = { pedidos: 0, admin: 0 };
  ctx.on('request', (r) => { if (esAdmin(r.url())) c.admin++; });
  if (responder) {
    await ctx.route((u) => esServidor(u.href ?? u), async (route) => {
      const n = ++c.pedidos;
      const r = responder(n);
      if (r === 'abortar') return route.abort('failed');
      if (r?.demoraMs) await esperar(r.demoraMs);
      return route.fulfill(r);
    });
  } else {
    ctx.on('request', (r) => { if (esServidor(r.url())) c.pedidos++; });
  }
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errores.push(String(e?.message ?? e)));
  await p.clock.install();
  await p.goto(BASE + '/settings');
  await p.waitForSelector('.srv .srv-estado-texto');
  return { ctx, p, c };
}

const leer = (p) => p.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const filas = [...document.querySelectorAll('.srv .settings-row')].map((f) => ({ dt: f.querySelector('dt')?.textContent.trim(), dd: f.querySelector('dd')?.textContent.trim(), viejo: !!f.querySelector('dd.srv-viejo') }));
  const est = q('.srv .srv-estado');
  return {
    texto: q('.srv .srv-estado-texto')?.textContent.trim() ?? null,
    icono: q('.srv .srv-estado .srv-icono')?.getAttribute('data-icono') ?? null,
    iconoOculto: q('.srv .srv-estado .srv-icono')?.getAttribute('aria-hidden') === 'true',
    tono: [...(est?.classList ?? [])].find((c) => c.startsWith('srv-estado--'))?.slice(12) ?? null,
    color: est ? getComputedStyle(est).color : null,
    peso: est ? getComputedStyle(est).fontWeight : null,
    ayuda: q('.srv .srv-ayuda')?.textContent.trim() ?? null,
    filas,
    version: filas.find((f) => f.dt === 'Versión')?.dd ?? null,
    colorVersion: (() => { const f = [...document.querySelectorAll('.srv .settings-row')].find((x) => x.querySelector('dt')?.textContent.trim() === 'Versión'); return f ? getComputedStyle(f.querySelector('dd')).color : null; })(),
    encendido: filas.find((f) => f.dt === 'Encendido')?.dd ?? null,
    hace: q('.srv .srv-hace')?.textContent.trim() ?? null,
    pie: q('.srv .srv-pie')?.textContent.trim() ?? null,
  };
});
// Espera a que el texto del estado cambie a `texto` (el reloj falso sigue corriendo en tiempo real).
const hasta = (p, texto, ms = 4000) => p.waitForFunction((t) => document.querySelector('.srv .srv-estado-texto')?.textContent.trim() === t, texto, { timeout: ms }).then(() => true, () => false);
const ver = (p, v) => p.evaluate((v) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => v === 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
}, v);
// Sin rojo ni verde: ni el canal R ni el G dominan solos (el ámbar tiene R y G altos y B bajo; el gris, los tres iguales).
const sinRojoNiVerde = (rgb) => { const [r, g, b] = (rgb.match(/\d+/g) ?? []).map(Number); return !(r > 150 && g < 110 && b < 110) && !(g > 150 && r < 120 && b < 150); };

try {
  // ── Los cuatro estados ──
  const ESTADOS = {
    ok:        { texto: 'Funciona con normalidad',            icono: 'check',     tono: 'normal' },
    lento:     { texto: 'Va lento',                           icono: 'reloj',     tono: 'ambar' },
    mal:       { texto: 'Con problemas',                      icono: 'triangulo', tono: 'ambar-fuerte' },
    sin_datos: { texto: 'Recién encendido, todavía midiendo', icono: 'puntos',    tono: 'gris' },
  };
  for (const [estado, esp] of Object.entries(ESTADOS)) {
    const { ctx, p } = await abrir({ responder: () => json(pub(estado)) });
    const llego = await hasta(p, esp.texto);
    const v = await leer(p);
    const base = llego && v.icono === esp.icono && v.iconoOculto && v.tono === esp.tono && v.version === '1.43.0' && v.encendido === 'hace 3 d 4 h'
      && v.pie?.includes(PIE) && /^Actualizado hace \d+ s$/.test(v.hace ?? '') && v.ayuda === null && sinRojoNiVerde(v.color);
    // Con dato fresco la versión va en el color de texto (--text #f0f0f0), no atenuada.
    const extra = (estado === 'mal' ? Number(v.peso) >= 700 : true) && v.filas.every((f) => !f.viejo) && v.colorVersion === 'rgb(240, 240, 240)';
    ok(`est_${estado}`, base && extra, { visto: v });
    await ctx.close();
  }

  // ── Primera carga + sin respuesta por red, con un dato previo ──
  {
    const { ctx, p, c } = await abrir({ responder: (n) => (n === 1 ? { ...json(pub('ok')), demoraMs: 1200 } : 'abortar') });
    const cargando = await leer(p);
    await hasta(p, 'Funciona con normalidad');
    await p.clock.fastForward(31_000);
    const llego = await hasta(p, 'Sin respuesta');
    const v = await leer(p);
    ok('primera_carga_consultando', cargando.texto === 'Consultando el servidor…' && cargando.version === '—' && cargando.hace === null, { cargando });
    ok('sin_respuesta_red', llego && c.pedidos === 2 && v.ayuda === null && v.icono === 'sin-senal' && v.tono === 'gris'
      && v.version === '1.43.0' && v.filas.filter((f) => f.dt !== 'Estado').every((f) => f.viejo) && /^Último dato hace \d+ s$/.test(v.hace ?? '')
      && v.colorVersion === 'rgb(136, 136, 136)', { visto: v, pedidos: c.pedidos });   // atenuado de verdad: --text-muted #888
    await ctx.close();
  }

  // ── HTML de Access y JSON con otra forma ──
  for (const [caso, resp] of [['sin_respuesta_html', { status: 200, contentType: 'text/html', body: HTML }], ['json_forma_mala', json({ estado: 'regular', version: '9.9.9', uptime_s: 5, admin: false })]]) {
    const { ctx, p } = await abrir({ responder: () => resp });
    const llego = await hasta(p, 'Sin respuesta');
    const v = await leer(p);
    ok(caso, llego && v.ayuda === 'Si sigue, recarga la página' && v.version === '—' && v.encendido === '—' && v.hace === null, { visto: v });
    await ctx.close();
  }

  // ── Nunca se pide el endpoint de admin (3c), aunque diga admin:true ──
  {
    const { ctx, p, c } = await abrir({ responder: () => json(pub('ok', { admin: true })) });
    await hasta(p, 'Funciona con normalidad');
    await p.clock.fastForward(61_000); await esperar(500);
    ok('sin_pedido_admin', c.admin === 0 && c.pedidos >= 2, { admin: c.admin, pedidos: c.pedidos });
    await ctx.close();
  }

  // ── El sondeo: 30 s, pausa, vuelta, una en vuelo ──
  {
    const { ctx, p, c } = await abrir({ responder: () => json(pub('ok')) });
    await hasta(p, 'Funciona con normalidad');
    const alMontar = c.pedidos;
    await p.clock.fastForward(28_000); await esperar(300);
    const antes30 = c.pedidos;
    await p.clock.fastForward(3_000); await esperar(500);
    const a30 = c.pedidos;
    ok('sondeo_30s', alMontar === 1 && antes30 === 1 && a30 === 2, { alMontar, antes30, a30 });

    await ver(p, 'hidden');
    await p.clock.fastForward(120_000); await esperar(500);
    const oculta = c.pedidos;
    ok('pausa_oculta', oculta === a30, { antes: a30, oculta });

    await ver(p, 'visible'); await esperar(600);
    const visible = c.pedidos;
    ok('vuelve_visible_pide', visible === oculta + 1, { oculta, visible });
    await ctx.close();
  }
  {
    // La primera respuesta tarda 2 s de verdad; en ese rato la pestaña se oculta y vuelve (y pasaron
    // «más de 30 s» desde ninguna respuesta): no puede salir un segundo pedido.
    const { ctx, p, c } = await abrir({ responder: (n) => ({ ...json(pub('ok')), demoraMs: n === 1 ? 2000 : 0 }) });
    await ver(p, 'hidden'); await ver(p, 'visible'); await ver(p, 'hidden'); await ver(p, 'visible');
    await esperar(400);
    const enVuelo = c.pedidos;
    await hasta(p, 'Funciona con normalidad', 5000);
    await esperar(300);
    ok('una_en_vuelo', enVuelo === 1 && c.pedidos === 1, { enVuelo, despues: c.pedidos });
    await ctx.close();
  }

  // ── Salir de Ajustes corta el sondeo ──
  {
    const { ctx, p, c } = await abrir({ responder: () => json(pub('ok')) });
    await hasta(p, 'Funciona con normalidad');
    await p.evaluate(() => [...document.querySelectorAll('.sidebar button')].find((b) => b.textContent.trim().startsWith('Biblioteca'))?.click());
    const salio = await p.waitForFunction(() => !document.querySelector('.srv'), null, { timeout: 4000 }).then(() => true, () => false);
    const alSalir = c.pedidos;
    await p.clock.fastForward(120_000); await esperar(600);
    ok('sale_de_ajustes_corta', salio && c.pedidos === alSalir, { salio, alSalir, despues: c.pedidos });
    await ctx.close();
  }

  // ── Un 401 corta (y la app vuelve al login) ──
  {
    const { ctx, p, c } = await abrir({ responder: () => json({ error: 'Invalid token' }, 401) });
    await esperar(800);
    const tras = c.pedidos;
    await p.clock.fastForward(120_000); await esperar(600);
    ok('401_corta', tras === 1 && c.pedidos === 1, { tras, despues: c.pedidos, en_ajustes: await p.evaluate(() => !!document.querySelector('.srv')) });
    await ctx.close();
  }

  // ── aria-live solo en el estado; el foco no se mueve; el tic no toca la tarjeta ──
  {
    const { ctx, p } = await abrir({ responder: (n) => json(pub(n === 1 ? 'ok' : 'lento')) });
    await hasta(p, 'Funciona con normalidad');
    const foco0 = await p.evaluate(() => document.activeElement?.tagName ?? null);
    await p.clock.fastForward(31_000);
    const cambio = await hasta(p, 'Va lento');
    const a = await p.evaluate(() => {
      const vivos = [...document.querySelectorAll('.srv [aria-live]')];
      const hace = document.querySelector('.srv .srv-hace');
      return {
        vivos: vivos.length,
        esElEstado: vivos.length === 1 && vivos[0].classList.contains('srv-estado') && vivos[0].getAttribute('role') === 'status' && vivos[0].getAttribute('aria-live') === 'polite' && !!vivos[0].querySelector('.srv-estado-texto'),
        haceFuera: !!hace && !hace.closest('[aria-live]') && !hace.hasAttribute('aria-live') && !hace.closest('[role="status"]'),
        status: document.querySelectorAll('.srv [role="status"]').length,
        foco: document.activeElement?.tagName ?? null,
      };
    });
    ok('aria_live', cambio && a.vivos === 1 && a.esElEstado && a.haceFuera && a.status === 1, a);
    ok('sin_mover_foco', a.foco === foco0, { antes: foco0, despues: a.foco });

    // 3 s reales: «hace N s» cambia, la tarjeta (.settings-card) no recibe ni una mutación.
    await p.evaluate(() => {
      window.__mut = 0;
      new MutationObserver((ms) => { window.__mut += ms.length; }).observe(document.querySelector('.srv .settings-card'), { subtree: true, childList: true, characterData: true, attributes: true });
      window.__hace0 = document.querySelector('.srv .srv-hace')?.textContent;
    });
    await esperar(3200);
    const t = await p.evaluate(() => ({ mut: window.__mut, antes: window.__hace0, ahora: document.querySelector('.srv .srv-hace')?.textContent }));
    ok('hace_no_toca_tarjeta', t.mut === 0 && t.antes !== t.ahora, t);
    await ctx.close();
  }

  // ── Móvil 390 con touch ──
  {
    const { ctx, p } = await abrir({ ancho: 390, alto: 844, movil: true, responder: (n) => (n === 1 ? json(pub('mal')) : { status: 200, contentType: 'text/html', body: HTML }) });
    await hasta(p, 'Con problemas');
    const medir = () => p.evaluate(() => {
      const card = document.querySelector('.srv .settings-card').getBoundingClientRect();
      const cosas = [...document.querySelectorAll('.srv .srv-estado, .srv .srv-ayuda, .srv dd, .srv dt, .srv .srv-pie span')].map((e) => e.getBoundingClientRect());
      return {
        scroll: document.scrollingElement.scrollWidth, vw: window.innerWidth,
        card: { l: Math.round(card.left), r: Math.round(card.right) },
        dentro: cosas.every((r) => r.left >= card.left - 0.5 && r.right <= card.right + 0.5 || r.width === 0),
        apilado: [...document.querySelectorAll('.srv .settings-row')].every((f) => getComputedStyle(f).flexDirection === 'column'),
      };
    });
    const m1 = await medir();
    await p.clock.fastForward(31_000); await hasta(p, 'Sin respuesta');
    const m2 = await medir();
    const fine = (m) => m.scroll <= m.vw && m.card.r <= m.vw && m.dentro && m.apilado;
    ok('movil_390_sin_desborde', fine(m1) && fine(m2), { mal: m1, sin_respuesta: m2 });
    await ctx.close();
  }

  // ── Sin mock: el backend de verdad (snap@local no es admin) ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript((t) => localStorage.setItem('token', t), token);
    let admin = 0;
    ctx.on('request', (r) => { if (esAdmin(r.url())) admin++; });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errores.push(String(e?.message ?? e)));
    const resp = p.waitForResponse((r) => esServidor(r.url()), { timeout: 10_000 });
    await p.goto(BASE + '/settings');
    const r = await resp;
    const cuerpo = await r.json().catch(() => null);
    await p.waitForFunction(() => document.querySelector('.srv .srv-estado-texto')?.textContent.trim() !== 'Consultando el servidor…', null, { timeout: 6000 }).catch(() => {});
    const v = await leer(p);
    const textos = Object.values(ESTADOS).map((e) => e.texto);
    ok('real_snap_local', r.status() === 200 && cuerpo?.admin === false && ['ok', 'lento', 'mal', 'sin_datos'].includes(cuerpo?.estado)
      && textos.includes(v.texto) && v.version === cuerpo.version && /^\d+\.\d+\.\d+$/.test(v.version ?? '') && admin === 0,
    { status: r.status(), cuerpo, visto: { texto: v.texto, version: v.version, encendido: v.encendido }, admin });
    await ctx.close();
  }

  ok('sin_errores_pagina', errores.length === 0, { errores: errores.slice(0, 5) });

  // ── Capturas para revisión humana (no cuentan) ──
  const DIR = process.env.SERVIDOR_CAPTURAS;
  if (DIR) {
    mkdirSync(DIR, { recursive: true });
    const CASOS = { ok: () => json(pub('ok')), lento: () => json(pub('lento')), mal: () => json(pub('mal')) };
    for (const [ancho, alto, movil] of [[390, 844, true], [960, 900, false]]) {
      for (const [nombre, responder] of Object.entries(CASOS)) {
        const { ctx, p } = await abrir({ ancho, alto, movil, responder });
        await hasta(p, ESTADOS[nombre].texto); await esperar(1200);
        await p.locator('.srv').scrollIntoViewIfNeeded();
        await p.screenshot({ path: join(DIR, `ajustes-${ancho}-${nombre}.png`), fullPage: true });
        await ctx.close();
      }
      // Sin respuesta, con un dato previo (valores atenuados) y por HTML de Access (con la ayuda).
      const { ctx, p } = await abrir({ ancho, alto, movil, responder: (n) => (n === 1 ? json(pub('ok')) : { status: 200, contentType: 'text/html', body: HTML }) });
      await hasta(p, 'Funciona con normalidad'); await p.clock.fastForward(31_000); await hasta(p, 'Sin respuesta'); await esperar(1200);
      await p.locator('.srv').scrollIntoViewIfNeeded();
      await p.screenshot({ path: join(DIR, `ajustes-${ancho}-sin_respuesta.png`), fullPage: true });
      await ctx.close();
    }
    console.error(`[servidor-func] capturas en ${DIR}`);
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify(R, null, 1));
const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
// SERVIDOR_FUNC_SALIDA=<archivo>: el detalle de cada caso (el runner solo imprime el conteo).
if (process.env.SERVIDOR_FUNC_SALIDA) writeFileSync(process.env.SERVIDOR_FUNC_SALIDA, JSON.stringify({ fallan: fails.map(([k]) => k), casos: R }, null, 1));
console.log(`\nservidor-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
process.exit(fails.length ? 1 : 0);
