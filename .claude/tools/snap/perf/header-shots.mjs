// header-shots.mjs — capturas de la CABECERA de cada vista (Frente 2, sub-paso M2: dónde va el botón
// "Mix aleatorio"). Por vista, a 1440 (escritorio), 1024 (tablet: Biblioteca ya en modo lista) y
// 390 (móvil): recorte superior de .main-content (alto HEAD_H). Los detalles toman nombres reales de
// la API (primer álbum con album_artist, Daft Punk, el género y el año con más pistas, la 1.ª playlist).
// Salida: shots/sub3/<OUT>/h-<ancho>-<vista>.png. Uso: SNAP_BASE=http://localhost:4173 OUT=m2-hoy node header-shots.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'shots', 'sub3', process.env.OUT ?? 'm2-hoy');
const HEAD_H = Number(process.env.HEAD_H ?? 380);
mkdirSync(OUT, { recursive: true });
await preflight();
const token = await getToken();
const H = { Authorization: `Bearer ${token}` };
const j = (p) => fetch(`${BASE}${p}`, { headers: H }).then((r) => r.json());
const enc = (s) => encodeURIComponent(s);
const albums = await j('/api/albums');
const alb = albums.find((a) => a.album_artist === 'Daft Punk' && /Random Access/.test(a.album)) ?? albums.find((a) => a.album_artist);
const genres = await j('/api/browse/genres').catch(() => []);
const years = await j('/api/browse/years').catch(() => []);
const pls = await j('/api/playlists').catch(() => []);
const g = [...(Array.isArray(genres) ? genres : [])].sort((a, b) => (b.track_count ?? b.count ?? 0) - (a.track_count ?? a.count ?? 0))[0];
const y = [...(Array.isArray(years) ? years : [])].sort((a, b) => (b.track_count ?? b.count ?? 0) - (a.track_count ?? a.count ?? 0))[0];
const ROUTES = [
  ['biblioteca', '/'],
  ['biblioteca-busqueda', '/', 'daf'],
  ['albumes', '/albums'],
  ['album-detalle', `/albums/${enc(alb.album_artist)}/${enc(alb.album)}`],
  ['artistas', '/artists'],
  ['artista-detalle', `/artists/${enc('Daft Punk')}`],
  ['generos', '/genres'],
  ['genero-detalle', `/genres/${enc(g?.genre ?? 'Soundtrack')}`],
  ['anios', '/years'],
  ['anio-detalle', `/years/${y?.year ?? 2013}`],
  ['playlists', '/playlists'],
  ['playlist-detalle', `/playlists/${pls[0]?.id ?? 3}`],
  ['novedades', '/changelog'],
  ['ajustes', '/settings'],
];
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const saved = [];
for (const [w, opts] of [
  [1440, { viewport: { width: 1440, height: 900 } }],
  [1024, { viewport: { width: 1024, height: 800 } }],
  [390, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
]) {
  const ctx = await browser.newContext({ deviceScaleFactor: 1, ...opts });
  await ctx.addInitScript((t) => localStorage.setItem('token', t), token);
  const p = await ctx.newPage();
  for (const [name, path, search] of ROUTES) {
    await p.goto(BASE + path);
    await p.waitForSelector('.main-content .section-header, .main-content .detail-hero, .main-content h1, .main-content h2', { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(1500);
    if (search) { await p.fill('.search-box input', search); await p.waitForTimeout(700); }
    await p.mouse.move(2, 2);
    const box = await p.locator('.main-content').boundingBox();
    const path_ = join(OUT, `h-${w}-${name}.png`);
    await p.screenshot({ path: path_, clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, HEAD_H) }, animations: 'disabled' });
    saved.push(path_);
  }
  await ctx.close();
}
console.log(`álbum: ${alb.album_artist} / ${alb.album} · género: ${g?.genre} · año: ${y?.year} · playlist: ${pls[0]?.id}`);
console.log(saved.join('\n'));
await browser.close();
