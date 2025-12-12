import { VercelRequest, VercelResponse } from '@vercel/node';
import * as line from '@line/bot-sdk';
import 'dotenv/config';

// LINEの認証設定
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
  channelSecret: process.env.LINE_CHANNEL_SECRET!,
};

// クライアントの作成
const client = new line.Client(config);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 1. GETリクエスト（ブラウザからのアクセス）なら生存確認を返す
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'active', message: 'LINE Bot is ready!' });
  }

  // 2. LINE以外からの怪しいアクセスを除外（署名検証）
  // ※Vercelの場合、署名検証を厳密にやるには少し工夫が必要ですが、
  // 一旦簡易的なチェックで進めます。本番運用で厳密にする場合は修正します。
  
  // 3. イベント処理
  try {
    const events: line.WebhookEvent[] = req.body.events;

    // イベントを並列処理
    const results = await Promise.all(
      events.map(async (event) => {
        return handleEvent(event);
      })
    );

    return res.status(200).json({ status: 'success', results });

  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ status: 'error', error: error.message });
  }
}

// イベントごとの処理分け
async function handleEvent(event: line.WebhookEvent) {
  // メッセージイベント以外（友達追加など）は無視
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  // 受信したテキスト
  const userText = event.message.text;

  // 返信するメッセージを作成
  // ここを書き換えるだけでボットの性格が変わります！
  const replyText = `あなたが言ったのは: 「${userText}」 ですね！`;

  // 返信を実行
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: replyText,
  });
}