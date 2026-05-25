import { useState, useEffect } from 'react'
import type { LiffProfile } from '../LiffApp'
import Skeleton from '../../components/Skeleton'

type NobuRoomEditTarget = { id: string; date: string; bandName: string; startTime: string; endTime: string }
type Props = {
  profile: LiffProfile
  initialEdit?: NobuRoomEditTarget | null
  onEditHandled?: () => void
  onBookingActive?: (active: boolean) => void
}

type TimeSlot      = { label: string; value: string }
type PerDaySchedule = { enabled: boolean; byWeekday: Record<string, TimeSlot[]>; byDate: Record<string, TimeSlot[]> }

type NobuRoomSettings = {
  availableDays:  number[]
  extraDates:     string[]
  excludedDates:  string[]
  timeSlots:      TimeSlot[]
  perDaySchedule: PerDaySchedule
}

type BookingBlock = { id: string; userId: string; bandName: string; startTime: string; endTime: string }
type DayMap       = Record<string, BookingBlock[]>
type ModalState   = { date: string }
type DetailModal  = { block: BookingBlock; date: string }

// ─── 時刻ユーティリティ ───────────────────────────────
function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function minutesToTime(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

function todayJST(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function maxBookingDate(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000)
  d.setFullYear(d.getFullYear() + 1)
  return d.toISOString().slice(0, 10)
}

function getSundayOfWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - d.getUTCDay())
  return d.toISOString().slice(0, 10)
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function formatDate(dateStr: string) {
  const WEEK_DAYS_JP = ['日', '月', '火', '水', '木', '金', '土']
  const d = new Date(dateStr + 'T00:00:00Z')
  return { md: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, wd: WEEK_DAYS_JP[d.getUTCDay()] }
}

// ─── 予約可能チェック ──────────────────────────────────
function isDateAvailable(date: string, settings: NobuRoomSettings, today: string, maxDate: string): boolean {
  if (date < today || date > maxDate) return false
  if (settings.excludedDates.includes(date)) return false
  const wd = new Date(date + 'T00:00:00Z').getUTCDay()
  return settings.availableDays.includes(wd) || settings.extraDates.includes(date)
}

// ─── タイムスロットユーティリティ ────────────────────
function getEffectiveSlots(date: string, settings: NobuRoomSettings): TimeSlot[] {
  const { perDaySchedule, timeSlots } = settings
  if (!perDaySchedule?.enabled) return timeSlots ?? []
  if (perDaySchedule.byDate?.[date]?.length)  return perDaySchedule.byDate[date]
  const wd = String(new Date(date + 'T00:00:00Z').getUTCDay())
  if (perDaySchedule.byWeekday?.[wd]?.length) return perDaySchedule.byWeekday[wd]
  return timeSlots ?? []
}

function slotsRange(slots: TimeSlot[]): { open: number; close: number } {
  if (!slots.length) return { open: 8 * 60, close: 20 * 60 }
  const starts = slots.map(s => toMinutes(s.value.split('-')[0]))
  const ends   = slots.map(s => toMinutes(s.value.split('-')[1]))
  return { open: Math.min(...starts), close: Math.max(...ends) }
}

function isMinInSlots(minute: number, slots: TimeSlot[]): boolean {
  return slots.some(s => {
    const [a, b] = s.value.split('-').map(toMinutes)
    return minute >= a && minute < b
  })
}

function computeGrayZones(slots: TimeSlot[], dispStart: number, dispEnd: number): { top: number; height: number }[] {
  const sorted = [...slots]
    .map(s => { const [a, b] = s.value.split('-').map(toMinutes); return { a, b } })
    .filter(r => r.b > r.a).sort((x, y) => x.a - y.a)
  const zones: { top: number; height: number }[] = []
  let cur = dispStart
  for (const { a, b } of sorted) {
    if (a > cur) zones.push({ top: cur - dispStart, height: a - cur })
    cur = Math.max(cur, b)
  }
  if (cur < dispEnd) zones.push({ top: cur - dispStart, height: dispEnd - cur })
  return zones
}

