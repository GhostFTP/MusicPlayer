import { Router } from 'express';
import bcrypt from 'bcrypt';
import db from '../db/database.js';
import { signToken } from '../auth/jwt.js';

const router = Router();

router.post('/register', async (req, res) => {
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

export default router;
