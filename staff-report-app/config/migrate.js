/**
 * テーブル自動作成（データは挿入しない）
 * サーバー起動時に毎回呼ばれる。既存テーブルがあればスキップ。
 */
const { getDB } = require('./database');

function runMigrations() {
  const db = getDB();

  db.exec(`
    CREATE TABLE IF NOT EXISTS stores (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      line_group_id   TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    );

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

    CREATE TABLE IF NOT EXISTS reports (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id        TEXT NOT NULL REFERENCES staff(id),
      store_id        TEXT NOT NULL REFERENCES stores(id),
      year_month      TEXT NOT NULL,
      q1_failure      TEXT,
      q2_self_cause   TEXT,
      q3_action       TEXT,
      q4_initiative   TEXT,
      q5_ownership    TEXT,
      q6_next_goal    TEXT,
      submitted_at    TEXT DEFAULT (datetime('now')),
      UNIQUE(staff_id, year_month)
    );

    CREATE TABLE IF NOT EXISTS feedbacks (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id       INTEGER NOT NULL REFERENCES reports(id),
      staff_id        TEXT NOT NULL REFERENCES staff(id),
      score_self_responsibility  REAL,
      score_problem_solving      REAL,
      score_initiative           REAL,
      score_ownership            REAL,
      total_score                REAL,
      comment_overall    TEXT,
      good_points        TEXT,
      improvement_points TEXT,
      next_action        TEXT,
      generated_at       TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS line_notifications (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id        TEXT NOT NULL REFERENCES stores(id),
      year_month      TEXT NOT NULL,
      message_type    TEXT NOT NULL,
      status          TEXT DEFAULT 'pending',
      sent_at         TEXT,
      error_message   TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_feedbacks_staff ON feedbacks(staff_id);
    CREATE INDEX IF NOT EXISTS idx_reports_yearmonth ON reports(year_month);
    CREATE INDEX IF NOT EXISTS idx_reports_store ON reports(store_id, year_month);
  `);

  console.log('📦 データベース準備完了');
}

module.exports = { runMigrations };
