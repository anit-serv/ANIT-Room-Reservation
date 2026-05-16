import { VercelRequest, VercelResponse } from '@vercel/node'
import * as admin from 'firebase-admin'
import * as crypto from 'crypto'
import axios from 'axios'
import { verifyAdmin } from '../lib/verifyAdmin'
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
  if (path === 'settings')           return handleSettings(req, res)
  if (path === 'settings/scheduled') return handleSettingsScheduled(req, res)

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
  }

  // 招待
  if (segments[0] === 'invitations') {
    if (segments.length === 1) return handleInvitations(req, res)
    if (segments.length === 2) return handleInvitationById(req, res, segments[1])
  }
  if (path === 'invite') return handleInviteAccept(req, res)

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
    const idToken: string = tokenRes.data.id_token

    const verifyRes = await axios.post(
      'https://api.line.me/oauth2/v2.1/verify',
      new URLSearchParams({
        id_token: idToken,
        client_id: process.env.LINE_LOGIN_CHANNEL_ID!,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    )
    const userId: string = verifyRes.data.sub

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
        return res.redirect(302, `${loginUrl}?token=${encodeURIComponent(idToken)}`)
      }
      // 招待トークンが無効でも、既存管理者なら通常ログインさせる
    }

    const adminDoc = await db.collection('admins').doc(userId).get()
    if (!adminDoc.exists) {
      return res.redirect(302, `${loginUrl}?error=not_admin`)
    }
    return res.redirect(302, `${loginUrl}?token=${encodeURIComponent(idToken)}`)
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
type Settings = {
  availableDays: number[]
  timeSlots: TimeSlot[]
  nextChange?: { availableDays: number[]; timeSlots: TimeSlot[]; effectiveFrom: string }
}

function todayJST(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s))
}

function validateSettings(body: any): { availableDays: number[]; timeSlots: TimeSlot[] } | null {
  if (!body) return null
  const { availableDays, timeSlots } = body
  if (!Array.isArray(availableDays)) return null
  if (!availableDays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return null
  if (!Array.isArray(timeSlots) || timeSlots.length === 0) return null
  if (!timeSlots.every((t) => t && typeof t.label === 'string' && typeof t.value === 'string')) return null
  const values = timeSlots.map((t) => t.value)
  if (new Set(values).size !== values.length) return null  // 重複チェック
  return { availableDays, timeSlots }
}

async function handleSettings(req: VercelRequest, res: VercelResponse) {
  try {
    await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }

  const docRef = db.collection('settings').doc('reservation')

  if (req.method === 'GET') {
    const doc = await docRef.get()
    const data = (doc.exists ? doc.data() : {}) as Settings
    return res.status(200).json({
      availableDays: data.availableDays ?? [3, 4, 6],
      timeSlots: data.timeSlots ?? [],
      nextChange: data.nextChange ?? null,
    })
  }

  if (req.method === 'PUT') {
    const validated = validateSettings(req.body)
    if (!validated) return res.status(400).json({ error: '不正なリクエストです' })

    const { effectiveFrom, applyNow } = (req.body ?? {}) as { effectiveFrom?: string; applyNow?: boolean }
    const today = todayJST()

    // 即時適用、または effectiveFrom が今日以前の場合
    if (applyNow || !effectiveFrom || effectiveFrom <= today) {
      await docRef.set({
        availableDays: validated.availableDays,
        timeSlots: validated.timeSlots,
        nextChange: admin.firestore.FieldValue.delete(),
      }, { merge: true })
      return res.status(200).json({ applied: 'now' })
    }

    // 未来日付として予約
    if (!isValidDate(effectiveFrom)) {
      return res.status(400).json({ error: '不正な日付形式です' })
    }
    await docRef.set({
      nextChange: { ...validated, effectiveFrom },
    }, { merge: true })
    return res.status(200).json({ applied: 'scheduled', effectiveFrom })
  }

  return res.status(405).json({ error: 'Method Not Allowed' })
}

// ─── 予約済みの設定変更をキャンセル ────────────────────
async function handleSettingsScheduled(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method Not Allowed' })
  try {
    await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }
  await db.collection('settings').doc('reservation').set({
    nextChange: admin.firestore.FieldValue.delete(),
  }, { merge: true })
  return res.status(200).json({ success: true })
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

    const reservations = docs.map((d) => ({
      id: d.id,
      userId: d.userId,
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
  const admins = snapshot.docs.map((d) => {
    const data = d.data()
    return {
      userId: d.id,
      displayName: data.displayName ?? '',
      addedAt: data.addedAt?.toMillis?.() ?? null,
      addedBy: data.addedBy ?? null,
    }
  }).sort((a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0))
  return res.status(200).json({ admins })
}

// ─── 管理者の削除 ─────────────────────────────────────
async function handleAdminById(req: VercelRequest, res: VercelResponse, targetId: string) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method Not Allowed' })
  let me
  try {
    me = await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }
  if (me.userId === targetId) {
    return res.status(400).json({ error: '自分自身は削除できません' })
  }
  await db.collection('admins').doc(targetId).delete()
  return res.status(200).json({ success: true })
}

// ─── 招待の発行・一覧 ─────────────────────────────────
async function handleInvitations(req: VercelRequest, res: VercelResponse) {
  let me
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
  try {
    await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }
  await db.collection('invitations').doc(token).delete()
  return res.status(200).json({ success: true })
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
    const snapshot = await db.collection('users').get()
    const users = snapshot.docs.map((d) => {
      const data = d.data()
      return {
        userId: d.id,
        displayName: data.displayName ?? '',
        pictureUrl: data.pictureUrl ?? null,
        banned: data.banned ?? false,
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
  try {
    await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }

  const userRef = db.collection('users').doc(userId)

  if (req.method === 'GET') {
    const [userDoc, resSnap] = await Promise.all([
      userRef.get(),
      db.collection('reservations').where('userId', '==', userId).get(),
    ])
    if (!userDoc.exists) return res.status(404).json({ error: 'ユーザーが見つかりません' })
    const data = userDoc.data()!
    const reservations = resSnap.docs
      .map((d) => ({ id: d.id, ...d.data() } as any))
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
      .map((r) => ({
        id: r.id, bandName: r.bandName, date: r.date, status: r.status, order: r.order,
      }))
    return res.status(200).json({
      user: {
        userId,
        displayName: data.displayName ?? '',
        pictureUrl: data.pictureUrl ?? null,
        banned: data.banned ?? false,
        lastReservedAt: data.lastReservedAt?.toMillis?.() ?? null,
      },
      reservations,
    })
  }

  if (req.method === 'PUT') {
    const { banned } = (req.body ?? {}) as { banned?: boolean }
    if (typeof banned !== 'boolean') return res.status(400).json({ error: '不正なリクエスト' })
    await userRef.set({ banned }, { merge: true })
    return res.status(200).json({ success: true })
  }

  return res.status(405).json({ error: 'Method Not Allowed' })
}

// ─── 予約の編集・削除 ─────────────────────────────────
async function handleReservationById(req: VercelRequest, res: VercelResponse, id: string) {
  try {
    await verifyAdmin(req.headers.authorization)
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : 401
    return res.status(status).json({ error: err.message })
  }

  const docRef = db.collection('reservations').doc(id)
  const doc = await docRef.get()
  if (!doc.exists) return res.status(404).json({ error: '予約が見つかりません' })

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
    await docRef.update(update)
    return res.status(200).json({ success: true })
  }

  if (req.method === 'DELETE') {
    await docRef.delete()
    return res.status(200).json({ success: true })
  }

  return res.status(405).json({ error: 'Method Not Allowed' })
}
