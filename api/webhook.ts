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

// 共通メッセージ
const MESSAGES = {
  ERROR: 'エラーが発生しました。もう一度お試しください。',
  SESSION_EXPIRED: '⏰ 5分間経過したため、操作をキャンセルしました。\nもう一度お試しください。',
  LOTTERY_TIME: '⚠️ 現在は20:50〜21:00の抽選集計時間のため、操作はできません。21:00以降にお試しください。',
  CAROUSEL_EXPIRED: '⏰ このボタンは有効期限切れです。',
  CAROUSEL_OUTDATED: '⚠️ このカルーセルは既に操作済みです。',
  CAROUSEL_REFRESH: '「自分の登録を見たい」と送って最新の一覧を取得してください。',
  NO_AVAILABLE_DATES: '現在、予約可能な枠がありません。（直近の水・木・土のみ予約可能です）',
};

const SESSION_TIMEOUT_MINUTES = 5;

// セッションタイムアウトチェック（開始時刻からの経過時間）
function isSessionExpired(startTime: number): boolean {
  const now = Date.now();
  const diffMinutes = (now - startTime) / (1000 * 60);
  return diffMinutes >= SESSION_TIMEOUT_MINUTES;
}

// カルーセルのボタンが有効かチェック（最後にボタンを押した時刻より後に生成されたかチェック）
async function isCarouselButtonValid(userId: string, buttonTs: number): Promise<{ valid: boolean; reason?: string }> {
  // 5分経過チェック
  if (isSessionExpired(buttonTs)) {
    return { valid: false, reason: 'expired' };
  }

  // 最後にボタンを押した時刻より前に生成されたカルーセルかチェック
  const stateSnap = await db.collection('states').doc(userId).get();
  if (stateSnap.exists) {
    const stateData = stateSnap.data();
    if (stateData?.lastButtonPressTs && buttonTs <= stateData.lastButtonPressTs) {
      return { valid: false, reason: 'outdated' };
    }
  }

  return { valid: true };
}

// ボタン押下時刻を記録
async function recordButtonPress(userId: string): Promise<void> {
  await db.collection('states').doc(userId).set({
    lastButtonPressTs: Date.now(),
  }, { merge: true });
}

// 「さらに表示」ボタンの重複押下チェック（ページ番号が進む方向のみ許可）
async function isViewMyMoreValid(userId: string, page: number, carouselTs: number): Promise<boolean> {
  const stateSnap = await db.collection('states').doc(userId).get();
  if (!stateSnap.exists) return true;

  const stateData = stateSnap.data();
  const lastCarouselTs = stateData?.lastViewMyCarouselTs;
  const lastViewedPage = stateData?.lastViewMyMorePage ?? 0;

  // 別のカルーセル（異なるタイムスタンプ）なら許可
  if (lastCarouselTs !== carouselTs) {
    return true;
  }

  // 同じカルーセルで、既に見たページ以下なら拒否（進む方向のみ許可）
  if (page <= lastViewedPage) {
    return false;
  }

  return true;
}

// 「さらに表示」ボタン押下を記録
async function recordViewMyMore(userId: string, page: number, carouselTs: number): Promise<void> {
  await db.collection('states').doc(userId).set({
    lastViewMyCarouselTs: carouselTs,
    lastViewMyMorePage: page,
  }, { merge: true });
}

// カルーセル/確認ダイアログのボタン押下時の共通チェック処理
// 無効な場合はエラーメッセージを返し、有効な場合はnullを返す
async function checkButtonAndGetErrorReply(
  event: line.PostbackEvent,
  userId: string,
  ts: string | null,
  options: { recordPress?: boolean; dialogType?: 'carousel' | 'confirm' } = {}
): Promise<line.Message[] | null> {
  const { recordPress = false, dialogType = 'carousel' } = options;

  if (!ts) return null;

  const validation = await isCarouselButtonValid(userId, Number(ts));
  if (validation.valid) {
    if (recordPress) {
      await recordButtonPress(userId);
    }
    return null;
  }

  // 進行中の操作があればクイックリプライを再表示
  const ongoingReply = await getOngoingOperationReply(userId, { isInvalidButton: true });
  if (ongoingReply) {
    return ongoingReply;
  }

  // エラーメッセージ
  const expiredMsg = MESSAGES.CAROUSEL_EXPIRED;
  const outdatedMsg = dialogType === 'confirm'
    ? '⚠️ この確認ダイアログは既に操作済みです。'
    : MESSAGES.CAROUSEL_OUTDATED;
  const message = validation.reason === 'expired' ? expiredMsg : outdatedMsg;

  return [{
    type: 'text',
    text: `${message}\n${MESSAGES.CAROUSEL_REFRESH}`,
  }];
}

