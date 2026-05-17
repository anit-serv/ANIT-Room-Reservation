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

  if (error) return <div className="banner error">{error}</div>
  if (!data) return <DashboardSkeleton />

  // 以降は実データ表示

  const { stats, upcoming, pendingChange, recentLogs } = data

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h1 className="admin-page-title" style={{ margin: 0 }}>
          ダッシュボード
        </h1>
        {me && (
          <span style={{ color: 'var(--text-sub)', fontSize: '0.9rem' }}>
            ようこそ、<strong>{me.displayName}</strong>
            {me.isSuperAdmin && (
              <span className="badge" style={{ background: '#fff7e0', color: '#b86200', border: '1px solid #f4c95a', marginLeft: '0.5rem' }}>
                <span className="icon icon-sm">star</span>スーパー管理者
              </span>
            )}
            {' '}さん
          </span>
        )}
      </div>

      {/* 適用予定通知 */}
      {pendingChange && (
        <div className="admin-card" style={{ background: 'var(--orange-light)', borderColor: 'var(--orange)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
            <div>
              <strong style={{ color: 'var(--orange)' }}>
                <span className="icon icon-sm" style={{ verticalAlign: 'middle' }}>schedule</span> 設定変更が予定されています
              </strong>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-sub)', marginTop: '0.3rem' }}>
                適用日: <strong>{pendingChange.effectiveFrom}</strong>
                {' / '}
                曜日: <strong>{pendingChange.availableDays.map((d) => WEEK_DAYS[d]).join('・') || 'なし'}</strong>
              </div>
            </div>
            <Link to="/admin/settings" className="btn-outline" style={{ width: 'auto', padding: '0.4rem 0.8rem' }}>
              確認する
            </Link>
          </div>
        </div>
      )}

      {/* 統計カード */}
      <div className="stats-grid">
        <StatCard
          icon="hourglass_empty" iconColor="var(--orange)"
          label="抽選待ち" value={stats.pendingReservations}
          onClick={() => navigate('/admin/reservations?')}
        />
        <StatCard
          icon="check_circle" iconColor="var(--green)"
          label="確定済み" value={stats.confirmedReservations}
          onClick={() => navigate('/admin/reservations')}
        />
        <StatCard
          icon="today" iconColor="#1a73e8"
          label="本日の予約" value={stats.todayReservations}
        />
        <StatCard
          icon="group" iconColor="var(--text-sub)"
          label="ユーザー" value={stats.totalUsers}
          sub={stats.bannedUsers > 0 ? `BAN ${stats.bannedUsers}名` : undefined}
          onClick={() => navigate('/admin/users')}
        />
      </div>

      <div className="dashboard-grid">
        {/* 直近の予約 */}
        <div className="admin-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="dash-section-header">
            <h2><span className="icon icon-sm">event</span> 直近の予約</h2>
            <Link to="/admin/reservations" style={{ fontSize: '0.85rem', color: 'var(--green)' }}>すべて見る →</Link>
          </div>
          {upcoming.length === 0 ? (
            <div className="empty-state" style={{ padding: '2rem 1rem' }}>
              <span className="icon icon-xl" style={{ color: 'var(--text-pale)' }}>event_busy</span>
              <span className="empty-text">直近の予約はありません</span>
            </div>
          ) : (
            <div className="dash-list">
              {upcoming.map((r) => {
                const [datePart, timePart] = r.date.split('T')
                return (
                  <button
                    key={r.id}
                    className="dash-list-item"
                    onClick={() => navigate(`/admin/reservations?focus=${r.id}`)}
                  >
                    <div className={`accent ${r.status}`} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.bandName}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-sub)' }}>
                        {datePart.slice(5).replace('-', '/')} {timePart} ・ {r.userDisplayName || '(不明)'}
                      </div>
                    </div>
                    <span className={`badge ${r.status}`}>
                      {r.status === 'confirmed' ? `${r.order ?? '-'}` : '待ち'}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* 最近のアクティビティ */}
        <div className="admin-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="dash-section-header">
            <h2><span className="icon icon-sm">history</span> 最近のアクティビティ</h2>
            <Link to="/admin/logs" style={{ fontSize: '0.85rem', color: 'var(--green)' }}>すべて見る →</Link>
          </div>
          {recentLogs.length === 0 ? (
            <div className="empty-state" style={{ padding: '2rem 1rem' }}>
              <span className="icon icon-xl" style={{ color: 'var(--text-pale)' }}>history_off</span>
              <span className="empty-text">アクティビティはありません</span>
            </div>
          ) : (
            <div className="dash-list">
              {recentLogs.map((log) => (
                <div key={log.id} className="dash-list-item dash-log-item">
                  <div style={{ flex: 1, minWidth: 0, fontSize: '0.85rem' }}>
                    <span style={{ fontWeight: 600 }}>{log.actorDisplayName}</span>
                    <span style={{ color: 'var(--text-sub)' }}> が </span>
                    <span>{ACTION_LABELS[log.action] ?? log.action}</span>
                    {log.targetLabel && (
                      <>
                        <span style={{ color: 'var(--text-sub)' }}>: </span>
                        <span>{log.targetLabel}</span>
                      </>
                    )}
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-pale)', whiteSpace: 'nowrap' }}>
                    {formatRelative(log.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <Skeleton width="180px" height="28px" />
        <Skeleton width="200px" height="20px" />
      </div>
      <div className="stats-grid">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="stat-card">
            <Skeleton width={32} height={32} circle />
            <div className="stat-body">
              <Skeleton width="60%" height="12px" style={{ marginBottom: '0.4rem' }} />
              <Skeleton width="40%" height="24px" />
            </div>
          </div>
        ))}
      </div>
      <div className="dashboard-grid">
        {[0, 1].map((i) => (
          <div key={i} className="admin-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="dash-section-header">
              <Skeleton width="160px" height="20px" />
              <Skeleton width="80px" height="14px" />
            </div>
            {[0, 1, 2, 3].map((j) => (
              <div key={j} className="dash-list-item" style={{ cursor: 'default' }}>
                <Skeleton width="4px" height="40px" style={{ borderRadius: '4px' }} />
                <div style={{ flex: 1 }}>
                  <Skeleton width="70%" height="14px" style={{ marginBottom: '0.3rem' }} />
                  <Skeleton width="50%" height="12px" />
                </div>
                <Skeleton width="48px" height="20px" style={{ borderRadius: '20px' }} />
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
  icon: string
  iconColor: string
  label: string
  value: number
  sub?: string
  onClick?: () => void
}) {
  const className = `stat-card${onClick ? ' stat-card-clickable' : ''}`
  const content = (
    <>
      <span className="icon icon-lg" style={{ color: iconColor }}>{icon}</span>
      <div className="stat-body">
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {sub && <div className="stat-sub">{sub}</div>}
      </div>
    </>
  )
  return onClick
    ? <button className={className} onClick={onClick}>{content}</button>
    : <div className={className}>{content}</div>
}
