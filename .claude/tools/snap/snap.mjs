// snap.mjs — Fase 2: los TRES anchos que importan, de una vista dada, en una corrida.
//
//   node snap.mjs                      → vista por defecto (álbum de 32 pistas)
//   node snap.mjs "/albums/Foo/Bar"    → cualquier ruta del Modelo 2
//
// Tooling LOCAL. No lo importa nadie de la app, no entra al bundle de Vite y no lo copia
// el Dockerfile (sólo copia music-client/ y music-server/; .dockerignore excluye .claude).
//
// AUTH — el repo NO tiene VITE_DISABLE_AUTH (0 coincidencias de VITE_ en todo el árbol), y
// agregar un bypass en AuthContext.jsx sería tocar código que SÍ viaja al bundle de
// producción. Así que la sesión entra por fuera, con un login NORMAL: el script hace el mismo
// POST /api/auth/login que haría el formulario y siembra en localStorage el JWT que devuelve
// el backend. No lee el secreto de firma ni fabrica tokens.
//
// Requisitos: backend en :3000, Vite en :5173 (o SNAP_BASE), y credenciales en
// .claude/tools/snap/.env (SNAP_USER / SNAP_PASS). SNAP_TOKEN sigue sirviendo como atajo.

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, 'shots');

// OJO con el puerto: Vite NO usa strictPort, así que si 5173 está ocupado por OTRO proyecto
// se corre solo al 5174 y lo dice en su log. Pasó de verdad: 5173 lo tenía otra app y las
// tres tomas salieron con SU 404, sin un solo error de red. De ahí el preflight de abajo.
const BASE = process.env.SNAP_BASE ?? 'http://localhost:5173';

// Auto-reinstalación entre sesiones: el entorno de Claude Code se resetea y node_modules/
// está gitignoreado. Los binarios del navegador viven en %LOCALAPPDATA%\ms-playwright, FUERA
// del repo, así que sobreviven al reset: acá sólo hay que rehacer 2 paquetes (~2s).
if (!existsSync(join(HERE, 'node_modules', 'playwright'))) {
  console.log('[snap] falta playwright → npm install…');
  execSync('npm install', { cwd: HERE, stdio: 'inherit' });
}
const { chromium } = await import('playwright');

// ── Sesión ───────────────────────────────────────────────────────────────────
// Login normal por API: el script hace el MISMO POST /api/auth/login que haría el formulario
// y siembra el JWT que le devuelve el backend. No lee el secreto de firma ni genera tokens.
// Credenciales desde .claude/tools/snap/.env (gitignoreado por la regla `.env` de la raíz),
// o por variables de entorno. SNAP_TOKEN sigue funcionando si preferís pegar un JWT a mano.
function readDotEnv() {
  const f = join(HERE, '.env');
  if (!existsSync(f)) return {};
  return Object.fromEntries(
    readFileSync(f, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
      }),
  );
}

async function getToken() {
  const env = readDotEnv();

  // Un JWT ya emitido gana sobre el login: es el atajo cuando la cuenta con la que hay sesión
  // no es la de SNAP_USER. Se acepta tanto por variable de entorno como desde el .env — antes
  // sólo se miraba process.env, así que ponerlo en el archivo no tenía ningún efecto.
  // NUNCA se imprime su valor, ni entero ni recortado.
  const token = process.env.SNAP_TOKEN ?? env.SNAP_TOKEN;
  if (token) {
    console.log('[snap] usando SNAP_TOKEN (login por usuario/contraseña omitido)');
    return token;
  }

  const user = process.env.SNAP_USER ?? env.SNAP_USER;
  const pass = process.env.SNAP_PASS ?? env.SNAP_PASS;
  if (!user || !pass) {
    console.error('[snap] no hay credenciales. Creá .claude/tools/snap/.env con:');
    console.error('       SNAP_USER=admin@adr.com');
    console.error('       SNAP_PASS=<la contraseña local>');
    console.error('       (o exportá SNAP_TOKEN con un JWT ya emitido)');
    process.exit(1);
  }

  // Vía el proxy de Vite (/api → :3000), así se usa el mismo origen que la app.
  let res;
  try {
    res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    console.error(`[snap] no se pudo llamar a ${BASE}/api/auth/login: ${e.message}`);
    process.exit(1);
  }
  if (!res.ok) {
    // El backend responde 401 con { error } tanto si el usuario no existe como si la
    // contraseña no coincide (auth.js:50-53) — no distingue, y está bien que no lo haga.
    const body = await res.json().catch(() => ({}));
    console.error(`[snap] login rechazado: HTTP ${res.status} ${body.error ?? ''}`.trim());
    console.error(`       usuario probado: ${user}`);
    process.exit(1);
  }
  const issued = (await res.json()).token;
  if (!issued) {
    console.error('[snap] el login respondió 200 pero sin token.');
    process.exit(1);
  }
  console.log(`[snap] sesión obtenida por login como ${user}`);
  return issued;
}

