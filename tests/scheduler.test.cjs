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
const { selectOperationPlan, planWarnings } = require('../lib/operationPlan.ts')
const { prepareOperationPlans } = require('../lib/operationPlanStore.ts')
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


test('same-day notification exceptions survive save normalization and resolve by usage date', async () => {
  const { normalizeLotteryTimeOverrides, resolveReservationSettingsForDate, resolveReservationSettingsForDates } = require('../lib/reservationSettings.ts')
  const rules = normalizeLotteryTimeOverrides({ byWeekday: {}, byDate: {},
    notifyByWeekday: { '4': '10:30', bad: '12:00' }, notifyByDate: { '2026-11-05': '11:45', '2026-11-12': '25:00' } })
  assert.deepEqual(rules.notifyByWeekday, { '4': '10:30' })
  assert.deepEqual(rules.notifyByDate, { '2026-11-05': '11:45' })
  const db = new FakeFirestore({
    'settings/reservation': { lotteryMode: 'same-day', notifyMode: 'same-day', lotteryTime: '21:00', notifyTime: '09:00' },
    'settings/reservation/versions/2026-11-01': { effectiveFrom: '2026-11-01', lotteryTime: '21:00', lotteryTimeOverrides: rules },
  })
  const dates = ['2026-10-29', '2026-11-05', '2026-11-12', '2026-11-13']
  const batch = await resolveReservationSettingsForDates(db, dates)
  for (const [index, date] of dates.entries()) {
    const single = await resolveReservationSettingsForDate(db, date)
    assert.equal(single.notifyTime, ['09:00', '11:45', '10:30', '09:00'][index])
    assert.equal(batch[date].notifyTime, single.notifyTime)
    assert.equal(single.defaultNotifyTime, '09:00')
    assert.equal(new Date(timing.executionTimes(date, single).lottery).toISOString(),
      new Date(Date.parse(`${date}T00:00:00+09:00`) - 5 * 60_000).toISOString())
    assert.equal(new Date(timing.executionTimes(date, single).notify).getTime(), Date.parse(`${date}T${single.notifyTime}:00+09:00`))
  }
})

test('notification exception validation compares matching draw rules and retains day ordering', () => {
  const { timingOverridesValid } = require('../lib/lotteryTiming.ts')
  assert.equal(timingOverridesValid({ ...mode, lotteryMode: 'same-day' }, { notifyByWeekday: { '4': '00:00' } }), true)
  assert.equal(timingOverridesValid({ ...mode, lotteryMode: 'same-day', notifyMode: 'previous-day' }, {}), false)
  const base = { ...mode, notifyMode: 'previous-day', notifyTime: '21:00' }
  assert.equal(timingOverridesValid(base, { byWeekday: { '4': '22:00' }, notifyByWeekday: { '4': '23:00' } }), true)
  assert.equal(timingOverridesValid(base, { byWeekday: { '4': '22:00' }, notifyByWeekday: { '4': '21:30' } }), false)
  assert.equal(timingOverridesValid(base, { byWeekday: { '4': '22:00' }, notifyByWeekday: { '4': '23:00' }, notifyByDate: { '2026-11-05': '21:00' } }), false)
})


test('previous-day nominal time starts at 00:10 so its deadline stays on the previous day', () => {
  const { timingOverridesValid } = require('../lib/lotteryTiming.ts')
  const base = { lotteryMode: 'previous-day', lotteryTime: '00:10', notifyMode: 'previous-day', notifyTime: '00:10' }
  assert.equal(timingOverridesValid(base, {}), true)
  assert.equal(timingOverridesValid({ ...base, lotteryTime: '00:09' }, {}), false)
  assert.equal(timingOverridesValid(base, { byWeekday: { '4': '00:09' } }), false)
  assert.equal(timingOverridesValid(base, { byDate: { '2026-11-05': '00:09' } }), false)
  const times = timing.executionTimes('2026-11-05', base)
  assert.equal(times.deadline, Date.parse('2026-11-04T00:00:00+09:00'))
  assert.equal(times.lottery, Date.parse('2026-11-04T00:05:00+09:00'))
})


