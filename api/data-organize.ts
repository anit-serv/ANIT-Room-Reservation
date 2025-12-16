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
  const { key, days } = req.query;
  if (key !== process.env.CRON_SECRET) {
    return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  }

  try {
    // 削除対象の日数（デフォルト: 7日前）
    const daysToKeep = days && typeof days === 'string' ? parseInt(days, 10) : 7;

    // 基準日を計算（JST）
    const now = new Date();
    const jstOffset = 9 * 60 * 60 * 1000;
    const nowJST = new Date(now.getTime() + jstOffset);
    const cutoffDateJST = new Date(nowJST);
    cutoffDateJST.setDate(cutoffDateJST.getDate() - daysToKeep);
    
    const cutoffDateStr = `${cutoffDateJST.getFullYear()}-${('0' + (cutoffDateJST.getMonth() + 1)).slice(-2)}-${('0' + cutoffDateJST.getDate()).slice(-2)}`;

    console.log(`Cleaning up data older than: ${cutoffDateStr} (${daysToKeep} days ago)`);

    // ---------------------------------------------------------
    // 1. 古い予約データを削除（reservations）
    // ---------------------------------------------------------
    const reservationsSnapshot = await db.collection('reservations')
      .where('date', '<', `${cutoffDateStr}T00:00`)
      .get();

    let deletedReservations = 0;
    
    if (!reservationsSnapshot.empty) {
      // バッチ処理で削除（Firestoreのバッチは最大500件）
      const batches: admin.firestore.WriteBatch[] = [];
      let currentBatch = db.batch();
      let operationCount = 0;

      reservationsSnapshot.forEach((doc) => {
        currentBatch.delete(doc.ref);
        operationCount++;

        // 500件ごとに新しいバッチを作成
        if (operationCount === 500) {
          batches.push(currentBatch);
          currentBatch = db.batch();
          operationCount = 0;
        }
      });

      // 残りの操作があればバッチに追加
      if (operationCount > 0) {
        batches.push(currentBatch);
      }

      // すべてのバッチを実行
      for (const batch of batches) {
        await batch.commit();
      }

      deletedReservations = reservationsSnapshot.size;
    }

    // ---------------------------------------------------------
    // 2. 古い抽選結果を削除（lottery_results）
    // ---------------------------------------------------------
    const lotteryResultsSnapshot = await db.collection('lottery_results').get();

    let deletedLotteryResults = 0;
    const lotteryBatches: admin.firestore.WriteBatch[] = [];
    let lotteryBatch = db.batch();
    let lotteryOperationCount = 0;

    lotteryResultsSnapshot.forEach((doc) => {
      const docId = doc.id; // YYYY-MM-DD 形式
      
      // 日付文字列を比較
      if (docId < cutoffDateStr) {
        lotteryBatch.delete(doc.ref);
        lotteryOperationCount++;
        deletedLotteryResults++;

        // 500件ごとに新しいバッチを作成
        if (lotteryOperationCount === 500) {
          lotteryBatches.push(lotteryBatch);
          lotteryBatch = db.batch();
          lotteryOperationCount = 0;
        }
      }
    });

    // 残りの操作があればバッチに追加
    if (lotteryOperationCount > 0) {
      lotteryBatches.push(lotteryBatch);
    }

    // すべてのバッチを実行
    for (const batch of lotteryBatches) {
      await batch.commit();
    }

    // ---------------------------------------------------------
    // 3. 古いユーザー状態を削除（states）
    //    実行時より5分以上前の操作を含むものを削除
    //    ※ ボタンの有効期限が5分なので、5分以上前の履歴は全て不要
    // ---------------------------------------------------------
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000); // 5分前のタイムスタンプ
    const statesSnapshot = await db.collection('states').get();

    let deletedStates = 0;
    const statesBatches: admin.firestore.WriteBatch[] = [];
    let statesBatch = db.batch();
    let statesOperationCount = 0;

    statesSnapshot.forEach((doc) => {
      const data = doc.data();
      
      // 全てのタイムスタンプフィールドをチェック
      const timestamps: number[] = [];

      // createdAt（Timestamp型）
      if (data.createdAt) {
        timestamps.push(data.createdAt.toMillis());
      }

      // number型のタイムスタンプフィールド
      if (data.quickReplyStartTime && typeof data.quickReplyStartTime === 'number') {
        timestamps.push(data.quickReplyStartTime);
      }
      if (data.lastButtonPressTs && typeof data.lastButtonPressTs === 'number') {
        timestamps.push(data.lastButtonPressTs);
      }
      if (data.lastViewMyCarouselTs && typeof data.lastViewMyCarouselTs === 'number') {
        timestamps.push(data.lastViewMyCarouselTs);
      }

      // 全てのタイムスタンプが5分以上前（または存在しない）なら削除
      const hasRecentActivity = timestamps.some(ts => ts >= fiveMinutesAgo);

      if (!hasRecentActivity) {
        statesBatch.delete(doc.ref);
        statesOperationCount++;
        deletedStates++;

        // 500件ごとに新しいバッチを作成
        if (statesOperationCount === 500) {
          statesBatches.push(statesBatch);
          statesBatch = db.batch();
          statesOperationCount = 0;
        }
      }
    });

    // 残りの操作があればバッチに追加
    if (statesOperationCount > 0) {
      statesBatches.push(statesBatch);
    }

    // すべてのバッチを実行
    for (const batch of statesBatches) {
      await batch.commit();
    }

    return res.status(200).json({
      status: 'success',
      message: 'Data cleanup completed.',
      cutoffDate: cutoffDateStr,
      deleted: {
        reservations: deletedReservations,
        lotteryResults: deletedLotteryResults,
        states: deletedStates,
        total: deletedReservations + deletedLotteryResults + deletedStates
      }
    });

  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ status: 'error', error: error.message });
  }
}
