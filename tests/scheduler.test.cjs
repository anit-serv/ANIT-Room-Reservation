const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename)
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { FakeFirestore } = require('./fakeFirestore.cjs')
const timing = require('../lib/schedulerTiming.ts')
const queue = require('../lib/schedulerQueue.ts')
const delivery = require('../lib/bandDelivery.ts')
const band = require('../lib/band.ts')
const { processNotification } = require('../lib/notificationService.ts')
const { runLotteryForDate } = require('../lib/lotteryRunner.ts')
const { refreshLotterySlot } = require('../lib/roomAllocation.ts')
const { reconcileScheduler } = require('../lib/scheduler.ts')
const { runScheduler } = require('../lib/scheduler.ts')
// No external request is allowed in this test suite.
const axios = require('axios')
axios.get = axios.post = axios.patch = () => { throw new Error('Unexpected network access') }

const mode = { lotteryMode: 'previous-day', lotteryTime: '21:00', notifyMode: 'same-day', notifyTime: '00:10' }
const defaultApi = () => ({ sendPost: async () => 'post-1', sendComment: async () => 'comment-1', findPost: async () => null, findComment: async () => null })
const result = () => ({ notificationRevision: 1, notificationDirty: false, notificationMode: 'post', pollStatus: 'posting',
  results: { '09:00-10:00': { rankedEntries: [{ reservationId: 'r1', bandName: 'A', lotteryRank: 1 }] } }, deliveries: {} })

