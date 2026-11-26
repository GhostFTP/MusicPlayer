// radio-vista-anfitrion-func.mjs — la vista de QUIEN TRANSMITE (1.46.0, R2: RadioAnfitrion.jsx), contra el BUILD DE
// PRODUCCIÓN (preview :4173) y el backend REAL del runner (:3100) para la biblioteca. La RADIO es un SERVIDOR FALSO
// (page.route sobre /api/radio, como radio-anfitrion-mod-func 19-20): quién escucha, quién modera, los eventos y las
// órdenes los pone la prueba. Así no se gasta el tope de radios por minuto que radio-func ya usa en la misma corrida.
//
// Casos (primero a 1440 px, después a 390 px en la MISMA radio):
//   VA_1440_dos_columnas_que_usan_el_ancho   dos columnas, más ancha que los 640 px de antes, sin pestañas ni «ver fila»
//        y sin scroll horizontal.
//   VA_codigo_grande_y_copiar        el código en dos bloques de ≥40 px, «Copiar código» y «Copiar enlace» copian.
//   VA_suena_ahora                   título y artista de lo que suena, la portada, el avance que corre y sin «la pidió».
//   VA_sin_oyentes_no_te_cuenta      «Nadie escuchando todavía» y ninguna fila (ni «Tú»).
//   VA_pausar_y_reanudar_para_todos  pausa el reproductor, el botón dice «Reanudar para todos» y se publica pausado; y vuelve.
//   VA_siguiente                     pasa a la siguiente de la cola.
//   VA_con_oyentes_sin_contarte      con 3 oyentes: «3 oyentes» y 3 filas, sin «Tú».
//   VA_hacer_moderador_y_quitar_rol  nombrar marca «Modera» y el botón dice «Quitar rol»; quitar vuelve a «Hacer moderador».
//   VA_solo_escucha                  quien no lo admite (409 sin-soporte) queda «Solo escucha…» y sin botón.
//   VA_fila_en_orden_con_quien_la_pidio   la petición de quien modera (una orden real del motor) y una tuya: en el
//        orden de la cola, «La pidió Sonia» / «La pusiste tú», y «Luego, tu música.» al final.
//   VA_quitar_de_la_fila             «Quitar» la saca de la cola (removeFromQueue) y de la fila.
//   VA_suena_ahora_la_pidio          al pasar a la pedida, «Suena ahora» dice «La pidió Sonia».
//   VA_lo_que_paso                   los eventos, el más nuevo primero.
//   VA_terminar_dice_a_cuantas_y_es_neutro   la confirmación dice «Se les cierra a 3 personas.», el foco va a «No», «No»
//        vuelve; el botón no es ámbar (mismo color que los neutros).
//   VA_sin_chat                      ni tarjeta ni pestaña de chat («próximamente» tampoco).
//   VA_390_pestanas_y_ver_fila       pestañas Radio / Fila / Gente (sin Chat), sólo el panel de Radio montado, «Siguen N ·
//        ver fila» y sin scroll horizontal.
//   VA_390_ver_fila_y_teclado        «ver fila» abre Fila con el foco en su pestaña; ← / → mueven entre pestañas; Gente
//        muestra quién escucha y lo que pasó; cada pestaña, una a la vez y sin scroll horizontal.
//   VA_390_terminar                  desde la pestaña Radio, terminar cierra la radio (DELETE) y vuelve a «Inicia tu radio».
//   VA_sin_errores_de_pagina
//
// CONTROL NEGATIVO (a mano): volviendo a poner la fila «Tú · Anfitrión» cae VA_sin_oyentes / VA_con_oyentes; con la
// confirmación de antes («¿Seguro?») cae VA_terminar; quitando el filtro de upNext la fila muestra la cola entera y cae
// VA_fila (Luego, tu música queda debajo de canciones que nadie pidió).
// Uso: SNAP_BASE=http://localhost:4173 SNAP_USER=… SNAP_PASS=… SNAP2_USER=… SNAP2_PASS=… node radio-vista-anfitrion-func.mjs
// VISTA_DUMP=<archivo>: deja ahí los resultados con sus valores. VISTA_CAPTURAS=<carpeta>: saca las capturas de cada
// estado a 1440 y 390 (no cambia el conteo).
import { R, ok, sleep, abrir, vista, esperar, sonar, irA, iniciar, terminarUI, BASE, browser } from './radio-anfitrion-comun.mjs';

