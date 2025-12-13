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
  const { key } = req.query;
  if (key !== process.env.CRON_SECRET) {
    return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  }

  try {
    // -----------------------------------------------------
    // ★ 日付計算ロジック (ここが重要)
    // -----------------------------------------------------
    // VercelはUTC(世界標準時)なので、JST(日本時間)に変換して計算する
    const now = new Date();
    const jstOffset = 9 * 60 * 60 * 1000;
    const nowJST = new Date(now.getTime() + jstOffset);

    // 「翌日」を計算
    const targetDateJST = new Date(nowJST);
    targetDateJST.setDate(targetDateJST.getDate() + 1);

    // YYYY-MM-DD 形式の文字列を作る (例: "2023-12-21")
    const y = targetDateJST.getFullYear();
    const m = ('0' + (targetDateJST.getMonth() + 1)).slice(-2);
    const d = ('0' + targetDateJST.getDate()).slice(-2);
    const targetDateStr = `${y}-${m}-${d}`;

    console.log(`Running lottery for target date: ${targetDateStr}`);

    // -----------------------------------------------------
    // 1. 翌日の「pending」予約だけを取得
    // -----------------------------------------------------
    // date文字列は "2023-12-21T10:00-12:00" のような形式なので文字列比較で範囲検索
    const snapshot = await db.collection('reservations')
      .where('status', '==', 'pending')
      .where('date', '>=', `${targetDateStr}T00:00`)
      .where('date', '<=', `${targetDateStr}T23:59`)
      .get();

    if (snapshot.empty) {
      return res.status(200).json({ 
        status: 'success', 
        message: `No pending reservations found for ${targetDateStr}.` 
      });
    }

    // -----------------------------------------------------
    // 2. 時間帯ごとにグループ分け
    // -----------------------------------------------------
    // { "10:00-12:00": [予約A, 予約B...], "14:00-16:00": [予約C...] }
    const groupedByTimeSlot: { [timeSlot: string]: FirebaseFirestore.QueryDocumentSnapshot[] } = {};

    snapshot.forEach((doc) => {
      const data = doc.data();
      const [datePart, timePart] = data.date.split('T'); // datePartはtargetDateStrと同じはず

      if (!groupedByTimeSlot[timePart]) {
        groupedByTimeSlot[timePart] = [];
      }
      groupedByTimeSlot[timePart].push(doc);
    });

    // -----------------------------------------------------
    // 3. 抽選(順位決め)と結果保存
    // -----------------------------------------------------
    const batch = db.batch();
    let processedCount = 0;

    // 結果保存用のデータ構造
    const dailyResultData: any = {
      updatedAt: new Date(),
      targetDate: targetDateStr,
      results: {} // "10:00-12:00": { count: 3, order: [...] }
    };

    for (const [timeSlot, docs] of Object.entries(groupedByTimeSlot)) {
      
      // ★ シャッフル実行
      const shuffledDocs = shuffleArray([...docs]);
      
      const rankedList: string[] = [];

      shuffledDocs.forEach((doc, index) => {
        const rank = index + 1;
        const data = doc.data();
        const bandName = data.bandName || 'バンド名なし';
        
        // 予約データのステータスを更新
        const ref = db.collection('reservations').doc(doc.id);
        batch.update(ref, { 
          status: 'determined', 
          lotteryRank: rank,
          lotteryTotal: docs.length,
          lotteryDate: targetDateStr // いつ抽選されたかも記録
        });

        rankedList.push(bandName);
        processedCount++;
      });

      // 集計結果データを作成
      dailyResultData.results[timeSlot] = {
        count: docs.length,
        order: rankedList
      };
    }

    // ★ "lottery_results" に保存 (IDは日付文字列)
    const resultRef = db.collection('lottery_results').doc(targetDateStr);
    batch.set(resultRef, dailyResultData, { merge: true });

    // 4. 書き込み実行
    await batch.commit();

    return res.status(200).json({
      status: 'success',
      targetDate: targetDateStr,
      processed: processedCount,
      message: 'Lottery completed for tomorrow.',
    });

  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ status: 'error', error: error.message });
  }
}
