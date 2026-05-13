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

const DEFAULT_TIME_SLOTS = [
  { label: '9:00~10:00', value: '09:00-10:00' },
  { label: '10:00~12:00', value: '10:00-12:00' },
  { label: '12:00~14:00', value: '12:00-14:00' },
  { label: '14:00~16:00', value: '14:00-16:00' },
  { label: '16:00~18:00', value: '16:00-18:00' },
  { label: '18:00~20:00', value: '18:00-20:00' },
]
const DEFAULT_AVAILABLE_DAYS = [3, 4, 6]
const WEEK_DAYS = ['日', '月', '火', '水', '木', '金', '土']

function buildDateList(availableDays: number[], includeToday: boolean): { label: string; value: string }[] {
  const now = new Date()
  const jstOffset = 9 * 60 * 60 * 1000
  const nowJST = new Date(now.getTime() + jstOffset)
  const currentHour = nowJST.getUTCHours()

  let daysToAdd: number
  if (includeToday) {
    const todayIdx = nowJST.getUTCDay()
    if (currentHour >= 21) {
      const tomorrow = new Date(nowJST)
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
      daysToAdd = availableDays.includes(tomorrow.getUTCDay()) ? 1 : 2
    } else {
      daysToAdd = availableDays.includes(todayIdx) ? 0 : 1
    }
  } else {
    daysToAdd = currentHour >= 21 ? 2 : 1
  }

  const start = new Date(nowJST)
  start.setUTCDate(start.getUTCDate() + daysToAdd)
  start.setUTCHours(0, 0, 0, 0)

  const results: { label: string; value: string }[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(start)
    d.setUTCDate(start.getUTCDate() + i)
    if (!availableDays.includes(d.getUTCDay())) continue
    const m = d.getUTCMonth() + 1
    const day = d.getUTCDate()
    const wd = WEEK_DAYS[d.getUTCDay()]
    const yyyy = d.getUTCFullYear()
    const mm = ('0' + m).slice(-2)
    const dd = ('0' + day).slice(-2)
    results.push({ label: `${m}/${day}(${wd})`, value: `${yyyy}-${mm}-${dd}` })
  }
  return results
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  try {
    const doc = await db.collection('settings').doc('reservation').get()
    const data = doc.exists ? doc.data()! : {}
    const availableDays: number[] = data.availableDays ?? DEFAULT_AVAILABLE_DAYS
    const timeSlots = data.timeSlots ?? DEFAULT_TIME_SLOTS

    return res.status(200).json({
      availableDates: buildDateList(availableDays, false),
      availableDatesWithToday: buildDateList(availableDays, true),
      timeSlots,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
