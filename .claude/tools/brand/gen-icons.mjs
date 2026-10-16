// gen-icons.mjs — genera TODOS los derivados del logo de la web a partir del ícono de la app.
//
//   node .claude/tools/brand/gen-icons.mjs <ruta/al/icon.png> [--out <carpeta>]
//                                          [--radio-alt <0.26> <carpeta>] [--favicon-plato <carpeta>]
//
// --radio-alt escribe el logo con OTRO radio de esquina en otra carpeta (mismos nombres), para
// compararlo en una hoja de contacto. Nunca va a public/.
//
// --favicon-plato escribe una variante de COMPARACIÓN del favicon: recorte cerrado sobre el
// disco con la R, mismo tratamiento. Nunca va a public/ (el puesto es el aparato completo).
//
// La fuente es el icon.png 1024×1024 de la app iOS (opaco, sin alfa). NO vive en este repo y
// la ruta NO se hardcodea: se pasa como argumento. Lo que se commitea son los derivados
// (music-client/public/icons/) y este script, para poder regenerarlos idénticos.
//
// Dos familias de derivados:
//   · El ícono completo RECORTADO a su propia forma (el "aparato" redondeado, sin el margen
//     negro del original y con fondo transparente afuera): el logo oficial de la sidebar /
//     login / encabezado móvil (logo-28/56/112.v4) y el favicon 16/32/48 (favicon-*.v3, desde
//     1.34.2: la pestaña muestra el mismo tocadiscos que la página).
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
const pIdx = argv.indexOf('--favicon-plato');
const OUT_PLATO = pIdx >= 0 ? resolve(argv[pIdx + 1]) : null;
const aIdx = argv.indexOf('--radio-alt');
const ALT = aIdx >= 0 ? { radio: Number(argv[aIdx + 1]), dir: resolve(argv[aIdx + 2]) } : null;
const SRC = argv.find((a, i) => !a.startsWith('--') && (outIdx < 0 || i !== outIdx + 1) && (pIdx < 0 || i !== pIdx + 1)
  && (aIdx < 0 || (i !== aIdx + 1 && i !== aIdx + 2)));
if (!SRC) {
  console.error('uso: node gen-icons.mjs <ruta/al/icon.png> [--out <carpeta>]');
  process.exit(2);
}

// Sufijo de versión de los nombres. express.static sirve /icons/* sin hash y con
// `Cache-Control: public, max-age=0` + ETag (revalida siempre), pero Cloudflare y la caché de
// favicons del navegador no siempre respetan eso: nombre nuevo = URL nueva = no hay caché que
// esquivar. Si el logo vuelve a cambiar, se sube la versión acá y en index.html / manifest / JSX.
const V = 'v2';          // apple-touch-icon y los 192/512 del manifest (sin cambios desde 1.34.0)
// El logo cambió de la R sola al ícono completo en la corrección de 1.34.0 (v3), y después de
// forma: esquinas más redondas (v4). apple-touch / manifest no cambiaron: siguen en v2.
const V_LOGO = 'v4';
// El favicon dejó la R sola (v2) por el aparato completo en 1.34.2.
const V_FAV = 'v3';

// ── Recorte del aparato (ícono completo) ───────────────────────────────────────────────
// Medido sobre el 1024²: el cuerpo redondeado va de x 19–1008 e y 22–1000 (esquinas originales
// de radio ≈170 px, ≈17 %, que se leían "cuadradas"). Afuera es negro puro. Se recorta el
// CUADRADO interior del cuerpo (INSET px adentro de su borde, para no arrastrar el negro en el
// antialias) y se enmascara con un rectángulo redondeado que lo LLENA, de radio RADIO × lado.
// Así la máscara es exactamente la misma curva que un `border-radius: <RADIO>` en CSS sobre la
// caja del <img>: el filo de 1 px y la sombra (que van en CSS) calzan con el borde del dibujo.
// Medido: a 22 % la curva roza la esquina del pad rojo (hasta 10 px de 1024 ≈ 1,2 px en el de
// 112); a 26 %, hasta 27 px (≈3 px en el de 112). El anillo del brazo no se toca en ninguno.
const BODY = { x0: 19, y0: 22, x1: 1008, y1: 1000 };
const INSET = 3;
const RADIO = 0.22;

const BG = '#111111'; // el --bg del tema: fondo de los íconos opacos

