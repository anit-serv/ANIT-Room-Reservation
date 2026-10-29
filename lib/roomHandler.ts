import { isFirestoreQuotaError, DATABASE_QUOTA_MESSAGE } from './serviceErrors'
import { VercelRequest, VercelResponse } from '@vercel/node'
import * as admin from 'firebase-admin'
import * as crypto from 'crypto'
import { verifyAdmin } from './verifyAdmin'
import { verifyRoomManager } from './verifyRoomManager'
import { roomManagerIds, roomManagerUpdate } from './roomManagerPermissions'
import { getRoomDay, getRoomPreferenceConfig, isRoomPreferenceEnabled, minimumModeDate, normalizeRoomList, roomDayRef, roomModeRef, usableRooms } from './roomPreference'
import { isDateAvailableBySettings, pickTimeSlotsForDate, resolveReservationSettingsForDate, todayJST } from './reservationSettings'
import { reservationDeadline } from './lotteryOperation'
import { refreshLotterySlot } from './roomAllocation'
import { ensureBandPollCron } from './cronSchedule'
import { processNotification } from './notificationService'
import { milliseconds, schedulerEnabled, enqueue, QUEUE } from './schedulerQueue'
import { schedulerStatus } from './schedulerStatus'
import { resultMessage } from './notificationMessage'
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
        const [config, versionRefs] = await Promise.all([
          getRoomPreferenceConfig(db),
          db.collection('room_preference_modes').listDocuments(),
        ])
        const versions = await Promise.all(versionRefs
          .sort((a, b) => b.id.localeCompare(a.id)).slice(0, 30).map((ref) => ref.get()))
        return res.status(200).json({ ...config, minimumModeDate: minimumModeDate(),
          commentBandConfigured: !!process.env.BAND_COMMENT_KEY,
          versions: versions.map((doc) => ({ effectiveFrom: doc.id, enabled: doc.data()?.enabled === true })) })
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
          // Post-only operation also needs cancellation replacements and cleanup.
          await ensureBandPollCron(db, req.headers.host)
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
      if (req.method === 'GET') {
        const snap = await db.collection('settings').doc('room-manager').get()
        return res.status(200).json({ manager: snap.exists ? snap.data() : null })
      }
      if (req.method === 'PUT') {
        const userId = String(req.body?.userId ?? '')
        const userRef = db.collection('users').doc(userId)
        await db.runTransaction(async (tx) => {
          const user = await tx.get(userRef)
          if (!user.exists) throw new Error('移譲先のユーザーが見つかりません')
          if (user.data()?.banned === true) throw new Error('利用停止中のユーザーには移譲できません')
          tx.set(db.collection('settings').doc('room-manager'), {
            ...roomManagerUpdate([userId], me.userId), displayName: user.data()?.displayName ?? '',
          })
        })
        return res.status(200).json({ success: true })
      }
      return res.status(405).json({ error: 'Method Not Allowed' })
    }

    if (path === 'notifications' || path === 'notifications/manual' || path === 'notifications/retry' || path === 'notifications/confirm-resend') {
      const me = await verifyAdmin(req.headers.authorization)
      if (path === 'notifications' && req.method === 'GET') {
        const [resultRefs, cleanup] = await Promise.all([
          db.collection('lottery_results').listDocuments(),
          db.collection('band_cleanup').limit(30).get(),
        ])
        const results = await Promise.all(resultRefs
          .sort((a, b) => b.id.localeCompare(a.id)).slice(0, 30).map((ref) => ref.get()))
        return res.status(200).json({
          results: results.map((doc) => ({ date: doc.id, pollStatus: doc.data()?.pollStatus ?? null,
            notificationSentAt: doc.data()?.notificationSentAt?.toMillis?.() ?? null,
            notificationError: doc.data()?.notificationError ?? null,
            notificationDirty: doc.data()?.notificationDirty === true })),
          cleanupPending: cleanup.size,
          scheduler: await schedulerStatus(db),
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
        const unknown = await db.collection('band_deliveries').where('date', '==', date).get()
        if (unknown.docs.some((doc) => doc.data().status !== 'sent')) {
          return res.status(409).json({ error: '送信結果不明の記録があります。先に送信結果の再確認を実行してください' })
        }
        await db.runTransaction(async (tx) => {
          const fresh = await tx.get(ref), data = fresh.data()!
          if (milliseconds(data.notificationLeaseUntil) > Date.now()) throw new Error('通知処理中です')
          if (data.notificationSentAt) throw new Error('既に通知済みです。結果更新の再試行を使ってください')
          tx.update(ref, { notificationMode: 'post', pollStatus: 'posting', notificationError: null,
            manualNotificationAt: new Date(), manualNotificationBy: me.userId })
        })
        await processNotification(db, date)
        if (schedulerEnabled()) await enqueue(db, 'cleanup', 'all', Date.now(), { repeat: true })
        return res.status(200).json({ success: true })
      }
      if (path === 'notifications/retry' && req.method === 'POST') {
        const date = String(req.body?.date ?? '')
        if (!DATE_RE.test(date)) return res.status(400).json({ error: '日付が不正です' })
        const ref = db.collection(QUEUE).doc(`band_${date}`)
        // Only reconcile existing send records. Unknown writes are never resent by this action.
        await db.runTransaction(async (tx) => {
          const job = await tx.get(ref)
          if (job.data()?.status === 'running') throw new Error('通知処理中です')
          tx.set(ref, { kind: 'band', date, status: 'pending', attempts: 0,
            dueAt: new Date(), availableAt: new Date(), generation: (job.data()?.generation ?? 0) + 1 }, { merge: true })
        })
        if (!schedulerEnabled()) await processNotification(db, date)
        return res.status(200).json({ success: true })
      }
      if (path === 'notifications/confirm-resend' && req.method === 'POST') {
        const date = String(req.body?.date ?? '')
        if (!DATE_RE.test(date) || req.body?.confirmedNotDelivered !== true) {
          return res.status(400).json({ error: 'BAND画面で未送信であることを確認してください' })
        }
        const resultRef = db.collection('lottery_results').doc(date), jobRef = db.collection(QUEUE).doc(`band_${date}`)
        await db.runTransaction(async (tx) => {
          const [result, job, attempts] = await Promise.all([
            tx.get(resultRef), tx.get(jobRef), tx.get(db.collection('band_deliveries').where('date', '==', date)),
          ])
          if (!result.exists || job.data()?.status === 'running' || milliseconds(result.data()?.notificationLeaseUntil) > Date.now()) {
            throw new Error('通知処理中、または抽選結果が見つかりません')
          }
          const unknown = attempts.docs.filter((doc) => doc.data().status !== 'sent')
          if (!unknown.length) throw new Error('送信結果不明の記録はありません')
          if (unknown.some((doc) => milliseconds(doc.data().leaseUntil) > Date.now())) throw new Error('通知処理中です')
          for (const attempt of unknown) tx.update(attempt.ref, { status: 'prepared', startedAt: new Date(),
            resendConfirmedBy: me.userId, resendConfirmedAt: new Date() })
          tx.update(resultRef, { notificationDirty: true, notificationError: null })
          tx.set(jobRef, { kind: 'band', date, status: 'pending', attempts: 0, dueAt: new Date(), availableAt: new Date(),
            generation: (job.data()?.generation ?? 0) + 1 }, { merge: true })
        })
        if (!schedulerEnabled()) await processNotification(db, date)
        return res.status(200).json({ success: true })
      }
      return res.status(405).json({ error: 'Method Not Allowed' })
    }

    if (path === 'transfer-candidates' && req.method === 'GET') {
      const me = await verifyRoomManager(req.headers.authorization)
      const [snap, managerSnap] = await Promise.all([
        db.collection('users').get(),
        db.collection('settings').doc('room-manager').get(),
      ])
      const managerIds = new Set(roomManagerIds(managerSnap.data()))
      return res.status(200).json({ users: snap.docs
        .filter((doc) => doc.id !== me.userId && doc.data().banned !== true &&
          !managerIds.has(doc.id))
        .map((doc) => ({ userId: doc.id, displayName: doc.data().displayName ?? '' })) })
    }

    if (path === 'transfer') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })
      const me = await verifyRoomManager(req.headers.authorization)
      const targetId = String(req.body?.userId ?? '')
      if (!targetId || targetId === me.userId) return res.status(400).json({ error: '別のユーザーを指定してください' })
      const targetRef = db.collection('users').doc(targetId)
      const ref = db.collection('settings').doc('room-manager')
      await db.runTransaction(async (tx) => {
        const [current, target] = await Promise.all([tx.get(ref), tx.get(targetRef)])
        const actorAdmin = await tx.get(db.collection('admins').doc(me.userId))
        const ids = roomManagerIds(current.data())
        if (!actorAdmin.exists && !ids.includes(me.userId)) throw new Error('Forbidden')
        if (!target.exists) throw new Error('移譲先のユーザーが見つかりません')
        if (target.data()?.banned === true) throw new Error('利用停止中のユーザーには移譲できません')
        if (ids.includes(targetId)) throw new Error('移譲先は既に部屋取り権限を持っています')
        const nextIds = actorAdmin.exists ? [targetId] : [...ids.filter((id) => id !== me.userId), targetId]
        tx.set(ref, { ...roomManagerUpdate(nextIds, me.userId),
          displayName: target.data()?.displayName ?? '' })
      })
      return res.status(200).json({ success: true })
    }

    if (path === 'transfer-invite') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })
      const me = await verifyRoomManager(req.headers.authorization)
      const token = crypto.randomBytes(24).toString('hex')
      const expiresAt = new Date(Date.now() + 24 * 60 * 60_000)
      await db.collection('invitations').doc(token).set({ kind: 'transfer', authority: 'room',
        sourceId: me.userId, createdBy: me.userId, roomScope: me.isAdmin ? 'all' : 'self',
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
    if (isFirestoreQuotaError(err)) return res.status(503).json({ error: DATABASE_QUOTA_MESSAGE })
    if (err.message === 'Unauthorized' || err.message === 'Forbidden') return authError(res, err)
    if (err.message === '移譲先のユーザーが見つかりません') return res.status(404).json({ error: err.message })
    if (err.message === '利用停止中のユーザーには移譲できません') return res.status(400).json({ error: err.message })
    if (err.message === '移譲先は既に部屋取り権限を持っています') return res.status(400).json({ error: err.message })
    if (err.message === '移譲先は管理者以上の権限を持っています') return res.status(400).json({ error: err.message })
    if (err.message === '予約後は部屋一覧を変更できません') return res.status(409).json({ error: err.message })
    console.error(err)
    return res.status(500).json({ error: err.message })
  }
}
