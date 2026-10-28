import type { Firestore } from 'firebase-admin/firestore'
import { schedulerEnabled, milliseconds, QUEUE } from './schedulerQueue'

export async function schedulerStatus(db: Firestore) {
  const [pending, running, manual, worker, cron] = await Promise.all([
    db.collection(QUEUE).where('status', '==', 'pending').count().get(),
    db.collection(QUEUE).where('status', '==', 'running').count().get(),
    db.collection(QUEUE).where('status', '==', 'manual').limit(30).get(),
    db.collection('scheduler_state').doc('worker').get(), db.collection('scheduler_state').doc('cron').get(),
  ])
  return { enabled: schedulerEnabled(), schedulerJobId: process.env.CRONJOB_ORG_SCHEDULER_JOB_ID ?? null,
    origin: process.env.PUBLIC_BASE_URL?.replace(/\/$/, '') ?? null, pending: pending.data().count, running: running.data().count,
    manual: manual.docs.map((doc) => ({ id: doc.id, date: doc.data().date, kind: doc.data().kind, error: doc.data().lastError ?? null })),
    lastRunAt: milliseconds(worker.data()?.lastSuccessAt) || null,
    lastRecoveryAt: milliseconds(worker.data()?.lastRecoveryAt) || null,
    cronError: cron.data()?.error ?? null, cronLastSuccessAt: milliseconds(cron.data()?.lastSuccessAt) || null }
}
