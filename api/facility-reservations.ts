import { VercelRequest, VercelResponse } from '@vercel/node'
import * as admin from 'firebase-admin'
import { verifyLineToken } from '../lib/verifyLineToken'
import { resolveFacilitySettingsForDate } from '../lib/reservationSettings'
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

const FACILITY_CONFIG = {
  kobu:       { collection: 'kobu_reservations',      settingsDoc: 'kobu',      label: '工部室', favoriteTimeField: 'kobuTimeSlot' },
  'nobu-room': { collection: 'nobu_room_reservations', settingsDoc: 'nobu-room', label: '農部室', favoriteTimeField: 'nobuRoomTimeSlot' },
} as const
type FacilityKey = keyof typeof FACILITY_CONFIG

function getConfig(req: VercelRequest) {
  const f = req.query.facility as string
  if (f !== 'kobu' && f !== 'nobu-room') throw Object.assign(new Error('Invalid facility'), { status: 400 })
  return FACILITY_CONFIG[f as FacilityKey]
}

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(204).end()

  const path = (req.query._path as string) ?? ''
  if (path === 'favorites')             return handleFavorites(req, res)
  if (path.startsWith('favorites/'))    return handleFavoriteById(req, res, path.slice('favorites/'.length))
  if (path === 'my')  return handleMy(req, res)
  if (path === 'all') return handleAll(req, res)
  if (path)           return handleById(req, res, path)
  return handleCreate(req, res)
}

