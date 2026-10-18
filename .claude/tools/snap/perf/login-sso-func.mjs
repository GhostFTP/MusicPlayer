// login-sso-func.mjs — matriz funcional de «Entrar con Google» como navegación a /sso (1.38.0).
// En local no hay Cloudflare Access, así que se SIMULA en dos capas:
//   · un SERVIDOR DE PRUEBA real (http, 127.0.0.1, puerto libre = OTRO origen que la app) hace de
//     barrera: /cdn-cgi/access/login (a donde Access manda un fetch sin sesión) y /google (la vuelta
//     de Google, que deja la sesión de Access "viva" y redirige a /sso).
//   · page.route sobre la app: /api/auth/config, /api/auth/cf (200 con token, 302 a la barrera si no
//     hay sesión de Access, 401 sin identidad en local, 409 conflicto), la navegación a /sso (302 a
//     /google cuando Access cubre /sso y no hay sesión) y el resto de /api (sin backend: [] o 401).
// Modos de Access: 'site' = todo el dominio con sesión viva (como hoy) · 'routes' = sólo /sso y
// /api/auth/cf, sin sesión hasta pasar por /sso · 'none' = local, sin Cloudflare.
// Reglas duras (son casos de la matriz): con elección 'password', 0 requests a /api/auth/cf y 0
// navegaciones a /sso (montaje, 401, logout); como mucho UNA navegación a /sso por intento.
// Lo que NO mide: qué responde de verdad Cloudflare (se asume 302 a su login), la cookie
// CF_Authorization ni /cdn-cgi/access/logout reales.
// Uso: SNAP_BASE=http://localhost:4173 node login-sso-func.mjs [--json salida.json]
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { loadPlaywright, BASE } from '../session.mjs';

const argv = process.argv.slice(2);
const JSON_OUT = (() => { const i = argv.indexOf('--json'); return i >= 0 ? argv[i + 1] : null; })();
const { chromium } = await loadPlaywright();

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (id, exp = Math.floor(Date.now() / 1000) + 3600) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ id, username: `u${id}`, exp })}.firma`;
const OLD = jwt(1), NEW = jwt(2), EXPIRED = jwt(3, 1000);

// ── servidor de prueba: la barrera de Access y Google, en otro origen ──
let st;   // estado del escenario en curso (lo comparten la barrera y los mocks)
const gate = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  st.gate++;
  if (u.pathname === '/google') {
    st.passedGate = true;
    if (st.google !== 'fail') st.cfAlive = true;
    res.writeHead(302, { location: `${BASE}/sso` }).end();
    return;
  }
  // /cdn-cgi/access/login: página HTML sin CORS (un fetch no la puede leer, como la real).
  res.writeHead(200, { 'content-type': 'text/html' }).end('<h1>Cloudflare Access</h1>');
});
await new Promise((r) => gate.listen(0, '127.0.0.1', r));
const GATE = `http://127.0.0.1:${gate.address().port}`;

