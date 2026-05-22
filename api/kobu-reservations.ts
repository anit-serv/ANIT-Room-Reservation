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

const OPEN_TIME  = '08:00'
const CLOSE_TIME = '20:00'

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function isValidTime(t: string): boolean {
  return /^\d{2}:\d{2}$/.test(t) && !isNaN(timeToMinutes(t))
}

function isMultipleOf15(t: string): boolean {
  return timeToMinutes(t) % 15 === 0
}

function timesOverlap(s1: string, e1: string, s2: string, e2: string): boolean {
  return timeToMinutes(s1) < timeToMinutes(e2) && timeToMinutes(s2) < timeToMinutes(e1)
}

function nowJST(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(204).end()

  const path = (req.query._path as string) ?? ''

  if (path === 'my')  return handleMy(req, res)
  if (path === 'all') return handleAll(req, res)
  if (path)           return handleById(req, res, path)
  return handleCreate(req, res)
}

// ─── 新規予約（即時確定） ──────────────────────────────
async function handleCreate(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })
  try {
    const { userId, name, picture } = await verifyLineToken(req.headers.authorization)
    const { bandName, date, startTime, endTime } = req.body as {
      bandName: string; date: string; startTime: string; endTime: string
    }

    if (!bandName?.trim() || !date || !startTime || !endTime) {
      return res.status(400).json({ error: 'bandName, date, startTime, endTime は必須です' })
    }
    if (!isValidTime(startTime) || !isValidTime(endTime)) {
      return res.status(400).json({ error: '時刻の形式が不正です（HH:MM）' })
    }
    if (!isMultipleOf15(startTime) || !isMultipleOf15(endTime)) {
      return res.status(400).json({ error: '時刻は15分単位で指定してください' })
    }
    if (timeToMinutes(startTime) >= timeToMinutes(endTime)) {
      return res.status(400).json({ error: '開始時刻は終了時刻より前にしてください' })
    }
    if (startTime < OPEN_TIME || endTime > CLOSE_TIME) {
      return res.status(400).json({ error: `予約可能時間は${OPEN_TIME}〜${CLOSE_TIME}です` })
    }

    const today = nowJST().toISOString().slice(0, 10)
    const maxDate = new Date(nowJST())
    maxDate.setFullYear(maxDate.getFullYear() + 1)
    const maxDateStr = maxDate.toISOString().slice(0, 10)
    if (date < today || date > maxDateStr) {
      return res.status(400).json({ error: '予約可能期間外です' })
    }

    const [userDoc, settingsDoc] = await Promise.all([
      db.collection('users').doc(userId).get(),
      db.collection('settings').doc('kobu').get(),
    ])
    if (userDoc.exists && userDoc.data()?.banned === true) {
      return res.status(403).json({ error: '予約機能の利用が停止されています' })
    }

    const settings = settingsDoc.data() ?? {}
    const availableDays: number[]  = settings.availableDays ?? [0, 1, 2, 3, 4, 5, 6]
    const extraDates: string[]     = settings.extraDates    ?? []
    const excludedDates: string[]  = settings.excludedDates ?? []
    const dateObj   = new Date(date + 'T00:00:00Z')
    const dayOfWeek = dateObj.getUTCDay()
    const isAvailable = (availableDays.includes(dayOfWeek) || extraDates.includes(date)) && !excludedDates.includes(date)
    if (!isAvailable) {
      return res.status(400).json({ error: 'この日は工部室を予約できません' })
    }

    const existingSnap = await db.collection('kobu_reservations').where('date', '==', date).get()
    for (const doc of existingSnap.docs) {
      const d = doc.data()
      if (timesOverlap(startTime, endTime, d.startTime, d.endTime)) {
        return res.status(400).json({
          error: `${d.startTime}〜${d.endTime} に既に予約が入っています`,
        })
      }
    }

    const userRef = db.collection('users').doc(userId)
    const userUpdate: Record<string, any> = { lastReservedAt: new Date() }
    if (name)    userUpdate.displayName = name
    if (picture) userUpdate.pictureUrl  = picture
    if (!userDoc.exists) userUpdate.banned = false
    await userRef.set(userUpdate, { merge: true })

    await db.collection('kobu_reservations').add({
      userId,
      bandName: bandName.trim(),
      date,
      startTime,
      endTime,
      status: 'confirmed',
      createdAt: new Date(),
    })
    return res.status(201).json({ success: true })
  } catch (err: any) {
    const status = err.message === 'Unauthorized' ? 401 : 500
    return res.status(status).json({ error: err.message })
  }
}

// ─── 自分の予約一覧 ──────────────────────────────────
async function handleMy(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' })
  try {
    const { userId } = await verifyLineToken(req.headers.authorization)
    const today = nowJST().toISOString().slice(0, 10)
    const snap  = await db.collection('kobu_reservations').where('userId', '==', userId).get()
    const reservations = snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as any))
      .filter((r) => r.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
      .map((r) => ({
        id: r.id,
        bandName:  r.bandName,
        date:      r.date,
        startTime: r.startTime,
        endTime:   r.endTime,
        status:    r.status,
      }))
    return res.status(200).json({ reservations })
  } catch (err: any) {
    const status = err.message === 'Unauthorized' ? 401 : 500
    return res.status(status).json({ error: err.message })
  }
}

// ─── 週単位の全予約（スケジュールUI用） ─────────────────
async function handleAll(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' })
  const { weekStart } = req.query as { weekStart?: string }
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return res.status(400).json({ error: 'weekStart (YYYY-MM-DD) は必須です' })
  }

  const end = new Date(weekStart + 'T00:00:00Z')
  end.setDate(end.getDate() + 6)
  const weekEnd = end.toISOString().slice(0, 10)

  try {
    const snap = await db.collection('kobu_reservations')
      .where('date', '>=', weekStart)
      .where('date', '<=', weekEnd)
      .get()

    const dayMap: Record<string, { bandName: string; startTime: string; endTime: string }[]> = {}
    snap.forEach((doc) => {
      const d = doc.data()
      if (!dayMap[d.date]) dayMap[d.date] = []
      dayMap[d.date].push({ bandName: d.bandName, startTime: d.startTime, endTime: d.endTime })
    })
    for (const day of Object.values(dayMap)) {
      day.sort((a, b) => a.startTime.localeCompare(b.startTime))
    }
    return res.status(200).json({ dayMap, weekStart, weekEnd })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

// ─── 予約キャンセル（ユーザー自身・確定後も可） ─────────
async function handleById(req: VercelRequest, res: VercelResponse, docId: string) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method Not Allowed' })
  try {
    const { userId } = await verifyLineToken(req.headers.authorization)
    const docRef = db.collection('kobu_reservations').doc(docId)
    const doc    = await docRef.get()
    if (!doc.exists) return res.status(404).json({ error: '予約が見つかりません' })
    if (doc.data()!.userId !== userId) return res.status(403).json({ error: '権限がありません' })
    await docRef.delete()
    return res.status(200).json({ success: true })
  } catch (err: any) {
    const status = err.message === 'Unauthorized' ? 401 : 500
    return res.status(status).json({ error: err.message })
  }
}
