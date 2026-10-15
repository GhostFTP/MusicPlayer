// gen-icons.mjs — genera TODOS los derivados del logo de la web a partir del ícono de la app.
//
//   node .claude/tools/brand/gen-icons.mjs <ruta/al/icon.png> [--out <carpeta>] [--favicon-b <carpeta>]
//
// --favicon-b escribe ADEMÁS la opción B del favicon (el ícono completo reducido a 16/32/48) en
// otra carpeta, para compararla en una hoja de contacto. Nunca va a public/: el favicon puesto
// sigue siendo la R (opción A) hasta que se elija.
//
// La fuente es el icon.png 1024×1024 de la app iOS (opaco, sin alfa). NO vive en este repo y
// la ruta NO se hardcodea: se pasa como argumento. Lo que se commitea son los derivados
// (music-client/public/icons/) y este script, para poder regenerarlos idénticos.
//
// Tres familias de derivados:
//   · La "R" sola, recortada del tornamesa y con fondo transparente: SOLO el favicon 16/32/48
//     (opción A, la puesta).
//   · El ícono completo RECORTADO a su propia forma (el "aparato" redondeado, sin el margen
//     negro del original y con fondo transparente afuera): el logo oficial de la sidebar /
//     login / encabezado móvil (logo-28/56/112.v3).
//   · El ícono completo, opaco y cuadrado: apple-touch-icon y los 192/512 del manifest, que es
//     donde conviene calcar el ícono de la app nativa (el sistema le pone su propia máscara).
//
// `sharp` se toma de music-server (ya es dependencia ahí): el cliente y este tooling no
// agregan dependencias. Tooling LOCAL: `.dockerignore` excluye `.claude`, no entra a la imagen.
import { createRequire } from 'node:module';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const sharp = createRequire(join(REPO, 'music-server', 'package.json'))('sharp');

const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const OUT = resolve(outIdx >= 0 ? argv[outIdx + 1] : join(REPO, 'music-client', 'public', 'icons'));
const bIdx = argv.indexOf('--favicon-b');
const OUT_B = bIdx >= 0 ? resolve(argv[bIdx + 1]) : null;
const SRC = argv.find((a, i) => !a.startsWith('--') && (outIdx < 0 || i !== outIdx + 1) && (bIdx < 0 || i !== bIdx + 1));
if (!SRC) {
  console.error('uso: node gen-icons.mjs <ruta/al/icon.png> [--out <carpeta>]');
  process.exit(2);
}

// Sufijo de versión de los nombres. express.static sirve /icons/* sin hash y con
// `Cache-Control: public, max-age=0` + ETag (revalida siempre), pero Cloudflare y la caché de
// favicons del navegador no siempre respetan eso: nombre nuevo = URL nueva = no hay caché que
// esquivar. Si el logo vuelve a cambiar, se sube a v3 acá y en index.html / manifest / JSX.
const V = 'v2';
// El logo cambió de la R sola al ícono completo en la corrección de 1.34.0: nombre nuevo (v3)
// para esos tres archivos; favicon / apple-touch / manifest no cambiaron y siguen en v2.
const V_LOGO = 'v3';

// ── Recorte del aparato (ícono completo) ───────────────────────────────────────────────
// Medido sobre el 1024²: el cuerpo redondeado va de x 19–1008 e y 22–1000, con esquinas de
// radio ≈170 px (la curva calza con un círculo de ese radio a 10, 45 y 100 px del borde). Afuera
// es negro puro. Se recorta un CUADRADO centrado en el cuerpo y se enmascara con un rectángulo
// redondeado de ese radio, metido INSET px hacia adentro para no arrastrar el negro del borde
// en el antialias. Fuera de la máscara: transparente.
const BODY = { x0: 19, y0: 22, x1: 1008, y1: 1000, r: 170 };
const INSET = 3;

// ── Recorte de la R ────────────────────────────────────────────────────────────────────
// Sobre el 1024²: la R es lo único AZUL dentro de esta caja (las barras del ecualizador y
// el pad azul quedan fuera). Se segmenta por color y se ensancha la máscara lo justo para
// llevarse el filete plateado que la rodea — así sale con fondo transparente y sin el
// brazo ni la aguja del tornamesa, que un recorte rectangular arrastraría.
const BOX = { x0: 270, y0: 290, x1: 750, y1: 830 };
const OUTLINE = 21;   // px desde el azul hasta el borde exterior del filete plateado
const FEATHER = 1.5;  // suavizado del borde de la máscara
const PAD = 0.04;     // aire alrededor de la R dentro del lienzo cuadrado

const BG = '#111111'; // el --bg del tema: fondo de los íconos opacos

