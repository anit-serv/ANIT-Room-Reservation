import { useState, useEffect, useCallback } from 'react'
import type { LiffProfile } from '../App'

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
    <div className="splash">
      <div className="spinner" />
      <span>読み込み中...</span>
    </div>
  )

  if (error) return <div className="banner error" style={{ marginTop: '1rem' }}>{error}</div>

  if (reservations.length === 0) {
    return (
      <div className="empty-state">
        <span className="icon icon-xl" style={{ color: 'var(--text-pale)' }}>event_busy</span>
        <span className="empty-text">予約はまだありません</span>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <p className="page-title" style={{ margin: 0 }}>自分の予約</p>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-sub)', background: 'var(--bg)', padding: '0.2rem 0.6rem', borderRadius: '20px' }}>
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
            <div className={`accent ${r.status}`} />
            <div className="card-body">
              <div className="card-band">{r.bandName}</div>
              <div className="card-date" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="icon icon-sm" style={{ color: 'var(--text-pale)' }}>calendar_month</span>{displayDate}
                <span className="icon icon-sm" style={{ color: 'var(--text-pale)' }}>schedule</span>{timePart}
              </div>
              <span className={`badge ${r.status}`}>
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