test('scheduled operation and BAND mode affect only usage dates from the effective date', async () => {
  const { resolveReservationSettingsForDate, resolveReservationSettingsForDates } = require('../lib/reservationSettings.ts')
  const { getRoomPreferenceConfig } = require('../lib/roomPreference.ts')
  const db = new FakeFirestore({
    'settings/reservation': { lotteryMode: 'previous-day', lotteryTime: '21:00', notifyMode: 'previous-day', notifyTime: '21:00' },
    'settings/room-preference': { notificationMode: 'post', fallbackPost: false },
    'settings/reservation/versions/2026-11-05': { effectiveFrom: '2026-11-05', lotteryTime: '21:00',
      lotteryMode: 'same-day', notifyMode: 'same-day', notifyTime: '08:30', notificationMode: 'comment', fallbackPost: true },
    // Older scheduled documents without operation fields must inherit the preceding operation.
    'settings/reservation/versions/2026-11-10': { effectiveFrom: '2026-11-10', lotteryTime: '22:00' },
  })
  const dates = ['2026-11-04', '2026-11-05', '2026-11-10']
  const batch = await resolveReservationSettingsForDates(db, dates)
  for (const date of dates) {
    const settings = await resolveReservationSettingsForDate(db, date)
    const before = date < '2026-11-05'
    assert.equal(settings.lotteryMode, before ? 'previous-day' : 'same-day')
    assert.equal(settings.notifyMode, before ? 'previous-day' : 'same-day')
    assert.equal(settings.notifyTime, before ? '21:00' : '08:30')
    assert.equal(batch[date].notifyTime, settings.notifyTime)
    assert.equal(batch[date].lotteryMode, settings.lotteryMode)
    assert.deepEqual(await getRoomPreferenceConfig(db, date), { notificationMode: before ? 'post' : 'comment', fallbackPost: !before })
  }
})


test('execution-day guard excludes usage dates before the requested effective date', () => {
  const { operationChangeOnExecutionDate } = require('../lib/lotteryTiming.ts')
  const before = { lotteryMode: 'previous-day', lotteryTime: '21:00', notifyMode: 'previous-day', notifyTime: '21:00' }
  const after = { ...before, notifyMode: 'same-day', notifyTime: '09:00' }
  assert.equal(operationChangeOnExecutionDate('2026-10-29', ['2026-10-29', '2026-10-30'], before, after, '2026-11-05'), null)
  assert.equal(operationChangeOnExecutionDate('2026-10-29', ['2026-10-29'], { ...before, notifyMode: 'same-day' }, after, '2026-10-29'), '通知')
})


const at = text => Date.parse(`${text}+09:00`)
const transitionBase = { lotteryMode: 'previous-day', lotteryTime: '12:09', notifyMode: 'previous-day', notifyTime: '12:09', notificationMode: 'post', fallbackPost: false }

test('12:00 confirmation keeps 12:04 actual draw and 12:09 notification when requested times are 12:01', () => {
  const plan = selectOperationPlan('2026-10-30', transitionBase, { ...transitionBase, lotteryTime: '12:01', notifyTime: '12:01' }, at('2026-10-29T12:00:00'))
  assert.equal(plan.deadline, at('2026-10-29T11:59:00'))
  assert.equal(plan.lotteryAt, at('2026-10-29T12:04:00'))
  assert.equal(plan.notifyAt, at('2026-10-29T12:09:00'))
  assert.match(plan.notifyReason, /採用した抽選/)
  assert.equal(planWarnings(plan).length, 2)
})

test('exact ten-minute draw boundary is allowed and earlier actual draw is retained', () => {
  const now = at('2026-10-29T10:00:00'), before = { ...transitionBase, lotteryTime: '13:00', notifyTime: '14:00' }
  const exact = selectOperationPlan('2026-10-30', before, { ...before, lotteryTime: '10:15', notifyTime: '10:15' }, now)
  assert.equal(exact.lotteryAt, now + 10 * 60_000)
  assert.equal(exact.drawReason, null)
  const early = selectOperationPlan('2026-10-30', before, { ...before, lotteryTime: '10:14', notifyTime: '10:14' }, now)
  assert.equal(early.lotteryTime, '13:00')
  assert.equal(early.notifyTime, '14:00')
})

