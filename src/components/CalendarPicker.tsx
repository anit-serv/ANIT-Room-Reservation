import { useState } from 'react'

type Props = {
  /** 単日選択モード: 選択中の日付 */
  value?: string
  /** 複数選択モード: 選択済み日付の配列（追加済みをハイライト） */
  selectedDates?: string[]
  /** 週選択モード（LIFF）: 選択中の週の日曜日 */
  selectedWeek?: string
  onChange: (date: string) => void
  /** この日付より前は選択不可 */
  min?: string
  /** この日付より後は選択不可 */
  maxDate?: string
  /**
   * 通常セル（未選択・有効）に追加するクラスを返す。
   * 未指定時は `text-ink hover:bg-brand-light cursor-pointer` が使われる。
   */
  getDayClass?: (date: string) => string
  getSelectedClass?: (date: string) => string
  isDateDisabled?: (date: string) => boolean
}

const MONTHS    = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月']
const WEEK_DAYS = ['日','月','火','水','木','金','土']

function todayJST(): string {
  return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)
}

function getSunday(date: string): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - d.getUTCDay())
  return d.toISOString().slice(0, 10)
}

export default function CalendarPicker({ value, selectedDates, selectedWeek, onChange, min, maxDate, getDayClass, getSelectedClass, isDateDisabled }: Props) {
  const initBase = selectedWeek || value || min || todayJST()
  const [[displayYear, displayMonth], setDisplay] = useState<[number, number]>(() => [
    parseInt(initBase.slice(0, 4)),
    parseInt(initBase.slice(5, 7)) - 1,
  ])
  const [view, setView] = useState<'days' | 'months'>('days')

  function prevMonth() {
    setDisplay(([y, m]) => m === 0 ? [y - 1, 11] : [y, m - 1])
  }
  function nextMonth() {
    setDisplay(([y, m]) => m === 11 ? [y + 1, 0] : [y, m + 1])
  }
  function prevYear() {
    setDisplay(([y, m]) => [y - 1, m])
  }
  function nextYear() {
    setDisplay(([y, m]) => [y + 1, m])
  }

  const firstWeekday = new Date(displayYear, displayMonth, 1).getDay()
  const daysInMonth  = new Date(displayYear, displayMonth + 1, 0).getDate()

  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const today  = todayJST()
  const nextYM = displayMonth === 11
    ? `${displayYear + 1}-01`
    : `${displayYear}-${String(displayMonth + 2).padStart(2, '0')}`

  function toDateStr(day: number) {
    return `${displayYear}-${String(displayMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  return (
    <div className="border border-line rounded-xl p-3 bg-surface w-[252px] select-none shadow-[var(--shadow-card-sm)]">

      {/* ── 月選択ビュー ── */}
      {view === 'months' && (
        <>
          <div className="flex items-center justify-between gap-3 mb-3">
            <button type="button" className="btn-icon-nav" onClick={prevYear} aria-label="前の年">
              <span className="icon">chevron_left</span>
            </button>
            <span className="font-semibold text-[0.9rem] text-ink flex-1 text-center">{displayYear}年</span>
            <button type="button" className="btn-icon-nav" onClick={nextYear} aria-label="次の年">
              <span className="icon">chevron_right</span>
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {MONTHS.map((label, i) => {
              const firstDay = `${displayYear}-${String(i + 1).padStart(2, '0')}-01`
              const lastDay  = `${displayYear}-${String(i + 1).padStart(2, '0')}-${String(new Date(displayYear, i + 1, 0).getDate()).padStart(2, '0')}`
              const isMonthDisabled = (!!min && lastDay < min) || (!!maxDate && firstDay > maxDate)
              return (
                <button
                  key={i}
                  type="button"
                  disabled={isMonthDisabled}
                  onClick={() => { if (!isMonthDisabled) { setDisplay([displayYear, i]); setView('days') } }}
                  className={`py-2 rounded-lg text-[0.83rem] transition ${
                    isMonthDisabled
                      ? 'text-ink-pale opacity-40 cursor-not-allowed'
                      : i === displayMonth
                        ? 'bg-brand text-white font-bold'
                        : 'text-ink hover:bg-brand-light cursor-pointer'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </>
      )}

      {/* ── 日付ビュー ── */}
      {view === 'days' && (
        <>
          {/* ヘッダー */}
          <div className="flex items-center justify-between gap-3 mb-2">
            <button type="button" className="btn-icon-nav" onClick={prevMonth} aria-label="前の月">
              <span className="icon">chevron_left</span>
            </button>
            <button
              type="button"
              onClick={() => setView('months')}
              className="font-semibold text-[0.9rem] text-ink min-w-[6rem] text-center hover:text-brand transition cursor-pointer"
            >
              {displayYear}年 {MONTHS[displayMonth]}
            </button>
            <button
              type="button"
              className="btn-icon-nav"
              onClick={nextMonth}
              disabled={!!maxDate && nextYM > maxDate.slice(0, 7)}
              aria-label="次の月"
            >
              <span className="icon">chevron_right</span>
            </button>
          </div>

          {/* 曜日ヘッダー */}
          <div className="grid grid-cols-7 mb-1">
            {WEEK_DAYS.map((d, i) => (
              <div key={d} className={`text-center text-[0.72rem] font-semibold py-0.5 ${
                i === 0 ? 'text-danger' : i === 6 ? 'text-brand' : 'text-ink-sub'
              }`}>
                {d}
              </div>
            ))}
          </div>

          {/* 日付グリッド */}
          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((day, idx) => {
              if (!day) return <div key={idx} />

              const dateStr    = toDateStr(day)
              const isDisabled = (!!min && dateStr < min) || (!!maxDate && dateStr > maxDate) || !!isDateDisabled?.(dateStr)
              const isHighlighted =
                (!!value && dateStr === value) ||
                (!!selectedDates && selectedDates.includes(dateStr)) ||
                (!!selectedWeek && getSunday(dateStr) === selectedWeek)
              const isToday = dateStr === today
              const col     = idx % 7

              let cellClass: string
              if (isHighlighted) {
                cellClass = getSelectedClass?.(dateStr) ?? 'bg-brand text-white font-bold cursor-pointer'
              } else if (isDisabled) {
                cellClass = 'text-ink-pale cursor-not-allowed opacity-50'
              } else if (isToday) {
                const extra = getDayClass?.(dateStr) ?? 'text-ink hover:bg-brand-light cursor-pointer'
                cellClass = `ring-1 ring-brand font-semibold ${extra}`
              } else {
                const extra = getDayClass?.(dateStr) ?? 'text-ink hover:bg-brand-light cursor-pointer'
                const dayColor = getDayClass
                  ? ''
                  : col === 0 ? 'text-danger' : col === 6 ? 'text-brand' : ''
                cellClass = `${extra} ${dayColor}`
              }

              return (
                <button
                  key={idx}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => !isDisabled && onChange(dateStr)}
                  className={`w-8 h-8 mx-auto rounded-full text-[0.83rem] flex items-center justify-center transition ${cellClass}`}
                >
                  {day}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
