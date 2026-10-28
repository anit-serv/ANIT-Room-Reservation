import { VercelRequest, VercelResponse } from '@vercel/node';
import * as admin from 'firebase-admin';
import {
  isDateAvailableBySettings,
  resolveReservationSettingsForDate,
} from '../lib/reservationSettings';
import 'dotenv/config';
import { lotteryTargetDate } from '../lib/lotteryOperation';
import { runLotteryForDate } from '../lib/lotteryRunner';
import { runScheduler } from '../lib/scheduler';
import { schedulerEnabled } from '../lib/schedulerQueue';

// ---------------------------------------------------------
// 1. 設定・初期化
// ---------------------------------------------------------
const privateKey = process.env.FIREBASE_PRIVATE_KEY
  ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  : undefined;

if (!admin.apps.length) {
  if (!privateKey) throw new Error('FIREBASE_PRIVATE_KEY is missing');
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey,
    }),
  });
}
const db = admin.firestore();

// ---------------------------------------------------------
// 2. メイン処理
// ---------------------------------------------------------
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // セキュリティチェック
  const { key, force, date } = req.query;
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  }

  // force=true の場合は翌日チェックをスキップ
  const forceExecute = force === 'true';

  try {
    if (schedulerEnabled()) {
      if (forceExecute) return res.status(409).json({ error: 'Force lottery is disabled while the queue is active' })
      return res.status(200).json(await runScheduler(db))
    }
    // -----------------------------------------------------
    // ★ 日付計算ロジック (ここが重要)
    // -----------------------------------------------------
    let targetDateStr: string;

    // force=true で date パラメータが指定されている場合、その日付を使用
    if (forceExecute && date && typeof date === 'string') {
      // YYYY-MM-DD 形式を解析
      const [y, m, d] = date.split('-').map(Number);
      if (isNaN(y) || isNaN(m) || isNaN(d)) {
        return res.status(400).json({ 
          status: 'error', 
          message: 'Invalid date format. Use YYYY-MM-DD.' 
        });
      }
      targetDateStr = date;
    } else {
      const scheduledDate = await lotteryTargetDate(db);
      if (!scheduledDate) return res.status(200).json({ status: 'skipped', message: 'No lottery scheduled today.' });
      targetDateStr = scheduledDate;
    }

    // 翌日が登録可能日かチェック（force=true の場合はスキップ）
    if (!forceExecute) {
      const settings = await resolveReservationSettingsForDate(db, targetDateStr);

      if (!isDateAvailableBySettings(targetDateStr, settings)) {
        return res.status(200).json({ 
          status: 'skipped', 
          message: `${targetDateStr} is not an available day. Skipping lottery.`
        });
      }
    }

    return res.status(200).json(await runLotteryForDate(db, targetDateStr, forceExecute));

  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ status: 'error', error: error.message });
  }
}