test('notification can change independently after an immutable draw, including exact confirmation time', () => {
  const before = { ...transitionBase, lotteryTime: '09:00', notifyTime: '12:00' }, now = at('2026-10-29T10:00:00')
  const exact = selectOperationPlan('2026-10-30', before, { ...before, notifyTime: '10:00' }, now, { drawLocked: true })
  assert.equal(exact.notifyTime, '10:00')
  assert.equal(exact.notifyReason, null)
  const past = selectOperationPlan('2026-10-30', before, { ...before, notifyTime: '09:59' }, now, { drawLocked: true })
  assert.equal(past.notifyTime, '12:00')
  assert.match(past.notifyReason, /保存確定より前/)
})

test('old notification retention also rolls back a later proposed draw to prevent inverse dependency', () => {
  const before = { ...transitionBase, lotteryTime: '12:09', notifyTime: '12:09' }
  const plan = selectOperationPlan('2026-10-30', before, { ...before, lotteryTime: '14:00', notifyTime: '14:00' },
    at('2026-10-29T09:00:00'), { notifyLocked: true })
  assert.equal(plan.lotteryTime, '12:09')
  assert.equal(plan.notifyTime, '12:09')
  assert.match(plan.drawReason, /維持する通知/)
})

test('next utilization day may notify before current utilization day without relabeling dates', () => {
  const now = at('2026-10-29T09:30:00')
  const old = { ...transitionBase, lotteryMode: 'same-day', notifyMode: 'same-day', notifyTime: '12:00' }
  const next = { ...old, lotteryMode: 'previous-day', lotteryTime: '09:50', notifyMode: 'previous-day', notifyTime: '10:00' }
  const today = selectOperationPlan('2026-10-29', old, next, now, { drawLocked: true })
  const tomorrow = selectOperationPlan('2026-10-30', old, next, now)
  assert.equal(today.notifyAt, at('2026-10-29T12:00:00'))
  assert.equal(tomorrow.notifyAt, at('2026-10-29T10:00:00'))
  assert.ok(tomorrow.notifyAt < today.notifyAt)
  assert.equal(tomorrow.date, '2026-10-30')
})

function planFixture(overrides = {}) {
  return new FakeFirestore({ 'settings/reservation': { ...transitionBase, availableDays: [], extraDates: ['2026-10-30'],
    timeSlots: [{ label: '09-10', value: '09:00-10:00' }], ...overrides },
    'settings/room-preference': { notificationMode: 'post', fallbackPost: false } })
}
function proposedPlan(overrides = {}) {
  return { ...transitionBase, availableDays: [], extraDates: ['2026-10-30'], excludedDates: [],
    timeSlots: [{ label: '09-10', value: '09:00-10:00' }], perDaySchedule: { enabled: false, byWeekday: {}, byDate: {} },
    effectiveFrom: '2026-10-30', lotteryTime: '12:01', notifyTime: '12:01', lotteryTimeOverrides: { byWeekday: {}, byDate: {} }, ...overrides }
}
async function savePlan(db, change, time) {
  return db.runTransaction(async tx => {
    const prepared = await prepareOperationPlans(db, tx, change, () => time)
    prepared.write()
    tx.set(db.collection('settings').doc('reservation').collection('versions').doc(change.effectiveFrom), change)
    return prepared
  })
}

test('settings, immutable retained dates and queue schedules are committed together and survive reconciliation', async () => {
  const { resolveReservationSettingsForDate, resolveReservationSettingsForDates } = require('../lib/reservationSettings.ts')
  const db = planFixture(), now = at('2026-10-29T12:00:00')
  await queue.enqueue(db, 'lottery', '2026-10-30', at('2026-10-29T12:04:00'))
  await queue.enqueue(db, 'notify', '2026-10-30', at('2026-10-29T12:09:00'))
  const prepared = await savePlan(db, proposedPlan(), now)
  assert.equal(prepared.warnings.length, 2)
  assert.ok(db.rows.has('operation_plans/2026-10-30'))
  const single = await resolveReservationSettingsForDate(db, '2026-10-30')
  const batch = await resolveReservationSettingsForDates(db, ['2026-10-30'])
  assert.equal(single.lotteryTime, '12:09')
  assert.equal(batch['2026-10-30'].notifyTime, '12:09')
  assert.equal((await resolveReservationSettingsForDate(db, '2026-10-30', { ignorePlan: true })).notifyTime, '12:01')
  const originalNow = Date.now
  Date.now = () => now + 60_000
  try { await reconcileScheduler(db) } finally { Date.now = originalNow }
  assert.equal(queue.milliseconds(db.rows.get('scheduled_jobs/notify_2026-10-30').dueAt), at('2026-10-29T12:09:00'))
  assert.equal(db.rows.get('scheduled_jobs/lottery_2026-10-30').status, 'pending')
  const { reservationDeadline } = require('../lib/lotteryOperation.ts')
  assert.equal(reservationDeadline('2026-10-30', single.lotteryMode, single.lotteryTime).getTime(), at('2026-10-29T11:59:00'))
})

