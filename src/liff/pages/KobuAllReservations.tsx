import { useState, useEffect } from 'react'
import Skeleton from '../../components/Skeleton'
import DatePicker from '../../components/DatePicker'

type BookingBlock = { bandName: string; startTime: string; endTime: string }
type DayMap = Record<string, BookingBlock[]>

const OPEN_MINUTES  = 8 * 60   // 08:00
const CLOSE_MINUTES = 20 * 60  // 20:00
const TOTAL_MINUTES = CLOSE_MINUTES - OPEN_MINUTES

const WEEK_DAYS_JP = ['日', '月', '火', '水', '木', '金', '土']

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function formatDate(dateStr: string): { md: string; wd: string } {
  const d  = new Date(dateStr + 'T00:00:00Z')
  const m  = d.getUTCMonth() + 1
  const dd = d.getUTCDate()
  const wd = WEEK_DAYS_JP[d.getUTCDay()]
  return { md: `${m}/${dd}`, wd }
}

function getMondayOfWeek(dateStr: string): string {
  const d  = new Date(dateStr + 'T00:00:00Z')
  const wd = d.getUTCDay()
  const diff = wd === 0 ? -6 : 1 - wd
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().slice(0, 10)
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function todayJST(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

const HOUR_LABELS = Array.from({ length: 13 }, (_, i) => `${8 + i}:00`)

export default function KobuAllReservations() {
  const [weekStart,   setWeekStart]   = useState(() => getMondayOfWeek(todayJST()))
  const [dayMap,      setDayMap]      = useState<DayMap | null>(null)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [jumpDate,    setJumpDate]    = useState('')

  useEffect(() => { fetchWeek(weekStart) }, [weekStart])

  async function fetchWeek(start: string) {
    setLoading(true)
    setError(null)
    setDayMap(null)
    try {
      const res = await fetch(`/api/kobu-reservations/all?weekStart=${start}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setDayMap(data.dayMap ?? {})
    } catch {
      setError('取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  function handleJump() {
    if (!jumpDate) return
    setWeekStart(getMondayOfWeek(jumpDate))
  }

  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const weekEnd   = weekDates[6]

  const { md: startMd } = formatDate(weekStart)
  const { md: endMd }   = formatDate(weekEnd)

  return (
    <div>
      <p className="text-[1.05rem] font-bold mb-3 text-ink">工部室 全体スケジュール</p>

      {/* 週ナビゲーション */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button className="btn-icon" onClick={() => setWeekStart(addDays(weekStart, -7))}
          title="前の週">
          <span className="icon">chevron_left</span>
        </button>
        <span className="text-[0.9rem] font-semibold text-ink min-w-[120px] text-center">
          {startMd} 〜 {endMd}
        </span>
        <button className="btn-icon" onClick={() => setWeekStart(addDays(weekStart, 7))}
          title="次の週">
          <span className="icon">chevron_right</span>
        </button>
        <button className="btn-outline w-auto px-3 py-1.5 text-[0.8rem]"
          onClick={() => setWeekStart(getMondayOfWeek(todayJST()))}>
          今週
        </button>
        <div className="flex items-center gap-1.5 ml-auto">
          <DatePicker value={jumpDate} onChange={setJumpDate} placeholder="日付を選択" />
          <button className="btn-outline w-auto px-3 py-1.5 text-[0.8rem]" onClick={handleJump}>
            移動
          </button>
        </div>
      </div>

      {error && <div className="banner-error">{error}</div>}

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width="100%" height="80px" />
          ))}
        </div>
      ) : dayMap !== null ? (
        <WeekSchedule weekDates={weekDates} dayMap={dayMap} />
      ) : null}
    </div>
  )
}

function WeekSchedule({ weekDates, dayMap }: { weekDates: string[]; dayMap: DayMap }) {
  const today = todayJST()

  return (
    <div className="bg-surface border border-line rounded-xl overflow-hidden shadow-[var(--shadow-card-sm)]">
      {/* ヘッダー */}
      <div className="flex border-b border-line">
        <div className="w-12 flex-shrink-0" />
        {weekDates.map((date) => {
          const { md, wd } = formatDate(date)
          const isToday    = date === today
          return (
            <div key={date}
              className={
                'flex-1 text-center py-2 border-l border-line text-[0.78rem] font-semibold ' +
                (isToday ? 'bg-brand-light text-brand-dark' : 'text-ink-sub')
              }>
              <div>{md}</div>
              <div>{wd}</div>
            </div>
          )
        })}
      </div>

      {/* グリッド */}
      <div className="relative overflow-y-auto" style={{ maxHeight: '480px' }}>
        {/* 時刻ラベル＋横線 */}
        <div className="relative" style={{ height: `${TOTAL_MINUTES}px` }}>
          {HOUR_LABELS.map((label, idx) => {
            const top = idx * 60
            return (
              <div key={label} className="absolute left-0 right-0 flex items-start"
                style={{ top }}>
                <div className="w-12 text-[0.7rem] text-ink-pale pr-1 text-right leading-none -translate-y-1/2 flex-shrink-0">
                  {label}
                </div>
                <div className="flex-1 border-t border-line" />
              </div>
            )
          })}

          {/* 各日の予約ブロック */}
          <div className="absolute inset-0 flex">
            <div className="w-12 flex-shrink-0" />
            {weekDates.map((date) => {
              const blocks   = dayMap[date] ?? []
              const isToday  = date === today
              return (
                <div key={date}
                  className={'flex-1 relative border-l border-line ' + (isToday ? 'bg-brand-light/20' : '')}>
                  {blocks.map((b, i) => {
                    const top    = toMinutes(b.startTime) - OPEN_MINUTES
                    const height = toMinutes(b.endTime)   - toMinutes(b.startTime)
                    return (
                      <div key={i}
                        className="absolute left-0.5 right-0.5 rounded bg-brand text-white text-[0.68rem] font-semibold px-1 overflow-hidden flex flex-col justify-start pt-0.5 shadow-sm"
                        style={{ top, height }}>
                        <span className="truncate leading-tight">{b.bandName}</span>
                        {height >= 30 && (
                          <span className="text-white/80 text-[0.6rem] leading-tight truncate">
                            {b.startTime}〜{b.endTime}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* 凡例 */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-line">
        <div className="w-3 h-3 rounded bg-brand flex-shrink-0" />
        <span className="text-[0.75rem] text-ink-sub">予約あり</span>
        <span className="text-[0.75rem] text-ink-pale ml-2">
          ※ 時間軸: {`${Math.floor(OPEN_MINUTES / 60)}:00`}〜{`${Math.floor(CLOSE_MINUTES / 60)}:00`}（1px = 1分）
        </span>
      </div>
    </div>
  )
}
