import { useState, useEffect, useCallback, useMemo } from 'react'
import type { LiffProfile } from '../LiffApp'
import Skeleton from '../../components/Skeleton'

// ─── 時刻ユーティリティ（サーバー側と同じロジック） ────
function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
function minToTime(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
function generateTimes(from: string, to: string): string[] {
  const result: string[] = []
  for (let m = timeToMin(from); m <= timeToMin(to); m += 15) result.push(minToTime(m))
  return result
}
type SlotRange = { start: string; end: string }
function getEffectiveSlots(date: string, settings: any): SlotRange[] {
  let slots: { value: string; deleted?: boolean }[] = settings.timeSlots ?? []
  slots = slots.filter((s) => !s.deleted)
  if (!slots.length) slots = [{ value: '08:00-20:00' }]
  const dow    = new Date(date + 'T00:00:00Z').getUTCDay()
  const perDay = settings.perDaySchedule
  if (perDay?.enabled) {
    const byDate = perDay.byDate?.[date]
    if (byDate?.length) slots = byDate
    else {
      const byWd = perDay.byWeekday?.[String(dow)]
      if (byWd?.length) slots = byWd
    }
  }
  return slots.map((s) => { const [start, end] = s.value.split('-'); return { start, end } })
}
function findSlotStart(time: string, slots: SlotRange[]): string | null {
  const t = timeToMin(time)
  const s = slots.find((sl) => timeToMin(sl.start) <= t && t < timeToMin(sl.end))
  return s ? s.start : null
}
function findSlotEnd(time: string, slots: SlotRange[]): string | null {
  const t = timeToMin(time)
  const s = slots.find((sl) => timeToMin(sl.start) < t && t <= timeToMin(sl.end))
  return s ? s.end : null
}

type Props = { profile: LiffProfile }

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

export default function MyReservations({ profile }: Props) {
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)
  const [deleting,     setDeleting]     = useState<string | null>(null)
  const [modifying,    setModifying]    = useState<KobuReservation | null>(null)

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

      {modifying && (
        <KobuModifyModal
          reservation={modifying}
          profile={profile}
          onClose={() => setModifying(null)}
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
              {canDelete && (
                <button className="btn-danger" onClick={() => handleDelete(r)} disabled={isDeleting}>
                  {isDeleting ? '...' : '削除'}
                </button>
              )}
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
            <div className="flex flex-col gap-1.5">
              <button className="btn-outline text-[0.8rem] px-2 py-1" onClick={() => setModifying(r)} disabled={isDeleting}>
                変更
              </button>
              <button className="btn-danger text-[0.8rem] px-2 py-1" onClick={() => handleDelete(r)} disabled={isDeleting}>
                {isDeleting ? '...' : '削除'}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── 工部室予約変更モーダル ───────────────────────────
function KobuModifyModal({
  reservation, profile, onClose, onUpdated,
}: {
  reservation: KobuReservation
  profile: LiffProfile
  onClose: () => void
  onUpdated: () => void
}) {
  const [newStart, setNewStart] = useState(reservation.startTime)
  const [newEnd,   setNewEnd]   = useState(reservation.endTime)
  const [error,    setError]    = useState<string | null>(null)
  const [saving,   setSaving]   = useState(false)
  const [constraints, setConstraints] = useState<{
    minStart: string; maxEnd: string
    startOutsideHours: boolean; endOutsideHours: boolean
  } | null>(null)

  useEffect(() => {
    fetch('/api/kobu-settings')
      .then((r) => r.json())
      .then((settings) => {
        const slots     = getEffectiveSlots(reservation.date, settings)
        const slotStart = findSlotStart(reservation.startTime, slots)
        const slotEnd   = findSlotEnd(reservation.endTime, slots)
        setConstraints({
          minStart:          slotStart ?? reservation.startTime,
          maxEnd:            slotEnd   ?? reservation.endTime,
          startOutsideHours: slotStart === null,
          endOutsideHours:   slotEnd   === null,
        })
      })
      .catch(() => setConstraints({
        minStart: reservation.startTime, maxEnd: reservation.endTime,
        startOutsideHours: false, endOutsideHours: false,
      }))
  }, [reservation])

  const startOptions = useMemo(() => {
    if (!constraints) return []
    return generateTimes(constraints.minStart, '23:45').filter((t) => t < newEnd)
  }, [constraints, newEnd])

  const endOptions = useMemo(() => {
    if (!constraints) return []
    return generateTimes('00:15', constraints.maxEnd).filter((t) => t > newStart)
  }, [constraints, newStart])

  // 選択値が有効範囲から外れた場合に補正
  useEffect(() => {
    if (startOptions.length && !startOptions.includes(newStart)) setNewStart(startOptions[startOptions.length - 1])
  }, [startOptions])
  useEffect(() => {
    if (endOptions.length && !endOptions.includes(newEnd)) setNewEnd(endOptions[0])
  }, [endOptions])

  async function handleSubmit() {
    if (newStart === reservation.startTime && newEnd === reservation.endTime) { onClose(); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/kobu-reservations/${reservation.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${profile.getAccessToken()}`,
        },
        body: JSON.stringify({ newStart, newEnd }),
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card max-w-[360px]" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold mb-0.5">予約時間を変更</h3>
        <p className="text-[0.82rem] text-ink-sub mb-4">
          {reservation.date.slice(5).replace('-', '/')} — {reservation.bandName}
        </p>

        {!constraints ? (
          <div className="text-center py-6 text-ink-pale text-[0.9rem]">読み込み中...</div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-[0.85rem] font-medium mb-1 block">開始時刻</label>
              <select className="text-input" value={newStart} onChange={(e) => setNewStart(e.target.value)}>
                {startOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              {constraints.startOutsideHours && (
                <p className="text-[0.78rem] text-warn mt-1">現在の開始時刻が営業時間外のため、早めることはできません</p>
              )}
            </div>
            <div>
              <label className="text-[0.85rem] font-medium mb-1 block">終了時刻</label>
              <select className="text-input" value={newEnd} onChange={(e) => setNewEnd(e.target.value)}>
                {endOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              {constraints.endOutsideHours && (
                <p className="text-[0.78rem] text-warn mt-1">現在の終了時刻が営業時間外のため、遅くすることはできません</p>
              )}
            </div>
          </div>
        )}

        {error && <div className="banner-error mt-3">{error}</div>}

        <div className="flex gap-2 mt-4">
          <button className="btn-outline flex-1" onClick={onClose} disabled={saving}>キャンセル</button>
          <button className="btn-primary flex-1" onClick={handleSubmit} disabled={saving || !constraints}>
            {saving ? '変更中...' : '変更する'}
          </button>
        </div>
      </div>
    </div>
  )
}
