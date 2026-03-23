require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
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
app.post('/api/line/webhook', (req, res) => {
  const events = req.body.events || [];
  for (const event of events) {
    if (event.type === 'join' && event.source.type === 'group') {
      console.log(`🔗 LINE グループ参加: groupId = ${event.source.groupId}`);
      console.log('   このIDを.envのLINE_GROUP_XXXに設定してください');
    }
  }
  res.json({ status: 'ok' });
});

// ヘルスチェック
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// SPA フォールバック
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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
