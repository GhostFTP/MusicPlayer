// video-grid-func.mjs — la GRILLA de la vista Videos (T30 · P1): una sola grilla para todos los videos,
// ordenada por artista A→Z y después por título, con tarjetas más grandes que las de un álbum.
// Corre contra un backend con VIDEO_DIR = los 3 fixtures (como lo arma regresion.mjs), pero la lista se
// intercepta en el navegador con una SINTÉTICA de 8 artistas con 1 video cada uno (el caso que dejaba
// una tarjeta chica por fila y el resto vacío). Los ids son los de los fixtures, así las portadas cargan.
//
// Mide a 390 (teléfono), 1440 y 1920: columnas, ancho de tarjeta, alto de la portada y % del ancho útil
// que usa la primera fila. Comprueba:
//   · una sola grilla, sin títulos de grupo, en el orden artista → título, con el artista en cada tarjeta;
//   · 390: una columna y portada de al menos 150px de alto; sin scroll horizontal;
//   · 1440 y 1920: la primera fila usa al menos el 90 % del ancho y la tarjeta es más ancha que la de
//     Álbumes (170px de mínimo);
//   · la grilla de Álbumes no cambió (mismo mínimo de 170px a 1440).
// Imprime la tabla (columnas · tarjeta · portada · % usado) para comparar antes/después.
// Uso: SNAP_BASE=http://localhost:4173 [SHOTS=1] node video-grid-func.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'shots', 'sub3', process.env.OUT ?? 'video-grid');
const SHOTS = !!process.env.SHOTS;
if (SHOTS) mkdirSync(OUT, { recursive: true });

const R = {};
const ok = (k, v, extra) => { R[k] = extra === undefined ? v : { ok: v, ...extra }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const H = { Authorization: `Bearer ${token}` };
const VIDS = (await (await fetch(BASE + '/api/videos', { headers: H })).json()).videos ?? [];
// Desordenados a propósito (la vista ordena): artista → título.
const ARTISTAS = ['Treyarch Sound', 'NewJeans', 'Ávila', 'Daft Punk', 'Metallica', 'Kali Uchis', 'Nujabes', 'Bad Bunny'];
const SINTETICA = ARTISTAS.map((a, i) => ({ ...VIDS[i % VIDS.length], artist: a, title: `Video ${i + 1}` }));
const col = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
const ORDEN = [...SINTETICA].sort((a, b) => col.compare(a.artist, b.artist) || col.compare(a.title, b.title));

async function newPage(w, h, mobile) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript((t) => localStorage.setItem('token', t), token);
  await ctx.route('**/api/videos', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ videos: SINTETICA }) }));
  const p = await ctx.newPage();
  return { ctx, p };
}

const medir = (p) => p.evaluate(() => {
  const main = document.querySelector('.main-content');
  const mr = main.getBoundingClientRect(); const cs = getComputedStyle(main);
  const innerL = mr.left + parseFloat(cs.paddingLeft);
  const innerW = mr.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const card0 = document.querySelector('.video-card');
  const grid = card0.parentElement;
  const cards = [...grid.querySelectorAll('.video-card')];
  const top0 = cards[0].getBoundingClientRect().top;
  const fila1 = cards.filter((c) => Math.abs(c.getBoundingClientRect().top - top0) < 2);
  const right = Math.max(...fila1.map((c) => c.getBoundingClientRect().right));
  return {
    grillas: document.querySelectorAll('.video-grid').length,
    grupos: document.querySelectorAll('.video-group, .video-group-title').length,
    columnas: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
    tarjeta: Math.round(cards[0].getBoundingClientRect().width),
    portada: Math.round(card0.querySelector('.video-cover').getBoundingClientRect().height),
    usado: Math.round(((right - innerL) / innerW) * 100),
    util: Math.round(innerW),
    scrollX: document.documentElement.scrollWidth > innerWidth || main.scrollWidth > main.clientWidth,
    titulos: cards.map((c) => c.querySelector('.album-name')?.textContent),
    artistas: cards.map((c) => c.querySelector('.album-artist')?.textContent),
  };
});

const tabla = [];
for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false], [1920, 1080, false]]) {
  const { ctx, p } = await newPage(w, h, mobile);
  await p.goto(BASE + '/videos');
  await p.waitForSelector('.video-card');
  await sleep(600);
  const m = await medir(p);
  tabla.push(`${String(w).padEnd(5)} · ${String(m.columnas).padEnd(8)} · ${String(m.tarjeta + ' px').padEnd(7)} · ${String(m.portada + ' px').padEnd(7)} · ${m.usado} %`);
  ok(`${w}_una_grilla_sin_grupos`, m.grillas === 1 && m.grupos === 0, { grillas: m.grillas, grupos: m.grupos });
  ok(`${w}_orden_artista_titulo`, JSON.stringify(m.titulos) === JSON.stringify(ORDEN.map((x) => x.title))
    && JSON.stringify(m.artistas) === JSON.stringify(ORDEN.map((x) => x.artist)), { titulos: m.titulos, artistas: m.artistas });
  ok(`${w}_sin_scroll_horizontal`, !m.scrollX);
  if (w === 390) ok('390_una_columna_portada_grande', m.columnas === 1 && m.portada >= 150, m);
  else ok(`${w}_fila_llena_y_tarjeta_mas_ancha`, m.usado >= 90 && m.tarjeta > 200, m);
  if (SHOTS) await p.screenshot({ path: join(OUT, `videos-${w}.png`) });
  await ctx.close();
}

// Álbumes no cambió: mismo mínimo de 170px a 1440 (sin selector de vista tocado).
{
  const { ctx, p } = await newPage(1440, 900, false);
  await p.goto(BASE + '/albums');
  await p.waitForSelector('.album-grid .album-card');
  const g = await p.evaluate(() => {
    const grid = document.querySelector('.album-grid');
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').map(parseFloat);
    return { cls: grid.className, min: Math.min(...cols) };
  });
  ok('albumes_sin_cambios', g.cls === 'album-grid' && g.min >= 170 && g.min < 260, g);
  await ctx.close();
}

const fails = Object.entries(R).filter(([, v]) => v === false || (v && typeof v === 'object' && v.ok === false)).map(([k]) => k);
console.log(JSON.stringify(R, null, 1));
console.log('\nancho · columnas · tarjeta · portada · usado');
for (const l of tabla) console.log(l);
console.log(`\nvideo-grid-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
