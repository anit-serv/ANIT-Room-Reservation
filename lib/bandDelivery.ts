import type { Firestore } from 'firebase-admin/firestore'
import { createHash, randomUUID } from 'crypto'
import { createBandPostOnce, createBandCommentOnce, findOwnPost, findOwnComment } from './band'
import { milliseconds, LEASE_MS } from './schedulerQueue'

export class DeliveryNeedsReview extends Error {}
export type Delivery = { kind: 'post' | 'comment'; postKey: string; commentKey?: string; content: string; revision: number }
export const deliveryApi = {
  sendPost: createBandPostOnce, sendComment: createBandCommentOnce, findPost: findOwnPost, findComment: findOwnComment,
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex')

export async function durableDelivery(db: Firestore, date: string, kind: Delivery['kind'], target: string,
  content: string, revision: number, ownKey: string, api = deliveryApi): Promise<Delivery> {
  const ref = db.collection('band_deliveries').doc(digest(`${date}:${kind}:${target}:${revision}:${content}`))
  const token = randomUUID()
  const claim = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref), data = snap.data()
    if (data?.status === 'sent') return { sent: data.delivery as Delivery, reconcile: false, startedAt: 0 }
    if (milliseconds(data?.leaseUntil) > Date.now()) throw new Error('Delivery already in progress')
    const startedAt = milliseconds(data?.startedAt) || Date.now()
    tx.set(ref, { date, kind, target, content, revision, status: 'sending', token,
      startedAt: new Date(startedAt), leaseUntil: new Date(Date.now() + LEASE_MS) }, { merge: true })
    return { sent: null, reconcile: !!data && data.status !== 'prepared', startedAt }
  })
  if (claim.sent) return claim.sent
  let key: string | null = null
  try {
    if (claim.reconcile) {
      key = kind === 'post' ? await api.findPost(content, ownKey, claim.startedAt) : await api.findComment(target, content, ownKey)
    } else {
      try { key = kind === 'post' ? await api.sendPost(content) : await api.sendComment(target, content, ownKey) }
      catch {
        key = kind === 'post' ? await api.findPost(content, ownKey, claim.startedAt) : await api.findComment(target, content, ownKey)
      }
    }
    if (!key) throw new DeliveryNeedsReview('BAND送信結果が不明です。自動再送を停止しました。BANDと送信記録を確認してください')
    const delivery: Delivery = { kind, postKey: kind === 'post' ? key : target,
      ...(kind === 'comment' ? { commentKey: key } : {}), content, revision }
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      if (snap.data()?.token !== token) throw new Error('Delivery lease lost')
      tx.update(ref, { status: 'sent', delivery, leaseUntil: new Date(0), sentAt: new Date() })
    })
    return delivery
  } catch (error) {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      if (snap.data()?.token === token) tx.update(ref, { status: 'unknown', leaseUntil: new Date(0) })
    }).catch(() => {})
    throw error
  }
}

/** Attach the durable send and enqueue removal of the superseded delivery atomically. */
export async function attachDelivery(db: Firestore, date: string, key: string, delivery: Delivery) {
  const result = db.collection('lottery_results').doc(date)
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(result), data = snap.data()!
    const previous: Delivery | undefined = data.deliveries?.[key]
    if (previous && previous.revision > delivery.revision) {
      if (previous.postKey !== delivery.postKey || previous.commentKey !== delivery.commentKey) {
        tx.set(db.collection('band_cleanup').doc(digest(`${delivery.postKey}:${delivery.commentKey ?? ''}`)), {
          ...delivery, date, status: 'pending', nextAttemptAt: new Date(), expiresAt: new Date(Date.now() + 60 * 60_000),
        })
      }
      return
    }
    const deliveries = { ...(data.deliveries ?? {}), [key]: delivery }
    tx.update(result, { deliveries })
    if (previous && (previous.postKey !== delivery.postKey || previous.commentKey !== delivery.commentKey)) {
      tx.set(db.collection('band_cleanup').doc(digest(`${previous.postKey}:${previous.commentKey ?? ''}`)), {
        ...previous, kind: previous.kind ?? 'post', date, status: 'pending',
        nextAttemptAt: new Date(), expiresAt: new Date(Date.now() + 60 * 60_000),
      })
    }
  })
}
