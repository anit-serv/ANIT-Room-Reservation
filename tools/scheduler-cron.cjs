// Explicit operator tool. Never runs during build/deploy. Does not print URLs, headers, or credentials.
require('dotenv/config')
const fs = require('node:fs')
const statePath = '.scheduler-cron-state.json'
const command = process.argv[2]
if (!['prepare', 'activate'].includes(command)) {
  console.log('Usage: node tools/scheduler-cron.cjs prepare|activate\nprepare creates disabled jobs. activate requires the deployment and Firestore index to be ready.')
  process.exit(0)
}
function required(name) { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value }
async function main() {
  const apiKey = required('CRONJOB_ORG_API_KEY'), secret = required('CRON_SECRET')
  const base = required('PUBLIC_BASE_URL').replace(/\/$/, '')
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(base)) throw new Error('PUBLIC_BASE_URL must be a canonical HTTPS origin')
  const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { origin: base }
  if (state.origin !== base) throw new Error('Saved migration belongs to a different environment')
  const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2))
  const api = async (method, path, body) => {
    const response = await fetch(`https://api.cron-job.org${path}`, {
      method, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`cron-job.org HTTP ${response.status}`)
    return response.json()
  }
  const request = path => fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(60_000) })
  if (command === 'prepare') {
    if (state.active) throw new Error('Migration is already active; refusing to disable running jobs')
    for (const [key, route, minutes] of [['scheduler', '/api/scheduler', [0]], ['recovery', '/api/scheduler/recover', Array.from({ length: 30 }, (_, i) => i * 2)]]) {
      const configuredId = process.env[key === 'scheduler' ? 'CRONJOB_ORG_SCHEDULER_JOB_ID' : 'CRONJOB_ORG_RECOVERY_JOB_ID']
      if (configuredId) {
        if (!/^\d+$/.test(configuredId) || Number(configuredId) <= 0) throw new Error(`Invalid ${key} job ID`)
        state[key] = Number(configuredId)
      }
      if (state[key]) {
        const current = await api('GET', `/jobs/${state[key]}`)
        if (current.jobDetails?.enabled) throw new Error(`${key} job is enabled; refusing to replace it during preparation`)
        if (current.jobDetails?.url !== `${base}${route}`) throw new Error(`${key} job has a different destination; refusing to replace it`)
      } else {
        if (state[`${key}Creating`]) throw new Error(`Previous ${key} creation result is unknown. Verify the console before clearing the local marker.`)
        state[`${key}Creating`] = true; save()
        const created = await api('PUT', '/jobs', { job: { enabled: false, title: `ANIT ${key}`, saveResponses: false,
          requestTimeout: 300, url: `${base}${route}`, extendedData: { headers: { Authorization: `Bearer ${secret}` } },
          schedule: { timezone: 'Asia/Tokyo', expiresAt: 0, hours: [-1], minutes, mdays: [-1], months: [-1], wdays: [-1] } } })
        if (!Number.isInteger(created.jobId)) throw new Error('Job creation response is missing its ID')
        state[key] = created.jobId; delete state[`${key}Creating`]; save()
        // Creating jobs is limited to one request per second by cron-job.org.
        await new Promise(resolve => setTimeout(resolve, 1100))
      }
    }
    save()
    console.log(`Prepared disabled jobs. Set CRONJOB_ORG_SCHEDULER_JOB_ID=${state.scheduler} and CRONJOB_ORG_RECOVERY_JOB_ID=${state.recovery} on the deployment.`)
    return
  }
  if (!state.scheduler || !state.recovery) throw new Error('Run prepare first')
  if (String(state.scheduler) !== required('CRONJOB_ORG_SCHEDULER_JOB_ID')) throw new Error('Scheduler job ID differs from the prepared job')
  const inspection = await request('/api/scheduler?inspect=1')
  if (!inspection.ok) throw new Error('Deployment is not reachable')
  const deployment = await inspection.json()
  if (!deployment.enabled || deployment.schedulerJobId !== String(state.scheduler) || deployment.origin !== base) {
    throw new Error('Deployment queue flag, origin, or scheduler job ID differs from the prepared environment')
  }
  const legacy = required('CRONJOB_ORG_LEGACY_JOB_IDS').split(',').map(v => Number(v.trim()))
  if (legacy.some(id => !Number.isInteger(id) || id <= 0 || id === state.scheduler || id === state.recovery)) throw new Error('Invalid or overlapping legacy job IDs')
  if (!state.legacy) {
    state.legacy = []
    for (const id of legacy) {
      const response = await api('GET', `/jobs/${id}`)
      const url = new URL(response.jobDetails.url)
      const allowed = ['/api/lottery', '/api/notify', '/api/band-poll', '/api/wake', '/api/update-lottery-status'].includes(url.pathname) ||
        (url.pathname === '/api/data-organize' && url.searchParams.get('task') === 'apply-lottery-time')
      if (!allowed) throw new Error('Legacy job list contains an unrecognized job or the data cleanup job; refusing to disable it')
      state.legacy.push({ id, enabled: response.jobDetails.enabled })
    }
    save()
  }
  for (const { id } of state.legacy) await api('PATCH', `/jobs/${id}`, { job: { enabled: false } })
  state.oldDisabled = true; save()
  await api('PATCH', `/jobs/${state.recovery}`, { job: { enabled: true } })
  const recovery = await request('/api/scheduler/recover')
  if (!recovery.ok) throw new Error('Bootstrap failed; the recovery job is enabled and will retry. Check the notification status page.')
  state.active = true; save()
  console.log('Queue activated. Legacy jobs stopped; recovery enabled. Check last recovery, next execution, and manual items in the app.')
}
main().catch(error => { console.error(error instanceof Error && !error.message.includes('https:') ? error.message : 'Migration request failed; verify console state before retrying'); process.exitCode = 1 })
