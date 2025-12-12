import { VercelRequest, VercelResponse } from '@vercel/node';
import * as line from '@line/bot-sdk';
import * as admin from 'firebase-admin';
import 'dotenv/config';

// ---------------------------------------------------------
// 1. 設定・初期化
// ---------------------------------------------------------
// 環境変数のチェックと整形
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

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
  channelSecret: process.env.LINE_CHANNEL_SECRET!,
};
const client = new line.Client(config);

// ---------------------------------------------------------
// 2. メイン処理 (Handler)
// ---------------------------------------------------------
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'active', message: 'Bot is ready!' });
  }

  try {
    const events: line.WebhookEvent[] = req.body.events;
    const results = await Promise.all(events.map((event) => handleEvent(event)));
    return res.status(200).json({ status: 'success', results });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ status: 'error', error: error.message });
  }
}

// ---------------------------------------------------------
// 3. イベント分岐処理
// ---------------------------------------------------------
async function handleEvent(event: line.WebhookEvent) {
  // A. テキストメッセージが来たとき（「予約フォーム」など）
  if (event.type === 'message' && event.message.type === 'text') {
    return handleTextEvent(event);
  }

  // B. 日時選択などのボタン操作（Postback）が来たとき
  if (event.type === 'postback') {
    return handlePostbackEvent(event);
  }

  return Promise.resolve(null);
}

// ---------------------------------------------------------
// 4. テキストへの返信ロジック
// ---------------------------------------------------------
async function handleTextEvent(event: line.MessageEvent) {
  const userText = (event.message as line.TextEventMessage).text;

  // リッチメニューから「予約フォーム」と送られてきたら...
  if (userText === '登録したい') {
    return client.replyMessage(event.replyToken, {
      type: 'template',
      altText: '予約日時を選んでください', // PCなどで非対応の場合の表示
      template: {
        type: 'buttons',
        text: 'サークルの部屋予約ですね。\n日時を選択してください。',
        actions: [
          {
            // ここが魔法の「日時選択アクション」
            type: 'datetimepicker',
            label: '日時を選ぶ',
            data: 'action=reservation', // 後で識別するためのタグ
            mode: 'datetime', // 日付と時刻両方選ぶ
          },
        ],
      },
    });
  }

  // それ以外の会話
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: `メニューから操作してください。\n受信したメッセージ: ${userText}`,
  });
}

// ---------------------------------------------------------
// 5. ボタン操作(Postback)への返信ロジック
// ---------------------------------------------------------
async function handlePostbackEvent(event: line.PostbackEvent) {
  // datetimepickerで選ばれたデータを取り出す
  const data = event.postback.data; // "action=reservation"
  const selectedParams = event.postback.params; // { datetime: "2023-12-25T14:00" }

  // 予約アクションの場合
  if (data === 'action=reservation' && selectedParams && selectedParams.datetime) {
    const userId = event.source.userId;
    const userDate = selectedParams.datetime; // 例: "2023-12-25T14:00"

    // 日付を見やすく整形 (例: 2023-12-25T14:00 -> 12/25 14:00)
    const displayDate = userDate.replace('T', ' ').slice(5);

    try {
      // ★ Firestoreに保存！
      await db.collection('reservations').add({
        userId: userId,
        date: userDate,
        status: 'pending', // 抽選待ち
        createdAt: new Date(),
      });

      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `了解です！\n📅 ${displayDate} で予約を受け付けました。\n抽選結果をお待ちください。`,
      });
    } catch (err) {
      console.error(err);
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: 'すみません、保存に失敗しました。もう一度試してください。',
      });
    }
  }
}