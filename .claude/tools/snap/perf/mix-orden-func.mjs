// mix-orden-func.mjs — funcional del ORDEN FIJO del aleatorio (tipo iOS) y del «Mix aleatorio».
//
// Hasta ahora, con el aleatorio encendido, el motor no tenía orden: «siguiente» sorteaba entre las no
// sonadas, «anterior» salía del historial y la cola que se ve no era el orden real («Aleatorio · orden
// de la cola» lo avisaba en el header). El Mix (ShuffleButton y la tecla M) hacía play(barajada, 0) y
// después encendía el aleatorio, que ignoraba ese orden. La regla nueva: con aleatorio, la cola que se
// ve ES el orden de reproducción, y siguiente/anterior caminan por posición.
//
// Comprueba, a 1440, con una biblioteca SINTÉTICA de 10 pistas (intercepción de /api/tracks; el audio
// es un WAV silencioso con Range, como queue-func.mjs) y, con videos, una lista SINTÉTICA de 8 (/api/
// videos interceptado) que suenan todos con los bytes del fixture «Largo Para Seek» (30 s) de
// video-fixtures.mjs, pedido una vez al backend de la corrida:
//   · el Mix (botón .mix-btn de la vista) arma la cola con TODA la vista, enciende el aleatorio y la
//     cola visible (el drawer) es la del motor;
//   · «siguiente» sigue la cola visible fila por fila; siguiente → anterior → siguiente da la MISMA;
//   · avanzar hasta el final suena las N sin repetir ni dejar fuera ninguna, en el orden de la cola;
//     retroceder hasta el inicio recorre lo mismo al revés y volver a avanzar repite el MISMO orden;
//   · apagar el aleatorio devuelve el orden de la vista (lo agregado con «Agregar a la cola» queda al
//     final), sin corte (mismo _qid, mismo src, el tiempo sigue avanzando) y «siguiente» sigue la vista;
//   · (sólo canciones) «repetir todo» vuelve a empezar en el MISMO orden, sin rebarajar; encender el
//     aleatorio con algo sonando baraja sólo lo que viene, sin tocar lo anterior ni cortar; tocar una
//     pista con el aleatorio encendido la pone PRIMERA y el resto barajado trae todas las demás;
//     «Reproducir a continuación» sigue sonando justo después de la actual; mover en la cola
//     (moveInQueue, y el arrastre real del drawer con el mouse) cambia lo que suena después.
// Los casos comunes corren con canciones (_canciones) y con videos (_videos), mismo código.
//
// El estado se lee del value de PlayerContext por la fibra de React (como fin-de-cola.mjs), y las
// operaciones sin botón cómodo (seek a 0 antes de «anterior», moveInQueue) llaman a funciones que
// usePlayer() ya expone. Todo lo demás va por la UI: el Mix de la vista, el aleatorio, el repetir,
// siguiente y anterior de la barra, el clic en la fila, el menú contextual y el drawer de la cola.
// Contra el motor de ANTES de este cambio fallan varios casos a propósito (ver cada clave).
//
// Uso: SNAP_BASE=http://localhost:4173 node mix-orden-func.mjs
// Termina con la línea `mix-orden-func: N/M` y código 0 (todo bien) o 1 (alguno falló). Sin el
// fixture de video en el backend NO CORRE (código 2).
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';

const NOMBRE = 'mix-orden-func';
const noCorrio = (msg) => { console.error(`[${NOMBRE}] NO CORRIÓ: ${msg}`); process.exit(2); };

await preflight();
const token = await getToken();
const H = { Authorization: `Bearer ${token}` };

// ── El video: los bytes del fixture largo, una vez. Sirven para TODOS los videos sintéticos. ──
const FIXTURE_LARGO = 'Largo Para Seek';
let VIDEO;
try {
  const lista = (await (await fetch(`${BASE}/api/videos`, { headers: H })).json()).videos ?? [];
  const largo = lista.find((v) => v.title === FIXTURE_LARGO);
  if (!largo) noCorrio(`el backend no tiene el fixture «${FIXTURE_LARGO}» (VIDEO_DIR con los fixtures de video-fixtures.mjs)`);
  const res = await fetch(`${BASE}/stream/video/${largo.id}`, { headers: H });
  if (!res.ok) noCorrio(`no se pudo bajar el fixture «${FIXTURE_LARGO}» (HTTP ${res.status})`);
  VIDEO = Buffer.from(await res.arrayBuffer());
} catch (e) {
  noCorrio(`no se pudo pedir /api/videos: ${e.message}`);
}

const { chromium } = await loadPlaywright();

