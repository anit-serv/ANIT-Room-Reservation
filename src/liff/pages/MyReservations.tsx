import { useState, useEffect, useCallback } from 'react'
import type { LiffProfile } from '../LiffApp'
import Skeleton from '../../components/Skeleton'


type Props = {
  profile: LiffProfile
  initialEdit?: { facility: 'kobu' | 'nobu'; id: string } | null
  onEditHandled?: () => void
  onKobuEdit?: (r: { id: string; date: string; bandName: string; startTime: string; endTime: string }) => void
}

type NobuReservation = {
  id: string
  bandName: string
  date: string       // "YYYY-MM-DDTHH:MM-HH:MM"
  status: 'pending' | 'confirmed'
  facility: 'nobu'
}

type KobuReservation = {
  id: string
  bandName: string
  date: string       // "YYYY-MM-DD"
  startTime: string
  endTime: string
  status: 'confirmed'
  facility: 'kobu'
}

type Reservation = NobuReservation | KobuReservation

function sortKey(r: Reservation): string {
  if (r.facility === 'nobu') return r.date
  return `${r.date}T${r.startTime}`
}

export default function MyReservations({ profile, initialEdit, onEditHandled, onKobuEdit }: Props) {
  const [reservations,  setReservations]  = useState<Reservation[]>([])
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState<string | null>(null)
  const [deleting,      setDeleting]      = useState<string | null>(null)
  const [modifyingNobu, setModifyingNobu] = useState<NobuReservation | null>(null)

  const fetchReservations = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const headers = { Authorization: `Bearer ${profile.getAccessToken()}` }
      const [nobuRes, kobuRes] = await Promise.all([
        fetch('/api/reservations/my', { headers }),
        fetch('/api/kobu-reservations/my', { headers }),
      ])
      if (!nobuRes.ok || !kobuRes.ok) {
        const failedRes = !nobuRes.ok ? nobuRes : kobuRes
        const label = !nobuRes.ok ? '農部' : '工部室'
        const body = await failedRes.json().catch(() => ({}))
        throw new Error(`${label} API: ${failedRes.status} ${body.error ?? ''}`)
      }
      const [nobuData, kobuData] = await Promise.all([nobuRes.json(), kobuRes.json()])

      const nobu: NobuReservation[] = (nobuData.reservations ?? []).map((r: any) => ({ ...r, facility: 'nobu' }))
      const kobu: KobuReservation[] = (kobuData.reservations ?? []).map((r: any) => ({ ...r, facility: 'kobu' }))

      const all: Reservation[] = [...nobu, ...kobu].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
      setReservations(all)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '予約の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [profile])

  useEffect(() => { fetchReservations() }, [fetchReservations])

  useEffect(() => {
    if (!initialEdit || loading) return
    const r = reservations.find((x) => x.id === initialEdit.id && x.facility === 'nobu')
    if (!r) return
    setModifyingNobu(r as NobuReservation)
    onEditHandled?.()
  }, [initialEdit, loading, reservations])

  async function handleDelete(r: Reservation) {
    const label = r.facility === 'nobu'
      ? `「${r.bandName}」の農部の登録を削除しますか？`
      : `「${r.bandName}」の工部室の登録を削除しますか？`
    if (!confirm(label)) return
    setDeleting(r.id)
    try {
      const endpoint = r.facility === 'nobu'
        ? `/api/reservations/${r.id}`
        : `/api/kobu-reservations/${r.id}`
      const res = await fetch(endpoint, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${profile.getAccessToken()}` },
      })
      if (!res.ok) throw new Error()
      setReservations((prev) => prev.filter((x) => x.id !== r.id))
    } catch {
      alert('削除に失敗しました')
    } finally {
      setDeleting(null)
    }
  }

  if (loading) return (
    <div>
      <Skeleton width="120px" height="20px" className="mb-4" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="reservation-card">
          <Skeleton width="4px" height="56px" />
          <div className="flex-1">
            <Skeleton width="60%" height="16px" className="mb-1.5" />
            <Skeleton width="80%" height="12px" className="mb-2" />
            <Skeleton width="80px" height="20px" style={{ borderRadius: 20 }} />
          </div>
        </div>
      ))}
    </div>
  )

  if (error) return <div className="banner-error mt-4">{error}</div>

  if (reservations.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 px-4 text-ink-pale text-center">
        <span className="icon icon-xl text-ink-pale">event_busy</span>
        <span className="text-[0.9rem]">予約はまだありません</span>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-[1.05rem] font-bold m-0 text-ink">自分の予約</p>
        <span className="text-[0.8rem] text-ink-sub bg-bg px-2.5 py-1 rounded-full">
          {reservations.length}件
        </span>
      </div>

      {modifyingNobu && (
        <NobuModifyModal
          reservation={modifyingNobu}
          profile={profile}
          onClose={() => setModifyingNobu(null)}
          onUpdated={fetchReservations}
        />
      )}

      {reservations.map((r) => {
        const isDeleting = deleting === r.id

        if (r.facility === 'nobu') {
          const [datePart, timePart] = r.date.split('T')
          const displayDate = datePart.slice(5).replace('-', '/')
          const isConfirmed = r.status === 'confirmed'
          const canDelete   = !isConfirmed

          return (
            <div key={r.id} className="reservation-card">
              <div className={'w-1 self-stretch rounded ' + (isConfirmed ? 'bg-brand' : 'bg-warn')} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[0.68rem] bg-line text-ink-sub px-1.5 py-0.5 rounded font-semibold">農部</span>
                  <span className="font-bold text-ink truncate">{r.bandName}</span>
                </div>
                <div className="text-[0.82rem] text-ink-sub mb-2 flex items-center gap-1.5 flex-wrap">
                  <span className="icon icon-sm text-ink-pale">calendar_month</span>{displayDate}
                  <span className="icon icon-sm text-ink-pale">schedule</span>{timePart}
                </div>
                <span className={'badge ' + (isConfirmed ? 'badge-confirmed' : 'badge-pending')}>
                  <span className="icon icon-sm">{isConfirmed ? 'check_circle' : 'hourglass_empty'}</span>
                  {isConfirmed ? '抽選確定' : '抽選待ち'}
                </span>
              </div>
              <div className="flex gap-1">
                <button className="btn-icon" onClick={() => setModifyingNobu(r)} disabled={isDeleting} title="変更">
                  <span className="icon" style={{ fontSize: 20 }}>edit</span>
                </button>
                {canDelete && (
                  <button className="btn-icon text-danger" onClick={() => handleDelete(r)} disabled={isDeleting} title="削除">
                    <span className="icon" style={{ fontSize: 20 }}>{isDeleting ? 'hourglass_empty' : 'delete'}</span>
                  </button>
                )}
              </div>
            </div>
          )
        }

        // 工部室
        const displayDate = r.date.slice(5).replace('-', '/')
        return (
          <div key={r.id} className="reservation-card">
            <div className="w-1 self-stretch rounded bg-brand" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[0.68rem] bg-brand-light text-brand-dark px-1.5 py-0.5 rounded font-semibold">工部室</span>
                <span className="font-bold text-ink truncate">{r.bandName}</span>
              </div>
              <div className="text-[0.82rem] text-ink-sub mb-2 flex items-center gap-1.5 flex-wrap">
                <span className="icon icon-sm text-ink-pale">calendar_month</span>{displayDate}
                <span className="icon icon-sm text-ink-pale">schedule</span>{r.startTime}〜{r.endTime}
              </div>
              <span className="badge badge-confirmed">
                <span className="icon icon-sm">check_circle</span>確定
              </span>
            </div>
            <div className="flex gap-1">
              <button className="btn-icon" onClick={() => onKobuEdit?.(r)} disabled={isDeleting} title="変更">
                <span className="icon" style={{ fontSize: 20 }}>edit</span>
              </button>
              <button className="btn-icon text-danger" onClick={() => handleDelete(r)} disabled={isDeleting} title="削除">
                <span className="icon" style={{ fontSize: 20 }}>{isDeleting ? 'hourglass_empty' : 'delete'}</span>
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── 農部予約変更モーダル ─────────────────────────────
type NobuTimeSlot = { label: string; value: string }

function NobuModifyModal({
  reservation, profile, onClose, onUpdated,
}: {
  reservation: NobuReservation
  profile: LiffProfile
  onClose: () => void
  onUpdated: () => void
}) {
  const currentSlot = reservation.date.split('T')[1] // e.g. "18:00-20:00"
  const [newBandName, setNewBandName] = useState(reservation.bandName)
  const [newTimeSlot, setNewTimeSlot] = useState(currentSlot)
  const [slots,       setSlots]       = useState<NobuTimeSlot[] | null>(null)
  const [error,       setError]       = useState<string | null>(null)
  const [saving,      setSaving]      = useState(false)
  const isConfirmed = reservation.status === 'confirmed'

  useEffect(() => {
    const dateOnly = reservation.date.split('T')[0]
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data) => {
        const dateEntry = (data.availableDatesWithToday ?? []).find((d: any) => d.value === dateOnly)
        const raw: NobuTimeSlot[] = (dateEntry?.timeSlots?.length ? dateEntry.timeSlots : null)
          ?? (data.timeSlots?.length ? data.timeSlots : null)
          ?? []
        setSlots(raw)
      })
      .catch(() => setSlots([]))
  }, [reservation])

  async function handleSubmit() {
    const noChange = newBandName.trim() === reservation.bandName && newTimeSlot === currentSlot
    if (noChange) { onClose(); return }
    if (!newBandName.trim()) { setError('バンド名を入力してください'); return }
    setSaving(true)
    setError(null)
    try {
      const body: Record<string, string> = {}
      if (newBandName.trim() !== reservation.bandName) body.bandName = newBandName.trim()
      if (newTimeSlot !== currentSlot) body.timeSlot = newTimeSlot
      const res = await fetch(`/api/reservations/${reservation.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${profile.getAccessToken()}`,
        },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '変更に失敗しました')
      onUpdated()
      onClose()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const dateOnly    = reservation.date.split('T')[0]
  const displayDate = dateOnly.slice(5).replace('-', '/')

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card max-w-[360px]" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold mb-0.5">予約を変更</h3>
        <p className="text-[0.82rem] text-ink-sub mb-4">農部 — {displayDate}</p>

        {slots === null ? (
          <div className="text-center py-6 text-ink-pale text-[0.9rem]">読み込み中...</div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-[0.85rem] font-medium mb-1 block">バンド名</label>
              <input
                className="text-input"
                value={newBandName}
                onChange={(e) => setNewBandName(e.target.value)}
                placeholder="バンド名"
              />
            </div>
            <div>
              <label className="text-[0.85rem] font-medium mb-1 block">時間枠</label>
              {isConfirmed ? (
                <p className="text-input bg-bg text-ink-sub cursor-not-allowed">
                  {slots.find((s) => s.value === currentSlot)?.label ?? currentSlot}
                </p>
              ) : slots.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {slots.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      className={
                        'w-full px-3 py-2.5 rounded-lg text-[0.85rem] border-[1.5px] text-left transition ' +
                        (s.value === newTimeSlot
                          ? 'bg-brand border-brand text-white font-semibold'
                          : 'bg-surface border-line text-ink-sub')
                      }
                      onClick={() => setNewTimeSlot(s.value)}
                    >{s.label}</button>
                  ))}
                </div>
              ) : (
                <p className="text-input bg-bg text-ink-sub">
                  {currentSlot}
                </p>
              )}
              {isConfirmed && (
                <p className="text-[0.78rem] text-ink-sub mt-1">抽選確定済みのため時間枠は変更できません</p>
              )}
            </div>
          </div>
        )}

        {error && <div className="banner-error mt-3">{error}</div>}

        <div className="flex gap-2 mt-4">
          <button className="btn-outline flex-1" onClick={onClose} disabled={saving}>キャンセル</button>
          <button className="btn-primary flex-1" onClick={handleSubmit} disabled={saving || slots === null}>
            {saving ? '変更中...' : '変更する'}
          </button>
        </div>
      </div>
    </div>
  )
}