test('transaction failure cannot leave new settings with an old or missing execution snapshot', async () => {
  const db = planFixture()
  db.failCommit = () => true
  await assert.rejects(savePlan(db, proposedPlan(), at('2026-10-29T12:00:00')))
  assert.equal(db.rows.has('settings/reservation/versions/2026-10-30'), false)
  assert.equal(db.rows.has('operation_plans/2026-10-30'), false)
})

test('preview writes nothing and actual save reevaluates the elapsed confirmation time', async () => {
  const db = planFixture({ lotteryTime: '14:00', notifyTime: '14:00' })
  const change = proposedPlan({ lotteryTime: '12:15', notifyTime: '12:15' }), before = db.rows.size
  const preview = await db.runTransaction(tx => prepareOperationPlans(db, tx, change, () => at('2026-10-29T12:00:00')))
  assert.equal(preview.warnings.length, 0)
  assert.equal(db.rows.size, before)
  const saved = await savePlan(db, change, at('2026-10-29T12:01:00'))
  assert.equal(saved.warnings.length, 2)
  assert.equal(db.rows.get('operation_plans/2026-10-30').notifyTime, '14:00')
})

test('started jobs and comment windows stay fixed on subsequent saves', async () => {
  const db = planFixture({ lotteryTime: '14:00', notifyMode: 'same-day', notifyTime: '12:00' })
  await queue.enqueue(db, 'lottery', '2026-10-30', at('2026-10-29T13:55:00'))
  const claimed = await queue.claimJob(db, 'lottery_2026-10-30', at('2026-10-29T13:55:00'))
  assert.ok(claimed)
  await db.collection('lottery_results').doc('2026-10-30').set({ pollStatus: 'active',
    pollStartsAt: new Date(at('2026-10-30T12:00:00')), pollEndsAt: new Date(at('2026-10-30T13:00:00')),
    notificationMode: 'comment', fallbackPost: true, notifyMode: 'same-day', notifyTime: '12:00' })
  await savePlan(db, proposedPlan({ lotteryTime: '15:00', notifyMode: 'same-day', notifyTime: '15:00' }), at('2026-10-29T13:55:00'))
  const plan = db.rows.get('operation_plans/2026-10-30')
  assert.equal(plan.lotteryTime, '14:00')
  assert.equal(plan.notifyTime, '12:00')
  assert.equal(plan.notificationMode, 'comment')
  assert.equal(plan.notifyAt, at('2026-10-30T12:00:00'))
  assert.equal(db.rows.get('scheduled_jobs/lottery_2026-10-30').token, claimed.token)
})

test('future effective dates neither change nor warn about current execution dates', async () => {
  const db = planFixture()
  const saved = await savePlan(db, proposedPlan({ effectiveFrom: '2026-11-05' }), at('2026-10-29T12:00:00'))
  assert.deepEqual(saved.warnings, [])
  assert.equal([...db.rows.keys()].some(key => key.startsWith('operation_plans/')), false)
})

