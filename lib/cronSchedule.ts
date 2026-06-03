import axios from 'axios'

export type CronApplyResult = { applied: boolean; warning?: string }

/**
 * cron-job.org の抽選ジョブ（抽選時刻の5分前）と通知ジョブ（抽選時刻）の
 * スケジュールを指定の抽選時刻（HH:MM）に合わせて更新する。
 *
 * 即時上書き（緊急エンドポイント）と日次リコンサイラの両方から呼ばれる。
 * 環境変数が未設定の場合は applied=false を返すだけで何もしない。
 */
export async function applyLotteryCronSchedule(lotteryTime: string): Promise<CronApplyResult> {
  const apiKey       = process.env.CRONJOB_ORG_API_KEY
  const lotteryJobId = process.env.CRONJOB_ORG_LOTTERY_JOB_ID
  const notifyJobId  = process.env.CRONJOB_ORG_NOTIFY_JOB_ID
  if (!apiKey || (!lotteryJobId && !notifyJobId)) return { applied: false }

  const [h, m] = lotteryTime.split(':').map(Number)
  const lotteryMinutes = h * 60 + m

  // 抽選ジョブ: 5分前
  const lotteryJobMinutes = lotteryMinutes - 5
  const lotteryJobH = Math.floor(lotteryJobMinutes / 60)
  const lotteryJobM = lotteryJobMinutes % 60

  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  const makeSchedule = (jh: number, jm: number) => ({
    job: { schedule: { timezone: 'Asia/Tokyo', expiresAt: 0, hours: [jh], minutes: [jm], mdays: [-1], months: [-1], wdays: [-1] } },
  })

  try {
    await Promise.all([
      lotteryJobId && axios.patch(`https://api.cron-job.org/jobs/${lotteryJobId}`, makeSchedule(lotteryJobH, lotteryJobM), { headers }),
      notifyJobId  && axios.patch(`https://api.cron-job.org/jobs/${notifyJobId}`,  makeSchedule(h, m),                    { headers }),
    ])
    return { applied: true }
  } catch (err: any) {
    return { applied: false, warning: 'cron-job.orgの更新に失敗しました: ' + err.message }
  }
}
