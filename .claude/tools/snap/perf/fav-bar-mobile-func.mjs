// fav-bar-mobile-func.mjs — funcional del CORAZÓN EN LA BARRA MINI (teléfono, hasta 700 px).
// Con una CANCIÓN sonando la mini lleva cinco botones de 40×40 (corazón · cola · letra · play ·
// siguiente; hasta la 1.28.0 eran cuatro de 48×48). Con un VIDEO no hay corazón ni letra y quedan
// los tres de 48×48 de siempre.
//
// En 360, 390, 430 y 700 (isMobile + hasTouch, con tap real):
//   · el corazón se ve, mide 40×40, es el primero del grupo y está dentro de la barra; los cinco
//     miden 40×40, van pegados y en orden; nada se pisa; ni la barra ni la página desbordan;
//   · el título queda con el ancho medido (360: 62 · 390: 92 · 430: 132 · 700: 402 px, ±4);
//   · tap en el corazón: lleno ↔ vacío, con el color de acento cuando está lleno, el servidor queda
//     consistente en los dos sentidos y el reproductor expandido NO se abre (control positivo: un
//     tap en la portada SÍ lo abre);
//   · los otros cuatro siguen haciendo lo suyo: play alterna, siguiente avanza, letra abre y cierra
//     el panel — ninguno de los tres abre el expandido — y cola abre la cola, que en el teléfono ES
//     el expandido con su hoja (así funciona desde la 1.9.0: no es una regresión);
//   · con un video: sin corazón, sin letra, tres botones de 48×48.
// En 701 y 899 (sin touch): la barra es la de escritorio y NO hay corazón a la vista (ni el de la
// mini ni el de escritorio, que va desde 900).
// Con SNAP_REF (el build de main servido en otro puerto) compara además contra main: con una
// canción el título pierde exactamente 8 px, la barra, la portada, el borde derecho de siguiente y
// todo lo de fuera de la barra (contenido y navegación de abajo) no cambian; con un video y en
// 701/899 la geometría es idéntica. Sin SNAP_REF esas comprobaciones NO se cuentan y se avisa.
// Necesita VIDEO_DIR con los fixtures (como lo arma regresion.mjs).
// ⚠️ ESCRIBE (crea/borra "Mis favoritos" de la cuenta de prueba): correr contra la COPIA de la base.
// Uso: SNAP_BASE=http://localhost:4173 [SNAP_REF=http://localhost:4174] node fav-bar-mobile-func.mjs
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
const favTitles = async () => { const l = await favLists(); return l.length ? (await apiJ(`/api/playlists/${l[0].id}/tracks`)).body.map((t) => t.title) : []; };
async function wipeFavs() { for (const p of await favLists()) await apiJ(`/api/playlists/${p.id}`, { method: 'DELETE' }); }

const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };
const MOVILES = [360, 390, 430, 700];
const ESCRITORIO = [701, 899];
const TITULO_ESPERADO = { 360: 62, 390: 92, 430: 132, 700: 402 };   // T41 (70/100/140/410) menos 8 px
const TOL = 4;
const ORDEN = ['fav-mini', 'queue-mini', 'lyrics-mini', 'play-mini', 'mini-next'];

