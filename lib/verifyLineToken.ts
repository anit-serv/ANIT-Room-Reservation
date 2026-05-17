import axios from 'axios'

export type LineTokenInfo = {
  userId: string
  name?: string
  picture?: string
}

export async function verifyLineToken(authHeader: string | undefined): Promise<LineTokenInfo> {
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

  return {
    userId: res.data.sub as string,
    name: res.data.name as string | undefined,
    picture: res.data.picture as string | undefined,
  }
}
