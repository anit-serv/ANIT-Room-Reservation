# キュー・cron移行と運用

## 配備する構成

| cron-job.orgジョブ | 呼出先 | 実行時刻 |
|---|---|---|
| ANIT scheduler | `/api/scheduler` | キューの次回日時。BAND確認中だけ当該時間帯を毎分 |
| ANIT recovery | `/api/scheduler/recover` | 2分ごと（固定） |
| 既存データ整理 | `/api/data-organize` | 既存の日次時刻を維持 |

両方の新ジョブはAuthorizationヘッダーで `Bearer CRON_SECRET` を渡す。URLに秘密値を入れない。
新URLは既存のdata-organize Functionへrewriteする。抽選締切は予約APIの絶対日時検証で制御し、締切ジョブは作らない。
次回ジョブが更新されなかった場合にも、固定の復旧ジョブが期限に達した処理を実行する。

## 環境変数

| 変数 | 設定 |
|---|---|
| `SCHEDULER_ENABLED` | `true`でキューへ切替。未指定時は既存cron経路 |
| `CRONJOB_ORG_SCHEDULER_JOB_ID` | prepareで作成する次回処理ジョブID |
| `CRONJOB_ORG_RECOVERY_JOB_ID` | prepareで作成する復旧ジョブID（移行ツール用） |
| `CRONJOB_ORG_API_KEY` | 既存のcron-job.org APIキー |
| `CRON_SECRET` | 既存の実行認証値 |
| `PUBLIC_BASE_URL` | 対象環境の固定HTTPS origin。末尾パスなし |
| `CRONJOB_ORG_LEGACY_JOB_IDS` | 停止する旧ジョブIDをカンマ区切りで指定（移行ツール用） |

Firebase/BANDの接続情報は既存の環境変数を使う。本番とPreviewのFirestore・cronジョブを共有したまま、Previewでキューを有効にしない。
VERCEL_ENVがproduction以外での有効化には、分離済みDB・BAND接続・cronジョブを用意した上で `SCHEDULER_ISOLATED_ENVIRONMENT=true` も必要。
このフラグは分離作業そのものを行わない。

## 切替手順

1. `npm run test:scheduler`、`npx tsc --noEmit`、`npx tsc --noEmit -p tsconfig.app.json`、`npm run build` を実行。
2. Firestoreへ `firestore.indexes.json` のscheduled_jobs(status, availableAt) indexを配備し、有効になるまで待つ。
3. 切替中の外部送信を避けるため、既存の抽選・通知・コメント確認が動いていない時間を選ぶ。
4. ローカルの環境変数を対象環境に合わせ、`node tools/scheduler-cron.cjs prepare` を実行。新しい2ジョブを**無効状態で**作成する。作成結果不明の場合は自動で再作成しない。コンソールで確認する。
5. 出力されたジョブID、固定PUBLIC_BASE_URL、`SCHEDULER_ENABLED=true` を対象デプロイへ設定し、このコードを配備する。この時点から旧実行URLもキューを通るため、旧URLとの競合でも抽選・送信を重ねない。
6. `CRONJOB_ORG_LEGACY_JOB_IDS` に旧抽選・通知・抽選時刻更新・BAND毎分確認・Wake upの**実在するIDを確認して**設定する。データ整理ジョブは含めない。新ジョブのIDも含めない。
7. `node tools/scheduler-cron.cjs activate` を実行。稼働コードのinspectを確認し、旧ジョブを停止→復旧ジョブを有効化→初回復旧・次回起動設定の順で実行する。
8. 管理画面「BAND通知状況」で最終復旧確認、実行待ち数、要確認項目、cronエラーを確認する。cron-job.orgでも次回日時と実行成功を確認する。
9. 旧ジョブは削除せず停止状態で残す。ローカルの `.scheduler-cron-state.json` は既存ジョブの有効状態を控える。秘密値は保存しない。Gitへ含めない。

## 処理失敗時

- 通常の一時エラー: 1分から最大15分のバックオフ。8回失敗したジョブはmanualとなり管理画面へ表示。
- 成功した毎分確認では試行数をリセットする。確認の終了日時は延長しない。
- 実行中にプロセスが止まった場合: 6分のlease終了後、2分間隔の復旧処理が回収する。即時の復旧を保証するものではなく、停止タイミングによって最大約8分かかる。
- 抽選結果作成は予約確定と同一トランザクション。0件でも完了結果を作り、同じ利用日を抽選し直さない。
- 通知結果なし: 抽選完了を待って再試行。利用開始後の未実施抽選、通知予定から6時間超の未開始通知はmanual。
- BAND送信結果不明: `band_deliveries` の本文・利用日・版・送信開始日時と自分の投稿／コメントを照合。見つかれば継続し、確認できなければ自動再送を停止。管理画面の「送信結果を再確認する」は照合の再実行であり、不明な送信の再送ではない。
- 照合で見つからない状態は、管理者がBAND画面で実送信を確認する。完全なexactly-once送信はBAND APIの冪等キーがないため保証できない。
- 未送信をBAND画面で確認できた場合のみ、管理画面の「未送信を確認して再送を許可する」を使用する。確認者と確認日時を記録し、同じ送信記録で再試行する。
- キューのmanualを解除する際は、送信結果の確認を先に行う。DBの送信記録を消して再実行すると重複投稿の原因になる。
- 旧投稿削除: 新投稿の記録と削除予定を同一トランザクションで保存。削除は再試行し、1時間で未解決ならmanual。結果が空になった場合は旧通知の削除だけを行う。

## cron APIの制限と復旧

通常のREST API枠は100リクエスト/日。毎分確認は時間帯単位の同じ設定を再利用し、毎分PATCHしない。
複数の長時間の確認や多数の設定変更があると枠を超える可能性は残る。429等は同期エラーとして記録し、固定復旧ジョブはREST APIとは独立して処理を続ける。
cronのexpiresAtはUnix秒ではなくジョブのタイムゾーンでの `YYYYMMDDhhmmss` を使用。
仕様の出典: https://docs.cron-job.org/rest-api.html

## 切戻し

1. 復旧ジョブと次回処理ジョブを停止し、実行中leaseと送信結果不明の記録を確認する。
2. 記録を保持したまま `SCHEDULER_ENABLED=false` のコードを配備する。
3. 旧抽選・通知・日次時刻更新・BAND確認のURL／時刻を現在設定に合わせて確認し、停止前の状態へ戻す。投稿方式でもキャンセル更新用BAND確認ジョブが必要。
4. 一度送信した通知のband_deliveriesとlottery_resultsは削除しない。

## 実装時の検証と残る実環境確認

偽Firestore・偽BAND・偽cron APIで、日時境界、同時取得、lease回収、送信成功後のDB失敗、結果不明、キャンセル競合、複数コメント、フォールバック、cron同期失敗の復旧を検証する。
Firestore Emulator／実環境でのindex作成・cron配備・BAND照合の疎通は別の確認事項。ローカルテストでは実データの変更・実投稿は行わない。
