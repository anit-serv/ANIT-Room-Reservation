import type { Firestore } from 'firebase-admin/firestore'
import { resolveReservationSettingsForDate, todayJST } from './reservationSettings'

export const DEFAULT_LOTTERY_TIME = '21:00'

/** Firestoreから抽選時刻を取得（HH:MM形式） */
export async function getLotteryTime(db: Firestore): Promise<string> {
  const settings = await resolveReservationSettingsForDate(db, todayJST())
  return settings.lotteryTime ?? DEFAULT_LOTTERY_TIME
}

/** HH:MM → 総分数 */
export function toTotalMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/** 現在のJST時刻（分） */
export function nowJSTMinutes(): number {
  const nowJST = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return nowJST.getUTCHours() * 60 + nowJST.getUTCMinutes()
}

/** 抽選10分前以降かどうか（日付選択の制限に使用） */
export function isAfterLotteryPrep(lotteryTime: string): boolean {
  return nowJSTMinutes() >= toTotalMinutes(lotteryTime) - 10
}

/** 抽選10分前〜抽選時刻の間かどうか（登録ブロックに使用） */
export function isInLotteryWindow(lotteryTime: string): boolean {
  const now = nowJSTMinutes()
  const lottery = toTotalMinutes(lotteryTime)
  return now >= lottery - 10 && now < lottery
}

/** 抽選10分前の時刻をHH:MM形式で返す */
export function getLockoutTime(lotteryTime: string): string {
  const mins = toTotalMinutes(lotteryTime) - 10
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
