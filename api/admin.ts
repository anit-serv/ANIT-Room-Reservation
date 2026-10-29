import { isFirestoreQuotaError, DATABASE_QUOTA_MESSAGE, SERVICE_UNAVAILABLE_MESSAGE } from '../lib/serviceErrors'
import { prepareOperationPlans } from '../lib/operationPlanStore'
import type { PlanWarning, OperationImpact } from '../lib/operationPlan'
import { VercelRequest, VercelResponse } from '@vercel/node'
import * as admin from 'firebase-admin'
import * as crypto from 'crypto'
import axios from 'axios'
import { verifyAdmin } from '../lib/verifyAdmin'
import { applyLotteryCronSchedule } from '../lib/cronSchedule'
import { lotteryTargetDate, reservationDeadline } from '../lib/lotteryOperation'
import { notificationFollowsLottery, operationChangeOnExecutionDate, timingOverridesValid } from '../lib/lotteryTiming'
import { schedulerEnabled } from '../lib/schedulerQueue'
import { refreshScheduler, markSchedulerDirty } from '../lib/scheduler'
import { getRoomPreferenceConfig } from '../lib/roomPreference'
import { refreshLotterySlot } from '../lib/roomAllocation'
import roomHandler from '../lib/roomHandler'
import { roomManagerIds, roomManagerUpdate } from '../lib/roomManagerPermissions'
import {
  addDaysJST,
  BASE_EFFECTIVE_FROM,
  getPendingReservationSettingsChange,
  getReservationLotteryOverride,
  listFacilitySettingsVersions,
  listPendingFacilitySettingsChanges,
  listPendingReservationSettingsChanges,
  listReservationDayOverrides,
  listReservationLotteryOverrides,
  normalizeLotteryTimeOverrides,
  notificationTimeForDate,
  isDateAvailableBySettings,
  isTimeSlotAvailableBySettings,
  pickTimeSlotsForDate,
  pickNobuRoomTimeSlotsForDate,
  resolveReservationSettingsForDate,
  resolveReservationSettingsForDates,
  resolveFacilitySettingsForDate,
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
  if (path.startsWith('room/')) {
    req.query._path = path.slice('room/'.length)
    return roomHandler(req, res)
  }
  const segments = path.split('/').filter(Boolean)

  // 認証系（無認証アクセス可能）
  if (path === 'auth/start')    return handleAuthStart(req, res)
  if (path === 'auth/callback') return handleAuthCallback(req, res)
  if (path === 'auth/exchange') return handleAuthExchange(req, res)
  if (path === 'auth/me')       return handleAuthMe(req, res)

  // 設定
  if (path === 'settings/operation-preview' && req.method === 'POST') return handleSettings(req, res, true)
  if (path === 'settings')              return handleSettings(req, res)
  if (path === 'settings/scheduled')    return handleSettingsScheduled(req, res)
  if (path === 'settings/lottery-time') return handleSettingsLotteryTime(req, res)
  if (path === 'settings/lottery-operation') return handleSettingsLotteryOperation(req, res)
  if (path === 'settings/hamoani-period') return handleSettingsHamoaniPeriod(req, res)
  if (path === 'settings/time-slots')   return handleSettingsTimeSlots(req, res)
  if (path === 'settings/available-dates') return handleSettingsAvailableDates(req, res)
  if (segments[0] === 'settings' && segments[1] === 'day-overrides') {
    if (segments.length === 2) return handleSettingsDayOverrides(req, res)
    if (segments.length === 3) return handleSettingsDayOverrideByDate(req, res, segments[2])
  }
  if (segments[0] === 'settings' && segments[1] === 'lottery-overrides') {
    if (segments.length === 2) return handleSettingsLotteryOverrides(req, res)
    if (segments.length === 3) return handleSettingsLotteryOverrideByDate(req, res, segments[2])
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
    if (segments.length === 2 && segments[1] === 'transfer') return handleAdminTransfer(req, res)
    if (segments.length === 2 && segments[1] === 'transfer-link') return handleAdminTransferLink(req, res)
    if (segments.length === 2 && segments[1] === 'permission-link') return handleAdminPermissionLink(req, res)
    if (segments.length === 2 && segments[1] === 'permissions') return handleAdminPermissions(req, res)
    if (segments.length === 2) return handleAdminById(req, res, segments[1])
    if (segments.length === 3 && segments[2] === 'transfer-super') {
      return handleTransferSuper(req, res, segments[1])
    }
  }
  if (path === 'invite') return handleTransferInviteAccept(req, res)

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
  if (path === 'kobu-settings/available-dates') return handleFacilityAvailableDates(req, res, 'kobu')
  if (path === 'kobu-settings/time-slots') return handleFacilityTimeSlots(req, res, 'kobu')
  if (path === 'kobu-settings/scheduled') return handleFacilitySettingsScheduled(req, res, 'kobu')
  if (path === 'kobu-settings/presets') return handleFacilityTimePresets(req, res, 'kobu')

  // 農部室予約管理
  if (segments[0] === 'nobu-room-reservations') {
    if (segments.length === 1) return handleNobuRoomReservationsList(req, res)
    if (segments.length === 2) return handleNobuRoomReservationById(req, res, segments[1])
  }

  // 農部室設定
  if (path === 'nobu-room-settings') return handleNobuRoomSettings(req, res)
  if (path === 'nobu-room-settings/seikyo-blocks') return handleNobuRoomSeikyoBlocks(req, res)
  if (path === 'nobu-room-settings/available-dates') return handleFacilityAvailableDates(req, res, 'nobu-room')
  if (path === 'nobu-room-settings/time-slots') return handleFacilityTimeSlots(req, res, 'nobu-room')
  if (path === 'nobu-room-settings/scheduled') return handleFacilitySettingsScheduled(req, res, 'nobu-room')
  if (path === 'nobu-room-settings/presets') return handleFacilityTimePresets(req, res, 'nobu-room')

  // 監査ログ
  if (path === 'logs') return handleLogs(req, res)

  // ダッシュボード
  if (path === 'dashboard') return handleDashboard(req, res)

  return res.status(404).json({ error: 'Not Found' })
}

// ─── 一時認証コードを Firestore に保存してリダイレクト ──────
async function redirectWithAuthCode(
  res: VercelResponse,
  loginUrl: string,
  accessToken: string,
): Promise<VercelResponse> {
  const code = crypto.randomBytes(16).toString('hex')
  await db.collection('auth_codes').doc(code).set({
    accessToken,
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 60_000),
  })
  return res.redirect(302, `${loginUrl}?code=${encodeURIComponent(code)}`)
}

// ─── 一時コードとトークンを交換 ────────────────────────────
async function handleAuthExchange(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' })
  const code = req.query.code as string | undefined
  if (!code || !/^[0-9a-f]{32}$/.test(code)) {
    return res.status(400).json({ error: 'Invalid code' })
  }
  try {
    const docRef = db.collection('auth_codes').doc(code)
    const doc = await docRef.get()
    if (!doc.exists) {
      return res.status(401).json({ error: 'Invalid or expired code' })
    }
    const data = doc.data()!
    if (data.expiresAt.toMillis() < Date.now()) {
      await docRef.delete()
      return res.status(401).json({ error: 'Code expired' })
    }
    await docRef.delete()
    return res.status(200).json({ token: data.accessToken })
  } catch (err: any) {
    return res.status(503).json({ error: isFirestoreQuotaError(err) ? DATABASE_QUOTA_MESSAGE : SERVICE_UNAVAILABLE_MESSAGE })
  }
}

