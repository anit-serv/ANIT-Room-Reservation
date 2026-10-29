export const DATABASE_QUOTA_MESSAGE = 'データベースの利用上限に達しているため、現在ログインできません。利用枠の回復後に再度お試しください。'
export const SERVICE_UNAVAILABLE_MESSAGE = '現在サーバーに接続できません。少し時間をおいて再度お試しください。'

export function isFirestoreQuotaError(error: unknown): boolean {
  const value = error as { code?: unknown; message?: unknown } | null
  return value?.code === 8 || value?.code === 'RESOURCE_EXHAUSTED' ||
    (typeof value?.message === 'string' && value.message.includes('RESOURCE_EXHAUSTED'))
}
