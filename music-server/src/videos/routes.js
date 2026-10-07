import { createReadStream, statSync } from 'node:fs';
import { Router } from 'express';
import { alFallarLectura, enviarConRange, resolveUser } from '../stream/stream.js';
import { buscarVideo, obtenerIndice, publico } from './index.js';

// LAS RUTAS DE VIDEO. La autenticación es la del stream de audio (`resolveUser`: Bearer o
// ?token=, y que la cuenta todavía exista), así un <video src> o una portada en <img>
// funcionan igual que el audio. No hay permisos por rol: los videos son de todos, como la
// música.

function autenticar(req, res, next) {
  if (!resolveUser(req)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// Los tres handlers son async (esperan al índice), y en Express 4 un throw DESPUÉS de un
// await no lo atrapa nadie: Node 22 mata el proceso. Hasta la 1.24.0 un "Range: bytes=-N"
// al stream de video hacía exactamente eso. Igual que `protegido` de api/playlists.js: un
// 500 si todavía se puede, o se corta la conexión si las cabeceras ya salieron.
function protegido(ruta, fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      console.error(`[videos] ${ruta}:`, e);
      if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
      else res.destroy();
    }
  };
}

// ---- /api/videos ----

export const videosApi = Router();
videosApi.use(autenticar);

// GET /api/videos → { videos: [...] }
videosApi.get('/', protegido('GET /api/videos', async (_req, res) => {
  const { videos } = await obtenerIndice();
  res.json({ videos: videos.map(publico) });
}));

// GET /api/videos/:id/cover → el .jpg que está al lado del video.
videosApi.get('/:id/cover', protegido('GET /api/videos/:id/cover', async (req, res) => {
  const v = await buscarVideo(req.params.id);
  if (!v?.portada) return res.status(404).json({ error: 'Cover not found' });
  let st;
  try { st = statSync(v.portada); }
  catch { return res.status(404).json({ error: 'Cover not found' }); }
  res.writeHead(200, {
    'Content-Type': 'image/jpeg',
    'Content-Length': st.size,
    // Privada: va con sesión. Un día alcanza; si se cambia la portada, cambia en el día.
    'Cache-Control': 'private, max-age=86400',
  });
  const lectura = createReadStream(v.portada);
  lectura.on('error', alFallarLectura(res, v.portada));
  lectura.pipe(res);
}));

// ---- /stream/video ----

export const videosStream = Router();

// GET /stream/video/:id → el MISMO manejo de Range que el audio.
videosStream.get('/:id', autenticar, protegido('GET /stream/video/:id', async (req, res) => {
  const v = await buscarVideo(req.params.id);
  if (!v) return res.status(404).json({ error: 'Video not found' });
  let st;
  try { st = statSync(v.ruta); }
  catch { return res.status(404).json({ error: 'File not found on disk' }); }
  enviarConRange(req, res, v.ruta, v.mime, st.size);
}));
