import * as admin from 'firebase-admin'
import { verifyLineToken } from './verifyLineToken'

export async function verifyRoomManager(authHeader: string | undefined) {
  const { userId } = await verifyLineToken(authHeader)
  const manager = await admin.firestore().collection('settings').doc('room-manager').get()
  if (manager.data()?.userId !== userId) throw new Error('Forbidden')
  return { userId, displayName: manager.data()?.displayName ?? '' }
}
