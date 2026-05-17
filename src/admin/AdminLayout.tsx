import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { getAdminToken, clearAdminToken, adminFetch } from './auth'
import Skeleton from '../components/Skeleton'

const NAV = [
  { to: '/admin',              label: 'ダッシュボード', icon: 'dashboard',     end: true },
  { to: '/admin/reservations', label: '予約管理',       icon: 'event_note' },
  { to: '/admin/settings',     label: '設定',           icon: 'settings' },
  { to: '/admin/users',        label: 'ユーザー',       icon: 'group' },
  { to: '/admin/admins',       label: '管理者',         icon: 'shield_person' },
  { to: '/admin/logs',         label: '監査ログ',       icon: 'history' },
]

type AdminMe = { userId: string; displayName: string }

export default function AdminLayout() {
  const navigate = useNavigate()
  const [me, setMe] = useState<AdminMe | null>(null)

  useEffect(() => {
    const token = getAdminToken()
    if (!token) {
      navigate('/admin/login', { replace: true })
      return
    }
    adminFetch('/api/admin/auth/me')
      .then(async (r) => {
        if (!r.ok) {
          clearAdminToken()
          navigate('/admin/login', { replace: true })
          return
        }
        setMe(await r.json())
      })
      .catch(() => {
        clearAdminToken()
        navigate('/admin/login', { replace: true })
      })
  }, [navigate])

  function handleLogout() {
    clearAdminToken()
    navigate('/admin/login', { replace: true })
  }

  if (!me) return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Skeleton width="60%" height="20px" style={{ margin: '0.5rem 0.75rem 1rem' }} />
        {NAV.map((_, i) => (
          <Skeleton key={i} width="100%" height="40px" style={{ marginBottom: '0.25rem' }} />
        ))}
      </aside>
      <main className="admin-main">
        <Skeleton width="200px" height="28px" style={{ marginBottom: '1.5rem' }} />
        <Skeleton width="100%" height="120px" style={{ marginBottom: '1rem' }} />
        <Skeleton width="100%" height="300px" />
      </main>
    </div>
  )

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">部屋予約 管理</div>
        <nav>
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => 'admin-nav-item' + (isActive ? ' active' : '')}
            >
              <span className="icon">{n.icon}</span>
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="admin-user">
          <span className="icon">account_circle</span>
          <span className="admin-user-name">{me.displayName}</span>
        </div>
        <button className="admin-logout" onClick={handleLogout}>
          <span className="icon">logout</span>ログアウト
        </button>
      </aside>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  )
}
