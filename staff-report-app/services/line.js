const line = require('@line/bot-sdk');
const { getDB } = require('../config/database');

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
});

/**
 * 店舗のLINEグループにメッセージ送信
 */
async function sendToStoreGroup(storeId, messages) {
  const db = getDB();
  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(storeId);

  if (!store || !store.line_group_id) {
    console.warn(`⚠️ 店舗 ${storeId} のLINEグループIDが未設定です`);
    return false;
  }

  try {
    await client.pushMessage({
      to: store.line_group_id,
      messages: Array.isArray(messages) ? messages : [messages],
    });
    console.log(`📨 LINE送信成功: ${store.name} (${storeId})`);
    return true;
  } catch (err) {
    console.error(`❌ LINE送信失敗: ${store.name}`, err.message);
    return false;
  }
}

/**
 * 月末リマインダー: 未提出スタッフに提出を促す
 */
async function sendMonthlyReminder() {
  const db = getDB();
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthLabel = `${now.getFullYear()}年${now.getMonth() + 1}月`;

  const stores = db.prepare('SELECT * FROM stores WHERE line_group_id IS NOT NULL').all();

  for (const store of stores) {
    // この店舗の未提出スタッフを取得
    const unsubmitted = db.prepare(`
      SELECT s.name FROM staff s
      WHERE s.store_id = ? AND s.is_active = 1
      AND s.id NOT IN (
        SELECT staff_id FROM reports WHERE year_month = ?
      )
    `).all(store.id, yearMonth);

    const totalStaff = db.prepare(`
      SELECT COUNT(*) as count FROM staff WHERE store_id = ? AND is_active = 1
    `).get(store.id);

    const submittedCount = totalStaff.count - unsubmitted.length;

    if (unsubmitted.length === 0) {
      // 全員提出済み
      await sendToStoreGroup(store.id, {
        type: 'text',
        text: `🎉 ${monthLabel}分レポート\n\n${store.name}は全員提出完了です！\nお疲れ様でした。\n\n提出: ${submittedCount}/${totalStaff.count}名`,
      });
    } else {
      // 未提出者あり
      const names = unsubmitted.map(s => `・${s.name}`).join('\n');
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const daysLeft = lastDay - now.getDate();

      await sendToStoreGroup(store.id, {
        type: 'text',
        text: [
          `📋 ${monthLabel}分 月次レポート`,
          ``,
          `${store.name}の提出状況:`,
          `提出済み: ${submittedCount}/${totalStaff.count}名`,
          ``,
          `⏰ 締切まであと ${daysLeft}日`,
          ``,
          `【未提出】`,
          names,
          ``,
          `レポートはアプリから提出できます。`,
          `お忙しいところ恐れ入りますが、月末までにご提出ください🙏`,
        ].join('\n'),
      });
    }

    // 配信ログ記録
    db.prepare(`
      INSERT INTO line_notifications (store_id, year_month, message_type, status, sent_at)
      VALUES (?, ?, 'reminder', 'sent', datetime('now'))
    `).run(store.id, yearMonth);
  }

  console.log(`📨 月末リマインダー配信完了 (${stores.length}店舗)`);
}

/**
 * AI評価完了後、個人結果のサマリーをグループに投稿
 */
async function sendFeedbackNotification(staffId, reportId) {
  const db = getDB();

  const staff = db.prepare(`
    SELECT s.*, st.name as store_name FROM staff s
    JOIN stores st ON s.store_id = st.id WHERE s.id = ?
  `).get(staffId);

  const feedback = db.prepare('SELECT * FROM feedbacks WHERE report_id = ?').get(reportId);
  if (!staff || !feedback) return;

  const scoreBar = (score) => {
    const filled = Math.round(score);
    return '★'.repeat(filled) + '☆'.repeat(5 - filled);
  };

  await sendToStoreGroup(staff.store_id, {
    type: 'text',
    text: [
      `📊 AI評価レポート`,
      ``,
      `${staff.name}さんの月次評価が完了しました`,
      ``,
      `総合スコア: ${feedback.total_score}/5.0`,
      `${scoreBar(feedback.total_score)}`,
      ``,
      `自責思考: ${feedback.score_self_responsibility}`,
      `解決能力: ${feedback.score_problem_solving}`,
      `主体性: ${feedback.score_initiative}`,
      `ｵｰﾅｰｼｯﾌﾟ: ${feedback.score_ownership}`,
      ``,
      `詳細はアプリで確認できます📱`,
    ].join('\n'),
  });
}

/**
 * 月末に店舗ごとの集計サマリーを配信
 */
async function sendMonthlySummary() {
  const db = getDB();
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthLabel = `${now.getFullYear()}年${now.getMonth() + 1}月`;

  const stores = db.prepare('SELECT * FROM stores WHERE line_group_id IS NOT NULL').all();

  for (const store of stores) {
    const stats = db.prepare(`
      SELECT
        COUNT(f.id) as feedback_count,
        ROUND(AVG(f.total_score), 1) as avg_score,
        MAX(f.total_score) as max_score,
        MIN(f.total_score) as min_score
      FROM feedbacks f
      JOIN reports r ON f.report_id = r.id
      WHERE r.store_id = ? AND r.year_month = ?
    `).get(store.id, yearMonth);

    if (!stats || stats.feedback_count === 0) continue;

    // 前月比較
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevYM = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;
    const prevStats = db.prepare(`
      SELECT ROUND(AVG(f.total_score), 1) as avg_score
      FROM feedbacks f JOIN reports r ON f.report_id = r.id
      WHERE r.store_id = ? AND r.year_month = ?
    `).get(store.id, prevYM);

    const diff = prevStats?.avg_score
      ? (stats.avg_score - prevStats.avg_score).toFixed(1)
      : null;
    const diffText = diff ? (diff > 0 ? `↑+${diff}` : `↓${diff}`) : '(前月データなし)';

    await sendToStoreGroup(store.id, {
      type: 'text',
      text: [
        `📈 ${monthLabel} ${store.name} 月次サマリー`,
        ``,
        `評価完了: ${stats.feedback_count}名`,
        `平均スコア: ${stats.avg_score}/5.0 ${diffText}`,
        `最高: ${stats.max_score} / 最低: ${stats.min_score}`,
        ``,
        `皆さんお疲れ様でした！`,
        `来月もさらなる成長を目指しましょう💪`,
      ].join('\n'),
    });

    db.prepare(`
      INSERT INTO line_notifications (store_id, year_month, message_type, status, sent_at)
      VALUES (?, ?, 'summary', 'sent', datetime('now'))
    `).run(store.id, yearMonth);
  }

  console.log(`📊 月次サマリー配信完了`);
}

module.exports = {
  sendToStoreGroup,
  sendMonthlyReminder,
  sendFeedbackNotification,
  sendMonthlySummary,
};
