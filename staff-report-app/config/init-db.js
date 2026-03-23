/**
 * データベース初期化スクリプト
 * 実行: npm run db:init
 */
require('dotenv').config();
const { getDB } = require('./database');
const bcrypt = require('bcryptjs');

const db = getDB();

// ===== テーブル作成 =====
db.exec(`
  -- 店舗マスタ
  CREATE TABLE IF NOT EXISTS stores (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    line_group_id   TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
  );

  -- スタッフマスタ
  CREATE TABLE IF NOT EXISTS staff (
    id              TEXT PRIMARY KEY,
    store_id        TEXT NOT NULL REFERENCES stores(id),
    name            TEXT NOT NULL,
    email           TEXT UNIQUE,
    password_hash   TEXT NOT NULL,
    role            TEXT DEFAULT 'staff' CHECK(role IN ('staff','manager','admin')),
    is_active       INTEGER DEFAULT 1,
    created_at      TEXT DEFAULT (datetime('now'))
  );

  -- 月次レポート
  CREATE TABLE IF NOT EXISTS reports (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id        TEXT NOT NULL REFERENCES staff(id),
    store_id        TEXT NOT NULL REFERENCES stores(id),
    year_month      TEXT NOT NULL,  -- '2025-03' 形式
    q1_failure      TEXT,
    q2_self_cause   TEXT,
    q3_action       TEXT,
    q4_initiative   TEXT,
    q5_ownership    TEXT,
    q6_next_goal    TEXT,
    submitted_at    TEXT DEFAULT (datetime('now')),
    UNIQUE(staff_id, year_month)
  );

  -- AI評価フィードバック
  CREATE TABLE IF NOT EXISTS feedbacks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id       INTEGER NOT NULL REFERENCES reports(id),
    staff_id        TEXT NOT NULL REFERENCES staff(id),
    score_self_responsibility  REAL,  -- 自責思考
    score_problem_solving      REAL,  -- 解決能力
    score_initiative           REAL,  -- 主体性
    score_ownership            REAL,  -- オーナーシップ
    total_score                REAL,
    comment_overall    TEXT,  -- 総合コメント
    good_points        TEXT,  -- JSON配列
    improvement_points TEXT,  -- JSON配列
    next_action        TEXT,  -- 来月アクション
    generated_at       TEXT DEFAULT (datetime('now'))
  );

  -- LINE配信ログ
  CREATE TABLE IF NOT EXISTS line_notifications (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id        TEXT NOT NULL REFERENCES stores(id),
    year_month      TEXT NOT NULL,
    message_type    TEXT NOT NULL,  -- 'reminder', 'summary', 'feedback'
    status          TEXT DEFAULT 'pending',
    sent_at         TEXT,
    error_message   TEXT
  );

  -- スコア履歴ビュー用インデックス
  CREATE INDEX IF NOT EXISTS idx_feedbacks_staff ON feedbacks(staff_id);
  CREATE INDEX IF NOT EXISTS idx_reports_yearmonth ON reports(year_month);
  CREATE INDEX IF NOT EXISTS idx_reports_store ON reports(store_id, year_month);
`);

// ===== サンプルデータ投入 =====
const insertStore = db.prepare(`
  INSERT OR IGNORE INTO stores (id, name, line_group_id) VALUES (?, ?, ?)
`);

const insertStaff = db.prepare(`
  INSERT OR IGNORE INTO staff (id, store_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)
`);

const sampleStores = [
  ['STORE001', '渋谷本店', process.env.LINE_GROUP_STORE001 || null],
  ['STORE002', '新宿店', process.env.LINE_GROUP_STORE002 || null],
  ['STORE003', '池袋店', process.env.LINE_GROUP_STORE003 || null],
];

const passwordHash = bcrypt.hashSync('password123', 10);

const sampleStaff = [
  ['tanaka_kenji', 'STORE001', '田中 健二', 'tanaka@shop.com', passwordHash, 'staff'],
  ['suzuki_yui', 'STORE001', '鈴木 結衣', 'suzuki@shop.com', passwordHash, 'staff'],
  ['yamada_taro', 'STORE002', '山田 太郎', 'yamada@shop.com', passwordHash, 'manager'],
  ['admin001', 'STORE001', '管理者', 'admin@shop.com', bcrypt.hashSync('admin123', 10), 'admin'],
];

const tx = db.transaction(() => {
  sampleStores.forEach(s => insertStore.run(...s));
  sampleStaff.forEach(s => insertStaff.run(...s));
});

tx();

console.log('✅ データベースを初期化しました');
console.log(`   店舗数: ${sampleStores.length}`);
console.log(`   スタッフ数: ${sampleStaff.length}`);
console.log(`   DB: ${require('path').join(__dirname, '..', 'data', 'staff_report.db')}`);