function wav(sec = 900, sr = 8000) {
  const n = sec * sr, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const WAV = wav();

// Biblioteca sintética: 10 pistas con ids únicos (lejos de los reales) y completas para trackMeta
// (album + codec): el motor no pide nada más por pista. Artistas distintos → el orden de la vista
// (por artista) es fijo, y no coincide con el de los ids.
const LETRAS = 'JABHCIDGEF';
const LIB = Array.from({ length: 10 }, (_, i) => ({
  id: 970001 + i, title: `Orden ${String(i + 1).padStart(2, '0')}`, artist: `Artista ${LETRAS[i]}`, album_artist: `Artista ${LETRAS[i]}`,
  album: `Álbum ${LETRAS[i]}`, track_number: 1, disc_number: 1, year: 1990 + i, genre: 'Prueba', duration: 900,
  codec: 'flac', sample_rate: 44100, bits_per_sample: 16, bitrate: 900, lossless: 1, cover_path: null, added_at: '2024-01-01 00:00:00',
}));
// Videos sintéticos: 8, sin portada (no se pide nada más). Ids hex de 16 como los del backend.
const VIDS = Array.from({ length: 8 }, (_, i) => ({
  id: `0f0f0f0f0f0f0f${(0xa0 + i).toString(16)}`, title: `Video ${i + 1}`, artist: `Mix Orden ${'HDAFCGBE'[i]}`, year: null,
  ext: 'mp4', size: VIDEO.length, mime: 'video/mp4', duration: 30, has_cover: false,
}));

const R = {};
const ok = (k, v, extra = {}) => {
  if (k in R) throw new Error(`clave repetida: ${k}`);
  R[k] = { ok: !!v, ...extra };
};
const medidas = {};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

function servir(r, buf, tipo) {
  const h = r.request().headers().range; const total = buf.length;
  if (!h) return r.fulfill({ status: 200, contentType: tipo, headers: { 'Accept-Ranges': 'bytes' }, body: buf });
  const [, a, b] = h.match(/bytes=(\d*)-(\d*)/) ?? [];
  const start = a ? +a : 0; const end = b ? Math.min(+b, total - 1) : total - 1;
  return r.fulfill({ status: 206, contentType: tipo, headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: buf.subarray(start, end + 1) });
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

async function abrir(ruta, esperar) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route((u) => u.pathname.startsWith('/stream/'), (r) => (new URL(r.request().url()).pathname.startsWith('/stream/video/') ? servir(r, VIDEO, 'video/mp4') : servir(r, WAV, 'audio/wav')));
  await ctx.route((u) => u.pathname === '/api/tracks' && !['album', 'artist', 'album_artist', 'genre', 'year', 'search'].some((k) => u.searchParams.has(k)),
    (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LIB) }));
  await ctx.route((u) => u.pathname === '/api/videos', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ videos: VIDS }) }));
  await ctx.route('**/api/plays', (r) => r.fulfill({ status: 201, contentType: 'application/json', body: '{"added":0,"already":0,"skipped":0}' }));
  await ctx.addInitScript((t) => {
    localStorage.setItem('token', t);
    window.__moEls = new Set();
    const op = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...a) { window.__moEls.add(this); return op.apply(this, a); };
    window.__moPlayer = () => {
      const root = document.getElementById('root');
      const key = Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
      const stack = [root[key]?.stateNode?.current ?? root[key]];
      while (stack.length) {
        const f = stack.pop();
        if (!f) continue;
        const v = f.memoizedProps?.value;
        if (v && typeof v.play === 'function' && typeof v.addToQueue === 'function') return v;
        if (f.sibling) stack.push(f.sibling);
        if (f.child) stack.push(f.child);
      }
      return null;
    };
    window.__moEstado = () => {
      const v = window.__moPlayer();
      const sonando = [...window.__moEls].filter((e) => !e.paused && !e.ended);
      return {
        cola: v.queue.map((x) => x.title), qids: v.queue.map((x) => String(x._qid)), kinds: v.queue.map((x) => x.kind ?? 'audio'),
        idx: v.queueIndex, actual: v.currentTrack?.title ?? null, qid: v.currentTrack?._qid != null ? String(v.currentTrack._qid) : null,
        shuffle: v.shuffle, repeat: v.repeat, isPlaying: v.isPlaying,
        sonando: sonando.length, t: sonando[0] ? +sonando[0].currentTime.toFixed(2) : null, src: sonando[0]?.getAttribute('src') ?? null,
      };
    };
  }, token);
  const p = await ctx.newPage();
  const errores = []; p.on('pageerror', (e) => errores.push(String(e.message).slice(0, 160)));
  await p.goto(BASE + ruta);
  await p.waitForSelector(esperar);
  await p.waitForTimeout(800);
  return { ctx, p, errores };
}

