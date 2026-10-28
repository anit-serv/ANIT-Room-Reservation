import type { Firestore } from 'firebase-admin/firestore'
import { resolveReservationSettingsForDate } from './reservationSettings'
import { assignRooms, getRoomPreferenceConfig, isRoomPreferenceEnabled, roomDayRef, usableRooms } from './roomPreference'

function shuffleArray<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array
}
export async function runLotteryForDate(db: Firestore, targetDateStr: string, forceExecute = false) {
    console.log(`Running lottery for target date: ${targetDateStr}`);
    const [roomPreferenceEnabled, notificationConfig, dateSettings] = await Promise.all([
      isRoomPreferenceEnabled(db, targetDateStr),
      getRoomPreferenceConfig(db, targetDateStr),
      resolveReservationSettingsForDate(db, targetDateStr),
    ]);
    const resultRef = db.collection('lottery_results').doc(targetDateStr);
    if (!forceExecute && (await resultRef.get()).exists) {
      return { status: 'skipped', targetDate: targetDateStr };
    }

    // 受付終了後の予約をトランザクション内で読み、キャンセルや同時実行と競合させない。
    const pendingQuery = db.collection('reservations')
      .where('status', '==', 'pending')
      .where('date', '>=', `${targetDateStr}T00:00`)
      .where('date', '<=', `${targetDateStr}T23:59`);

    const outcome = await db.runTransaction(async (tx) => {
      if (!forceExecute && (await tx.get(resultRef)).exists) return { status: 'already', processed: 0 };
      const roomDay = roomPreferenceEnabled ? await tx.get(roomDayRef(db, targetDateStr)) : null;
      const snapshot = await tx.get(pendingQuery);


      const grouped: Record<string, FirebaseFirestore.QueryDocumentSnapshot[]> = {};
      snapshot.forEach((doc) => {
        const timeSlot = doc.data().date.split('T')[1];
        (grouped[timeSlot] ??= []).push(doc);
      });
      const resultData: any = { updatedAt: new Date(), targetDate: targetDateStr, results: {},
        roomPreferenceEnabled, notificationMode: notificationConfig.notificationMode,
        fallbackPost: notificationConfig.fallbackPost, lotteryMode: dateSettings.lotteryMode,
        notifyMode: dateSettings.notifyMode,
        notifyTime: dateSettings.notifyTime, notificationRevision: 1 };
      let processed = 0;
      for (const [timeSlot, docs] of Object.entries(grouped)) {
        const priority = docs.filter((doc) => doc.data().hamoani === true);
        const ordinary = docs.filter((doc) => doc.data().hamoani !== true);
        const ranked = [...shuffleArray([...priority]), ...shuffleArray([...ordinary])];
        const availableRooms = roomPreferenceEnabled ? usableRooms(roomDay?.data()?.slots?.[timeSlot]) : [];
        const assignments = roomPreferenceEnabled ? assignRooms(ranked.map((doc, index) => ({
          id: doc.id, preferredRooms: doc.data().preferredRooms ?? [], lotteryRank: index + 1,
        })), availableRooms) : [];
        const assignmentById = new Map(assignments.map((entry) => [entry.id, entry]));
        const order: string[] = [];
        const hamoaniBands: string[] = [];
        ranked.forEach((doc, index) => {
          const data = doc.data();
          const bandName = data.bandName || 'バンド名なし';
          tx.update(doc.ref, {
            lotteryRank: index + 1,
            lotteryTotal: ranked.length,
            lotteryDate: targetDateStr,
            status: 'confirmed',
            order: index + 1,
            ...(roomPreferenceEnabled ? {
              assignedRoom: assignmentById.get(doc.id)?.assignedRoom ?? null,
              waitRank: assignmentById.get(doc.id)?.waitRank ?? null,
            } : {}),
          });
          order.push(bandName);
          if (data.hamoani === true) hamoaniBands.push(bandName);
          processed++;
        });
        resultData.results[timeSlot] = { count: ranked.length, order, hamoaniBands,
          rankedEntries: ranked.map((doc, index) => ({ reservationId: doc.id,
            bandName: doc.data().bandName || 'バンド名なし', lotteryRank: index + 1,
            hamoani: doc.data().hamoani === true })),
          ...(roomPreferenceEnabled ? { assignments: ranked.map((doc) => ({
            reservationId: doc.id,
            bandName: doc.data().bandName || 'バンド名なし',
            lotteryRank: assignmentById.get(doc.id)?.lotteryRank,
            assignedRoom: assignmentById.get(doc.id)?.assignedRoom ?? null,
            waitRank: assignmentById.get(doc.id)?.waitRank ?? null,
          })) } : {}) };
      }
      tx.set(resultRef, resultData);
      return { status: 'success', processed };
    });
    if (outcome.status === 'already') return { status: 'skipped', targetDate: targetDateStr };

    return {
      status: 'success',
      targetDate: targetDateStr,
      processed: outcome.processed,
      message: 'Lottery completed.',
    };

}
