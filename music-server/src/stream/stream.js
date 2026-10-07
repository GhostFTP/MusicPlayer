import { createReadStream, statSync } from 'node:fs';
import { Router } from 'express';
import db from '../db/database.js';
import { cuentaExiste, verifyToken } from '../auth/jwt.js';
import { parsearRange } from './range.js';

const router = Router();

// Auth via query-param token so <audio src="..."> funciona sin JS extra
//
// No pasa por authMiddleware, así que la comprobación de que la cuenta EXISTE (1.19.0)
// está repetida acá con la misma función: sin ella, una cuenta borrada seguiría
// escuchando música con su token viejo hasta que venciera (ver auth/jwt.js).
export function resolveUser(req) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : req.query.token;

  if (!token) return null;
  let user;
  try { user = verifyToken(token); }
  catch { return null; }
  return cuentaExiste(user?.id) ? user : null;
}

// GET /stream/:id
router.get('/:id', (req, res) => {
  const user = resolveUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const track = db.prepare('SELECT file_path, mime_type FROM tracks WHERE id = ?').get(req.params.id);
  if (!track) return res.status(404).json({ error: 'Track not found' });

  let stat;
  try { stat = statSync(track.file_path); }
  catch { return res.status(404).json({ error: 'File not found on disk' }); }

  enviarConRange(req, res, track.file_path, track.mime_type, stat.size);
});

// El manejo de Range, sacado del handler de arriba con la misma lógica (solo cambian los
// nombres de la ruta y del tipo) para que lo use también el stream de video
// (src/videos/routes.js). Sin Range manda el archivo entero (200); con Range, el pedazo
// (206 + Content-Range); un rango imposible, 416.
//
// El parseo vive en stream/range.js (1.24.1): ahí se decide completo / parcial / 416.
export function enviarConRange(req, res, filePath, mimeType, fileSize) {
  const r = parsearRange(req.headers.range, fileSize);

  if (r.tipo === 'insatisfacible') {
    res.writeHead(416, { 'Content-Range': `bytes */${fileSize}`, 'Accept-Ranges': 'bytes' });
    return res.end();
  }

  // Sin Range (o uno que se ignora): el archivo completo, 200. Con rango: el pedazo, 206.
  const parcial = r.tipo === 'parcial';
  res.writeHead(parcial ? 206 : 200, {
    'Content-Type': mimeType,
    'Content-Length': parcial ? r.end - r.start + 1 : fileSize,
    'Accept-Ranges': 'bytes',
    ...(parcial ? { 'Content-Range': `bytes ${r.start}-${r.end}/${fileSize}` } : {}),
  });

  const lectura = createReadStream(filePath, parcial ? { start: r.start, end: r.end } : undefined);
  lectura.on('error', alFallarLectura(res, filePath));
  lectura.pipe(res);
}

// Un stream de lectura sin listener de 'error' es una excepción sin atrapar: si el archivo
// desaparece entre el stat y la lectura (un rescan, un disco que se cae), se caía el proceso
// entero. Ahora solo se corta ESTA respuesta: un 500 si todavía no salieron las cabeceras;
// si ya salieron, no hay forma de cambiar el estado y se corta la conexión.
export function alFallarLectura(res, filePath) {
  return (e) => {
    console.error(`[stream] no se pudo leer ${filePath}:`, e.message);
    if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
    else res.destroy();
  };
}

export default router;
