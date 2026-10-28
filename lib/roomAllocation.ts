import type { Firestore, Transaction } from 'firebase-admin/firestore'
import { assignRooms, roomDayRef, usableRooms } from './roomPreference'
import { schedulerEnabled, QUEUE } from './schedulerQueue'

/** Keep the original lottery ranks while reflecting a cancellation or unusable room. */
export async function refreshLotterySlot(
  db: Firestore, tx: Transaction, date: string, timeSlot: string, excludedIds: string[] = [],
  availableOverride?: string[],
): Promise<boolean> {
  const resultRef = db.collection('lottery_results').doc(date)
  const jobRef = db.collection(QUEUE).doc(`band_${date}`)
  const [result, reservations, day, job] = await Promise.all([
    tx.get(resultRef),
    tx.get(db.collection('reservations').where('date', '==', `${date}T${timeSlot}`)),
    tx.get(roomDayRef(db, date)),
    schedulerEnabled() ? tx.get(jobRef) : Promise.resolve(null),
  ])
  if (!result.exists) return false
  const resultData = result.data()!
  const ranked = reservations.docs
    .filter((doc) => doc.data().status !== 'cancelled' && !excludedIds.includes(doc.id))
    .sort((a, b) => (a.data().lotteryRank ?? a.data().order ?? 9999) - (b.data().lotteryRank ?? b.data().order ?? 9999))
  const previous = resultData.results?.[timeSlot] ?? {}
  const order = ranked.map((doc) => doc.data().bandName || 'バンド名なし')
  const hamoaniBands = ranked.filter((doc) => doc.data().hamoani === true).map((doc) => doc.data().bandName)
  let nextSlot: Record<string, unknown> = { ...previous, count: ranked.length, order, hamoaniBands,
    rankedEntries: ranked.map((doc) => ({ reservationId: doc.id,
      bandName: doc.data().bandName || 'バンド名なし',
      lotteryRank: doc.data().lotteryRank ?? doc.data().order,
      hamoani: doc.data().hamoani === true })) }
  if (resultData.roomPreferenceEnabled === true) {
    const available = availableOverride ?? usableRooms(day.data()?.slots?.[timeSlot])
    const assignments = assignRooms(ranked.map((doc) => ({
      id: doc.id, preferredRooms: doc.data().preferredRooms ?? [],
      lotteryRank: doc.data().lotteryRank ?? doc.data().order,
    })), available)
    const byId = new Map(assignments.map((entry) => [entry.id, entry]))
    for (const doc of ranked) {
      const assignment = byId.get(doc.id)!
      tx.update(doc.ref, { assignedRoom: assignment.assignedRoom, waitRank: assignment.waitRank,
        updatedAt: new Date() })
    }
    nextSlot = { ...nextSlot, assignments: ranked.map((doc) => ({
      reservationId: doc.id,
      bandName: doc.data().bandName || 'バンド名なし',
      lotteryRank: byId.get(doc.id)?.lotteryRank,
      assignedRoom: byId.get(doc.id)?.assignedRoom ?? null,
      waitRank: byId.get(doc.id)?.waitRank ?? null,
    })) }
  }
  tx.update(resultRef, {
    results: { ...resultData.results, [timeSlot]: nextSlot },
    notificationRevision: (resultData.notificationRevision ?? 1) + 1,
    notificationDirty: true,
    updatedAt: new Date(),
  })
  if (schedulerEnabled() && job?.data()?.status !== 'manual') {
    const previous = job?.data()
    tx.set(jobRef, { kind: 'band', date,
      status: previous?.status === 'running' ? 'running' : 'pending',
      dueAt: new Date(), availableAt: new Date(), requestedAt: new Date(),
      generation: (previous?.generation ?? 0) + 1, attempts: 0,
    }, { merge: true })
  }
  return true
}