test('comment notification initialization uses the preserved start date and one-hour window', async () => {
  const { startNotification } = require('../lib/notificationService.ts')
  const now = at('2026-10-29T12:00:00'), originalNow = Date.now, db = planFixture()
  await db.collection('settings').doc('room-preference').set({ notificationMode: 'comment', fallbackPost: true })
  await savePlan(db, proposedPlan({ notificationMode: 'post', fallbackPost: false }), now)
  // The original comment mode and its confirmation window are retained together.
  await db.collection('lottery_results').doc('2026-10-30').set({ results: {} })
  Date.now = () => at('2026-10-29T12:08:00')
  try { await assert.rejects(startNotification(db, '2026-10-30'), /通知日時前/) } finally { Date.now = originalNow }
  Date.now = () => at('2026-10-29T12:09:00')
  try { await startNotification(db, '2026-10-30') } finally { Date.now = originalNow }
  const data = db.rows.get('lottery_results/2026-10-30')
  assert.equal(data.notificationMode, 'comment')
  assert.equal(data.pollStatus, 'active')
  assert.equal(data.fallbackPost, true)
  assert.equal(queue.milliseconds(data.pollStartsAt), at('2026-10-29T12:09:00'))
  assert.equal(queue.milliseconds(data.pollEndsAt) - queue.milliseconds(data.pollStartsAt), 3_600_000)
})


async function withSchedulerClock(initial, callback) {
  const RealDate = Date, envKeys = ['SCHEDULER_ENABLED', 'CRONJOB_ORG_SCHEDULER_JOB_ID', 'CRONJOB_ORG_API_KEY', 'CRON_SECRET', 'PUBLIC_BASE_URL']
  const savedEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]))
  let fixed = initial
  class ClockDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [fixed])) }
    static now() { return fixed }
    static [Symbol.hasInstance](value) { return value instanceof RealDate }
  }
  global.Date = ClockDate
  Object.assign(process.env, { SCHEDULER_ENABLED: 'true', CRONJOB_ORG_SCHEDULER_JOB_ID: '123',
    CRONJOB_ORG_API_KEY: 'test-only', CRON_SECRET: 'test-only', PUBLIC_BASE_URL: 'https://scheduler.invalid' })
  const oldPatch = axios.patch
  axios.patch = async () => ({ data: {} })
  try { await callback(next => { fixed = next }) }
  finally {
    global.Date = RealDate; axios.patch = oldPatch
    for (const key of envKeys) { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key] }
  }
}

test('notification waits for an absent draw result without exhausting retries and sends after completion', async () => {
  await withSchedulerClock(at('2026-10-29T12:20:00'), async advance => {
    const db = planFixture()
    let sends = 0
    delivery.deliveryApi.sendPost = async () => { sends++; return 'after-draw' }
    await queue.enqueue(db, 'lottery', '2026-10-30', at('2026-10-29T12:04:00'))
    await db.collection('scheduled_jobs').doc('lottery_2026-10-30').update({ status: 'manual' })
    await queue.enqueue(db, 'notify', '2026-10-30', at('2026-10-29T12:09:00'))
    await db.collection('scheduled_jobs').doc('notify_2026-10-30').update({ attempts: 7 })
    await runScheduler(db, true)
    assert.equal(sends, 0)
    assert.equal(db.rows.get('scheduled_jobs/notify_2026-10-30').status, 'pending')
    assert.equal(db.rows.get('scheduled_jobs/notify_2026-10-30').attempts, 0)
    assert.equal(db.rows.has('band_deliveries/anything'), false)
    advance(at('2026-10-29T12:22:00'))
    const data = result(); delete data.pollStatus
    await db.collection('lottery_results').doc('2026-10-30').set(data)
    await runScheduler(db, true)
    assert.equal(sends, 1)
    assert.equal(db.rows.get('scheduled_jobs/notify_2026-10-30').status, 'done')
    await runScheduler(db, true)
    assert.equal(sends, 1)
  })
})

