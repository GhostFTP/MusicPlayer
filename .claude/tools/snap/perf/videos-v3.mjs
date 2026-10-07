// videos-v3.mjs — funcional de la vista VIDEOS (V3: sólo lista, sin reproducir) y del 7º ítem de la
// navegación. Corre contra un backend con VIDEO_DIR = los 3 fixtures de video-fixtures.mjs (así lo
// arma regresion.mjs). Comprueba:
//   · GET /api/videos trae los 3 fixtures con artist/title/year/duration/has_cover;
//   · la barra inferior a 360 y 390 (isMobile) tiene 7 botones, ninguna etiqueta se sale de su botón
//     ni se parte en 2 líneas, y ni la barra ni la página scrollean en horizontal;
//   · la barra lateral (1440) tiene "Videos" y lleva a /videos;
//   · /videos agrupa por artista, pinta las portadas que existen y el marcador donde no hay;
//   · tocar una tarjeta NO hace nada (aria-disabled, sin cambio de URL, sin <video>);
//   · estados de error (con Reintentar) y vacío.
// Con SHOTS=1 guarda capturas en shots/sub3/<OUT> (por defecto videos-v3).
// Uso: SNAP_BASE=http://localhost:4173 [SHOTS=1] node videos-v3.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'shots', 'sub3', process.env.OUT ?? 'videos-v3');
const SHOTS = !!process.env.SHOTS;
if (SHOTS) mkdirSync(OUT, { recursive: true });

const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };

// 1) La API: la forma real de la respuesta.
const api = await (await fetch(BASE + '/api/videos', { headers: { Authorization: `Bearer ${token}` } })).json();
const vids = api?.videos ?? [];
const campos = ['id', 'title', 'artist', 'year', 'duration', 'has_cover'];
ok('api_tres_fixtures', vids.length === 3 && vids.every((v) => campos.every((c) => c in v)),
  { n: vids.length, campos: vids[0] ? Object.keys(vids[0]) : [] });

async function page(w, h, mobile) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript((t) => localStorage.setItem('token', t), token);
  const p = await ctx.newPage();
  return { ctx, p };
}