async function abrir(base, w, mobile) {
  const ctx = await browser.newContext({ viewport: { width: w, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile });
  // El audio es un WAV sintético; el video es el real del backend (los fixtures).
  await ctx.route('**/stream/**', (r) => {
    if (r.request().url().includes('/stream/video')) return r.continue();
    const h = r.request().headers().range; const total = WAV.length;
    if (!h) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV });
    const [, a, b] = h.match(/bytes=(\d*)-(\d*)/); const start = a ? +a : 0; const end = b ? +b : total - 1;
    r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: WAV.subarray(start, end + 1) });
  });
  await ctx.addInitScript((t) => localStorage.setItem('token', t), token);
  const p = await ctx.newPage();
  const toca = (loc) => (mobile ? loc.tap() : loc.click());
  return { ctx, p, toca };
}
const titulo = (p) => p.locator('.player-bar .player-title').first().textContent().then((s) => s.trim());
// Canción: la primera fila de la Biblioteca SIN filtro, así la cola es la biblioteca entera y "siguiente" tiene a dónde ir.
async function conCancion(base, w, mobile) {
  const o = await abrir(base, w, mobile);
  await o.p.goto(base + '/'); await o.p.waitForSelector('.library-tracks .track-row');
  await o.p.evaluate(() => document.fonts.ready);
  await o.toca(o.p.locator('.library-tracks .track-row').first());
  await o.p.waitForFunction(() => { const t = document.querySelector('.player-bar .player-title')?.textContent.trim(); return t && t !== 'Sin reproducción'; }, null, { timeout: 5000 });
  await o.p.waitForTimeout(700);
  return o;
}
async function conVideo(base, w, mobile) {
  const o = await abrir(base, w, mobile);
  await o.p.goto(base + '/videos');
  const hay = await o.p.waitForSelector('.video-card', { timeout: 6000 }).then(() => true).catch(() => false);
  if (!hay) { await o.ctx.close(); return null; }
  await o.p.evaluate(() => document.fonts.ready);
  const nombre = (await o.p.locator('.video-card .album-name').first().textContent()).trim();
  await o.toca(o.p.locator('.video-card').first());
  await o.p.waitForFunction((t) => document.querySelector('.player-bar .player-title')?.textContent.trim() === t, nombre, { timeout: 8000 });
  await o.p.waitForTimeout(700);
  return o;
}

// Geometría: la barra, sus controles visibles, el título y lo de FUERA de la barra.
const medir = (p) => p.evaluate(() => {
  const r1 = (n) => Math.round(n * 10) / 10;
  const bar = document.querySelector('.player-bar');
  const vis = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const caja = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r1(r.left), y: r1(r.top), w: r1(r.width), h: r1(r.height), r: r1(r.right), b: r1(r.bottom) }; };
  const clase = (el) => (typeof el.className === 'string' && el.className ? el.className : el.type || el.tagName).split(' ').filter((c) => c !== 'active' && c !== 'fav-on' && c !== 'mini-btn').slice(0, 2).join('.');
  const controles = [...bar.querySelectorAll('button, input[type=range], .player-art, .player-art-placeholder, video')].filter(vis).map((el) => ({ k: clase(el), ...caja(el) }));
  const title = bar.querySelector('.player-title'), mini = bar.querySelector('.player-mini-controls');
  const favMini = bar.querySelector('.fav-mini'), favEsc = bar.querySelector('.fav-player');
  const cs = (el) => getComputedStyle(el);
  return {
    innerW: window.innerWidth, pageScrollW: document.documentElement.scrollWidth,
    bar: { ...caja(bar), scrollW: bar.scrollWidth, clientW: bar.clientWidth, padR: parseFloat(cs(bar).paddingRight) },
    titulo: { ...caja(title), clientW: title.clientWidth },
    mini: vis(mini) ? { ...caja(mini), botones: [...mini.children].filter(vis).map((b) => ({ k: clase(b), ...caja(b) })) } : null,
    corazonMini: favMini ? { visible: vis(favMini), ...caja(favMini), pressed: favMini.getAttribute('aria-pressed'), on: favMini.classList.contains('fav-on'), color: cs(favMini).color, primero: mini.firstElementChild === favMini, svg: caja(favMini.querySelector('svg')) } : null,
    corazonEscritorioVisible: vis(favEsc),
    letraMini: !!bar.querySelector('.lyrics-mini'),
    acento: cs(document.documentElement).getPropertyValue('--accent').trim(),
    colorLetraMini: bar.querySelector('.lyrics-mini') ? cs(bar.querySelector('.lyrics-mini')).color : null,
    controles,
    fuera: { contenido: caja(document.querySelector('.main-content')), nav: caja(document.querySelector('.bottom-nav')), navBotones: [...document.querySelectorAll('.bottom-nav-btn')].filter(vis).map(caja), lateral: caja(document.querySelector('.sidebar')) },
  };
});
const sePisan = (a, b) => a.x < b.r - 0.5 && b.x < a.r - 0.5 && a.y < b.b - 0.5 && b.y < a.b - 0.5;
const expandido = (p) => p.locator('.player-expanded').count().then((n) => n > 0);
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