test('actual queue sends tomorrow at 10:00 and today at 12:00 using their own result dates', async () => {
  await withSchedulerClock(at('2026-10-29T09:30:00'), async advance => {
    const old = { ...transitionBase, lotteryMode: 'same-day', notifyMode: 'same-day', notifyTime: '12:00' }
    const db = planFixture({ ...old, extraDates: ['2026-10-29', '2026-10-30'] })
    const next = { ...old, lotteryMode: 'previous-day', lotteryTime: '09:50', notifyMode: 'previous-day', notifyTime: '10:00' }
    for (const date of ['2026-10-29', '2026-10-30']) {
      const plan = selectOperationPlan(date, old, next, Date.now(), { drawLocked: date === '2026-10-29' })
      await db.collection('operation_plans').doc(date).set(plan)
      const data = result(); delete data.pollStatus
      await db.collection('lottery_results').doc(date).set(data)
    }
    const posted = []
    delivery.deliveryApi.sendPost = async content => { posted.push(content); return `ordered-${posted.length}` }
    advance(at('2026-10-29T10:00:00'))
    await runScheduler(db, true)
    assert.equal(posted.length, 1)
    assert.match(posted[0], /10[\/]30/)
    assert.equal(db.rows.get('lottery_results/2026-10-29').notificationSentAt, undefined)
    advance(at('2026-10-29T12:00:00'))
    await runScheduler(db, true)
    assert.equal(posted.length, 2)
    assert.match(posted[1], /10[\/]29/)
  })
})

test('near midnight the day after tomorrow is included in the safety decision', async () => {
  const db = planFixture({ lotteryTime: '13:00', notifyTime: '13:00', extraDates: ['2026-10-31'] })
  const change = proposedPlan({ effectiveFrom: '2026-10-31', lotteryTime: '00:10', notifyTime: '00:10', extraDates: ['2026-10-31'] })
  await savePlan(db, change, at('2026-10-29T23:59:00'))
  const plan = db.rows.get('operation_plans/2026-10-31')
  assert.equal(plan.lotteryTime, '13:00')
  assert.equal(plan.notifyTime, '13:00')
  assert.ok(plan.drawReason)
})

test('cancelling a version also atomically preserves a near execution instead of moving it backwards', async () => {
  const db = planFixture({ lotteryTime: '12:01', notifyTime: '12:01' }), change = proposedPlan({ lotteryTime: '12:09', notifyTime: '12:09' })
  await db.collection('settings').doc('reservation').collection('versions').doc(change.effectiveFrom).set(change)
  await db.runTransaction(async tx => {
    const prepared = await prepareOperationPlans(db, tx, change, () => at('2026-10-29T12:00:00'), change.effectiveFrom)
    prepared.write()
    tx.delete(db.collection('settings').doc('reservation').collection('versions').doc(change.effectiveFrom))
  })
  assert.equal(db.rows.get('operation_plans/2026-10-30').lotteryTime, '12:09')
  assert.equal(db.rows.get('operation_plans/2026-10-30').notifyTime, '12:09')
})


test('stale reconciliation cannot overwrite a plan committed between its settings read and enqueue', async () => {
  const db = planFixture({ lotteryTime: '14:00', notifyTime: '14:00' })
  const stale = timing.executionTimes('2026-10-30', { ...transitionBase, lotteryTime: '14:00', notifyTime: '14:00' })
  await savePlan(db, proposedPlan({ lotteryTime: '13:00', notifyTime: '13:00' }), at('2026-10-29T09:00:00'))
  await queue.enqueue(db, 'lottery', '2026-10-30', stale.lottery, { reschedule: true })
  await queue.enqueue(db, 'notify', '2026-10-30', stale.notify, { reschedule: true })
  assert.equal(queue.milliseconds(db.rows.get('scheduled_jobs/lottery_2026-10-30').dueAt), at('2026-10-29T12:55:00'))
  assert.equal(queue.milliseconds(db.rows.get('scheduled_jobs/notify_2026-10-30').dueAt), at('2026-10-29T13:00:00'))
})

test('a moved pending job cannot be claimed at the stale due time', async () => {
  const db = planFixture({ lotteryTime: '14:00', notifyTime: '14:00' })
  await queue.enqueue(db, 'lottery', '2026-10-30', at('2026-10-29T13:55:00'))
  await savePlan(db, proposedPlan({ lotteryTime: '15:00', notifyTime: '15:00' }), at('2026-10-29T09:00:00'))
  assert.equal(await queue.claimJob(db, 'lottery_2026-10-30', at('2026-10-29T13:55:00')), null)
  assert.ok(await queue.claimJob(db, 'lottery_2026-10-30', at('2026-10-29T14:55:00')))
})


