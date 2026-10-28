import type { VercelRequest, VercelResponse } from '@vercel/node'
import * as admin from 'firebase-admin'
import { cleanupNotifications, processNotification } from './notificationService'
import { schedulerEnabled } from './schedulerQueue'
import { runScheduler } from './scheduler'
import 'dotenv/config'
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert({
  projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey,
}) })
const db = admin.firestore()
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!process.env.CRON_SECRET || (req.query.key !== process.env.CRON_SECRET &&
      req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    if (schedulerEnabled()) return res.status(200).json(await runScheduler(db))
    await cleanupNotifications(db)
    const [active, dirty, posting] = await Promise.all([
      db.collection('lottery_results').where('pollStatus', '==', 'active').get(),
      db.collection('lottery_results').where('notificationDirty', '==', true).get(),
      db.collection('lottery_results').where('pollStatus', '==', 'posting').get(),
    ])
    const dates = new Set([...active.docs, ...dirty.docs, ...posting.docs].map((doc) => doc.id))
    let failed = 0
    for (const date of dates) {
      try { await processNotification(db, date) } catch { failed++ }
    }
    return res.status(failed ? 503 : 200).json({ processed: dates.size, failed })
  } catch { return res.status(503).json({ error: 'BAND確認処理が失敗しました' }) }
}
