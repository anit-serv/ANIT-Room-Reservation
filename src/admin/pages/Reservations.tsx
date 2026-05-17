import { useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { adminFetch } from '../auth'
import TimeRangeInput from '../components/TimeRangeInput'
import Skeleton from '../../components/Skeleton'

type Reservation = {
  id: string
  userId: string
  userDisplayName: string
  userPictureUrl: string | null
  bandName: string
  date: string
  status: 'pending' | 'confirmed'
  order?: number
  createdAt: number | null
}

export default function Reservations() {
  const [searchParams, setSearchParams] = useSearchParams()
  const focusId = searchParams.get('focus')
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({})

  const [reservations, setReservations] = useState<Reservation[]>([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)
  const [dateFilter, setDateFilter]     = useState('')
  const [statusFilter, setStatusFilter] = useState<'' | 'pending' | 'confirmed'>('')
  const [search, setSearch]             = useState('')
  const [editing, setEditing]           = useState<Reservation | null>(null)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (dateFilter)   params.set('date', dateFilter)
      if (statusFilter) params.set('status', statusFilter)
      if (search)       params.set('q', search)
      const res = await adminFetch(`/api/admin/reservations?${params}`)
      if (!res.ok) throw new Error('取得に失敗しました')
      const data = await res.json()
      setReservations(data.reservations)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [dateFilter, statusFilter, search])

  useEffect(() => { load() }, [load])

  // focus クエリ → 該当行へスクロール＋ハイライト
  useEffect(() => {
    if (!focusId || reservations.length === 0) return
    const row = rowRefs.current[focusId]
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setHighlightedId(focusId)
      // 3秒後にクエリを消す（履歴汚染を防ぐ）と同時にハイライト解除
      const t = setTimeout(() => {
        setHighlightedId(null)
        setSearchParams({}, { replace: true })
      }, 3000)
      return () => clearTimeout(t)
    }
  }, [focusId, reservations, setSearchParams])

  async function handleDelete(r: Reservation) {
    if (!confirm(`「${r.bandName}」(${r.date}) を削除しますか？\nこの操作は取り消せません。`)) return
    const res = await adminFetch(`/api/admin/reservations/${r.id}`, { method: 'DELETE' })
    if (res.ok) {
      setReservations((prev) => prev.filter((x) => x.id !== r.id))
    } else {
      alert('削除に失敗しました')
    }
  }

  return (
    <div>
      <h1 className="admin-page-title">予約管理</h1>

      <div className="admin-card">
        <div className="filter-row">
          <input
            type="date"
            className="text-input"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            style={{ width: 'auto' }}
          />
          <select
            className="text-input"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            style={{ width: 'auto' }}
          >
            <option value="">全ステータス</option>
            <option value="pending">抽選待ち</option>
            <option value="confirmed">抽選確定</option>
          </select>
          <input
            type="text"
            className="text-input"
            placeholder="バンド名で検索"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1 }}
          />
          <button
            className="btn-outline"
            style={{ width: 'auto', padding: '0.5rem 0.8rem' }}
            onClick={() => { setDateFilter(''); setStatusFilter(''); setSearch('') }}
          >
            クリア
          </button>
        </div>
      </div>

      {error && <div className="banner error" style={{ marginBottom: '1rem' }}>{error}</div>}
      {loading ? (
        <div className="admin-card" style={{ padding: 0, overflow: 'hidden' }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} style={{ display: 'flex', gap: '1rem', padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
              <Skeleton width="80px" height="38px" />
              <Skeleton width="120px" height="20px" />
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                <Skeleton width={24} height={24} circle />
                <Skeleton width="80px" height="14px" />
              </div>
              <Skeleton width="80px" height="22px" style={{ borderRadius: '20px' }} />
              <Skeleton width="24px" height="14px" />
              <Skeleton width="76px" height="32px" />
            </div>
          ))}
        </div>
      ) : reservations.length === 0 ? (
        <div className="empty-state">
          <span className="icon icon-xl" style={{ color: 'var(--text-pale)' }}>event_busy</span>
          <span className="empty-text">該当する予約がありません</span>
        </div>
      ) : (
        <div className="admin-card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>日時</th>
                <th>バンド名</th>
                <th>登録者</th>
                <th>ステータス</th>
                <th>順位</th>
                <th style={{ width: '120px' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {reservations.map((r) => {
                const [datePart, timePart] = r.date.split('T')
                return (
                  <tr
                    key={r.id}
                    ref={(el) => { rowRefs.current[r.id] = el }}
                    className={highlightedId === r.id ? 'row-highlight' : ''}
                  >
                    <td data-label="日時">
                      <div>
                        <div>{datePart}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-sub)' }}>{timePart}</div>
                      </div>
                    </td>
                    <td data-label="バンド名">{r.bandName}</td>
                    <td data-label="登録者">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {r.userPictureUrl
                          ? <img src={r.userPictureUrl} alt="" className="user-avatar" style={{ width: '24px', height: '24px' }} />
                          : <span className="user-avatar-fallback" style={{ width: '24px', height: '24px' }}>
                              <span className="icon icon-sm">account_circle</span>
                            </span>}
                        <span style={{ fontSize: '0.85rem' }}>{r.userDisplayName || '(不明)'}</span>
                      </div>
                    </td>
                    <td data-label="ステータス">
                      <span className={`badge ${r.status}`}>
                        <span className="icon icon-sm">
                          {r.status === 'confirmed' ? 'check_circle' : 'hourglass_empty'}
                        </span>
                        {r.status === 'confirmed' ? '確定' : '抽選待ち'}
                      </span>
                    </td>
                    <td data-label="順位">{r.order ?? '-'}</td>
                    <td className="cell-actions">
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <button className="btn-icon" onClick={() => setEditing(r)}>
                          <span className="icon">edit</span>
                        </button>
                        <button className="btn-icon" onClick={() => handleDelete(r)}>
                          <span className="icon">delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <EditModal
          reservation={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
    </div>
  )
}

function EditModal({
  reservation, onClose, onSaved,
}: {
  reservation: Reservation
  onClose: () => void
  onSaved: () => void
}) {
  const [bandName, setBandName] = useState(reservation.bandName)
  const [datePart, timePart] = reservation.date.split('T')
  const [date, setDate] = useState(datePart)
  const [time, setTime] = useState(timePart)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setErr(null)
    try {
      const res = await adminFetch(`/api/admin/reservations/${reservation.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bandName, date: `${date}T${time}` }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '保存に失敗しました')
      onSaved()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="admin-card-title">予約を編集</h2>
        {err && <div className="banner error" style={{ marginBottom: '0.75rem' }}>{err}</div>}
        <div className="form-row">
          <label>バンド名</label>
          <input
            className="text-input"
            value={bandName}
            onChange={(e) => setBandName(e.target.value)}
          />
        </div>
        <div className="form-row">
          <label>日付</label>
          <input
            type="date"
            className="text-input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="form-row">
          <label>時間帯</label>
          <TimeRangeInput value={time} onChange={setTime} />
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
          <button className="btn-outline" style={{ flex: 1 }} onClick={onClose}>キャンセル</button>
          <button className="btn-primary" style={{ flex: 1 }} onClick={save} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