// ---------------------------------------------------------
// クイックリプライ状態の一元管理
// ---------------------------------------------------------

// 設定キャッシュ（パフォーマンス向上のため）
let configCache: {
  availableDays: number[];
  timeSlots: { label: string; value: string }[];
  lastFetched: number;
} | null = null;

const CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5分間キャッシュ

// Firestoreから設定を取得（キャッシュ付き）
async function getConfig(): Promise<{
  availableDays: number[];
  timeSlots: { label: string; value: string }[];
}> {
  const now = Date.now();

  // キャッシュが有効ならそれを返す
  if (configCache && (now - configCache.lastFetched) < CONFIG_CACHE_TTL) {
    return {
      availableDays: configCache.availableDays,
      timeSlots: configCache.timeSlots,
    };
  }

  // Firestoreから取得
  const configDoc = await db.collection('settings').doc('reservation').get();

  if (configDoc.exists) {
    const data = configDoc.data()!;
    configCache = {
      availableDays: data.availableDays || [3, 4, 6],
      timeSlots: data.timeSlots || [
        { label: '9:00~10:00', value: '09:00-10:00' },
        { label: '10:00~12:00', value: '10:00-12:00' },
        { label: '12:00~14:00', value: '12:00-14:00' },
        { label: '14:00~16:00', value: '14:00-16:00' },
        { label: '16:00~18:00', value: '16:00-18:00' },
        { label: '18:00~20:00', value: '18:00-20:00' },
      ],
      lastFetched: now,
    };
  } else {
    // 設定がない場合はデフォルト値を使用（初回はFirestoreに保存）
    const defaultConfig = {
      availableDays: [3, 4, 6], // 水・木・土
      timeSlots: [
        { label: '9:00~10:00', value: '09:00-10:00' },
        { label: '10:00~12:00', value: '10:00-12:00' },
        { label: '12:00~14:00', value: '12:00-14:00' },
        { label: '14:00~16:00', value: '14:00-16:00' },
        { label: '16:00~18:00', value: '16:00-18:00' },
        { label: '18:00~20:00', value: '18:00-20:00' },
      ],
    };
    await db.collection('settings').doc('reservation').set(defaultConfig);
    configCache = {
      ...defaultConfig,
      lastFetched: now,
    };
  }

  return {
    availableDays: configCache.availableDays,
    timeSlots: configCache.timeSlots,
  };
}

// 時間枠を取得するヘルパー関数
async function getTimeSlots(): Promise<{ label: string; value: string }[]> {
  const config = await getConfig();
  return config.timeSlots;
}

// 登録可能な曜日を取得するヘルパー関数
async function getAvailableDays(): Promise<number[]> {
  const config = await getConfig();
  return config.availableDays;
}

// 進行中の操作があれば、クイックリプライを再表示するメッセージを作成
async function getOngoingOperationReply(
  userId: string,
  options: { isInvalidButton?: boolean; isReservedWord?: boolean } = {}
): Promise<line.Message[] | null> {
  const { isInvalidButton = true, isReservedWord = false } = options;

  const stateSnap = await db.collection('states').doc(userId).get();
  if (!stateSnap.exists) return null;

  const stateData = stateSnap.data();
  if (!stateData?.pendingQuickReply) return null;

  // タイムアウトチェック
  const startTime = stateData.quickReplyStartTime;
  if (startTime && isSessionExpired(startTime)) {
    // 特定フィールドのみ削除（lastViewMyCarouselTs、lastViewMyMorePage、lastButtonPressTsは保持）
    await db.collection('states').doc(userId).set({
      pendingQuickReply: admin.firestore.FieldValue.delete(),
      quickReplyStartTime: admin.firestore.FieldValue.delete(),
      status: admin.firestore.FieldValue.delete(),
      createdAt: admin.firestore.FieldValue.delete(),
    }, { merge: true });
    return null;
  }

  // メッセージ選択
  let message: string;
  if (isInvalidButton) {
    message = '⚠️ このボタンは無効です。\n\n選択を続けてください👇';
  } else if (isReservedWord) {
    message = '⚠️ 操作中のため予約語は使用できません。\n\n選択を続けてください👇\n(中断する場合は「キャンセル」と送ってください)';
  } else {
    message = '選択を続けてください👇\n(中断する場合は「キャンセル」と送ってください)';
  }

  return [
    {
      type: 'text',
      text: message,
      quickReply: { items: stateData.pendingQuickReply },
    },
  ];
}

