import { VercelRequest, VercelResponse } from '@vercel/node'
import * as admin from 'firebase-admin'
import * as crypto from 'crypto'
import { verifyAdmin } from '../lib/verifyAdmin'
import { verifyRoomManager } from '../lib/verifyRoomManager'
import { getRoomDay, getRoomPreferenceConfig, isRoomPreferenceEnabled, minimumModeDate, normalizeRoomList, roomDayRef, roomModeRef, usableRooms } from '../lib/roomPreference'
import { isDateAvailableBySettings, pickTimeSlotsForDate, resolveReservationSettingsForDate, todayJST } from '../lib/reservationSettings'
import { reservationDeadline } from '../lib/lotteryOperation'
import { refreshLotterySlot } from '../lib/roomAllocation'
import { ensureBandPollCron } from '../lib/cronSchedule'
import { bandUserKey, writeBandPost } from '../lib/band'
import { resultMessage } from '../lib/notificationMessage'
import 'dotenv/config'

const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert({
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey,
}) })
const db = admin.firestore()
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function authError(res: VercelResponse, err: any) {
  return res.status(err.message === 'Forbidden' ? 403 : 401).json({ error: err.message })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(204).end()
  const path = String(req.query._path ?? '')

  try {
    if (path === 'me' && req.method === 'GET') {
      return res.status(200).json(await verifyRoomManager(req.headers.authorization))
    }

    if (path === 'config') {
      const me = await verifyAdmin(req.headers.authorization)
      if (req.method === 'GET') {
        const [config, versions] = await Promise.all([
          getRoomPreferenceConfig(db),
          db.collection('room_preference_modes').orderBy('__name__', 'desc').limit(30).get(),
        ])
        return res.status(200).json({ ...config, minimumModeDate: minimumModeDate(),
          commentBandConfigured: !!process.env.BAND_COMMENT_KEY,
          versions: versions.docs.map((doc) => ({ effectiveFrom: doc.id, enabled: doc.data().enabled === true })) })
      }
      if (req.method === 'PUT') {
        const { effectiveFrom, enabled, notificationMode, fallbackPost } = req.body ?? {}
        if (typeof notificationMode !== 'undefined' || typeof fallbackPost !== 'undefined') {
          if (!['post', 'comment'].includes(notificationMode) || typeof fallbackPost !== 'boolean') {
            return res.status(400).json({ error: '通知設定が不正です' })
          }
          if (notificationMode === 'comment' && !process.env.BAND_COMMENT_KEY) {
            return res.status(400).json({ error: 'コメント先BANDのキーが未設定です' })
          }
          if (notificationMode === 'comment') await ensureBandPollCron(db, req.headers.host)
          await db.collection('settings').doc('room-preference').set({ notificationMode, fallbackPost,
            updatedAt: new Date(), updatedBy: me.userId }, { merge: true })
        }
        if (typeof enabled !== 'undefined') {
          if (!DATE_RE.test(effectiveFrom ?? '') || effectiveFrom < minimumModeDate() || typeof enabled !== 'boolean') {
            return res.status(400).json({ error: `モードの適用日は${minimumModeDate()}以降を指定してください` })
          }
          await roomModeRef(db, effectiveFrom).set({ enabled, updatedAt: new Date(), updatedBy: me.userId })
        }
        return res.status(200).json({ success: true })
      }
      return res.status(405).json({ error: 'Method Not Allowed' })
    }

    if (path === 'manager') {
      const me = await verifyAdmin(req.headers.authorization)
      if (!me.isSuperAdmin) return res.status(403).json({ error: 'スーパー管理者のみ操作できます' })
      if (req.method === 'GET') {
        const snap = await db.collection('settings').doc('room-manager').get()
        return res.status(200).json({ manager: snap.exists ? snap.data() : null })
      }
      if (req.method === 'PUT') {
        const userId = String(req.body?.userId ?? '')
        const user = await db.collection('users').doc(userId).get()
        if (!user.exists) return res.status(404).json({ error: '移譲先のユーザーが見つかりません' })
        await db.collection('settings').doc('room-manager').set({ userId,
          displayName: user.data()?.displayName ?? '', updatedAt: new Date(), updatedBy: me.userId })
        return res.status(200).json({ success: true })
      }
      return res.status(405).json({ error: 'Method Not Allowed' })
    }

    if (path === 'notifications' || path === 'notifications/manual') {
      const me = await verifyAdmin(req.headers.authorization)
      if (path === 'notifications' && req.method === 'GET') {
        const [results, cleanup] = await Promise.all([
          db.collection('lottery_results').orderBy('__name__', 'desc').limit(30).get(),
          db.collection('band_cleanup').limit(30).get(),
        ])
        return res.status(200).json({
          results: results.docs.map((doc) => ({ date: doc.id, pollStatus: doc.data().pollStatus ?? null,
            notificationSentAt: doc.data().notificationSentAt?.toMillis?.() ?? null,
            notificationError: doc.data().notificationError ?? null,
            notificationDirty: doc.data().notificationDirty === true })),
          cleanupPending: cleanup.size,
        })
      }
      if (path === 'notifications/manual' && req.method === 'POST') {
        const date = String(req.body?.date ?? '')
        if (!DATE_RE.test(date)) return res.status(400).json({ error: '日付が不正です' })
        const ref = db.collection('lottery_results').doc(date)
        const result = await ref.get()
        if (!result.exists) return res.status(404).json({ error: '抽選結果が見つかりません' })
        const content = resultMessage(date, result.data())
        if (!content) return res.status(400).json({ error: '通知する結果がありません' })
        const postKey = await writeBandPost(content, await bandUserKey())
        await ref.update({ pollStatus: 'complete', notificationSentAt: new Date(),
          notificationRevisionSent: result.data()?.notificationRevision ?? 1,
          manualNotificationAt: new Date(), manualNotificationBy: me.userId,
          deliveries: { ...(result.data()?.deliveries ?? {}), post: {
            kind: 'post', postKey, content, revision: result.data()?.notificationRevision ?? 1 } },
          notificationError: null, notificationDirty: false })
        return res.status(200).json({ success: true })
      }
      return res.status(405).json({ error: 'Method Not Allowed' })
    }

    if (path === 'invite') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })
      const me = await verifyAdmin(req.headers.authorization)
      if (!me.isSuperAdmin) return res.status(403).json({ error: 'スーパー管理者のみ招待できます' })
      const token = crypto.randomBytes(24).toString('hex')
      const expiresAt = new Date(Date.now() + 24 * 60 * 60_000)
      await db.collection('invitations').doc(token).set({ kind: 'room-manager', createdBy: me.userId,
        createdAt: new Date(), expiresAt, used: false })
      return res.status(201).json({ url: `https://${req.headers.host}/api/admin/invite?token=${token}`,
        expiresAt: expiresAt.toISOString() })
    }

    if (path === 'transfer') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })
      const me = await verifyRoomManager(req.headers.authorization)
      const targetId = String(req.body?.userId ?? '')
      if (!targetId || targetId === me.userId) return res.status(400).json({ error: '別のユーザーを指定してください' })
      const target = await db.collection('users').doc(targetId).get()
      if (!target.exists) return res.status(404).json({ error: '移譲先のユーザーが見つかりません' })
      const ref = db.collection('settings').doc('room-manager')
      await db.runTransaction(async (tx) => {
        const current = await tx.get(ref)
        if (current.data()?.userId !== me.userId) throw new Error('Forbidden')
        tx.set(ref, { userId: targetId, displayName: target.data()?.displayName ?? '',
          updatedAt: new Date(), updatedBy: me.userId })
      })
      return res.status(200).json({ success: true })
    }

    if (path === 'transfer-invite') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })
      const me = await verifyRoomManager(req.headers.authorization)
      const token = crypto.randomBytes(24).toString('hex')
      const expiresAt = new Date(Date.now() + 24 * 60 * 60_000)
      await db.collection('invitations').doc(token).set({ kind: 'room-manager', createdBy: me.userId, fromManager: me.userId,
        createdAt: new Date(), expiresAt, used: false })
      return res.status(201).json({ url: `https://${req.headers.host}/api/admin/invite?token=${token}`,
        expiresAt: expiresAt.toISOString() })
    }

    if (path === 'day') {
      const me = await verifyRoomManager(req.headers.authorization)
      const date = String(req.query.date ?? req.body?.date ?? '')
      if (!DATE_RE.test(date)) return res.status(400).json({ error: '日付が不正です' })
      const settings = await resolveReservationSettingsForDate(db, date)
      if (!isDateAvailableBySettings(date, settings)) return res.status(400).json({ error: '予約できない日付です' })
      const timeSlots = pickTimeSlotsForDate(date, settings)
      if (req.method === 'GET') {
        const [day, enabled] = await Promise.all([getRoomDay(db, date), isRoomPreferenceEnabled(db, date)])
        return res.status(200).json({ date, timeSlots, enabled, slots: day.slots })
      }
      if (req.method !== 'PUT') return res.status(405).json({ error: 'Method Not Allowed' })
      const slot = String(req.body?.timeSlot ?? '')
      if (!timeSlots.some((item) => item.value === slot)) return res.status(400).json({ error: '時間枠が不正です' })
      if (Date.now() >= reservationDeadline(date, settings.lotteryMode, settings.lotteryTime).getTime()) {
        return res.status(400).json({ error: '予約受付締切後は部屋を登録できません' })
      }
      const rooms = normalizeRoomList(req.body?.rooms)
      const ready = req.body?.ready === true
      if (!rooms || (ready && rooms.length === 0)) return res.status(400).json({ error: '部屋を1件以上指定してください' })
      const ref = roomDayRef(db, date)
      const reservations = db.collection('reservations').where('date', '==', `${date}T${slot}`)
      await db.runTransaction(async (tx) => {
        const [day, existing] = await Promise.all([tx.get(ref), tx.get(reservations)])
        if (existing.docs.some((doc) => doc.data().status !== 'cancelled')) throw new Error('予約後は部屋一覧を変更できません')
        const slots = { ...(day.data()?.slots ?? {}) }
        slots[slot] = { rooms, unavailable: [], ready }
        tx.set(ref, { slots, updatedAt: new Date(), updatedBy: me.userId }, { merge: true })
      })
      return res.status(200).json({ success: true })
    }

    if (path === 'day/unavailable') {
      const me = await verifyRoomManager(req.headers.authorization)
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })
      const { date, timeSlot, room } = req.body ?? {}
      if (!DATE_RE.test(date ?? '') || typeof timeSlot !== 'string' || typeof room !== 'string') {
        return res.status(400).json({ error: '日付・時間枠・部屋が不正です' })
      }
      const dayRef = roomDayRef(db, date)
      await db.runTransaction(async (tx) => {
        const day = await tx.get(dayRef)
        const slots = { ...(day.data()?.slots ?? {}) }
        const slot = slots[timeSlot]
        if (!slot?.ready || !slot.rooms?.includes(room)) throw new Error('登録済みの部屋ではありません')
        const unavailable = Array.from(new Set([...(slot.unavailable ?? []), room])) as string[]
        const nextSlot = { ...slot, unavailable }
        const available = usableRooms(nextSlot)
        await refreshLotterySlot(db, tx, date, timeSlot, [], available)
        slots[timeSlot] = nextSlot
        tx.update(dayRef, { slots, updatedAt: new Date(), updatedBy: me.userId })
      })
      return res.status(200).json({ success: true })
    }

    return res.status(404).json({ error: 'Not Found' })
  } catch (err: any) {
    if (err.message === 'Unauthorized' || err.message === 'Forbidden') return authError(res, err)
    if (err.message === '予約後は部屋一覧を変更できません') return res.status(409).json({ error: err.message })
    console.error(err)
    return res.status(500).json({ error: err.message })
  }
}
