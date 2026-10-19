import { useEffect, useState } from 'react'
import { adminFetch } from '../auth'

type Version = { effectiveFrom: string; enabled: boolean }
type NotificationRow = { date: string; pollStatus: string | null; notificationSentAt: number | null;
  notificationError: string | null; notificationDirty: boolean }

export default function RoomPreferenceSettings() {
  const [versions, setVersions] = useState<Version[]>([])
  const [minDate, setMinDate] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [mode, setMode] = useState<'post' | 'comment'>('post')
  const [fallback, setFallback] = useState(false)
  const [commentConfigured, setCommentConfigured] = useState(false)
  const [manager, setManager] = useState<{ userId: string; displayName: string } | null>(null)
  const [targetUserId, setTargetUserId] = useState('')
  const [inviteUrl, setInviteUrl] = useState('')
  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const [cleanupPending, setCleanupPending] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    const [configRes, managerRes, notificationsRes] = await Promise.all([
      adminFetch('/api/room/config'), adminFetch('/api/room/manager'), adminFetch('/api/room/notifications'),
    ])
    if (!configRes.ok) throw new Error('設定を取得できませんでした')
    const config = await configRes.json()
    setVersions(config.versions ?? []); setMinDate(config.minimumModeDate)
    setEffectiveFrom((prev) => prev || config.minimumModeDate)
    setMode(config.notificationMode); setFallback(config.fallbackPost)
    setCommentConfigured(config.commentBandConfigured)
    if (managerRes.ok) setManager((await managerRes.json()).manager)
    if (notificationsRes.ok) {
      const data = await notificationsRes.json()
      setNotifications(data.results ?? []); setCleanupPending(data.cleanupPending ?? 0)
    }
  }

  useEffect(() => { load().catch((err) => setError(err.message)) }, [])

  async function save(body: object) {
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await adminFetch('/api/room/config', { method: 'PUT',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? '保存に失敗しました')
      await load(); setNotice('設定を保存しました')
    } catch (err: any) { setError(err.message) }
    finally { setBusy(false) }
  }

  async function invite() {
    setBusy(true); setError('')
    try {
      const response = await adminFetch('/api/room/invite', { method: 'POST' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? '招待を作成できませんでした')
      setInviteUrl(data.url)
    } catch (err: any) { setError(err.message) }
    finally { setBusy(false) }
  }

  async function assign() {
    setBusy(true); setError('')
    try {
      const response = await adminFetch('/api/room/manager', { method: 'PUT',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: targetUserId.trim() }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? '再割当に失敗しました')
      setTargetUserId(''); await load(); setNotice('部屋取り権限を再割当しました')
    } catch (err: any) { setError(err.message) }
    finally { setBusy(false) }
  }

  async function manualPost(date: string) {
    if (!window.confirm(`${date}の抽選結果を投稿先BANDに新規投稿しますか？`)) return
    setBusy(true); setError('')
    try {
      const response = await adminFetch('/api/room/notifications/manual', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? '通知に失敗しました')
      await load(); setNotice(`${date}を通知しました`)
    } catch (err: any) { setError(err.message) }
    finally { setBusy(false) }
  }

  return <div className="max-w-3xl space-y-5">
    <h1 className="text-2xl font-bold">希望部屋モードとBAND通知</h1>
    {error && <div className="banner-error">{error}</div>}
    {notice && <div className="bg-brand-light text-brand-dark p-3 rounded-lg text-sm">{notice}</div>}
    <section className="bg-surface border border-line rounded-xl p-5">
      <h2 className="font-bold mb-3">希望部屋モードの切替</h2>
      <p className="text-sm text-ink-sub mb-3">予約画面に出る前に確定するため、適用日の8日前まで指定できます。</p>
      <div className="flex flex-wrap gap-3 items-end">
        <label className="text-sm">適用日<input type="date" className="text-input mt-1" min={minDate} value={effectiveFrom}
          onChange={(event) => setEffectiveFrom(event.target.value)} /></label>
        <label className="text-sm">モード<select className="text-input mt-1" value={enabled ? 'on' : 'off'}
          onChange={(event) => setEnabled(event.target.value === 'on')}><option value="on">オン</option><option value="off">オフ</option></select></label>
        <button className="btn-primary" disabled={busy || !effectiveFrom} onClick={() => save({ effectiveFrom, enabled })}>切替を予約</button>
      </div>
      {!!versions.length && <ul className="text-sm text-ink-sub mt-3 space-y-1">{versions.map((item) =>
        <li key={item.effectiveFrom}>{item.effectiveFrom}から {item.enabled ? 'オン' : 'オフ'}</li>)}</ul>}
    </section>
    <section className="bg-surface border border-line rounded-xl p-5">
      <h2 className="font-bold mb-3">BAND通知方式</h2>
      <label className="block text-sm mb-3">方式<select className="text-input mt-1" value={mode}
        onChange={(event) => setMode(event.target.value as 'post' | 'comment')}>
        <option value="post">投稿先BANDに新規投稿</option><option value="comment">コメント先BANDでメンション投稿にコメント</option>
      </select></label>
      {mode === 'comment' && <><p className="text-sm text-ink-sub mb-2">コメント先BAND: {commentConfigured ? '設定済み' : '未設定'}</p>
        <label className="flex items-center gap-2 text-sm mb-3"><input type="checkbox" checked={fallback}
          onChange={(event) => setFallback(event.target.checked)} />1時間以内に対象投稿がなければ投稿先BANDに自動投稿</label></>}
      <button className="btn-primary" disabled={busy || (mode === 'comment' && !commentConfigured)}
        onClick={() => save({ notificationMode: mode, fallbackPost: fallback })}>通知方式を保存</button>
    </section>
    <section className="bg-surface border border-line rounded-xl p-5">
      <h2 className="font-bold mb-2">部屋取り権限者</h2>
      <p className="text-sm mb-3">現在: {manager ? `${manager.displayName} (${manager.userId})` : '未登録'}</p>
      <button className="btn-outline" disabled={busy} onClick={invite}>新しい権限者の招待リンクを作成</button>
      {inviteUrl && <input className="text-input mt-2" readOnly value={inviteUrl} onFocus={(event) => event.target.select()} />}
      <p className="text-sm text-ink-sub mt-4 mb-2">ログイン不能時は、登録済みユーザーIDを指定して再割当できます。</p>
      <div className="flex gap-2"><input className="text-input" placeholder="LINEユーザーID" value={targetUserId}
        onChange={(event) => setTargetUserId(event.target.value)} />
        <button className="btn-outline" disabled={busy || !targetUserId.trim()} onClick={assign}>再割当</button></div>
    </section>
    <section className="bg-surface border border-line rounded-xl p-5">
      <h2 className="font-bold mb-2">通知状態</h2>
      {cleanupPending > 0 && <p className="text-sm text-warn mb-3">古い投稿・コメントの削除待ち: {cleanupPending}件</p>}
      <div className="space-y-2">{notifications.filter((row) => row.pollStatus === 'unnotified' || row.notificationError || row.notificationDirty).map((row) =>
        <div key={row.date} className="border border-line rounded-lg p-3 text-sm">
          <div className="font-semibold">{row.date} — {row.pollStatus ?? '投稿方式'}{row.notificationDirty ? ' / 更新待ち' : ''}</div>
          {row.notificationError && <p className="text-warn mt-1">{row.notificationError}</p>}
          {row.pollStatus === 'unnotified' && <button className="btn-outline mt-2" disabled={busy}
            onClick={() => manualPost(row.date)}>確認後、投稿先BANDに手動通知</button>}
        </div>)}</div>
    </section>
  </div>
}