// ─── 時間オプション生成 ───────────────────────────────
function buildStartOptions(date: string, dayMap: DayMap, slots: TimeSlot[]): string[] {
  const blocks = dayMap[date] ?? []
  const opts: string[] = []
  for (const s of slots) {
    const [a, b] = s.value.split('-').map(toMinutes)
    for (let m = a; m < b; m += 15) {
      if (!blocks.some(blk => m >= toMinutes(blk.startTime) && m < toMinutes(blk.endTime)))
        opts.push(minutesToTime(m))
    }
  }
  return opts.sort()
}

function prevMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

function nextMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

function getCalendarDays(ym: string): (string | null)[] {
  const [y, m] = ym.split('-').map(Number)
  const firstDay    = new Date(Date.UTC(y, m - 1, 1))
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const pad = firstDay.getUTCDay()
  const days: (string | null)[] = Array(pad).fill(null)
  for (let d = 1; d <= daysInMonth; d++)
    days.push(`${ym}-${String(d).padStart(2, '0')}`)
  while (days.length % 7 !== 0) days.push(null)
  return days
}

function buildEndOptions(startMinutes: number, date: string, dayMap: DayMap, slots: TimeSlot[]): string[] {
  const blocks = dayMap[date] ?? []
  const slot = slots.find(s => {
    const [a, b] = s.value.split('-').map(toMinutes)
    return startMinutes >= a && startMinutes < b
  })
  if (!slot) return []
  const slotEnd = toMinutes(slot.value.split('-')[1])
  const nextBlock = blocks.map(b => toMinutes(b.startTime)).filter(m => m > startMinutes)
    .reduce((min, m) => Math.min(min, m), slotEnd)
  const opts: string[] = []
  for (let m = startMinutes + 15; m <= nextBlock; m += 15) opts.push(minutesToTime(m))
  return opts
}