await wipeFavs();
const medidas = {};
for (const w of MOVILES) {
  // ── canción ──
  const o = await conCancion(BASE, w, true); const { p } = o;
  const m = await medir(p);
  const c = m.corazonMini, bs = m.mini?.botones ?? [];
  medidas[w] = { titulo_w: m.titulo.clientW, bloque_w: m.mini?.w, botones: bs.map((b) => `${b.k} ${b.w}x${b.h}`), icono_corazon: c?.svg && `${c.svg.w}x${c.svg.h}` };
  ok(`corazon_visible_${w}`, !!c && c.visible && c.w === 40 && c.h === 40 && c.primero && c.x >= m.bar.x && c.r <= m.bar.r && c.y >= m.bar.y && c.b <= m.bar.b && c.r <= m.innerW && !m.corazonEscritorioVisible, { corazon: c, bar: { x: m.bar.x, r: m.bar.r, y: m.bar.y, b: m.bar.b } });
  const pegados = bs.every((b, i) => i === 0 || Math.abs(b.x - bs[i - 1].r) <= 0.5);
  ok(`cinco_de_40_${w}`, bs.length === 5 && igual(bs.map((b) => b.k), ORDEN) && bs.every((b) => b.w === 40 && b.h === 40) && pegados && m.mini.w === 200 && Math.abs(bs[4].r - (m.bar.r - m.bar.padR)) <= 0.5,
    { botones: bs.map((b) => [b.k, b.x, b.r, b.w, b.h]), bloque_w: m.mini?.w, borde_derecho: [bs[4]?.r, m.bar.r - m.bar.padR] });
  const pisados = [];
  for (let i = 0; i < m.controles.length; i++) for (let j = i + 1; j < m.controles.length; j++) if (sePisan(m.controles[i], m.controles[j])) pisados.push([m.controles[i].k, m.controles[j].k]);
  ok(`sin_solape_ni_desborde_${w}`, pisados.length === 0 && m.titulo.r <= (bs[0]?.x ?? 0) + 0.5 && m.titulo.clientW > 0 && m.bar.scrollW <= m.bar.clientW && m.pageScrollW <= m.innerW,
    { pisados, titulo_r: m.titulo.r, primer_boton_x: bs[0]?.x, bar: [m.bar.scrollW, m.bar.clientW], pagina: [m.pageScrollW, m.innerW] });
  ok(`titulo_ancho_${w}`, Math.abs(m.titulo.clientW - TITULO_ESPERADO[w]) <= TOL, { medido: m.titulo.clientW, esperado: TITULO_ESPERADO[w], tolerancia: TOL });

  // Sin corazón no hay nada que tocar: lo de arriba ya quedó en falla; se sigue con el ancho siguiente.
  if (!c?.visible) { await o.ctx.close(); continue; }

  // Tap en el corazón: lleno ↔ vacío, servidor consistente, sin abrir el expandido.
  const t0 = await titulo(p);
  const heart = p.locator('.player-bar .fav-mini');
  const antes = { pressed: c?.pressed, on: c?.on, color: c?.color, exp: await expandido(p), servidor: (await favTitles()).includes(t0) };
  await heart.tap(); await p.waitForTimeout(1200);
  const m1 = await medir(p);
  const on = { pressed: m1.corazonMini.pressed, on: m1.corazonMini.on, color: m1.corazonMini.color, servidor: (await favTitles()).includes(t0), exp: await expandido(p) };
  await heart.tap(); await p.waitForTimeout(1200);
  const m2 = await medir(p);
  const off = { pressed: m2.corazonMini.pressed, on: m2.corazonMini.on, color: m2.corazonMini.color, servidor: (await favTitles()).includes(t0), exp: await expandido(p) };
  ok(`tap_corazon_y_servidor_${w}`, antes.pressed === 'false' && !antes.servidor && on.pressed === 'true' && on.on && on.servidor && off.pressed === 'false' && !off.on && !off.servidor
    && on.color === m.colorLetraMini && on.color !== antes.color && off.color === antes.color, { antes, on, off, color_acento_letra: m.colorLetraMini, acento: m.acento });
  ok(`corazon_no_abre_expandido_${w}`, !antes.exp && !on.exp && !off.exp);

  // Los otros: play alterna, siguiente avanza, letra abre y cierra. Ninguno abre el expandido.
  const icono = () => p.locator('.player-bar .play-mini').innerHTML();
  const i0 = await icono();
  await p.locator('.player-bar .play-mini').tap(); await p.waitForTimeout(500);
  const i1 = await icono(); const expPlay1 = await expandido(p);
  await p.locator('.player-bar .play-mini').tap(); await p.waitForTimeout(500);
  const i2 = await icono(); const expPlay2 = await expandido(p);
  await p.locator('.player-bar .mini-next').tap(); await p.waitForTimeout(900);
  const t1 = await titulo(p); const expNext = await expandido(p);
  await p.locator('.player-bar .lyrics-mini').tap(); await p.waitForTimeout(600);
  const letraOn = { activo: await p.locator('.player-bar .lyrics-mini.active').count(), panel: await p.locator('.lyrics-panel').count(), exp: await expandido(p) };
  await p.locator('.player-bar .lyrics-mini').tap(); await p.waitForTimeout(600);
  const letraOff = { activo: await p.locator('.player-bar .lyrics-mini.active').count(), panel: await p.locator('.lyrics-panel').count(), exp: await expandido(p) };
  ok(`play_siguiente_letra_${w}`, i1 !== i0 && i2 === i0 && t1 !== t0 && letraOn.activo === 1 && letraOn.panel >= 1 && letraOff.activo === 0 && letraOff.panel === 0,
    { play: { cambia: i1 !== i0, vuelve: i2 === i0 }, siguiente: { de: t0, a: t1 }, letraOn, letraOff });
  ok(`play_siguiente_letra_no_abren_expandido_${w}`, !expPlay1 && !expPlay2 && !expNext && !letraOn.exp && !letraOff.exp);

  // Cola: en el teléfono ES el expandido con su hoja (openQueueMobile). Se comprueba eso.
  await p.locator('.player-bar .queue-mini').tap(); await p.waitForTimeout(900);
  const cola = { expandido_con_hoja: await p.locator('.player-expanded.exp-has-drawer').count(), hoja_abierta: await p.locator('.exp-drawer.open').count(), filas: await p.locator('.exp-drawer .queue-row, .exp-drawer [data-qid]').count() };
  ok(`cola_abre_la_cola_${w}`, cola.expandido_con_hoja === 1 && cola.hoja_abierta === 1 && cola.filas > 0, cola);
  await o.ctx.close();

  // Control positivo del "no abre el expandido": un tap en la portada SÍ lo abre.
  if (w === 390) {
    const k = await conCancion(BASE, w, true);
    await k.p.locator('.player-bar .player-art, .player-bar .player-art-placeholder').first().tap(); await k.p.waitForTimeout(800);
    ok('control_tap_en_portada_si_abre_expandido', await expandido(k.p));
    await k.ctx.close();
  }

  // ── video: sin corazón, sin letra, tres de 48 ──
  const v = await conVideo(BASE, w, true);
  let mv = null;
  if (!v) ok(`video_tres_de_48_${w}`, false, { motivo: 'no hay videos en /videos (¿VIDEO_DIR sin fixtures?)' });
  else {
    mv = await medir(v.p); await v.ctx.close();
    const vb = mv.mini?.botones ?? [];
    ok(`video_tres_de_48_${w}`, !mv.corazonMini && !mv.letraMini && vb.length === 3 && igual(vb.map((b) => b.k), ['queue-mini', 'play-mini', 'mini-next']) && vb.every((b) => b.w === 48 && b.h === 48) && mv.mini.w === 144,
      { corazon: mv.corazonMini, letra: mv.letraMini, botones: vb.map((b) => [b.k, b.w, b.h]), bloque_w: mv.mini?.w });
  }

  // ── contra main ──
  if (REF) {
    const N = await conCancion(BASE, w, true); const nuevo = await medir(N.p); await N.ctx.close();
    const Rf = await conCancion(REF, w, true); const ref = await medir(Rf.p); await Rf.ctx.close();
    const nb = nuevo.mini.botones, rb = ref.mini.botones;
    const arte = (x) => x.controles.find((k) => k.k.startsWith('player-art'));
    ok(`titulo_pierde_8_y_nada_mas_${w}`, nuevo.titulo.clientW === ref.titulo.clientW - 8 && nuevo.titulo.x === ref.titulo.x && nuevo.titulo.y === ref.titulo.y
      && igual({ ...nuevo.bar, scrollW: 0 }, { ...ref.bar, scrollW: 0 }) && nuevo.bar.scrollW <= ref.bar.scrollW && nuevo.pageScrollW <= ref.pageScrollW && igual(arte(nuevo), arte(ref))
      && rb.length === 4 && rb.every((b) => b.w === 48 && b.h === 48) && !ref.corazonMini && nb[4].r === rb[3].r && nb[3].r === nb[4].x,
    { titulo: [nuevo.titulo.clientW, ref.titulo.clientW], barra: [nuevo.bar, ref.bar], main_botones: rb.map((b) => [b.k, b.w, b.h]), borde_derecho_siguiente: [nb[4].r, rb[3].r] });
    ok(`fuera_de_la_barra_igual_a_main_${w}`, igual(nuevo.fuera, ref.fuera) && !!nuevo.fuera.contenido && !!nuevo.fuera.nav, { nuevo: nuevo.fuera, main: ref.fuera });
    if (mv) {
      const rv = await conVideo(REF, w, true);
      if (!rv) ok(`video_igual_a_main_${w}`, false, { motivo: 'main no mostró videos' });
      else { const mr = await medir(rv.p); await rv.ctx.close();
        ok(`video_igual_a_main_${w}`, igual(mv.controles, mr.controles) && igual(mv.titulo, mr.titulo) && igual(mv.bar, mr.bar) && igual(mv.fuera, mr.fuera), { nuevo: { controles: mv.controles, titulo: mv.titulo }, main: { controles: mr.controles, titulo: mr.titulo } }); }
    }
  }
}

