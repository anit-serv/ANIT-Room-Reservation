# ANIT Room Reservation System

LINE LIFF アプリと Web 管理画面を組み合わせた、音楽練習室の予約管理システムです。

## 概要

3つの施設を統合管理します。

| 施設 | 予約方式 | 対象 |
|------|---------|------|
| 農部生協 | **抽選制**（毎日自動抽選） | 農部生協練習室 |
| 工部室 | **先着確定制** | 工学部練習室 |
| 農部室 | **先着確定制** | 農部練習室 |

ユーザーは LINE 内の LIFF アプリから予約を登録し、管理者は Web ブラウザから専用の管理画面にアクセスします。

## 機能一覧

### LIFF アプリ（LINE 内ウェブアプリ）

| タブ | 機能 |
|------|------|
| 農部生協 | 予約登録（バンド名・日付・時間枠）、全登録表示（日付別・スロット別）|
| 農部室 | 週間スケジュール表示、時間ブロック予約・変更・キャンセル |
| 工部室 | 週間スケジュール表示、時間ブロック予約・変更・キャンセル |
| 自分の予約 | 全施設の予約一覧確認・削除・編集 |

- お気に入りバンド登録（優先時間枠設定付き）
- 翌週繰り返し予約
- 同日同名バンドの重複登録禁止
- BANユーザーの予約不可

### LINE Bot（Webhook）

- カルーセル UI による農部生協の予約登録・確認・削除
- 抽選結果の閲覧（順位付き）
- 5分間のセッション管理とタイムアウト処理
- 抽選時間中の操作ブロック

### Web 管理画面

| ページ | 機能 |
|--------|------|
| ダッシュボード | 全施設の予約・ユーザー統計、直近予約、監査ログ概要 |
| 予約管理（農部生協） | 一覧・フィルタ・編集・キャンセル、URL フォーカス |
| 予約管理（工部室） | 一覧・フィルタ・編集・キャンセル |
| 予約管理（農部室） | 一覧・フィルタ・編集・キャンセル |
| ユーザー管理 | 一覧・検索・BAN/解除、予約履歴モーダル |
| 管理者管理 | 招待リンク発行・削除、スーパー管理者移譲 |
| 設定（農部生協） | 登録可能曜日・時間枠・追加日・除外日・曜日別スケジュール・抽選時刻・スケジュール変更予約 |
| 緊急対応（農部生協） | 直近8日間の予約受付停止・臨時開放（即時反映） |
| 設定（工部室・農部室） | 利用可能曜日・時間枠・追加日・除外日・曜日別スケジュール |
| 監査ログ | 管理者操作の全履歴閲覧（1年保持） |

- デスクトップ・タブレット・モバイル対応レスポンシブ UI
- 設定画面の未保存変更離脱警告
- 抽選時刻を管理画面から変更（cron-job.org を自動更新）
- 設定変更の予約適用（指定日から反映）

### 自動処理（cron-job.org）

| ジョブ | タイミング | エンドポイント |
|--------|----------|--------------|
| Lottery | 抽選時刻の5分前 | `/api/lottery` |
| Notify | 抽選時刻 | `/api/notify` |
| Data Organize | 毎日 02:00 JST | `/api/data-organize` |
| Wake up | 定期起動 | `/api/wake` |

## 技術スタック

| 区分 | 内容 |
|------|------|
| フロントエンド | React 18 / TypeScript / Vite / Tailwind CSS v4 |
| バックエンド | Vercel Serverless Functions (Node.js / TypeScript) |
| データベース | Firebase Firestore |
| ホスティング | Vercel |
| Cron | cron-job.org |
| ユーザー認証 | LINE LIFF / LINE Access Token |
| 管理者認証 | LINE Login OAuth2 → 一時コード交換フロー |
| 外部 API | LINE Messaging API / LINE LIFF / BAND Developers API |

## プロジェクト構成