test('opening a previously inactive day can accept a future draw after an unrelated old default deadline', async () => {
  const db = planFixture({ lotteryTime: '09:00', notifyTime: '09:00', extraDates: [] })
  await savePlan(db, proposedPlan({ lotteryTime: '14:00', notifyTime: '14:00' }), at('2026-10-29T12:00:00'))
  assert.equal(db.rows.get('operation_plans/2026-10-30').lotteryTime, '14:00')
  assert.equal(db.rows.get('operation_plans/2026-10-30').drawReason, null)
})


test('a simultaneous immediate extra-date change participates in the same timing decision', async () => {
  const db = planFixture({ lotteryTime: '14:00', notifyTime: '14:00', extraDates: [],
    immediateDatedSettings: { extraDates: [], excludedDates: [], byDate: {} } })
  const change = proposedPlan({ lotteryTime: '12:01', notifyTime: '12:01' })
  await db.runTransaction(async tx => {
    const prepared = await prepareOperationPlans(db, tx, change, () => at('2026-10-29T12:00:00'), undefined,
      { extraDates: ['2026-10-30'], excludedDates: [], byDate: {} })
    prepared.write()
    tx.set(db.collection('settings').doc('reservation').collection('versions').doc(change.effectiveFrom), change)
    tx.set(db.collection('settings').doc('reservation'), { immediateDatedSettings: { extraDates: ['2026-10-30'], excludedDates: [], byDate: {} } }, { merge: true })
  })
  assert.equal(db.rows.get('operation_plans/2026-10-30').lotteryTime, '14:00')
  assert.equal(db.rows.get('operation_plans/2026-10-30').notifyTime, '14:00')
})


test('booking-window timing warning includes eligible usage dates from the effective date and permits save', async () => {
  const extraDates = ['2026-10-30', '2026-11-01', '2026-11-02']
  const db = planFixture({ extraDates })
  const saved = await savePlan(db, proposedPlan({ effectiveFrom: '2026-11-01', extraDates, lotteryTime: '14:00', notifyTime: '14:00' }), at('2026-10-29T12:00:00'))
  assert.deepEqual(saved.affectedOperations, [
    { date: '2026-11-01', events: ['抽選', '通知'] }, { date: '2026-11-02', events: ['抽選', '通知'] },
  ])
  assert.ok(db.rows.has('settings/reservation/versions/2026-11-01'))
  assert.equal(saved.warnings.length, 0)
})

test('BAND method-only change warns about notification but does not block setting save', async () => {
  const db = planFixture({ lotteryTime: '14:00', notifyTime: '14:00' })
  const saved = await savePlan(db, proposedPlan({ lotteryTime: '14:00', notifyTime: '14:00', notificationMode: 'comment' }), at('2026-10-29T12:00:00'))
  assert.deepEqual(saved.affectedOperations, [{ date: '2026-10-30', events: ['通知'] }])
  assert.equal(db.rows.get('settings/reservation/versions/2026-10-30').notificationMode, 'comment')
})

test('no timing warning for unchanged schedules or dates outside the existing booking window', async () => {
  const db = planFixture()
  const unchanged = await savePlan(db, proposedPlan({ lotteryTime: '12:09', notifyTime: '12:09' }), at('2026-10-29T12:00:00'))
  assert.deepEqual(unchanged.affectedOperations, [])
  const later = await savePlan(db, proposedPlan({ effectiveFrom: '2026-11-10', lotteryTime: '14:00', notifyTime: '14:00' }), at('2026-10-29T12:00:00'))
  assert.deepEqual(later.affectedOperations, [])
  const newDateDb = planFixture({ extraDates: [] })
  const added = await savePlan(newDateDb, proposedPlan({ lotteryTime: '14:00', notifyTime: '14:00' }), at('2026-10-29T12:00:00'))
  assert.deepEqual(added.affectedOperations, [])
})


function readMeter(db) {
  let units = 0
  const wrap = ref => new Proxy(ref, { get(target, key) {
    const value = target[key]
    if (key === 'get') return async () => {
      const result = await value.call(target)
      units += result.docs ? Math.max(1, result.docs.length) : 1
      return result
    }
    if (typeof value !== 'function') return value
    return (...args) => {
      const result = value.apply(target, args)
      return result && typeof result.get === 'function' ? wrap(result) : result
    }
  } })
  return { db: { collection: path => wrap(db.collection(path)), runTransaction: fn => db.runTransaction(fn) },
    get units() { return units } }
}

