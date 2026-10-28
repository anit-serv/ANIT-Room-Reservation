import type { Firestore } from 'firebase-admin/firestore'
import { randomUUID } from 'crypto'
import { resolveReservationSettingsForDates, resolveReservationSettingsForDate, isDateAvailableBySettings, pickTimeSlotsForDate } from './reservationSettings'
import { runLotteryForDate } from './lotteryRunner'
import { processNotification, startNotification, cleanupNotifications } from './notificationService'
import { DeliveryNeedsReview } from './bandDelivery'
import { enqueue, claimJob, finishJob, recoverExpiredJobs, milliseconds, QUEUE, LEASE_MS, schedulerEnabled } from './schedulerQueue'
import { executionTimes, dateJST, shiftDate, JOB_ORDER, type JobKind } from './schedulerTiming'
import { syncSchedulerCron } from './schedulerCron'

export async function reconcileScheduler(db: Firestore) {
  const today = dateJST(), first = shiftDate(today, -1)
  const dates = Array.from({ length: 11 }, (_, index) => shiftDate(first, index))
  const settings = await resolveReservationSettingsForDates(db, dates)
  const existing = await db.collection('reservations').where('date', '>=', `${first}T00:00`).where('date', '<=', `${dates[10]}T23:59`).get()
  const pendingDates = new Set(existing.docs.filter((doc) => doc.data().status === 'pending').map((doc) => String(doc.data().date).slice(0, 10)))
  for (const date of dates) {
    // Prior-day data is handled through existing results/pending reservations, never invented on first activation.
    if (date < today && !pendingDates.has(date)) continue
    const active = isDateAvailableBySettings(date, settings[date]) || pendingDates.has(date)
    if (active) {
      const times = executionTimes(date, settings[date])
      await enqueue(db, 'lottery', date, times.lottery, { reschedule: true })
      await enqueue(db, 'notify', date, times.notify, { reschedule: true })
    } else {
      for (const kind of ['lottery', 'notify']) {
        const ref = db.collection(QUEUE).doc(`${kind}_${date}`)
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref)
          if (snap.data()?.status === 'pending') tx.update(ref, { status: 'cancelled' })
        })
      }
    }
  }
  // Read by target date, not by "today's" mode, so midnight and overlapping schedules cannot change the target.
  const results = await db.collection('lottery_results').orderBy('__name__').startAt(first).endAt(dates[10]).get()
  for (const result of results.docs) {
    const data = result.data()
    if (data.pollStatus === 'active' || data.pollStatus === 'posting' || data.notificationDirty) {
      await enqueue(db, 'band', result.id, Date.now(), { repeat: true })
    }
  }
  const cleanup = await db.collection('band_cleanup').orderBy('nextAttemptAt').limit(1).get()
  const nextCleanup = milliseconds(cleanup.docs[0]?.data().nextAttemptAt)
  if (nextCleanup && nextCleanup < Date.now() + 24 * 3_600_000) await enqueue(db, 'cleanup', 'all', nextCleanup, { repeat: true })
  // A daily maintenance item guarantees queue replenishment even with no reservations for more than 10 days.
  await enqueue(db, 'cleanup', 'daily', Date.parse(`${shiftDate(today, 1)}T00:10:00+09:00`), { repeat: true })
}

async function executeJob(db: Firestore, kind: JobKind, date: string, dueAt: number): Promise<number | undefined> {
  if (kind === 'lottery') {
    const result = await db.collection('lottery_results').doc(date).get()
    if (!result.exists && date < dateJST()) throw new DeliveryNeedsReview('過去の利用日の抽選は手動確認してください')
    if (!result.exists && date === dateJST()) {
      const settings = await resolveReservationSettingsForDate(db, date)
      const firstSlot = pickTimeSlotsForDate(date, settings).map((slot) => slot.value.split('-')[0]).sort()[0]
      if (firstSlot && Date.now() >= Date.parse(`${date}T${firstSlot}:00+09:00`)) {
        throw new DeliveryNeedsReview('利用開始後の抽選となるため、手動確認してください')
      }
    }
    await runLotteryForDate(db, date)
  } else if (kind === 'notify') {
    const result = await db.collection('lottery_results').doc(date).get()
    if (!result.exists) throw new Error('Waiting for lottery result')
    if (!result.data()?.notificationSentAt && Date.now() > dueAt + 6 * 3_600_000) {
      await result.ref.update({ notificationError: '通知予定から6時間を超過しました。手動確認してください', pollStatus: 'unnotified' })
      throw new DeliveryNeedsReview('Notification overdue')
    }
    await startNotification(db, date)
    await enqueue(db, 'band', date, Date.now(), { repeat: true })
  } else if (kind === 'band') {
    const again = await processNotification(db, date)
    const cleanup = await cleanupNotifications(db)
    if (cleanup) await enqueue(db, 'cleanup', 'all', cleanup, { repeat: true })
    return again
  } else if (date !== 'daily') return cleanupNotifications(db)
}

export async function runScheduler(db: Firestore, recover = false) {
  if (!schedulerEnabled()) return { status: 'disabled' }
  const state = db.collection('scheduler_state').doc('worker'), token = randomUUID()
  const claimed = await db.runTransaction(async (tx) => {
    const doc = await tx.get(state)
    if (milliseconds(doc.data()?.leaseUntil) > Date.now()) return false
    tx.set(state, { token, leaseUntil: new Date(Date.now() + LEASE_MS), startedAt: new Date() }, { merge: true })
    return true
  })
  if (!claimed) return { status: 'busy' }
  let processed = 0, failed = 0
  const started = Date.now()
  try {
    if (recover) await recoverExpiredJobs(db)
    await reconcileScheduler(db)
    while (processed < 12 && Date.now() - started < 20_000) {
      const owner = (await state.get()).data()
      if (owner?.token !== token || milliseconds(owner.leaseUntil) <= Date.now()) break
      const docs = await db.collection(QUEUE).where('status', '==', 'pending')
        .where('availableAt', '<=', new Date()).orderBy('availableAt').limit(30).get()
      const ordered = docs.docs.sort((a, b) => milliseconds(a.data().dueAt) - milliseconds(b.data().dueAt) ||
        JOB_ORDER[a.data().kind as JobKind] - JOB_ORDER[b.data().kind as JobKind])
      if (!ordered.length) break
      const job = await claimJob(db, ordered[0].id)
      if (!job) continue
      try {
        const again = await executeJob(db, job.kind, job.date, milliseconds(job.dueAt))
        await finishJob(db, job, again)
      } catch (error) {
        failed++
        await finishJob(db, job, undefined, error instanceof DeliveryNeedsReview ? error.message : '処理失敗。再試行待ちです', error instanceof DeliveryNeedsReview)
      }
      processed++
    }
    await state.set({ lastSuccessAt: new Date(), ...(recover ? { lastRecoveryAt: new Date() } : {}) }, { merge: true })
    await syncSchedulerCron(db)
    return { status: failed ? 'retrying' : 'success', processed, failed }
  } finally {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(state)
      if (snap.data()?.token === token) tx.update(state, { token: null, leaseUntil: new Date(0) })
    })
  }
}

/** Called after settings saves. A failed sync is durable and recovery will recalculate the queue. */
export async function refreshScheduler(db: Firestore) {
  await reconcileScheduler(db)
  await syncSchedulerCron(db)
}
