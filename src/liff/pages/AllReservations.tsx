import { useState, useEffect } from 'react'

type TimeSlot    = { label: string; value: string }
type DateEntry   = { label: string; value: string; timeSlots: TimeSlot[] }
type SlotEntry   = { bandName: string; status: string; order?: number }
type TimeSlotMap = { [timeSlot: string]: SlotEntry[] }

export default function AllReservations() {
  const [dates,        setDates]        = useState<DateEntry[]>([])
  const [selectedDate, setSelectedDate] = useState('')
  const [slotMap,      setSlotMap]      = useState<TimeSlotMap | null>(null)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data) => setDates(data.availableDatesWithToday ?? []))
      .catch(() => setError('設定の取得に失敗しました'))
  }, [])

  const selectedDateEntry = dates.find((d) => d.value === selectedDate)
  const timeSlotOrder = (selectedDateEntry?.timeSlots ?? []).map((t) => t.value)

  async function handleDateSelect(date: string) {
    setSelectedDate(date)
    setSlotMap(null)
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/reservations/all?date=${date}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setSlotMap(data.slotMap ?? {})
    } catch {
      setError('取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  // 選択日付の時間枠順で並べる。順序にないものは末尾に補う。
  const activeSlots = slotMap
    ? (() => {
        const known = timeSlotOrder.filter((ts) => slotMap[ts]?.length)
        const extra = Object.keys(slotMap).filter((ts) => !timeSlotOrder.includes(ts) && slotMap[ts]?.length).sort()
        return [...known, ...extra]
      })()
    : []

  return (
    <div>
      <p className="page-title">全登録表示</p>

      {error && <div className="banner error">{error}</div>}

      {/* 日付チップ（横スクロール） */}
      <div className="date-scroll">
        {dates.map((d) => (
          <button
            key={d.value}
            className={`date-chip ${selectedDate === d.value ? 'selected' : ''}`}
            onClick={() => handleDateSelect(d.value)}
          >
            {d.label}
          </button>
        ))}
      </div>

      {/* ローディング */}
      {loading && (
        <div className="splash" style={{ height: 'auto', padding: '2.5rem 0' }}>
          <div className="spinner" />
        </div>
      )}

      {/* 結果 */}
      {slotMap && !loading && (
        activeSlots.length === 0
          ? (
            <div className="empty-state">
              <span className="icon icon-xl" style={{ color: 'var(--text-pale)' }}>event_busy</span>
              <span className="empty-text">この日の登録はまだありません</span>
            </div>
          )
          : activeSlots.map((ts) => (
            <div key={ts} className="time-section">
              <div className="time-header">
                <span className="icon icon-sm">schedule</span>
                <span>{ts}</span>
                <span style={{ marginLeft: 'auto', color: 'var(--text-pale)', fontWeight: 400 }}>
                  {slotMap[ts].length}件
                </span>
              </div>
              {slotMap[ts].map((entry, i) => (
                <div key={i} className="slot-item">
                  {entry.status === 'confirmed'
                    ? <div className="slot-rank">{i + 1}</div>
                    : <div className="slot-dot" />
                  }
                  <span className="slot-name">{entry.bandName}</span>
                </div>
              ))}
            </div>
          ))
      )}

      {/* 日付未選択 */}
      {!selectedDate && !loading && (
        <div className="empty-state">
          <span className="icon icon-xl" style={{ color: 'var(--text-pale)' }}>calendar_month</span>
          <span className="empty-text">日付を選択してください</span>
        </div>
      )}
    </div>
  )
}
