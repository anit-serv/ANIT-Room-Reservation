import { useEffect, useState } from 'react'
import { adminFetch } from '../auth'

type Version = { effectiveFrom: string; enabled: boolean }
type NotificationRow = { date: string; pollStatus: string | null; notificationSentAt: number | null;
  notificationError: string | null; notificationDirty: boolean }

export default function RoomPreferenceSettings({ effectiveFrom }: { effectiveFrom: string }) {
  const [versions, setVersions] = useState<Version[]>([])
  const [minDate, setMinDate] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [loaded, setLoaded] = useState(false)
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
    const nextVersions: Version[] = config.versions ?? []
    setVersions(nextVersions); setMinDate(config.minimumModeDate)
    if (!loaded) {
      const nextEnabled = nextVersions[0]?.enabled ?? false
      setEnabled(nextEnabled)
      setExpanded(nextEnabled)
      setLoaded(true)
    }
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

  return <div className="space-y-4 mb-6">
    {error && <div className="banner-error">{error}</div>}
    {notice && <div className="bg-brand-light text-brand-dark p-3 rounded-lg text-sm">{notice}</div>}
    <section className="admin-card">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-bold mb-1">希望部屋モード</h2>
          <p className="text-[0.85rem] text-ink-sub">指定した適用日から、予約時に希望部屋を選べるようにします。</p>
        </div>
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <span className="text-sm font-semibold">{enabled ? 'オン' : 'オフ'}</span>
          <input type="checkbox" role="switch" aria-label="希望部屋モード" checked={enabled} disabled={!loaded || busy}
            onChange={(event) => { setEnabled(event.target.checked); setExpanded(event.target.checked) }}
            className="sr-only peer" />
          <span aria-hidden="true" className="relative w-11 h-6 rounded-full bg-line peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand transition-colors after:absolute after:top-0.5 after:left-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5" />
        </label>
      </div>
      <p className="text-[0.82rem] text-ink-sub mt-3">画面下部の「適用日」で選んだ日から切り替えます。予約画面に出る前に確定するため、8日前までに設定してください。</p>
      <div className="flex flex-wrap gap-3 items-end mt-3">
        <span className="text-sm text-ink-sub">適用日: <strong className="text-ink">{effectiveFrom || '未選択'}</strong></span>
        <button className="btn-primary w-auto px-4" disabled={busy || !loaded || !effectiveFrom || effectiveFrom < minDate}
          onClick={() => save({ effectiveFrom, enabled })}>切替を予約</button>
      </div>
      {!!versions.length && <ul className="text-sm text-ink-sub mt-3 space-y-1">{versions.map((item) =>
        <li key={item.effectiveFrom}>{item.effectiveFrom}から {item.enabled ? 'オン' : 'オフ'}</li>)}</ul>}
      {enabled && <div className="mt-4 border-t border-line pt-3">
        <button type="button" className="flex w-full items-center justify-between text-sm font-semibold text-ink"
          aria-expanded={expanded} aria-controls="room-preference-details" onClick={() => setExpanded((value) => !value)}>
          希望部屋モードの詳細設定
          <span className={`icon transition-transform ${expanded ? 'rotate-180' : ''}`}>expand_more</span>
        </button>
        {expanded && <div id="room-preference-details" className="mt-4 space-y-4">
          <div className="rounded-lg border border-line p-4">
            <h3 className="font-bold mb-2">部屋取り権限者</h3>
            <p className="text-sm mb-3">現在: {manager ? `${manager.displayName} (${manager.userId})` : '未登録'}</p>
            <button className="btn-outline" disabled={busy} onClick={invite}>新しい権限者の招待リンクを作成</button>
            {inviteUrl && <input className="text-input mt-2" readOnly value={inviteUrl} onFocus={(event) => event.target.select()} />}
            <p className="text-sm text-ink-sub mt-4 mb-2">ログイン不能時は、登録済みユーザーIDを指定して再割当できます。</p>
            <div className="flex gap-2"><input className="text-input" placeholder="LINEユーザーID" value={targetUserId}
              onChange={(event) => setTargetUserId(event.target.value)} />
              <button className="btn-outline" disabled={busy || !targetUserId.trim()} onClick={assign}>再割当</button></div>
          </div>
        </div>}
      </div>}
    </section>
    <section className="admin-card">
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
    <section className="admin-card">
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
