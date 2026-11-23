// MODO RADIO (1.29.0): lo que escucha una persona, publicado para que los demás lo sigan.
//
//   POST   /api/radio              crea MI radio → un código de 6 caracteres
//   PUT    /api/radio/:code/state  el anfitrión publica qué suena (y sirve de latido)
//   GET    /api/radio/:code        cualquiera con sesión lee el estado (y queda de oyente)
//   DELETE /api/radio/:code        el anfitrión, o un admin, la termina
//
// Desde 1.45.0 (moderadores y control remoto):
//   PUT    /api/radio/:code/moderadores/:userId  el anfitrión nombra moderador a quien escucha
//   DELETE /api/radio/:code/moderadores/:userId  y se lo quita
//   POST   /api/radio/:code/ordenes              un moderador manda una orden → 202 { id }
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
// LA MODERACIÓN ES A PEDIDO. Un cliente de 1.42.0 (la app de iOS, la web vieja) no pide nada y
// recibe lo de siempre, byte a byte:
//   · GET con ?cap=mod (este cliente sabe moderar) o ?desde=N (el último evento que vio) suma
//     moderators, capabilities, events, eventsUntil y eventsLost; y orders, solo al anfitrión.
//   · PUT /state con ordenHasta (y aplicadas) confirma órdenes y devuelve las que quedan (orders).
//
// LAS CAPACIDADES SE DECLARAN SOLO AL CREAR LA RADIO (decisión de S4): POST /api/radio con
// { capabilities: { orders: true } }, y no en cada PUT /state. Por qué:
//   · "mi reproductor ejecuta órdenes" es del cliente del anfitrión, y no cambia a media radio;
//   · si viajara en cada latido, un PUT sin el campo (un cliente viejo, un reintento) la apagaría
//     y dejaría colgadas las órdenes ya mandadas;
//   · así PUT /state sigue siendo el cuerpo de 1.42.0 más la confirmación, nada más.
// Un anfitrión que cambia de cliente crea otra radio, como ya pasa hoy.
//
// VIDEOS: una orden nunca pone un video. Los videos NO están en `tracks` (viven en el índice de
// videos, src/videos/, con ids de 16 hex en texto), así que uno llega con esa forma de id o con
// kind:'video' (lo que marca la web): 422 con reason 'video', y no entra nada al almacén. Si algún
// día `tracks` tuviera un video, su mime_type lo delata: también 422 'video'.
//
// No toca /api/plays: lo que cada oyente escucha se sigue registrando como siempre.
import express, { Router } from 'express';
import db from '../db/database.js';
import { authMiddleware } from '../auth/jwt.js';
import { avatarDe } from '../users/avatars.js';
import { radios } from '../radio/almacen.js';
import { REGLAS, acotarPosicion, leerCodigo, leerOrden, leerPublicacion, nombrePublico } from '../radio/reglas.js';

const router = Router();

// Va ANTES del `express.json()` global (server.js monta esta ruta primero): así el tope del
// cuerpo es el de acá y no los 100 kB por defecto. Vale para TODAS las rutas de este archivo,
// también las de la moderación: sin sesión, 401 antes de mirar nada.
router.use(authMiddleware);
router.use(express.json({ limit: REGLAS.CUERPO_MAX_BYTES }));
// Nada de esto se guarda en ninguna caché: cambia cada segundo.
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// Solo lectura, las cuatro.
const PISTA = db.prepare('SELECT id, duration FROM tracks WHERE id = ?');
const PISTA_ORDEN = db.prepare('SELECT id, title, mime_type FROM tracks WHERE id = ?');
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

/** El motivo del almacén → la respuesta. Los de la moderación (1.45.0) llevan `reason`, para
 *  que el cliente decida sin leer el texto; los de antes, no (son los de 1.42.0, tal cual). */