// ─── 新規予約（即時確定） ──────────────────────────────
async function handleCreate(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })
  try {
    const cfg = getConfig(req)
    const { userId, name, picture } = await verifyLineToken(req.headers.authorization)
    const { bandName, date, startTime, endTime, favoriteId } = req.body as {
      bandName: string; date: string; startTime: string; endTime: string; favoriteId?: string
    }

    if (!bandName?.trim() || !date || !startTime || !endTime)
      return res.status(400).json({ error: 'bandName, date, startTime, endTime は必須です' })
    if (!isValidTime(startTime) || !isValidTime(endTime))
      return res.status(400).json({ error: '時刻の形式が不正です（HH:MM）' })
    if (!isMultipleOf15(startTime) || !isMultipleOf15(endTime))
      return res.status(400).json({ error: '時刻は15分単位で指定してください' })
    if (timeToMinutes(startTime) >= timeToMinutes(endTime))
      return res.status(400).json({ error: '開始時刻は終了時刻より前にしてください' })

    const maxDate = new Date(nowJST())
    maxDate.setFullYear(maxDate.getFullYear() + 1)
    if (date > maxDate.toISOString().slice(0, 10))
      return res.status(400).json({ error: '予約可能期間外です' })
    if (Date.now() >= new Date(`${date}T${startTime}:00+09:00`).getTime())
      return res.status(400).json({ error: '予約開始時刻を過ぎているため登録できません' })

    const settingsDocRef = db.collection('settings').doc(cfg.settingsDoc)
    const [userDoc, settingsDoc] = await Promise.all([
      db.collection('users').doc(userId).get(),
      settingsDocRef.get(),
    ])
    if (userDoc.exists && userDoc.data()?.banned === true)
      return res.status(403).json({ error: '予約機能の利用が停止されています' })

    const baseData = settingsDoc.data() ?? {}
    let baseTimeSlots = baseData.timeSlots ?? []
    if (!baseTimeSlots.length && (baseData.openTime || baseData.closeTime))
      baseTimeSlots = [{ label: '', value: `${baseData.openTime ?? '08:00'}-${baseData.closeTime ?? '20:00'}` }]
    if (!baseTimeSlots.length) baseTimeSlots = [{ label: '', value: '08:00-20:00' }]

    const baseDefaults = {
      availableDays:  baseData.availableDays  ?? [0, 1, 2, 3, 4, 5, 6],
      extraDates:     baseData.extraDates     ?? [],
      excludedDates:  baseData.excludedDates  ?? [],
      timeSlots:      baseTimeSlots.filter((s: any) => !s.deleted),
      perDaySchedule: baseData.perDaySchedule ?? { enabled: false, byWeekday: {}, byDate: {} },
    }
    const settings = await resolveFacilitySettingsForDate(db, cfg.settingsDoc, date, baseDefaults)

    const availableDays: number[] = settings.availableDays
    const extraDates: string[]    = settings.extraDates
    const excludedDates: string[] = settings.excludedDates
    const dateObj   = new Date(date + 'T00:00:00Z')
    const dayOfWeek = dateObj.getUTCDay()
    // 施設（工部室・農部室）には dayOverride が存在しないため、標準の曜日・追加日・除外日のみチェック
    const isAvailable = (availableDays.includes(dayOfWeek) || extraDates.includes(date)) && !excludedDates.includes(date)
    if (!isAvailable)
      return res.status(400).json({ error: `この日は${cfg.label}を予約できません` })

    let timeSlots: { label: string; value: string }[] = settings.timeSlots
    const perDay = settings.perDaySchedule
    if (perDay?.enabled) {
      const byDate = perDay.byDate?.[date]
      if (byDate?.length) timeSlots = byDate
      else {
        const byWd = perDay.byWeekday?.[String(dayOfWeek)]
        if (byWd?.length) timeSlots = byWd
      }
    }
    const startMin = timeToMinutes(startTime)
    const endMin   = timeToMinutes(endTime)
    const fitsInSlot = timeSlots.some(s => {
      const [a, b] = s.value.split('-')
      return startMin >= timeToMinutes(a) && endMin <= timeToMinutes(b)
    })
    if (!fitsInSlot) {
      const slotStr = timeSlots.map(s => s.value.replace('-', '〜')).join(' / ')
      return res.status(400).json({ error: `予約可能時間は ${slotStr} です` })
    }

    const userRef = db.collection('users').doc(userId)
    const userUpdate: Record<string, any> = { lastReservedAt: new Date() }
    if (name)    userUpdate.displayName = name
    if (picture) userUpdate.pictureUrl  = picture
    if (!userDoc.exists) userUpdate.banned = false
    await userRef.set(userUpdate, { merge: true })

    // 重複チェックと予約書き込みをトランザクションで原子的に実行（二重予約防止）
    const newDocRef = db.collection(cfg.collection).doc()
    await db.runTransaction(async (tx) => {
      const existingSnap = await tx.get(
        db.collection(cfg.collection).where('date', '==', date)
      )
      for (const doc of existingSnap.docs) {
        const d = doc.data()
        if (d.status === 'cancelled') continue
        if (timesOverlap(startTime, endTime, d.startTime, d.endTime))
          throw Object.assign(
            new Error(`${d.startTime}〜${d.endTime} に既に予約が入っています`),
            { status: 400 }
          )
      }
      tx.set(newDocRef, {
        userId,
        bandName: bandName.trim(),
        date, startTime, endTime,
        status: 'confirmed',
        favoriteId: favoriteId ?? null,
        createdAt: new Date(),
      })
    })
    if (favoriteId) {
      const favoriteRef = db.collection('favorites').doc(favoriteId)
      const favoriteDoc = await favoriteRef.get().catch(() => null)
      if (favoriteDoc?.exists && favoriteDoc.data()?.userId === userId) {
        await favoriteRef.update({ [cfg.favoriteTimeField]: `${startTime}-${endTime}` }).catch(() => {})
      }
    }
    return res.status(201).json({ success: true })
  } catch (err: any) {
    const status = err.message === 'Unauthorized' ? 401 : (err.status ?? 500)
    return res.status(status).json({ error: err.message })
  }
}