const T0 = Date.now();
const CAPTURAS = process.env.VISTA_CAPTURAS || null;

// ── El servidor de radio falso ──
const PERS = { 9002: 'Sonia', 9003: 'Beto', 9005: 'Dani' };
const persona = (id) => ({ id, name: PERS[id], avatar: null });
const F = { host: null, oyentes: [], mods: [], sinSoporte: new Set([9005]), eventos: [], evId: 0, ordenes: [], ordId: 0, log: [], ultimoPut: null };
const evento = (type, by, byName, extra = {}) => {
  const e = { id: ++F.evId, type, by, byName, target: null, targetName: null, trackId: null, title: null, at: Date.now(), ...extra };
  F.eventos.push(e); return e;
};
const CODIGO = 'K7M2QX';
async function falso(route) {
  const q = route.request(); const m = q.method(); const t = Date.now(); const u = new URL(q.url());
  let body = null; try { body = q.postData() ? JSON.parse(q.postData()) : null; } catch {}
  F.log.push({ t, m, ruta: u.pathname + u.search, body });
  const json = (status, b) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
  const mod = u.pathname.match(/\/moderadores\/(\d+)$/);
  if (mod) {
    const id = +mod[1];
    if (m === 'PUT') {
      if (F.sinSoporte.has(id)) return json(409, { error: 'x', reason: 'sin-soporte' });
      if (!F.mods.includes(id)) { F.mods.push(id); evento('moderador', F.host, 'Yo', { target: id, targetName: PERS[id] }); }
    } else if (F.mods.includes(id)) { F.mods = F.mods.filter((x) => x !== id); evento('sin-moderador', F.host, 'Yo', { target: id, targetName: PERS[id] }); }
    return json(200, { serverNow: t, moderators: F.mods.map(persona), name: PERS[id] });
  }
  const salen = () => F.ordenes.slice(0, 10);
  if (m === 'POST') return json(201, { code: CODIGO, serverNow: t, status: 'live' });
  if (m === 'PUT') {
    const b = body ?? {};
    F.ultimoPut = b;
    const conf = b.ordenHasta !== undefined;
    if (conf) F.ordenes = F.ordenes.filter((o) => o.id > b.ordenHasta);
    const state = { seq: F.log.length, trackId: b.trackId ?? null, positionMs: b.positionMs ?? 0, playing: !!b.playing, nextTrackId: b.nextTrackId ?? null, enPausaPorVideo: false, publishedAtServerMs: t };
    return json(200, { serverNow: t, status: 'live', state, ...(conf ? { orders: salen() } : {}) });
  }
  if (m === 'GET') {
    const desde = Number(u.searchParams.get('desde') ?? 0);
    return json(200, { serverNow: t, code: CODIGO, status: 'live', state: null, host: { id: F.host, name: 'Yo' }, listeners: F.oyentes.map(persona),
      moderators: F.mods.map(persona), capabilities: { orders: true }, events: F.eventos.filter((e) => e.id > desde), eventsUntil: F.evId, eventsLost: false, orders: salen() });
  }
  if (m === 'DELETE') return json(200, { serverNow: t, status: 'ended', endedReason: 'anfitrion' });
  return route.continue();
}
// El valor de PlayerContext y de la sesión, ubicados por la fibra (como radio-anfitrion-mod-func): la app no expone nada.
const INIT_VA = () => {
  const valor = (cumple) => {
    const root = document.getElementById('root');
    const key = Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
    const pila = [root[key]?.stateNode?.current ?? root[key]];
    while (pila.length) {
      const f = pila.pop(); if (!f) continue;
      const v = f.memoizedProps?.value;
      if (v && cumple(v)) return v;
      if (f.sibling) pila.push(f.sibling);
      if (f.child) pila.push(f.child);
    }
    return null;
  };
  window.__player = () => valor((v) => typeof v.play === 'function' && typeof v.addToQueue === 'function');
  window.__sesion = () => valor((v) => typeof v.signOut === 'function');
  window.__toasts = [];
  new MutationObserver(() => {
    for (const n of document.querySelectorAll('.toast-text')) if (!n.dataset.visto) { n.dataset.visto = '1'; window.__toasts.push(n.textContent); }
  }).observe(document, { subtree: true, childList: true, characterData: true });
};

