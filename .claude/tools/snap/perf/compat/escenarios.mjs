// compat/escenarios.mjs — los escenarios del arnés de compatibilidad. Cada uno es un módulo:
//   { id, titulo, aplica?(h), run(h, datos, ok) }
// `h` son las herramientas del perfil (compat/util.mjs), `datos` lo que se sabe de la biblioteca de
// la prueba (compat-matrix.mjs lo pide una vez) y `ok(clave, pasa, detalle)` anota una comprobación.
// Ninguno escribe en la biblioteca. El (g) usa videos sintéticos que pone y quita compat-matrix.mjs.
import { same, sleep } from './util.mjs';

const VISTAS = [['Biblioteca', '/'], ['Álbumes', '/albums'], ['Artistas', '/artists'], ['Géneros', '/genres'], ['Años', '/years'], ['Playlists', '/playlists'], ['Videos', '/videos']];
const LISTO = '.main-content .track-row, .main-content .album-card, .main-content .browse-item, .main-content .artist-portrait, .main-content .video-card, .main-content .empty-state, .main-content .pl-card, .main-content .section-title';

// ── a) Carga, pestañas y desborde horizontal ──
export const carga = {
  id: 'a', titulo: 'Carga, navegación por las pestañas y desborde horizontal',
  async run(h, datos, ok) {
    const { ctx, p, errores } = await h.abrir('/', { esperar: '.library-tracks .track-row' });
    const filas = await p.locator('.library-tracks .track-row').count();
    ok('a_carga_biblioteca', filas > 0 && !errores.length, { filas_montadas: filas, errores });
    // Las pestañas: barra de abajo en el teléfono, lateral desde 701 px. Lo que no está a la vista
    // (en el teléfono varias vistas viven detrás de otra pestaña) se anota aparte, no cuenta como fallo.
    const visitadas = [], sinBoton = [];
    for (const [nombre, ruta] of VISTAS) {
      const boton = p.locator('.bottom-nav-btn, .sidebar button').filter({ hasText: nombre }).filter({ visible: true }).first();
      if (!(await boton.count())) { sinBoton.push(nombre); continue; }
      await h.tap(p, boton);
      await p.waitForFunction((r) => decodeURI(location.pathname) === r, ruta, { timeout: 4000 }).catch(() => {});
      await p.waitForSelector(LISTO, { timeout: 6000 }).catch(() => {});
      visitadas.push({ nombre, llego: (await p.evaluate(() => decodeURI(location.pathname))) === ruta });
    }
    ok('a_pestanas', visitadas.length >= 3 && visitadas.every((v) => v.llego) && !errores.length, { visitadas: visitadas.map((v) => `${v.nombre}${v.llego ? '' : ' ✗'}`), sin_boton_a_la_vista: sinBoton, errores });
    await ctx.close();
    // Desborde: en el teléfono a 360, 390 y 430; en el resto, a su ancho.
    const base = p.viewportSize();
    for (const w of (h.movil ? [360, 390, 430] : [base.width])) {
      const o = await h.abrir('/', { viewport: { width: w, height: base.height }, esperar: '.library-tracks .track-row' });
      const malas = [];
      for (const [nombre, ruta] of VISTAS) {
        await o.p.goto(h.BASE + ruta); await o.p.waitForSelector(LISTO, { timeout: 6000 }).catch(() => {}); await o.p.waitForTimeout(350);
        const d = await o.p.evaluate(() => ({ sobra: document.documentElement.scrollWidth - window.innerWidth, inner: window.innerWidth }));
        if (d.sobra > 0) malas.push(`${nombre} +${d.sobra}px`);
      }
      ok(`a_sin_desborde_${w}`, malas.length === 0 && !o.errores.length, { vistas: VISTAS.length, desbordan: malas, errores: o.errores });
      await o.ctx.close();
    }
  },
};