```
.
├── api/
│   ├── admin.ts                # 管理画面 API（認証・予約・ユーザー・管理者・設定・ログ）
│   ├── reservations.ts         # 農部生協 LIFF 予約 API
│   ├── facility-reservations.ts # 工部室・農部室 LIFF 予約 API
│   ├── settings.ts             # 農部生協 設定取得 API（公開）
│   ├── facility-settings.ts    # 工部室・農部室 設定取得 API（公開）
│   ├── webhook.ts              # LINE Bot Webhook（農部生協）
│   ├── lottery.ts              # 農部生協 抽選実行
│   ├── notify.ts               # BAND 通知
│   ├── clear-lottery.ts        # 抽選結果クリア
│   ├── data-organize.ts        # データクリーンアップ
│   └── wake.ts                 # サーバー起動確認
│
├── lib/
│   ├── reservationSettings.ts  # 設定解決ロジック（バージョン管理・施設共通）
│   ├── lotteryTime.ts          # 抽選時刻ユーティリティ
│   ├── update-reservation-status.ts  # 農部生協専用 抽選ステータス更新
│   ├── verifyAdmin.ts          # 管理者認証
│   └── verifyLineToken.ts      # LINE トークン検証
│
├── src/
│   ├── main.tsx                # エントリーポイント
│   ├── index.css               # グローバルスタイル（Tailwind v4）
│   ├── contexts/
│   │   └── ToastContext.tsx    # グローバルトースト通知
│   ├── components/
│   │   ├── CalendarPicker.tsx  # カレンダー選択 UI
│   │   ├── DatePicker.tsx      # 日付入力（カレンダーポップオーバー付き）
│   │   ├── ConfirmDialog.tsx   # 確認ダイアログ
│   │   ├── FavoritePicker.tsx  # お気に入りバンド選択
│   │   ├── Skeleton.tsx        # スケルトンスクリーン
│   │   └── Toast.tsx           # トースト通知
│   ├── admin/
│   │   ├── AdminApp.tsx        # 管理画面ルーティング
│   │   ├── AdminLayout.tsx     # 共通レイアウト・サイドナビ
│   │   ├── Login.tsx           # LINE Login（コード交換フロー）
│   │   ├── auth.ts             # 管理者トークン管理
│   │   ├── components/         # 設定エディタ系（TimeSlotsEditor 等）
│   │   └── pages/              # 各管理ページ
│   └── liff/
│       ├── LiffApp.tsx         # LIFF アプリ（4タブ）
│       └── pages/
│           ├── ReservationForm.tsx      # 農部生協 予約登録
│           ├── AllReservations.tsx      # 農部生協 全体確認
│           ├── KobuSchedule.tsx         # 工部室 週間スケジュール・予約
│           ├── KobuReservationForm.tsx  # 工部室 予約フォーム
│           ├── NobuRoomSchedule.tsx     # 農部室 週間スケジュール・予約
│           └── MyReservations.tsx       # 自分の予約一覧
│
├── firebase.json               # Firebase CLI 設定
├── firestore.indexes.json      # Firestore 複合インデックス定義
├── vercel.json                 # Vercel 設定（リライト・Cron）
└── tsconfig.json
```

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数の設定

`.env` ファイルを作成します（`.gitignore` 済み）：

```env
# Firebase Admin SDK
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-client-email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# LINE Bot（Webhook・農部生協）
LINE_CHANNEL_ACCESS_TOKEN=your-channel-access-token
LINE_CHANNEL_SECRET=your-channel-secret

# LINE Login（管理画面認証）
LINE_LOGIN_CHANNEL_ID=your-login-channel-id
LINE_LOGIN_CHANNEL_SECRET=your-login-channel-secret

# BAND API（抽選結果通知）
BAND_ACCESS_TOKEN=your-band-access-token
BAND_KEY=your-band-key

# Cron ジョブ認証
CRON_SECRET=your-random-secret-key

# cron-job.org API（抽選時刻の動的変更用）
CRONJOB_ORG_API_KEY=your-cronjob-org-api-key
CRONJOB_ORG_LOTTERY_JOB_ID=your-lottery-job-id
CRONJOB_ORG_NOTIFY_JOB_ID=your-notify-job-id

# LIFF（フロントエンドのみ、VITE_ プレフィックス必須）
VITE_LIFF_ID=your-liff-id
```

