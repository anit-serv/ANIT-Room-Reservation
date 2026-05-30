import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { adminFetch } from '../auth'
import { getPageCache, setPageCache } from '../pageCache'
import Skeleton from '../../components/Skeleton'

type Stats = {
  nobu:     { pending: number; confirmed: number; today: number }
  kobu:     { today: number; week: number }
  nobuRoom: { today: number; week: number }
  users:    { total: number; banned: number }
  adminCount: number
}

type UpcomingReservation = {
  id: string
  facility: 'nobu' | 'kobu' | 'nobu-room'
  bandName: string
  date: string
  startTime?: string
  endTime?: string
  status?: 'pending' | 'confirmed'
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
  'reservation.update': '予約編集(農部生協)',
  'reservation.cancel': '予約キャンセル(農部生協)',
  'kobu_reservation.update': '予約編集(工部室)',
  'kobu_reservation.cancel': '予約キャンセル(工部室)',
  'nobu_room_reservation.update': '予約編集(農部室)',
  'nobu_room_reservation.cancel': '予約キャンセル(農部室)',
  'settings.update': '設定変更(農部生協/即時)',
  'settings.schedule': '設定変更(農部生協/予定)',
  'settings.scheduled.cancel': '設定予定の取消(農部生協)',
  'settings.dayOverride.block': '緊急対応(予約不可)',
  'settings.dayOverride.open': '緊急対応(臨時開放)',
  'settings.dayOverride.delete': '緊急対応の解除',
  'kobu_settings.update': '設定変更(工部室/即時)',
  'kobu_settings.schedule': '設定変更(工部室/予定)',
  'kobu_settings.scheduled.cancel': '設定予定の取消(工部室)',
  'kobu_settings.time_presets.update': '時間プリセット更新(工部室)',
  'nobu_room_settings.schedule': '設定変更(農部室/予定)',
  'nobu_room_settings.scheduled.cancel': '設定予定の取消(農部室)',
  'nobu_room_settings.time_presets.update': '時間プリセット更新(農部室)',
  'admin.add': '管理者追加',
  'admin.remove': '管理者削除',
  'admin.super.transfer': 'スーパー管理者移譲',
  'invitation.create': '招待発行',
  'invitation.revoke': '招待取消',
  'preset.create': 'プリセット作成',
  'preset.delete': 'プリセット削除',
}

const FACILITY_META = {
  'nobu':      { label: '農部生協', icon: 'grass',        iconBg: 'bg-emerald-100', iconColor: 'text-emerald-600', labelColor: 'text-emerald-600' },
  'kobu':      { label: '工部室',   icon: 'door_open',    iconBg: 'bg-cyan-100',    iconColor: 'text-cyan-700',    labelColor: 'text-cyan-700'    },
  'nobu-room': { label: '農部室',   icon: 'door_sliding', iconBg: 'bg-teal-100',    iconColor: 'text-teal-600',    labelColor: 'text-teal-600'    },
} as const

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