// ── La vista ─────────────────────────────────────────────────────────────────
// La URL directa funciona por el Modelo 2 (routes.js:43-45); Albums.jsx:47-57 consume el
// target cuando la lista termina de cargar y abre el detalle.
const DEFAULT_PATH = `/albums/${encodeURIComponent('Daft Punk')}/${encodeURIComponent('TRON: Legacy - The Complete Edition (Original Motion Picture Soundtrack)')}`;
const PATH = process.argv[2] ?? DEFAULT_PATH;
const SLUG = (decodeURIComponent(PATH).replace(/^\//, '').split('/')[0] || 'home').replace(/[^a-z0-9]+/gi, '-').toLowerCase();

// ── Los tres regímenes ───────────────────────────────────────────────────────
// isMobile/hasTouch cambian qué media queries de puntero aplican y NO se pueden cambiar en
// caliente → un contexto por ancho, no un contexto redimensionado.
//
// Por qué estos tres (main.css:682-686 documenta los disparadores):
//   390        → bloque móvil ≤700px. La cola desktop no existe acá (.player-actions es
//                display:none en main.css:4180), así que no se abre.
//   960+cola   → el caso de ayer. La cola es la 3ª columna del grid (≥701px) y roba
//                --queue-w (320px) SIN cambiar el viewport, así que dispara
//                `.layout--queue @ max-width:1344`, no el @media de viewport.
//   1440       → ningún disparador (>1344): tablas como tablas. Referencia sana.
const SHOTS_SPEC = [
  { name: '390',       width: 390,  height: 844, mobile: true,  queue: false },
  { name: '960-queue', width: 960,  height: 900, mobile: false, queue: true  },
  { name: '1440',      width: 1440, height: 900, mobile: false, queue: false },
];

// ── Auditoría de layout ──────────────────────────────────────────────────────
// Corre DENTRO de la página. Caza los dos bugs de ayer sin depender del ojo:
// el título colapsado al ancho de la carátula y el chip de calidad desbordando la fila.
function auditInPage() {
  const px = (n) => Math.round(n);
  const flags = [];

  // 1 · Scroll horizontal a nivel página: casi siempre es un bug real.
  const de = document.documentElement;
  if (de.scrollWidth > window.innerWidth + 1) {
    flags.push({ sev: 'alto', kind: 'page-overflow-x',
      detail: `la página scrollea en horizontal: ${de.scrollWidth}px > viewport ${window.innerWidth}px` });
  }

  // 2 · Contenedores que desbordan su propia caja.
  for (const sel of ['.main-content', '.track-table']) {
    document.querySelectorAll(sel).forEach((el) => {
      if (el.scrollWidth > el.clientWidth + 1) {
        flags.push({ sev: 'alto', kind: 'overflow-x', sel,
          detail: `${sel}: scrollWidth ${el.scrollWidth}px > clientWidth ${el.clientWidth}px` });
      }
    });
  }

  const rows = [...document.querySelectorAll('.track-row')].slice(0, 15);

  // 3 · Título colapsado — EL bug de ayer. Con table-layout:fixed y columnas ocultas, el
  //     ancho no se reclama limpio y el Título quedaba al ancho de la carátula.
  let narrow = 0, minW = Infinity;
  // 4 · Título recortado: cuánto texto queda fuera por ellipsis.
  let clipped = 0, maxHidden = 0;
  for (const row of rows) {
    const t = row.querySelector('.track-title');
    if (!t) continue;
    const w = t.getBoundingClientRect().width;
    if (w < 80) { narrow++; minW = Math.min(minW, w); }
    const hidden = t.scrollWidth - t.clientWidth;
    if (hidden > 1) { clipped++; maxHidden = Math.max(maxHidden, hidden); }
  }
  if (narrow) {
    flags.push({ sev: 'alto', kind: 'title-collapsed',
      detail: `${narrow}/${rows.length} títulos por debajo de 80px (el peor, ${px(minW)}px)` });
  }
  if (clipped) {
    flags.push({ sev: 'medio', kind: 'title-clipped',
      detail: `${clipped}/${rows.length} títulos recortados (hasta ${px(maxHidden)}px de texto oculto)` });
  }

  // 5 · Chip de calidad desbordando la fila — el otro bug de ayer (se encimaba con la duración).
  let over = 0, maxOver = 0;
  for (const row of rows) {
    const chip = row.querySelector('.quality-chip.chip-inline');
    if (!chip || !chip.getClientRects().length) continue;
    const d = chip.getBoundingClientRect().right - row.getBoundingClientRect().right;
    if (d > 1) { over++; maxOver = Math.max(maxOver, d); }
  }
  if (over) {
    flags.push({ sev: 'alto', kind: 'chip-overflow',
      detail: `${over} chips de calidad se salen de su fila (hasta ${px(maxOver)}px)` });
  }

  // Contexto del régimen: display:block en .track-table = MODO LISTA; table = modo tabla.
  const table = document.querySelector('.track-table');
  return {
    flags,
    ctx: {
      viewport: window.innerWidth,
      queueOpen: !!document.querySelector('.layout--queue'),
      layout: table ? (getComputedStyle(table).display === 'block' ? 'lista' : 'tabla') : '—',
      rows: document.querySelectorAll('.track-row').length,
    },
  };
}

// ── Preflight: ¿del otro lado hay SonoraRev? ─────────────────────────────────
// Sin esto, apuntarle a la app equivocada no da NINGÚN error: se navega, no hay .track-row,
// y el script culpa a la sesión o a los servidores. Se verifica el <title> del index.html.
{
  let html;
  try {
    html = await fetch(BASE, { signal: AbortSignal.timeout(5_000) }).then((r) => r.text());
  } catch (e) {
    console.error(`[snap] no hay nada escuchando en ${BASE} (${e.message}).`);
    console.error('       Levantá Vite en music-client y pasá SNAP_BASE si no quedó en 5173.');
    process.exit(1);
  }
  if (!/<title>SonoraRev<\/title>/i.test(html)) {
    const otra = html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? '(sin título)';
    console.error(`[snap] ${BASE} NO es SonoraRev — sirve "${otra}".`);
    console.error('       Vite se corre de puerto si 5173 está ocupado: mirá su log y pasá SNAP_BASE.');
    process.exit(1);
  }
}

// El login va DESPUÉS del preflight: si BASE apunta a otra app, el mensaje útil es "esto no
// es SonoraRev", no un 404 del endpoint de login.
const TOKEN = await getToken();

// ── Corrida ──────────────────────────────────────────────────────────────────
mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const report = [];
let failed = false;

for (const spec of SHOTS_SPEC) {
  const ctx = await browser.newContext({
    viewport: { width: spec.width, height: spec.height },
    deviceScaleFactor: 2,
    isMobile: spec.mobile,
    hasTouch: spec.mobile,
  });

  // Siembra la sesión ANTES de que la app monte: AuthContext lee localStorage en el
  // initializer de estado, así que no llega a mostrar el login.
  await ctx.addInitScript((t) => {
    localStorage.setItem('token', t);
    localStorage.setItem('loginMethod', 'password');
  }, TOKEN);

  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()} — ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.url().includes('/api/') && !r.ok()) problems.push(`HTTP ${r.status()} ${r.url()}`); });

  await page.goto(BASE + PATH, { waitUntil: 'domcontentloaded' });

  // Carrera entre los dos desenlaces posibles: contenido real o pantalla de login. Chequear
  // el login "de una" no sirve — a domcontentloaded React todavía no montó y el form no
  // existe, así que una sesión inválida degeneraba en un timeout opaco de 20s.
  const outcome = await Promise.race([
    page.locator('.track-table .track-row').first().waitFor({ state: 'visible', timeout: 20_000 }).then(() => 'content'),
    page.locator('form input[type="password"]').first().waitFor({ state: 'visible', timeout: 20_000 }).then(() => 'login'),
  ]).catch(() => 'timeout');

  if (outcome !== 'content') {
    console.error(`[snap] ${spec.name}: ${outcome === 'login'
      ? 'se renderizó el LOGIN → la sesión sembrada no fue aceptada.'
      : 'ni contenido ni login en 20s → ¿Vite (:5173) y backend (:3000) arriba?'}`);
    for (const p of problems.slice(0, 5)) console.error('  - ' + p);
    await page.screenshot({ path: join(SHOTS, `${SLUG}-${spec.name}-FALLO.png`) });
    await ctx.close();
    failed = true;
    continue;
  }

  // Abrir la cola: clic en el botón real + ASERCIÓN de que el estado llegó al DOM. Sólo el
  // clic no alcanza como prueba — lo que gobierna el reflow es la clase .layout--queue
  // (Layout.jsx:217), así que se verifica esa, no el clic.
  if (spec.queue) {
    await page.locator('.player-actions .queue-btn').click();
    try {
      await page.locator('.layout--queue').waitFor({ state: 'attached', timeout: 5_000 });
      await page.locator('.queue-panel').waitFor({ state: 'visible', timeout: 5_000 });
    } catch {
      console.error('[snap] 960: se clickeó Cola pero .layout--queue nunca apareció → la toma no vale.');
      await ctx.close();
      failed = true;
      continue;
    }
    await page.waitForTimeout(450);   // que termine la transición de la columna
  }

  // Nombre FIJO por toma → una corrida nueva reemplaza sólo su propia captura y deja intactas
  // las demás. Nunca se vacía la carpeta: si una toma falla, la buena anterior sobrevive.
  const out = join(SHOTS, `${SLUG}-${spec.name}.png`);
  await page.screenshot({ path: out });

  // Esta toma salió bien → el -FALLO viejo de ESTA misma toma ya no describe nada y sólo
  // confunde al abrir la carpeta. Borrado por nombre exacto, nunca por patrón.
  const stale = join(SHOTS, `${SLUG}-${spec.name}-FALLO.png`);
  if (existsSync(stale)) unlinkSync(stale);

  const audit = await page.evaluate(auditInPage);
  report.push({ shot: spec.name, file: out, ...audit, problems });
  await ctx.close();
}

