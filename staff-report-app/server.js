require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
app.set('trust proxy', 1); // Railway等のリバースプロキシ対応
const PORT = process.env.PORT || 3000;

// ===== ミドルウェア =====
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

// レート制限
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分
  max: 100,
  message: { error: 'リクエスト回数の上限に達しました。しばらくお待ちください。' },
});
app.use('/api/', limiter);

// ===== 静的ファイル =====
app.use(express.static(path.join(__dirname, 'public')));

// ===== APIルート =====
app.use('/api/auth', require('./routes/auth'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/admin', require('./routes/admin'));

// LINE Webhook（Bot招待時のグループID取得用）
// GET: webhook URL動作確認用（LINE Developers Consoleの検証ボタン対応）
app.get('/api/line/webhook', (req, res) => {
  console.log('✅ LINE Webhook GET確認リクエスト受信');
  res.json({ status: 'ok', message: 'LINE Webhook endpoint is active' });
});

app.post('/api/line/webhook', (req, res) => {
  console.log('📩 LINE Webhook受信:', JSON.stringify(req.body));

  // LINEサーバーに即座にレスポンスを返す（タイムアウト防止）
  res.json({ status: 'ok' });

  // イベント処理は非同期で行う
  const events = req.body.events || [];
  if (events.length === 0) {
    console.log('   (検証リクエスト: eventsが空)');
    return;
  }
  for (const event of events) {
    console.log(`📌 イベント種別: ${event.type}, ソース: ${event.source?.type}, groupId: ${event.source?.groupId || 'なし'}`);
    if (event.type === 'join' && event.source?.type === 'group') {
      const groupId = event.source.groupId;
      console.log(`🔗 LINE グループ参加: groupId = ${groupId}`);
      // グループにgroupIdを自動返信（非同期で実行）
      const line = require('@line/bot-sdk');
      const client = new line.messagingApi.MessagingApiClient({
        channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
      });
      client.pushMessage({
        to: groupId,
        messages: [{
          type: 'text',
          text: `📋 BOT登録完了！\n\nこのグループのIDは:\n${groupId}\n\n管理者はこのIDを店舗設定に登録してください。`,
        }],
      }).then(() => {
        console.log('   ✅ groupIdをグループに送信しました');
      }).catch((err) => {
        console.error('   ❌ groupId送信失敗:', err.message);
      });
    }
    if (event.type === 'memberJoined' && event.source?.type === 'group') {
      console.log(`👤 メンバー参加: groupId = ${event.source.groupId}`);
    }
    if (event.type === 'follow') {
      console.log(`👋 友だち追加: userId = ${event.source?.userId}`);
    }
  }
});

// ===== 招待リンク経由のスタッフ自己登録 =====
// GET: トークン検証（登録ページ用）
app.get('/api/invite/:token', (req, res) => {
  const { getDB } = require('./config/database');
  const db = getDB();
  const invite = db.prepare(`
    SELECT t.*, s.name as store_name
    FROM invite_tokens t JOIN stores s ON t.store_id = s.id
    WHERE t.token = ? AND t.is_active = 1
  `).get(req.params.token);

  if (!invite) return res.status(404).json({ error: '無効な招待リンクです' });
  if (new Date(invite.expires_at) < new Date()) {
    return res.status(410).json({ error: 'この招待リンクは期限切れです' });
  }

  // 店舗一覧を返す（ドロップダウン用）
  const stores = db.prepare('SELECT id, name FROM stores ORDER BY name').all();
  res.json({
    valid: true,
    default_store_id: invite.store_id,
    default_store_name: invite.store_name,
    stores,
    expires_at: invite.expires_at
  });
});

// POST: スタッフ自己登録
app.post('/api/invite/:token/register', (req, res) => {
  try {
    const { getDB } = require('./config/database');
    const bcrypt = require('bcryptjs');
    const db = getDB();

    const invite = db.prepare(`
      SELECT * FROM invite_tokens WHERE token = ? AND is_active = 1
    `).get(req.params.token);

    if (!invite) return res.status(404).json({ error: '無効な招待リンクです' });
    if (new Date(invite.expires_at) < new Date()) {
      return res.status(410).json({ error: 'この招待リンクは期限切れです' });
    }

    const { staff_id, name, store_id, password } = req.body;
    if (!staff_id || !name || !store_id || !password) {
      return res.status(400).json({ error: 'スタッフID、名前、店舗、パスワードは必須です' });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: 'パスワードは4文字以上にしてください' });
    }

    // 店舗存在チェック
    const store = db.prepare('SELECT id FROM stores WHERE id = ?').get(store_id);
    if (!store) return res.status(400).json({ error: '指定された店舗が存在しません' });

    // ID重複チェック
    const existing = db.prepare('SELECT id FROM staff WHERE id = ?').get(staff_id);
    if (existing) return res.status(400).json({ error: 'このスタッフIDは既に使われています' });

    const hash = bcrypt.hashSync(password, 10);
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO staff (id, store_id, name, password_hash, role)
        VALUES (?, ?, ?, ?, 'staff')
      `).run(staff_id, store_id, name, hash);
      db.prepare('UPDATE invite_tokens SET use_count = use_count + 1 WHERE id = ?').run(invite.id);
    });
    tx();

    res.json({ success: true, message: `${name}さんの登録が完了しました！` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// セットアップ状態確認
app.get('/api/setup/status', (req, res) => {
  const { getDB } = require('./config/database');
  const db = getDB();
  const adminCount = db.prepare("SELECT COUNT(*) as c FROM staff WHERE role = 'admin'").get();
  res.json({ needsSetup: adminCount.c === 0 });
});

// 初期セットアップ（管理者がゼロの時だけ使える）
app.post('/api/setup', (req, res) => {
  const { id, name, password, store_id, store_name } = req.body;
  if (!id || !name || !password) {
    return res.status(400).json({ error: 'ID、名前、パスワードは必須です' });
  }
  const { getDB } = require('./config/database');
  const bcrypt = require('bcryptjs');
  const db = getDB();
  const adminCount = db.prepare("SELECT COUNT(*) as c FROM staff WHERE role = 'admin'").get();
  if (adminCount.c > 0) {
    return res.status(403).json({ error: '管理者が既に存在します。このAPIは使えません。' });
  }
  const tx = db.transaction(() => {
    const sid = store_id || 'STORE001';
    const sname = store_name || '本店';
    db.prepare('INSERT OR IGNORE INTO stores (id, name) VALUES (?, ?)').run(sid, sname);
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO staff (id, store_id, name, password_hash, role) VALUES (?, ?, ?, ?, ?)').run(id, sid, name, hash, 'admin');
  });
  tx();
  res.json({ success: true, message: '管理者アカウントを作成しました。/admin.html からログインしてください。' });
});

// ヘルスチェック
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// SPA フォールバック
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===== DB マイグレーション（テーブル作成のみ、データ挿入なし） =====
const { runMigrations } = require('./config/migrate');
runMigrations();

// ===== サーバー起動 =====
app.listen(PORT, () => {
  console.log(`\n🚀 Staff Report Server 起動`);
  console.log(`   URL: http://localhost:${PORT}`);
  console.log(`   環境: ${process.env.NODE_ENV || 'development'}\n`);

  // スケジューラー起動
  if (process.env.NODE_ENV !== 'test') {
    const { startScheduler } = require('./services/scheduler');
    startScheduler();
  }
});

module.exports = app;
