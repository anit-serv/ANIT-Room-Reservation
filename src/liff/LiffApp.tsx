import { useState, useEffect } from 'react'
import liff from '@line/liff'
import ReservationForm from './pages/ReservationForm'
import AllReservations from './pages/AllReservations'
import KobuSchedule from './pages/KobuSchedule'
import MyReservations from './pages/MyReservations'
import Skeleton from '../components/Skeleton'

type SubView = 'register' | 'all'
type MainTab = 'nobu' | 'kobu' | 'my'

export type LiffProfile = {
  userId: string
  displayName: string
  pictureUrl?: string
  getAccessToken: () => string
}

const MAIN_TABS: { id: MainTab; icon: string; label: string }[] = [
  { id: 'nobu', icon: 'grass',        label: '農部' },
  { id: 'kobu', icon: 'meeting_room', label: '工部室' },
  { id: 'my',   icon: 'event_note',   label: '自分の予約' },
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

type EditTarget = { facility: 'kobu' | 'nobu'; id: string }
type KobuEditTarget = { id: string; date: string; bandName: string; startTime: string; endTime: string }

function App() {
  const [mainTab,       setMainTab]       = useState<MainTab>('nobu')
  const [nobuSub,       setNobuSub]       = useState<SubView>('register')
  const [profile,       setProfile]       = useState<LiffProfile | null>(null)
  const [error,         setError]         = useState<string | null>(null)
  const [editTarget,    setEditTarget]    = useState<EditTarget | null>(null)
  const [kobuEditTarget, setKobuEditTarget] = useState<KobuEditTarget | null>(null)

  function handleEditRequest(facility: 'kobu' | 'nobu', id: string) {
    setEditTarget({ facility, id })
    setMainTab('my')
  }

  function handleKobuEdit(target: KobuEditTarget) {
    setKobuEditTarget(target)
    setMainTab('kobu')
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
            <NobuSubNav active={nobuSub} onChange={setNobuSub} />
            {nobuSub === 'register' && <ReservationForm profile={profile} />}
            {nobuSub === 'all'      && (
              <AllReservations
                profile={profile}
                onEditRequest={(id) => handleEditRequest('nobu', id)}
              />
            )}
          </>
        )}
        {mainTab === 'kobu' && (
          <KobuSchedule
            profile={profile}
            initialEdit={kobuEditTarget}
            onEditHandled={() => setKobuEditTarget(null)}
          />
        )}
        {mainTab === 'my' && (
          <MyReservations
            profile={profile}
            initialEdit={editTarget}
            onEditHandled={() => setEditTarget(null)}
            onKobuEdit={handleKobuEdit}
          />
        )}
      </main>
    </div>
  )
}

export default App
