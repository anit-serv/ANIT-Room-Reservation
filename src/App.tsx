import { useState, useEffect } from 'react'
import liff from '@line/liff'
import ReservationForm from './pages/ReservationForm'
import MyReservations from './pages/MyReservations'
import AllReservations from './pages/AllReservations'

type Tab = 'register' | 'my' | 'all'

export type LiffProfile = {
  userId: string
  displayName: string
  idToken: string
}

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'register', icon: '✏️', label: '予約登録' },
  { id: 'my',       icon: '📋', label: '自分の予約' },
  { id: 'all',      icon: '👥', label: '全登録表示' },
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
        setProfile({ userId: lineProfile.userId, displayName: lineProfile.displayName, idToken })
      })
      .catch((err: Error) => setError(err.message))
  }, [])

  if (error) return <div className="error-splash">⚠️ 初期化エラー<br />{error}</div>
  if (!profile) return (
    <div className="splash">
      <div className="spinner" />
      <span>読み込み中...</span>
    </div>
  )

  return (
    <>
      <nav className="tab-bar">
        {TABS.map(({ id, icon, label }) => (
          <button
            key={id}
            className={activeTab === id ? 'active' : ''}
            onClick={() => setActiveTab(id)}
          >
            <span className="tab-icon">{icon}</span>
            {label}
          </button>
        ))}
      </nav>
      <main className="page">
        {activeTab === 'register' && <ReservationForm profile={profile} />}
        {activeTab === 'my'       && <MyReservations  profile={profile} />}
        {activeTab === 'all'      && <AllReservations />}
      </main>
    </>
  )
}

export default App
