import type { RelativeDay } from './lotteryTiming'

export type JobKind = 'lottery' | 'notify' | 'band' | 'cleanup'
export const JOB_ORDER: Record<JobKind, number> = { lottery: 0, notify: 1, band: 2, cleanup: 3 }
export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}
export function dateJST(now = Date.now()): string { return new Date(now + 9 * 3_600_000).toISOString().slice(0, 10) }
export function executionTimes(date: string, settings: {
  lotteryMode: RelativeDay; lotteryTime: string; notifyMode: RelativeDay; notifyTime: string
}) {
  const previous = shiftDate(date, -1)
  const nominal = settings.lotteryMode === 'same-day'
    ? Date.parse(`${date}T00:00:00+09:00`) : Date.parse(`${previous}T${settings.lotteryTime}:00+09:00`)
  return {
    deadline: nominal - 10 * 60_000, lottery: nominal - 5 * 60_000,
    notify: Date.parse(`${settings.notifyMode === 'same-day' ? date : previous}T${settings.notifyTime}:00+09:00`),
  }
}
export function retryDelay(attempt: number): number { return Math.min(15 * 60_000, 30_000 * 2 ** Math.min(attempt, 5)) }
export function nextMinute(now: number): number { return (Math.floor(now / 60_000) + 1) * 60_000 }
export function cronWakeSchedule(at: number, minuteCadence: boolean, now = Date.now()) {
  const wake = Math.max(nextMinute(now), Math.ceil(at / 60_000) * 60_000)
  const jst = new Date(wake + 9 * 3_600_000)
  const hour = jst.getUTCHours(), date = jst.toISOString().slice(0, 10)
  // Polls in the current hour share one cron schedule, avoiding 60 PATCHes/hour.
  const minute = minuteCadence && at <= now + 60_000
  return {
    key: minute ? `minute:${date}:${hour}` : `once:${wake}`,
    schedule: { timezone: 'Asia/Tokyo', hours: [hour], minutes: minute ? [-1] : [jst.getUTCMinutes()],
      mdays: [jst.getUTCDate()], months: [jst.getUTCMonth() + 1], wdays: [-1],
      expiresAt: Number(new Date((minute ? wake + (60 - jst.getUTCMinutes()) * 60_000 : wake + 60_000) + 9 * 3_600_000)
        .toISOString().slice(0, 19).replace(/[-:T]/g, '')) },
  }
}
