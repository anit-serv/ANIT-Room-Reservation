import { useState, useEffect } from 'react'
import type { LiffProfile } from '../LiffApp'
import Skeleton from '../../components/Skeleton'
import FavoritePicker, { type Favorite } from '../../components/FavoritePicker'

type Props = { profile: LiffProfile; onBookingActive?: (active: boolean) => void }
type TimeSlot  = { label: string; value: string }
type DateEntry = { label: string; value: string; timeSlots: TimeSlot[] }

export default function ReservationForm({ profile, onBookingActive }: Props) {
  const [bandName,          setBandName]          = useState('')
  const [dates,             setDates]             = useState<DateEntry[]>([])
  const [selectedDate,      setSelectedDate]      = useState('')
  const [selectedTime,      setSelectedTime]      = useState('')
  const [submitting,        setSubmitting]        = useState(false)
  const [done,              setDone]              = useState(false)
  const [loadingSettings,   setLoadingSettings]   = useState(true)
  const [error,             setError]             = useState<string | null>(null)
  const [favorites,         setFavorites]         = useState<Favorite[]>([])
  const [selectedFavId,     setSelectedFavId]     = useState<string | null>(null)
  const [preferredTimeSlot, setPreferredTimeSlot] = useState<string | null>(null)
  const [favSaved,          setFavSaved]          = useState(false)
  const [savingFav,         setSavingFav]         = useState(false)

  const isDirty = !done && !!bandName.trim()
  useEffect(() => { onBookingActive?.(isDirty) }, [isDirty])

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data) => setDates(data.availableDates ?? []))
      .catch(() => setError('設定の取得に失敗しました'))
      .finally(() => setLoadingSettings(false))
  }, [])

  useEffect(() => {
    fetch('/api/favorites', { headers: { Authorization: `Bearer ${profile.getAccessToken()}` } })
      .then(r => r.json()).then(d => setFavorites(d.favorites ?? [])).catch(() => {})
  }, [])

  const selectedDateEntry = dates.find((d) => d.value === selectedDate)
  const timeSlots = selectedDateEntry?.timeSlots ?? []

  function handleSelectDate(value: string) {
    setSelectedDate(value)
    const newEntry = dates.find((d) => d.value === value)
    if (!newEntry) return
    if (newEntry.timeSlots.some((t) => t.value === selectedTime)) return
    // お気に入りの優先時間枠を適用
    if (preferredTimeSlot && newEntry.timeSlots.some((t) => t.value === preferredTimeSlot)) {
      setSelectedTime(preferredTimeSlot)
    } else {
      setSelectedTime('')
    }
  }

  function handleFavoriteSelect(favId: string, name: string, nobuTimeSlot: string | null) {
    setBandName(name)
    setSelectedFavId(favId)
    setPreferredTimeSlot(nobuTimeSlot)
    if (nobuTimeSlot && selectedDate) {
      const entry = dates.find(d => d.value === selectedDate)
      if (entry?.timeSlots.some(t => t.value === nobuTimeSlot)) setSelectedTime(nobuTimeSlot)
    }
  }

  async function saveAsFavorite() {
    if (!bandName.trim()) return
    setSavingFav(true)
    try {
      const res = await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${profile.getAccessToken()}` },
        body: JSON.stringify({ name: bandName.trim(), nobuTimeSlot: selectedTime || null }),
      })
      if (!res.ok) throw new Error()
      setFavSaved(true)
    } catch {} finally {
      setSavingFav(false)
    }
  }

  const canSubmit = bandName.trim() && selectedDate && selectedTime && !submitting

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/reservations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${profile.getAccessToken()}`,
        },
        body: JSON.stringify({
          bandName: bandName.trim(),
          date: `${selectedDate}T${selectedTime}`,
          ...(selectedFavId ? { favoriteId: selectedFavId } : {}),
        }),
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
    setBandName(''); setSelectedDate(''); setSelectedTime(''); setDone(false); setError(null)
    setSelectedFavId(null); setPreferredTimeSlot(null); setFavSaved(false)
  }

  const dateLabel = dates.find((d) => d.value === selectedDate)?.label ?? ''
  const timeLabel = timeSlots.find((t) => t.value === selectedTime)?.label ?? ''

  if (loadingSettings) {
    return (
      <div>
        <Skeleton width="100px" height="20px" className="mb-4" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-surface border border-line rounded-xl p-4 mb-3 shadow-[var(--shadow-card-sm)]">
            <Skeleton width="40%" height="14px" className="mb-2" />
            <Skeleton width="100%" height={i === 0 ? 44 : 80} />
          </div>
        ))}
      </div>
    )
  }

  if (done) {
    const isAlreadyFav = !!selectedFavId || favorites.some(f => f.name === bandName.trim())
    return (
      <div>
        <div className="banner-success">✅ 予約を受け付けました。抽選結果をお待ちください。</div>
        <Summary bandName={bandName} dateLabel={dateLabel} timeLabel={timeLabel} />
        {!isAlreadyFav && !favSaved && (
          <button
            className="flex items-center gap-1.5 text-[0.85rem] text-ink-sub border border-line rounded-xl px-4 py-2.5 mb-3 w-full hover:bg-[#f8f8f8] transition"
            onClick={saveAsFavorite}
            disabled={savingFav}
          >
            <span className="icon text-brand" style={{ fontSize: 18 }}>star_border</span>
            {savingFav ? '登録中...' : 'このバンドをお気に入りに登録する'}
          </button>
        )}
        {(isAlreadyFav || favSaved) && (
          <div className="flex items-center gap-1.5 text-[0.82rem] text-brand mb-3 px-1">
            <span className="icon" style={{ fontSize: 16 }}>star</span>
            お気に入り登録済み
          </div>
        )}
        <button className="btn-outline mt-2" onClick={reset}>続けて登録</button>
      </div>
    )
  }

  return (
    <div>
      <p className="text-[1.05rem] font-bold mb-4 text-ink">予約登録</p>

      {error && <div className="banner-error">{error}</div>}

      <SectionCard step={1} label="バンド名" complete={!!bandName.trim()}>
        <FavoritePicker favorites={favorites} onSelect={handleFavoriteSelect} />
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
      </SectionCard>

      <SectionCard step={2} label="日付" complete={!!selectedDate}>
        <div className="grid grid-cols-3 gap-2">
          {dates.map((d) => (
            <SelectButton key={d.value} active={selectedDate === d.value} onClick={() => handleSelectDate(d.value)}>
              {d.label}
            </SelectButton>
          ))}
        </div>
      </SectionCard>

      <SectionCard step={3} label="時間帯" complete={!!selectedTime}>
        <div className="grid grid-cols-2 gap-2">
          {timeSlots.map((t) => (
            <SelectButton key={t.value} active={selectedTime === t.value} onClick={() => setSelectedTime(t.value)}>
              {t.label}
            </SelectButton>
          ))}
        </div>
      </SectionCard>

      {canSubmit && (
        <div className="bg-brand-light border-[1.5px] border-brand rounded-xl p-4 mb-3">
          <SummaryRow label="バンド名" value={bandName} />
          <SummaryRow label="日付" value={dateLabel} />
          <SummaryRow label="時間帯" value={timeLabel} />
        </div>
      )}

      <button className="btn-primary" onClick={handleSubmit} disabled={!canSubmit}>
        {submitting ? '送信中...' : '予約'}
      </button>
    </div>
  )
}

// ── Section card with step badge & completion mark ─────────────
function SectionCard({
  step, label, complete, children,
}: { step: number; label: string; complete: boolean; children: React.ReactNode }) {
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

function SelectButton({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
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

function Summary({ bandName, dateLabel, timeLabel }: { bandName: string; dateLabel: string; timeLabel: string }) {
  return (
    <div className="bg-surface border border-line rounded-xl p-4 mb-3 shadow-[var(--shadow-card-sm)]">
      <SummaryRow label="バンド名" value={bandName} />
      <SummaryRow label="日付" value={dateLabel} />
      <SummaryRow label="時間帯" value={timeLabel} />
    </div>
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
