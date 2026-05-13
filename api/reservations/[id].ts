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
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method Not Allowed' })

  try {
    const userId = await verifyLineToken(req.headers.authorization)
    const docId = req.query.id as string

    const docRef = db.collection('reservations').doc(docId)
    const doc = await docRef.get()
    if (!doc.exists) return res.status(404).json({ error: '予約が見つかりません' })
    if (doc.data()!.userId !== userId) return res.status(403).json({ error: '権限がありません' })
    if (doc.data()!.status === 'confirmed') return res.status(400).json({ error: '抽選確定済みは削除できません' })

    await docRef.delete()
    return res.status(200).json({ success: true })
  } catch (err: any) {
    const status = err.message === 'Unauthorized' ? 401 : 500
    return res.status(status).json({ error: err.message })
  }
}
