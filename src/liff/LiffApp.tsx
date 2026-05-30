import { useState, useEffect } from 'react'
import liff from '@line/liff'
import ReservationForm from './pages/ReservationForm'
import AllReservations from './pages/AllReservations'
import KobuSchedule from './pages/KobuSchedule'
import NobuRoomSchedule from './pages/NobuRoomSchedule'
import MyReservations from './pages/MyReservations'
import Skeleton from '../components/Skeleton'

type SubView = 'register' | 'all'
type MainTab = 'nobu' | 'nobu-room' | 'kobu' | 'my'

export type LiffProfile = {
  userId: string
  displayName: string
  pictureUrl?: string
  getAccessToken: () => string
}

const MAIN_TABS: { id: MainTab; icon: string; label: string }[] = [
  { id: 'nobu',     icon: 'grass',        label: '農部生協' },
  { id: 'nobu-room', icon: 'door_sliding', label: '農部室' },
  { id: 'kobu',     icon: 'door_open',    label: '工部室' },
  { id: 'my',       icon: 'event_note',   label: '自分の予約' },
]

function NobuSubNav({ active, onChange }: { active: SubView; onChange: (v: SubView) => void }) {
  return (
    <div className="flex gap-2 mb-4">
      {(['register', 'all'] as SubView[]).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={
            'flex-1 py-2 rounded-lg text-[0.85rem] font-medium border transition ' +
            (active === v
              ? 'bg-brand text-white border-brand'
              : 'bg-surface text-ink-sub border-line hover:border-brand')
          }
        >
          {v === 'register' ? '予約登録' : '全体確認'}
        </button>
      ))}
    </div>
  )
}

type EditTarget = { facility: 'kobu' | 'nobu' | 'nobu-room'; id: string }
type KobuEditTarget = { id: string; date: string; bandName: string; startTime: string; endTime: string }
type NobuFocusTarget = { id: string; date: string }
type PendingNav = { tab?: MainTab; nobuSub?: SubView }

