import type { Firestore } from 'firebase-admin/firestore'
import { randomUUID } from 'crypto'
import { bandUserKey, listBandPosts, matchesMention, removeBandComment, removeBandPost } from './band'
import { attachDelivery, durableDelivery, DeliveryNeedsReview, digest, type Delivery } from './bandDelivery'
import { resultMessage, notificationWindow } from './notificationMessage'
import { getRoomPreferenceConfig } from './roomPreference'
import { LEASE_MS, milliseconds } from './schedulerQueue'
import { nextMinute } from './schedulerTiming'
import { resolveReservationSettingsForDate } from './reservationSettings'

export async function startNotification(db: Firestore, date: string) {
  const [config, settings] = await Promise.all([getRoomPreferenceConfig(db, date), resolveReservationSettingsForDate(db, date)])
  const ref = db.collection('lottery_results').doc(date)
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref), data = snap.data()
    if (!data) throw new Error('抽選結果が未作成です')
    if (data.notificationSentAt || data.pollStatus) return
    const window = notificationWindow(date, settings.notifyMode, settings.notifyTime)
    if (Date.now() < window.startsAt.getTime()) throw new Error('通知日時前です')
    if (config.notificationMode === 'comment' && Date.now() >= window.endsAt.getTime()) {
      tx.update(ref, { pollStatus: 'unnotified', notificationError: '通知確認期間を過ぎたため、手動確認が必要です' })
      return
    }
    tx.update(ref, { notificationMode: config.notificationMode, fallbackPost: config.fallbackPost,
      notifyMode: settings.notifyMode, notifyTime: settings.notifyTime,
      pollStatus: config.notificationMode === 'comment' ? 'active' : 'posting',
      pollStartsAt: window.startsAt, pollEndsAt: window.endsAt,
      pollTargetDate: date, deliveries: data.deliveries ?? {} })
  })
}