Vercel には `vercel env add <変数名>` で登録します。

### 3. ローカル開発

```bash
npm run dev
```

- 管理画面: `http://localhost:5173/admin`
- LIFF アプリ: LINE アプリ内専用のためローカルでは動作しません

### 4. Firestore インデックスのデプロイ

初回セットアップ時、または `firestore.indexes.json` を変更した場合に実行します：

```bash
firebase use <project-id>
firebase deploy --only firestore:indexes
```

### 5. Firestore コレクション

| コレクション | 用途 | 保持期間 |
|------------|------|---------|
| `reservations` | 農部生協 予約データ | 4年 |
| `kobu_reservations` | 工部室 予約データ | 4年 |
| `nobu_room_reservations` | 農部室 予約データ | 4年 |
| `lottery_results` | 農部生協 抽選結果 | 4年 |
| `users` | LINE ユーザー情報 | 永続 |
| `admins` | 管理者情報 | 永続 |
| `settings` | システム設定（サブコレクション含む） | 永続 |
| `invitations` | 管理者招待トークン | 永続 |
| `auth_codes` | ログイン一時コード（60秒 TTL） | 60秒自動削除 |
| `auditLogs` | 管理者操作ログ | 1年 |
| `states` | LINE Bot セッション状態 | 5分 |
| `timeSlotPresets` | 時間枠プリセット | 永続 |
| `favorites` | ユーザーのお気に入りバンド | 永続 |

#### settings ドキュメント構成

```
settings/
├── reservation              # 農部生協 基本設定（availableDays, timeSlots, lotteryTime, ...）
│   ├── versions/{date}      # スケジュール変更バージョン（適用日別）
│   └── dayOverrides/{date}  # 緊急対応オーバーライド
├── kobu                     # 工部室 基本設定
│   └── versions/{date}
└── nobu-room                # 農部室 基本設定
    └── versions/{date}
```

## デプロイ

```bash
vercel --prod
```

## API エンドポイント

### 公開 API（LINE アクセストークン必須）

```
GET  /api/settings                        農部生協 設定・予約可能日時取得
POST /api/reservations                    農部生協 予約登録
GET  /api/reservations/my                 自分の農部生協予約一覧
GET  /api/reservations/all?date=...       指定日の全予約（要認証）
POST /api/reservations/sync               ユーザー情報同期

GET  /api/kobu-settings                   工部室 設定取得
GET  /api/kobu-reservations/all           工部室 週間スケジュール（要認証）
GET  /api/kobu-reservations/my            自分の工部室予約一覧
POST /api/kobu-reservations               工部室 予約作成
PATCH /api/kobu-reservations/:id          工部室 予約変更
DELETE /api/kobu-reservations/:id         工部室 予約削除

GET  /api/nobu-room-settings              農部室 設定取得
GET  /api/nobu-room-reservations/all      農部室 週間スケジュール（要認証）
GET  /api/nobu-room-reservations/my       自分の農部室予約一覧
POST /api/nobu-room-reservations          農部室 予約作成
PATCH /api/nobu-room-reservations/:id     農部室 予約変更
DELETE /api/nobu-room-reservations/:id    農部室 予約削除

GET/POST   /api/favorites                 お気に入り一覧・登録
GET/PUT/DELETE /api/favorites/:id         お気に入り操作

POST /api/webhook                         LINE Bot Webhook
```

### 認証フロー（管理画面）

```
GET  /api/admin/auth/start                LINE Login OAuth 開始
GET  /api/admin/auth/callback             OAuth コールバック（一時コード発行）
GET  /api/admin/auth/exchange?code=...    一時コード → アクセストークン交換
GET  /api/admin/auth/me                   ログイン中の管理者情報
```

### 管理画面 API（管理者アクセストークン必須）

