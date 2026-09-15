import { Router } from 'express';
import db, { mapUser } from './db.js';
import { uid, nowIso, hashPassword } from './util.js';

export function authRequired(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const s = token && db.prepare('SELECT * FROM sessions WHERE token=?').get(token);
  if (!s) return res.status(401).json({ error: '未登录或会话已过期' });
  const user = db.prepare('SELECT id,username,role,name,patient_id FROM users WHERE id=?').get(s.user_id);
  if (!user) return res.status(401).json({ error: '账号不存在' });
  req.user = user;
  return next();
}

export const requireRole = (...roles) => (req, res, next) => (
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: '当前角色无权执行此操作' })
);

const router = Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码' });
  const row = db.prepare('SELECT * FROM users WHERE username=?').get(String(username).trim());
  if (!row || row.password_hash !== hashPassword(password)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const token = uid();
  db.prepare('INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)').run(token, row.id, nowIso());
  return res.json({ token, user: mapUser(row) });
});

router.get('/me', authRequired, (req, res) => res.json({ user: mapUser(req.user) }));

router.post('/logout', authRequired, (req, res) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  db.prepare('DELETE FROM sessions WHERE token=?').run(token);
  return res.json({ ok: true });
});

export default router;
