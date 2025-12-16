import * as admin from 'firebase-admin';

/**
 * 抽選結果をreservationsコレクションに反映する
 * @param targetDateStr 対象日付 (例: "2024-12-20")
 * @param db Firestore instance
 * @returns 更新件数
 */
export async function updateReservationStatus(
  targetDateStr: string,
  db: admin.firestore.Firestore
): Promise<number> {
  // 1. Firestoreから抽選結果を取得
  const resultDoc = await db.collection('lottery_results').doc(targetDateStr).get();

  if (!resultDoc.exists) {
    console.log(`No lottery results found for ${targetDateStr}`);
    return 0;
  }

  const data = resultDoc.data();
  const results = data?.results || {};

  // 結果がない場合
  if (Object.keys(results).length === 0) {
    console.log(`No entries found in lottery results for ${targetDateStr}`);
    return 0;
  }

  // 2. 抽選結果をreservationsに反映
  let updatedCount = 0;
  const timeSlots = Object.keys(results);

  for (const timeSlot of timeSlots) {
    const slotData = results[timeSlot];
    const bands: string[] = slotData.order || [];
    
    if (bands.length > 0) {
      const dateTime = `${targetDateStr}T${timeSlot}`;
      
      // 該当する日時の予約を取得
      const snapshot = await db.collection('reservations')
        .where('date', '==', dateTime)
        .get();
      
      // バンド名でマッチングして更新
      for (const doc of snapshot.docs) {
        const docData = doc.data();
        const bandName = docData.bandName || '';
        
        // 抽選結果に含まれているバンドなら確定状態に更新
        if (bands.includes(bandName) && docData.status !== 'confirmed') {
          const bandIndex = bands.indexOf(bandName);
          await db.collection('reservations').doc(doc.id).update({
            status: 'confirmed',
            order: bandIndex // 順番も記録
          });
          updatedCount++;
        }
      }
    }
  }

  console.log(`Updated ${updatedCount} reservations to confirmed status for ${targetDateStr}`);
  return updatedCount;
}
