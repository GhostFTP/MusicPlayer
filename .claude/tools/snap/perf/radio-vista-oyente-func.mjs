// radio-vista-oyente-func.mjs — la vista de quien ESCUCHA y de quien MODERA (1.46.0, R3: RadioOyente.jsx) y el chip
// de la radio en la barra (RadioChip.jsx), contra el BUILD DE PRODUCCIÓN (preview :4173) y el backend REAL del runner
// (:3100). El montaje es el de radio-oyente-comun.mjs (la cuenta del oyente y su SALA FALSA FK…): quién escucha, quién
// modera y los eventos los pone la prueba. Para «Tu radio» (el chip de quien transmite) se abre una radio REAL de la
// cuenta del oyente, una sola, y se termina desde la vista.
//
// Casos (1440 px salvo los VO_390_*):
//   VO_1440_cabecera_y_dos_columnas   «La radio de Anfitriona», «En vivo», «3 escuchando, contigo» (te cuenta: antes
//        «1 oyente» eras tú) y «Salir de la radio»; dos columnas más anchas que los 640 px de antes, sin scroll horizontal.
//   VO_suena_ahora_con_portada_y_la_pidio   portada, título y artista de lo que suena, «La pidió Sonia» (por su evento),
//        el avance que corre y «Pausar para mí»; sin botones de quien modera.
//   VO_despues_suena                  la siguiente que publica la radio (nextTrackId), con su artista.
//   VO_quien_escucha_con_tu_marcado   Anfitriona (Transmite), Sonia (Modera), Beto y «Tú» al final.
//   VO_lo_que_paso                    el evento, en «Lo que pasó».
//   VO_sin_tarjetas_apagadas_ni_fila_ni_chat   sin «Tu radio» ni «Iniciar radio» mientras escuchas; sin fila ni chat.
//   VO_pausar_para_mi_y_volver_al_vivo   te silencia a ti («En pausa para ti…», el botón dice «Volver al vivo») y vuelve.
//   VO_chip_oyente_en_la_barra_abre_radio   «En la radio de Anfitriona» en la barra; desde Álbumes, tocarlo abre /radio.
//   VO_390_pestanas_radio_y_gente     pestañas Radio / Gente (sin Fila ni Chat), una a la vez, teclado ← →, sin scroll.
//   VO_390_chip_en_la_barra_pequena_sin_tapar   el chip va en la barra pequeña, dentro de ella y sin pisar sus botones.
//   VO_moderador_siguiente_manda_la_orden   quien modera: «Modera» en la cabecera y en «Tú», «Siguiente» (nombre
//        «Siguiente canción de la radio») y «Pausar la radio»; «Siguiente» manda la orden 'siguiente'.
//   VO_chip_anfitrion_tu_radio        con tu radio abierta: «Tu radio» en la barra (1440 y 390) y tocarlo abre /radio.
//   VO_sin_errores_de_pagina
//
// CONTROL NEGATIVO (a mano): sin pasar quién modera al oyente (RadioContext) cae VO_quien_escucha (Sonia sin «Modera»);
// volviendo la tarjeta «Tu radio» apagada cae VO_sin_tarjetas; con el chip mini en la fila de botones cae VO_390_chip.
// Uso: SNAP_BASE=http://localhost:4173 SNAP_USER=… SNAP_PASS=… SNAP2_USER=… SNAP2_PASS=… node radio-vista-oyente-func.mjs
// OYENTE_VISTA_DUMP=<archivo>: deja ahí los resultados. OYENTE_CAPTURAS=<carpeta>: saca las capturas (no cambia el conteo).
import {
  R, ok, sleep, tokOye, api, A, B, p, errores, esperar, foto, HOST_FK, YO_FK, FK, salaFalsa, estadoFk, escuchar,
  sonandoEn, irA, salirFk, TXT_SILENCIADA, salas, BASE, browser, ctx,
} from './radio-oyente-comun.mjs';

