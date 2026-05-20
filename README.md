# ANIT Room Reservation System

LINE Bot / LIFFアプリ と Web管理画面を組み合わせた、音楽練習室の予約・抽選管理システムです。

## 概要

ユーザーは LINE 内のアプリから予約を登録し、毎日設定した時刻に自動抽選が行われます。結果は BAND API で通知されます。管理者は Web ブラウザから専用の管理画面にアクセスし、予約・ユーザー・設定などを管理できます。

## 機能一覧

### LIFFアプリ（LINE内ウェブアプリ）

- 予約登録（バンド名・日付・時間枠を選択）
- 自分の予約一覧確認・削除
- 全登録表示（日付別）
- 同日同名バンドの重複登録禁止

### LINE Bot（Webhook）

- カルーセルUIによる予約登録・確認・削除
- 抽選結果の閲覧（順位付き）
- 5分間のセッション管理とタイムアウト処理
- 抽選時間中の操作ブロック

### Web管理画面

| ページ | 機能 |
|--------|------|
| ダッシュボード | 予約・ユーザー統計、直近予約、監査ログ概要 |
| 予約管理 | 一覧・フィルタ・編集・削除、URLフォーカス機能 |
| ユーザー管理 | 一覧・検索・BAN/解除、予約履歴モーダル |
| 管理者管理 | 招待リンク発行、削除、スーパー管理者移譲 |
| 設定 | 登録可能曜日・時間枠・追加日・除外日・曜日別スケジュール・抽選時刻 |
| 監査ログ | 管理者操作の履歴閲覧（1年保持） |

- モバイル対応（アコーディオン形式カード表示）
- 設定画面の未保存変更離脱警告
- 抽選時刻を管理画面から変更（cron-job.org を自動更新）
- 設定変更の予約適用（指定日から反映）

### 自動処理（cron-job.org）

| ジョブ名 | タイミング | エンドポイント |
|---------|----------|--------------|
| ANIT Room Lottery | 抽選時刻の5分前 | `/api/lottery` |
| ANIT Room Notify | 抽選時刻 | `/api/notify` |
| ANIT Room Data Organize | 毎日 02:00 JST | `/api/data-organize` |
| ANIT Room Wake up | 定期起動 | `/api/wake` |

## 技術スタック

| 区分 | 内容 |
|------|------|
| フロントエンド | React 18 / TypeScript / Vite / Tailwind CSS v4 |
| バックエンド | Vercel Serverless Functions (Node.js / TypeScript) |
| データベース | Firebase Firestore |
| ホスティング | Vercel |
| Cron | cron-job.org |
| ユーザー認証 | LINE LIFF / LINE ID Token |
| 管理者認証 | LINE Login → JWT |
| 外部API | LINE Messaging API / LINE LIFF / BAND Developers API |

## プロジェクト構成

```
.
├── api/
│   ├── admin.ts            # 管理画面API（予約・ユーザー・管理者・設定・ログ）
│   ├── reservations.ts     # LIFF予約API
│   ├── settings.ts         # 設定取得API（公開）
│   ├── webhook.ts          # LINE Bot Webhook
│   ├── lottery.ts          # 抽選実行
│   ├── notify.ts           # BAND通知
│   ├── clear-lottery.ts    # 抽選結果クリア
│   ├── data-organize.ts    # データクリーンアップ
│   └── wake.ts             # サーバー起動確認
│
├── lib/
│   ├── lotteryTime.ts      # 抽選時刻ユーティリティ（全API共通）
│   ├── verifyAdmin.ts      # 管理者認証
│   └── verifyLineToken.ts  # LINEトークン検証
│
├── src/
│   ├── main.tsx            # エントリーポイント（createBrowserRouter）
│   ├── index.css           # グローバルスタイル（Tailwind v4）
│   ├── admin/              # Web管理画面
│   │   ├── AdminApp.tsx
│   │   ├── AdminLayout.tsx
│   │   ├── Login.tsx
│   │   ├── auth.ts
│   │   ├── components/     # 設定エディタ系コンポーネント
│   │   └── pages/          # 各管理ページ
│   ├── components/
│   │   └── Skeleton.tsx
│   └── liff/               # LIFFアプリ
│       ├── LiffApp.tsx
│       └── pages/
│
├── vercel.json             # Vercel設定（リライト・Cronジョブ）
├── firestore.indexes.json  # Firestoreインデックス定義
└── tsconfig.app.json       # フロントエンド用TypeScript設定
```

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数の設定

`.env` ファイルを作成し以下を設定します（`.env` は `.gitignore` 済み）：

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

# Cronジョブ認証
CRON_SECRET=your-random-secret-key

# cron-job.org API（抽選時刻の動的変更用）
CRONJOB_ORG_API_KEY=your-cronjob-org-api-key
CRONJOB_ORG_LOTTERY_JOB_ID=your-lottery-job-id
CRONJOB_ORG_NOTIFY_JOB_ID=your-notify-job-id