async function handleTextEvent(event: line.MessageEvent) {
  const userId = event.source.userId!;
  const userText = (event.message as line.TextEventMessage).text;

  // キャンセル処理は常に最優先
  if (TRIGGER_WORDS.CANCEL.includes(userText)) {
    return handleCancelRequest(event, userId);
  }

  // 状態を取得して、操作中かどうかを判定
  const stateSnap = await db.collection('states').doc(userId).get();
  const hasActiveState = stateSnap.exists && stateSnap.data()?.status;

  // 操作中の場合は予約語を無視して状態に応じた処理を行う
  if (hasActiveState) {
    return handleOtherInput(event, userId, userText, stateSnap);
  }

  // 状態がない場合のみ予約語をトリガーとして処理
  if (TRIGGER_WORDS.REGISTER.includes(userText)) {
    return handleRegisterRequest(event, userId);
  }

  if (TRIGGER_WORDS.VIEW_ALL.includes(userText)) {
    return handleViewAllRequest(event, userId);
  }

  if (TRIGGER_WORDS.VIEW_MY.includes(userText)) {
    return handleViewMyReservations(event, userId);
  }

  // それ以外（状態なし＆予約語でもない）
  return Promise.resolve(null);
}

// キャンセル処理
async function handleCancelRequest(event: line.MessageEvent, userId: string) {
  // 特定フィールドのみ削除（lastViewMyCarouselTs、lastViewMyMorePage、lastButtonPressTsは保持）
  await db.collection('states').doc(userId).set({
    status: admin.firestore.FieldValue.delete(),
    createdAt: admin.firestore.FieldValue.delete(),
    editingDocId: admin.firestore.FieldValue.delete(),
    editSelectedDate: admin.firestore.FieldValue.delete(),
    deletingDocId: admin.firestore.FieldValue.delete(),
    deletingBandName: admin.firestore.FieldValue.delete(),
    pendingQuickReply: admin.firestore.FieldValue.delete(),
    quickReplyStartTime: admin.firestore.FieldValue.delete(),
  }, { merge: true });
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: '操作をキャンセルしました。',
  });
}

// 全登録表示リクエストの処理
async function handleViewAllRequest(event: line.MessageEvent, userId: string) {
  // 全登録表示では当日も含める
  const availableDates = await getAvailableDateList(true);

  if (availableDates.length === 0) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '現在、表示可能な日付がありません。',
    });
  }

  const startTime = Date.now();

  const quickReplyItems: line.QuickReplyItem[] = availableDates.map((d) => ({
    type: 'action',
    action: {
      type: 'postback',
      label: d.label,
      data: `action=view_reservations&date=${d.value}&start=${startTime}`,
    },
  }));

  // 状態を保存（クイックリプライ情報も一緒に保存）
  await db.collection('states').doc(userId).set({
    status: 'VIEWING_ALL_DATE_SELECT',
    createdAt: new Date(),
    lastButtonPressTs: Date.now(),
    pendingQuickReply: quickReplyItems,
    quickReplyStartTime: startTime,
  });

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: '登録状況を見たい日付を選択してください👇',
    quickReply: {
      items: quickReplyItems,
    },
  });
}

