// search-years-func.mjs — funcional del BUSCADOR de Años (Years.jsx).
//
// Un solo campo con dos modos: sólo dígitos = por AÑO, desde el principio ("199" son los 90); con
// letras = por ÁLBUM o ARTISTA, y quedan los años que tienen alguna pista que coincide.
//
// Lo esperado NO está escrito a mano: sale del mismo GET /api/browse/years y de la biblioteca real
// (GET /api/tracks?limit=10000), con la misma regla que la vista (sin mayúsculas ni acentos, en
// álbum, artista del álbum y artista de la pista). Las búsquedas se eligen de esos datos.
//
// Comprueba, a 1440:
//   · sin buscar se ve todo y el campo está en la cabecera junto al título;
//   · un año exacto y un prefijo de década; texto de álbum; texto de artista; acentos y mayúsculas;
//   · el contador sigue lo que se ve («1 año» en singular);
//   · el Mix sigue lo que se ve: por año mezcla las pistas de los años visibles; por TEXTO mezcla SÓLO
//     las pistas que coinciden (no todo lo de esos años); con menos de 2 pistas queda deshabilitado;
//   · sin resultados; limpiar con la ✕ y con Esc; tocar «Años» estando en Años borra la búsqueda;
//   · entrar a un año con la búsqueda puesta y volver: el detalle no tiene buscador y al volver la
//     búsqueda sigue ahí.
// A 360, 390 y 430 con touch: el campo no se pisa con el engrane ni con la campana flotantes, no se
// sale de la pantalla, la página no desborda y escribir filtra. Los números van en `medidas`.
// FRESCURA (1.31.1): con Biblioteca ya visitada (biblioteca en memoria), la respuesta de
// /api/tracks?limit=10000 trae desde la 2ª vez un álbum cambiado (se intercepta: la base no se toca).
// Sin pasar por Biblioteca ni recargar, al escribir en Años el álbum nuevo aparece; no hay spinner y
// el campo no se remonta; escribir más letras no dispara más pedidos (a lo sumo uno por ventana de
// 30 s; el reloj de la página se adelanta, no se espera de verdad); y una revalidación que trae lo
// mismo no toca el DOM de la lista.
// Con SNAP_REF (el build de main en otro puerto): en main no hay buscador y, sin buscar, la rama pinta
// la misma lista. Sin SNAP_REF esas dos NO se corren ni se cuentan, y se avisa.
// Contra un build sin buscador las comprobaciones fallan una por una (no se corta con un timeout).
// Sólo lee: no escribe nada en la base.
// Uso: SNAP_BASE=http://localhost:4173 [SNAP_REF=http://localhost:4174] node search-years-func.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';

const REF = process.env.SNAP_REF ?? null;
await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

// ── Lo esperado, de los datos reales ──
const H = { Authorization: `Bearer ${token}` };
const YEARS = await (await fetch(BASE + '/api/browse/years', { headers: H })).json();
const LIB = (await (await fetch(BASE + '/api/tracks?limit=10000', { headers: H })).json()).filter((t) => t.year != null);
const fold = (s) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const hay = (t) => fold(`${t.album ?? ''}\n${t.album_artist ?? ''}\n${t.artist ?? ''}`);
const pistasDe = (q) => LIB.filter((t) => hay(t).includes(fold(q.trim())));
function esperado(q) {
  const f = fold(q.trim());
  if (!f) return YEARS.map((y) => y.year);
  if (/^\d+$/.test(f)) return YEARS.filter((y) => String(y.year).startsWith(f)).map((y) => y.year);
  const con = new Set(pistasDe(q).map((t) => t.year));
  return YEARS.filter((y) => con.has(y.year)).map((y) => y.year);
}
const contador = (n) => `${n} ${n === 1 ? 'año' : 'años'}`;
// Búsquedas elegidas de la biblioteca.
const conLetras = (s) => typeof s === 'string' && /[a-z]/i.test(s) && s.trim().length >= 5;
const cuenta = (xs) => { const m = new Map(); for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))); };
const ANIO = YEARS[Math.floor(YEARS.length / 2)].year;
const DECADA = cuenta(YEARS.map((y) => String(y.year).slice(0, 3))).find(([, n]) => n >= 2)?.[0] ?? String(ANIO).slice(0, 3);
const ARTISTA = cuenta(LIB.map((t) => t.album_artist).filter(conLetras))[0][0];
// Un álbum que comparta año con OTROS álbumes (así se ve que el Mix lleva sólo lo que coincide y no
// todo lo de ese año), y de esos el que deje menos años.
const deEsosAnios = (q) => LIB.filter((t) => esperado(q).includes(t.year)).length;
const ALBUM = cuenta(LIB.map((t) => t.album).filter(conLetras)).map(([a]) => a).filter((a) => pistasDe(a).length >= 2 && pistasDe(a).length < deEsosAnios(a))
  .sort((a, b) => esperado(a).length - esperado(b).length || pistasDe(b).length - pistasDe(a).length)[0];
