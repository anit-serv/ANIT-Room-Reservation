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
  VIEW_ALL: ['全登録を見たい', '全予約', '一覧'],
  VIEW_MY: ['自分の登録を見たい', '自分の予約', 'マイ予約'],
};

const SESSION_TIMEOUT_MINUTES = 5;

// セッションタイムアウトチェック（開始時刻からの経過時間）
function isSessionExpired(startTime: number): boolean {
  const now = Date.now();
  const diffMinutes = (now - startTime) / (1000 * 60);
  return diffMinutes >= SESSION_TIMEOUT_MINUTES;
}

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

  // 全登録表示トリガーワード
  if (TRIGGER_WORDS.VIEW_ALL.includes(userText)) {
    return handleViewAllRequest(event);
  }

  // 自分の登録表示トリガーワード
  if (TRIGGER_WORDS.VIEW_MY.includes(userText)) {
    return handleViewMyReservations(event, userId);
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

// 全登録表示リクエストの処理
async function handleViewAllRequest(event: line.MessageEvent) {
  const availableDates = getAvailableDates();

  if (availableDates.length === 0) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '現在、表示可能な日付がありません。',
    });
  }

  const quickReplyItems: line.QuickReplyItem[] = availableDates.map((d) => ({
    type: 'action',
    action: {
      type: 'postback',
      label: d.label,
      data: `action=view_reservations&date=${d.value}`,
    },
  }));

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: '登録状況を見たい日付を選択してください👇',
    quickReply: {
      items: quickReplyItems,
    },
  });
}

