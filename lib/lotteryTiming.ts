export type RelativeDay = 'previous-day' | 'same-day'

export type OperationTiming = {
  lotteryMode: RelativeDay
  lotteryTime: string
  notifyMode: RelativeDay
  notifyTime: string
}

function previousDate(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
}

/** 保存日に予定されている抽選・通知を、時刻やモードの変更で取りこぼさないための判定。 */
export function operationChangeOnExecutionDate(
  applicationDate: string,
  reservationDates: string[],
  before: OperationTiming,
  after: OperationTiming,
): '抽選' | '通知' | null {
  const drawChanged = before.lotteryMode !== after.lotteryMode ||
    (after.lotteryMode === 'previous-day' && before.lotteryTime !== after.lotteryTime)
  const notifyChanged = before.notifyMode !== after.notifyMode || before.notifyTime !== after.notifyTime
  for (const reservationDate of reservationDates) {
    // どちらの抽選モードも、実際の実行日は利用日の前日。
    if (drawChanged && previousDate(reservationDate) === applicationDate) return '抽選'
    if (notifyChanged && (
      (before.notifyMode === 'previous-day' ? previousDate(reservationDate) : reservationDate) === applicationDate ||
      (after.notifyMode === 'previous-day' ? previousDate(reservationDate) : reservationDate) === applicationDate
    )) return '通知'
  }
  return null
}

function relativeMinutes(day: RelativeDay, time: string): number {
  const [hour, minute] = time.split(':').map(Number)
  return (day === 'same-day' ? 24 * 60 : 0) + hour * 60 + minute
}

export function notificationFollowsLottery(
  lotteryMode: RelativeDay,
  lotteryTime: string,
  notifyMode: RelativeDay,
  notifyTime: string,
): boolean {
  // 当日モードの抽選は利用日前日23:55に固定する。前日通知との組合せは許可しない。
  if (lotteryMode === 'same-day') return notifyMode === 'same-day'
  return relativeMinutes(notifyMode, notifyTime) >= relativeMinutes(lotteryMode, lotteryTime)
}

/** Each notification exception is checked against the draw used on the same usage date. */
export function timingOverridesValid(base: OperationTiming, rules: {
  byWeekday?: Record<string, string>; byDate?: Record<string, string>;
  notifyByWeekday?: Record<string, string>; notifyByDate?: Record<string, string>;
}, minDate?: string): boolean {
  const valid = (draw: string, notify: string) => (base.lotteryMode === 'same-day' || draw >= '00:10') && /^([01]\d|2[0-3]):[0-5]\d$/.test(notify) &&
    notificationFollowsLottery(base.lotteryMode, draw, base.notifyMode, notify)
  if (!valid(base.lotteryTime, base.notifyTime)) return false
  for (let day = 0; day < 7; day++) {
    if (!valid(rules.byWeekday?.[day] ?? base.lotteryTime, rules.notifyByWeekday?.[day] ?? base.notifyTime)) return false
  }
  for (const date of new Set([...Object.keys(rules.byDate ?? {}), ...Object.keys(rules.notifyByDate ?? {})])) {
    if (minDate && date < minDate) continue
    const day = new Date(`${date}T00:00:00Z`).getUTCDay()
    if (!valid(rules.byDate?.[date] ?? rules.byWeekday?.[day] ?? base.lotteryTime,
      rules.notifyByDate?.[date] ?? rules.notifyByWeekday?.[day] ?? base.notifyTime)) return false
  }
  return true
}
