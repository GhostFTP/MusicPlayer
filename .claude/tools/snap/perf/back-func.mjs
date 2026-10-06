// back-func.mjs — funcional del botón de VOLVER de los 5 detalles (F3a, components/BackButton.jsx):
// existe en álbum, artista, género, año y playlist; mide ≥44px de alto en táctil (390, isMobile) y en
// escritorio; su nombre accesible es el texto ("Todos los artistas"…); al tocarlo vuelve a la LISTA
// de esa vista (Modelo 2: history.back()), y la flecha es un svg de 22px. Con SHOTS=1 guarda la
// cabecera de cada detalle a 1440/1024/390 en shots/sub3/<OUT>.
// La playlist de prueba se crea y se borra acá: correrlo SÓLO contra un backend con COPIA de la base.
// Uso: SNAP_BASE=http://localhost:4173 [SHOTS=1] [OUT=back] node back-func.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'shots', 'sub3', process.env.OUT ?? 'back');
if (process.env.SHOTS) mkdirSync(OUT, { recursive: true });
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
const j = async (p, o = {}) => (await fetch(BASE + p, { ...o, headers: H })).json();
const enc = encodeURIComponent;

// Un ejemplo real de cada detalle.
const albums = await j('/api/albums');
const alb = albums.find((a) => a.album_artist);
const artists = await j('/api/browse/artists');
const genres = await j('/api/browse/genres');
const years = await j('/api/browse/years');
const tracks = await j('/api/tracks?limit=50');
const pl = await j('/api/playlists', { method: 'POST', body: JSON.stringify({ name: 'back-func temporal' }) });
await fetch(BASE + `/api/playlists/${pl.id}/tracks`, { method: 'POST', headers: H, body: JSON.stringify({ track_ids: [tracks[0].id, tracks[1].id] }) });
const first = (x) => (Array.isArray(x) ? x[0] : Object.values(x)[0]?.[0] ?? x);
const artistName = first(artists).artist ?? first(artists).album_artist;
const genreName = first(genres).genre;
const yearNum = first(years).year;
const DETAILS = [
  { view: 'albums', label: 'Volver', path: `/albums/${enc(alb.album_artist)}/${enc(alb.album)}`, list: '/albums' },
  { view: 'artists', label: 'Todos los artistas', path: `/artists/${enc(artistName)}`, list: '/artists' },
  { view: 'genres', label: 'Todos los géneros', path: `/genres/${enc(genreName)}`, list: '/genres' },
  { view: 'years', label: 'Todos los años', path: `/years/${yearNum}`, list: '/years' },
  { view: 'playlists', label: 'Todas las playlists', path: `/playlists/${pl.id}`, list: '/playlists' },
];

const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };
for (const [w, h, mobile] of [[1440, 900, false], [1024, 800, false], [390, 844, true]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
  await ctx.route('**/stream/**', (r) => r.fulfill({ status: 404, body: '' }));
  await ctx.addInitScript((t) => localStorage.setItem('token', t), token);
  const p = await ctx.newPage();
  for (const d of DETAILS) {
    await p.goto(BASE + d.path);
    const found = await p.waitForSelector('.back-btn', { timeout: 8000 }).then(() => true).catch(() => false);
    if (!found) { ok(`${d.view}_${w}`, false, { motivo: 'sin .back-btn', path: d.path }); continue; }
    await p.waitForTimeout(500);
    const m = await p.evaluate(() => {
      const b = document.querySelector('.back-btn');
      const r = b.getBoundingClientRect();
      const svg = b.querySelector('svg')?.getBoundingClientRect();
      const cs = getComputedStyle(b);
      return { h: Math.round(r.height), w: Math.round(r.width), name: b.textContent.trim(), svg: svg ? Math.round(svg.width) : 0, bg: cs.backgroundColor, radius: cs.borderRadius, type: b.getAttribute('type') };
    });
    if (process.env.SHOTS) {
      const hb = await p.locator('.back-btn').boundingBox();
      await p.screenshot({ path: join(OUT, `${d.view}-${w}.png`), clip: { x: 0, y: 0, width: w, height: Math.min(h, Math.ceil(hb.y + hb.height + 140)) } });
    }
    // Volver: a la LISTA de esa vista (en un deep link frío la lista se sintetiza debajo del detalle).
    await p.locator('.back-btn').click();
    await p.waitForTimeout(700);
    const after = new URL(p.url()).pathname;
    ok(`${d.view}_${w}`, m.h >= 44 && m.name === d.label && m.svg === 22 && m.bg !== 'rgba(0, 0, 0, 0)' && m.type === 'button' && after === d.list, { ...m, after });
  }
  await ctx.close();
}
// El GESTO de deslizar para volver (Layout, sólo ≤700px) no cambia: arrastrar 120px a la derecha
// sobre el contenido del detalle vuelve a la lista, igual que antes.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.route('**/stream/**', (r) => r.fulfill({ status: 404, body: '' }));
  await ctx.addInitScript((t) => localStorage.setItem('token', t), token);
  const p = await ctx.newPage();
  for (const d of DETAILS.slice(0, 2)) {
    await p.goto(BASE + d.path); await p.waitForSelector('.back-btn'); await p.waitForTimeout(600);
    const y = 420, x0 = 60;
    await p.mouse.move(x0, y); await p.mouse.down();
    for (let k = 1; k <= 12; k++) { await p.mouse.move(x0 + k * 10, y + k * 0.5); await p.waitForTimeout(16); }
    await p.mouse.up(); await p.waitForTimeout(700);
    ok(`swipe_atras_${d.view}`, new URL(p.url()).pathname === d.list, { after: new URL(p.url()).pathname });
  }
  await ctx.close();
}
await fetch(BASE + `/api/playlists/${pl.id}`, { method: 'DELETE', headers: H });

const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
console.log(`\nback-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
