// fav-bar-desktop-func.mjs — funcional del CORAZÓN EN LA BARRA DE ESCRITORIO (desde 701 px; antes sólo
// desde 1280). En 701, 1024, 1279 y 1280: el corazón se ve (30×30, dentro de su columna), ningún
// control se pisa con otro ni se sale de su columna, tocarlo alterna lleno/vacío, deja el servidor
// consistente y NO abre el reproductor expandido (con un control positivo: un clic en la zona vacía
// del título SÍ lo abre), el título queda con el ancho medido (1024: 121 px · 1279 y 1280: 185 px,
// ±4) y un título largo se recorta con "…" en una línea.
// Desborde horizontal (scrollWidth > clientWidth de la barra y de la página): se exige CERO en 1024,
// 1279 y 1280. En 701 NO se exige: main ya desborda ahí 17 px por el slider de volumen, con o sin
// corazón (medido en T42); lo que se exige es que no sea MAYOR que en main, y eso necesita SNAP_REF.
// La columna izquierda no se mide por scrollWidth: los tooltips ocultos (.bar-tip, en absoluto) lo
// inflan aunque nada se vea fuera; se mide por las cajas.
// Con SNAP_REF (el build de main servido en otro puerto) compara además contra main: el resto de
// los controles no cambia de tamaño ni de lugar salvo el "+", que se corre 42 px (corazón +
// separación) donde el corazón es nuevo, y el desborde de barra y página es el mismo.
// Sin SNAP_REF esas comprobaciones NO se cuentan y se avisa.
// ⚠️ ESCRIBE (crea/borra "Mis favoritos" de la cuenta de prueba): correr contra la COPIA de la base.
// Uso: SNAP_BASE=http://localhost:4173 [SNAP_REF=http://localhost:4174] node fav-bar-desktop-func.mjs
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
const apiJ = async (path, opts = {}) => {
  const r = await fetch(BASE + path, { ...opts, headers: H });
  return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
};
const FAV = 'Mis favoritos';
const favLists = async () => (await apiJ('/api/playlists')).body.filter((p) => p.name.trim() === FAV);
const favTrackIds = async () => { const l = await favLists(); return l.length ? (await apiJ(`/api/playlists/${l[0].id}/tracks`)).body.map((t) => t.id) : []; };
async function wipeFavs() { for (const p of await favLists()) await apiJ(`/api/playlists/${p.id}`, { method: 'DELETE' }); }

// Los dos casos salen de la base: el título más corto y el más largo (únicos, para hallar la fila).
const tracksAll = (await apiJ('/api/tracks?limit=10000')).body.filter((t) => (t.title ?? '').trim());
const unicos = tracksAll.filter((t) => tracksAll.filter((o) => o.title === t.title).length === 1);
const porLargo = [...unicos].sort((a, b) => a.title.length - b.title.length || a.id - b.id);
const CORTO = porLargo[0], LARGO = porLargo[porLargo.length - 1];

const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };
const WIDTHS = [701, 1024, 1279, 1280];
const TITULO_ESPERADO = { 1024: 121, 1279: 185, 1280: 185 };   // medido en T41; 701 no tiene referencia
const TOL = 4;
const CORAZON_NUEVO = (w) => w < 1280;   // en main el corazón ya estaba desde 1280

async function abrir(base, w, track) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
  await ctx.route('**/stream/**', (r) => {
    const h = r.request().headers().range; const total = WAV.length;
    if (!h) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV });
    const [, a, b] = h.match(/bytes=(\d*)-(\d*)/); const start = a ? +a : 0; const end = b ? +b : total - 1;
    r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: WAV.subarray(start, end + 1) });
  });
  await ctx.addInitScript((t) => localStorage.setItem('token', t), token);
  const p = await ctx.newPage();
  await p.goto(base + '/'); await p.waitForSelector('.library-tracks .track-row');
  await p.evaluate(() => document.fonts.ready);
  await p.locator('.search-box input').first().fill(track.title); await p.waitForTimeout(500);
  await p.locator('.library-tracks .track-row').filter({ has: p.getByText(track.title, { exact: true }) }).first().click();
  await p.waitForFunction((t) => document.querySelector('.player-bar .player-title')?.textContent.trim() === t, track.title, { timeout: 5000 });
  await p.waitForTimeout(600);
  return { ctx, p };
}