const ACENTO = [...new Set(LIB.flatMap((t) => [t.album, t.album_artist, t.artist]))].find((s) => typeof s === 'string' && /[áéíóúñü]/i.test(s) && /^[\p{L} ]+$/u.test(s)) ?? null;
// Un texto que coincida con UNA sola pista (para el Mix deshabilitado).
const UNA = cuenta(LIB.map((t) => t.album).filter(conLetras)).map(([a]) => a).find((a) => pistasDe(a).length === 1) ?? null;

const R = {};
const ok = (k, v, extra = {}) => { R[k] = { ok: !!v, ...extra }; };
const medidas = { anios: YEARS.length, pistas_con_anio: LIB.length, busquedas: { anio: String(ANIO), decada: DECADA, album: ALBUM, artista: ARTISTA, con_acento: ACENTO, una_sola_pista: UNA } };
const INPUT = '.section-header .sbx input';
const MIX = '.view-actions .mix-btn';
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

function wav(sec = 60, sr = 8000) {
  const n = sec * sr, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const WAV = wav();
async function abrir(base, w, h, mobile) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript((t) => {
    localStorage.setItem('token', t);
    window.__player = () => {
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
  }, token);
  await ctx.route('**/stream/**', (r) => {
    const h2 = r.request().headers().range; const total = WAV.length;
    if (!h2) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV });
    const [, a, b] = h2.match(/bytes=(\d*)-(\d*)/); const start = a ? +a : 0; const end = b ? +b : total - 1;
    r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: WAV.subarray(start, end + 1) });
  });
  await ctx.route('**/api/plays', (r) => r.fulfill({ status: 201, contentType: 'application/json', body: '{"added":0,"already":0,"skipped":0}' }));
  const p = await ctx.newPage();
  const errores = []; p.on('pageerror', (e) => errores.push(String(e.message).slice(0, 140)));
  await p.goto(base + '/years');
  await p.waitForSelector('.browse-list .browse-item');
  return { ctx, p, errores };
}
const visto = (p) => p.evaluate(() => ({
  anios: [...document.querySelectorAll('.main-content .browse-list .browse-item-name')].map((e) => Number(e.textContent.trim())),
  contador: document.querySelector('.view-actions .section-count')?.textContent.trim() ?? null,
  mix: (() => { const b = document.querySelector('.view-actions .mix-btn'); return b ? { disabled: b.disabled, title: b.title } : null; })(),
  cartel: document.querySelector('.main-content .empty-state .empty-title')?.textContent ?? null,
}));
// Sin campo (el build de main) no se escribe nada y se devuelve lo que hay: así las comprobaciones
// fallan una por una en vez de cortarse el script.
const hayCampo = (p) => p.locator(INPUT).count().then((n) => n > 0);
const valor = (p) => p.locator(INPUT).inputValue({ timeout: 1000 }).catch(() => null);
async function buscar(p, q) {
  if (await hayCampo(p)) {
    await p.locator(INPUT).fill(q); await p.waitForTimeout(350);
    await p.waitForFunction(() => !document.querySelector('.main-content .spinner'), null, { timeout: 8000 }).catch(() => {});   // la biblioteca, la primera vez
    await p.waitForTimeout(150);
  }
  return visto(p);
}
const coincide = (v, q) => same(v.anios, esperado(q)) && v.contador === contador(esperado(q).length);
// Aprieta Mix y devuelve los ids de la cola (o null si no arrancó nada nuevo).
async function mezclar(p) {
  const antes = await p.evaluate(() => window.__player().queue.map((t) => t._qid).join(','));
  await p.locator(MIX).click({ timeout: 2000, force: true }).catch(() => {});
  await p.waitForFunction((a) => window.__player().queue.map((t) => t._qid).join(',') !== a, antes, { timeout: 4000 }).catch(() => {});
  const e = await p.evaluate(() => { const v = window.__player(); return { ids: v.queue.map((t) => t.id), qids: v.queue.map((t) => t._qid).join(','), shuffle: v.shuffle, actual: v.currentTrack?.id ?? null }; });
  return e.qids === antes ? null : e;
}