// ─── 自分の予約一覧 ──────────────────────────────────
async function handleMy(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' })
  try {
    const cfg = getConfig(req)
    const { userId } = await verifyLineToken(req.headers.authorization)
    const today = nowJST().toISOString().slice(0, 10)
    const snap  = await db.collection(cfg.collection).where('userId', '==', userId).get()
    const reservations = snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as any))
      .filter((r) => r.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
      .map((r) => ({
        id: r.id,
        bandName: r.bandName,
        date: r.date,
        startTime: r.startTime,
        endTime: r.endTime,
        status: r.status,
        cancelledAt: r.cancelledAt?.toMillis?.() ?? null,
        cancelledByType: r.cancelledByType ?? null,
      }))
    return res.status(200).json({ reservations })
  } catch (err: any) {
    const status = err.message === 'Unauthorized' ? 401 : (err.status ?? 500)
    return res.status(status).json({ error: err.message })
  }
}

// ─── 週単位の全予約（スケジュールUI用） ─────────────────
async function handleAll(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' })
  let requesterId: string
  try {
    requesterId = (await verifyLineToken(req.headers.authorization)).userId
  } catch {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const { weekStart } = req.query as { weekStart?: string }
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart))
    return res.status(400).json({ error: 'weekStart (YYYY-MM-DD) は必須です' })

  const end = new Date(weekStart + 'T00:00:00Z')
  end.setDate(end.getDate() + 6)
  const weekEnd = end.toISOString().slice(0, 10)

  try {
    const cfg  = getConfig(req)
    const snap = await db.collection(cfg.collection)
      .where('date', '>=', weekStart)
      .where('date', '<=', weekEnd)
      .get()

    const dayMap: Record<string, { id: string; userId: string; bandName: string; startTime: string; endTime: string }[]> = {}
    snap.forEach((doc) => {
      const d = doc.data()
      if (d.status === 'cancelled') return
      if (!dayMap[d.date]) dayMap[d.date] = []
      // 他人の userId は漏洩防止のため返さない。呼び出し元自身の予約だけ userId を含め、
      // フロント（KobuSchedule/NobuRoomSchedule）の isOwn 判定（編集・削除・次の週も予約）が成立するようにする。
      const own = d.userId === requesterId
      dayMap[d.date].push({ id: doc.id, userId: own ? d.userId : '', bandName: d.bandName, startTime: d.startTime, endTime: d.endTime })
    })
    for (const day of Object.values(dayMap)) day.sort((a, b) => a.startTime.localeCompare(b.startTime))
    return res.status(200).json({ dayMap, weekStart, weekEnd })
  } catch (err: any) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}

// ─── ヘルパー ─────────────────────────────────────────
type SlotRange = { start: string; end: string }

function getEffectiveSlots(date: string, settings: any): SlotRange[] {
  let slots: { label: string; value: string; deleted?: boolean }[] = settings.timeSlots ?? []
  slots = slots.filter((s) => !s.deleted)
  if (!slots.length && (settings.openTime || settings.closeTime))
    slots = [{ label: '', value: `${settings.openTime ?? '08:00'}-${settings.closeTime ?? '20:00'}` }]
  if (!slots.length) slots = [{ label: '', value: '08:00-20:00' }]

  const dow    = new Date(date + 'T00:00:00Z').getUTCDay()
  const perDay = settings.perDaySchedule
  if (perDay?.enabled) {
    const byDate = perDay.byDate?.[date]
    if (byDate?.length) slots = byDate
    else {
      const byWd = perDay.byWeekday?.[String(dow)]
      if (byWd?.length) slots = byWd
    }
  }
  return slots.map((s) => { const [start, end] = s.value.split('-'); return { start, end } })
}

function findSlotStart(time: string, slots: SlotRange[]): string | null {
  const t = timeToMinutes(time)
  const s = slots.find((sl) => timeToMinutes(sl.start) <= t && t < timeToMinutes(sl.end))
  return s ? s.start : null
}

function findSlotEnd(time: string, slots: SlotRange[]): string | null {
  const t = timeToMinutes(time)
  const s = slots.find((sl) => timeToMinutes(sl.start) < t && t <= timeToMinutes(sl.end))
  return s ? s.end : null
}

