// buscar-func.mjs — funcional del botón «Buscar» y de la vista /search (búsqueda en toda la música).
// Mismo estilo que login-sso-func / search-views-func: matriz de escenarios con id, lo esperado se
// calcula ACÁ desde /api/* con un plegado propio (no importa nada de la app) y cada escenario es una
// clave booleana (o {ok,...detalle}) del JSON final.
//
// Contrato que mide (lo escribió el pedido, no el código):
//   · desktop: «Buscar» en el grupo MENU del Sidebar, DESPUÉS de Videos; ruta /search.
//   · teléfono: botón flotante .search-fab (como el de Ajustes); el BottomNav NO cambia (7 ítems).
//   · cinco grupos con conteo (Canciones, Álbumes, Artistas, Playlists, Videos), límite por grupo,
//     «Ver todo» con tope, orden por relevancia (empieza con > empieza una palabra > contiene).
//   · estados: vacío (sin consulta), cargando una fuente, fuente caída con Reintentar, sin resultados.
//   · la consulta vive SOLO en memoria: sin ?q=, F5 abre vacía; abrir un resultado y volver atrás la
//     restaura; tocar la pestaña activa la limpia y enfoca la caja; entrar desde otra vista, vacía.
//   · la música no se corta (Player hermano de <main>, sin recargas); Esc y M/F/Espacio/flechas no
//     actúan mientras se escribe; reproducir, menú contextual y arrastre a la cola como en las demás.
// Límites del grupo y tope de «Ver todo» son parte del contrato (constantes de abajo).
// Escribe playlists de prueba (las borra al final): correr contra la COPIA de la base (regresion.mjs).
// Capturas en shots/buscar (ignorado por git).
// Uso: SNAP_BASE=http://localhost:4173 node buscar-func.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'shots', process.env.OUT ?? 'buscar');
mkdirSync(OUT, { recursive: true });

await preflight();
const token = await getToken();
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

// ── Contrato numérico ──
const LIMITS = { songs: 8, albums: 8, artists: 6, playlists: 6, videos: 6 };
const EXPANDED_MAX = 100;
const TITLES = { songs: 'Canciones', albums: 'Álbumes', artists: 'Artistas', playlists: 'Playlists', videos: 'Videos' };
const ORDER = ['songs', 'albums', 'artists', 'playlists', 'videos'];

const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };
const soft = async (fn) => { try { return await fn(); } catch { return undefined; } };
async function chk(key, fn) {
  try { const r = await fn(); const [v, extra] = Array.isArray(r) ? r : [r]; ok(key, !!v, extra); }
  catch (e) { ok(key, false, { error: String(e?.message ?? e).split('\n')[0].slice(0, 160) }); }
}