test('quiet recovery avoids repeated full settings scans and stays within a bounded read budget', async () => {
  await withSchedulerClock(at('2026-10-29T10:00:00'), async advance => {
    const original = planFixture({ availableDays: [], extraDates: [] }), meter = readMeter(original)
    await runScheduler(meter.db, true)
    const first = meter.units
    advance(at('2026-10-29T10:02:00'))
    await runScheduler(meter.db, true)
    const second = meter.units - first
    assert.ok(first > second, `initial=${first} recurring=${second}`)
    assert.ok(second <= 16, `quiet recovery charged ${second} read units`)
    assert.ok(first * 24 + second * (720 - 24) < 20_000)
    assert.equal(original.rows.get('scheduler_state/worker').needsReconcile, false)
  })
})

test('atomic settings invalidation forces immediate rebuild while ordinary recovery remains lightweight', async () => {
  const { markSchedulerDirty } = require('../lib/scheduler.ts')
  await withSchedulerClock(at('2026-10-29T10:00:00'), async advance => {
    const db = planFixture({ availableDays: [], extraDates: [] })
    await runScheduler(db, true)
    assert.equal(db.rows.has('scheduled_jobs/lottery_2026-10-30'), false)
    await db.runTransaction(async tx => {
      tx.set(db.collection('settings').doc('reservation'), { extraDates: ['2026-10-30'] }, { merge: true })
      markSchedulerDirty(db, tx)
    })
    assert.equal(db.rows.get('scheduler_state/worker').needsReconcile, true)
    advance(at('2026-10-29T10:02:00'))
    await runScheduler(db, true)
    assert.equal(db.rows.has('scheduled_jobs/lottery_2026-10-30'), true)
    assert.equal(db.rows.get('scheduler_state/worker').needsReconcile, false)
  })
})

test('lightweight recovery still repairs a crash after initial notification state was saved', async () => {
  await withSchedulerClock(at('2026-10-29T10:00:00'), async advance => {
    const db = planFixture({ availableDays: [], extraDates: [] })
    await runScheduler(db, true)
    await db.collection('lottery_results').doc('2026-10-29').set(result())
    let sends = 0
    delivery.deliveryApi.sendPost = async () => { sends++; return 'crash-repair' }
    advance(at('2026-10-29T10:02:00'))
    await runScheduler(db, true)
    assert.equal(sends, 1)
    assert.equal(db.rows.get('scheduled_jobs/band_2026-10-29').status, 'done')
    await runScheduler(db, true)
    assert.equal(sends, 1)
  })
})

test('quota failure is classified separately from a rejected LINE token', () => {
  const { isFirestoreQuotaError, DATABASE_QUOTA_MESSAGE } = require('../lib/serviceErrors.ts')
  assert.equal(isFirestoreQuotaError({ code: 8, message: 'quota' }), true)
  assert.equal(isFirestoreQuotaError({ message: '8 RESOURCE_EXHAUSTED: Quota exceeded.' }), true)
  assert.equal(isFirestoreQuotaError({ code: 'RESOURCE_EXHAUSTED' }), true)
  assert.equal(isFirestoreQuotaError(new Error('Unauthorized')), false)
  assert.equal(isFirestoreQuotaError({ response: { status: 429 } }), false)
  assert.match(DATABASE_QUOTA_MESSAGE, /利用上限/)
})


test('hourly rebuilding still discovers legacy settings changes without an invalidation marker', async () => {
  await withSchedulerClock(at('2026-10-29T10:00:00'), async advance => {
    const db = planFixture({ availableDays: [], extraDates: [] })
    await runScheduler(db, true)
    await db.collection('settings').doc('reservation').update({ extraDates: ['2026-10-30'] })
    advance(at('2026-10-29T10:02:00'))
    await runScheduler(db, true)
    assert.equal(db.rows.has('scheduled_jobs/lottery_2026-10-30'), false)
    advance(at('2026-10-29T11:00:00'))
    await runScheduler(db, true)
    assert.equal(db.rows.has('scheduled_jobs/lottery_2026-10-30'), true)
  })
})
