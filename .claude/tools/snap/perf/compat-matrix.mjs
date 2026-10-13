// compat-matrix.mjs — ARNÉS DE COMPATIBILIDAD: los mismos escenarios en varios motores y dispositivos
// emulados. Sale una línea por perfil: `compat-<perfil>: N/N`.
//
// PERFILES (compat/util.mjs): pixel7 (Chromium + Pixel 7, toque real por CDP) · iphone15 e ipad
// (WebKit + descriptor de iPhone 15 / iPad gen 7) · desktop-webkit (WebKit 1440×900) · firefox
// (opcional, sólo si se pide). Ningún navegador se lanza con --autoplay-policy: reproducir tiene
// que salir de un gesto.
// ESCENARIOS (compat/escenarios.mjs): a carga y pestañas · b inputs ≥16 px · c <video> · d safe
// areas · e pulsación larga · f menú de Años · g enlace de artista en Videos · h «Reproducir año»
// con la biblioteca fría.
//
// ⚠️ ES EMULACIÓN. Chromium con un descriptor no es Chrome de Android y el WebKit de Playwright en
// Windows no es Safari de iOS. Lo que este arnés NO puede decir (sesión de audio de iOS, callout,
// barra dinámica, safe-areas físicas, el dedo) está en .claude/skills/compat-lab/SKILL.md, con los
// pasos para probarlo en un teléfono de verdad.
//
// El escenario (g) necesita videos en carpetas con nombre de artista real: con VIDEO_DIR (la carpeta
// de FIXTURES que usa el backend de la prueba) suma dos videos cortos y los borra al terminar,
// también si se corta. Sin VIDEO_DIR el (g) no corre ni se cuenta, y se avisa. Nunca escribe en una
// carpeta que no sea de fixtures. No escribe en la base.
//
// Uso:
//   SNAP_BASE=http://localhost:4173 [VIDEO_DIR=<fixtures>] node compat-matrix.mjs [--perfil pixel7,iphone15] [--escenario e,f,g]
// Código de salida: 0 todo pasa · 1 algo falla · 2 no corrió.
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { FIXTURES, EXTRAS, crearExtras, borrarExtras, SinFfmpeg } from './video-fixtures.mjs';
import { PERFILES, POR_DEFECTO, herramientas, fold, sleep } from './compat/util.mjs';
import { ESCENARIOS } from './compat/escenarios.mjs';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const lista = (s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : null);
const perfiles = lista(arg('--perfil')) ?? POR_DEFECTO;
const soloEsc = lista(arg('--escenario'));
const noCorrio = (msg) => { console.error(`[compat] NO CORRIÓ: ${msg}`); process.exit(2); };
for (const n of perfiles) if (!PERFILES[n]) noCorrio(`perfil desconocido "${n}" (hay: ${Object.keys(PERFILES).join(', ')})`);
const escenarios = ESCENARIOS.filter((e) => !soloEsc || soloEsc.includes(e.id));
if (!escenarios.length) noCorrio(`ningún escenario con --escenario ${soloEsc} (hay: ${ESCENARIOS.map((e) => e.id).join(', ')})`);

await preflight();
const token = await getToken();
const pw = await loadPlaywright();
const H = { Authorization: `Bearer ${token}` };
const api = async (ruta) => (await fetch(BASE + ruta, { headers: H })).json();

// ── Lo que se sabe de la biblioteca de la prueba (una vez, para todos los perfiles) ──
const YEARS = await api('/api/browse/years');
const LIB = (await api('/api/tracks?limit=10000'));
const conAnio = LIB.filter((t) => t.year != null);
const idsDe = (y) => conAnio.filter((t) => t.year === y).map((t) => t.id);
const chicos = YEARS.filter((y) => y.track_count >= 2).sort((a, b) => a.track_count - b.track_count || a.year - b.year);
const datos = { pistas: LIB.length, A: chicos[0]?.year, B: chicos[1]?.year, idsDe, videos: (await api('/api/videos')).videos ?? [], extras: null };

