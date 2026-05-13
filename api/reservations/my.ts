import { VercelRequest, VercelResponse } from '@vercel/node'
import * as admin from 'firebase-admin'
import { verifyLineToken } from '../../lib/verifyLineToken'
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
  res.setHeader('Access-Control-Allow-Headers', 'Authorization')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' })

  try {
    const userId = await verifyLineToken(req.headers.authorization)

    const now = new Date()
    const jstOffset = 9 * 60 * 60 * 1000
    const nowJST = new Date(now.getTime() + jstOffset)
    const todayStr = nowJST.toISOString().slice(0, 10)

    const snapshot = await db.collection('reservations').where('userId', '==', userId).get()

    const reservations = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() } as any))
      .filter((r) => (r.date ?? '').split('T')[0] >= todayStr)
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
      .map((r) => ({
        id: r.id,
        bandName: r.bandName,
        date: r.date,
        status: r.status,
      }))

    return res.status(200).json({ reservations })
  } catch (err: any) {
    const status = err.message === 'Unauthorized' ? 401 : 500
    return res.status(status).json({ error: err.message })
  }
}
