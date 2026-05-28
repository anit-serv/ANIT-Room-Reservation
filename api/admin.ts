import { VercelRequest, VercelResponse } from '@vercel/node'
import * as admin from 'firebase-admin'
import * as crypto from 'crypto'
import axios from 'axios'
import { verifyAdmin } from '../lib/verifyAdmin'
import {
  addDaysJST,
  getPendingReservationSettingsChange,
  listFacilitySettingsVersions,
  listPendingFacilitySettingsChanges,
  listPendingReservationSettingsChanges,
  listReservationDayOverrides,
  resolveReservationSettingsForDate,
  todayJST,
} from '../lib/reservationSettings'
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

// ─── 監査ログ ────────────────────────────────────────
type AuditActor = { userId: string; displayName: string }

async function audit(
  actor: AuditActor,
  action: string,
  opts: { targetType?: string; targetId?: string; targetLabel?: string; details?: any } = {}
): Promise<void> {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000) // +1年
  try {
    await db.collection('auditLogs').add({
      actorUserId: actor.userId,
      actorDisplayName: actor.displayName,
      action,
      targetType: opts.targetType ?? null,
      targetId: opts.targetId ?? null,
      targetLabel: opts.targetLabel ?? null,
      details: opts.details ?? null,
      createdAt: now,
      expiresAt,
    })
  } catch (err) {
    // ログ書き込み失敗は本処理を止めない
    console.error('audit log error:', err)
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {}
  const result: Record<string, string> = {}
  header.split(';').forEach((c) => {
    const [k, ...v] = c.trim().split('=')
    if (k && v.length) result[k] = v.join('=')
  })
  return result
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const path = (req.query._path as string) ?? ''
  const segments = path.split('/').filter(Boolean)

  // 認証系（無認証アクセス可能）
  if (path === 'auth/start')    return handleAuthStart(req, res)
  if (path === 'auth/callback') return handleAuthCallback(req, res)
  if (path === 'auth/me')       return handleAuthMe(req, res)

  // 設定
  if (path === 'settings')              return handleSettings(req, res)
  if (path === 'settings/scheduled')    return handleSettingsScheduled(req, res)
  if (path === 'settings/lottery-time') return handleSettingsLotteryTime(req, res)
  if (segments[0] === 'settings' && segments[1] === 'day-overrides') {
    if (segments.length === 2) return handleSettingsDayOverrides(req, res)
    if (segments.length === 3) return handleSettingsDayOverrideByDate(req, res, segments[2])
  }

  // 予約管理
  if (segments[0] === 'reservations') {
    if (segments.length === 1) return handleReservationsList(req, res)
    if (segments.length === 2) return handleReservationById(req, res, segments[1])
  }

  // ユーザー管理
  if (segments[0] === 'users') {
    if (segments.length === 1) return handleUsersList(req, res)
    if (segments.length === 2) return handleUserById(req, res, segments[1])
  }

  // 管理者管理
  if (segments[0] === 'admins') {
    if (segments.length === 1) return handleAdminsList(req, res)
    if (segments.length === 2) return handleAdminById(req, res, segments[1])
    if (segments.length === 3 && segments[2] === 'transfer-super') {
      return handleTransferSuper(req, res, segments[1])
    }
  }

  // 招待
  if (segments[0] === 'invitations') {
    if (segments.length === 1) return handleInvitations(req, res)
    if (segments.length === 2) return handleInvitationById(req, res, segments[1])
  }
  if (path === 'invite') return handleInviteAccept(req, res)

  // 時間枠プリセット
  if (segments[0] === 'time-slot-presets') {
    if (segments.length === 1) return handleTimeSlotPresets(req, res)
    if (segments.length === 2) return handleTimeSlotPresetById(req, res, segments[1])
  }

  // 工部室予約管理
  if (segments[0] === 'kobu-reservations') {
    if (segments.length === 1) return handleKobuReservationsList(req, res)
    if (segments.length === 2) return handleKobuReservationById(req, res, segments[1])
  }

  // 工部室設定
  if (path === 'kobu-settings') return handleKobuSettings(req, res)
  if (path === 'kobu-settings/scheduled') return handleFacilitySettingsScheduled(req, res, 'kobu')

  // 農部室予約管理
  if (segments[0] === 'nobu-room-reservations') {
    if (segments.length === 1) return handleNobuRoomReservationsList(req, res)
    if (segments.length === 2) return handleNobuRoomReservationById(req, res, segments[1])
  }

  // 農部室設定
  if (path === 'nobu-room-settings') return handleNobuRoomSettings(req, res)
  if (path === 'nobu-room-settings/scheduled') return handleFacilitySettingsScheduled(req, res, 'nobu-room')

  // 監査ログ
  if (path === 'logs') return handleLogs(req, res)

  // ダッシュボード
  if (path === 'dashboard') return handleDashboard(req, res)

  return res.status(404).json({ error: 'Not Found' })
}

// ─── LINE Login OAuth 開始 ──────────────────────────────
function handleAuthStart(req: VercelRequest, res: VercelResponse) {
  const state = crypto.randomBytes(16).toString('hex')
  const baseUrl = `https://${req.headers.host}`
  const redirectUri = `${baseUrl}/api/admin/auth/callback`

  res.setHeader(
    'Set-Cookie',
    `admin_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`
  )

  const authUrl = new URL('https://access.line.me/oauth2/v2.1/authorize')
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', process.env.LINE_LOGIN_CHANNEL_ID!)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('scope', 'openid profile')

  res.redirect(302, authUrl.toString())
}

