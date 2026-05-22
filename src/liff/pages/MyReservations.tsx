import { useState, useEffect, useCallback } from 'react'
import type { LiffProfile } from '../LiffApp'
import Skeleton from '../../components/Skeleton'

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

  const fetchReservations = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const headers = { Authorization: `Bearer ${profile.idToken}` }
      const [nobuRes, kobuRes] = await Promise.all([
        fetch('/api/reservations/my', { headers }),
        fetch('/api/kobu-reservations/my', { headers }),
      ])
      if (!nobuRes.ok || !kobuRes.ok) throw new Error()
      const [nobuData, kobuData] = await Promise.all([nobuRes.json(), kobuRes.json()])

      const nobu: NobuReservation[] = (nobuData.reservations ?? []).map((r: any) => ({ ...r, facility: 'nobu' }))
      const kobu: KobuReservation[] = (kobuData.reservations ?? []).map((r: any) => ({ ...r, facility: 'kobu' }))

      const all: Reservation[] = [...nobu, ...kobu].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
      setReservations(all)
    } catch {
      setError('予約の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [profile.idToken])

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
        headers: { Authorization: `Bearer ${profile.idToken}` },
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
            <button className="btn-danger" onClick={() => handleDelete(r)} disabled={isDeleting}>
              {isDeleting ? '...' : '削除'}
            </button>
          </div>
        )
      })}
    </div>
  )
}
