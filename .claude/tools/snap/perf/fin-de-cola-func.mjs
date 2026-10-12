// fin-de-cola-func.mjs — «siguiente» MANUAL en el último de la cola, con CANCIONES.
//
// Son las comprobaciones de fin-de-cola.mjs (ahí está la regla y el detalle), solas y en el formato
// que lee regresion.mjs. Existe porque queue-func.mjs, que también las corre, tarda unos 4 minutos y
// no está en el baseline; con videos las corre video-mix-func.mjs.
//
// No lleva SNAP_REF a propósito: una comparación "en main tiene que fallar" deja de valer el día que
// esto se mergea. Para ver el control, se corre contra el build viejo: SNAP_BASE=<main> y fallan las
// de «siguiente» (pasan las de repetir todo y la del fin natural, que no cambiaron).
// Sólo lee: no escribe nada en la base.
// Uso: SNAP_BASE=http://localhost:4173 node fin-de-cola-func.mjs
import { getToken, preflight, loadPlaywright, BASE } from '../session.mjs';
import { probarFinDeCola } from './fin-de-cola.mjs';

await preflight();
const token = await getToken();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

// El audio es un WAV sintético de 2 minutos: cada caso dura unos segundos y el fin natural se
// provoca saltando cerca del final.
function wav(sec = 120, sr = 8000) {
  const n = sec * sr, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const WAV = wav();
const rutas = (ctx) => ctx.route('**/stream/**', (r) => {
  const h = r.request().headers().range; const total = WAV.length;
  if (!h) return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: WAV });
  const [, a, b] = h.match(/bytes=(\d*)-(\d*)/); const start = a ? +a : 0; const end = b ? +b : total - 1;
  r.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}` }, body: WAV.subarray(start, end + 1) });
});

const R = {};
const ok = (k, v, extra = {}) => { R[k] = { ok: !!v, ...extra }; };
let medidas = {};
try {
  const tres = await (await fetch(`${BASE}/api/tracks?limit=3`, { headers: { Authorization: `Bearer ${token}` } })).json();
  medidas = await probarFinDeCola({ browser, token, base: BASE, ok, items: tres, sufijo: 'canciones', rutas });
} catch (e) {
  ok('sin_excepciones', false, { error: String(e.message).split('\n')[0].slice(0, 200) });
}

const fails = Object.entries(R).filter(([, v]) => !v.ok);
console.log(JSON.stringify(R, null, 1));
console.log('medidas: ' + JSON.stringify(medidas));
console.log(`\nfin-de-cola-func: ${Object.keys(R).length - fails.length}/${Object.keys(R).length}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
