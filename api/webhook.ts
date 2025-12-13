import { VercelRequest, VercelResponse } from '@vercel/node';
import * as line from '@line/bot-sdk';
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

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
  channelSecret: process.env.LINE_CHANNEL_SECRET!,
};
const client = new line.Client(config);

// ---------------------------------------------------------
// 2. メイン処理
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
// 3. イベント分岐
// ---------------------------------------------------------
async function handleEvent(event: line.WebhookEvent) {
  if (event.type === 'message' && event.message.type === 'text') {
    return handleTextEvent(event);
  }
  if (event.type === 'postback') {
    return handlePostbackEvent(event);
  }
  return Promise.resolve(null);
}

// ---------------------------------------------------------
// 4. テキストメッセージの処理 (状態管理を追加！)
// ---------------------------------------------------------

const TRIGGER_WORDS = {
  REGISTER: ['登録したい', '予約', '予約したい', '登録'],
  CANCEL: ['キャンセル', 'やめる', '終了'],
};

async function handleTextEvent(event: line.MessageEvent) {
  const userId = event.source.userId!;
  const userText = (event.message as line.TextEventMessage).text;

  // キャンセル処理
  if (TRIGGER_WORDS.CANCEL.includes(userText)) {
    return handleCancelRequest(event, userId);
  }

  // 登録系トリガーワード
  if (TRIGGER_WORDS.REGISTER.includes(userText)) {
    return handleRegisterRequest(event, userId);
  }

  // それ以外（状態に応じた処理）
  return handleOtherInput(event, userId, userText);
}

// キャンセル処理
async function handleCancelRequest(event: line.MessageEvent, userId: string) {
  await db.collection('states').doc(userId).delete();
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: '操作をキャンセルしました。',
  });
}

// 登録リクエストの処理
async function handleRegisterRequest(event: line.MessageEvent, userId: string) {
  if (isLotteryTime()) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '⚠️ 現在は20:50〜21:00の抽選集計時間のため、予約操作はできません。21:00以降にお試しください。',
    });
  }

  await db.collection('states').doc(userId).set({
    status: 'WAITING_BAND_NAME',
    createdAt: new Date(),
  });

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: '登録する【バンド名】を入力してください。\n(中断する場合は「キャンセル」と送ってください)',
  });
}

// その他の入力処理（状態に応じた処理）
async function handleOtherInput(event: line.MessageEvent, userId: string, userText: string) {
  const stateSnap = await db.collection('states').doc(userId).get();

  if (!stateSnap.exists) {
    return Promise.resolve(null);
  }

  const stateData = stateSnap.data();

  // バンド名入力待ちの場合
  if (stateData && stateData.status === 'WAITING_BAND_NAME') {
    const bandName = userText;
    await db.collection('states').doc(userId).delete();

    const availableDates = getAvailableDates();

    if (availableDates.length === 0) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '現在、予約可能な枠がありません。（直近の水・木・土のみ予約可能です）',
      });
    }

    const quickReplyItems: line.QuickReplyItem[] = availableDates.map((d) => ({
      type: 'action',
      action: {
        type: 'postback',
        label: d.label,
        data: `action=select_date&date=${d.value}&band=${bandName}`,
      },
    }));

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `「${bandName}」で登録を進めます。\n予約する日付を選択してください👇`,
      quickReply: {
        items: quickReplyItems,
      },
    });
  }

  return Promise.resolve(null);
}

// ---------------------------------------------------------
// 5. ボタン操作への返信 (バンド名を持ち回る)
// ---------------------------------------------------------
async function handlePostbackEvent(event: line.PostbackEvent) {
  const data = event.postback.data; 

  // パターンA: 日付が選ばれたら → 「時間」を聞く
  if (data.startsWith('action=select_date')) {
    return handleSelectDate(event, data);
  }

  // パターンB: 時間も選ばれて、最終確定したとき
  if (data.startsWith('action=finalize')) {
    return handleFinalize(event, data);
  }
}