const S = [
  // id, Access, semilla, acción → esperado { final, url, cf, sso, err }
  { id: 'A1', label: 'sin elección → «Entrar con Google» · Access en todo el sitio', access: 'site', act: 'google', exp: { final: 'APP', url: '/', cf: 1, sso: 1 } },
  { id: 'A2', label: 'sin elección → «Entrar con Google» · Access en 2 rutas', access: 'routes', act: 'google', exp: { final: 'APP', url: '/', cf: 1, sso: 1 } },
  { id: 'A3', label: 'sin elección → Google desde un deep link (/albums) · 2 rutas', access: 'routes', path: '/albums', act: 'google', exp: { final: 'APP', url: '/albums', cf: 1, sso: 1 } },
  { id: 'B1', label: 'google, sin token, Access viva (todo el sitio): entra SIN navegar', access: 'site', ls: { loginChoice: 'google' }, exp: { final: 'APP', url: '/', cf: 1, sso: 0 } },
  { id: 'B2', label: 'google, sin token, Access en 2 rutas: montaje → /sso → app', access: 'routes', ls: { loginChoice: 'google' }, exp: { final: 'APP', url: '/', cf: 2, sso: 1 } },
  { id: 'B3', label: 'google en pausa → «Continuar con Google» · 2 rutas', access: 'routes', ls: { loginChoice: 'google', loginPaused: '1' }, act: 'google', exp: { final: 'APP', url: '/', cf: 1, sso: 1 } },
  { id: 'C1', label: 'google, 401 a mitad, Access viva: reauth en sitio', access: 'site', mid401: true, path: '/albums', ls: { loginChoice: 'google', loginMethod: 'sso', token: OLD }, exp: { final: 'APP', url: '/albums', cf: 1, sso: 0 } },
  { id: 'C2', label: 'google, 401 a mitad, Access vencida: → /sso → vuelve a /albums', access: 'routes', mid401: true, path: '/albums', ls: { loginChoice: 'google', loginMethod: 'sso', token: OLD }, exp: { final: 'APP', url: '/albums', cf: 2, sso: 1 } },
  { id: 'C3', label: 'google, 401 a mitad, Access vencida, ssoFailed ya marcado: no navega', access: 'routes', mid401: true, path: '/albums', ss: { ssoFailed: '1' }, ls: { loginChoice: 'google', loginMethod: 'sso', token: OLD }, exp: { final: 'LOGIN', url: '/albums', cf: 1, sso: 0, err: true } },
  { id: 'D1', label: 'password, 401 a mitad (Access viva)', access: 'site', mid401: true, path: '/albums', ls: { loginChoice: 'password', loginMethod: 'password', token: OLD }, exp: { final: 'LOGIN', url: '/albums', cf: 0, sso: 0 }, pw: true },
  { id: 'D2', label: 'password, 401 a mitad (2 rutas)', access: 'routes', mid401: true, path: '/albums', ls: { loginChoice: 'password', loginMethod: 'password', token: OLD }, exp: { final: 'LOGIN', url: '/albums', cf: 0, sso: 0 }, pw: true },
  { id: 'D3', label: 'password, sin token, al montar', access: 'routes', ls: { loginChoice: 'password' }, exp: { final: 'LOGIN', url: '/', cf: 0, sso: 0 }, pw: true },
  { id: 'D4', label: 'password, token vencido en un deep link', access: 'routes', path: '/albums', ls: { loginChoice: 'password', loginMethod: 'password', token: EXPIRED }, exp: { final: 'LOGIN', url: '/albums', cf: 0, sso: 0 }, pw: true },
  { id: 'D5', label: 'password, escribe /sso a mano: sale a / sin /cf', access: 'site', path: '/sso', ls: { loginChoice: 'password' }, exp: { final: 'LOGIN', url: '/', cf: 0, sso: 0 }, pw: true },
  { id: 'D6', label: 'password, cerrar sesión (Ajustes) y recargar', access: 'routes', path: '/settings', act: 'signout', ls: { loginChoice: 'password', loginMethod: 'password', token: NEW }, exp: { final: 'LOGIN', url: '/settings', cf: 0, sso: 0 }, pw: true },
  { id: 'E1', label: '/sso vuelve sin token: Login con error, sin reintentar', access: 'routes', google: 'fail', act: 'google', exp: { final: 'LOGIN', url: '/', cf: 1, sso: 1, err: true } },
  { id: 'E2', label: '/sso vuelve sin token + F5: no vuelve a navegar', access: 'routes', google: 'fail', act: 'google', reload: true, exp: { final: 'LOGIN', url: '/', cf: 2, sso: 1, err: true } },
  { id: 'E3', label: 'google, 401 a mitad, /sso vuelve sin token: una sola vuelta', access: 'routes', google: 'fail', mid401: true, path: '/albums', ls: { loginChoice: 'google', loginMethod: 'sso', token: OLD }, exp: { final: 'LOGIN', url: '/albums', cf: 2, sso: 1, err: true } },
  { id: 'E4', label: '/sso con /cf 409 (conflicto de cuenta): mensaje del servidor', access: 'site', cf: 409, act: 'google', exp: { final: 'LOGIN', url: '/', cf: 1, sso: 1, err: true } },
  { id: 'E5', label: 'ssoReturn ajeno ("//evil.test/x"): vuelve a /', access: 'site', path: '/sso', ss: { ssoReturn: '//evil.test/x' }, ls: { loginChoice: 'google' }, exp: { final: 'APP', url: '/', cf: 1, sso: 0 } },
  { id: 'F1', label: 'sso:false local, sin elección', access: 'none', exp: { final: 'LOGIN', url: '/', cf: 0, sso: 0 } },
  { id: 'F2', label: 'sso:false local, elección google vieja: 401 propio, no navega ni da error', access: 'none', ls: { loginChoice: 'google' }, exp: { final: 'LOGIN', url: '/', cf: 1, sso: 0, err: false } },
  { id: 'G1', label: 'google en pausa (cerró sesión): no entra solo', access: 'routes', ls: { loginChoice: 'google', loginPaused: '1' }, exp: { final: 'LOGIN', url: '/', cf: 0, sso: 0 } },
  { id: 'H1', label: 'token vivo (google), deep link /albums', access: 'routes', path: '/albums', ls: { loginChoice: 'google', loginMethod: 'sso', token: NEW }, exp: { final: 'APP', url: '/albums', cf: 0, sso: 0 } },
];

