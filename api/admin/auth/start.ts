import { VercelRequest, VercelResponse } from '@vercel/node'
import * as crypto from 'crypto'
import 'dotenv/config'

export default function handler(req: VercelRequest, res: VercelResponse) {
  const state = crypto.randomBytes(16).toString('hex')
  const baseUrl = `https://${req.headers.host}`
  const redirectUri = `${baseUrl}/api/admin/auth/callback`

  // CSRF 対策の state を Cookie に保存（10分間有効）
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