const T0 = Date.now();
const CAPTURAS = process.env.OYENTE_CAPTURAS || null;
const SONIA = { id: 990101, name: 'Sonia', avatar: null };
const BETO = { id: 990102, name: 'Beto', avatar: null };
let idEv = 0;
const ev = (type, by, byName, extra = {}) => ({ id: ++idEv, type, by, byName, target: null, targetName: null, trackId: null, title: null, at: Date.now(), ...extra });

const leer = () => p.evaluate(() => {
  const txt = (sel, r = document) => r?.querySelector(sel)?.textContent ?? null;
  const vis = (el) => !!el && el.offsetParent !== null && getComputedStyle(el).display !== 'none';
  const caja = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) }; };
  const w = document.querySelector('.radio-escucha');
  const cols = w?.querySelector('.radio-transmite-cols');
  const barra = w?.querySelector('.radio-avance-barra');
  const chipB = document.querySelector('.radio-chip--barra'); const chipM = document.querySelector('.radio-chip--mini');
  const titulos = [...document.querySelectorAll('.main-content .radio-card-title')].map((h) => h.textContent.trim());
  return {
    path: location.pathname, hay: !!w, ancho: document.documentElement.scrollWidth, vw: innerWidth,
    anchoVista: Math.round(w?.getBoundingClientRect().width ?? 0), columnas: cols ? getComputedStyle(cols).gridTemplateColumns.split(' ').length : 0,
    titulo: txt('.radio-anfitrion-nombre', w), enVivo: txt('.radio-en-vivo', w), cuantos: txt('.radio-escucha-cuantos', w),
    insigniaCab: txt('.radio-escucha-cabecera .radio-insignia', w), salir: !!w?.querySelector('.radio-escucha-cabecera .radio-terminar .radio-btn'),
    pestanas: [...document.querySelectorAll('[role="tab"]')].map((b) => ({ texto: b.textContent, sel: b.getAttribute('aria-selected') })),
    paneles: document.querySelectorAll('[role="tabpanel"]').length,
    cancion: txt('.radio-ahora-cancion', w), artista: txt('.radio-ahora-artista', w), pidio: txt('.radio-ahora-pidio', w),
    portada: !!w?.querySelector('.radio-ahora .radio-portada'), avance: barra ? Number(barra.getAttribute('aria-valuenow')) : null,
    controles: [...(w?.querySelectorAll('.radio-ahora-controles .radio-btn') ?? [])].map((b) => ({ texto: b.textContent.trim(), label: b.getAttribute('aria-label') })),
    despues: txt('.radio-despues .radio-cola-titulo', w), despuesSub: txt('.radio-despues .radio-cola-pidio', w),
    personas: [...(w?.querySelectorAll('.radio-escucha-personas .radio-persona') ?? [])].map((li) => ({ nombre: txt('.radio-persona-nombre', li), insignia: txt('.radio-insignia', li) })),
    eventos: [...(w?.querySelectorAll('.radio-eventos li') ?? [])].map((li) => li.textContent),
    aviso: txt('.radio-aviso-vivo', w),
    iniciar: [...document.querySelectorAll('.main-content button')].some((b) => /Iniciar radio/.test(b.textContent)),
    tuRadio: titulos.includes('Tu radio'), fila: titulos.some((t) => /fila/i.test(t)),
    chat: /chat|próximamente/i.test(document.querySelector('.main-content')?.textContent ?? ''),
    chipBarra: vis(chipB) ? chipB.textContent : null, chipMini: vis(chipM) ? chipM.textContent : null,
    cajaChip: caja(chipM), cajaBotones: caja(document.querySelector('.player-mini-controls')), cajaBarra: caja(document.querySelector('.player-bar')),
    anfitrionTu: !!document.querySelector('.radio-transmite:not(.radio-escucha) .radio-codigo'),
    foco: document.activeElement?.textContent?.trim().slice(0, 40) ?? null, focoRol: document.activeElement?.getAttribute('role') ?? null,
  };
});