// ─── メインコンポーネント ──────────────────────────────
export default function NobuRoomSchedule({ profile, initialEdit, onEditHandled, onBookingActive }: Props) {
  const [settings,     setSettings]     = useState<NobuRoomSettings | null>(null)
  const [weekStart,    setWeekStart]    = useState(() => getSundayOfWeek(todayJST()))
  const [dayMap,       setDayMap]       = useState<DayMap | null>(null)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [modal,        setModal]        = useState<ModalState | null>(null)
  const [bandName,     setBandName]     = useState('')
  const [modalStart,   setModalStart]   = useState('')
  const [modalEnd,     setModalEnd]     = useState('')
  const [editingId,    setEditingId]    = useState<string | null>(null)
  const [submitting,   setSubmitting]   = useState(false)
  const [submitError,  setSubmitError]  = useState<string | null>(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [calMonth,     setCalMonth]     = useState('')
  const [detailModal,  setDetailModal]  = useState<DetailModal | null>(null)
  const [cancelling,    setCancelling]    = useState(false)
  const [cancelError,   setCancelError]   = useState<string | null>(null)
  const [cancelConfirm, setCancelConfirm] = useState(false)
  const [closeConfirm,  setCloseConfirm]  = useState(false)
  const [editOriginal,  setEditOriginal]  = useState<{ bandName: string; startTime: string; endTime: string } | null>(null)
  const [pendingEdit,   setPendingEdit]   = useState<NobuRoomEditTarget | null>(null)

  useEffect(() => {
    if (modal === null) { onBookingActive?.(false); return }
    const dirty = editingId
      ? (bandName.trim() !== editOriginal?.bandName || modalStart !== editOriginal?.startTime || modalEnd !== editOriginal?.endTime)
      : !!bandName.trim()
    onBookingActive?.(dirty)
  }, [modal, bandName, modalStart, modalEnd, editingId, editOriginal])

  // 設定取得
  useEffect(() => {
    fetch('/api/nobu-room-settings')
      .then(r => r.json())
      .then(setSettings)
      .catch(() => setError('設定の取得に失敗しました'))
  }, [])

  // 週データ取得
  useEffect(() => { fetchWeek(weekStart) }, [weekStart])

  // 外部から編集ターゲットが渡された場合、対象週に移動してボトムシートを開く
  useEffect(() => {
    if (!initialEdit) return
    setPendingEdit(initialEdit)
    setWeekStart(getSundayOfWeek(initialEdit.date))
    onEditHandled?.()
  }, [initialEdit])

  // dayMapが読み込まれたらpendingEditを適用
  useEffect(() => {
    if (!pendingEdit || !dayMap) return
    setModal({ date: pendingEdit.date })
    setBandName(pendingEdit.bandName)
    setModalStart(pendingEdit.startTime)
    setModalEnd(pendingEdit.endTime)
    setEditingId(pendingEdit.id)
    setSubmitError(null)
    setPendingEdit(null)
    setCloseConfirm(false)
    setEditOriginal({ bandName: pendingEdit.bandName, startTime: pendingEdit.startTime, endTime: pendingEdit.endTime })
  }, [pendingEdit, dayMap])

  async function fetchWeek(start: string) {
    setLoading(true)
    setError(null)
    setDayMap(null)
    try {
      const res = await fetch(`/api/nobu-room-reservations/all?weekStart=${start}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setDayMap(data.dayMap ?? {})
    } catch {
      setError('取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  // ─── タップ処理 ───────────────────────────────────────
  function handleDayTap(e: React.MouseEvent<HTMLDivElement>, date: string) {
    if (!dayMap || !settings) return
    const today   = todayJST()
    const maxDate = maxBookingDate()
    if (!isDateAvailable(date, settings, today, maxDate)) return

    const effectiveSlots = getEffectiveSlots(date, settings)
    const rect       = e.currentTarget.getBoundingClientRect()
    const yOffset    = e.clientY - rect.top
    const rawMinutes = dispStart + Math.floor(yOffset / 15) * 15

    if (!isMinInSlots(rawMinutes, effectiveSlots)) return

    const activeSlot = effectiveSlots.find(s => {
      const [a, b] = s.value.split('-').map(toMinutes)
      return rawMinutes >= a && rawMinutes < b
    })!
    const slotStart = toMinutes(activeSlot.value.split('-')[0])
    const slotEnd   = toMinutes(activeSlot.value.split('-')[1])
    const startMinutes = Math.max(slotStart, Math.min(rawMinutes, slotEnd - 15))

    const blocks = dayMap[date] ?? []
    if (blocks.some(b => startMinutes >= toMinutes(b.startTime) && startMinutes < toMinutes(b.endTime))) return

    const nextStart = blocks.map(b => toMinutes(b.startTime)).filter(m => m > startMinutes)
      .reduce((min, m) => Math.min(min, m), slotEnd)
    const defaultEnd = Math.min(startMinutes + 60, nextStart)

    setModal({ date })
    setModalStart(minutesToTime(startMinutes))
    setModalEnd(minutesToTime(defaultEnd))
    setBandName('')
    setEditingId(null)
    setSubmitError(null)
    setCloseConfirm(false)
    setEditOriginal(null)
  }

  function handleStartChange(newStart: string) {
    setModalStart(newStart)
    if (!modal || !dayMap || !settings) return
    const effectiveSlots = getEffectiveSlots(modal.date, settings)
    const endOpts  = buildEndOptions(toMinutes(newStart), modal.date, dayMap, effectiveSlots)
    const targetEnd = toMinutes(newStart) + 60
    const best = endOpts.reduce((prev, curr) =>
      Math.abs(toMinutes(curr) - targetEnd) < Math.abs(toMinutes(prev) - targetEnd) ? curr : prev,
      endOpts[0] ?? ''
    )
    setModalEnd(best)
  }

  async function handleSubmit() {
    if (!modal || !bandName.trim() || !modalStart || !modalEnd) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      let res: Response
      if (editingId) {
        res = await fetch(`/api/nobu-room-reservations/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${profile.getAccessToken()}` },
          body: JSON.stringify({ bandName: bandName.trim(), newStart: modalStart, newEnd: modalEnd }),
        })
      } else {
        res = await fetch('/api/nobu-room-reservations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${profile.getAccessToken()}` },
          body: JSON.stringify({ bandName: bandName.trim(), date: modal.date, startTime: modalStart, endTime: modalEnd }),
        })
      }
      if (!res.ok) throw new Error((await res.json()).error ?? (editingId ? '変更に失敗しました' : '登録に失敗しました'))
      setModal(null)
      setEditingId(null)
      fetchWeek(weekStart)
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : '失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  // ─── 既存予約タップ ───────────────────────────────────
  function handleBlockTap(e: React.MouseEvent, block: BookingBlock, date: string) {
    e.stopPropagation()
    setDetailModal({ block, date })
    setCancelError(null)
    setCancelConfirm(false)
  }

  function handleEditFromDetail() {
    if (!detailModal) return
    if (Date.now() >= new Date(`${detailModal.date}T${detailModal.block.startTime}:00+09:00`).getTime()) return
    const { block, date } = detailModal
    setModal({ date })
    setBandName(block.bandName)
    setModalStart(block.startTime)
    setModalEnd(block.endTime)
    setEditingId(block.id)
    setDetailModal(null)
    setSubmitError(null)
    setCloseConfirm(false)
    setEditOriginal({ bandName: block.bandName, startTime: block.startTime, endTime: block.endTime })
  }

  async function handleCancel() {
    if (!detailModal) return
    if (Date.now() >= new Date(`${detailModal.date}T${detailModal.block.startTime}:00+09:00`).getTime()) return
    setCancelling(true)
    setCancelError(null)
    try {
      const res = await fetch(`/api/nobu-room-reservations/${detailModal.block.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${profile.getAccessToken()}` },
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '削除に失敗しました')
      setDetailModal(null)
      fetchWeek(weekStart)
    } catch (err: unknown) {
      setCancelError(err instanceof Error ? err.message : '削除に失敗しました')
    } finally {
      setCancelling(false)
    }
  }

  // ─── 表示範囲の計算 ───────────────────────────────────
  const { open: openMin, close: closeMin } = slotsRange(settings?.timeSlots ?? [])
  const dispStart = openMin  - 60  // 1時間前
  const dispEnd   = closeMin + 60  // 1時間後
  const totalDisp = dispEnd - dispStart

  // 1時間ごとのラベル
  const startHour = Math.floor(dispStart / 60)
  const endHour   = Math.ceil(dispEnd / 60)
  const hourLabels = Array.from({ length: endHour - startHour + 1 }, (_, i) => ({
    label: `${startHour + i}:00`,
    top:   (startHour + i) * 60 - dispStart,
  }))

  const today     = todayJST()
  const maxDate   = maxBookingDate()
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const { md: startMd } = formatDate(weekStart)
  const { md: endMd }   = formatDate(weekDates[6])

  // ─── ローディング ─────────────────────────────────────
  if (!settings) return (
    <div>
      <Skeleton width="200px" height="32px" className="mb-3" />
      <Skeleton width="100%" height="420px" />
    </div>
  )

  return (
    <div>
      {/* 週ナビゲーション */}
      <div className="flex items-center gap-1.5 mb-2 flex-wrap relative">
        <button className="btn-icon-nav" onClick={() => {
          setCalMonth(weekStart.slice(0, 7))
          setCalendarOpen(v => !v)
        }}>
          <span className="icon">calendar_month</span>
        </button>
        <button className="btn-icon-nav" onClick={() => setWeekStart(addDays(weekStart, -7))}>
          <span className="icon">chevron_left</span>
        </button>
        <span className="text-[0.88rem] font-semibold text-ink min-w-[108px] text-center">
          {startMd} 〜 {endMd}
        </span>
        <button className="btn-icon-nav" onClick={() => setWeekStart(addDays(weekStart, 7))}
          disabled={addDays(weekStart, 6) >= maxDate}>
          <span className="icon">chevron_right</span>
        </button>
        <button className="btn-outline w-auto px-2.5 py-1 text-[0.78rem]"
          onClick={() => setWeekStart(getSundayOfWeek(today))}>
          今週
        </button>

        {calendarOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setCalendarOpen(false)} />
            <div className="absolute top-full left-0 mt-1.5 bg-surface border border-line rounded-xl shadow-lg z-30 p-3 select-none"
              style={{ width: 252 }}>
              {/* 月ナビ */}
              <div className="flex items-center justify-between mb-2">
                <button className="btn-icon-nav" onClick={() => setCalMonth(prevMonth(calMonth))}>
                  <span className="icon">chevron_left</span>
                </button>
                <span className="text-[0.84rem] font-semibold text-ink">
                  {(() => { const [y, mo] = calMonth.split('-').map(Number); return `${y}年${mo}月` })()}
                </span>
                <button className="btn-icon-nav" onClick={() => setCalMonth(nextMonth(calMonth))}
                  disabled={nextMonth(calMonth) > maxDate.slice(0, 7)}>
                  <span className="icon">chevron_right</span>
                </button>
              </div>
              {/* 曜日ヘッダー */}
              <div className="grid grid-cols-7 mb-0.5">
                {['日','月','火','水','木','金','土'].map(d => (
                  <div key={d} className="text-center text-[0.63rem] text-ink-pale font-semibold py-0.5">{d}</div>
                ))}
              </div>
              {/* 日付グリッド */}
              <div className="grid grid-cols-7 gap-y-0.5">
                {getCalendarDays(calMonth).map((date, i) => {
                  if (!date) return <div key={i} />
                  const inSelected  = getSundayOfWeek(date) === weekStart
                  const isToday     = date === today
                  const isFuture    = date > maxDate
                  const isAvailable = isDateAvailable(date, settings, today, maxDate)
                  return (
                    <button
                      key={date}
                      className={
                        'text-center text-[0.75rem] py-1.5 rounded leading-none transition-colors ' +
                        (inSelected
                          ? 'bg-brand text-white font-semibold'
                          : isToday
                            ? 'bg-brand-light text-brand-dark font-semibold'
                            : isFuture
                              ? 'text-[#c8c8c8] cursor-default'
                              : date < today
                                ? 'text-ink-pale hover:bg-[#f0f0f0]'
                                : isAvailable
                                  ? 'text-ink hover:bg-[#f0f0f0]'
                                  : 'text-[#c8c8c8] cursor-default')
                      }
                      onClick={() => {
                        if (isFuture) return
                        setWeekStart(getSundayOfWeek(date))
                        setCalendarOpen(false)
                      }}
                    >
                      {parseInt(date.slice(8))}
                    </button>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </div>

      <p className="text-[0.75rem] text-ink-pale mb-2 flex items-center gap-1">
        <span className="icon" style={{ fontSize: 14 }}>touch_app</span>
        空きスロットをタップして予約
      </p>

      {error && <div className="banner-error">{error}</div>}

      {loading ? (
        <Skeleton width="100%" height="420px" />
      ) : dayMap !== null ? (
        <div className="border border-line rounded-xl shadow-[var(--shadow-card-sm)] bg-surface overflow-hidden">
          {/* ヘッダー＋グリッドを同一スクロールコンテナに入れてスクロールバー幅を共有 */}
          <div className="overflow-y-auto" style={{ maxHeight: '460px' }}>
            {/* ヘッダー行（スクロールコンテナ内でsticky） */}
            <div className="sticky top-0 bg-surface z-20 border-b border-line flex">
              <div className="w-9 flex-shrink-0" />
              {weekDates.map((date) => {
                const { md, wd } = formatDate(date)
                const isToday     = date === today
                const isPast      = date < today
                const isAvailable = !isPast && isDateAvailable(date, settings, today, maxDate)
                return (
                  <div key={date}
                    className={
                      'flex-1 text-center py-1.5 border-l border-line text-[0.67rem] font-semibold leading-tight ' +
                      (isToday
                        ? 'bg-brand-light text-brand-dark'
                        : !isAvailable
                          ? 'bg-[#f0f0f0] text-ink-pale'
                          : 'text-ink-sub')
                    }>
                    <div>{md}</div>
                    <div>{wd}</div>
                  </div>
                )
              })}
            </div>

            {/* グリッド本体 */}
            <div className="relative flex overflow-hidden" style={{ height: `${totalDisp}px` }}>

              {/* 時刻軸 */}
              <div className="w-9 flex-shrink-0 relative">
                {hourLabels.map(({ label, top }) => (
                  <div key={label}
                    className="absolute right-1 text-[0.58rem] text-ink-pale leading-none"
                    style={{ top: top - 4 }}>
                    {label}
                  </div>
                ))}
              </div>

              {/* 日付列 */}
              {weekDates.map((date) => {
                const blocks      = dayMap[date] ?? []
                const isPast      = date < today
                const isToday     = date === today
                const isAvailable = !isPast && isDateAvailable(date, settings, today, maxDate)
                const isBookable  = isAvailable  // タップできるか

                return (
                  <div
                    key={date}
                    className={
                      'flex-1 relative border-l border-line min-w-0 overflow-hidden ' +
                      (isBookable ? 'cursor-pointer ' + (isToday ? 'bg-brand-light/10' : '') : 'cursor-default')
                    }
                    onClick={(e) => isBookable && handleDayTap(e, date)}
                  >
                    {/* 1時間ごとの横線 */}
                    {hourLabels.map(({ top }, idx) => (
                      <div key={idx}
                        className="absolute left-0 right-0 border-t border-line pointer-events-none"
                        style={{ top }} />
                    ))}
                    {/* 30分ごとの薄い線（営業時間内のみ） */}
                    {hourLabels.slice(0, -1).map(({ top }, idx) => {
                      const halfTop = top + 30
                      return halfTop > (openMin - dispStart) && halfTop < (closeMin - dispStart) ? (
                        <div key={idx}
                          className="absolute left-0 right-0 border-t border-line/30 pointer-events-none"
                          style={{ top: halfTop }} />
                      ) : null
                    })}

                    {isBookable ? (
                      <>
                        {computeGrayZones(getEffectiveSlots(date, settings), dispStart, dispEnd).map((z, gi) => (
                          <div key={gi} className="absolute left-0 right-0 bg-[#f0f0f0] pointer-events-none"
                            style={{ top: z.top, height: z.height }} />
                        ))}
                      </>
                    ) : (
                      /* 予約不可日・過去日は列全体を均一にグレー */
                      <div className="absolute inset-0 bg-[#f0f0f0] pointer-events-none" style={{ zIndex: 5 }} />
                    )}

                    {/* 登録中の時間枠ハイライト */}
                    {modal && date === modal.date && modalStart && modalEnd && (
                      <div
                        className="absolute inset-x-0.5 rounded border-2 border-brand bg-brand/15 pointer-events-none z-[9]"
                        style={{
                          top:    toMinutes(modalStart) - dispStart,
                          height: toMinutes(modalEnd) - toMinutes(modalStart),
                        }}
                      />
                    )}

                    {/* 予約ブロック */}
                    {blocks.map((b, i) => {
                      const top    = toMinutes(b.startTime) - dispStart
                      const height = toMinutes(b.endTime) - toMinutes(b.startTime)
                      const isOwn  = b.userId === profile.userId
                      return (
                        <div key={i}
                          className="absolute inset-x-0.5 rounded overflow-hidden z-10 cursor-pointer active:brightness-90"
                          style={{ top, height }}
                          onClick={(e) => handleBlockTap(e, b, date)}>
                          <div className={
                            'w-full h-full ' +
                            (isBookable ? 'bg-brand' : 'bg-brand/50')
                          }>
                            <div className="text-[0.6rem] font-semibold px-1 pt-0.5 truncate leading-tight text-white">
                              {b.bandName}{isOwn ? ' ✎' : ''}
                            </div>
                            {height >= 30 && (
                              <div className="text-[0.53rem] px-1 text-white/75 leading-tight">
                                {b.startTime}〜{b.endTime}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      ) : null}

      {/* 予約詳細モーダル（ライトボックス） */}
      {detailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => !cancelling && setDetailModal(null)} />
          <div className="relative bg-surface rounded-2xl shadow-[var(--shadow-modal)] w-full max-w-[320px] overflow-hidden">
            {/* ヘッダー */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-line">
              <p className="text-base font-bold text-ink">予約詳細</p>
              <button className="btn-icon" onClick={() => setDetailModal(null)} disabled={cancelling}>
                <span className="icon">close</span>
              </button>
            </div>

            {/* 内容 */}
            <div className="px-5 py-4 space-y-3">
              <div className="flex items-center gap-2.5">
                <span className="icon text-brand" style={{ fontSize: 20 }}>groups</span>
                <span className="text-[0.95rem] font-semibold text-ink">{detailModal.block.bandName}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="icon text-ink-pale" style={{ fontSize: 20 }}>calendar_today</span>
                <span className="text-[0.88rem] text-ink-sub">
                  {formatDate(detailModal.date).md}（{formatDate(detailModal.date).wd}）
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="icon text-ink-pale" style={{ fontSize: 20 }}>schedule</span>
                <span className="text-[0.88rem] text-ink-sub">
                  {detailModal.block.startTime} 〜 {detailModal.block.endTime}
                </span>
              </div>
            </div>

            {/* 自分の予約のみ：編集・キャンセル（開始前のみ） */}
            {detailModal.block.userId === profile.userId &&
              Date.now() < new Date(`${detailModal.date}T${detailModal.block.startTime}:00+09:00`).getTime() && (
              <div className="px-5 pb-5 flex flex-col gap-2">
                {!cancelConfirm ? (
                  <>
                    <button
                      className="btn-outline w-full flex items-center justify-center gap-1.5 py-2.5"
                      onClick={handleEditFromDetail}
                      disabled={cancelling}
                    >
                      <span className="icon" style={{ fontSize: 16 }}>edit</span>
                      編集
                    </button>
                    <button
                      className="btn-danger w-full flex items-center justify-center gap-1.5 py-2.5 text-[0.95rem] font-semibold"
                      onClick={() => setCancelConfirm(true)}
                      disabled={cancelling}
                    >
                      <span className="icon" style={{ fontSize: 16 }}>delete</span>
                      取り消し
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-[0.88rem] text-ink text-center py-1 font-semibold">本当に取り消しますか？</p>
                    {cancelError && <div className="banner-error">{cancelError}</div>}
                    <div className="flex gap-2">
                      <button className="btn-outline flex-1" onClick={() => setCancelConfirm(false)} disabled={cancelling}>
                        戻る
                      </button>
                      <button
                        className="btn-danger flex-1 flex items-center justify-center gap-1 py-2.5 text-[0.95rem] font-semibold"
                        onClick={handleCancel}
                        disabled={cancelling}
                      >
                        {cancelling ? '取り消し中...' : '取り消し'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 予約モーダル（ボトムシート） */}
      {modal && dayMap && (() => {
        const isDirty = editingId
          ? (bandName.trim() !== editOriginal?.bandName || modalStart !== editOriginal?.startTime || modalEnd !== editOriginal?.endTime)
          : !!bandName.trim()
        const closeFn = () => {
          if (!submitting) {
            if (isDirty) setCloseConfirm(true)
            else { setModal(null); setEditingId(null) }
          }
        }
        const effectiveDayMap = editingId
          ? { ...dayMap, [modal.date]: (dayMap[modal.date] ?? []).filter(b => b.id !== editingId) }
          : dayMap
        const effectiveSlots = getEffectiveSlots(modal.date, settings)
        return (
          <div className="fixed inset-0 z-50 flex flex-col justify-end">
            <div className="absolute inset-0 bg-black/40" onClick={closeFn} />
            <div className="relative bg-surface rounded-t-2xl px-5 pt-4 pb-8 shadow-xl">
              <div className="w-10 h-1 bg-line rounded-full mx-auto mb-4" />

              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-base font-bold text-ink">{editingId ? '予約を変更' : '農部室を予約'}</p>
                  <p className="text-[0.82rem] text-ink-sub">
                    {formatDate(modal.date).md}（{formatDate(modal.date).wd}）
                  </p>
                </div>
                <button className="btn-icon" onClick={closeFn} disabled={submitting}>
                  <span className="icon">close</span>
                </button>
              </div>

              {submitError && <div className="banner-error">{submitError}</div>}

              <div className="form-row mb-3">
                <label>バンド名</label>
                <input
                  className="text-input"
                  type="text"
                  placeholder="バンド名を入力"
                  value={bandName}
                  onChange={(e) => setBandName(e.target.value)}
                />
              </div>

              <div className="mb-5 space-y-3">
                <div>
                  <label className="block text-[0.8rem] text-ink-sub mb-1.5">開始</label>
                  <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ WebkitOverflowScrolling: 'touch' }}>
                    {buildStartOptions(modal.date, effectiveDayMap, effectiveSlots).map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={
                          'flex-shrink-0 px-3 py-2 rounded-lg text-[0.82rem] border-[1.5px] transition ' +
                          (t === modalStart
                            ? 'bg-brand border-brand text-white font-semibold'
                            : 'bg-surface border-line text-ink-sub')
                        }
                        onClick={() => handleStartChange(t)}
                      >{t}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-[0.8rem] text-ink-sub mb-1.5">終了</label>
                  <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ WebkitOverflowScrolling: 'touch' }}>
                    {buildEndOptions(toMinutes(modalStart), modal.date, effectiveDayMap, effectiveSlots).map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={
                          'flex-shrink-0 px-3 py-2 rounded-lg text-[0.82rem] border-[1.5px] transition ' +
                          (t === modalEnd
                            ? 'bg-brand border-brand text-white font-semibold'
                            : 'bg-surface border-line text-ink-sub')
                        }
                        onClick={() => setModalEnd(t)}
                      >{t}</button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <button className="btn-outline flex-1" onClick={closeFn} disabled={submitting}>
                  キャンセル
                </button>
                <button className="btn-primary flex-1" onClick={handleSubmit}
                  disabled={submitting || !bandName.trim() || !modalEnd}>
                  {submitting ? (editingId ? '変更中...' : '送信中...') : (editingId ? '変更' : '予約')}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {closeConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setCloseConfirm(false)} />
          <div className="relative bg-surface rounded-2xl shadow-[var(--shadow-modal)] w-full max-w-[320px] p-6">
            <p className="text-base font-bold text-ink mb-1.5">
              {editingId ? '編集を中断しますか？' : '予約を中断しますか？'}
            </p>
            <p className="text-[0.85rem] text-ink-sub mb-4">入力中の内容が破棄されます</p>
            <div className="flex gap-2">
              <button className="btn-outline flex-1" onClick={() => setCloseConfirm(false)}>続ける</button>
              <button
                className="flex-1 px-4 py-[0.9rem] bg-danger text-white rounded-[10px] text-[0.95rem] font-bold cursor-pointer transition hover:brightness-90"
                onClick={() => { setModal(null); setEditingId(null); setCloseConfirm(false) }}
              >中断</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

