import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { getAdminToken, clearAdminToken, adminFetch } from './auth'
import Skeleton from '../components/Skeleton'

type AdminMe = { userId: string; displayName: string; pictureUrl: string | null }
type DropdownData = { for: 'reservations' | 'settings'; top: number; left: number; width: number }

const SIDEBAR_CLS = 'w-60 bg-surface border-r border-line p-3 pt-5 flex flex-col sticky top-0 h-dvh max-md:w-full max-md:h-auto max-md:static max-md:border-r-0 max-md:border-b max-md:p-3 max-md:relative'
const MAIN_CLS    = 'flex-1 px-10 py-8 bg-bg overflow-x-auto max-md:px-5 max-md:py-5'

const LINK_BASE    = 'flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[0.9rem] font-medium transition-colors no-underline max-md:flex-shrink-0 '
const LINK_ACTIVE  = 'bg-brand-light text-brand-dark font-semibold'
const LINK_IDLE    = 'text-ink-sub hover:bg-bg hover:text-ink'
const SUBLINK_BASE = 'flex items-center gap-2 pl-8 pr-3 py-2 rounded-lg text-[0.85rem] font-medium transition-colors no-underline '
const SUBLINK_MOB  = 'flex items-center gap-2 px-3 py-2 rounded-lg text-[0.85rem] font-medium transition-colors no-underline flex-shrink-0 '

