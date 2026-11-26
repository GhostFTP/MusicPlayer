// radio-unirse-func.mjs — UNIRSE a una radio (1.46.0, R4): la tarjeta «Unirse con código» en seis casillas, la ficha
// del ENLACE de invitación y el chip corto de la barra, contra el BUILD DE PRODUCCIÓN (preview :4173) y el backend REAL
// del runner (:3100). El montaje es el de radio-oyente-comun.mjs (la cuenta del oyente y su SALA FALSA FK…: lo que
// contesta la radio lo pone la prueba).
//
// Casos:
//   VU_1440_dos_columnas_y_seis_casillas   sin radio: «Inicia tu radio» y «Unirse con código» lado a lado; seis
//        casillas vacías, la pista «Pídele el código…» y «Unirse».
//   VU_minusculas_y_letras_que_no_van      lo escrito queda en mayúsculas, sin lo que no es de un código, seis como mucho.
//   VU_pegar_el_mensaje_entero             pegar «Escucha conmigo… /radio/CÓDIGO» deja solo el código.
//   VU_corto_en_ambar                      con 3 caracteres: «El código tiene 6 caracteres.» en ámbar, sin leer nada.
//   VU_no_existe / VU_ya_termino / VU_esta_llena / VU_termino_el_anfitrion   el error EN la tarjeta, en ámbar, una
//        sola vez (arriba no se repite), el foco vuelve al campo y la cola queda como estaba.
//   VU_unirse_entra_directo                «Unirse» entra sin pasar por la ficha: suena la radio y se ve la cara del
//        oyente en /radio.
//   VU_ficha_del_enlace                    /radio/CÓDIGO: «Te invitaron a escuchar», el código en seis casillas, «Escuchar»,
//        «Tu cola se guarda y vuelve al salir.», «Al entrar verás quién transmite y qué suena.», «¿Otro código?»; no se
//        lee la radio antes del clic y no se menciona la Fiesta.
//   VU_otro_codigo_desde_la_ficha          desde «¿Otro código?» se entra a ESA otra radio y se pasa a /radio, con el
//        foco en el encabezado de la vista del oyente (FIX-146; antes quedaba en el body).
//   VU_390_una_columna_sin_scroll          a 390 px, la tarjeta y la ficha en una columna, sin scroll horizontal.
//   VU_chip_corto                          escuchando: «Radio de <nombre>» sin cortarse (1440, y 390 con un nombre corto);
//        «En la radio de <nombre>» como nombre accesible y title.
//   VU_sin_errores_de_pagina
//
// CONTROL NEGATIVO (a mano): con «Unirse» navegando a la ficha (lo de antes) caen VU_unirse_entra_directo y los VU_
// de error (el aviso no sale en la tarjeta); con el error también arriba cae «una sola vez».
// Uso: SNAP_BASE=http://localhost:4173 SNAP_USER=… SNAP_PASS=… SNAP2_USER=… SNAP2_PASS=… node radio-unirse-func.mjs
// UNIRSE_DUMP=<archivo>: deja ahí los resultados. UNIRSE_CAPTURAS=<carpeta>: saca las capturas (no cambia el conteo).
import {
  R, ok, sleep, A, B, p, errores, esperar, foto, FK, salaFalsa, estadoFk, sonandoEn, irA, salirFk, prepararFoto, mismo,
  TXT_FIN, salas, api, BASE, browser, ctx,
} from './radio-oyente-comun.mjs';

const T0 = Date.now();
const CAPTURAS = process.env.UNIRSE_CAPTURAS || null;
const TXT = {
  corto: 'El código tiene 6 caracteres.',
  noExiste: 'No hay ninguna radio con ese código. Revísalo e intenta de nuevo.',
  termino: 'Esa radio ya terminó.',
  llena: 'Esa radio está llena. Intenta más tarde.',
};

