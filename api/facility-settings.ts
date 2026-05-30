import { VercelRequest, VercelResponse } from '@vercel/node'
import * as admin from 'firebase-admin'
import { resolveFacilitySettingsForDate, todayJST } from '../lib/reservationSettings'
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

const SETTINGS_DOC: Record<string, string> = {
  kobu:        'kobu',
  'nobu-room': 'nobu-room',
}

const DEFAULTS = {
  availableDays:  [0, 1, 2, 3, 4, 5, 6] as number[],
  extraDates:     [] as string[],
  excludedDates:  [] as string[],
  timeSlots:      [{ label: '8:00~20:00', value: '08:00-20:00' }],
  perDaySchedule: { enabled: false, byWeekday: {} as Record<string, any[]>, byDate: {} as Record<string, any[]> },
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' })

  const f = req.query.facility as string
  const date = (req.query.date as string | undefined) ?? todayJST()
  const docId = SETTINGS_DOC[f]
  if (!docId) return res.status(400).json({ error: 'Invalid facility' })

  try {
    // バージョン管理に対応: 指定日時点で有効なバージョンを解決する
    const baseDoc = await db.collection('settings').doc(docId).get()
    const baseData = baseDoc.exists ? baseDoc.data()! : {}

    let baseTimeSlots = baseData.timeSlots
    if (!baseTimeSlots && (baseData.openTime || baseData.closeTime)) {
      const open  = baseData.openTime  ?? '08:00'
      const close = baseData.closeTime ?? '20:00'
      baseTimeSlots = [{ label: `${open}〜${close}`, value: `${open}-${close}` }]
    }

    const baseDefaults = {
      availableDays:  baseData.availableDays  ?? DEFAULTS.availableDays,
      extraDates:     baseData.extraDates     ?? DEFAULTS.extraDates,
      excludedDates:  baseData.excludedDates  ?? DEFAULTS.excludedDates,
      timeSlots:      (baseTimeSlots ?? DEFAULTS.timeSlots).filter((s: any) => !s.deleted),
      perDaySchedule: baseData.perDaySchedule ?? DEFAULTS.perDaySchedule,
    }

    const resolved = await resolveFacilitySettingsForDate(db, docId, date, baseDefaults)

    return res.status(200).json({
      availableDays:  resolved.availableDays,
      extraDates:     resolved.extraDates,
      excludedDates:  resolved.excludedDates,
      timeSlots:      resolved.timeSlots.filter((s: any) => !s.deleted),
      perDaySchedule: resolved.perDaySchedule,
      timePresets:    baseData.timePresets ?? [],
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
