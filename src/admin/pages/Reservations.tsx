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
  const rowRefs = useRef<Record<string, HTMLElement | null>>({})

  const [reservations, setReservations] = useState<Reservation[]>([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)
  const [dateFilter, setDateFilter]     = useState('')
  const [statusFilter, setStatusFilter] = useState<'' | 'pending' | 'confirmed'>('')
  const [search, setSearch]             = useState('')
  const [editing, setEditing]           = useState<Reservation | null>(null)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const [openId,        setOpenId]        = useState<string | null>(null)

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

  useEffect(() => {
    if (!focusId || reservations.length === 0) return
    const row = rowRefs.current[focusId]
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setHighlightedId(focusId)
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
      <h1 className="text-2xl font-bold mb-6">予約管理 - 農部生協</h1>

      <div className="admin-card">
        <div className="filter-row">
          <input type="date" className="text-input w-auto" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
          <select className="text-input w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
            <option value="">全ステータス</option>
            <option value="pending">抽選待ち</option>
            <option value="confirmed">抽選確定</option>
          </select>
          <input type="text" className="text-input flex-1" placeholder="バンド名で検索" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="btn-outline w-auto px-3 py-2"
            onClick={() => { setDateFilter(''); setStatusFilter(''); setSearch('') }}>
            クリア
          </button>
        </div>
      </div>

      {error && <div className="banner-error">{error}</div>}
      {loading ? (
        <div className="bg-surface border border-line rounded-xl overflow-hidden shadow-[var(--shadow-card-sm)]">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex gap-4 px-4 py-3 border-b border-line items-center last:border-b-0">
              <Skeleton width="80px" height="38px" />
              <Skeleton width="120px" height="20px" />
              <div className="flex items-center gap-2 flex-1">
                <Skeleton width={24} height={24} circle />
                <Skeleton width="80px" height="14px" />
              </div>
              <Skeleton width="80px" height="22px" style={{ borderRadius: 20 }} />
              <Skeleton width="24px" height="14px" />
              <Skeleton width="76px" height="32px" />
            </div>
          ))}
        </div>
      ) : reservations.length === 0 ? (
        <div className="empty-state">
          <span className="icon icon-xl text-ink-pale">event_busy</span>
          <span className="text-[0.9rem]">該当する予約がありません</span>
        </div>
      ) : (
        <>
        {/* Desktop */}
        <div className="hidden md:block bg-surface border border-line rounded-xl overflow-hidden shadow-[var(--shadow-card-sm)]">
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
                        <div className="text-[0.8rem] text-ink-sub">{timePart}</div>
                      </div>
                    </td>
                    <td data-label="バンド名">{r.bandName}</td>
                    <td data-label="登録者">
                      <div className="flex items-center gap-2">
                        {r.userPictureUrl
                          ? <img src={r.userPictureUrl} alt="" className="avatar avatar-sm" />
                          : <span className="avatar-fallback avatar-sm"><span className="icon icon-sm">account_circle</span></span>}
                        <span className="text-[0.85rem]">{r.userDisplayName || '(不明)'}</span>
                      </div>
                    </td>
                    <td data-label="ステータス">
                      <span className={'badge ' + (r.status === 'confirmed' ? 'badge-confirmed' : 'badge-pending')}>
                        <span className="icon icon-sm">
                          {r.status === 'confirmed' ? 'check_circle' : 'hourglass_empty'}
                        </span>
                        {r.status === 'confirmed' ? '確定' : '抽選待ち'}
                      </span>
                    </td>
                    <td data-label="順位">{r.order ?? '-'}</td>
                    <td className="cell-actions">
                      <div className="flex gap-1.5">
                        <button className="btn-icon" onClick={() => setEditing(r)}>
                          <span className="icon">edit</span>
                        </button>
                        <button className="btn-icon-danger" onClick={() => handleDelete(r)}>
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

        {/* Mobile accordion */}
        <div className="md:hidden bg-surface border border-line rounded-xl overflow-hidden shadow-[var(--shadow-card-sm)]">
          {reservations.map((r) => (
            <ReservationMobileCard
              key={r.id}
              r={r}
              highlighted={highlightedId === r.id}
              rowRef={(el) => { rowRefs.current[r.id] = el }}
              open={openId === r.id}
              onToggle={() => setOpenId(openId === r.id ? null : r.id)}
              onEdit={() => setEditing(r)}
              onDelete={() => handleDelete(r)}
            />
          ))}
        </div>
        </>
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

function ReservationMobileCard({
  r, highlighted, rowRef, open, onToggle, onEdit, onDelete,
}: {
  r: Reservation
  highlighted: boolean
  rowRef: (el: HTMLDivElement | null) => void
  open: boolean
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const [datePart, timePart] = r.date.split('T')

  return (
    <div
      ref={rowRef}
      className={`border-b border-line last:border-b-0 ${highlighted ? 'row-highlight' : ''}`}
    >
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left bg-transparent border-0 cursor-pointer hover:bg-[#fafbfc] transition-colors"
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-[0.9rem] truncate">{r.bandName}</span>
            <span className={'badge ' + (r.status === 'confirmed' ? 'badge-confirmed' : 'badge-pending')}>
              <span className="icon icon-sm">{r.status === 'confirmed' ? 'check_circle' : 'hourglass_empty'}</span>
              {r.status === 'confirmed' ? '確定' : '抽選待ち'}
            </span>
          </div>
          <div className="text-[0.8rem] text-ink-sub mt-0.5">{datePart}　{timePart}</div>
        </div>
        <span className={`icon text-ink-pale transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
          expand_more
        </span>
      </button>

      <div className={`grid transition-all duration-200 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden min-h-0">
          <div className="px-4 pb-3 border-t border-line bg-bg">
            <div className="flex items-center justify-between py-2 border-b border-line">
              <span className="text-[0.72rem] text-ink-sub font-semibold uppercase tracking-wide">登録者</span>
              <div className="flex items-center gap-2">
                {r.userPictureUrl
                  ? <img src={r.userPictureUrl} alt="" className="avatar avatar-sm" />
                  : <span className="avatar-fallback avatar-sm"><span className="icon icon-sm">account_circle</span></span>}
                <span className="text-[0.85rem]">{r.userDisplayName || '(不明)'}</span>
              </div>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-[0.72rem] text-ink-sub font-semibold uppercase tracking-wide">順位</span>
              <span className="text-[0.9rem]">{r.order ?? '-'}</span>
            </div>
            <div className="flex gap-2 pt-2">
              <button className="btn-outline py-1.5 text-[0.85rem]" onClick={onEdit}>
                <span className="icon icon-sm">edit</span> 編集
              </button>
              <button className="btn-icon-danger" onClick={onDelete}>
                <span className="icon">delete</span>
              </button>
            </div>
          </div>
        </div>
      </div>
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
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold m-0">予約を編集</h2>
          <button className="btn-icon-close" onClick={onClose} aria-label="閉じる">
            <span className="icon">close</span>
          </button>
        </div>
        {err && <div className="banner-error">{err}</div>}
        <div className="form-row">
          <label>バンド名</label>
          <input className="text-input" value={bandName} onChange={(e) => setBandName(e.target.value)} />
        </div>
        <div className="form-row">
          <label>日付</label>
          <input type="date" className="text-input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="form-row">
          <label>時間帯</label>
          <TimeRangeInput value={time} onChange={setTime} />
        </div>
        <div className="mt-4">
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