function rechazar(res, r) {
  const conMotivo = (status, error) => res.status(status).json({ error, reason: r.motivo });
  switch (r.motivo) {
    case 'no-existe': return res.status(404).json({ error: NO_EXISTE });
    case 'no-es-tuya': return res.status(403).json({ error: 'Esa radio no es tuya.' });
    case 'terminada': return res.status(410).json({ error: 'Esa radio ya terminó.', status: 'ended', endedReason: r.razon ?? null });
    case 'demasiadas': return res.status(409).json({ error: 'Hay demasiadas radios en vivo. Intenta más tarde.' });
    case 'llena': return res.status(409).json({ error: 'Esa radio está llena.' });
    case 'frecuencia':
      res.set('Retry-After', String(Math.max(1, Math.ceil((r.esperaMs ?? 1000) / 1000))));
      return res.status(429).json({ error: 'Demasiadas peticiones seguidas. Espera un momento.' });
    case 'sin-permiso': return conMotivo(403, 'No tienes permiso para eso.');
    case 'es-el-anfitrion': return conMotivo(409, 'El anfitrión no puede ser moderador de su propia radio.');
    case 'no-escucha': return conMotivo(409, 'Hay que estar escuchando la radio.');
    case 'sin-soporte': return conMotivo(409, 'Esa app todavía no lo admite.');
    case 'moderadores-llenos': return conMotivo(409, `Ya hay ${REGLAS.MAX_MODERADORES} moderadores.`);
    case 'ordenes-llenas': return conMotivo(409, 'Hay demasiadas órdenes pendientes. Espera un momento.');
    case 'obsoleta': return conMotivo(409, 'La canción ya cambió.');
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

/** Una orden como la ve el anfitrión. */
const ordenPublica = (o) => ({ id: o.id, type: o.tipo, trackId: o.trackId, seqBase: o.seqBase, trackBase: o.trackBase, by: o.por, title: o.titulo });
/** Un evento ("Sonia pasó a la siguiente") como viaja. Los nombres son los que guardó el almacén. */
const eventoPublico = (e) => ({
  id: e.id, type: e.tipo, by: e.por, byName: e.porNombre, target: e.sobre, targetName: e.sobreNombre, trackId: e.trackId, title: e.titulo, at: e.en,
});
/** Lo de la moderación, SOLO si el almacén lo devolvió (a pedido). Sin pedirlo, nada. */
const moderacion = (r) => (r.moderadores === undefined ? {} : {
  moderators: r.moderadores.map(persona).filter(Boolean),
  capabilities: { orders: r.capacidades.ordenes },
  events: r.eventos.map(eventoPublico),
  eventsUntil: r.eventosHasta,
  eventsLost: r.eventosPerdidos,
  ...(r.ordenes ? { orders: r.ordenes.map(ordenPublica) } : {}),
});

/** Un entero > 0 escrito como tal en la URL (sin signo, sin decimales, sin ceros adelante), o null. */
const idDeUrl = (v) => (typeof v === 'string' && /^[1-9]\d{0,15}$/.test(v) && Number.isSafeInteger(Number(v)) ? Number(v) : null);
/** `?desde=`: ausente, o un entero ≥ 0. Cualquier otra cosa (texto, negativo, repetido) no. */
function leerDesde(v) {
  if (v === undefined) return { ok: true, desde: undefined };
  return typeof v === 'string' && /^\d{1,16}$/.test(v) && Number.isSafeInteger(Number(v)) ? { ok: true, desde: Number(v) } : { ok: false };
}

const ID_VIDEO = /^[0-9a-f]{16}$/;
/** ¿La orden pide poner un video? (ver VIDEOS arriba) */
const pideVideo = (b) => b?.kind === 'video' || (typeof b?.trackId === 'string' && ID_VIDEO.test(b.trackId));
const VIDEO = { error: 'Los videos no se pueden poner desde el control remoto.', reason: 'video' };

router.post('/', (req, res) => {
  // `{ capabilities: { orders: true } }` (1.45.0): el reproductor de este anfitrión ejecuta
  // órdenes. Solo cuenta un true de verdad; sin cuerpo, o con uno raro, la radio de siempre.
  const b = req.body;
  const pide = b && typeof b === 'object' && !Array.isArray(b) ? b.capabilities : null;
  const r = radios.crear(req.user.id, {
    capacidades: { ordenes: pide?.orders === true },
    nombre: persona(req.user.id)?.name || null,   // para los eventos: "Ana hizo moderadora a Sonia"
  });
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
  }, leido.confirmacion);
  if (!r.ok) return rechazar(res, r);
  res.json({
    serverNow: r.serverNow,
    status: 'live',
    state: estadoPublico(r.estado),
    ...(r.ordenes ? { orders: r.ordenes.map(ordenPublica) } : {}),   // solo con confirmación
  });
});