export default function AdminLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [me, setMe] = useState<AdminMe | null>(null)

  const reservationsOpen = location.pathname.startsWith('/admin/reservations')
  const settingsOpen     = location.pathname.startsWith('/admin/settings')

  const [reservationsExpanded, setReservationsExpanded] = useState(reservationsOpen)
  const [settingsExpanded,     setSettingsExpanded]     = useState(settingsOpen)

  useEffect(() => {
    if (reservationsOpen) setReservationsExpanded(true)
    if (settingsOpen)     setSettingsExpanded(true)
  }, [reservationsOpen, settingsOpen])

  const asideRef         = useRef<HTMLElement>(null)
  const navRef           = useRef<HTMLElement>(null)
  const dropdownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingDropdown  = useRef<DropdownData | null>(null)
  const previousLocation = useRef<{ pathname: string; search: string } | null>(null)
  const [mobileDropdown, setMobileDropdown] = useState<DropdownData | null>(null)
  const [dropdownClosing, setDropdownClosing] = useState(false)

  // 閉じてから次を開く（next=null なら閉じるだけ）
  function switchDropdown(next: DropdownData | null) {
    if (dropdownTimerRef.current) clearTimeout(dropdownTimerRef.current)
    pendingDropdown.current = next
    setDropdownClosing(true)
    dropdownTimerRef.current = setTimeout(() => {
      const n = pendingDropdown.current
      pendingDropdown.current = null
      setDropdownClosing(false)
      setMobileDropdown(n)
    }, 150)
  }

  function closeDropdown() { switchDropdown(null) }

  // nav横スクロール時はアニメーションなしで即閉じ（ずれた位置にアニメーションが残らないように）
  function dismissDropdown() {
    if (dropdownTimerRef.current) clearTimeout(dropdownTimerRef.current)
    pendingDropdown.current = null
    setDropdownClosing(false)
    setMobileDropdown(null)
  }

  // ボタンクリック時の開閉ロジック
  function handleMobileButtonClick(id: DropdownData['for'], e: React.MouseEvent<HTMLButtonElement>) {
    const br = e.currentTarget.getBoundingClientRect()
    const ar = asideRef.current!.getBoundingClientRect()
    const data: DropdownData = {
      for:   id,
      top:   ar.bottom - 1,
      left:  br.left,
      width: br.width,
    }

    if (mobileDropdown?.for === id && !dropdownClosing) {
      switchDropdown(null)          // 同じボタン → 閉じる
    } else if (mobileDropdown && !dropdownClosing) {
      switchDropdown(data)          // 別ボタンが開いている → 閉じてから開く
    } else {
      if (dropdownTimerRef.current) clearTimeout(dropdownTimerRef.current)
      setDropdownClosing(false)
      setMobileDropdown(data)       // 何も開いていない → すぐ開く
    }
  }

  useEffect(() => {
    const previous = previousLocation.current
    previousLocation.current = { pathname: location.pathname, search: location.search }

    const params = new URLSearchParams(location.search)
    const previousParams = new URLSearchParams(previous?.search ?? '')
    const hasReservationFocus = params.has('focus') || params.has('dateFocus')
    const hadReservationFocus = previousParams.has('focus') || previousParams.has('dateFocus')

    if (hasReservationFocus || hadReservationFocus) return
    if (!previous || previous.pathname !== location.pathname) {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    }
  }, [location.pathname, location.search])

  useEffect(() => {
    setDropdownClosing(false)
    if (dropdownTimerRef.current) clearTimeout(dropdownTimerRef.current)
    pendingDropdown.current = null
    setMobileDropdown(null)

    // モバイルのみ：遷移後にアクティブ項目が見えるようスクロール
    if (window.innerWidth < 768 && navRef.current) {
      const nav = navRef.current
      let target: Element | null = null
      if (location.pathname.startsWith('/admin/reservations')) {
        target = nav.querySelector('[data-navid="reservations"]')
      } else if (location.pathname.startsWith('/admin/settings')) {
        target = nav.querySelector('[data-navid="settings"]')
      } else {
        target = nav.querySelector('[aria-current="page"]')
      }
      target?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    }
  }, [location.pathname])

  // リロード時: me がセットされてナビが描画された直後にアクティブ項目へスクロール
  useEffect(() => {
    if (!me || !navRef.current || window.innerWidth >= 768) return
    const nav = navRef.current
    let target: Element | null = null
    if (location.pathname.startsWith('/admin/reservations')) {
      target = nav.querySelector('[data-navid="reservations"]')
    } else if (location.pathname.startsWith('/admin/settings')) {
      target = nav.querySelector('[data-navid="settings"]')
    } else {
      target = nav.querySelector('[aria-current="page"]')
    }
    target?.scrollIntoView({ behavior: 'instant', inline: 'center', block: 'nearest' })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me])

  useEffect(() => {
    if (!mobileDropdown) return
    function onPointerDown(e: PointerEvent) {
      if (asideRef.current?.contains(e.target as Node)) return
      closeDropdown()
    }
    function onScroll() { closeDropdown() }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('scroll', onScroll, { capture: true })
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('scroll', onScroll, { capture: true })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileDropdown])

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
      <aside ref={asideRef} className={SIDEBAR_CLS}>
        <div className="text-base font-bold px-3 pb-4 pt-2 text-ink max-md:hidden">部屋予約 管理</div>

        {/* ナビ行：デスクトップ＝縦、モバイル＝横スクロール */}
        <nav ref={navRef} onScroll={mobileDropdown ? dismissDropdown : undefined} className="flex flex-col gap-1 flex-1 max-md:flex-row max-md:overflow-x-auto no-scrollbar">

          <NavLink to="/admin" end
            className={({ isActive }) => LINK_BASE + (isActive ? LINK_ACTIVE : LINK_IDLE)}>
            <span className="icon">dashboard</span>
            <span>ダッシュボード</span>
          </NavLink>

          {/* 予約管理 アコーディオン */}
          <div className="max-md:flex-shrink-0">
            <button
              data-navid="reservations"
              onClick={(e) => {
                if (window.innerWidth < 768) {
                  handleMobileButtonClick('reservations', e)
                } else {
                  setReservationsExpanded(v => !v); setSettingsExpanded(false)
                }
              }}
              className={LINK_BASE + (reservationsOpen ? LINK_ACTIVE : LINK_IDLE) + ' w-full justify-between'}
            >
              <span className="flex items-center gap-2.5">
                <span className="icon">event_note</span>
                <span>予約管理</span>
              </span>
              <span className={`icon transition-transform duration-200 ${reservationsExpanded ? 'md:rotate-180' : ''} ${mobileDropdown?.for === 'reservations' ? 'max-md:rotate-180' : ''}`}
                style={{ fontSize: 16 }}>expand_more</span>
            </button>
            {/* デスクトップのみ：インライン展開 */}
            <div className={`grid transition-all duration-200 ease-out max-md:hidden ${reservationsExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
              <div className="overflow-hidden min-h-0">
                <div className="flex flex-col gap-0.5 mt-0.5">
                  <NavLink to="/admin/reservations/nobu"
                    className={({ isActive }) => SUBLINK_BASE + (isActive ? LINK_ACTIVE : LINK_IDLE)}>
                    農部生協
                  </NavLink>
                  <NavLink to="/admin/reservations/nobu-room"
                    className={({ isActive }) => SUBLINK_BASE + (isActive ? LINK_ACTIVE : LINK_IDLE)}>
                    農部室
                  </NavLink>
                  <NavLink to="/admin/reservations/kobu"
                    className={({ isActive }) => SUBLINK_BASE + (isActive ? LINK_ACTIVE : LINK_IDLE)}>
                    工部室
                  </NavLink>
                </div>
              </div>
            </div>
          </div>

          {/* 設定 アコーディオン */}
          <div className="max-md:flex-shrink-0">
            <button
              data-navid="settings"
              onClick={(e) => {
                if (window.innerWidth < 768) {
                  handleMobileButtonClick('settings', e)
                } else {
                  setSettingsExpanded(v => !v); setReservationsExpanded(false)
                }
              }}
              className={LINK_BASE + (settingsOpen ? LINK_ACTIVE : LINK_IDLE) + ' w-full justify-between'}
            >
              <span className="flex items-center gap-2.5">
                <span className="icon">settings</span>
                <span>設定</span>
              </span>
              <span className={`icon transition-transform duration-200 ${settingsExpanded ? 'md:rotate-180' : ''} ${mobileDropdown?.for === 'settings' ? 'max-md:rotate-180' : ''}`}
                style={{ fontSize: 16 }}>expand_more</span>
            </button>
            {/* デスクトップのみ：インライン展開 */}
            <div className={`grid transition-all duration-200 ease-out max-md:hidden ${settingsExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
              <div className="overflow-hidden min-h-0">
                <div className="flex flex-col gap-0.5 mt-0.5">
                  <NavLink to="/admin/settings/nobu"
                    className={({ isActive }) => SUBLINK_BASE + (isActive ? LINK_ACTIVE : LINK_IDLE)}>
                    農部生協
                  </NavLink>
                  <NavLink to="/admin/settings/nobu-emergency"
                    className={({ isActive }) => SUBLINK_BASE + (isActive ? LINK_ACTIVE : LINK_IDLE)}>
                    緊急対応
                  </NavLink>
                  <NavLink to="/admin/settings/nobu-room"
                    className={({ isActive }) => SUBLINK_BASE + (isActive ? LINK_ACTIVE : LINK_IDLE)}>
                    農部室
                  </NavLink>
                  <NavLink to="/admin/settings/kobu"
                    className={({ isActive }) => SUBLINK_BASE + (isActive ? LINK_ACTIVE : LINK_IDLE)}>
                    工部室
                  </NavLink>
                </div>
              </div>
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
          {me.pictureUrl
            ? <img src={me.pictureUrl} alt="" className="w-5 h-5 rounded-full object-cover shrink-0" />
            : <span className="icon">account_circle</span>}
          <span className="truncate">{me.displayName}</span>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border-0 bg-transparent text-ink-sub cursor-pointer text-[0.9rem] text-left hover:bg-bg hover:text-danger max-md:hidden"
        >
          <span className="icon">logout</span>ログアウト
        </button>

        {/* モバイル: ボタン直下ドロップダウン（aside 相対）
            外側div: clipTop ぶんだけ上をクリップ → nav バー内の枠線を非表示
            内側div: clip-path アニメーション（key でリマウント → 切り替え時も再生） */}
        {mobileDropdown && (
          <div
            className="fixed md:hidden z-[200]"
            style={{
              top:   mobileDropdown.top,
              left:  mobileDropdown.left,
              width: mobileDropdown.width,
            }}
          >
            <div
              key={mobileDropdown.for}
              className={`bg-surface border border-line border-t-0 overflow-hidden flex flex-col px-1 pb-1 ${dropdownClosing ? 'animate-dropdown-out' : 'animate-dropdown-in'}`}
            >
              {mobileDropdown.for === 'reservations' ? (<>
                <NavLink to="/admin/reservations/nobu"      onClick={closeDropdown} className={({ isActive }) => SUBLINK_MOB + (isActive ? LINK_ACTIVE : LINK_IDLE)}>農部生協</NavLink>
                <NavLink to="/admin/reservations/nobu-room" onClick={closeDropdown} className={({ isActive }) => SUBLINK_MOB + (isActive ? LINK_ACTIVE : LINK_IDLE)}>農部室</NavLink>
                <NavLink to="/admin/reservations/kobu"      onClick={closeDropdown} className={({ isActive }) => SUBLINK_MOB + (isActive ? LINK_ACTIVE : LINK_IDLE)}>工部室</NavLink>
              </>) : (<>
                <NavLink to="/admin/settings/nobu"          onClick={closeDropdown} className={({ isActive }) => SUBLINK_MOB + (isActive ? LINK_ACTIVE : LINK_IDLE)}>農部生協</NavLink>
                <NavLink to="/admin/settings/nobu-emergency" onClick={closeDropdown} className={({ isActive }) => SUBLINK_MOB + (isActive ? LINK_ACTIVE : LINK_IDLE)}>緊急対応</NavLink>
                <NavLink to="/admin/settings/nobu-room"     onClick={closeDropdown} className={({ isActive }) => SUBLINK_MOB + (isActive ? LINK_ACTIVE : LINK_IDLE)}>農部室</NavLink>
                <NavLink to="/admin/settings/kobu"          onClick={closeDropdown} className={({ isActive }) => SUBLINK_MOB + (isActive ? LINK_ACTIVE : LINK_IDLE)}>工部室</NavLink>
              </>)}
            </div>
          </div>
        )}
      </aside>
      <main className={MAIN_CLS}>
        <Outlet />
      </main>
    </div>
  )
}