test('absolute execution dates survive year/month boundaries and midnight', () => {
  const times = timing.executionTimes('2027-01-01', mode)
  assert.equal(new Date(times.lottery).toISOString(), '2026-12-31T11:55:00.000Z')
  assert.equal(new Date(times.deadline).toISOString(), '2026-12-31T11:50:00.000Z')
  assert.equal(new Date(times.notify).toISOString(), '2026-12-31T15:10:00.000Z')
  const same = timing.executionTimes('2027-01-01', { ...mode, lotteryMode: 'same-day' })
  assert.equal(new Date(same.deadline).toISOString(), '2026-12-31T14:50:00.000Z')
  assert.equal(new Date(same.lottery).toISOString(), '2026-12-31T14:55:00.000Z')
})
test('cron expiration uses documented calendar format; minute scans reuse one PATCH', () => {
  const now = Date.parse('2026-10-28T12:01:10+09:00')
  const a = timing.cronWakeSchedule(now, true, now)
  const b = timing.cronWakeSchedule(now + 60_000, true, now + 60_000)
  assert.equal(a.key, b.key)
  assert.equal(a.schedule.expiresAt, 20261028130000)
  assert.deepEqual(a.schedule.minutes, [-1])
  const once = timing.cronWakeSchedule(Date.parse('2027-01-01T00:00:00+09:00'), false, now)
  assert.deepEqual(once.schedule.mdays, [1]); assert.deepEqual(once.schedule.months, [1])
})
test('queue registration is idempotent and concurrent claims have one winner', async () => {
  const db = new FakeFirestore(), now = Date.now()
  await Promise.all([queue.enqueue(db, 'lottery', '2026-10-29', now), queue.enqueue(db, 'lottery', '2026-10-29', now)])
  const claims = await Promise.all([queue.claimJob(db, 'lottery_2026-10-29'), queue.claimJob(db, 'lottery_2026-10-29')])
  assert.equal(claims.filter(Boolean).length, 1)
  await queue.finishJob(db, claims.find(Boolean))
  await queue.enqueue(db, 'lottery', '2026-10-29', now)
  assert.equal(db.rows.get('scheduled_jobs/lottery_2026-10-29').status, 'done')
})
test('cancellation enqueued while running is not lost by completion', async () => {
  const db = new FakeFirestore(), now = Date.now()
  await queue.enqueue(db, 'band', '2026-10-29', now)
  const job = await queue.claimJob(db, 'band_2026-10-29')
  await queue.enqueue(db, 'band', '2026-10-29', now + 10, { repeat: true })
  await queue.finishJob(db, job)
  assert.equal(db.rows.get('scheduled_jobs/band_2026-10-29').status, 'pending')
})
test('expired lease recovery fences an obsolete worker', async () => {
  const db = new FakeFirestore(), now = Date.now()
  await queue.enqueue(db, 'band', '2026-10-29', now)
  const first = await queue.claimJob(db, 'band_2026-10-29', now)
  await queue.recoverExpiredJobs(db, now + queue.LEASE_MS + 1)
  const second = await queue.claimJob(db, 'band_2026-10-29', now + queue.LEASE_MS + 1)
  await queue.finishJob(db, first)
  assert.equal(db.rows.get('scheduled_jobs/band_2026-10-29').token, second.token)
})
test('reconciliation preserves retry backoff and attempt count', async () => {
  const db = new FakeFirestore(), now = Date.now()
  await queue.enqueue(db, 'notify', '2026-10-29', now)
  const job = await queue.claimJob(db, 'notify_2026-10-29')
  await queue.finishJob(db, job, undefined, 'Temporary error')
  const before = db.rows.get('scheduled_jobs/notify_2026-10-29')
  await queue.enqueue(db, 'notify', '2026-10-29', now, { reschedule: true })
  assert.deepEqual(db.rows.get('scheduled_jobs/notify_2026-10-29'), before)
})
test('same durable delivery sends only once', async () => {
  const db = new FakeFirestore(), api = defaultApi(); let sends = 0
  api.sendPost = async () => { sends++; return 'post-1' }
  await delivery.durableDelivery(db, '2026-10-29', 'post', '', 'body', 1, 'self', api)
  await delivery.durableDelivery(db, '2026-10-29', 'post', '', 'body', 1, 'self', api)
  assert.equal(sends, 1)
})
test('ambiguous send without matching BAND history is never blindly resent', async () => {
  const db = new FakeFirestore(), api = defaultApi(); let sends = 0
  api.sendPost = async () => { sends++; throw new Error('Timeout') }
  await assert.rejects(delivery.durableDelivery(db, '2026-10-29', 'post', '', 'body', 1, 'self', api), delivery.DeliveryNeedsReview)
  await assert.rejects(delivery.durableDelivery(db, '2026-10-29', 'post', '', 'body', 1, 'self', api), delivery.DeliveryNeedsReview)
  assert.equal(sends, 1)
})
test('DB failure after BAND success reconciles persisted attempt without duplicate post', async () => {
  const db = new FakeFirestore(), api = defaultApi(); let sends = 0
  api.sendPost = async () => { sends++; return 'post-1' }
  api.findPost = async () => 'post-1'
  db.failCommit = writes => writes.some(([, ref, data]) => ref.path.startsWith('band_deliveries/') && data.status === 'sent')
  await assert.rejects(delivery.durableDelivery(db, '2026-10-29', 'post', '', 'body', 1, 'self', api))
  assert.equal((await delivery.durableDelivery(db, '2026-10-29', 'post', '', 'body', 1, 'self', api)).postKey, 'post-1')
  assert.equal(sends, 1)
})
test('cancellation during initial post preserves dirty revision then replaces old post', async () => {
  const db = new FakeFirestore({ 'lottery_results/2026-10-29': result() })
  band.bandUserKey = async () => 'self'
  let sends = 0
  delivery.deliveryApi.sendPost = async () => {
    sends++
    if (sends === 1) await db.collection('lottery_results').doc('2026-10-29').update({ notificationRevision: 2, notificationDirty: true })
    return `post-${sends}`
  }
  const again = await processNotification(db, '2026-10-29')
  assert.ok(again)
  assert.equal(db.rows.get('lottery_results/2026-10-29').notificationDirty, true)
  await processNotification(db, '2026-10-29')
  const final = db.rows.get('lottery_results/2026-10-29')
  assert.equal(final.notificationDirty, false); assert.equal(final.notificationRevisionSent, 2)
  assert.equal(final.deliveries.post.postKey, 'post-2')
  assert.equal((await db.collection('band_cleanup').get()).size, 1)
})
test('post-only cancellation creates an update job transactionally', async () => {
  const db = new FakeFirestore({
    'lottery_results/2026-10-29': result(),
    'reservations/r1': { date: '2026-10-29T09:00-10:00', bandName: 'A', status: 'confirmed', lotteryRank: 1 },
  })
  process.env.SCHEDULER_ENABLED = 'true'
  await db.runTransaction(tx => refreshLotterySlot(db, tx, '2026-10-29', '09:00-10:00', ['r1']))
  assert.equal(db.rows.get('scheduled_jobs/band_2026-10-29').status, 'pending')
  delete process.env.SCHEDULER_ENABLED
})
test('empty lottery writes completion and a retry cannot re-randomize it', async () => {
  const db = new FakeFirestore()
  await runLotteryForDate(db, '2026-10-29')
  const initial = db.rows.get('lottery_results/2026-10-29')
  assert.ok(initial); assert.deepEqual(initial.results, {})
  const next = await runLotteryForDate(db, '2026-10-29')
  assert.equal(next.status, 'skipped')
})
test('planner recovers pending results and guarantees a daily replenishment wakeup', async () => {
  const date = timing.dateJST()
  const db = new FakeFirestore({ [`lottery_results/${date}`]: { ...result(), notificationDirty: true } })
  await reconcileScheduler(db)
  assert.equal(db.rows.get(`scheduled_jobs/band_${date}`).status, 'pending')
  assert.equal(db.rows.get('scheduled_jobs/cleanup_daily').status, 'pending')
})