await browser.close();

// ── Salida ───────────────────────────────────────────────────────────────────
for (const r of report) {
  const { viewport, queueOpen, layout, rows } = r.ctx;
  console.log(`\n── ${r.shot} · ${viewport}px · cola ${queueOpen ? 'ABIERTA' : 'cerrada'} · modo ${layout} · ${rows} filas`);
  if (!r.flags.length) console.log('   ✓ sin flags de layout');
  for (const f of r.flags) console.log(`   ${f.sev === 'alto' ? '🔴' : '🟡'} ${f.kind}: ${f.detail}`);
  for (const p of r.problems.slice(0, 5)) console.log(`   ⚠ ${p}`);
  console.log(`   → ${r.file}`);
}

// Sólo se pisa el reporte si esta corrida midió ALGO. Antes se escribía siempre, así que una
// corrida fallida dejaba report.json en [] y se llevaba puestas las mediciones buenas de la
// corrida anterior — el mismo problema que las capturas, pero con los datos.
if (report.length) {
  writeFileSync(join(SHOTS, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\n[snap] ${report.length}/${SHOTS_SPEC.length} tomas · reporte → ${join(SHOTS, 'report.json')}`);
} else {
  console.log(`\n[snap] 0/${SHOTS_SPEC.length} tomas — no se toca report.json (se conserva el de la corrida anterior).`);
}
process.exit(failed ? 1 : 0);