// Plato (sólo para la variante de comparación del favicon): el disco con la R. La R ocupa
// x 303–713 × y 343–811 del 1024² → cuadrado de 560 centrado en ella (508, 577).
const PLATO = { left: 228, top: 297, side: 560 };

async function cutDevice(src, radio, caja = null) {
  const meta = await sharp(src).metadata();
  if (meta.width !== 1024 || meta.height !== 1024) throw new Error(`se esperaba 1024×1024 y llegó ${meta.width}×${meta.height}`);
  // Cuadrado interior: el lado lo pone la dimensión CORTA del cuerpo (el alto), centrado en x.
  const top = caja?.top ?? BODY.y0 + INSET, side = caja?.side ?? BODY.y1 - INSET - (BODY.y0 + INSET) + 1;
  const left = caja?.left ?? Math.round((BODY.x0 + BODY.x1) / 2 - side / 2);
  const rx = Math.round(radio * side);
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}">` +
    `<rect width="${side}" height="${side}" rx="${rx}" ry="${rx}" fill="#fff"/></svg>`);
  const buf = await sharp(src).removeAlpha().extract({ left, top, width: side, height: side }).ensureAlpha()
    .composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  console.log(`aparato: recorte ${left},${top} ${side}² · radio ${Math.round(radio * 100)} % (${rx} px)`);
  return buf;
}

const PNG = { compressionLevel: 9 };
const results = [];
async function write(name, pipeline) {
  const file = join(OUT, name);
  await pipeline.toFile(file);
  results.push([name, statSync(file).size]);
}

// Favicon: reducir de golpe 973 → 16 deja la R en 6×6 px. Supersampling (primero a 4× con
// lanczos3, después al tamaño final) + nitidez σ 0,5; y SÓLO a 16 px un poco más de saturación
// y contraste. Medido sobre la R (azul) del resultado: a 16 px pasa de 6×6 / 17 px azules a
// 10×7 / 21 px, con más contraste contra el resto (4,52 vs 4,27). A 32/48 queda igual que la
// reducción directa (20×23 y 31×34). El dibujo no cambia ni se le pone nada encima.
async function favicon(base, size) {
  let p = sharp(await sharp(base).resize(size * 4, size * 4, { kernel: 'lanczos3' }).png().toBuffer())
    .resize(size, size, { kernel: 'lanczos3' });
  if (size <= 16) p = p.modulate({ saturation: 1.25, brightness: 1.08 }).linear(1.12, -8);
  return p.sharpen({ sigma: 0.5 }).png(PNG);
}

mkdirSync(OUT, { recursive: true });
// El logo: el ícono completo recortado a su forma, con alfa. sidebar 28 (1x) / 56 (2x) ·
// login 56 (1x) / 112 (2x) · encabezado móvil 56 (cubre 26 px hasta 2x).
const device = await cutDevice(SRC, RADIO);
for (const size of [28, 56, 112]) {
  await write(`logo-${size}.${V_LOGO}.png`, sharp(device).resize(size, size, { kernel: 'lanczos3' }).png(PNG));
}
for (const size of [16, 32, 48]) await write(`favicon-${size}.${V_FAV}.png`, await favicon(device, size));

// Variante de radio para comparar (sólo con --radio-alt <0.26> <carpeta>, fuera de public/).
// Mismos nombres que los puestos, para poder cambiarlos por ruta en una captura.
if (ALT) {
  mkdirSync(ALT.dir, { recursive: true });
  const alt = await cutDevice(SRC, ALT.radio);
  for (const size of [28, 56, 112]) {
    const file = join(ALT.dir, `logo-${size}.${V_LOGO}.png`);
    await sharp(alt).resize(size, size, { kernel: 'lanczos3' }).png(PNG).toFile(file);
    results.push([`(alt ${ALT.radio}) logo-${size}`, statSync(file).size]);
  }
}

// Variante de comparación del favicon (sólo con --favicon-plato, fuera de public/).
if (OUT_PLATO) {
  mkdirSync(OUT_PLATO, { recursive: true });
  const plato = await cutDevice(SRC, RADIO, PLATO);
  for (const size of [16, 32, 48]) {
    const file = join(OUT_PLATO, `favicon-plato-${size}.png`);
    await (await favicon(plato, size)).toFile(file);
    results.push([`(plato) favicon-${size}`, statSync(file).size]);
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
