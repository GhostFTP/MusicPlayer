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
// `responderAdmin(n)` hace lo mismo para /api/admin/servidor (3c); sin él, ese pedido va al backend
// real (que a snap@local le contesta 403).
// `portapapeles` (3d) sustituye navigator.clipboard ANTES de que cargue la app, sin permisos reales:
//   'ok'    → writeText guarda el texto en window.__copias;
//   'falla' → writeText rechaza y document.execCommand devuelve false (queda el textarea a mano);
//   'exec'  → writeText rechaza y execCommand('copy') «copia» lo seleccionado en window.__copias.
async function abrir({ responder, responderAdmin, ancho = 1440, alto = 900, movil = false, portapapeles = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: alto }, isMobile: movil, hasTouch: movil });
  await ctx.addInitScript((t) => localStorage.setItem('token', t), token);
  if (portapapeles) {
    await ctx.addInitScript((modo) => {
      window.__copias = [];
      const writeText = modo === 'ok'
        ? async (t) => { window.__copias.push(t); }
        : async () => { throw new DOMException('denegado', 'NotAllowedError'); };
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
      if (modo !== 'ok') {
        document.execCommand = (cmd) => {
          if (modo === 'exec' && cmd === 'copy') { window.__copias.push(document.activeElement?.value ?? null); return true; }
          return false;
        };
      }
    }, portapapeles);
  }
  const c = { pedidos: 0, admin: 0 };
  ctx.on('request', (r) => { if (esAdmin(r.url())) c.admin++; });
  if (responderAdmin) {
    let n = 0;
    await ctx.route((u) => esAdmin(u.href ?? u), async (route) => {
      const r = responderAdmin(++n);
      if (r === 'abortar') return route.abort('failed');
      if (r?.demoraMs) await esperar(r.demoraMs);
      return route.fulfill(r);
    });
  }
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

