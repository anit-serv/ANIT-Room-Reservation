import { VercelRequest, VercelResponse } from '@vercel/node';
import * as admin from 'firebase-admin';
import 'dotenv/config'; // .envを読み込むおまじない

// 環境変数のチェック
const privateKey = process.env.FIREBASE_PRIVATE_KEY
  ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') // \n という文字を本当の改行に直す
  : undefined;

if (!admin.apps.length) {
  if (!privateKey) {
    throw new Error('環境変数 FIREBASE_PRIVATE_KEY がありません');
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey,
    }),
  });
}

const db = admin.firestore();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const result = await db.collection('reservations').add({
      name: "環境変数テスト太郎",
      status: "成功",
      timestamp: new Date()
    });

    res.status(200).json({ 
      message: '安全にFirestoreに書き込みました！', 
      docId: result.id 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'エラー', details: error });
  }
}