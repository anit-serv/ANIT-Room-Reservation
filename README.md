# ANIT Room Reservation System

LINE Botを使った部屋予約・抽選管理システムです。登録可能日（水・木・土）に対して予約を受け付け、毎日21:00に自動抽選を行い、結果をBAND APIを通じて通知します。

## 🎯 主な機能

### LINE Bot
- **予約登録**: バンド名と日時を選択して予約
- **予約一覧**: 自分の予約を確認・編集・削除
- **全登録表示**: 特定日の全予約状況を確認
- **抽選結果表示**: 順位付きで表示（抽選後）
- **カルーセル UI**: ページネーション対応の快適な操作感
- **状態管理**: 5分間のセッション管理とタイムアウト処理

### 自動処理（Cron Job）
- **抽選実行** (`/api/lottery`): 毎日21:00に翌日分の抽選を実行
- **結果通知** (`/api/notify`): 抽選結果をBANDに投稿
- **データ整理** (`/api/data-organize`): 古いデータと期限切れセッションを削除

## 🛠️ 技術スタック

- **Runtime**: Node.js (TypeScript)
- **Hosting**: Vercel (Serverless Functions)
- **Database**: Firebase Firestore
- **APIs**:
  - LINE Messaging API
  - BAND Developers API
- **Dependencies**:
  - `@line/bot-sdk`: LINE Bot SDK
  - `firebase-admin`: Firebase Admin SDK
  - `axios`: HTTP client
  - `dotenv`: 環境変数管理

## 📁 プロジェクト構成

```
api/
├── webhook.ts          # LINE Bot メインロジック
├── lottery.ts          # 抽選実行エンドポイント
├── notify.ts           # BAND通知エンドポイント
├── clear-lottery.ts    # 抽選結果クリアエンドポイント
├── data-organize.ts    # データクリーンアップエンドポイント
└── wake.ts             # サーバー起動確認エンドポイント

scripts/
└── generate-test-url.js # テスト用URL生成ツール
```

## 🚀 セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数の設定

`.env` ファイルを作成し、以下の変数を設定してください：

```env
# Firebase
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-client-email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# LINE Bot
LINE_CHANNEL_ACCESS_TOKEN=your-channel-access-token
LINE_CHANNEL_SECRET=your-channel-secret

# BAND API
BAND_ACCESS_TOKEN=your-band-access-token
BAND_KEY=your-band-key

# Cron Job セキュリティ
CRON_SECRET=your-random-secret-key
```

### 3. Firebase サービスアカウントキー

Firebase Admin SDKのサービスアカウントキーJSONファイルを取得し、プロジェクトルートに配置してください：
- ファイル名: `anit-room-reservation-firebase-adminsdk-*.json`
- **注意**: このファイルは`.gitignore`に含まれています

### 4. Firestore 設定

以下のコレクションが必要です：

- `reservations`: 予約データ
- `lottery_results`: 抽選結果
- `states`: ユーザーセッション状態
- `settings`: システム設定（時間枠、登録可能曜日）

#### settings/reservation ドキュメント例：

```json
{
  "availableDays": [3, 4, 6],  // 水・木・土
  "timeSlots": [
    { "label": "9:00~10:00", "value": "09:00-10:00" },
    { "label": "10:00~12:00", "value": "10:00-12:00" },
    { "label": "12:00~14:00", "value": "12:00-14:00" },
    { "label": "14:00~16:00", "value": "14:00-16:00" },
    { "label": "16:00~18:00", "value": "16:00-18:00" },
    { "label": "18:00~20:00", "value": "18:00-20:00" }
  ]
}
```

## 📡 APIエンドポイント

### LINE Webhook
- **POST** `/api/webhook`
  - LINE Messaging APIからのWebhook受信

### Cron Job用（認証必須: `?key=CRON_SECRET`）

#### 抽選実行
```
GET /api/lottery?key=SECRET&force=true&date=YYYY-MM-DD
```
- `force`: 曜日チェックをスキップ（オプション）
- `date`: 対象日を指定（オプション、デフォルト: 翌日）

#### BAND通知
```
GET /api/notify?key=SECRET&date=YYYY-MM-DD
```
- `date`: 通知する日を指定（オプション、デフォルト: 翌日）

#### データ整理
```
GET /api/data-organize?key=SECRET&days=7
```
- `days`: 保持する日数（オプション、デフォルト: 7日）

#### 抽選結果クリア
```
GET /api/clear-lottery?key=SECRET&date=YYYY-MM-DD
```
- `date`: クリアする日を指定（必須）

### その他

#### サーバー起動確認
```
GET /api/wake
```

## 🔧 開発ツール

### テストURL生成ツール

```bash
npm run gen-url
```

対話形式でエンドポイントのテストURLを生成できます：
- エンドポイント選択
- 日付選択（今日/明日/明後日/カスタム）
- オプション設定
- クリップボードへのコピー

## 🚢 デプロイ

### Vercel へのデプロイ

```bash
npx vercel --prod
```

### Cron Jobの設定

Vercelのダッシュボード、または外部Cronサービス（cron-job.org等）で以下を設定：

```
# 毎日21:00（JST）に抽選実行
0 12 * * * https://your-app.vercel.app/api/lottery?key=SECRET

# 毎日21:05（JST）に通知
5 12 * * * https://your-app.vercel.app/api/notify?key=SECRET

# 毎日深夜2:00（JST）にデータ整理
0 17 * * * https://your-app.vercel.app/api/data-organize?key=SECRET

# 10分ごとにサーバー起動維持（オプション）
*/10 * * * * https://your-app.vercel.app/api/wake
```

**注意**: 時刻はUTC表記です（JST = UTC+9）

## 📝 使用方法

### ユーザー操作（LINE Bot）

1. **予約登録**
   - 「登録したい」と送信
   - バンド名を入力
   - 日付と時間を選択

2. **予約確認**
   - 「自分の登録を見たい」と送信
   - カルーセルで一覧表示
   - 編集・削除が可能

3. **全体確認**
   - 「全登録を見たい」と送信
   - 日付を選択して全予約を表示

4. **キャンセル**
   - いつでも「キャンセル」と送信して操作中断

### 管理者操作

- テスト用URL生成ツールを使用
- Vercelのログで実行状況を確認
- Firestoreで直接データを確認・編集

## 🔒 セキュリティ

- 全てのCron Job用エンドポイントは`CRON_SECRET`で保護
- Firebaseサービスアカウントキーは環境変数で管理
- カルーセルボタンは5分間の有効期限付き
- タイムスタンプベースの重複操作防止

## 📊 データ保持期間

- **予約データ**: 7日間（自動削除）
- **抽選結果**: 7日間（自動削除）
- **ユーザー状態**: 5分間（セッションタイムアウト後に削除）

## ⚠️ 注意事項

- LINE Botの応答時間は5秒以内に制限されています
- Firestoreの読み書き回数に注意してください
- BAND APIのレート制限に注意してください
- タイムゾーンはJST（UTC+9）で統一されています

## 📄 ライセンス

ISC