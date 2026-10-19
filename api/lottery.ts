import { VercelRequest, VercelResponse } from '@vercel/node';
import * as admin from 'firebase-admin';
import {
  isDateAvailableBySettings,
  resolveReservationSettingsForDate,
} from '../lib/reservationSettings';
import 'dotenv/config';
import { lotteryTargetDate } from '../lib/lotteryOperation';

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

// 配列をシャッフルする関数
function shuffleArray<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// ---------------------------------------------------------
// 2. メイン処理
// ---------------------------------------------------------
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // セキュリティチェック
  const { key, force, date } = req.query;
  if (key !== process.env.CRON_SECRET) {
    return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  }

  // force=true の場合は翌日チェックをスキップ
  const forceExecute = force === 'true';

  try {
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

    console.log(`Running lottery for target date: ${targetDateStr}`);
    const resultRef = db.collection('lottery_results').doc(targetDateStr);
    if (!forceExecute && (await resultRef.get()).exists) {
      return res.status(200).json({ status: 'skipped', message: 'Lottery already completed.', targetDate: targetDateStr });
    }

    // 受付終了後の予約をトランザクション内で読み、キャンセルや同時実行と競合させない。
    const pendingQuery = db.collection('reservations')
      .where('status', '==', 'pending')
      .where('date', '>=', `${targetDateStr}T00:00`)
      .where('date', '<=', `${targetDateStr}T23:59`);

    const outcome = await db.runTransaction(async (tx) => {
      if (!forceExecute && (await tx.get(resultRef)).exists) return { status: 'already', processed: 0 };
      const snapshot = await tx.get(pendingQuery);
      if (snapshot.empty) return { status: 'empty', processed: 0 };

      const grouped: Record<string, FirebaseFirestore.QueryDocumentSnapshot[]> = {};
      snapshot.forEach((doc) => {
        const timeSlot = doc.data().date.split('T')[1];
        (grouped[timeSlot] ??= []).push(doc);
      });
      const resultData: any = { updatedAt: new Date(), targetDate: targetDateStr, results: {} };
      let processed = 0;
      for (const [timeSlot, docs] of Object.entries(grouped)) {
        const priority = docs.filter((doc) => doc.data().hamoani === true);
        const ordinary = docs.filter((doc) => doc.data().hamoani !== true);
        const ranked = [...shuffleArray([...priority]), ...shuffleArray([...ordinary])];
        const order: string[] = [];
        const hamoaniBands: string[] = [];
        ranked.forEach((doc, index) => {
          const data = doc.data();
          const bandName = data.bandName || 'バンド名なし';
          tx.update(doc.ref, {
            lotteryRank: index + 1,
            lotteryTotal: ranked.length,
            lotteryDate: targetDateStr,
            status: 'confirmed',
            order: index + 1,
          });
          order.push(bandName);
          if (data.hamoani === true) hamoaniBands.push(bandName);
          processed++;
        });
        resultData.results[timeSlot] = { count: ranked.length, order, hamoaniBands };
      }
      tx.set(resultRef, resultData);
      return { status: 'success', processed };
    });
    if (outcome.status === 'already') return res.status(200).json({ status: 'skipped', message: 'Lottery already completed.', targetDate: targetDateStr });
    if (outcome.status === 'empty') return res.status(200).json({ status: 'success', message: `No pending reservations found for ${targetDateStr}.` });

    return res.status(200).json({
      status: 'success',
      targetDate: targetDateStr,
      processed: outcome.processed,
      message: 'Lottery completed.',
    });

  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ status: 'error', error: error.message });
  }
}
