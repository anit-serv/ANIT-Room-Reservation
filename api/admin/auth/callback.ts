import { VercelRequest, VercelResponse } from '@vercel/node'
import * as admin from 'firebase-admin'
import axios from 'axios'
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
  const baseUrl = `https://${req.headers.host}`
  const loginUrl = `${baseUrl}/admin/login`

  try {
    const { code, state } = req.query as { code?: string; state?: string }

    const cookies = parseCookies(req.headers.cookie)
    if (!state || !code || state !== cookies.admin_oauth_state) {
      return res.redirect(302, `${loginUrl}?error=invalid`)
    }

    // コード → トークン交換
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

    // ID Token 検証
    const verifyRes = await axios.post(
      'https://api.line.me/oauth2/v2.1/verify',
      new URLSearchParams({
        id_token: idToken,
        client_id: process.env.LINE_LOGIN_CHANNEL_ID!,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    )

    const userId: string = verifyRes.data.sub

    // admins コレクションで確認
    const adminDoc = await db.collection('admins').doc(userId).get()
    if (!adminDoc.exists) {
      // state Cookie 削除
      res.setHeader('Set-Cookie', 'admin_oauth_state=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/')
      return res.redirect(302, `${loginUrl}?error=not_admin`)
    }

    res.setHeader('Set-Cookie', 'admin_oauth_state=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/')
    return res.redirect(302, `${loginUrl}?token=${encodeURIComponent(idToken)}`)
  } catch (err) {
    console.error('OAuth callback error:', err)
    return res.redirect(302, `${loginUrl}?error=invalid`)
  }
}