// ─── LINE Login OAuth コールバック ─────────────────────
async function handleAuthCallback(req: VercelRequest, res: VercelResponse) {
  const baseUrl = `https://${req.headers.host}`
  const loginUrl = `${baseUrl}/admin/login`

  try {
    const { code, state } = req.query as { code?: string; state?: string }
    const cookies = parseCookies(req.headers.cookie)
    if (!state || !code || state !== cookies.admin_oauth_state) {
      return res.redirect(302, `${loginUrl}?error=invalid`)
    }

    const tokenRes = await axios.post(
      'https://api.line.me/oauth2/v2.1/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${baseUrl}/api/admin/auth/callback`,
        client_id: process.env.LINE_LOGIN_CHANNEL_ID!,
        client_secret: process.env.LINE_LOGIN_CHANNEL_SECRET!,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    )
    const idToken: string     = tokenRes.data.id_token
    const accessToken: string = tokenRes.data.access_token

    const verifyRes = await axios.post(
      'https://api.line.me/oauth2/v2.1/verify',
      new URLSearchParams({
        id_token: idToken,
        client_id: process.env.LINE_LOGIN_CHANNEL_ID!,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    )
    const userId: string = verifyRes.data.sub
    const lineName: string | undefined = verifyRes.data.name
    const linePicture: string | undefined = verifyRes.data.picture

    // users コレクションにも同期（管理者ログイン時）
    if (lineName || linePicture) {
      const userRef = db.collection('users').doc(userId)
      const userDoc = await userRef.get()
      const update: Record<string, any> = {}
      if (lineName)    update.displayName = lineName
      if (linePicture) update.pictureUrl  = linePicture
      if (!userDoc.exists) update.banned = false
      await userRef.set(update, { merge: true })
    }

    // 招待トークンがあれば管理者として登録
    const invitationToken = cookies.admin_invitation
    const clearCookies = [
      'admin_oauth_state=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/',
      'admin_invitation=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/',
    ]
    res.setHeader('Set-Cookie', clearCookies)

    if (invitationToken) {
      const invRef = db.collection('invitations').doc(invitationToken)
      const invDoc = await invRef.get()
      const invData = invDoc.exists ? invDoc.data()! : null
      const isValid =
        invData &&
        !invData.used &&
        invData.expiresAt &&
        invData.expiresAt.toMillis() > Date.now()
      if (isValid) {
        // 招待トークンからの管理者追加
        const displayName = (verifyRes.data.name as string) ?? ''
        await db.collection('admins').doc(userId).set({
          displayName,
          addedAt: new Date(),
          addedBy: invData!.createdBy ?? null,
        })
        await invRef.update({ used: true, usedAt: new Date(), usedBy: userId })

        // 招待者をアクターとして取得
        const inviterUserId = (invData!.createdBy ?? null) as string | null
        let inviterActor: AuditActor = { userId: 'system', displayName: 'システム' }
        if (inviterUserId) {
          const inviterDoc = await db.collection('admins').doc(inviterUserId).get()
          inviterActor = {
            userId: inviterUserId,
            displayName: inviterDoc.data()?.displayName ?? inviterUserId,
          }
        }
        await audit(
          inviterActor,
          'admin.add',
          { targetType: 'admin', targetId: userId, targetLabel: displayName }
        )
        return res.redirect(302, `${loginUrl}?token=${encodeURIComponent(accessToken)}`)
      }
      // 招待トークンが無効でも、既存管理者なら通常ログインさせる
    }

    const adminDoc = await db.collection('admins').doc(userId).get()
    if (!adminDoc.exists) {
      return res.redirect(302, `${loginUrl}?error=not_admin`)
    }
    return res.redirect(302, `${loginUrl}?token=${encodeURIComponent(accessToken)}`)
  } catch (err) {
    console.error('OAuth callback error:', err)
    return res.redirect(302, `${loginUrl}?error=invalid`)
  }
}

// ─── 現在ログイン中の管理者情報 ────────────────────────
async function handleAuthMe(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' })
  try {
    const info = await verifyAdmin(req.headers.authorization)
    return res.status(200).json(info)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }
}

// ─── 設定の取得・更新 ─────────────────────────────────
type TimeSlot = { label: string; value: string }
type PerDaySchedule = {
  enabled: boolean
  byWeekday: { [day: string]: TimeSlot[] }
  byDate:    { [date: string]: TimeSlot[] }
}
type SettingsCore = {
  availableDays: number[]
  timeSlots: TimeSlot[]
  extraDates: string[]
  excludedDates: string[]
  perDaySchedule: PerDaySchedule
}
type Settings = SettingsCore & {
  nextChange?: SettingsCore & { effectiveFrom: string }
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s))
}

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// 単一の時間枠配列のバリデーション（形式・順序・重複）
function validateTimeSlots(timeSlots: any, contextLabel = ''): TimeSlot[] | string {
  if (!Array.isArray(timeSlots) || timeSlots.length === 0) {
    return `${contextLabel}時間枠が必要です`
  }
  if (!timeSlots.every((t: any) => t && typeof t.label === 'string' && typeof t.value === 'string')) {
    return `${contextLabel}時間枠の形式が不正です`
  }
  const parsed: { start: number; end: number }[] = []
  for (const t of timeSlots) {
    const m = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(t.value)
    if (!m) return `${contextLabel}時間枠の形式が不正です: ${t.value}`
    const start = toMinutes(m[1])
    const end = toMinutes(m[2])
    if (start >= end) return `${contextLabel}開始時刻は終了時刻より前にしてください: ${t.value}`
    parsed.push({ start, end })
  }
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      const a = parsed[i], b = parsed[j]
      if (a.start < b.end && b.start < a.end) {
        return `${contextLabel}時間枠が重複: ${timeSlots[i].value} と ${timeSlots[j].value}`
      }
    }
  }
  return timeSlots
}

function validateSettings(body: any): SettingsCore | string {
  if (!body) return '不正なリクエストです'
  const { availableDays, timeSlots, extraDates, excludedDates, perDaySchedule } = body

  if (!Array.isArray(availableDays)) return '不正なリクエストです'
  if (!availableDays.every((d: any) => Number.isInteger(d) && d >= 0 && d <= 6)) {
    return '不正な曜日が含まれています'
  }

  const validatedDefault = validateTimeSlots(timeSlots, 'デフォルト')
  if (typeof validatedDefault === 'string') return validatedDefault

  // 追加日・除外日
  const validatedExtra: string[] = []
  for (const d of extraDates ?? []) {
    if (typeof d !== 'string' || !DATE_RE.test(d)) return `追加日の形式が不正: ${d}`
    validatedExtra.push(d)
  }
  const validatedExcluded: string[] = []
  for (const d of excludedDates ?? []) {
    if (typeof d !== 'string' || !DATE_RE.test(d)) return `除外日の形式が不正: ${d}`
    validatedExcluded.push(d)
  }
  // 追加日と除外日の重複は無効
  for (const d of validatedExtra) {
    if (validatedExcluded.includes(d)) return `${d} は追加日と除外日の両方に指定されています`
  }

  // 曜日/日付別スケジュール
  const sched: PerDaySchedule = {
    enabled: !!perDaySchedule?.enabled,
    byWeekday: {},
    byDate: {},
  }
  if (sched.enabled) {
    for (const [k, v] of Object.entries(perDaySchedule?.byWeekday ?? {})) {
      const day = Number(k)
      if (!Number.isInteger(day) || day < 0 || day > 6) return `不正な曜日キー: ${k}`
      const result = validateTimeSlots(v, `${['日','月','火','水','木','金','土'][day]}曜の`)
      if (typeof result === 'string') return result
      sched.byWeekday[String(day)] = result
    }
    for (const [date, v] of Object.entries(perDaySchedule?.byDate ?? {})) {
      if (!DATE_RE.test(date)) return `不正な日付キー: ${date}`
      const result = validateTimeSlots(v, `${date}の`)
      if (typeof result === 'string') return result
      sched.byDate[date] = result
    }
  }

  return {
    availableDays,
    timeSlots: validatedDefault,
    extraDates: validatedExtra,
    excludedDates: validatedExcluded,
    perDaySchedule: sched,
  }
}

async function handleSettings(req: VercelRequest, res: VercelResponse) {
  let me: AuditActor
  try {
    me = await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }

  const docRef = db.collection('settings').doc('reservation')

  if (req.method === 'GET') {
    const [data, scheduledChanges] = await Promise.all([
      resolveReservationSettingsForDate(db, todayJST()),
      listPendingReservationSettingsChanges(db),
    ])
    const pendingChange = scheduledChanges[0] ?? null
    return res.status(200).json({
      availableDays:  data.availableDays,
      timeSlots:      data.timeSlots,
      extraDates:     data.extraDates,
      excludedDates:  data.excludedDates,
      perDaySchedule: data.perDaySchedule,
      nextChange:     pendingChange,
      scheduledChanges,
      lotteryTime:    data.lotteryTime,
    })
  }

  if (req.method === 'PUT') {
    const validated = validateSettings(req.body)
    if (typeof validated === 'string') return res.status(400).json({ error: validated })

    const { effectiveFrom } = (req.body ?? {}) as { effectiveFrom?: string }

    if (!effectiveFrom || !isValidDate(effectiveFrom)) {
      return res.status(400).json({ error: '適用日を指定してください' })
    }

    // 現在の予約可能期間（7日後まで）と競合させないため、
    // 適用日は 今日+8日 以降に制限する
    const minDateStr = addDaysJST(8)
    if (effectiveFrom < minDateStr) {
      return res.status(400).json({
        error: `適用日は${minDateStr}以降を指定してください（現在の予約可能期間との競合を避けるため）`,
      })
    }

    await docRef.collection('versions').doc(effectiveFrom).set({
      ...validated,
      effectiveFrom,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: me.userId,
    })
    await docRef.set({ nextChange: admin.firestore.FieldValue.delete() }, { merge: true })
    await audit(me, 'settings.schedule', { targetType: 'settings', details: { ...validated, effectiveFrom } })
    return res.status(200).json({ applied: 'scheduled', effectiveFrom })
  }

  return res.status(405).json({ error: 'Method Not Allowed' })
}

