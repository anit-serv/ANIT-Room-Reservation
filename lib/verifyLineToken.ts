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
  const accessToken = authHeader.slice(7)

  let res
  try {
    res = await axios.get('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch (err: any) {
    const detail = err.response
      ? `LINE ${err.response.status}: ${JSON.stringify(err.response.data)}`
      : err.message
    throw new Error(detail)
  }

  return {
    userId:  res.data.userId      as string,
    name:    res.data.displayName as string | undefined,
    picture: res.data.pictureUrl  as string | undefined,
  }
}
