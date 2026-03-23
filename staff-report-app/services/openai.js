const OpenAI = require('openai');
const { getDB } = require('../config/database');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const EVALUATION_PROMPT = `あなたは飲食店スタッフの成長を支援するAI評価者です。
以下のスタッフの月次レポート回答を分析し、4つの観点で5段階スコアとフィードバックを生成してください。

## 評価軸（各1.0〜5.0、小数第1位まで）
1. **自責思考** — 失敗の原因を他人や環境のせいにせず、自分の行動パターンとして捉えられているか
2. **解決能力** — 問題に対して具体的・実効性のある対応策を考え実行できているか
3. **主体性** — 指示を待たず自発的に行動できているか
4. **オーナーシップ** — 自分の担当範囲を超えて店全体のことを考えて行動できているか

## 出力形式（必ずこのJSON形式で）
{
  "score_self_responsibility": 4.2,
  "score_problem_solving": 3.8,
  "score_initiative": 4.5,
  "score_ownership": 4.0,
  "total_score": 4.1,
  "comment_overall": "総合コメント（150〜250字）",
  "good_points": ["良い点1（50〜100字）", "良い点2（50〜100字）"],
  "improvement_points": ["改善点1（50〜100字）"],
  "next_action": "来月の具体的アクション（50〜100字）"
}

## 評価のガイドライン
- 厳しすぎず甘すぎない、成長を促すフィードバックを心がけてください
- 具体的なエピソードに言及して、「ちゃんと読んでくれている」と感じさせてください
- total_score は4軸の単純平均を小数第1位に丸めてください
- 日本語で回答してください`;

/**
 * レポートのAI評価を生成してDBに保存
 */
async function generateFeedback(reportId, staffId) {
  const db = getDB();

  // レポート内容を取得
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
  if (!report) throw new Error('レポートが見つかりません');

  // スタッフ名取得
  const staff = db.prepare('SELECT name FROM staff WHERE id = ?').get(staffId);

  // 前月のフィードバック（成長比較用）
  const prevFeedback = db.prepare(`
    SELECT f.total_score, f.next_action
    FROM feedbacks f
    JOIN reports r ON f.report_id = r.id
    WHERE f.staff_id = ? AND r.year_month < ?
    ORDER BY r.year_month DESC LIMIT 1
  `).get(staffId, report.year_month);

  const userMessage = `
## スタッフ情報
- 名前: ${staff?.name || '匿名'}
- 対象月: ${report.year_month}
${prevFeedback ? `- 前回スコア: ${prevFeedback.total_score}/5.0` : '- 前回データ: なし（初回）'}
${prevFeedback?.next_action ? `- 前回のアクション目標: ${prevFeedback.next_action}` : ''}

## 回答内容
**Q1. 今月一番の失敗は何でしたか？**
${report.q1_failure}

**Q2. その原因は自分のどんな点でしたか？**
${report.q2_self_cause}

**Q3. その問題に対してどう行動しましたか？**
${report.q3_action}

**Q4. 指示されずに自分から動いたことは？**
${report.q4_initiative}

**Q5. 店をより良くするためにやったことは？**
${report.q5_ownership}

**Q6. 来月、必ず改善することを1つ教えてください**
${report.q6_next_goal}
`;

  console.log(`🤖 AI評価を生成中... (report_id: ${reportId})`);

  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    messages: [
      { role: 'system', content: EVALUATION_PROMPT },
      { role: 'user', content: userMessage },
    ],
    temperature: 0.7,
    response_format: { type: 'json_object' },
  });

  const content = completion.choices[0].message.content;
  let feedback;
  try {
    feedback = JSON.parse(content);
  } catch (e) {
    throw new Error(`AI応答のJSON解析エラー: ${e.message}`);
  }

  // DBに保存
  db.prepare(`
    INSERT INTO feedbacks (
      report_id, staff_id,
      score_self_responsibility, score_problem_solving,
      score_initiative, score_ownership, total_score,
      comment_overall, good_points, improvement_points, next_action
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    reportId,
    staffId,
    feedback.score_self_responsibility,
    feedback.score_problem_solving,
    feedback.score_initiative,
    feedback.score_ownership,
    feedback.total_score,
    feedback.comment_overall,
    JSON.stringify(feedback.good_points),
    JSON.stringify(feedback.improvement_points),
    feedback.next_action
  );

  console.log(`✅ AI評価完了 (report_id: ${reportId}, score: ${feedback.total_score})`);
  return feedback;
}

module.exports = { generateFeedback };
