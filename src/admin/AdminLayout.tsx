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

const SIDEBAR_CLS = 'w-60 bg-surface border-r border-line p-3 pt-5 flex flex-col sticky top-0 h-dvh max-md:w-full max-md:h-auto max-md:static max-md:border-r-0 max-md:border-b max-md:p-3'
const MAIN_CLS = 'flex-1 px-10 py-8 bg-bg overflow-x-auto max-md:px-5 max-md:py-5'

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
    <div className="flex min-h-dvh max-md:flex-col">
      <aside className={SIDEBAR_CLS}>
        <Skeleton width="60%" height="20px" className="mx-3 mt-2 mb-4" />
        {NAV.map((_, i) => (
          <Skeleton key={i} width="100%" height="40px" className="mb-1" />
        ))}
      </aside>
      <main className={MAIN_CLS}>
        <Skeleton width="200px" height="28px" className="mb-6" />
        <Skeleton width="100%" height="120px" className="mb-4" />
        <Skeleton width="100%" height="300px" />
      </main>
    </div>
  )

  return (
    <div className="flex min-h-dvh max-md:flex-col">
      <aside className={SIDEBAR_CLS}>
        <div className="text-base font-bold px-3 pb-4 pt-2 text-ink max-md:hidden">部屋予約 管理</div>
        <nav className="flex flex-col gap-1 flex-1 max-md:flex-row max-md:overflow-x-auto">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                'flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[0.9rem] font-medium transition-colors no-underline max-md:flex-shrink-0 ' +
                (isActive
                  ? 'bg-brand-light text-brand-dark font-semibold'
                  : 'text-ink-sub hover:bg-bg hover:text-ink')
              }
            >
              <span className="icon">{n.icon}</span>
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-2 px-3 py-2.5 text-[0.85rem] text-ink-sub border-t border-line mt-2 max-md:hidden">
          <span className="icon">account_circle</span>
          <span className="truncate">{me.displayName}</span>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border-0 bg-transparent text-ink-sub cursor-pointer text-[0.9rem] text-left hover:bg-bg hover:text-danger max-md:hidden"
        >
          <span className="icon">logout</span>ログアウト
        </button>
      </aside>
      <main className={MAIN_CLS}>
        <Outlet />
      </main>
    </div>
  )
}