// 2) Barra inferior a 360 y 390.
for (const w of [360, 390]) {
  const { ctx, p } = await page(w, 844, true);
  await p.goto(BASE + '/videos');
  await p.waitForSelector('.bottom-nav .bottom-nav-btn');
  await p.waitForTimeout(500);
  const m = await p.evaluate(() => {
    const nav = document.querySelector('.bottom-nav');
    const btns = [...nav.querySelectorAll('.bottom-nav-btn')];
    const labels = btns.map((b) => {
      const tn = [...b.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      const br = b.getBoundingClientRect();
      if (!tn) return { texto: null };
      const r = document.createRange(); r.selectNodeContents(tn);
      const rr = r.getBoundingClientRect();
      return { texto: tn.textContent.trim(), lineas: r.getClientRects().length, dentro: rr.left >= br.left - 0.5 && rr.right <= br.right + 0.5, ancho: Math.round(br.width), anchoTexto: Math.round(rr.width) };
    });
    return {
      n: btns.length,
      labels,
      navScroll: nav.scrollWidth - nav.clientWidth,
      pageScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      activa: nav.querySelector('.bottom-nav-btn.active')?.textContent.trim(),
    };
  });
  ok(`nav_${w}_siete`, m.n === 7 && m.labels[6]?.texto === 'Videos', { n: m.n, ultima: m.labels[6]?.texto });
  ok(`nav_${w}_etiquetas_caben`, m.labels.every((l) => l.texto && l.dentro && l.lineas === 1), { labels: m.labels });
  ok(`nav_${w}_sin_scroll_horizontal`, m.navScroll <= 0 && m.pageScroll <= 0, { navScroll: m.navScroll, pageScroll: m.pageScroll });
  ok(`nav_${w}_videos_activa`, m.activa === 'Videos', { activa: m.activa });
  if (SHOTS) {
    await p.locator('.bottom-nav').screenshot({ path: join(OUT, `nav-${w}.png`) });
    await p.screenshot({ path: join(OUT, `videos-${w}.png`) });
  }
  await ctx.close();
}

// 3) Barra lateral (escritorio) → /videos.
{
  const { ctx, p } = await page(1440, 900, false);
  await p.goto(BASE + '/');
  await p.waitForSelector('.sidebar-nav button');
  const btn = p.locator('.sidebar-nav button', { hasText: 'Videos' });
  ok('sidebar_tiene_videos', (await btn.count()) === 1);
  await btn.click();
  await p.waitForSelector('.video-card');
  ok('sidebar_lleva_a_videos', new URL(p.url()).pathname === '/videos', { path: new URL(p.url()).pathname });

  // 4) La vista.
  await p.waitForTimeout(800);   // portadas lazy
  const v = await p.evaluate(() => ({
    titulo: document.querySelector('.section-title')?.textContent,
    grupos: [...document.querySelectorAll('.video-group-title')].map((h) => h.textContent),
    tarjetas: [...document.querySelectorAll('.video-card')].map((c) => ({
      titulo: c.querySelector('.album-name')?.textContent,
      meta: c.querySelector('.album-count')?.textContent ?? null,
      img: c.querySelector('img') ? { cargo: c.querySelector('img').complete && c.querySelector('img').naturalWidth > 0 } : null,
      marcador: !!c.querySelector('.album-cover-placeholder'),
      disabled: c.getAttribute('aria-disabled'),
    })),
  }));
  const conPortada = vids.filter((x) => x.has_cover).length;
  ok('vista_titulo', v.titulo === 'Videos', { titulo: v.titulo });
  ok('vista_agrupa_por_artista', JSON.stringify(v.grupos) === JSON.stringify([...new Set(vids.map((x) => x.artist))]), { grupos: v.grupos });
  ok('vista_tres_tarjetas', v.tarjetas.length === vids.length, { n: v.tarjetas.length });
  ok('vista_portadas', v.tarjetas.filter((t) => t.img?.cargo).length === conPortada && v.tarjetas.filter((t) => t.marcador).length === vids.length - conPortada,
    { tarjetas: v.tarjetas });
  ok('vista_tarjetas_deshabilitadas', v.tarjetas.every((t) => t.disabled === 'true'));

  // 5) Tocar no hace nada.
  const antes = p.url();
  await p.locator('.video-card').first().click();
  await p.waitForTimeout(500);
  const despues = await p.evaluate(() => ({ url: location.href, videos: document.querySelectorAll('video').length }));
  ok('tocar_no_hace_nada', despues.url === antes && despues.videos === 0, despues);
  if (SHOTS) await p.screenshot({ path: join(OUT, 'videos-1440.png'), fullPage: true });
  await ctx.close();
}

// 6) Error y vacío (la respuesta se intercepta en el navegador; el backend no se toca).
for (const [nombre, handler, esperado] of [
  ['estado_error', (r) => r.abort('failed'), 'No se pudieron cargar los videos'],
  ['estado_vacio', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"videos":[]}' }), 'Sin videos'],
]) {
  const { ctx, p } = await page(1440, 900, false);
  await p.route('**/api/videos', handler);
  await p.goto(BASE + '/videos');
  await p.waitForSelector('.empty-state');
  const e = await p.evaluate(() => ({ titulo: document.querySelector('.empty-title')?.textContent, reintentar: !!document.querySelector('.empty-state .btn-primary') }));
  ok(nombre, e.titulo === esperado && (nombre === 'estado_error' ? e.reintentar : !e.reintentar), e);
  await ctx.close();
}

const fails = Object.entries(R).filter(([, v]) => v === false || (v && typeof v === 'object' && v.ok === false)).map(([k]) => k);
console.log(JSON.stringify(R, null, 1));
console.log(`\nvideos-v3: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