// Geometría de la barra: cada control visible con su caja, más el título y los desbordes.
const medir = (p) => p.evaluate(() => {
  const r1 = (n) => Math.round(n * 10) / 10;
  const bar = document.querySelector('.player-bar');
  const vis = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const caja = (el) => { const r = el.getBoundingClientRect(); return { x: r1(r.left), y: r1(r.top), w: r1(r.width), h: r1(r.height), r: r1(r.right), b: r1(r.bottom) }; };
  const grupo = (b) => ['player-track', 'player-controls', 'player-actions', 'player-mini-controls'].find((c) => b.closest('.' + c)) ?? '?';
  const controles = [...bar.querySelectorAll('button, input[type=range], .player-art, .player-art-placeholder')].filter(vis).map((el, i) => ({
    k: `${grupo(el)}/${(typeof el.className === 'string' && el.className ? el.className : el.type || el.tagName).split(' ').filter((c) => c !== 'active' && c !== 'fav-on').slice(0, 2).join('.')}`, ...caja(el), i,
  }));
  const title = bar.querySelector('.player-title'), artist = bar.querySelector('.player-artist'), meta = bar.querySelector('.player-meta');
  const track = bar.querySelector('.player-track'), ctrl = bar.querySelector('.player-controls'), act = bar.querySelector('.player-actions');
  const fav = bar.querySelector('.fav-player');
  return {
    innerW: window.innerWidth, pageScrollW: document.documentElement.scrollWidth,
    bar: { ...caja(bar), scrollW: bar.scrollWidth, clientW: bar.clientWidth },
    track: { ...caja(track), scrollW: track.scrollWidth, clientW: track.clientWidth }, controls: caja(ctrl), actions: caja(act), meta: caja(meta),
    titulo: { ...caja(title), clientW: title.clientWidth, scrollW: title.scrollWidth, lineH: parseFloat(getComputedStyle(title).lineHeight) || null, overflow: getComputedStyle(title).textOverflow, ws: getComputedStyle(title).whiteSpace },
    artista: caja(artist),
    corazon: fav ? { visible: vis(fav), ...caja(fav), pressed: fav.getAttribute('aria-pressed') } : null,
    controles,
  };
});
const sePisan = (a, b) => a.x < b.r - 0.5 && b.x < a.r - 0.5 && a.y < b.b - 0.5 && b.y < a.b - 0.5;
const expandidoAbierto = (p) => p.locator('.player-expanded').count().then((n) => n > 0);

