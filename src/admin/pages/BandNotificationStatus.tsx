import { useCallback, useEffect, useState } from 'react'
import { adminFetch } from '../auth'
import Skeleton from '../../components/Skeleton'

type NotificationRow = {
  date: string
  pollStatus: string | null
  notificationError: string | null
  notificationDirty: boolean
}
type SchedulerStatus = { enabled: boolean; pending: number; running: number; lastRecoveryAt: number | null;
  cronError: string | null; manual: { id: string; date: string; kind: string; error: string | null }[] }

export default function BandNotificationStatus() {
  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const [cleanupPending, setCleanupPending] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null)

  const load = useCallback(async () => {
    const response = await adminFetch('/api/room/notifications')
    if (!response.ok) throw new Error('BAND通知状況を取得できませんでした')
    const data = await response.json()
    setNotifications(data.results ?? [])
    setCleanupPending(data.cleanupPending ?? 0)
    setScheduler(data.scheduler ?? null)
  }, [])

  useEffect(() => {
    load().catch((err) => setError(err.message)).finally(() => setLoading(false))
  }, [load])

  async function manualPost(date: string) {
    if (!window.confirm(`${date}の抽選結果を投稿先BANDに新規投稿しますか？`)) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await adminFetch('/api/room/notifications/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? '通知に失敗しました')
      await load()
      setNotice(`${date}を通知しました`)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  async function retry(date: string, confirmResend = false) {
    if (confirmResend && !window.confirm(`${date}の投稿・コメントがBANDに存在しないことを確認しましたか？確認済みの場合だけ再送を許可してください。`)) return
    setBusy(true)
    setError('')
    try {
      const response = await adminFetch(`/api/room/notifications/${confirmResend ? 'confirm-resend' : 'retry'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, confirmedNotDelivered: confirmResend }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? '再確認を開始できませんでした')
      setNotice(confirmResend ? '未送信の確認を記録し、再送を予約しました。' : '送信結果の再確認を予約しました。送信結果不明の投稿は自動再送しません。')
      await load()
    } catch (err: any) { setError(err.message) } finally { setBusy(false) }
  }

  const needsAttention = notifications.filter((row) =>
    row.pollStatus === 'unnotified' || Boolean(row.notificationError) || row.notificationDirty)

  return <div>
    <h1 className="text-2xl font-bold mb-6">BAND通知状況</h1>
    {error && <div className="banner-error mb-4">{error}</div>}
    {notice && <div className="bg-brand-light text-brand-dark p-3 rounded-lg text-sm mb-4">{notice}</div>}
    {scheduler?.enabled && <section className="admin-card">
      <h2 className="font-bold mb-2">自動処理の状況</h2>
      <p className="text-sm">待機中 {scheduler.pending}件・実行中 {scheduler.running}件</p>
      <p className="text-sm text-ink-sub mt-2">最終復旧確認: {scheduler.lastRecoveryAt ? new Date(scheduler.lastRecoveryAt).toLocaleString('ja-JP') : '未確認'}</p>
      {scheduler.cronError && <p className="text-sm text-danger mt-2">{scheduler.cronError}</p>}
      {scheduler.manual.map((job) => <div className="border border-line rounded-lg p-3 mt-3 text-sm" key={job.id}>
        <strong>{job.date}：{({ lottery: '抽選', notify: '通知開始', band: '通知更新', cleanup: '旧通知の削除' } as Record<string, string>)[job.kind] ?? '自動処理'}の確認が必要です</strong>
        <p>{job.error}</p>
        {job.kind === 'band' && <button className="btn-outline mt-2" disabled={busy} onClick={() => retry(job.date)}>送信結果を再確認する</button>}
        {job.kind === 'band' && job.error?.includes('送信結果') && <button className="btn-outline mt-2" disabled={busy}
          onClick={() => retry(job.date, true)}>未送信を確認して再送を許可する</button>}
      </div>)}
    </section>}
    <section className="admin-card">
      <h2 className="font-bold mb-2">確認が必要な通知</h2>
      <p className="text-sm text-ink-sub mb-3">未通知・通知エラー・投稿やコメントの更新待ちを表示します。</p>
      {loading ? <NotificationStatusSkeleton /> : <>
        {cleanupPending > 0 && <p className="text-sm text-warn mb-3">古い投稿・コメントの削除待ち: {cleanupPending}件</p>}
        {needsAttention.length === 0 && cleanupPending === 0 && !error &&
          <p className="text-sm text-ink-sub">現在、確認が必要な通知はありません。</p>}
        <div className="space-y-2">{needsAttention.map((row) =>
          <NotificationStatusRow key={row.date} row={row} busy={busy} onManualPost={manualPost}
            onRetry={!scheduler?.enabled ? retry : undefined} />)}</div>
      </>}
    </section>
  </div>
}

function NotificationStatusSkeleton() {
  return (
    <div aria-label="通知状況を読み込み中" role="status" className="space-y-2">
      {[0, 1, 2].map((index) => <NotificationStatusRow key={index} loading index={index} />)}
    </div>
  )
}

function NotificationStatusRow({
  row,
  busy = false,
  loading = false,
  index = 0,
  onManualPost,
  onRetry,
}: {
  row?: NotificationRow
  busy?: boolean
  loading?: boolean
  index?: number
  onManualPost?: (date: string) => void
  onRetry?: (date: string, confirmResend?: boolean) => void
}) {
  if (loading) return (
    <div className="border border-line rounded-lg p-3 text-sm">
      <Skeleton width={index === 0 ? '58%' : index === 1 ? '72%' : '48%'} height="16px" className="mb-2" />
      {index !== 2 && <Skeleton width={index === 0 ? '90%' : '65%'} height="13px" className="mb-3" />}
      {index === 0 && <Skeleton width="206px" height="38px" style={{ borderRadius: 8 }} />}
    </div>
  )

  if (!row) return null
  const label = row.pollStatus === 'unnotified'
    ? '未通知'
    : row.notificationError ? '通知エラー' : '投稿・コメントの更新待ち'
  return (
    <div className="border border-line rounded-lg p-3 text-sm">
      <div className="font-semibold">{row.date} — {label}</div>
      {row.notificationError && <p className="text-warn mt-1">{row.notificationError}</p>}
      {row.notificationError && onRetry && <button className="btn-outline mt-2" disabled={busy}
        onClick={() => onRetry(row.date)}>送信結果を再確認する</button>}
      {row.notificationError?.includes('送信結果') && onRetry && <button className="btn-outline mt-2" disabled={busy}
        onClick={() => onRetry(row.date, true)}>未送信を確認して再送を許可する</button>}
      {row.pollStatus === 'unnotified' && <button className="btn-outline mt-2" disabled={busy}
        onClick={() => onManualPost?.(row.date)}>確認後、投稿先BANDに手動通知</button>}
    </div>
  )
}
