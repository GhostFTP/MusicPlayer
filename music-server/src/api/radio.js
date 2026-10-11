// MODO RADIO (1.29.0): lo que escucha una persona, publicado para que los demás lo sigan.
//
//   POST   /api/radio              crea MI radio → un código de 6 caracteres
//   PUT    /api/radio/:code/state  el anfitrión publica qué suena (y sirve de latido)
//   GET    /api/radio/:code        cualquiera con sesión lee el estado (y queda de oyente)
//   DELETE /api/radio/:code        el anfitrión, o un admin, la termina
//
// Acá vive SOLO lo de HTTP y lo que hay que leer de la base (¿existe la pista?, ¿cuánto
// dura?, nombres y avatares). El estado y sus reglas están en radio/almacen.js y
// radio/reglas.js, EN MEMORIA: un reinicio o un redeploy borra todas las radios.
//
// EL TRANSPORTE ES EL MÁS SIMPLE: la app pregunta cada ~2 s. Por eso la respuesta del GET es
// chica y trae `serverNow`: con la hora del servidor de cada respuesta, cada cliente estima
// su diferencia de reloj. El servidor NUNCA lee un reloj del cliente.
//
// PRIVACIDAD: de otra persona salen su id, su nombre y su avatar, nada más (ni correo, ni
// rol). El nombre de una cuenta que se llama como su correo se corta en la arroba.
//
// No toca /api/plays: lo que cada oyente escucha se sigue registrando como siempre.
import express, { Router } from 'express';
import db from '../db/database.js';
import { authMiddleware } from '../auth/jwt.js';
import { avatarDe } from '../users/avatars.js';
import { radios } from '../radio/almacen.js';
import { REGLAS, acotarPosicion, leerCodigo, leerPublicacion, nombrePublico } from '../radio/reglas.js';

const router = Router();

// Va ANTES del `express.json()` global (server.js monta esta ruta primero): así el tope del
// cuerpo es el de acá y no los 100 kB por defecto.
router.use(authMiddleware);
router.use(express.json({ limit: REGLAS.CUERPO_MAX_BYTES }));
// Nada de esto se guarda en ninguna caché: cambia cada segundo.
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// Solo lectura, las tres.
const PISTA = db.prepare('SELECT id, duration FROM tracks WHERE id = ?');
const PERSONA = db.prepare('SELECT id, username, avatar_emoji, avatar_updated_at FROM users WHERE id = ?');
const ROL = db.prepare('SELECT role FROM users WHERE id = ?');

/** `{ id, name, avatar }`, o null si la cuenta ya no existe. */
function persona(id) {
  const row = PERSONA.get(id);
  return row ? { id: row.id, name: nombrePublico(row.username), avatar: avatarDe(row) } : null;
}

// El mismo texto para "no existe", "ya se borró" y "eso no es un código": quien prueba
// códigos al azar no aprende nada de la respuesta.
const NO_EXISTE = 'No existe esa radio.';

/** El motivo del almacén → la respuesta. */
function rechazar(res, r) {
  switch (r.motivo) {
    case 'no-existe': return res.status(404).json({ error: NO_EXISTE });
    case 'no-es-tuya': return res.status(403).json({ error: 'Esa radio no es tuya.' });
    case 'terminada': return res.status(410).json({ error: 'Esa radio ya terminó.', status: 'ended', endedReason: r.razon ?? null });
    case 'demasiadas': return res.status(409).json({ error: 'Hay demasiadas radios en vivo. Intenta más tarde.' });
    case 'llena': return res.status(409).json({ error: 'Esa radio está llena.' });
    case 'frecuencia':
      res.set('Retry-After', String(Math.max(1, Math.ceil((r.esperaMs ?? 1000) / 1000))));
      return res.status(429).json({ error: 'Demasiadas peticiones seguidas. Espera un momento.' });
    default: return res.status(500).json({ error: 'Internal error' });
  }
}

/** El estado como viaja. */
const estadoPublico = (e) => e && {
  seq: e.seq,
  trackId: e.trackId,
  positionMs: e.positionMs,
  playing: e.playing,
  nextTrackId: e.nextTrackId,
  enPausaPorVideo: e.enPausaPorVideo,
  publishedAtServerMs: e.publishedAtServerMs,
};

router.post('/', (req, res) => {
  const r = radios.crear(req.user.id);
  if (!r.ok) return rechazar(res, r);
  res.status(201).json({ code: r.codigo, serverNow: r.serverNow, status: 'live' });
});

router.put('/:code/state', (req, res) => {
  const codigo = leerCodigo(req.params.code);
  if (!codigo) return res.status(404).json({ error: NO_EXISTE });

  const leido = leerPublicacion(req.body);
  if (!leido.ok) return res.status(400).json({ error: leido.error });
  const p = leido.pedido;

  // La pista tiene que existir, y la posición no puede pasarse de su duración.
  let positionMs = 0;
  if (p.trackId !== null) {
    const pista = PISTA.get(p.trackId);
    if (!pista) return res.status(422).json({ error: 'Esa canción no existe.' });
    positionMs = acotarPosicion(p.positionMs, pista.duration);
  }
  // La siguiente es solo una pista para que el oyente se adelante: si ya no existe, se
  // publica sin ella en vez de rechazar el latido entero.
  const nextTrackId = p.nextTrackId !== null && PISTA.get(p.nextTrackId) ? p.nextTrackId : null;

  const r = radios.publicar(codigo, req.user.id, {
    trackId: p.trackId, positionMs, playing: p.playing, nextTrackId, enPausaPorVideo: p.enPausaPorVideo,
  });
  if (!r.ok) return rechazar(res, r);
  res.json({ serverNow: r.serverNow, status: 'live', state: estadoPublico(r.estado) });
});

router.get('/:code', (req, res) => {
  const codigo = leerCodigo(req.params.code);
  if (!codigo) return res.status(404).json({ error: NO_EXISTE });

  const r = radios.leer(codigo, req.user.id);
  if (!r.ok) return rechazar(res, r);
  res.json({
    serverNow: r.serverNow,
    code: r.codigo,
    status: r.status,
    ...(r.status === 'ended' ? { endedReason: r.motivo } : {}),
    state: estadoPublico(r.estado),
    host: persona(r.anfitrion),
    listeners: r.oyentes.map(persona).filter(Boolean),
  });
});

router.delete('/:code', (req, res) => {
  const codigo = leerCodigo(req.params.code);
  if (!codigo) return res.status(404).json({ error: NO_EXISTE });

  // El rol se lee de la base, no del token (igual que requireAdmin, auth/jwt.js).
  const esAdmin = ROL.get(req.user.id)?.role === 'admin';
  const r = radios.terminar(codigo, req.user.id, { esAdmin });
  if (!r.ok) return rechazar(res, r);
  res.json({ serverNow: r.serverNow, status: 'ended', endedReason: r.motivo });
});

// Un cuerpo demasiado grande o que no es JSON: sin esto Express contesta una página HTML.
router.use((err, _req, res, next) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'El cuerpo es demasiado grande.' });
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) return res.status(400).json({ error: 'El cuerpo no es JSON válido.' });
  next(err);
});

// La memoria no puede depender de que alguien pregunte: cada medio minuto se cierra lo
// vencido y se borra lo terminado. `unref` para que este reloj no mantenga vivo el proceso.
setInterval(() => radios.expirar(), 30_000).unref();

export default router;
