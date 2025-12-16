import { VercelRequest, VercelResponse } from '@vercel/node';
import * as admin from 'firebase-admin';
import { updateReservationStatus } from '../lib/update-reservation-status';
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
    // 1. 対象の日付を決定
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

    console.log(`Updating reservation status for: ${targetDateStr}`);

    // 2. 抽選結果をreservationsに反映
    const updatedCount = await updateReservationStatus(targetDateStr, db);

    if (updatedCount === 0) {
      return res.status(200).json({ 
        status: 'skipped', 
        message: `No lottery results or updates for ${targetDateStr}.`,
        targetDate: targetDateStr,
        updatedCount: 0
      });
    }

    return res.status(200).json({
      status: 'success',
      message: `Updated ${updatedCount} reservations for ${targetDateStr}.`,
      targetDate: targetDateStr,
      updatedCount: updatedCount
    });

  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ status: 'error', error: error.message });
  }
}
