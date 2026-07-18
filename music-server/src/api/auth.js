import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import db from '../db/database.js';
import { signToken } from '../auth/jwt.js';
import { verifyCfAccess, cfAccessEnabled } from '../auth/cloudflare.js';

const router = Router();

// El registro público está CERRADO por defecto. Para abrirlo (p.ej. al crear el
// primer usuario) define ALLOW_REGISTRATION=true. El auto-provisioning vía
// Cloudflare Access (POST /cf) NO depende de este flag: crea usuarios igualmente.
const ALLOW_REGISTRATION = process.env.ALLOW_REGISTRATION === 'true';

/**
 * Crea (o recupera) el usuario asociado a un email verificado por Cloudflare.
 * Como estos usuarios nunca inician sesión por contraseña, guardamos un hash
 * aleatorio e inutilizable para cumplir el NOT NULL de password_hash.
 */
async function upsertUserByEmail(email) {
  const existing = db.prepare('SELECT id, username FROM users WHERE username = ?').get(email);
  if (existing) return existing;

  const hash = await bcrypt.hash(randomUUID(), 12);
  const info = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(email, hash);
  return { id: Number(info.lastInsertRowid), username: email };
}

router.post('/register', async (req, res) => {
  if (!ALLOW_REGISTRATION) {
    return res.status(403).json({ error: 'Registration is disabled' });
  }

  const { username, password } = req.body ?? {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });

  const hash = await bcrypt.hash(password, 12);
  try {
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
    res.status(201).json({ message: 'User created' });
  } catch {
    res.status(409).json({ error: 'Username already exists' });
  }
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body ?? {};
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  res.json({ token: signToken({ id: user.id, username: user.username }) });
});

// Auto-login vía Cloudflare Access. El frontend lo llama al cargar: si la
// petición trae una identidad CF válida (JWT firmado por Cloudflare), canjea
// esa identidad por el JWT normal de la app. Si no, responde 401 y el frontend
// cae al formulario usuario/contraseña (caso red local sin Cloudflare).
router.post('/cf', async (req, res) => {
  const identity = await verifyCfAccess(req);
  if (!identity) return res.status(401).json({ error: 'No Cloudflare identity' });

  const user = await upsertUserByEmail(identity.email);
  res.json({ token: signToken({ id: user.id, username: user.username }) });
});

// Config PÚBLICA del login: SIN auth middleware (este router es público — es la pantalla
// de login, el usuario aún no tiene token; gatearlo sería un catch-22). Solo expone si el
// auto-login por Cloudflare Access está disponible, para que el frontend decida si mostrar
// el botón "Iniciar sesión con Google". NO filtra el AUD ni el team domain: cfAccessEnabled
// es un booleano puro (Boolean(TEAM_DOMAIN && AUD), ver cloudflare.js).
router.get('/config', (_req, res) => res.json({ sso: cfAccessEnabled }));

export default router;
