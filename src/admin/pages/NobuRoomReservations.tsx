import { useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { adminFetch } from '../auth'
import Skeleton from '../../components/Skeleton'
import ConfirmDialog from '../../components/ConfirmDialog'
import DatePicker from '../../components/DatePicker'

type DateOption = { label: string; value: string }
type TimeSlot = { label: string; value: string }

type NobuRoomReservation = {
  id: string
  userId: string
  userDisplayName: string
  userPictureUrl: string | null
  bandName: string
  date: string
  startTime: string
  endTime: string
  status: 'confirmed'
  createdAt: number | null
}

function formatDateHeading(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const weekdays = ['日', '月', '火', '水', '木', '金', '土']
  return `${date} (${weekdays[new Date(year, month - 1, day).getDay()]})`
}

export default function NobuRoomReservations() {
  const [searchParams, setSearchParams] = useSearchParams()
  const focusId = searchParams.get('focus')
  const dateFocus = searchParams.get('dateFocus')
  const rowRefs = useRef<Record<string, HTMLElement | null>>({})
  const desktopDateRefs = useRef<Record<string, HTMLElement | null>>({})
  const mobileDateRefs = useRef<Record<string, HTMLElement | null>>({})

  const [reservations, setReservations] = useState<NobuRoomReservation[]>([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)
  const [dateFilter, setDateFilter]     = useState('')
  const [search, setSearch]             = useState('')
  const [editing,       setEditing]       = useState<NobuRoomReservation | null>(null)
  const [deleteTarget,  setDeleteTarget]  = useState<NobuRoomReservation | null>(null)
  const [openId,        setOpenId]        = useState<string | null>(null)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (dateFilter) params.set('date', dateFilter)
      if (search)     params.set('q', search)
      const res = await adminFetch(`/api/admin/nobu-room-reservations?${params}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? '取得に失敗しました')
      }
      const data = await res.json()
      setReservations(data.reservations)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [dateFilter, search])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (reservations.length === 0) return
    if (focusId) {
      const row = rowRefs.current[focusId]
      if (!row) return
      row.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setHighlightedId(focusId)
      const t = setTimeout(() => {
        setHighlightedId(null)
        setSearchParams({}, { replace: true })
      }, 3000)
      return () => clearTimeout(t)
    }
    if (dateFocus) {
      const isDesktop = window.matchMedia('(min-width: 768px)').matches
      const heading = (isDesktop ? desktopDateRefs.current : mobileDateRefs.current)[dateFocus]
      if (!heading) return
      heading.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setSearchParams({}, { replace: true })
    }
  }, [focusId, dateFocus, reservations, setSearchParams])

  async function execDelete(r: NobuRoomReservation) {
    const res = await adminFetch(`/api/admin/nobu-room-reservations/${r.id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('削除に失敗しました')
    setReservations((prev) => prev.filter((x) => x.id !== r.id))
    setDeleteTarget(null)
  }

  const reservationGroups = reservations.reduce<{ date: string; items: NobuRoomReservation[] }[]>((groups, reservation) => {
    const last = groups[groups.length - 1]
    if (last?.date === reservation.date) last.items.push(reservation)
    else groups.push({ date: reservation.date, items: [reservation] })
    return groups
  }, [])

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">予約管理 - 農部室</h1>

      <div className="admin-card">
        <div className="filter-row">
          <DatePicker value={dateFilter} onChange={setDateFilter} clearable />
          <input type="text" className="text-input flex-1" placeholder="バンド名で検索"
            value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="btn-outline w-auto px-3 py-2"
            onClick={() => { setDateFilter(''); setSearch('') }}>
            クリア
          </button>
        </div>
      </div>

      {error && <div className="banner-error">{error}</div>}

      {loading ? (
        <div className="bg-surface border border-line rounded-xl overflow-hidden shadow-[var(--shadow-card-sm)]">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex gap-4 px-4 py-3 border-b border-line items-center last:border-b-0">
              <Skeleton width="100px" height="38px" />
              <Skeleton width="120px" height="20px" />
              <div className="flex items-center gap-2 flex-1">
                <Skeleton width={24} height={24} circle />
                <Skeleton width="80px" height="14px" />
              </div>
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
          <div className="hidden md:flex flex-col gap-4">
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
                    <col style={{ width: '180px' }} />
                    <col />
                    <col style={{ width: '220px' }} />
                    <col style={{ width: '100px' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>時間帯</th>
                      <th>バンド名</th>
                      <th>登録者</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((r) => (
                      <tr key={r.id}
                        ref={(el) => { rowRefs.current[r.id] = el }}
                        className={highlightedId === r.id ? 'row-highlight' : ''}
                      >
                        <td data-label="時間帯">
                          <span className="text-[0.85rem] font-mono">{r.startTime}〜{r.endTime}</span>
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
                        <td className="cell-actions">
                          <div className="flex gap-1.5">
                            <button className="btn-icon" onClick={() => setEditing(r)}>
                              <span className="icon">edit</span>
                            </button>
                            <button className="btn-icon-danger" onClick={() => setDeleteTarget(r)}>
                              <span className="icon">delete</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
          </div>

          {/* Mobile */}
          <div className="md:hidden bg-surface border border-line rounded-xl overflow-hidden shadow-[var(--shadow-card-sm)]">
            {reservationGroups.map((group) => (
              <div key={group.date}>
                <div ref={(el) => { mobileDateRefs.current[group.date] = el }} className="bg-bg px-4 py-2 text-[0.82rem] font-bold text-ink-sub border-b border-line">
                  {formatDateHeading(group.date)}
                </div>
                {group.items.map((r) => (
                  <NobuRoomMobileCard key={r.id} r={r}
                    highlighted={highlightedId === r.id}
                    rowRef={(el) => { rowRefs.current[r.id] = el }}
                    open={openId === r.id}
                    onToggle={() => setOpenId(openId === r.id ? null : r.id)}
                    onEdit={() => setEditing(r)} onDelete={() => setDeleteTarget(r)} />
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="予約を削除しますか？"
          message={`「${deleteTarget.bandName}」(${deleteTarget.date} ${deleteTarget.startTime}〜${deleteTarget.endTime}) を削除します。この操作は取り消せません。`}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => execDelete(deleteTarget)}
        />
      )}

      {editing && (
        <NobuRoomEditModal
          reservation={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
    </div>
  )
}

function NobuRoomMobileCard({ r, highlighted, rowRef, open, onToggle, onEdit, onDelete }: {
  r: NobuRoomReservation; highlighted: boolean; rowRef: (el: HTMLElement | null) => void
  open: boolean; onToggle: () => void; onEdit: () => void; onDelete: () => void
}) {
  return (
    <div ref={rowRef} className={`border-b border-line last:border-b-0 ${highlighted ? 'row-highlight' : ''}`}>
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left bg-transparent border-0 cursor-pointer hover:bg-[#fafbfc] transition-colors"
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0">
          <div className="font-medium text-[0.9rem] truncate">{r.bandName}</div>
          <div className="text-[0.8rem] text-ink-sub mt-0.5">
            {r.date}　{r.startTime}〜{r.endTime}
          </div>
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
            <div className="flex gap-2 pt-3">
              <button className="btn-outline py-1.5 text-[0.85rem]" onClick={onEdit}>
                <span className="icon icon-sm">edit</span> 編集
              </button>
              <button className="btn-icon-danger" onClick={onDelete}>
                <span className="icon">delete</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function NobuRoomEditModal({ reservation, onClose, onSaved }: {
  reservation: NobuRoomReservation; onClose: () => void; onSaved: () => void
}) {
  const [bandName,  setBandName]  = useState(reservation.bandName)
  const [date,      setDate]      = useState(reservation.date)
  const [startTime, setStartTime] = useState(reservation.startTime)
  const [endTime,   setEndTime]   = useState(reservation.endTime)
  const [dateOptions, setDateOptions] = useState<DateOption[]>([])
  const [loadingDates, setLoadingDates] = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [err,       setErr]       = useState<string | null>(null)
  const [sameDay,   setSameDay]   = useState<NobuRoomReservation[]>([])
  const [loadingSameDay, setLoadingSameDay] = useState(false)
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)

  const timeOptions = buildTimeOptions(timeSlots)

  useEffect(() => {
    let alive = true
    setLoadingDates(true)
    setErr(null)
    adminFetch('/api/admin/nobu-room-settings/available-dates')
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
      setSameDay([])
      return
    }
    setLoadingSameDay(true)
    adminFetch(`/api/admin/nobu-room-reservations?date=${date}`)
      .then((r) => r.ok ? r.json() : { reservations: [] })
      .then((data) => setSameDay((data.reservations ?? []).filter((r: NobuRoomReservation) => r.id !== reservation.id)))
      .catch(() => setSameDay([]))
      .finally(() => setLoadingSameDay(false))
  }, [date, reservation.id])

  useEffect(() => {
    if (!date) {
      setTimeSlots([])
      return
    }
    let alive = true
    setLoadingSlots(true)
    adminFetch(`/api/admin/nobu-room-settings/time-slots?date=${encodeURIComponent(date)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error ?? '時間枠の取得に失敗しました')
        if (!alive) return
        const slots = Array.isArray(data.timeSlots) ? data.timeSlots : []
        setTimeSlots(slots)
        if (slots.length === 0) {
          setStartTime('')
          setEndTime('')
        } else if (!rangeFitsInSlot(startTime, endTime, slots)) {
          const [nextStart, nextEnd] = slots[0].value.split('-')
          setStartTime(nextStart)
          setEndTime(nextEnd)
        }
      })
      .catch((e: any) => {
        if (!alive) return
        setTimeSlots([])
        setErr(e.message ?? '時間枠の取得に失敗しました')
      })
      .finally(() => {
        if (alive) setLoadingSlots(false)
      })
    return () => { alive = false }
  }, [date])

  const conflict = sameDay.find((r) => timesOverlap(startTime, endTime, r.startTime, r.endTime))
  const fitsInSlot = rangeFitsInSlot(startTime, endTime, timeSlots)

  function isStartBlocked(t: string) { return sameDay.some((r) => timesOverlap(t, endTime, r.startTime, r.endTime)) }
  function isEndBlocked(t: string)   { return sameDay.some((r) => timesOverlap(startTime, t, r.startTime, r.endTime)) }

  async function save() {
    if (conflict) return
    setSaving(true)
    setErr(null)
    try {
      const res = await adminFetch(`/api/admin/nobu-room-reservations/${reservation.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bandName, date, startTime, endTime }),
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
          <h2 className="text-base font-bold m-0">農部室予約を編集</h2>
          <button className="btn-icon-close" onClick={onClose} aria-label="閉じる">
            <span className="icon">close</span>
          </button>
        </div>
        {err && <div className="banner-error">{err}</div>}
        {conflict && !err && (
          <div className="banner-warn">
            {conflict.startTime}〜{conflict.endTime}（{conflict.bandName}）と重複しています
          </div>
        )}
        {!conflict && !fitsInSlot && !loadingSlots && !err && (
          <div className="banner-warn">選択した時間帯は予約可能時間外です</div>
        )}
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
          <label>開始時刻</label>
          <select className="text-input" value={startTime} onChange={(e) => setStartTime(e.target.value)}
            disabled={loadingSlots || timeOptions.length === 0}>
            {timeOptions.slice(0, -1).map((t) => (
              <option key={t} value={t} disabled={isStartBlocked(t) || !canUseStart(t, endTime, timeSlots)}>{t}</option>
            ))}
            {timeOptions.length === 0 && <option value="">選択できる時刻がありません</option>}
          </select>
        </div>
        <div className="form-row">
          <label>終了時刻</label>
          <select className="text-input" value={endTime} onChange={(e) => setEndTime(e.target.value)}
            disabled={loadingSlots || timeOptions.length === 0}>
            {timeOptions.slice(1).map((t) => (
              <option key={t} value={t} disabled={t <= startTime || isEndBlocked(t) || !canUseEnd(startTime, t, timeSlots)}>{t}</option>
            ))}
            {timeOptions.length === 0 && <option value="">選択できる時刻がありません</option>}
          </select>
        </div>
        <div className="mt-4">
          <button className="btn-primary" onClick={save}
            disabled={saving || loadingDates || loadingSlots || loadingSameDay || dateOptions.length === 0 || timeOptions.length === 0 || !date || !bandName.trim() || startTime >= endTime || !fitsInSlot || !!conflict}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function minutesToTime(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

function buildTimeOptions(slots: TimeSlot[]): string[] {
  const options = new Set<string>()
  for (const slot of slots) {
    const [start, end] = slot.value.split('-')
    for (let cur = toMinutes(start); cur <= toMinutes(end); cur += 15) {
      options.add(minutesToTime(cur))
    }
  }
  return [...options].sort()
}

function timesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  return toMinutes(startA) < toMinutes(endB) && toMinutes(startB) < toMinutes(endA)
}

function rangeFitsInSlot(startTime: string, endTime: string, slots: TimeSlot[]): boolean {
  if (!startTime || !endTime || startTime >= endTime) return false
  const start = toMinutes(startTime)
  const end = toMinutes(endTime)
  return slots.some((slot) => {
    const [slotStart, slotEnd] = slot.value.split('-')
    return start >= toMinutes(slotStart) && end <= toMinutes(slotEnd)
  })
}

function canUseStart(startTime: string, endTime: string, slots: TimeSlot[]): boolean {
  if (!endTime || startTime >= endTime) return true
  return rangeFitsInSlot(startTime, endTime, slots)
}

function canUseEnd(startTime: string, endTime: string, slots: TimeSlot[]): boolean {
  if (!startTime || startTime >= endTime) return false
  return rangeFitsInSlot(startTime, endTime, slots)
}
