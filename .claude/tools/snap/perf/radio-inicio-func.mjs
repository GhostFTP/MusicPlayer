// radio-inicio-func.mjs — «Inicia tu radio» eligiendo qué suena (1.46.0, R1), contra el BUILD DE PRODUCCIÓN (preview
// :4173) y el backend REAL del runner (:3100, copia de la base) para la biblioteca, las playlists y las listas.
//
// La RADIO es un SERVIDOR FALSO (page.route sobre /api/radio, como radio-func 11-18): lo que se prueba es qué se carga,
// qué suena y qué se publica primero, no la creación; y así no se gasta el tope de 6 radios por minuto por cuenta, que
// radio-func ya usa en la misma corrida. En el POST se anota qué sonaba en ese instante: prueba que PRIMERO suena y
// DESPUÉS se crea la radio (el orden de la app del iPhone).
//
// Casos:
//   RI_sin_cancion_se_ofrece_todo_menos_lo_actual   sin nada sonando: Mix por defecto, sin «Lo que estoy escuchando»,
//        sin aviso de reemplazo, el botón activo y sin «Pon una canción para empezar».
//   RI_mix                 Mix de toda la biblioteca: suena revuelta ANTES del POST, y el primer estado publicado es esa.
//   RI_aviso_de_reemplazo  con algo sonando: «Lo que estoy escuchando» por defecto y sin aviso; otra fuente muestra el
//        aviso y el botón lo tiene como descripción.
//   RI_album               el primer álbum: su cola es la del álbum, en orden, y suena antes del POST.
//   RI_playlist            una playlist de la cuenta (creada por la prueba): su cola, en orden.
//   RI_genero              el primer género: todas las canciones de la cola son de ese género.
//   RI_lista_que_falla_y_reintentar   la lista de años falla: lo dice y «Reintentar» la trae.
//   RI_anio                el primer año: todas las canciones de la cola son de ese año.
//   RI_lo_que_estoy_escuchando   no toca la cola y publica lo que ya sonaba.
//   RI_crear_falla_sigue_sonando_y_reintentar   el servidor rechaza crear la radio con el álbum ya sonando: la tarjeta
//        dice «No se pudo iniciar la radio. Lo que elegiste sigue sonando solo para ti.», el álbum sigue sonando, y
//        «Reintentar» crea la radio con lo que suena, sin volver a cargar ni tocar la cola.
//   RI_fuente_vacia_no_crea      una playlist vacía: lo explica, no hay POST y la cola no cambia.
//   RI_carga_que_falla_no_crea   las canciones de la playlist fallan: lo explica, no hay POST y la cola no cambia.
//   RI_390_dos_columnas_sin_scroll   a 390 px: dos columnas y sin scroll horizontal.
//   RI_sin_errores_de_pagina
//
// CONTROL NEGATIVO (a mano): llamando iniciar() antes de play() caen RI_mix/RI_album/RI_playlist (en el POST todavía
// suena lo anterior); sin el chequeo de vacía cae RI_fuente_vacia_no_crea (hay POST); sin el aviso cae RI_aviso.
// Uso: SNAP_BASE=http://localhost:4173 SNAP_USER=… SNAP_PASS=… node radio-inicio-func.mjs
// INICIO_DUMP=<archivo>: deja ahí los resultados con sus valores.
import { R, ok, sleep, tokHost, api, abrir, vista, esperar, sonar, terminarUI, BASE, browser } from './radio-anfitrion-comun.mjs';

const T0 = Date.now();
const REEMPLAZA = 'Esto reemplaza lo que estás escuchando y tu cola. Al terminar la radio no vuelve.';
const FALLO_INICIAR = 'No se pudo iniciar la radio. Lo que elegiste sigue sonando solo para ti.';

