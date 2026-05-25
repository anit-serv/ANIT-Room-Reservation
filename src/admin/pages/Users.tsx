import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminFetch } from '../auth'
import Skeleton from '../../components/Skeleton'

type User = {
  userId: string
  displayName: string
  pictureUrl: string | null
  banned: boolean
  isAdmin?: boolean
  lastReservedAt: number | null
}

type Reservation = {
  id: string
  bandName: string
  date: string
  status: 'pending' | 'confirmed'
  order?: number
}

export default function Users() {
  const [users, setUsers]     = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [search, setSearch]   = useState('')
  const [tab, setTab]         = useState<'all' | 'banned' | 'admin'>('all')
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const res = await adminFetch('/api/admin/users')
      if (!res.ok) throw new Error()
      setUsers((await res.json()).users)
    } catch {
      setError('ユーザー一覧の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const filtered = users
    .filter((u) => {
      if (tab === 'banned') return u.banned
      if (tab === 'admin')  return u.isAdmin
      return true
    })
    .filter((u) => !search || u.displayName.toLowerCase().includes(search.toLowerCase()))

  const counts = {
    all: users.length,
    banned: users.filter((u) => u.banned).length,
    admin: users.filter((u) => u.isAdmin).length,
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">ユーザー管理</h1>

      <div className="flex gap-1 mb-4 border-b border-line">
        <TabButton active={tab === 'all'}    onClick={() => setTab('all')}    label="全員"  count={counts.all} />
        <TabButton active={tab === 'banned'} onClick={() => setTab('banned')} label="BAN者" count={counts.banned} />
        <TabButton active={tab === 'admin'}  onClick={() => setTab('admin')}  label="管理者" count={counts.admin} />
      </div>

      <div className="admin-card">
        <input type="text" className="text-input" placeholder="名前で検索"
          value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {error && <div className="banner-error">{error}</div>}

      {loading ? (
        <div className="bg-surface border border-line rounded-xl overflow-hidden shadow-[var(--shadow-card-sm)]">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex gap-3 px-4 py-3 border-b border-line items-center last:border-b-0">
              <Skeleton width={32} height={32} circle />
              <Skeleton width="40%" height="16px" />
              <Skeleton width="80px" height="14px" className="ml-auto" />
              <Skeleton width="80px" height="22px" style={{ borderRadius: 20 }} />
              <Skeleton width="56px" height="28px" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <span className="icon icon-xl text-ink-pale">group_off</span>
          <span className="text-[0.9rem]">該当するユーザーがいません</span>
        </div>
      ) : (
        <>
        {/* Desktop */}
        <div className="hidden md:block bg-surface border border-line rounded-xl overflow-hidden shadow-[var(--shadow-card-sm)]">
          <table className="admin-table">
            <thead>
              <tr>
                <th></th>
                <th>最終予約</th>
                <th></th>
                <th style={{ width: '80px' }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.userId}>
                  <td data-label="ユーザー">
                    <div className="flex items-center gap-2">
                      {u.pictureUrl
                        ? <img src={u.pictureUrl} alt="" className="avatar" />
                        : <span className="avatar-fallback"><span className="icon">account_circle</span></span>}
                      <span>{u.displayName || '(名前なし)'}</span>
                    </div>
                  </td>
                  <td data-label="最終予約" className="text-[0.85rem] text-ink-sub">
                    {u.lastReservedAt ? new Date(u.lastReservedAt).toLocaleDateString('ja-JP') : '-'}
                  </td>
                  <td data-label="状態">
                    {u.isAdmin
                      ? <span className="badge badge-info"><span className="icon icon-sm">shield_person</span>管理者</span>
                      : u.banned
                        ? <span className="badge badge-danger"><span className="icon icon-sm">block</span>BAN中</span>
                        : <span className="badge badge-confirmed"><span className="icon icon-sm">check_circle</span>有効</span>}
                  </td>
                  <td className="cell-actions">
                    <button className="btn-outline w-auto px-2.5 py-1.5 text-[0.8rem]" onClick={() => setSelected(u.userId)}>
                      詳細
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile accordion */}
        <div className="md:hidden bg-surface border border-line rounded-xl overflow-hidden shadow-[var(--shadow-card-sm)]">
          {filtered.map((u) => (
            <UserMobileCard key={u.userId} u={u} onDetail={() => setSelected(u.userId)} />
          ))}
        </div>
        </>
      )}

      {selected && (
        <UserDetail userId={selected} onClose={() => setSelected(null)} onUpdated={() => load()} />
      )}
    </div>
  )
}

