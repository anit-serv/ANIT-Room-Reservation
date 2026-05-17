import { useEffect, useState, useCallback } from 'react'
import { adminFetch } from '../auth'
import Skeleton from '../../components/Skeleton'

type Log = {
  id: string
  actorUserId: string
  actorDisplayName: string
  action: string
  targetType: string | null
  targetId: string | null
  targetLabel: string | null
  details: any
  createdAt: number | null
}

const ACTION_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  'user.ban':                { label: 'BAN',               icon: 'block',           color: 'var(--color-danger)' },
  'user.unban':              { label: 'BAN解除',           icon: 'lock_open',       color: 'var(--color-brand)' },
  'reservation.update':      { label: '予約編集',          icon: 'edit',            color: 'var(--color-warn)' },
  'reservation.delete':      { label: '予約削除',          icon: 'delete',          color: 'var(--color-danger)' },
  'settings.update':         { label: '設定変更(即時)',    icon: 'settings',        color: 'var(--color-brand)' },
  'settings.schedule':       { label: '設定変更(予定)',    icon: 'schedule',        color: 'var(--color-warn)' },
  'settings.scheduled.cancel': { label: '設定予定の取消', icon: 'cancel',          color: 'var(--color-ink-sub)' },
  'admin.add':               { label: '管理者追加',        icon: 'person_add',      color: 'var(--color-brand)' },
  'admin.remove':            { label: '管理者削除',        icon: 'person_remove',   color: 'var(--color-danger)' },
  'admin.super.transfer':    { label: 'スーパー管理者移譲', icon: 'star',           color: 'var(--color-super)' },
  'invitation.create':       { label: '招待発行',          icon: 'add_link',        color: 'var(--color-brand)' },
  'invitation.revoke':       { label: '招待取消',          icon: 'link_off',        color: 'var(--color-ink-sub)' },
  'preset.create':           { label: 'プリセット作成',    icon: 'bookmark_add',    color: 'var(--color-brand)' },
  'preset.delete':           { label: 'プリセット削除',    icon: 'bookmark_remove', color: 'var(--color-danger)' },
}

const ACTION_OPTIONS = Object.keys(ACTION_LABELS)

export default function Logs() {
  const [logs, setLogs]       = useState<Log[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [actionFilter, setActionFilter] = useState<string>('')
  const [hasMore, setHasMore] = useState(false)
  const [nextBefore, setNextBefore] = useState<number | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const load = useCallback(async (reset = true) => {
    if (reset) { setLoading(true); setLogs([]) } else { setLoadingMore(true) }
    setError(null)
    try {
      const params = new URLSearchParams()
      if (actionFilter) params.set('action', actionFilter)
      if (!reset && nextBefore) params.set('before', String(nextBefore))
      params.set('limit', '50')
      const res = await adminFetch(`/api/admin/logs?${params}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setLogs((prev) => reset ? data.logs : [...prev, ...data.logs])
      setHasMore(data.hasMore)
      setNextBefore(data.nextBefore)
    } catch {
      setError('ログの取得に失敗しました')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [actionFilter, nextBefore])

  useEffect(() => { load(true) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [actionFilter])

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">監査ログ</h1>

      <div className="admin-card">
        <div className="filter-row">
          <select className="text-input w-auto" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
            <option value="">全アクション</option>
            {ACTION_OPTIONS.map((a) => (
              <option key={a} value={a}>{ACTION_LABELS[a]?.label ?? a}</option>
            ))}
          </select>
          <span className="text-[0.85rem] text-ink-pale ml-auto">
            ※ログは1年間自動保持され、削除はできません
          </span>
        </div>
      </div>

      {error && <div className="banner-error">{error}</div>}

      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="grid grid-cols-[32px_1fr_auto] gap-3 items-start p-3 bg-surface border border-line rounded-lg shadow-[var(--shadow-card-sm)]">
              <Skeleton width={32} height={32} circle />
              <div className="flex-1">
                <Skeleton width="70%" height="14px" className="mb-1" />
                <Skeleton width="40%" height="12px" />
              </div>
              <Skeleton width="60px" height="12px" />
            </div>
          ))}
        </div>
      ) : logs.length === 0 ? (
        <div className="empty-state">
          <span className="icon icon-xl text-ink-pale">history</span>
          <span className="text-[0.9rem]">ログがありません</span>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {logs.map((log) => {
              const meta = ACTION_LABELS[log.action] ?? { label: log.action, icon: 'info', color: 'var(--color-ink-sub)' }
              return (
                <div key={log.id} className="grid grid-cols-[32px_1fr_auto] gap-3 items-start p-3 bg-surface border border-line rounded-lg shadow-[var(--shadow-card-sm)]">
                  <div className="flex items-center justify-center w-8 h-8" style={{ color: meta.color }}>
                    <span className="icon icon-md">{meta.icon}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[0.9rem] leading-relaxed">
                      <span className="font-semibold">{log.actorDisplayName}</span>
                      <span className="text-ink-sub"> が </span>
                      <span className="font-semibold" style={{ color: meta.color }}>{meta.label}</span>
                      {log.targetLabel && (<><span className="text-ink-sub">: </span><span>{log.targetLabel}</span></>)}
                    </div>
                    {log.details && (
                      <details className="mt-1 text-[0.8rem]">
                        <summary className="text-ink-pale cursor-pointer">詳細</summary>
                        <pre className="bg-bg p-2 rounded mt-1 text-[0.75rem] whitespace-pre-wrap overflow-x-auto">{JSON.stringify(log.details, null, 2)}</pre>
                      </details>
                    )}
                  </div>
                  <div className="text-[0.75rem] text-ink-pale whitespace-nowrap">
                    {log.createdAt ? new Date(log.createdAt).toLocaleString('ja-JP') : '-'}
                  </div>
                </div>
              )
            })}
          </div>

          {hasMore && (
            <div className="flex justify-center mt-4">
              <button className="btn-outline w-auto px-5 py-2" onClick={() => load(false)} disabled={loadingMore}>
                {loadingMore ? '読み込み中...' : 'さらに読み込む'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
