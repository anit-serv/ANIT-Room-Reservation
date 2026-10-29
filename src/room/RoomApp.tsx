import { DATABASE_QUOTA_MESSAGE } from '../../lib/serviceErrors'
import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { adminFetch, clearAdminToken, getAdminToken, setAdminToken } from '../admin/auth'
import Skeleton from '../components/Skeleton'

type Slot = { rooms: string[]; unavailable: string[]; ready: boolean }
type Day = { date: string; enabled: boolean; timeSlots: { label: string; value: string }[]; slots: Record<string, Slot> }
const todayJST = () => new Date(Date.now() + 9 * 60 * 60_000).toISOString().slice(0, 10)

export default function RoomApp() {
  const navigate = useNavigate()
  const location = useLocation()
  const isTransferPage = location.pathname === '/room/transfer'
  const [params] = useSearchParams()
  const [me, setMe] = useState<{ userId: string; displayName: string; isAdmin: boolean } | null>(null)
  const [date, setDate] = useState(todayJST())
  const [day, setDay] = useState<Day | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [transferUsers, setTransferUsers] = useState<{ userId: string; displayName: string }[]>([])
  const [transferSearch, setTransferSearch] = useState('')
  const [transferTarget, setTransferTarget] = useState('')
  const [transferInviteUrl, setTransferInviteUrl] = useState('')
  const [authLoading, setAuthLoading] = useState(() => Boolean(getAdminToken()))
  const [dayLoading, setDayLoading] = useState(false)
  const [transferLoading, setTransferLoading] = useState(false)

  useEffect(() => {
    const code = params.get('code')
    if (code) {
      setAuthLoading(true)
      fetch(`/api/admin/auth/exchange?code=${encodeURIComponent(code)}`)
        .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error ?? 'ログインに失敗しました'); return data })
        .then((data) => { setAdminToken(data.token); navigate('/room', { replace: true }) })
        .catch((err) => setError(err.message))
        .finally(() => setAuthLoading(false))
      return
    }
    if (!getAdminToken()) { setAuthLoading(false); return }
    adminFetch('/api/room/me').then(async (response) => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? '部屋取り権限を確認できませんでした')
      setMe(data)
    }).catch((err) => setError(err.message)).finally(() => setAuthLoading(false))
  }, [navigate, params])

  async function loadDay(target = date) {
    setError('')
    setDayLoading(true)
    try {
      const response = await adminFetch(`/api/room/day?date=${encodeURIComponent(target)}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? '部屋を取得できませんでした')
      setDay(data)
      setDrafts(Object.fromEntries(data.timeSlots.map((slot: { value: string }) => [slot.value,
        (data.slots[slot.value]?.rooms ?? []).join('\n')])))
    } finally {
      setDayLoading(false)
    }
  }

  useEffect(() => { if (me && !isTransferPage) loadDay(date).catch((err) => setError(err.message)) }, [me, date, isTransferPage])
  useEffect(() => {
    if (!me || !isTransferPage) return
    setTransferLoading(true)
    adminFetch('/api/room/transfer-candidates')
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error ?? 'ユーザーを取得できませんでした')
        setTransferUsers(data.users ?? [])
      }).catch((err) => setError(err.message)).finally(() => setTransferLoading(false))
  }, [me, isTransferPage])

  async function saveSlot(timeSlot: string, ready: boolean) {
    setBusy(true); setError(''); setNotice('')
    try {
      const rooms = (drafts[timeSlot] ?? '').split(/[\n,、]/).map((item) => item.trim()).filter(Boolean)
      const response = await adminFetch('/api/room/day', { method: 'PUT',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, timeSlot, rooms, ready }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? '保存できませんでした')
      await loadDay()
      setNotice(ready ? '部屋を公開しました' : '下書きを保存しました')
    } catch (err: any) { setError(err.message) }
    finally { setBusy(false) }
  }

  async function makeUnavailable(timeSlot: string, room: string) {
    if (!window.confirm(`${room}を利用不可にしますか？抽選後なら割当が再計算されます。`)) return
    setBusy(true); setError('')
    try {
      const response = await adminFetch('/api/room/day/unavailable', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, timeSlot, room }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? '変更できませんでした')
      await loadDay()
      setNotice(`${room}を利用不可にしました`)
    } catch (err: any) { setError(err.message) }
    finally { setBusy(false) }
  }

  async function transferAuthority() {
    const target = transferUsers.find((user) => user.userId === transferTarget)
    if (!target || !window.confirm(`「${target.displayName || target.userId}」に部屋取り権限を移譲しますか？`)) return
    setBusy(true); setError('')
    try {
      const response = await adminFetch('/api/room/transfer', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: target.userId }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? '移譲できませんでした')
      if (!me?.isAdmin) {
        clearAdminToken()
        setMe(null)
      }
      setNotice('部屋取り権限を移譲しました')
      navigate(me?.isAdmin ? '/room' : '/room/login')
    } catch (err: any) { setError(err.message) }
    finally { setBusy(false) }
  }

  async function createTransferInvite() {
    setBusy(true); setError('')
    try {
      const response = await adminFetch('/api/room/transfer-invite', { method: 'POST' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? '移譲リンクを作成できませんでした')
      setTransferInviteUrl(data.url)
    } catch (err: any) { setError(err.message) }
    finally { setBusy(false) }
  }

  if (!me) return <div className="min-h-dvh bg-bg flex items-center justify-center p-4">
    <div className={`bg-surface border border-line rounded-xl p-6 max-w-sm w-full ${authLoading ? 'skeleton-layout' : ''}`} aria-busy={authLoading} ref={(el) => { if (el) el.inert = authLoading }}>
      <h1 className="text-xl font-bold mb-3">部屋取り専用ページ</h1>
      {error && <div className="banner-error mb-3">{error}</div>}
        {params.get('error') && <div className="banner-error mb-3">{params.get('error') === 'database_quota' ? DATABASE_QUOTA_MESSAGE : '権限または招待リンクを確認してください'}</div>}
      <button className="btn-primary" onClick={() => { window.location.href = '/api/admin/auth/start?role=room' }}>LINEでログイン</button>
    </div>
  </div>

  return <main className="min-h-dvh bg-bg p-4 md:p-8">
    <div className="max-w-2xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div><h1 className="text-xl font-bold">使用可能部屋の登録</h1><p className="text-sm text-ink-sub">{me.displayName}</p></div>
        <button className="btn-outline" onClick={() => { clearAdminToken(); setMe(null); setDay(null) }}>ログアウト</button>
      </header>
      <nav className="flex gap-2 mb-6" aria-label="部屋取りメニュー">
        <Link to="/room" className={isTransferPage ? 'btn-outline w-auto px-4' : 'btn-primary w-auto px-4'}>部屋の登録</Link>
        <Link to="/room/transfer" className={isTransferPage ? 'btn-primary w-auto px-4' : 'btn-outline w-auto px-4'}>権限の移譲</Link>
      </nav>
      {error && <div className="banner-error mb-3">{error}</div>}
      {notice && <div className="bg-brand-light text-brand-dark rounded-lg p-3 mb-3 text-sm">{notice}</div>}
      {!isTransferPage ? <>
      <label className="block text-sm font-semibold mb-2">活動日</label>
      <input type="date" value={date} min={todayJST()} onChange={(event) => setDate(event.target.value)} className="text-input mb-4" />
      {dayLoading && <RoomDaySkeleton />}
      {day && !dayLoading && <>
        {!day.enabled && <p className="text-sm text-ink-sub mb-3">この日は希望部屋モードがオフです。部屋一覧の準備はできます。</p>}
        {day.timeSlots.map((slot) => <RoomSlotCard
          key={slot.value}
          slot={slot}
          saved={day.slots[slot.value]}
          value={drafts[slot.value] ?? ''}
          busy={busy}
          onChange={(value) => setDrafts((prev) => ({ ...prev, [slot.value]: value }))}
          onSave={saveSlot}
          onMakeUnavailable={makeUnavailable}
        />)}
      </>}
      </> : <section className="bg-surface border border-line rounded-xl p-4">
        <h2 className="font-bold mb-2">部屋取り権限の移譲</h2>
        <p className="text-sm text-ink-sub mb-3">登録済みユーザーから移譲先を選択してください。</p>
        <div className={transferLoading ? 'skeleton-layout' : ''} aria-busy={transferLoading} ref={(el) => { if (el) el.inert = transferLoading }}>
        <input className="text-input" placeholder="ユーザー名で検索" value={transferSearch}
          onChange={(event) => { setTransferSearch(event.target.value); setTransferTarget('') }} />
        <select className="text-input mt-2" aria-label="部屋取り権限の移譲先" value={transferTarget}
          onChange={(event) => setTransferTarget(event.target.value)}>
          <option value="">移譲先を選択</option>
          {transferUsers.filter((user) => `${user.displayName} ${user.userId}`.toLowerCase().includes(transferSearch.toLowerCase()))
            .map((user) => <option key={user.userId} value={user.userId}>{user.displayName || '名前なし'} ({user.userId})</option>)}
        </select>
        <button className="btn-outline mt-2" disabled={busy || !transferTarget} onClick={transferAuthority}>選択したユーザーへ移譲</button>
        <button className="btn-outline mt-2 ml-2" disabled={busy} onClick={createTransferInvite}>移譲リンクを作成</button>
        <p className="text-[0.78rem] text-ink-sub mt-2">リンクは24時間有効で、最初の1人が利用すると無効になります。</p>
        {transferInviteUrl && <input className="text-input mt-2" readOnly aria-label="移譲リンク" value={transferInviteUrl}
          onFocus={(event) => event.target.select()} />}
        </div>
      </section>}
    </div>
  </main>
}

function RoomDaySkeleton() {
  return <div aria-label="部屋情報を読み込み中" role="status" className="space-y-3">
    {[0, 1, 2].map((index) => <RoomSlotCard key={index} loading />)}
  </div>
}

function RoomSlotCard({
  slot,
  saved,
  value = '',
  busy = false,
  loading = false,
  onChange,
  onSave,
  onMakeUnavailable,
}: {
  slot?: { label: string; value: string }
  saved?: Slot
  value?: string
  busy?: boolean
  loading?: boolean
  onChange?: (value: string) => void
  onSave?: (timeSlot: string, ready: boolean) => void
  onMakeUnavailable?: (timeSlot: string, room: string) => void
}) {
  return <section className={`bg-surface border border-line rounded-xl p-4 mb-3 ${loading ? 'skeleton-layout' : ''}`} aria-busy={loading} ref={(el) => { if (el) el.inert = loading }}>
    <div className="flex justify-between items-center mb-2">
      {loading ? <Skeleton width="108px" height="19px" /> : <h2 className="font-bold">{slot?.label}</h2>}
      {loading ? <Skeleton width="54px" height="14px" /> : <span className="text-sm">{saved?.ready ? '公開済み' : '未公開'}</span>}
    </div>
    <>
      <label className="block text-sm text-ink-sub mb-1">部屋名（1行に1室）</label>
      <textarea className="text-input min-h-28" value={value} onChange={(event) => onChange?.(event.target.value)} />
      <div className="flex gap-2 mt-3">
        <button className="btn-outline" disabled={busy} onClick={() => slot && onSave?.(slot.value, false)}>下書き保存</button>
        <button className="btn-primary" disabled={busy} onClick={() => slot && onSave?.(slot.value, true)}>登録完了・公開</button>
      </div>
      {!!saved?.unavailable?.length && <p className="text-sm text-warn mt-3">利用不可: {saved.unavailable.join('、')}</p>}
      {saved?.ready && <div className="flex flex-wrap gap-2 mt-3">{saved.rooms.filter((room) => !saved.unavailable.includes(room)).map((room) =>
        <button key={room} className="text-sm border border-warn text-warn rounded px-2 py-1" disabled={busy}
          onClick={() => slot && onMakeUnavailable?.(slot.value, room)}>{room}を利用不可にする</button>)}</div>}
    </>
  </section>
}
