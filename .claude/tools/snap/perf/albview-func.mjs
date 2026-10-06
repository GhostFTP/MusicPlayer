// albview-func.mjs — funcional de la VISTA del listado de Álbumes (Frente 3, F3b–F3e):
// predeterminado sin clave, guardado por usuario (y que NO se mezcla al cambiar de cuenta, con un
// segundo login real), valor inválido o storage roto → predeterminado, columnas de cada modo a 390,
// selector con teclado (radiogroup en escritorio, menú en el teléfono) sin que las teclas lleguen a
// los atajos globales (←/→ adelantarían la canción), y que cada cara aparezca sólo en su ancho.
// La segunda cuenta (SNAP2_USER / SNAP2_PASS) tiene que existir SÓLO en la COPIA de la base.
// Uso: SNAP_BASE=http://localhost:4173 SNAP2_USER=… SNAP2_PASS=… node albview-func.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';

await preflight();
const token = await getToken();
const login2 = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: process.env.SNAP2_USER, password: process.env.SNAP2_PASS }) });
const token2 = login2.ok ? (await login2.json()).token : null;
const idOf = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).id;
const K1 = `sonorarev.albumsView:id:${idOf(token)}`;
const K2 = token2 ? `sonorarev.albumsView:id:${idOf(token2)}` : null;

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };
const GRID = '.album-grid';

async function open(opts, init) {
  const ctx = await browser.newContext(opts);
  await ctx.route('**/stream/**', (r) => r.fulfill({ status: 404, body: '' }));
  await ctx.addInitScript((t) => { if (!sessionStorage.getItem('__seeded')) { localStorage.setItem('token', t); sessionStorage.setItem('__seeded', '1'); } }, token);
  if (init) await ctx.addInitScript(init);
  const p = await ctx.newPage();
  return { ctx, p };
}
const state = (p) => p.evaluate(() => {
  const g = document.querySelector('.album-grid');
  const checked = document.querySelector('.avs-seg [aria-checked="true"]')?.getAttribute('aria-label');
  const cols = getComputedStyle(g).gridTemplateColumns.split(' ').filter(Boolean).length;
  return { cls: g.className, checked, cols, display: getComputedStyle(g).display };
});
const gotoAlbums = async (p) => { await p.goto(BASE + '/albums'); await p.waitForSelector('.album-grid .album-card'); await p.waitForTimeout(300); };