// ── El servidor de radio falso: anota cada pedido; en el POST, qué sonaba en ese instante ──
const F = { log: [], seq: 0, puts: [], posts: [], fallarPost: 0, postsRechazados: 0 };
let p = null;
async function falso(route) {
  const q = route.request(); const m = q.method(); const t = Date.now();
  F.log.push({ t, m });
  const code = 'K7M2QX';
  if (m === 'POST' && F.fallarPost > 0) {   // el servidor dice que no (como con demasiadas radios abiertas)
    F.fallarPost--; F.postsRechazados++;
    return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Hay demasiadas radios en vivo. Intenta más tarde.' }) });
  }
  if (m === 'POST') {
    const sonaba = await p.evaluate(() => window.__player?.()?.currentTrack?.id ?? null).catch(() => null);
    F.posts.push({ t, sonaba });
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ code, serverNow: t, status: 'live' }) });
  }
  if (m === 'PUT') {
    const b = JSON.parse(q.postData() || '{}');
    F.puts.push({ t, b });
    const state = { seq: ++F.seq, trackId: b.trackId ?? null, positionMs: b.positionMs ?? 0, playing: b.playing ?? false, nextTrackId: b.nextTrackId ?? null, enPausaPorVideo: !!b.enPausaPorVideo, publishedAtServerMs: t };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ serverNow: t, status: 'live', state }) });
  }
  if (m === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ serverNow: t, code, status: 'live', state: null, host: { id: 1, name: 'h' }, listeners: [] }) });
  if (m === 'DELETE') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ serverNow: t, status: 'ended', endedReason: 'anfitrion' }) });
  return route.continue();
}
const PLAYER = () => {
  const buscar = (es) => {
    const root = document.getElementById('root'); const key = root && Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
    if (!key) return null; const stack = [root[key]?.stateNode?.current ?? root[key]];
    while (stack.length) { const f = stack.pop(); if (!f) continue; const v = f.memoizedProps?.value; if (v && es(v)) return v; if (f.sibling) stack.push(f.sibling); if (f.child) stack.push(f.child); }
    return null;
  };
  window.__player = () => buscar((v) => typeof v.play === 'function' && typeof v.addToQueue === 'function');
};

const arr = (j) => (Array.isArray(j) ? j : (j?.tracks ?? []));
const ids = (l) => l.map((t) => t.id);
const cola = () => p.evaluate(() => { const v = window.__player(); return { ids: v.queue.map((t) => t.id), actual: v.currentTrack?.id ?? null, shuffle: v.shuffle, tracks: v.queue.map((t) => ({ id: t.id, genre: t.genre ?? null, year: t.year ?? null })) }; });
const tarjeta = () => p.evaluate(() => {
  const c = document.querySelector('.radio-inicio'); if (!c) return null;
  const btn = [...c.querySelectorAll('.radio-btn')].find((b) => /Iniciar|Creando|Preparando/.test(b.textContent));
  const aviso = c.querySelector('.radio-inicio-reemplaza');
  const sel = c.querySelector('.radio-inicio-item select');
  return {
    fuentes: [...c.querySelectorAll('.radio-fuente')].map((l) => l.dataset.fuente),
    elegida: c.querySelector('.radio-fuente input:checked')?.value ?? null,
    aviso: aviso?.textContent ?? null, avisoEsDescripcion: !!(aviso && btn && btn.getAttribute('aria-describedby') === aviso.id),
    boton: btn ? { texto: btn.textContent.trim(), off: btn.disabled } : null,
    problema: c.querySelector('.radio-inicio-problema')?.textContent ?? '',
    select: sel ? { off: sel.disabled, valor: sel.value, opciones: sel.options.length } : null,
    listaError: c.querySelector('.radio-inicio-lista-error')?.textContent ?? null,
    notas: [...document.querySelectorAll('.main-content .radio-nota')].map((n) => n.textContent),
  };
});
const elegir = async (fuente) => { await p.locator(`.radio-inicio .radio-fuente[data-fuente="${fuente}"]`).click(); await sleep(200); };
const listaLista = () => esperar(async () => { const t = await tarjeta(); return t?.select && !t.select.off && t.select.opciones > 0 ? t : null; }, 8000, 100);
/** Inicia con lo elegido y espera la radio y su primer PUT. → { post, put } */
const empezar = async () => {
  const n0 = F.posts.length, m0 = F.puts.length;
  await p.locator('.radio-inicio .radio-btn--iniciar').click();
  const listo = await esperar(async () => ((await vista(p)).anfitrion && F.puts.length > m0 ? true : null), 10_000, 100);
  return { listo: !!listo.v, post: F.posts[n0] ?? null, put: F.puts[m0]?.b ?? null };
};
const terminar = async () => { await terminarUI(p); await sleep(400); };

