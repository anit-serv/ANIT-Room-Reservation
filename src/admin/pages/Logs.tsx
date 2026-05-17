import { useEffect, useState, useCallback } from 'react'
import { adminFetch } from '../auth'

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
  'user.ban':                { label: 'BAN',               icon: 'block',          color: 'var(--red)' },
  'user.unban':              { label: 'BAN解除',           icon: 'lock_open',      color: 'var(--green)' },
  'reservation.update':      { label: '予約編集',          icon: 'edit',           color: 'var(--orange)' },
  'reservation.delete':      { label: '予約削除',          icon: 'delete',         color: 'var(--red)' },
  'settings.update':         { label: '設定変更(即時)',    icon: 'settings',       color: 'var(--green)' },
  'settings.schedule':       { label: '設定変更(予定)',    icon: 'schedule',       color: 'var(--orange)' },
  'settings.scheduled.cancel': { label: '設定予定の取消', icon: 'cancel',         color: 'var(--text-sub)' },
  'admin.add':               { label: '管理者追加',        icon: 'person_add',     color: 'var(--green)' },
  'admin.remove':            { label: '管理者削除',        icon: 'person_remove',  color: 'var(--red)' },
  'admin.super.transfer':    { label: 'スーパー管理者移譲', icon: 'star',           color: '#b86200' },
  'invitation.create':       { label: '招待発行',          icon: 'add_link',       color: 'var(--green)' },
  'invitation.revoke':       { label: '招待取消',          icon: 'link_off',       color: 'var(--text-sub)' },
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
      <h1 className="admin-page-title">監査ログ</h1>

      <div className="admin-card">
        <div className="filter-row">
          <select
            className="text-input"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            style={{ width: 'auto' }}
          >
            <option value="">全アクション</option>
            {ACTION_OPTIONS.map((a) => (
              <option key={a} value={a}>{ACTION_LABELS[a]?.label ?? a}</option>
            ))}
          </select>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-pale)', marginLeft: 'auto' }}>
            ※ログは1年間自動保持され、削除はできません
          </span>
        </div>
      </div>

      {error && <div className="banner error">{error}</div>}

      {loading ? (
        <div className="splash" style={{ height: 'auto', padding: '3rem 0' }}>
          <div className="spinner" />
        </div>
      ) : logs.length === 0 ? (
        <div className="empty-state">
          <span className="icon icon-xl" style={{ color: 'var(--text-pale)' }}>history</span>
          <span className="empty-text">ログがありません</span>
        </div>
      ) : (
        <>
          <div className="log-list">
            {logs.map((log) => {
              const meta = ACTION_LABELS[log.action] ?? { label: log.action, icon: 'info', color: 'var(--text-sub)' }
              return (
                <div key={log.id} className="log-row">
                  <div className="log-icon" style={{ color: meta.color }}>
                    <span className="icon icon-md">{meta.icon}</span>
                  </div>
                  <div className="log-body">
                    <div className="log-headline">
                      <span style={{ fontWeight: 600 }}>{log.actorDisplayName}</span>
                      <span style={{ color: 'var(--text-sub)' }}> が </span>
                      <span style={{ color: meta.color, fontWeight: 600 }}>{meta.label}</span>
                      {log.targetLabel && (
                        <>
                          <span style={{ color: 'var(--text-sub)' }}>: </span>
                          <span>{log.targetLabel}</span>
                        </>
                      )}
                    </div>
                    {log.details && (
                      <details className="log-details">
                        <summary>詳細</summary>
                        <pre>{JSON.stringify(log.details, null, 2)}</pre>
                      </details>
                    )}
                  </div>
                  <div className="log-time">
                    {log.createdAt ? new Date(log.createdAt).toLocaleString('ja-JP') : '-'}
                  </div>
                </div>
              )
            })}
          </div>

          {hasMore && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem' }}>
              <button className="btn-outline" style={{ width: 'auto', padding: '0.5rem 1.25rem' }}
                onClick={() => load(false)} disabled={loadingMore}>
                {loadingMore ? '読み込み中...' : 'さらに読み込む'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