function wav(sec = 900, sr = 8000) {
  const n = sec * sr, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const WAV = wav();

// ── Datos reales y lo esperado, calculado acá ──
const get = (path) => fetch(BASE + path, { headers: H }).then((r) => r.json());
const fold = (s) => (s ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const COLLATOR = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
const TRACKS = await get('/api/tracks?limit=100000');
const ALBUMS = await get('/api/albums');
const ARTISTS = await get('/api/browse/artists');
const VIDEOS = ((await get('/api/videos')).videos ?? [])
  .sort((a, b) => COLLATOR.compare(a.artist ?? '', b.artist ?? '') || COLLATOR.compare(a.title ?? '', b.title ?? ''));

// Consulta con canciones, varios álbumes y un artista: el artista con ≥2 álbumes que menos tiene.
const byArtist = new Map();
for (const a of ALBUMS) if (a.album_artist) byArtist.set(a.album_artist, (byArtist.get(a.album_artist) ?? 0) + 1);
const ARTIST = [...byArtist.entries()].filter(([, n]) => n >= 2).sort((x, y) => x[1] - y[1])[0]?.[0] ?? ALBUMS.find((a) => a.album_artist)?.album_artist;
const Q = fold(ARTIST).slice(0, Math.max(4, Math.min(8, ARTIST.length)));
const QV = VIDEOS.length ? fold(VIDEOS[0].artist).slice(0, 5) : null;
const NADA = 'zzqxjw';
const ACC = { a: 'Á', e: 'É', i: 'Í', o: 'Ó', u: 'Ú' };
let accented = false;
const Q_RARA = [...Q].map((ch) => { if (!accented && ACC[ch]) { accented = true; return ACC[ch]; } return ch.toUpperCase(); }).join('');

// Playlists de prueba: una cuyo nombre coincide con Q (para el grupo Playlists) con 3 pistas.
const mk = (name) => fetch(`${BASE}/api/playlists`, { method: 'POST', headers: H, body: JSON.stringify({ name, emoji: '🔎' }) }).then((r) => r.json());
const PL = await mk(`Mezcla ${Q} prueba ${Date.now() % 100000}`);
for (const t of TRACKS.slice(0, 3)) await fetch(`${BASE}/api/playlists/${PL.id}/tracks`, { method: 'POST', headers: H, body: JSON.stringify({ track_id: t.id }) });
const PLAYLISTS = await get('/api/playlists');

const SPEC = {
  songs:     { list: TRACKS,    hay: (t) => `${t.title ?? ''}\n${t.artist ?? ''}\n${t.album ?? ''}`, prim: (t) => [t.title] },
  albums:    { list: ALBUMS,    hay: (a) => `${a.album ?? ''}\n${a.album_artist ?? ''}`,             prim: (a) => [a.album] },
  artists:   { list: ARTISTS,   hay: (a) => `${a.artist ?? ''}`,                                      prim: (a) => [a.artist] },
  playlists: { list: PLAYLISTS, hay: (p) => `${p.name ?? ''}`,                                        prim: (p) => [p.name] },
  videos:    { list: VIDEOS,    hay: (v) => `${v.artist ?? ''}\n${v.title ?? ''}`,                   prim: (v) => [v.artist, v.title] },
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tier = (prim, q) => {
  const fs = prim.map(fold);
  if (fs.some((s) => s.startsWith(q))) return 0;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${esc(q)}`, 'u');
  return fs.some((s) => re.test(s)) ? 1 : 2;
};
// Lo que tiene que mostrar el grupo: todo lo que coincide, ordenado (estable) por relevancia.
function expected(q) {
  const f = fold(q.trim());
  const out = {};
  for (const [g, s] of Object.entries(SPEC)) {
    if (!f) { out[g] = []; continue; }
    const hits = s.list.filter((it) => fold(s.hay(it)).includes(f)).map((it, i) => ({ it, i, t: tier(s.prim(it), f) }));
    hits.sort((a, b) => a.t - b.t || a.i - b.i);
    out[g] = hits;
  }
  return out;
}
const label = {
  songs: (t) => t.title, albums: (a) => a.album, artists: (a) => a.artist, playlists: (p) => p.name, videos: (v) => v.title,
};
const wantNames = (e, g, n) => e[g].slice(0, n).map((h) => label[g](h.it));

// ── Navegador ──
async function open(opts) {
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript((t) => {
    localStorage.setItem('token', t);
    // El <audio> no está en el DOM (new Audio()): se captura al crearlo, como func.mjs.
    const A = window.Audio;
    window.Audio = function (...a) { const x = new A(...a); window.__audio = x; return x; };
    window.__player = () => {
      const root = document.getElementById('root');
      const key = Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
      const stack = [root[key]];
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
  await ctx.route((u) => u.pathname.startsWith('/stream/') && !u.pathname.startsWith('/stream/video/'), (r) => {
    const h = r.request().headers().range; const total = WAV.length;
    if (!h) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV });
    const [, a, b] = h.match(/bytes=(\d*)-(\d*)/); const start = a ? +a : 0; const end = b ? +b : total - 1;
    r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: WAV.subarray(start, end + 1) });
  });
  await ctx.route('**/api/plays', (r) => r.fulfill({ status: 201, contentType: 'application/json', body: '{}' }));
  const p = await ctx.newPage();
  p.setDefaultTimeout(8000);
  return { ctx, p };
}
const INPUT = '.search-view .sbx input';
const G = (g) => `.search-group[data-group="${g}"]`;
const ITEM = { songs: 'tr.track-row', albums: '.album-card', artists: '.artist-portrait', playlists: '.playlist-item', videos: '.video-card' };
const fresh = (p, path = '/search') => soft(async () => { await p.goto(BASE + path); await p.waitForSelector('.sidebar, .bottom-nav'); await p.waitForTimeout(250); });
const typeQ = (p, q) => soft(async () => { await p.locator(INPUT).click(); await p.keyboard.press('Control+A'); await p.keyboard.type(q, { delay: 12 }); await p.waitForTimeout(450); });
const settled = (p) => soft(() => p.waitForFunction(() => !document.querySelector('.search-status'), null, { timeout: 15000 }));
const groups = (p) => p.evaluate(({ ITEM, NAMES }) => Object.fromEntries([...document.querySelectorAll('.search-group')].map((g) => {
  const k = g.dataset.group;
  const more = g.querySelector('.search-group-more');
  return [k, {
    title: g.querySelector('.search-group-title')?.textContent ?? null,
    count: Number(g.querySelector('.search-group-count')?.textContent),
    items: g.querySelectorAll(ITEM[k]).length,
    more: more?.textContent.trim() ?? null,
    expanded: more?.getAttribute('aria-expanded') ?? null,
    note: g.querySelector('.search-group-note')?.textContent ?? null,
    names: [...g.querySelectorAll(NAMES[k])].map((e) => e.textContent),
  }];
})), { ITEM, NAMES: { songs: '.track-title', albums: '.album-name', artists: '.artist-portrait-name', playlists: '.playlist-name', videos: '.video-card-title' } });
const view = (p) => p.evaluate(() => ({
  url: location.pathname + location.search,
  value: document.querySelector('.search-view .sbx input')?.value ?? null,
  focused: document.activeElement === document.querySelector('.search-view .sbx input'),
  hint: !!document.querySelector('.search-hint'),
  none: document.querySelector('.search-none .empty-title')?.textContent ?? null,
  status: document.querySelector('.search-status')?.textContent.trim() ?? null,
  statusErr: !!document.querySelector('.search-status--error'),
  groups: document.querySelectorAll('.search-group').length,
}));
const player = (p) => p.evaluate(() => { const v = window.__player(); return { id: v.currentTrack?.id ?? null, kind: v.currentTrack?.kind ?? null, title: v.currentTrack?.title ?? null, playing: v.isPlaying, shuffle: v.shuffle, queue: v.queue.map((t) => t.title), kinds: v.queue.map((t) => t.kind ?? 'track'), n: v.queue.length }; });
const media = (p) => p.evaluate(() => { const a = window.__audio; return a && !a.paused && a.currentTime > 0 ? { t: a.currentTime, src: a.currentSrc.split('?')[0] } : null; });
const sideBtn = (p, name) => p.locator('.sidebar .sidebar-nav button', { hasText: new RegExp(`^\\s*${name}\\s*$`) });
const sameGroups = (a, b) => ORDER.every((g) => (a[g] ? a[g].count === b[g]?.count && a[g].items === b[g]?.items && a[g].names.join('|') === b[g]?.names.join('|') : !b[g]));
const overflow = (p) => p.evaluate(() => {
  const m = document.querySelector('.main-content');
  return { doc: document.documentElement.scrollWidth - window.innerWidth, main: m.scrollWidth - m.clientWidth };
});
const sinDesborde = (o) => o.doc <= 0 && o.main <= 0;

// ═══════════════ ESCRITORIO (1440) ═══════════════
{
  const { ctx, p } = await open({ viewport: { width: 1440, height: 900 } });
  await fresh(p, '/');

  await chk('D01_menu_buscar_despues_de_videos', async () => {
    const t = await p.evaluate(() => [...document.querySelectorAll('.sidebar > nav')[0].querySelectorAll('button')].map((b) => ({ txt: b.textContent.trim(), svg: !!b.querySelector('svg') })));
    return [JSON.stringify(t.map((x) => x.txt)) === JSON.stringify(['Biblioteca', 'Álbumes', 'Playlists', 'Videos', 'Buscar']) && t.at(-1).svg, { menu: t.map((x) => x.txt) }];
  });

  await chk('D02_navega_a_search_y_queda_activo', async () => {
    await sideBtn(p, 'Buscar').click(); await p.waitForSelector('.search-view'); await p.waitForTimeout(250);
    const a = await p.evaluate(() => [...document.querySelectorAll('.sidebar button.active')].map((b) => b.textContent.trim()));
    return [p.url().endsWith('/search') && JSON.stringify(a) === '["Buscar"]', { url: p.url(), activos: a }];
  });

  await chk('D03_vista_vacia_inicial', async () => {
    const v = await view(p);
    const hintTxt = await p.locator('.search-hint').innerText();
    return [v.hint && v.groups === 0 && v.value === '' && v.focused && /toda tu música/i.test(hintTxt) && !v.status, { hint: hintTxt.replace(/\n/g, ' / '), ...v }];
  });
  await p.screenshot({ path: join(OUT, 'buscar-1440-vacia.png') });

  await chk('D04_grupos_con_conteo', async () => {
    await typeQ(p, Q); await settled(p);
    const e = expected(Q), g = await groups(p), mal = [];
    for (const k of ORDER) {
      const n = e[k].length;
      if (n === 0) { if (g[k]) mal.push(`${k}: no debía estar`); continue; }
      if (!g[k]) { mal.push(`${k}: falta`); continue; }
      if (g[k].count !== n) mal.push(`${k}: conteo ${g[k].count}≠${n}`);
      if (g[k].title !== TITLES[k]) mal.push(`${k}: título ${g[k].title}`);
    }
    const orden = Object.keys(g);
    const enOrden = orden.join() === ORDER.filter((k) => g[k]).join();
    return [mal.length === 0 && enOrden && e.songs.length > 0 && e.albums.length > 0 && e.artists.length > 0 && e.playlists.length > 0,
      { q: Q, esperado: Object.fromEntries(ORDER.map((k) => [k, e[k].length])), mal, orden }];
  });
  await p.screenshot({ path: join(OUT, 'buscar-1440-resultados.png') });

  await chk('D05_orden_por_relevancia_y_limite', async () => {
    const e = expected(Q), g = await groups(p), mal = [];
    for (const k of ORDER.filter((x) => e[x].length)) {
      const n = Math.min(e[k].length, LIMITS[k]);
      if (g[k].items !== n) mal.push(`${k}: filas ${g[k].items}≠${n}`);
      if (g[k].names.join('|') !== wantNames(e, k, n).join('|')) mal.push(`${k}: orden/contenido`);
      const tiers = e[k].slice(0, n).map((h) => h.t);
      if (tiers.some((t, i) => i && t < tiers[i - 1])) mal.push(`${k}: tiers no decrecen`);
      const hayMas = e[k].length > LIMITS[k];
      if (hayMas !== (g[k].more !== null)) mal.push(`${k}: «ver todo» ${g[k].more} con ${e[k].length}`);
    }
    return [mal.length === 0, { mal, limites: LIMITS }];
  });

  await chk('D06_ver_todo_expande_con_tope_y_vuelve', async () => {
    const e = expected(Q);
    const k = ORDER.filter((x) => e[x].length > LIMITS[x]).sort((a, b) => e[b].length - e[a].length)[0];
    if (!k) return [false, { motivo: 'ningún grupo supera su límite con Q' }];
    await p.locator(`${G(k)} .search-group-more`).click(); await p.waitForTimeout(350);
    const abierto = (await groups(p))[k];
    const tope = Math.min(e[k].length, EXPANDED_MAX);
    await p.locator(`${G(k)} .search-group-more`).click(); await p.waitForTimeout(350);
    const cerrado = (await groups(p))[k];
    return [abierto.items === tope && abierto.expanded === 'true' && cerrado.items === LIMITS[k] && cerrado.expanded === 'false'
      && (e[k].length > EXPANDED_MAX ? !!abierto.note : true), { grupo: k, total: e[k].length, abierto: abierto.items, cerrado: cerrado.items, nota: abierto.note }];
  });

  await chk('D07_acentos_y_mayusculas', async () => {
    await typeQ(p, Q); const a = await groups(p);
    await typeQ(p, Q_RARA); const b = await groups(p);
    return [accented && sameGroups(a, b) && Object.keys(a).length > 0, { q: Q_RARA }];
  });

  await chk('D08_espacios_de_los_extremos_no_cuentan', async () => {
    await typeQ(p, Q); const a = await groups(p);
    await typeQ(p, `  ${Q}  `); const b = await groups(p);
    await typeQ(p, '   '); const v = await view(p);
    return [sameGroups(a, b) && v.hint && v.groups === 0, { soloEspacios: v.hint }];
  });

  await chk('D09_sin_resultados', async () => {
    await typeQ(p, NADA); const v = await view(p);
    const cab = await p.locator('.search-view .section-title').isVisible();
    return [v.none === `Sin resultados para «${NADA}»` && v.groups === 0 && !v.hint && cab && v.value === NADA, v];
  });
  await p.screenshot({ path: join(OUT, 'buscar-1440-sin-resultados.png') });

  await chk('D10_limpiar_con_x_vuelve_a_vacio_y_enfoca', async () => {
    await typeQ(p, Q);
    await p.locator('.search-view .sbx-clear').click(); await p.waitForTimeout(300);
    const v = await view(p);
    return [v.hint && v.groups === 0 && v.value === '' && v.focused && (await p.locator('.search-view .sbx-clear').count()) === 0, v];
  });

  await chk('D11_sin_q_en_la_url', async () => {
    await typeQ(p, Q);
    const u = await p.evaluate(() => ({ path: location.pathname, search: location.search, hash: location.hash, st: JSON.stringify(history.state) }));
    return [u.path === '/search' && u.search === '' && u.hash === '' && !u.st.includes(Q), u];
  });

  await ctx.close();
}

// ── Reproducir, menú, arrastre (sesión propia, con música) ──
{
  const { ctx, p } = await open({ viewport: { width: 1440, height: 900 } });
  await fresh(p);
  await typeQ(p, Q); await settled(p);

  await chk('D12_reproducir_cancion_cola_es_lo_visible', async () => {
    const g = (await groups(p)).songs;
    await p.locator(`${G('songs')} tr.track-row`).nth(2).click(); await p.waitForTimeout(800);
    const pl = await player(p);
    return [pl.playing && pl.title === g.names[2] && pl.queue.join('|') === g.names.join('|') && pl.n === g.items, { actual: pl.title, esperado: g.names[2], cola: pl.n, visibles: g.items }];
  });

  await chk('D13_reproducir_video', async () => {
    if (!QV) return [true, { omitido: 'sin videos en el servidor' }];
    await typeQ(p, QV); await settled(p);
    const g = (await groups(p)).videos;
    await p.locator(`${G('videos')} .video-card`).first().click(); await p.waitForTimeout(900);
    const pl = await player(p);
    return [!!g && pl.kind === 'video' && pl.kinds.every((x) => x === 'video') && pl.n === g.items, { kind: pl.kind, cola: pl.n, visibles: g?.items }];
  });
  await typeQ(p, Q); await settled(p);

  await chk('D25_menu_contextual_en_cada_grupo', async () => {
    const res = {};
    const probe = async (g, q) => {
      if (q) { await typeQ(p, q); await settled(p); }
      const el = p.locator(`${G(g)} ${ITEM[g]}`).first();
      if (!(await el.count())) { res[g] = 'sin elementos'; return; }
      // Primero a la vista y quieta: el menú se cierra con el scroll (como en las demás vistas), así que el clic
      // derecho no puede arrastrar un desplazamiento propio.
      await el.scrollIntoViewIfNeeded(); await p.waitForTimeout(450);
      await el.click({ button: 'right' }); await p.waitForTimeout(250);
      res[g] = await p.evaluate(() => { const m = document.querySelector('.ctx-menu'); return m ? m.querySelectorAll('button, [role="menuitem"]').length : 0; });
      await p.keyboard.press('Escape'); await p.waitForTimeout(250);
    };
    await probe('songs', Q); await probe('albums'); await probe('artists');
    if (QV) await probe('videos', QV); else res.videos = 'omitido (sin videos)';
    return [res.songs >= 4 && res.albums >= 2 && res.artists >= 2 && (QV ? res.videos >= 2 : true), res];
  });
  await typeQ(p, Q); await settled(p);

  await chk('D26_arrastre_cancion_y_album_a_la_cola_y_a_la_barra', async () => {
    await p.click('.player-bar .action-btn[aria-label="Cola"]'); await p.waitForSelector('.queue-panel'); await p.waitForTimeout(300);
    const n0 = (await player(p)).n;
    await p.locator(`${G('songs')} tr.track-row`).nth(1).dragTo(p.locator('.queue-panel')); await p.waitForTimeout(700);
    const n1 = (await player(p)).n;
    const alb = (await groups(p)).albums.names[0];
    const aAlb = ALBUMS.find((a) => a.album === alb);
    const deAlbum = TRACKS.filter((t) => t.album === aAlb.album && (t.album_artist ?? null) === (aAlb.album_artist ?? null)).length;
    await p.locator(`${G('albums')} .album-card`).first().dragTo(p.locator('.queue-panel')); await p.waitForTimeout(1200);
    const n2 = (await player(p)).n;
    await p.click('.player-bar .action-btn[aria-label="Cola"]'); await p.waitForTimeout(400);   // cerrada: la barra es el destino
    await p.locator(`${G('songs')} tr.track-row`).nth(3).dragTo(p.locator('.player-bar')); await p.waitForTimeout(700);
    const n3 = (await player(p)).n;
    return [n1 === n0 + 1 && n2 === n1 + deAlbum && n3 === n2 + 1, { n0, n1, n2, n3, deAlbum }];
  });

  await ctx.close();
}

// ── Navegación: abrir un resultado y volver, música, F5, pestaña activa ──
{
  const { ctx, p } = await open({ viewport: { width: 1440, height: 900 } });
  await fresh(p, '/');
  await p.evaluate(() => { window.__marca = 'sin-recarga'; });
  await soft(async () => { await sideBtn(p, 'Buscar').click(); await p.waitForSelector('.search-view'); });
  await typeQ(p, Q); await settled(p);
  await soft(async () => { await p.locator(`${G('songs')} tr.track-row`).first().click(); await p.waitForTimeout(1200); });
  const m0 = await media(p);

  const abrirYVolver = async (grupo, urlRe, porBoton) => {
    await typeQ(p, Q); await settled(p);
    const antes = await groups(p);
    await p.locator(`${G(grupo)} ${ITEM[grupo]}`).first().click();
    await p.waitForURL(urlRe); await p.waitForTimeout(600);
    const urlDetalle = p.url();
    if (porBoton) await p.locator('.back-btn').first().click(); else await p.goBack();
    await p.waitForURL(/\/search$/); await p.waitForTimeout(120);
    const v = await view(p), despues = await groups(p);
    return { urlDetalle, restaurada: v.value === Q && sameGroups(antes, despues) && !v.status, valor: v.value, url: v.url };
  };
  await chk('D14_abrir_album_y_volver_restaura', async () => {
    const a = await abrirYVolver('albums', /\/albums\/[^/]+\/[^/]+$/, false);
    const b = await abrirYVolver('albums', /\/albums\/[^/]+\/[^/]+$/, true);
    return [a.restaurada && b.restaurada, { atras: a, botonVolver: b }];
  });
  await chk('D15_abrir_artista_y_volver_restaura', async () => {
    const a = await abrirYVolver('artists', /\/artists\/[^/]+$/, false);
    return [a.restaurada, a];
  });
  await chk('D16_abrir_playlist_y_volver_restaura', async () => {
    const a = await abrirYVolver('playlists', /\/playlists\/\d+$/, false);
    return [a.restaurada && /\/playlists\/\d+$/.test(a.urlDetalle), a];
  });

  await chk('D21_la_musica_no_se_corta_y_no_hay_recarga', async () => {
    await p.waitForTimeout(500);
    const m1 = await media(p);
    const marca = await p.evaluate(() => window.__marca);
    const barra = await p.locator('.player-bar').count();
    return [!!m0 && !!m1 && m1.src === m0.src && m1.t > m0.t && marca === 'sin-recarga' && barra === 1, { m0, m1, marca }];
  });

  await chk('D19_pestana_activa_limpia_y_enfoca', async () => {
    await typeQ(p, Q); await p.locator('.search-view .section-title').click();   // saca el foco de la caja
    const n0 = await p.evaluate(() => history.length);
    await sideBtn(p, 'Buscar').click(); await p.waitForTimeout(350);
    const v = await view(p), n1 = await p.evaluate(() => history.length);
    return [v.value === '' && v.hint && v.focused && v.url === '/search' && n1 === n0, { ...v, historial: [n0, n1] }];
  });

  await chk('D20_entrar_desde_otra_vista_arranca_vacia', async () => {
    await typeQ(p, Q);
    await sideBtn(p, 'Álbumes').click(); await p.waitForSelector('.album-grid .album-card'); await p.waitForTimeout(200);
    await sideBtn(p, 'Buscar').click(); await p.waitForSelector('.search-view'); await p.waitForTimeout(300);
    const v = await view(p);
    return [v.value === '' && v.hint && v.groups === 0, v];
  });

  await chk('D18_f5_en_search_abre_vacia', async () => {
    await typeQ(p, Q);
    await p.reload(); await p.waitForSelector('.search-view'); await p.waitForTimeout(400);
    const v = await view(p);
    return [v.url === '/search' && v.value === '' && v.hint && v.groups === 0, v];
  });
  await ctx.close();
}

// ── Escribir no dispara atajos ni cierra overlays ──
{
  const { ctx, p } = await open({ viewport: { width: 1440, height: 900 } });
  await fresh(p);
  await typeQ(p, Q); await settled(p);
  await soft(async () => { await p.locator(`${G('songs')} tr.track-row`).first().click(); await p.waitForTimeout(900); });

  await chk('D24_atajos_M_F_espacio_flechas_no_actuan_al_escribir', async () => {
    await p.locator(INPUT).click(); await p.keyboard.press('Control+A'); await p.keyboard.press('Backspace');
    const a = await player(p), t0 = await media(p);
    for (const k of ['KeyM', 'KeyF', 'Space', 'ArrowRight', 'ArrowLeft', 'KeyM']) await p.keyboard.press(k);
    await p.keyboard.type('m f ', { delay: 20 }); await p.waitForTimeout(900);
    const b = await player(p), t1 = await media(p), v = await view(p);
    const salto = t1 && t0 ? t1.t - t0.t : null;
    return [b.playing === a.playing && b.shuffle === a.shuffle && b.n === a.n && b.title === a.title && salto !== null && salto >= 0 && salto < 5
      && !(await p.evaluate(() => !!document.fullscreenElement)) && /m/i.test(v.value), { antes: [a.playing, a.shuffle, a.n], despues: [b.playing, b.shuffle, b.n], salto, valor: v.value }];
  });

  await chk('D22_esc_con_texto_limpia_sin_cerrar_la_cola', async () => {
    await p.click('.player-bar .action-btn[aria-label="Cola"]'); await p.waitForSelector('.queue-panel'); await p.waitForTimeout(300);
    await typeQ(p, Q);
    await p.keyboard.press('Escape'); await p.waitForTimeout(250);
    const v = await view(p);
    return [v.value === '' && (await p.locator('.queue-panel').count()) === 1, { valor: v.value }];
  });
  await chk('D23_esc_vacio_suelta_foco_sin_cerrar_la_cola_y_luego_cierra', async () => {
    await p.locator(INPUT).click();
    await p.keyboard.press('Escape'); await p.waitForTimeout(250);
    const v = await view(p), cola1 = await p.locator('.queue-panel').count();
    await p.keyboard.press('Escape'); await p.waitForTimeout(450);
    const cola2 = await p.locator('.queue-panel').count();
    return [!v.focused && cola1 === 1 && cola2 === 0, { enfocada: v.focused, cola1, cola2 }];
  });
  await ctx.close();
}

// ── Estados de carga: una fuente lenta y una fuente caída ──
{
  const { ctx, p } = await open({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**/api/tracks**', async (r) => { await new Promise((s) => setTimeout(s, 2500)); r.continue(); });
  await fresh(p);
  await chk('D29_fuente_lenta_muestra_cargando_y_luego_el_grupo', async () => {
    await typeQ(p, Q);
    const durante = await view(p), g1 = await groups(p);
    await settled(p); await p.waitForTimeout(300);
    const despues = await view(p), g2 = await groups(p);
    return [/Canciones/.test(durante.status ?? '') && !durante.statusErr && !g1.songs && !!g1.albums && !durante.none && !!g2.songs && despues.status === null,
      { durante: durante.status, grupos1: Object.keys(g1), grupos2: Object.keys(g2) }];
  });
  await ctx.close();
}
{
  const { ctx, p } = await open({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**/api/videos', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"x"}' }));
  await fresh(p);
  await chk('D30_fuente_caida_avisa_y_reintenta', async () => {
    if (!QV) return [true, { omitido: 'sin videos en el servidor' }];
    await typeQ(p, QV); await p.waitForSelector('.search-status--error');
    const v = await view(p);
    const reintentar = await p.locator('.search-status--error button', { hasText: 'Reintentar' }).count();
    const otrosOk = !v.none;   // no dice «sin resultados» cuando una fuente no cargó
    await ctx.unroute('**/api/videos');
    await p.locator('.search-status--error button', { hasText: 'Reintentar' }).click();
    await p.waitForSelector(G('videos')); await p.waitForTimeout(250);
    const v2 = await view(p);
    return [/Videos/.test(v.status ?? '') && reintentar === 1 && otrosOk && v2.status === null && !v2.statusErr, { error: v.status, tras: v2.status }];
  });
  await ctx.close();
}

// ── Caracteres especiales: la consulta es TEXTO, nunca un patrón ──
// Lo que se escribe no puede lanzar ni tumbar la vista, y una consulta literal que sí existe la encuentra.
{
  const { ctx, p } = await open({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 80)));
  const BS = String.fromCharCode(92);
  const conParen = TRACKS.find((t) => /\(.+\)/.test(t.title ?? ''));
  const conBarra = TRACKS.find((t) => / \/ /.test(t.title ?? ''));
  const PL2_NAME = `Mezcla C++ [en vivo] (a.b) $1 ^ ${Date.now() % 100000}`;
  const PL2 = await mk(PL2_NAME);
  try {
    await chk('D31_caracteres_especiales_no_lanzan_y_la_literal_se_encuentra', async () => {
      SPEC.playlists.list = await get('/api/playlists');
      const SOLO = ['(', ')', '[', ']', BS, '+', '*', '?', '^', '$', '.', '|', '{', '}', 'c++', 'a.b', '-', '/', '&', 'ñ', '🔥', 'x'.repeat(200), `${BS}p{L}`, '(?<', '*+'];
      // Literales que EXISTEN: un título con paréntesis, uno con « / » (en mayúsculas) y la playlist de prueba.
      const LITERAL = [
        conParen && conParen.title.slice(conParen.title.indexOf('(')),
        conBarra && conBarra.title.toUpperCase(),
        'c++', '[en vivo]', '(a.b)', '$1 ^',
      ].filter(Boolean);
      await fresh(p);
      const fallos = [], sinHallar = [];
      for (const q of [...SOLO, ...LITERAL]) {
        await typeQ(p, q); await settled(p);
        const v = await view(p), g = await groups(p), e = expected(q);
        const hay = ORDER.some((k) => e[k].length > 0);
        const vivo = (await p.locator('.search-view').count()) === 1 && v.value === q;
        const coincide = ORDER.every((k) => (e[k].length
          ? !!g[k] && g[k].count === e[k].length && g[k].names.join('|') === wantNames(e, k, Math.min(e[k].length, LIMITS[k])).join('|')
          : !g[k]));
        const estado = hay ? v.groups > 0 && !v.none : !!v.none;
        if (!(vivo && coincide && estado)) fallos.push(q.length > 20 ? `${q.slice(0, 8)}…(${q.length})` : q);
        if (LITERAL.includes(q) && !(hay && v.groups > 0)) sinHallar.push(q);
      }
      // La playlist de prueba tiene que aparecer, por su nombre, al buscar «c++».
      await typeQ(p, 'c++'); await settled(p);
      const pl = (await groups(p)).playlists;
      const halla = !!pl && pl.names.includes(PL2_NAME);
      return [errs.length === 0 && fallos.length === 0 && sinHallar.length === 0 && halla,
        { consultas: SOLO.length + LITERAL.length, literales: LITERAL.length, errores: errs, fallos, sinHallar, hallaPlaylist: halla }];
    });
  } finally {
    await fetch(`${BASE}/api/playlists/${PL2.id}`, { method: 'DELETE', headers: H }).catch(() => {});
    SPEC.playlists.list = PLAYLISTS;
  }
  await ctx.close();
}

// ── Desbordes y captura a 1440 y a 1024 (la cola abierta recorta el ancho) ──
{
  const { ctx, p } = await open({ viewport: { width: 1440, height: 900 } });
  await fresh(p); await typeQ(p, Q); await settled(p);
  await chk('D28_sin_desbordes_1440_y_1024', async () => {
    const a = await overflow(p);
    await p.setViewportSize({ width: 1024, height: 768 }); await p.waitForTimeout(400);
    const b = await overflow(p);
    await p.screenshot({ path: join(OUT, 'buscar-1024-resultados.png') });
    const g = Object.keys(await groups(p)).length;
    return [sinDesborde(a) && sinDesborde(b) && g >= 3, { a, b, grupos: g }];
  });
  await ctx.close();
}

// ═══════════════ TELÉFONO (390) ═══════════════
{
  const { ctx, p } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await fresh(p, '/');
  await soft(() => p.waitForSelector('.settings-fab'));

  await chk('M01_bottom_nav_intacto_7_items', async () => {
    const t = await p.evaluate(() => [...document.querySelectorAll('.bottom-nav .bottom-nav-btn')].map((b) => b.textContent.trim()));
    return [JSON.stringify(t) === JSON.stringify(['Biblioteca', 'Álbumes', 'Artistas', 'Géneros', 'Años', 'Playlists', 'Videos']), { items: t }];
  });

  await chk('M02_fab_buscar_a_la_izquierda_de_ajustes_sin_solaparse', async () => {
    const r = await p.evaluate(() => {
      const box = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
      return { s: box('.search-fab'), g: box('.settings-fab'), b: box('.changelog-bell'), vw: window.innerWidth, label: document.querySelector('.search-fab')?.getAttribute('aria-label') ?? null };
    });
    const bien = r.s && r.g && r.b && r.s.w === 44 && r.s.h === 44 && r.s.t === r.g.t && r.g.l - r.s.r >= 8 && r.s.l >= 0 && r.b.r <= r.vw && r.label === 'Buscar';
    return [!!bien, r];
  });
  await p.screenshot({ path: join(OUT, 'buscar-390-boton-flotante.png') });

  await chk('M03_fab_navega_a_search_y_se_oculta_ahi', async () => {
    await p.locator('.search-fab').tap(); await p.waitForSelector('.search-view'); await p.waitForTimeout(300);
    const v = await view(p);
    const fab = await p.locator('.search-fab').count();
    const activos = await p.evaluate(() => document.querySelectorAll('.bottom-nav .bottom-nav-btn.active').length);
    return [v.url === '/search' && v.hint && fab === 0 && activos === 0, { ...v, fab, activos }];
  });

  await chk('M04_sin_desbordes_390_con_resultados', async () => {
    await p.locator(INPUT).tap(); await p.keyboard.type(Q, { delay: 12 }); await p.waitForTimeout(500); await settled(p);
    const o = await overflow(p);
    await p.screenshot({ path: join(OUT, 'buscar-390-resultados.png') });
    const g = await groups(p);
    return [sinDesborde(o) && Object.keys(g).length >= 3, { o, grupos: Object.keys(g) }];
  });

  await chk('M05_long_press_en_cancion_abre_el_menu_de_tiles', async () => {
    const el = p.locator(`${G('songs')} tr.track-row`).first();
    await el.scrollIntoViewIfNeeded();
    const b = await el.boundingBox();
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); await p.waitForTimeout(700); await p.mouse.up(); await p.waitForTimeout(350);
    const r = await p.evaluate(() => { const m = document.querySelector('.ctx-menu'); return m ? { botones: m.querySelectorAll('button, [role="menuitem"]').length, tiles: m.className } : null; });
    await p.screenshot({ path: join(OUT, 'buscar-390-menu.png') });
    return [!!r && r.botones >= 4, r];
  });
  await ctx.close();
}

// ── limpieza ──
await fetch(`${BASE}/api/playlists/${PL.id}`, { method: 'DELETE', headers: H }).catch(() => {});

const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
console.log(`capturas: ${OUT}`);
console.log(`\nbuscar-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