// ── b) Inputs de búsqueda: 16 px o más (iOS hace zoom al enfocar si es menos) ──
export const inputs = {
  id: 'b', titulo: 'Inputs de búsqueda con font-size ≥ 16 px',
  aplica: (h) => h.perfil.touch,
  async run(h, datos, ok) {
    const { ctx, p } = await h.abrir('/', { esperar: '.library-tracks .track-row' });
    const vistos = [];
    for (const [nombre, ruta] of [...VISTAS, ['Novedades', '/changelog']]) {
      await p.goto(h.BASE + ruta); await p.waitForSelector(LISTO, { timeout: 6000 }).catch(() => {}); await p.waitForTimeout(350);
      const ins = await p.evaluate(() => [...document.querySelectorAll('.main-content input:not([type="range"]):not([type="checkbox"]):not([type="radio"]), .main-content textarea')]
        .filter((e) => e.getClientRects().length).map((e) => ({ px: parseFloat(getComputedStyle(e).fontSize), ph: e.getAttribute('placeholder') ?? e.getAttribute('aria-label') ?? '' })));
      for (const i of ins) vistos.push({ vista: nombre, ...i });
    }
    const chicos = vistos.filter((i) => i.px < 16);
    ok('b_inputs_16px', vistos.length > 0 && chicos.length === 0, { inputs: vistos.length, por_vista: vistos.map((i) => `${i.vista} ${i.px}px`), menores_de_16: chicos });
    await ctx.close();
  },
};

