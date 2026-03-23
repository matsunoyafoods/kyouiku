const cron = require('node-cron');
const { sendMonthlyReminder, sendMonthlySummary } = require('./line');

/**
 * 月末自動配信スケジューラー
 *
 * スケジュール:
 * 1. 毎月25日 10:00 — 1回目リマインダー（締切5日前）
 * 2. 毎月28日 10:00 — 2回目リマインダー（締切間近）
 * 3. 毎月最終日 18:00 — 月次サマリー配信
 */
function startScheduler() {
  // --- 1回目リマインダー: 毎月25日 10:00 ---
  cron.schedule('0 10 25 * *', async () => {
    console.log('⏰ [スケジューラー] 1回目リマインダー配信開始');
    try {
      await sendMonthlyReminder();
    } catch (err) {
      console.error('❌ リマインダー配信エラー:', err.message);
    }
  }, { timezone: 'Asia/Tokyo' });

  // --- 2回目リマインダー: 毎月28日 10:00 ---
  cron.schedule('0 10 28 * *', async () => {
    console.log('⏰ [スケジューラー] 2回目リマインダー配信開始');
    try {
      await sendMonthlyReminder();
    } catch (err) {
      console.error('❌ リマインダー配信エラー:', err.message);
    }
  }, { timezone: 'Asia/Tokyo' });

  // --- 月次サマリー: 毎月最終日を判定して18:00に配信 ---
  // 28〜31日の18:00にチェックし、その日が月末ならサマリー配信
  cron.schedule('0 18 28-31 * *', async () => {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    if (now.getDate() === lastDay) {
      console.log('⏰ [スケジューラー] 月次サマリー配信開始');
      try {
        await sendMonthlySummary();
      } catch (err) {
        console.error('❌ サマリー配信エラー:', err.message);
      }
    }
  }, { timezone: 'Asia/Tokyo' });

  console.log('📅 スケジューラー起動完了');
  console.log('   - リマインダー1回目: 毎月25日 10:00 JST');
  console.log('   - リマインダー2回目: 毎月28日 10:00 JST');
  console.log('   - 月次サマリー: 毎月最終日 18:00 JST');
}

module.exports = { startScheduler };