function UserMobileCard({ u, onDetail }: { u: User; onDetail: () => void }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="border-b border-line last:border-b-0">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left bg-transparent border-0 cursor-pointer hover:bg-[#fafbfc] transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {u.pictureUrl
            ? <img src={u.pictureUrl} alt="" className="avatar" />
            : <span className="avatar-fallback"><span className="icon">account_circle</span></span>}
          <span className="font-medium truncate">{u.displayName || '(名前なし)'}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {u.isAdmin
            ? <span className="badge badge-info"><span className="icon icon-sm">shield_person</span>管理者</span>
            : u.banned
              ? <span className="badge badge-danger"><span className="icon icon-sm">block</span>BAN中</span>
              : <span className="badge badge-confirmed"><span className="icon icon-sm">check_circle</span>有効</span>}
          <span className={`icon text-ink-pale transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
            expand_more
          </span>
        </div>
      </button>

      <div className={`grid transition-all duration-200 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden min-h-0">
          <div className="px-4 pb-3 border-t border-line bg-bg">
            <div className="flex items-center justify-between py-2">
              <span className="text-[0.72rem] text-ink-sub font-semibold uppercase tracking-wide">最終予約</span>
              <span className="text-[0.85rem] text-ink-sub">
                {u.lastReservedAt ? new Date(u.lastReservedAt).toLocaleDateString('ja-JP') : '-'}
              </span>
            </div>
            <div className="pt-2">
              <button className="btn-outline py-1.5 text-[0.85rem]" onClick={onDetail}>
                詳細を見る
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function TabButton({ active, onClick, label, count }:
  { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      className={
        'flex items-center gap-1.5 px-4 py-2.5 bg-transparent border-0 border-b-2 cursor-pointer text-[0.9rem] font-medium transition-colors ' +
        (active
          ? 'text-brand border-brand font-semibold'
          : 'text-ink-sub border-transparent hover:text-ink')
      }
    >
      {label}
      <span className={
        'text-[0.75rem] font-semibold px-1.5 py-0.5 rounded-full ' +
        (active ? 'bg-brand-light text-brand-dark' : 'bg-bg text-ink-sub')
      }>{count}</span>
    </button>
  )
}

function UserDetail({
  userId, onClose, onUpdated,
}: {
  userId: string
  onClose: () => void
  onUpdated: () => void
}) {
  const navigate = useNavigate()
  const [data, setData] = useState<{ user: User; reservations: Reservation[] } | null>(null)
  const [working, setWorking] = useState(false)

  function jumpToReservation(id: string) {
    onClose()
    navigate(`/admin/reservations?focus=${id}`)
  }

  useEffect(() => {
    adminFetch(`/api/admin/users/${userId}`)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then(setData)
      .catch(() => setData(null))
  }, [userId])

  async function toggleBan() {
    if (!data) return
    const next = !data.user.banned
    if (!confirm(next ? 'このユーザーをBANしますか？' : 'BANを解除しますか？')) return
    setWorking(true)
    try {
      const res = await adminFetch(`/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ banned: next }),
      })
      if (!res.ok) throw new Error()
      setData({ ...data, user: { ...data.user, banned: next } })
      onUpdated()
    } catch {
      alert('更新に失敗しました')
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card max-w-[560px]" onClick={(e) => e.stopPropagation()}>
        {!data ? (
          <div className="flex items-center justify-center py-8">
            <div className="spinner" />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-4">
              {data.user.pictureUrl
                ? <img src={data.user.pictureUrl} alt="" className="avatar avatar-lg" />
                : <span className="avatar-fallback avatar-lg"><span className="icon icon-lg">account_circle</span></span>}
              <div>
                <div className="font-bold">{data.user.displayName || '(名前なし)'}</div>
              </div>
            </div>

            {data.user.isAdmin ? (
              <div className="bg-link-light text-link border border-link rounded-xl px-4 py-3 mb-4 text-[0.9rem] font-medium">
                <span className="icon icon-sm align-middle">shield_person</span>
                {' '}このユーザーは管理者です（BAN できません）
              </div>
            ) : (
              <button
                className={data.user.banned ? 'btn-outline mb-4' : 'btn-danger mb-4 w-full py-2.5'}
                onClick={toggleBan}
                disabled={working}
              >
                <span className="icon icon-sm mr-1">{data.user.banned ? 'lock_open' : 'block'}</span>
                {data.user.banned ? 'BAN 解除' : 'BAN'}
              </button>
            )}

            <h3 className="text-[0.9rem] font-semibold mb-2">予約履歴 ({data.reservations.length}件)</h3>
            {data.reservations.length === 0 ? (
              <p className="text-ink-pale text-[0.9rem]">履歴なし</p>
            ) : (
              <div className="max-h-[300px] overflow-y-auto">
                {data.reservations.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => jumpToReservation(r.id)}
                    title="予約管理で開く"
                    className="reservation-card w-full cursor-pointer text-left hover:bg-bg hover:border-brand transition-colors"
                  >
                    <div className={'w-1 self-stretch rounded ' + (r.status === 'confirmed' ? 'bg-brand' : 'bg-warn')} />
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-ink truncate">{r.bandName}</div>
                      <div className="text-[0.82rem] text-ink-sub">{r.date}</div>
                      <span className={'badge ' + (r.status === 'confirmed' ? 'badge-confirmed' : 'badge-pending')}>
                        <span className="icon icon-sm">{r.status === 'confirmed' ? 'check_circle' : 'hourglass_empty'}</span>
                        {r.status === 'confirmed' ? `確定 (${r.order ?? '-'})` : '抽選待ち'}
                      </span>
                    </div>
                    <span className="icon icon-sm text-ink-pale">arrow_forward</span>
                  </button>
                ))}
              </div>
            )}

            <button className="btn-outline mt-4" onClick={onClose}>閉じる</button>
          </>
        )}
      </div>
    </div>
  )
}
