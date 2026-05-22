import { useState, useEffect } from 'react'
import type { LiffProfile } from '../LiffApp'
import Skeleton from '../../components/Skeleton'

type Props = { profile: LiffProfile }
type BookingBlock = { bandName: string; startTime: string; endTime: string }
type DayMap = Record<string, BookingBlock[]>
type ModalState = { date: string }

const OPEN_MINUTES  = 8 * 60
const CLOSE_MINUTES = 20 * 60
const TOTAL_MINUTES = CLOSE_MINUTES - OPEN_MINUTES
const WEEK_DAYS_JP  = ['日', '月', '火', '水', '木', '金', '土']
const HOUR_LABELS   = Array.from({ length: 13 }, (_, i) => `${8 + i}:00`)

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

function getMondayOfWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  const wd = d.getUTCDay()
  d.setUTCDate(d.getUTCDate() + (wd === 0 ? -6 : 1 - wd))
  return d.toISOString().slice(0, 10)
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00Z')
  return { md: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, wd: WEEK_DAYS_JP[d.getUTCDay()] }
}

function buildStartOptions(date: string, dayMap: DayMap): string[] {
  const blocks = dayMap[date] ?? []
  const opts: string[] = []
  for (let m = OPEN_MINUTES; m < CLOSE_MINUTES; m += 15) {
    if (!blocks.some(b => m >= toMinutes(b.startTime) && m < toMinutes(b.endTime))) {
      opts.push(minutesToTime(m))
    }
  }
  return opts
}

function buildEndOptions(startMinutes: number, date: string, dayMap: DayMap): string[] {
  const blocks = dayMap[date] ?? []
  const nextStart = blocks
    .map(b => toMinutes(b.startTime))
    .filter(m => m > startMinutes)
    .reduce((min, m) => Math.min(min, m), CLOSE_MINUTES)
  const opts: string[] = []
  for (let m = startMinutes + 15; m <= nextStart; m += 15) opts.push(minutesToTime(m))
  return opts
}