// ─── 予約済みの設定変更をキャンセル ────────────────────
async function handleSettingsScheduled(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method Not Allowed' })
  let me: AuditActor
  try {
    me = await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }
  const docRef = db.collection('settings').doc('reservation')
  const date = req.query.date as string | undefined
  if (date && !isValidDate(date)) return res.status(400).json({ error: '日付の形式が不正です' })

  if (date) {
    await docRef.collection('versions').doc(date).delete()
    const doc = await docRef.get()
    if (doc.exists && doc.data()?.nextChange?.effectiveFrom === date) {
      await docRef.set({ nextChange: admin.firestore.FieldValue.delete() }, { merge: true })
    }
    await audit(me, 'settings.scheduled.cancel', { targetType: 'settings', targetId: date, details: { effectiveFrom: date } })
    return res.status(200).json({ success: true })
  }

  const pendingChange = await getPendingReservationSettingsChange(db)
  if (pendingChange?.source === 'version') {
    await docRef.collection('versions').doc(pendingChange.effectiveFrom).delete()
  }
  await docRef.set({
    nextChange: admin.firestore.FieldValue.delete(),
  }, { merge: true })
  await audit(me, 'settings.scheduled.cancel', { targetType: 'settings' })
  return res.status(200).json({ success: true })
}

async function reservationCountForDate(date: string): Promise<number> {
  const snap = await db.collection('reservations')
    .where('date', '>=', `${date}T00:00`)
    .where('date', '<=', `${date}T23:59`)
    .get()
  return snap.size
}

// ─── 農部生協の直近日付例外（緊急ブロック/臨時開放） ───
async function handleSettingsDayOverrides(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' })
  try {
    await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }

  const date = req.query.date as string | undefined
  if (date) {
    if (!isValidDate(date)) return res.status(400).json({ error: '日付の形式が不正です' })
    const [doc, reservationCount] = await Promise.all([
      db.collection('settings').doc('reservation').collection('dayOverrides').doc(date).get(),
      reservationCountForDate(date),
    ])
    return res.status(200).json({
      override: doc.exists ? doc.data() : null,
      reservationCount,
    })
  }

  const overrides = await listReservationDayOverrides(db, { minDate: todayJST() })
  const withCounts = await Promise.all(overrides.map(async (override) => ({
    ...override,
    reservationCount: await reservationCountForDate(override.date),
  })))
  return res.status(200).json({ overrides: withCounts })
}

async function handleSettingsDayOverrideByDate(req: VercelRequest, res: VercelResponse, date: string) {
  let me: AuditActor
  try {
    me = await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }

  if (!isValidDate(date)) return res.status(400).json({ error: '日付の形式が不正です' })
  if (date < todayJST()) return res.status(400).json({ error: '過去の日付は指定できません' })

  const docRef = db.collection('settings').doc('reservation').collection('dayOverrides').doc(date)

  if (req.method === 'DELETE') {
    await docRef.delete()
    await audit(me, 'settings.dayOverride.delete', {
      targetType: 'settings',
      targetId: date,
      details: { date },
    })
    return res.status(200).json({ success: true })
  }

  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method Not Allowed' })
  if (date >= addDaysJST(8)) {
    return res.status(400).json({
      error: `緊急対応の対象日は通常設定では間に合わない日付（${todayJST()}〜${addDaysJST(7)}）を指定してください`,
    })
  }

  const { type, reason, timeSlots } = (req.body ?? {}) as {
    type?: 'blocked' | 'opened'
    reason?: string
    timeSlots?: TimeSlot[]
  }
  if (type !== 'blocked' && type !== 'opened') {
    return res.status(400).json({ error: '操作種別が不正です' })
  }
  const trimmedReason = (reason ?? '').trim()
  if (!trimmedReason) return res.status(400).json({ error: '理由を入力してください' })

  let validatedSlots: TimeSlot[] | undefined
  if (type === 'opened' && Array.isArray(timeSlots) && timeSlots.length > 0) {
    const result = validateTimeSlots(timeSlots, '臨時開放の')
    if (typeof result === 'string') return res.status(400).json({ error: result })
    validatedSlots = result
  }

  const data = {
    date,
    type,
    reason: trimmedReason,
    ...(validatedSlots ? { timeSlots: validatedSlots } : { timeSlots: admin.firestore.FieldValue.delete() }),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: me.userId,
  }
  await docRef.set(data, { merge: true })

  const reservationCount = await reservationCountForDate(date)
  await audit(me, type === 'blocked' ? 'settings.dayOverride.block' : 'settings.dayOverride.open', {
    targetType: 'settings',
    targetId: date,
    details: { date, type, reason: trimmedReason, timeSlots: validatedSlots ?? null, reservationCount },
  })

  return res.status(200).json({
    override: { date, type, reason: trimmedReason, ...(validatedSlots ? { timeSlots: validatedSlots } : {}) },
    reservationCount,
  })
}

// ─── 抽選時刻の即時更新 ───────────────────────────────
async function handleSettingsLotteryTime(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method Not Allowed' })
  let me: AuditActor
  try {
    me = await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }

  const { lotteryTime } = (req.body ?? {}) as { lotteryTime?: string }
  if (!lotteryTime || !/^([01]\d|2[0-3]):[0-5]\d$/.test(lotteryTime) || lotteryTime < '01:00') {
    return res.status(400).json({ error: '抽選時刻は01:00〜23:59で指定してください' })
  }

  await db.collection('settings').doc('reservation').set({ lotteryTime }, { merge: true })
  await audit(me, 'settings.lotteryTime', { targetType: 'settings', details: { lotteryTime } })

  // cron-job.org スケジュール更新（抽選ジョブ: 5分前 / 通知ジョブ: 抽選時刻）
  const apiKey        = process.env.CRONJOB_ORG_API_KEY
  const lotteryJobId  = process.env.CRONJOB_ORG_LOTTERY_JOB_ID
  const notifyJobId   = process.env.CRONJOB_ORG_NOTIFY_JOB_ID
  if (apiKey && (lotteryJobId || notifyJobId)) {
    const [h, m] = lotteryTime.split(':').map(Number)
    const lotteryMinutes = h * 60 + m

    // 抽選ジョブ: 5分前
    const lotteryJobMinutes = lotteryMinutes - 5
    const lotteryJobH = Math.floor(lotteryJobMinutes / 60)
    const lotteryJobM = lotteryJobMinutes % 60

    const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
    const makeSchedule = (jh: number, jm: number) => ({
      job: { schedule: { timezone: 'Asia/Tokyo', expiresAt: 0, hours: [jh], minutes: [jm], mdays: [-1], months: [-1], wdays: [-1] } }
    })

    try {
      await Promise.all([
        lotteryJobId && axios.patch(`https://api.cron-job.org/jobs/${lotteryJobId}`, makeSchedule(lotteryJobH, lotteryJobM), { headers }),
        notifyJobId  && axios.patch(`https://api.cron-job.org/jobs/${notifyJobId}`,  makeSchedule(h, m),                    { headers }),
      ])
    } catch (err: any) {
      return res.status(200).json({ success: true, lotteryTime, cronWarning: 'cron-job.orgの更新に失敗しました: ' + err.message })
    }
  }

  return res.status(200).json({ success: true, lotteryTime })
}

