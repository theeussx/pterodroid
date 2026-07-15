const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDB } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const config = require('../config');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const db = getDB();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign(
    { id: user.id, username: user.username },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRES }
  );

  return res.json({ token, username: user.username });
});

// POST /api/auth/change-password
router.post('/change-password', authMiddleware, async (req, res) => {
  const { current, next: newPass } = req.body || {};
  if (!current || !newPass) {
    return res.status(400).json({ error: 'Current and new passwords required' });
  }
  if (newPass.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  const db = getDB();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const ok = await bcrypt.compare(current, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Current password incorrect' });

  const hash = await bcrypt.hash(newPass, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  return res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
  const db = getDB();
  const setup = db.prepare("SELECT value FROM settings WHERE key = 'setup_done'").get();
  return res.json({ username: req.user.username, setupDone: setup?.value === 'true' });
});

module.exports = router;
