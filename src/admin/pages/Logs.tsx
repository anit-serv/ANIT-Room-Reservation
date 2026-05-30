import React, { useEffect, useState, useCallback } from 'react'
import { adminFetch } from '../auth'
import { getPageCache, setPageCache } from '../pageCache'
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

const WEEK_DAYS_JP = ['日', '月', '火', '水', '木', '金', '土']

const ACTION_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  'user.ban':                           { label: 'BAN',                     icon: 'block',           color: 'var(--color-danger)' },
  'user.unban':                         { label: 'BAN解除',                 icon: 'lock_open',       color: 'var(--color-brand)' },
  'reservation.update':                 { label: '予約編集(農部生協)',       icon: 'edit',            color: 'var(--color-warn)' },
  'reservation.delete':                 { label: '予約削除(農部生協)',       icon: 'delete',          color: 'var(--color-danger)' },
  'kobu_reservation.update':            { label: '予約編集(工部室)',         icon: 'edit',            color: 'var(--color-warn)' },
  'kobu_reservation.delete':            { label: '予約削除(工部室)',         icon: 'delete',          color: 'var(--color-danger)' },
  'nobu_room_reservation.update':       { label: '予約編集(農部室)',         icon: 'edit',            color: 'var(--color-warn)' },
  'nobu_room_reservation.delete':       { label: '予約削除(農部室)',         icon: 'delete',          color: 'var(--color-danger)' },
  'settings.update':                    { label: '設定変更(農部生協/即時)', icon: 'settings',        color: 'var(--color-brand)' },
  'settings.schedule':                  { label: '設定変更(農部生協/予定)', icon: 'schedule',        color: 'var(--color-warn)' },
  'settings.scheduled.cancel':          { label: '設定予定の取消(農部生協)', icon: 'cancel',          color: 'var(--color-ink-sub)' },
  'settings.lotteryTime':               { label: '抽選時刻変更',             icon: 'alarm',           color: 'var(--color-ink-sub)' },
  'settings.dayOverride.block':         { label: '緊急対応(予約不可)',       icon: 'block',           color: 'var(--color-warn)' },
  'settings.dayOverride.open':          { label: '緊急対応(臨時開放)',       icon: 'event_available', color: 'var(--color-brand)' },
  'settings.dayOverride.delete':        { label: '緊急対応の解除',           icon: 'delete',          color: 'var(--color-ink-sub)' },
  'kobu_settings.update':               { label: '設定変更(工部室/即時)',    icon: 'settings',        color: 'var(--color-brand)' },
  'kobu_settings.schedule':             { label: '設定変更(工部室/予定)',    icon: 'schedule',        color: 'var(--color-warn)' },
  'kobu_settings.scheduled.cancel':     { label: '設定予定の取消(工部室)',   icon: 'cancel',          color: 'var(--color-ink-sub)' },
  'kobu_settings.time_presets.update':  { label: '時間プリセット更新(工部室)', icon: 'tune',          color: 'var(--color-ink-sub)' },
  'nobu_room_settings.schedule':        { label: '設定変更(農部室/予定)',    icon: 'schedule',        color: 'var(--color-warn)' },
  'nobu_room_settings.scheduled.cancel':{ label: '設定予定の取消(農部室)',   icon: 'cancel',          color: 'var(--color-ink-sub)' },
  'nobu_room_settings.time_presets.update': { label: '時間プリセット更新(農部室)', icon: 'tune',      color: 'var(--color-ink-sub)' },
  'admin.add':                          { label: '管理者追加',               icon: 'person_add',      color: 'var(--color-brand)' },
  'admin.remove':                       { label: '管理者削除',               icon: 'person_remove',   color: 'var(--color-danger)' },
  'admin.super.transfer':               { label: 'スーパー管理者移譲',       icon: 'star',            color: 'var(--color-super)' },
  'invitation.create':                  { label: '招待発行',                 icon: 'add_link',        color: 'var(--color-brand)' },
  'invitation.revoke':                  { label: '招待取消',                 icon: 'link_off',        color: 'var(--color-ink-sub)' },
  'preset.create':                      { label: 'プリセット作成',           icon: 'bookmark_add',    color: 'var(--color-brand)' },
  'preset.delete':                      { label: 'プリセット削除',           icon: 'bookmark_remove', color: 'var(--color-danger)' },
}

