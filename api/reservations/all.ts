import { VercelRequest, VercelResponse } from '@vercel/node'
import * as admin from 'firebase-admin'
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
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' })

  const date = req.query.date as string
  if (!date) return res.status(400).json({ error: 'date は必須です' })

  try {
    const snapshot = await db.collection('reservations')
      .where('date', '>=', `${date}T00:00`)
      .where('date', '<=', `${date}T23:59`)
      .get()

    const slotMap: Record<string, { bandName: string; status: string; order?: number }[]> = {}

    snapshot.forEach((doc) => {
      const data = doc.data()
      const timeSlot = data.date.split('T')[1]
      if (!slotMap[timeSlot]) slotMap[timeSlot] = []
      slotMap[timeSlot].push({
        bandName: data.bandName ?? '(バンド名なし)',
        status: data.status,
        order: data.order,
      })
    })

    // 抽選済みはorder順、未抽選はcreatedAt順
    for (const ts of Object.keys(slotMap)) {
      const entries = slotMap[ts]
      const allConfirmed = entries.every((e) => e.status === 'confirmed')
      if (allConfirmed && entries.some((e) => e.order !== undefined)) {
        slotMap[ts] = entries.sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
      }
    }

    return res.status(200).json({ slotMap })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
