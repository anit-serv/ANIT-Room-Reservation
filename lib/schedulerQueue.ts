import type { Firestore } from 'firebase-admin/firestore'
import { randomUUID } from 'crypto'
import { retryDelay, type JobKind } from './schedulerTiming'

export const QUEUE = 'scheduled_jobs'
export const LEASE_MS = 6 * 60_000
export type QueueJob = { id: string; kind: JobKind; date: string; dueAt: any; availableAt: any;
  status: 'pending' | 'running' | 'done' | 'manual' | 'cancelled'; attempts: number; token?: string }
export const milliseconds = (value: any): number => value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : 0)
export function schedulerEnabled() {
  if (process.env.SCHEDULER_ENABLED !== 'true') return false
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production' && process.env.SCHEDULER_ISOLATED_ENVIRONMENT !== 'true') {
    throw new Error('Non-production scheduler requires an isolated database and SCHEDULER_ISOLATED_ENVIRONMENT=true')
  }
  return true
}

/** With a transaction, enqueues racing with completion increment generation instead of being lost. */
export async function enqueue(db: Firestore, kind: JobKind, date: string, dueAt: number, options: { repeat?: boolean; reschedule?: boolean } = {}) {
  const ref = db.collection(QUEUE).doc(`${kind}_${date}`)
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref), data = snap.data()
    if (data?.status === 'manual') return
    if (data?.status === 'running') {
      if (options.repeat) tx.update(ref, { generation: (data.generation ?? 0) + 1, requestedAt: new Date(dueAt) })
      return
    }
    if (data?.status === 'done' && !options.repeat) return
    // Recovery must not pull a scheduled poll forward and cause two BAND reads in one minute.
    // Real cancellations update generation/availableAt in their own result transaction.
    if (data?.status === 'pending' && options.repeat) return
    if (data?.status === 'pending' && options.reschedule && milliseconds(data.dueAt) === dueAt) return
    if (data?.status === 'pending' && !options.reschedule && milliseconds(data.availableAt) <= dueAt) return
    tx.set(ref, { kind, date, status: 'pending', dueAt: new Date(dueAt), availableAt: new Date(dueAt),
      generation: (data?.generation ?? 0) + 1, attempts: 0, lastError: null, updatedAt: new Date() }, { merge: true })
  })
}
export async function claimJob(db: Firestore, id: string, now = Date.now()): Promise<(QueueJob & { generation: number }) | null> {
  const ref = db.collection(QUEUE).doc(id)
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref), data = snap.data()
    if (!data || data.status !== 'pending' || milliseconds(data.availableAt) > now) return null
    const token = randomUUID()
    tx.update(ref, { status: 'running', token, leaseUntil: new Date(now + LEASE_MS), attempts: (data.attempts ?? 0) + 1 })
    return { ...data, id, token, attempts: (data.attempts ?? 0) + 1 } as QueueJob & { generation: number }
  })
}
export async function finishJob(db: Firestore, job: QueueJob & { generation: number }, againAt?: number, error?: string, manual = false) {
  const ref = db.collection(QUEUE).doc(job.id)
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref), current = snap.data()
    if (!current || current.token !== job.token) return
    const requested = current.generation !== job.generation ? milliseconds(current.requestedAt) || Date.now() : undefined
    const next = requested === undefined ? againAt : Math.min(requested, againAt ?? Infinity)
    const status = manual || (error && job.attempts >= 8) ? 'manual' : next !== undefined || error ? 'pending' : 'done'
    tx.update(ref, { status, availableAt: new Date(next ?? (error ? Date.now() + retryDelay(job.attempts) : Date.now())),
      ...(!error ? { attempts: 0 } : {}), lastError: error ?? null, token: null, leaseUntil: new Date(0), updatedAt: new Date() })
  })
}
export async function recoverExpiredJobs(db: Firestore, now = Date.now()) {
  const running = await db.collection(QUEUE).where('status', '==', 'running').get()
  for (const doc of running.docs) {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(doc.ref), data = snap.data()
      if (data?.status !== 'running' || milliseconds(data.leaseUntil) > now) return
      tx.update(doc.ref, { status: (data.attempts ?? 0) >= 8 ? 'manual' : 'pending', availableAt: new Date(now),
        token: null, lastError: 'Execution lease expired' })
    })
  }
}