function renderDetails(action: string, details: any): React.ReactNode {
  if (!details) return null

  // 予約編集（農部生協 / 工部室 / 農部室）
  if (
    action === 'reservation.update' ||
    action === 'kobu_reservation.update' ||
    action === 'nobu_room_reservation.update'
  ) {
    const before = details.before ?? {}
    const after  = details.after  ?? {}
    const merged = { ...before, ...after }
    const hasTime = action === 'kobu_reservation.update' || action === 'nobu_room_reservation.update'
    const fmt = (r: any) => hasTime
      ? `${r.bandName ?? ''}　${r.date ?? ''}　${r.startTime ?? ''}〜${r.endTime ?? ''}`
      : `${r.bandName ?? ''}　${r.date ?? ''}`
    return (
      <div className="mt-1.5 space-y-1 text-[0.78rem]">
        <div className="flex items-center gap-2">
          <span className="shrink-0 px-1.5 py-0.5 rounded text-[0.65rem] font-semibold bg-[#f0f0f0] text-ink-sub leading-tight">変更前</span>
          <span className="text-ink-sub">{fmt(before)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="shrink-0 px-1.5 py-0.5 rounded text-[0.65rem] font-semibold bg-brand-light text-brand-dark leading-tight">変更後</span>
          <span className="text-ink">{fmt(merged)}</span>
        </div>
      </div>
    )
  }

  // 設定変更（農部生協）
  if (action === 'settings.schedule' || action === 'settings.update') {
    return (
      <div className="mt-1.5 space-y-0.5 text-[0.78rem] text-ink-sub">
        {details.effectiveFrom && (
          <div>適用日: <span className="font-semibold text-ink">{details.effectiveFrom}</span></div>
        )}
        {Array.isArray(details.availableDays) && (
          <div>登録可能曜日: <span className="text-ink">
            {details.availableDays.length === 0 ? 'なし' : details.availableDays.map((d: number) => WEEK_DAYS_JP[d]).join('・')}
          </span></div>
        )}
        {Array.isArray(details.timeSlots) && (
          <div>時間枠: <span className="text-ink">{details.timeSlots.length}件</span></div>
        )}
        {(Array.isArray(details.extraDates) || Array.isArray(details.excludedDates)) && (
          <div>追加日: <span className="text-ink">{details.extraDates?.length ?? 0}件</span> / 除外日: <span className="text-ink">{details.excludedDates?.length ?? 0}件</span></div>
        )}
      </div>
    )
  }

  // 設定変更（工部室 / 農部室）— schedule アクション
  if (
    action === 'kobu_settings.schedule' ||
    action === 'kobu_settings.update' ||
    action === 'nobu_room_settings.schedule'
  ) {
    return (
      <div className="mt-1.5 space-y-0.5 text-[0.78rem] text-ink-sub">
        {details.effectiveFrom && (
          <div>適用日: <span className="font-semibold text-ink">{details.effectiveFrom}</span></div>
        )}
        {Array.isArray(details.availableDays) && (
          <div>利用可能曜日: <span className="text-ink">
            {details.availableDays.length === 0 ? 'なし' : details.availableDays.map((d: number) => WEEK_DAYS_JP[d]).join('・')}
          </span></div>
        )}
        {(details.timeSlotsCount !== undefined || details.extraDatesCount !== undefined) && (
          <div>
            時間枠: <span className="text-ink">{details.timeSlotsCount ?? 0}件</span>
            {' / '}追加日: <span className="text-ink">{details.extraDatesCount ?? 0}件</span>
            {' / '}除外日: <span className="text-ink">{details.excludedDatesCount ?? 0}件</span>
          </div>
        )}
        {details.openTime && details.closeTime && (
          <div>営業時間: <span className="text-ink">{details.openTime} 〜 {details.closeTime}</span></div>
        )}
      </div>
    )
  }

  // 設定予定の取消（農部生協 / 工部室 / 農部室）
  if (
    action === 'settings.scheduled.cancel' ||
    action === 'kobu_settings.scheduled.cancel' ||
    action === 'nobu_room_settings.scheduled.cancel'
  ) {
    return details.effectiveFrom ? (
      <div className="mt-1 text-[0.78rem] text-ink-sub">
        取消した適用日: <span className="font-semibold text-ink">{details.effectiveFrom}</span>
      </div>
    ) : null
  }

  // 抽選時刻変更
  if (action === 'settings.lotteryTime') {
    return details.lotteryTime ? (
      <div className="mt-1 text-[0.78rem] text-ink-sub">
        新しい抽選時刻: <span className="font-semibold text-ink">{details.lotteryTime}</span>
      </div>
    ) : null
  }

  // 時間プリセット更新（工部室 / 農部室）
  if (
    action === 'kobu_settings.time_presets.update' ||
    action === 'nobu_room_settings.time_presets.update'
  ) {
    return (
      <div className="mt-1 text-[0.78rem] text-ink-sub">
        プリセット数: <span className="font-semibold text-ink">{details.count ?? 0}件</span>
      </div>
    )
  }

  // その他: 折りたたみ JSON
  return (
    <details className="mt-1 text-[0.8rem]">
      <summary className="text-ink-pale cursor-pointer">詳細</summary>
      <pre className="bg-bg p-2 rounded mt-1 text-[0.75rem] whitespace-pre-wrap overflow-x-auto">{JSON.stringify(details, null, 2)}</pre>
    </details>
  )
}

const ACTION_OPTIONS = Object.keys(ACTION_LABELS)

type LogsCache = {
  logs: Log[]
  hasMore: boolean
  nextBefore: number | null
}

function logsCacheKey(actionFilter: string) {
  return `logs:${actionFilter}`
}

export default function Logs() {
  const [error, setError]     = useState<string | null>(null)
  const [actionFilter, setActionFilter] = useState<string>('')
  const initialCache = getPageCache<LogsCache>(logsCacheKey(''))
  const [logs, setLogs]       = useState<Log[]>(initialCache?.logs ?? [])
  const [loading, setLoading] = useState(!initialCache)
  const [hasMore, setHasMore] = useState(initialCache?.hasMore ?? false)
  const [nextBefore, setNextBefore] = useState<number | null>(initialCache?.nextBefore ?? null)
  const [loadingMore, setLoadingMore] = useState(false)

  const load = useCallback(async (reset = true) => {
    const cacheKey = logsCacheKey(actionFilter)
    const cached = getPageCache<LogsCache>(cacheKey)
    if (reset) {
      if (cached) {
        setLogs(cached.logs)
        setHasMore(cached.hasMore)
        setNextBefore(cached.nextBefore)
        setLoading(false)
      } else {
        setLoading(true)
        setLogs([])
      }
    } else {
      setLoadingMore(true)
    }
    setError(null)
    try {
      const params = new URLSearchParams()
      if (actionFilter) params.set('action', actionFilter)
      if (!reset && nextBefore) params.set('before', String(nextBefore))
      params.set('limit', '50')
      const res = await adminFetch(`/api/admin/logs?${params}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      const nextLogs = reset ? data.logs : [...logs, ...data.logs]
      setLogs(nextLogs)
      setHasMore(data.hasMore)
      setNextBefore(data.nextBefore)
      setPageCache<LogsCache>(cacheKey, {
        logs: nextLogs,
        hasMore: data.hasMore,
        nextBefore: data.nextBefore,
      })
    } catch {
      setError('ログの取得に失敗しました')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [actionFilter, logs, nextBefore])

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
                    {renderDetails(log.action, log.details)}
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
