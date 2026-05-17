import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminFetch } from '../auth'

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
    .filter((u) =>
      !search || u.displayName.toLowerCase().includes(search.toLowerCase())
    )

  const counts = {
    all: users.length,
    banned: users.filter((u) => u.banned).length,
    admin: users.filter((u) => u.isAdmin).length,
  }

  return (
    <div>
      <h1 className="admin-page-title">ユーザー管理</h1>

      <div className="admin-tabs">
        <button className={`admin-tab ${tab === 'all'    ? 'active' : ''}`} onClick={() => setTab('all')}>
          全員 <span className="admin-tab-count">{counts.all}</span>
        </button>
        <button className={`admin-tab ${tab === 'banned' ? 'active' : ''}`} onClick={() => setTab('banned')}>
          BAN者 <span className="admin-tab-count">{counts.banned}</span>
        </button>
        <button className={`admin-tab ${tab === 'admin'  ? 'active' : ''}`} onClick={() => setTab('admin')}>
          管理者 <span className="admin-tab-count">{counts.admin}</span>
        </button>
      </div>

      <div className="admin-card">
        <input
          type="text"
          className="text-input"
          placeholder="名前で検索"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && <div className="banner error">{error}</div>}

      {loading ? (
        <div className="splash" style={{ height: 'auto', padding: '3rem 0' }}>
          <div className="spinner" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <span className="icon icon-xl" style={{ color: 'var(--text-pale)' }}>group_off</span>
          <span className="empty-text">該当するユーザーがいません</span>
        </div>
      ) : (
        <div className="admin-card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>ユーザー</th>
                <th>最終予約</th>
                <th>状態</th>
                <th style={{ width: '80px' }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.userId}>
                  <td data-label="ユーザー">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {u.pictureUrl
                        ? <img src={u.pictureUrl} alt="" className="user-avatar" />
                        : <span className="user-avatar-fallback"><span className="icon">account_circle</span></span>}
                      <span>{u.displayName || '(名前なし)'}</span>
                    </div>
                  </td>
                  <td data-label="最終予約" style={{ fontSize: '0.85rem', color: 'var(--text-sub)' }}>
                    {u.lastReservedAt
                      ? new Date(u.lastReservedAt).toLocaleDateString('ja-JP')
                      : '-'}
                  </td>
                  <td data-label="状態">
                    {u.isAdmin
                      ? <span className="badge" style={{ background: '#e8f0fe', color: '#1a73e8' }}>
                          <span className="icon icon-sm">shield_person</span>管理者
                        </span>
                      : u.banned
                        ? <span className="badge" style={{ background: 'var(--red-light)', color: 'var(--red)' }}>
                            <span className="icon icon-sm">block</span>BAN中
                          </span>
                        : <span className="badge confirmed">
                            <span className="icon icon-sm">check_circle</span>有効
                          </span>}
                  </td>
                  <td className="cell-actions">
                    <button className="btn-outline" style={{ width: 'auto', padding: '0.35rem 0.6rem', fontSize: '0.8rem' }}
                      onClick={() => setSelected(u.userId)}>
                      詳細
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <UserDetail
          userId={selected}
          onClose={() => setSelected(null)}
          onUpdated={() => { load() }}
        />
      )}
    </div>
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
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '560px' }}>
        {!data ? (
          <div className="splash" style={{ height: 'auto', padding: '2rem 0' }}>
            <div className="spinner" />
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              {data.user.pictureUrl
                ? <img src={data.user.pictureUrl} alt="" className="user-avatar" style={{ width: '48px', height: '48px' }} />
                : <span className="user-avatar-fallback" style={{ width: '48px', height: '48px' }}>
                    <span className="icon icon-lg">account_circle</span>
                  </span>}
              <div>
                <div style={{ fontWeight: 700 }}>{data.user.displayName || '(名前なし)'}</div>
              </div>
            </div>

            {data.user.isAdmin ? (
              <div className="banner" style={{ background: '#e8f0fe', color: '#1a73e8', borderColor: '#1a73e8', marginBottom: '1rem' }}>
                <span className="icon icon-sm" style={{ verticalAlign: 'middle' }}>shield_person</span>
                {' '}このユーザーは管理者です（BAN できません）
              </div>
            ) : (
              <button
                className={data.user.banned ? 'btn-outline' : 'btn-danger'}
                style={{ width: '100%', padding: '0.6rem', marginBottom: '1rem' }}
                onClick={toggleBan}
                disabled={working}
              >
                <span className="icon icon-sm">{data.user.banned ? 'lock_open' : 'block'}</span>
                {data.user.banned ? 'BAN を解除' : 'BAN する'}
              </button>
            )}

            <h3 style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>予約履歴 ({data.reservations.length}件)</h3>
            {data.reservations.length === 0 ? (
              <p style={{ color: 'var(--text-pale)', fontSize: '0.9rem' }}>履歴なし</p>
            ) : (
              <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                {data.reservations.map((r) => (
                  <button
                    key={r.id}
                    className="reservation-card reservation-card-clickable"
                    onClick={() => jumpToReservation(r.id)}
                    title="予約管理で開く"
                  >
                    <div className={`accent ${r.status}`} />
                    <div className="card-body">
                      <div className="card-band">{r.bandName}</div>
                      <div className="card-date">{r.date}</div>
                      <span className={`badge ${r.status}`}>
                        <span className="icon icon-sm">
                          {r.status === 'confirmed' ? 'check_circle' : 'hourglass_empty'}
                        </span>
                        {r.status === 'confirmed' ? `確定 (${r.order ?? '-'})` : '抽選待ち'}
                      </span>
                    </div>
                    <span className="icon icon-sm" style={{ color: 'var(--text-pale)' }}>arrow_forward</span>
                  </button>
                ))}
              </div>
            )}

            <button className="btn-outline" style={{ marginTop: '1rem' }} onClick={onClose}>閉じる</button>
          </>
        )}
      </div>
    </div>
  )
}
