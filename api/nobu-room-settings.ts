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

const DEFAULTS = {
  availableDays:  [0, 1, 2, 3, 4, 5, 6] as number[],
  extraDates:     [] as string[],
  excludedDates:  [] as string[],
  timeSlots:      [{ label: '8:00~20:00', value: '08:00-20:00' }],
  perDaySchedule: { enabled: false, byWeekday: {} as Record<string, any[]>, byDate: {} as Record<string, any[]> },
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (_req.method === 'OPTIONS') return res.status(204).end()
  if (_req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' })

  try {
    const doc  = await db.collection('settings').doc('nobu-room').get()
    const data = doc.exists ? doc.data()! : {}

    let timeSlots = data.timeSlots
    if (!timeSlots && (data.openTime || data.closeTime)) {
      const open  = data.openTime  ?? '08:00'
      const close = data.closeTime ?? '20:00'
      timeSlots = [{ label: `${open}〜${close}`, value: `${open}-${close}` }]
    }

    return res.status(200).json({
      availableDays:  data.availableDays  ?? DEFAULTS.availableDays,
      extraDates:     data.extraDates     ?? DEFAULTS.extraDates,
      excludedDates:  data.excludedDates  ?? DEFAULTS.excludedDates,
      timeSlots:      (timeSlots ?? DEFAULTS.timeSlots).filter((s: any) => !s.deleted),
      perDaySchedule: data.perDaySchedule ?? DEFAULTS.perDaySchedule,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