async function run(sc) {
  st = { cfAlive: sc.access === 'site', passedGate: false, google: sc.google, cf: 0, sso: 0, gate: 0 };
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(({ ls, ss }) => {
    if (sessionStorage.getItem('__seeded')) return;   // sólo la primera carga: el reload no re-siembra
    sessionStorage.setItem('__seeded', '1');
    localStorage.clear();
    for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v);
    for (const [k, v] of Object.entries(ss)) sessionStorage.setItem(k, v);
  }, { ls: sc.ls ?? {}, ss: sc.ss ?? {} });

  const page = await ctx.newPage();
  let first = true;
  page.on('request', (r) => {
    if (!r.isNavigationRequest() || r.frame() !== page.mainFrame() || r.redirectedFrom()) return;
    const u = new URL(r.url());
    if (first) { first = false; return; }                  // la carga que hace el test no cuenta
    if (u.origin === new URL(BASE).origin && u.pathname === '/sso') st.sso++;
  });

  await ctx.route(`${BASE}/sso`, (route) => {
    const req = route.request();
    if (req.isNavigationRequest() && sc.access === 'routes' && !st.cfAlive && !st.passedGate) {
      return route.fulfill({ status: 302, headers: { location: `${GATE}/google` } });
    }
    return route.continue();
  });
  await ctx.route(`${BASE}/api/**`, (route) => {
    const u = new URL(route.request().url());
    const auth = route.request().headers().authorization ?? '';
    if (u.pathname === '/api/auth/config') return route.fulfill({ json: { sso: sc.access !== 'none' } });
    if (u.pathname === '/api/auth/cf') {
      st.cf++;
      if (sc.access === 'none') return route.fulfill({ status: 401, json: { error: 'No Cloudflare identity' } });
      if (sc.cf === 409) return route.fulfill({ status: 409, json: { error: 'Esa cuenta de Google choca con otra: avisa a un admin.' } });
      if (st.cfAlive) return route.fulfill({ json: { token: NEW } });
      return route.fulfill({ status: 302, headers: { location: `${GATE}/cdn-cgi/access/login/sonorarev.com` } });
    }
    if (u.pathname.startsWith('/api/auth/')) return route.fulfill({ status: 404, json: {} });
    if (sc.mid401 && auth.includes(OLD)) return route.fulfill({ status: 401, json: { error: 'Token inválido' } });
    return route.fulfill({ json: [] });
  });
  await ctx.route(`${BASE}/stream/**`, (r) => r.fulfill({ status: 404, body: '' }));
  await ctx.route('**/cdn-cgi/access/logout', (r) => r.fulfill({ status: 302, headers: { location: `${BASE}/` } }));

  const settle = async (ms = 1200) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(ms); };
  const notes = [];
  await page.goto(BASE + (sc.path ?? '/'));
  await settle();
  try {
    if (sc.act === 'google') {
      const b = page.locator('.login-google');
      if (await b.count()) { await b.click(); await settle(2000); } else notes.push('sin botón Google');
    } else if (sc.act === 'signout') {
      await page.click('.settings-logout', { timeout: 3000 }); await settle();
      await page.reload(); await settle();
    }
    if (sc.reload) { await page.reload(); await settle(2000); }
  } catch (e) { notes.push(`acción falló: ${e.message.split('\n')[0]}`); }

  const got = await page.evaluate(() => ({
    final: document.querySelector('.layout') ? 'APP' : document.querySelector('.login-page') ? 'LOGIN' : 'OTRA',
    url: location.pathname,
    err: document.querySelector('.login-error')?.textContent ?? '',
    sub: document.querySelector('.login-sub')?.textContent ?? '',
    failed: sessionStorage.getItem('ssoFailed'),
    keys: { choice: localStorage.getItem('loginChoice'), method: localStorage.getItem('loginMethod'), paused: localStorage.getItem('loginPaused') },
  }));
  await browser.close();
  const e = sc.exp;
  const checks = [
    got.final === e.final, got.url === e.url, st.cf === e.cf, st.sso === e.sso,
    e.err === undefined || !!got.err === e.err,
  ];
  const violaRegla = !!sc.pw && (st.cf > 0 || st.sso > 0);
  return { ...sc, got, cf: st.cf, sso: st.sso, gate: st.gate, notes, violaRegla, ok: checks.every(Boolean) && !violaRegla };
}

const rows = [];
for (const sc of S) {
  try { rows.push(await run(sc)); }
  catch (err) { rows.push({ ...sc, ok: false, got: { final: 'ERROR' }, notes: [err.message.split('\n')[0]] }); }
}
gate.close();

console.log('\n| | Escenario | Final | URL | /cf | nav /sso | barrera | Mensaje | ssoFailed | Notas |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const e = r.exp, g = r.got;
  const diff = r.ok ? '' : ` (esperado: ${e.final} ${e.url} cf=${e.cf} sso=${e.sso}${e.err !== undefined ? ` err=${e.err}` : ''})`;
  console.log(`| ${r.ok ? '✓' : '✗'} | ${r.id} ${r.label} | ${g.final} | ${g.url ?? ''} | ${r.cf ?? ''}${r.violaRegla ? ' ⚠️' : ''} | ${r.sso ?? ''}${r.violaRegla ? ' ⚠️' : ''} | ${r.gate ?? ''} | ${(g.err || g.sub || '').slice(0, 60)} | ${g.failed ?? '∅'} | ${r.notes.join('; ')}${diff} |`);
}
const viol = rows.filter((r) => r.violaRegla);
console.log(viol.length ? `\n⚠️ REGLA DURA ROTA (password tocó /cf o /sso): ${viol.map((r) => r.id).join(', ')}` : '\n✓ regla dura: con password, 0 requests a /api/auth/cf y 0 navegaciones a /sso');
const okN = rows.filter((r) => r.ok).length;
console.log(`login-sso-func: ${okN}/${rows.length}`);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(rows, null, 2));
process.exitCode = viol.length || okN !== rows.length ? 1 : 0;
