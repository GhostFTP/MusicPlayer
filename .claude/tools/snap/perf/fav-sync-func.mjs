// fav-sync-func.mjs — SINCRONÍA entre el corazón del reproductor y el detalle de «Mis favoritos».
// Con el detalle de «Mis favoritos» ABIERTO y SIN recargar la página (escritorio, 1440):
//   · barra → detalle: marcar la que suena la agrega a la lista (las filas que ya estaban no se
//     vuelven a montar); desmarcar una que está la quita; el encabezado («N canciones · duración») y
//     la tarjeta de la lista de playlists cuadran con el servidor;
//   · detalle → barra: «Quitar de esta playlist» sobre la que suena vacía el corazón de la barra y
//     el del expandido, y el servidor queda sin ella;
//   · con 1 elemento y con la lista vacía no se rompe nada, y desde vacía se puede volver a llenar;
//   · rollback: con el servidor fallando (500 con demora) la baja se ve al instante en el detalle y
//     vuelve sola, tanto desde la barra como desde «Quitar de esta playlist»; un alta que falla no
//     deja nada en el detalle; en los tres casos sale el aviso y el corazón vuelve al estado real;
//   · con OTRA playlist abierta, quitar una canción no toca los favoritos, y el corazón no toca esa
//     lista;
//   · con 60 favoritos y la lista scrolleada, agregar y quitar no mueve el scroll ni remonta filas.
// Con SNAP_REF (el build de main en otro puerto) corre lo mismo contra main como CONTROL NEGATIVO:
// las comprobaciones de sincronía (SYNC, abajo) tienen que FALLAR ahí; si alguna pasa en main, el
// script no estaría midiendo el bug. Sin SNAP_REF ese control NO se corre ni se cuenta, y se avisa.
// ⚠️ ESCRIBE (crea/borra «Mis favoritos» y «Sync otra» en la cuenta de prueba): sólo contra la COPIA.
// Uso: SNAP_BASE=http://localhost:4173 [SNAP_REF=http://localhost:4174] node fav-sync-func.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';

const REF = process.env.SNAP_REF ?? null;
await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

