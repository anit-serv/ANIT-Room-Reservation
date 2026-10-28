import { useState, useEffect } from 'react'
import { useToast } from '../../contexts/ToastContext'
import type { LiffProfile } from '../LiffApp'
import Skeleton from '../../components/Skeleton'
import FavoritePicker, { type Favorite } from '../../components/FavoritePicker'

type Props = { profile: LiffProfile | null; onBookingActive?: (active: boolean) => void }
type TimeSlot  = { label: string; value: string }
type DateEntry = { label: string; value: string; timeSlots: TimeSlot[]; lotteryTime?: string; hamoaniActive?: boolean; roomPreferenceEnabled?: boolean; roomRegistrationPending?: boolean; roomChoices?: Record<string, string[]> }

export default function ReservationForm({ profile, onBookingActive }: Props) {
  const [bandName,          setBandName]          = useState('')
  const [dates,             setDates]             = useState<DateEntry[]>([])
  const [selectedDate,      setSelectedDate]      = useState('')
  const [selectedTime,      setSelectedTime]      = useState('')
  const [preferredRooms,    setPreferredRooms]    = useState<string[]>([])
  const [hamoani,           setHamoani]           = useState(false)
  const [submitting,        setSubmitting]        = useState(false)
  const [done,              setDone]              = useState(false)
  const [loadingSettings,   setLoadingSettings]   = useState(true)
  const [error,             setError]             = useState<string | null>(null)
  const [favorites,         setFavorites]         = useState<Favorite[]>([])
  const [selectedFavId,     setSelectedFavId]     = useState<string | null>(null)
  const [preferredTimeSlot, setPreferredTimeSlot] = useState<string | null>(null)
  const [favSaved,          setFavSaved]          = useState(false)
  const [savingFav,         setSavingFav]         = useState(false)
  const { showToast } = useToast()

  const isDirty = !done && !!bandName.trim()
  useEffect(() => { onBookingActive?.(isDirty) }, [isDirty])

  useEffect(() => {
    if (!profile) return
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data) => setDates(data.availableDates ?? []))
      .catch(() => setError('設定の取得に失敗しました'))
      .finally(() => setLoadingSettings(false))
  }, [profile])

  useEffect(() => {
    if (!profile) return
    fetch('/api/favorites', { headers: { Authorization: `Bearer ${profile.getAccessToken()}` } })
      .then(r => r.json()).then(d => setFavorites(d.favorites ?? [])).catch(() => {})
  }, [profile])

  const selectedDateEntry = dates.find((d) => d.value === selectedDate)
  const timeSlots = selectedDateEntry?.timeSlots ?? []
  const roomChoices = selectedDateEntry?.roomChoices?.[selectedTime] ?? []

  function handleSelectDate(value: string) {
    setSelectedDate(value)
    setPreferredRooms([])
    const newEntry = dates.find((d) => d.value === value)
    if (!newEntry) return
    if (!newEntry.hamoaniActive) setHamoani(false)
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
    if (!profile || !bandName.trim()) return
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

  const canSubmit = bandName.trim() && selectedDate && selectedTime && !submitting &&
    (!selectedDateEntry?.roomPreferenceEnabled || preferredRooms.length > 0)

  function toggleRoom(room: string) {
    setPreferredRooms((current) => current.includes(room)
      ? current.filter((item) => item !== room) : [...current, room])
  }

  function moveRoom(index: number, direction: number) {
    setPreferredRooms((current) => {
      const next = [...current]
      const other = index + direction
      if (other < 0 || other >= next.length) return current
      ;[next[index], next[other]] = [next[other], next[index]]
      return next
    })
  }

  async function handleSubmit() {
    if (!profile || !canSubmit) return
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
          ...(selectedDateEntry?.hamoaniActive ? { hamoani } : {}),
          ...(selectedDateEntry?.roomPreferenceEnabled ? { preferredRooms } : {}),
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '登録に失敗しました')
      showToast('予約を受け付けました。抽選結果をお待ちください。')
      setDone(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '登録に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  function reset() {
    setBandName(''); setSelectedDate(''); setSelectedTime(''); setDone(false); setError(null)
    setSelectedFavId(null); setPreferredTimeSlot(null); setFavSaved(false); setHamoani(false); setPreferredRooms([])
  }

  const dateLabel = dates.find((d) => d.value === selectedDate)?.label ?? ''
  const timeLabel = timeSlots.find((t) => t.value === selectedTime)?.label ?? ''
  const lotteryTime = selectedDateEntry?.lotteryTime ?? ''

  if (done && !loadingSettings) {
    const isAlreadyFav = !!selectedFavId || favorites.some(f => f.name === bandName.trim())
    return (
      <div>
        <Summary
          bandName={bandName}
          dateLabel={dateLabel}
          timeLabel={timeLabel}
          lotteryTime={lotteryTime}
          hamoani={selectedDateEntry?.hamoaniActive ? hamoani : undefined}
          preferredRooms={selectedDateEntry?.roomPreferenceEnabled ? preferredRooms : undefined}
        />
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
      <p className="text-[1.05rem] font-bold mb-4 text-ink">{loadingSettings ? <Skeleton width="100px" height="20px" /> : '予約登録'}</p>

      {error && <div className="banner-error">{error}</div>}

      <SectionCard step={1} label="バンド名" complete={!!bandName.trim()} loading={loadingSettings}>
        {loadingSettings ? <>{favorites.length > 0 && <Skeleton width="100%" height={36} className="mb-2" />}<Skeleton width="100%" height={44} /></> : <><FavoritePicker favorites={favorites} onSelect={handleFavoriteSelect} />
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
        /></>}
      </SectionCard>

      <SectionCard step={2} label="日付" complete={!!selectedDate} loading={loadingSettings}>
        <div className="grid grid-cols-3 gap-2">
          {loadingSettings ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} width="100%" height={44} />) : dates.map((d) => (
            <SelectButton key={d.value} active={selectedDate === d.value} disabled={d.roomRegistrationPending || d.timeSlots.length === 0} onClick={() => handleSelectDate(d.value)}>
              {d.label}{d.roomRegistrationPending ? <span className="block text-[0.7rem]">部屋登録待ち</span> : null}
            </SelectButton>
          ))}
        </div>
      </SectionCard>

      <SectionCard step={3} label="時間帯" complete={!!selectedTime} loading={loadingSettings}>
        <div className="grid grid-cols-2 gap-2">
          {loadingSettings ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} width="100%" height={44} />) : timeSlots.map((t) => (
            <SelectButton key={t.value} active={selectedTime === t.value} onClick={() => { setSelectedTime(t.value); setPreferredRooms([]) }}>
              {t.label}
            </SelectButton>
          ))}
        </div>
      </SectionCard>

      {selectedDateEntry?.roomPreferenceEnabled && selectedTime && (
        <SectionCard step={4} label="希望部屋（上から希望順）" complete={preferredRooms.length > 0}>
          <p className="text-[0.8rem] text-ink-sub mb-2">希望する部屋だけ選べます。希望順は矢印で変更してください。</p>
          <div className="flex flex-wrap gap-2 mb-3">
            {roomChoices.map((room) => <button key={room} type="button" onClick={() => toggleRoom(room)}
              className={`px-3 py-2 rounded-lg border text-sm ${preferredRooms.includes(room) ? 'bg-brand text-white border-brand' : 'border-line'}`}>
              {room}
            </button>)}
          </div>
          <ol className="space-y-2">
            {preferredRooms.map((room, index) => <li key={room} className="flex items-center gap-2 text-sm">
              <span className="w-6">{index + 1}.</span><span className="flex-1">{room}</span>
              <button type="button" aria-label={`${room}を上へ`} disabled={index === 0} onClick={() => moveRoom(index, -1)} className="px-2 disabled:opacity-30">↑</button>
              <button type="button" aria-label={`${room}を下へ`} disabled={index === preferredRooms.length - 1} onClick={() => moveRoom(index, 1)} className="px-2 disabled:opacity-30">↓</button>
            </li>)}
          </ol>
        </SectionCard>
      )}

      {selectedDateEntry?.hamoaniActive && (
        <div className="bg-surface border border-line rounded-xl p-4 mb-3 shadow-[var(--shadow-card-sm)]">
          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              className="mt-0.5 w-[18px] h-[18px] accent-brand shrink-0"
              checked={hamoani}
              onChange={(e) => setHamoani(e.target.checked)}
            />
            <span>
              <span className="block text-[0.95rem] font-semibold text-ink">ハモアニ</span>
              <span className="block text-[0.8rem] text-ink-sub mt-0.5">
                チェックすると、この予約は抽選で優先されます（期間限定）
              </span>
            </span>
          </label>
        </div>
      )}

      {canSubmit && (
        <div className="bg-brand-light border-[1.5px] border-brand rounded-xl p-4 mb-3">
          <SummaryRow label="バンド名" value={bandName} />
          <SummaryRow label="日付" value={dateLabel} />
          <SummaryRow label="時間帯" value={timeLabel} />
          {selectedDateEntry?.hamoaniActive && <SummaryRow label="ハモアニ" value={hamoani ? '有効' : '無効'} />}
          {selectedDateEntry?.roomPreferenceEnabled && <SummaryRow label="希望部屋" value={preferredRooms.join(' → ')} />}
        </div>
      )}

      <button className="btn-primary" onClick={handleSubmit} disabled={loadingSettings || !canSubmit}>
        {loadingSettings ? <Skeleton width="100%" height={22} /> : submitting ? '送信中...' : '予約'}
      </button>
    </div>
  )
}

