const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDB } = require('../config/database');

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { login_id, password } = req.body;

  if (!login_id || !password) {
    return res.status(400).json({ error: 'IDとパスワードを入力してください' });
  }

  const db = getDB();
  // email または id でログイン
  const staff = db.prepare(`
    SELECT s.*, st.name as store_name
    FROM staff s
    JOIN stores st ON s.store_id = st.id
    WHERE (s.id = ? OR s.email = ?) AND s.is_active = 1
  `).get(login_id, login_id);

  if (!staff) {
    return res.status(401).json({ error: 'IDまたはパスワードが正しくありません' });
  }

  if (!bcrypt.compareSync(password, staff.password_hash)) {
    return res.status(401).json({ error: 'IDまたはパスワードが正しくありません' });
  }

  const token = jwt.sign(
    { staff_id: staff.id, store_id: staff.store_id, role: staff.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    token,
    staff: {
      id: staff.id,
      name: staff.name,
      store_id: staff.store_id,
      store_name: staff.store_name,
      role: staff.role,
    },
  });
});

// GET /api/auth/me — トークン検証 & プロフィール取得
router.get('/me', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: '認証が必要です' });
  }

  try {
    const decoded = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
    const db = getDB();
    const staff = db.prepare(`
      SELECT s.id, s.name, s.store_id, s.role, st.name as store_name
      FROM staff s JOIN stores st ON s.store_id = st.id
      WHERE s.id = ?
    `).get(decoded.staff_id);

    if (!staff) return res.status(401).json({ error: 'ユーザーが見つかりません' });
    res.json({ staff });
  } catch (e) {
    res.status(401).json({ error: 'トークンが無効です' });
  }
});

module.exports = router;
