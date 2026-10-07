// cold-back.mjs — DIAGNÓSTICO: abrir cada detalle EN FRÍO (contexto y pestaña nuevos, sin historial
// previo de la app, como un link compartido) y tocar la pastilla de volver. Reporta a dónde lleva y el
// largo del historial antes y después. Sólo lectura (la playlist de prueba se crea y borra: COPIA de DB).
// Uso: SNAP_BASE=http://localhost:4173 node cold-back.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
const j = async (p, o = {}) => (await fetch(BASE + p, { ...o, headers: H })).json();
const enc = encodeURIComponent;
const alb = (await j('/api/albums')).find((a) => a.album_artist);
const art = (await j('/api/browse/artists'))[0];
const gen = (await j('/api/browse/genres'))[0];
const yr = (await j('/api/browse/years'))[0];
const pl = await j('/api/playlists', { method: 'POST', body: JSON.stringify({ name: 'cold-back temporal' }) });
const D = [
  ['albums', `/albums/${enc(alb.album_artist)}/${enc(alb.album)}`],
  ['artists', `/artists/${enc(art.artist)}`],
  ['genres', `/genres/${enc(gen.genre)}`],
  ['years', `/years/${yr.year}`],
  ['playlists', `/playlists/${pl.id}`],
];
const out = {};
for (const [view, path] of D) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => localStorage.setItem('token', t), token);
  const p = await ctx.newPage();
  await p.goto(BASE + path);
  await p.waitForSelector('.back-btn', { timeout: 8000 });
  await p.waitForTimeout(600);
  const before = await p.evaluate(() => ({ len: history.length, path: location.pathname, state: history.state }));
  await p.locator('.back-btn').click();
  await p.waitForTimeout(900);
  const after = await p.evaluate(() => ({ len: history.length, url: location.href, path: location.pathname, detalle: !!document.querySelector('.back-btn') }));
  out[view] = { abrio: path, antes: before, despues: after, sale_de_la_app: !after.url.startsWith(BASE) };
  await ctx.close();
}
await fetch(BASE + `/api/playlists/${pl.id}`, { method: 'DELETE', headers: H });
console.log(JSON.stringify(out, null, 1));
await browser.close();