// ── Capturas (opcionales): página entera (a 390 se alarga la ventana a lo que mide el contenido, que scrollea dentro
//    de .main-content) o solo la barra; los toasts se esconden SOLO durante la foto. ──
const fotos = { hechas: [], fallas: [] };
const sacar = async (nombre, anchos, soloBarra = false) => {
  if (!CAPTURAS) return;
  const { mkdirSync } = await import('node:fs'); const { join } = await import('node:path');
  mkdirSync(CAPTURAS, { recursive: true });
  const antes = p.viewportSize();
  for (const w of anchos) {
    try {
      await p.setViewportSize({ width: w, height: w === 390 ? 844 : 900 }); await sleep(500);
      if (w === 390 && !soloBarra) {
        const alto = await p.evaluate(() => { const m = document.querySelector('.main-content'); return m ? m.scrollHeight - m.clientHeight : 0; });
        if (alto > 0) { await p.setViewportSize({ width: w, height: 844 + alto }); await sleep(400); }
      }
      const estilo = await p.addStyleTag({ content: '.toast-layer { visibility: hidden !important; }' });
      const f = join(CAPTURAS, `${nombre}-${w}.png`);
      if (soloBarra) await p.locator('.player-bar').screenshot({ path: f }); else await p.screenshot({ path: f, fullPage: true });
      fotos.hechas.push(f);
      await estilo.evaluate((n) => n.remove());
    } catch (e) { fotos.fallas.push(`${nombre}-${w}: ${String(e.message).split('\n')[0]}`); }
  }
  await p.setViewportSize(antes); await sleep(400);
};

