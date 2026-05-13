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

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('register')
  const [profile, setProfile] = useState<LiffProfile | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    liff
      .init({ liffId: import.meta.env.VITE_LIFF_ID })
      .then(async () => {
        if (!liff.isLoggedIn()) {
          liff.login()
          return
        }
        const lineProfile = await liff.getProfile()
        const idToken = liff.getIDToken()
        if (!idToken) throw new Error('IDトークンの取得に失敗しました')
        setProfile({
          userId: lineProfile.userId,
          displayName: lineProfile.displayName,
          idToken,
        })
      })
      .catch((err: Error) => setError(err.message))
  }, [])

  if (error) return <div className="error">初期化エラー: {error}</div>
  if (!profile) return <div className="loading">読み込み中...</div>

  return (
    <>
      <nav className="tab-bar">
        <button
          className={activeTab === 'register' ? 'active' : ''}
          onClick={() => setActiveTab('register')}
        >
          予約登録
        </button>
        <button
          className={activeTab === 'my' ? 'active' : ''}
          onClick={() => setActiveTab('my')}
        >
          自分の予約
        </button>
        <button
          className={activeTab === 'all' ? 'active' : ''}
          onClick={() => setActiveTab('all')}
        >
          全登録表示
        </button>
      </nav>

      <main className="page">
        {activeTab === 'register' && <ReservationForm profile={profile} />}
        {activeTab === 'my' && <MyReservations profile={profile} />}
        {activeTab === 'all' && <AllReservations />}
      </main>
    </>
  )
}

export default App
