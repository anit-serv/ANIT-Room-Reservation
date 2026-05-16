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

  switch (path) {
    case 'auth/start':         return handleAuthStart(req, res)
    case 'auth/callback':      return handleAuthCallback(req, res)
    case 'auth/me':            return handleAuthMe(req, res)
    case 'settings':           return handleSettings(req, res)
    case 'settings/scheduled': return handleSettingsScheduled(req, res)
    default:                   return res.status(404).json({ error: 'Not Found' })
  }
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

    const adminDoc = await db.collection('admins').doc(userId).get()
    res.setHeader('Set-Cookie', 'admin_oauth_state=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/')

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
