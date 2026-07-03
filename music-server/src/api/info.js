import { Router } from 'express';
import { authMiddleware } from '../auth/jwt.js';

const router = Router();
router.use(authMiddleware);

// Datos de artista EN VIVO desde MusicBrainz (metadatos públicos: tipo, país,
// años activo, tags/géneros). Complementa los agregados locales del panel de Info.
// - Rate limit: MB pide ≤1 req/s y User-Agent identificable → serializamos las
//   peticiones salientes con ≥1s de separación.
// - Caché en memoria por 24h (found o not-found válidos) para no golpear MB en
//   cada apertura del panel. Los fallos de red NO se cachean (son transitorios).

const MB_URL = 'https://musicbrainz.org/ws/2/artist/';
const UA     = 'SonoraRev/1.0 ( https://sonorarev.com )';   // User-Agent obligatorio de MB
const TTL    = 24 * 60 * 60 * 1000;                          // 24h
const MIN_SCORE = 90;                                        // confianza mínima del match

const cache = new Map();   // nameLower -> { data, ts }

// Cola serial con ≥1s entre peticiones a MusicBrainz.
let chain = Promise.resolve();
let lastReq = 0;
function schedule(fn) {
  const run = async () => {
    const wait = 1000 - (Date.now() - lastReq);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastReq = Date.now();
    return fn();
  };
  chain = chain.then(run, run);   // encadena pase lo que pase con la anterior
  return chain;
}

async function fetchFromMB(name) {
  const query = encodeURIComponent(`artist:"${name}"`);
  const resp = await fetch(`${MB_URL}?query=${query}&fmt=json&limit=3`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!resp.ok) throw new Error(`MB ${resp.status}`);
  const json = await resp.json();

  const a = (json.artists || [])[0];
  if (!a || (a.score ?? 0) < MIN_SCORE) return { found: false };   // sin match confiable

  const tags = (a.tags || [])
    .filter(t => (t.count ?? 0) > 0)
    .sort((x, y) => (y.count || 0) - (x.count || 0))
    .slice(0, 6)
    .map(t => t.name);

  const life = a['life-span'] || {};
  return {
    found:   true,
    name:    a.name ?? name,
    type:    a.type ?? null,                                        // Person | Group | ...
    country: a.country ?? a.area?.['iso-3166-1-codes']?.[0] ?? null,
    begin:   life.begin ?? null,
    end:     life.end ?? null,
    ended:   life.ended ?? null,
    tags,
  };
}

// GET /api/info/artist/:name  → datos de MusicBrainz (o { found:false } si no hay match/falla).
router.get('/artist/:name', async (req, res) => {
  const name = (req.params.name || '').trim();
  if (!name) return res.json({ found: false });

  const key = name.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return res.json(hit.data);

  try {
    const data = await schedule(() => fetchFromMB(name));
    cache.set(key, { data, ts: Date.now() });   // cachea resultado válido (found o not-found)
    res.json(data);
  } catch {
    res.json({ found: false });                  // fallo transitorio: sin error visible, sin cachear
  }
});

export default router;
