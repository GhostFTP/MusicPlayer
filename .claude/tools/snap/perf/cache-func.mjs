// cache-func.mjs — caché de vistas (Frente 1, sub-paso 5): FRESCURA y AISLAMIENTO entre cuentas.
// · Frescura: desde la 2ª respuesta, /api/tracks y /api/albums vienen con un dato cambiado; al volver
//   a la vista se pinta lo cacheado y, tras la revalidación de fondo, el dato nuevo.
// · Aislamiento: cuenta A = snap@local (real). Cuenta B = SIMULADA en Playwright: el login de
//   "cuenta-b" devuelve un JWT con otro id (firma falsa) y TODA /api/** con ese token se responde
//   desde acá (B nunca llega al servidor real). Se visita Biblioteca y Álbumes con A, se cierra
//   sesión desde Ajustes, se entra como B y se registra, frame a frame, si aparece algo de A.
// Uso: SNAP_BASE=http://localhost:4173 node cache-func.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';

await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };
const LIBROWS = '.library-tracks .track-row';
const CARDS = '.album-grid .album-card';
const click = (p, label) => p.evaluate((label) => [...document.querySelectorAll('.sidebar button')].find((b) => b.textContent.trim().startsWith(label)).click(), label);

// ── 1) Frescura ─────────────────────────────────────────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => localStorage.setItem('token', t), token);
  let nT = 0, nA = 0;
  await ctx.route('**/api/tracks?limit=10000', async (r) => {
    const res = await r.fetch(); const data = await res.json();
    if (++nT >= 2) data[0].title = 'TITULO-CAMBIADO';
    r.fulfill({ response: res, body: JSON.stringify(data) });
  });
  // la app pide '/api/albums?' (query vacía): se matchea por pathname, no con glob
  await ctx.route((url) => new URL(url).pathname === '/api/albums', async (r) => {
    const res = await r.fetch(); const data = await res.json();
    if (++nA >= 2) data[0].album = 'ALBUM-CAMBIADO';
    r.fulfill({ response: res, body: JSON.stringify(data) });
  });
  const p = await ctx.newPage();
  await p.goto(BASE + '/'); await p.waitForSelector(LIBROWS); await p.waitForTimeout(800);
  await click(p, 'Álbumes'); await p.waitForSelector(CARDS); await p.waitForTimeout(800);
  // vuelve a Biblioteca: 1º lo cacheado (sin el cambio), luego el cambio
  const lib = await p.evaluate(async () => {
    const t0 = performance.now();
    [...document.querySelectorAll('.sidebar button')].find((b) => b.textContent.trim().startsWith('Biblioteca')).click();
    let tRows = null, tNew = null, sawOldFirst = false;
    await new Promise((res) => {
      const f = () => {
        const now = performance.now() - t0;
        const rows = document.querySelectorAll('.library-tracks .track-row');
        if (rows.length && tRows == null) { tRows = now; sawOldFirst = ![...rows].some((r) => r.textContent.includes('TITULO-CAMBIADO')); }
        if ([...rows].some((r) => r.textContent.includes('TITULO-CAMBIADO'))) { tNew = now; return res(); }
        if (now > 8000) return res();
        requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
    return { filasCacheadas_ms: Math.round(tRows), cambioVisible_ms: tNew == null ? null : Math.round(tNew), primeroLoCacheado: sawOldFirst };
  });
  ok('frescura_biblioteca', lib.primeroLoCacheado && lib.cambioVisible_ms != null, lib);
  await p.waitForTimeout(500);
  const alb = await p.evaluate(async () => {
    const t0 = performance.now();
    [...document.querySelectorAll('.sidebar button')].find((b) => b.textContent.trim().startsWith('Álbumes')).click();
    let tCards = null, tNew = null, sawOldFirst = false;
    await new Promise((res) => {
      const f = () => {
        const now = performance.now() - t0;
        const cards = document.querySelectorAll('.album-grid .album-card');
        if (cards.length && tCards == null) { tCards = now; sawOldFirst = ![...cards].some((c) => c.textContent.includes('ALBUM-CAMBIADO')); }
        if ([...cards].some((c) => c.textContent.includes('ALBUM-CAMBIADO'))) { tNew = now; return res(); }
        if (now > 8000) return res();
        requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
    return { tarjetasCacheadas_ms: Math.round(tCards), cambioVisible_ms: tNew == null ? null : Math.round(tNew), primeroLoCacheado: sawOldFirst };
  });
  ok('frescura_albumes', alb.primeroLoCacheado && alb.cambioVisible_ms != null, alb);
  // revalidación que FALLA: con caché, se queda lo cacheado y sin error visible
  await ctx.unroute('**/api/tracks?limit=10000');
  await ctx.route('**/api/tracks?limit=10000', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"x"}' }));
  await click(p, 'Biblioteca'); await p.waitForTimeout(2000);
  ok('revalidacion_falla_sin_error', (await p.locator(LIBROWS).count()) > 0 && (await p.locator('.empty-state').count()) === 0,
    { filas: await p.locator(LIBROWS).count(), estadoError: await p.locator('.empty-state').count() });
  await ctx.close();
}

// ── 2) Aislamiento entre cuentas ────────────────────────────────────────────────────────────────
{
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const tokenB = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ id: 990001, username: 'cuenta-b', exp: Math.floor(Date.now() / 1000) + 3600 })}.firma-falsa`;
  const B_TRACKS = [1, 2, 3].map((i) => ({ id: 9900000 + i, title: `CUENTA-B-${i}`, artist: 'Artista B', album: 'Album B', album_artist: 'Artista B', duration: 200, track_number: i }));
  const B_ALBUMS = [{ album: 'Album B', album_artist: 'Artista B', year: 2020, track_count: 3, sample_track_id: null }];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => { if (!sessionStorage.getItem('__init')) { sessionStorage.setItem('__init', '1'); localStorage.setItem('token', t); } }, token);
  await ctx.route('**/api/**', async (r) => {
    const req = r.request(); const u = new URL(req.url());
    if (u.pathname === '/api/auth/login') {
      const body = JSON.parse(req.postData() || '{}');
      if (body.username === 'cuenta-b') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: tokenB }) });
      return r.fallback();
    }
    if ((req.headers().authorization || '').includes(tokenB)) {
      const json = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (u.pathname === '/api/tracks') return json(B_TRACKS);
      if (u.pathname === '/api/albums') return json(B_ALBUMS);
      if (u.pathname === '/api/changelog') return json({ content: '' });
      if (u.pathname.startsWith('/api/playlists')) return json([]);
      return json({});
    }
    return r.fallback();
  });
  const p = await ctx.newPage();
  await p.goto(BASE + '/'); await p.waitForSelector(LIBROWS); await p.waitForTimeout(800);
  const aTitles = new Set(await p.locator(`${LIBROWS} .track-title`).allTextContents());
  await click(p, 'Álbumes'); await p.waitForSelector(CARDS); await p.waitForTimeout(800);
  const aAlbums = new Set(await p.locator(`${CARDS} .album-name`).allTextContents());
  // cerrar sesión desde Ajustes
  await click(p, 'Ajustes'); await p.click('.settings-logout');
  await p.waitForSelector('form input');
  // registrar cada frame desde el login de B hasta 3 s después de entrar a Biblioteca y a Álbumes
  await p.evaluate(() => {
    window.__seen = new Set();
    const f = () => { for (const n of document.querySelectorAll('.library-tracks .track-row .track-title, .album-grid .album-card .album-name')) window.__seen.add(n.textContent); requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
  const inputs = p.locator('form input');
  await inputs.nth(0).fill('cuenta-b'); await inputs.nth(1).fill('x');
  await p.click('form button.btn-primary');
  await p.waitForSelector('.sidebar');
  await click(p, 'Biblioteca'); await p.waitForTimeout(3000);
  const bLib = await p.locator(`${LIBROWS} .track-title`).allTextContents();
  await click(p, 'Álbumes'); await p.waitForTimeout(3000);
  const bAlb = await p.locator(`${CARDS} .album-name`).allTextContents();
  const seen = await p.evaluate(() => [...window.__seen]);
  const leaked = seen.filter((t) => aTitles.has(t) || aAlbums.has(t));
  ok('aislamiento_cuentas', leaked.length === 0 && bLib.every((t) => t.startsWith('CUENTA-B')) && bAlb.length === 1,
    { cuentaA_pistas: aTitles.size, cuentaA_albumes: aAlbums.size, cuentaB_biblioteca: bLib, cuentaB_albumes: bAlb, vistosDeA_enAlgunFrame: leaked.slice(0, 5), totalVistos: seen.length });
  await ctx.close();
}

console.log(JSON.stringify(R, null, 1));
await browser.close();