const leer = () => p.evaluate(() => {
  const txt = (sel, r = document) => r?.querySelector(sel)?.textContent ?? null;
  const ambar = (() => { const d = document.createElement('span'); d.style.color = 'var(--amber)'; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; })();
  const dos = document.querySelector('.radio-dos');
  const u = document.querySelector('.radio-unirse');
  const av = document.getElementById('radio-aviso');
  const campo = document.getElementById('radio-codigo-campo');
  const ficha = document.querySelector('.radio-ficha');
  const chipB = document.querySelector('.radio-chip--barra'); const chipM = document.querySelector('.radio-chip--mini');
  const vis = (el) => !!el && el.offsetParent !== null;
  const cortado = (el) => { const t = el?.querySelector('.radio-chip-texto'); return t ? t.scrollWidth > t.clientWidth + 1 : null; };
  return {
    path: location.pathname, ancho: document.documentElement.scrollWidth, vw: innerWidth,
    columnas: dos ? getComputedStyle(dos).gridTemplateColumns.split(' ').length : 0,
    inicio: !!document.querySelector('.radio-inicio'),
    titulo: txt('.radio-card-title', u), casillas: [...(u?.querySelectorAll('.radio-casilla') ?? [])].map((c) => c.textContent),
    valor: campo?.value ?? null, campoOff: campo?.disabled ?? null, pista: txt('#radio-unirse-pista'),
    aviso: av?.textContent ?? null, avisoAmbar: av ? getComputedStyle(av).color === ambar : null, casillasMal: !!u?.querySelector('.radio-casillas--mal'),
    estado: txt('.radio-estado'), foco: document.activeElement?.id || document.activeElement?.className || null,
    subtitulo: txt('.radio-subtitle'), oyente: !!document.querySelector('.radio-escucha'),
    focoEnOyente: !!document.activeElement?.closest('.radio-escucha') && document.activeElement.classList.contains('radio-anfitrion-nombre'),
    ficha: ficha ? {
      casillas: [...ficha.querySelectorAll('.radio-codigo--casillas .radio-casilla')].map((c) => c.textContent),
      lema: txt('.radio-ficha-lema', ficha), nota: txt('#radio-escuchar-nota'), escuchar: txt('.radio-btn--escuchar', ficha),
      notas: [...ficha.querySelectorAll('.radio-nota')].map((n) => n.textContent),
    } : null,
    fiesta: /fiesta/i.test(document.querySelector('.main-content')?.textContent ?? ''),
    chipB: vis(chipB) ? { texto: chipB.textContent, label: chipB.getAttribute('aria-label'), title: chipB.title, cortado: cortado(chipB) } : null,
    chipM: vis(chipM) ? { texto: chipM.textContent, label: chipM.getAttribute('aria-label'), cortado: cortado(chipM) } : null,
  };
});
const escribir = async (texto) => { await p.locator('#radio-codigo-campo').fill(''); await p.locator('#radio-codigo-campo').pressSequentially(texto); };
const pegar = (texto) => p.evaluate((t) => {
  const dt = new DataTransfer(); dt.setData('text/plain', t);
  document.getElementById('radio-codigo-campo').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, texto);
const unirseClic = () => p.locator('.radio-unirse button[type="submit"]').click();

const fotos = { hechas: [], fallas: [] };
const sacar = async (nombre, anchos) => {
  if (!CAPTURAS) return;
  const { mkdirSync } = await import('node:fs'); const { join } = await import('node:path');
  mkdirSync(CAPTURAS, { recursive: true });
  const antes = p.viewportSize();
  for (const w of anchos) {
    try {
      await p.setViewportSize({ width: w, height: w === 390 ? 844 : 900 }); await sleep(500);
      if (w === 390) {
        const alto = await p.evaluate(() => { const m = document.querySelector('.main-content'); return m ? m.scrollHeight - m.clientHeight : 0; });
        if (alto > 0) { await p.setViewportSize({ width: w, height: 844 + alto }); await sleep(400); }
      }
      const estilo = await p.addStyleTag({ content: '.toast-layer { visibility: hidden !important; }' });
      const f = join(CAPTURAS, `${nombre}-${w}.png`); await p.screenshot({ path: f, fullPage: true }); fotos.hechas.push(f);
      await estilo.evaluate((n) => n.remove());
    } catch (e) { fotos.fallas.push(`${nombre}-${w}: ${String(e.message).split('\n')[0]}`); }
  }
  await p.setViewportSize(antes); await sleep(400);
};

try {
  await p.goto(BASE + '/');
  await p.waitForSelector('.player-bar', { timeout: 15000 });
  await p.waitForFunction(() => !!window.__player?.() && !!window.__radio?.());
  const antes = await prepararFoto('all');
  await irA('/radio'); await sleep(700);

  // ── La tarjeta ──
  let v = await leer();
  ok('VU_1440_dos_columnas_y_seis_casillas', v.columnas === 2 && v.inicio && v.titulo === 'Unirse con código' && v.casillas.length === 6 && v.casillas.every((c) => c === '')
    && v.pista === 'Pídele el código a quien transmite, o abre su enlace.' && v.campoOff === false && v.aviso === '' && v.ancho <= v.vw,
    { columnas: v.columnas, inicio: v.inicio, titulo: v.titulo, casillas: v.casillas, pista: v.pista, ancho: v.ancho });
  await sacar('1-unirse-vacia', [1440, 390]);

  await escribir('k7-m 2qxzz9');
  v = await leer();
  ok('VU_minusculas_y_letras_que_no_van', v.valor === 'K7M2QX' && v.casillas.join('') === 'K7M2QX', { valor: v.valor, casillas: v.casillas });

  const cPegado = salaFalsa();
  await p.locator('#radio-codigo-campo').fill('');
  await pegar(`¡Escucha conmigo en SonoraRev! ${BASE}/radio/${cPegado}`); await sleep(200);
  v = await leer();
  ok('VU_pegar_el_mensaje_entero', v.valor === cPegado && v.casillas.join('') === cPegado && v.aviso === '', { valor: v.valor, esperado: cPegado, aviso: v.aviso });

  const lecturasAntes = Object.values(FK).reduce((n, s) => n + s.lecturas.length, 0);
  await escribir('K7M'); await unirseClic(); await sleep(300);
  v = await leer();
  const lecturasDespues = Object.values(FK).reduce((n, s) => n + s.lecturas.length, 0);
  ok('VU_corto_en_ambar', v.aviso === TXT.corto && v.avisoAmbar && v.casillasMal && lecturasDespues === lecturasAntes, { aviso: v.aviso, ambar: v.avisoAmbar, mal: v.casillasMal });
  await sacar('2-unirse-error-corto', [1440, 390]);

  // ── Los errores al entrar, en la tarjeta ──
  for (const [caso, extra, esperado] of [
    ['VU_no_existe', { modo: { status: 404, body: { error: 'Radio not found' } } }, TXT.noExiste],
    ['VU_ya_termino', { modo: { status: 410, body: { error: 'Radio ended', endedReason: 'admin' } } }, TXT.termino],
    ['VU_esta_llena', { modo: { status: 409, body: { error: 'Radio full' } } }, TXT.llena],
    ['VU_termino_el_anfitrion', { modo: 'ended', razon: 'anfitrion' }, TXT_FIN],
  ]) {
    const code = salaFalsa(extra);
    estadoFk(code, { trackId: A.id, positionMs: 40_000, playing: true, nextTrackId: B.id });
    await escribir(code.toLowerCase()); await unirseClic();
    const listo = await esperar(async () => { const x = await leer(); return x.aviso === esperado ? x : null; }, 5000, 100);
    await sleep(200);
    const x = await leer(); const f = await foto();
    ok(caso, !!listo.v && x.avisoAmbar && x.casillasMal && x.estado === '' && x.foco === 'radio-codigo-campo' && f.fase === 'sin-radio'
      && mismo(f.cola, antes.cola) && f.indice === antes.indice && f.paused && FK[code].lecturas.length === 1,
      { aviso: x.aviso, ambar: x.avisoAmbar, estado: x.estado, foco: x.foco, fase: f.fase, cola: mismo(f.cola, antes.cola), lecturas: FK[code].lecturas.length });
    if (caso === 'VU_esta_llena') await sacar('3-unirse-error-llena', [1440, 390]);
  }

  // ── Unirse entra directo ──
  const cOk = salaFalsa({ host: { id: 990201, name: 'Oscar', avatar: null } });
  estadoFk(cOk, { trackId: A.id, positionMs: 40_000, playing: true, nextTrackId: B.id });
  await escribir(cOk); await unirseClic();
  const dentro = await sonandoEn(A.id);
  await sleep(600);
  v = await leer();
  ok('VU_unirse_entra_directo', !!dentro.v && v.path === '/radio' && v.oyente && v.subtitulo === 'Escuchando en vivo' && v.focoEnOyente,
    { sono: !!dentro.v, path: v.path, oyente: v.oyente, focoEnOyente: v.focoEnOyente, foco: v.foco });

  // El chip corto (1440 con «Oscar»; 390 también)
  const c1440 = v.chipB;
  await p.setViewportSize({ width: 390, height: 844 }); await sleep(700);
  const c390 = (await leer()).chipM;
  await p.setViewportSize({ width: 1440, height: 900 }); await sleep(400);
  ok('VU_chip_corto', c1440?.texto === 'Radio de Oscar' && c1440.label === 'En la radio de Oscar' && c1440.title === 'En la radio de Oscar · Abrir Radio' && c1440.cortado === false
    && c390?.texto === 'Radio de Oscar' && c390.label === 'En la radio de Oscar' && c390.cortado === false, { c1440, c390 });
  await salirFk();

  // ── La ficha del enlace ──
  const cFicha = salaFalsa(); const cOtro = salaFalsa({ host: { id: 990202, name: 'Joana', avatar: null } });
  estadoFk(cFicha, { trackId: A.id, positionMs: 40_000, playing: true, nextTrackId: B.id });
  estadoFk(cOtro, { trackId: A.id, positionMs: 40_000, playing: true, nextTrackId: B.id });
  await irA(`/radio/${cFicha}`); await sleep(1500);
  v = await leer();
  ok('VU_ficha_del_enlace', v.subtitulo === 'Te invitaron a escuchar' && v.ficha?.casillas.join('') === cFicha && v.ficha.casillas.length === 6
    && v.ficha.lema === 'Escucha lo mismo que suena en esa radio, en vivo.' && v.ficha.nota === 'Tu cola se guarda y vuelve al salir.'
    && v.ficha.notas.includes('Al entrar verás quién transmite y qué suena.') && v.ficha.escuchar === 'Escuchar' && v.titulo === '¿Otro código?'
    && !v.fiesta && FK[cFicha].lecturas.length === 0 && v.columnas === 2,
    { subtitulo: v.subtitulo, ficha: v.ficha, otro: v.titulo, fiesta: v.fiesta, lecturas: FK[cFicha].lecturas.length, columnas: v.columnas });
  await sacar('4-ficha-del-enlace', [1440, 390]);

  // ── 390: una columna, sin scroll (la ficha y, en /radio, la tarjeta) ──
  await p.setViewportSize({ width: 390, height: 844 }); await sleep(600);
  const m1 = await leer();
  await irA('/radio'); await sleep(600);
  const m2 = await leer();
  await p.setViewportSize({ width: 1440, height: 900 }); await sleep(400);
  ok('VU_390_una_columna_sin_scroll', m1.columnas === 1 && m1.ancho <= 390 && m2.columnas === 1 && m2.ancho <= 390 && m2.casillas.length === 6,
    { ficha: [m1.columnas, m1.ancho], tarjeta: [m2.columnas, m2.ancho] });

  // ── «¿Otro código?» desde la ficha ──
  await irA(`/radio/${cFicha}`); await sleep(800);
  await escribir(cOtro); await unirseClic();
  const otro = await sonandoEn(A.id);
  await sleep(800);
  v = await leer(); const fO = await foto();
  // FIX-146: el foco cae en el encabezado de la vista del oyente («La radio de …») cuando ya existe, no en el body.
  ok('VU_otro_codigo_desde_la_ficha', !!otro.v && fO.codigo === cOtro && v.path === '/radio' && v.oyente && FK[cFicha].lecturas.length === 0 && v.focoEnOyente,
    { codigo: fO.codigo, esperado: cOtro, path: v.path, oyente: v.oyente, lecturasFicha: FK[cFicha].lecturas.length, focoEnOyente: v.focoEnOyente, foco: v.foco });
  await salirFk();
} catch (e) {
  ok('VU_excepcion', false, { error: String(e?.message ?? e).split('\n')[0].slice(0, 300) });
} finally {
  for (const [tok, c] of salas) if (c) await api(tok, 'DELETE', `/api/radio/${c}`).catch(() => {});
}
ok('VU_sin_errores_de_pagina', errores.length === 0, { errores });
await ctx.close();

const fails = Object.entries(R).filter(([, x]) => (typeof x === 'object' ? !x.ok : !x));
console.log(JSON.stringify(R, null, 1));
if (CAPTURAS) console.log('[radio-unirse-func] capturas:', JSON.stringify({ hechas: fotos.hechas.length, fallas: fotos.fallas }));
if (process.env.UNIRSE_DUMP) (await import('node:fs')).writeFileSync(process.env.UNIRSE_DUMP, JSON.stringify({ R, segundos: Math.round((Date.now() - T0) / 1000), fotos }, null, 1));
console.log(`\n[radio-unirse-func] ${Math.round((Date.now() - T0) / 1000)} s`);
console.log(`\nradio-unirse-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
