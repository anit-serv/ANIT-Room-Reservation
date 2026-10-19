import { VercelRequest, VercelResponse } from '@vercel/node'
import * as admin from 'firebase-admin'
import { bandUserKey, listBandPosts, matchesMention, removeBandComment, removeBandPost, writeBandComment, writeBandPost } from './band'
import { resultMessage } from './notificationMessage'
import 'dotenv/config'

const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert({
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey,
}) })
const db = admin.firestore()
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type Delivery = { kind: 'post' | 'comment'; postKey: string; commentKey?: string; content: string; revision: number }

async function removeOld(delivery: Delivery) {
  const remove = async () => delivery.kind === 'comment' && delivery.commentKey
    ? removeBandComment(delivery.postKey, delivery.commentKey) : removeBandPost(delivery.postKey)
  try { await remove(); return }
  catch { await sleep(10_000) }
  try { await remove(); return }
  catch {
    await db.collection('band_cleanup').add({ ...delivery, createdAt: new Date(),
      nextAttemptAt: new Date(Date.now() + 5 * 60_000), expiresAt: new Date(Date.now() + 60 * 60_000) })
  }
}

async function processCleanup() {
  const snapshot = await db.collection('band_cleanup').where('nextAttemptAt', '<=', new Date()).limit(10).get()
  for (const doc of snapshot.docs) {
    const item = doc.data() as Delivery & { expiresAt: admin.firestore.Timestamp }
    if (item.expiresAt.toMillis() <= Date.now()) {
      await doc.ref.update({ status: 'manual', nextAttemptAt: new Date('2100-01-01T00:00:00Z') })
      continue
    }
    try {
      if (item.kind === 'comment' && item.commentKey) await removeBandComment(item.postKey, item.commentKey)
      else await removeBandPost(item.postKey)
      await doc.ref.delete()
    } catch {
      await doc.ref.update({ nextAttemptAt: new Date(Date.now() + 5 * 60_000) })
    }
  }
}

async function claim(ref: FirebaseFirestore.DocumentReference): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const current = await tx.get(ref)
    if (!current.exists || (current.data()?.pollLeaseUntil?.toMillis?.() ?? 0) > Date.now()) return false
    tx.update(ref, { pollLeaseUntil: new Date(Date.now() + 2 * 60_000) })
    return true
  })
}

async function processResult(ref: FirebaseFirestore.DocumentReference) {
  if (!await claim(ref)) return
  try {
    const snap = await ref.get()
    const data = snap.data()!
    const date = ref.id
    const revision = data.notificationRevision ?? 1
    const content = resultMessage(date, data)
    const deliveries: Record<string, Delivery> = { ...(data.deliveries ?? {}) }
    const windowStart = data.pollStartsAt?.toMillis?.() ?? 0
    const windowEnd = data.pollEndsAt?.toMillis?.() ?? 0
    const isActive = data.pollStatus === 'active'
    const ownKey = await bandUserKey(data.notificationMode === 'comment' ? 'comment' : 'post')
    const windowFinished = isActive && Date.now() >= windowEnd
    let fullScanSucceeded = false

    if (isActive) {
      if (!windowStart || !windowEnd || (!data.pollLastSuccessAt && windowFinished)) {
        await ref.update({ pollStatus: 'unnotified', notificationError: 'Polling window was not sufficiently checked' })
        return
      }
      if (Date.now() >= windowStart) {
        let listed
        try { listed = await listBandPosts(windowFinished ? 30 : 1, 'comment') }
        catch (err: any) {
          await ref.update({ notificationError: `BAND posts fetch failed: ${err.message}` })
          if (windowFinished) await ref.update({ pollStatus: 'unnotified' })
          return
        }
        fullScanSucceeded = listed.complete
        const matches = listed.posts.filter((post) => post.created_at >= windowStart && post.created_at < windowEnd &&
          matchesMention(post, ownKey))
        for (const target of matches) {
          const key = `p_${target.post_key}`
          const previous = deliveries[key]
          if (previous?.revision === revision) continue
          try {
            const commentKey = await writeBandComment(target.post_key, content, ownKey)
            deliveries[key] = { kind: 'comment', postKey: target.post_key, commentKey, content, revision }
            await ref.update({ deliveries })
            if (previous) await removeOld(previous)
          } catch (err: any) {
            await ref.update({ notificationError: `Comment send unknown for ${target.post_key}: ${err.message}`,
              pollStatus: 'unnotified' })
            return
          }
        }
        await ref.update({ pollLastSuccessAt: new Date(), notificationError: null })
      }
    }

    // A cancellation or unusable room can change a result after the original notice.
    if (data.notificationDirty || Object.values(deliveries).some((entry) => entry.revision !== revision)) {
      for (const [key, previous] of Object.entries(deliveries)) {
        if (previous.revision === revision) continue
        let replacement: Delivery
        if (previous.kind === 'comment') {
          const commentKey = await writeBandComment(previous.postKey, content, ownKey)
          replacement = { kind: 'comment', postKey: previous.postKey, commentKey, content, revision }
        } else {
          const postKey = await writeBandPost(content, await bandUserKey('post'))
          replacement = { kind: 'post', postKey, content, revision }
        }
        delete deliveries[key]
        deliveries[replacement.kind === 'post' ? 'post' : `p_${replacement.postKey}`] = replacement
        await ref.update({ deliveries })
        await removeOld(previous)
      }
      const fresh = await ref.get()
      if (fresh.data()?.notificationRevision === revision) {
        await ref.update({ notificationDirty: false, notificationRevisionSent: revision })
      }
    }

    if (windowFinished) {
      if (!fullScanSucceeded) {
        await ref.update({ pollStatus: 'unnotified', notificationError: 'BAND posts scan incomplete' })
        return
      }
      const hasComments = Object.values(deliveries).some((entry) => entry.kind === 'comment')
      if (!hasComments && data.fallbackPost === true) {
        const postKey = await writeBandPost(content, await bandUserKey('post'))
        deliveries.post = { kind: 'post', postKey, content, revision }
        await ref.update({ deliveries })
      }
      const latest = await ref.get()
      const revisionUnchanged = latest.data()?.notificationRevision === revision
      await ref.update({ pollStatus: hasComments || deliveries.post ? 'complete' : 'unnotified',
        ...(hasComments || deliveries.post ? { notificationSentAt: new Date() } : {}),
        ...(revisionUnchanged ? { notificationRevisionSent: revision, notificationDirty: false } : {}) })
    }
  } finally {
    await ref.update({ pollLeaseUntil: new Date(0) })
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!process.env.CRON_SECRET ||
      (req.query.key !== process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    await processCleanup()
    const [active, dirty] = await Promise.all([
      db.collection('lottery_results').where('pollStatus', '==', 'active').get(),
      db.collection('lottery_results').where('notificationDirty', '==', true).get(),
    ])
    const refs = new Map([...active.docs, ...dirty.docs].map((doc) => [doc.id, doc.ref]))
    const errors: string[] = []
    for (const ref of refs.values()) {
      try { await processResult(ref) }
      catch (err: any) {
        errors.push(`${ref.id}: ${err.message}`)
        await ref.update({ notificationError: err.message }).catch(() => {})
      }
    }
    return res.status(errors.length ? 503 : 200).json({ processed: refs.size, errors })
  } catch (error: any) {
    console.error('BAND poll error:', error.message)
    return res.status(500).json({ error: error.message })
  }
}
