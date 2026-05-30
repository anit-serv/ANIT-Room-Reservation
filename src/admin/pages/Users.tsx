import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminFetch } from '../auth'
import { getPageCache, setPageCache } from '../pageCache'
import Skeleton from '../../components/Skeleton'
import ConfirmDialog from '../../components/ConfirmDialog'

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
  facility: 'nobu' | 'kobu' | 'nobu-room'
  bandName: string
  date: string
  startTime?: string
  endTime?: string
  status: 'pending' | 'confirmed' | 'cancelled'
  order?: number
}

const FACILITY_CFG = {
  'nobu':      { label: '農部生協', icon: 'grass',        iconBg: 'bg-emerald-100', iconColor: 'text-emerald-600', labelColor: 'text-emerald-600' },
  'kobu':      { label: '工部室',   icon: 'door_open',    iconBg: 'bg-cyan-100',    iconColor: 'text-cyan-700',    labelColor: 'text-cyan-700'    },
  'nobu-room': { label: '農部室',   icon: 'door_sliding', iconBg: 'bg-teal-100',    iconColor: 'text-teal-600',    labelColor: 'text-teal-600'    },
} as const

const USERS_CACHE_KEY = 'users'

export default function Users() {
  const cachedUsers = getPageCache<User[]>(USERS_CACHE_KEY)
  const [users, setUsers]     = useState<User[]>(cachedUsers ?? [])
  const [loading, setLoading] = useState(!cachedUsers)
  const [error, setError]     = useState<string | null>(null)
  const [search, setSearch]   = useState('')
  const [tab, setTab]         = useState<'all' | 'banned' | 'admin'>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const tabBarRef = useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = useState({ left: 0, width: 0 })

  useEffect(() => { load() }, [])

  useEffect(() => {
    const bar = tabBarRef.current
    if (!bar) return
    const btn = bar.querySelector('[data-active="true"]') as HTMLElement | null
    if (btn) setIndicator({ left: btn.offsetLeft, width: btn.offsetWidth })
  }, [tab])

  async function load() {
    if (!getPageCache<User[]>(USERS_CACHE_KEY)) setLoading(true)
    try {
      const res = await adminFetch('/api/admin/users')
      if (!res.ok) throw new Error()
      const data = await res.json()
      setUsers(data.users)
      setPageCache<User[]>(USERS_CACHE_KEY, data.users)
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

      <div ref={tabBarRef} className="relative flex gap-1 mb-4 border-b border-line">
        <TabButton active={tab === 'all'}    onClick={() => setTab('all')}    label="全員"  count={counts.all} />
        <TabButton active={tab === 'banned'} onClick={() => setTab('banned')} label="BAN"   count={counts.banned} />
        <TabButton active={tab === 'admin'}  onClick={() => setTab('admin')}  label="管理者" count={counts.admin} />
        <span
          className="absolute bottom-0 h-0.5 bg-brand transition-[left,width] duration-200 ease-out"
          style={{ left: indicator.left, width: indicator.width }}
        />
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
                <th style={{ width: '32px' }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.userId} className="cursor-pointer" onClick={() => setSelected(u.userId)}>
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
                  <td>
                    <span className="icon text-ink-pale" style={{ fontSize: 18 }}>chevron_right</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile: タップでモーダルを開く */}
        <div className="md:hidden bg-surface border border-line rounded-xl overflow-hidden shadow-[var(--shadow-card-sm)]">
          {filtered.map((u) => (
            <UserMobileCard key={u.userId} u={u} onClick={() => setSelected(u.userId)} />
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

function UserMobileCard({ u, onClick }: { u: User; onClick: () => void }) {
  return (
    <button
      className="w-full flex items-center gap-3 px-4 py-3 text-left bg-transparent border-0 border-b border-line last:border-b-0 cursor-pointer hover:bg-[#fafbfc] transition-colors"
      onClick={onClick}
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
        <span className="icon text-ink-pale" style={{ fontSize: 18 }}>chevron_right</span>
      </div>
    </button>
  )
}

function TabButton({ active, onClick, label, count }:
  { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      data-active={active}
      onClick={onClick}
      className={
        'flex items-center gap-1.5 px-4 py-2.5 bg-transparent border-0 cursor-pointer text-[0.9rem] font-medium transition-colors ' +
        (active ? 'text-brand font-semibold' : 'text-ink-sub hover:text-ink')
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
  const [banConfirm, setBanConfirm] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  function jumpToReservation(r: Reservation) {
    onClose()
    const base = r.facility === 'kobu' ? '/admin/reservations/kobu'
      : r.facility === 'nobu-room'    ? '/admin/reservations/nobu-room'
      :                                 '/admin/reservations/nobu'
    const date = r.facility === 'nobu' ? r.date.split('T')[0] : r.date
    navigate(`${base}?focus=${encodeURIComponent(r.id)}&dateFocus=${encodeURIComponent(date)}`)
  }

  useEffect(() => {
    adminFetch(`/api/admin/users/${userId}`)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then(setData)
      .catch(() => setData(null))
  }, [userId])

  async function toggleBan() {
    setBanConfirm(true)
  }

  async function execToggleBan() {
    if (!data) return
    const next = !data.user.banned
    setWorking(true)
    try {
      const res = await adminFetch(`/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ banned: next }),
      })
      if (!res.ok) throw new Error()
      setData({ ...data, user: { ...data.user, banned: next } })
      setMessage({ type: 'success', text: next ? 'BANしました' : 'BANを解除しました' })
      setBanConfirm(false)
      onUpdated()
    } catch {
      throw new Error('更新に失敗しました')
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
              <div className="flex-1 min-w-0">
                <div className="font-bold">{data.user.displayName || '(名前なし)'}</div>
              </div>
              <button className="btn-icon-close shrink-0" onClick={onClose} aria-label="閉じる">
                <span className="icon">close</span>
              </button>
            </div>

            {data.user.isAdmin ? (
              <div className="bg-link-light text-link border border-link rounded-xl px-4 py-3 mb-4 text-[0.9rem] font-medium">
                <span className="icon icon-sm align-middle">shield_person</span>
                {' '}このユーザーは管理者です（BAN できません）
              </div>
            ) : (
              <button
                className={data.user.banned ? 'btn-outline mb-4' : 'btn-danger mb-4'}
                onClick={toggleBan}
                disabled={working}
              >
                <span className="icon icon-sm">{data.user.banned ? 'lock_open' : 'block'}</span>
                {data.user.banned ? 'BAN 解除' : 'BAN'}
              </button>
            )}

            {message && (
              <div className={message.type === 'success' ? 'banner-success' : 'banner-error'}>
                {message.text}
              </div>
            )}

            <h3 className="text-[0.9rem] font-semibold mb-2">予約履歴 ({data.reservations.length}件)</h3>
            {data.reservations.length === 0 ? (
              <p className="text-ink-pale text-[0.9rem]">履歴なし</p>
            ) : (
              <div className="max-h-[300px] overflow-y-auto">
                {data.reservations.map((r) => {
                  const fc = FACILITY_CFG[r.facility]
                  const timeStr = r.facility === 'nobu'
                    ? r.date.split('T')[1]
                    : r.startTime ? `${r.startTime}〜${r.endTime}` : ''
                  const dateStr = r.facility === 'nobu'
                    ? r.date.split('T')[0]
                    : r.date
                  const isConfirmed = r.status === 'confirmed'
                  const isCancelled = r.status === 'cancelled'
                  return (
                    <button
                      key={r.id}
                      onClick={() => jumpToReservation(r)}
                      title="予約管理で開く"
                      className="reservation-card w-full cursor-pointer text-left hover:bg-bg hover:border-brand transition-colors"
                    >
                      <div className="flex flex-col items-center gap-0.5 shrink-0">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${fc.iconBg}`}>
                          <span className={`icon ${fc.iconColor}`} style={{ fontSize: 18 }}>{fc.icon}</span>
                        </div>
                        <span className={`text-[0.55rem] font-semibold leading-none ${fc.labelColor}`}>{fc.label}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-0.5">
                          <span className="font-bold text-ink truncate">{r.bandName}</span>
                          <span className={'badge shrink-0 ' + (isCancelled ? 'badge-neutral' : isConfirmed ? 'badge-confirmed' : 'badge-pending')}>
                            <span className="icon icon-sm">{isCancelled ? 'cancel' : isConfirmed ? 'check_circle' : 'hourglass_empty'}</span>
                            {isCancelled ? 'キャンセル済み' : r.facility === 'nobu' ? (isConfirmed ? `確定 (${r.order ?? '-'})` : '抽選待ち') : '確定'}
                          </span>
                        </div>
                        <div className="text-[0.78rem] text-ink-sub">
                          {dateStr}{timeStr ? `　${timeStr}` : ''}
                        </div>
                      </div>
                      <span className="icon icon-sm text-ink-pale shrink-0">arrow_forward</span>
                    </button>
                  )
                })}
              </div>
            )}

          </>
        )}
      </div>

      {data && banConfirm && (
        <ConfirmDialog
          title={data.user.banned ? 'BANを解除しますか？' : 'このユーザーをBANしますか？'}
          message={data.user.banned ? 'このユーザーのBANを解除します。' : 'このユーザーをBANします。'}
          confirmLabel={data.user.banned ? '解除' : 'BAN'}
          onClose={() => setBanConfirm(false)}
          onConfirm={execToggleBan}
        />
      )}
    </div>
  )
}
