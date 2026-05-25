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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(204).end()

  const path = (req.query._path as string) ?? ''

  // /api/reservations/sync - LIFF 起動時にユーザー情報を同期
  if (path === 'sync') return handleSync(req, res)
  // /api/reservations/my
  if (path === 'my')  return handleMy(req, res)
  // /api/reservations/all
  if (path === 'all') return handleAll(req, res)
  // /api/reservations/{id}
  if (path)            return handleById(req, res, path)
  // /api/reservations
  return handleCreate(req, res)
}

// ─── ユーザー情報の同期 ───────────────────────────────
async function handleSync(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })
  try {
    const { userId, name, picture } = await verifyLineToken(req.headers.authorization)
    const userRef = db.collection('users').doc(userId)
    const userDoc = await userRef.get()
    const update: Record<string, any> = {}
    if (name)    update.displayName = name
    if (picture) update.pictureUrl  = picture
    if (!userDoc.exists) update.banned = false
    if (Object.keys(update).length > 0) {
      await userRef.set(update, { merge: true })
    }
    return res.status(200).json({ success: true })
  } catch (err: any) {
    const status = err.message === 'Unauthorized' ? 401 : 500
    return res.status(status).json({ error: err.message })
  }
}

// ─── 新規予約 ─────────────────────────────────────────
async function handleCreate(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })
  try {
    const { userId, name, picture } = await verifyLineToken(req.headers.authorization)
    const { bandName, date } = req.body as { bandName: string; date: string }
    if (!bandName || !date) return res.status(400).json({ error: 'bandName と date は必須です' })

    // 設定とBANチェックを並列取得
    const [userDoc, settingsDoc] = await Promise.all([
      db.collection('users').doc(userId).get(),
      db.collection('settings').doc('reservation').get(),
    ])
    const userRef = db.collection('users').doc(userId)
    if (userDoc.exists && userDoc.data()?.banned === true) {
      return res.status(403).json({ error: '予約機能の利用が停止されています' })
    }

    // 同日に同名バンドが既に登録されていないかチェック
    const trimmedBandName = bandName.trim()
    const dateOnly = date.split('T')[0]
    const dupSnap = await db.collection('reservations')
      .where('bandName', '==', trimmedBandName)
      .where('date', '>=', `${dateOnly}T00:00`)
      .where('date', '<=', `${dateOnly}T23:59`)
      .get()
    if (!dupSnap.empty) {
      return res.status(400).json({
        error: `${dateOnly} には「${trimmedBandName}」が既に登録されています（時間枠が違っても同名のバンドは1日1回まで）`,
      })
    }

    // 抽選10分前〜抽選時刻の間は当日・翌日の登録不可
    const lotteryTime = (settingsDoc.exists ? settingsDoc.data()?.lotteryTime : null) ?? '21:00'
    const [lh, lm] = lotteryTime.split(':').map(Number)
    const lotteryMinutes = lh * 60 + lm
    const nowJST = new Date(Date.now() + 9 * 60 * 60 * 1000)
    const nowMinutes = nowJST.getUTCHours() * 60 + nowJST.getUTCMinutes()
    const inLotteryWindow = nowMinutes >= lotteryMinutes - 10 && nowMinutes < lotteryMinutes
    if (inLotteryWindow) {
      const lockoutHH = String(Math.floor((lotteryMinutes - 10) / 60)).padStart(2, '0')
      const lockoutMM = String((lotteryMinutes - 10) % 60).padStart(2, '0')
      const todayStr = nowJST.toISOString().slice(0, 10)
      const tomorrowJST = new Date(nowJST)
      tomorrowJST.setUTCDate(nowJST.getUTCDate() + 1)
      const tomorrowStr = tomorrowJST.toISOString().slice(0, 10)
      const dateStr = date.split('T')[0]
      if (dateStr === todayStr || dateStr === tomorrowStr) {
        return res.status(400).json({ error: `抽選集計中（${lockoutHH}:${lockoutMM}〜${lotteryTime}）のため本日・翌日の登録はできません` })
      }
    }

    // ユーザー情報を更新（lastReservedAt とトークン由来の最新プロフィール）
    const userUpdate: Record<string, any> = { lastReservedAt: new Date() }
    if (name)    userUpdate.displayName = name
    if (picture) userUpdate.pictureUrl  = picture
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
    const { userId } = await verifyLineToken(req.headers.authorization)
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

    const slotMap: Record<string, { id: string; userId: string; bandName: string; status: string; order?: number }[]> = {}
    snapshot.forEach((doc) => {
      const data = doc.data()
      const ts = data.date.split('T')[1]
      if (!slotMap[ts]) slotMap[ts] = []
      slotMap[ts].push({
        id:       doc.id,
        userId:   data.userId,
        bandName: data.bandName ?? '(バンド名なし)',
        status:   data.status,
        order:    data.order,
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

// ─── 予約の削除または変更のディスパッチ ─────────────
async function handleById(req: VercelRequest, res: VercelResponse, docId: string) {
  if (req.method === 'DELETE') return handleDelete(req, res, docId)
  if (req.method === 'PATCH')  return handleModify(req, res, docId)
  return res.status(405).json({ error: 'Method Not Allowed' })
}

// ─── 予約の削除 ─────────────────────────────────────
async function handleDelete(req: VercelRequest, res: VercelResponse, docId: string) {
  try {
    const { userId } = await verifyLineToken(req.headers.authorization)
    const docRef = db.collection('reservations').doc(docId)
    const doc = await docRef.get()
    if (!doc.exists) return res.status(404).json({ error: '予約が見つかりません' })
    const data = doc.data()!
    if (data.userId !== userId) return res.status(403).json({ error: '権限がありません' })
    if (data.status === 'confirmed') return res.status(400).json({ error: '抽選確定済みは削除できません' })
    const [datePart, timePart] = (data.date as string).split('T')
    const startTime = timePart?.split('-')[0] ?? '00:00'
    if (Date.now() >= new Date(`${datePart}T${startTime}:00+09:00`).getTime()) {
      return res.status(400).json({ error: '予約開始時刻を過ぎているため削除できません' })
    }
    await docRef.delete()
    return res.status(200).json({ success: true })
  } catch (err: any) {
    const status = err.message === 'Unauthorized' ? 401 : 500
    return res.status(status).json({ error: err.message })
  }
}

// ─── 予約の変更（バンド名・時間枠） ──────────────────
async function handleModify(req: VercelRequest, res: VercelResponse, docId: string) {
  try {
    const { userId } = await verifyLineToken(req.headers.authorization)
    const { bandName: newBandName, timeSlot: newTimeSlot } = (req.body ?? {}) as {
      bandName?: string; timeSlot?: string
    }

    const docRef = db.collection('reservations').doc(docId)
    const doc    = await docRef.get()
    if (!doc.exists) return res.status(404).json({ error: '予約が見つかりません' })
    const data = doc.data()!
    if (data.userId !== userId) return res.status(403).json({ error: '権限がありません' })

    const dateOnly = (data.date as string).split('T')[0]
    const startTime = (data.date as string).split('T')[1]?.split('-')[0] ?? '00:00'
    if (Date.now() >= new Date(`${dateOnly}T${startTime}:00+09:00`).getTime()) {
      return res.status(400).json({ error: '予約開始時刻を過ぎているため変更できません' })
    }
    const updates: Record<string, any> = {}

    // バンド名変更
    if (newBandName !== undefined) {
      const trimmed = newBandName.trim()
      if (!trimmed) return res.status(400).json({ error: 'バンド名は空にできません' })
      if (trimmed !== data.bandName) {
        const dupSnap = await db.collection('reservations')
          .where('bandName', '==', trimmed)
          .where('date', '>=', `${dateOnly}T00:00`)
          .where('date', '<=', `${dateOnly}T23:59`)
          .get()
        if (!dupSnap.empty && dupSnap.docs.some((d) => d.id !== docId)) {
          return res.status(400).json({ error: `${dateOnly} には「${trimmed}」が既に登録されています` })
        }
        updates.bandName = trimmed
      }
    }

    // 時間枠変更（抽選待ちのみ）
    if (newTimeSlot !== undefined) {
      if (data.status === 'confirmed') {
        return res.status(400).json({ error: '抽選確定済みの予約は時間枠を変更できません' })
      }
      const newDate = `${dateOnly}T${newTimeSlot}`
      if (newDate !== data.date) updates.date = newDate
    }

    if (Object.keys(updates).length === 0) return res.status(200).json({ success: true })
    updates.updatedAt = new Date()
    await docRef.update(updates)
    return res.status(200).json({ success: true })
  } catch (err: any) {
    const status = err.message === 'Unauthorized' ? 401 : 500
    return res.status(status).json({ error: err.message })
  }
}
