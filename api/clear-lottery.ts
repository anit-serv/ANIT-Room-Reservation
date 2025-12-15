import { VercelRequest, VercelResponse } from '@vercel/node';
import * as admin from 'firebase-admin';
import 'dotenv/config';

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
  const { key, date } = req.query;
  if (key !== process.env.CRON_SECRET) {
    return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  }

  // 日付パラメータのチェック
  if (!date || typeof date !== 'string') {
    return res.status(400).json({ 
      status: 'error', 
      message: 'Date parameter is required. Use format: YYYY-MM-DD' 
    });
  }

  // 日付フォーマットの検証
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(date)) {
    return res.status(400).json({ 
      status: 'error', 
      message: 'Invalid date format. Use YYYY-MM-DD.' 
    });
  }

  try {
    console.log(`Clearing lottery results for date: ${date}`);

    // -----------------------------------------------------
    // 1. 指定日付の予約データから抽選情報を削除
    // -----------------------------------------------------
    const snapshot = await db.collection('reservations')
      .where('lotteryDate', '==', date)
      .get();

    const batch = db.batch();
    let clearedCount = 0;

    snapshot.forEach((doc) => {
      const ref = db.collection('reservations').doc(doc.id);
      // 抽選関連のフィールドを削除（FieldValue.delete()を使用）
      batch.update(ref, {
        lotteryRank: admin.firestore.FieldValue.delete(),
        lotteryTotal: admin.firestore.FieldValue.delete(),
        lotteryDate: admin.firestore.FieldValue.delete(),
      });
      clearedCount++;
    });

    // -----------------------------------------------------
    // 2. lottery_results コレクションから該当ドキュメントを削除
    // -----------------------------------------------------
    const resultRef = db.collection('lottery_results').doc(date);
    const resultDoc = await resultRef.get();
    
    let resultDeleted = false;
    if (resultDoc.exists) {
      batch.delete(resultRef);
      resultDeleted = true;
    }

    // 3. バッチ実行
    if (clearedCount > 0 || resultDeleted) {
      await batch.commit();
    }

    return res.status(200).json({
      status: 'success',
      date: date,
      reservationsCleared: clearedCount,
      lotteryResultDeleted: resultDeleted,
      message: `Lottery results cleared for ${date}.`,
    });

  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ status: 'error', error: error.message });
  }
}
