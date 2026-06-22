import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET ?? 'change-me-in-production';
const EXPIRES = '7d';

export function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES });
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token ?? null;

  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}
