export function resultMessage(date: string, resultData: any): string {
  const displayDate = date.replace(/-/g, '/').slice(5)
  const weekdays = ['日', '月', '火', '水', '木', '金', '土']
  const weekday = weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()]
  let text = `📢 【部屋取り抽選結果】＜${displayDate}(${weekday})＞\n\n`
  let hasContent = false
  for (const slot of Object.keys(resultData.results ?? {}).sort()) {
    const data = resultData.results[slot]
    const entries = data.rankedEntries ?? (data.order ?? []).map((bandName: string, index: number) => ({
      bandName, lotteryRank: index + 1, hamoani: (data.hamoaniBands ?? []).includes(bandName),
    }))
    if (!entries.length) continue
    hasContent = true
    text += `【${slot}】\n`
    if (resultData.roomPreferenceEnabled) {
      const assignments = new Map((data.assignments ?? []).map((entry: any) => [entry.reservationId, entry]))
      for (const entry of entries) {
        const assigned: any = assignments.get(entry.reservationId)
        const label = entry.hamoani ? `${entry.bandName}（ハモアニ）` : entry.bandName
        text += `${entry.lotteryRank}. ${label}：${assigned?.assignedRoom ?? `待機${assigned?.waitRank ?? '-'}位`}\n`
      }
    } else {
      for (const entry of entries) {
        const label = entry.hamoani ? `${entry.bandName}（ハモアニ）` : entry.bandName
        text += `${entry.lotteryRank}. ${label}\n`
      }
    }
    text += '\n'
  }
  if (!hasContent) return ''
  return `${text}------------------\n※詳細はLINE ANIT部屋取りシステム【全登録一覧】からも確認できます。`
}

export function notificationWindow(date: string, notifyMode: 'previous-day' | 'same-day', notifyTime: string) {
  const day = new Date(`${date}T00:00:00+09:00`)
  if (notifyMode === 'previous-day') day.setUTCDate(day.getUTCDate() - 1)
  const [hour, minute] = notifyTime.split(':').map(Number)
  const startsAt = new Date(day.getTime() + (hour * 60 + minute) * 60_000)
  return { startsAt, endsAt: new Date(startsAt.getTime() + 60 * 60_000) }
}
