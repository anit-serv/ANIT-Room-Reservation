const TOKEN_KEY = 'admin_id_token'

export function getAdminToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setAdminToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearAdminToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export async function adminFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = getAdminToken()
  if (!token) throw new Error('Not authenticated')
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  return fetch(input, { ...init, headers })
}
