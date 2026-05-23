import * as admin from 'firebase-admin'
import { verifyLineToken } from './verifyLineToken'

export type AdminInfo = {
  userId: string
  displayName: string
  isSuperAdmin: boolean
}

/**
 * 認証ヘッダーから LINE アクセストークンを検証し、
 * 管理者として登録されている場合は管理者情報を返す。
 * 未登録または検証失敗時は Error を throw。
 */
export async function verifyAdmin(authHeader: string | undefined): Promise<AdminInfo> {
  const { userId } = await verifyLineToken(authHeader)
  const db = admin.firestore()
  const doc = await db.collection('admins').doc(userId).get()
  if (!doc.exists) {
    throw new Error('Forbidden')
  }
  const data = doc.data() ?? {}
  return {
    userId,
    displayName: data.displayName ?? '',
    isSuperAdmin: data.isSuperAdmin === true,
  }
}