function App() {
  const [mainTab,            setMainTab]            = useState<MainTab>('nobu')
  const [nobuSub,            setNobuSub]            = useState<SubView>('register')
  const [profile,            setProfile]            = useState<LiffProfile | null>(null)
  const [error,              setError]              = useState<string | null>(null)
  const [editTarget,         setEditTarget]         = useState<EditTarget | null>(null)
  const [kobuEditTarget,     setKobuEditTarget]     = useState<KobuEditTarget | null>(null)
  const [nobuRoomEditTarget, setNobuRoomEditTarget] = useState<KobuEditTarget | null>(null)
  const [nobuFocusTarget,    setNobuFocusTarget]    = useState<NobuFocusTarget | null>(null)
  const [kobuFocusTarget,    setKobuFocusTarget]    = useState<KobuEditTarget | null>(null)
  const [nobuRoomFocusTarget,setNobuRoomFocusTarget]= useState<KobuEditTarget | null>(null)
  const [bookingActive,      setBookingActive]      = useState(false)
  const [pendingNav,         setPendingNav]         = useState<PendingNav | null>(null)

  function handleTabClick(id: MainTab) {
    if (id === mainTab) return
    if (bookingActive) { setPendingNav({ tab: id }); return }
    setMainTab(id)
  }

  function handleNobuSubChange(v: SubView) {
    if (v === nobuSub) return
    if (bookingActive && nobuSub === 'register') { setPendingNav({ nobuSub: v }); return }
    setNobuSub(v)
  }

  function confirmNavigation() {
    setBookingActive(false)
    if (pendingNav?.tab      !== undefined) setMainTab(pendingNav.tab)
    if (pendingNav?.nobuSub  !== undefined) setNobuSub(pendingNav.nobuSub)
    setPendingNav(null)
  }

  function handleEditRequest(facility: 'kobu' | 'nobu' | 'nobu-room', id: string) {
    setEditTarget({ facility, id })
    setMainTab('my')
  }

  function handleKobuEdit(target: KobuEditTarget) {
    setKobuEditTarget(target)
    setMainTab('kobu')
  }

  function handleNobuRoomEdit(target: KobuEditTarget) {
    setNobuRoomEditTarget(target)
    setMainTab('nobu-room')
  }

  function handleReservationOpen(target: { facility: 'kobu' | 'nobu' | 'nobu-room'; id: string; date: string; bandName: string; startTime?: string; endTime?: string }) {
    if (target.facility === 'nobu') {
      setNobuFocusTarget({ id: target.id, date: target.date.split('T')[0] })
      setNobuSub('all')
      setMainTab('nobu')
      return
    }
    const roomTarget = {
      id: target.id,
      date: target.date,
      bandName: target.bandName,
      startTime: target.startTime ?? '00:00',
      endTime: target.endTime ?? target.startTime ?? '00:00',
    }
    if (target.facility === 'kobu') {
      setKobuFocusTarget(roomTarget)
      setMainTab('kobu')
    } else {
      setNobuRoomFocusTarget(roomTarget)
      setMainTab('nobu-room')
    }
  }

  useEffect(() => {
    const liffId = import.meta.env.VITE_LIFF_ID as string | undefined
    if (!liffId) { setError('LINE アプリ内からアクセスしてください'); return }
    liff
      .init({ liffId })
      .then(async () => {
        if (!liff.isLoggedIn()) { liff.login(); return }
        const lineProfile = await liff.getProfile()
        const accessToken = liff.getAccessToken()
        if (!accessToken) throw new Error('アクセストークンの取得に失敗しました')
        setProfile({
          userId:         lineProfile.userId,
          displayName:    lineProfile.displayName,
          pictureUrl:     lineProfile.pictureUrl,
          getAccessToken: () => liff.getAccessToken() ?? '',
        })
        fetch('/api/reservations/sync', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
        }).catch(() => {})
      })
      .catch((err: Error) => setError(err.message))
  }, [])

  if (error) return (
    <div className="flex items-center justify-center min-h-dvh p-6 text-danger text-center text-sm">
      <div>
        <span className="icon icon-xl">error</span>
        <br />{error}
      </div>
    </div>
  )

  if (!profile) return (
    <div className="liff-shell">
      <nav className="flex bg-surface border-b border-line sticky top-0 z-10">
        {MAIN_TABS.map((_, i) => (
          <div key={i} className="flex-1 px-1 py-2.5 flex flex-col items-center gap-1">
            <Skeleton width="22px" height="22px" />
            <Skeleton width="48px" height="10px" />
          </div>
        ))}
      </nav>
      <main className="flex-1 p-4 overflow-y-auto">
        <Skeleton width="100px" height="20px" className="mb-4" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-surface border border-line rounded-xl p-4 mb-3 shadow-[var(--shadow-card-sm)]">
            <Skeleton width="40%" height="14px" className="mb-2" />
            <Skeleton width="100%" height="44px" />
          </div>
        ))}
      </main>
    </div>
  )

  return (
    <div className="liff-shell">
      <nav className="relative flex bg-surface border-b border-line sticky top-0 z-10">
        {/* スライドするアクティブインジケーター */}
        <div
          className="absolute bottom-0 h-[2.5px] bg-brand transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
          style={{
            width: `${100 / MAIN_TABS.length}%`,
            transform: `translateX(${MAIN_TABS.findIndex((t) => t.id === mainTab) * 100}%)`,
          }}
        />
        {MAIN_TABS.map(({ id, icon, label }) => (
          <button
            key={id}
            onClick={() => handleTabClick(id)}
            className={
              'flex-1 flex flex-col items-center gap-0.5 px-1 py-2.5 text-[0.7rem] transition-colors duration-200 ' +
              (mainTab === id ? 'text-brand font-semibold' : 'text-ink-pale')
            }
          >
            <span className="icon" style={{ fontSize: 22 }}>{icon}</span>
            {label}
          </button>
        ))}
      </nav>

      <main className="flex-1 min-h-0 p-4 overflow-y-auto flex flex-col">
        {mainTab === 'nobu' && (
          <>
            <NobuSubNav active={nobuSub} onChange={handleNobuSubChange} />
            {nobuSub === 'register' && <ReservationForm profile={profile} onBookingActive={setBookingActive} />}
            {nobuSub === 'all'      && (
              <AllReservations
                profile={profile}
                initialFocus={nobuFocusTarget}
                onFocusHandled={() => setNobuFocusTarget(null)}
                onEditRequest={(id) => handleEditRequest('nobu', id)}
              />
            )}
          </>
        )}
        {mainTab === 'nobu-room' && (
          <NobuRoomSchedule
            profile={profile}
            initialEdit={nobuRoomEditTarget}
            initialFocus={nobuRoomFocusTarget}
            onEditHandled={() => setNobuRoomEditTarget(null)}
            onFocusHandled={() => setNobuRoomFocusTarget(null)}
            onBookingActive={setBookingActive}
          />
        )}
        {mainTab === 'kobu' && (
          <KobuSchedule
            profile={profile}
            initialEdit={kobuEditTarget}
            initialFocus={kobuFocusTarget}
            onEditHandled={() => setKobuEditTarget(null)}
            onFocusHandled={() => setKobuFocusTarget(null)}
            onBookingActive={setBookingActive}
          />
        )}
        {mainTab === 'my' && (
          <MyReservations
            profile={profile}
            initialEdit={editTarget}
            onEditHandled={() => setEditTarget(null)}
            onKobuEdit={handleKobuEdit}
            onNobuRoomEdit={handleNobuRoomEdit}
            onReservationOpen={handleReservationOpen}
          />
        )}
      </main>

      {pendingNav && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setPendingNav(null)} />
          <div className="relative bg-surface rounded-2xl shadow-[var(--shadow-modal)] w-full max-w-[320px] p-6">
            <p className="text-base font-bold text-ink mb-1.5">ページを移動しますか？</p>
            <p className="text-[0.85rem] text-ink-sub mb-4">入力中の内容が失われます。</p>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setPendingNav(null)}>キャンセル</button>
              <button className="btn-danger flex-1" onClick={confirmNavigation}>OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