// ─── 予約キャンセルまたは変更のディスパッチ ──────────────
async function handleById(req: VercelRequest, res: VercelResponse, docId: string) {
  if (req.method === 'DELETE') return handleDelete(req, res, docId)
  if (req.method === 'PATCH')  return handleModify(req, res, docId)
  return res.status(405).json({ error: 'Method Not Allowed' })
}

async function handleDelete(req: VercelRequest, res: VercelResponse, docId: string) {
  try {
    const cfg = getConfig(req)
    const { userId, name, picture } = await verifyLineToken(req.headers.authorization)
    const docRef = db.collection(cfg.collection).doc(docId)
    const doc    = await docRef.get()
    if (!doc.exists) return res.status(404).json({ error: '予約が見つかりません' })
    const data = doc.data()!
    if (data.userId !== userId) return res.status(403).json({ error: '権限がありません' })
    if (data.status === 'cancelled') return res.status(200).json({ success: true })
    if (Date.now() >= new Date(`${data.date}T${data.startTime}:00+09:00`).getTime()) {
      return res.status(400).json({ error: '予約開始時刻を過ぎているためキャンセルできません' })
    }
    await docRef.update({
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelledByType: 'user',
      cancelledById: userId,
      updatedAt: new Date(),
    })
    const profileUpdate: Record<string, any> = {}
    if (name)    profileUpdate.displayName = name
    if (picture) profileUpdate.pictureUrl  = picture
    if (Object.keys(profileUpdate).length > 0)
      await db.collection('users').doc(userId).set(profileUpdate, { merge: true })
    return res.status(200).json({ success: true })
  } catch (err: any) {
    const status = err.message === 'Unauthorized' ? 401 : (err.status ?? 500)
    return res.status(status).json({ error: err.message })
  }
}

