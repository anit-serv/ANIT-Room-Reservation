import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { adminFetch } from '../auth'
import Skeleton from '../../components/Skeleton'

type Stats = {
  pendingReservations: number
  confirmedReservations: number
  todayReservations: number
  totalUsers: number
  bannedUsers: number
  adminCount: number
}

type UpcomingReservation = {
  id: string
  bandName: string
  date: string
  status: 'pending' | 'confirmed'
  order?: number
  userDisplayName: string
  userPictureUrl: string | null
}

type RecentLog = {
  id: string
  actorDisplayName: string
  action: string
  targetLabel: string | null
  createdAt: number | null
}

type DashboardData = {
  stats: Stats
  upcoming: UpcomingReservation[]
  pendingChange: { availableDays: number[]; effectiveFrom: string } | null
  recentLogs: RecentLog[]
}

const WEEK_DAYS = ['日', '月', '火', '水', '木', '金', '土']

const ACTION_LABELS: Record<string, string> = {
  'user.ban': 'BAN',
  'user.unban': 'BAN解除',
  'reservation.update': '予約編集',
  'reservation.delete': '予約削除',
  'settings.update': '設定変更',
  'settings.schedule': '設定変更予定',
  'settings.scheduled.cancel': '設定予定取消',
  'admin.add': '管理者追加',
  'admin.remove': '管理者削除',
  'admin.super.transfer': 'スーパー管理者移譲',
  'invitation.create': '招待発行',
  'invitation.revoke': '招待取消',
  'preset.create': 'プリセット作成',
  'preset.delete': 'プリセット削除',
}

function formatRelative(ts: number | null): string {
  if (!ts) return '-'
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1)    return 'たった今'
  if (min < 60)   return `${min}分前`
  const hr = Math.floor(min / 60)
  if (hr < 24)    return `${hr}時間前`
  const day = Math.floor(hr / 24)
  if (day < 7)    return `${day}日前`
  return new Date(ts).toLocaleDateString('ja-JP')
}

const STATS_GRID = 'grid grid-cols-4 gap-3 mb-4 max-md:grid-cols-2'
const DASH_GRID  = 'grid grid-cols-2 gap-4 max-md:grid-cols-1'
const SECTION_HEADER = 'flex justify-between items-center px-4 py-3 border-b border-line'

