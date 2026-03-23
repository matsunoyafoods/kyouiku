const express = require('express');
const router = express.Router();
const { getDB } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// 全APIで認証必須
router.use(authMiddleware);

// GET /api/reports/status — 今月の提出状況
router.get('/status', (req, res) => {
  const db = getDB();
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const report = db.prepare(`
    SELECT id, submitted_at FROM reports
    WHERE staff_id = ? AND year_month = ?
  `).get(req.user.staff_id, yearMonth);

  // 前月のスコア
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevYM = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;

  const prevFeedback = db.prepare(`
    SELECT f.* FROM feedbacks f
    JOIN reports r ON f.report_id = r.id
    WHERE f.staff_id = ? AND r.year_month = ?
  `).get(req.user.staff_id, prevYM);

  // スコア推移（直近6ヶ月）
  const scoreHistory = db.prepare(`
    SELECT r.year_month, f.total_score
    FROM feedbacks f
    JOIN reports r ON f.report_id = r.id
    WHERE f.staff_id = ?
    ORDER BY r.year_month DESC LIMIT 6
  `).all(req.user.staff_id).reverse();

  // 締切日計算（月末）
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = lastDay - now.getDate();

  res.json({
    current_month: yearMonth,
    is_submitted: !!report,
    submitted_at: report?.submitted_at || null,
    days_left: daysLeft,
    prev_feedback: prevFeedback ? {
      score_self_responsibility: prevFeedback.score_self_responsibility,
      score_problem_solving: prevFeedback.score_problem_solving,
      score_initiative: prevFeedback.score_initiative,
      score_ownership: prevFeedback.score_ownership,
      total_score: prevFeedback.total_score,
    } : null,
    score_history: scoreHistory,
  });
});

// POST /api/reports/submit — レポート提出
router.post('/submit', (req, res) => {
  const { q1, q2, q3, q4, q5, q6 } = req.body;

  // バリデーション
  const answers = [q1, q2, q3, q4, q5, q6];
  for (let i = 0; i < answers.length; i++) {
    if (!answers[i] || answers[i].trim().length < 10) {
      return res.status(400).json({
        error: `質問${i + 1}の回答が短すぎます（10文字以上）`,
      });
    }
  }

  const db = getDB();
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // 重複チェック
  const existing = db.prepare(`
    SELECT id FROM reports WHERE staff_id = ? AND year_month = ?
  `).get(req.user.staff_id, yearMonth);

  if (existing) {
    return res.status(409).json({ error: '今月のレポートは既に提出済みです' });
  }

  const result = db.prepare(`
    INSERT INTO reports (staff_id, store_id, year_month, q1_failure, q2_self_cause, q3_action, q4_initiative, q5_ownership, q6_next_goal)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.user.staff_id,
    req.user.store_id,
    yearMonth,
    q1.trim(), q2.trim(), q3.trim(), q4.trim(), q5.trim(), q6.trim()
  );

  // AI評価をバックグラウンドで開始
  const { generateFeedback } = require('../services/openai');
  generateFeedback(result.lastInsertRowid, req.user.staff_id).catch(err => {
    console.error('AI評価エラー:', err.message);
  });

  res.json({
    success: true,
    report_id: result.lastInsertRowid,
    message: 'レポートを提出しました。AI評価は24時間以内に届きます。',
  });
});

// GET /api/reports/feedback/:yearMonth — フィードバック取得
router.get('/feedback/:yearMonth', (req, res) => {
  const db = getDB();
  const { yearMonth } = req.params;

  const report = db.prepare(`
    SELECT id FROM reports WHERE staff_id = ? AND year_month = ?
  `).get(req.user.staff_id, yearMonth);

  if (!report) {
    return res.status(404).json({ error: '該当月のレポートが見つかりません' });
  }

  const feedback = db.prepare(`
    SELECT * FROM feedbacks WHERE report_id = ?
  `).get(report.id);

  if (!feedback) {
    return res.json({ status: 'processing', message: 'AI評価を生成中です...' });
  }

  res.json({
    status: 'complete',
    feedback: {
      score_self_responsibility: feedback.score_self_responsibility,
      score_problem_solving: feedback.score_problem_solving,
      score_initiative: feedback.score_initiative,
      score_ownership: feedback.score_ownership,
      total_score: feedback.total_score,
      comment_overall: feedback.comment_overall,
      good_points: JSON.parse(feedback.good_points || '[]'),
      improvement_points: JSON.parse(feedback.improvement_points || '[]'),
      next_action: feedback.next_action,
      generated_at: feedback.generated_at,
    },
  });
});

// GET /api/reports/history — 過去のレポート一覧
router.get('/history', (req, res) => {
  const db = getDB();
  const reports = db.prepare(`
    SELECT r.id, r.year_month, r.submitted_at,
           f.total_score, f.generated_at as feedback_at
    FROM reports r
    LEFT JOIN feedbacks f ON f.report_id = r.id
    WHERE r.staff_id = ?
    ORDER BY r.year_month DESC
    LIMIT 12
  `).all(req.user.staff_id);

  res.json({ reports });
});

module.exports = router;