// ── 701 y 899: barra de escritorio, sin corazón a la vista ──
for (const w of ESCRITORIO) {
  const o = await conCancion(BASE, w, false); const m = await medir(o.p); await o.ctx.close();
  ok(`sin_corazon_${w}`, m.mini === null && !(m.corazonMini?.visible) && !m.corazonEscritorioVisible && !m.controles.some((k) => k.k.includes('fav')), { mini: m.mini, corazonMini: m.corazonMini?.visible ?? null, corazonEscritorio: m.corazonEscritorioVisible });
  if (REF) {
    const Rf = await conCancion(REF, w, false); const ref = await medir(Rf.p); await Rf.ctx.close();
    ok(`barra_igual_a_main_${w}`, igual(m.controles, ref.controles) && igual(m.titulo, ref.titulo) && igual(m.bar, ref.bar), { nuevo: m.controles.length, main: ref.controles.length, titulo: [m.titulo.clientW, ref.titulo.clientW] });
  }
}
await wipeFavs();

const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
console.log('medidas: ' + JSON.stringify(medidas));
console.log(REF ? `referencia (main): ${REF}` : 'SIN SNAP_REF: las comprobaciones contra main (titulo_pierde_8_*, fuera_de_la_barra_*, video_igual_a_main_*, barra_igual_a_main_*) NO se corrieron ni se cuentan.');
console.log(`\nfav-bar-mobile-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