# LIFF（フロントエンドのみ、VITE_プレフィックス必須）
VITE_LIFF_ID=your-liff-id
```

Vercelには `vercel env add <変数名>` で登録します。

### 3. ローカル開発

```bash
npm run dev
```

- 管理画面: `http://localhost:5173/admin`
- LIFFアプリ: LINE アプリ内専用のため localhost では動作しません

### 4. Firestore コレクション

以下のコレクションが使用されます（自動生成）：

| コレクション | 用途 | 保持期間 |
|------------|------|---------|
| `reservations` | 予約データ | 4年 |
| `lottery_results` | 抽選結果 | 4年 |
| `users` | LINEユーザー情報 | 永続 |
| `admins` | 管理者情報 | 永続 |
| `settings` | システム設定 | 永続 |
| `invitations` | 管理者招待トークン | 永続 |
| `auditLogs` | 監査ログ | 1年 |
| `states` | LINEセッション状態 | 5分 |
| `timeSlotPresets` | 時間枠プリセット | 永続 |

#### settings/reservation ドキュメント例

```json
{
  "availableDays": [3, 4, 6],
  "lotteryTime": "21:00",
  "timeSlots": [
    { "label": "9:00~10:00",  "value": "09:00-10:00" },
    { "label": "10:00~12:00", "value": "10:00-12:00" },
    { "label": "12:00~14:00", "value": "12:00-14:00" },
    { "label": "14:00~16:00", "value": "14:00-16:00" },
    { "label": "16:00~18:00", "value": "16:00-18:00" },
    { "label": "18:00~20:00", "value": "18:00-20:00" }
  ]
}
```

### 5. Firestoreインデックスの作成

```bash
firebase deploy --only firestore:indexes
```

## デプロイ

```bash
vercel --prod
```

## APIエンドポイント

### 公開API

```
GET  /api/settings                    設定・予約可能日時取得
POST /api/reservations                予約登録（LINE IDトークン必須）
GET  /api/reservations/my             自分の予約一覧
GET  /api/reservations/all?date=...   指定日の全予約
POST /api/reservations/sync           ユーザー情報同期
POST /api/webhook                     LINE Bot Webhook
```

### 管理画面API（管理者JWTトークン必須）

```
GET/PUT  /api/admin/settings              設定の取得・更新（予約適用）
PUT      /api/admin/settings/lottery-time 抽選時刻の即時更新
DELETE   /api/admin/settings/scheduled    予約済み設定変更のキャンセル
GET      /api/admin/reservations          予約一覧（フィルタ可）
PUT      /api/admin/reservations/:id      予約編集
DELETE   /api/admin/reservations/:id      予約削除
GET      /api/admin/users                 ユーザー一覧
GET/PUT  /api/admin/users/:id             ユーザー詳細・BAN操作
GET      /api/admin/admins                管理者一覧
DELETE   /api/admin/admins/:id            管理者削除
POST     /api/admin/admins/:id/transfer-super  スーパー管理者移譲
GET/POST /api/admin/invitations           招待一覧・発行
DELETE   /api/admin/invitations/:token    招待取り消し
GET      /api/admin/logs                  監査ログ
GET      /api/admin/dashboard             ダッシュボードデータ
```

### Cronジョブ用（`CRON_SECRET` による認証）

```
GET /api/lottery?key=SECRET[&force=true][&date=YYYY-MM-DD]
GET /api/notify?key=SECRET[&date=YYYY-MM-DD]
GET /api/data-organize?key=SECRET[&days=1461]
GET /api/clear-lottery?key=SECRET&date=YYYY-MM-DD
GET /api/wake
```

## Cron設定（cron-job.org）

管理画面の「設定 → 抽選時刻」から変更すると、cron-job.org のスケジュールが自動で更新されます。

| ジョブ | スケジュール（JST） | UTC換算 |
|--------|-----------------|---------|
| Lottery | 抽選時刻の5分前（例: 20:55） | 例: 11:55 |
| Notify | 抽選時刻（例: 21:00） | 例: 12:00 |
| Data Organize | 毎日 02:00 | 17:00（前日） |
| Wake up | 任意間隔 | — |

## 予約ルール

- 抽選時刻の**10分前から抽選時刻まで**、当日・翌日の登録不可
- 同日に同名バンドは1枠のみ登録可能
- 予約可能期間は当日翌日以降7日先まで（曜日・追加日・除外日に依存）
- BANされたユーザーは予約不可

## セキュリティ

- Cronエンドポイント: `CRON_SECRET` によるクエリパラメータ認証（または `Authorization: Bearer` ヘッダー）
- 管理画面: LINE Login → サーバー側で JWT 発行・検証
- LIFFアプリ: LINE ID Token をサーバー側で検証
- 招待リンク: 24時間有効・一度使用で無効化
- 監査ログ: 管理者操作をすべて記録（1年保持）
