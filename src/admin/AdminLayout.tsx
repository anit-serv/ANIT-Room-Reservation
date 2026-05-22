import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { getAdminToken, clearAdminToken, adminFetch } from './auth'
import Skeleton from '../components/Skeleton'

type AdminMe = { userId: string; displayName: string }

const SIDEBAR_CLS = 'w-60 bg-surface border-r border-line p-3 pt-5 flex flex-col sticky top-0 h-dvh max-md:w-full max-md:h-auto max-md:static max-md:border-r-0 max-md:border-b max-md:p-3'
const MAIN_CLS    = 'flex-1 px-10 py-8 bg-bg overflow-x-auto max-md:px-5 max-md:py-5'

const LINK_BASE    = 'flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[0.9rem] font-medium transition-colors no-underline max-md:flex-shrink-0 '
const LINK_ACTIVE  = 'bg-brand-light text-brand-dark font-semibold'
const LINK_IDLE    = 'text-ink-sub hover:bg-bg hover:text-ink'
const SUBLINK_BASE = 'flex items-center gap-2 pl-8 pr-3 py-2 rounded-lg text-[0.85rem] font-medium transition-colors no-underline '

export default function AdminLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [me, setMe] = useState<AdminMe | null>(null)

  const reservationsOpen = location.pathname.startsWith('/admin/reservations')
  const settingsOpen     = location.pathname.startsWith('/admin/settings')

  useEffect(() => {
    const token = getAdminToken()
    if (!token) { navigate('/admin/login', { replace: true }); return }
    adminFetch('/api/admin/auth/me')
      .then(async (r) => {
        if (!r.ok) { clearAdminToken(); navigate('/admin/login', { replace: true }); return }
        setMe(await r.json())
      })
      .catch(() => { clearAdminToken(); navigate('/admin/login', { replace: true }) })
  }, [navigate])

  function handleLogout() {
    clearAdminToken()
    navigate('/admin/login', { replace: true })
  }

  if (!me) return (
    <div className="flex min-h-dvh max-md:flex-col">
      <aside className={SIDEBAR_CLS}>
        <Skeleton width="60%" height="20px" className="mx-3 mt-2 mb-4" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
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

          <NavLink to="/admin" end
            className={({ isActive }) => LINK_BASE + (isActive ? LINK_ACTIVE : LINK_IDLE)}>
            <span className="icon">dashboard</span>
            <span>ダッシュボード</span>
          </NavLink>

          {/* 予約管理 アコーディオン */}
          <div>
            <div className={LINK_BASE + (reservationsOpen ? LINK_ACTIVE : LINK_IDLE) + ' cursor-default select-none'}>
              <span className="icon">event_note</span>
              <span>予約管理</span>
            </div>
            <div className="flex flex-col gap-0.5 mt-0.5">
              <NavLink to="/admin/reservations/nobu"
                className={({ isActive }) => SUBLINK_BASE + (isActive ? LINK_ACTIVE : LINK_IDLE)}>
                農部
              </NavLink>
              <NavLink to="/admin/reservations/kobu"
                className={({ isActive }) => SUBLINK_BASE + (isActive ? LINK_ACTIVE : LINK_IDLE)}>
                工部室
              </NavLink>
            </div>
          </div>

          {/* 設定 アコーディオン */}
          <div>
            <div className={LINK_BASE + (settingsOpen ? LINK_ACTIVE : LINK_IDLE) + ' cursor-default select-none'}>
              <span className="icon">settings</span>
              <span>設定</span>
            </div>
            <div className="flex flex-col gap-0.5 mt-0.5">
              <NavLink to="/admin/settings/nobu"
                className={({ isActive }) => SUBLINK_BASE + (isActive ? LINK_ACTIVE : LINK_IDLE)}>
                農部
              </NavLink>
              <NavLink to="/admin/settings/kobu"
                className={({ isActive }) => SUBLINK_BASE + (isActive ? LINK_ACTIVE : LINK_IDLE)}>
                工部室
              </NavLink>
            </div>
          </div>

          <NavLink to="/admin/users"
            className={({ isActive }) => LINK_BASE + (isActive ? LINK_ACTIVE : LINK_IDLE)}>
            <span className="icon">group</span>
            <span>ユーザー</span>
          </NavLink>

          <NavLink to="/admin/admins"
            className={({ isActive }) => LINK_BASE + (isActive ? LINK_ACTIVE : LINK_IDLE)}>
            <span className="icon">shield_person</span>
            <span>管理者</span>
          </NavLink>

          <NavLink to="/admin/logs"
            className={({ isActive }) => LINK_BASE + (isActive ? LINK_ACTIVE : LINK_IDLE)}>
            <span className="icon">history</span>
            <span>監査ログ</span>
          </NavLink>

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