const estado = (p) => p.evaluate(() => window.__moEstado());
const actual = (p) => p.evaluate(() => { const v = window.__moPlayer(); return { qid: v.currentTrack?._qid != null ? String(v.currentTrack._qid) : null, t: v.currentTrack?.title ?? null }; });
const suena = (p) => p.waitForFunction(() => { const e = window.__moEstado(); return e.isPlaying && e.sonando === 1 && e.t > 0.3; }, null, { timeout: 8000 }).then(() => true, () => false);
const frames = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

// La cola VISIBLE: las filas del drawer en su orden (data-index), con la marcada como actual.
async function abrirCola(p) {
  if (!(await p.locator('.queue-panel .queue-list').isVisible().catch(() => false))) {
    await p.locator('.player-actions .queue-btn').click();
    await p.waitForSelector('.queue-panel .queue-row', { timeout: 5000 });
  }
  await p.waitForTimeout(250);
}
async function colaDom(p) {
  await frames(p); await p.waitForTimeout(100);
  return p.evaluate(() => [...document.querySelectorAll('.queue-panel .queue-list > .queue-row')]
    .map((li) => ({ qid: String(li.dataset.qid), i: Number(li.dataset.index), t: li.querySelector('.queue-title-name')?.textContent ?? null, cur: li.classList.contains('current'), pill: !!li.querySelector('.queue-pill') }))
    .sort((a, b) => a.i - b.i));
}
const qidsDom = (d) => d.map((r) => r.qid);
const titulosDom = (d) => d.map((r) => r.t);

// Un paso con «siguiente» o «anterior» de la barra. Antes de «anterior», seek a 0: con más de 3 s
// «anterior» vuelve al inicio de la misma. Espera a que cambie la actual (o se rinde a los 3 s).
async function paso(p, dir) {
  const antes = await actual(p);
  if (dir === 'prev') await p.evaluate(() => window.__moPlayer().seek(0));
  await p.locator(dir === 'next' ? '.player-bar .ctrl-next' : '.player-bar .ctrl-prev').click();
  await p.waitForFunction((q) => { const c = window.__moPlayer().currentTrack; return (c?._qid != null ? String(c._qid) : null) !== q; }, antes.qid, { timeout: 3000 }).catch(() => {});
  await p.waitForTimeout(120);
  return actual(p);
}
// Varios pasos; devuelve lo que sonó (incluida la de partida). Si un paso no cambia nada, corta ahí
// (queda repetida al final de la secuencia: así se ve en la salida dónde se trabó).
async function recorrer(p, pasos, dir) {
  const seq = [await actual(p)];
  for (let i = 0; i < pasos; i++) {
    const n = await paso(p, dir);
    seq.push(n);
    if (n.qid === seq[seq.length - 2].qid) break;
  }
  return seq;
}
const tq = (seq) => seq.map((x) => x.t);
const qq = (seq) => seq.map((x) => x.qid);