// ── Escritorio 1440 ──
{
  const { ctx, p, errores } = await abrir(BASE, 1440, 900, false);
  const v0 = await visto(p);
  const cab = await p.evaluate((sel) => { const i = document.querySelector(sel); return { hay: !!i, enCabecera: !!i?.closest('.section-header')?.querySelector('.section-title'), label: i?.getAttribute('aria-label'), placeholder: i?.placeholder }; }, INPUT);
  ok('sin_buscar_se_ve_todo', coincide(v0, '') && cab.hay && cab.enCabecera && cab.label === 'Buscar en años', { anios: v0.anios.length, contador: v0.contador, campo: cab });

  // Por año: exacto y prefijo de década.
  const va = await buscar(p, String(ANIO));
  ok('anio_exacto', coincide(va, String(ANIO)) && same(va.anios, [ANIO]) && va.contador === '1 año', { busqueda: String(ANIO), visto: va.anios, contador: va.contador });
  const mixAnio = await mezclar(p);
  const delAnio = LIB.filter((t) => t.year === ANIO).map((t) => t.id);
  ok('mix_por_anio_las_pistas_de_los_anios_visibles', !!mixAnio && same(mixAnio.ids, delAnio) && mixAnio.shuffle === true, { en_la_cola: mixAnio?.ids.length ?? null, pistas_del_anio: delAnio.length });
  const vd = await buscar(p, DECADA);
  ok('prefijo_de_decada', coincide(vd, DECADA) && vd.anios.length >= 2 && vd.anios.every((y) => String(y).startsWith(DECADA)), { busqueda: DECADA, visto: vd.anios });

  // Por texto: álbum y artista.
  const vAlb = await buscar(p, ALBUM);
  ok('texto_de_album', coincide(vAlb, ALBUM) && vAlb.anios.length >= 1 && vAlb.anios.length < YEARS.length, { busqueda: ALBUM, visto: vAlb.anios });
  const mixAlb = await mezclar(p);
  const idsAlb = pistasDe(ALBUM).map((t) => t.id);
  const todasDeEsosAnios = deEsosAnios(ALBUM);
  ok('mix_por_texto_solo_las_pistas_que_coinciden', !!mixAlb && same(mixAlb.ids, idsAlb) && idsAlb.length < todasDeEsosAnios && mixAlb.shuffle === true && idsAlb.includes(mixAlb.actual),
    { en_la_cola: mixAlb?.ids.length ?? null, pistas_que_coinciden: idsAlb.length, pistas_de_esos_anios: todasDeEsosAnios });
  medidas.mix_por_texto = { busqueda: ALBUM, pistas_que_coinciden: idsAlb.length, pistas_de_los_anios_visibles: todasDeEsosAnios };
  const vArt = await buscar(p, ARTISTA);
  ok('texto_de_artista', coincide(vArt, ARTISTA) && vArt.anios.length >= 1, { busqueda: ARTISTA, visto: vArt.anios });
  const mixArt = await mezclar(p);
  ok('mix_por_artista_solo_sus_pistas', !!mixArt && same(mixArt.ids, pistasDe(ARTISTA).map((t) => t.id)), { en_la_cola: mixArt?.ids.length ?? null, pistas_que_coinciden: pistasDe(ARTISTA).length });

  // Acentos y mayúsculas.
  const base1 = ACENTO ?? ARTISTA;
  const sinAcento = fold(base1), gritando = `  ${base1.toUpperCase()} `;
  const v1 = await buscar(p, sinAcento); const v2 = await buscar(p, gritando);
  ok('acentos_y_mayusculas_dan_lo_mismo', coincide(v1, base1) && coincide(v2, base1) && same(v1.anios, v2.anios) && v1.anios.length >= 1, { original: base1, tiene_acento: !!ACENTO, sin_acento: sinAcento, visto: v1.anios });

  // Mix deshabilitado con menos de 2 pistas.
  if (UNA) {
    const vu = await buscar(p, UNA);
    const cola0 = await p.evaluate(() => window.__player().queue.map((t) => t._qid).join(','));
    await p.locator(MIX).click({ timeout: 1500, force: true }).catch(() => {}); await p.waitForTimeout(400);
    const cola1 = await p.evaluate(() => window.__player().queue.map((t) => t._qid).join(','));
    ok('mix_deshabilitado_con_una_pista', coincide(vu, UNA) && vu.mix?.disabled === true && /No hay suficientes/.test(vu.mix.title) && cola0 === cola1, { busqueda: UNA, visto: vu.anios, mix: vu.mix });
  } else medidas.mix_deshabilitado = 'no hay en la biblioteca un álbum que coincida con una sola pista: no se comprobó';

  // Sin resultados.
  const vz = await buscar(p, 'zzzzqq');
  ok('sin_resultados', vz.anios.length === 0 && vz.cartel === 'Sin resultados para «zzzzqq»' && vz.contador === '0 años' && vz.mix?.disabled === true && (await valor(p)) === 'zzzzqq', { cartel: vz.cartel, contador: vz.contador });
  const vz2 = await buscar(p, '9999');
  ok('sin_resultados_por_anio', vz2.anios.length === 0 && vz2.cartel === 'Sin resultados para «9999»' && vz2.mix?.disabled === true, { cartel: vz2.cartel });

  // Limpiar con la ✕ y con Esc.
  await p.locator('.section-header .sbx-clear').click({ timeout: 1500 }).catch(() => {}); await p.waitForTimeout(350);
  const tx = await visto(p); const valX = await valor(p);
  await buscar(p, DECADA); if (await hayCampo(p)) await p.locator(INPUT).press('Escape'); await p.waitForTimeout(350);
  const te = await visto(p); const valE = await valor(p);
  ok('limpiar_devuelve_todo', valX === '' && coincide(tx, '') && valE === '' && coincide(te, ''), { con_x: tx.anios.length, con_esc: te.anios.length });

  // Tocar «Años» estando en Años borra la búsqueda.
  await buscar(p, ARTISTA);
  await p.locator('.sidebar').getByText('Años', { exact: true }).first().click(); await p.waitForTimeout(450);
  const tt = await visto(p);
  ok('retocar_la_pestana_borra_la_busqueda', (await valor(p)) === '' && coincide(tt, '') && new URL(p.url()).pathname === '/years', { visto: tt.anios.length });

  // Entrar a un año con la búsqueda puesta y volver.
  const vb = await buscar(p, ARTISTA);
  const elegido = esperado(ARTISTA)[0];
  await p.locator('.browse-list .browse-item', { hasText: String(elegido) }).first().click();
  await p.waitForSelector('.back-btn', { timeout: 4000 }).catch(() => {}); await p.waitForTimeout(500);
  const det = await p.evaluate(() => ({ ruta: location.pathname, titulo: document.querySelector('.main-content .section-title')?.textContent.trim(), buscadores: document.querySelectorAll('.main-content .sbx').length }));
  await p.locator('.back-btn').click({ timeout: 2000 }).catch(() => {}); await p.waitForTimeout(600);
  const vuelta = await visto(p);
  ok('entrar_a_un_anio_y_volver_conserva_la_busqueda', coincide(vb, ARTISTA) && det.ruta === `/years/${elegido}` && det.titulo === String(elegido) && det.buscadores === 0
    && new URL(p.url()).pathname === '/years' && (await valor(p)) === ARTISTA && coincide(vuelta, ARTISTA), { detalle: det, al_volver: { campo: await valor(p), anios: vuelta.anios.length } });
  ok('sin_errores_de_pagina', errores.length === 0, { errores });
  await ctx.close();
}

