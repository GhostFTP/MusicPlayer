import 'node:process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';

import authRoutes      from './src/api/auth.js';
import tracksRoutes    from './src/api/tracks.js';
import albumsRoutes    from './src/api/albums.js';
import browseRoutes    from './src/api/browse.js';
import playlistRoutes  from './src/api/playlists.js';
import streamRoutes    from './src/stream/stream.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const DIST  = join(__dir, 'public');

const app  = express();
const PORT = process.env.PORT ?? 3000;
const isDev = process.env.NODE_ENV !== 'production' && !existsSync(DIST);

// CORS solo en desarrollo (en prod el frontend viene del mismo origen)
if (isDev) app.use(cors());
app.use(express.json());

// API routes
app.use('/api/auth',      authRoutes);
app.use('/api/tracks',    tracksRoutes);
app.use('/api/albums',    albumsRoutes);
app.use('/api/browse',    browseRoutes);
app.use('/api/playlists', playlistRoutes);
app.use('/stream',        streamRoutes);
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// Frontend estático (producción)
if (existsSync(DIST)) {
  app.use(express.static(DIST));
  // SPA fallback: cualquier ruta no-API sirve index.html
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/stream')) return res.status(404).end();
    res.sendFile(join(DIST, 'index.html'));
  });
  console.log(`Serving frontend from ${DIST}`);
}

app.listen(PORT, () => {
  console.log(`Music server running on http://localhost:${PORT}`);
});
