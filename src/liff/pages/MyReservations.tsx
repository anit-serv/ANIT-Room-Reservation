import { useState, useEffect, useCallback } from 'react'
import type { LiffProfile } from '../LiffApp'
import Skeleton from '../../components/Skeleton'

type Props = { profile: LiffProfile }

type Reservation = {
  id: string
  bandName: string
  date: string
  status: 'pending' | 'confirmed'
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
      const res = await fetch('/api/reservations/my', {
        headers: { Authorization: `Bearer ${profile.idToken}` },
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setReservations(data.reservations ?? [])
    } catch {
      setError('予約の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [profile.idToken])

  useEffect(() => { fetchReservations() }, [fetchReservations])

  async function handleDelete(id: string, bandName: string) {
    if (!confirm(`「${bandName}」の登録を削除しますか？`)) return
    setDeleting(id)
    try {
      const res = await fetch(`/api/reservations/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${profile.idToken}` },
      })
      if (!res.ok) throw new Error()
      setReservations((prev) => prev.filter((r) => r.id !== id))
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
        const [datePart, timePart] = r.date.split('T')
        const displayDate = datePart.slice(5).replace('-', '/')
        const isConfirmed = r.status === 'confirmed'
        const isDeleting  = deleting === r.id

        return (
          <div key={r.id} className="reservation-card">
            <div className={'w-1 self-stretch rounded ' + (isConfirmed ? 'bg-brand' : 'bg-warn')} />
            <div className="flex-1 min-w-0">
              <div className="font-bold text-ink truncate mb-0.5">{r.bandName}</div>
              <div className="text-[0.82rem] text-ink-sub mb-2 flex items-center gap-1.5 flex-wrap">
                <span className="icon icon-sm text-ink-pale">calendar_month</span>{displayDate}
                <span className="icon icon-sm text-ink-pale">schedule</span>{timePart}
              </div>
              <span className={'badge ' + (isConfirmed ? 'badge-confirmed' : 'badge-pending')}>
                <span className="icon icon-sm">{isConfirmed ? 'check_circle' : 'hourglass_empty'}</span>
                {isConfirmed ? '抽選確定' : '抽選待ち'}
              </span>
            </div>
            {!isConfirmed && (
              <button
                className="btn-danger"
                onClick={() => handleDelete(r.id, r.bandName)}
                disabled={isDeleting}
              >
                {isDeleting ? '...' : '削除'}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