// 自分の登録表示の処理
async function handleViewMyReservations(event: line.MessageEvent | line.PostbackEvent, userId: string, page: number = 0, originalTs?: number) {
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

    // カルーセル生成時刻（元のタイムスタンプがあればそれを使用）
    const carouselCreatedAt = originalTs ?? Date.now();
    const isLottery = await isLotteryTime();

    // カルーセルのカラムを作成（最大9件 + さらに表示で合計10件以内）
    const columns: line.TemplateColumn[] = sortedDocs.slice(startIndex, endIndex).map((doc) => {
      const data = doc.data();
      const docId = doc.id;
      const bandName = data.bandName || '(バンド名なし)';
      const dateTime = data.date; // "2023-12-20T09:00-10:00"
      const [datePart, timePart] = dateTime.split('T');
      const displayDate = datePart.replace(/-/g, '/').slice(5); // "12/20"
      const status = data.status === 'confirmed' ? '✅確定' : '⏳抽選待ち';

      // 抽選時間中はボタンなし（閲覧専用）
      const actions: line.Action[] = isLottery
        ? [
            { type: 'postback' as const, label: '─', data: 'action=noop' },
            { type: 'postback' as const, label: '🔒 抽選中', data: 'action=noop' },
            { type: 'postback' as const, label: '─', data: 'action=noop' },
          ]
        : [
            {
              type: 'postback' as const,
              label: '✏️ バンド名を編集',
              data: `action=edit_reservation&docId=${docId}&ts=${carouselCreatedAt}`,
            },
            {
              type: 'postback' as const,
              label: '📅 日時を編集',
              data: `action=edit_datetime&docId=${docId}&ts=${carouselCreatedAt}`,
            },
            {
              type: 'postback' as const,
              label: '🗑️ 削除する',
              data: `action=confirm_delete&docId=${docId}&band=${encodeURIComponent(bandName)}&ts=${carouselCreatedAt}`,
            },
          ];

      return {
        title: bandName.slice(0, 40), // タイトルは40文字まで
        text: `📅 ${displayDate} ${timePart}\n${status}`,
        actions: actions,
      };
    });

    // まだ残りがある場合は「さらに表示」カラムを追加（抽選時間中も有効）
    if (hasMore) {
      const remainingCount = totalCount - endIndex;
      columns.push({
        title: `さらに表示 (${remainingCount}件)`,
        text: `残り${remainingCount}件の登録があります`,
        actions: [
          {
            type: 'postback' as const,
            label: '➡️ 次を見る',
            data: `action=view_my_more&page=${page + 1}&ts=${carouselCreatedAt}`,
          },
          { type: 'postback' as const, label: '─', data: 'action=noop' },
          { type: 'postback' as const, label: '─', data: 'action=noop' },
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
      text: MESSAGES.ERROR,
    });
  }
}

// 登録リクエストの処理
async function handleRegisterRequest(event: line.MessageEvent, userId: string) {
  if (await isLotteryTime()) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '⚠️ 現在は20:50〜21:00の抽選集計時間のため、予約操作はできません。21:00以降にお試しください。',
    });
  }

  await db.collection('states').doc(userId).set({
    status: 'WAITING_BAND_NAME',
    createdAt: new Date(),
    lastButtonPressTs: Date.now(),
  });

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: '登録する【バンド名】を入力してください。\n(中断する場合は「キャンセル」と送ってください)',
  });
}