export default function KobuSchedule({ profile }: Props) {
  const [weekStart,    setWeekStart]    = useState(() => getMondayOfWeek(todayJST()))
  const [dayMap,       setDayMap]       = useState<DayMap | null>(null)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [modal,        setModal]        = useState<ModalState | null>(null)
  const [bandName,     setBandName]     = useState('')
  const [modalStart,   setModalStart]   = useState('')
  const [modalEnd,     setModalEnd]     = useState('')
  const [submitting,   setSubmitting]   = useState(false)
  const [submitError,  setSubmitError]  = useState<string | null>(null)

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

  function handleDayTap(e: React.MouseEvent<HTMLDivElement>, date: string) {
    if (!dayMap || date < todayJST()) return

    const rect = e.currentTarget.getBoundingClientRect()
    const yOffset = e.clientY - rect.top
    const rawMinutes = OPEN_MINUTES + Math.round(yOffset / 15) * 15
    const startMinutes = Math.max(OPEN_MINUTES, Math.min(rawMinutes, CLOSE_MINUTES - 15))

    // 既存予約ブロックの上はスキップ
    const blocks = dayMap[date] ?? []
    if (blocks.some(b => startMinutes >= toMinutes(b.startTime) && startMinutes < toMinutes(b.endTime))) return

    const nextStart = blocks
      .map(b => toMinutes(b.startTime))
      .filter(m => m > startMinutes)
      .reduce((min, m) => Math.min(min, m), CLOSE_MINUTES)
    const defaultEnd = Math.min(startMinutes + 60, nextStart)

    const startStr = minutesToTime(startMinutes)
    const endStr   = minutesToTime(defaultEnd)
    setModal({ date })
    setModalStart(startStr)
    setModalEnd(endStr)
    setBandName('')
    setSubmitError(null)
  }

  function handleStartChange(newStart: string) {
    setModalStart(newStart)
    if (!modal || !dayMap) return
    const endOpts = buildEndOptions(toMinutes(newStart), modal.date, dayMap)
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
      const res = await fetch('/api/kobu-reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${profile.idToken}` },
        body: JSON.stringify({ bandName: bandName.trim(), date: modal.date, startTime: modalStart, endTime: modalEnd }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '登録に失敗しました')
      setModal(null)
      fetchWeek(weekStart)
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : '登録に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  const today     = todayJST()
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const { md: startMd } = formatDate(weekStart)
  const { md: endMd }   = formatDate(weekDates[6])

  return (
    <div>
      {/* 週ナビゲーション */}
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <button className="btn-icon" onClick={() => setWeekStart(addDays(weekStart, -7))}>
          <span className="icon">chevron_left</span>
        </button>
        <span className="text-[0.88rem] font-semibold text-ink min-w-[108px] text-center">
          {startMd} 〜 {endMd}
        </span>
        <button className="btn-icon" onClick={() => setWeekStart(addDays(weekStart, 7))}>
          <span className="icon">chevron_right</span>
        </button>
        <button className="btn-outline w-auto px-2.5 py-1 text-[0.78rem]"
          onClick={() => setWeekStart(getMondayOfWeek(today))}>
          今週
        </button>
      </div>

      <p className="text-[0.75rem] text-ink-pale mb-2 flex items-center gap-1">
        <span className="icon" style={{ fontSize: 14 }}>touch_app</span>
        空きスロットをタップして予約
      </p>

      {error && <div className="banner-error">{error}</div>}

      {loading ? (
        <Skeleton width="100%" height="380px" />
      ) : dayMap !== null ? (
        <div className="border border-line rounded-xl overflow-hidden shadow-[var(--shadow-card-sm)] bg-surface">
          {/* ヘッダー行 */}
          <div className="flex border-b border-line sticky top-0 bg-surface z-10">
            <div className="w-9 flex-shrink-0" />
            {weekDates.map((date) => {
              const { md, wd } = formatDate(date)
              const isToday = date === today
              const isPast  = date < today
              return (
                <div key={date}
                  className={
                    'flex-1 text-center py-1.5 border-l border-line text-[0.67rem] font-semibold leading-tight ' +
                    (isToday ? 'bg-brand-light text-brand-dark' : isPast ? 'text-ink-pale bg-bg' : 'text-ink-sub')
                  }>
                  <div>{md}</div>
                  <div>{wd}</div>
                </div>
              )
            })}
          </div>

          {/* スケジュールグリッド */}
          <div className="overflow-y-auto" style={{ maxHeight: '420px' }}>
            <div className="relative flex" style={{ height: `${TOTAL_MINUTES}px` }}>

              {/* 時刻軸 */}
              <div className="w-9 flex-shrink-0 relative">
                {HOUR_LABELS.map((label, idx) => (
                  <div key={label}
                    className="absolute right-1 text-[0.58rem] text-ink-pale leading-none"
                    style={{ top: idx * 60 - 4 }}>
                    {label}
                  </div>
                ))}
              </div>

              {/* 日付列 */}
              {weekDates.map((date) => {
                const blocks  = dayMap[date] ?? []
                const isPast  = date < today
                const isToday = date === today
                return (
                  <div
                    key={date}
                    className={
                      'flex-1 relative border-l border-line min-w-0 ' +
                      (isPast ? 'bg-bg cursor-not-allowed' : 'cursor-pointer active:bg-brand-light/20 ' + (isToday ? 'bg-brand-light/10' : ''))
                    }
                    onClick={(e) => handleDayTap(e, date)}
                  >
                    {/* 1時間ごとの横線 */}
                    {HOUR_LABELS.map((_, idx) => (
                      <div key={idx}
                        className="absolute left-0 right-0 border-t border-line pointer-events-none"
                        style={{ top: idx * 60 }} />
                    ))}
                    {/* 30分ごとの薄い線 */}
                    {HOUR_LABELS.slice(0, -1).map((_, idx) => (
                      <div key={idx}
                        className="absolute left-0 right-0 border-t border-line/40 pointer-events-none"
                        style={{ top: idx * 60 + 30 }} />
                    ))}

                    {/* 予約ブロック */}
                    {blocks.map((b, i) => {
                      const top    = toMinutes(b.startTime) - OPEN_MINUTES
                      const height = toMinutes(b.endTime) - toMinutes(b.startTime)
                      return (
                        <div key={i}
                          className="absolute inset-x-0.5 rounded bg-brand text-white pointer-events-none overflow-hidden"
                          style={{ top, height }}>
                          <div className="text-[0.6rem] font-semibold px-1 pt-0.5 truncate leading-tight">
                            {b.bandName}
                          </div>
                          {height >= 30 && (
                            <div className="text-[0.53rem] px-1 text-white/75 leading-tight">
                              {b.startTime}〜{b.endTime}
                            </div>
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
      ) : null}

      {/* 予約モーダル（ボトムシート） */}
      {modal && dayMap && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => !submitting && setModal(null)} />
          <div className="relative bg-surface rounded-t-2xl px-5 pt-5 pb-8 shadow-xl">
            {/* ハンドル */}
            <div className="w-10 h-1 bg-line rounded-full mx-auto mb-4" />

            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-base font-bold text-ink">工部室を予約</p>
                <p className="text-[0.82rem] text-ink-sub">
                  {formatDate(modal.date).md}（{formatDate(modal.date).wd}）
                </p>
              </div>
              <button className="btn-icon" onClick={() => setModal(null)} disabled={submitting}>
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

            <div className="flex gap-3 mb-5">
              <div className="flex-1">
                <label className="block text-[0.8rem] text-ink-sub mb-1">開始</label>
                <select className="text-input" value={modalStart}
                  onChange={(e) => handleStartChange(e.target.value)}>
                  {buildStartOptions(modal.date, dayMap).map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-[0.8rem] text-ink-sub mb-1">終了</label>
                <select className="text-input" value={modalEnd}
                  onChange={(e) => setModalEnd(e.target.value)}>
                  {buildEndOptions(toMinutes(modalStart), modal.date, dayMap).map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-2">
              <button className="btn-outline flex-1" onClick={() => setModal(null)} disabled={submitting}>
                キャンセル
              </button>
              <button className="btn-primary flex-1" onClick={handleSubmit}
                disabled={submitting || !bandName.trim() || !modalEnd}>
                {submitting ? '送信中...' : '予約する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
