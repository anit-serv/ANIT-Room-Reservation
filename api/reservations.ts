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

  const path = (req.query._path as string) ?? ''

  // /api/reservations/my
  if (path === 'my')  return handleMy(req, res)
  // /api/reservations/all
  if (path === 'all') return handleAll(req, res)
  // /api/reservations/{id}
  if (path)            return handleById(req, res, path)
  // /api/reservations
  return handleCreate(req, res)
}

// ─── 新規予約 ─────────────────────────────────────────
async function handleCreate(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })
  try {
    const userId = await verifyLineToken(req.headers.authorization)
    const { bandName, date, displayName, pictureUrl } = req.body as {
      bandName: string; date: string; displayName?: string; pictureUrl?: string
    }
    if (!bandName || !date) return res.status(400).json({ error: 'bandName と date は必須です' })

    // BAN チェック
    const userRef = db.collection('users').doc(userId)
    const userDoc = await userRef.get()
    if (userDoc.exists && userDoc.data()?.banned === true) {
      return res.status(403).json({ error: '予約機能の利用が停止されています' })
    }

    // 抽選時間中（20:50〜21:00）は今日・翌日の登録不可
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

    // ユーザー情報を保存/更新
    const userUpdate: Record<string, any> = { lastReservedAt: new Date() }
    if (displayName) userUpdate.displayName = displayName
    if (pictureUrl)  userUpdate.pictureUrl  = pictureUrl
    if (!userDoc.exists) userUpdate.banned = false
    await userRef.set(userUpdate, { merge: true })

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

// ─── 自分の予約一覧 ─────────────────────────────────
async function handleMy(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' })
  try {
    const userId = await verifyLineToken(req.headers.authorization)
    const nowJST = new Date(Date.now() + 9 * 60 * 60 * 1000)
    const todayStr = nowJST.toISOString().slice(0, 10)
    const snapshot = await db.collection('reservations').where('userId', '==', userId).get()
    const reservations = snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() } as any))
      .filter((r) => (r.date ?? '').split('T')[0] >= todayStr)
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
      .map((r) => ({ id: r.id, bandName: r.bandName, date: r.date, status: r.status }))
    return res.status(200).json({ reservations })
  } catch (err: any) {
    const status = err.message === 'Unauthorized' ? 401 : 500
    return res.status(status).json({ error: err.message })
  }
}

// ─── 指定日の全予約 ─────────────────────────────────
async function handleAll(req: VercelRequest, res: VercelResponse) {
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
      const ts = data.date.split('T')[1]
      if (!slotMap[ts]) slotMap[ts] = []
      slotMap[ts].push({
        bandName: data.bandName ?? '(バンド名なし)',
        status: data.status,
        order: data.order,
      })
    })

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

// ─── 予約の削除 ─────────────────────────────────────
async function handleById(req: VercelRequest, res: VercelResponse, docId: string) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method Not Allowed' })
  try {
    const userId = await verifyLineToken(req.headers.authorization)
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
