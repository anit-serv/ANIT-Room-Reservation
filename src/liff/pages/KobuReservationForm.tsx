import { useState, useEffect } from 'react'
import type { LiffProfile } from '../LiffApp'
import Skeleton from '../../components/Skeleton'

type Props = { profile: LiffProfile }

type KobuSettings = {
  availableDays:  number[]
  extraDates:     string[]
  excludedDates:  string[]
  openTime:       string
  closeTime:      string
  maxAdvanceDays: number
}

const WEEK_DAYS_SHORT = ['日', '月', '火', '水', '木', '金', '土']

function buildTimeOptions(open: string, close: string): string[] {
  const options: string[] = []
  const [oh, om] = open.split(':').map(Number)
  const [ch, cm] = close.split(':').map(Number)
  let cur = oh * 60 + om
  const end = ch * 60 + cm
  while (cur <= end) {
    const h = String(Math.floor(cur / 60)).padStart(2, '0')
    const m = String(cur % 60).padStart(2, '0')
    options.push(`${h}:${m}`)
    cur += 15
  }
  return options
}

function buildAvailableDates(settings: KobuSettings): { value: string; label: string }[] {
  const nowJST = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const today  = nowJST.toISOString().slice(0, 10)
  const maxDate = new Date(nowJST)
  maxDate.setFullYear(maxDate.getFullYear() + 1)
  const maxDateStr = maxDate.toISOString().slice(0, 10)

  const extraSet    = new Set(settings.extraDates)
  const excludedSet = new Set(settings.excludedDates)

  const results: { value: string; label: string }[] = []
  // 表示は今日〜30日先までのみ（UX上、1年分は多すぎる）
  for (let i = 0; i <= 30; i++) {
    const d = new Date(nowJST)
    d.setUTCDate(nowJST.getUTCDate() + i)
    const dateStr = d.toISOString().slice(0, 10)
    if (dateStr > maxDateStr) break
    const wd = d.getUTCDay()
    const isAvailable = (settings.availableDays.includes(wd) || extraSet.has(dateStr)) && !excludedSet.has(dateStr)
    if (isAvailable && dateStr >= today) {
      const m   = d.getUTCMonth() + 1
      const day = d.getUTCDate()
      const wdLabel = WEEK_DAYS_SHORT[wd]
      results.push({ value: dateStr, label: `${m}/${day}(${wdLabel})` })
    }
  }
  return results
}

