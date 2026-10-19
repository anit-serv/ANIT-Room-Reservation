import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { adminFetch, clearAdminToken, getAdminToken, setAdminToken } from '../admin/auth'

type Slot = { rooms: string[]; unavailable: string[]; ready: boolean }
type Day = { date: string; enabled: boolean; timeSlots: { label: string; value: string }[]; slots: Record<string, Slot> }
const todayJST = () => new Date(Date.now() + 9 * 60 * 60_000).toISOString().slice(0, 10)

export default function RoomApp() {
  const navigate = useNavigate()
  const location = useLocation()
  const isTransferPage = location.pathname === '/room/transfer'
  const [params] = useSearchParams()
  const [me, setMe] = useState<{ displayName: string } | null>(null)
  const [date, setDate] = useState(todayJST())
  const [day, setDay] = useState<Day | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [inviteUrl, setInviteUrl] = useState('')

  useEffect(() => {
    const code = params.get('code')
    if (code) {
      fetch(`/api/admin/auth/exchange?code=${encodeURIComponent(code)}`)
        .then(async (response) => { if (!response.ok) throw new Error('ログインに失敗しました'); return response.json() })
        .then((data) => { setAdminToken(data.token); navigate('/room', { replace: true }) })
        .catch((err) => setError(err.message))
      return
    }
    if (!getAdminToken()) return
    adminFetch('/api/room/me').then(async (response) => {
      if (!response.ok) throw new Error('部屋取り権限がありません')
      setMe(await response.json())
    }).catch((err) => setError(err.message))
  }, [navigate, params])

  async function loadDay(target = date) {
    setError('')
    const response = await adminFetch(`/api/room/day?date=${encodeURIComponent(target)}`)
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? '部屋を取得できませんでした')
    setDay(data)
    setDrafts(Object.fromEntries(data.timeSlots.map((slot: { value: string }) => [slot.value,
      (data.slots[slot.value]?.rooms ?? []).join('\n')])))
  }

  useEffect(() => { if (me && !isTransferPage) loadDay(date).catch((err) => setError(err.message)) }, [me, date, isTransferPage])

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

  async function createTransferInvite() {
    setError('')
    try {
      const response = await adminFetch('/api/room/transfer-invite', { method: 'POST' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? '招待を作成できませんでした')
      setInviteUrl(data.url)
    } catch (err: any) { setError(err.message) }
  }

  if (!me) return <div className="min-h-dvh bg-bg flex items-center justify-center p-4">
    <div className="bg-surface border border-line rounded-xl p-6 max-w-sm w-full">
      <h1 className="text-xl font-bold mb-3">部屋取り専用ページ</h1>
      {error && <div className="banner-error mb-3">{error}</div>}
      {params.get('error') && <div className="banner-error mb-3">権限または招待を確認してください</div>}
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
      {day && <>
        {!day.enabled && <p className="text-sm text-ink-sub mb-3">この日は希望部屋モードがオフです。部屋一覧の準備はできます。</p>}
        {day.timeSlots.map((slot) => {
          const saved = day.slots[slot.value]
          return <section key={slot.value} className="bg-surface border border-line rounded-xl p-4 mb-3">
            <div className="flex justify-between items-center mb-2"><h2 className="font-bold">{slot.label}</h2>
              <span className="text-sm">{saved?.ready ? '公開済み' : '未公開'}</span></div>
            <label className="block text-sm text-ink-sub mb-1">部屋名（1行に1室）</label>
            <textarea className="text-input min-h-28" value={drafts[slot.value] ?? ''}
              onChange={(event) => setDrafts((prev) => ({ ...prev, [slot.value]: event.target.value }))} />
            <div className="flex gap-2 mt-3">
              <button className="btn-outline" disabled={busy} onClick={() => saveSlot(slot.value, false)}>下書き保存</button>
              <button className="btn-primary" disabled={busy} onClick={() => saveSlot(slot.value, true)}>登録完了・公開</button>
            </div>
            {!!saved?.unavailable?.length && <p className="text-sm text-warn mt-3">利用不可: {saved.unavailable.join('、')}</p>}
            {saved?.ready && <div className="flex flex-wrap gap-2 mt-3">{saved.rooms.filter((room) => !saved.unavailable.includes(room)).map((room) =>
              <button key={room} className="text-sm border border-warn text-warn rounded px-2 py-1" disabled={busy}
                onClick={() => makeUnavailable(slot.value, room)}>{room}を利用不可にする</button>)}</div>}
          </section>
        })}
      </>}
      </> : <section className="bg-surface border border-line rounded-xl p-4">
        <h2 className="font-bold mb-2">部屋取り権限の移譲</h2>
        <p className="text-sm text-ink-sub mb-3">招待リンクを移譲先に渡してください。相手がLINEでログインすると、この権限だけが移ります。</p>
        <button className="btn-outline" onClick={createTransferInvite}>移譲リンクを作成</button>
        {inviteUrl && <input className="text-input mt-2" readOnly value={inviteUrl} onFocus={(event) => event.target.select()} />}
      </section>}
    </div>
  </main>
}