// ── c) <video>: playsinline, sin gesto falla de forma controlada, con gesto reproduce ──
export const video = {
  id: 'c', titulo: '<video> con playsinline; reproducir pide un gesto',
  async run(h, datos, ok) {
    if (!datos.videos.length) { ok('c_hay_videos', false, { motivo: 'GET /api/videos vino vacío (¿VIDEO_DIR sin fixtures?)' }); return; }
    const item = { ...datos.videos[0], kind: 'video' };
    // SIN gesto: se le pide al motor que reproduzca desde un script (no hay toque ni clic).
    {
      const { ctx, p, errores } = await h.abrir('/videos', { esperar: '.video-card' });
      const attrs = await p.evaluate(() => { const v = document.querySelector('video'); return v ? { playsInline: v.playsInline === true, attr: v.hasAttribute('playsinline'), webkit: v.hasAttribute('webkit-playsinline'), controls: v.controls } : null; });
      ok('c_playsinline', !!attrs && (attrs.playsInline || attrs.attr), attrs ?? { motivo: 'no hay <video> en el DOM' });
      await p.evaluate((it) => { window.__rechazos = []; window.addEventListener('unhandledrejection', (e) => window.__rechazos.push(String(e.reason?.name ?? e.reason))); window.__player().play([it], 0); }, item);
      await p.waitForTimeout(2500);
      const e1 = await h.estado(p); const rech = await p.evaluate(() => window.__rechazos);
      const reprodujo = !!e1.video && !e1.video.paused && e1.video.t > 0;
      // La UI no se cuelga: una pestaña sigue respondiendo.
      const boton = p.locator('.bottom-nav-btn, .sidebar button').filter({ hasText: 'Biblioteca' }).filter({ visible: true }).first();
      if (await p.locator('.player-expanded').count()) { await p.keyboard.press('Escape'); await sleep(400); }
      await h.tap(p, boton).catch(() => {}); await p.waitForFunction(() => location.pathname === '/', null, { timeout: 4000 }).catch(() => {});
      const responde = (await p.evaluate(() => location.pathname)) === '/';
      ok('c_sin_gesto_no_cuelga', responde && !errores.length && rech.length === 0,
        { sin_gesto: reprodujo ? 'reprodujo (el motor lo permitió)' : 'no reprodujo', estado_del_reproductor: { isPlaying: e1.isPlaying, video: e1.video }, la_ui_responde: responde, rechazos_sin_atrapar: rech, errores });
      // Si no reprodujo, el botón no puede decir «pausa»: el estado tiene que cuadrar con el medio.
      ok('c_sin_gesto_estado_coherente', reprodujo ? e1.isPlaying : !e1.isPlaying, { reprodujo, isPlaying: e1.isPlaying });
      await ctx.close();
    }
    // CON gesto: el toque en la tarjeta.
    {
      const { ctx, p, errores } = await h.abrir('/videos', { esperar: '.video-card' });
      await h.tap(p, p.locator('.video-card .video-cover-frame').first());
      await p.waitForFunction(() => { const v = document.querySelector('video'); return v && !v.paused && v.currentTime > 0; }, null, { timeout: 6000 }).catch(() => {});
      const e2 = await h.estado(p); const media = await p.evaluate(() => { const v = document.querySelector('video'); return v ? { error: v.error?.code ?? null, readyState: v.readyState, puede_mp4: v.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"') } : null; });
      ok('c_con_gesto_reproduce', e2.kind === 'video' && !!e2.video && !e2.video.paused && e2.video.t > 0 && !errores.length, { video: e2.video, isPlaying: e2.isPlaying, media, errores });
      await ctx.close();
    }
  },
};

// ── d) Safe areas y viewport-fit ──
export const safeAreas = {
  id: 'd', titulo: 'env(safe-area-inset-*) en la mini barra y el expandido; viewport-fit=cover',
  async run(h, datos, ok) {
    const { ctx, p } = await h.abrir('/', { esperar: '.library-tracks .track-row' });
    const meta = await p.evaluate(() => document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? null);
    ok('d_viewport_fit_cover', /viewport-fit\s*=\s*cover/.test(meta ?? ''), { meta });
    // Se lee el CSS que el navegador cargó (no el fuente): los selectores de cada bloque con env(safe-area-…).
    const usos = await p.evaluate(async () => {
      const hojas = [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href);
      const sel = new Set();
      for (const u of hojas) {
        const css = await (await fetch(u)).text();
        for (const m of css.matchAll(/safe-area-inset-(top|bottom|left|right)/g)) {
          const abre = css.lastIndexOf('{', m.index); const antes = Math.max(css.lastIndexOf('}', abre), css.lastIndexOf('{', abre - 1), css.lastIndexOf(';', abre));
          sel.add(css.slice(antes + 1, abre).trim().slice(0, 90));
        }
      }
      const probe = document.createElement('div'); probe.style.cssText = 'position:fixed;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
      document.body.appendChild(probe); const cs = getComputedStyle(probe); const valor = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft]; probe.remove();
      return { selectores: [...sel], valor_en_este_navegador: valor };
    });
    const hay = (re) => usos.selectores.filter((s) => re.test(s));
    ok('d_safe_area_en_la_barra', hay(/player-bar|bottom-nav|player-mini/).length > 0, { selectores: hay(/player-bar|bottom-nav|player-mini/).slice(0, 6) });
    ok('d_safe_area_en_el_expandido', hay(/player-expanded|exp-/).length > 0, { selectores: hay(/player-expanded|exp-/).slice(0, 6), total_de_bloques: usos.selectores.length, valor_de_env_en_este_navegador: usos.valor_en_este_navegador });
    await ctx.close();
  },
};

// ── e) Pulsación larga en una fila de Géneros y en una de Años ──
export const pulsacionLarga = {
  id: 'e', titulo: 'Pulsación larga: abre el menú y al soltar no navega ni reproduce',
  async run(h, datos, ok) {
    for (const [clave, ruta, fila] of [['generos', '/genres', '.main-content .genre-item'], ['anios', '/years', '.main-content .browse-list .browse-item']]) {
      const { ctx, p, errores } = await h.abrir(ruta, { esperar: fila });
      await h.pulsacionLarga(p, p.locator(fila).first());
      await h.esperarMenu(p);
      const e = await h.estado(p); const etiquetas = await h.etiquetasMenu(p);
      ok(`e_${clave}_abre_el_menu`, e.menu === 1 && etiquetas.length >= 2 && !errores.length, { toque: h.toque, menu: e.menu, tiles: e.tiles === 1, etiquetas, errores });
      await sleep(600);
      const e2 = await h.estado(p);
      ok(`e_${clave}_no_navega_ni_reproduce`, e2.ruta === ruta && e2.actual === null && e2.ids.length === 0, { ruta: e2.ruta, esperada: ruta, en_cola: e2.ids.length, sigue_el_menu: e2.menu === 1 });
      await ctx.close();
    }
  },
};

// ── f) Menú de Años con toque: «Reproducir año» y «Agregar a la cola» ──
export const menuAnios = {
  id: 'f', titulo: 'Menú de Años: «Reproducir año» y «Agregar a la cola» con toque',
  async run(h, datos, ok) {
    const { A, B, idsDe } = datos;
    const fila = (p, y) => p.locator('.main-content .browse-list .browse-item').filter({ has: p.locator('.browse-item-name', { hasText: new RegExp(`^${y}$`) }) }).first();
    const { ctx, p, errores } = await h.abrir('/years', { esperar: '.main-content .browse-list .browse-item' });
    await h.pulsacionLarga(p, fila(p, A)); await h.esperarMenu(p);
    const elegido = await h.elegirDelMenu(p, ['Reproducir año', 'Reproducir']);
    await p.waitForFunction((n) => window.__player().queue.length === n, idsDe(A).length, { timeout: 6000 }).catch(() => {});
    const e1 = await h.estado(p);
    ok('f_reproducir_anio_arma_la_cola', !!elegido && same(e1.ids, idsDe(A)) && e1.actual === idsDe(A)[0] && e1.ruta === '/years', { toque: h.toque, opcion: elegido, en_cola: e1.ids.length, esperadas: idsDe(A).length, actual: e1.actual, primera: idsDe(A)[0], ruta: e1.ruta });
    if (await h.audioSuena()) {
      await p.waitForFunction(() => window.__audio && !window.__audio.paused && window.__audio.currentTime > 0, null, { timeout: 6000 }).catch(() => {});
      const e2 = await h.estado(p);
      ok('f_reproducir_anio_suena', !!e2.audio && !e2.audio.paused && e2.audio.t > 0 && e2.isPlaying, { audio: e2.audio, isPlaying: e2.isPlaying });
    } else h.noMedible('f_reproducir_anio_suena', 'este navegador no reproduce el <audio> de prueba');
    await h.cerrarMenu(p);
    if ((await h.estado(p)).ruta !== '/years') { await p.goto(h.BASE + '/years'); await p.waitForSelector('.main-content .browse-list .browse-item').catch(() => {}); }
    const antes = (await h.estado(p)).ids;
    await h.pulsacionLarga(p, fila(p, B)); await h.esperarMenu(p);
    const elegido2 = await h.elegirDelMenu(p, ['Agregar a la cola', 'A la cola']);
    await p.waitForFunction((n) => window.__player().queue.length === n, antes.length + idsDe(B).length, { timeout: 6000 }).catch(() => {});
    await sleep(300);
    const e3 = await h.estado(p); const av = await h.avisos(p); const nB = idsDe(B).length;
    ok('f_agregar_a_la_cola', !!elegido2 && same(e3.ids, [...antes, ...idsDe(B)]) && av.includes(`«${B}» a la cola · ${nB} ${nB === 1 ? 'pista' : 'pistas'}`) && !errores.length, { opcion: elegido2, en_cola: e3.ids.length, esperadas: antes.length + nB, avisos: av, errores });
    await ctx.close();
  },
};

// ── g) Videos: el enlace de artista ──
export const videoArtista = {
  id: 'g', titulo: 'Videos: el enlace de artista navega y no reproduce; tamaño del área táctil',
  aplica: (h, datos) => !!datos.extras,
  async run(h, datos, ok) {
    const { artista, tituloExacto } = datos.extras;
    const card = (p) => p.locator('.video-card', { hasText: tituloExacto }).first();
    const { ctx, p, errores } = await h.abrir('/videos', { esperar: '.video-card' });
    const hay = (await card(p).locator('.video-artist-link').count()) > 0;
    ok('g_enlace_presente', hay, { tarjeta: tituloExacto, artista });
    let g = null;
    if (hay) {
      await card(p).scrollIntoViewIfNeeded().catch(() => {}); await sleep(300);
      g = await card(p).evaluate((c) => {
        const b = c.querySelector('.video-artist-link'), r = b.getBoundingClientRect(), cs = getComputedStyle(b);
        const en = (x, y) => !!document.elementFromPoint(x, y)?.closest('.video-artist-link');
        const t = c.querySelector('.album-name')?.getBoundingClientRect();
        return { alto: Math.round(r.height * 10) / 10, ancho: Math.round(r.width * 10) / 10, alto_del_texto: Math.round((r.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) * 10) / 10, fuente: cs.fontSize,
          centro: en(r.left + r.width / 2, r.top + r.height / 2), borde_arriba: en(r.left + r.width / 2, r.top + 2), borde_abajo: en(r.left + r.width / 2, r.bottom - 2),
          el_titulo_no_cae_en_el_enlace: t ? !en(t.left + Math.min(t.width, 40) / 2, t.top + t.height / 2) : null };
      });
    }
    // 32 px de alto donde hay dedo y la barra es la del teléfono; en el resto se informa la medida.
    ok('g_area_tactil', !!g && g.centro && g.el_titulo_no_cae_en_el_enlace !== false && (h.movil ? g.alto >= 32 && g.borde_arriba && g.borde_abajo : true), { toque: h.toque, exigido: h.movil ? 'alto ≥ 32 px' : 'sólo se informa (no es el diseño del teléfono)', ...(g ?? {}) });
    if (hay) { await h.tap(p, card(p).locator('.video-artist-link')); await sleep(800); }
    const e1 = await h.estado(p); const pagina = await p.locator('.artist-hero-name').first().textContent({ timeout: 3000 }).then((s) => s.trim()).catch(() => null);
    ok('g_toque_navega_y_no_reproduce', hay && pagina === artista && e1.ruta === `/artists/${artista}` && e1.actual === null && e1.ids.length === 0, { ruta: e1.ruta, pagina, suena: e1.titulo, en_cola: e1.ids.length });
    await p.goto(h.BASE + '/videos'); await p.waitForSelector('.video-card').catch(() => {}); await p.waitForTimeout(500);
    await h.tap(p, card(p).locator('.video-cover-frame')); await p.waitForFunction(() => window.__player().currentTrack?.kind === 'video', null, { timeout: 5000 }).catch(() => {});
    const e2 = await h.estado(p);
    ok('g_toque_en_la_portada_reproduce', e2.titulo === tituloExacto && e2.kind === 'video' && !errores.length, { suena: e2.titulo, kind: e2.kind, errores });
    await ctx.close();
  },
};

// ── h) «Reproducir año» con la biblioteca FRÍA: del toque a que suena ──
// Entra directo a /years (la biblioteca no está en memoria: yearTracks tiene que pedirla entera).
export const frio = {
  id: 'h', titulo: '«Reproducir año» con la biblioteca fría: tiempo hasta que suena',
  async run(h, datos, ok) {
    const { A, idsDe } = datos;
    if (!(await h.audioSuena())) { h.noMedible('h_frio_suena', 'este navegador no reproduce el <audio> de prueba'); return; }
    const { ctx, p, pedidos } = await h.abrir('/years', { esperar: '.main-content .browse-list .browse-item' });
    const fila = p.locator('.main-content .browse-list .browse-item').filter({ has: p.locator('.browse-item-name', { hasText: new RegExp(`^${A}$`) }) }).first();
    const deBiblioteca = (u) => u.startsWith('/api/tracks?') && u.includes('limit=10000');
    const antes = pedidos.filter(deBiblioteca).length;
    await h.pulsacionLarga(p, fila); await h.esperarMenu(p);
    const item = p.locator('.ctx-menu :is(.ctx-item, .ctx-tile)', { hasText: 'Reproducir' }).first();
    if (!(await item.count())) { ok('h_frio_suena', false, { motivo: 'no hay menú de año en este build' }); await ctx.close(); return; }
    await p.evaluate(() => { window.__t = { clic: null, cola: null, suena: null }; const f = () => { const v = window.__player?.(); const a = window.__audio; const now = performance.now();
      if (window.__t.clic != null) { if (window.__t.cola == null && v?.queue.length) window.__t.cola = now; if (window.__t.suena == null && a && !a.paused && a.currentTime > 0) window.__t.suena = now; }
      if (window.__t.suena == null) requestAnimationFrame(f); }; requestAnimationFrame(f); });
    await p.evaluate(() => { window.__t.clic = performance.now(); });
    await h.tap(p, item);
    await p.waitForFunction(() => window.__t.suena != null, null, { timeout: 10000 }).catch(() => {});
    const t = await p.evaluate(() => window.__t); const e = await h.estado(p);
    const pedidosBib = pedidos.filter(deBiblioteca).length - antes;
    ok('h_frio_suena', t.suena != null && same(e.ids, idsDe(A)), { toque: h.toque, ms_hasta_la_cola: t.cola != null ? Math.round(t.cola - t.clic) : null, ms_hasta_que_suena: t.suena != null ? Math.round(t.suena - t.clic) : null,
      pedidos_de_la_biblioteca_tras_el_toque: pedidosBib, pistas_en_la_biblioteca: datos.pistas, en_cola: e.ids.length, nota: 'incluye el tiempo del toque sintético y del WAV de prueba; la red es localhost' });
    await ctx.close();
  },
};

export const ESCENARIOS = [carga, inputs, video, safeAreas, pulsacionLarga, menuAnios, videoArtista, frio];