// その他の入力処理（状態に応じた処理）
// stateSnapを引数で受け取ることで、重複したDB読み取りを避ける
async function handleOtherInput(
  event: line.MessageEvent,
  userId: string,
  userText: string,
  stateSnap?: FirebaseFirestore.DocumentSnapshot
) {
  // stateSnapが渡されていない場合は取得
  if (!stateSnap) {
    stateSnap = await db.collection('states').doc(userId).get();
  }

  if (!stateSnap.exists) {
    return Promise.resolve(null);
  }

  const stateData = stateSnap.data();

  // タイムアウトチェック
  if (stateData && stateData.createdAt) {
    const createdAt = stateData.createdAt.toDate().getTime();
    if (isSessionExpired(createdAt)) {
      // 特定フィールドのみ削除（lastViewMyCarouselTs、lastViewMyMorePage、lastButtonPressTsは保持）
      await db.collection('states').doc(userId).set({
        status: admin.firestore.FieldValue.delete(),
        createdAt: admin.firestore.FieldValue.delete(),
        editingDocId: admin.firestore.FieldValue.delete(),
        editSelectedDate: admin.firestore.FieldValue.delete(),
        deletingDocId: admin.firestore.FieldValue.delete(),
        deletingBandName: admin.firestore.FieldValue.delete(),
        pendingQuickReply: admin.firestore.FieldValue.delete(),
        quickReplyStartTime: admin.firestore.FieldValue.delete(),
      }, { merge: true });
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '⏰ 5分間経過したため、登録をキャンセルしました。\nもう一度「登録したい」と送ってください。',
      });
    }
  }

  // 予約語が入力された場合の警告（テキスト入力待ち状態で）
  const isReservedWord = [
    ...TRIGGER_WORDS.REGISTER,
    ...TRIGGER_WORDS.VIEW_ALL,
    ...TRIGGER_WORDS.VIEW_MY,
  ].includes(userText);

  // バンド名入力待ちの場合
  if (stateData && stateData.status === 'WAITING_BAND_NAME') {
    // 予約語が入力された場合は警告
    if (isReservedWord) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `⚠️「${userText}」は予約語のため、バンド名として使用できません。\n\n別のバンド名を入力してください。\n(中断する場合は「キャンセル」と送ってください)`,
      });
    }

    const bandName = userText;
    const startTime = stateData.createdAt.toDate().getTime(); // 開始時刻を取得
    
    const availableDates = await getAvailableDateList();

    if (availableDates.length === 0) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: MESSAGES.NO_AVAILABLE_DATES,
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

    // 状態を更新（lastButtonPressTsは保持、クイックリプライ情報を保存）
    await db.collection('states').doc(userId).set({
      status: admin.firestore.FieldValue.delete(),
      createdAt: admin.firestore.FieldValue.delete(),
      pendingQuickReply: quickReplyItems,
      quickReplyStartTime: startTime,
    }, { merge: true });

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
    // 予約語が入力された場合は警告
    if (isReservedWord) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `⚠️「${userText}」は予約語のため、バンド名として使用できません。\n\n別のバンド名を入力してください。\n(中断する場合は「キャンセル」と送ってください)`,
      });
    }

    const newBandName = userText;
    const docId = stateData.editingDocId;
    
    // 状態の特定フィールドのみ削除（lastButtonPressTsは保持して元のカルーセルのボタンを無効に保つ）
    await db.collection('states').doc(userId).set({
      status: admin.firestore.FieldValue.delete(),
      editingDocId: admin.firestore.FieldValue.delete(),
      createdAt: admin.firestore.FieldValue.delete(),
    }, { merge: true });

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
        text: MESSAGES.ERROR,
      });
    }
  }

  // 削除確認ダイアログ待ちの場合
  if (stateData && stateData.status === 'WAITING_DELETE_CONFIRM') {
    const bandName = stateData.deletingBandName || '';
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `⚠️「${bandName}」の削除確認中です。\n\n確認ダイアログで「はい、削除する」または「いいえ」を選択してください。\n(中断する場合は「キャンセル」と送ってください)`,
    });
  }

  // クイックリプライが必要な状態の場合 → 共通関数で再表示
  const ongoingReply = await getOngoingOperationReply(userId, { isInvalidButton: false, isReservedWord });
  if (ongoingReply) {
    return client.replyMessage(event.replyToken, ongoingReply);
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

  // パターンF2: 削除キャンセル
  if (data.startsWith('action=cancel_delete')) {
    return handleCancelDelete(event, data);
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
  const userId = event.source.userId!;

  // 時間枠をFirestoreから取得
  const timeSlots = await getTimeSlots();

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

  // 時間選択のクイックリプライ情報を保存
  await db.collection('states').doc(userId).set({
    pendingQuickReply: quickReplyItems,
    quickReplyStartTime: Number(startTime),
  }, { merge: true });

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

    // 予約完了後、クイックリプライ情報を削除し、lastButtonPressTsを更新（登録が増えたので古いカルーセルを無効化）
    await db.collection('states').doc(userId!).set({
      pendingQuickReply: admin.firestore.FieldValue.delete(),
      quickReplyStartTime: admin.firestore.FieldValue.delete(),
      lastButtonPressTs: Date.now(),
    }, { merge: true });

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `✅ 予約を受け付けました\n\nバンド名: ${bandName}\n日時: ${displayStr}\n\n抽選結果をお待ちください。`,
    });
  } catch (err) {
    console.error(err);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: MESSAGES.ERROR,
    });
  }
}

