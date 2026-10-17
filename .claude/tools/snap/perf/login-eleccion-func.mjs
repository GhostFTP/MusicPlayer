// login-eleccion-func.mjs — matriz funcional del login web (1.37.0: elección Google / usuario).
// Por escenario: qué requests de auth salen al montar (/config, /cf, /login), en qué pantalla
// termina y si entró solo. El flujo de Cloudflare Access NO se puede reproducir en local (el
// backend valida la firma del JWT de CF), así que se MOCKEA con page.route:
//   GET  /api/auth/config → { sso }            (como en sonorarev.com si SSO=1)
//   POST /api/auth/cf     → 200 { token } real (el del login de session.mjs) o 401
//   /cdn-cgi/access/logout → 302 a '/'         (el edge corta la sesión de CF y vuelve)
// El 401 "a mitad de sesión" se provoca sembrando un JWT con firma inválida pero `exp` futuro:
// el cliente lo da por bueno y el primer request de datos recibe el 401 real del backend.
// Regla dura que vigila: con elección 'password', CERO requests a /api/auth/cf.
// Uso: SNAP_BASE=http://localhost:5180 node login-eleccion-func.mjs [--json salida.json] [--shots dir]
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const JSON_OUT = opt('--json');
const SHOTS = opt('--shots');

await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();