/** Same result lock protects initial delivery and cancellation replacements, even on legacy endpoints. */
export async function processNotification(db: Firestore, date: string): Promise<number | undefined> {
  const ref = db.collection('lottery_results').doc(date), token = randomUUID()
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref), data = snap.data()
    if (!data || milliseconds(data.notificationLeaseUntil) > Date.now()) return false
    tx.update(ref, { notificationLeaseUntil: new Date(Date.now() + LEASE_MS), notificationLeaseToken: token })
    return true
  })
  if (!claimed) return Date.now() + 30_000
  try {
    const data = (await ref.get()).data()!
    const revision = data.notificationRevision ?? 1, content = resultMessage(date, data)
    let deliveries: Record<string, Delivery> = { ...(data.deliveries ?? {}) }
    const isActive = data.pollStatus === 'active', end = milliseconds(data.pollEndsAt)
    const finished = isActive && Date.now() >= end
    if (data.pollStatus === 'unnotified' && !data.notificationDirty) return
    // Dirty results before their first notification must wait for the notification job.
    if (!data.pollStatus && !data.notificationSentAt && !Object.keys(deliveries).length) return
    // Resolve prior revisions too. A cancellation must never bypass an unknown initial send
    // by creating a new delivery ID for the newer revision.
    const attempts = await db.collection('band_deliveries').where('date', '==', date).get()
    for (const attempt of attempts.docs) {
      const previous = attempt.data()
      if (previous.status === 'sent') continue
      const recovered = await durableDelivery(db, date, previous.kind, previous.target, previous.content,
        previous.revision, await bandUserKey(previous.kind === 'comment' ? 'comment' : 'post'))
      await attachDelivery(db, date, previous.kind === 'comment' ? `p_${previous.target}` : 'post', recovered)
    }
    deliveries = { ...((await ref.get()).data()?.deliveries ?? {}) }
    if (!content) {
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(ref)
        if ((fresh.data()?.notificationRevision ?? 1) !== revision) return
        for (const old of Object.values(deliveries)) tx.set(db.collection('band_cleanup').doc(digest(`${old.postKey}:${old.commentKey ?? ''}`)), {
          ...old, kind: old.kind ?? 'post', date, nextAttemptAt: new Date(), expiresAt: new Date(Date.now() + 60 * 60_000), status: 'pending',
        })
        tx.update(ref, { deliveries: {}, notificationDirty: false, notificationRevisionSent: revision,
          notificationSentAt: new Date(), pollStatus: 'complete' })
      })
      return
    }
    const ownPostKey = await bandUserKey('post')
    const send = async (kind: Delivery['kind'], target: string, key: string, ownKey: string) => {
      if (deliveries[key]?.revision === revision) return
      const delivery = await durableDelivery(db, date, kind, target, content, revision, ownKey)
      await attachDelivery(db, date, key, delivery)
      deliveries[key] = delivery
    }
    if (data.notificationMode === 'post' && !data.notificationSentAt && data.pollStatus === 'posting') {
      await send('post', '', 'post', ownPostKey)
    }
    if (isActive) {
      if (Date.now() < milliseconds(data.pollStartsAt)) return milliseconds(data.pollStartsAt)
      // A complete scan is mandatory before deciding there is no matching post.
      const listed = await listBandPosts(finished ? 30 : 1, 'comment', milliseconds(data.pollStartsAt))
      if (finished && !listed.complete) throw new Error('BAND投稿の全件確認が完了していません')
      const ownCommentKey = await bandUserKey('comment')
      for (const post of listed.posts.filter((item) => item.created_at >= milliseconds(data.pollStartsAt) &&
        item.created_at < end && matchesMention(item, ownCommentKey))) {
        await send('comment', post.post_key, `p_${post.post_key}`, ownCommentKey)
      }
      await ref.update({ pollLastSuccessAt: new Date() })
      if (finished && !Object.values(deliveries).some((item) => item.kind === 'comment') && data.fallbackPost) {
        await send('post', '', 'post', ownPostKey)
      }
    }
    // Existing deliveries are updated even after the one-hour mention window has ended.
    for (const [key, previous] of Object.entries(deliveries)) {
      if (previous.revision === revision) continue
      const kind = previous.kind ?? 'post'
      await send(kind, kind === 'comment' ? previous.postKey : '', key,
        kind === 'comment' ? await bandUserKey('comment') : ownPostKey)
    }
    let changed = false
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref), fresh = snap.data()!
      changed = (fresh.notificationRevision ?? 1) !== revision
      const delivered = Object.keys(deliveries).length > 0
      const complete = !isActive || finished
      tx.update(ref, {
        ...(complete ? { pollStatus: delivered ? 'complete' : 'unnotified' } : {}),
        ...(delivered ? { notificationSentAt: fresh.notificationSentAt ?? new Date() } : {}),
        ...(!changed ? { notificationDirty: false, notificationRevisionSent: revision } : {}),
        notificationError: null,
      })
    })
    if (changed) return Date.now()
    return isActive && !finished ? Math.min(nextMinute(Date.now()), end) : undefined
  } catch (error: any) {
    // Never persist Axios errors or URLs containing credentials.
    await ref.update({ notificationError: error instanceof DeliveryNeedsReview ? error.message : '通知処理が失敗しました。再確認待ちです。' })
    throw error instanceof DeliveryNeedsReview ? error : new Error('通知処理に失敗しました。送信記録を保持して再確認します')
  } finally {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      if (snap.data()?.notificationLeaseToken === token) tx.update(ref, { notificationLeaseUntil: new Date(0), notificationLeaseToken: null })
    })
  }
}

export async function cleanupNotifications(db: Firestore): Promise<number | undefined> {
  const docs = await db.collection('band_cleanup').where('nextAttemptAt', '<=', new Date()).limit(10).get()
  for (const doc of docs.docs) {
    const old = doc.data() as Delivery & { expiresAt: any }
    if (milliseconds(old.expiresAt) <= Date.now()) {
      await doc.ref.update({ status: 'manual', nextAttemptAt: new Date('2100-01-01') })
      continue
    }
    try {
      if (old.kind === 'comment' && old.commentKey) await removeBandComment(old.postKey, old.commentKey)
      else await removeBandPost(old.postKey)
      await doc.ref.delete()
    } catch {
      await doc.ref.update({ nextAttemptAt: new Date(Date.now() + 5 * 60_000) })
    }
  }
  const next = await db.collection('band_cleanup').orderBy('nextAttemptAt').limit(1).get()
  const at = milliseconds(next.docs[0]?.data().nextAttemptAt)
  return at && at < Date.now() + 60 * 60_000 ? at : undefined
}