// ── Teléfono: 360, 390, 430 ──
for (const w of [360, 390, 430]) {
  const { ctx, p, errores } = await abrir(BASE, w, 844, true);
  const g = await p.evaluate(() => {
    const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return b.width && getComputedStyle(e).display !== 'none' ? { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) } : null; };
    const choca = (a, b) => !!a && !!b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    const caja = r('.main-content .section-header .sbx'), titulo = r('.main-content .section-title'), fab = r('.settings-fab'), campana = r('.changelog-bell');
    const abajo = Math.max(fab?.b ?? 0, campana?.b ?? 0);
    return { caja, titulo, engrane: fab, campana, chocaEngrane: choca(caja, fab), chocaCampana: choca(caja, campana), tituloChoca: choca(titulo, fab) || choca(titulo, campana),
      separacion_px: caja ? caja.t - abajo : null, desbordePagina: document.documentElement.scrollWidth - innerWidth, vw: innerWidth };
  });
  medidas[`telefono_${w}`] = g;
  ok(`movil_sin_solape_${w}`, !!g.caja && !g.chocaEngrane && !g.chocaCampana && g.caja.l >= 0 && g.caja.r <= g.vw && g.desbordePagina <= 0 && g.caja.h >= 36,
    { caja: g.caja && `${g.caja.w}×${g.caja.h} en y ${g.caja.t}–${g.caja.b}`, engrane: g.engrane && `x ${g.engrane.l}–${g.engrane.r}, y ${g.engrane.t}–${g.engrane.b}`, campana: g.campana ? `x ${g.campana.l}–${g.campana.r}, y ${g.campana.t}–${g.campana.b}` : 'no está', separacion_px: g.separacion_px, desbordePagina: g.desbordePagina });
  if (await hayCampo(p)) await p.locator(INPUT).tap();
  const vm = await buscar(p, ARTISTA);
  ok(`movil_escribir_filtra_${w}`, await hayCampo(p) && coincide(vm, ARTISTA) && !errores.length, { visto: vm.anios.length, contador: vm.contador });
  await ctx.close();
}