// パターンC: 全登録表示（日付選択後）
async function handleViewReservations(event: line.PostbackEvent, data: string) {
  const params = new URLSearchParams(data);
  const selectedDate = params.get('date'); // "2023-12-20"
  const startTime = params.get('start');
  const userId = event.source.userId!;

  // タイムアウトチェック
  if (startTime && isSessionExpired(Number(startTime))) {
    // 特定フィールドのみ削除（lastViewMyCarouselTs、lastViewMyMorePage、lastButtonPressTsは保持）
    await db.collection('states').doc(userId).set({
      status: admin.firestore.FieldValue.delete(),
      createdAt: admin.firestore.FieldValue.delete(),
      pendingQuickReply: admin.firestore.FieldValue.delete(),
      quickReplyStartTime: admin.firestore.FieldValue.delete(),
    }, { merge: true });
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '⏰ 5分間経過したため、操作をキャンセルしました。\nもう一度お試しください。',
    });
  }

  // 状態を削除（lastViewMyCarouselTs、lastViewMyMorePage、lastButtonPressTsは保持）
  await db.collection('states').doc(userId).set({
    status: admin.firestore.FieldValue.delete(),
    createdAt: admin.firestore.FieldValue.delete(),
    pendingQuickReply: admin.firestore.FieldValue.delete(),
    quickReplyStartTime: admin.firestore.FieldValue.delete(),
  }, { merge: true });

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

    // 時間帯ごとに整理（抽選済みの場合は順番を保持）
    const timeSlotOrder = ['09:00-10:00', '10:00-12:00', '12:00-14:00', '14:00-16:00', '16:00-18:00', '18:00-20:00'];
    const reservationsByTime: { [key: string]: Array<{ bandName: string; status: string; order?: number; createdAt: any }> } = {};

    snapshot.forEach((doc) => {
      const data = doc.data();
      const timeSlot = data.date.split('T')[1]; // "09:00-10:00"
      const bandName = data.bandName || '(バンド名なし)';

      if (!reservationsByTime[timeSlot]) {
        reservationsByTime[timeSlot] = [];
      }
      reservationsByTime[timeSlot].push({
        bandName,
        status: data.status,
        order: data.order,
        createdAt: data.createdAt,
      });
    });

    // メッセージを組み立て
    const dateLabel = selectedDate?.replace(/-/g, '/').slice(5);
    let message = `📅 ${dateLabel} の登録状況\n${'─'.repeat(15)}\n`;

    for (const timeSlot of timeSlotOrder) {
      const reservations = reservationsByTime[timeSlot];
      if (reservations && reservations.length > 0) {
        message += `\n🕐 ${timeSlot}\n`;
        
        // 抽選済みかどうかをチェック（全てconfirmedならソート）
        const allConfirmed = reservations.every(r => r.status === 'confirmed');
        
        if (allConfirmed && reservations[0].order !== undefined) {
          // 抽選済み: order順でソート（orderがある場合）
          const sorted = reservations.sort((a, b) => (a.order || 0) - (b.order || 0));
          sorted.forEach((r, index) => {
            message += `  ${index + 1}. ${r.bandName}\n`;
          });
        } else if (allConfirmed) {
          // 抽選済みだがorderがない場合: createdAt順
          const sorted = reservations.sort((a, b) => {
            const timeA = a.createdAt?.toMillis?.() || 0;
            const timeB = b.createdAt?.toMillis?.() || 0;
            return timeA - timeB;
          });
          sorted.forEach((r, index) => {
            message += `  ${index + 1}. ${r.bandName}\n`;
          });
        } else {
          // 抽選前: 順番なしで表示
          reservations.forEach((r) => {
            message += `  ・${r.bandName}\n`;
          });
        }
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
      text: MESSAGES.ERROR,
    });
  }
}

// パターンD: 予約編集（バンド名入力待ち状態にする）
async function handleEditReservation(event: line.PostbackEvent, data: string) {
  const params = new URLSearchParams(data);
  const ts = params.get('ts');
  const userId = event.source.userId!;

  // ボタンの有効性チェック
  const errorReply = await checkButtonAndGetErrorReply(event, userId, ts);
  if (errorReply) {
    return client.replyMessage(event.replyToken, errorReply);
  }

  // 抽選時間チェック
  if (await isLotteryTime()) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: MESSAGES.LOTTERY_TIME,
    });
  }

  const docId = params.get('docId');

  // 編集対象のドキュメントIDを状態に保存（lastButtonPressTsも一緒に保存）
  await db.collection('states').doc(userId).set({
    status: 'EDITING_BAND_NAME',
    editingDocId: docId,
    createdAt: new Date(),
    lastButtonPressTs: Date.now(),
  });

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: '新しい【バンド名】を入力してください。\n(中断する場合は「キャンセル」と送ってください)',
  });
}

// パターンE: 削除確認
async function handleConfirmDelete(event: line.PostbackEvent, data: string) {
  const params = new URLSearchParams(data);
  const ts = params.get('ts');
  const userId = event.source.userId!;

  // ボタンの有効性チェック（recordPress: trueで他のボタンを無効化）
  const errorReply = await checkButtonAndGetErrorReply(event, userId, ts, { recordPress: true });
  if (errorReply) {
    return client.replyMessage(event.replyToken, errorReply);
  }

  const docId = params.get('docId');
  const bandName = decodeURIComponent(params.get('band') || '');
  const confirmTs = Date.now() + 10; // 確認ダイアログ生成時刻（lastButtonPressTsより確実に大きくするため+10ms）

  // 確認ダイアログ待ち状態を保存（lastButtonPressTsは上書きしない）
  await db.collection('states').doc(userId).set({
    status: 'WAITING_DELETE_CONFIRM',
    deletingDocId: docId,
    deletingBandName: bandName,
    createdAt: new Date(),
  }, { merge: true });

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
          data: `action=delete_reservation&docId=${docId}&ts=${confirmTs}`,
        },
        {
          type: 'postback',
          label: 'いいえ',
          data: `action=cancel_delete&ts=${confirmTs}`,
        },
      ],
    },
  });
}