async function ponerAleatorio(p, on) {
  if ((await estado(p)).shuffle === on) return;
  await p.locator('.player-bar .shuffle-btn').click();
  await p.waitForFunction((v) => window.__moPlayer().shuffle === v, on, { timeout: 3000 }).catch(() => {});
  await p.waitForTimeout(250);
}
async function ponerRepetir(p, modo) {
  for (let i = 0; i < 3 && (await estado(p)).repeat !== modo; i++) {
    await p.locator('.player-bar .player-buttons [aria-label^="Repetir"]').first().click();
    await p.waitForTimeout(250);
  }
  return (await estado(p)).repeat;
}
// Espera a que la cola sea OTRA (otros _qid) y con `n` ítems: lo que deja un play() nuevo.
async function esperarColaNueva(p, antes, n) {
  await p.waitForFunction(([a, k]) => { const v = window.__moPlayer(); return v.currentTrack && v.queue.length === k && v.queue.map((x) => String(x._qid)).join(',') !== a; }, [antes, n], { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(300);
}
// Menú contextual (clic derecho) sobre un ítem de la vista y una acción ('next' | 'queue').
async function menuAccion(p, loc, accion, largoEsperado) {
  await loc.scrollIntoViewIfNeeded(); await frames(p);
  await loc.click({ button: 'right' });
  await p.waitForSelector('.ctx-menu [role="menuitem"]', { timeout: 4000 });
  await p.waitForTimeout(150);
  await p.locator(`.ctx-menu [role="menuitem"][data-accion="${accion}"]`).first().click();
  await p.waitForFunction((k) => window.__moPlayer().queue.length === k, largoEsperado, { timeout: 3000 }).catch(() => {});
  await p.waitForTimeout(300);
}
// «Sin corte»: lo que suena antes y después de la acción es el mismo ítem, en el mismo elemento y
// src, y su tiempo no vuelve atrás y sigue avanzando.
async function sinCorte(p, accion) {
  await suena(p);
  const d0 = await estado(p);
  await accion();
  await p.waitForTimeout(350);
  const d1 = await estado(p);
  await p.waitForTimeout(600);
  const d2 = await estado(p);
  const bien = d0.sonando === 1 && d1.sonando === 1 && d2.sonando === 1 && d1.qid === d0.qid && d2.qid === d0.qid && d1.src === d0.src
    && d1.t >= d0.t - 0.05 && d2.t > d1.t + 0.2 && d1.isPlaying && d2.isPlaying;
  return { d0, d1, d2, bien, resumen: { pista: `${d0.actual} → ${d2.actual}`, t: [d0.t, d1.t, d2.t], elementos_sonando: [d0.sonando, d1.sonando, d2.sonando], mismo_src: d1.src === d0.src } };
}

// ── Casos comunes (canciones y videos) ──
async function casosComunes({ p, s, vista, kind, mezclar, itemDeVista }) {
  const N = vista.length;

  // Mix: toda la vista, aleatorio encendido, y la cola visible es la del motor.
  await mezclar(p);
  await abrirCola(p);
  await suena(p);
  const e0 = await estado(p);
  const pressed = await p.locator('.player-bar .shuffle-btn').getAttribute('aria-pressed');
  ok(`mix_cola_es_toda_la_vista_${s}`, e0.cola.length === N && same(e0.cola, vista) && e0.kinds.every((k) => k === kind) && e0.shuffle === true && pressed === 'true' && vista.includes(e0.actual),
    { vista, cola: e0.cola, actual: e0.actual, aleatorio: e0.shuffle, boton_aleatorio: pressed });
  const D0 = await colaDom(p);
  ok(`cola_visible_igual_al_motor_${s}`, eq(qidsDom(D0), e0.qids) && D0.find((r) => r.cur)?.qid === e0.qid,
    { visible: titulosDom(D0), motor: e0.cola, actual_visible: D0.find((r) => r.cur)?.t ?? null, actual_motor: e0.actual });

  // 1. «Siguiente» sigue la cola visible, fila por fila, y la cola no se reordena al avanzar.
  const p0 = D0.findIndex((r) => r.qid === e0.qid);
  const k = Math.max(0, Math.min(3, N - 1 - p0));
  const pasos = [];
  for (let i = 0; i < k; i++) {
    const a = await paso(p, 'next');
    const dom = await colaDom(p);
    pasos.push({ t: a.t, qid: a.qid, marcada: dom.find((r) => r.cur)?.qid ?? null });
  }
  const esperados = D0.slice(p0 + 1, p0 + 1 + k);
  const D1 = await colaDom(p);
  ok(`aleatorio_siguiente_sigue_la_cola_visible_${s}`, k >= 2 && pasos.every((x, i) => x.qid === esperados[i].qid && x.marcada === x.qid) && eq(qidsDom(D1), qidsDom(D0)),
    { cola_visible: titulosDom(D0), desde_fila: p0, esperado: titulosDom(esperados), sonaron: pasos.map((x) => x.t), marcada_sigue_a_la_que_suena: pasos.every((x) => x.marcada === x.qid), cola_sin_cambios: eq(qidsDom(D1), qidsDom(D0)) });

  // 1b. Siguiente → anterior → siguiente: la misma.
  const A = await actual(p); const B = await paso(p, 'next'); const A2 = await paso(p, 'prev'); const B2 = await paso(p, 'next');
  ok(`aleatorio_siguiente_anterior_siguiente_misma_${s}`, B.qid !== A.qid && A2.qid === A.qid && B2.qid === B.qid, { secuencia: [A.t, B.t, A2.t, B2.t], qids: [A.qid, B.qid, A2.qid, B2.qid] });

  // 6 y 2. Mix nuevo: hasta el final suenan las N, sin repetir, en el orden de la cola visible. Hacia
  // atrás hasta el inicio, lo mismo al revés; y otra vez hacia adelante, el MISMO orden.
  await mezclar(p);
  const D2 = await colaDom(p);
  const F = await recorrer(p, N - 1, 'next');
  ok(`mix_suenan_todas_sin_repetir_${s}`, F.length === N && new Set(qq(F)).size === N && same(tq(F), vista), { sonaron: tq(F), distintas: new Set(qq(F)).size, de: N });
  ok(`aleatorio_recorrido_igual_a_la_cola_visible_${s}`, eq(qq(F), qidsDom(D2)), { cola_visible: titulosDom(D2), sonaron: tq(F) });
  const Bk = await recorrer(p, N - 1, 'prev');
  ok(`aleatorio_retroceder_hasta_el_inicio_${s}`, eq(qq(Bk), [...qq(F)].reverse()), { hacia_adelante: tq(F), hacia_atras: tq(Bk) });
  const F2 = await recorrer(p, N - 1, 'next');
  ok(`aleatorio_avanzar_de_nuevo_mismo_orden_${s}`, eq(qq(F2), qq(F)), { primera_vez: tq(F), segunda_vez: tq(F2) });

  // 4. Apagar el aleatorio a mitad: vuelve el orden de la vista, lo agregado («Agregar a la cola»)
  // al final, sin corte; y «siguiente» sigue la vista desde la que suena.
  await mezclar(p);
  await paso(p, 'next'); await paso(p, 'next');
  const antesAdd = await estado(p);
  const xi = vista.findIndex((t) => t !== antesAdd.actual);
  const X = vista[xi];
  await menuAccion(p, itemDeVista(xi), 'queue', antesAdd.cola.length + 1);
  const conX = await estado(p);
  const xQid = conX.qids.find((q) => !antesAdd.qids.includes(q)) ?? null;
  const r = await sinCorte(p, () => p.locator('.player-bar .shuffle-btn').click());
  const D3 = await colaDom(p);
  const esperado = [...vista, X];
  const d = r.d2;
  ok(`apagar_aleatorio_vuelve_al_orden_de_la_vista_${s}`, d.shuffle === false && eq(d.cola, esperado) && xQid != null && d.qids[N] === xQid && d.idx === d.qids.indexOf(r.d0.qid) && eq(qidsDom(D3), d.qids),
    { esperado, cola: d.cola, cola_visible: titulosDom(D3), agregada: X, agregada_al_final: d.qids[N] === xQid, actual: d.actual, idx: d.idx });
  ok(`apagar_aleatorio_no_corta_${s}`, r.bien && d.shuffle === false, r.resumen);
  const pos = esperado.indexOf(r.d0.actual);
  const sig = await paso(p, 'next');
  const sigOk = pos >= 0 && (pos + 1 === N ? sig.qid === xQid : sig.t === esperado[pos + 1]);
  ok(`apagar_aleatorio_siguiente_sigue_la_vista_${s}`, sigOk, { sonaba: r.d0.actual, esperado: esperado[pos + 1] ?? null, sono: sig.t });
}

try {
  // ═════════════ Canciones (Biblioteca sintética) ═════════════
  {
    const { ctx, p, errores } = await abrir('/', '.library-tracks .track-row');
    const vista = await p.evaluate(() => [...document.querySelectorAll('.library-tracks tr.track-row[data-index]')]
      .sort((a, b) => a.dataset.index - b.dataset.index).map((tr) => tr.querySelector('.track-title')?.textContent.trim() ?? null));
    medidas.vista_canciones = vista;
    const N = vista.length;
    ok('vista_sintetica_cargada_canciones', N === LIB.length && same(vista, LIB.map((t) => t.title)), { vista });
    const fila = (i) => p.locator(`.library-tracks tr.track-row[data-index="${i}"]`);
    const mezclar = async (pg) => { const a = (await estado(pg)).qids.join(','); await pg.locator('.library-actions .mix-btn').click(); await esperarColaNueva(pg, a, N); };
    const tocarFila = async (i) => { const a = (await estado(p)).qids.join(','); await fila(i).locator('.track-title').click(); await esperarColaNueva(p, a, N); };

    await casosComunes({ p, s: 'canciones', vista, kind: 'audio', mezclar, itemDeVista: fila });

    // 3. Repetir todo: al final vuelve a empezar en el MISMO orden, sin rebarajar la cola.
    await ponerAleatorio(p, true);
    await mezclar(p);
    const rep = await ponerRepetir(p, 'all');
    const F = await recorrer(p, N - 1, 'next');
    const colaAntes = (await estado(p)).qids;
    const W = await recorrer(p, N, 'next');
    const colaDespues = (await estado(p)).qids;
    ok('repetir_todo_vuelve_a_empezar_en_el_mismo_orden_canciones', rep === 'all' && F.length === N && eq(qq(W.slice(1)), qq(F)),
      { repetir: rep, primera_vuelta: tq(F), segunda_vuelta: tq(W.slice(1)) });
    ok('repetir_todo_no_rebaraja_la_cola_canciones', rep === 'all' && eq(colaDespues, colaAntes) && W.length === N + 1, { repetir: rep, cola_igual: eq(colaDespues, colaAntes), pasos_dados: W.length - 1 });
    await ponerRepetir(p, 'off');

    // 5. Encender el aleatorio con algo sonando: baraja sólo lo que viene; lo anterior queda igual.
    await ponerAleatorio(p, false);
    await tocarFila(3);
    const e0 = await estado(p);
    const r5 = await sinCorte(p, () => p.locator('.player-bar .shuffle-btn').click());
    const e1 = r5.d2;
    ok('encender_aleatorio_lo_anterior_queda_intacto_canciones', e0.shuffle === false && e0.idx === 3 && eq(e0.cola, vista) && e1.shuffle === true && e1.idx === 3
      && eq(e1.qids.slice(0, 4), e0.qids.slice(0, 4)) && same(e1.qids.slice(4), e0.qids.slice(4)),
      { antes: e0.cola, despues: e1.cola, idx: [e0.idx, e1.idx], aleatorio: [e0.shuffle, e1.shuffle] });
    ok('encender_aleatorio_no_corta_canciones', r5.bien && e1.shuffle === true, r5.resumen);
    const intentos = [e1.cola.slice(4)];
    for (let i = 0; i < 3 && intentos.every((x) => eq(x, vista.slice(4))); i++) {
      await ponerAleatorio(p, false);
      await tocarFila(3);
      await suena(p);
      await ponerAleatorio(p, true);
      intentos.push((await estado(p)).cola.slice(4));
    }
    ok('encender_aleatorio_baraja_lo_que_viene_canciones', intentos.some((x) => !eq(x, vista.slice(4))) && intentos.every((x) => same(x, vista.slice(4))),
      { en_la_vista: vista.slice(4), intentos: intentos.map((x) => x.join(' | ')) });
    const e5 = await estado(p);
    const sig5 = await paso(p, 'next');
    ok('encender_aleatorio_siguiente_es_el_de_la_cola_canciones', e5.shuffle === true && sig5.qid === e5.qids[e5.idx + 1], { cola: e5.cola, idx: e5.idx, esperado: e5.cola[e5.idx + 1] ?? null, sono: sig5.t });

    // 7. Tocar una pista con el aleatorio encendido: va PRIMERA y el resto (barajado) trae TODAS las
    // demás de la lista, también las que en la vista estaban antes que ella.
    await ponerAleatorio(p, true);
    const toques = [];
    for (const i of [5, 2, 7, 4]) {
      await tocarFila(i);
      const e = await estado(p);
      const dom = await colaDom(p);
      toques.push({ tocada: vista[i], e, primeraVisible: dom[0]?.t ?? null });
    }
    ok('tocar_con_aleatorio_la_tocada_va_primero_canciones', toques.every((x) => x.e.cola[0] === x.tocada && x.e.idx === 0 && x.e.actual === x.tocada && x.primeraVisible === x.tocada && x.e.shuffle),
      { toques: toques.map((x) => ({ tocada: x.tocada, primera_en_cola: x.e.cola[0], primera_visible: x.primeraVisible, idx: x.e.idx, suena: x.e.actual })) });
    ok('tocar_con_aleatorio_estan_todas_canciones', toques.every((x) => x.e.cola.length === N && same(x.e.cola, vista)), { colas: toques.map((x) => x.e.cola.join(' | ')) });
    const resto = (x) => x.e.cola.filter((t) => t !== x.tocada);
    const restoVista = (x) => vista.filter((t) => t !== x.tocada);
    ok('tocar_con_aleatorio_el_resto_barajado_canciones', toques.some((x) => !eq(resto(x), restoVista(x))), { restos: toques.map((x) => resto(x).join(' | ')) });
    const ult = toques[toques.length - 1].e;
    const sig7 = await paso(p, 'next');
    ok('tocar_con_aleatorio_siguiente_es_la_segunda_canciones', sig7.qid === ult.qids[1], { cola: ult.cola, esperado: ult.cola[1], sono: sig7.t });

    // 8. «Reproducir a continuación» con aleatorio: queda justo después de la actual, suena después
    // y, tras ella, sigue lo que venía en la cola.
    await ponerAleatorio(p, true);
    await mezclar(p);
    await paso(p, 'next');
    const a8 = await estado(p);
    const ri = vista.findIndex((t) => t !== a8.actual && t !== a8.cola[a8.idx + 1]);
    const T8 = vista[ri];
    await menuAccion(p, fila(ri), 'next', N + 1);
    const e8 = await estado(p);
    const nuevo = e8.qids.find((q) => !a8.qids.includes(q)) ?? null;
    const dom8 = await colaDom(p);
    const fNueva = dom8.find((x) => x.qid === nuevo);
    const fActual = dom8.find((x) => x.cur);
    ok('a_continuacion_con_aleatorio_queda_justo_despues_canciones', nuevo != null && e8.qid === a8.qid && e8.qids[e8.idx + 1] === nuevo && e8.cola[e8.idx + 1] === T8 && !!fNueva?.pill && fActual && fNueva.i === fActual.i + 1,
      { marcada: T8, cola: e8.cola, idx: e8.idx, fila_visible_de_la_marcada: fNueva?.i ?? null, fila_visible_actual: fActual?.i ?? null, pill: !!fNueva?.pill });
    const s8 = await paso(p, 'next');
    ok('a_continuacion_con_aleatorio_suena_despues_canciones', s8.qid === nuevo, { marcada: T8, sono: s8.t });
    const s8b = await paso(p, 'next');
    ok('a_continuacion_despues_sigue_la_cola_canciones', s8b.qid === e8.qids[e8.idx + 2], { esperado: e8.cola[e8.idx + 2] ?? null, sono: s8b.t });

    // 9. Mover en la cola con aleatorio: lo movido junto a la actual es lo que suena después.
    await ponerAleatorio(p, true);
    await mezclar(p);
    const a9 = await estado(p);
    const movida = a9.qids[a9.idx + 4];
    const r9 = await sinCorte(p, () => p.evaluate(([q, to]) => { const v = window.__moPlayer(); const it = v.queue.find((x) => String(x._qid) === q); v.moveInQueue(it._qid, to); }, [movida, a9.idx + 1]));
    const e9 = r9.d2;
    const dom9 = await colaDom(p);
    ok('mover_con_aleatorio_queda_donde_se_solto_canciones', e9.qids[e9.idx + 1] === movida && e9.qid === a9.qid && eq(qidsDom(dom9), e9.qids),
      { movida: a9.cola[a9.idx + 4], antes: a9.cola, despues: e9.cola, cola_visible: titulosDom(dom9) });
    ok('mover_con_aleatorio_no_corta_canciones', r9.bien, r9.resumen);
    const s9 = await paso(p, 'next');
    ok('mover_con_aleatorio_cambia_lo_que_sigue_canciones', s9.qid === movida, { movida: a9.cola[a9.idx + 4], sono: s9.t });

    // 9b. Lo mismo con el ARRASTRE real del drawer (mouse, como queue-func): con aleatorio encendido,
    // soltar una fila justo debajo de la actual hace que sea la siguiente que suena.
    await abrirCola(p);
    const a9b = await estado(p);
    const filaDe = (i) => p.locator(`.queue-panel .queue-row[data-index="${i}"]`);
    const arrastrada = a9b.qids[a9b.idx + 4];
    const desde = filaDe(a9b.idx + 4);
    await desde.scrollIntoViewIfNeeded(); await frames(p);
    const bbA = await desde.boundingBox();
    const bbB = await filaDe(a9b.idx + 3).boundingBox();
    const alto = bbA && bbB ? bbA.y - bbB.y : 0;
    if (bbA && alto > 0) {
      await p.mouse.move(bbA.x + bbA.width / 2, bbA.y + bbA.height / 2);
      await p.mouse.down();
      for (let k = 1; k <= 12; k++) { await p.mouse.move(bbA.x + bbA.width / 2, bbA.y + bbA.height / 2 - (3 * alto) * k / 12); await p.waitForTimeout(16); }
      await p.mouse.up();
      await p.waitForTimeout(500);
    }
    const e9b = await estado(p);
    ok('arrastrar_con_aleatorio_queda_debajo_de_la_actual_canciones', e9b.shuffle && e9b.qid === a9b.qid && e9b.qids[e9b.idx + 1] === arrastrada,
      { arrastrada: a9b.cola[a9b.idx + 4], antes: a9b.cola, despues: e9b.cola, alto_fila: alto });
    const s9b = await paso(p, 'next');
    ok('arrastrar_con_aleatorio_es_lo_que_suena_despues_canciones', s9b.qid === arrastrada, { arrastrada: a9b.cola[a9b.idx + 4], sono: s9b.t });

    // 10. (1.44.0) Sin aleatorio: «Reproducir a continuación» del menú local sigue APILANDO, y jumpTo (tocar
    // una fila del drawer) con marcadas pendientes: las que quedan en la elegida o por encima pierden la
    // marca. Antes, «siguiente» volvía a ellas (y luego repetía lo de en medio), y saltar a una marcada la
    // hacía sonar dos veces.
    await ponerAleatorio(p, false);
    const marcadas = () => p.evaluate(() => { const v = window.__moPlayer(); return v.queue.filter((t) => v.upNext.has(t._qid)).map((t) => t.title); });
    const conDos = async () => {   // cola = LIB, suena LIB[0], y a continuación LIB[5] y después LIB[6] → [0, 6, 5, 1, 2, …]
      await p.evaluate((lib) => window.__moPlayer().play(lib, 0), LIB);
      await suena(p);
      await p.evaluate((lib) => { const v = window.__moPlayer(); v.playAfterCurrent(lib[5]); v.playAfterCurrent(lib[6]); }, LIB);
      await p.waitForTimeout(200);
      return estado(p);
    };
    const hasta = (t) => p.waitForFunction((x) => window.__moPlayer().currentTrack?.title === x, t, { timeout: 5000 }).then(() => true, () => false);
    const e10 = await conDos();
    const m10 = await marcadas();
    ok('a_continuacion_local_sigue_apilando_canciones', eq(e10.cola.slice(0, 4), [LIB[0].title, LIB[6].title, LIB[5].title, LIB[1].title]) && eq(m10, [LIB[6].title, LIB[5].title]),
      { cola: e10.cola.slice(0, 4), marcadas: m10, esperado: [LIB[0].title, LIB[6].title, LIB[5].title, LIB[1].title] });
    await p.evaluate(() => window.__moPlayer().jumpTo(3));
    const llego10 = await hasta(LIB[1].title);
    const m10b = await marcadas();
    ok('jumpto_por_encima_de_las_marcadas_les_quita_la_marca_canciones', llego10 && eq(m10b, []), { suena: (await actual(p)).t, marcadas: m10b });
    const s10 = await paso(p, 'next');
    ok('jumpto_despues_siguiente_va_por_posicion_canciones', s10.t === LIB[2].title, { sono: s10.t, esperado: LIB[2].title });
    await conDos();
    await p.evaluate(() => window.__moPlayer().jumpTo(2));   // la marcada LIB[5]; LIB[6] queda arriba
    const llego10c = await hasta(LIB[5].title);
    const m10c = await marcadas();
    const s10c = await paso(p, 'next');
    ok('jumpto_a_una_marcada_no_la_repite_canciones', llego10c && eq(m10c, []) && s10c.t === LIB[1].title, { marcadas: m10c, sono: s10c.t, esperado: LIB[1].title });

    ok('sin_errores_de_pagina_canciones', !errores.length, { errores });
    await ctx.close();
  }

  // ═════════════ Videos (lista sintética, bytes del fixture largo) ═════════════
  {
    const { ctx, p, errores } = await abrir('/videos', '.video-card');
    const vista = (await p.locator('.video-grid .video-card-title').allTextContents()).map((x) => x.trim());
    medidas.vista_videos = vista;
    medidas.video_fixture_bytes = VIDEO.length;
    const N = vista.length;
    ok('vista_sintetica_cargada_videos', N === VIDS.length && same(vista, VIDS.map((v) => v.title)), { vista });
    const mezclar = async (pg) => {
      const a = (await estado(pg)).qids.join(',');
      await pg.locator('.view-actions .mix-btn').click();
      await esperarColaNueva(pg, a, N);
      await pg.waitForFunction(() => window.__moPlayer()?.currentTrack?.kind === 'video', null, { timeout: 5000 }).catch(() => {});
    };
    await casosComunes({ p, s: 'videos', vista, kind: 'video', mezclar, itemDeVista: (i) => p.locator('.video-grid .video-card').nth(i) });
    ok('sin_errores_de_pagina_videos', !errores.length, { errores });
    await ctx.close();
  }
} catch (e) {
  ok('sin_excepciones', false, { error: String(e.message).split('\n')[0].slice(0, 200) });
} finally {
  await browser.close().catch(() => {});
}

const fails = Object.entries(R).filter(([, v]) => !v.ok);
console.log(JSON.stringify(R, null, 1));
console.log('medidas: ' + JSON.stringify(medidas));
if (fails.length) console.log('fallan: ' + fails.map(([k]) => k).join(', '));
console.log(`\n${NOMBRE}: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
process.exit(fails.length ? 1 : 0);