// ─── 予約一覧（フィルタ可） ────────────────────────────
async function handleReservationsList(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' })
  try {
    await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }

  try {
    const { date, status, q } = req.query as { date?: string; status?: string; q?: string }
    let query: FirebaseFirestore.Query = db.collection('reservations')

    if (date) {
      query = query
        .where('date', '>=', `${date}T00:00`)
        .where('date', '<=', `${date}T23:59`)
    }
    if (status === 'pending' || status === 'confirmed') {
      query = query.where('status', '==', status)
    }

    const snapshot = await query.get()
    let docs = snapshot.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    } as any))

    // バンド名で部分一致フィルタ
    if (q) {
      const lower = q.toLowerCase()
      docs = docs.filter((d) => (d.bandName ?? '').toLowerCase().includes(lower))
    }

    // 日付降順でソート
    docs.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))

    // ユーザー名をまとめて取得
    const userIds = Array.from(new Set(docs.map((d) => d.userId).filter(Boolean)))
    const userMap: Record<string, { displayName: string; pictureUrl: string | null }> = {}
    if (userIds.length > 0) {
      const refs = userIds.map((id) => db.collection('users').doc(id))
      const userDocs = await db.getAll(...refs)
      userDocs.forEach((doc) => {
        if (doc.exists) {
          const data = doc.data()!
          userMap[doc.id] = {
            displayName: data.displayName ?? '',
            pictureUrl: data.pictureUrl ?? null,
          }
        }
      })
    }

    const reservations = docs.map((d) => ({
      id: d.id,
      userId: d.userId,
      userDisplayName: userMap[d.userId]?.displayName ?? '',
      userPictureUrl:  userMap[d.userId]?.pictureUrl  ?? null,
      bandName: d.bandName,
      date: d.date,
      status: d.status,
      order: d.order,
      createdAt: d.createdAt?.toMillis?.() ?? null,
    }))

    return res.status(200).json({ reservations, count: reservations.length })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

// ─── 管理者一覧 ───────────────────────────────────────
async function handleAdminsList(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' })
  try {
    await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }
  const snapshot = await db.collection('admins').get()
  const adminIds = snapshot.docs.map((d) => d.id)
  const userDocs = adminIds.length > 0
    ? await db.getAll(...adminIds.map((id) => db.collection('users').doc(id)))
    : []
  const pictureMap: Record<string, string | null> = {}
  userDocs.forEach((d) => { pictureMap[d.id] = d.exists ? (d.data()?.pictureUrl ?? null) : null })

  const admins = snapshot.docs.map((d) => {
    const data = d.data()
    return {
      userId: d.id,
      displayName: data.displayName ?? '',
      pictureUrl: pictureMap[d.id] ?? null,
      isSuperAdmin: data.isSuperAdmin === true,
      addedAt: data.addedAt?.toMillis?.() ?? null,
      addedBy: data.addedBy ?? null,
    }
  }).sort((a, b) => {
    // スーパー管理者を先頭、その後 addedAt 順
    if (a.isSuperAdmin !== b.isSuperAdmin) return a.isSuperAdmin ? -1 : 1
    return (a.addedAt ?? 0) - (b.addedAt ?? 0)
  })
  return res.status(200).json({ admins })
}

// ─── 管理者の削除 ─────────────────────────────────────
async function handleAdminById(req: VercelRequest, res: VercelResponse, targetId: string) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method Not Allowed' })
  let me: AuditActor
  try {
    me = await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }
  if (me.userId === targetId) {
    return res.status(400).json({ error: '自分自身は削除できません' })
  }
  const target = await db.collection('admins').doc(targetId).get()
  if (!target.exists) return res.status(404).json({ error: '管理者が見つかりません' })
  if (target.data()?.isSuperAdmin === true) {
    return res.status(403).json({ error: 'スーパー管理者は削除できません' })
  }
  const targetLabel = target.data()?.displayName ?? ''
  await db.collection('admins').doc(targetId).delete()
  await audit(me, 'admin.remove', { targetType: 'admin', targetId, targetLabel })
  return res.status(200).json({ success: true })
}

// ─── スーパー管理者の移譲 ─────────────────────────────
async function handleTransferSuper(req: VercelRequest, res: VercelResponse, targetId: string) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })
  let me: AuditActor & { isSuperAdmin?: boolean }
  try {
    me = await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }
  if (!me.isSuperAdmin) {
    return res.status(403).json({ error: 'スーパー管理者のみが移譲できます' })
  }
  if (me.userId === targetId) {
    return res.status(400).json({ error: '自分自身には移譲できません' })
  }

  let targetLabel = ''
  try {
    await db.runTransaction(async (tx) => {
      const meRef = db.collection('admins').doc(me.userId)
      const targetRef = db.collection('admins').doc(targetId)
      const [meDoc, targetDoc] = await Promise.all([tx.get(meRef), tx.get(targetRef)])
      if (!meDoc.exists || meDoc.data()?.isSuperAdmin !== true) {
        throw new Error('スーパー管理者ではありません')
      }
      if (!targetDoc.exists) {
        throw new Error('移譲先の管理者が見つかりません')
      }
      targetLabel = targetDoc.data()?.displayName ?? ''
      tx.update(meRef,     { isSuperAdmin: admin.firestore.FieldValue.delete() })
      tx.update(targetRef, { isSuperAdmin: true })
    })
  } catch (err: any) {
    return res.status(400).json({ error: err.message })
  }

  await audit(me, 'admin.super.transfer', {
    targetType: 'admin', targetId, targetLabel,
    details: { from: me.userId, to: targetId },
  })
  return res.status(200).json({ success: true })
}

// ─── 招待の発行・一覧 ─────────────────────────────────
async function handleInvitations(req: VercelRequest, res: VercelResponse) {
  let me: AuditActor
  try {
    me = await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }

  if (req.method === 'POST') {
    const token = crypto.randomBytes(24).toString('hex')
    const now = new Date()
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    await db.collection('invitations').doc(token).set({
      createdBy: me.userId,
      createdAt: now,
      expiresAt,
      used: false,
    })
    await audit(me, 'invitation.create', { targetType: 'invitation', targetId: token })
    const baseUrl = `https://${req.headers.host}`
    return res.status(201).json({
      token,
      url: `${baseUrl}/api/admin/invite?token=${token}`,
      expiresAt: expiresAt.toISOString(),
    })
  }

  if (req.method === 'GET') {
    const snapshot = await db.collection('invitations').orderBy('createdAt', 'desc').limit(50).get()
    const invitations = snapshot.docs.map((d) => {
      const data = d.data()
      return {
        token: d.id,
        createdBy: data.createdBy ?? null,
        createdAt: data.createdAt?.toMillis?.() ?? null,
        expiresAt: data.expiresAt?.toMillis?.() ?? null,
        used: data.used ?? false,
        usedBy: data.usedBy ?? null,
      }
    })
    return res.status(200).json({ invitations })
  }

  return res.status(405).json({ error: 'Method Not Allowed' })
}

// ─── 招待の取消 ───────────────────────────────────────
async function handleInvitationById(req: VercelRequest, res: VercelResponse, token: string) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method Not Allowed' })
  let me: AuditActor
  try {
    me = await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }
  await db.collection('invitations').doc(token).delete()
  await audit(me, 'invitation.revoke', { targetType: 'invitation', targetId: token })
  return res.status(200).json({ success: true })
}

// ─── 時間枠プリセット ─────────────────────────────────
async function handleTimeSlotPresets(req: VercelRequest, res: VercelResponse) {
  let me: AuditActor
  try {
    me = await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }

  if (req.method === 'GET') {
    const snapshot = await db.collection('timeSlotPresets').orderBy('createdAt', 'desc').get()
    const presets = snapshot.docs.map((d) => {
      const data = d.data()
      return {
        id: d.id,
        name: data.name,
        timeSlots: data.timeSlots,
        createdAt: data.createdAt?.toMillis?.() ?? null,
      }
    })
    return res.status(200).json({ presets })
  }

  if (req.method === 'POST') {
    const { name, timeSlots } = (req.body ?? {}) as { name?: string; timeSlots?: any }
    if (!name || !name.trim()) return res.status(400).json({ error: '名前を入力してください' })
    const validated = validateTimeSlots(timeSlots, 'プリセットの')
    if (typeof validated === 'string') return res.status(400).json({ error: validated })

    const docRef = await db.collection('timeSlotPresets').add({
      name: name.trim(),
      timeSlots: validated,
      createdAt: new Date(),
      createdBy: me.userId,
    })
    await audit(me, 'preset.create', { targetType: 'preset', targetId: docRef.id, targetLabel: name.trim() })
    return res.status(201).json({ id: docRef.id })
  }

  return res.status(405).json({ error: 'Method Not Allowed' })
}