// パターンF: 削除実行
async function handleDeleteReservation(event: line.PostbackEvent, data: string) {
  const params = new URLSearchParams(data);
  const ts = params.get('ts');
  const userId = event.source.userId!;

  // ボタンの有効性チェック
  const errorReply = await checkButtonAndGetErrorReply(event, userId, ts, { recordPress: true, dialogType: 'confirm' });
  if (errorReply) {
    return client.replyMessage(event.replyToken, errorReply);
  }

  const docId = params.get('docId');

  // 状態の特定フィールドのみ削除（lastButtonPressTsは保持して元のカルーセルのボタンを無効に保つ）
  await db.collection('states').doc(userId).set({
    status: admin.firestore.FieldValue.delete(),
    deletingDocId: admin.firestore.FieldValue.delete(),
    deletingBandName: admin.firestore.FieldValue.delete(),
    createdAt: admin.firestore.FieldValue.delete(),
  }, { merge: true });

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
      text: MESSAGES.ERROR,
    });
  }
}

// パターンF2: 削除キャンセル
async function handleCancelDelete(event: line.PostbackEvent, data: string) {
  const params = new URLSearchParams(data);
  const ts = params.get('ts');
  const userId = event.source.userId!;

  // ボタンの有効性チェック
  const errorReply = await checkButtonAndGetErrorReply(event, userId, ts, { recordPress: true, dialogType: 'confirm' });
  if (errorReply) {
    return client.replyMessage(event.replyToken, errorReply);
  }

  // 状態の特定フィールドのみ削除（lastButtonPressTsは保持して元のカルーセルのボタンを無効に保つ）
  await db.collection('states').doc(userId).set({
    status: admin.firestore.FieldValue.delete(),
    deletingDocId: admin.firestore.FieldValue.delete(),
    deletingBandName: admin.firestore.FieldValue.delete(),
    createdAt: admin.firestore.FieldValue.delete(),
  }, { merge: true });

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: '削除をキャンセルしました。',
  });
}

// パターンG: バンド名更新（テキスト入力後に呼ばれる）
async function handleUpdateBandName(event: line.PostbackEvent, data: string) {
  // この関数は使わない（handleOtherInputで処理）
  return Promise.resolve(null);
}

// パターンH: 自分の登録をさらに表示
async function handleViewMyMore(event: line.PostbackEvent, data: string) {
  const params = new URLSearchParams(data);
  const ts = params.get('ts');
  const userId = event.source.userId!;

  // ボタンの有効性チェック（他の操作に影響を与えないよう押下時刻を記録しない）
  const errorReply = await checkButtonAndGetErrorReply(event, userId, ts);
  if (errorReply) {
    return client.replyMessage(event.replyToken, errorReply);
  }

  const page = parseInt(params.get('page') || '0', 10);
  const originalTs = ts ? Number(ts) : undefined;

  // 「さらに表示」の重複押下チェック
  if (originalTs && !(await isViewMyMoreValid(userId, page, originalTs))) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '⚠️ このボタンは既に押されています。\n「自分の登録を見たい」と送って最新の一覧を取得してください。',
    });
  }

  // 押下を記録
  if (originalTs) {
    await recordViewMyMore(userId, page, originalTs);
  }

  // 元のタイムスタンプを引き継いでカルーセルを表示
  return handleViewMyReservations(event, userId, page, originalTs);
}

