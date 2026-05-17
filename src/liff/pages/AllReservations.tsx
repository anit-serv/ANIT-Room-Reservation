import { useState, useEffect } from 'react'
import Skeleton from '../../components/Skeleton'

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

  const activeSlots = slotMap
    ? (() => {
        const known = timeSlotOrder.filter((ts) => slotMap[ts]?.length)
        const extra = Object.keys(slotMap).filter((ts) => !timeSlotOrder.includes(ts) && slotMap[ts]?.length).sort()
        return [...known, ...extra]
      })()
    : []

  return (
    <div>
      <p className="text-[1.05rem] font-bold mb-4 text-ink">全登録表示</p>

      {error && <div className="banner-error">{error}</div>}

      {/* 日付チップ（横スクロール） */}
      <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1 mb-4">
        {dates.map((d) => (
          <button
            key={d.value}
            onClick={() => handleDateSelect(d.value)}
            className={
              'flex-shrink-0 px-3.5 py-1.5 border-[1.5px] rounded-full text-[0.85rem] cursor-pointer transition whitespace-nowrap ' +
              (selectedDate === d.value
                ? 'bg-brand border-brand text-white font-semibold'
                : 'bg-[#fafafa] border-line text-ink-sub')
            }
          >
            {d.label}
          </button>
        ))}
      </div>

      {loading && (
        <div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="mb-4">
              <Skeleton width="100px" height="14px" className="mb-2" />
              <Skeleton width="100%" height="40px" className="mb-1" />
              <Skeleton width="100%" height="40px" />
            </div>
          ))}
        </div>
      )}

      {slotMap && !loading && (
        activeSlots.length === 0
          ? (
            <div className="flex flex-col items-center gap-2 py-12 px-4 text-ink-pale text-center">
              <span className="icon icon-xl text-ink-pale">event_busy</span>
              <span className="text-[0.9rem]">この日の登録はまだありません</span>
            </div>
          )
          : activeSlots.map((ts) => (
            <div key={ts} className="mb-4">
              <div className="flex items-center gap-1.5 text-[0.8rem] font-bold text-ink-sub mb-1.5 px-1">
                <span className="icon icon-sm">schedule</span>
                <span>{ts}</span>
                <span className="ml-auto text-ink-pale font-normal">{slotMap[ts].length}件</span>
              </div>
              {slotMap[ts].map((entry, i) => (
                <div key={i} className="flex items-center gap-2.5 px-3 py-2 bg-surface border border-line rounded-lg mb-1 shadow-[var(--shadow-card-sm)]">
                  {entry.status === 'confirmed' ? (
                    <div className="w-[22px] h-[22px] rounded-full bg-brand-light text-brand-dark text-[0.7rem] font-bold flex items-center justify-center flex-shrink-0">
                      {i + 1}
                    </div>
                  ) : (
                    <div className="w-1.5 h-1.5 rounded-full bg-ink-pale flex-shrink-0" />
                  )}
                  <span className="text-[0.9rem] text-ink font-medium">{entry.bandName}</span>
                </div>
              ))}
            </div>
          ))
      )}

      {!selectedDate && !loading && (
        <div className="flex flex-col items-center gap-2 py-12 px-4 text-ink-pale text-center">
          <span className="icon icon-xl text-ink-pale">calendar_month</span>
          <span className="text-[0.9rem]">日付を選択してください</span>
        </div>
      )}
    </div>
  )
}