// ── Escritorio ──
{
  const { ctx, p } = await open({ viewport: { width: 1440, height: 900 } });
  await p.goto(BASE + '/'); await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('sonorarev.albumsView:')) localStorage.removeItem(k); });
  await gotoAlbums(p);
  let s = await state(p);
  ok('predeterminado_sin_clave', s.cls === 'album-grid' && s.checked === 'Grande', s);

  // Elegir Mediana → se aplica y se guarda con la clave del usuario; sobrevive a recargar.
  await p.locator('.avs-seg [role="radio"][aria-label="Mediana"]').click();
  s = await state(p);
  const saved = await p.evaluate((k) => localStorage.getItem(k), K1);
  await p.reload(); await p.waitForSelector('.album-grid .album-card');
  const s2 = await state(p);
  ok('guarda_por_usuario_y_recarga', s.cls.includes('album-grid--d3') && saved === 'd3' && s2.cls.includes('album-grid--d3') && s2.checked === 'Mediana', { saved, antes: s.cls, despues: s2.cls });

  // Cambio de CUENTA real (segundo login): la otra cuenta arranca en el predeterminado, elige Lista;
  // al volver a la primera sigue en Mediana.
  if (token2) {
    await p.evaluate((t) => localStorage.setItem('token', t), token2);
    await p.reload(); await p.waitForSelector('.album-grid .album-card');
    const u2 = await state(p);
    await p.locator('.avs-seg [role="radio"][aria-label="Lista"]').click();
    const u2list = await state(p);
    const k2 = await p.evaluate((k) => localStorage.getItem(k), K2);
    await p.evaluate((t) => localStorage.setItem('token', t), token);
    await p.reload(); await p.waitForSelector('.album-grid .album-card');
    const u1 = await state(p);
    ok('no_se_mezcla_entre_cuentas', u2.cls === 'album-grid' && u2list.cls.includes('--list') && k2 === 'list' && u1.cls.includes('--d3'), { u2: u2.cls, u2list: u2list.cls, k2, u1: u1.cls });
  } else ok('no_se_mezcla_entre_cuentas', false, { motivo: 'sin SNAP2_USER/SNAP2_PASS o el login falló' });

  // Valor inválido → predeterminado (y la vista funciona).
  await p.evaluate((k) => localStorage.setItem(k, 'grande'), K1);
  await p.reload(); await p.waitForSelector('.album-grid .album-card');
  s = await state(p);
  ok('invalido_cae_al_predeterminado', s.cls === 'album-grid' && s.checked === 'Grande', s);

  // Teclado: el foco entra al elegido; flechas/Inicio/Fin cambian de modo y mueven el foco; ninguna
  // de esas teclas llega a window (donde ←/→ adelantan la canción y Espacio pausa).
  await p.evaluate(() => { window.__leaked = []; window.addEventListener('keydown', (e) => window.__leaked.push(e.key)); });
  await p.locator('.avs-seg [aria-checked="true"]').focus();
  const seq = [];
  for (const k of ['ArrowRight', 'ArrowRight', 'End', 'Home', 'ArrowLeft', ' ']) {
    await p.keyboard.press(k);
    seq.push(await p.evaluate(() => ({ checked: document.querySelector('.avs-seg [aria-checked="true"]').getAttribute('aria-label'), focus: document.activeElement.getAttribute('aria-label') })));
  }
  const leaked = await p.evaluate(() => window.__leaked);
  const tabStops = await p.locator('.avs-seg [tabindex="0"]').count();
  ok('teclado_radiogroup', seq.map((x) => x.checked).join('|') === 'Mediana|Pequeña|Lista|Grande|Lista|Lista' && seq.every((x) => x.focus === x.checked) && leaked.length === 0 && tabStops === 1, { seq: seq.map((x) => x.checked), leaked, tabStops });
  await p.locator('.avs-seg [role="radio"][aria-label="Grande"]').click();

  // Rótulos de densidad (no de columnas) en aria-label y title.
  ok('rotulos_densidad', await p.evaluate(() => [...document.querySelectorAll('.avs-seg [role="radio"]')].map((b) => `${b.getAttribute('aria-label')}=${b.title}`).join('|')) === 'Grande=Grande|Mediana=Mediana|Pequeña=Pequeña|Mosaico=Mosaico|Lista=Lista');

  // Mosaico: cada tarjeta lleva aria-label «álbum – artista» (o sólo el álbum sin artista), SIN nodos
  // extra; en los otros modos no lleva aria-label.
  const nodes = () => p.evaluate(() => document.querySelectorAll('.album-grid *').length);
  const n0 = await nodes();
  await p.locator('.avs-seg [role="radio"][aria-label="Mosaico"]').click();
  const mos = await p.evaluate(() => [...document.querySelectorAll('.album-grid .album-card')].map((el) => el.getAttribute('aria-label')));
  const n1 = await nodes();
  await p.locator('.avs-seg [role="radio"][aria-label="Grande"]').click();
  const sinLabel = await p.evaluate(() => [...document.querySelectorAll('.album-grid .album-card')].every((el) => !el.hasAttribute('aria-label')));
  const albs = await p.evaluate(async () => (await fetch('/api/albums', { headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } })).json());
  const want = albs.map((a) => (a.album_artist ? `${a.album} – ${a.album_artist}` : a.album));
  ok('mosaico_aria_label', mos.length === want.length && mos.every((l, i) => l === want[i]) && n1 === n0 && sinLabel, { primeros: mos.slice(0, 3), n0, n1, sinLabel });

  ok('caras_por_ancho_escritorio', await p.locator('.avs-seg').isVisible() && !(await p.locator('.avs-btn').isVisible()));
  ok('a11y_radiogroup', await p.evaluate(() => {
    const g = document.querySelector('.avs-seg');
    const rs = [...g.querySelectorAll('[role="radio"]')];
    return g.getAttribute('role') === 'radiogroup' && !!g.getAttribute('aria-label') && rs.length === 5 && rs.every((r) => r.getAttribute('aria-label') && ['true', 'false'].includes(r.getAttribute('aria-checked')));
  }));
  await ctx.close();
}

// ── Storage roto (getItem/setItem lanzan) → predeterminado, y elegir igual funciona en la visita ──
{
  const { ctx, p } = await open({ viewport: { width: 1440, height: 900 } }, () => {
    const g = Storage.prototype.getItem, s = Storage.prototype.setItem;
    Storage.prototype.getItem = function (k) { if (String(k).startsWith('sonorarev.albumsView:')) throw new Error('bloqueado'); return g.call(this, k); };
    Storage.prototype.setItem = function (k, v) { if (String(k).startsWith('sonorarev.albumsView:')) throw new Error('bloqueado'); return s.call(this, k, v); };
  });
  await gotoAlbums(p);
  const s = await state(p);
  await p.locator('.avs-seg [role="radio"][aria-label="Mosaico"]').click();
  const s2 = await state(p);
  ok('storage_roto_no_rompe', s.cls === 'album-grid' && s2.cls.includes('--mosaic'), { s: s.cls, s2: s2.cls });
  await ctx.close();
}

