import { VercelRequest, VercelResponse } from '@vercel/node'
import * as admin from 'firebase-admin'
import 'dotenv/config'

const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  })
}
const db = admin.firestore()

const DEFAULT_TIME_SLOTS = [
  { label: '9:00~10:00', value: '09:00-10:00' },
  { label: '10:00~12:00', value: '10:00-12:00' },
  { label: '12:00~14:00', value: '12:00-14:00' },
  { label: '14:00~16:00', value: '14:00-16:00' },
  { label: '16:00~18:00', value: '16:00-18:00' },
  { label: '18:00~20:00', value: '18:00-20:00' },
]
const DEFAULT_AVAILABLE_DAYS = [3, 4, 6]
const WEEK_DAYS = ['日', '月', '火', '水', '木', '金', '土']

// forView=false（登録用）: 20:50以降は今日・翌日を除外 → 明後日以降のみ
// forView=true（全登録表示用）: 20:50以降は今日のみ除外、翌日は含む（抽選結果確認のため）
function buildDateList(availableDays: number[], forView: boolean): { label: string; value: string }[] {
  const nowJST = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const h = nowJST.getUTCHours()
  const mi = nowJST.getUTCMinutes()
  const afterLotteryPrep = h > 20 || (h === 20 && mi >= 50)

  const results: { label: string; value: string }[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(nowJST)
    d.setUTCDate(nowJST.getUTCDate() + i)
    d.setUTCHours(0, 0, 0, 0)

    if (!availableDays.includes(d.getUTCDay())) continue
    if (i === 0 && afterLotteryPrep) continue              // 今日: 20:50以降は常に除外
    if (i === 1 && afterLotteryPrep && !forView) continue  // 翌日: 登録は20:50以降除外、表示は含む

    const m = d.getUTCMonth() + 1
    const day = d.getUTCDate()
    const wd = WEEK_DAYS[d.getUTCDay()]
    const yyyy = d.getUTCFullYear()
    const mm = ('0' + m).slice(-2)
    const dd = ('0' + day).slice(-2)
    results.push({ label: `${m}/${day}(${wd})`, value: `${yyyy}-${mm}-${dd}` })
  }
  return results
}

function todayJST(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  try {
    const docRef = db.collection('settings').doc('reservation')
    let doc = await docRef.get()
    let data = doc.exists ? doc.data()! : {}

    // 予約済み設定変更が今日以前なら即座に適用
    const nextChange = data.nextChange
    if (nextChange && nextChange.effectiveFrom && nextChange.effectiveFrom <= todayJST()) {
      await docRef.set({
        availableDays: nextChange.availableDays,
        timeSlots: nextChange.timeSlots,
        nextChange: admin.firestore.FieldValue.delete(),
      }, { merge: true })
      data = {
        availableDays: nextChange.availableDays,
        timeSlots: nextChange.timeSlots,
      }
    }

    const availableDays: number[] = data.availableDays ?? DEFAULT_AVAILABLE_DAYS
    const timeSlots = data.timeSlots ?? DEFAULT_TIME_SLOTS

    return res.status(200).json({
      availableDates: buildDateList(availableDays, false),
      availableDatesWithToday: buildDateList(availableDays, true),
      timeSlots,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