// パターンI: 日時編集開始
async function handleEditDateTime(event: line.PostbackEvent, data: string) {
  const params = new URLSearchParams(data);
  const ts = params.get('ts');
  const userId = event.source.userId!;

  // ボタンの有効性チェック
  const errorReply = await checkButtonAndGetErrorReply(event, userId, ts);
  if (errorReply) {
    return client.replyMessage(event.replyToken, errorReply);
  }

  // 抽選時間チェック
  if (await isLotteryTime()) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: MESSAGES.LOTTERY_TIME,
    });
  }

  const docId = params.get('docId');
  const startTime = Date.now(); // 編集開始時刻

  const availableDates = await getAvailableDateList();

  if (availableDates.length === 0) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: MESSAGES.NO_AVAILABLE_DATES,
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

  // 状態を保存（クイックリプライ情報も一緒に保存）
  await db.collection('states').doc(userId).set({
    status: 'EDITING_DATETIME',
    editingDocId: docId,
    createdAt: new Date(),
    lastButtonPressTs: Date.now(),
    pendingQuickReply: quickReplyItems,
    quickReplyStartTime: startTime,
  });

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
  const userId = event.source.userId!;

  // タイムアウトチェック
  if (startTime && isSessionExpired(Number(startTime))) {
    // 特定フィールドのみ削除（lastViewMyCarouselTs、lastViewMyMorePage、lastButtonPressTsは保持）
    await db.collection('states').doc(userId).set({
      status: admin.firestore.FieldValue.delete(),
      editingDocId: admin.firestore.FieldValue.delete(),
      createdAt: admin.firestore.FieldValue.delete(),
      pendingQuickReply: admin.firestore.FieldValue.delete(),
      quickReplyStartTime: admin.firestore.FieldValue.delete(),
    }, { merge: true });
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '⏰ 5分間経過したため、編集をキャンセルしました。\nもう一度お試しください。',
    });
  }

  const dateObj = new Date(selectedDate!);
  const dateLabel = `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;

  // 時間枠をFirestoreから取得
  const timeSlots = await getTimeSlots();

  const quickReplyItems: line.QuickReplyItem[] = timeSlots.map((slot) => ({
    type: 'action',
    action: {
      type: 'postback',
      label: slot.label,
      data: `action=edit_finalize&docId=${docId}&date=${selectedDate}&time=${slot.value}&start=${startTime}`,
    },
  }));

  // 状態を更新（クイックリプライ情報も一緒に保存）
  await db.collection('states').doc(userId).set({
    status: 'EDITING_DATETIME_TIME',
    editingDocId: docId,
    editSelectedDate: selectedDate,
    createdAt: new Date(),
    lastButtonPressTs: Date.now(),
    pendingQuickReply: quickReplyItems,
    quickReplyStartTime: Number(startTime),
  });

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
  const userId = event.source.userId!;

  // タイムアウトチェック
  if (startTime && isSessionExpired(Number(startTime))) {
    await db.collection('states').doc(userId).delete();
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '⏰ 5分間経過したため、編集をキャンセルしました。\nもう一度お試しください。',
    });
  }

  // 状態の特定フィールドのみ削除（lastButtonPressTsは保持して元のカルーセルのボタンを無効に保つ）
  await db.collection('states').doc(userId).set({
    status: admin.firestore.FieldValue.delete(),
    editingDocId: admin.firestore.FieldValue.delete(),
    editSelectedDate: admin.firestore.FieldValue.delete(),
    createdAt: admin.firestore.FieldValue.delete(),
    pendingQuickReply: admin.firestore.FieldValue.delete(),
    quickReplyStartTime: admin.firestore.FieldValue.delete(),
  }, { merge: true });

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
      text: MESSAGES.ERROR,
    });
  }
}

// ---------------------------------------------------------
// 6. ロジック関数群
// ---------------------------------------------------------

async function isLotteryTime(): Promise<boolean> {
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
  const nowJST = new Date(now.getTime() + jstOffset);
  const h = nowJST.getUTCHours();
  const m = nowJST.getUTCMinutes();

  // 20:50〜21:00の時間帯かチェック
  const isLotteryTimeSlot = h === 20 && m >= 50;
  if (!isLotteryTimeSlot) return false;

  // 翌日が登録可能日かどうかをチェック
  const tomorrow = new Date(nowJST);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowDayIndex = tomorrow.getUTCDay();

  const availableDays = await getAvailableDays();
  return availableDays.includes(tomorrowDayIndex);
}

async function getAvailableDateList(includeToday: boolean = false): Promise<{ label: string; value: string }[]> {
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
  const nowJST = new Date(now.getTime() + jstOffset);
  const currentHour = nowJST.getUTCHours();

  const availableDays = await getAvailableDays();

  // includeTodayがtrueの場合、当日が登録可能日かチェック
  let daysToAdd: number;
  if (includeToday) {
    const todayDayIndex = nowJST.getUTCDay();
    // 全登録表示では、21時以降でも翌日から表示（新規登録は明後日から）
    // 当日が登録可能日であれば0から、そうでなければ翌日から
    if (currentHour >= 21) {
      // 21時以降: 翌日が登録可能日なら1、そうでなければ2
      const tomorrow = new Date(nowJST);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const tomorrowDayIndex = tomorrow.getUTCDay();
      daysToAdd = availableDays.includes(tomorrowDayIndex) ? 1 : 2;
    } else {
      // 21時前: 当日が登録可能日なら0、そうでなければ1
      daysToAdd = availableDays.includes(todayDayIndex) ? 0 : 1;
    }
  } else {
    daysToAdd = currentHour >= 21 ? 2 : 1;
  }
  
  const startDate = new Date(nowJST);
  startDate.setUTCDate(startDate.getUTCDate() + daysToAdd);
  startDate.setUTCHours(0, 0, 0, 0);

  const results: { label: string; value: string }[] = [];
  const weekDays = ['日', '月', '火', '水', '木', '金', '土'];

  for (let i = 0; i < 7; i++) {
    const targetDate = new Date(startDate);
    targetDate.setUTCDate(startDate.getUTCDate() + i);

    const dayIndex = targetDate.getUTCDay();
    
    if (availableDays.includes(dayIndex)) {
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
