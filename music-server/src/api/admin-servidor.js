// GET /api/admin/servidor — el detalle del servidor, SOLO para admins.
//
// SOLO LECTURA. Nada de botones ni escrituras en este paso.
//
// ⚠️ LO QUE NUNCA SALE POR ACÁ: rutas del disco (ni la de la base, ni las carpetas de música
// o videos), variables de entorno, IPs ni datos de usuarios. Todo lo que viaja son números,
// estados y versiones. El tamaño de la base lo mide estado/base.js con un stat, y la ruta se
// queda adentro.
import { Router } from 'express';
import db, { DB_PATH } from '../db/database.js';
import { authMiddleware, requireAdmin } from '../auth/jwt.js';
import { muestreador } from '../estado/muestreo.js';
import { contadores } from '../estado/contadores.js';
import { crearLectorBase } from '../estado/base.js';
import { VERSION, VERSION_PAQUETE } from '../estado/version.js';
import { estadoIndice } from '../videos/index.js';
import { ollama } from '../ia/ollama.js';
import { servicio } from './locutor.js';
import { handle } from './handle.js';

const router = Router();

// LAS DOS CAPAS, en este orden y para todo el router, como admin-users.js.
router.use(authMiddleware, requireAdmin);

const VENTANA_MUESTRAS_MS = 60 * 60_000;   // las muestras de la última hora
// Tamaño, WAL, pistas y último escaneo, en caché de 5 s (estado/base.js). DB_PATH solo se usa
// ahí adentro si db.location() no existe; la ruta no viaja.
const baseEnCache = crearLectorBase({ conexion: db, rutaRespaldo: DB_PATH });

function locutor() {
  const cliente = ollama.estado();
  // Apagado (sin OLLAMA_URL): null. Ni la URL ni el modelo viajan.
  if (!cliente.encendido) return null;
  return { cliente, servicio: servicio.estadisticas() };
}

router.get('/', handle(async (_req, res) => {
  const mem = process.memoryUsage();
  const ultima = muestreador.ultima();
  res.set('Cache-Control', 'no-store');
  res.json({
    version: VERSION,
    version_paquete: VERSION_PAQUETE,
    node: process.version,
    uptime_s: Math.round(process.uptime()),
    memoria: { rss: mem.rss, heap: mem.heapUsed },
    // La última ventana de 10 s; null antes de la primera.
    event_loop: ultima ? { p50: ultima.p50, p99: ultima.p99, max: ultima.max } : null,
    muestras: muestreador.muestras(VENTANA_MUESTRAS_MS),
    base: baseEnCache(),
    videos: estadoIndice(),
    locutor: locutor(),
    ...contadores(),
  });
}));

export default router;