// ── Section card with step badge & completion mark ─────────────
function SectionCard({
  step, label, complete, loading = false, children,
}: { step: number; label: string; complete: boolean; loading?: boolean; children: React.ReactNode }) {
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
          {loading ? <Skeleton width="84px" height="14px" /> : label}
        </span>
        {complete && !loading && <span className="icon icon-sm text-brand">check_circle</span>}
      </div>
      {children}
    </div>
  )
}

function SelectButton({
  active, disabled, onClick, children,
}: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        'px-1 py-2.5 rounded-lg text-[0.85rem] cursor-pointer text-center transition active:scale-[0.97] border-[1.5px] ' +
        (active ? 'bg-brand border-brand text-white font-semibold' : 'bg-[#fafafa] border-line text-ink-sub') +
        (disabled ? ' opacity-40 cursor-not-allowed' : '')
      }
    >
      {children}
    </button>
  )
}

function Summary({ bandName, dateLabel, timeLabel, lotteryTime, hamoani, preferredRooms }: {
  bandName: string; dateLabel: string; timeLabel: string; lotteryTime?: string; hamoani?: boolean; preferredRooms?: string[]
}) {
  return (
    <div className="bg-surface border border-line rounded-xl p-4 mb-3 shadow-[var(--shadow-card-sm)]">
      <SummaryRow label="バンド名" value={bandName} />
      <SummaryRow label="日付" value={dateLabel} />
      <SummaryRow label="時間帯" value={timeLabel} />
      {lotteryTime && <SummaryRow label="抽選時刻" value={lotteryTime} />}
      {hamoani !== undefined && <SummaryRow label="ハモアニ" value={hamoani ? '有効' : '無効'} />}
      {preferredRooms && <SummaryRow label="希望部屋" value={preferredRooms.join(' → ')} />}
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
