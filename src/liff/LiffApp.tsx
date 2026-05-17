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
    liff
      .init({ liffId: import.meta.env.VITE_LIFF_ID })
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
        // ユーザー情報を users コレクションに同期（失敗しても無視）
        fetch('/api/reservations/sync', {
          method: 'POST',
          headers: { Authorization: `Bearer ${idToken}` },
        }).catch(() => {})
      })
      .catch((err: Error) => setError(err.message))
  }, [])

  if (error) return <div className="error-splash"><span className="icon icon-xl">error</span><br />{error}</div>
  if (!profile) return (
    <div className="liff-shell">
      <nav className="tab-bar">
        {TABS.map((_, i) => (
          <div key={i} style={{ flex: 1, padding: '10px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            <Skeleton width="22px" height="22px" />
            <Skeleton width="48px" height="10px" />
          </div>
        ))}
      </nav>
      <main className="page">
        <Skeleton width="100px" height="20px" style={{ marginBottom: '1rem' }} />
        {[0, 1, 2].map((i) => (
          <div key={i} className="section">
            <Skeleton width="40%" height="14px" style={{ marginBottom: '0.5rem' }} />
            <Skeleton width="100%" height="44px" />
          </div>
        ))}
      </main>
    </div>
  )

  return (
    <div className="liff-shell">
      <nav className="tab-bar">
        {TABS.map(({ id, icon, label }) => (
          <button
            key={id}
            className={activeTab === id ? 'active' : ''}
            onClick={() => setActiveTab(id)}
          >
            <span className="icon tab-icon">{icon}</span>
            {label}
          </button>
        ))}
      </nav>
      <main className="page">
        {activeTab === 'register' && <ReservationForm profile={profile} />}
        {activeTab === 'my'       && <MyReservations  profile={profile} />}
        {activeTab === 'all'      && <AllReservations />}
      </main>
    </div>
  )
}

export default App
