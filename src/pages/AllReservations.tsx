import { useState, useEffect } from 'react'

type DateOption = { label: string; value: string }
type ReservationEntry = { bandName: string; status: string; order?: number }
type TimeSlotMap = { [timeSlot: string]: ReservationEntry[] }

const TIME_SLOT_ORDER = [
  '09:00-10:00',
  '10:00-12:00',
  '12:00-14:00',
  '14:00-16:00',
  '16:00-18:00',
  '18:00-20:00',
]

export default function AllReservations() {
  const [dates, setDates] = useState<DateOption[]>([])
  const [selectedDate, setSelectedDate] = useState('')
  const [slotMap, setSlotMap] = useState<TimeSlotMap | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div>
      <p className="section-title">全登録表示</p>

      {error && <div className="error" style={{ height: 'auto', padding: '0.75rem', marginBottom: '1rem' }}>{error}</div>}

      <div className="form-group">
        <label>日付を選択</label>
        <div className="select-grid">
          {dates.map((d) => (
            <button
              key={d.value}
              className={selectedDate === d.value ? 'selected' : ''}
              onClick={() => handleDateSelect(d.value)}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="loading" style={{ height: 'auto', padding: '2rem' }}>読み込み中...</div>}

      {slotMap && (
        <div>
          {TIME_SLOT_ORDER.filter((ts) => slotMap[ts]?.length).map((ts) => (
            <div key={ts} style={{ marginBottom: '1rem' }}>
              <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#555', marginBottom: '0.4rem' }}>
                🕐 {ts}
              </div>
              {slotMap[ts].map((r, i) => (
                <div key={i} className="reservation-card" style={{ marginBottom: '0.4rem', padding: '0.6rem 1rem' }}>
                  <div className="band-name" style={{ fontSize: '0.9rem' }}>
                    {r.status === 'confirmed' ? `${i + 1}. ` : '・'}{r.bandName}
                  </div>
                </div>
              ))}
            </div>
          ))}
          {TIME_SLOT_ORDER.every((ts) => !slotMap[ts]?.length) && (
            <div className="empty-state">この日の登録はまだありません</div>
          )}
        </div>
      )}
    </div>
  )
}
