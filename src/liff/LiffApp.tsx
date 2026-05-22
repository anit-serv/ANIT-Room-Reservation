import { useState, useEffect } from 'react'
import liff from '@line/liff'
import ReservationForm from './pages/ReservationForm'
import AllReservations from './pages/AllReservations'
import KobuReservationForm from './pages/KobuReservationForm'
import KobuAllReservations from './pages/KobuAllReservations'
import MyReservations from './pages/MyReservations'
import Skeleton from '../components/Skeleton'

type FacilityTab = 'nobu' | 'kobu'
type SubView     = 'register' | 'all'
type MainTab     = 'nobu' | 'kobu' | 'my'

export type LiffProfile = {
  userId: string
  displayName: string
  pictureUrl?: string
  idToken: string
}

const MAIN_TABS: { id: MainTab; icon: string; label: string }[] = [
  { id: 'nobu', icon: 'grass',       label: '農部' },
  { id: 'kobu', icon: 'meeting_room', label: '工部室' },
  { id: 'my',   icon: 'event_note',  label: '自分の予約' },
]

function FacilitySubNav({ active, onChange }: { active: SubView; onChange: (v: SubView) => void }) {
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

function App() {
  const [mainTab,    setMainTab]    = useState<MainTab>('nobu')
  const [nobuSub,    setNobuSub]    = useState<SubView>('register')
  const [kobuSub,    setKobuSub]    = useState<SubView>('register')
  const [profile,    setProfile]    = useState<LiffProfile | null>(null)
  const [error,      setError]      = useState<string | null>(null)

  useEffect(() => {
    const liffId = import.meta.env.VITE_LIFF_ID as string | undefined
    if (!liffId) { setError('LINE アプリ内からアクセスしてください'); return }
    liff
      .init({ liffId })
      .then(async () => {
        if (!liff.isLoggedIn()) { liff.login(); return }
        const lineProfile = await liff.getProfile()
        const idToken = liff.getIDToken()
        if (!idToken) throw new Error('IDトークンの取得に失敗しました')
        setProfile({
          userId:      lineProfile.userId,
          displayName: lineProfile.displayName,
          pictureUrl:  lineProfile.pictureUrl,
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
      <nav className="flex bg-surface border-b border-line sticky top-0 z-10">
        {MAIN_TABS.map(({ id, icon, label }) => (
          <button
            key={id}
            onClick={() => setMainTab(id)}
            className={
              'flex-1 flex flex-col items-center gap-0.5 px-1 py-2.5 text-[0.7rem] border-b-2 transition-colors ' +
              (mainTab === id
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
        {mainTab === 'nobu' && (
          <>
            <FacilitySubNav active={nobuSub} onChange={setNobuSub} />
            {nobuSub === 'register' && <ReservationForm profile={profile} />}
            {nobuSub === 'all'      && <AllReservations />}
          </>
        )}
        {mainTab === 'kobu' && (
          <>
            <FacilitySubNav active={kobuSub} onChange={setKobuSub} />
            {kobuSub === 'register' && <KobuReservationForm profile={profile} />}
            {kobuSub === 'all'      && <KobuAllReservations />}
          </>
        )}
        {mainTab === 'my' && <MyReservations profile={profile} />}
      </main>
    </div>
  )
}

export default App
