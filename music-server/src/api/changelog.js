import { Router } from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authMiddleware } from '../auth/jwt.js';

const router = Router();
router.use(authMiddleware);

const __dir = dirname(fileURLToPath(import.meta.url));
// El CHANGELOG.md vive en la raíz del repo (dev) y se copia a music-server/ en la
// imagen Docker (ver Dockerfile: COPY CHANGELOG.md ./). Probamos ambas rutas.
const CANDIDATES = [
  join(__dir, '../../../CHANGELOG.md'),  // raíz del repo (desarrollo)
  join(__dir, '../../CHANGELOG.md'),     // music-server/ (producción / Docker)
];

// GET /api/changelog → { content } con el markdown crudo del CHANGELOG.
router.get('/', (_req, res) => {
  const path = CANDIDATES.find(existsSync);
  if (!path) return res.json({ content: '' });
  try {
    res.json({ content: readFileSync(path, 'utf8') });
  } catch {
    res.json({ content: '' });
  }
});

export default router;