export default function KobuReservationForm({ profile }: Props) {
  const [settings,      setSettings]      = useState<KobuSettings | null>(null)
  const [loadingSettings, setLoadingSettings] = useState(true)
  const [bandName,      setBandName]      = useState('')
  const [selectedDate,  setSelectedDate]  = useState('')
  const [startTime,     setStartTime]     = useState('')
  const [endTime,       setEndTime]       = useState('')
  const [submitting,    setSubmitting]    = useState(false)
  const [done,          setDone]          = useState(false)
  const [error,         setError]         = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/kobu-settings')
      .then((r) => r.json())
      .then((data) => setSettings(data))
      .catch(() => setError('設定の取得に失敗しました'))
      .finally(() => setLoadingSettings(false))
  }, [])

  const availableDates = settings ? buildAvailableDates(settings) : []
  const timeOptions    = settings ? buildTimeOptions(settings.openTime, settings.closeTime) : []
  const endOptions     = timeOptions.filter((t) => !startTime || t > startTime)

  const canSubmit = !!bandName.trim() && !!selectedDate && !!startTime && !!endTime && !submitting

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/kobu-reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${profile.getAccessToken()}` },
        body: JSON.stringify({ bandName: bandName.trim(), date: selectedDate, startTime, endTime }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '登録に失敗しました')
      setDone(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '登録に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  function reset() {
    setBandName(''); setSelectedDate(''); setStartTime(''); setEndTime('')
    setDone(false); setError(null)
  }

  if (loadingSettings) {
    return (
      <div>
        <Skeleton width="120px" height="20px" className="mb-4" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-surface border border-line rounded-xl p-4 mb-3 shadow-[var(--shadow-card-sm)]">
            <Skeleton width="40%" height="14px" className="mb-2" />
            <Skeleton width="100%" height={44} />
          </div>
        ))}
      </div>
    )
  }

  if (done) {
    const dateLabel = availableDates.find((d) => d.value === selectedDate)?.label ?? selectedDate
    return (
      <div>
        <div className="banner-success">✅ 予約を確定しました。</div>
        <div className="bg-surface border border-line rounded-xl p-4 mb-3 shadow-[var(--shadow-card-sm)]">
          <SummaryRow label="バンド名" value={bandName} />
          <SummaryRow label="日付"     value={dateLabel} />
          <SummaryRow label="時間帯"   value={`${startTime}〜${endTime}`} />
        </div>
        <button className="btn-outline mt-2" onClick={reset}>続けて登録</button>
      </div>
    )
  }

  return (
    <div>
      <p className="text-[1.05rem] font-bold mb-4 text-ink">工部室 予約登録</p>

      {error && <div className="banner-error">{error}</div>}

      <SectionCard step={1} label="バンド名" complete={!!bandName.trim()}>
        <input
          className="text-input"
          type="text"
          placeholder="バンド名を入力"
          value={bandName}
          onChange={(e) => setBandName(e.target.value)}
        />
      </SectionCard>

      <SectionCard step={2} label="日付" complete={!!selectedDate}>
        <div className="grid grid-cols-3 gap-2">
          {availableDates.map((d) => (
            <SelectButton key={d.value} active={selectedDate === d.value}
              onClick={() => { setSelectedDate(d.value); setStartTime(''); setEndTime('') }}>
              {d.label}
            </SelectButton>
          ))}
          {availableDates.length === 0 && (
            <p className="col-span-3 text-[0.85rem] text-ink-pale text-center py-2">
              予約可能な日がありません
            </p>
          )}
        </div>
      </SectionCard>

      <SectionCard step={3} label="開始時刻" complete={!!startTime}>
        <div className="grid grid-cols-4 gap-1.5">
          {timeOptions.slice(0, -1).map((t) => (
            <SelectButton key={t} active={startTime === t}
              onClick={() => { setStartTime(t); setEndTime('') }}>
              {t}
            </SelectButton>
          ))}
        </div>
      </SectionCard>

      <SectionCard step={4} label="終了時刻" complete={!!endTime}>
        <div className="grid grid-cols-4 gap-1.5">
          {endOptions.map((t) => (
            <SelectButton key={t} active={endTime === t} onClick={() => setEndTime(t)}>
              {t}
            </SelectButton>
          ))}
          {!startTime && (
            <p className="col-span-4 text-[0.85rem] text-ink-pale text-center py-1">
              開始時刻を先に選んでください
            </p>
          )}
        </div>
      </SectionCard>

      {canSubmit && (
        <div className="bg-brand-light border-[1.5px] border-brand rounded-xl p-4 mb-3">
          <SummaryRow label="バンド名" value={bandName} />
          <SummaryRow label="日付"     value={availableDates.find((d) => d.value === selectedDate)?.label ?? selectedDate} />
          <SummaryRow label="時間帯"   value={`${startTime}〜${endTime}`} />
        </div>
      )}

      <button className="btn-primary" onClick={handleSubmit} disabled={!canSubmit}>
        {submitting ? '送信中...' : '予約（即時確定）'}
      </button>
    </div>
  )
}

function SectionCard({ step, label, complete, children }: {
  step: number; label: string; complete: boolean; children: React.ReactNode
}) {
  return (
    <div className={
      'bg-surface border rounded-xl p-4 mb-3 shadow-[var(--shadow-card-sm)] transition-colors ' +
      (complete ? 'border-brand' : 'border-line')
    }>
      <div className="flex items-center justify-between mb-3">
        <span className="flex items-center gap-1.5 text-[0.8rem] font-semibold text-ink-sub uppercase tracking-wide">
          <span className={
            'w-5 h-5 rounded-full flex items-center justify-center text-[0.65rem] font-bold ' +
            (complete ? 'bg-brand text-white' : 'bg-line text-ink-sub')
          }>{step}</span>
          {label}
        </span>
        {complete && <span className="icon icon-sm text-brand">check_circle</span>}
      </div>
      {children}
    </div>
  )
}

function SelectButton({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={
        'px-1 py-2.5 rounded-lg text-[0.85rem] cursor-pointer text-center transition active:scale-[0.97] border-[1.5px] ' +
        (active ? 'bg-brand border-brand text-white font-semibold' : 'bg-[#fafafa] border-line text-ink-sub')
      }
    >
      {children}
    </button>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[0.9rem] py-0.5 not-first:border-t not-first:border-brand/20 not-first:mt-1.5 not-first:pt-1.5">
      <span className="text-ink-sub">{label}</span>
      <span className="font-semibold text-ink">{value}</span>
    </div>
  )
}