// JWT con firma basura y exp a 1 h: pasa getStoredToken() y el backend lo rechaza con 401.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const FAKE = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ id: 1, username: 'fake', exp: Math.floor(Date.now() / 1000) + 3600 })}.firma-invalida`;
const EXPIRED = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ id: 1, username: 'old', exp: 1000 })}.x`;

// seed: lo que había en localStorage antes de abrir · sso / cf: lo que contestan los mocks ·
// act: lo que hace "el usuario" después de cargar (sin act = sólo montar).
// expect = pantalla final esperada desde 1.37.0 (en main falla a propósito: es la foto del bug).
// noCf = el escenario no puede tocar /api/auth/cf (regla dura de 'password' y fallos de /config).
const SCENARIOS = [
  { id: 'sin-eleccion',        label: 'sso:true, sin elección',                         sso: true,  cf: 'ok',  seed: {}, expect: 'login [Google · usuario]', noCf: true },
  { id: 'sin-nada-pre-release', label: 'sso:true, sin loginChoice ni loginMethod ni token (token vencido antes de 1.37.0) → selector una vez, esperado', sso: true, cf: 'ok', seed: {}, expect: 'login [Google · usuario]', noCf: true },
  { id: 'google-sin-token',    label: 'sso:true, elección google, sin token',           sso: true,  cf: 'ok',  seed: { loginChoice: 'google' }, expect: 'app' },
  { id: 'google-cf-falla',     label: 'elección google, /cf responde 401',              sso: true,  cf: '401', seed: { loginChoice: 'google' }, expect: 'login [Google · otra cuenta]' },
  { id: 'password-sin-token',  label: 'sso:true, elección password, sin token',         sso: true,  cf: 'ok',  seed: { loginChoice: 'password' }, expect: 'login [form · otra cuenta]', noCf: true },
  { id: 'password-401',        label: 'elección password + 401 a mitad de sesión',      sso: true,  cf: 'ok',  seed: { loginChoice: 'password', loginMethod: 'password', token: FAKE }, expect: 'login [form · otra cuenta]', noCf: true },
  { id: 'google-401',          label: 'elección google + 401 a mitad de sesión',        sso: true,  cf: 'ok',  seed: { loginChoice: 'google', loginMethod: 'sso', token: FAKE }, expect: 'app' },
  { id: 'signout-google',      label: 'cerrar sesión (Ajustes) con google, y recargar', sso: true,  cf: 'ok',  seed: { loginChoice: 'google', loginMethod: 'sso', token }, act: 'signout', expect: 'login [Google · otra cuenta]', noCf: true },
  { id: 'signout-password',    label: 'cerrar sesión (Ajustes) con password, y recargar', sso: true, cf: 'ok', seed: { loginChoice: 'password', loginMethod: 'password', token }, act: 'signout', expect: 'login [form · otra cuenta]', noCf: true },
  { id: 'otra-cuenta',         label: '«Entrar con otra cuenta» (desde password)',      sso: true,  cf: 'ok',  seed: { loginChoice: 'password' }, act: 'otra-cuenta', expect: 'login [Google · usuario]', noCf: true },
  { id: 'otra-cuenta-google',  label: '«Entrar con otra cuenta» (desde google pausado) → logout de CF → selector', sso: true, cf: 'ok', seed: { loginChoice: 'google', loginPaused: '1' }, act: 'otra-cuenta', expect: 'login [Google · usuario]', noCf: true },
  { id: 'elegir-password',     label: 'sin elección → elige «usuario y contraseña» → entra con el form → recarga', sso: true, cf: 'ok', seed: {}, act: 'elegir-password', expect: 'app', noCf: true },
  { id: 'elegir-google',       label: 'sin elección → elige «Google»',                  sso: true,  cf: 'ok',  seed: {}, act: 'elegir-google', expect: 'app' },
  { id: 'local',               label: 'sso:false (local)',                              sso: false, cf: '401', seed: {}, expect: 'login [form]', noCf: true },
  { id: 'config-500',          label: '/config responde 500',                           sso: 500,   cf: 'ok',  seed: {}, expect: 'login [form]', noCf: true },
  { id: 'config-cuelga',       label: '/config no responde (el cliente corta a los 10 s)', sso: 'hang', cf: 'ok', seed: {}, expect: 'login [form]', noCf: true, wait: 11_500 },
  { id: 'migra-sso',           label: 'migración: token vivo + loginMethod sso, sin loginChoice', sso: true, cf: 'ok', seed: { loginMethod: 'sso', token }, expect: 'app' },
  { id: 'migra-password-vencido', label: 'migración: token vencido + loginMethod password, sin loginChoice', sso: true, cf: 'ok', seed: { loginMethod: 'password', token: EXPIRED }, expect: 'login [form · otra cuenta]', noCf: true },
];

const browser = await chromium.launch();
const rows = [];

async function screenOf(page) {
  return page.evaluate(() => {
    const t = (sel) => !!document.querySelector(sel);
    const txt = document.body.innerText;
    if (t('.layout')) return { screen: 'app' };
    if (!t('.login-page')) return { screen: document.body.children.length ? 'otra' : 'vacía' };
    return {
      screen: 'login',
      form: t('.login-page input[type=password]'),
      google: [...document.querySelectorAll('.login-page button')].some((b) => /Google/.test(b.textContent)),
      usuario: [...document.querySelectorAll('.login-page button')].some((b) => /usuario y contraseña/i.test(b.textContent)),
      otra: /otra cuenta/i.test(txt),
      error: document.querySelector('.login-error')?.textContent ?? null,
    };
  });
}
const describe = (s) => s.screen !== 'login' ? s.screen
  : `login [${[s.google && 'Google', s.usuario && 'usuario', s.form && 'form', s.otra && 'otra cuenta'].filter(Boolean).join(' · ') || 'vacía'}]`;

for (const sc of SCENARIOS) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // Sembrar UNA sola vez (addInitScript corre en cada navegación: sin la marca, recargar
  // re-sembraría y taparía justo lo que se quiere ver tras el reload).
  await ctx.addInitScript((seed) => {
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    localStorage.clear();
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  }, sc.seed);

  const reqs = [];
  const notes = [];
  let phase = 'montaje';
  await ctx.route('**/api/auth/config', (r) => sc.sso === 'hang' ? undefined   // nunca contesta
    : sc.sso === 500 ? r.fulfill({ status: 500, json: { error: 'boom' } })
    : r.fulfill({ json: { sso: sc.sso } }));
  await ctx.route('**/api/auth/cf', (r) => sc.cf === 'ok'
    ? r.fulfill({ json: { token } })
    : r.fulfill({ status: 401, json: { error: 'Sin identidad de Cloudflare Access' } }));
  await ctx.route('**/cdn-cgi/access/logout', (r) => r.fulfill({ status: 302, headers: { location: `${BASE}/` } }));
  ctx.on('request', (q) => {
    const p = new URL(q.url()).pathname;
    if (p.startsWith('/api/auth/') || p.startsWith('/cdn-cgi/')) reqs.push(`${phase}:${p.replace('/api/auth/', '')}`);
  });

  const page = await ctx.newPage();
  const settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(800); };
  const path = sc.act === 'signout' ? '/settings' : '/';
  await page.goto(BASE + path);
  if (sc.wait) {
    await page.waitForTimeout(1000);
    notes.push(`a 1 s: ${describe(await screenOf(page))}`);   // lo que se ve mientras /config no contesta
    await page.waitForTimeout(sc.wait - 1000);
  } else await settle();
  const mount = await screenOf(page);
  let after = null;

  try {
    if (sc.act === 'signout') {
      phase = 'salir';
      await page.click('.settings-logout', { timeout: 3000 });
      await settle();
      phase = 'recarga';
      await page.reload();
      await settle();
      after = await screenOf(page);
    } else if (sc.act === 'otra-cuenta') {
      phase = 'otra';
      const b = page.getByText(/otra cuenta/i).first();
      if (await b.count()) { await b.click(); await settle(); after = await screenOf(page); }
      else notes.push('no existe «Entrar con otra cuenta»');
    } else if (sc.act === 'elegir-password' || sc.act === 'elegir-google') {
      phase = 'elegir';
      const re = sc.act === 'elegir-password' ? /usuario y contraseña/i : /Entrar con Google/i;
      const b = page.getByRole('button', { name: re }).first();
      if (await b.count()) {
        await b.click(); await settle();
        if (sc.act === 'elegir-password') {
          const env = await import('node:fs').then((fs) => fs.readFileSync(new URL('../.env', import.meta.url), 'utf8'));
          const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1].trim().replace(/^["']|["']$/g, '');
          phase = 'form';
          await page.fill('.login-page input:not([type=password])', get('SNAP_USER'));
          await page.fill('.login-page input[type=password]', get('SNAP_PASS'));
          await page.click('.login-page button.btn-primary');
          await settle();
          phase = 'recarga';
          await page.reload(); await settle();
        }
        after = await screenOf(page);
      } else notes.push('no hay botón de elección');
    }
  } catch (e) { notes.push(`acción falló: ${e.message.split('\n')[0]}`); }

  const ls = await page.evaluate(() => ({ choice: localStorage.getItem('loginChoice'), method: localStorage.getItem('loginMethod'), paused: localStorage.getItem('loginPaused') }));
  if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, `${sc.id}.png`) }); }
  const final = after ?? mount;
  const cfCalls = reqs.filter((r) => r.endsWith(':cf')).length;
  if (final.error) notes.push(`error: «${final.error}»`);
  rows.push({
    ok: describe(final) === sc.expect && !(sc.noCf && cfCalls),
    expect: sc.expect,
    id: sc.id, label: sc.label, reqs,
    montaje: describe(mount), final: describe(final),
    entraSolo: mount.screen === 'app' && !sc.seed.token ? 'sí' : (final.screen === 'app' && !sc.act ? 'sí (ya tenía token)' : 'no'),
    cfCalls, ls, notes,
    violaRegla: !!sc.noCf && cfCalls > 0,
  });
  await ctx.close();
}
await browser.close();

console.log('\n| | Escenario | Requests de auth (fase:endpoint) | Al montar | Pantalla final | ¿Entra solo? | /cf | localStorage después | Notas |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.ok ? '✓' : '✗'} | ${r.label} | ${r.reqs.join(', ') || '—'} | ${r.montaje} | ${r.final}${r.ok ? '' : ` (esperado: ${r.expect})`} | ${r.entraSolo} | ${r.cfCalls}${r.violaRegla ? ' ⚠️' : ''} | choice=${r.ls.choice ?? '∅'} method=${r.ls.method ?? '∅'}${r.ls.paused ? ' paused' : ''} | ${r.notes.join('; ')} |`);
}
const viol = rows.filter((r) => r.violaRegla);
console.log(viol.length ? `\n⚠️ REGLA DURA ROTA (/cf donde no debe): ${viol.map((r) => r.id).join(', ')}` : '\n✓ regla dura: con password (y con /config caído), 0 requests a /api/auth/cf');
const okN = rows.filter((r) => r.ok).length;
console.log(`login-eleccion: ${okN}/${rows.length}`);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(rows, null, 2));
process.exitCode = viol.length || okN !== rows.length ? 1 : 0;