// Solo lo PÚBLICO: la tarjeta (.srv > .settings-card) y su pie (.srv > .srv-pie). Desde 3c el detalle
// de admin también vive dentro de .srv, con sus propias filas, ayuda y «hace N s».
const leer = (p) => p.evaluate(() => {
  const q = (s) => document.querySelector(s.replace('.srv .srv-pie', '.srv > .srv-pie').replace('.srv .', '.srv > .settings-card .'));
  const filas = [...document.querySelectorAll('.srv > .settings-card .settings-row')].map((f) => ({ dt: f.querySelector('dt')?.textContent.trim(), dd: f.querySelector('dd')?.textContent.trim(), viejo: !!f.querySelector('dd.srv-viejo') }));
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
    colorVersion: (() => { const f = [...document.querySelectorAll('.srv > .settings-card .settings-row')].find((x) => x.querySelector('dt')?.textContent.trim() === 'Versión'); return f ? getComputedStyle(f.querySelector('dd')).color : null; })(),
    encendido: filas.find((f) => f.dt === 'Encendido')?.dd ?? null,
    hace: document.querySelector('.srv > .srv-pie .srv-hace')?.textContent.trim() ?? null,
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
// ── 3c: el JSON de admin (la forma de music-server/src/api/admin-servidor.js) ──
// `n` muestras cada 10 s que terminan en FIN; `pico` (ms) en la muestra `picoEn` (por defecto, la del medio).
const FIN = Date.UTC(2026, 10, 20, 20, 0, 0);
function adminJson({ n = 30, pico = null, picoEn = null, ...extra } = {}) {
  const muestras = Array.from({ length: n }, (_, i) => ({ t: FIN - (n - 1 - i) * 10_000, p99: 12 + (i % 3), max: 14 + (i % 4), rss: 63029248 }));
  if (pico !== null && n) { const k = picoEn ?? Math.floor(n / 2); muestras[k] = { ...muestras[k], p99: Math.round(pico * 0.85), max: pico }; }
  return {
    version: '1.43.0', version_paquete: '1.40.2', node: 'v22.18.0', uptime_s: 3 * 86400,
    memoria: { rss: 63029248, heap: 18874368 }, event_loop: { p50: 11.1, p99: 12.9, max: 14.5 }, muestras,
    base: { bytes: 94208, wal_bytes: 395552, pistas: 653, ultimo_escaneo: '2026-11-20 10:00:02' },
    videos: 'unavailable', locutor: null, sqlite_busy: 0, errores_500: 0, ...extra,
  };
}
const LOCUTOR_ABIERTO = { cliente: { encendido: true, circuito: 'abierto', fallosSeguidos: 3 }, servicio: { cache: 3, cola: 2, trabajando: false, generadas: 5, descartadas: 1, sinCupo: 0, errores: 1, rechazos: { extraccion: 2 } } };
const pubAdmin = () => json(pub('ok', { admin: true }));
// Abre el bloque «Ver detalle (admin)» y espera a que pinte algo (filas o aviso).
// Clic en el resumen con un techo corto: si el bloque no está (p. ej. ya lo escondió un 403), el caso
// falla con false en vez de tumbar la suite con el timeout de 30 s de Playwright.
const clicResumen = (p) => p.locator('.srv-admin-resumen').click({ timeout: 3000 }).then(() => true, () => false);
async function abrirDetalle(p) {
  if (!(await clicResumen(p))) return false;
  return p.waitForSelector('.srv-admin-filas, .srv-admin-aviso--fallo', { timeout: 5000 }).then(() => true, () => false);
}
const leerAdmin = (p) => p.evaluate(() => {
  const filas = Object.fromEntries([...document.querySelectorAll('.srv-admin-filas .settings-row')].map((f) => [f.querySelector('dt').textContent.trim(), f.querySelector('dd').textContent.trim()]));
  const svg = document.querySelector('.srv-grafica-svg');
  const pts = (s) => (document.querySelector(s)?.getAttribute('points') ?? '').trim().split(/\s+/).filter(Boolean).length;
  return {
    hay: !!document.querySelector('.srv-admin'),
    abierto: document.querySelector('.srv-admin')?.open ?? null,
    resumen: document.querySelector('.srv-admin-resumen')?.textContent.trim() ?? null,
    filas,
    aviso: document.querySelector('.srv-admin-aviso--fallo .srv-admin-fallo-texto')?.textContent.trim() ?? null,
    ayuda: document.querySelector('.srv-admin-aviso--fallo .srv-ayuda')?.textContent.trim() ?? null,
    guias: [...document.querySelectorAll('.srv-grafica-svg .srv-guia')].map((g) => g.getAttribute('data-valor')),
    etiquetas: [...document.querySelectorAll('.srv-guia-etiqueta')].map((e) => e.textContent.trim()),
    puntosP99: pts('.srv-linea-p99'), puntosMax: pts('.srv-linea-max'),
    role: svg?.getAttribute('role') ?? null, aria: svg?.getAttribute('aria-label') ?? null,
    pico: document.querySelector('.srv-grafica-pico')?.textContent.trim() ?? null,
    eje: [...document.querySelectorAll('.srv-grafica-eje span')].map((e) => e.textContent.trim()),
  };
});
// La hora «HH:MM» de un instante, con la zona de la PÁGINA (lo mismo que hace horaLocal en la app).
const horaEnPagina = (p, t) => p.evaluate((t) => new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit', hour12: false }).format(t), t);
const fechaEnPagina = (p, ms) => p.evaluate((ms) => new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(ms), ms);

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
      // En la TARJETA (desde 3d hay otra región viva, la de «Copiado», fuera de ella: va en copiar_feedback_aria).
      const vivos = [...document.querySelectorAll('.srv > .settings-card [aria-live]')];
      const hace = document.querySelector('.srv .srv-hace');
      return {
        vivos: vivos.length,
        esElEstado: vivos.length === 1 && vivos[0].classList.contains('srv-estado') && vivos[0].getAttribute('role') === 'status' && vivos[0].getAttribute('aria-live') === 'polite' && !!vivos[0].querySelector('.srv-estado-texto'),
        haceFuera: !!hace && !hace.closest('[aria-live]') && !hace.hasAttribute('aria-live') && !hace.closest('[role="status"]'),
        status: document.querySelectorAll('.srv > .settings-card [role="status"]').length,
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

  // ═══ 3c: el detalle de admin ═══

  // Usuario normal: ni rastro del bloque, ni un pedido al detalle.
  {
    const { ctx, p, c } = await abrir({ responder: () => json(pub('ok')), responderAdmin: () => json(adminJson()) });
    await hasta(p, 'Funciona con normalidad');
    await p.clock.fastForward(61_000); await esperar(500);
    const a = await leerAdmin(p);
    const texto = await p.evaluate(() => document.querySelector('.srv').textContent);
    ok('usuario_sin_detalle', !a.hay && !/detalle|admin/i.test(texto) && c.admin === 0, { hay: a.hay, admin: c.admin });
    await ctx.close();
  }
  // Admin: el bloque está, cerrado, y cerrado no pide nada.
  {
    const { ctx, p, c } = await abrir({ responder: pubAdmin, responderAdmin: () => json(adminJson()) });
    await hasta(p, 'Funciona con normalidad');
    await p.waitForSelector('.srv-admin', { timeout: 3000 }).catch(() => {});
    await p.clock.fastForward(61_000); await esperar(500);
    const a = await leerAdmin(p);
    ok('admin_detalle_cerrado_sin_pedido', a.hay && a.abierto === false && a.resumen === 'Ver detalle (admin)' && c.admin === 0 && c.pedidos >= 2, { ...a, filas: undefined, admin: c.admin });
    // Abrir: UN pedido, y las filas con sus textos.
    const pinto = await abrirDetalle(p); await esperar(800);
    const b = await leerAdmin(p);
    const f = b.filas;
    const escaneo = await fechaEnPagina(p, Date.UTC(2026, 10, 20, 10, 0, 2));
    ok('admin_abre_pide_una_vez', pinto && c.admin === 1 && b.abierto === true
      && f['Atraso del event loop'] === 'p50 11 ms · p99 13 ms · máx 15 ms (últimos 10 s)'
      && f['Memoria'] === '60 MB (heap 18 MB)' && f['Base'] === '92 KB · WAL 386 KB' && f['Pistas'] === '653'
      && f['Último escaneo'] === escaneo && f['Desde el arranque'] === 'SQLITE_BUSY 0 · errores 500 0' && f['Versión del paquete'] === '1.40.2'
      && b.eje.join('|') === 'hace 60 min|ahora', { admin: c.admin, filas: f, escaneo, eje: b.eje });
    ok('videos_unavailable_texto', f['Videos'] === 'Sin consultar o no disponible', { videos: f['Videos'] });
    ok('locutor_apagado', f['Locutor'] === 'Apagado', { locutor: f['Locutor'] });

    // La gráfica no se redibuja con el tic de «hace N s» (3 s reales).
    await p.evaluate(() => {
      window.__mutG = 0;
      new MutationObserver((ms) => { window.__mutG += ms.length; }).observe(document.querySelector('.srv-grafica'), { subtree: true, childList: true, characterData: true, attributes: true });
      window.__haceG = document.querySelector('.srv-admin-cuerpo .srv-hace')?.textContent;
    });
    await esperar(3200);
    const m = await p.evaluate(() => ({ mut: window.__mutG, antes: window.__haceG, ahora: document.querySelector('.srv-admin-cuerpo .srv-hace')?.textContent }));
    ok('grafica_no_se_redibuja', m.mut === 0 && m.antes !== m.ahora, m);
    await ctx.close();
  }
  // Abierto: cada 30 s; oculta no pide; al volver (más de 30 s) pide en el acto.
  {
    const { ctx, p, c } = await abrir({ responder: pubAdmin, responderAdmin: () => json(adminJson()) });
    await hasta(p, 'Funciona con normalidad');
    await p.waitForSelector('.srv-admin', { timeout: 3000 }).catch(() => {});
    await abrirDetalle(p); await esperar(500);
    const alAbrir = c.admin;
    await p.clock.fastForward(31_000); await esperar(600);
    const a30 = c.admin;
    await ver(p, 'hidden'); await p.clock.fastForward(61_000); await esperar(500);
    const oculta = c.admin;
    await ver(p, 'visible'); await esperar(700);
    const visible = c.admin;
    ok('admin_sondeo_30s_solo_abierto', alAbrir === 1 && a30 === 2 && oculta === 2 && visible === 3, { alAbrir, a30, oculta, visible });
    await ctx.close();
  }
  // Cerrar el bloque detiene su sondeo (lo público sigue); reabrir pide en el acto.
  {
    const { ctx, p, c } = await abrir({ responder: pubAdmin, responderAdmin: () => json(adminJson()) });
    await hasta(p, 'Funciona con normalidad');
    await p.waitForSelector('.srv-admin', { timeout: 3000 }).catch(() => {});
    await abrirDetalle(p); await esperar(500);
    const abierto = c.admin;
    await clicResumen(p); await esperar(300);
    const cerrado = await p.evaluate(() => document.querySelector('.srv-admin')?.open === false);
    const pub0 = c.pedidos;
    await p.clock.fastForward(91_000); await esperar(600);
    const tras = c.admin;
    const pubSigue = c.pedidos > pub0;
    await abrirDetalle(p); await esperar(600);
    ok('admin_cierra_detiene', abierto === 1 && cerrado && tras === 1 && pubSigue && c.admin === 2, { abierto, cerrado, tras, pubSigue, reabrir: c.admin });
    await ctx.close();
  }
  // 403 en el detalle: el bloque desaparece, lo público queda, y no se vuelve a pedir.
  {
    const { ctx, p, c } = await abrir({ responder: pubAdmin, responderAdmin: () => json({ error: 'admin required' }, 403) });
    await hasta(p, 'Funciona con normalidad');
    await p.waitForSelector('.srv-admin', { timeout: 3000 }).catch(() => {});
    const hizoClic = await clicResumen(p);
    const oculto = await p.waitForFunction(() => !document.querySelector('.srv-admin'), null, { timeout: 4000 }).then(() => true, () => false);
    await p.clock.fastForward(61_000); await esperar(600);
    const v = await leer(p);
    // hizoClic: el bloque tenía que estar (cerrado y SIN pedir) hasta el clic; el 403 llega recién al abrir.
    ok('admin_403_oculta', hizoClic && oculto && c.admin === 1 && v.texto === 'Funciona con normalidad' && !(await leerAdmin(p)).hay, { hizoClic, oculto, admin: c.admin, publico: v.texto });
    await ctx.close();
  }
  // JSON de admin con otra forma: «Sin respuesta» SOLO en el detalle.
  {
    const { ctx, p } = await abrir({ responder: pubAdmin, responderAdmin: () => json({ ...adminJson(), muestras: [null] }) });
    await hasta(p, 'Funciona con normalidad');
    await p.waitForSelector('.srv-admin', { timeout: 3000 }).catch(() => {});
    await abrirDetalle(p);
    const a = await leerAdmin(p);
    const v = await leer(p);
    ok('admin_forma_mala', a.aviso === 'Sin respuesta' && a.ayuda === 'Si sigue, recarga la página' && Object.keys(a.filas).length === 0
      && v.texto === 'Funciona con normalidad' && v.ayuda === null, { aviso: a.aviso, ayuda: a.ayuda, publico: v.texto, publicoAyuda: v.ayuda });
    await ctx.close();
  }
  // La gráfica: guías, 360 muestras, aria con el pico; versión del paquete; locutor encendido.
  {
    const conDetalle = async (admin) => {
      const r = await abrir({ responder: pubAdmin, responderAdmin: () => json(admin) });
      await hasta(r.p, 'Funciona con normalidad');
      await r.p.waitForSelector('.srv-admin', { timeout: 3000 }).catch(() => {});
      await abrirDetalle(r.p);
      return { ...r, a: await leerAdmin(r.p) };
    };
    const bajo = await conDetalle(adminJson({ n: 60, pico: 120 }));
    const alto = await conDetalle(adminJson({ n: 60, pico: 600 }));
    ok('grafica_guias', bajo.a.guias.join(',') === '100' && bajo.a.etiquetas.join('|') === 'lento · 100 ms'
      && alto.a.guias.join(',') === '100,500' && alto.a.etiquetas.join('|') === 'lento · 100 ms|mal · 500 ms', { bajo: [bajo.a.guias, bajo.a.etiquetas], alto: [alto.a.guias, alto.a.etiquetas] });
    const tPico = FIN - (60 - 1 - 30) * 10_000;
    const hora = await horaEnPagina(alto.p, tPico);
    ok('grafica_aria_pico', alto.a.role === 'img' && alto.a.aria === `Atraso en la última hora. Pico: 600 ms a las ${hora}` && alto.a.pico === `Pico: 600 ms a las ${hora}`, { aria: alto.a.aria, pico: alto.a.pico, hora });
    await bajo.ctx.close(); await alto.ctx.close();

    const m360 = await conDetalle(adminJson({ n: 360 }));
    ok('grafica_360_muestras', m360.a.puntosP99 === 360 && m360.a.puntosMax === 360, { p99: m360.a.puntosP99, max: m360.a.puntosMax });
    await m360.ctx.close();

    const igual = await conDetalle(adminJson({ version_paquete: '1.43.0', locutor: LOCUTOR_ABIERTO }));
    ok('version_paquete_si_difiere', !('Versión del paquete' in igual.a.filas), { filas: Object.keys(igual.a.filas) });
    ok('locutor_encendido', igual.a.filas['Locutor'] === 'Encendido · circuito en pausa por fallos · generadas 5 · errores 1 · cola 2', { locutor: igual.a.filas['Locutor'] });
    await igual.ctx.close();
  }
  // 390 con touch: 360 muestras, pico alto, números enormes y el locutor encendido: nada desborda.
  {
    const enorme = adminJson({ n: 360, pico: 600, memoria: { rss: 3.5 * 1024 ** 4, heap: 987654321098 }, base: { bytes: Math.round(7.2 * 1024 ** 4), wal_bytes: 999999999999, pistas: 1234567, ultimo_escaneo: '2026-11-20 10:00:02' },
      sqlite_busy: 9999999, errores_500: 8888888, locutor: { ...LOCUTOR_ABIERTO, servicio: { ...LOCUTOR_ABIERTO.servicio, generadas: 123456789, errores: 987654321, cola: 20 } } });
    const { ctx, p } = await abrir({ ancho: 390, alto: 844, movil: true, responder: pubAdmin, responderAdmin: () => json(enorme) });
    await hasta(p, 'Funciona con normalidad');
    await p.waitForSelector('.srv-admin', { timeout: 3000 }).catch(() => {});
    await abrirDetalle(p); await esperar(400);
    const m = await p.evaluate(() => {
      // Sin gráfica (p. ej. el JSON no validó) el caso falla con `sinGrafica`, no tumba la suite.
      if (!document.querySelector('.srv-grafica-svg')) return { sinGrafica: true, aviso: document.querySelector('.srv-admin-aviso')?.textContent ?? null };
      const sec = document.querySelector('.srv').getBoundingClientRect();
      const fig = document.querySelector('.srv-grafica').getBoundingClientRect();
      const svg = document.querySelector('.srv-grafica-svg').getBoundingClientRect();
      const cosas = [...document.querySelectorAll('.srv-admin dd, .srv-admin dt, .srv-guia-etiqueta, .srv-grafica-pico, .srv-grafica-eje span, .srv-admin-resumen')].map((e) => e.getBoundingClientRect());
      return {
        scroll: document.scrollingElement.scrollWidth, vw: window.innerWidth,
        seccion: { l: Math.round(sec.left), r: Math.round(sec.right) },
        svg: { l: Math.round(svg.left), r: Math.round(svg.right), w: Math.round(svg.width) }, figura: { l: Math.round(fig.left), r: Math.round(fig.right) },
        dentro: cosas.every((r) => r.width === 0 || (r.left >= sec.left - 0.5 && r.right <= sec.right + 0.5)),
      };
    });
    const llena = !m.sinGrafica && m.svg.w >= (m.figura.r - m.figura.l) - 2 * 14 - 2;   // el lienzo ocupa el ancho de la tarjeta (menos su padding y borde)
    ok('admin_390_sin_desborde', !m.sinGrafica && m.scroll <= m.vw && m.seccion.r <= m.vw && m.dentro && llena, m);
    await ctx.close();
  }

  // ═══ 3d: «Copiar diagnóstico» ═══
  const ADMIN_CLAVES = ['detalle leído', 'event loop', 'pico de la hora', 'memoria', 'base', 'desde el arranque', 'locutor', 'videos'];
  const lineasDe = (t) => Object.fromEntries((t ?? '').split('\n').map((l) => { const i = l.indexOf(': '); return [l.slice(0, i), l.slice(i + 2)]; }));
  // Clic en «Copiar diagnóstico» y lo que quedó en el portapapeles falso (o null).
  async function copiar(p) {
    const antes = await p.evaluate(() => window.__copias?.length ?? 0);
    await p.locator('.srv-copiar-boton').click({ timeout: 3000 }).catch(() => {});
    await p.waitForFunction((n) => (window.__copias?.length ?? 0) > n || !!document.querySelector('.srv-copiar-texto'), antes, { timeout: 3000 }).catch(() => {});
    return p.evaluate((n) => window.__copias?.[n] ?? null, antes);
  }
  const buildEnPagina = (p) => p.evaluate(() => {
    for (const s of document.querySelectorAll('script[src]')) { const m = /\/assets\/index-([A-Za-z0-9_-]{4,64})\.js(?:$|\?)/.exec(s.getAttribute('src')); if (m) return m[1]; }
    return 'dev';
  });
  const FECHA = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC[+-]\d{2}:\d{2}( \([A-Za-z_]+(\/[A-Za-z0-9_+-]+)*\))?$/;

  // Público: lo de la tarjeta, la versión del cliente, el navegador y la pestaña; nada de admin.
  {
    const { ctx, p, c } = await abrir({ responder: () => json(pub('ok')), portapapeles: 'ok' });
    await hasta(p, 'Funciona con normalidad');
    const t = await copiar(p);
    const L = lineasDe(t);
    const build = await buildEnPagina(p);
    const ua = await p.evaluate(() => navigator.userAgent);
    ok('copiar_publico', !!t && L['diagnóstico'] === 'SonoraRev · estado del servidor' && FECHA.test(L['fecha'] ?? '') && L['estado'] === 'Funciona con normalidad'
      && /^hace \d+ s$/.test(L['última lectura'] ?? '') && L['versión del servidor'] === '1.43.0' && L['versión del cliente'] === build && build !== 'dev'
      && L['encendido'] === 'hace 3 d 4 h' && L['navegador'] === ua && L['pestaña'] === 'visible' && !ADMIN_CLAVES.some((k) => k in L) && c.admin === 0,
    { texto: t, build });
    await ctx.close();
  }
  // Sin respuesta: con lo último que hubo, y sin ningún dato nunca.
  {
    const a = await abrir({ responder: (n) => (n === 1 ? json(pub('ok')) : 'abortar'), portapapeles: 'ok' });
    await hasta(a.p, 'Funciona con normalidad'); await a.p.clock.fastForward(31_000); await hasta(a.p, 'Sin respuesta');
    const La = lineasDe(await copiar(a.p));
    await a.ctx.close();
    const b = await abrir({ responder: () => 'abortar', portapapeles: 'ok' });
    await hasta(b.p, 'Sin respuesta');
    const Lb = lineasDe(await copiar(b.p));
    await b.ctx.close();
    ok('copiar_sin_respuesta', La['estado'] === 'Sin respuesta' && /^hace \d+ s$/.test(La['última lectura'] ?? '') && La['versión del servidor'] === '1.43.0' && La['encendido'] === 'hace 3 d 4 h'
      && Lb['estado'] === 'Sin respuesta' && Lb['última lectura'] === 'nunca' && Lb['versión del servidor'] === '—' && Lb['encendido'] === '—' && !!Lb['versión del cliente'], { con_dato: La, sin_dato: Lb });
  }
  // Admin con el detalle ABIERTO y cargado: van las líneas del detalle.
  {
    const { ctx, p } = await abrir({ responder: pubAdmin, responderAdmin: () => json(adminJson({ n: 60, pico: 600 })), portapapeles: 'ok' });
    await hasta(p, 'Funciona con normalidad');
    await p.waitForSelector('.srv-admin', { timeout: 3000 }).catch(() => {});
    await abrirDetalle(p); await esperar(300);
    const L = lineasDe(await copiar(p));
    const hora = await horaEnPagina(p, FIN - (60 - 1 - 30) * 10_000);
    ok('copiar_admin_incluye_detalle', /^hace \d+ s$/.test(L['detalle leído'] ?? '') && L['event loop'] === 'p50 11 ms · p99 13 ms · máx 15 ms (últimos 10 s)' && L['pico de la hora'] === `600 ms a las ${hora}`
      && L['memoria'] === '60 MB (heap 18 MB)' && L['base'] === '92 KB · WAL 386 KB' && L['desde el arranque'] === 'SQLITE_BUSY 0 · errores 500 0'
      && L['locutor'] === 'Apagado' && L['videos'] === 'Sin consultar o no disponible', { L, hora });
    await ctx.close();
  }
  // Admin con el bloque CERRADO: nada de admin y copiar no pide el endpoint. Abrir y cerrar: tampoco.
  {
    const { ctx, p, c } = await abrir({ responder: pubAdmin, responderAdmin: () => json(adminJson()), portapapeles: 'ok' });
    await hasta(p, 'Funciona con normalidad');
    await p.waitForSelector('.srv-admin', { timeout: 3000 }).catch(() => {});
    const L1 = lineasDe(await copiar(p)); await esperar(400);
    const pedidos1 = c.admin;
    await abrirDetalle(p); await esperar(400);
    await clicResumen(p); await esperar(300);
    const L2 = lineasDe(await copiar(p)); await esperar(400);
    ok('copiar_admin_cerrado_no_pide', pedidos1 === 0 && c.admin === 1 && !ADMIN_CLAVES.some((k) => k in L1) && !ADMIN_CLAVES.some((k) => k in L2) && L1['estado'] === 'Funciona con normalidad',
      { pedidos_al_copiar_cerrado: pedidos1, pedidos_total: c.admin, claves1: Object.keys(L1), claves2: Object.keys(L2) });
    await ctx.close();
  }
  // Ningún secreto: el token REAL del fixture (el de localStorage), el usuario, cookies, URLs.
  {
    const { ctx, p } = await abrir({ responder: pubAdmin, responderAdmin: () => json(adminJson({ n: 60, pico: 600, locutor: LOCUTOR_ABIERTO })), portapapeles: 'ok' });
    await hasta(p, 'Funciona con normalidad');
    await p.waitForSelector('.srv-admin', { timeout: 3000 }).catch(() => {});
    await abrirDetalle(p); await esperar(300);
    const t = await copiar(p);
    const { tk, cookie, ua } = await p.evaluate(() => ({ tk: localStorage.getItem('token'), cookie: document.cookie, ua: navigator.userAgent }));
    const sinUa = (t ?? '').replace(ua, '');
    const partes = (tk ?? '').split('.').filter((x) => x.length >= 8);
    ok('copiar_no_incluye_secretos', !!t && !!tk && tk === token && !t.includes(tk) && partes.every((x) => !t.includes(x)) && (!cookie || !t.includes(cookie))
      && !/snap@local|bearer|authorization|cookie|token|localhost|127\.0\.0\.1|:\/\/|\?|@/i.test(sinUa) && 'event loop' in lineasDe(t),
    { largo_token: tk?.length ?? 0, hay_cookie: !!cookie, claves: Object.keys(lineasDe(t)) });
    await ctx.close();
  }
  // Sin portapapeles ni execCommand: el texto queda a la vista, readonly y seleccionado.
  {
    const { ctx, p } = await abrir({ responder: () => json(pub('ok')), portapapeles: 'falla' });
    await hasta(p, 'Funciona con normalidad');
    await copiar(p);
    const m = await p.evaluate(() => {
      const ta = document.querySelector('.srv-copiar-texto');
      return ta ? { ro: ta.readOnly, inicio: ta.value.slice(0, 13), sel: [ta.selectionStart, ta.selectionEnd, ta.value.length], foco: document.activeElement === ta,
        aviso: document.querySelector('.srv-copiar-aviso')?.textContent.trim(), etiqueta: document.querySelector('.srv-copiar-etiqueta')?.textContent.trim() } : null;
    });
    ok('copiar_fallback_textarea', !!m && m.ro && m.inicio === 'diagnóstico: ' && m.sel[0] === 0 && m.sel[1] === m.sel[2] && m.foco
      && m.aviso === 'No pude copiar solo: selecciona y copia' && m.etiqueta === 'Copiar diagnóstico', m);
    await ctx.close();
  }
  // El camino del medio: sin clipboard, pero execCommand('copy') sí copia (y el foco vuelve al botón).
  {
    const { ctx, p } = await abrir({ responder: () => json(pub('ok')), portapapeles: 'exec' });
    await hasta(p, 'Funciona con normalidad');
    const t = await copiar(p);
    const m = await p.evaluate(() => ({ etiqueta: document.querySelector('.srv-copiar-etiqueta')?.textContent.trim(), foco: document.activeElement?.classList.contains('srv-copiar-boton'), manual: !!document.querySelector('.srv-copiar-texto') }));
    ok('copiar_exec_command', (t ?? '').startsWith('diagnóstico: ') && m.etiqueta === 'Copiado' && m.foco && !m.manual, { inicio: t?.slice(0, 30), ...m });
    await ctx.close();
  }
  // «Copiado» ~2 s, en una región role=status hermana del botón; el foco se queda; sin color de estado.
  {
    const { ctx, p } = await abrir({ responder: () => json(pub('ok')), portapapeles: 'ok' });
    await hasta(p, 'Funciona con normalidad');
    const colorAntes = await p.evaluate(() => getComputedStyle(document.querySelector('.srv-copiar-boton')).color);
    await copiar(p);
    const d = await p.evaluate(() => {
      const b = document.querySelector('.srv-copiar-boton');
      const st = document.querySelector('.srv-copiar [role="status"]');
      return {
        etiqueta: b.querySelector('.srv-copiar-etiqueta').textContent.trim(), tipo: b.getAttribute('type'),
        status: st?.textContent.trim() ?? null, vivo: st?.getAttribute('aria-live') ?? null, fueraDelBoton: !!st && !b.contains(st),
        foco: document.activeElement === b, color: getComputedStyle(b).color,
      };
    });
    await p.clock.fastForward(2_100); await esperar(300);
    const despues = await p.evaluate(() => ({ etiqueta: document.querySelector('.srv-copiar-etiqueta').textContent.trim(), status: document.querySelector('.srv-copiar [role="status"]').textContent.trim() }));
    ok('copiar_feedback_aria', d.etiqueta === 'Copiado' && d.tipo === 'button' && d.status === 'Copiado' && d.vivo === 'polite' && d.fueraDelBoton && d.foco
      && d.color === colorAntes && d.color === 'rgb(240, 240, 240)' && sinRojoNiVerde(d.color) && despues.etiqueta === 'Copiar diagnóstico' && despues.status === '',
    { durante: d, despues, colorAntes });
    await ctx.close();
  }
  // 390 con touch: el botón a lo ancho y el textarea de respaldo, sin desborde.
  {
    const { ctx, p } = await abrir({ ancho: 390, alto: 844, movil: true, responder: () => json(pub('mal')), portapapeles: 'falla' });
    await hasta(p, 'Con problemas');
    const antes = await p.evaluate(() => { const s = document.querySelector('.srv').getBoundingClientRect(), b = document.querySelector('.srv-copiar-boton').getBoundingClientRect(); return { s: [s.left, s.right], b: [b.left, b.right, b.height] }; });
    await copiar(p); await esperar(200);
    const m = await p.evaluate(() => {
      const s = document.querySelector('.srv').getBoundingClientRect();
      const r = (q) => { const e = document.querySelector(q); if (!e) return null; const x = e.getBoundingClientRect(); return [x.left, x.right]; };
      return { scroll: document.scrollingElement.scrollWidth, vw: window.innerWidth, s: [s.left, s.right], ta: r('.srv-copiar-texto'), aviso: r('.srv-copiar-aviso'), b: r('.srv-copiar-boton'), fs: getComputedStyle(document.querySelector('.srv-copiar-texto') ?? document.body).fontSize };
    });
    const dentro = (x) => !!x && x[0] >= m.s[0] - 0.5 && x[1] <= m.s[1] + 0.5;
    ok('copiar_390_sin_desborde', m.scroll <= m.vw && dentro(m.ta) && dentro(m.aviso) && dentro(m.b) && Math.abs((antes.b[1] - antes.b[0]) - (antes.s[1] - antes.s[0])) < 1 && antes.b[2] >= 44 && m.fs === '16px',
      { antes, ...m });
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
    // 3c: con admin y el detalle abierto (captura de la sección entera, aunque sea más alta que la ventana).
    const ADMIN = { abierto: adminJson({ n: 30 }), pico120: adminJson({ n: 120, pico: 120 }), pico600: adminJson({ n: 120, pico: 600 }), m360: adminJson({ n: 360 }) };
    for (const [ancho, alto, movil] of [[390, 844, true], [960, 900, false]]) {
      for (const [nombre, admin] of Object.entries(ADMIN)) {
        const { ctx, p } = await abrir({ ancho, alto, movil, responder: pubAdmin, responderAdmin: () => json(admin) });
        await hasta(p, 'Funciona con normalidad');
        await p.waitForSelector('.srv-admin', { timeout: 3000 }).catch(() => {});
        await abrirDetalle(p); await esperar(1200);
        // La sección abierta es más alta que la ventana y lo que queda fuera no se pinta: para la foto,
        // la ventana crece hasta que la sección entra entera.
        const altoSec = await p.evaluate(() => Math.ceil(document.querySelector('.srv').getBoundingClientRect().height));
        await p.setViewportSize({ width: ancho, height: Math.max(alto, altoSec + 600) });
        await esperar(400);
        await p.locator('.srv').screenshot({ path: join(DIR, `admin-${ancho}-${nombre}.png`) });
        await ctx.close();
      }
    }
    // 3d: el botón normal, «Copiado» y el textarea de respaldo.
    for (const [ancho, alto, movil] of [[390, 844, true], [960, 900, false]]) {
      for (const [nombre, modo] of [['normal', 'ok'], ['copiado', 'ok'], ['textarea', 'falla']]) {
        const { ctx, p } = await abrir({ ancho, alto, movil, responder: () => json(pub('ok')), portapapeles: modo });
        await hasta(p, 'Funciona con normalidad'); await esperar(800);
        if (nombre !== 'normal') await copiar(p);
        await esperar(200);
        const altoSec = await p.evaluate(() => Math.ceil(document.querySelector('.srv').getBoundingClientRect().height));
        await p.setViewportSize({ width: ancho, height: Math.max(alto, altoSec + 600) });
        await esperar(300);
        await p.locator('.srv').screenshot({ path: join(DIR, `copiar-${ancho}-${nombre}.png`) });
        await ctx.close();
      }
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