// ─── 予約時間変更（方向制約付き） ───────────────────────
async function handleModify(req: VercelRequest, res: VercelResponse, docId: string) {
  try {
    const cfg = getConfig(req)
    const { userId, name, picture } = await verifyLineToken(req.headers.authorization)
    const { newStart, newEnd, bandName: newBandName } = (req.body ?? {}) as {
      newStart?: string; newEnd?: string; bandName?: string
    }

    if (!newStart || !newEnd)
      return res.status(400).json({ error: 'newStart と newEnd は必須です' })
    if (!isValidTime(newStart) || !isValidTime(newEnd))
      return res.status(400).json({ error: '時刻の形式が不正です（HH:MM）' })
    if (!isMultipleOf15(newStart) || !isMultipleOf15(newEnd))
      return res.status(400).json({ error: '時刻は15分単位で指定してください' })
    if (timeToMinutes(newStart) >= timeToMinutes(newEnd))
      return res.status(400).json({ error: '開始時刻は終了時刻より前にしてください' })

    const docRef = db.collection(cfg.collection).doc(docId)
    const [doc, settingsDoc] = await Promise.all([
      docRef.get(),
      db.collection('settings').doc(cfg.settingsDoc).get(),
    ])
    if (!doc.exists) return res.status(404).json({ error: '予約が見つかりません' })
    const data = doc.data()!
    if (data.userId !== userId) return res.status(403).json({ error: '権限がありません' })
    if (data.status === 'cancelled') return res.status(400).json({ error: 'キャンセル済みの予約は変更できません' })

    if (Date.now() >= new Date(`${data.date}T${data.startTime}:00+09:00`).getTime()) {
      return res.status(400).json({ error: '予約開始時刻を過ぎているため変更できません' })
    }

    const updates: Record<string, any> = {}
    if (newBandName !== undefined) {
      const trimmed = newBandName.trim()
      if (!trimmed) return res.status(400).json({ error: 'バンド名は空にできません' })
      if (trimmed !== data.bandName) updates.bandName = trimmed
    }
    if (newStart === data.startTime && newEnd === data.endTime && Object.keys(updates).length === 0)
      return res.status(200).json({ success: true })

    const slots = getEffectiveSlots(data.date, settingsDoc.data() ?? {})

    if (timeToMinutes(newStart) < timeToMinutes(data.startTime)) {
      const slotStart = findSlotStart(data.startTime, slots)
      if (slotStart === null)
        return res.status(400).json({ error: '現在の開始時刻が営業時間外のため、開始時刻を早めることはできません' })
      if (timeToMinutes(newStart) < timeToMinutes(slotStart))
        return res.status(400).json({ error: `開始時刻は ${slotStart} より前にはできません` })
    }

    if (timeToMinutes(newEnd) > timeToMinutes(data.endTime)) {
      const slotEnd = findSlotEnd(data.endTime, slots)
      if (slotEnd === null)
        return res.status(400).json({ error: '現在の終了時刻が営業時間外のため、終了時刻を遅くすることはできません' })
      if (timeToMinutes(newEnd) > timeToMinutes(slotEnd))
        return res.status(400).json({ error: `終了時刻は ${slotEnd} より後にはできません` })
    }

    // 変更後の (start, end) が有効なスロット内に収まるか最終チェック
    const finalStart = (newStart !== data.startTime ? newStart : data.startTime) as string
    const finalEnd   = (newEnd   !== data.endTime   ? newEnd   : data.endTime)   as string
    const fitsInSlot = slots.some(
      s => timeToMinutes(finalStart) >= timeToMinutes(s.start)
        && timeToMinutes(finalEnd)   <= timeToMinutes(s.end)
    )
    if (!fitsInSlot) {
      const slotStr = slots.map(s => `${s.start}〜${s.end}`).join(' / ')
      return res.status(400).json({ error: `予約可能時間は ${slotStr} です` })
    }

    if (newStart !== data.startTime) updates.startTime = newStart
    if (newEnd   !== data.endTime)   updates.endTime   = newEnd
    updates.updatedAt = new Date()

    // 重複チェックと更新をトランザクションで原子的に実行（二重予約防止）
    await db.runTransaction(async (tx) => {
      const existingSnap = await tx.get(
        db.collection(cfg.collection).where('date', '==', data.date)
      )
      for (const d of existingSnap.docs) {
        if (d.id === docId) continue
        const r = d.data()
        if (r.status === 'cancelled') continue
        if (timesOverlap(newStart, newEnd, r.startTime, r.endTime))
          throw Object.assign(
            new Error(`${r.startTime}〜${r.endTime} に既に予約が入っています`),
            { status: 409 }
          )
      }
      tx.update(docRef, updates)
    })
    const profileUpdate: Record<string, any> = {}
    if (name)    profileUpdate.displayName = name
    if (picture) profileUpdate.pictureUrl  = picture
    if (Object.keys(profileUpdate).length > 0)
      await db.collection('users').doc(userId).set(profileUpdate, { merge: true })
    return res.status(200).json({ success: true })
  } catch (err: any) {
    const status = err.message === 'Unauthorized' ? 401 : (err.status ?? 500)
    return res.status(status).json({ error: err.message })
  }
}

