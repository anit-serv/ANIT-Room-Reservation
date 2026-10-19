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
  if (todaySettings.lotteryMode === 'same-day') return today
  if (tomorrowSettings.lotteryMode === 'previous-day') return tomorrow
  return null
}

export function reservationDeadline(date: string, mode: 'previous-day' | 'same-day', lotteryTime: string): Date {
  if (mode === 'same-day') return new Date(`${date}T00:00:00+09:00`)
  const drawDate = new Date(`${date}T00:00:00+09:00`)
  drawDate.setUTCDate(drawDate.getUTCDate() - 1)
  const [h, m] = lotteryTime.split(':').map(Number)
  return new Date(drawDate.getTime() + (h * 60 + m - 10) * 60_000)
}
