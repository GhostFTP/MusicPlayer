import { createReadStream, statSync } from 'node:fs';
import { Router } from 'express';
import db from '../db/database.js';
import { verifyToken } from '../auth/jwt.js';

const router = Router();

// Auth via query-param token so <audio src="..."> funciona sin JS extra
function resolveUser(req) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : req.query.token;

  if (!token) return null;
  try { return verifyToken(token); }
  catch { return null; }
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

  const fileSize = stat.size;
  const rangeHeader = req.headers.range;

  if (!rangeHeader) {
    // Sin Range: enviamos el archivo completo (útil para descargas)
    res.writeHead(200, {
      'Content-Type': track.mime_type,
      'Content-Length': fileSize,
      'Accept-Ranges': 'bytes',
    });
    createReadStream(track.file_path).pipe(res);
    return;
  }

  // Parsear "Range: bytes=START-END"
  const [startStr, endStr] = rangeHeader.replace('bytes=', '').split('-');
  const start = parseInt(startStr, 10);
  const end = endStr ? parseInt(endStr, 10) : fileSize - 1;

  if (start >= fileSize || end >= fileSize || start > end) {
    res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
    return res.end();
  }

  const chunkSize = end - start + 1;

  res.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': chunkSize,
    'Content-Type': track.mime_type,
  });

  createReadStream(track.file_path, { start, end }).pipe(res);
});

export default router;
