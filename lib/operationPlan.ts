import type { Firestore } from 'firebase-admin/firestore'
import type { RelativeDay } from './lotteryTiming'
import { executionTimes } from './schedulerTiming'

export type OperationSnapshot = {
  lotteryMode: RelativeDay; lotteryTime: string; notifyMode: RelativeDay; notifyTime: string
  notificationMode: 'post' | 'comment'; fallbackPost: boolean
}
export type OperationPlan = OperationSnapshot & {
  date: string; deadline: number; lotteryAt: number; notifyAt: number; confirmedAt: number
  drawReason: string | null; notifyReason: string | null
}
export type PlanState = { drawLocked?: boolean; notifyLocked?: boolean; drawWasScheduled?: boolean }
export type PlanWarning = { date: string; event: '抽選' | '通知'; at: number; reason: string }
export type OperationImpact = { date: string; events: ('抽選' | '通知')[] }

export function snapshotOperation(value: Partial<OperationSnapshot> & Pick<OperationSnapshot, 'lotteryMode' | 'lotteryTime' | 'notifyMode' | 'notifyTime'>): OperationSnapshot {
  return { lotteryMode: value.lotteryMode, lotteryTime: value.lotteryTime, notifyMode: value.notifyMode,
    notifyTime: value.notifyTime, notificationMode: value.notificationMode ?? 'post', fallbackPost: value.fallbackPost ?? false }
}

/** Select the draw first, then validate notification against the draw actually retained. */
export function selectOperationPlan(date: string, previous: OperationSnapshot, next: OperationSnapshot,
  confirmedAt: number, state: PlanState = {}, previousPlan?: OperationPlan): OperationPlan {
  const oldTimes = previousPlan ?? (() => {
    const times = executionTimes(date, previous)
    return { deadline: times.deadline, lotteryAt: times.lottery, notifyAt: times.notify }
  })()
  const candidate = executionTimes(date, next)
  let drawReason: string | null = state.drawLocked ? '抽選が実行中または完了済み' :
    state.drawWasScheduled !== false && oldTimes.deadline <= confirmedAt ? '予約受付を締切済み' :
    candidate.lottery < confirmedAt + 10 * 60_000 ? '新しい抽選日時が保存確定から10分未満' : null
  let draw = drawReason ? previous : next
  let lotteryAt = drawReason ? oldTimes.lotteryAt : candidate.lottery
  let notifyReason: string | null = state.notifyLocked ? '通知またはコメント確認を開始済み' :
    candidate.notify < confirmedAt ? '新しい通知日時が保存確定より前' :
    candidate.notify < lotteryAt ? '新しい通知日時が採用した抽選日時より前' : null
  const notify = notifyReason ? previous : next
  const notifyAt = notifyReason ? oldTimes.notifyAt : candidate.notify
  // Keeping the old notification must not introduce the opposite inversion either.
  if (notifyAt < lotteryAt) {
    drawReason = '維持する通知日時より後に抽選を移動できないため'
    draw = previous; lotteryAt = oldTimes.lotteryAt
  }
  if (notifyAt < lotteryAt) throw new Error('既存の抽選・通知予定が不整合です。管理者の確認が必要です')
  const drawChanged = previous.lotteryMode !== next.lotteryMode || previous.lotteryTime !== next.lotteryTime
  const notifyChanged = previous.notifyMode !== next.notifyMode || previous.notifyTime !== next.notifyTime ||
    previous.notificationMode !== next.notificationMode || previous.fallbackPost !== next.fallbackPost
  return { date, lotteryMode: draw.lotteryMode, lotteryTime: draw.lotteryTime,
    notifyMode: notify.notifyMode, notifyTime: notify.notifyTime, notificationMode: notify.notificationMode,
    fallbackPost: notify.fallbackPost, deadline: draw === previous ? oldTimes.deadline : candidate.deadline,
    lotteryAt, notifyAt, confirmedAt, drawReason: drawChanged ? drawReason : null, notifyReason: notifyChanged ? notifyReason : null }
}

export function planWarnings(plan: OperationPlan): PlanWarning[] {
  return [
    ...(plan.drawReason ? [{ date: plan.date, event: '抽選' as const, at: plan.lotteryAt, reason: plan.drawReason }] : []),
    ...(plan.notifyReason ? [{ date: plan.date, event: '通知' as const, at: plan.notifyAt, reason: plan.notifyReason }] : []),
  ]
}

export async function applyStoredOperationPlan<T extends OperationSnapshot | Partial<OperationSnapshot>>(db: Firestore, date: string, settings: T): Promise<T> {
  const doc = await db.collection('operation_plans').doc(date).get()
  if (!doc.exists) return settings
  const data = doc.data() as OperationPlan
  return { ...settings, ...snapshotOperation(data) }
}
