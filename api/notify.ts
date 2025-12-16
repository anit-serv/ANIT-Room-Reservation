import { VercelRequest, VercelResponse } from '@vercel/node';
import * as admin from 'firebase-admin';
import axios from 'axios'; // BAND APIを叩くために必要
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

  try {
    // 1. 通知対象の日付（明日）を計算
    // ※ dateパラメータがあればそれを使用（テスト用）
    let targetDateStr: string;

    if (date && typeof date === 'string') {
      targetDateStr = date;
    } else {
      const now = new Date();
      const jstOffset = 9 * 60 * 60 * 1000;
      const nowJST = new Date(now.getTime() + jstOffset);
      const targetDateJST = new Date(nowJST);
      targetDateJST.setDate(targetDateJST.getDate() + 1); // 翌日
      
      const y = targetDateJST.getFullYear();
      const m = ('0' + (targetDateJST.getMonth() + 1)).slice(-2);
      const d = ('0' + targetDateJST.getDate()).slice(-2);
      targetDateStr = `${y}-${m}-${d}`;
    }

    console.log(`Checking lottery results for: ${targetDateStr}`);

    // 2. Firestoreから抽選結果を取得
    const resultDoc = await db.collection('lottery_results').doc(targetDateStr).get();

    if (!resultDoc.exists) {
      return res.status(200).json({ 
        status: 'skipped', 
        message: `No lottery results found for ${targetDateStr}.` 
      });
    }

    const data = resultDoc.data();
    const results = data?.results || {};

    // 結果がない場合（空の日）
    if (Object.keys(results).length === 0) {
      return res.status(200).json({ status: 'skipped', message: 'No entries found.' });
    }

    // 3. 投稿メッセージを作成
    const displayDate = targetDateStr.replace(/-/g, '/').slice(5); // 12/21
    const weekDays = ['日', '月', '火', '水', '木', '金', '土'];
    const dateObj = new Date(targetDateStr);
    const wd = weekDays[dateObj.getDay()];

    let message = `📢 【部屋取り抽選結果】＜${displayDate}(${wd})＞\n\n`;
    
    // 抽選結果から時間帯を取得してソート
    const timeSlots = Object.keys(results).sort();

    let hasContent = false;

    for (const timeSlot of timeSlots) {
      const slotData = results[timeSlot];
      const bands: string[] = slotData.order || [];
      
      if (bands.length > 0) {
        hasContent = true;
        message += `【${timeSlot}】\n`;
        bands.forEach((bandName, index) => {
          message += `${index + 1}. ${bandName}\n`;
        });
        message += `\n`;
      }
    }

    if (!hasContent) {
      return res.status(200).json({ status: 'skipped', message: 'No bands to notify.' });
    }

    message += `------------------\n`;
    message += `※詳細はLINE ANIT部屋取りシステム【全登録一覧】からも確認できます。`;

    // 4. BAND APIに投稿
    const bandAccessToken = process.env.BAND_ACCESS_TOKEN;
    const bandKey = process.env.BAND_KEY;

    if (!bandAccessToken || !bandKey) {
      throw new Error('BAND API credentials are missing.');
    }

    // BAND API: 投稿作成 (v2.2)
    // 公式ドキュメント: https://developers.band.us/develop/guide/api/write_post.html
    const response = await axios.post('https://openapi.band.us/v2.2/band/post/create', null, {
      params: {
        access_token: bandAccessToken,
        band_key: bandKey,
        content: message,
        do_push: true // プッシュ通知を送る
      }
    });

    // レスポンスコードの確認 (result_code: 1 = 成功)
    if (response.data?.result_code !== 1) {
      throw new Error(`BAND API returned error: ${JSON.stringify(response.data)}`);
    }

    return res.status(200).json({
      status: 'success',
      message: 'Posted to BAND successfully.',
      content: message
    });

  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ status: 'error', error: error.message });
  }
}
