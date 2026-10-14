// gen-icons.mjs — genera TODOS los derivados del logo de la web a partir del ícono de la app.
//
//   node .claude/tools/brand/gen-icons.mjs <ruta/al/icon.png> [--out <carpeta>]
//
// La fuente es el icon.png 1024×1024 de la app iOS (opaco, sin alfa). NO vive en este repo y
// la ruta NO se hardcodea: se pasa como argumento. Lo que se commitea son los derivados
// (music-client/public/icons/) y este script, para poder regenerarlos idénticos.
//
// Dos familias de derivados:
//   · La "R" sola, recortada del tornamesa y con fondo transparente: favicon 16/32/48 y el
//     logo de la sidebar / login / encabezado móvil. El ícono completo NO sirve ahí: a
//     16–32 px el tornamesa es una mancha.
//   · El ícono completo (tornamesa), opaco: apple-touch-icon y los 192/512 del manifest, que
//     es donde hay píxeles para leerlo y donde conviene calcar el ícono de la app nativa.
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
const SRC = argv.find((a, i) => !a.startsWith('--') && (outIdx < 0 || i !== outIdx + 1));
if (!SRC) {
  console.error('uso: node gen-icons.mjs <ruta/al/icon.png> [--out <carpeta>]');
  process.exit(2);
}

// Sufijo de versión de los nombres. express.static sirve /icons/* sin hash y con
// `Cache-Control: public, max-age=0` + ETag (revalida siempre), pero Cloudflare y la caché de
// favicons del navegador no siempre respetan eso: nombre nuevo = URL nueva = no hay caché que
// esquivar. Si el logo vuelve a cambiar, se sube a v3 acá y en index.html / manifest / JSX.
const V = 'v2';

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
for (const size of [28, 56, 112]) {   // sidebar 28 (1x) / 56 (2x) · login 56 (1x) / 112 (2x)
  await write(`logo-r-${size}.${V}.png`, sharp(r).resize(size, size, { kernel: 'lanczos3' }).png(PNG));
}

// El ícono completo, OPACO (iOS pinta negro lo transparente del apple-touch-icon). Paleta de
// 8 bits: es lo que lo baja de ~300 KB a lo que pesa; a estos tamaños no se nota.
for (const [name, size] of [[`apple-touch-icon.${V}.png`, 180], [`icon-192.${V}.png`, 192], [`icon-512.${V}.png`, 512]]) {
  await write(name,
    sharp(SRC).resize(size, size, { kernel: 'lanczos3' }).flatten({ background: BG }).removeAlpha()
      .png({ ...PNG, palette: true, quality: 90, colors: 256, effort: 10 }));
}

for (const [name, bytes] of results) console.log(`${name.padEnd(28)} ${(bytes / 1024).toFixed(1).padStart(6)} KB`);