// ─── お気に入り一覧・作成 ────────────────────────────────
async function handleFavorites(req: VercelRequest, res: VercelResponse) {
  try {
    const { userId } = await verifyLineToken(req.headers.authorization)

    if (req.method === 'GET') {
      const snap = await db.collection('favorites')
        .where('userId', '==', userId)
        .get()
      const favorites = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a: any, b: any) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0))
      return res.status(200).json({ favorites })
    }

    if (req.method === 'POST') {
      const { name, nobuTimeSlot, kobuTimeSlot, nobuRoomTimeSlot } = (req.body ?? {}) as {
        name?: string; nobuTimeSlot?: string; kobuTimeSlot?: string; nobuRoomTimeSlot?: string
      }
      if (!name?.trim()) return res.status(400).json({ error: 'name は必須です' })
      const trimmedName = name.trim()

      const existing = await db.collection('favorites').where('userId', '==', userId).get()
      if (existing.docs.some((d) => (d.data().name as string | undefined)?.trim() === trimmedName)) {
        return res.status(400).json({ error: '同じバンド名はすでにお気に入りに登録されています' })
      }
      if (existing.size >= 5) return res.status(400).json({ error: 'お気に入りは5件まで登録できます' })

      const doc = await db.collection('favorites').add({
        userId,
        name: trimmedName,
        nobuTimeSlot: nobuTimeSlot ?? null,
        kobuTimeSlot: kobuTimeSlot ?? null,
        nobuRoomTimeSlot: nobuRoomTimeSlot ?? null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      return res.status(201).json({ id: doc.id })
    }

    return res.status(405).json({ error: 'Method Not Allowed' })
  } catch (err: any) {
    const status = err.message === 'Unauthorized' ? 401 : 500
    return res.status(status).json({ error: err.message })
  }
}

// ─── お気に入り更新・削除 ────────────────────────────────
async function handleFavoriteById(req: VercelRequest, res: VercelResponse, id: string) {
  try {
    const { userId } = await verifyLineToken(req.headers.authorization)

    const ref = db.collection('favorites').doc(id)
    const doc = await ref.get()
    if (!doc.exists || doc.data()!.userId !== userId) {
      return res.status(404).json({ error: 'Not found' })
    }

    if (req.method === 'PATCH') {
      const { name, nobuTimeSlot, kobuTimeSlot, nobuRoomTimeSlot } = (req.body ?? {}) as {
        name?: string; nobuTimeSlot?: string | null; kobuTimeSlot?: string | null; nobuRoomTimeSlot?: string | null
      }
      const oldName = doc.data()!.name as string
      const updates: Record<string, any> = {}
      if (name !== undefined) {
        const trimmedName = name.trim()
        if (!trimmedName) return res.status(400).json({ error: 'name は必須です' })
        if (trimmedName !== oldName) {
          const existing = await db.collection('favorites').where('userId', '==', userId).get()
          if (existing.docs.some((d) => d.id !== id && (d.data().name as string | undefined)?.trim() === trimmedName)) {
            return res.status(400).json({ error: '同じバンド名はすでにお気に入りに登録されています' })
          }
        }
        updates.name = trimmedName
      }
      if (nobuTimeSlot !== undefined) updates.nobuTimeSlot = nobuTimeSlot
      if (kobuTimeSlot !== undefined) updates.kobuTimeSlot = kobuTimeSlot
      if (nobuRoomTimeSlot !== undefined) updates.nobuRoomTimeSlot = nobuRoomTimeSlot

      await ref.update(updates)

      // バンド名が変わった場合、全予約コレクションのbandNameを一括更新
      if (updates.name !== undefined && updates.name !== oldName) {
        const newName = updates.name
        await Promise.all([
          cascadeFavoriteNameUpdate('reservations',           id, newName),
          cascadeFavoriteNameUpdate('kobu_reservations',      id, newName),
          cascadeFavoriteNameUpdate('nobu_room_reservations', id, newName),
        ])
      }

      return res.status(200).json({ ok: true })
    }

    if (req.method === 'DELETE') {
      await ref.delete()
      return res.status(200).json({ ok: true })
    }

    return res.status(405).json({ error: 'Method Not Allowed' })
  } catch (err: any) {
    const status = err.message === 'Unauthorized' ? 401 : 500
    return res.status(status).json({ error: err.message })
  }
}

async function cascadeFavoriteNameUpdate(collection: string, favoriteId: string, newName: string) {
  const snap = await db.collection(collection).where('favoriteId', '==', favoriteId).get()
  if (snap.empty) return
  const batch = db.batch()
  snap.docs.forEach(d => batch.update(d.ref, { bandName: newName }))
  await batch.commit()
}
