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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchReservations = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/reservations/my', {
        headers: { Authorization: `Bearer ${profile.idToken}` },
      })
      if (!res.ok) throw new Error('取得に失敗しました')
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
    try {
      const res = await fetch(`/api/reservations/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${profile.idToken}` },
      })
      if (!res.ok) throw new Error()
      setReservations((prev) => prev.filter((r) => r.id !== id))
    } catch {
      alert('削除に失敗しました')
    }
  }

  if (loading) return <div className="loading">読み込み中...</div>
  if (error) return <div className="error" style={{ height: 'auto', padding: '1rem' }}>{error}</div>

  if (reservations.length === 0) {
    return <div className="empty-state">予約はまだありません</div>
  }

  return (
    <div>
      <p className="section-title">自分の予約 ({reservations.length}件)</p>
      {reservations.map((r) => {
        const [datePart, timePart] = r.date.split('T')
        const displayDate = datePart.slice(5).replace('-', '/')
        const isConfirmed = r.status === 'confirmed'
        return (
          <div key={r.id} className="reservation-card">
            <div className="band-name">{r.bandName}</div>
            <div className="date-time">📅 {displayDate} {timePart}</div>
            <span className={`status ${r.status}`}>
              {isConfirmed ? '✅ 抽選確定' : '⏳ 抽選待ち'}
            </span>
            {!isConfirmed && (
              <div className="card-actions">
                <button className="btn-delete" onClick={() => handleDelete(r.id, r.bandName)}>
                  削除
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