await wipeFavs();
const medidas = {};
for (const w of WIDTHS) {
  // ── título corto: visibilidad, desbordes, solapes, toggle ──
  const { ctx, p } = await abrir(BASE, w, CORTO);
  const m = await medir(p);
  medidas[w] = { titulo_w: m.titulo.clientW, corazon: m.corazon && { x: m.corazon.x, w: m.corazon.w, h: m.corazon.h } };
  const c = m.corazon;
  ok(`corazon_visible_${w}`, !!c && c.visible && c.w === 30 && c.h === 30 && c.x >= m.track.x && c.r <= m.track.r + 0.5 && c.y >= m.bar.y && c.b <= m.bar.b, { corazon: c, track: { x: m.track.x, r: m.track.r } });

  const pisados = [];
  for (let i = 0; i < m.controles.length; i++) for (let j = i + 1; j < m.controles.length; j++) if (sePisan(m.controles[i], m.controles[j])) pisados.push([m.controles[i].k, m.controles[j].k]);
  // Columna izquierda por cajas: portada, texto, "+" y corazón dentro de la columna, en orden y sin pisarse.
  const izq = m.controles.filter((k) => k.k.startsWith('player-track/'));
  const columnaOk = izq.every((k) => k.x >= m.track.x - 0.5 && k.r <= m.track.r + 0.5) && m.meta.w > 0 && m.titulo.r <= m.meta.r + 0.5
    && izq.filter((k) => !k.k.includes('player-art')).every((k) => k.x >= m.meta.r - 0.5) && m.track.r <= m.controls.x + 0.5 && m.controls.r <= m.actions.x + 0.5;
  ok(`sin_solape_${w}`, columnaOk && pisados.length === 0, { bordes: { track_x: m.track.x, meta_r: m.meta.r, track_r: m.track.r, controls_x: m.controls.x, controls_r: m.controls.r, actions_x: m.actions.x }, izq: izq.map((k) => [k.k, k.x, k.r]), pisados });
  medidas[w].desborde = { barra: m.bar.scrollW - m.bar.clientW, pagina: m.pageScrollW - m.innerW };
  if (w !== 701) ok(`sin_desborde_${w}`, m.bar.scrollW <= m.bar.clientW && m.pageScrollW <= m.innerW, { bar: [m.bar.scrollW, m.bar.clientW], pagina: [m.pageScrollW, m.innerW] });

  // Toggle: lleno → servidor lo tiene; vacío → servidor no lo tiene; el expandido nunca se abre.
  const heart = p.locator('.player-bar .fav-player');
  const antes = { pressed: await heart.getAttribute('aria-pressed'), exp: await expandidoAbierto(p) };
  await heart.click(); await p.waitForTimeout(1200);
  const on = { pressed: await heart.getAttribute('aria-pressed'), clase: (await heart.getAttribute('class')).includes('fav-on'), servidor: (await favTrackIds()).includes(CORTO.id), exp: await expandidoAbierto(p) };
  await heart.click(); await p.waitForTimeout(1200);
  const off = { pressed: await heart.getAttribute('aria-pressed'), clase: (await heart.getAttribute('class')).includes('fav-on'), servidor: (await favTrackIds()).includes(CORTO.id), exp: await expandidoAbierto(p) };
  ok(`toggle_y_servidor_${w}`, antes.pressed === 'false' && on.pressed === 'true' && on.clase && on.servidor && off.pressed === 'false' && !off.clase && !off.servidor, { antes, on, off });
  ok(`no_abre_expandido_${w}`, !antes.exp && !on.exp && !off.exp);

  // Control positivo del selector: un clic en la zona vacía del texto SÍ abre el expandido.
  if (w === 1024) {
    const mm = await medir(p);
    await p.mouse.click(mm.titulo.r - 4, mm.titulo.y + mm.titulo.h / 2); await p.waitForTimeout(700);   // fila del título, a la derecha del texto corto
    ok('control_clic_en_barra_si_abre_expandido', await expandidoAbierto(p));
  }
  await ctx.close();

  // ── título largo: ancho medido y recorte limpio ──
  const L = await abrir(BASE, w, LARGO);
  const ml = await medir(L.p);
  const t = ml.titulo;
  if (TITULO_ESPERADO[w] != null) ok(`titulo_ancho_${w}`, Math.abs(t.clientW - TITULO_ESPERADO[w]) <= TOL, { medido: t.clientW, esperado: TITULO_ESPERADO[w], tolerancia: TOL });
  medidas[w].titulo_w_largo = t.clientW;
  ok(`titulo_largo_no_rompe_${w}`, t.scrollW > t.clientW && t.overflow === 'ellipsis' && t.ws === 'nowrap' && t.h === m.titulo.h && t.w > 0
    && t.r <= ml.meta.r + 0.5 && ml.bar.scrollW === m.bar.scrollW && ml.pageScrollW === m.pageScrollW
    && !!ml.corazon?.visible && ml.corazon.x === m.corazon?.x,
  { titulo: { clientW: t.clientW, scrollW: t.scrollW, h: t.h, h_corto: m.titulo.h }, corazon_x: [ml.corazon?.x, m.corazon?.x] });
  await L.ctx.close();

  // ── contra main: el resto de la barra no se movió ──
  if (REF) {
    const N = await abrir(BASE, w, CORTO); const nuevo = await medir(N.p); await N.ctx.close();
    const Rf = await abrir(REF, w, CORTO); const ref = await medir(Rf.p); await Rf.ctx.close();
    const esCorazon = (k) => k.k.includes('fav-player'), esMas = (k) => k.k.startsWith('player-track/ptp');
    const corr = CORAZON_NUEVO(w) ? 42 : 0;
    const a = nuevo.controles.filter((k) => !esCorazon(k)), b = ref.controles.filter((k) => !esCorazon(k));
    const difs = [];
    if (a.length !== b.length) difs.push({ cantidad: [a.length, b.length] });
    else a.forEach((k, i) => {
      const o = b[i]; const dx = esMas(k) ? corr : 0;
      if (k.k !== o.k || k.w !== o.w || k.h !== o.h || k.y !== o.y || Math.abs((o.x - dx) - k.x) > 0.5) difs.push({ nuevo: k, main: o, corrimiento_esperado: dx });
    });
    const corazonMain = ref.corazon?.visible ?? false;
    const desb = { nuevo: [nuevo.bar.scrollW - nuevo.bar.clientW, nuevo.pageScrollW - nuevo.innerW], main: [ref.bar.scrollW - ref.bar.clientW, ref.pageScrollW - ref.innerW] };
    ok(`resto_igual_a_main_${w}`, difs.length === 0 && corazonMain === !CORAZON_NUEVO(w) && nuevo.titulo.clientW === ref.titulo.clientW - corr,
      { controles_comparados: a.length, difs, corazon_en_main: corazonMain, titulo: { nuevo: nuevo.titulo.clientW, main: ref.titulo.clientW, corrimiento_esperado: corr } });
    ok(`desborde_no_mayor_que_main_${w}`, desb.nuevo[0] <= desb.main[0] && desb.nuevo[1] <= desb.main[1], { barra_y_pagina_px: desb });
  }
}
await wipeFavs();

const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
console.log('medidas: ' + JSON.stringify(medidas));
console.log(`casos: corto «${CORTO.title}» (id ${CORTO.id}) · largo «${LARGO.title}» (id ${LARGO.id})`);
console.log(REF ? `referencia (main): ${REF}` : 'SIN SNAP_REF: las comprobaciones contra main (resto_igual_a_main_*) NO se corrieron ni se cuentan.');
console.log(`\nfav-bar-desktop-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
