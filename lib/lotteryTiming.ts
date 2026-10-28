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