router.get('/:code', (req, res) => {
  const codigo = leerCodigo(req.params.code);
  if (!codigo) return res.status(404).json({ error: NO_EXISTE });
  const d = leerDesde(req.query.desde);
  if (!d.ok) return res.status(400).json({ error: 'desde tiene que ser un entero.' });

  const r = radios.leer(codigo, req.user.id, { capacidades: { moderar: req.query.cap === 'mod' }, desde: d.desde });
  if (!r.ok) return rechazar(res, r);
  res.json({
    serverNow: r.serverNow,
    code: r.codigo,
    status: r.status,
    ...(r.status === 'ended' ? { endedReason: r.motivo } : {}),
    state: estadoPublico(r.estado),
    host: persona(r.anfitrion),
    listeners: r.oyentes.map(persona).filter(Boolean),
    ...moderacion(r),
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

// ---- Moderadores (1.45.0) ----
// Quién puede (solo el anfitrión) lo decide el almacén: acá solo se lee la URL y se ponen nombres.
function moderar(req, res, otorgar) {
  const codigo = leerCodigo(req.params.code);
  if (!codigo) return res.status(404).json({ error: NO_EXISTE });
  const objetivo = idDeUrl(req.params.userId);
  if (objetivo === null) return res.status(400).json({ error: 'userId tiene que ser un entero.' });

  const r = otorgar
    ? radios.otorgar(codigo, req.user.id, objetivo, { nombre: persona(objetivo)?.name || null })
    : radios.quitar(codigo, req.user.id, objetivo);
  if (!r.ok) return rechazar(res, r);
  res.json({ serverNow: r.serverNow, moderators: r.moderadores.map(persona).filter(Boolean), name: r.nombre });
}
router.put('/:code/moderadores/:userId', (req, res) => moderar(req, res, true));
router.delete('/:code/moderadores/:userId', (req, res) => moderar(req, res, false));

// ---- Órdenes (1.45.0) ----
// Cuerpo: { type, trackId?, seqBase?, clientId } (los tipos, en reglas.js: TIPOS_ORDEN). Quién
// puede (un moderador que está escuchando) lo decide el almacén; acá, la pista y su título.
router.post('/:code/ordenes', (req, res) => {
  const codigo = leerCodigo(req.params.code);
  if (!codigo) return res.status(404).json({ error: NO_EXISTE });

  const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
  if (pideVideo(b)) return res.status(422).json(VIDEO);
  const leida = leerOrden(b && { tipo: b.type, trackId: b.trackId, seqBase: b.seqBase, idCliente: b.clientId });
  // leerOrden nombra los campos como el almacén; acá viajan en inglés.
  if (!leida.ok) return res.status(400).json({ error: leida.error.replace('idCliente', 'clientId') });

  let titulo = null;
  if (leida.orden.trackId !== null) {
    const pista = PISTA_ORDEN.get(leida.orden.trackId);
    if (!pista) return res.status(422).json({ error: 'Esa canción no existe.', reason: 'sin-pista' });
    if (typeof pista.mime_type === 'string' && pista.mime_type.startsWith('video/')) return res.status(422).json(VIDEO);
    titulo = pista.title;
  }

  const r = radios.ordenar(codigo, req.user.id, leida.orden, { titulo });
  if (!r.ok) return rechazar(res, r);
  res.status(202).json({ id: r.id, repeated: r.repetida, serverNow: r.serverNow });
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