async function cutR(src) {
  const { data, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  if (W !== 1024 || H !== 1024) throw new Error(`se esperaba 1024×1024 y llegó ${W}×${H}`);

  // Distancia (chamfer 3-4) de cada píxel al azul de la R.
  const INF = 1e9;
  const dist = new Float32Array(W * H).fill(INF);
  for (let y = BOX.y0; y < BOX.y1; y++) {
    for (let x = BOX.x0; x < BOX.x1; x++) {
      const i = (y * W + x) * 3;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (b > 110 && b - r > 60 && b - g > 15) dist[y * W + x] = 0;
    }
  }
  const relax = (p, q, w) => { if (dist[q] + w < dist[p]) dist[p] = dist[q] + w; };
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const p = y * W + x;
    relax(p, p - 1, 3); relax(p, p - W, 3); relax(p, p - W - 1, 4); relax(p, p - W + 1, 4);
  }
  for (let y = H - 2; y > 0; y--) for (let x = W - 2; x > 0; x--) {
    const p = y * W + x;
    relax(p, p + 1, 3); relax(p, p + W, 3); relax(p, p + W + 1, 4); relax(p, p + W - 1, 4);
  }

  const rgba = Buffer.alloc(W * H * 4);
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let p = 0; p < W * H; p++) {
    const d = dist[p] / 3;
    const a = Math.max(0, Math.min(1, (OUTLINE + FEATHER - d) / (2 * FEATHER)));
    rgba[p * 4] = data[p * 3]; rgba[p * 4 + 1] = data[p * 3 + 1]; rgba[p * 4 + 2] = data[p * 3 + 2];
    rgba[p * 4 + 3] = Math.round(a * 255);
    if (a > 0) {
      const x = p % W, y = (p / W) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  // Lienzo CUADRADO con la R centrada: los <img> llevan width == height.
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const side = Math.round(Math.max(w, h) * (1 + 2 * PAD));
  const left = Math.round((side - w) / 2), top = Math.round((side - h) / 2);
  const buf = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: x0, top: y0, width: w, height: h })
    .extend({ left, top, right: side - w - left, bottom: side - h - top, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();
  console.log(`R: caja ${x0},${y0} – ${x1},${y1} (${w}×${h}) → lienzo ${side}²`);
  return buf;
}

async function cutDevice(src) {
  const meta = await sharp(src).metadata();
  if (meta.width !== 1024 || meta.height !== 1024) throw new Error(`se esperaba 1024×1024 y llegó ${meta.width}×${meta.height}`);
  const w = BODY.x1 - BODY.x0 + 1, h = BODY.y1 - BODY.y0 + 1;
  const side = Math.max(w, h);
  const left = Math.round(BODY.x0 + w / 2 - side / 2), top = Math.round(BODY.y0 + h / 2 - side / 2);
  // Máscara en coordenadas del recorte: el cuerpo (menos INSET) con sus esquinas.
  const mx = BODY.x0 - left + INSET, my = BODY.y0 - top + INSET;
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}">` +
    `<rect x="${mx}" y="${my}" width="${w - 2 * INSET}" height="${h - 2 * INSET}" rx="${BODY.r - INSET}" ry="${BODY.r - INSET}" fill="#fff"/></svg>`);
  const buf = await sharp(src).removeAlpha().extract({ left, top, width: side, height: side }).ensureAlpha()
    .composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  console.log(`aparato: recorte ${left},${top} ${side}² · máscara r=${BODY.r - INSET}`);
  return buf;
}

const PNG = { compressionLevel: 9 };
const results = [];
async function write(name, pipeline) {
  const file = join(OUT, name);
  await pipeline.toFile(file);
  results.push([name, statSync(file).size]);
}

mkdirSync(OUT, { recursive: true });
const r = await cutR(SRC);

// La R, con alfa. Los chicos se afilan un poco: a 16 px el reductor la deja lavada.
for (const size of [16, 32, 48]) {
  await write(`favicon-${size}.${V}.png`,
    sharp(r).resize(size, size, { kernel: 'lanczos3' }).sharpen({ sigma: size <= 16 ? 0.6 : 0.5 }).png(PNG));
}
// El logo: el ícono completo recortado a su forma, con alfa. sidebar 28 (1x) / 56 (2x) ·
// login 56 (1x) / 112 (2x) · encabezado móvil 56 (cubre 26 px hasta 2x).
const device = await cutDevice(SRC);
for (const size of [28, 56, 112]) {
  await write(`logo-${size}.${V_LOGO}.png`, sharp(device).resize(size, size, { kernel: 'lanczos3' }).png(PNG));
}

// Opción B del favicon (sólo con --favicon-b, fuera de public/): el ícono completo reducido.
if (OUT_B) {
  mkdirSync(OUT_B, { recursive: true });
  for (const size of [16, 32, 48]) {
    const file = join(OUT_B, `favicon-b-${size}.png`);
    await sharp(device).resize(size, size, { kernel: 'lanczos3' }).sharpen({ sigma: size <= 16 ? 0.6 : 0.5 }).png(PNG).toFile(file);
    results.push([`(B) favicon-b-${size}.png`, statSync(file).size]);
  }
}

// El ícono completo, OPACO (iOS pinta negro lo transparente del apple-touch-icon). Paleta de
// 8 bits: es lo que lo baja de ~300 KB a lo que pesa; a estos tamaños no se nota.
for (const [name, size] of [[`apple-touch-icon.${V}.png`, 180], [`icon-192.${V}.png`, 192], [`icon-512.${V}.png`, 512]]) {
  await write(name,
    sharp(SRC).resize(size, size, { kernel: 'lanczos3' }).flatten({ background: BG }).removeAlpha()
      .png({ ...PNG, palette: true, quality: 90, colors: 256, effort: 10 }));
}

for (const [name, bytes] of results) console.log(`${name.padEnd(28)} ${(bytes / 1024).toFixed(1).padStart(6)} KB`);