// パターンA: 日付選択 → 時間選択を促す
async function handleSelectDate(event: line.PostbackEvent, data: string) {
  const params = new URLSearchParams(data);
  const selectedDate = params.get('date');
  const bandName = params.get('band'); // 受け取ったバンド名

  const dateObj = new Date(selectedDate!);
  const dateLabel = `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;

  const timeSlots = [
    { label: '9:00~10:00', value: '09:00-10:00' },
    { label: '10:00~12:00', value: '10:00-12:00' },
    { label: '12:00~14:00', value: '12:00-14:00' },
    { label: '14:00~16:00', value: '14:00-16:00' },
    { label: '16:00~18:00', value: '16:00-18:00' },
    { label: '18:00~20:00', value: '18:00-20:00' },
  ];

  // クイックリプライ作成
  const quickReplyItems: line.QuickReplyItem[] = timeSlots.map((slot) => ({
    type: 'action',
    action: {
      type: 'postback',
      label: slot.label,
      // ★ここでもバンド名を次のデータに引き継ぐ！
      data: `action=finalize&date=${selectedDate}&time=${slot.value}&band=${bandName}`,
    },
  }));

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: `📅 ${dateLabel} ですね。\n利用時間を選んでください👇`,
    quickReply: {
      items: quickReplyItems,
    },
  });
}

// パターンB: 時間選択 → 予約確定
async function handleFinalize(event: line.PostbackEvent, data: string) {
  const params = new URLSearchParams(data);
  const selectedDate = params.get('date');
  const selectedTime = params.get('time');
  const bandName = params.get('band'); // 最終的にここでバンド名を取り出す

  const finalDateTimeStr = `${selectedDate}T${selectedTime}`;
  const displayStr = `${selectedDate?.replace(/-/g, '/').slice(5)} ${selectedTime}`;
  const userId = event.source.userId;

  try {
    // Firestoreに保存（バンド名も追加！）
    await db.collection('reservations').add({
      userId: userId,
      bandName: bandName, // ★追加
      date: finalDateTimeStr,
      status: 'pending',
      createdAt: new Date(),
    });

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `✅ 予約を受け付けました\n\nバンド名: ${bandName}\n日時: ${displayStr}\n\n抽選結果をお待ちください。`,
    });
  } catch (err) {
    console.error(err);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'エラーが発生しました。もう一度お試しください。',
    });
  }
}

// ---------------------------------------------------------
// 6. ロジック関数群
// ---------------------------------------------------------

function isLotteryTime(): boolean {
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
  const nowJST = new Date(now.getTime() + jstOffset);
  const h = nowJST.getUTCHours();
  const m = nowJST.getUTCMinutes();
  return h === 20 && m >= 50;
}

function getAvailableDates(): { label: string; value: string }[] {
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
  const nowJST = new Date(now.getTime() + jstOffset);
  const currentHour = nowJST.getUTCHours();

  let daysToAdd = currentHour >= 21 ? 2 : 1;
  
  const startDate = new Date(nowJST);
  startDate.setUTCDate(startDate.getUTCDate() + daysToAdd);
  startDate.setUTCHours(0, 0, 0, 0);

  const results: { label: string; value: string }[] = [];
  const weekDays = ['日', '月', '火', '水', '木', '金', '土'];

  for (let i = 0; i < 7; i++) {
    const targetDate = new Date(startDate);
    targetDate.setUTCDate(startDate.getUTCDate() + i);

    const dayIndex = targetDate.getUTCDay();
    
    if (dayIndex === 3 || dayIndex === 4 || dayIndex === 6) {
      const m = targetDate.getUTCMonth() + 1;
      const d = targetDate.getUTCDate();
      const wd = weekDays[dayIndex];
      const yyyy = targetDate.getUTCFullYear();
      const mm = ('0' + m).slice(-2);
      const dd = ('0' + d).slice(-2);

      results.push({
        label: `${m}/${d}(${wd})`,
        value: `${yyyy}-${mm}-${dd}`
      });
    }
  }
  return results;
}