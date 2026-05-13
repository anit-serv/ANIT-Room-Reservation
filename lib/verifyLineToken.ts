import axios from 'axios'

export async function verifyLineToken(authHeader: string | undefined): Promise<string> {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Unauthorized')
  }
  const idToken = authHeader.slice(7)

  const params = new URLSearchParams({
    id_token: idToken,
    client_id: process.env.LINE_LOGIN_CHANNEL_ID!,
  })

  const res = await axios.post(
    'https://api.line.me/oauth2/v2.1/verify',
    params.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  )

  return res.data.sub as string // LINE userId
}
