import { VercelRequest, VercelResponse } from '@vercel/node'
import * as admin from 'firebase-admin'
import { verifyLineToken } from '../lib/verifyLineToken'
import 'dotenv/config'

const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  })
}
const db = admin.firestore()

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(204).end()

  // POST /api/reservations — 新規予約
  if (req.method === 'POST') {
    try {
      const userId = await verifyLineToken(req.headers.authorization)
      const { bandName, date } = req.body as { bandName: string; date: string }
      if (!bandName || !date) return res.status(400).json({ error: 'bandName と date は必須です' })

      // 抽選時間中（20:50〜21:00）は今日・翌日の登録不可（明後日以降は可能）
      const nowJST = new Date(Date.now() + 9 * 60 * 60 * 1000)
      const h = nowJST.getUTCHours()
      const mi = nowJST.getUTCMinutes()
      const inLotteryWindow = h === 20 && mi >= 50
      if (inLotteryWindow) {
        const todayStr = nowJST.toISOString().slice(0, 10)
        const tomorrowJST = new Date(nowJST)
        tomorrowJST.setUTCDate(nowJST.getUTCDate() + 1)
        const tomorrowStr = tomorrowJST.toISOString().slice(0, 10)
        const dateStr = date.split('T')[0]
        if (dateStr === todayStr || dateStr === tomorrowStr) {
          return res.status(400).json({ error: '抽選時間中のため本日・翌日の登録はできません' })
        }
      }

      await db.collection('reservations').add({
        userId,
        bandName,
        date,
        status: 'pending',
        createdAt: new Date(),
      })
      return res.status(201).json({ success: true })
    } catch (err: any) {
      const status = err.message === 'Unauthorized' ? 401 : 500
      return res.status(status).json({ error: err.message })
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' })
}
