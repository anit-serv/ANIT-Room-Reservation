import type { Firestore, Transaction } from 'firebase-admin/firestore'
import { resolveReservationSettingsForDate, isDateAvailableBySettings, pickTimeSlotsForDate, type ReservationSettingsVersion } from './reservationSettings'
import { getRoomPreferenceConfig } from './roomPreference'
import { dateJST, shiftDate, executionTimes } from './schedulerTiming'
import { milliseconds } from './schedulerQueue'
import { planWarnings, selectOperationPlan, snapshotOperation, type OperationPlan, type OperationImpact } from './operationPlan'

/** Reuse the normal settings readers, with every read participating in this transaction. */
export function transactionReader(db: Firestore, tx: Transaction): Firestore {
  const wrap = (ref: any): any => new Proxy(ref, { get(target, property) {
    if (property === 'get') return () => tx.get(target)
    if (property === 'listDocuments') return async () => (await tx.get(target)).docs.map((doc: any) => wrap(doc.ref))
    const value = target[property]
    if (typeof value !== 'function') return value
    return (...args: any[]) => {
      const result = value.apply(target, args)
      return result && typeof result.get === 'function' ? wrap(result) : result
    }
  } })
  return { collection: (path: string) => wrap(db.collection(path)) } as Firestore
}

export async function prepareOperationPlans(db: Firestore, tx: Transaction, change: ReservationSettingsVersion,
  clock = () => Date.now(), deletedVersion?: string,
  proposedDatedSettings?: { extraDates: string[]; excludedDates: string[]; byDate: Record<string, import('./reservationSettings').TimeSlot[]> }) {
  const reader = transactionReader(db, tx)
  const started = clock(), today = dateJST(started)
  // Inspect the full booking window for warnings; persist near-term safety decisions only.
  const dates = Array.from({ length: 8 }, (_, index) => shiftDate(today, index)).filter(date => date >= change.effectiveFrom)
  const inputs = await Promise.all(dates.map(async date => {
    const [before, after, oldConfig, oldPlan, draw, notify, result] = await Promise.all([
      resolveReservationSettingsForDate(reader, date),
      resolveReservationSettingsForDate(reader, date, { ignorePlan: true, proposedVersion: deletedVersion ? undefined : change, deletedVersion, proposedDatedSettings }),
      getRoomPreferenceConfig(reader, date),
      tx.get(db.collection('operation_plans').doc(date)),
      tx.get(db.collection('scheduled_jobs').doc(`lottery_${date}`)),
      tx.get(db.collection('scheduled_jobs').doc(`notify_${date}`)),
      tx.get(db.collection('lottery_results').doc(date)),
    ])
    return { date, before, after, oldConfig, oldPlan, draw, notify, result }
  }))
  // Capture once after reads, and recapture on a transaction retry, never trust browser time.
  const confirmedAt = clock()
  if (dateJST(confirmedAt) !== today) throw new Error('日付が変わりました。内容を確認して保存し直してください')
  const affectedOperations: OperationImpact[] = inputs.filter(({ date, before }) =>
    isDateAvailableBySettings(date, before) && pickTimeSlotsForDate(date, before).length > 0
  ).flatMap(({ date, before, after, oldConfig }) => {
    const old = executionTimes(date, before), next = executionTimes(date, after)
    const events: OperationImpact['events'] = []
    if (old.lottery !== next.lottery || old.deadline !== next.deadline) events.push('抽選')
    if (old.notify !== next.notify || oldConfig.notificationMode !== (after.notificationMode ?? oldConfig.notificationMode) ||
        oldConfig.fallbackPost !== (after.fallbackPost ?? oldConfig.fallbackPost)) events.push('通知')
    return events.length ? [{ date, events }] : []
  })
  const plans = inputs.filter(({ date }) => date <= shiftDate(today, 2)).filter(({ date, before, after, draw, notify, result }) =>
    draw.exists || notify.exists || result.exists ||
    (isDateAvailableBySettings(date, before) && pickTimeSlotsForDate(date, before).length > 0) ||
    (isDateAvailableBySettings(date, after) && pickTimeSlotsForDate(date, after).length > 0)
  ).map(({ date, before, after, oldConfig, oldPlan, draw, notify, result }) => {
    const previous = snapshotOperation({ ...before, ...oldConfig })
    const next = snapshotOperation({ ...after, notificationMode: after.notificationMode ?? oldConfig.notificationMode,
      fallbackPost: after.fallbackPost ?? oldConfig.fallbackPost })
    let existing = oldPlan.data() as OperationPlan | undefined
    if (!existing) {
      const times = executionTimes(date, before)
      const lotteryAt = milliseconds(draw.data()?.dueAt) || times.lottery
      existing = { ...previous, date, deadline: lotteryAt - 5 * 60_000, lotteryAt,
        notifyAt: milliseconds(result.data()?.pollStartsAt) || milliseconds(notify.data()?.dueAt) || times.notify,
        confirmedAt, drawReason: null, notifyReason: null }
    }
    if (result.data()?.pollStatus || result.data()?.notificationSentAt) {
      previous.notificationMode = result.data()?.notificationMode ?? previous.notificationMode
      previous.fallbackPost = result.data()?.fallbackPost ?? previous.fallbackPost
      previous.notifyMode = result.data()?.notifyMode ?? previous.notifyMode
      previous.notifyTime = result.data()?.notifyTime ?? previous.notifyTime
    }
    const locked = (status: string | undefined) => ['running', 'done', 'manual'].includes(status ?? '')
    return { plan: selectOperationPlan(date, previous, next, confirmedAt, {
      drawLocked: result.exists || locked(draw.data()?.status),
      drawWasScheduled: draw.exists || result.exists || (isDateAvailableBySettings(date, before) && pickTimeSlotsForDate(date, before).length > 0),
      notifyLocked: !!result.data()?.pollStatus || !!result.data()?.notificationSentAt || locked(notify.data()?.status),
    }, existing), draw, notify }
  })
  return { confirmedAt, affectedOperations, warnings: plans.flatMap(({ plan }) => planWarnings(plan)),
    write() {
      for (const { plan, draw, notify } of plans) {
        tx.set(db.collection('operation_plans').doc(plan.date), plan)
        for (const [kind, at, job] of [['lottery', plan.lotteryAt, draw], ['notify', plan.notifyAt, notify]] as const) {
          // Reconciliation creates missing jobs only for active dates. Preserve retries if unchanged.
          if (job.data()?.status !== 'pending' || milliseconds(job.data()?.dueAt) === at) continue
          tx.update(job.ref, { dueAt: new Date(at), availableAt: new Date(at), attempts: 0,
            generation: (job.data()?.generation ?? 0) + 1, lastError: null })
        }
      }
    } }
}