// ── Teléfono (390): columnas por modo y el menú "Vista" con teclado ──
{
  const { ctx, p } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await gotoAlbums(p);
  const btn = p.locator('.avs-btn');
  const bb = await btn.boundingBox();
  ok('movil_boton_44', Math.round(bb.width) >= 44 && Math.round(bb.height) >= 44 && !(await p.locator('.avs-seg').isVisible()), { w: bb.width, h: bb.height });

  // Columnas de cada modo (tamaño de celda de iOS en 390): 2 · 3 · 4 · 5 · lista.
  const cols = {};
  for (const [m, label] of [['d2', 'Grande'], ['d3', 'Mediana'], ['d4', 'Pequeña'], ['mosaic', 'Mosaico'], ['list', 'Lista']]) {
    await btn.click(); await p.waitForSelector('.avs-menu');
    await p.locator('.avs-menu [role="menuitemradio"]', { hasText: label }).click();
    await p.waitForTimeout(150);
    const s = await state(p);
    cols[m] = s.display === 'flex' ? 'lista' : s.cols;
  }
  ok('columnas_por_modo_390', cols.d2 === 2 && cols.d3 === 3 && cols.d4 === 4 && cols.mosaic === 5 && cols.list === 'lista', cols);

  // Teclado en el menú: Enter abre, el foco va al elegido, ↓ mueve, Enter elige y cierra devolviendo
  // el foco al botón; Esc cierra sin cambiar; ninguna tecla sale del menú.
  await p.locator('.avs-menu').waitFor({ state: 'detached' }).catch(() => {});
  await p.evaluate(() => { window.__leaked = []; window.addEventListener('keydown', (e) => window.__leaked.push(e.key)); });
  await btn.focus();
  await p.evaluate(() => { window.__leaked = []; });
  await p.keyboard.press('Enter'); await p.waitForSelector('.avs-menu');
  const f0 = await p.evaluate(() => document.activeElement.textContent);
  await p.keyboard.press('ArrowDown');
  const f1 = await p.evaluate(() => document.activeElement.textContent);
  await p.keyboard.press('Enter'); await p.waitForTimeout(150);
  const after = await state(p);
  const back = await p.evaluate(() => document.activeElement.classList.contains('avs-btn'));
  await p.keyboard.press('Enter'); await p.waitForSelector('.avs-menu');
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  const afterEsc = await state(p);
  const closed = (await p.locator('.avs-menu').count()) === 0;
  const leaked = await p.evaluate(() => window.__leaked.filter((k) => k !== 'Enter'));
  ok('teclado_menu_movil', f0 === 'Lista' && f1 === 'Grande' && after.cls === 'album-grid' && back && afterEsc.cls === 'album-grid' && closed && leaked.length === 0, { f0, f1, after: after.cls, back, afterEsc: afterEsc.cls, closed, leaked });

  // Tocar afuera cierra el menú.
  await btn.click(); await p.waitForSelector('.avs-menu');
  // …sobre una TARJETA: cierra y NO abre ese álbum (el toque no sigue viaje).
  const card = await p.locator('.album-grid .album-card').nth(0).boundingBox();   // primera fila: las de abajo quedan bajo la barra mini
  await p.mouse.click(card.x + card.width / 2, card.y + card.height / 2); await p.waitForTimeout(500);
  const det1 = await p.locator('.detail-title').count();
  // …y el toque SIGUIENTE sobre la tarjeta sí la abre (no se tragó un click de más).
  await p.mouse.click(card.x + card.width / 2, card.y + card.height / 2); await p.waitForTimeout(900);
  const det2 = await p.locator('.detail-title').count();
  ok('tocar_afuera_cierra_sin_abrir', (await p.locator('.avs-menu').count()) === 0 && det1 === 0 && det2 === 1, { det1, det2 });
  await ctx.close();
}

const fails = Object.entries(R).filter(([, v]) => (typeof v === 'object' ? !v.ok : !v));
console.log(JSON.stringify(R, null, 1));
console.log(`\nalbview-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