function wav(sec = 120, sr = 8000) {
  const n = sec * sr, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const WAV = wav();
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
const apiJ = async (path, opts = {}) => { const r = await fetch(BASE + path, { ...opts, headers: H }); return r.status === 204 ? null : r.json().catch(() => null); };
const FAV = 'Mis favoritos', OTRA = 'Sync otra';
const listas = async (name) => (await apiJ('/api/playlists')).filter((p) => p.name.trim() === name);
const wipe = async () => { for (const n of [FAV, OTRA]) for (const p of await listas(n)) await apiJ(`/api/playlists/${p.id}`, { method: 'DELETE' }); };
const crear = async (name, ids) => {
  const pl = await apiJ('/api/playlists', { method: 'POST', body: JSON.stringify({ name }) });
  for (const id of ids) await apiJ(`/api/playlists/${pl.id}/tracks`, { method: 'POST', body: JSON.stringify({ track_id: id }) });
  return pl.id;
};
const enServidor = async (name) => { const [p] = await listas(name); return p ? (await apiJ(`/api/playlists/${p.id}/tracks`)) : []; };
const idsServidor = async (name) => (await enServidor(name)).map((t) => t.id).sort((a, b) => a - b);

// El mismo formato que utils/formatTotal.js + contadorDeLista (sin videos).
function fmtTotal(secs) {
  const total = Math.round(secs || 0); if (total <= 0) return null;
  const h = Math.floor(total / 3600), m = Math.round((total % 3600) / 60);
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  return `${Math.max(1, m)} min`;
}
const contador = (n) => `${n} ${n === 1 ? 'canción' : 'canciones'}`;
const metaEsperada = (tracks) => { const d = fmtTotal(tracks.reduce((s, t) => s + (t.duration || 0), 0)); return contador(tracks.length) + (d ? ` · ${d}` : ''); };

const LIB = '.library-tracks .track-row';
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

// Abre una página, pone a sonar la primera fila de la Biblioteca (N) y, sin recargar, entra al
// detalle de la playlist `nombre` por la navegación de la app.
async function montar(base, nombre) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**/stream/**', (r) => {
    const h = r.request().headers().range; const total = WAV.length;
    if (!h) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV });
    const [, a, b] = h.match(/bytes=(\d*)-(\d*)/); const start = a ? +a : 0; const end = b ? +b : total - 1;
    r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: WAV.subarray(start, end + 1) });
  });
  await ctx.addInitScript((t) => localStorage.setItem('token', t), token);
  const p = await ctx.newPage();
  const errores = []; p.on('pageerror', (e) => errores.push(String(e.message).slice(0, 160)));
  await p.goto(base + '/'); await p.waitForSelector(LIB);
  await p.locator(LIB).first().click(); await p.waitForTimeout(900);
  if (nombre) {
    await p.locator('.sidebar, aside, nav').getByText('Playlists', { exact: true }).first().click();
    await p.locator('.playlist-item', { hasText: nombre }).first().click();
    await p.waitForSelector('.detail-meta'); await p.waitForTimeout(500);
  }
  const u = {
    ctx, p, errores,
    wait: (ms) => p.waitForTimeout(ms),
    corazon: () => p.locator('.player-bar .fav-player'),
    lleno: async () => (await p.locator('.player-bar .fav-player').getAttribute('aria-pressed')) === 'true',
    sonando: async () => (await p.locator('.player-bar .player-title').first().textContent()).trim(),
    filas: () => p.locator('.main-content .track-row .track-title').allTextContents().then((a) => a.map((s) => s.trim())),
    fila: (t) => p.locator('.main-content .track-row').filter({ hasText: t }).first(),
    meta: () => p.locator('.detail-meta').first().textContent().then((s) => s.trim().replace(/\s+/g, ' ')).catch(() => null),
    toasts: () => p.locator('.toast.warning .toast-text').allTextContents(),
    // Espera (hasta 4 s) a que las filas sean exactamente `titulos`; devuelve si llegó.
    async hasta(titulos) {
      for (let i = 0; i < 20; i++) { if (same(await u.filas(), titulos)) return true; await p.waitForTimeout(200); }
      return false;
    },
    async quitarDeLaPlaylist(t) {
      await u.fila(t).click({ button: 'right' });
      await p.waitForSelector('.ctx-menu [role="menuitem"]', { timeout: 3000 });
      await p.locator('.ctx-menu [role="menuitem"]', { hasText: 'Quitar de esta playlist' }).first().click();
    },
    async corazonExpandido() {
      await p.locator('.player-bar .player-art').click(); await p.waitForTimeout(900);
      const v = await p.locator('.exp-head-actions .fav-exp').getAttribute('aria-pressed').catch(() => null);
      await p.keyboard.press('Escape'); await p.waitForTimeout(500);
      return v;
    },
  };
  return u;
}

// Las que tienen que FALLAR en main (miden la sincronía que no existía).
const SYNC = [
  'barra_agrega_al_detalle', 'encabezado_tras_agregar', 'barra_quita_del_detalle', 'encabezado_tras_quitar',
  'tarjeta_de_la_lista_cuadra', 'detalle_vacia_el_corazon', 'quitar_la_ultima_deja_vacia', 'desde_vacia_agrega',
  'rollback_baja_desde_la_barra', 'rollback_baja_desde_el_detalle', 'scroll_se_conserva',
];

async function correr(base) {
  const R = {};
  const ok = (k, v, extra = {}) => { R[k] = { ok: !!v, ...extra }; };
  const bloque = async (nombre, claves, fn) => {
    try { await fn(); } catch (e) { for (const k of claves) if (!(k in R)) ok(k, false, { error: `${nombre}: ${String(e.message).split('\n')[0].slice(0, 140)}` }); }
  };

  // N = la primera fila de la Biblioteca: su id sale de marcarla una vez y leer el servidor.
  await wipe();
  let u = await montar(base, null);
  const tN = await u.sonando();
  await u.corazon().click(); await u.wait(1200);
  const N = (await enServidor(FAV))[0];
  await u.ctx.close(); await wipe();
  const todas = await apiJ('/api/tracks?limit=10000');
  const unicas = todas.filter((t) => t.id !== N.id && t.title && t.title !== tN && t.duration > 0 && todas.filter((x) => x.title === t.title).length === 1
    && !t.title.includes(tN) && !tN.includes(t.title));
  const [A, B, C] = [unicas[3], unicas[40], unicas[80]];

  // 1) BARRA → DETALLE: agregar y quitar con el detalle abierto.
  await bloque('barra→detalle', ['detalle_abre_con_lo_del_servidor', 'barra_agrega_al_detalle', 'encabezado_tras_agregar', 'tarjeta_de_la_lista_cuadra', 'barra_quita_del_detalle', 'encabezado_tras_quitar'], async () => {
    await crear(FAV, [A.id, B.id]);
    u = await montar(base, FAV);
    ok('detalle_abre_con_lo_del_servidor', same(await u.filas(), [A.title, B.title]) && (await u.meta()) === metaEsperada([A, B]) && !(await u.lleno()), { filas: await u.filas(), meta: await u.meta() });
    // Marca en el DOM: si las filas viejas se remontan, la marca se pierde.
    await u.p.evaluate(() => document.querySelectorAll('.main-content .track-row').forEach((r) => { r.dataset.marca = '1'; }));
    await u.corazon().click();
    const llego = await u.hasta([A.title, B.title, tN]);
    const marcadas = await u.p.locator('.main-content .track-row[data-marca="1"]').count();
    ok('barra_agrega_al_detalle', llego && marcadas === 2 && (await u.lleno()) && same(await idsServidor(FAV), [A.id, B.id, N.id]), { filas: await u.filas(), filas_no_remontadas: marcadas, corazon: await u.lleno() });
    ok('encabezado_tras_agregar', (await u.meta()) === metaEsperada([A, B, N]), { meta: await u.meta(), esperado: metaEsperada([A, B, N]) });
    // La tarjeta de la lista de playlists (se mira con 3, que no es ni el número inicial ni el final).
    await u.p.goBack(); await u.wait(700);
    const tarjeta = (await u.p.locator('.playlist-item', { hasText: FAV }).first().locator('.playlist-meta').textContent().catch(() => '')).trim();
    ok('tarjeta_de_la_lista_cuadra', tarjeta === contador(3), { tarjeta, esperado: contador(3) });
    await u.p.locator('.playlist-item', { hasText: FAV }).first().click(); await u.p.waitForSelector('.detail-meta'); await u.wait(600);
    // Suena A (desde el detalle) y se desmarca desde la barra.
    await u.fila(A.title).click(); await u.wait(900);
    const antes = { sonando: await u.sonando(), corazon: await u.lleno() };
    await u.corazon().click();
    const seFue = await u.hasta([B.title, tN]);
    await u.wait(700);
    ok('barra_quita_del_detalle', antes.corazon && seFue && !(await u.lleno()) && same(await idsServidor(FAV), [B.id, N.id]), { antes, filas: await u.filas() });
    ok('encabezado_tras_quitar', (await u.meta()) === metaEsperada([B, N]), { meta: await u.meta(), esperado: metaEsperada([B, N]) });
  });
  await u.ctx.close().catch(() => {}); await wipe();

  // 2) DETALLE → BARRA: «Quitar de esta playlist» sobre la que suena.
  await bloque('detalle→barra', ['detalle_vacia_el_corazon'], async () => {
    await crear(FAV, [A.id, B.id]);
    u = await montar(base, FAV);
    await u.fila(B.title).click(); await u.wait(900);
    const antes = { sonando: await u.sonando(), corazon: await u.lleno() };
    await u.quitarDeLaPlaylist(B.title);
    const seFue = await u.hasta([A.title]); await u.wait(700);
    const barra = await u.lleno(); const exp = await u.corazonExpandido();
    ok('detalle_vacia_el_corazon', antes.corazon && seFue && !barra && exp === 'false' && same(await idsServidor(FAV), [A.id]) && (await u.meta()) === metaEsperada([A]),
      { antes, filas: await u.filas(), corazon_barra: barra, corazon_expandido: exp, meta: await u.meta(), servidor: await idsServidor(FAV) });
  });
  await u.ctx.close().catch(() => {}); await wipe();

  // 3) UN ELEMENTO y LISTA VACÍA.
  await bloque('uno y vacía', ['un_elemento_no_rompe', 'quitar_la_ultima_deja_vacia', 'desde_vacia_agrega'], async () => {
    await crear(FAV, [N.id]);
    u = await montar(base, FAV);
    ok('un_elemento_no_rompe', same(await u.filas(), [tN]) && (await u.meta()) === metaEsperada([N]) && (await u.lleno()) && !u.errores.length, { filas: await u.filas(), meta: await u.meta(), errores: u.errores });
    await u.corazon().click();
    const vacia = await u.hasta([]); await u.wait(700);
    const cartel = await u.p.locator('.main-content .empty-title').first().textContent().catch(() => null);
    ok('quitar_la_ultima_deja_vacia', vacia && cartel === 'Playlist vacía' && (await u.meta()) === contador(0) && !(await u.lleno()) && same(await idsServidor(FAV), []) && !u.errores.length,
      { filas: await u.filas(), cartel, meta: await u.meta(), errores: u.errores });
    await u.corazon().click();
    const volvio = await u.hasta([tN]); await u.wait(500);
    ok('desde_vacia_agrega', vacia && volvio && (await u.meta()) === metaEsperada([N]) && (await u.lleno()) && same(await idsServidor(FAV), [N.id]) && !u.errores.length, { filas: await u.filas(), meta: await u.meta(), errores: u.errores });
  });
  await u.ctx.close().catch(() => {}); await wipe();

  // 4) ROLLBACK: el servidor contesta 500 (con demora, para ver el estado optimista en el medio).
  await bloque('rollback', ['rollback_baja_desde_la_barra', 'rollback_baja_desde_el_detalle', 'rollback_alta'], async () => {
    await crear(FAV, [N.id]);
    u = await montar(base, FAV);
    const falla = (r) => setTimeout(() => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"simulado"}' }).catch(() => {}), 900);
    const esBaja = (r) => r.request().method() === 'DELETE';
    await u.ctx.route('**/api/playlists/*/tracks/*', (r) => (esBaja(r) ? falla(r) : r.continue()));
    await u.corazon().click(); await u.wait(350);
    const medio = { filas: await u.filas(), corazon: await u.lleno() };
    const volvio = await u.hasta([tN]); await u.wait(600);
    const fin = { filas: await u.filas(), corazon: await u.lleno(), meta: await u.meta(), aviso: await u.toasts() };
    ok('rollback_baja_desde_la_barra', medio.filas.length === 0 && !medio.corazon && volvio && fin.corazon && fin.meta === metaEsperada([N])
      && fin.aviso.some((t) => t.includes('No se pudo quitar')) && same(await idsServidor(FAV), [N.id]), { medio, fin });
    await u.wait(4500);   // que se vaya el aviso anterior
    await u.quitarDeLaPlaylist(tN); await u.wait(350);
    const medio2 = { filas: await u.filas(), corazon: await u.lleno() };
    const volvio2 = await u.hasta([tN]); await u.wait(600);
    const fin2 = { filas: await u.filas(), corazon: await u.lleno(), meta: await u.meta(), aviso: await u.toasts() };
    ok('rollback_baja_desde_el_detalle', medio2.filas.length === 0 && !medio2.corazon && volvio2 && fin2.corazon && fin2.meta === metaEsperada([N])
      && fin2.aviso.some((t) => t.includes('No se pudo quitar')) && same(await idsServidor(FAV), [N.id]), { medio: medio2, fin: fin2 });
    // Alta que falla: primero una baja de verdad, después el POST contesta 500.
    await u.ctx.unroute('**/api/playlists/*/tracks/*');
    await u.wait(4500);
    await u.corazon().click(); await u.hasta([]); await u.wait(900);
    const base0 = { filas: await u.filas(), corazon: await u.lleno(), servidor: await idsServidor(FAV) };
    await u.ctx.route('**/api/playlists/*/tracks', (r) => (r.request().method() === 'POST' ? falla(r) : r.continue()));
    await u.corazon().click(); await u.wait(350);
    const medio3 = { filas: await u.filas(), corazon: await u.lleno() };
    await u.wait(1800);
    const fin3 = { filas: await u.filas(), corazon: await u.lleno(), meta: await u.meta(), aviso: await u.toasts() };
    ok('rollback_alta', base0.servidor.length === 0 && !base0.corazon && medio3.corazon && !fin3.corazon && fin3.filas.length === 0 && fin3.meta === contador(0)
      && fin3.aviso.some((t) => t.includes('No se pudo guardar')) && same(await idsServidor(FAV), []) && !u.errores.length, { base: base0, medio: medio3, fin: fin3, errores: u.errores });
  });
  await u.ctx.close().catch(() => {}); await wipe();

  // 5) OTRA PLAYLIST abierta: sus cambios y los del corazón no se cruzan.
  await bloque('otra playlist', ['otra_playlist_no_toca_favoritos', 'corazon_no_toca_otra_playlist'], async () => {
    await crear(FAV, [N.id]); await crear(OTRA, [N.id, C.id]);
    u = await montar(base, OTRA);
    const antes = { filas: await u.filas(), corazon: await u.lleno() };
    await u.quitarDeLaPlaylist(tN);
    const seFue = await u.hasta([C.title]); await u.wait(700);
    ok('otra_playlist_no_toca_favoritos', same(antes.filas, [tN, C.title]) && antes.corazon && seFue && (await u.lleno()) && same(await idsServidor(FAV), [N.id]) && same(await idsServidor(OTRA), [C.id]),
      { antes, filas: await u.filas(), corazon: await u.lleno(), favoritos: await idsServidor(FAV), otra: await idsServidor(OTRA) });
    await u.corazon().click(); await u.wait(1500);
    ok('corazon_no_toca_otra_playlist', !(await u.lleno()) && same(await u.filas(), [C.title]) && (await u.meta()) === metaEsperada([C]) && same(await idsServidor(FAV), []) && same(await idsServidor(OTRA), [C.id]) && !u.errores.length,
      { filas: await u.filas(), meta: await u.meta(), errores: u.errores });
  });
  await u.ctx.close().catch(() => {}); await wipe();

  // 6) SCROLL: con 60 favoritos y la lista scrolleada, agregar y quitar desde la barra no la mueve
  // (se tolera una fila: la nueva entra arriba y el navegador puede anclar el contenido) ni remonta filas.
  await bloque('scroll', ['scroll_se_conserva'], async () => {
    await crear(FAV, unicas.slice(100, 160).map((t) => t.id));
    u = await montar(base, FAV);
    const top = () => u.p.evaluate(() => { let e = document.querySelector('.main-content .track-row'); while (e && !(e.scrollHeight > e.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(e).overflowY))) e = e.parentElement; return e ? Math.round(e.scrollTop) : Math.round(window.scrollY); });
    const n0 = (await u.filas()).length;
    await u.p.locator('.main-content .track-row').nth(40).scrollIntoViewIfNeeded(); await u.wait(400);
    await u.p.evaluate(() => document.querySelectorAll('.main-content .track-row').forEach((r) => { r.dataset.marca = '1'; }));
    const t0 = await top();
    await u.corazon().click();
    for (let i = 0; i < 20 && (await u.filas()).length !== n0 + 1; i++) await u.wait(200);
    const t1 = await top(); const n1 = (await u.filas()).length; const marcadas = await u.p.locator('.main-content .track-row[data-marca="1"]').count();
    await u.corazon().click();
    for (let i = 0; i < 20 && (await u.filas()).length !== n0; i++) await u.wait(200);
    const t2 = await top(); const n2 = (await u.filas()).length;
    ok('scroll_se_conserva', n0 === 60 && t0 > 300 && n1 === 61 && marcadas === 60 && Math.abs(t1 - t0) <= 80 && n2 === 60 && Math.abs(t2 - t0) <= 80,
      { filas: [n0, n1, n2], scrollTop: [t0, t1, t2], filas_no_remontadas: marcadas });
  });
  await u.ctx.close().catch(() => {}); await wipe();
  return R;
}

const R = await correr(BASE);
let enMain = null;
if (REF) {
  enMain = await correr(REF);
  for (const k of SYNC) R[`control_main_falla_${k}`] = { ok: enMain[k]?.ok === false, en_main: enMain[k] };
}

const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
if (enMain) console.log('en main (control): ' + JSON.stringify(Object.fromEntries(Object.entries(enMain).map(([k, v]) => [k, v.ok]))));
console.log(REF ? `referencia (main): ${REF}` : 'SIN SNAP_REF: el control negativo contra main (control_main_falla_*) NO se corrió ni se cuenta.');
console.log(`\nfav-sync-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