// ─── LINE Login OAuth 開始 ──────────────────────────────
function handleAuthStart(req: VercelRequest, res: VercelResponse) {
  const state = crypto.randomBytes(16).toString('hex')
  const role = req.query.role === 'room' ? 'room' : 'admin'
  const baseUrl = `https://${req.headers.host}`
  const redirectUri = `${baseUrl}/api/admin/auth/callback`

  res.setHeader(
    'Set-Cookie',
    [`admin_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`,
      `admin_oauth_role=${role}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`]
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
  const cookies = parseCookies(req.headers.cookie)
  const loginUrl = cookies.admin_oauth_role === 'room' ? `${baseUrl}/room/login` : `${baseUrl}/admin/login`

  try {
    const { code, state } = req.query as { code?: string; state?: string }
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
    if (lineName || linePicture || cookies.admin_invitation) {
      const userRef = db.collection('users').doc(userId)
      const userDoc = await userRef.get()
      const update: Record<string, any> = {}
      if (lineName)    update.displayName = lineName
      if (linePicture) update.pictureUrl  = linePicture
      if (!userDoc.exists) update.banned = false
      await userRef.set(update, { merge: true })
    }

    const clearCookies = [
      'admin_oauth_state=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/',
      'admin_oauth_role=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/',
      'admin_invitation=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/',
    ]
    res.setHeader('Set-Cookie', clearCookies)
    if (cookies.admin_invitation) {
      const authority = await redeemAuthorityInvitation(cookies.admin_invitation, userId, lineName ?? '')
      return redirectWithAuthCode(res, authority === 'room' ? `${baseUrl}/room/login` : `${baseUrl}/admin/login`, accessToken)
    }

    if (cookies.admin_oauth_role === 'room') {
      const [manager, adminDoc, user] = await Promise.all([
        db.collection('settings').doc('room-manager').get(),
        db.collection('admins').doc(userId).get(),
        db.collection('users').doc(userId).get(),
      ])
      if (user.data()?.banned === true || (!adminDoc.exists && !roomManagerIds(manager.data()).includes(userId))) {
        return res.redirect(302, `${loginUrl}?error=not_manager`)
      }
    } else {
      const adminDoc = await db.collection('admins').doc(userId).get()
      if (!adminDoc.exists) return res.redirect(302, `${loginUrl}?error=not_admin`)
    }
    return redirectWithAuthCode(res, loginUrl, accessToken)
  } catch (err) {
    const quota = isFirestoreQuotaError(err)
    console.error('OAuth callback failed', { reason: quota ? 'firestore_quota' : 'oauth_or_database_error',
      code: (err as any)?.code ?? null, status: (err as any)?.response?.status ?? null })
    return res.redirect(302, `${loginUrl}?error=${quota ? 'database_quota' : cookies.admin_invitation ? 'invalid_invitation' : 'invalid'}`)
  }
}

async function redeemAuthorityInvitation(token: string, userId: string, displayName: string): Promise<string> {
  const inviteRef = db.collection('invitations').doc(token)
  const targetUserRef = db.collection('users').doc(userId)
  const targetAdminRef = db.collection('admins').doc(userId)
  const managerRef = db.collection('settings').doc('room-manager')
  let authority = ''
  let sourceId = ''
  let operation = ''
  await db.runTransaction(async (tx) => {
    const invite = await tx.get(inviteRef)
    const data = invite.data()
    if (!invite.exists || !data || !['transfer', 'grant'].includes(data.kind) || data.used === true ||
        !data.expiresAt || data.expiresAt.toMillis() <= Date.now()) {
      throw new Error('移譲リンクが無効または使用済みです')
    }
    authority = data.authority
    sourceId = data.sourceId
    operation = data.kind === 'grant' ? 'add' : 'transfer'
    if (!['super', 'admin', 'room'].includes(authority) || !sourceId || sourceId === userId) {
      throw new Error('移譲リンクが無効です')
    }
    const [user, targetAdmin, sourceAdmin, actorAdmin, manager] = await Promise.all([
      tx.get(targetUserRef), tx.get(targetAdminRef),
      tx.get(db.collection('admins').doc(sourceId)),
      tx.get(db.collection('admins').doc(data.createdBy)), tx.get(managerRef),
    ])
    if (!user.exists || user.data()?.banned === true) throw new Error('利用停止中または未登録のユーザーには移譲できません')
    const targetLabel = user.data()?.displayName ?? displayName
    if (data.kind === 'grant') {
      if (!actorAdmin.exists || data.createdBy !== sourceId ||
          (authority === 'admin' && actorAdmin.data()?.isSuperAdmin !== true) ||
          !['admin', 'room'].includes(authority)) throw new Error('権限を追加できません')
      if (authority === 'admin') {
        if (targetAdmin.exists) throw new Error('既に管理者権限があります')
        tx.set(targetAdminRef, { displayName: targetLabel, addedAt: new Date(), addedBy: sourceId })
      } else {
        const ids = roomManagerIds(manager.data())
        if (ids.includes(userId)) throw new Error('既に部屋取り権限があります')
        tx.set(managerRef, roomManagerUpdate([...ids, userId], sourceId))
      }
    } else if (authority === 'super') {
      if (!sourceAdmin.exists || sourceAdmin.data()?.isSuperAdmin !== true || data.createdBy !== sourceId) {
        throw new Error('権限元のスーパー管理者が見つかりません')
      }
      tx.update(sourceAdmin.ref, { isSuperAdmin: admin.firestore.FieldValue.delete() })
      tx.set(targetAdminRef, { displayName: targetLabel, isSuperAdmin: true,
        ...(targetAdmin.exists ? {} : { addedAt: new Date(), addedBy: sourceId }) }, { merge: true })
    } else if (authority === 'admin') {
      if (!sourceAdmin.exists || sourceAdmin.data()?.isSuperAdmin === true ||
          !actorAdmin.exists || (data.createdBy !== sourceId && actorAdmin.data()?.isSuperAdmin !== true) ||
          targetAdmin.exists) throw new Error('管理者権限を移譲できません')
      tx.delete(sourceAdmin.ref)
      tx.set(targetAdminRef, { displayName: targetLabel, addedAt: new Date(), addedBy: data.createdBy })
    } else {
      const ids = roomManagerIds(manager.data())
      if (ids.includes(userId)) throw new Error('移譲先は既に部屋取り以上の権限があります')
      if (data.roomScope === 'self') {
        if (!ids.includes(sourceId) || data.createdBy !== sourceId) throw new Error('権限元の部屋取り担当者が見つかりません')
        tx.set(managerRef, roomManagerUpdate([...ids.filter((id) => id !== sourceId), userId], sourceId))
      } else {
        if (!actorAdmin.exists || data.createdBy !== sourceId) throw new Error('権限元の管理者が見つかりません')
        tx.set(managerRef, roomManagerUpdate([userId], sourceId))
      }
    }
    tx.update(inviteRef, { used: true, usedAt: new Date(), usedBy: userId })
  })
  await audit({ userId: sourceId, displayName: '' }, `admin.${authority}.${operation}`, {
    targetType: authority === 'room' ? 'room-manager' : 'admin', targetId: userId,
    details: { from: sourceId, to: userId, via: 'link' },
  })
  return authority
}

async function handleTransferInviteAccept(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' })
  const token = typeof req.query.token === 'string' ? req.query.token : ''
  const invite = token ? await db.collection('invitations').doc(token).get() : null
  const data = invite?.data()
  if (!invite?.exists || !['transfer', 'grant'].includes(data?.kind) || data?.used === true ||
      !data?.expiresAt || data.expiresAt.toMillis() <= Date.now()) {
    return res.redirect(302, '/admin/login?error=invalid')
  }
  const state = crypto.randomBytes(16).toString('hex')
  res.setHeader('Set-Cookie', [
    `admin_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`,
    `admin_oauth_role=${data.authority === 'room' ? 'room' : 'admin'}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`,
    `admin_invitation=${token}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`,
  ])
  const authUrl = new URL('https://access.line.me/oauth2/v2.1/authorize')
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', process.env.LINE_LOGIN_CHANNEL_ID!)
  authUrl.searchParams.set('redirect_uri', `https://${req.headers.host}/api/admin/auth/callback`)
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('scope', 'openid profile')
  return res.redirect(302, authUrl.toString())
}

// ─── 現在ログイン中の管理者情報 ────────────────────────
async function handleAuthMe(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' })
  try {
    const info = await verifyAdmin(req.headers.authorization)
    return res.status(200).json(info)
  } catch (err: any) {
    if (err.message === 'Forbidden' || err.message === 'Unauthorized') return res.status(err.message === 'Forbidden' ? 403 : 401).json({ error: err.message })
    return res.status(503).json({ error: isFirestoreQuotaError(err) ? DATABASE_QUOTA_MESSAGE : SERVICE_UNAVAILABLE_MESSAGE })
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

function isValidTime(s: string): boolean {
  return /^\d{2}:\d{2}$/.test(s)
}

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function isMultipleOf15(t: string): boolean {
  return toMinutes(t) % 15 === 0
}

function timesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  return toMinutes(startA) < toMinutes(endB) && toMinutes(startB) < toMinutes(endA)
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const LOTTERY_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const WEEK_DAYS = ['日', '月', '火', '水', '木', '金', '土']

type DateOption = { label: string; value: string }
type EmergencyDateOption = DateOption & {
  isReservable: boolean
  canBlock: boolean
  canOpen: boolean
  blockedReason?: string
  openReason?: string
}

function formatDateOption(date: string): DateOption {
  const d = new Date(date + 'T00:00:00Z')
  const month = d.getUTCMonth() + 1
  const day = d.getUTCDate()
  return { label: `${month}/${day}(${WEEK_DAYS[d.getUTCDay()]})`, value: date }
}

async function buildReservationAvailableDates(): Promise<DateOption[]> {
  const dates = Array.from({ length: 8 }, (_, i) => addDaysJST(i))
  const entries = await Promise.all(dates.map(async (date) => {
    const settings = await resolveReservationSettingsForDate(db, date)
    if (isDateAvailableBySettings(date, settings) && pickTimeSlotsForDate(date, settings).length > 0) {
      return formatDateOption(date)
    }
    return null
  }))
  return entries.filter((entry): entry is DateOption => entry !== null)
}

async function getFacilityBaseSettings(settingDocId: string): Promise<SettingsCore> {
  const doc = await db.collection('settings').doc(settingDocId).get()
  const data = doc.exists ? doc.data()! : {}
  let timeSlots = data.timeSlots as TimeSlot[] | undefined
  if ((!timeSlots || timeSlots.length === 0) && (data.openTime || data.closeTime)) {
    const open = data.openTime ?? '08:00'
    const close = data.closeTime ?? '20:00'
    timeSlots = [{ label: `${open}〜${close}`, value: `${open}-${close}` }]
  }

  return {
    availableDays: Array.isArray(data.availableDays) ? data.availableDays : [0, 1, 2, 3, 4, 5, 6],
    extraDates: Array.isArray(data.extraDates) ? data.extraDates : [],
    excludedDates: Array.isArray(data.excludedDates) ? data.excludedDates : [],
    timeSlots: (timeSlots?.length ? timeSlots : [{ label: '8:00~20:00', value: '08:00-20:00' }]).filter((s: any) => !s.deleted),
    perDaySchedule: data.perDaySchedule ?? { enabled: false, byWeekday: {}, byDate: {} },
  }
}

async function buildFacilityAvailableDates(settingDocId: string): Promise<DateOption[]> {
  const baseSettings = await getFacilityBaseSettings(settingDocId)
  const dates = Array.from({ length: 31 }, (_, i) => addDaysJST(i))
  const entries = await Promise.all(dates.map(async (date) => {
    const settings = await resolveFacilitySettingsForDate(db, settingDocId, date, baseSettings)
    const slots = isDateAvailableBySettings(date, settings) ? pickTimeSlotsForDate(date, settings) : []
    const availableSlots = settingDocId === 'nobu-room' ? await pickNobuRoomTimeSlotsForDate(db, date, slots) : slots
    if (availableSlots.length > 0) {
      return formatDateOption(date)
    }
    return null
  }))
  return entries.filter((entry): entry is DateOption => entry !== null)
}

async function isFacilityReservationRangeAvailable(
  settingDocId: string,
  date: string,
  startTime: string,
  endTime: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const baseSettings = await getFacilityBaseSettings(settingDocId)
  const settings = await resolveFacilitySettingsForDate(db, settingDocId, date, baseSettings)
  if (!isDateAvailableBySettings(date, settings)) {
    return { ok: false, message: 'この日は予約できません' }
  }
  const start = toMinutes(startTime)
  const end = toMinutes(endTime)
  const slots = pickTimeSlotsForDate(date, settings)
  const availableSlots = settingDocId === 'nobu-room' ? await pickNobuRoomTimeSlotsForDate(db, date, slots) : slots
  const fits = availableSlots.some((slot) => {
    const [slotStart, slotEnd] = slot.value.split('-')
    return start >= toMinutes(slotStart) && end <= toMinutes(slotEnd)
  })
  if (!fits) {
    const slotStr = availableSlots.map((slot) => slot.value.replace('-', '〜')).join(' / ')
    return { ok: false, message: slotStr ? `予約可能時間は ${slotStr} です` : 'この日に指定できる時間帯がありません' }
  }
  return { ok: true }
}

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
    if (availableDays.includes(new Date(`${d}T00:00:00Z`).getUTCDay())) return `${d} は登録可能曜日のため追加日に指定できません`
  }
  for (const d of validatedExcluded) {
    if (!availableDays.includes(new Date(`${d}T00:00:00Z`).getUTCDay())) return `${d} は登録可能曜日ではないため除外日に指定できません`
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
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
      if (validatedExcluded.includes(date) || (!availableDays.includes(weekday) && !validatedExtra.includes(date))) {
        return `${date} は予約可能な日ではないため特定日ルールを指定できません`
      }
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

async function handleSettings(req: VercelRequest, res: VercelResponse, preview = false) {
  let me: AuditActor
  try {
    me = await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }

  const docRef = db.collection('settings').doc('reservation')

  if (req.method === 'GET') {
    const windowDates = Array.from({ length: 8 }, (_, index) => addDaysJST(index))
    const [data, scheduledChanges, roomModeRefs, windowSettings] = await Promise.all([
      resolveReservationSettingsForDate(db, todayJST(), { ignorePlan: true }),
      listPendingReservationSettingsChanges(db),
      db.collection('room_preference_modes').listDocuments(),
      resolveReservationSettingsForDates(db, windowDates),
    ])
    const roomModeDocs = await Promise.all(roomModeRefs
      .sort((a, b) => b.id.localeCompare(a.id)).map((ref) => ref.get()))
    const pendingChange = scheduledChanges[0] ?? null
    return res.status(200).json({
      availableDays:  data.availableDays,
      timeSlots:      data.timeSlots,
      extraDates:     data.extraDates,
      excludedDates:  data.excludedDates,
      perDaySchedule: data.perDaySchedule,
      nextChange:     pendingChange,
      scheduledChanges,
      reservableDatesInWindow: windowDates.filter((date) =>
        isDateAvailableBySettings(date, windowSettings[date]) && pickTimeSlotsForDate(date, windowSettings[date]).length > 0),
      lotteryTime:    data.lotteryTime,
      defaultLotteryTime: data.defaultLotteryTime,
      lotteryTimeOverrides: data.lotteryTimeOverrides,
      lotteryMode:    data.lotteryMode,
      notifyMode:     data.notifyMode,
      notifyTime:     data.defaultNotifyTime ?? data.notifyTime,
      hamoaniStartDate: data.hamoaniStartDate,
      hamoaniEndDate:   data.hamoaniEndDate,
      ...await getRoomPreferenceConfig(db, todayJST(), true),
      roomModeVersions: roomModeDocs.map((doc) => ({ effectiveFrom: doc.id, enabled: doc.data()?.enabled === true })),
    })
  }

  if (req.method === 'PUT' || preview) {
    const validated = validateSettings(req.body)
    if (typeof validated === 'string') return res.status(400).json({ error: validated })

    const { effectiveFrom, lotteryTime, lotteryTimeOverrides, roomPreferenceEnabled, applyRecurring, applyDated } = (req.body ?? {}) as {
      effectiveFrom?: string; lotteryTime?: string; lotteryTimeOverrides?: { byWeekday?: Record<string, string>; byDate?: Record<string, string>; notifyByWeekday?: Record<string, string>; notifyByDate?: Record<string, string> }; roomPreferenceEnabled?: boolean;
      applyRecurring?: boolean; applyDated?: boolean
    }
    const saveRecurring = applyRecurring !== false
    const saveDated = applyDated !== false
    if (!saveRecurring && !saveDated) return res.status(400).json({ error: '保存する変更がありません' })

    if (!effectiveFrom || !isValidDate(effectiveFrom)) {
      return res.status(400).json({ error: '適用日を指定してください' })
    }
    if (!lotteryTime || !LOTTERY_TIME_RE.test(lotteryTime) || lotteryTime < '00:10') {
      return res.status(400).json({ error: '抽選時刻は00:10〜23:59で指定してください' })
    }
    const currentOperation = await resolveReservationSettingsForDate(db, effectiveFrom, { ignorePlan: true })
    const legacyNotification = await getRoomPreferenceConfig(db, effectiveFrom)
    const operation = {
      lotteryMode: req.body.lotteryMode ?? currentOperation.lotteryMode,
      notifyMode: req.body.notifyMode ?? currentOperation.notifyMode,
      notifyTime: req.body.notifyTime ?? currentOperation.defaultNotifyTime ?? currentOperation.notifyTime,
      notificationMode: req.body.notificationMode ?? legacyNotification.notificationMode,
      fallbackPost: req.body.fallbackPost ?? legacyNotification.fallbackPost,
    }
    if (!['previous-day', 'same-day'].includes(operation.lotteryMode) || !['previous-day', 'same-day'].includes(operation.notifyMode) ||
        !LOTTERY_TIME_RE.test(operation.notifyTime) || !['post', 'comment'].includes(operation.notificationMode) || typeof operation.fallbackPost !== 'boolean') {
      return res.status(400).json({ error: '抽選・通知設定が不正です' })
    }
    if (operation.notificationMode === 'comment' && !process.env.BAND_COMMENT_KEY) return res.status(400).json({ error: 'コメント先BANDが未設定です' })
    const overrides = normalizeLotteryTimeOverrides(lotteryTimeOverrides)
    const weekdayEntries = Object.entries(lotteryTimeOverrides?.byWeekday ?? {})
    const dateEntries = Object.entries(lotteryTimeOverrides?.byDate ?? {})
    if (weekdayEntries.length !== Object.keys(overrides.byWeekday).length || dateEntries.length !== Object.keys(overrides.byDate).length ||
        Object.values(overrides.byWeekday).some((time) => time < '00:10') || Object.values(overrides.byDate).some((time) => time < '00:10') ||
        dateEntries.some(([date]) => !isValidDate(date) || date < effectiveFrom)) {
      return res.status(400).json({ error: '抽選時刻の例外設定を確認してください。時刻は00:10以降、特定日は適用日以降にしてください' })
    }
    for (const field of ['notifyByWeekday', 'notifyByDate'] as const) {
      const entries = Object.entries(lotteryTimeOverrides?.[field] ?? {})
      if (entries.length !== Object.keys(overrides[field] ?? {}).length ||
          (field === 'notifyByDate' && entries.some(([date]) => !isValidDate(date) || date < effectiveFrom))) {
        return res.status(400).json({ error: '通知時刻の例外設定を確認してください。特定日は適用日以降にしてください' })
      }
    }
    if (!timingOverridesValid({ ...operation, lotteryTime }, overrides, effectiveFrom)) {
      return res.status(400).json({ error: '通知日時は、各ルールの抽選日時以降にしてください' })
    }
    if (effectiveFrom < todayJST()) {
      return res.status(400).json({ error: `適用日は${todayJST()}以降を指定してください` })
    }
    if (typeof roomPreferenceEnabled !== 'boolean') {
      return res.status(400).json({ error: '希望部屋モードの指定が不正です' })
    }

    // 設定・直近利用日の確定予定・キューを同じトランザクションで保存する。
    // 保存後に次回起動を同期し、同期失敗は固定復旧ジョブで補う。
    const [legacyDayOverrides, legacyLotteryOverrides] = await Promise.all([
      saveDated ? listReservationDayOverrides(db, { minDate: todayJST() }) : Promise.resolve([]),
      saveRecurring ? listReservationLotteryOverrides(db, { minDate: effectiveFrom }) : Promise.resolve([]),
    ])
    const proposedVersion = { ...validated, ...operation, lotteryTime, lotteryTimeOverrides: overrides, effectiveFrom }
    const proposedDatedSettings = saveDated ? { extraDates: validated.extraDates, excludedDates: validated.excludedDates, byDate: validated.perDaySchedule.byDate } : undefined
    if (preview) {
      const result = await db.runTransaction(async tx => {
        const plans = saveRecurring ? await prepareOperationPlans(db, tx, proposedVersion, undefined, undefined, proposedDatedSettings) : null
        return { operationWarnings: plans?.warnings ?? [], affectedOperations: plans?.affectedOperations ?? [], confirmedAt: plans?.confirmedAt ?? Date.now() }
      })
      return res.status(200).json(result)
    }
    let operationWarnings: PlanWarning[] = []
    let affectedOperations: OperationImpact[] = []
    await db.runTransaction(async batch => {
      const plans = saveRecurring ? await prepareOperationPlans(db, batch, proposedVersion, undefined, undefined, proposedDatedSettings) : null
      // All transactional reads finish before settings, plans and queue entries are written.
      operationWarnings = plans?.warnings ?? []
      affectedOperations = plans?.affectedOperations ?? []
      plans?.write()
      markSchedulerDirty(db, batch)
      const rootUpdate: Record<string, unknown> = {}
      if (saveRecurring) {
        batch.set(docRef.collection('versions').doc(effectiveFrom), {
          ...validated,
          ...operation,
          lotteryTime,
          lotteryTimeOverrides: overrides,
          effectiveFrom,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: me.userId,
        })
        batch.set(db.collection('room_preference_modes').doc(effectiveFrom), {
          enabled: roomPreferenceEnabled,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: me.userId,
        })
        rootUpdate.nextChange = admin.firestore.FieldValue.delete()
      }
      if (saveDated) {
        rootUpdate.immediateDatedSettings = {
          extraDates: validated.extraDates,
          excludedDates: validated.excludedDates,
          byDate: validated.perDaySchedule.byDate,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: me.userId,
        }
      }
      // 明示した親フィールド単位で更新し、削除済みの特定日ルールが古い map に残らないようにする。
      batch.set(docRef, rootUpdate, {
        mergeFields: [
          ...(saveRecurring ? ['nextChange'] : []),
          ...(saveDated ? ['immediateDatedSettings'] : []),
        ],
      })
      for (const override of legacyDayOverrides) {
        batch.delete(docRef.collection('dayOverrides').doc(override.date))
      }
      for (const override of legacyLotteryOverrides) {
        batch.delete(docRef.collection('lotteryOverrides').doc(override.date))
      }
    })
    let cronWarning: string | undefined
    try {
      if (schedulerEnabled()) await refreshScheduler(db)
      const targetDate = await lotteryTargetDate(db)
      if (saveRecurring && targetDate && effectiveFrom <= targetDate) {
        const targetSettings = await resolveReservationSettingsForDate(db, targetDate)
        const cronResult = await applyLotteryCronSchedule(targetSettings.lotteryTime, targetSettings.notifyTime, targetSettings.lotteryMode)
        cronWarning = cronResult.warning
        if (cronResult.applied) {
          await docRef.set({ appliedLotteryTime: targetSettings.lotteryTime, appliedNotifyTime: targetSettings.notifyTime, appliedLotteryMode: targetSettings.lotteryMode }, { merge: true })
        }
      }
    } catch (error) {
      console.error('設定保存後の抽選スケジュール更新に失敗しました', error)
      cronWarning = '設定は保存されましたが、抽選スケジュールを更新できませんでした。通知状況を確認してください。'
    }
    try {
      await audit(me, 'settings.schedule', { targetType: 'settings', details: { ...validated, ...operation, lotteryTime, lotteryTimeOverrides: overrides, effectiveFrom, roomPreferenceEnabled, saveRecurring, saveDated, operationWarnings,
        replacedDayOverrides: legacyDayOverrides.map((item) => item.date), replacedLotteryOverrides: legacyLotteryOverrides.map((item) => item.date) } })
    } catch (error) {
      console.error('設定保存後の監査ログ記録に失敗しました', error)
    }
    return res.status(200).json({ applied: saveRecurring && effectiveFrom > todayJST() ? 'scheduled' : 'immediate', effectiveFrom, cronWarning, operationWarnings, affectedOperations })
  }

  return res.status(405).json({ error: 'Method Not Allowed' })
}

async function handleSettingsTimeSlots(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' })
  try {
    await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }

  const date = req.query.date as string | undefined
  if (!date || !isValidDate(date)) return res.status(400).json({ error: '日付の形式が不正です' })

  try {
    const settings = await resolveReservationSettingsForDate(db, date)
    return res.status(200).json({
      date,
      timeSlots: pickTimeSlotsForDate(date, settings),
      effectiveFrom: settings.effectiveFrom,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

async function handleSettingsAvailableDates(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' })
  try {
    await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }

  try {
    const dates = await buildReservationAvailableDates()
    return res.status(200).json({ dates })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

async function handleFacilityAvailableDates(req: VercelRequest, res: VercelResponse, settingDocId: string) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' })
  try {
    await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }

  try {
    const dates = await buildFacilityAvailableDates(settingDocId)
    return res.status(200).json({ dates })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

async function handleFacilityTimeSlots(req: VercelRequest, res: VercelResponse, settingDocId: string) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' })
  try {
    await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }

  const date = req.query.date as string | undefined
  if (!date || !isValidDate(date)) return res.status(400).json({ error: '日付の形式が不正です' })

  try {
    const baseSettings = await getFacilityBaseSettings(settingDocId)
    const settings = await resolveFacilitySettingsForDate(db, settingDocId, date, baseSettings)
    const slots = isDateAvailableBySettings(date, settings) ? pickTimeSlotsForDate(date, settings) : []
    return res.status(200).json({
      date,
      timeSlots: settingDocId === 'nobu-room' ? await pickNobuRoomTimeSlotsForDate(db, date, slots) : slots,
      effectiveFrom: settings.effectiveFrom,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
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

  const pending = date ? null : await getPendingReservationSettingsChange(db)
  const targetDate = date ?? pending?.effectiveFrom
  if (!targetDate) return res.status(200).json({ success: true, operationWarnings: [] })
  const operationWarnings = await db.runTransaction(async tx => {
    const root = await tx.get(docRef)
    const plans = await prepareOperationPlans(db, tx, { effectiveFrom: targetDate, availableDays: [], timeSlots: [],
      extraDates: [], excludedDates: [], perDaySchedule: { enabled: false, byWeekday: {}, byDate: {} },
      lotteryTimeOverrides: { byWeekday: {}, byDate: {} } }, undefined, targetDate)
    plans.write()
    markSchedulerDirty(db, tx)
    tx.delete(docRef.collection('versions').doc(targetDate))
    tx.delete(db.collection('room_preference_modes').doc(targetDate))
    if (root.data()?.nextChange?.effectiveFrom === targetDate) tx.set(docRef, { nextChange: admin.firestore.FieldValue.delete() }, { merge: true })
    return plans.warnings
  })
  let cronWarning: string | undefined
  try { if (schedulerEnabled()) await refreshScheduler(db) }
  catch { cronWarning = '取消は保存されましたが、次回起動の同期に失敗しました。復旧処理で再試行します。' }
  await audit(me, 'settings.scheduled.cancel', { targetType: 'settings', targetId: targetDate })
  return res.status(200).json({ success: true, operationWarnings, cronWarning })
}

async function reservationCountForDate(date: string): Promise<number> {
  const snap = await db.collection('reservations')
    .where('date', '>=', `${date}T00:00`)
    .where('date', '<=', `${date}T23:59`)
    .get()
  return snap.docs.filter((d) => d.data().status !== 'cancelled').length
}

async function buildEmergencyDateOptions(): Promise<EmergencyDateOption[]> {
  const today = todayJST()
  const tomorrow = addDaysJST(1)
  const dates = Array.from({ length: 8 }, (_, i) => addDaysJST(i))
  const settingsByDate = await resolveReservationSettingsForDates(db, dates)
  const tomorrowSettings = settingsByDate[tomorrow]
  const tomorrowBlockedByDeadline = Date.now() >= reservationDeadline(tomorrow, tomorrowSettings.lotteryMode, tomorrowSettings.lotteryTime).getTime()

  return dates.map((date) => {
    const settings = settingsByDate[date]
    const baseSettings = { ...settings, dayOverride: undefined }
    const isReservable = isDateAvailableBySettings(date, baseSettings) && pickTimeSlotsForDate(date, baseSettings).length > 0
    const canBlock = date >= tomorrow && isReservable
    const canOpen = date >= tomorrow && !isReservable && !(date === tomorrow && tomorrowBlockedByDeadline)
    return {
      ...formatDateOption(date),
      isReservable,
      canBlock,
      canOpen,
      blockedReason: canBlock ? undefined : date < tomorrow ? '予約不可は翌日以降の日付だけ指定できます' : '設定時点で予約可能な日だけ予約不可にできます',
      openReason: canOpen
        ? undefined
        : date < tomorrow
          ? '予約解放は翌日以降の日付だけ指定できます'
          : date === tomorrow && tomorrowBlockedByDeadline
            ? '抽選時刻10分前を過ぎているため、翌日は予約解放できません'
            : '設定時点で予約不可能な日だけ予約解放できます',
    }
  })
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
    const [doc, reservationCount, emergencyDates] = await Promise.all([
      db.collection('settings').doc('reservation').collection('dayOverrides').doc(date).get(),
      reservationCountForDate(date),
      buildEmergencyDateOptions(),
    ])
    return res.status(200).json({
      override: doc.exists ? doc.data() : null,
      reservationCount,
      dateOption: emergencyDates.find((entry) => entry.value === date) ?? null,
    })
  }

  const [overrides, emergencyDates] = await Promise.all([
    listReservationDayOverrides(db, { minDate: todayJST() }),
    buildEmergencyDateOptions(),
  ])
  const withCounts = await Promise.all(overrides.map(async (override) => ({
    ...override,
    reservationCount: await reservationCountForDate(override.date),
  })))
  return res.status(200).json({ overrides: withCounts, emergencyDates })
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
  const dateOption = (await buildEmergencyDateOptions()).find((entry) => entry.value === date)
  if (!dateOption) {
    return res.status(400).json({ error: `緊急対応の対象日は${todayJST()}〜${addDaysJST(7)}を指定してください` })
  }
  if (type === 'blocked' && !dateOption.canBlock) {
    return res.status(400).json({ error: dateOption.blockedReason ?? 'この日は予約不可にできません' })
  }
  if (type === 'opened' && !dateOption.canOpen) {
    return res.status(400).json({ error: dateOption.openReason ?? 'この日は予約解放できません' })
  }

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

// ─── 抽選時刻の即時更新（緊急用） ─────────────────────
async function handleSettingsLotteryOperation(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method Not Allowed' })
  let me: AuditActor
  try {
    me = await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    return res.status(err.message === 'Forbidden' ? 403 : 401).json({ error: err.message })
  }
  if (schedulerEnabled() && req.method === 'PUT') return res.status(409).json({ error: '農部生協の設定画面で適用日を指定して保存してください' })


  const { lotteryMode, lotteryTime, notifyMode, notifyTime } = (req.body ?? {}) as {
    lotteryMode?: string; lotteryTime?: string; notifyMode?: string; notifyTime?: string
  }
  if (lotteryMode !== 'previous-day' && lotteryMode !== 'same-day') {
    return res.status(400).json({ error: '抽選モードが不正です' })
  }
  if (notifyMode !== 'previous-day' && notifyMode !== 'same-day') {
    return res.status(400).json({ error: '通知日が不正です' })
  }
  if (!notifyTime || !LOTTERY_TIME_RE.test(notifyTime)) {
    return res.status(400).json({ error: '通知時刻は00:00〜23:59で指定してください' })
  }
  if (!lotteryTime || !LOTTERY_TIME_RE.test(lotteryTime) || lotteryTime < '00:10') {
    return res.status(400).json({ error: '抽選時刻は00:10〜23:59で指定してください' })
  }
  const settings = await resolveReservationSettingsForDate(db, todayJST())
  const executionDate = todayJST()
  const tomorrow = addDaysJST(1)
  const executionSettings = await resolveReservationSettingsForDates(db, [executionDate, tomorrow])
  const reservationDates = [executionDate, tomorrow].filter((date) =>
    isDateAvailableBySettings(date, executionSettings[date]) && pickTimeSlotsForDate(date, executionSettings[date]).length > 0)
  const blockedEvent = operationChangeOnExecutionDate(executionDate, reservationDates, settings, {
    lotteryMode, lotteryTime, notifyMode, notifyTime,
  })
  if (blockedEvent) {
    return res.status(400).json({ error: `変更前または変更後の${blockedEvent}日が本日のため、この設定は適用できません。実行日のない日に変更してください` })
  }
  if ((lotteryMode !== settings.lotteryMode || lotteryTime !== settings.lotteryTime) &&
      (await listPendingReservationSettingsChanges(db, addDaysJST(1))).length > 0) {
    return res.status(400).json({ error: '適用予定の通常設定があります。先に適用予定を確認してください' })
  }
  if ((lotteryTime !== settings.lotteryTime || lotteryMode !== settings.lotteryMode) &&
      await getReservationLotteryOverride(db, todayJST())) {
    return res.status(400).json({ error: '本日の抽選時刻に緊急上書きがあります。先に解除してください' })
  }
  if (lotteryMode !== settings.lotteryMode || notifyMode !== settings.notifyMode) {
    const [todayResult, tomorrowResult] = await Promise.all([
      db.collection('lottery_results').doc(todayJST()).get(),
      db.collection('lottery_results').doc(addDaysJST(1)).get(),
    ])
    if ([todayResult, tomorrowResult].some((doc) => doc.exists && !doc.data()?.notificationSentAt)) {
      return res.status(400).json({ error: '抽選済みの結果通知が完了してからモードを切り替えてください' })
    }
  }
  const pendingTimingChanges = await listPendingReservationSettingsChanges(db, addDaysJST(1))
  const timingBase: Parameters<typeof timingOverridesValid>[0] = { lotteryMode, lotteryTime, notifyMode, notifyTime }
  if (!timingOverridesValid({ ...timingBase, lotteryTime: settings.defaultLotteryTime }, settings.lotteryTimeOverrides, todayJST()) ||
      pendingTimingChanges.some((change) => !timingOverridesValid({ ...timingBase,
        lotteryTime: change.lotteryTime ?? settings.defaultLotteryTime }, change.lotteryTimeOverrides ?? {}, change.effectiveFrom))) {
    return res.status(400).json({ error: '通知日時は通常設定と各例外ルールの抽選日時以降にしてください' })
  }
  const targetDate = addDaysJST(1)
  const targetResult = await db.collection('lottery_results').doc(targetDate).get()
  const [drawHour, drawMinute] = lotteryTime.split(':').map(Number)
  const drawMinutes = lotteryMode === 'same-day' ? 23 * 60 + 55 : drawHour * 60 + drawMinute - 5
  if (!targetResult.exists && jstNowMinutes() >= drawMinutes) {
    const pending = await db.collection('reservations')
      .where('status', '==', 'pending')
      .where('date', '>=', `${targetDate}T00:00`)
      .where('date', '<=', `${targetDate}T23:59`)
      .limit(1).get()
    if (!pending.empty) return res.status(400).json({ error: '本日の抽選実行時刻を過ぎています。抽選済みの日付を指定してください' })
  }
  const notifyTarget = notifyMode === 'same-day' ? todayJST() : addDaysJST(1)
  const notificationResult = notifyTarget === targetDate ? targetResult : await db.collection('lottery_results').doc(notifyTarget).get()
  const [notifyHour, notifyMinute] = notifyTime.split(':').map(Number)
  if (notificationResult.exists && !notificationResult.data()?.notificationSentAt &&
      jstNowMinutes() >= notifyHour * 60 + notifyMinute) {
    return res.status(400).json({ error: '未通知の抽選結果があります。通知時刻を未来に設定してください' })
  }
  if (settings.lotteryMode === 'same-day' && lotteryMode === 'previous-day') {
    const today = todayJST()
    if (isDateAvailableBySettings(today, settings) && !(await db.collection('lottery_results').doc(today).get()).exists) {
      const pending = await db.collection('reservations')
        .where('status', '==', 'pending')
        .where('date', '>=', `${today}T00:00`)
        .where('date', '<=', `${today}T23:59`)
        .limit(1).get()
      if (!pending.empty) return res.status(400).json({ error: '本日の抽選が完了してから前日モードへ切り替えてください' })
    }
  }
  const reservationRef = db.collection('settings').doc('reservation')
  const result = await applyLotteryCronSchedule(lotteryTime, notifyTime, lotteryMode)
  if (result.warning) {
    await applyLotteryCronSchedule(settings.lotteryTime, settings.notifyTime, settings.lotteryMode)
    return res.status(503).json({ error: result.warning })
  }
  const timeRef = settings.effectiveFrom === BASE_EFFECTIVE_FROM
    ? reservationRef
    : reservationRef.collection('versions').doc(settings.effectiveFrom)
  try {
    if (settings.effectiveFrom === BASE_EFFECTIVE_FROM) {
      await reservationRef.set({ lotteryMode, notifyMode, notifyTime, appliedLotteryTime: lotteryTime, appliedNotifyTime: notifyTime, appliedLotteryMode: lotteryMode,
        ...(lotteryTime !== settings.lotteryTime ? { lotteryTime } : {}) }, { merge: true })
    } else {
      const batch = db.batch()
      batch.set(reservationRef, { lotteryMode, notifyMode, notifyTime, appliedLotteryTime: lotteryTime, appliedNotifyTime: notifyTime, appliedLotteryMode: lotteryMode }, { merge: true })
      if (lotteryTime !== settings.lotteryTime) batch.set(timeRef, { lotteryTime }, { merge: true })
      await batch.commit()
    }
  } catch (error) {
    await applyLotteryCronSchedule(settings.lotteryTime, settings.notifyTime, settings.lotteryMode)
    throw error
  }
  await audit(me, 'settings.lotteryOperation', { targetType: 'settings', details: { lotteryMode, lotteryTime, notifyMode, notifyTime } })
  let cronWarning: string | undefined
  if (schedulerEnabled()) {
    try { await refreshScheduler(db) } catch { cronWarning = '設定は保存済みです。キューとcronの同期は復旧ジョブが再試行します' }
  }
  return res.status(200).json({ success: true, lotteryMode, lotteryTime, notifyMode, notifyTime, cronWarning })
}

// 通常の変更は handleSettings（適用日方式）で行う。これはミス修正など
// 「今すぐ」反映したい場合の緊急上書き：base 値を即書き換え、cron-job.org も即PATCHする。
async function handleSettingsLotteryTime(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method Not Allowed' })
  const settings = await resolveReservationSettingsForDate(db, todayJST())
  const lotteryTime = (req.body ?? {}).lotteryTime
  req.body = {
    lotteryMode: settings.lotteryMode,
    lotteryTime,
    notifyMode: settings.notifyMode,
    notifyTime: settings.notifyTime === settings.lotteryTime ? lotteryTime : settings.notifyTime,
  }
  return handleSettingsLotteryOperation(req, res)
}

// ─── ハモアニ優先抽選の有効期間（自由に即時変更、毎年夏休み前後などに設定する想定） ───
// lotteryTime のような「適用日方式」のスケジューリングは行わず、base 値を直接読み書きする。
async function handleSettingsHamoaniPeriod(req: VercelRequest, res: VercelResponse) {
  let me: AuditActor
  try {
    me = await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }
  if (schedulerEnabled() && req.method === 'PUT') return res.status(409).json({ error: '農部生協の設定画面で適用日を指定して保存してください' })


  const docRef = db.collection('settings').doc('reservation')

  if (req.method === 'GET') {
    const doc = await docRef.get()
    const data = doc.exists ? doc.data() : {}
    return res.status(200).json({
      hamoaniStartDate: typeof data?.hamoaniStartDate === 'string' ? data.hamoaniStartDate : null,
      hamoaniEndDate:   typeof data?.hamoaniEndDate === 'string' ? data.hamoaniEndDate : null,
    })
  }

  if (req.method === 'PUT') {
    const { hamoaniStartDate, hamoaniEndDate } = (req.body ?? {}) as {
      hamoaniStartDate?: string | null; hamoaniEndDate?: string | null
    }

    // 両方 null/未指定なら「無効化」として扱う
    if (!hamoaniStartDate && !hamoaniEndDate) {
      await docRef.set({
        hamoaniStartDate: admin.firestore.FieldValue.delete(),
        hamoaniEndDate: admin.firestore.FieldValue.delete(),
      }, { merge: true })
      await audit(me, 'settings.hamoaniPeriod.clear', { targetType: 'settings' })
      return res.status(200).json({ success: true, hamoaniStartDate: null, hamoaniEndDate: null })
    }

    if (!hamoaniStartDate || !DATE_RE.test(hamoaniStartDate) || !hamoaniEndDate || !DATE_RE.test(hamoaniEndDate)) {
      return res.status(400).json({ error: '開始日・終了日を両方とも YYYY-MM-DD 形式で指定してください' })
    }
    if (hamoaniStartDate > hamoaniEndDate) {
      return res.status(400).json({ error: '開始日は終了日より前（または同じ日）にしてください' })
    }

    await docRef.set({ hamoaniStartDate, hamoaniEndDate }, { merge: true })
    await audit(me, 'settings.hamoaniPeriod.set', { targetType: 'settings', details: { hamoaniStartDate, hamoaniEndDate } })
    return res.status(200).json({ success: true, hamoaniStartDate, hamoaniEndDate })
  }

  return res.status(405).json({ error: 'Method Not Allowed' })
}

// ─── 抽選時刻の日付別緊急対応（予約不可/開放とは独立） ───
type LotteryDateOption = DateOption & {
  isReservable: boolean
  currentLotteryTime: string
  hasOverride: boolean
  editable: boolean
  minTime: string
  maxTime: string
  note?: string
}

function jstNowMinutes(): number {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return now.getUTCHours() * 60 + now.getUTCMinutes()
}

function formatHHMM(totalMin: number): string {
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// 当日〜+7日の各日について、抽選時刻を変更できるか・最小指定時刻などを算出する。
async function buildLotteryOverrideDateOptions(): Promise<LotteryDateOption[]> {
  const today = todayJST()
  const dates = Array.from({ length: 8 }, (_, i) => addDaysJST(i))
  const [settingsByDate, overrides] = await Promise.all([
    resolveReservationSettingsForDates(db, dates),
    listReservationLotteryOverrides(db, { minDate: today, maxDate: addDaysJST(7) }),
  ])
  const overrideDates = new Set(overrides.map((o) => o.date))
  const nowMin = jstNowMinutes()
  const minLottery = toMinutes('00:10')
  const maxLottery = toMinutes('23:59')

  return dates.map((date) => {
    const settings = settingsByDate[date]
    const isReservable =
      isDateAvailableBySettings(date, settings) && pickTimeSlotsForDate(date, settings).length > 0
    const currentLotteryTime = settings.lotteryTime
    const drawDate = settings.lotteryMode === 'same-day' ? date :
      new Date(new Date(`${date}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10)
    let editable = isReservable
    let minTime = '00:10'
    const maxTime = '23:59'
    let note: string | undefined

    if (!isReservable) {
      editable = false
      note = '予約可能な日ではないため抽選時刻は変更できません'
    } else if (drawDate < today) {
      editable = false
      note = 'この日の抽選は終了しています'
    } else if (drawDate === today) {
      const oldLockout = toMinutes(currentLotteryTime) - 10
      if (nowMin >= oldLockout) {
        // 旧抽選の10分前を過ぎている＝遅延不可かつ新ロックアウトも過去になるため、本日は変更不可
        editable = false
        note = '抽選時刻の10分前を過ぎているため、抽選時刻は変更できません'
      } else {
        const earliest = Math.max(nowMin + 10, minLottery) // T-10 >= now かつ 00:10以降
        if (earliest > maxLottery) {
          editable = false
          note = '本日はこれ以上抽選時刻を指定できる時間帯がありません'
        } else {
          minTime = formatHHMM(earliest)
          note = `本日は ${minTime} 以降（現在時刻の10分後以降）で指定できます`
        }
      }
    }

    return {
      ...formatDateOption(date),
      isReservable,
      currentLotteryTime,
      hasOverride: overrideDates.has(date),
      editable,
      minTime,
      maxTime,
      note,
    }
  })
}

// 今日実行する抽選の対象日の上書き/解除後、cron-job.org を再同期する。
async function reapplyCurrentLotteryCron(date: string): Promise<string | undefined> {
  if (schedulerEnabled()) {
    try { await refreshScheduler(db); return undefined }
    catch { return '設定は保存済みです。キューとcronの同期は復旧ジョブが再試行します' }
  }
  const targetDate = await lotteryTargetDate(db)
  if (date !== targetDate) return undefined
  const settings = await resolveReservationSettingsForDate(db, targetDate)
  const result = await applyLotteryCronSchedule(settings.lotteryTime, settings.notifyTime, settings.lotteryMode)
  if (result.warning) return result.warning
  await db.collection('settings').doc('reservation').set({ appliedLotteryTime: settings.lotteryTime, appliedNotifyTime: settings.notifyTime, appliedLotteryMode: settings.lotteryMode }, { merge: true })
  return undefined
}

async function handleSettingsLotteryOverrides(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' })
  try {
    await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }

  const [overrides, dateOptions] = await Promise.all([
    listReservationLotteryOverrides(db, { minDate: todayJST(), maxDate: addDaysJST(7) }),
    buildLotteryOverrideDateOptions(),
  ])
  return res.status(200).json({ overrides, dateOptions })
}

async function handleSettingsLotteryOverrideByDate(req: VercelRequest, res: VercelResponse, date: string) {
  let me: AuditActor
  try {
    me = await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }
  if (schedulerEnabled() && req.method === 'PUT') return res.status(409).json({ error: '農部生協の設定画面で適用日を指定して保存してください' })


  if (!isValidDate(date)) return res.status(400).json({ error: '日付の形式が不正です' })
  if (date < todayJST() || date > addDaysJST(7)) {
    return res.status(400).json({ error: `抽選時刻の緊急対応は ${todayJST()}〜${addDaysJST(7)} の範囲で指定してください` })
  }

  const docRef = db.collection('settings').doc('reservation').collection('lotteryOverrides').doc(date)

  if (req.method === 'DELETE') {
    await docRef.delete()
    await audit(me, 'settings.lotteryOverride.delete', { targetType: 'settings', targetId: date, details: { date } })
    const cronWarning = await reapplyCurrentLotteryCron(date)
    return res.status(200).json({ success: true, ...(cronWarning ? { cronWarning } : {}) })
  }

  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method Not Allowed' })

  const { lotteryTime } = (req.body ?? {}) as { lotteryTime?: string }
  if (!lotteryTime || !LOTTERY_TIME_RE.test(lotteryTime) || lotteryTime < '00:10') {
    return res.status(400).json({ error: '抽選時刻は00:10〜23:59で指定してください' })
  }

  // サーバ側で最新の制約を再計算して検証（GET時点との時間経過に対応）
  const option = (await buildLotteryOverrideDateOptions()).find((o) => o.value === date)
  if (!option) {
    return res.status(400).json({ error: `抽選時刻の緊急対応は ${todayJST()}〜${addDaysJST(7)} を指定してください` })
  }
  if (!option.editable) {
    return res.status(400).json({ error: option.note ?? 'この日は抽選時刻を変更できません' })
  }
  if (lotteryTime < option.minTime || lotteryTime > option.maxTime) {
    return res.status(400).json({ error: `指定できる抽選時刻は ${option.minTime}〜${option.maxTime} です` })
  }

  await docRef.set(
    { date, lotteryTime, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: me.userId },
    { merge: true },
  )
  await audit(me, 'settings.lotteryOverride.set', { targetType: 'settings', targetId: date, details: { date, lotteryTime } })
  const cronWarning = await reapplyCurrentLotteryCron(date)
  return res.status(200).json({ success: true, lotteryTime, ...(cronWarning ? { cronWarning } : {}) })
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
    if (status === 'pending' || status === 'confirmed' || status === 'cancelled') {
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

    const uniqueDates = [...new Set(docs
      .map((d) => typeof d.date === 'string' ? d.date.split('T')[0] : '')
      .filter(Boolean))]
    const settingsByDate = new Map(await Promise.all(uniqueDates.map(async (date) => [
      date,
      await resolveReservationSettingsForDate(db, date),
    ] as const)))

    const reservations = docs.map((d) => {
      const reservationDate = typeof d.date === 'string' ? d.date.split('T')[0] : ''
      const settings = settingsByDate.get(reservationDate)
      const nameOnlyEditable = !!settings && Date.now() >= reservationDeadline(
        reservationDate,
        settings.lotteryMode,
        settings.lotteryTime,
      ).getTime()
      return {
      id: d.id,
      userId: d.userId,
      userDisplayName: userMap[d.userId]?.displayName ?? '',
      userPictureUrl:  userMap[d.userId]?.pictureUrl  ?? null,
      bandName: d.bandName,
      date: d.date,
      status: d.status,
      cancelledAt: d.cancelledAt?.toMillis?.() ?? null,
      cancelledByType: d.cancelledByType ?? null,
      cancelledById: d.cancelledById ?? null,
      cancelReason: d.cancelReason ?? null,
      order: d.order,
      createdAt: d.createdAt?.toMillis?.() ?? null,
      nameOnlyEditable,
    }
    })

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
  const [snapshot, managerDoc] = await Promise.all([
    db.collection('admins').get(),
    db.collection('settings').doc('room-manager').get(),
  ])
  const managerData = managerDoc.data()
  const managerIds = roomManagerIds(managerData)
  const userIds = [...new Set([...snapshot.docs.map((d) => d.id), ...managerIds])]
  const userDocs = userIds.length > 0
    ? await db.getAll(...userIds.map((id) => db.collection('users').doc(id)))
    : []
  const pictureMap: Record<string, string | null> = {}
  userDocs.forEach((d) => { pictureMap[d.id] = d.exists ? (d.data()?.pictureUrl ?? null) : null })

  const admins = snapshot.docs.map((d) => {
    const data = d.data()
    return {
      userId: d.id,
      displayName: data.displayName ?? '',
      pictureUrl: pictureMap[d.id] ?? null,
      isAdmin: true,
      isSuperAdmin: data.isSuperAdmin === true,
      isRoomManager: managerIds.includes(d.id),
      addedAt: data.addedAt?.toMillis?.() ?? null,
      addedBy: data.addedBy ?? null,
    }
  })
  for (const managerId of managerIds.filter((id) => !snapshot.docs.some((doc) => doc.id === id))) {
    admins.push({
      userId: managerId,
      displayName: userDocs.find((doc) => doc.id === managerId)?.data()?.displayName ?? managerData?.displayName ?? '',
      pictureUrl: pictureMap[managerId] ?? null,
      isAdmin: false,
      isSuperAdmin: false,
      isRoomManager: true,
      addedAt: managerData?.updatedAt?.toMillis?.() ?? null,
      addedBy: managerData?.updatedBy ?? null,
    })
  }
  admins.sort((a, b) => {
    // スーパー管理者を先頭、その後 addedAt 順
    if (a.isSuperAdmin !== b.isSuperAdmin) return a.isSuperAdmin ? -1 : 1
    return (a.addedAt ?? 0) - (b.addedAt ?? 0)
  })
  return res.status(200).json({ admins })
}

// ─── 管理者の削除 ─────────────────────────────────────
async function handleAdminById(req: VercelRequest, res: VercelResponse, targetId: string) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method Not Allowed' })
  let me: AuditActor & { isSuperAdmin: boolean }
  try {
    me = await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }
  if (!me.isSuperAdmin) return res.status(403).json({ error: '管理者の削除はスーパー管理者のみ実行できます' })
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

// ─── 権限の追加・削除 ─────────────────────────────────
async function handleAdminPermissionLink(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })
  let me: AuditActor & { isSuperAdmin: boolean }
  try {
    me = await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    return res.status(err.message === 'Forbidden' ? 403 : 401).json({ error: err.message })
  }
  const authority = (req.body ?? {}).authority
  if (authority !== 'admin' && authority !== 'room') {
    return res.status(400).json({ error: '追加する権限を選択してください' })
  }
  if (authority === 'admin' && !me.isSuperAdmin) {
    return res.status(403).json({ error: 'スーパー管理者のみ管理者権限を追加できます' })
  }
  const token = crypto.randomBytes(24).toString('hex')
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000)
  await db.collection('invitations').doc(token).set({ kind: 'grant', authority,
    sourceId: me.userId, createdBy: me.userId, createdAt: new Date(), expiresAt, used: false })
  return res.status(201).json({ url: `https://${req.headers.host}/api/admin/invite?token=${token}`,
    expiresAt: expiresAt.toISOString() })
}

async function handleAdminPermissions(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })
  let me: AuditActor & { isSuperAdmin: boolean }
  try {
    me = await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    return res.status(err.message === 'Forbidden' ? 403 : 401).json({ error: err.message })
  }
  const { userId, authority, operation } = (req.body ?? {}) as {
    userId?: string; authority?: string; operation?: string
  }
  if (!userId || !['admin', 'room'].includes(authority ?? '') || !['add', 'remove'].includes(operation ?? '')) {
    return res.status(400).json({ error: 'ユーザー、権限、操作を選択してください' })
  }
  if (authority === 'admin' && !me.isSuperAdmin) {
    return res.status(403).json({ error: '管理者権限を操作できるのはスーパー管理者のみです' })
  }
  if (authority === 'admin' && operation === 'remove') {
    return res.status(403).json({ error: '管理者以上の権限ははく奪できません' })
  }
  if (userId === me.userId) return res.status(400).json({ error: '自分自身の権限は変更できません' })

  const actorRef = db.collection('admins').doc(me.userId)
  const userRef = db.collection('users').doc(userId)
  const targetRef = db.collection('admins').doc(userId)
  const managerRef = db.collection('settings').doc('room-manager')
  let targetLabel = ''
  try {
    await db.runTransaction(async (tx) => {
      const [actor, user, target, manager] = await Promise.all([
        tx.get(actorRef), tx.get(userRef), tx.get(targetRef), tx.get(managerRef),
      ])
      if (!actor.exists || (authority === 'admin' && actor.data()?.isSuperAdmin !== true)) {
        throw new Error('操作する権限がありません')
      }
      if (!user.exists) throw new Error('ユーザーが見つかりません')
      if (operation === 'add' && user.data()?.banned === true) {
        throw new Error('利用停止中のユーザーには権限を追加できません')
      }
      targetLabel = user.data()?.displayName ?? ''
      if (authority === 'admin') {
        if (target.data()?.isSuperAdmin === true) throw new Error('スーパー管理者の権限は変更できません')
        if (operation === 'add') {
          if (target.exists) throw new Error('既に管理者権限があります')
          tx.set(targetRef, { displayName: targetLabel, addedAt: new Date(), addedBy: me.userId })
        } else {
          if (!target.exists) throw new Error('管理者権限がありません')
          tx.delete(targetRef)
        }
      } else {
        const ids = roomManagerIds(manager.data())
        if (operation === 'add') {
          if (ids.includes(userId)) throw new Error('既に部屋取り権限があります')
          ids.push(userId)
        } else {
          if (!ids.includes(userId)) throw new Error('部屋取り権限がありません')
          ids.splice(ids.indexOf(userId), 1)
        }
        tx.set(managerRef, roomManagerUpdate(ids, me.userId))
      }
    })
  } catch (err: any) {
    return res.status(400).json({ error: err.message })
  }
  await audit(me, `admin.${authority}.${operation}`, {
    targetType: authority === 'room' ? 'room-manager' : 'admin', targetId: userId, targetLabel,
  })
  return res.status(200).json({ success: true })
}

// ─── 権限の移譲 ───────────────────────────────────────
async function handleAdminTransferLink(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })
  let me: AuditActor & { isSuperAdmin: boolean }
  try {
    me = await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    return res.status(err.message === 'Forbidden' ? 403 : 401).json({ error: err.message })
  }
  const { authority, sourceUserId } = (req.body ?? {}) as { authority?: string; sourceUserId?: string }
  if (!['super', 'admin', 'room'].includes(authority ?? '')) {
    return res.status(400).json({ error: '移譲する権限を選択してください' })
  }
  if (authority === 'super' && !me.isSuperAdmin) {
    return res.status(403).json({ error: 'スーパー管理者のみ移譲できます' })
  }
  const sourceId = authority === 'admin' && me.isSuperAdmin ? sourceUserId : me.userId
  if (!sourceId) return res.status(400).json({ error: '権限元の管理者を選択してください' })
  const source = await db.collection('admins').doc(sourceId).get()
  if (authority === 'admin' && (!source.exists || source.data()?.isSuperAdmin === true)) {
    return res.status(400).json({ error: '権限元の通常管理者が見つかりません' })
  }
  const token = crypto.randomBytes(24).toString('hex')
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000)
  await db.collection('invitations').doc(token).set({ kind: 'transfer', authority,
    sourceId, createdBy: me.userId, roomScope: 'all', createdAt: new Date(), expiresAt, used: false })
  return res.status(201).json({ url: `https://${req.headers.host}/api/admin/invite?token=${token}`,
    expiresAt: expiresAt.toISOString() })
}

async function handleAdminTransfer(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })
  let me: AuditActor & { isSuperAdmin: boolean }
  try {
    me = await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    return res.status(err.message === 'Forbidden' ? 403 : 401).json({ error: err.message })
  }

  const { userId, authority, sourceUserId } = (req.body ?? {}) as {
    userId?: string; authority?: string; sourceUserId?: string
  }
  if (!userId || !['super', 'admin', 'room'].includes(authority ?? '')) {
    return res.status(400).json({ error: '移譲先と権限を選択してください' })
  }
  if (userId === me.userId) return res.status(400).json({ error: '自分自身には移譲できません' })
  if (authority === 'super' && !me.isSuperAdmin) {
    return res.status(403).json({ error: 'スーパー管理者権限はスーパー管理者のみ移譲できます' })
  }
  const adminSourceId = authority === 'admin' && me.isSuperAdmin ? sourceUserId : me.userId
  if (authority === 'admin' && (!adminSourceId || adminSourceId === userId)) {
    return res.status(400).json({ error: '権限元の管理者と別の移譲先を選択してください' })
  }

  const userRef = db.collection('users').doc(userId)
  const sourceRef = db.collection('admins').doc(me.userId)
  const adminSourceRef = db.collection('admins').doc(adminSourceId ?? me.userId)
  const targetRef = db.collection('admins').doc(userId)
  const managerRef = db.collection('settings').doc('room-manager')
  let targetLabel = ''
  try {
    await db.runTransaction(async (tx) => {
      const [user, source, adminSource, target, manager] = await Promise.all([
        tx.get(userRef), tx.get(sourceRef), tx.get(adminSourceRef), tx.get(targetRef), tx.get(managerRef),
      ])
      if (!user.exists) throw new Error('移譲先のユーザーが見つかりません')
      if (user.data()?.banned === true) throw new Error('利用停止中のユーザーには移譲できません')
      if (!source.exists) throw new Error('管理者権限がありません')
      targetLabel = user.data()?.displayName ?? ''

      if (authority === 'room') {
        if (roomManagerIds(manager.data()).includes(userId)) throw new Error('既に部屋取り権限を持っています')
        tx.set(managerRef, { ...roomManagerUpdate([userId], me.userId), displayName: targetLabel })
      } else if (authority === 'super') {
        if (source.data()?.isSuperAdmin !== true) throw new Error('スーパー管理者権限がありません')
        tx.update(sourceRef, { isSuperAdmin: admin.firestore.FieldValue.delete() })
        tx.set(targetRef, { displayName: targetLabel, isSuperAdmin: true,
          ...(target.exists ? {} : { addedAt: new Date(), addedBy: me.userId }) }, { merge: true })
      } else {
        if (!adminSource.exists || adminSource.data()?.isSuperAdmin === true) {
          throw new Error('権限元の通常管理者が見つかりません')
        }
        if (target.exists) throw new Error('移譲先は既に管理者です')
        tx.set(targetRef, { displayName: targetLabel, addedAt: new Date(), addedBy: me.userId })
        tx.delete(adminSourceRef)
      }
    })
  } catch (err: any) {
    return res.status(400).json({ error: err.message })
  }

  await audit(me, `admin.${authority}.transfer`, {
    targetType: authority === 'room' ? 'room-manager' : 'admin', targetId: userId, targetLabel,
    details: { from: authority === 'admin' ? adminSourceId : me.userId, to: userId },
  })
  return res.status(200).json({ success: true })
}

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
      const userRef = db.collection('users').doc(targetId)
      const [meDoc, targetDoc, targetUser] = await Promise.all([tx.get(meRef), tx.get(targetRef), tx.get(userRef)])
      if (!meDoc.exists || meDoc.data()?.isSuperAdmin !== true) {
        throw new Error('スーパー管理者ではありません')
      }
      if (!targetDoc.exists) {
        throw new Error('移譲先の管理者が見つかりません')
      }
      if (!targetUser.exists || targetUser.data()?.banned === true) {
        throw new Error('利用停止中または未登録のユーザーには移譲できません')
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
    const nobuAll = resSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any)).filter((r) => r.status !== 'cancelled')
    const pendingCount   = nobuAll.filter((r) => r.status === 'pending').length
    const confirmedCount = nobuAll.filter((r) => r.status === 'confirmed').length
    const nobuToday      = nobuAll.filter((r) => (r.date ?? '').startsWith(todayStr)).length
    const bannedCount    = usersSnap.docs.filter((d) => d.data().banned === true).length

    // 工部室・農部室 統計
    const kobuAll      = kobuSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any)).filter((r) => r.status !== 'cancelled')
    const kobuToday    = kobuAll.filter((r) => r.date === todayStr).length
    const kobuWeek     = kobuAll.length

    const nobuRoomAll  = nobuRoomSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any)).filter((r) => r.status !== 'cancelled')
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
  let me: AuditActor & { isSuperAdmin: boolean }
  try {
    me = await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }

  const userRef = db.collection('users').doc(userId)

  if (req.method === 'GET') {
    const [userDoc, resSnap, kobuSnap, nobuRoomSnap, adminDoc, managerDoc] = await Promise.all([
      userRef.get(),
      db.collection('reservations').where('userId', '==', userId).get(),
      db.collection('kobu_reservations').where('userId', '==', userId).get(),
      db.collection('nobu_room_reservations').where('userId', '==', userId).get(),
      db.collection('admins').doc(userId).get(),
      db.collection('settings').doc('room-manager').get(),
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
        isSuperAdmin: adminDoc.data()?.isSuperAdmin === true,
        isRoomManager: roomManagerIds(managerDoc.data()).includes(userId),
        canBan: userId !== me.userId && !adminDoc.exists,
        lastReservedAt: data.lastReservedAt?.toMillis?.() ?? null,
      },
      reservations,
    })
  }

  if (req.method === 'PUT') {
    const { banned } = (req.body ?? {}) as { banned?: boolean }
    if (typeof banned !== 'boolean') return res.status(400).json({ error: '不正なリクエスト' })
    if (banned && userId === me.userId) return res.status(400).json({ error: '自分自身はBANできません' })
    const actorRef = db.collection('admins').doc(me.userId)
    const targetAdminRef = db.collection('admins').doc(userId)
    const managerRef = db.collection('settings').doc('room-manager')
    let targetLabel = ''
    let removedAdmin = false
    let removedRoomManager = false
    try {
      await db.runTransaction(async (tx) => {
        const [actorDoc, targetSnap, targetAdminDoc, managerDoc] = await Promise.all([
          tx.get(actorRef), tx.get(userRef), tx.get(targetAdminRef), tx.get(managerRef),
        ])
        if (!actorDoc.exists) throw new Error('管理者権限がありません')
        if (!targetSnap.exists) throw new Error('ユーザーが見つかりません')
        targetLabel = targetSnap.data()?.displayName ?? ''
        const managerIds = roomManagerIds(managerDoc.data())
        if (banned && targetAdminDoc.exists) throw new Error('管理者以上のユーザーはBANできません')
        removedAdmin = banned && targetAdminDoc.exists
        removedRoomManager = banned && managerIds.includes(userId)
        tx.set(userRef, { banned }, { merge: true })
        if (removedAdmin) tx.delete(targetAdminRef)
        if (removedRoomManager) tx.set(managerRef, roomManagerUpdate(managerIds.filter((id) => id !== userId), me.userId), { merge: true })
      })
    } catch (err: any) {
      if (['管理者権限がありません', '管理者以上のユーザーはBANできません'].includes(err.message)) {
        return res.status(403).json({ error: err.message })
      }
      if (err.message === 'ユーザーが見つかりません') return res.status(404).json({ error: err.message })
      throw err
    }
    await audit(me, banned ? 'user.ban' : 'user.unban', {
      targetType: 'user', targetId: userId, targetLabel, details: { removedAdmin, removedRoomManager },
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
    if (before.status === 'cancelled') return res.status(400).json({ error: 'キャンセル済みの予約は編集できません' })
    const { bandName, date } = (req.body ?? {}) as { bandName?: string; date?: string }
    const update: Record<string, any> = {}
    if (typeof bandName === 'string' && bandName.trim()) update.bandName = bandName.trim()
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}-\d{2}:\d{2}$/.test(date)) {
      update.date = date
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: '更新項目がありません' })
    }

    // 抽選締切（抽選時刻の10分前）後は、予約日時を動かすと抽選対象が変わるため
    // バンド名だけを編集可能にする。画面側の制御を迂回したリクエストにも適用する。
    const originalDateOnly = String(before.date ?? '').split('T')[0]
    const originalSettings = await resolveReservationSettingsForDate(db, originalDateOnly)
    const isPastDeadline = Date.now() >= reservationDeadline(
      originalDateOnly,
      originalSettings.lotteryMode,
      originalSettings.lotteryTime,
    ).getTime()
    if (isPastDeadline && update.date && update.date !== before.date) {
      return res.status(400).json({ error: '抽選締切後はバンド名以外を編集できません' })
    }

    // 編集後の bandName と date を確定し、同日同名の重複チェック（自分自身は除外）
    const finalBandName = (update.bandName ?? before.bandName) as string
    const finalDate     = (update.date     ?? before.date)     as string
    const finalDateOnly = finalDate.split('T')[0]
    const settings = await resolveReservationSettingsForDate(db, finalDateOnly)
    if (!isTimeSlotAvailableBySettings(finalDate, settings)) {
      const slotStr = pickTimeSlotsForDate(finalDateOnly, settings).map((s) => s.value.replace('-', '〜')).join(' / ')
      return res.status(400).json({
        error: slotStr
          ? `指定できる時間帯は ${slotStr} です`
          : `${finalDateOnly} に指定できる時間帯がありません`,
      })
    }

    const dupSnap = await db.collection('reservations')
      .where('bandName', '==', finalBandName)
      .where('date', '>=', `${finalDateOnly}T00:00`)
      .where('date', '<=', `${finalDateOnly}T23:59`)
      .get()
    const conflict = dupSnap.docs.find((d) => d.id !== id && d.data().status !== 'cancelled')
    if (conflict) {
      return res.status(400).json({
        error: `${finalDateOnly} には「${finalBandName}」が既に登録されています`,
      })
    }

    update.updatedAt = new Date()
    await docRef.update(update)
    await audit(me, 'reservation.update', {
      targetType: 'reservation', targetId: id, targetLabel: before.bandName,
      details: { before: { bandName: before.bandName, date: before.date }, after: update },
    })
    return res.status(200).json({ success: true })
  }

  if (req.method === 'DELETE') {
    const { reason } = (req.body ?? {}) as { reason?: string }
    const cancelUpdate = {
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelledByType: 'admin',
      cancelledById: me.userId,
      cancelReason: typeof reason === 'string' && reason.trim() ? reason.trim() : null,
      updatedAt: new Date(),
    }
    await db.runTransaction(async (tx) => {
      const current = await tx.get(docRef)
      if (!current.exists || current.data()?.status === 'cancelled') return
      if (current.data()?.status === 'confirmed') {
        const [date, slot] = String(current.data()?.date ?? '').split('T')
        await refreshLotterySlot(db, tx, date, slot, [id])
      }
      tx.update(docRef, cancelUpdate)
    })
    await audit(me, 'reservation.cancel', {
      targetType: 'reservation', targetId: id, targetLabel: before.bandName,
      details: { bandName: before.bandName, date: before.date, userId: before.userId, status: before.status, after: cancelUpdate },
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
        ? (b.date ?? '').localeCompare(a.date ?? '')
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
      cancelledAt: r.cancelledAt?.toMillis?.() ?? null,
      cancelledByType: r.cancelledByType ?? null,
      cancelledById: r.cancelledById ?? null,
      cancelReason: r.cancelReason ?? null,
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
    if (before.status === 'cancelled') return res.status(400).json({ error: 'キャンセル済みの予約は編集できません' })
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

    if (!isValidTime(finalStartTime) || !isValidTime(finalEndTime)) {
      return res.status(400).json({ error: '時刻の形式が不正です（HH:MM）' })
    }
    if (!isMultipleOf15(finalStartTime) || !isMultipleOf15(finalEndTime)) {
      return res.status(400).json({ error: '時刻は15分単位で指定してください' })
    }
    if (finalStartTime >= finalEndTime) {
      return res.status(400).json({ error: '開始時刻は終了時刻より前にしてください' })
    }
    const availability = await isFacilityReservationRangeAvailable('kobu', finalDate, finalStartTime, finalEndTime)
    if (availability.ok === false) return res.status(400).json({ error: availability.message })

    const existingSnap = await db.collection('kobu_reservations').where('date', '==', finalDate).get()
    for (const d of existingSnap.docs) {
      if (d.id === id) continue
      const data = d.data()
      if (data.status === 'cancelled') continue
      if (timesOverlap(finalStartTime, finalEndTime, data.startTime, data.endTime)) {
        return res.status(400).json({ error: `${data.startTime}〜${data.endTime} に既に予約が入っています` })
      }
    }

    update.updatedAt = new Date()
    await docRef.update(update)
    await audit(me, 'kobu_reservation.update', {
      targetType: 'kobu_reservation', targetId: id, targetLabel: before.bandName,
      details: { before: { bandName: before.bandName, date: before.date, startTime: before.startTime, endTime: before.endTime }, after: update },
    })
    return res.status(200).json({ success: true })
  }

  if (req.method === 'DELETE') {
    const { reason } = (req.body ?? {}) as { reason?: string }
    const cancelUpdate = {
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelledByType: 'admin',
      cancelledById: me.userId,
      cancelReason: typeof reason === 'string' && reason.trim() ? reason.trim() : null,
      updatedAt: new Date(),
    }
    await docRef.update(cancelUpdate)
    await audit(me, 'kobu_reservation.cancel', {
      targetType: 'kobu_reservation', targetId: id, targetLabel: before.bandName,
      details: { bandName: before.bandName, date: before.date, startTime: before.startTime, endTime: before.endTime, after: cancelUpdate },
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
      timePresets:     data.timePresets    ?? [],
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
        ? (b.date ?? '').localeCompare(a.date ?? '')
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
      cancelledAt: r.cancelledAt?.toMillis?.() ?? null,
      cancelledByType: r.cancelledByType ?? null,
      cancelledById: r.cancelledById ?? null,
      cancelReason: r.cancelReason ?? null,
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
    if (before.status === 'cancelled') return res.status(400).json({ error: 'キャンセル済みの予約は編集できません' })
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

    if (!isValidTime(finalStartTime) || !isValidTime(finalEndTime)) {
      return res.status(400).json({ error: '時刻の形式が不正です（HH:MM）' })
    }
    if (!isMultipleOf15(finalStartTime) || !isMultipleOf15(finalEndTime)) {
      return res.status(400).json({ error: '時刻は15分単位で指定してください' })
    }
    if (finalStartTime >= finalEndTime) {
      return res.status(400).json({ error: '開始時刻は終了時刻より前にしてください' })
    }
    const availability = await isFacilityReservationRangeAvailable('nobu-room', finalDate, finalStartTime, finalEndTime)
    if (availability.ok === false) return res.status(400).json({ error: availability.message })

    const existingSnap = await db.collection('nobu_room_reservations').where('date', '==', finalDate).get()
    for (const d of existingSnap.docs) {
      if (d.id === id) continue
      const data = d.data()
      if (data.status === 'cancelled') continue
      if (timesOverlap(finalStartTime, finalEndTime, data.startTime, data.endTime)) {
        return res.status(400).json({ error: `${data.startTime}〜${data.endTime} に既に予約が入っています` })
      }
    }

    update.updatedAt = new Date()
    await docRef.update(update)
    await audit(me, 'nobu_room_reservation.update', {
      targetType: 'nobu_room_reservation', targetId: id, targetLabel: before.bandName,
      details: { before: { bandName: before.bandName, date: before.date, startTime: before.startTime, endTime: before.endTime }, after: update },
    })
    return res.status(200).json({ success: true })
  }

  if (req.method === 'DELETE') {
    const { reason } = (req.body ?? {}) as { reason?: string }
    const cancelUpdate = {
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelledByType: 'admin',
      cancelledById: me.userId,
      cancelReason: typeof reason === 'string' && reason.trim() ? reason.trim() : null,
      updatedAt: new Date(),
    }
    await docRef.update(cancelUpdate)
    await audit(me, 'nobu_room_reservation.cancel', {
      targetType: 'nobu_room_reservation', targetId: id, targetLabel: before.bandName,
      details: { bandName: before.bandName, date: before.date, startTime: before.startTime, endTime: before.endTime, after: cancelUpdate },
    })
    return res.status(200).json({ success: true })
  }

  return res.status(405).json({ error: 'Method Not Allowed' })
}

// ─── 農部室 設定の取得・更新 ───────────────────────────
async function handleNobuRoomSeikyoBlocks(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' })
  try {
    await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    return res.status(err.message === 'Forbidden' ? 403 : 401).json({ error: err.message })
  }
  const from = typeof req.query.from === 'string' ? req.query.from : todayJST()
  const days = Number(req.query.days ?? 31)
  if (!isValidDate(from) || !Number.isInteger(days) || days < 1 || days > 31)
    return res.status(400).json({ error: '日付または日数が不正です' })

  try {
    const dates = Array.from({ length: days }, (_, index) => {
      const date = new Date(`${from}T00:00:00Z`)
      date.setUTCDate(date.getUTCDate() + index)
      return date.toISOString().slice(0, 10)
    })
    const [baseRoom, roomVersions, seikyoByDate] = await Promise.all([
      getFacilityBaseSettings('nobu-room'),
      listFacilitySettingsVersions(db, 'nobu-room', { maxEffectiveFrom: dates[dates.length - 1] }),
      resolveReservationSettingsForDates(db, dates),
    ])
    const rows = dates.map((date) => {
      const seikyo = seikyoByDate[date]
      const room = [...roomVersions].reverse().find((version) => version.effectiveFrom <= date) ?? baseRoom
      const seikyoSlots = isDateAvailableBySettings(date, seikyo) ? pickTimeSlotsForDate(date, seikyo) : []
      const roomSlots = isDateAvailableBySettings(date, room) ? pickTimeSlotsForDate(date, room) : []
      const blockedSlots = roomSlots.flatMap((roomSlot) => seikyoSlots.flatMap((seikyoSlot) => {
        const [roomStart, roomEnd] = roomSlot.value.split('-')
        const [seikyoStart, seikyoEnd] = seikyoSlot.value.split('-')
        const start = roomStart > seikyoStart ? roomStart : seikyoStart
        const end = roomEnd < seikyoEnd ? roomEnd : seikyoEnd
        return start < end ? [`${start}-${end}`] : []
      }))
      const weekday = String(new Date(`${date}T00:00:00Z`).getUTCDay())
      const sources = [
        seikyo.dayOverride?.date === date ? (seikyo.dayOverride.type === 'opened' ? '緊急開放' : '緊急休止') : null,
        seikyo.extraDates.includes(date) ? '追加日' : null,
        seikyo.perDaySchedule?.enabled && seikyo.perDaySchedule.byDate?.[date]?.length ? '特定日時間枠' : null,
        seikyo.perDaySchedule?.enabled && !seikyo.perDaySchedule.byDate?.[date]?.length &&
          seikyo.perDaySchedule.byWeekday?.[weekday]?.length ? '曜日別時間枠' : null,
      ].filter(Boolean)
      if (sources.length === 0) sources.push('通常設定')
      return { date, blockedSlots, seikyoSlots: seikyoSlots.map((slot) => slot.value), sources }
    }).filter((row) => row.blockedSlots.length > 0 || (row.seikyoSlots.length > 0 && row.sources.some((source) => source !== '通常設定')))
    return res.status(200).json({ rows, from, days })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

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
      timePresets:     data.timePresets    ?? [],
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

// ─── 工部室・農部室 時間プリセット ────────────────────────
async function handleFacilityTimePresets(req: VercelRequest, res: VercelResponse, docId: string) {
  let me: AuditActor
  try {
    me = await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    return res.status(err.message === 'Forbidden' ? 403 : 401).json({ error: err.message })
  }

  if (req.method === 'GET') {
    const doc = await db.collection('settings').doc(docId).get()
    const data = doc.exists ? doc.data()! : {}
    return res.status(200).json({ timePresets: data.timePresets ?? [] })
  }

  if (req.method === 'PUT') {
    const { timePresets } = (req.body ?? {}) as { timePresets?: any[] }
    if (!Array.isArray(timePresets)) return res.status(400).json({ error: '不正なデータです' })
    for (const p of timePresets) {
      if (typeof p.label !== 'string' || !p.label.trim()) return res.status(400).json({ error: 'ラベルを入力してください' })
      if (!isValidTime(p.startTime) || !isValidTime(p.endTime)) return res.status(400).json({ error: '時刻の形式が不正です' })
      if (p.startTime >= p.endTime) return res.status(400).json({ error: '開始時刻は終了時刻より前にしてください' })
    }
    await db.collection('settings').doc(docId).set(
      { timePresets: timePresets.map(p => ({ label: p.label, startTime: p.startTime, endTime: p.endTime })) },
      { merge: true }
    )
    await audit(me, `${docId.replace('-', '_')}_settings.time_presets.update`, {
      targetType: 'settings', targetId: docId,
      details: { count: timePresets.length },
    })
    return res.status(200).json({ success: true })
  }

  return res.status(405).json({ error: 'Method Not Allowed' })
}