// 自分の登録表示の処理
async function handleViewMyReservations(event: line.MessageEvent | line.PostbackEvent, userId: string, page: number = 0) {
  try {
    // インデックスなしでも動くようにorderByを削除し、クライアント側でソート
    const snapshot = await db.collection('reservations')
      .where('userId', '==', userId)
      .get();

    if (snapshot.empty) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '📝 あなたの登録はまだありません。',
      });
    }

    // 日付でソート
    const sortedDocs = snapshot.docs.sort((a, b) => {
      const dateA = a.data().date || '';
      const dateB = b.data().date || '';
      return dateA.localeCompare(dateB);
    });

    const totalCount = sortedDocs.length;
    const startIndex = page * 9; // 9件ずつ表示（さらに表示ボタン用に1枠確保）
    const endIndex = Math.min(startIndex + 9, totalCount);
    const hasMore = endIndex < totalCount;

    // 該当ページのデータがない場合
    if (startIndex >= totalCount) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: 'これ以上の登録はありません。',
      });
    }

    // カルーセルのカラムを作成（最大9件 + さらに表示で合計10件以内）
    const columns: line.TemplateColumn[] = sortedDocs.slice(startIndex, endIndex).map((doc) => {
      const data = doc.data();
      const docId = doc.id;
      const bandName = data.bandName || '(バンド名なし)';
      const dateTime = data.date; // "2023-12-20T09:00-10:00"
      const [datePart, timePart] = dateTime.split('T');
      const displayDate = datePart.replace(/-/g, '/').slice(5); // "12/20"
      const status = data.status === 'confirmed' ? '✅確定' : '⏳抽選待ち';

      return {
        title: bandName.slice(0, 40), // タイトルは40文字まで
        text: `📅 ${displayDate} ${timePart}\n${status}`,
        actions: [
          {
            type: 'postback' as const,
            label: '✏️ バンド名を編集',
            data: `action=edit_reservation&docId=${docId}`,
          },
          {
            type: 'postback' as const,
            label: '📅 日時を編集',
            data: `action=edit_datetime&docId=${docId}`,
          },
          {
            type: 'postback' as const,
            label: '🗑️ 削除する',
            data: `action=confirm_delete&docId=${docId}&band=${encodeURIComponent(bandName)}`,
          },
        ],
      };
    });

    // まだ残りがある場合は「さらに表示」カラムを追加
    if (hasMore) {
      const remainingCount = totalCount - endIndex;
      columns.push({
        title: `さらに表示 (${remainingCount}件)`,
        text: `残り${remainingCount}件の登録があります`,
        actions: [
          {
            type: 'postback' as const,
            label: '➡️ 次を見る',
            data: `action=view_my_more&page=${page + 1}`,
          },
          {
            type: 'postback' as const,
            label: '─',
            data: 'action=noop',
          },
          {
            type: 'postback' as const,
            label: '─',
            data: 'action=noop',
          },
        ],
      });
    }

    const pageInfo = totalCount > 9 ? ` (${startIndex + 1}-${endIndex}/${totalCount}件)` : '';

    return client.replyMessage(event.replyToken, {
      type: 'template',
      altText: `あなたの登録一覧${pageInfo}`,
      template: {
        type: 'carousel',
        columns: columns,
      },
    });
  } catch (err) {
    console.error(err);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'エラーが発生しました。もう一度お試しください。',
    });
  }
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

  // タイムアウトチェック
  if (stateData && stateData.createdAt) {
    const createdAt = stateData.createdAt.toDate().getTime();
    if (isSessionExpired(createdAt)) {
      await db.collection('states').doc(userId).delete();
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '⏰ 5分間経過したため、登録をキャンセルしました。\nもう一度「登録したい」と送ってください。',
      });
    }
  }

  // バンド名入力待ちの場合
  if (stateData && stateData.status === 'WAITING_BAND_NAME') {
    const bandName = userText;
    const startTime = stateData.createdAt.toDate().getTime(); // 開始時刻を取得
    await db.collection('states').doc(userId).delete();

    const availableDates = getAvailableDates();

    if (availableDates.length === 0) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '現在、予約可能な枠がありません。（直近の水・木・土のみ予約可能です）',
      });
    }

    // 開始時刻をpostbackデータに埋め込む
    const quickReplyItems: line.QuickReplyItem[] = availableDates.map((d) => ({
      type: 'action',
      action: {
        type: 'postback',
        label: d.label,
        data: `action=select_date&date=${d.value}&band=${encodeURIComponent(bandName)}&start=${startTime}`,
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

  // バンド名編集中の場合
  if (stateData && stateData.status === 'EDITING_BAND_NAME') {
    const newBandName = userText;
    const docId = stateData.editingDocId;
    await db.collection('states').doc(userId).delete();

    try {
      await db.collection('reservations').doc(docId).update({
        bandName: newBandName,
      });

      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `✅ バンド名を「${newBandName}」に更新しました。`,
      });
    } catch (err) {
      console.error(err);
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: 'エラーが発生しました。もう一度お試しください。',
      });
    }
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

  // パターンC: 全登録表示（日付選択後）
  if (data.startsWith('action=view_reservations')) {
    return handleViewReservations(event, data);
  }

  // パターンD: 予約編集
  if (data.startsWith('action=edit_reservation')) {
    return handleEditReservation(event, data);
  }

  // パターンE: 削除確認
  if (data.startsWith('action=confirm_delete')) {
    return handleConfirmDelete(event, data);
  }

  // パターンF: 削除実行
  if (data.startsWith('action=delete_reservation')) {
    return handleDeleteReservation(event, data);
  }

  // パターンG: バンド名更新確定
  if (data.startsWith('action=update_band_name')) {
    return handleUpdateBandName(event, data);
  }

  // パターンH: 自分の登録をさらに表示
  if (data.startsWith('action=view_my_more')) {
    return handleViewMyMore(event, data);
  }

  // パターンI: 日時編集開始
  if (data.startsWith('action=edit_datetime')) {
    return handleEditDateTime(event, data);
  }

  // パターンJ: 日時編集 - 日付選択後
  if (data.startsWith('action=edit_select_date')) {
    return handleEditSelectDate(event, data);
  }

  // パターンK: 日時編集 - 時間選択後（確定）
  if (data.startsWith('action=edit_finalize')) {
    return handleEditFinalize(event, data);
  }
}