// Lo que muestra la vista del anfitrión, en una sola lectura.
const leer = (p) => p.evaluate(() => {
  const txt = (sel, r = document) => r.querySelector(sel)?.textContent ?? null;
  const cols = document.querySelector('.radio-transmite-cols');
  const pista = window.__player()?.currentTrack;
  const barra = document.querySelector('.radio-avance-barra');
  return {
    ancho: document.documentElement.scrollWidth, vw: window.innerWidth,
    anchoVista: Math.round(document.querySelector('.radio-transmite')?.getBoundingClientRect().width ?? 0),
    columnas: cols ? getComputedStyle(cols).gridTemplateColumns.split(' ').length : 0,
    pestanas: [...document.querySelectorAll('[role="tab"]')].map((b) => ({ texto: b.textContent, sel: b.getAttribute('aria-selected') })),
    paneles: [...document.querySelectorAll('[role="tabpanel"]')].length,
    verFila: txt('.radio-ver-fila'),
    codigo: txt('.radio-codigo'), bloques: [...document.querySelectorAll('.radio-codigo > span')].map((s) => s.textContent),
    tamCodigo: parseFloat(getComputedStyle(document.querySelector('.radio-codigo') ?? document.body).fontSize),
    cancion: txt('.radio-ahora-cancion'), artista: txt('.radio-ahora-artista'), pidio: txt('.radio-ahora-pidio'),
    portada: !!document.querySelector('.radio-ahora .radio-portada'), portadaImg: !!document.querySelector('.radio-ahora .radio-portada img'),
    avance: barra ? Number(barra.getAttribute('aria-valuenow')) : null,
    pista: pista ? { id: pista.id, qid: pista._qid, title: pista.title ?? null, artist: pista.artist ?? null, cover: !!pista.cover_path } : null,
    sonando: !!window.__player()?.isPlaying,
    oyentes: txt('.radio-oyentes'),
    personas: [...document.querySelectorAll('.radio-persona')].map((li) => {
      const b = li.querySelector('.radio-btn--persona');
      return { nombre: txt('.radio-persona-nombre', li), insignia: txt('.radio-insignia', li), boton: b ? b.textContent : null, nota: txt('.radio-persona-nota', li) };
    }),
    fila: [...document.querySelectorAll('.radio-cola-item')].map((li) => ({ titulo: txt('.radio-cola-titulo', li), pidio: txt('.radio-cola-pidio', li), quitar: li.querySelector('.radio-btn--cola')?.getAttribute('aria-label') ?? null })),
    luego: txt('.radio-cola-luego'), colaVacia: !!document.querySelector('.radio-cola-vacia'),
    eventos: [...document.querySelectorAll('.radio-eventos li')].map((li) => li.textContent),
    region: txt('.radio-evento'),
    pregunta: txt('.radio-confirmar-pregunta'),
    foco: document.activeElement?.textContent?.trim().slice(0, 40) ?? null,
    focoRol: document.activeElement?.getAttribute('role') ?? null,
    chat: /chat|próximamente/i.test(document.querySelector('.radio-transmite')?.textContent ?? ''),
    terminarColor: (() => { const b = document.querySelector('.radio-terminar .radio-btn--terminar'); return b ? getComputedStyle(b).color : null; })(),
    neutroColor: (() => { const b = [...document.querySelectorAll('.radio-card--codigo .radio-btn')][0]; return b ? getComputedStyle(b).color : null; })(),
    upNext: (() => { const v = window.__player(); if (!v) return []; const i = v.queueIndex; return v.queue.filter((t, k) => k > i && v.upNext.has(t._qid)).map((t) => t.title ?? 'Sin título'); })(),
  };
});
const fotos = { hechas: [], fallas: [] };
const foto = async (p, nombre, anchos = [1440, 390]) => {
  if (!CAPTURAS) return;
  const { mkdirSync } = await import('node:fs'); const { join } = await import('node:path');
  mkdirSync(CAPTURAS, { recursive: true });
  const antes = p.viewportSize();
  for (const w of anchos) {
    try {
      // El scroll vive en .main-content (no en la página): a 390 se alarga la ventana a lo que mide el contenido para que
      // la captura lo muestre entero. Los toasts se esconden SOLO durante la foto (taparían los botones).
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

const { ctx, p, errores } = await abrir({ falso, init: INIT_VA });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
try {
  await sonar(p);
  await irA(p, 'Radio');
  F.host = await p.evaluate(() => window.__sesion()?.user?.id ?? null);
  const inicio = await iniciar(p);
  if (!inicio.v) throw new Error('no abrió la cara del anfitrión');
  await sleep(1200);

  // ── 1440 sin oyentes ──
  let v = await leer(p);
  ok('VA_1440_dos_columnas_que_usan_el_ancho', v.columnas === 2 && v.anchoVista > 900 && v.pestanas.length === 0 && v.paneles === 0 && v.verFila === null && v.ancho <= v.vw,
    { columnas: v.columnas, anchoVista: v.anchoVista, pestanas: v.pestanas.length, verFila: v.verFila, ancho: v.ancho, vw: v.vw });

  await p.getByRole('button', { name: 'Copiar código' }).click(); await sleep(300);
  const portaCodigo = await p.evaluate(() => navigator.clipboard.readText());
  await p.getByRole('button', { name: 'Copiar enlace' }).click(); await sleep(300);
  const portaEnlace = await p.evaluate(() => navigator.clipboard.readText());
  const toasts = await p.evaluate(() => window.__toasts.slice());
  ok('VA_codigo_grande_y_copiar', v.codigo === CODIGO && v.bloques.join('|') === 'K7M|2QX' && v.tamCodigo >= 40 && portaCodigo === CODIGO
    && portaEnlace === `${new URL(BASE).origin}/radio/${CODIGO}` && toasts.includes('Código copiado') && toasts.includes('Enlace copiado'),
    { codigo: v.codigo, bloques: v.bloques, tam: v.tamCodigo, portaCodigo, portaEnlace, toasts });

  const a0 = v.avance; await sleep(1600); const v1 = await leer(p);
  ok('VA_suena_ahora', !!v.pista && v.cancion === (v.pista.title ?? 'Sin título') && (v.pista.artist ? v.artista === v.pista.artist : true) && v.portada
    && (v.pista.cover ? v.portadaImg : true) && v.pidio === null && v1.avance > a0,
    { cancion: v.cancion, artista: v.artista, pista: v.pista, portadaImg: v.portadaImg, avance: [a0, v1.avance], pidio: v.pidio });
  ok('VA_sin_oyentes_no_te_cuenta', v.oyentes === 'Nadie escuchando todavía' && v.personas.length === 0, { oyentes: v.oyentes, personas: v.personas });
  await foto(p, '1-sin-oyentes');

  // Pausar / reanudar para todos: el reproductor y lo que se publica
  const nPut = F.log.length;
  await p.getByRole('button', { name: 'Pausar para todos' }).click();
  const pausa = await esperar(async () => { const x = await leer(p); return !x.sonando && F.log.slice(nPut).some((r) => r.m === 'PUT' && r.body?.playing === false) ? x : null; }, 5000, 100);
  const textoPausado = pausa.v ? await p.locator('.radio-ahora-controles .radio-btn').first().textContent() : null;
  await p.getByRole('button', { name: 'Reanudar para todos' }).click();
  const sigue = await esperar(async () => ((await leer(p)).sonando ? true : null), 5000, 100);
  ok('VA_pausar_y_reanudar_para_todos', !!pausa.v && textoPausado === 'Reanudar para todos' && !!sigue.v, { pausado: !!pausa.v, texto: textoPausado, reanudo: !!sigue.v });

  const antesSig = (await leer(p)).pista;
  const esperadaSig = await p.evaluate(() => { const v = window.__player(); return v.queue[v.queueIndex + 1]?.id ?? null; });
  await p.locator('.radio-ahora-controles').getByRole('button', { name: 'Siguiente' }).click();
  const sig = await esperar(async () => { const x = await leer(p); return x.pista?.id === esperadaSig && x.cancion === (x.pista.title ?? 'Sin título') ? x : null; }, 5000, 100);
  ok('VA_siguiente', !!sig.v && antesSig?.qid !== sig.v?.pista?.qid, { antes: antesSig?.id, esperada: esperadaSig, despues: sig.v?.pista?.id ?? null });

  // ── Con oyentes ──
  F.oyentes = [9002, 9003, 9005];
  const con = await esperar(async () => { const x = await leer(p); return x.personas.length === 3 ? x : null; }, 8000, 100);
  v = con.v ?? await leer(p);
  ok('VA_con_oyentes_sin_contarte', !!con.v && v.oyentes === '3 oyentes' && !v.personas.some((x) => x.nombre === 'Tú') && v.personas.every((x) => x.boton === 'Hacer moderador'),
    { oyentes: v.oyentes, personas: v.personas });

  await p.getByRole('button', { name: 'Hacer moderador a Beto' }).click();
  const beto = await esperar(async () => { const x = (await leer(p)).personas.find((y) => y.nombre === 'Beto'); return x?.insignia === 'Modera' ? x : null; }, 5000, 100);
  await p.getByRole('button', { name: 'Quitar a Beto de moderar' }).click();
  const betoFuera = await esperar(async () => { const x = (await leer(p)).personas.find((y) => y.nombre === 'Beto'); return x && x.insignia === null && x.boton === 'Hacer moderador' ? x : null; }, 5000, 100);
  await p.getByRole('button', { name: 'Hacer moderador a Sonia' }).click();
  const sonia = await esperar(async () => { const x = (await leer(p)).personas.find((y) => y.nombre === 'Sonia'); return x?.insignia === 'Modera' ? x : null; }, 5000, 100);
  ok('VA_hacer_moderador_y_quitar_rol', beto.v?.boton === 'Quitar rol' && !!betoFuera.v && sonia.v?.boton === 'Quitar rol', { beto: beto.v, betoFuera: betoFuera.v, sonia: sonia.v });

  await p.getByRole('button', { name: 'Hacer moderador a Dani' }).click();
  const dani = await esperar(async () => { const x = (await leer(p)).personas.find((y) => y.nombre === 'Dani'); return x?.nota ? x : null; }, 5000, 100);
  ok('VA_solo_escucha', dani.v?.nota === 'Solo escucha: su versión todavía no permite moderar.' && dani.v.boton === null, { dani: dani.v });
  await foto(p, '2-con-oyentes-y-moderador');

  // ── La fila: una petición de Sonia (orden REAL del motor, como el servidor) y una tuya (el menú local) ──
  const cola = await p.evaluate(() => { const v = window.__player(); return { idx: v.queueIndex, q: v.queue.map(({ _qid, ...t }) => t) }; });
  // Dos canciones DISTINTAS de la que suena (por id): la que pide Sonia y la tuya. De las últimas, que no sean la siguiente.
  const actual = cola.q[cola.idx]?.id;
  const otras = [...new Map(cola.q.filter((t) => t.id !== actual).map((t) => [t.id, t])).values()];
  if (otras.length < 2) throw new Error(`el álbum de prueba tiene ${otras.length + 1} canciones distintas (hacen falta 3)`);
  const X = otras[otras.length - 1];   // la que pide Sonia
  const Y = otras[otras.length - 2];   // la tuya
  const o = { id: ++F.ordId, type: 'a-continuacion', trackId: X.id, seqBase: 1, trackBase: null, by: 9002, title: X.title ?? null };
  F.ordenes.push(o);
  evento('a-continuacion', 9002, 'Sonia', { trackId: X.id, title: X.title ?? null });
  const llegó = await esperar(async () => ((await leer(p)).fila.length === 1 ? true : null), 8000, 100);
  await p.evaluate((t) => window.__player().playAfterCurrent([t]), Y);
  const dos = await esperar(async () => { const x = await leer(p); return x.fila.length === 2 ? x : null; }, 4000, 100);
  v = dos.v ?? await leer(p);
  const tY = Y.title ?? 'Sin título', tX = X.title ?? 'Sin título';
  const pidioDe = (t) => v.fila.find((x) => x.titulo === t)?.pidio ?? null;
  ok('VA_fila_en_orden_con_quien_la_pidio', !!llegó.v && !!dos.v && JSON.stringify(v.fila.map((x) => x.titulo)) === JSON.stringify(v.upNext)
    && pidioDe(tX) === 'La pidió Sonia' && pidioDe(tY) === 'La pusiste tú' && v.luego === 'Luego, tu música.' && !v.colaVacia,
    { fila: v.fila, upNext: v.upNext, luego: v.luego });
  await foto(p, '3-con-fila');

  await p.getByRole('button', { name: `Quitar «${tY}» de la fila` }).click();
  const quitada = await esperar(async () => { const x = await leer(p); return x.fila.length === 1 ? x : null; }, 4000, 100);
  const enCola = await p.evaluate((id) => { const v = window.__player(); const i = v.queueIndex; return v.queue.some((t, k) => k > i && t.id === id && v.upNext.has(t._qid)); }, Y.id);
  ok('VA_quitar_de_la_fila', !!quitada.v && quitada.v.fila[0]?.titulo === tX && !enCola, { fila: quitada.v?.fila ?? null, sigueMarcada: enCola });

  await p.locator('.radio-ahora-controles').getByRole('button', { name: 'Siguiente' }).click();
  const pedida = await esperar(async () => { const x = await leer(p); return x.pista?.id === X.id ? x : null; }, 6000, 100);
  ok('VA_suena_ahora_la_pidio', pedida.v?.pidio === 'La pidió Sonia' && pedida.v.fila.length === 0 && pedida.v.colaVacia && pedida.v.luego === 'Luego, tu música.',
    { pista: pedida.v?.pista ?? null, pidio: pedida.v?.pidio ?? null, fila: pedida.v?.fila ?? null });

  v = await leer(p);
  ok('VA_lo_que_paso', v.eventos[0] === `Sonia puso «${tX}» a continuación` && v.eventos.includes('Tú nombraste a Sonia para moderar')
    && v.eventos.includes('Tú le quitaste el control a Beto') && v.eventos.length <= 8, { eventos: v.eventos });

  // ── Terminar: la confirmación ──
  await p.getByRole('button', { name: 'Terminar radio' }).click(); await sleep(300);
  const conf = await leer(p);
  await foto(p, '4-confirmar-terminar');
  await p.getByRole('button', { name: 'No', exact: true }).click(); await sleep(300);
  const tras = await leer(p);
  ok('VA_terminar_dice_a_cuantas_y_es_neutro', conf.pregunta === '¿Terminar la radio? Se les cierra a 3 personas.' && conf.foco === 'No' && tras.pregunta === null
    && tras.foco === 'Terminar radio' && !!tras.terminarColor && tras.terminarColor === tras.neutroColor,
    { pregunta: conf.pregunta, foco: conf.foco, focoTras: tras.foco, color: tras.terminarColor, neutro: tras.neutroColor });
  ok('VA_sin_chat', !v.chat && !conf.chat, { chat: v.chat });

  // ── 390 px ──
  await p.setViewportSize({ width: 390, height: 844 }); await sleep(700);
  F.ordenes.push({ id: ++F.ordId, type: 'a-continuacion', trackId: Y.id, seqBase: 1, trackBase: null, by: 9002, title: Y.title ?? null });
  evento('a-continuacion', 9002, 'Sonia', { trackId: Y.id, title: Y.title ?? null });
  const conFila = await esperar(async () => { const x = await leer(p); return x.verFila === 'Siguen 1 · ver fila' ? x : null; }, 8000, 100);
  v = conFila.v ?? await leer(p);
  ok('VA_390_pestanas_y_ver_fila', v.pestanas.map((x) => x.texto.split(' · ')[0]).join('|') === 'Radio|Fila|Gente' && v.pestanas[0].sel === 'true' && v.paneles === 1
    && v.personas.length === 0 && v.luego === null && v.cancion != null && !!conFila.v && v.ancho <= 390 && !v.chat,
    { pestanas: v.pestanas, paneles: v.paneles, verFila: v.verFila, personas: v.personas.length, ancho: v.ancho });
  await foto(p, '5-telefono-pestana-radio', [390]);

  await p.locator('.radio-ver-fila').click(); await sleep(400);
  const enFila = await leer(p);
  await foto(p, '6-telefono-pestana-fila', [390]);
  await p.keyboard.press('ArrowRight'); await sleep(400);
  const enGente = await leer(p);
  await foto(p, '7-telefono-pestana-gente', [390]);
  await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft'); await sleep(400);
  const enRadio = await leer(p);
  ok('VA_390_ver_fila_y_teclado', enFila.pestanas[1]?.sel === 'true' && enFila.focoRol === 'tab' && enFila.foco?.startsWith('Fila') && enFila.fila.length === 1 && enFila.fila[0].pidio === 'La pidió Sonia'
    && enFila.cancion === null && enFila.personas.length === 0
    && enGente.pestanas[2]?.sel === 'true' && enGente.personas.length === 3 && enGente.eventos.length > 0 && enGente.fila.length === 0 && enGente.cancion === null
    && enRadio.pestanas[0]?.sel === 'true' && enRadio.cancion != null
    && [enFila, enGente, enRadio].every((x) => x.ancho <= 390 && x.paneles === 1),
    { fila: { pest: enFila.pestanas, foco: enFila.foco, rol: enFila.focoRol, fila: enFila.fila }, gente: { pest: enGente.pestanas, personas: enGente.personas.length, eventos: enGente.eventos.length },
      radio: enRadio.pestanas, anchos: [enFila.ancho, enGente.ancho, enRadio.ancho] });

  const fin = await terminarUI(p);
  const del = F.log.some((r) => r.m === 'DELETE');
  const sinRadio = await esperar(async () => ((await p.locator('.radio-inicio').count()) === 1 ? true : null), 4000, 100);
  ok('VA_390_terminar', !!fin.v && del && !!sinRadio.v && !(await vista(p)).anfitrion, { cerro: !!fin.v, delete: del, inicio: !!sinRadio.v });
} catch (e) {
  ok('VA_excepcion', false, { error: String(e?.message ?? e).split('\n')[0].slice(0, 300) });
}
ok('VA_sin_errores_de_pagina', errores.length === 0, { errores });
await ctx.close();

const fails = Object.entries(R).filter(([, x]) => (typeof x === 'object' ? !x.ok : !x));
console.log(JSON.stringify(R, null, 1));
if (CAPTURAS) console.log('[radio-vista-anfitrion-func] capturas:', JSON.stringify({ hechas: fotos.hechas.length, fallas: fotos.fallas }));
if (process.env.VISTA_DUMP) (await import('node:fs')).writeFileSync(process.env.VISTA_DUMP, JSON.stringify({ R, segundos: Math.round((Date.now() - T0) / 1000), fotos }, null, 1));
console.log(`\n[radio-vista-anfitrion-func] ${Math.round((Date.now() - T0) / 1000)} s`);
console.log(`\nradio-vista-anfitrion-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
