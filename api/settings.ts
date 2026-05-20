import { VercelRequest, VercelResponse } from '@vercel/node'
import * as admin from 'firebase-admin'
import 'dotenv/config'

const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  })
}
const db = admin.firestore()

type TimeSlot = { label: string; value: string }
type Settings = {
  availableDays?: number[]
  timeSlots?: TimeSlot[]
  extraDates?: string[]
  excludedDates?: string[]
  perDaySchedule?: {
    enabled?: boolean
    byWeekday?: { [day: string]: TimeSlot[] }
    byDate?:    { [date: string]: TimeSlot[] }
  }
  nextChange?: any
  lotteryTime?: string
}

const DEFAULT_TIME_SLOTS: TimeSlot[] = [
  { label: '9:00~10:00', value: '09:00-10:00' },
  { label: '10:00~12:00', value: '10:00-12:00' },
  { label: '12:00~14:00', value: '12:00-14:00' },
  { label: '14:00~16:00', value: '14:00-16:00' },
  { label: '16:00~18:00', value: '16:00-18:00' },
  { label: '18:00~20:00', value: '18:00-20:00' },
]
const DEFAULT_AVAILABLE_DAYS = [3, 4, 6]
const WEEK_DAYS = ['日', '月', '火', '水', '木', '金', '土']

function todayJST(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function pickTimeSlotsForDate(date: string, settings: Settings): TimeSlot[] {
  const sched = settings.perDaySchedule
  const defaultSlots = settings.timeSlots ?? DEFAULT_TIME_SLOTS
  if (!sched?.enabled) return defaultSlots
  if (sched.byDate && sched.byDate[date]) return sched.byDate[date]
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay()
  if (sched.byWeekday && sched.byWeekday[String(weekday)]) return sched.byWeekday[String(weekday)]
  return defaultSlots
}

type DateEntry = { label: string; value: string; timeSlots: TimeSlot[] }

// 今日から7日後まで（8日分）を見て、availableDays に該当 + extraDates - excludedDates の日付を集める
// forView=false（登録用）: 今日は常に除外、抽選10分前以降は翌日も除外
// forView=true（全登録表示用）: 抽選10分前以降は今日のみ除外、翌日は含む
function buildDateList(settings: Settings, forView: boolean): DateEntry[] {
  const lotteryTime = settings.lotteryTime ?? '21:00'
  const [lh, lm] = lotteryTime.split(':').map(Number)
  const lockoutMinutes = lh * 60 + lm - 10

  const nowJST = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const nowMinutes = nowJST.getUTCHours() * 60 + nowJST.getUTCMinutes()
  const afterLotteryPrep = nowMinutes >= lockoutMinutes

  const availableDays = settings.availableDays ?? DEFAULT_AVAILABLE_DAYS
  const extraSet = new Set(settings.extraDates ?? [])
  const excludedSet = new Set(settings.excludedDates ?? [])

  // 当該7日間に表示する日のセットを作る
  const candidates = new Set<string>()
  for (let i = 0; i < 8; i++) {
    const d = new Date(nowJST)
    d.setUTCDate(nowJST.getUTCDate() + i)
    d.setUTCHours(0, 0, 0, 0)
    const dateStr = d.toISOString().slice(0, 10)
    const wd = d.getUTCDay()
    const inWeekly = availableDays.includes(wd) && !excludedSet.has(dateStr)
    const inExtra = extraSet.has(dateStr)
    if ((inWeekly || inExtra)) candidates.add(dateStr)
  }

  // 今日(i=0)・翌日(i=1)の制約
  const todayStr = todayJST()
  const tomorrowDate = new Date(nowJST); tomorrowDate.setUTCDate(nowJST.getUTCDate() + 1)
  const tomorrowStr = tomorrowDate.toISOString().slice(0, 10)

  const results: DateEntry[] = []
  for (const dateStr of Array.from(candidates).sort()) {
    if (dateStr === todayStr && (afterLotteryPrep || !forView)) continue
    if (dateStr === tomorrowStr && afterLotteryPrep && !forView) continue

    const dObj = new Date(dateStr + 'T00:00:00Z')
    const m = dObj.getUTCMonth() + 1
    const day = dObj.getUTCDate()
    const wd = WEEK_DAYS[dObj.getUTCDay()]
    results.push({
      label: `${m}/${day}(${wd})`,
      value: dateStr,
      timeSlots: pickTimeSlotsForDate(dateStr, settings),
    })
  }
  return results
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  try {
    const docRef = db.collection('settings').doc('reservation')
    let doc = await docRef.get()
    let data = (doc.exists ? doc.data()! : {}) as Settings

    // 予約済み設定変更が今日以前なら即座に適用
    const nextChange = data.nextChange
    if (nextChange && nextChange.effectiveFrom && nextChange.effectiveFrom <= todayJST()) {
      const { effectiveFrom, ...rest } = nextChange as any
      await docRef.set({
        ...rest,
        nextChange: admin.firestore.FieldValue.delete(),
      }, { merge: true })
      data = rest
    }

    return res.status(200).json({
      availableDates:          buildDateList(data, false),
      availableDatesWithToday: buildDateList(data, true),
      // 後方互換のため timeSlots（デフォルト）も返す
      timeSlots:    data.timeSlots ?? DEFAULT_TIME_SLOTS,
      lotteryTime:  data.lotteryTime ?? '21:00',
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