// ── Frescura: la biblioteca en memoria se revalida sola ──
{
  const X = LIB.find((t) => t.album && YEARS.some((y) => y.year === t.year));
  const NUEVO = 'Zzz Album Nuevo'; const Q = 'zzz album';
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => localStorage.setItem('token', t), token);
  let pedidos = 0;
  await ctx.route('**/api/tracks?limit=10000', async (r) => {
    const res = await r.fetch(); const data = await res.json();
    if (++pedidos >= 2) { const t = data.find((x) => x.id === X.id); if (t) t.album = NUEVO; await new Promise((f) => setTimeout(f, 300)); }
    r.fulfill({ response: res, body: JSON.stringify(data) });
  });
  const p = await ctx.newPage();
  await p.clock.install();
  await p.goto(BASE + '/'); await p.waitForSelector('.library-tracks .track-row'); await p.waitForTimeout(600);
  await p.evaluate(() => { window.__sinRecargar = true; });   // una recarga borraría esta marca
  await p.evaluate(() => [...document.querySelectorAll('.sidebar button')].find((b) => b.textContent.trim().startsWith('Años')).click());
  await p.waitForSelector('.main-content .browse-list .browse-item').catch(() => {});
  const campo = await hayCampo(p);
  if (campo) await p.locator(INPUT).evaluate((e) => { e.dataset.marca = '1'; });
  const antes = pedidos;
  await p.clock.fastForward(31000);
  // la primera letra pide la biblioteca (está en memoria: sale al instante) y dispara la revalidación;
  // desde ahí se registra cada frame: mientras llega lo nuevo no tiene que verse ningún spinner
  if (campo) { await p.locator(INPUT).press(Q[0]); await p.waitForTimeout(120); }
  await p.evaluate(() => {
    window.__fr = { spinner: 0, frames: 0 };
    const f = () => { window.__fr.frames++; if (document.querySelector('.main-content .spinner')) window.__fr.spinner++; requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
  if (campo) await p.locator(INPUT).pressSequentially(Q.slice(1), { delay: 40 });
  await p.waitForFunction((y) => [...document.querySelectorAll('.main-content .browse-list .browse-item-name')].some((e) => e.textContent.trim() === String(y)), X.year, { timeout: 4000 }).catch(() => {});
  await p.waitForTimeout(200);
  const v1 = await visto(p); const fr = await p.evaluate(() => window.__fr);
  const sinRecargar = await p.evaluate(() => window.__sinRecargar === true);
  const marca = campo ? await p.locator(INPUT).evaluate((e) => ({ marca: e.dataset.marca ?? null, foco: document.activeElement === e, valor: e.value })) : null;
  ok('frescura_album_nuevo_aparece', campo && same(v1.anios, [X.year]) && v1.contador === contador(1) && pedidos === antes + 1 && sinRecargar,
    { pista: X.id, anio: X.year, visto: v1.anios, contador: v1.contador, pedidos_de_biblioteca: [antes, pedidos], sin_recargar: sinRecargar });
  ok('frescura_sin_spinner_ni_remontar_el_campo', campo && fr.spinner === 0 && fr.frames > 5 && marca?.marca === '1' && marca.foco && marca.valor === Q, { frames: fr.frames, frames_con_spinner: fr.spinner, campo: marca });
  // más letras dentro de la misma ventana: ni un pedido más
  const p2 = pedidos;
  if (campo) { await p.locator(INPUT).fill(''); await p.locator(INPUT).pressSequentially(String(ARTISTA).slice(0, 8), { delay: 60 }); await p.waitForTimeout(600); }
  ok('frescura_sin_pedido_por_tecla', campo && pedidos === p2, { teclas: 8, pedidos_antes: p2, pedidos_despues: pedidos });
  // otra ventana, y lo que llega es idéntico: el pedido sale, la lista no se toca
  const vA = await buscar(p, ARTISTA);
  await p.clock.fastForward(31000);
  const p3 = pedidos;
  if (campo) { await p.locator(INPUT).press('End'); await p.locator(INPUT).press('Backspace'); await p.waitForTimeout(150); }
  await p.evaluate(() => {
    document.querySelectorAll('.main-content .browse-list .browse-item').forEach((e) => { e.dataset.marca = '1'; });
    window.__mut = 0; new MutationObserver((ms) => { window.__mut += ms.length; }).observe(document.querySelector('.main-content'), { subtree: true, childList: true, characterData: true, attributes: true });
  });
  for (let i = 0; i < 30 && pedidos === p3; i++) await p.waitForTimeout(100);
  await p.waitForTimeout(700);
  const quieto = await p.evaluate(() => ({ mutaciones: window.__mut, filas: document.querySelectorAll('.main-content .browse-list .browse-item').length, marcadas: document.querySelectorAll('.main-content .browse-list .browse-item[data-marca="1"]').length }));
  ok('frescura_datos_iguales_no_tocan_la_lista', campo && pedidos === p3 + 1 && quieto.mutaciones === 0 && quieto.filas > 0 && quieto.marcadas === quieto.filas, { pedidos: [p3, pedidos], ...quieto, anios_con_el_artista: vA.anios.length });
  await ctx.close();
}

// ── Contra main: no hay buscador, y sin buscar la lista es la misma ──
if (REF) {
  const { ctx, p } = await abrir(REF, 1440, 900, false);
  const vr = await visto(p); const n = await p.locator('.main-content .sbx').count();
  const { ctx: c2, p: p2 } = await abrir(BASE, 1440, 900, false);
  const vb = await visto(p2);
  ok('control_main_sin_buscador', n === 0, { buscadores_en_main: n });
  ok('sin_buscar_igual_a_main', same(vr.anios, vb.anios) && vr.contador === vb.contador && vr.anios.length === YEARS.length, { main: { anios: vr.anios.length, contador: vr.contador }, rama: { anios: vb.anios.length, contador: vb.contador } });
  await ctx.close(); await c2.close();
}

const fails = Object.entries(R).filter(([, v]) => !v.ok);
console.log(JSON.stringify(R, null, 1));
console.log('medidas: ' + JSON.stringify(medidas));
console.log(REF ? `referencia (main): ${REF}` : 'SIN SNAP_REF: las comprobaciones contra main (control_main_sin_buscador, sin_buscar_igual_a_main) NO se corrieron ni se cuentan.');
console.log(`\nsearch-years-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
