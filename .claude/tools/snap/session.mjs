// session.mjs — lo que TODA captura necesita antes de abrir el navegador: apuntarle al Vite
// correcto y tener una sesión válida.
//
// Vive aparte desde que hay más de un script de capturas (snap.mjs = los tres regímenes de
// ancho · snap-ctx.mjs = las variantes del menú contextual): la lógica de login es UNA, y
// duplicarla era garantía de que una de las dos copias envejeciera. Salió tal cual estaba en
// snap.mjs — no cambia de comportamiento, sólo de archivo.
//
// Tooling LOCAL: no lo importa nadie de la app, no entra al bundle de Vite y no lo copia el
// Dockerfile (sólo copia music-client/ y music-server/; .dockerignore excluye .claude).

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// OJO con el puerto: Vite NO usa strictPort, así que si 5173 está ocupado por OTRO proyecto
// se corre solo al 5174 y lo dice en su log. Pasó de verdad: 5173 lo tenía otra app y las
// tres tomas salieron con SU 404, sin un solo error de red. De ahí el preflight de abajo.
export const BASE = process.env.SNAP_BASE ?? 'http://localhost:5173';

// Credenciales desde .claude/tools/snap/.env (gitignoreado por la regla `.env` de la raíz),
// o por variables de entorno.
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

// Login normal por API: el mismo POST /api/auth/login que haría el formulario. No lee el secreto
// de firma ni fabrica tokens; el JWT se siembra después en localStorage.
export async function getToken() {
  const env = readDotEnv();

  // Un JWT ya emitido gana sobre el login: es el atajo cuando la cuenta con la que hay sesión
  // no es la de SNAP_USER. Se acepta tanto por variable de entorno como desde el .env.
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

// ¿Del otro lado hay SonoraRev? Sin esto, apuntarle a la app equivocada no da NINGÚN error: se
// navega, no hay contenido, y el script culpa a la sesión o a los servidores.
export async function preflight() {
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

// Auto-reinstalación entre sesiones: el entorno de Claude Code se resetea y node_modules/ está
// gitignoreado. Los binarios del navegador viven en %LOCALAPPDATA%\ms-playwright, FUERA del repo,
// así que sobreviven al reset: acá sólo hay que rehacer 2 paquetes (~2s).
export async function loadPlaywright() {
  const { execSync } = await import('node:child_process');
  if (!existsSync(join(HERE, 'node_modules', 'playwright'))) {
    console.log('[snap] falta playwright → npm install…');
    execSync('npm install', { cwd: HERE, stdio: 'inherit' });
  }
  return import('playwright');
}
