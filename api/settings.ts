import { VercelRequest, VercelResponse } from '@vercel/node'
import * as admin from 'firebase-admin'
import {
  DEFAULT_TIME_SLOTS,
  isDateAvailableBySettings,
  isHamoaniActive,
  pickTimeSlotsForDate,
  resolveReservationSettingsForDate,
  resolveReservationSettingsForDates,
  todayJST,
  type ReservationSettings,
  type TimeSlot,
} from '../lib/reservationSettings'
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

const WEEK_DAYS = ['日', '月', '火', '水', '木', '金', '土']

type DateEntry = {
  label: string; value: string; timeSlots: TimeSlot[]; effectiveFrom: string; lotteryTime: string
  hamoaniActive: boolean
}

// 今日から7日後まで（8日分）を見て、availableDays に該当 + extraDates - excludedDates の日付を集める
// forView=false（登録用）: 今日は常に除外、抽選10分前以降は翌日も除外
// forView=true（全登録表示用）: 抽選10分前以降は今日のみ除外、翌日は含む
async function buildDateList(forView: boolean): Promise<DateEntry[]> {
  const nowJST = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const candidateDates = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(nowJST)
    d.setUTCDate(nowJST.getUTCDate() + i)
    d.setUTCHours(0, 0, 0, 0)
    return d.toISOString().slice(0, 10)
  })
  const settingsByDate = await resolveReservationSettingsForDates(db, candidateDates)
  const currentSettings = settingsByDate[todayJST()] ?? Object.values(settingsByDate)[0]
  const lotteryTime = currentSettings?.lotteryTime ?? '21:00'
  const [lh, lm] = lotteryTime.split(':').map(Number)
  const lockoutMinutes = lh * 60 + lm - 10

  const nowMinutes = nowJST.getUTCHours() * 60 + nowJST.getUTCMinutes()
  const afterLotteryPrep = nowMinutes >= lockoutMinutes

  // 今日(i=0)・翌日(i=1)の制約
  const todayStr = todayJST()
  const tomorrowDate = new Date(nowJST); tomorrowDate.setUTCDate(nowJST.getUTCDate() + 1)
  const tomorrowStr = tomorrowDate.toISOString().slice(0, 10)

  const results: DateEntry[] = []
  for (const dateStr of candidateDates) {
    const settings = settingsByDate[dateStr] as ReservationSettings | undefined
    if (!settings || !isDateAvailableBySettings(dateStr, settings)) continue
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
      effectiveFrom: settings.effectiveFrom,
      lotteryTime: settings.lotteryTime,
      hamoaniActive: isHamoaniActive(settings, dateStr),
    })
  }
  return results
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  try {
    const [availableDates, availableDatesWithToday, currentSettings] = await Promise.all([
      buildDateList(false),
      buildDateList(true),
      resolveReservationSettingsForDate(db, todayJST()),
    ])

    return res.status(200).json({
      availableDates,
      availableDatesWithToday,
      // 後方互換のため timeSlots（デフォルト）も返す
      timeSlots: currentSettings.timeSlots?.length ? currentSettings.timeSlots : DEFAULT_TIME_SLOTS,
      lotteryTime: currentSettings.lotteryTime,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
