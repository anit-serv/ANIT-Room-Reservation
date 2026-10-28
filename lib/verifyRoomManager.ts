import * as admin from 'firebase-admin'
import { verifyLineToken } from './verifyLineToken'
import { roomManagerIds } from './roomManagerPermissions'

export async function verifyRoomManager(authHeader: string | undefined) {
  const { userId } = await verifyLineToken(authHeader)
  const db = admin.firestore()
  const [manager, adminDoc, user] = await Promise.all([
    db.collection('settings').doc('room-manager').get(),
    db.collection('admins').doc(userId).get(),
    db.collection('users').doc(userId).get(),
  ])
  if (user.data()?.banned === true || (!adminDoc.exists && !roomManagerIds(manager.data()).includes(userId))) {
    throw new Error('Forbidden')
  }
  return { userId, displayName: user.data()?.displayName ?? adminDoc.data()?.displayName ?? '', isAdmin: adminDoc.exists }
}