let plConCanciones = null; let plVacia = null; const errores = [];
try {
  // La biblioteca y dos playlists de la cuenta (una con 3 canciones en un orden propio, otra vacía).
  const todas = arr((await api(tokHost, 'GET', '/api/tracks?limit=400')).j);
  if (todas.length < 5) throw new Error(`hacen falta 5 canciones en la copia (hay ${todas.length})`);
  plConCanciones = (await api(tokHost, 'POST', '/api/playlists', { name: 'Radio inicio (prueba)', emoji: '📻' })).j;
  const ORDEN_PL = [todas[4], todas[1], todas[3]];
  for (const t of ORDEN_PL) await api(tokHost, 'POST', `/api/playlists/${plConCanciones.id}/tracks`, { track_id: t.id });
  plVacia = (await api(tokHost, 'POST', '/api/playlists', { name: 'Radio vacía (prueba)', emoji: '🫙' })).j;

  ({ p } = await abrir({ falso, init: PLAYER }));
  p.on('pageerror', (e) => errores.push(String(e.message).slice(0, 160)));
  await p.goto(BASE + '/radio'); await p.waitForSelector('.radio-inicio', { timeout: 10_000 });
  await p.waitForFunction(() => !!window.__player?.());

  // ── Sin nada sonando ──
  const t0 = await tarjeta();
  ok('RI_sin_cancion_se_ofrece_todo_menos_lo_actual', !!t0 && JSON.stringify(t0.fuentes) === '["mix","playlist","album","genero","anio"]' && t0.elegida === 'mix'
    && t0.aviso === null && t0.boton?.texto === 'Iniciar radio' && t0.boton.off === false && !t0.notas.some((x) => x.includes('Pon una canción')), t0);

  // ── Mix ──
  const rMix = await empezar();
  const cMix = await cola();
  ok('RI_mix', rMix.listo && rMix.post?.sonaba != null && rMix.post.sonaba === cMix.actual && rMix.put?.trackId === rMix.post.sonaba && cMix.shuffle === true && cMix.ids.length >= Math.min(todas.length, 5),
    { post: rMix.post, primerPut: rMix.put?.trackId, actual: cMix.actual, revuelta: cMix.shuffle, enCola: cMix.ids.length });
  await terminar();

  // ── Con algo sonando: el aviso de reemplazo ──
  const t1 = await tarjeta();
  await elegir('album'); const t2 = await tarjeta();
  ok('RI_aviso_de_reemplazo', t1?.fuentes[0] === 'actual' && t1.elegida === 'actual' && t1.aviso === null && t2?.aviso === REEMPLAZA && t2.avisoEsDescripcion,
    { antes: { fuentes: t1?.fuentes, elegida: t1?.elegida, aviso: t1?.aviso }, conAlbum: { aviso: t2?.aviso, esDescripcion: t2?.avisoEsDescripcion } });

  // ── Álbum (el primero de la lista) ──
  const albumes = (await api(tokHost, 'GET', '/api/albums')).j ?? [];
  const alb0 = albumes[0];
  const esperadoAlb = ids(arr((await api(tokHost, 'GET', `/api/tracks?${new URLSearchParams({ album: alb0.album, limit: 500, ...(alb0.album_artist ? { album_artist: alb0.album_artist } : {}) })}`)).j));
  await listaLista();
  const rAlb = await empezar(); const cAlb = await cola();
  ok('RI_album', rAlb.listo && JSON.stringify(cAlb.ids) === JSON.stringify(esperadoAlb) && rAlb.post?.sonaba === esperadoAlb[0] && rAlb.put?.trackId === esperadoAlb[0] && cAlb.shuffle === false,
    { album: alb0.album, esperado: esperadoAlb.length, enCola: cAlb.ids.length, post: rAlb.post, primerPut: rAlb.put?.trackId });
  await terminar();

  // ── Playlist (la de la prueba) ──
  await elegir('playlist'); await listaLista();
  await p.selectOption('.radio-inicio-item select', String(plConCanciones.id)); await sleep(200);
  const rPl = await empezar(); const cPl = await cola();
  ok('RI_playlist', rPl.listo && JSON.stringify(cPl.ids) === JSON.stringify(ids(ORDEN_PL)) && rPl.post?.sonaba === ORDEN_PL[0].id && rPl.put?.trackId === ORDEN_PL[0].id,
    { esperado: ids(ORDEN_PL), cola: cPl.ids, post: rPl.post, primerPut: rPl.put?.trackId });
  await terminar();

  // ── Género (el primero) ──
  await elegir('genero'); const tg = (await listaLista()).v;
  const genero = await p.evaluate(() => document.querySelector('.radio-inicio-item select')?.value ?? null);
  const rGen = await empezar(); const cGen = await cola();
  ok('RI_genero', rGen.listo && !!genero && cGen.ids.length > 0 && cGen.tracks.every((t) => t.genre === genero) && rGen.post?.sonaba === cGen.ids[0] && rGen.put?.trackId === cGen.ids[0],
    { genero, enCola: cGen.ids.length, otros: cGen.tracks.filter((t) => t.genre !== genero).length, post: rGen.post, opciones: tg?.select?.opciones });
  await terminar();

  // ── La lista de años falla y se reintenta ──
  let fallar = true;
  await p.route('**/api/browse/years', (r) => (fallar ? r.abort('failed') : r.fallback()));
  await elegir('anio');
  const te = await esperar(async () => { const t = await tarjeta(); return t?.listaError ? t : null; }, 6000, 100);
  fallar = false;
  await p.locator('.radio-inicio-lista-error .radio-btn').click();
  const tr = await listaLista();
  await p.unroute('**/api/browse/years');
  ok('RI_lista_que_falla_y_reintentar', !!te.v && /No se pudo cargar la lista\./.test(te.v.listaError) && !!tr.v && tr.v.select.opciones > 0, { error: te.v?.listaError ?? null, opcionesTras: tr.v?.select?.opciones ?? null });

  // ── Año (el primero) ──
  const anio = Number(await p.evaluate(() => document.querySelector('.radio-inicio-item select')?.value ?? 'NaN'));
  const rAn = await empezar(); const cAn = await cola();
  ok('RI_anio', rAn.listo && Number.isInteger(anio) && cAn.ids.length > 0 && cAn.tracks.every((t) => t.year === anio) && rAn.post?.sonaba === cAn.ids[0], { anio, enCola: cAn.ids.length, otros: cAn.tracks.filter((t) => t.year !== anio).length });
  await terminar();

  // ── Lo que estoy escuchando: no toca la cola ──
  const antes = await cola();
  await elegir('actual');
  const rAc = await empezar(); const despues = await cola();
  ok('RI_lo_que_estoy_escuchando', rAc.listo && JSON.stringify(despues.ids) === JSON.stringify(antes.ids) && rAc.post?.sonaba === antes.actual && rAc.put?.trackId === antes.actual,
    { igualCola: JSON.stringify(despues.ids) === JSON.stringify(antes.ids), post: rAc.post, actual: antes.actual });
  await terminar();

  // ── Crear falla con lo elegido ya sonando: lo dice, sigue sonando, y «Reintentar» crea la radio con eso ──
  await elegir('album'); await listaLista();
  F.fallarPost = 1; const nPf = F.posts.length;
  await p.locator('.radio-inicio .radio-btn--iniciar').click();
  const tfi = await esperar(async () => { const t = await tarjeta(); return t?.problema === FALLO_INICIAR ? t : null; }, 8000, 100);
  const cFi = await cola();
  const sinRadioFi = !(await vista(p)).anfitrion;
  const botonesFi = await p.locator('.radio-inicio-reintentar .radio-btn').count();
  if (botonesFi) await p.locator('.radio-inicio-reintentar .radio-btn').click();
  const creadaFi = await esperar(async () => ((await vista(p)).anfitrion && F.posts.length > nPf ? true : null), 8000, 100);
  const cFi2 = await cola();
  ok('RI_crear_falla_sigue_sonando_y_reintentar', !!tfi.v && sinRadioFi && F.postsRechazados === 1 && cFi.actual === esperadoAlb[0] && botonesFi === 1 && !!creadaFi.v
    && JSON.stringify(cFi2.ids) === JSON.stringify(cFi.ids) && F.posts[nPf]?.sonaba === cFi.actual,
    { problema: tfi.v?.problema ?? null, sinRadio: sinRadioFi, rechazados: F.postsRechazados, sonaba: cFi.actual, esperado: esperadoAlb[0], reintentar: botonesFi, creada: !!creadaFi.v, mismaCola: JSON.stringify(cFi2.ids) === JSON.stringify(cFi.ids) });
  await terminar();

  // ── Fuente vacía: no se crea ──
  const c0 = await cola(); const nPost = F.posts.length;
  await elegir('playlist'); await listaLista();
  await p.selectOption('.radio-inicio-item select', String(plVacia.id)); await sleep(200);
  await p.locator('.radio-inicio .radio-btn--iniciar').click();
  const tv = await esperar(async () => { const t = await tarjeta(); return t?.problema ? t : null; }, 6000, 100);
  await sleep(600);
  ok('RI_fuente_vacia_no_crea', tv.v?.problema === 'Esa playlist no tiene canciones, así que no se creó la radio.' && F.posts.length === nPost && JSON.stringify((await cola()).ids) === JSON.stringify(c0.ids) && !(await vista(p)).anfitrion,
    { problema: tv.v?.problema ?? null, posts: F.posts.length - nPost });

  // ── La carga falla: no se crea ──
  await p.route(`**/api/playlists/${plConCanciones.id}/tracks`, (r) => r.abort('failed'));
  await p.selectOption('.radio-inicio-item select', String(plConCanciones.id)); await sleep(200);
  await p.locator('.radio-inicio .radio-btn--iniciar').click();
  const tf = await esperar(async () => { const t = await tarjeta(); return t?.problema?.startsWith('No se pudieron') ? t : null; }, 8000, 100);
  await sleep(600);
  await p.unroute(`**/api/playlists/${plConCanciones.id}/tracks`);
  ok('RI_carga_que_falla_no_crea', tf.v?.problema === 'No se pudieron cargar las canciones, así que no se creó la radio. Intenta de nuevo.' && F.posts.length === nPost && JSON.stringify((await cola()).ids) === JSON.stringify(c0.ids),
    { problema: tf.v?.problema ?? null, posts: F.posts.length - nPost });

  // ── A 390 px ──
  await p.setViewportSize({ width: 390, height: 844 }); await sleep(700);
  const m = await p.evaluate(() => {
    const g = document.querySelector('.radio-inicio-grilla');
    return { columnas: g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : 0, ancho: document.documentElement.scrollWidth, boton: !!document.querySelector('.radio-inicio .radio-btn--iniciar') };
  });
  await p.setViewportSize({ width: 1440, height: 900 }); await sleep(300);
  ok('RI_390_dos_columnas_sin_scroll', m.columnas === 2 && m.ancho <= 390 && m.boton, m);

  ok('RI_sin_errores_de_pagina', errores.length === 0, { errores });
} catch (e) {
  ok('RI_excepcion', false, { error: String(e?.message ?? e).split('\n')[0].slice(0, 200) });
} finally {
  for (const pl of [plConCanciones, plVacia]) if (pl?.id) await api(tokHost, 'DELETE', `/api/playlists/${pl.id}`).catch(() => {});
}

const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
if (process.env.INICIO_DUMP) (await import('node:fs')).writeFileSync(process.env.INICIO_DUMP, JSON.stringify({ R, segundos: Math.round((Date.now() - T0) / 1000) }, null, 1));
console.log(`\n[radio-inicio-func] ${Math.round((Date.now() - T0) / 1000)} s`);
console.log(`\nradio-inicio-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