test('concurrent initial notification attempts send once', async () => {
  const db = new FakeFirestore({ 'lottery_results/2026-10-29': result() })
  let sends = 0
  delivery.deliveryApi.sendPost = async () => { sends++; return 'concurrent-post' }
  await Promise.all([processNotification(db, '2026-10-29'), processNotification(db, '2026-10-29')])
  assert.equal(sends, 1)
})
test('all matching mention posts receive one comment per revision', async () => {
  const now = Date.now(), db = new FakeFirestore({ 'lottery_results/2026-10-29': {
    ...result(), notificationMode: 'comment', pollStatus: 'active', pollStartsAt: new Date(now - 1000), pollEndsAt: new Date(now + 60_000),
  } })
  band.listBandPosts = async () => ({ complete: true, posts: ['a', 'b'].map(post_key => ({ post_key,
    created_at: now, author: { role: 'leader' }, content: '<band:refer user_key="self">' })) })
  let comments = 0
  delivery.deliveryApi.sendComment = async target => { comments++; return `comment-${target}` }
  await processNotification(db, '2026-10-29')
  await processNotification(db, '2026-10-29')
  assert.equal(comments, 2)
  assert.equal(Object.keys(db.rows.get('lottery_results/2026-10-29').deliveries).length, 2)
})
test('failed/incomplete final BAND read never triggers fallback posting', async () => {
  const now = Date.now(), db = new FakeFirestore({ 'lottery_results/2026-10-29': {
    ...result(), notificationMode: 'comment', fallbackPost: true, pollStatus: 'active',
    pollStartsAt: new Date(now - 3_600_000), pollEndsAt: new Date(now - 1),
  } })
  let posts = 0
  delivery.deliveryApi.sendPost = async () => { posts++; return 'unsafe-fallback' }
  band.listBandPosts = async () => ({ complete: false, posts: [] })
  await assert.rejects(processNotification(db, '2026-10-29'))
  assert.equal(posts, 0)
  assert.ok(db.rows.get('lottery_results/2026-10-29').notificationError)
})
test('successful final scan with no matching posts permits one fallback', async () => {
  const now = Date.now(), db = new FakeFirestore({ 'lottery_results/2026-10-29': {
    ...result(), notificationMode: 'comment', fallbackPost: true, pollStatus: 'active',
    pollStartsAt: new Date(now - 3_600_000), pollEndsAt: new Date(now - 1),
  } })
  let posts = 0
  delivery.deliveryApi.sendPost = async () => { posts++; return 'fallback' }
  band.listBandPosts = async () => ({ complete: true, posts: [] })
  await processNotification(db, '2026-10-29')
  await processNotification(db, '2026-10-29')
  assert.equal(posts, 1)
  assert.equal(db.rows.get('lottery_results/2026-10-29').pollStatus, 'complete')
})
test('successful periodic work resets retry attempts instead of exhausting them after eight polls', async () => {
  const db = new FakeFirestore(), now = Date.now()
  await queue.enqueue(db, 'band', '2026-10-29', now)
  for (let i = 0; i < 12; i++) {
    const job = await queue.claimJob(db, 'band_2026-10-29', now + i)
    await queue.finishJob(db, job, now)
  }
  const job = await queue.claimJob(db, 'band_2026-10-29', now + 20)
  await queue.finishJob(db, job, undefined, 'temporary')
  assert.equal(db.rows.get('scheduled_jobs/band_2026-10-29').status, 'pending')
  assert.equal(db.rows.get('scheduled_jobs/band_2026-10-29').attempts, 1)
})
test('worker processes due jobs and recovery repairs a failed cron synchronization', async () => {
  const db = new FakeFirestore({ 'settings/reservation': { availableDays: [], extraDates: [], timeSlots: [] } })
  Object.assign(process.env, { SCHEDULER_ENABLED: 'true', CRONJOB_ORG_SCHEDULER_JOB_ID: '123',
    CRONJOB_ORG_API_KEY: 'test-only', CRON_SECRET: 'test-only', PUBLIC_BASE_URL: 'https://scheduler.invalid' })
  await queue.enqueue(db, 'cleanup', 'all', Date.now())
  axios.patch = async () => { throw new Error('Injected cron error') }
  await assert.rejects(runScheduler(db, true))
  assert.equal(db.rows.get('scheduled_jobs/cleanup_all').status, 'done')
  assert.ok(db.rows.get('scheduler_state/cron').error)
  assert.equal(db.rows.get('scheduler_state/worker').token, null)
  await db.collection('scheduler_state').doc('cron').update({ retryAt: new Date(0) })
  let patches = 0
  axios.patch = async () => { patches++; return { data: {} } }
  await runScheduler(db, true)
  await runScheduler(db, true)
  assert.equal(patches, 1)
  assert.equal(db.rows.get('scheduler_state/cron').error, null)
  assert.ok(db.rows.get('scheduler_state/worker').lastRecoveryAt)
  for (const key of ['SCHEDULER_ENABLED', 'CRONJOB_ORG_SCHEDULER_JOB_ID', 'CRONJOB_ORG_API_KEY', 'CRON_SECRET', 'PUBLIC_BASE_URL']) delete process.env[key]
})
test('Preview cannot consume the production queue without an explicit isolated-environment flag', () => {
  Object.assign(process.env, { SCHEDULER_ENABLED: 'true', VERCEL_ENV: 'preview' })
  assert.throws(() => queue.schedulerEnabled(), /isolated/)
  delete process.env.SCHEDULER_ENABLED; delete process.env.VERCEL_ENV
})
test('recovery does not move an already scheduled minute poll earlier', async () => {
  const db = new FakeFirestore(), now = Date.now()
  await queue.enqueue(db, 'band', '2026-10-29', now + 60_000)
  await queue.enqueue(db, 'band', '2026-10-29', now, { repeat: true })
  assert.equal(queue.milliseconds(db.rows.get('scheduled_jobs/band_2026-10-29').availableAt), now + 60_000)
})
test('full recovery executes lottery then notification for the explicit utilization date exactly once', async () => {
  const RealDate = Date, fixed = Date.parse('2026-12-31T21:05:00+09:00')
  class ClockDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [fixed])) }
    static now() { return fixed }
    static [Symbol.hasInstance](value) { return value instanceof RealDate }
  }
  global.Date = ClockDate
  const envKeys = ['SCHEDULER_ENABLED', 'CRONJOB_ORG_SCHEDULER_JOB_ID', 'CRONJOB_ORG_API_KEY', 'CRON_SECRET', 'PUBLIC_BASE_URL']
  try {
    const db = new FakeFirestore({
      'settings/reservation': { availableDays: [5], lotteryMode: 'previous-day', lotteryTime: '21:00', notifyMode: 'previous-day', notifyTime: '21:00' },
      'reservations/r1': { date: '2027-01-01T09:00-10:00', bandName: 'A', status: 'pending' },
    })
    Object.assign(process.env, { SCHEDULER_ENABLED: 'true', CRONJOB_ORG_SCHEDULER_JOB_ID: '123',
      CRONJOB_ORG_API_KEY: 'test-only', CRON_SECRET: 'test-only', PUBLIC_BASE_URL: 'https://scheduler.invalid' })
    let sends = 0
    delivery.deliveryApi.sendPost = async () => { sends++; return 'new-year-result' }
    axios.patch = async () => ({ data: {} })
    await runScheduler(db, true)
    assert.equal(db.rows.get('reservations/r1').status, 'confirmed')
    assert.equal(db.rows.get('lottery_results/2027-01-01').notificationRevisionSent, 1)
    assert.equal(db.rows.get('scheduled_jobs/lottery_2027-01-01').status, 'done')
    await runScheduler(db, true)
    assert.equal(sends, 1)
  } finally {
    global.Date = RealDate
    envKeys.forEach(key => delete process.env[key])
  }
})
test('a newer cancellation revision cannot bypass an unknown initial delivery', async () => {
  const db = new FakeFirestore({ 'lottery_results/2026-10-29': { ...result(), notificationRevision: 2, notificationDirty: true } })
  const oldContent = 'old revision'
  const id = delivery.digest(`2026-10-29:post::1:${oldContent}`)
  await db.collection('band_deliveries').doc(id).set({ date: '2026-10-29', kind: 'post', target: '', content: oldContent,
    revision: 1, status: 'unknown', startedAt: new Date(), leaseUntil: new Date(0) })
  let sends = 0
  delivery.deliveryApi.findPost = async () => null
  delivery.deliveryApi.sendPost = async () => { sends++; return 'new-revision' }
  await assert.rejects(processNotification(db, '2026-10-29'), delivery.DeliveryNeedsReview)
  assert.equal(sends, 0)
  delivery.deliveryApi.findPost = async () => 'recovered-initial'
  await processNotification(db, '2026-10-29')
  assert.equal(sends, 1)
  assert.equal(db.rows.get('lottery_results/2026-10-29').deliveries.post.postKey, 'new-revision')
  assert.equal((await db.collection('band_cleanup').get()).size, 1)
})
test('repeated hard crashes eventually require review rather than retrying forever', async () => {
  const db = new FakeFirestore({ 'scheduled_jobs/band_2026-10-29': { kind: 'band', date: '2026-10-29',
    status: 'running', attempts: 8, leaseUntil: new Date(0), token: 'old' } })
  await queue.recoverExpiredJobs(db)
  assert.equal(db.rows.get('scheduled_jobs/band_2026-10-29').status, 'manual')
})
test('an explicit confirmed-absent decision permits a recorded resend', async () => {
  const db = new FakeFirestore(), api = defaultApi(); let sends = 0
  api.sendPost = async () => { sends++; if (sends === 1) throw new Error('timeout'); return 'confirmed-resend' }
  await assert.rejects(delivery.durableDelivery(db, '2026-10-29', 'post', '', 'body', 1, 'self', api))
  const attempt = (await db.collection('band_deliveries').get()).docs[0]
  await attempt.ref.update({ status: 'prepared', resendConfirmedBy: 'admin', resendConfirmedAt: new Date() })
  const sent = await delivery.durableDelivery(db, '2026-10-29', 'post', '', 'body', 1, 'self', api)
  assert.equal(sent.postKey, 'confirmed-resend'); assert.equal(sends, 2)
})
