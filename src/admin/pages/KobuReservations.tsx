import { useEffect, useState, useCallback } from 'react'
import { adminFetch } from '../auth'
import Skeleton from '../../components/Skeleton'

type KobuReservation = {
  id: string
  userId: string
  userDisplayName: string
  userPictureUrl: string | null
  bandName: string
  date: string
  startTime: string
  endTime: string
  status: 'confirmed'
  createdAt: number | null
}

export default function KobuReservations() {
  const [reservations, setReservations] = useState<KobuReservation[]>([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)
  const [dateFilter, setDateFilter]     = useState('')
  const [search, setSearch]             = useState('')
  const [editing, setEditing]           = useState<KobuReservation | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (dateFilter) params.set('date', dateFilter)
      if (search)     params.set('q', search)
      const res = await adminFetch(`/api/admin/kobu-reservations?${params}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? '取得に失敗しました')
      }
      const data = await res.json()
      setReservations(data.reservations)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [dateFilter, search])

  useEffect(() => { load() }, [load])

  async function handleDelete(r: KobuReservation) {
    if (!confirm(`「${r.bandName}」(${r.date} ${r.startTime}〜${r.endTime}) を削除しますか？\nこの操作は取り消せません。`)) return
    const res = await adminFetch(`/api/admin/kobu-reservations/${r.id}`, { method: 'DELETE' })
    if (res.ok) {
      setReservations((prev) => prev.filter((x) => x.id !== r.id))
    } else {
      alert('削除に失敗しました')
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">予約管理 - 工部室</h1>

      <div className="admin-card">
        <div className="filter-row">
          <input type="date" className="text-input w-auto" value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)} />
          <input type="text" className="text-input flex-1" placeholder="バンド名で検索"
            value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="btn-outline w-auto px-3 py-2"
            onClick={() => { setDateFilter(''); setSearch('') }}>
            クリア
          </button>
        </div>
      </div>

      {error && <div className="banner-error">{error}</div>}

      {loading ? (
        <div className="bg-surface border border-line rounded-xl overflow-hidden shadow-[var(--shadow-card-sm)]">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex gap-4 px-4 py-3 border-b border-line items-center last:border-b-0">
              <Skeleton width="100px" height="38px" />
              <Skeleton width="120px" height="20px" />
              <div className="flex items-center gap-2 flex-1">
                <Skeleton width={24} height={24} circle />
                <Skeleton width="80px" height="14px" />
              </div>
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
                  <th>日付</th>
                  <th>時間帯</th>
                  <th>バンド名</th>
                  <th>登録者</th>
                  <th style={{ width: '100px' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {reservations.map((r) => (
                  <tr key={r.id}>
                    <td data-label="日付">{r.date}</td>
                    <td data-label="時間帯">
                      <span className="text-[0.85rem] font-mono">{r.startTime}〜{r.endTime}</span>
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
                    <td className="cell-actions">
                      <div className="flex gap-1.5">
                        <button className="btn-icon" onClick={() => setEditing(r)}>
                          <span className="icon">edit</span>
                        </button>
                        <button className="btn-icon" onClick={() => handleDelete(r)}>
                          <span className="icon">delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile */}
          <div className="md:hidden bg-surface border border-line rounded-xl overflow-hidden shadow-[var(--shadow-card-sm)]">
            {reservations.map((r) => (
              <KobuMobileCard key={r.id} r={r} onEdit={() => setEditing(r)} onDelete={() => handleDelete(r)} />
            ))}
          </div>
        </>
      )}

      {editing && (
        <KobuEditModal
          reservation={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
    </div>
  )
}

function KobuMobileCard({ r, onEdit, onDelete }: {
  r: KobuReservation; onEdit: () => void; onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-line last:border-b-0">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left bg-transparent border-0 cursor-pointer hover:bg-[#fafbfc] transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex-1 min-w-0">
          <div className="font-medium text-[0.9rem] truncate">{r.bandName}</div>
          <div className="text-[0.8rem] text-ink-sub mt-0.5">
            {r.date}　{r.startTime}〜{r.endTime}
          </div>
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
            <div className="flex gap-2 pt-3">
              <button className="btn-outline py-1.5 text-[0.85rem]" onClick={onEdit}>
                <span className="icon icon-sm">edit</span> 編集
              </button>
              <button className="btn-icon" onClick={onDelete}>
                <span className="icon">delete</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function KobuEditModal({ reservation, onClose, onSaved }: {
  reservation: KobuReservation; onClose: () => void; onSaved: () => void
}) {
  const [bandName,   setBandName]   = useState(reservation.bandName)
  const [date,       setDate]       = useState(reservation.date)
  const [startTime,  setStartTime]  = useState(reservation.startTime)
  const [endTime,    setEndTime]    = useState(reservation.endTime)
  const [saving,     setSaving]     = useState(false)
  const [err,        setErr]        = useState<string | null>(null)

  const timeOptions = buildTimeOptions('08:00', '20:00')

  async function save() {
    setSaving(true)
    setErr(null)
    try {
      const res = await adminFetch(`/api/admin/kobu-reservations/${reservation.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bandName, date, startTime, endTime }),
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
        <h2 className="text-base font-bold mb-3">工部室予約を編集</h2>
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
          <label>開始時刻</label>
          <select className="text-input" value={startTime} onChange={(e) => setStartTime(e.target.value)}>
            {timeOptions.slice(0, -1).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label>終了時刻</label>
          <select className="text-input" value={endTime} onChange={(e) => setEndTime(e.target.value)}>
            {timeOptions.slice(1).map((t) => (
              <option key={t} value={t} disabled={t <= startTime}>{t}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-2 mt-4">
          <button className="btn-outline flex-1" onClick={onClose}>キャンセル</button>
          <button className="btn-primary flex-1" onClick={save} disabled={saving || !bandName.trim() || startTime >= endTime}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

function buildTimeOptions(open: string, close: string): string[] {
  const options: string[] = []
  const [oh, om] = open.split(':').map(Number)
  const [ch, cm] = close.split(':').map(Number)
  let cur = oh * 60 + om
  const end = ch * 60 + cm
  while (cur <= end) {
    const h = String(Math.floor(cur / 60)).padStart(2, '0')
    const m = String(cur % 60).padStart(2, '0')
    options.push(`${h}:${m}`)
    cur += 15
  }
  return options
}
