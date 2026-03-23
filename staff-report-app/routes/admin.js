const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDB } = require('../config/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

router.use(authMiddleware);
router.use(adminMiddleware);

// GET /api/admin/stores — 店舗一覧
router.get('/stores', (req, res) => {
  const db = getDB();
  const stores = db.prepare(`
    SELECT s.*, COUNT(st.id) as staff_count
    FROM stores s LEFT JOIN staff st ON s.id = st.store_id AND st.is_active = 1
    GROUP BY s.id
  `).all();
  res.json({ stores });
});

// POST /api/admin/stores — 店舗追加
router.post('/stores', (req, res) => {
  const { id, name, line_group_id } = req.body;
  if (!id || !name) return res.status(400).json({ error: '店舗IDと名前は必須です' });
  const db = getDB();
  db.prepare('INSERT INTO stores (id, name, line_group_id) VALUES (?, ?, ?)').run(id, name, line_group_id || null);
  res.json({ success: true });
});

// POST /api/admin/staff — スタッフ追加
router.post('/staff', (req, res) => {
  const { id, store_id, name, email, password, role } = req.body;
  if (!id || !store_id || !name || !password) {
    return res.status(400).json({ error: '必須項目を入力してください' });
  }
  const db = getDB();
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(`
    INSERT INTO staff (id, store_id, name, email, password_hash, role)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, store_id, name, email || null, hash, role || 'staff');
  res.json({ success: true });
});

// GET /api/admin/reports/overview — 全店舗レポート概況
router.get('/reports/overview', (req, res) => {
  const db = getDB();
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const overview = db.prepare(`
    SELECT
      st.id as store_id, st.name as store_name,
      COUNT(DISTINCT s.id) as total_staff,
      COUNT(DISTINCT r.staff_id) as submitted_count,
      ROUND(AVG(f.total_score), 1) as avg_score
    FROM stores st
    LEFT JOIN staff s ON st.id = s.store_id AND s.is_active = 1
    LEFT JOIN reports r ON s.id = r.staff_id AND r.year_month = ?
    LEFT JOIN feedbacks f ON r.id = f.report_id
    GROUP BY st.id
  `).all(yearMonth);

  res.json({ year_month: yearMonth, stores: overview });
});

// GET /api/admin/staff/list — スタッフ一覧
router.get('/staff/list', (req, res) => {
  const db = getDB();
  const staff = db.prepare(`
    SELECT s.id, s.name, s.email, s.store_id, s.role, s.is_active, st.name as store_name
    FROM staff s JOIN stores st ON s.store_id = st.id
    WHERE s.is_active = 1
    ORDER BY st.name, s.name
  `).all();
  res.json({ staff });
});

// PUT /api/admin/stores/:id — 店舗情報更新（LINEグループID等）
router.put('/stores/:id', (req, res) => {
  const { name, line_group_id } = req.body;
  const db = getDB();
  const updates = [];
  const params = [];
  if (name) { updates.push('name = ?'); params.push(name); }
  if (line_group_id !== undefined) { updates.push('line_group_id = ?'); params.push(line_group_id || null); }
  if (updates.length === 0) return res.status(400).json({ error: '更新項目がありません' });
  params.push(req.params.id);
  db.prepare(`UPDATE stores SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});

// POST /api/admin/line/test — LINE送信テスト
router.post('/line/test', async (req, res) => {
  const { store_id, message } = req.body;
  const { sendToStoreGroup } = require('../services/line');
  const success = await sendToStoreGroup(store_id, { type: 'text', text: message || 'テスト送信です' });
  res.json({ success });
});

// POST /api/admin/line/remind — 手動リマインダー送信
router.post('/line/remind', async (req, res) => {
  const { sendMonthlyReminder } = require('../services/line');
  try {
    await sendMonthlyReminder();
    res.json({ success: true, message: 'リマインダーを送信しました' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
