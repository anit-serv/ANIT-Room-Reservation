import axios from 'axios'
import type { Firestore } from 'firebase-admin/firestore'
import { randomUUID } from 'crypto'
import { cronWakeSchedule } from './schedulerTiming'
import { milliseconds, QUEUE, LEASE_MS } from './schedulerQueue'

export async function syncSchedulerCron(db: Firestore) {
  const jobId = process.env.CRONJOB_ORG_SCHEDULER_JOB_ID, apiKey = process.env.CRONJOB_ORG_API_KEY
  const baseUrl = process.env.PUBLIC_BASE_URL, secret = process.env.CRON_SECRET
  if (!jobId || !apiKey || !baseUrl || !secret) throw new Error('Scheduler environment variables missing')
  if (!/^\d+$/.test(jobId) || !/^https:\/\/[a-z0-9.-]+$/i.test(baseUrl.replace(/\/$/, ''))) {
    throw new Error('Scheduler job ID or canonical HTTPS origin is invalid')
  }
  const state = db.collection('scheduler_state').doc('cron'), token = randomUUID()
  const claimed = await db.runTransaction(async (tx) => {
    const doc = await tx.get(state), data = doc.data()
    if (milliseconds(data?.leaseUntil) > Date.now() || milliseconds(data?.retryAt) > Date.now()) return false
    tx.set(state, { token, leaseUntil: new Date(Date.now() + LEASE_MS) }, { merge: true })
    return true
  })
  if (!claimed) return
  try {
    const first = await db.collection(QUEUE).where('status', '==', 'pending').orderBy('availableAt').limit(1).get()
    const job = first.docs[0]?.data()
    const next = job ? cronWakeSchedule(milliseconds(job.availableAt), job.kind === 'band') : null
    const saved = (await state.get()).data()
    const fingerprint = `${baseUrl}:${jobId}:${next?.key ?? 'disabled'}`
    // Expired once schedules must be rearmed even when the queued job has not changed.
    if (saved?.fingerprint === fingerprint && milliseconds(saved?.verifiedUntil) > Date.now()) return
    const request = { job: { enabled: !!next, saveResponses: false, requestTimeout: 300, requestMethod: 0,
      url: `${baseUrl.replace(/\/$/, '')}/api/scheduler`,
      extendedData: { headers: { Authorization: `Bearer ${secret}` } },
      ...(next ? { schedule: next.schedule } : {}) } }
    await axios.patch(`https://api.cron-job.org/jobs/${jobId}`, request,
      { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 10_000 })
    // expiresAt is YYYYMMDDhhmmss, not a Unix timestamp.
    const expiry = next?.schedule.expiresAt.toString()
    const until = expiry ? Date.parse(`${expiry.slice(0, 4)}-${expiry.slice(4, 6)}-${expiry.slice(6, 8)}T${expiry.slice(8, 10)}:${expiry.slice(10, 12)}:${expiry.slice(12, 14)}+09:00`) : Date.now() + 60_000
    await state.set({ fingerprint, verifiedUntil: new Date(until), lastSuccessAt: new Date(), error: null, retryAt: new Date(0) }, { merge: true })
  } catch {
    await state.set({ error: 'cron同期に失敗しました。復旧ジョブで再試行します', retryAt: new Date(Date.now() + 2 * 60_000) }, { merge: true })
    throw new Error('Scheduler cron sync failed')
  } finally {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(state)
      if (snap.data()?.token === token) tx.update(state, { token: null, leaseUntil: new Date(0) })
    })
  }
}