export default function Dashboard() {
  const navigate = useNavigate()
  const [me, setMe] = useState<{ displayName: string; isSuperAdmin?: boolean } | null>(null)
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      adminFetch('/api/admin/auth/me').then((r) => r.ok ? r.json() : null),
      adminFetch('/api/admin/dashboard').then((r) => r.ok ? r.json() : Promise.reject()),
    ])
      .then(([meData, dashData]) => {
        setMe(meData)
        setData(dashData)
      })
      .catch(() => setError('ダッシュボードの取得に失敗しました'))
  }, [])

  if (error) return <div className="banner-error">{error}</div>
  if (!data) return <DashboardSkeleton />

  const { stats, upcoming, pendingChange, recentLogs } = data

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6 flex-wrap gap-2">
        <h1 className="text-2xl font-bold m-0">ダッシュボード</h1>
        {me && (
          <span className="text-ink-sub text-[0.9rem]">
            ようこそ、<strong>{me.displayName}</strong>
            {me.isSuperAdmin && (
              <span className="badge badge-super ml-2">
                <span className="icon icon-sm">star</span>スーパー管理者
              </span>
            )}
            {' '}さん
          </span>
        )}
      </div>

      {/* 適用予定通知 */}
      {pendingChange && (
        <div className="bg-warn-light border border-warn rounded-xl p-5 mb-4 shadow-[var(--shadow-card-sm)]">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <strong className="text-warn">
                <span className="icon icon-sm align-middle">schedule</span> 設定変更が予定されています
              </strong>
              <div className="text-[0.85rem] text-ink-sub mt-1">
                適用日: <strong>{pendingChange.effectiveFrom}</strong>
                {' / '}
                曜日: <strong>{pendingChange.availableDays.map((d) => WEEK_DAYS[d]).join('・') || 'なし'}</strong>
              </div>
            </div>
            <Link to="/admin/settings" className="btn-outline w-auto px-3 py-1.5">
              確認する
            </Link>
          </div>
        </div>
      )}

      {/* 統計カード */}
      <div className={STATS_GRID}>
        <StatCard icon="hourglass_empty" iconColor="var(--color-warn)" label="抽選待ち" value={stats.pendingReservations} onClick={() => navigate('/admin/reservations')} />
        <StatCard icon="check_circle"    iconColor="var(--color-brand)" label="確定済み" value={stats.confirmedReservations} onClick={() => navigate('/admin/reservations')} />
        <StatCard icon="today"           iconColor="var(--color-link)"  label="本日の予約" value={stats.todayReservations} />
        <StatCard icon="group"           iconColor="var(--color-ink-sub)" label="ユーザー"
          value={stats.totalUsers}
          sub={stats.bannedUsers > 0 ? `BAN ${stats.bannedUsers}名` : undefined}
          onClick={() => navigate('/admin/users')} />
      </div>

      <div className={DASH_GRID}>
        {/* 直近の予約 */}
        <div className="bg-surface border border-line rounded-xl overflow-hidden shadow-[var(--shadow-card-sm)]">
          <div className={SECTION_HEADER}>
            <h2 className="text-[0.95rem] font-bold m-0 flex items-center gap-1.5">
              <span className="icon icon-sm">event</span> 直近の予約
            </h2>
            <Link to="/admin/reservations" className="text-[0.85rem] text-brand no-underline">すべて見る →</Link>
          </div>
          {upcoming.length === 0 ? (
            <EmptyState icon="event_busy" text="直近の予約はありません" />
          ) : (
            <div className="flex flex-col">
              {upcoming.map((r) => {
                const [datePart, timePart] = r.date.split('T')
                return (
                  <button
                    key={r.id}
                    className="flex items-center gap-2.5 px-4 py-2.5 border-b border-line last:border-b-0 bg-transparent border-0 text-left cursor-pointer transition-colors hover:bg-bg"
                    onClick={() => navigate(`/admin/reservations?focus=${r.id}`)}
                  >
                    <div className={'w-1 self-stretch rounded ' + (r.status === 'confirmed' ? 'bg-brand' : 'bg-warn')} />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{r.bandName}</div>
                      <div className="text-[0.8rem] text-ink-sub">
                        {datePart.slice(5).replace('-', '/')} {timePart} ・ {r.userDisplayName || '(不明)'}
                      </div>
                    </div>
                    <span className={'badge ' + (r.status === 'confirmed' ? 'badge-confirmed' : 'badge-pending')}>
                      {r.status === 'confirmed' ? `${r.order ?? '-'}` : '待ち'}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* 最近のアクティビティ */}
        <div className="bg-surface border border-line rounded-xl overflow-hidden shadow-[var(--shadow-card-sm)]">
          <div className={SECTION_HEADER}>
            <h2 className="text-[0.95rem] font-bold m-0 flex items-center gap-1.5">
              <span className="icon icon-sm">history</span> 最近のアクティビティ
            </h2>
            <Link to="/admin/logs" className="text-[0.85rem] text-brand no-underline">すべて見る →</Link>
          </div>
          {recentLogs.length === 0 ? (
            <EmptyState icon="history_off" text="アクティビティはありません" />
          ) : (
            <div className="flex flex-col">
              {recentLogs.map((log) => (
                <div key={log.id} className="flex items-center gap-2.5 px-4 py-2.5 border-b border-line last:border-b-0">
                  <div className="flex-1 min-w-0 text-[0.85rem]">
                    <span className="font-semibold">{log.actorDisplayName}</span>
                    <span className="text-ink-sub"> が </span>
                    <span>{ACTION_LABELS[log.action] ?? log.action}</span>
                    {log.targetLabel && (<><span className="text-ink-sub">: </span><span>{log.targetLabel}</span></>)}
                  </div>
                  <span className="text-[0.75rem] text-ink-pale whitespace-nowrap">{formatRelative(log.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 px-4 text-ink-pale text-center">
      <span className="icon icon-xl text-ink-pale">{icon}</span>
      <span className="text-[0.9rem]">{text}</span>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div>
      <div className="flex justify-between mb-6">
        <Skeleton width="180px" height="28px" />
        <Skeleton width="200px" height="20px" />
      </div>
      <div className={STATS_GRID}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 p-4 bg-surface border border-line rounded-xl shadow-[var(--shadow-card-sm)]">
            <Skeleton width={32} height={32} circle />
            <div className="flex-1">
              <Skeleton width="60%" height="12px" className="mb-1.5" />
              <Skeleton width="40%" height="24px" />
            </div>
          </div>
        ))}
      </div>
      <div className={DASH_GRID}>
        {[0, 1].map((i) => (
          <div key={i} className="bg-surface border border-line rounded-xl overflow-hidden shadow-[var(--shadow-card-sm)]">
            <div className={SECTION_HEADER}>
              <Skeleton width="160px" height="20px" />
              <Skeleton width="80px" height="14px" />
            </div>
            {[0, 1, 2, 3].map((j) => (
              <div key={j} className="flex items-center gap-2.5 px-4 py-2.5 border-b border-line last:border-b-0">
                <Skeleton width="4px" height="40px" />
                <div className="flex-1">
                  <Skeleton width="70%" height="14px" className="mb-1" />
                  <Skeleton width="50%" height="12px" />
                </div>
                <Skeleton width="48px" height="20px" style={{ borderRadius: 20 }} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function StatCard({
  icon, iconColor, label, value, sub, onClick,
}: {
  icon: string; iconColor: string; label: string; value: number; sub?: string; onClick?: () => void
}) {
  const baseCls = 'flex items-center gap-3 p-4 bg-surface border border-line rounded-xl shadow-[var(--shadow-card-sm)] text-left'
  const interactiveCls = ' cursor-pointer transition hover:border-brand active:scale-[0.98]'
  const cls = baseCls + (onClick ? interactiveCls : '')
  const content = (
    <>
      <span className="icon icon-lg" style={{ color: iconColor }}>{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[0.75rem] text-ink-sub font-semibold uppercase tracking-wide">{label}</div>
        <div className="text-[1.6rem] font-bold leading-tight mt-0.5 max-md:text-[1.4rem]">{value}</div>
        {sub && <div className="text-[0.75rem] text-danger mt-0.5">{sub}</div>}
      </div>
    </>
  )
  return onClick
    ? <button className={cls} onClick={onClick}>{content}</button>
    : <div className={cls}>{content}</div>
}
