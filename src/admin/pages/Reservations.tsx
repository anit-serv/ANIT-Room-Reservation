import { useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { adminFetch } from '../auth'
import { getPageCache, setPageCache } from '../pageCache'
import Skeleton from '../../components/Skeleton'
import ConfirmDialog from '../../components/ConfirmDialog'
import DatePicker from '../../components/DatePicker'

type TimeSlot = { label: string; value: string }
type DateOption = { label: string; value: string }

type Reservation = {
  id: string
  userId: string
  userDisplayName: string
  userPictureUrl: string | null
  bandName: string
  date: string
  status: 'pending' | 'confirmed' | 'cancelled'
  order?: number
  createdAt: number | null
}

const RESERVATION_POLL_MS = 60_000

function reservationsCacheKey(dateFilter: string, statusFilter: string, search: string) {
  return `reservations:nobu:${dateFilter}:${statusFilter}:${search}`
}

function formatDateHeading(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const weekdays = ['日', '月', '火', '水', '木', '金', '土']
  return `${date} (${weekdays[new Date(year, month - 1, day).getDay()]})`
}

export default function Reservations() {
  const [searchParams, setSearchParams] = useSearchParams()
  const focusId = searchParams.get('focus')
  const dateFocus = searchParams.get('dateFocus')
  const desktopRowRefs = useRef<Record<string, HTMLElement | null>>({})
  const mobileRowRefs = useRef<Record<string, HTMLElement | null>>({})
  const desktopDateRefs = useRef<Record<string, HTMLElement | null>>({})
  const mobileDateRefs = useRef<Record<string, HTMLElement | null>>({})

  const initialCacheKey = reservationsCacheKey('', '', '')
  const cachedReservations = getPageCache<Reservation[]>(initialCacheKey)
  const [reservations, setReservations] = useState<Reservation[]>(cachedReservations ?? [])
  const [loading, setLoading]           = useState(!cachedReservations)
  const [error, setError]               = useState<string | null>(null)
  const [dateFilter, setDateFilter]     = useState('')
  const [statusFilter, setStatusFilter] = useState<'' | 'pending' | 'confirmed' | 'cancelled'>('')
  const [search, setSearch]             = useState('')
  const [editing,       setEditing]       = useState<Reservation | null>(null)
  const [deleteTarget,  setDeleteTarget]  = useState<Reservation | null>(null)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const [openId,        setOpenId]        = useState<string | null>(null)

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    const cacheKey = reservationsCacheKey(dateFilter, statusFilter, search)
    const cached = getPageCache<Reservation[]>(cacheKey)
    if (!opts.silent) {
      if (cached) {
        setReservations(cached)
        setLoading(false)
      } else {
        setLoading(true)
      }
    }
    setError(null)
    try {
      const params = new URLSearchParams()
      if (dateFilter)   params.set('date', dateFilter)
      if (statusFilter) params.set('status', statusFilter)
      if (search)       params.set('q', search)
      const res = await adminFetch(`/api/admin/reservations?${params}`)
      if (!res.ok) throw new Error('取得に失敗しました')
      const data = await res.json()
      setReservations(data.reservations)
      setPageCache<Reservation[]>(cacheKey, data.reservations)
    } catch (err: any) {
      setError(err.message)
    } finally {
      if (!opts.silent) setLoading(false)
    }
  }, [dateFilter, statusFilter, search])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') load({ silent: true })
    }, RESERVATION_POLL_MS)
    return () => window.clearInterval(id)
  }, [load])

  useEffect(() => {
    if (reservations.length === 0) return
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let clearTimer: ReturnType<typeof setTimeout> | null = null

    function scrollElementToCenter(el: HTMLElement) {
      const rect = el.getBoundingClientRect()
      const top = window.scrollY + rect.top - (window.innerHeight / 2) + (rect.height / 2)
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
    }

    if (focusId) {
      let attempts = 0
      const tryScroll = () => {
        const isDesktop = window.matchMedia('(min-width: 1024px)').matches
        const row = (isDesktop ? desktopRowRefs.current : mobileRowRefs.current)[focusId]
        if (row) {
          scrollElementToCenter(row)
          setHighlightedId(focusId)
          clearTimer = setTimeout(() => {
            setHighlightedId(null)
            setSearchParams({}, { replace: true })
          }, 3000)
          return
        }

        attempts += 1
        if (attempts < 10) {
          retryTimer = setTimeout(tryScroll, 80)
          return
        }

        if (dateFocus) {
          const heading = (isDesktop ? desktopDateRefs.current : mobileDateRefs.current)[dateFocus]
          if (heading) scrollElementToCenter(heading)
        }
        setSearchParams({}, { replace: true })
      }
      requestAnimationFrame(tryScroll)
      return () => {
        if (retryTimer) clearTimeout(retryTimer)
        if (clearTimer) clearTimeout(clearTimer)
      }
    }
    if (dateFocus) {
      const isDesktop = window.matchMedia('(min-width: 1024px)').matches
      const heading = (isDesktop ? desktopDateRefs.current : mobileDateRefs.current)[dateFocus]
      if (!heading) return
      scrollElementToCenter(heading)
      setSearchParams({}, { replace: true })
    }
  }, [focusId, dateFocus, reservations, setSearchParams])

  async function execDelete(r: Reservation) {
    const res = await adminFetch(`/api/admin/reservations/${r.id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('キャンセルに失敗しました')
    setDeleteTarget(null)
    await load({ silent: true })
  }

  const reservationGroups = reservations.reduce<{ date: string; items: Reservation[] }[]>((groups, reservation) => {
    const date = reservation.date.split('T')[0]
    const last = groups[groups.length - 1]
    if (last?.date === date) last.items.push(reservation)
    else groups.push({ date, items: [reservation] })
    return groups
  }, [])

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">予約管理 - 農部生協</h1>

      <div className="admin-card">
        <div className="filter-row">
          <DatePicker value={dateFilter} onChange={setDateFilter} clearable />
          <select className="text-input w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
            <option value="">全ステータス</option>
            <option value="pending">抽選待ち</option>
            <option value="confirmed">抽選確定</option>
            <option value="cancelled">キャンセル済み</option>
          </select>
          <input type="text" className="text-input flex-1" placeholder="バンド名で検索" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="btn-outline w-auto px-3 py-2"
            onClick={() => { setDateFilter(''); setStatusFilter(''); setSearch('') }}>
            クリア
          </button>
        </div>
      </div>

      {error && <div className="banner-error">{error}</div>}
      {loading ? (
        <div className="bg-surface border border-line rounded-xl overflow-hidden shadow-[var(--shadow-card-sm)]">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex gap-4 px-4 py-3 border-b border-line items-center last:border-b-0">
              <Skeleton width="80px" height="38px" />
              <Skeleton width="120px" height="20px" />
              <div className="flex items-center gap-2 flex-1">
                <Skeleton width={24} height={24} circle />
                <Skeleton width="80px" height="14px" />
              </div>
              <Skeleton width="80px" height="22px" style={{ borderRadius: 20 }} />
              <Skeleton width="24px" height="14px" />
              <Skeleton width="76px" height="32px" />
            </div>
          ))}
        </div>
      ) : reservations.length === 0 ? (
        <div className="empty-state">
          <span className="icon icon-xl text-ink-pale">event_busy</span>
          <span className="text-[0.9rem]">該当する予約がありません</span>
        </div>
      ) : (
        <>
        {/* Desktop */}
        <div className="hidden lg:flex flex-col gap-4">
          {reservationGroups.map((group) => (
            <section key={group.date} className="bg-surface border border-line rounded-xl overflow-hidden shadow-[var(--shadow-card-sm)]">
              <div ref={(el) => { desktopDateRefs.current[group.date] = el }} className="flex items-center justify-between px-5 py-3 bg-bg border-b border-line">
                <div className="flex items-center gap-2 font-bold text-ink">
                  <span className="icon icon-sm text-ink-pale">event</span>
                  {formatDateHeading(group.date)}
                </div>
                <span className="text-[0.78rem] font-semibold text-ink-sub">{group.items.length}件</span>
              </div>
              <table className="admin-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                <colgroup>
                  <col style={{ width: '150px' }} />
                  <col />
                  <col style={{ width: '200px' }} />
                  <col style={{ width: '130px' }} />
                  <col style={{ width: '70px' }} />
                  <col style={{ width: '100px' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>時間</th>
                    <th>バンド名</th>
                    <th>登録者</th>
                    <th className="text-right">ステータス</th>
                    <th className="text-right">順位</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((r) => {
                const [, timePart] = r.date.split('T')
                return (
                  <tr
                    key={r.id}
                    ref={(el) => { desktopRowRefs.current[r.id] = el }}
                    className={highlightedId === r.id ? 'row-highlight' : ''}
                  >
                    <td data-label="時間">
                      <div>
                        <div className="text-[0.8rem] text-ink-sub">{timePart}</div>
                      </div>
                    </td>
                    <td data-label="バンド名">{r.bandName}</td>
                    <td data-label="登録者">
                      <div className="flex items-center gap-2">
                        {r.userPictureUrl
                          ? <img src={r.userPictureUrl} alt="" className="avatar avatar-sm" />
                          : <span className="avatar-fallback avatar-sm"><span className="icon icon-sm">account_circle</span></span>}
                        <span className="text-[0.85rem]">{r.userDisplayName || '(不明)'}</span>
                      </div>
                    </td>
                    <td data-label="ステータス" className="text-right">
                      <span className={'badge ' + statusBadgeClass(r.status)}>
                        <span className="icon icon-sm">
                          {statusIcon(r.status)}
                        </span>
                        {statusLabel(r.status)}
                      </span>
                    </td>
                    <td data-label="順位" className="text-right">{r.order ?? '-'}</td>
                    <td className="cell-actions">
                      <div className="flex gap-1.5">
                        {r.status !== 'cancelled' && (
                          <>
                            <button className="btn-icon" onClick={() => setEditing(r)}>
                              <span className="icon">edit</span>
                            </button>
                            <button className="btn-icon-danger" onClick={() => setDeleteTarget(r)} title="キャンセル">
                              <span className="icon">cancel</span>
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
                </tbody>
              </table>
            </section>
          ))}
        </div>

        {/* Mobile accordion */}
        <div className="lg:hidden bg-surface border border-line rounded-xl overflow-hidden shadow-[var(--shadow-card-sm)]">
          {reservationGroups.map((group) => (
            <div key={group.date}>
              <div ref={(el) => { mobileDateRefs.current[group.date] = el }} className="bg-bg px-4 py-2 text-[0.82rem] font-bold text-ink-sub border-b border-line">
                {formatDateHeading(group.date)}
              </div>
              {group.items.map((r) => (
                <ReservationMobileCard
                  key={r.id}
                  r={r}
                  highlighted={highlightedId === r.id}
                  rowRef={(el) => { mobileRowRefs.current[r.id] = el }}
                  open={openId === r.id}
                  onToggle={() => setOpenId(openId === r.id ? null : r.id)}
                  onEdit={() => setEditing(r)}
                  onDelete={() => setDeleteTarget(r)}
                />
              ))}
            </div>
          ))}
        </div>
        </>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="予約をキャンセルしますか？"
          message={`「${deleteTarget.bandName}」(${deleteTarget.date}) をキャンセルします。予約はキャンセル済みとして履歴に残ります。`}
          confirmLabel="実行する"
          cancelLabel="戻る"
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => execDelete(deleteTarget)}
        />
      )}

      {editing && (
        <EditModal
          reservation={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load({ silent: true }) }}
        />
      )}
    </div>
  )
}

function statusBadgeClass(status: Reservation['status']) {
  if (status === 'confirmed') return 'badge-confirmed'
  if (status === 'cancelled') return 'badge-neutral'
  return 'badge-pending'
}

function statusIcon(status: Reservation['status']) {
  if (status === 'confirmed') return 'check_circle'
  if (status === 'cancelled') return 'cancel'
  return 'hourglass_empty'
}

function statusLabel(status: Reservation['status']) {
  if (status === 'confirmed') return '確定'
  if (status === 'cancelled') return 'キャンセル済み'
  return '抽選待ち'
}

function ReservationMobileCard({
  r, highlighted, rowRef, open, onToggle, onEdit, onDelete,
}: {
  r: Reservation
  highlighted: boolean
  rowRef: (el: HTMLDivElement | null) => void
  open: boolean
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const [datePart, timePart] = r.date.split('T')

  return (
    <div
      ref={rowRef}
      className={`border-b border-line last:border-b-0 ${highlighted ? 'row-highlight' : ''}`}
    >
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left bg-transparent border-0 cursor-pointer hover:bg-[#fafbfc] transition-colors"
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-[0.9rem] truncate">{r.bandName}</span>
            <span className={'badge shrink-0 ' + statusBadgeClass(r.status)}>
              <span className="icon icon-sm">{statusIcon(r.status)}</span>
              {statusLabel(r.status)}
            </span>
          </div>
          <div className="text-[0.8rem] text-ink-sub mt-0.5">{datePart}　{timePart}</div>
        </div>
        <span className={`icon text-ink-pale transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
          expand_more
        </span>
      </button>

      <div className={`grid transition-all duration-200 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden min-h-0">
          <div className="px-4 pb-3 border-t border-line bg-bg">
            <div className="flex items-center justify-between py-2 border-b border-line">
              <span className="text-[0.72rem] text-ink-sub font-semibold uppercase tracking-wide">登録者</span>
              <div className="flex items-center gap-2">
                {r.userPictureUrl
                  ? <img src={r.userPictureUrl} alt="" className="avatar avatar-sm" />
                  : <span className="avatar-fallback avatar-sm"><span className="icon icon-sm">account_circle</span></span>}
                <span className="text-[0.85rem]">{r.userDisplayName || '(不明)'}</span>
              </div>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-[0.72rem] text-ink-sub font-semibold uppercase tracking-wide">順位</span>
              <span className="text-[0.9rem]">{r.order ?? '-'}</span>
            </div>
            <div className="flex gap-2 pt-2">
              {r.status !== 'cancelled' && (
                <>
                  <button className="btn-outline py-1.5 text-[0.85rem]" onClick={onEdit}>
                    <span className="icon icon-sm">edit</span> 編集
                  </button>
                  <button className="btn-icon-danger" onClick={onDelete} title="キャンセル">
                    <span className="icon">cancel</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function EditModal({
  reservation, onClose, onSaved,
}: {
  reservation: Reservation
  onClose: () => void
  onSaved: () => void
}) {
  const [bandName, setBandName] = useState(reservation.bandName)
  const [datePart, timePart] = reservation.date.split('T')
  const [date, setDate] = useState(datePart)
  const [time, setTime] = useState(timePart)
  const [dateOptions, setDateOptions] = useState<DateOption[]>([])
  const [loadingDates, setLoadingDates] = useState(false)
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoadingDates(true)
    setErr(null)
    adminFetch('/api/admin/settings/available-dates')
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error ?? '日付候補の取得に失敗しました')
        if (!alive) return
        const dates = Array.isArray(data.dates) ? data.dates : []
        setDateOptions(dates)
        if (dates.length > 0 && !dates.some((d: DateOption) => d.value === date)) {
          setDate(dates[0].value)
        } else if (dates.length === 0) {
          setDate('')
        }
      })
      .catch((e: any) => {
        if (!alive) return
        setDateOptions([])
        setDate('')
        setErr(e.message ?? '日付候補の取得に失敗しました')
      })
      .finally(() => {
        if (alive) setLoadingDates(false)
      })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!date) {
      setTimeSlots([])
      setTime('')
      return
    }
    let alive = true
    setLoadingSlots(true)
    setErr(null)
    adminFetch(`/api/admin/settings/time-slots?date=${encodeURIComponent(date)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error ?? '時間枠の取得に失敗しました')
        if (!alive) return
        const slots = Array.isArray(data.timeSlots) ? data.timeSlots : []
        setTimeSlots(slots)
        if (slots.length > 0 && !slots.some((slot: TimeSlot) => slot.value === time)) {
          setTime(slots[0].value)
        } else if (slots.length === 0) {
          setTime('')
        }
      })
      .catch((e: any) => {
        if (!alive) return
        setTimeSlots([])
        setTime('')
        setErr(e.message ?? '時間枠の取得に失敗しました')
      })
      .finally(() => {
        if (alive) setLoadingSlots(false)
      })
    return () => { alive = false }
  }, [date])

  async function save() {
    setSaving(true)
    setErr(null)
    try {
      const res = await adminFetch(`/api/admin/reservations/${reservation.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bandName, date: `${date}T${time}` }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '保存に失敗しました')
      onSaved()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold m-0">予約を編集</h2>
          <button className="btn-icon-close" onClick={onClose} aria-label="閉じる">
            <span className="icon">close</span>
          </button>
        </div>
        {err && <div className="banner-error">{err}</div>}
        <div className="form-row">
          <label>バンド名</label>
          <input className="text-input" value={bandName} onChange={(e) => setBandName(e.target.value)} />
        </div>
        <div className="form-row">
          <label>日付</label>
          <select
            className="text-input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={loadingDates || dateOptions.length === 0}
          >
            {dateOptions.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
            {dateOptions.length === 0 && (
              <option value="">
                {loadingDates ? '日付候補を読み込み中...' : '選択できる日付がありません'}
              </option>
            )}
          </select>
        </div>
        <div className="form-row">
          <label>時間帯</label>
          <select
            className="text-input"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            disabled={loadingSlots || timeSlots.length === 0}
          >
            {timeSlots.map((slot) => (
              <option key={slot.value} value={slot.value}>
                {slot.label || slot.value.replace('-', '〜')}
              </option>
            ))}
            {timeSlots.length === 0 && (
              <option value="">
                {loadingSlots ? '時間枠を読み込み中...' : '選択できる時間枠がありません'}
              </option>
            )}
          </select>
        </div>
        <div className="mt-4">
          <button className="btn-primary" onClick={save} disabled={saving || loadingDates || loadingSlots || dateOptions.length === 0 || timeSlots.length === 0 || !date || !time}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