```
GET/PUT      /api/admin/settings               農部生協 設定取得・バージョン保存
PUT          /api/admin/settings/lottery-time  抽選時刻更新（cron-job.org 連動）
DELETE       /api/admin/settings/scheduled     予約済み設定変更のキャンセル
GET/PUT/DELETE /api/admin/settings/day-overrides  緊急対応オーバーライド

GET/PUT/DELETE /api/admin/kobu-settings         工部室 設定
GET/PUT/DELETE /api/admin/nobu-room-settings    農部室 設定

GET      /api/admin/reservations            農部生協 予約一覧
PUT      /api/admin/reservations/:id        農部生協 予約編集
DELETE   /api/admin/reservations/:id        農部生協 予約キャンセル
GET      /api/admin/kobu-reservations       工部室 予約一覧
PUT      /api/admin/kobu-reservations/:id   工部室 予約編集
DELETE   /api/admin/kobu-reservations/:id   工部室 予約キャンセル
GET      /api/admin/nobu-room-reservations       農部室 予約一覧
PUT      /api/admin/nobu-room-reservations/:id   農部室 予約編集
DELETE   /api/admin/nobu-room-reservations/:id   農部室 予約キャンセル

GET      /api/admin/users                   ユーザー一覧
GET/PUT  /api/admin/users/:id               ユーザー詳細・BAN 操作
GET      /api/admin/admins                  管理者一覧
DELETE   /api/admin/admins/:id              管理者削除
POST     /api/admin/admins/:id/transfer-super  スーパー管理者移譲
GET/POST /api/admin/invitations             招待一覧・発行
DELETE   /api/admin/invitations/:token      招待取り消し
GET      /api/admin/logs                    監査ログ
GET      /api/admin/dashboard               ダッシュボードデータ
```

### Cron ジョブ用（`CRON_SECRET` 認証）

```
GET /api/lottery?key=SECRET[&force=true][&date=YYYY-MM-DD]
GET /api/notify?key=SECRET[&date=YYYY-MM-DD]
GET /api/data-organize?key=SECRET[&days=1461]
GET /api/clear-lottery?key=SECRET&date=YYYY-MM-DD
GET /api/wake
```

## Cron 設定（cron-job.org）

管理画面「設定 → 抽選時刻」から変更すると cron-job.org のスケジュールが自動更新されます。

| ジョブ | スケジュール（JST） | UTC 換算 |
|--------|-----------------|---------|
| Lottery | 抽選時刻の5分前（例: 20:55） | 例: 11:55 |
| Notify | 抽選時刻（例: 21:00） | 例: 12:00 |
| Data Organize | 毎日 02:00 | 17:00（前日） |
| Wake up | 任意間隔 | — |

## 予約ルール

### 農部生協（抽選制）

- 抽選時刻の**10分前から抽選時刻まで**、当日・翌日の登録不可
- 同日に同名バンドは1枠のみ登録可能
- 予約可能期間は翌日以降7日先まで（曜日・追加日・除外日設定に依存）
- 毎日設定した時刻に抽選を実行、結果を BAND グループに通知

### 工部室・農部室（先着確定制）

- 先着順で即時確定、抽選なし
- 時間枠は15分単位で自由に指定（施設設定の営業時間内）
- 重複する時間帯の同時予約を防止（Firestore トランザクション）
- 最大予約期間は最大31日先まで（施設設定に依存）

## セキュリティ

| 区分 | 対策 |
|------|------|
| Cron エンドポイント | `CRON_SECRET` によるクエリパラメータ認証 |
| LIFF API | LINE Access Token をサーバー側で `/v2/profile` に問い合わせて検証 |
| 管理画面認証 | LINE Login OAuth2 → サーバー側でトークン検証 → 一時コード（60秒有効）を発行 → フロントがコードとトークンを交換（トークンが URL に露出しない設計） |
| 管理者チェック | Firestore `admins` コレクションで管理者登録を確認 |
| 招待リンク | 24時間有効・一度使用で無効化、スーパー管理者がアクターとして監査ログに記録 |
| 二重予約防止 | Firestore トランザクションで重複チェックと書き込みを原子的に実行 |
| 監査ログ | 管理者操作をすべて記録（1年保持） |
