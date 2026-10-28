import { VercelRequest, VercelResponse } from '@vercel/node'
import * as admin from 'firebase-admin'
import { notificationTargetDate } from '../lib/lotteryOperation'
import bandPollHandler from '../lib/bandPollHandler'
import { startNotification, processNotification } from '../lib/notificationService'
import { runScheduler } from '../lib/scheduler'
import { schedulerEnabled } from '../lib/schedulerQueue'
import 'dotenv/config'

const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert({
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey,
}) })
const db = admin.firestore()

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.query._poll === '1') return bandPollHandler(req, res)
  if (!process.env.CRON_SECRET ||
      (req.query.key !== process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    if (schedulerEnabled()) return res.status(200).json(await runScheduler(db))
    const date = typeof req.query.date === 'string' ? req.query.date : await notificationTargetDate(db)
    if (!date) return res.status(200).json({ status: 'skipped' })
    await startNotification(db, date)
    const again = await processNotification(db, date)
    return res.status(200).json({ status: again ? 'polling' : 'success', targetDate: date })
  } catch {
    return res.status(503).json({ error: '通知処理が失敗しました。通知状況を確認してください' })
  }
}
