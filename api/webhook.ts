import { VercelRequest, VercelResponse } from '@vercel/node';
import * as line from '@line/bot-sdk';
import * as admin from 'firebase-admin';
import 'dotenv/config';

// ---------------------------------------------------------
// 1. 設定・初期化 (ここは変更なし)
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
// 2. メイン処理 (変更なし)
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
// 3. イベント分岐 (変更なし)
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
// 4. テキストメッセージの処理
// ---------------------------------------------------------

// トリガーワードの定義
const TRIGGER_WORDS = {
  REGISTER: ['登録したい', '予約', '予約したい', '登録'],
};

async function handleTextEvent(event: line.MessageEvent) {
  const userText = (event.message as line.TextEventMessage).text;

  // 登録系のトリガーワード
  if (TRIGGER_WORDS.REGISTER.includes(userText)) {
    return handleRegisterRequest(event);
  }

  return Promise.resolve(null);
}

// 予約登録リクエストの処理
async function handleRegisterRequest(event: line.MessageEvent) {
  // まず、今が抽選時間(20:50-21:00)かどうかチェック
  if (isLotteryTime()) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '⚠️ 現在は20:50〜21:00の抽選集計時間のため、予約操作はできません。21:00以降にお試しください。',
    });
  }

  // 予約可能な日付リストを計算して取得
  const availableDates = getAvailableDates();

  if (availableDates.length === 0) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '現在、予約可能な枠がありません。（直近の水・木・土のみ予約可能です）',
    });
  }

  // クイックリプライのボタンを作成
  const quickReplyItems: line.QuickReplyItem[] = availableDates.map((d) => ({
    type: 'action',
    action: {
      type: 'postback',
      label: d.label, // 表示名 "12/20(水)"
      data: `action=select_date&date=${d.value}`, // 裏データ "2023-12-20"
    },
  }));

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: '予約する日付を選択してください👇',
    quickReply: {
      items: quickReplyItems,
    },
  });
}

// ---------------------------------------------------------
// 5. ボタン操作への返信 (★2段階フローの実装)
// ---------------------------------------------------------
async function handlePostbackEvent(event: line.PostbackEvent) {
  const data = event.postback.data; // "action=..."
  const params = event.postback.params;

  // パターンA: 日付が選ばれたら → 「時間」を聞く
  if (data.startsWith('action=select_date')) {
    return handleSelectDate(event, data);
  }

  // パターンB: 時間も選ばれて、最終確定したとき
  if (data.startsWith('action=finalize') && data.includes('time=')) {
    return handleFinalize(event, data);
  }
}

// パターンA: 日付選択 → 時間選択を促す
async function handleSelectDate(event: line.PostbackEvent, data: string) {
  const selectedDate = new URLSearchParams(data).get('date'); // "2023-12-20"

  // 日付を「年月日」の表示用に整形
  const dateObj = new Date(selectedDate!);
  const dateLabel = `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;

  // 時間帯の選択肢
  const timeSlots = [
    { label: '9:00~10:00', value: '09:00-10:00' },
    { label: '10:00~12:00', value: '10:00-12:00' },
    { label: '12:00~14:00', value: '12:00-14:00' },
    { label: '14:00~16:00', value: '14:00-16:00' },
    { label: '16:00~18:00', value: '16:00-18:00' },
    { label: '18:00~20:00', value: '18:00-20:00' },
  ];

  // クイックリプライのボタンを作成
  const quickReplyItems: line.QuickReplyItem[] = timeSlots.map((slot) => ({
    type: 'action',
    action: {
      type: 'postback',
      label: slot.label,
      data: `action=finalize&date=${selectedDate}&time=${slot.value}`,
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
  const selectedDate = params.get('date'); // "2023-12-20"
  const selectedTime = params.get('time'); // "09:00-10:00"

  // 日時を結合: "2023-12-20T09:00-10:00"
  const finalDateTimeStr = `${selectedDate}T${selectedTime}`;
  const displayStr = `${selectedDate?.replace(/-/g, '/').slice(5)} ${selectedTime}`;

  const userId = event.source.userId;

  try {
    await db.collection('reservations').add({
      userId: userId,
      date: finalDateTimeStr,
      status: 'pending',
      createdAt: new Date(),
    });

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `✅ 予約を受け付けました\n日時: ${displayStr}\n\n抽選結果をお待ちください。`,
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
// 6. ロジック関数群 (カレンダー計算)
// ---------------------------------------------------------

// 抽選時間(20:50-21:00)かどうか判定
function isLotteryTime(): boolean {
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
  const nowJST = new Date(now.getTime() + jstOffset);
  const h = nowJST.getUTCHours();
  const m = nowJST.getUTCMinutes();
  return h === 20 && m >= 50;
}

// 予約可能な日付リストを生成する
function getAvailableDates(): { label: string; value: string }[] {
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
  const nowJST = new Date(now.getTime() + jstOffset);
  const currentHour = nowJST.getUTCHours();

  // 開始日の決定ルール
  // 21時前なら「明日」から。21時以降なら「明後日」から。
  let daysToAdd = currentHour >= 21 ? 2 : 1;
  
  const startDate = new Date(nowJST);
  startDate.setUTCDate(startDate.getUTCDate() + daysToAdd);
  startDate.setUTCHours(0, 0, 0, 0);

  const results: { label: string; value: string }[] = [];
  const weekDays = ['日', '月', '火', '水', '木', '金', '土'];

  // 向こう7日間を走査
  for (let i = 0; i < 7; i++) {
    const targetDate = new Date(startDate);
    targetDate.setUTCDate(startDate.getUTCDate() + i);

    const dayIndex = targetDate.getUTCDay(); // 0(日)〜6(土)
    
    // 水(3), 木(4), 土(6) のみ許可
    if (dayIndex === 3 || dayIndex === 4 || dayIndex === 6) {
      const m = targetDate.getUTCMonth() + 1;
      const d = targetDate.getUTCDate();
      const wd = weekDays[dayIndex];
      
      // データ用: YYYY-MM-DD
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