function todayDateKey(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

const DASHBOARD_GRID = 'grid grid-cols-[minmax(0,1fr)_minmax(340px,0.58fr)] gap-5 items-start max-lg:block'
const STATS_GRID3 = 'grid grid-cols-3 gap-3 mb-3 max-md:grid-cols-3'
const STATS_GRID2 = 'grid grid-cols-2 gap-3 mb-3 max-md:grid-cols-2'
const SECTION_HEADER = 'flex justify-between items-center px-4 py-3 border-b border-line'
const DASHBOARD_POLL_MS = 60_000
const DASHBOARD_CACHE_KEY = 'dashboard'
type DashboardCache = {
  me: { displayName: string; isSuperAdmin?: boolean } | null
  data: DashboardData
}

export default function Dashboard() {
  const navigate = useNavigate()
  const cached = getPageCache<DashboardCache>(DASHBOARD_CACHE_KEY)
  const [me, setMe] = useState<{ displayName: string; isSuperAdmin?: boolean } | null>(cached?.me ?? null)
  const [data, setData] = useState<DashboardData | null>(cached?.data ?? null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    return Promise.all([
      adminFetch('/api/admin/auth/me').then((r) => r.ok ? r.json() : null),
      adminFetch('/api/admin/dashboard').then((r) => r.ok ? r.json() : Promise.reject()),
    ])
      .then(([meData, dashData]) => {
        setMe(meData)
        setData(dashData)
        setPageCache<DashboardCache>(DASHBOARD_CACHE_KEY, { me: meData, data: dashData })
      })
      .catch(() => setError('ダッシュボードの取得に失敗しました'))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, DASHBOARD_POLL_MS)
    return () => window.clearInterval(id)
  }, [load])

  if (error && !data) return <div className="banner-error">{error}</div>
  if (!data) return <DashboardSkeleton />

  const { stats, upcoming, pendingChange, recentLogs } = data
  const today = todayDateKey()

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

      {/* 農部生協 適用予定通知 */}
      {pendingChange && (
        <div className="bg-warn-light border border-warn rounded-xl p-5 mb-4 shadow-[var(--shadow-card-sm)]">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <strong className="text-warn">
                <span className="icon icon-sm align-middle">schedule</span> 農部生協の設定変更が予定されています
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

      <div className={DASHBOARD_GRID}>
        <div>
          {/* 農部生協 統計 */}
          <FacilityLabel icon="grass" label="農部生協" />
          <div className={STATS_GRID3}>
            <StatCard icon="hourglass_empty" iconColor="var(--color-warn)"  label="抽選待ち"  value={stats.nobu.pending}   onClick={() => navigate('/admin/reservations')} />
            <StatCard icon="check_circle"    iconColor="var(--color-brand)" label="確定済み"  value={stats.nobu.confirmed} onClick={() => navigate('/admin/reservations')} />
            <StatCard icon="today"           iconColor="var(--color-link)"  label="本日の予約" value={stats.nobu.today}     onClick={() => navigate(`/admin/reservations/nobu?dateFocus=${today}`)} />
          </div>

          {/* 工部室・農部室 統計 */}
          <FacilityLabel icon="meeting_room" label="工部室" />
          <div className={STATS_GRID2}>
            <StatCard icon="today"      iconColor="var(--color-link)"    label="本日の予約" value={stats.kobu.today} onClick={() => navigate(`/admin/reservations/kobu?dateFocus=${today}`)} />
            <StatCard icon="date_range" iconColor="var(--color-ink-sub)" label="今後7日"   value={stats.kobu.week}  onClick={() => navigate('/admin/reservations/kobu')} />
          </div>

          <FacilityLabel icon="door_sliding" label="農部室" />
          <div className={STATS_GRID2}>
            <StatCard icon="today"      iconColor="var(--color-link)"    label="本日の予約" value={stats.nobuRoom.today} onClick={() => navigate(`/admin/reservations/nobu-room?dateFocus=${today}`)} />
            <StatCard icon="date_range" iconColor="var(--color-ink-sub)" label="今後7日"   value={stats.nobuRoom.week}  onClick={() => navigate('/admin/reservations/nobu-room')} />
          </div>

          {/* ユーザー管理 */}
          <FacilityLabel icon="group" label="ユーザー管理" />
          <div className={STATS_GRID2 + ' mb-5'}>
            <StatCard icon="group"           iconColor="var(--color-ink-sub)" label="ユーザー"
              value={stats.users.total}
              sub={stats.users.banned > 0 ? `BAN ${stats.users.banned}名` : undefined}
              onClick={() => navigate('/admin/users')} />
            <StatCard icon="admin_panel_settings" iconColor="var(--color-ink-sub)" label="管理者"
              value={stats.adminCount}
              onClick={() => navigate('/admin/admins')} />
          </div>
        </div>

        <div className="grid gap-4">
        {/* 直近の予約（全施設） */}
        <div className="bg-surface border border-line rounded-xl overflow-hidden shadow-[var(--shadow-card-sm)]">
          <div className={SECTION_HEADER}>
            <h2 className="text-[0.95rem] font-bold m-0 flex items-center gap-1.5">
              <span className="icon icon-sm">event</span> 直近の予約
            </h2>
          </div>
          {upcoming.length === 0 ? (
            <EmptyState icon="event_busy" text="直近の予約はありません" />
          ) : (
            <div className="flex flex-col">
              {upcoming.map((r) => {
                const meta = FACILITY_META[r.facility]
                let dateStr: string
                let timeStr: string
                if (r.facility === 'nobu') {
                  const [datePart, timePart] = r.date.split('T')
                  dateStr = datePart.slice(5).replace('-', '/')
                  timeStr = timePart ?? ''
                } else {
                  dateStr = r.date.slice(5).replace('-', '/')
                  timeStr = r.startTime ? `${r.startTime}〜${r.endTime}` : ''
                }
                const dest = r.facility === 'nobu'
                  ? `/admin/reservations/nobu?focus=${r.id}`
                  : r.facility === 'kobu'
                    ? `/admin/reservations/kobu?focus=${r.id}`
                    : `/admin/reservations/nobu-room?focus=${r.id}`
                return (
                  <button
                    key={`${r.facility}-${r.id}`}
                    className="flex items-center gap-3 px-4 py-3 border-b border-line last:border-b-0 bg-transparent border-x-0 border-t-0 text-left cursor-pointer transition-colors hover:bg-bg w-full"
                    onClick={() => navigate(dest)}
                  >
                    <div className="flex flex-col items-center gap-0.5 shrink-0">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${meta.iconBg}`}>
                        <span className={`icon ${meta.iconColor}`} style={{ fontSize: 18 }}>{meta.icon}</span>
                      </div>
                      <span className={`text-[0.55rem] font-semibold leading-none ${meta.labelColor}`}>{meta.label}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate text-ink">{r.bandName}</div>
                      <div className="text-[0.78rem] text-ink-sub">
                        {dateStr} {timeStr}{r.userDisplayName ? ` ・ ${r.userDisplayName}` : ''}
                      </div>
                    </div>
                    {r.facility === 'nobu' && (
                      <span className={'badge shrink-0 ' + (r.status === 'confirmed' ? 'badge-confirmed' : 'badge-pending')}>
                        <span className="icon icon-sm">{r.status === 'confirmed' ? 'check_circle' : 'hourglass_empty'}</span>
                        {r.status === 'confirmed' ? `確定 (${typeof r.order === 'number' ? r.order + 1 : '-'})` : '抽選待ち'}
                      </span>
                    )}
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
                <div key={log.id} className="flex items-center gap-2.5 px-4 py-2.5 border-b border-line">
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
    </div>
  )
}

function FacilityLabel({ icon, label }: { icon: string; label: string }) {
  return (
    <p className="text-[0.72rem] font-bold text-ink-pale mb-1.5 flex items-center gap-1 mt-1">
      <span className="icon" style={{ fontSize: 13 }}>{icon}</span>
      {label}
    </p>
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
  const StatSkel = () => (
    <div className="flex items-center gap-3 p-4 bg-surface border border-line rounded-xl shadow-[var(--shadow-card-sm)]">
      <Skeleton width={28} height={28} circle />
      <div className="flex-1">
        <Skeleton width="55%" height="11px" className="mb-1.5" />
        <Skeleton width="35%" height="22px" />
      </div>
    </div>
  )
  const FacilityLabelSkel = () => (
    <Skeleton width="72px" height="11px" className="mb-1.5 mt-1" />
  )
  const CardSkel = () => (
    <div className="bg-surface border border-line rounded-xl overflow-hidden shadow-[var(--shadow-card-sm)]">
      <div className="px-4 py-3 border-b border-line">
        <Skeleton width="140px" height="18px" />
      </div>
      {[0, 1, 2, 3].map((j) => (
        <div key={j} className="flex items-center gap-3 px-4 py-3 border-b border-line last:border-b-0">
          <div className="flex flex-col items-center gap-0.5 shrink-0">
            <Skeleton width={36} height={36} style={{ borderRadius: 12 }} />
            <Skeleton width={28} height={8} />
          </div>
          <div className="flex-1">
            <Skeleton width="60%" height="14px" className="mb-1" />
            <Skeleton width="45%" height="11px" />
          </div>
        </div>
      ))}
    </div>
  )
  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <Skeleton width="180px" height="28px" />
        <Skeleton width="150px" height="16px" />
      </div>
      <div className={DASHBOARD_GRID}>
        <div>
          <FacilityLabelSkel />
          <div className={STATS_GRID3}>{[0,1,2].map((i) => <StatSkel key={i} />)}</div>
          <FacilityLabelSkel />
          <div className={STATS_GRID2}>{[0,1].map((i) => <StatSkel key={i} />)}</div>
          <FacilityLabelSkel />
          <div className={STATS_GRID2}>{[0,1].map((i) => <StatSkel key={i} />)}</div>
          <FacilityLabelSkel />
          <div className={STATS_GRID2 + ' mb-5'}>{[0,1].map((i) => <StatSkel key={i} />)}</div>
        </div>
        <div className="grid gap-4">
          <CardSkel />
          <CardSkel />
        </div>
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
