import type { Firestore } from 'firebase-admin/firestore'
import { addDaysJST, resolveReservationSettingsForDate, todayJST } from './reservationSettings'

/** Which reservation date today's scheduled jobs should process. */
export async function lotteryTargetDate(db: Firestore): Promise<string | null> {
  const today = todayJST()
  const tomorrow = addDaysJST(1)
  const [todaySettings, tomorrowSettings] = await Promise.all([
    resolveReservationSettingsForDate(db, today),
    resolveReservationSettingsForDate(db, tomorrow),
  ])
  // 当日モードの抽選は利用日前日の23:55に実行する。
  const [nowHour, nowMinute] = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date()).split(':').map(Number)
  const nowMinutes = nowHour * 60 + nowMinute
  if (nowMinutes >= 23 * 60 + 55 && tomorrowSettings.lotteryMode === 'same-day') return tomorrow
  if (todaySettings.lotteryMode === 'same-day') return today
  if (tomorrowSettings.lotteryMode === 'previous-day') return tomorrow
  return null
}

/** Which reservation date today's notification job should process. */
export async function notificationTargetDate(db: Firestore): Promise<string | null> {
  const today = todayJST()
  const tomorrow = addDaysJST(1)
  const [todaySettings, tomorrowSettings] = await Promise.all([
    resolveReservationSettingsForDate(db, today),
    resolveReservationSettingsForDate(db, tomorrow),
  ])
  if (todaySettings.notifyMode === 'same-day') return today
  if (tomorrowSettings.notifyMode === 'previous-day') return tomorrow
  return null
}

export function reservationDeadline(date: string, mode: 'previous-day' | 'same-day', lotteryTime: string): Date {
  const drawDate = new Date(`${date}T00:00:00+09:00`)
  drawDate.setUTCDate(drawDate.getUTCDate() - 1)
  if (mode === 'same-day') return new Date(drawDate.getTime() + (23 * 60 + 50) * 60_000)
  const [h, m] = lotteryTime.split(':').map(Number)
  return new Date(drawDate.getTime() + (h * 60 + m - 10) * 60_000)
}
