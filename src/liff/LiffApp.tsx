import { useState, useEffect } from 'react'
import liff from '@line/liff'
import ReservationForm from './pages/ReservationForm'
import MyReservations from './pages/MyReservations'
import AllReservations from './pages/AllReservations'
import Skeleton from '../components/Skeleton'

type Tab = 'register' | 'my' | 'all'

export type LiffProfile = {
  userId: string
  displayName: string
  pictureUrl?: string
  idToken: string
}

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'register', icon: 'edit_calendar', label: '予約登録' },
  { id: 'my',       icon: 'event_note',    label: '自分の予約' },
  { id: 'all',      icon: 'group',         label: '全登録表示' },
]

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('register')
  const [profile, setProfile] = useState<LiffProfile | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const liffId = import.meta.env.VITE_LIFF_ID as string | undefined
    if (!liffId) {
      setError('LINE アプリ内からアクセスしてください')
      return
    }
    liff
      .init({ liffId })
      .then(async () => {
        if (!liff.isLoggedIn()) { liff.login(); return }
        const lineProfile = await liff.getProfile()
        const idToken = liff.getIDToken()
        if (!idToken) throw new Error('IDトークンの取得に失敗しました')
        setProfile({
          userId: lineProfile.userId,
          displayName: lineProfile.displayName,
          pictureUrl: lineProfile.pictureUrl,
          idToken,
        })
        fetch('/api/reservations/sync', {
          method: 'POST',
          headers: { Authorization: `Bearer ${idToken}` },
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
        {TABS.map((_, i) => (
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
      <nav className="flex bg-surface border-b border-line sticky top-0 z-10">
        {TABS.map(({ id, icon, label }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={
              'flex-1 flex flex-col items-center gap-0.5 px-1 py-2.5 text-[0.7rem] border-b-2 transition-colors -webkit-tap-highlight-color-transparent ' +
              (activeTab === id
                ? 'text-brand border-brand font-semibold'
                : 'text-ink-pale border-transparent')
            }
          >
            <span className="icon" style={{ fontSize: 22 }}>{icon}</span>
            {label}
          </button>
        ))}
      </nav>
      <main className="flex-1 p-4 overflow-y-auto">
        {activeTab === 'register' && <ReservationForm profile={profile} />}
        {activeTab === 'my'       && <MyReservations  profile={profile} />}
        {activeTab === 'all'      && <AllReservations />}
      </main>
    </div>
  )
}

export default App