// ── Los videos del escenario (g): dos carpetas, una con el nombre EXACTO de un artista de la
//    biblioteca y otra de nadie. Firma «Enlace »: lo que quede de una corrida cortada se borra al arrancar. ──
const PREFIJO = 'Enlace ';
const DIR = process.env.VIDEO_DIR ? resolve(process.env.VIDEO_DIR) : null;
let MIOS = null, puestos = false;
const quiereG = escenarios.some((e) => e.id === 'g');
if (quiereG && DIR && existsSync(DIR)) {
  const deFix = new Set([...FIXTURES, ...EXTRAS].map((f) => f.artista));
  const esMia = (n) => { try { const fs = readdirSync(join(DIR, n)); return fs.length > 0 && fs.every((f) => f.startsWith(PREFIJO)); } catch { return false; } };
  for (const n of readdirSync(DIR)) if (!deFix.has(n) && esMia(n)) rmSync(join(DIR, n), { recursive: true, force: true });
  const enDisco = readdirSync(DIR);
  if (!enDisco.length || enDisco.some((n) => !deFix.has(n))) noCorrio(`VIDEO_DIR no es una carpeta de fixtures (${enDisco.slice(0, 4).join(', ')}…): no escribo ahí`);
  const artistas = (await api('/api/browse/artists')).map((a) => a.artist);
  const A = artistas.find((a) => /^[A-Za-z]+( [A-Za-z]+)*$/.test(a) && a.length >= 4 && a !== 'Various Artists');
  if (A && !artistas.some((a) => fold(a) === fold('Artista Inexistente'))) {
    MIOS = [
      { artista: A, archivo: `${PREFIJO}Exacto (2020).mp4`, segundos: 2.5, faststart: true, portada: true },
      { artista: 'Artista Inexistente', archivo: `${PREFIJO}Nadie (2017).mp4`, segundos: 2.5, faststart: true, portada: true },
    ];
    datos.extras = { artista: A, tituloExacto: `${PREFIJO}Exacto` };
  }
}
const esperarIndice = async (n) => { for (let i = 0; i < 80; i++) { const v = (await api('/api/videos')).videos ?? []; if (v.length === n) return v; await sleep(250); } return null; };
const nBase = datos.videos.length;
async function limpiar() { if (!puestos) return; borrarExtras(DIR, MIOS); puestos = false; await esperarIndice(nBase).catch(() => null); }
process.on('exit', () => { if (puestos) { try { borrarExtras(DIR, MIOS); } catch { /* nada más que hacer */ } } });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => { limpiar().finally(() => process.exit(130)); });
process.on('uncaughtException', (e) => { console.error(`[compat] excepción no atrapada: ${e?.message}`); limpiar().finally(() => process.exit(1)); });
process.on('unhandledRejection', (e) => { console.error(`[compat] promesa rechazada sin atrapar: ${e?.message}`); limpiar().finally(() => process.exit(1)); });

const resumen = []; let algunaFalla = false;
try {
  if (MIOS) {
    try { crearExtras(DIR, MIOS); puestos = true; } catch (e) { if (e instanceof SinFfmpeg) { MIOS = null; datos.extras = null; console.error(`[compat] sin ffmpeg: el escenario g no corre (${e.message})`); } else throw e; }
    if (puestos && !(await esperarIndice(nBase + MIOS.length))) throw new Error('el backend no llegó a ver los videos del escenario g');
    if (puestos) datos.videos = (await api('/api/videos')).videos ?? [];
  }
  for (const nombre of perfiles) {
    const perfil = PERFILES[nombre];
    const R = {}; const ok = (k, v, extra = {}) => { R[k] = { ok: !!v, ...extra }; };
    const t0 = Date.now(); let version = null; const saltados = [];
    let browser = null, noMedibles = [];
    try {
      browser = await pw[perfil.motor].launch();
      version = browser.version();
      const h = herramientas({ nombre, perfil, browser, devices: pw.devices, token, BASE });
      noMedibles = h.noMedibles;
      for (const esc of escenarios) {
        if (esc.aplica && !esc.aplica(h, datos)) { saltados.push(esc.id); continue; }
        try { await esc.run(h, datos, ok); }
        catch (e) { ok(`${esc.id}_sin_excepciones`, false, { error: String(e.message).split('\n')[0].slice(0, 220) }); }
      }
    } catch (e) {
      ok('navegador_arranca', false, { error: String(e.message).split('\n')[0].slice(0, 220) });
    } finally { await browser?.close().catch(() => {}); }
    const fails = Object.entries(R).filter(([, v]) => !v.ok).map(([k]) => k);
    if (fails.length) algunaFalla = true;
    console.log(`\n════ ${nombre} · ${perfil.motor} ${version ?? '?'}${perfil.dispositivo ? ` · ${perfil.dispositivo}` : ''} · [${perfil.etiqueta}] · ${Math.round((Date.now() - t0) / 1000)} s ════`);
    console.log(JSON.stringify(R, null, 1));
    if (saltados.length) console.log(`no aplican a este perfil (no se cuentan): ${saltados.join(', ')}`);
    for (const n of noMedibles) console.log(`NO MEDIBLE en este perfil (no se cuenta): ${n.clave} — ${n.motivo}`);
    const linea = `compat-${nombre}: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`;
    console.log(linea + (fails.length ? `   · falla: ${fails.join(', ')}` : ''));
    resumen.push(linea + (fails.length ? `   · falla: ${fails.join(', ')}` : ''));
  }
} finally { await limpiar(); }

console.log('\n──── resumen ────');
console.log(`base: ${BASE} · escenarios: ${escenarios.map((e) => e.id).join(',')} · biblioteca: ${datos.pistas} pistas`);
if (quiereG && !datos.extras) console.log('SIN VIDEO_DIR de fixtures (o sin ffmpeg): el escenario g NO se corrió ni se cuenta.');
for (const l of resumen) console.log(l);
process.exit(algunaFalla ? 1 : 0);
