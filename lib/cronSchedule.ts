import axios from 'axios'
import type { Firestore } from 'firebase-admin/firestore'
import { schedulerEnabled } from './schedulerQueue'
import { refreshScheduler } from './scheduler'

export type CronApplyResult = { applied: boolean; warning?: string }

/**
 * cron-job.org の抽選ジョブ（前日モードは設定時刻の5分前、当日モードは前日23:55）と通知ジョブ（通知時刻）の
 * スケジュールをそれぞれ更新する。
 *
 * 即時上書き（緊急エンドポイント）と日次リコンサイラの両方から呼ばれる。
 * 環境変数が未設定の場合は applied=false を返すだけで何もしない。
 */
export async function applyLotteryCronSchedule(lotteryTime: string, notifyTime = lotteryTime, lotteryMode: 'previous-day' | 'same-day' = 'previous-day'): Promise<CronApplyResult> {
  // Queue-mode callers refresh after the DB settings have committed; never change old cron jobs.
  if (schedulerEnabled()) return { applied: false }
  const apiKey       = process.env.CRONJOB_ORG_API_KEY
  const lotteryJobId = process.env.CRONJOB_ORG_LOTTERY_JOB_ID
  const notifyJobId  = process.env.CRONJOB_ORG_NOTIFY_JOB_ID
  if (!apiKey || !lotteryJobId || !notifyJobId) {
    return { applied: false, warning: 'cron-job.org のAPIキーまたは抽選・通知ジョブIDが未設定です' }
  }

  const [h, m] = lotteryTime.split(':').map(Number)
  const lotteryMinutes = h * 60 + m
  const [notifyH, notifyM] = notifyTime.split(':').map(Number)

  // 当日モードでは利用日の前日23:55、前日モードでは設定時刻の5分前。
  const lotteryJobMinutes = lotteryMode === 'same-day' ? 23 * 60 + 55 : lotteryMinutes - 5
  const lotteryJobH = Math.floor(lotteryJobMinutes / 60)
  const lotteryJobM = lotteryJobMinutes % 60

  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  const makeSchedule = (jh: number, jm: number) => ({
    job: { schedule: { timezone: 'Asia/Tokyo', expiresAt: 0, hours: [jh], minutes: [jm], mdays: [-1], months: [-1], wdays: [-1] } },
  })

  try {
    await Promise.all([
      lotteryJobId && axios.patch(`https://api.cron-job.org/jobs/${lotteryJobId}`, makeSchedule(lotteryJobH, lotteryJobM), { headers }),
      notifyJobId  && axios.patch(`https://api.cron-job.org/jobs/${notifyJobId}`,  makeSchedule(notifyH, notifyM),        { headers }),
    ])
    return { applied: true }
  } catch (err: any) {
    return { applied: false, warning: 'cron-job.orgの更新に失敗しました: ' + err.message }
  }
}

/** Provision a single cron-job.org job which calls the BAND poll worker every minute. */
export async function ensureBandPollCron(db: Firestore, host: string | undefined): Promise<number> {
  if (schedulerEnabled()) { await refreshScheduler(db); return 0 }
  const apiKey = process.env.CRONJOB_ORG_API_KEY
  const cronSecret = process.env.CRON_SECRET
  const baseUrl = process.env.PUBLIC_BASE_URL ?? (host && /^[a-z0-9.-]+$/i.test(host) ? `https://${host}` : '')
  if (!apiKey || !cronSecret || !baseUrl) throw new Error('BAND定期確認ジョブの設定が不足しています')
  const ref = db.collection('settings').doc('room-preference')
  const saved = await ref.get()
  const jobId = saved.data()?.bandPollJobId
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  const job = { enabled: true, title: 'ANIT BAND notification polling',
    url: `${baseUrl.replace(/\/$/, '')}/api/band-poll?key=${encodeURIComponent(cronSecret)}`,
    saveResponses: false,
    schedule: { timezone: 'Asia/Tokyo', expiresAt: 0, hours: [-1], minutes: [-1],
      mdays: [-1], months: [-1], wdays: [-1] } }
  if (jobId) {
    await axios.patch(`https://api.cron-job.org/jobs/${jobId}`, { job }, { headers })
    return jobId
  }
  const response = await axios.put('https://api.cron-job.org/jobs', { job }, { headers })
  const created = response.data?.jobId
  if (!Number.isInteger(created)) throw new Error('BAND定期確認ジョブを作成できませんでした')
  await ref.set({ bandPollJobId: created }, { merge: true })
  return created
}