try {
  await p.goto(BASE + '/');
  await p.waitForSelector('.player-bar', { timeout: 15000 });
  await p.waitForFunction(() => !!window.__player?.() && !!window.__radio?.());

  // ── 1440: quien escucha ──
  const code = salaFalsa({ listeners: [HOST_FK, YO_FK, SONIA, BETO], mod: { moderators: [SONIA], events: [], until: 0, lost: false } });
  const s = FK[code];
  estadoFk(code, { trackId: A.id, positionMs: 40_000, playing: true, nextTrackId: B.id });
  await escuchar(code);
  const sono = await sonandoEn(A.id);
  if (!sono.v) throw new Error('la radio falsa no sonó');
  await irA('/radio'); await sleep(600);
  // El pedido de Sonia: un evento DESPUÉS de entrar (los de antes del cursor no se leen).
  s.mod.events.push(ev('a-continuacion', SONIA.id, 'Sonia', { trackId: A.id, title: A.title ?? null })); s.mod.until = idEv;
  const conTodo = await esperar(async () => { const x = await leer(); return x.pidio && x.personas.some((y) => y.nombre === 'Sonia' && y.insignia === 'Modera') ? x : null; }, 9000, 150);
  let v = conTodo.v ?? await leer();
  ok('VO_1440_cabecera_y_dos_columnas', v.titulo === 'La radio de Anfitriona' && v.enVivo === 'En vivo' && v.cuantos === '3 escuchando, contigo' && v.salir
    && v.columnas === 2 && v.anchoVista > 900 && v.pestanas.length === 0 && v.ancho <= v.vw && v.insigniaCab === null,
    { titulo: v.titulo, enVivo: v.enVivo, cuantos: v.cuantos, salir: v.salir, columnas: v.columnas, anchoVista: v.anchoVista, ancho: v.ancho });
  const a0 = v.avance; await sleep(1600); const v1 = await leer();
  ok('VO_suena_ahora_con_portada_y_la_pidio', v.cancion === (A.title ?? 'Sin título') && (A.artist ? v.artista === A.artist : true) && v.portada && v.pidio === 'La pidió Sonia'
    && v1.avance > a0 && v.controles.length === 1 && v.controles[0].texto === 'Pausar para mí',
    { cancion: v.cancion, artista: v.artista, pidio: v.pidio, avance: [a0, v1.avance], controles: v.controles });
  ok('VO_despues_suena', v.despues === (B.title ?? 'Sin título') && (B.artist ? v.despuesSub?.startsWith(B.artist) : true), { despues: v.despues, sub: v.despuesSub });
  ok('VO_quien_escucha_con_tu_marcado', JSON.stringify(v.personas) === JSON.stringify([
    { nombre: 'Anfitriona', insignia: 'Transmite' }, { nombre: 'Sonia', insignia: 'Modera' }, { nombre: 'Beto', insignia: null }, { nombre: 'Tú', insignia: null }]), { personas: v.personas });
  ok('VO_lo_que_paso', v.eventos[0] === `Sonia puso «${A.title}» a continuación`, { eventos: v.eventos });
  ok('VO_sin_tarjetas_apagadas_ni_fila_ni_chat', !v.iniciar && !v.tuRadio && !v.fila && !v.chat, { iniciar: v.iniciar, tuRadio: v.tuRadio, fila: v.fila, chat: v.chat });
  await sacar('1-oyente', [1440, 390]);

  await p.getByRole('button', { name: 'Pausar para mí' }).click();
  const callada = await esperar(async () => { const f = await foto(); const x = await leer(); return f.silenciada && x.aviso === TXT_SILENCIADA && x.controles[0]?.texto === 'Volver al vivo' ? x : null; }, 6000, 150);
  await p.getByRole('button', { name: 'Volver al vivo' }).click();
  const vivo = await esperar(async () => { const f = await foto(); return !f.silenciada && f.isPlaying && !f.paused && f.actual === A.id ? f : null; }, 8000, 150);
  ok('VO_pausar_para_mi_y_volver_al_vivo', !!callada.v && !!vivo.v, { callada: !!callada.v, vivo: !!vivo.v });

  // El chip en la barra: desde otra vista, tocarlo abre Radio.
  await irA('/albums'); await sleep(600);
  const vAlb = await leer();
  await p.locator('.radio-chip--barra').click(); await sleep(700);
  const vChip = await leer();
  ok('VO_chip_oyente_en_la_barra_abre_radio', vAlb.chipBarra === 'En la radio de Anfitriona' && vAlb.chipMini === null && vChip.path === '/radio' && vChip.hay,
    { chip: vAlb.chipBarra, mini: vAlb.chipMini, path: vChip.path, vista: vChip.hay });
  await sacar('5-chip-oyente-barra', [1440, 390], true);

  // ── 390: pestañas Radio / Gente y el chip en la barra pequeña ──
  await p.setViewportSize({ width: 390, height: 844 }); await sleep(800);
  const t0 = await leer();
  await sacar('3-telefono-pestana-radio', [390]);
  await p.getByRole('tab', { name: /^Gente/ }).click(); await sleep(400);
  const t1 = await leer();
  await sacar('4-telefono-pestana-gente', [390]);
  await p.keyboard.press('ArrowLeft'); await sleep(400);
  const t2 = await leer();
  ok('VO_390_pestanas_radio_y_gente', t0.pestanas.map((x) => x.texto.split(' · ')[0]).join('|') === 'Radio|Gente' && t0.pestanas[0].sel === 'true' && t0.paneles === 1
    && t0.cancion != null && t0.personas.length === 0 && t1.pestanas[1].sel === 'true' && t1.cancion === null && t1.personas.length === 4 && t1.eventos.length > 0
    && t2.pestanas[0].sel === 'true' && t2.focoRol === 'tab' && t2.cancion != null && [t0, t1, t2].every((x) => x.ancho <= 390 && !x.chat && !x.fila),
    { pestanas: t0.pestanas, paneles: t0.paneles, gente: t1.personas.length, foco: t2.focoRol, anchos: [t0.ancho, t1.ancho, t2.ancho] });
  const solapa = (a, b) => !!a && !!b && a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;
  ok('VO_390_chip_en_la_barra_pequena_sin_tapar', t0.chipMini === 'En la radio de Anfitriona' && t0.chipBarra === null && !!t0.cajaChip && !solapa(t0.cajaChip, t0.cajaBotones)
    && t0.cajaChip.y >= t0.cajaBarra.y && t0.cajaChip.b <= t0.cajaBarra.b,
    { chip: t0.chipMini, cajaChip: t0.cajaChip, botones: t0.cajaBotones, barra: t0.cajaBarra });
  await p.setViewportSize({ width: 1440, height: 900 }); await sleep(500);
  await salirFk();

  // ── 1440: quien modera ──
  const codeM = salaFalsa({ listeners: [HOST_FK, YO_FK, SONIA, BETO], mod: { moderators: [YO_FK, SONIA], events: [], until: 0, lost: false } });
  const sM = FK[codeM];
  estadoFk(codeM, { trackId: A.id, positionMs: 40_000, playing: true, nextTrackId: B.id });
  await escuchar(codeM);
  if (!(await sonandoEn(A.id)).v) throw new Error('la radio falsa del moderador no sonó');
  await irA('/radio');
  const conBotones = await esperar(async () => { const x = await leer(); return x.controles.length === 3 ? x : null; }, 9000, 150);
  const m = conBotones.v ?? await leer();
  await sacar('2-moderador', [1440, 390]);
  await p.getByRole('button', { name: 'Siguiente canción de la radio' }).click();
  const orden = await esperar(async () => (sM.ordenes ?? []).find((o) => o.type === 'siguiente') ?? null, 5000, 100);
  ok('VO_moderador_siguiente_manda_la_orden', m.insigniaCab === 'Modera' && m.personas.find((x) => x.nombre === 'Tú')?.insignia === 'Modera'
    && JSON.stringify(m.controles.map((x) => x.texto)) === JSON.stringify(['Pausar para mí', 'Siguiente', 'Pausar la radio'])
    && m.controles[1].label === 'Siguiente canción de la radio' && !!orden.v,
    { insignia: m.insigniaCab, controles: m.controles, orden: orden.v ?? null });
  await salirFk();

  // ── Tu radio: una radio REAL de esta cuenta, para el chip de quien transmite ──
  await irA('/radio'); await sleep(800);
  await p.locator('.radio-inicio .radio-btn--iniciar').click();
  const abierta = await esperar(async () => { const r = await p.evaluate(() => ({ fase: window.__radio().fase, codigo: window.__radio().codigo })); return r.fase === 'anfitrion' ? r : null; }, 8000, 150);
  if (abierta.v?.codigo) salas.push([tokOye, abierta.v.codigo]);
  await irA('/albums'); await sleep(600);
  const h0 = await leer();
  await sacar('6-chip-anfitrion-barra', [1440, 390], true);
  await p.locator('.radio-chip--barra').click(); await sleep(700);
  const h1 = await leer();
  await p.setViewportSize({ width: 390, height: 844 }); await sleep(700);
  const h2 = await leer();
  await p.setViewportSize({ width: 1440, height: 900 }); await sleep(400);
  ok('VO_chip_anfitrion_tu_radio', !!abierta.v && h0.chipBarra === 'Tu radio' && h1.path === '/radio' && h1.anfitrionTu && h2.chipMini === 'Tu radio' && h2.chipBarra === null,
    { abierta: abierta.v, chip: h0.chipBarra, path: h1.path, vista: h1.anfitrionTu, mini: h2.chipMini });
  await p.getByRole('button', { name: 'Terminar radio' }).click(); await sleep(250);
  await p.getByRole('button', { name: 'Sí, terminar' }).click();
  await esperar(async () => ((await p.evaluate(() => window.__radio().fase)) === 'sin-radio' ? true : null), 6000, 150);
} catch (e) {
  ok('VO_excepcion', false, { error: String(e?.message ?? e).split('\n')[0].slice(0, 300) });
} finally {
  for (const [tok, c] of salas) if (c) await api(tok, 'DELETE', `/api/radio/${c}`).catch(() => {});
}
ok('VO_sin_errores_de_pagina', errores.length === 0, { errores });
await ctx.close();

const fails = Object.entries(R).filter(([, x]) => (typeof x === 'object' ? !x.ok : !x));
console.log(JSON.stringify(R, null, 1));
if (CAPTURAS) console.log('[radio-vista-oyente-func] capturas:', JSON.stringify({ hechas: fotos.hechas.length, fallas: fotos.fallas }));
if (process.env.OYENTE_VISTA_DUMP) (await import('node:fs')).writeFileSync(process.env.OYENTE_VISTA_DUMP, JSON.stringify({ R, segundos: Math.round((Date.now() - T0) / 1000), fotos }, null, 1));
console.log(`\n[radio-vista-oyente-func] ${Math.round((Date.now() - T0) / 1000)} s`);
console.log(`\nradio-vista-oyente-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
