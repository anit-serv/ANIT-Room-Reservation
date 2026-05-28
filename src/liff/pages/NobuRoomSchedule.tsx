import { useState, useEffect, useRef } from 'react'
import type { LiffProfile } from '../LiffApp'
import Skeleton from '../../components/Skeleton'
import FavoritePicker, { type Favorite } from '../../components/FavoritePicker'

type NobuRoomEditTarget = { id: string; date: string; bandName: string; startTime: string; endTime: string }
type Props = {
  profile: LiffProfile
  initialEdit?: NobuRoomEditTarget | null
  onEditHandled?: () => void
  onBookingActive?: (active: boolean) => void
}

type TimeSlot      = { label: string; value: string }
type PerDaySchedule = { enabled: boolean; byWeekday: Record<string, TimeSlot[]>; byDate: Record<string, TimeSlot[]> }

type TimePreset = { label: string; startTime: string; endTime: string }

type NobuRoomSettings = {
  availableDays:  number[]
  extraDates:     string[]
  excludedDates:  string[]
  timeSlots:      TimeSlot[]
  perDaySchedule: PerDaySchedule
  timePresets?:   TimePreset[]
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

function nowJSTMinutes(): number {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
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
  const [weekCache,    setWeekCache]    = useState<Record<string, DayMap>>({})
  const [outgoingWeek,      setOutgoingWeek]      = useState<string | null>(null)
  const [slideDir,          setSlideDir]          = useState<'left' | 'right' | null>(null)
  const scrollRef   = useRef<HTMLDivElement>(null)
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
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
  const [modalClosing,  setModalClosing]  = useState(false)
  const [pendingEdit,   setPendingEdit]   = useState<NobuRoomEditTarget | null>(null)
  const [nowMinutes,       setNowMinutes]       = useState(() => nowJSTMinutes())
  const [favorites,        setFavorites]        = useState<Favorite[]>([])
  const [selectedFavId,    setSelectedFavId]    = useState<string | null>(null)
  const [saveAsFavChecked, setSaveAsFavChecked] = useState(false)
  const [pendingRepeat, setPendingRepeat] = useState<{ date: string; bandName: string; startTime: string; endTime: string } | null>(null)
  const [repeatBlocked, setRepeatBlocked] = useState<{ reason: string; nextNextDate: string; nextNextAvail: boolean } | null>(null)

  useEffect(() => {
    const id = setInterval(() => setNowMinutes(nowJSTMinutes()), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    fetch('/api/favorites', { headers: { Authorization: `Bearer ${profile.getAccessToken()}` } })
      .then(r => r.json()).then(d => setFavorites(d.favorites ?? [])).catch(() => {})
  }, [])

  function closeModal() {
    setModalClosing(true)
    setTimeout(() => {
      setModal(null)
      setEditingId(null)
      setSelectedFavId(null)
      setSaveAsFavChecked(false)
      setModalClosing(false)
    }, 220)
  }

  function closeDetailModal() {
    setDetailModal(null)
    setRepeatBlocked(null)
    setCancelConfirm(false)
  }

  const dayMap = weekCache[weekStart] ?? null

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

  // 隣接週プリフェッチ
  useEffect(() => {
    if (!dayMap) return
    fetchWeek(addDays(weekStart, 7), true)
    fetchWeek(addDays(weekStart, -7), true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, !!dayMap])

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

  // dayMapが読み込まれたらpendingRepeatを適用
  useEffect(() => {
    if (!pendingRepeat || !dayMap) return
    const targetWeek = getSundayOfWeek(pendingRepeat.date)
    if (weekStart !== targetWeek) return
    setModal({ date: pendingRepeat.date })
    setBandName(pendingRepeat.bandName)
    setModalStart(pendingRepeat.startTime)
    setModalEnd(pendingRepeat.endTime)
    setEditingId(null)
    setSelectedFavId(null)
    setSaveAsFavChecked(false)
    setSubmitError(null)
    setCloseConfirm(false)
    setEditOriginal(null)
    setPendingRepeat(null)
  }, [pendingRepeat, dayMap, weekStart])

  async function fetchWeek(start: string, silent = false, force = false) {
    if (!force && weekCache[start] !== undefined) return
    if (!silent) { setLoading(true); setError(null) }
    try {
      const res = await fetch(`/api/nobu-room-reservations/all?weekStart=${start}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setWeekCache(prev => ({ ...prev, [start]: data.dayMap ?? {} }))
    } catch {
      if (!silent) setError('取得に失敗しました')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  function refreshWeek(start: string) {
    setWeekCache(prev => { const n = { ...prev }; delete n[start]; return n })
    fetchWeek(start, false, true)
  }

  function navigateTo(newWeek: string, dir: 'left' | 'right') {
    if (outgoingWeek || newWeek === weekStart) return
    if (weekCache[newWeek] !== undefined) {
      setOutgoingWeek(weekStart)
      setSlideDir(dir)
      setWeekStart(newWeek)
      setTimeout(() => { setOutgoingWeek(null); setSlideDir(null) }, 320)
    } else {
      setWeekStart(newWeek)
    }
  }

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
  }

  function handleTouchEnd(e: React.TouchEvent) {
    const dx = e.changedTouches[0].clientX - touchStartX.current
    const dy = e.changedTouches[0].clientY - touchStartY.current
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return
    if (dx < 0) navigateTo(addDays(weekStart, 7), 'left')
    else        navigateTo(addDays(weekStart, -7), 'right')
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

    if (date === today) {
      const cutoff = (Math.floor(nowMinutes / 15) + 1) * 15
      if (startMinutes < cutoff) return
    }

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
    setSelectedFavId(null)
    setSaveAsFavChecked(false)
    setSubmitError(null)
    setCloseConfirm(false)
    setEditOriginal(null)
  }

  function handlePresetSelect(preset: TimePreset) {
    setModalStart(preset.startTime)
    setModalEnd(preset.endTime)
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
        const savedName = bandName.trim()
        const shouldSaveFav = saveAsFavChecked && !selectedFavId
        res = await fetch('/api/nobu-room-reservations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${profile.getAccessToken()}` },
          body: JSON.stringify({ bandName: savedName, date: modal.date, startTime: modalStart, endTime: modalEnd, ...(selectedFavId ? { favoriteId: selectedFavId } : {}) }),
        })
        if (!res.ok) throw new Error((await res.json()).error ?? '登録に失敗しました')
        if (shouldSaveFav) {
          fetch('/api/favorites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${profile.getAccessToken()}` },
            body: JSON.stringify({ name: savedName }),
          }).then(r => r.ok ? r.json() : null)
            .then(d => { if (d?.id) setFavorites(prev => [...prev, { id: d.id, name: savedName, nobuTimeSlot: null }]) })
            .catch(() => {})
        }
        setModal(null)
        setEditingId(null)
        setSaveAsFavChecked(false)
        setSelectedFavId(null)
        refreshWeek(weekStart)
        return
      }
      if (!res.ok) throw new Error((await res.json()).error ?? '変更に失敗しました')
      setModal(null)
      setEditingId(null)
      refreshWeek(weekStart)
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
      refreshWeek(weekStart)
    } catch (err: unknown) {
      setCancelError(err instanceof Error ? err.message : '削除に失敗しました')
    } finally {
      setCancelling(false)
    }
  }

  // ─── 「次の週も予約」ハンドラ ─────────────────────────
  function openRepeat(date: string, bName: string, startTime: string, endTime: string) {
    setRepeatBlocked(null)
    setDetailModal(null)
    setPendingRepeat({ date, bandName: bName, startTime, endTime })
    navigateTo(getSundayOfWeek(date), 'left')
  }

  function handleRepeatNext() {
    if (!detailModal || !settings) return
    const { block, date } = detailModal
    const nextDate = addDays(date, 7)
    const today = todayJST()
    const maxDate = maxBookingDate()
    setRepeatBlocked(null)
    if (!isDateAvailable(nextDate, settings, today, maxDate)) {
      const { md, wd } = formatDate(nextDate)
      const nextNextDate = addDays(date, 14)
      setRepeatBlocked({
        reason: `来週（${md}${wd}）は予約不可日のため予約できません。`,
        nextNextDate,
        nextNextAvail: isDateAvailable(nextNextDate, settings, today, maxDate),
      })
      return
    }
    const nextWeekStart = getSundayOfWeek(nextDate)
    const nextDayMap = weekCache[nextWeekStart]
    if (nextDayMap !== undefined) {
      const blocks = nextDayMap[nextDate] ?? []
      const taken = blocks.some(
        b => toMinutes(block.startTime) < toMinutes(b.endTime) && toMinutes(b.startTime) < toMinutes(block.endTime)
      )
      if (taken) {
        const { md, wd } = formatDate(nextDate)
        const nextNextDate = addDays(date, 14)
        setRepeatBlocked({
          reason: `来週（${md}${wd}）の ${block.startTime}〜${block.endTime} はすでに予約が入っています。`,
          nextNextDate,
          nextNextAvail: isDateAvailable(nextNextDate, settings, today, maxDate),
        })
        return
      }
    }
    openRepeat(nextDate, block.bandName, block.startTime, block.endTime)
  }

  function handleRepeatConfirmNextNext() {
    if (!detailModal || !repeatBlocked) return
    openRepeat(repeatBlocked.nextNextDate, detailModal.block.bandName, detailModal.block.startTime, detailModal.block.endTime)
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
    <div className="flex flex-col flex-1 min-h-0">
      {/* 週ナビゲーション */}
      <div className="flex items-center gap-1.5 mb-2 flex-wrap relative">
        <button className="btn-icon-nav" onClick={() => {
          setCalMonth(weekStart.slice(0, 7))
          setCalendarOpen(v => !v)
        }}>
          <span className="icon">calendar_month</span>
        </button>
        <button className="btn-icon-nav" onClick={() => navigateTo(addDays(weekStart, -7), 'right')}>
          <span className="icon">chevron_left</span>
        </button>
        <span className="text-[0.88rem] font-semibold text-ink min-w-[108px] text-center">
          {startMd} 〜 {endMd}
        </span>
        <button className="btn-icon-nav" onClick={() => navigateTo(addDays(weekStart, 7), 'left')}
          disabled={addDays(weekStart, 6) >= maxDate}>
          <span className="icon">chevron_right</span>
        </button>
        <button className="btn-outline w-auto px-2.5 py-1 text-[0.78rem]"
          onClick={() => navigateTo(getSundayOfWeek(today), getSundayOfWeek(today) > weekStart ? 'left' : 'right')}>
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
                        const target = getSundayOfWeek(date)
                        navigateTo(target, target > weekStart ? 'left' : 'right')
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

      {loading && !dayMap ? (
        <Skeleton width="100%" height="420px" />
      ) : dayMap !== null ? (() => {
        function renderDayHeaders(tWeek: string) {
          return Array.from({ length: 7 }, (_, i) => addDays(tWeek, i)).map((date) => {
            const { md, wd } = formatDate(date)
            const isToday = date === today
            const isPast  = date < today
            const isAvail = !isPast && isDateAvailable(date, settings!, today, maxDate)
            return (
              <div key={date}
                className={
                  'flex-1 text-center py-1.5 border-l border-line text-[0.67rem] font-semibold leading-tight ' +
                  (isToday ? 'bg-brand-light text-brand-dark' : !isAvail ? 'bg-[#f0f0f0] text-ink-pale' : 'text-ink-sub')
                }>
                <div>{md}</div><div>{wd}</div>
              </div>
            )
          })
        }

        function renderDayColumns(tWeek: string, tMap: DayMap, interactive: boolean) {
          return Array.from({ length: 7 }, (_, i) => addDays(tWeek, i)).map((date) => {
            const blocks     = tMap[date] ?? []
            const isPast     = date < today
            const isToday    = date === today
            const isAvail    = !isPast && isDateAvailable(date, settings!, today, maxDate)
            const isBookable = isAvail
            return (
              <div key={date}
                className={
                  'flex-1 relative border-l border-line min-w-0 overflow-hidden ' +
                  (isBookable && interactive ? 'cursor-pointer ' + (isToday ? 'bg-brand-light/10' : '') : 'cursor-default')
                }
                onClick={interactive && isBookable ? (e) => handleDayTap(e, date) : undefined}
              >
                {hourLabels.map(({ top }, idx) => (
                  <div key={idx} className="absolute left-0 right-0 border-t border-line pointer-events-none" style={{ top }} />
                ))}
                {hourLabels.slice(0, -1).map(({ top }, idx) => {
                  const halfTop = top + 30
                  return halfTop > (openMin - dispStart) && halfTop < (closeMin - dispStart)
                    ? <div key={idx} className="absolute left-0 right-0 border-t border-line/30 pointer-events-none" style={{ top: halfTop }} />
                    : null
                })}
                {isBookable
                  ? computeGrayZones(getEffectiveSlots(date, settings!), dispStart, dispEnd).map((z, gi) => (
                      <div key={gi} className="absolute left-0 right-0 bg-[#f0f0f0] pointer-events-none" style={{ top: z.top, height: z.height }} />
                    ))
                  : <div className="absolute inset-0 bg-[#f0f0f0] pointer-events-none" style={{ zIndex: 5 }} />
                }
                {isToday && (() => {
                  const cutoff = (Math.floor(nowMinutes / 15) + 1) * 15
                  const grayHeight = Math.max(0, Math.min(cutoff - dispStart, totalDisp))
                  return grayHeight > 0 ? (
                    <div className="absolute left-0 right-0 bg-[#f0f0f0] cursor-default" style={{ top: 0, height: grayHeight, zIndex: 4 }} />
                  ) : null
                })()}
                {interactive && modal?.date === date && modalStart && modalEnd && (
                  <div className="absolute inset-x-0.5 rounded border-2 border-brand bg-brand/15 pointer-events-none z-[9]"
                    style={{ top: toMinutes(modalStart) - dispStart, height: toMinutes(modalEnd) - toMinutes(modalStart) }} />
                )}
                {blocks.map((b, i) => {
                  const top    = toMinutes(b.startTime) - dispStart
                  const height = toMinutes(b.endTime) - toMinutes(b.startTime)
                  const isOwn  = b.userId === profile.userId
                  return (
                    <div key={i}
                      className="absolute inset-x-0.5 rounded overflow-hidden z-10 cursor-pointer active:brightness-90"
                      style={{ top, height }}
                      onClick={interactive ? (e) => handleBlockTap(e, b, date) : (e) => e.stopPropagation()}
                    >
                      <div className={'w-full h-full ' + (isBookable ? 'bg-brand' : 'bg-brand/50')}>
                        <div className="text-[0.6rem] font-semibold px-1 pt-0.5 truncate leading-tight text-white">
                          {b.bandName}{isOwn ? ' ✎' : ''}
                        </div>
                        {height >= 30 && <div className="text-[0.53rem] px-1 text-white/75 leading-tight">{b.startTime}〜{b.endTime}</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })
        }

        return (
          <div className="border border-line rounded-xl shadow-[var(--shadow-card-sm)] overflow-hidden flex flex-col flex-1 min-h-0">
            <div
              ref={scrollRef}
              className="overflow-y-auto flex-1 min-h-0"
              style={{ scrollbarGutter: 'stable' }}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              <div className="sticky top-0 z-20 bg-surface border-b border-line flex">
                <div className="w-9 flex-shrink-0" />
                <div className="flex-1 relative flex" style={{ overflow: 'clip' }}>
                  {outgoingWeek && weekCache[outgoingWeek] && (
                    <div className="absolute inset-0 flex pointer-events-none" style={{
                      animation: `${slideDir === 'left' ? 'week-slide-out-left' : 'week-slide-out-right'} 0.32s ease-in-out forwards`,
                    }}>
                      {renderDayHeaders(outgoingWeek)}
                    </div>
                  )}
                  <div className="flex w-full" style={{
                    animation: slideDir ? `${slideDir === 'left' ? 'week-slide-in-right' : 'week-slide-in-left'} 0.32s ease-in-out` : 'none',
                  }}>
                    {renderDayHeaders(weekStart)}
                  </div>
                </div>
              </div>
              <div className="flex overflow-hidden" style={{ height: `${totalDisp}px` }}>
                <div className="w-9 flex-shrink-0 relative">
                  {hourLabels.map(({ label, top }) => (
                    <div key={label} className="absolute right-1 text-[0.58rem] text-ink-pale leading-none" style={{ top: top - 4 }}>{label}</div>
                  ))}
                </div>
                <div className="flex-1 relative" style={{ overflow: 'clip' }}>
                  {outgoingWeek && weekCache[outgoingWeek] && (
                    <div className="absolute inset-0 flex pointer-events-none" style={{
                      animation: `${slideDir === 'left' ? 'week-slide-out-left' : 'week-slide-out-right'} 0.32s ease-in-out forwards`,
                    }}>
                      {renderDayColumns(outgoingWeek, weekCache[outgoingWeek], false)}
                    </div>
                  )}
                  <div className="absolute inset-0 flex" style={{
                    animation: slideDir ? `${slideDir === 'left' ? 'week-slide-in-right' : 'week-slide-in-left'} 0.32s ease-in-out` : 'none',
                  }}>
                    {renderDayColumns(weekStart, dayMap, true)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })() : null}

      {/* 予約詳細モーダル（ライトボックス） */}
      {detailModal && (() => {
        const isOwn = detailModal.block.userId === profile.userId
        const isBeforeStart = Date.now() < new Date(`${detailModal.date}T${detailModal.block.startTime}:00+09:00`).getTime()
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50" onClick={() => !cancelling && closeDetailModal()} />
            <div className="relative bg-surface rounded-2xl shadow-[var(--shadow-modal)] w-full max-w-[320px] overflow-hidden">
              {/* ヘッダー */}
              <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-line">
                <p className="text-base font-bold text-ink">予約詳細</p>
                <button className="btn-icon-close" onClick={closeDetailModal} disabled={cancelling}>
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

              {/* 自分の予約のみ：アクション */}
              {isOwn && (
                <div className="px-5 pb-5 flex flex-col gap-2">
                  {/* 編集・削除（開始前のみ） */}
                  {isBeforeStart && !cancelConfirm && (
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
                        className="btn-danger w-full"
                        onClick={() => setCancelConfirm(true)}
                        disabled={cancelling}
                      >
                        <span className="icon" style={{ fontSize: 16 }}>delete</span>
                        削除
                      </button>
                    </>
                  )}
                  {isBeforeStart && cancelConfirm && (
                    <>
                      <p className="text-[0.88rem] text-ink text-center py-1 font-semibold">本当に削除しますか？</p>
                      {cancelError && <div className="banner-error">{cancelError}</div>}
                      <div className="flex gap-2">
                        <button className="btn-secondary flex-1" onClick={() => setCancelConfirm(false)} disabled={cancelling}>
                          キャンセル
                        </button>
                        <button className="btn-danger flex-1" onClick={handleCancel} disabled={cancelling}>
                          {cancelling ? '削除中...' : 'OK'}
                        </button>
                      </div>
                    </>
                  )}

                  {/* 次の週も予約（削除確認中は非表示） */}
                  {!cancelConfirm && (
                    <>
                      {!repeatBlocked ? (
                        <button
                          className="btn-primary w-full"
                          onClick={handleRepeatNext}
                          disabled={cancelling}
                        >
                          <span className="icon" style={{ fontSize: 16 }}>event_repeat</span>
                          次の週も予約
                        </button>
                      ) : (
                        <div className="bg-warn-light border border-warn/30 rounded-xl px-4 py-3 flex flex-col gap-2">
                          <p className="text-[0.85rem] text-warn font-semibold">{repeatBlocked.reason}</p>
                          {repeatBlocked.nextNextAvail ? (
                            <>
                              <p className="text-[0.82rem] text-ink-sub">再来週に予約しますか？</p>
                              <div className="flex gap-2">
                                <button className="btn-secondary flex-1 py-2 text-[0.82rem] whitespace-nowrap" onClick={() => setRepeatBlocked(null)}>
                                  キャンセル
                                </button>
                                <button className="btn-primary flex-1 py-2 text-[0.82rem] whitespace-nowrap" onClick={handleRepeatConfirmNextNext}>
                                  再来週に予約
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              <p className="text-[0.82rem] text-ink-sub">再来週も予約不可です。</p>
                              <button className="btn-secondary w-full py-2" onClick={() => setRepeatBlocked(null)}>
                                閉じる
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* 予約モーダル（ボトムシート） */}
      {(modal || modalClosing) && dayMap && (() => {
        const isDirty = editingId
          ? (bandName.trim() !== editOriginal?.bandName || modalStart !== editOriginal?.startTime || modalEnd !== editOriginal?.endTime)
          : !!bandName.trim()
        const closeFn = () => {
          if (!submitting && !modalClosing) {
            if (isDirty) setCloseConfirm(true)
            else closeModal()
          }
        }
        const effectiveDayMap = editingId
          ? { ...dayMap, [modal.date]: (dayMap[modal.date] ?? []).filter(b => b.id !== editingId) }
          : dayMap
        const effectiveSlots = getEffectiveSlots(modal.date, settings)
        return (
          <div className={`fixed inset-0 z-50 flex flex-col justify-end ${modalClosing ? 'animate-fade-out' : 'animate-fade-in'}`}>
            <div className="absolute inset-0 bg-black/40" onClick={closeFn} />
            <div className={`relative bg-surface rounded-t-2xl px-5 pt-4 pb-8 shadow-xl ${modalClosing ? 'animate-sheet-down' : 'animate-sheet-up'}`}>
              <div className="w-10 h-1 bg-line rounded-full mx-auto mb-4" />

              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-base font-bold text-ink">{editingId ? '予約を変更' : '農部室を予約'}</p>
                  <p className="text-[0.82rem] text-ink-sub">
                    {formatDate(modal.date).md}（{formatDate(modal.date).wd}）
                  </p>
                </div>
                <button className="btn-icon-close" onClick={closeFn} disabled={submitting}>
                  <span className="icon">close</span>
                </button>
              </div>

              {submitError && <div className="banner-error">{submitError}</div>}

              <div className="mb-3">
                <label className="block text-[0.8rem] text-ink-sub mb-1.5">バンド名</label>
                {!editingId && (
                  <FavoritePicker favorites={favorites} onSelect={(favId, name) => {
                    setBandName(name); setSelectedFavId(favId); setSaveAsFavChecked(false)
                  }} />
                )}
                <input
                  className="text-input"
                  type="text"
                  placeholder="バンド名を入力"
                  value={bandName}
                  onChange={(e) => {
                    setBandName(e.target.value)
                    if (selectedFavId) {
                      const fav = favorites.find(f => f.id === selectedFavId)
                      if (fav && fav.name !== e.target.value) setSelectedFavId(null)
                    }
                  }}
                />
              </div>

              {(settings.timePresets ?? []).length > 0 && (
                <div className="mb-3">
                  <label className="block text-[0.8rem] text-ink-sub mb-1.5">時間プリセット</label>
                  <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1" style={{ WebkitOverflowScrolling: 'touch' }}>
                    {(settings.timePresets ?? []).map((p, i) => {
                      const active = p.startTime === modalStart && p.endTime === modalEnd
                      return (
                        <button
                          key={i}
                          type="button"
                          className={
                            'flex-shrink-0 px-3 py-2 rounded-lg text-[0.82rem] border-[1.5px] transition ' +
                            (active
                              ? 'bg-brand border-brand text-white font-semibold'
                              : 'bg-surface border-line text-ink-sub hover:border-brand hover:text-brand')
                          }
                          onClick={() => handlePresetSelect(p)}
                        >
                          <span className="font-semibold">{p.label}</span>
                          <span className="ml-1 opacity-75">{p.startTime}〜{p.endTime}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="mb-5 space-y-3">
                <div>
                  <label className="block text-[0.8rem] text-ink-sub mb-1.5">開始</label>
                  <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ WebkitOverflowScrolling: 'touch' }}>
                    {buildStartOptions(modal.date, effectiveDayMap, effectiveSlots).map((t) => {
                      const isPast = modal.date === today && toMinutes(t) < (Math.floor(nowMinutes / 15) + 1) * 15
                      return (
                        <button
                          key={t}
                          type="button"
                          disabled={isPast}
                          className={
                            'flex-shrink-0 px-3 py-2 rounded-lg text-[0.82rem] border-[1.5px] transition ' +
                            (isPast
                              ? 'bg-[#f0f0f0] border-line text-[#c8c8c8] cursor-default'
                              : t === modalStart
                                ? 'bg-brand border-brand text-white font-semibold'
                                : 'bg-surface border-line text-ink-sub')
                          }
                          onClick={isPast ? undefined : () => handleStartChange(t)}
                        >{t}</button>
                      )
                    })}
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

              {!editingId && !selectedFavId && (
                <label className="flex items-center gap-2 text-[0.82rem] text-ink-sub mb-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={saveAsFavChecked}
                    onChange={(e) => setSaveAsFavChecked(e.target.checked)}
                    className="w-4 h-4 accent-brand"
                  />
                  <span className="icon text-brand" style={{ fontSize: 14 }}>star_border</span>
                  お気に入りとして保存
                </label>
              )}
              {!editingId && !!selectedFavId && (
                <div className="flex items-center gap-1.5 text-[0.82rem] text-brand mb-3 px-0.5">
                  <span className="icon" style={{ fontSize: 14 }}>star</span>
                  お気に入りから選択中
                </div>
              )}

              <button className="btn-primary" onClick={handleSubmit}
                disabled={submitting || !bandName.trim() || !modalEnd}>
                {submitting ? (editingId ? '変更中...' : '送信中...') : (editingId ? '変更' : '予約')}
              </button>
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
              <button className="btn-secondary flex-1" onClick={() => setCloseConfirm(false)}>キャンセル</button>
              <button className="btn-danger flex-1" onClick={() => { setCloseConfirm(false); closeModal() }}>OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