// パターンA: 日付選択 → 時間選択を促す
async function handleSelectDate(event: line.PostbackEvent, data: string) {
  const params = new URLSearchParams(data);
  const selectedDate = params.get('date');
  const bandName = params.get('band');
  const startTime = params.get('start');

  // タイムアウトチェック
  if (startTime && isSessionExpired(Number(startTime))) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '⏰ 5分間経過したため、登録をキャンセルしました。\nもう一度「登録したい」と送ってください。',
    });
  }

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
      // 開始時刻も次のデータに引き継ぐ
      data: `action=finalize&date=${selectedDate}&time=${slot.value}&band=${bandName}&start=${startTime}`,
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
  const bandName = decodeURIComponent(params.get('band') || '');
  const startTime = params.get('start');

  // タイムアウトチェック
  if (startTime && isSessionExpired(Number(startTime))) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '⏰ 5分間経過したため、登録をキャンセルしました。\nもう一度「登録したい」と送ってください。',
    });
  }

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

// パターンC: 全登録表示（日付選択後）
async function handleViewReservations(event: line.PostbackEvent, data: string) {
  const params = new URLSearchParams(data);
  const selectedDate = params.get('date'); // "2023-12-20"

  try {
    // 選択された日付の予約を取得（dateフィールドが "2023-12-20T" で始まるもの）
    const snapshot = await db.collection('reservations')
      .where('date', '>=', `${selectedDate}T00:00`)
      .where('date', '<=', `${selectedDate}T23:59`)
      .get();

    if (snapshot.empty) {
      const dateLabel = selectedDate?.replace(/-/g, '/').slice(5);
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `📅 ${dateLabel} の登録はまだありません。`,
      });
    }

    // 時間帯ごとに整理
    const timeSlotOrder = ['09:00-10:00', '10:00-12:00', '12:00-14:00', '14:00-16:00', '16:00-18:00', '18:00-20:00'];
    const reservationsByTime: { [key: string]: string[] } = {};

    snapshot.forEach((doc) => {
      const data = doc.data();
      const timeSlot = data.date.split('T')[1]; // "09:00-10:00"
      const bandName = data.bandName || '(バンド名なし)';

      if (!reservationsByTime[timeSlot]) {
        reservationsByTime[timeSlot] = [];
      }
      reservationsByTime[timeSlot].push(bandName);
    });

    // メッセージを組み立て
    const dateLabel = selectedDate?.replace(/-/g, '/').slice(5);
    let message = `📅 ${dateLabel} の登録状況\n${'─'.repeat(15)}\n`;

    for (const timeSlot of timeSlotOrder) {
      const bands = reservationsByTime[timeSlot];
      if (bands && bands.length > 0) {
        message += `\n🕐 ${timeSlot}\n`;
        bands.forEach((band, index) => {
          message += `  ${index + 1}. ${band}\n`;
        });
      }
    }

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: message.trim(),
    });
  } catch (err) {
    console.error(err);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'エラーが発生しました。もう一度お試しください。',
    });
  }
}

// パターンD: 予約編集（バンド名入力待ち状態にする）
async function handleEditReservation(event: line.PostbackEvent, data: string) {
  // 抽選時間チェック
  if (isLotteryTime()) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '⚠️ 現在は20:50〜21:00の抽選集計時間のため、編集操作はできません。21:00以降にお試しください。',
    });
  }

  const params = new URLSearchParams(data);
  const docId = params.get('docId');
  const userId = event.source.userId!;

  // 編集対象のドキュメントIDを状態に保存
  await db.collection('states').doc(userId).set({
    status: 'EDITING_BAND_NAME',
    editingDocId: docId,
    createdAt: new Date(),
  });

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: '新しい【バンド名】を入力してください。\n(中断する場合は「キャンセル」と送ってください)',
  });
}

// パターンE: 削除確認
async function handleConfirmDelete(event: line.PostbackEvent, data: string) {
  const params = new URLSearchParams(data);
  const docId = params.get('docId');
  const bandName = decodeURIComponent(params.get('band') || '');

  return client.replyMessage(event.replyToken, {
    type: 'template',
    altText: '削除確認',
    template: {
      type: 'confirm',
      text: `「${bandName}」の登録を削除しますか？`,
      actions: [
        {
          type: 'postback',
          label: 'はい、削除する',
          data: `action=delete_reservation&docId=${docId}`,
        },
        {
          type: 'postback',
          label: 'いいえ',
          data: 'action=cancel_delete',
        },
      ],
    },
  });
}