async function handleTimeSlotPresetById(req: VercelRequest, res: VercelResponse, id: string) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method Not Allowed' })
  let me: AuditActor
  try {
    me = await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }
  const doc = await db.collection('timeSlotPresets').doc(id).get()
  const label = doc.exists ? (doc.data()?.name ?? '') : ''
  await db.collection('timeSlotPresets').doc(id).delete()
  await audit(me, 'preset.delete', { targetType: 'preset', targetId: id, targetLabel: label })
  return res.status(200).json({ success: true })
}

// ─── ダッシュボード（統計＋直近データを集約） ─────────
async function handleDashboard(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' })
  try {
    await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }

  try {
    const nowJST = new Date(Date.now() + 9 * 60 * 60 * 1000)
    const todayStr = nowJST.toISOString().slice(0, 10)
    const in7Days = new Date(nowJST); in7Days.setUTCDate(nowJST.getUTCDate() + 7)
    const in7DaysStr = in7Days.toISOString().slice(0, 10)

    const [resSnap, kobuSnap, nobuRoomSnap, usersSnap, adminsSnap, logsSnap] = await Promise.all([
      db.collection('reservations').where('date', '>=', `${todayStr}T00:00`).get(),
      db.collection('kobu_reservations').where('date', '>=', todayStr).where('date', '<=', in7DaysStr).get(),
      db.collection('nobu_room_reservations').where('date', '>=', todayStr).where('date', '<=', in7DaysStr).get(),
      db.collection('users').get(),
      db.collection('admins').get(),
      db.collection('auditLogs').orderBy('createdAt', 'desc').limit(8).get(),
    ])

    // 農部生協 統計
    const nobuAll = resSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any))
    const pendingCount   = nobuAll.filter((r) => r.status === 'pending').length
    const confirmedCount = nobuAll.filter((r) => r.status === 'confirmed').length
    const nobuToday      = nobuAll.filter((r) => (r.date ?? '').startsWith(todayStr)).length
    const bannedCount    = usersSnap.docs.filter((d) => d.data().banned === true).length

    // 工部室・農部室 統計
    const kobuAll      = kobuSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any))
    const kobuToday    = kobuAll.filter((r) => r.date === todayStr).length
    const kobuWeek     = kobuAll.length

    const nobuRoomAll  = nobuRoomSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any))
    const nobuRoomToday = nobuRoomAll.filter((r) => r.date === todayStr).length
    const nobuRoomWeek  = nobuRoomAll.length

    // 全施設の直近予約（7日以内・最大10件）を合体してソート
    const nobuUpcoming = nobuAll
      .filter((r) => (r.date ?? '').split('T')[0] <= in7DaysStr)
      .map((r) => ({ ...r, facility: 'nobu' as const, sortKey: r.date ?? '' }))

    const kobuUpcoming = kobuAll
      .map((r) => ({ ...r, facility: 'kobu' as const, sortKey: `${r.date}T${r.startTime ?? ''}` }))

    const nobuRoomUpcoming = nobuRoomAll
      .map((r) => ({ ...r, facility: 'nobu-room' as const, sortKey: `${r.date}T${r.startTime ?? ''}` }))

    const allUpcomingRaw = [...nobuUpcoming, ...kobuUpcoming, ...nobuRoomUpcoming]
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
      .slice(0, 10)

    // ユーザー名を結合（全施設分）
    const allUserIds = Array.from(new Set(allUpcomingRaw.map((r) => r.userId).filter(Boolean)))
    const userMap: Record<string, { displayName: string; pictureUrl: string | null }> = {}
    if (allUserIds.length > 0) {
      const refs = allUserIds.map((id) => db.collection('users').doc(id))
      const userDocs = await db.getAll(...refs)
      userDocs.forEach((d) => {
        if (d.exists) {
          userMap[d.id] = {
            displayName: d.data()?.displayName ?? '',
            pictureUrl: d.data()?.pictureUrl ?? null,
          }
        }
      })
    }

    const upcoming = allUpcomingRaw.map((r) => ({
      id:              r.id,
      facility:        r.facility,
      bandName:        r.bandName,
      date:            r.date,
      startTime:       r.startTime,
      endTime:         r.endTime,
      status:          r.status,
      order:           r.order,
      userDisplayName: userMap[r.userId]?.displayName ?? '',
      userPictureUrl:  userMap[r.userId]?.pictureUrl  ?? null,
    }))

    // 農部生協の適用予定設定変更
    const pendingChange = await getPendingReservationSettingsChange(db)

    // 最近のログ
    const recentLogs = logsSnap.docs.map((d) => {
      const data = d.data()
      return {
        id: d.id,
        actorDisplayName: data.actorDisplayName,
        action: data.action,
        targetLabel: data.targetLabel,
        createdAt: data.createdAt?.toMillis?.() ?? null,
      }
    })

    return res.status(200).json({
      stats: {
        nobu:    { pending: pendingCount, confirmed: confirmedCount, today: nobuToday },
        kobu:    { today: kobuToday,    week: kobuWeek },
        nobuRoom:{ today: nobuRoomToday, week: nobuRoomWeek },
        users:   { total: usersSnap.size, banned: bannedCount },
        adminCount: adminsSnap.size,
      },
      upcoming,
      pendingChange: pendingChange ? {
        availableDays: pendingChange.availableDays ?? [],
        effectiveFrom: pendingChange.effectiveFrom ?? null,
      } : null,
      recentLogs,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

// ─── 監査ログ一覧（GET のみ。削除エンドポイントなし） ──
async function handleLogs(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' })
  try {
    await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }

  const { action, actor, before, limit } = req.query as {
    action?: string; actor?: string; before?: string; limit?: string
  }
  const pageSize = Math.min(Math.max(parseInt(limit ?? '50', 10) || 50, 1), 200)

  try {
    let query: FirebaseFirestore.Query = db.collection('auditLogs').orderBy('createdAt', 'desc')
    if (action) query = query.where('action', '==', action)
    if (actor)  query = query.where('actorUserId', '==', actor)
    if (before) {
      const beforeDate = new Date(Number(before))
      if (!isNaN(beforeDate.getTime())) {
        query = query.where('createdAt', '<', beforeDate)
      }
    }
    const snapshot = await query.limit(pageSize + 1).get()
    const docs = snapshot.docs.slice(0, pageSize)
    const hasMore = snapshot.docs.length > pageSize

    const logs = docs.map((d) => {
      const data = d.data()
      return {
        id: d.id,
        actorUserId: data.actorUserId,
        actorDisplayName: data.actorDisplayName,
        action: data.action,
        targetType: data.targetType,
        targetId: data.targetId,
        targetLabel: data.targetLabel,
        details: data.details,
        createdAt: data.createdAt?.toMillis?.() ?? null,
      }
    })

    return res.status(200).json({
      logs,
      hasMore,
      nextBefore: hasMore && logs.length > 0 ? logs[logs.length - 1].createdAt : null,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

// ─── 招待リンクからの参加（OAuth開始） ────────────────
async function handleInviteAccept(req: VercelRequest, res: VercelResponse) {
  const token = req.query.token as string
  const baseUrl = `https://${req.headers.host}`
  const loginUrl = `${baseUrl}/admin/login`

  if (!token) return res.redirect(302, `${loginUrl}?error=invalid`)

  // トークン検証
  const invDoc = await db.collection('invitations').doc(token).get()
  if (!invDoc.exists) return res.redirect(302, `${loginUrl}?error=invalid_invitation`)
  const data = invDoc.data()!
  if (data.used) return res.redirect(302, `${loginUrl}?error=invitation_used`)
  if (data.expiresAt?.toMillis?.() <= Date.now()) {
    return res.redirect(302, `${loginUrl}?error=invitation_expired`)
  }

  // 招待トークンと OAuth state を Cookie に保存して OAuth 開始
  const state = crypto.randomBytes(16).toString('hex')
  const redirectUri = `${baseUrl}/api/admin/auth/callback`
  res.setHeader('Set-Cookie', [
    `admin_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`,
    `admin_invitation=${token}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`,
  ])

  const authUrl = new URL('https://access.line.me/oauth2/v2.1/authorize')
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', process.env.LINE_LOGIN_CHANNEL_ID!)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('scope', 'openid profile')

  res.redirect(302, authUrl.toString())
}

// ─── ユーザー一覧 ─────────────────────────────────
async function handleUsersList(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' })
  try {
    await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }

  try {
    const [usersSnap, adminsSnap] = await Promise.all([
      db.collection('users').get(),
      db.collection('admins').get(),
    ])
    const adminIds = new Set(adminsSnap.docs.map((d) => d.id))
    const users = usersSnap.docs.map((d) => {
      const data = d.data()
      return {
        userId: d.id,
        displayName: data.displayName ?? '',
        pictureUrl: data.pictureUrl ?? null,
        banned: data.banned ?? false,
        isAdmin: adminIds.has(d.id),
        lastReservedAt: data.lastReservedAt?.toMillis?.() ?? null,
      }
    })
    users.sort((a, b) => (b.lastReservedAt ?? 0) - (a.lastReservedAt ?? 0))
    return res.status(200).json({ users })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

// ─── ユーザー詳細＋予約履歴 / BAN更新 ────────────────
async function handleUserById(req: VercelRequest, res: VercelResponse, userId: string) {
  let me: AuditActor
  try {
    me = await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }

  const userRef = db.collection('users').doc(userId)

  if (req.method === 'GET') {
    const [userDoc, resSnap, kobuSnap, nobuRoomSnap, adminDoc] = await Promise.all([
      userRef.get(),
      db.collection('reservations').where('userId', '==', userId).get(),
      db.collection('kobu_reservations').where('userId', '==', userId).get(),
      db.collection('nobu_room_reservations').where('userId', '==', userId).get(),
      db.collection('admins').doc(userId).get(),
    ])
    if (!userDoc.exists) return res.status(404).json({ error: 'ユーザーが見つかりません' })
    const data = userDoc.data()!
    const nobuReservations = resSnap.docs
      .map((d) => ({ id: d.id, ...d.data() } as any))
      .map((r) => ({ id: r.id, facility: 'nobu' as const, bandName: r.bandName, date: r.date, status: r.status, order: r.order }))
    const kobuReservations = kobuSnap.docs
      .map((d) => ({ id: d.id, ...d.data() } as any))
      .map((r) => ({ id: r.id, facility: 'kobu' as const, bandName: r.bandName, date: r.date, startTime: r.startTime, endTime: r.endTime, status: r.status }))
    const nobuRoomReservations = nobuRoomSnap.docs
      .map((d) => ({ id: d.id, ...d.data() } as any))
      .map((r) => ({ id: r.id, facility: 'nobu-room' as const, bandName: r.bandName, date: r.date, startTime: r.startTime, endTime: r.endTime, status: r.status }))
    const reservations = [...nobuReservations, ...kobuReservations, ...nobuRoomReservations]
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    return res.status(200).json({
      user: {
        userId,
        displayName: data.displayName ?? '',
        pictureUrl: data.pictureUrl ?? null,
        banned: data.banned ?? false,
        isAdmin: adminDoc.exists,
        lastReservedAt: data.lastReservedAt?.toMillis?.() ?? null,
      },
      reservations,
    })
  }

  if (req.method === 'PUT') {
    const { banned } = (req.body ?? {}) as { banned?: boolean }
    if (typeof banned !== 'boolean') return res.status(400).json({ error: '不正なリクエスト' })
    if (banned) {
      const adminDoc = await db.collection('admins').doc(userId).get()
      if (adminDoc.exists) {
        return res.status(400).json({ error: '管理者はBANできません' })
      }
    }
    const targetSnap = await userRef.get()
    const targetLabel = targetSnap.exists ? (targetSnap.data()?.displayName ?? '') : ''
    await userRef.set({ banned }, { merge: true })
    await audit(me, banned ? 'user.ban' : 'user.unban', {
      targetType: 'user', targetId: userId, targetLabel,
    })
    return res.status(200).json({ success: true })
  }

  return res.status(405).json({ error: 'Method Not Allowed' })
}

// ─── 予約の編集・削除 ─────────────────────────────────
async function handleReservationById(req: VercelRequest, res: VercelResponse, id: string) {
  let me: AuditActor
  try {
    me = await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }

  const docRef = db.collection('reservations').doc(id)
  const doc = await docRef.get()
  if (!doc.exists) return res.status(404).json({ error: '予約が見つかりません' })
  const before = doc.data()!

  if (req.method === 'PUT') {
    const { bandName, date } = (req.body ?? {}) as { bandName?: string; date?: string }
    const update: Record<string, any> = {}
    if (typeof bandName === 'string' && bandName.trim()) update.bandName = bandName.trim()
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}-\d{2}:\d{2}$/.test(date)) {
      update.date = date
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: '更新項目がありません' })
    }

    // 編集後の bandName と date を確定し、同日同名の重複チェック（自分自身は除外）
    const finalBandName = (update.bandName ?? before.bandName) as string
    const finalDate     = (update.date     ?? before.date)     as string
    const finalDateOnly = finalDate.split('T')[0]
    const dupSnap = await db.collection('reservations')
      .where('bandName', '==', finalBandName)
      .where('date', '>=', `${finalDateOnly}T00:00`)
      .where('date', '<=', `${finalDateOnly}T23:59`)
      .get()
    const conflict = dupSnap.docs.find((d) => d.id !== id)
    if (conflict) {
      return res.status(400).json({
        error: `${finalDateOnly} には「${finalBandName}」が既に登録されています`,
      })
    }

    await docRef.update(update)
    await audit(me, 'reservation.update', {
      targetType: 'reservation', targetId: id, targetLabel: before.bandName,
      details: { before: { bandName: before.bandName, date: before.date }, after: update },
    })
    return res.status(200).json({ success: true })
  }

  if (req.method === 'DELETE') {
    await docRef.delete()
    await audit(me, 'reservation.delete', {
      targetType: 'reservation', targetId: id, targetLabel: before.bandName,
      details: { bandName: before.bandName, date: before.date, userId: before.userId, status: before.status },
    })
    return res.status(200).json({ success: true })
  }

  return res.status(405).json({ error: 'Method Not Allowed' })
}

// ─── 工部室 予約一覧 ─────────────────────────────────
async function handleKobuReservationsList(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' })
  try {
    await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }

  const { date, q } = req.query as { date?: string; q?: string }
  try {
    let query: FirebaseFirestore.Query = db.collection('kobu_reservations')
    if (date) query = query.where('date', '==', date)
    const snap = await query.get()

    let docs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any))
    if (q) {
      const lower = q.toLowerCase()
      docs = docs.filter((r) => (r.bandName ?? '').toLowerCase().includes(lower))
    }
    docs.sort((a: any, b: any) =>
      a.date !== b.date
        ? (a.date ?? '').localeCompare(b.date ?? '')
        : (a.startTime ?? '').localeCompare(b.startTime ?? '')
    )

    const userIds = Array.from(new Set(docs.map((r) => r.userId).filter(Boolean)))
    const userMap: Record<string, { displayName: string; pictureUrl: string | null }> = {}
    if (userIds.length > 0) {
      const userDocs = await db.getAll(...userIds.map((id) => db.collection('users').doc(id)))
      userDocs.forEach((d) => {
        if (d.exists) userMap[d.id] = { displayName: d.data()?.displayName ?? '', pictureUrl: d.data()?.pictureUrl ?? null }
      })
    }

    const reservations = docs.map((r) => ({
      id: r.id, userId: r.userId,
      bandName: r.bandName, date: r.date, startTime: r.startTime, endTime: r.endTime,
      status: r.status, createdAt: r.createdAt?.toMillis?.() ?? null,
      userDisplayName: userMap[r.userId]?.displayName ?? '',
      userPictureUrl:  userMap[r.userId]?.pictureUrl  ?? null,
    }))
    return res.status(200).json({ reservations })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

// ─── 工部室 予約の編集・削除 ──────────────────────────
async function handleKobuReservationById(req: VercelRequest, res: VercelResponse, id: string) {
  let me: AuditActor
  try {
    me = await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }

  const docRef = db.collection('kobu_reservations').doc(id)
  const doc = await docRef.get()
  if (!doc.exists) return res.status(404).json({ error: '予約が見つかりません' })
  const before = doc.data()!

  if (req.method === 'PUT') {
    const { bandName, date, startTime, endTime } = (req.body ?? {}) as {
      bandName?: string; date?: string; startTime?: string; endTime?: string
    }
    const update: Record<string, any> = {}
    if (typeof bandName === 'string' && bandName.trim()) update.bandName = bandName.trim()
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) update.date = date
    if (typeof startTime === 'string') update.startTime = startTime
    if (typeof endTime === 'string')   update.endTime   = endTime
    if (Object.keys(update).length === 0) return res.status(400).json({ error: '更新項目がありません' })

    const finalDate      = update.date      ?? before.date
    const finalStartTime = update.startTime ?? before.startTime
    const finalEndTime   = update.endTime   ?? before.endTime

    if (finalStartTime >= finalEndTime) {
      return res.status(400).json({ error: '開始時刻は終了時刻より前にしてください' })
    }

    const existingSnap = await db.collection('kobu_reservations').where('date', '==', finalDate).get()
    for (const d of existingSnap.docs) {
      if (d.id === id) continue
      const data = d.data()
      if (finalStartTime < data.endTime && data.startTime < finalEndTime) {
        return res.status(400).json({ error: `${data.startTime}〜${data.endTime} に既に予約が入っています` })
      }
    }

    await docRef.update(update)
    await audit(me, 'kobu_reservation.update', {
      targetType: 'kobu_reservation', targetId: id, targetLabel: before.bandName,
      details: { before: { bandName: before.bandName, date: before.date, startTime: before.startTime, endTime: before.endTime }, after: update },
    })
    return res.status(200).json({ success: true })
  }

  if (req.method === 'DELETE') {
    await docRef.delete()
    await audit(me, 'kobu_reservation.delete', {
      targetType: 'kobu_reservation', targetId: id, targetLabel: before.bandName,
      details: { bandName: before.bandName, date: before.date, startTime: before.startTime, endTime: before.endTime },
    })
    return res.status(200).json({ success: true })
  }

  return res.status(405).json({ error: 'Method Not Allowed' })
}

// ─── 工部室 設定の取得・更新 ───────────────────────────
async function handleKobuSettings(req: VercelRequest, res: VercelResponse) {
  let me: AuditActor
  try {
    me = await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }

  const DEFAULTS = {
    availableDays:  [0, 1, 2, 3, 4, 5, 6] as number[],
    extraDates:     [] as string[],
    excludedDates:  [] as string[],
    timeSlots:      [{ label: '8:00~20:00', value: '08:00-20:00' }] as TimeSlot[],
    perDaySchedule: { enabled: false, byWeekday: {} as Record<string, TimeSlot[]>, byDate: {} as Record<string, TimeSlot[]> },
  }

  if (req.method === 'GET') {
    const [doc, scheduledChanges] = await Promise.all([
      db.collection('settings').doc('kobu').get(),
      listPendingFacilitySettingsChanges(db, 'kobu', todayJST()),
    ])
    const data = doc.exists ? doc.data()! : {}

    // 旧形式（openTime/closeTime）から新形式（timeSlots）へ自動移行
    let timeSlots = data.timeSlots as TimeSlot[] | undefined
    if (!timeSlots && (data.openTime || data.closeTime)) {
      const open  = data.openTime  ?? '08:00'
      const close = data.closeTime ?? '20:00'
      timeSlots = [{ label: `${open}〜${close}`, value: `${open}-${close}` }]
    }

    return res.status(200).json({
      availableDays:   data.availableDays  ?? DEFAULTS.availableDays,
      extraDates:      data.extraDates     ?? DEFAULTS.extraDates,
      excludedDates:   data.excludedDates  ?? DEFAULTS.excludedDates,
      timeSlots:       (timeSlots ?? DEFAULTS.timeSlots).filter((s: any) => !s.deleted),
      perDaySchedule:  data.perDaySchedule ?? DEFAULTS.perDaySchedule,
      scheduledChanges,
    })
  }

  if (req.method === 'PUT') {
    const { availableDays, extraDates, excludedDates, timeSlots, perDaySchedule, effectiveFrom } = (req.body ?? {}) as {
      availableDays?: number[]; extraDates?: string[]; excludedDates?: string[];
      timeSlots?: TimeSlot[]; perDaySchedule?: PerDaySchedule; effectiveFrom?: string
    }

    if (!Array.isArray(availableDays) || !availableDays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
      return res.status(400).json({ error: '利用可能曜日が不正です' })
    }
    if (!Array.isArray(extraDates) || !Array.isArray(excludedDates)) {
      return res.status(400).json({ error: '日付リストが不正です' })
    }
    if (!Array.isArray(timeSlots) || timeSlots.length === 0) {
      return res.status(400).json({ error: '営業時間枠を1つ以上指定してください' })
    }
    if (!effectiveFrom || !isValidDate(effectiveFrom)) {
      return res.status(400).json({ error: '適用日を指定してください' })
    }
    if (effectiveFrom < todayJST()) {
      return res.status(400).json({ error: '適用日は今日以降を指定してください' })
    }

    await db.collection('settings').doc('kobu').collection('versions').doc(effectiveFrom).set({
      availableDays,
      extraDates:     extraDates    ?? [],
      excludedDates:  excludedDates ?? [],
      timeSlots,
      perDaySchedule: perDaySchedule ?? DEFAULTS.perDaySchedule,
      effectiveFrom,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: me.userId,
    })

    await audit(me, 'kobu_settings.schedule', {
      targetType: 'settings', targetId: 'kobu',
      details: {
        effectiveFrom,
        availableDays,
        timeSlotsCount:     timeSlots.length,
        extraDatesCount:    (extraDates    ?? []).length,
        excludedDatesCount: (excludedDates ?? []).length,
        perDayEnabled:      perDaySchedule?.enabled ?? false,
      },
    })
    return res.status(200).json({ applied: 'scheduled', effectiveFrom })
  }

  return res.status(405).json({ error: 'Method Not Allowed' })
}

// ─── 農部室 予約一覧 ──────────────────────────────────
async function handleNobuRoomReservationsList(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' })
  try {
    await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }

  const { date, q } = req.query as { date?: string; q?: string }
  try {
    let query: FirebaseFirestore.Query = db.collection('nobu_room_reservations')
    if (date) query = query.where('date', '==', date)
    const snap = await query.get()

    let docs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any))
    if (q) {
      const lower = q.toLowerCase()
      docs = docs.filter((r) => (r.bandName ?? '').toLowerCase().includes(lower))
    }
    docs.sort((a: any, b: any) =>
      a.date !== b.date
        ? (a.date ?? '').localeCompare(b.date ?? '')
        : (a.startTime ?? '').localeCompare(b.startTime ?? '')
    )

    const userIds = Array.from(new Set(docs.map((r) => r.userId).filter(Boolean)))
    const userMap: Record<string, { displayName: string; pictureUrl: string | null }> = {}
    if (userIds.length > 0) {
      const userDocs = await db.getAll(...userIds.map((id) => db.collection('users').doc(id)))
      userDocs.forEach((d) => {
        if (d.exists) userMap[d.id] = { displayName: d.data()?.displayName ?? '', pictureUrl: d.data()?.pictureUrl ?? null }
      })
    }

    const reservations = docs.map((r) => ({
      id: r.id, userId: r.userId,
      bandName: r.bandName, date: r.date, startTime: r.startTime, endTime: r.endTime,
      status: r.status, createdAt: r.createdAt?.toMillis?.() ?? null,
      userDisplayName: userMap[r.userId]?.displayName ?? '',
      userPictureUrl:  userMap[r.userId]?.pictureUrl  ?? null,
    }))
    return res.status(200).json({ reservations })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

// ─── 農部室 予約の編集・削除 ──────────────────────────
async function handleNobuRoomReservationById(req: VercelRequest, res: VercelResponse, id: string) {
  let me: AuditActor
  try {
    me = await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }

  const docRef = db.collection('nobu_room_reservations').doc(id)
  const doc = await docRef.get()
  if (!doc.exists) return res.status(404).json({ error: '予約が見つかりません' })
  const before = doc.data()!

  if (req.method === 'PUT') {
    const { bandName, date, startTime, endTime } = (req.body ?? {}) as {
      bandName?: string; date?: string; startTime?: string; endTime?: string
    }
    const update: Record<string, any> = {}
    if (typeof bandName === 'string' && bandName.trim()) update.bandName = bandName.trim()
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) update.date = date
    if (typeof startTime === 'string') update.startTime = startTime
    if (typeof endTime === 'string')   update.endTime   = endTime
    if (Object.keys(update).length === 0) return res.status(400).json({ error: '更新項目がありません' })

    const finalDate      = update.date      ?? before.date
    const finalStartTime = update.startTime ?? before.startTime
    const finalEndTime   = update.endTime   ?? before.endTime

    if (finalStartTime >= finalEndTime) {
      return res.status(400).json({ error: '開始時刻は終了時刻より前にしてください' })
    }

    const existingSnap = await db.collection('nobu_room_reservations').where('date', '==', finalDate).get()
    for (const d of existingSnap.docs) {
      if (d.id === id) continue
      const data = d.data()
      if (finalStartTime < data.endTime && data.startTime < finalEndTime) {
        return res.status(400).json({ error: `${data.startTime}〜${data.endTime} に既に予約が入っています` })
      }
    }

    await docRef.update(update)
    await audit(me, 'nobu_room_reservation.update', {
      targetType: 'nobu_room_reservation', targetId: id, targetLabel: before.bandName,
      details: { before: { bandName: before.bandName, date: before.date, startTime: before.startTime, endTime: before.endTime }, after: update },
    })
    return res.status(200).json({ success: true })
  }

  if (req.method === 'DELETE') {
    await docRef.delete()
    await audit(me, 'nobu_room_reservation.delete', {
      targetType: 'nobu_room_reservation', targetId: id, targetLabel: before.bandName,
      details: { bandName: before.bandName, date: before.date, startTime: before.startTime, endTime: before.endTime },
    })
    return res.status(200).json({ success: true })
  }

  return res.status(405).json({ error: 'Method Not Allowed' })
}

// ─── 農部室 設定の取得・更新 ───────────────────────────
async function handleNobuRoomSettings(req: VercelRequest, res: VercelResponse) {
  let me: AuditActor
  try {
    me = await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }

  const NR_DEFAULTS = {
    availableDays:  [0, 1, 2, 3, 4, 5, 6] as number[],
    extraDates:     [] as string[],
    excludedDates:  [] as string[],
    timeSlots:      [{ label: '8:00~20:00', value: '08:00-20:00' }] as TimeSlot[],
    perDaySchedule: { enabled: false, byWeekday: {} as Record<string, TimeSlot[]>, byDate: {} as Record<string, TimeSlot[]> },
  }

  if (req.method === 'GET') {
    const [doc, scheduledChanges] = await Promise.all([
      db.collection('settings').doc('nobu-room').get(),
      listPendingFacilitySettingsChanges(db, 'nobu-room', todayJST()),
    ])
    const data = doc.exists ? doc.data()! : {}

    let timeSlots = data.timeSlots as TimeSlot[] | undefined
    if (!timeSlots && (data.openTime || data.closeTime)) {
      const open  = data.openTime  ?? '08:00'
      const close = data.closeTime ?? '20:00'
      timeSlots = [{ label: `${open}〜${close}`, value: `${open}-${close}` }]
    }

    return res.status(200).json({
      availableDays:   data.availableDays  ?? NR_DEFAULTS.availableDays,
      extraDates:      data.extraDates     ?? NR_DEFAULTS.extraDates,
      excludedDates:   data.excludedDates  ?? NR_DEFAULTS.excludedDates,
      timeSlots:       (timeSlots ?? NR_DEFAULTS.timeSlots).filter((s: any) => !s.deleted),
      perDaySchedule:  data.perDaySchedule ?? NR_DEFAULTS.perDaySchedule,
      scheduledChanges,
    })
  }

  if (req.method === 'PUT') {
    const { availableDays, extraDates, excludedDates, timeSlots, perDaySchedule, effectiveFrom } = (req.body ?? {}) as {
      availableDays?: number[]; extraDates?: string[]; excludedDates?: string[];
      timeSlots?: TimeSlot[]; perDaySchedule?: PerDaySchedule; effectiveFrom?: string
    }

    if (!Array.isArray(availableDays) || !availableDays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
      return res.status(400).json({ error: '利用可能曜日が不正です' })
    }
    if (!Array.isArray(extraDates) || !Array.isArray(excludedDates)) {
      return res.status(400).json({ error: '日付リストが不正です' })
    }
    if (!Array.isArray(timeSlots) || timeSlots.length === 0) {
      return res.status(400).json({ error: '営業時間枠を1つ以上指定してください' })
    }
    if (!effectiveFrom || !isValidDate(effectiveFrom)) {
      return res.status(400).json({ error: '適用日を指定してください' })
    }
    if (effectiveFrom < todayJST()) {
      return res.status(400).json({ error: '適用日は今日以降を指定してください' })
    }

    await db.collection('settings').doc('nobu-room').collection('versions').doc(effectiveFrom).set({
      availableDays,
      extraDates:     extraDates    ?? [],
      excludedDates:  excludedDates ?? [],
      timeSlots,
      perDaySchedule: perDaySchedule ?? NR_DEFAULTS.perDaySchedule,
      effectiveFrom,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: me.userId,
    })

    await audit(me, 'nobu_room_settings.schedule', {
      targetType: 'settings', targetId: 'nobu-room',
      details: {
        effectiveFrom,
        availableDays,
        timeSlotsCount:     timeSlots.length,
        extraDatesCount:    (extraDates    ?? []).length,
        excludedDatesCount: (excludedDates ?? []).length,
        perDayEnabled:      perDaySchedule?.enabled ?? false,
      },
    })
    return res.status(200).json({ applied: 'scheduled', effectiveFrom })
  }

  return res.status(405).json({ error: 'Method Not Allowed' })
}

// ─── 工部室・農部室 スケジュール変更キャンセル ────────────
async function handleFacilitySettingsScheduled(req: VercelRequest, res: VercelResponse, settingDocId: string) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method Not Allowed' })
  let me: AuditActor
  try {
    me = await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }

  const date = req.query.date as string | undefined
  if (!date || !isValidDate(date)) return res.status(400).json({ error: '日付を指定してください' })

  await db.collection('settings').doc(settingDocId).collection('versions').doc(date).delete()
  await audit(me, `${settingDocId.replace('-', '_')}_settings.scheduled.cancel`, {
    targetType: 'settings', targetId: settingDocId,
    details: { effectiveFrom: date },
  })
  return res.status(200).json({ success: true })
}