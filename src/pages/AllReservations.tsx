import { useState, useEffect } from 'react'

type DateOption    = { label: string; value: string }
type SlotEntry     = { bandName: string; status: string; order?: number }
type TimeSlotMap   = { [timeSlot: string]: SlotEntry[] }

const TIME_SLOT_ORDER = [
  '09:00-10:00', '10:00-12:00', '12:00-14:00',
  '14:00-16:00', '16:00-18:00', '18:00-20:00',
]

export default function AllReservations() {
  const [dates,        setDates]        = useState<DateOption[]>([])
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

  const activeSlots = slotMap
    ? TIME_SLOT_ORDER.filter((ts) => slotMap[ts]?.length)
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
              <span className="empty-icon">📭</span>
              <span className="empty-text">この日の登録はまだありません</span>
            </div>
          )
          : activeSlots.map((ts) => (
            <div key={ts} className="time-section">
              <div className="time-header">
                <span>🕐</span>
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
          <span className="empty-icon">📅</span>
          <span className="empty-text">日付を選択してください</span>
        </div>
      )}
    </div>
  )
}
