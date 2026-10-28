import axios from 'axios'

type BandPost = { post_key: string; content: string; created_at: number; author?: { role?: string; user_key?: string } }
type BandComment = { comment_key: string; content: string; author?: { user_key?: string } }
const BASE = 'https://openapi.band.us'
export type BandDestination = 'post' | 'comment'
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function credentials(destination: BandDestination) {
  const access_token = process.env.BAND_ACCESS_TOKEN
  const band_key = destination === 'post'
    ? (process.env.BAND_POST_KEY || process.env.BAND_KEY)
    : process.env.BAND_COMMENT_KEY
  if (!access_token || !band_key) throw new Error('BAND credentials are missing')
  return { access_token, band_key }
}

async function get<T>(path: string, params: Record<string, unknown>, destination: BandDestination = 'post'): Promise<T> {
  const call = () => axios.get(`${BASE}${path}`, { params: { ...credentials(destination), ...params }, timeout: 8000 })
  let response = await call()
  if (response.data?.result_code === 1003) { await sleep(10_000); response = await call() }
  if (response.data?.result_code !== 1) throw new Error(`BAND result_code ${response.data?.result_code ?? 'unknown'}`)
  return response.data.result_data as T
}

async function post<T>(path: string, params: Record<string, unknown>, destination: BandDestination = 'post'): Promise<T> {
  const response = await axios.post(`${BASE}${path}`, null, { params: { ...credentials(destination), ...params }, timeout: 8000 })
  if (response.data?.result_code !== 1) throw new Error(`BAND result_code ${response.data?.result_code ?? 'unknown'}`)
  return response.data.result_data as T
}

export async function bandUserKey(destination: BandDestination = 'post'): Promise<string> {
  const profile = await get<{ user_key: string }>('/v2/profile', {}, destination)
  return profile.user_key
}

export async function listBandPosts(maxPages = 1, destination: BandDestination = 'post', since?: number): Promise<{ posts: BandPost[]; complete: boolean }> {
  const posts: BandPost[] = []
  let after: string | undefined
  for (let page = 0; page < maxPages; page++) {
    const result = await get<{ items: BandPost[]; paging?: { next_params?: { after?: string } } }>(
      '/v2/band/posts', { locale: 'ja_JP', ...(after ? { after } : {}) }, destination)
    posts.push(...(result.items ?? []))
    // BAND returns newest posts first. Older pages cannot contain a match within this window.
    if (since !== undefined && (result.items ?? []).some((item) => item.created_at < since)) return { posts, complete: true }
    after = result.paging?.next_params?.after
    if (!after) return { posts, complete: true }
  }
  return { posts, complete: false }
}

export async function listBandComments(postKey: string): Promise<BandComment[]> {
  const comments: BandComment[] = []
  let after: string | undefined
  for (let page = 0; page < 20; page++) {
    const result = await get<{ items: BandComment[]; paging?: { next_params?: { after?: string } } }>(
      '/v2/band/post/comments', { post_key: postKey, ...(after ? { after } : {}) }, 'comment')
    comments.push(...(result.items ?? []))
    after = result.paging?.next_params?.after
    if (!after) break
  }
  return comments
}

export async function findOwnComment(postKey: string, content: string, ownKey: string): Promise<string | null> {
  const comments = await listBandComments(postKey)
  return comments.find((comment) => comment.author?.user_key === ownKey && comment.content === content)?.comment_key ?? null
}

export async function removeBandComment(postKey: string, commentKey: string) {
  await post('/v2/band/post/comment/remove', { post_key: postKey, comment_key: commentKey }, 'comment')
}

export async function removeBandPost(postKey: string) {
  await post('/v2/band/post/remove', { post_key: postKey })
}

// Durable delivery uses one external write only; an ambiguous response is reconciled, never blindly resent.
export async function createBandPostOnce(content: string): Promise<string> {
  const data = await post<{ post_key: string }>('/v2.2/band/post/create', { content, do_push: true })
  if (!data.post_key) throw new Error('BAND post key missing')
  return data.post_key
}
export async function createBandCommentOnce(postKey: string, content: string, ownKey: string): Promise<string> {
  await post('/v2/band/post/comment/create', { post_key: postKey, body: content }, 'comment')
  const key = await findOwnComment(postKey, content, ownKey)
  if (!key) throw new Error('BAND comment key missing')
  return key
}
export async function findOwnPost(content: string, ownKey: string, startedAt: number): Promise<string | null> {
  const listed = await listBandPosts(30, 'post', startedAt - 60_000)
  return listed.posts.find((item) => item.author?.user_key === ownKey && item.content === content &&
    item.created_at >= startedAt - 60_000)?.post_key ?? null
}

export function matchesMention(post: BandPost, ownKey: string): boolean {
  if (post.author?.role !== 'leader' && post.author?.role !== 'coleader') return false
  return [...post.content.matchAll(/<band:refer\s+user_key="([^"]+)"/g)].some((match) => match[1] === ownKey)
}
