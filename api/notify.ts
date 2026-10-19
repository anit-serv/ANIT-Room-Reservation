import { VercelRequest, VercelResponse } from '@vercel/node'
import * as admin from 'firebase-admin'
import { lotteryTargetDate } from '../lib/lotteryOperation'
import { bandUserKey, writeBandPost } from '../lib/band'
import { notificationWindow, resultMessage } from '../lib/notificationMessage'
import bandPollHandler from '../lib/bandPollHandler'
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
    const date = typeof req.query.date === 'string' ? req.query.date : await lotteryTargetDate(db)
    if (!date) return res.status(200).json({ status: 'skipped' })
    const ref = db.collection('lottery_results').doc(date)
    const result = await ref.get()
    if (!result.exists) return res.status(503).json({ error: 'Lottery results missing' })
    const data = result.data()!
    if (data.notificationSentAt || data.pollStatus) return res.status(200).json({ status: 'skipped' })
    const content = resultMessage(date, data)
    if (!content) return res.status(200).json({ status: 'skipped', reason: 'empty' })

    if (data.notificationMode === 'comment') {
      const { startsAt, endsAt } = notificationWindow(date, data.lotteryMode ?? 'previous-day', data.notifyTime ?? '21:00')
      if (Date.now() >= endsAt.getTime()) {
        await ref.update({ pollStatus: 'unnotified', notificationError: 'Notification window was missed' })
        return res.status(200).json({ status: 'unnotified' })
      }
      await ref.update({ pollStatus: 'active', pollStartsAt: startsAt, pollEndsAt: endsAt,
        pollTargetDate: date, pollLotteryMode: data.lotteryMode ?? 'previous-day',
        deliveries: {}, pollLastSuccessAt: null })
      return res.status(200).json({ status: 'polling', targetDate: date })
    }

    const ownKey = await bandUserKey()
    const postKey = await writeBandPost(content, ownKey)
    await ref.update({ notificationSentAt: new Date(), notificationRevisionSent: data.notificationRevision ?? 1,
      deliveries: { post: { postKey, content, revision: data.notificationRevision ?? 1 } },
      notificationDirty: false })
    return res.status(200).json({ status: 'success', targetDate: date })
  } catch (error: any) {
    console.error('BAND notification error:', error.message)
    return res.status(500).json({ error: error.message })
  }
}