// パターンF: 削除実行
async function handleDeleteReservation(event: line.PostbackEvent, data: string) {
  const params = new URLSearchParams(data);
  const docId = params.get('docId');

  try {
    await db.collection('reservations').doc(docId!).delete();

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '🗑️ 登録を削除しました。',
    });
  } catch (err) {
    console.error(err);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'エラーが発生しました。もう一度お試しください。',
    });
  }
}

// パターンG: バンド名更新（テキスト入力後に呼ばれる）
async function handleUpdateBandName(event: line.PostbackEvent, data: string) {
  // この関数は使わない（handleOtherInputで処理）
  return Promise.resolve(null);
}

// パターンH: 自分の登録をさらに表示
async function handleViewMyMore(event: line.PostbackEvent, data: string) {
  const params = new URLSearchParams(data);
  const page = parseInt(params.get('page') || '0', 10);
  const userId = event.source.userId!;

  return handleViewMyReservations(event, userId, page);
}

// パターンI: 日時編集開始
async function handleEditDateTime(event: line.PostbackEvent, data: string) {
  // 抽選時間チェック
  if (isLotteryTime()) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '⚠️ 現在は20:50〜21:00の抽選集計時間のため、編集操作はできません。21:00以降にお試しください。',
    });
  }

  const params = new URLSearchParams(data);
  const docId = params.get('docId');
  const startTime = Date.now(); // 編集開始時刻

  const availableDates = getAvailableDates();

  if (availableDates.length === 0) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '現在、予約可能な枠がありません。（直近の水・木・土のみ予約可能です）',
    });
  }

  // 日付選択のクイックリプライを作成
  const quickReplyItems: line.QuickReplyItem[] = availableDates.map((d) => ({
    type: 'action',
    action: {
      type: 'postback',
      label: d.label,
      data: `action=edit_select_date&docId=${docId}&date=${d.value}&start=${startTime}`,
    },
  }));

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: '新しい日付を選択してください👇\n(中断する場合は「キャンセル」と送ってください)',
    quickReply: {
      items: quickReplyItems,
    },
  });
}

// パターンJ: 日時編集 - 日付選択後 → 時間選択を促す
async function handleEditSelectDate(event: line.PostbackEvent, data: string) {
  const params = new URLSearchParams(data);
  const docId = params.get('docId');
  const selectedDate = params.get('date');
  const startTime = params.get('start');

  // タイムアウトチェック
  if (startTime && isSessionExpired(Number(startTime))) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '⏰ 5分間経過したため、編集をキャンセルしました。\nもう一度お試しください。',
    });
  }

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

  const quickReplyItems: line.QuickReplyItem[] = timeSlots.map((slot) => ({
    type: 'action',
    action: {
      type: 'postback',
      label: slot.label,
      data: `action=edit_finalize&docId=${docId}&date=${selectedDate}&time=${slot.value}&start=${startTime}`,
    },
  }));

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: `📅 ${dateLabel} ですね。\n新しい時間を選択してください👇`,
    quickReply: {
      items: quickReplyItems,
    },
  });
}

// パターンK: 日時編集 - 時間選択後（確定）
async function handleEditFinalize(event: line.PostbackEvent, data: string) {
  const params = new URLSearchParams(data);
  const docId = params.get('docId');
  const selectedDate = params.get('date');
  const selectedTime = params.get('time');
  const startTime = params.get('start');

  // タイムアウトチェック
  if (startTime && isSessionExpired(Number(startTime))) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '⏰ 5分間経過したため、編集をキャンセルしました。\nもう一度お試しください。',
    });
  }

  const newDateTime = `${selectedDate}T${selectedTime}`;
  const displayStr = `${selectedDate?.replace(/-/g, '/').slice(5)} ${selectedTime}`;

  try {
    await db.collection('reservations').doc(docId!).update({
      date: newDateTime,
    });

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `✅ 日時を「${displayStr}」に更新しました。`,
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