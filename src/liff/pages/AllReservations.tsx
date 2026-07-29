import { useState, useEffect, useRef } from 'react'
import type { LiffProfile } from '../LiffApp'
import Skeleton from '../../components/Skeleton'
import { getPageCache, setPageCache } from '../pageCache'

const DATES_CACHE_KEY = 'liff:nobu-settings'
function slotCacheKey(date: string) { return `liff:nobu-slots:${date}` }

type TimeSlot    = { label: string; value: string }
type DateEntry   = { label: string; value: string; timeSlots: TimeSlot[]; lotteryTime?: string }
type SlotEntry   = { id: string; userId: string; bandName: string; status: string; order?: number; hamoani?: boolean }
type TimeSlotMap = { [timeSlot: string]: SlotEntry[] }
type DetailModal = { entry: SlotEntry; date: string; timeSlot: string }

type Props = {
  profile?: LiffProfile | null
  initialFocus?: { id: string; date: string } | null
  onFocusHandled?: () => void
  onEditRequest?: (id: string) => void
}

export default function AllReservations({ profile, initialFocus, onFocusHandled, onEditRequest }: Props) {
  const cachedDates   = getPageCache<DateEntry[]>(DATES_CACHE_KEY) ?? []
  const initDate      = cachedDates[0]?.value ?? ''
  const initSlotMap   = initDate ? (getPageCache<TimeSlotMap>(slotCacheKey(initDate)) ?? null) : null
  const currentDateRef = useRef(initDate)
  const entryRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  const [dates,        setDates]        = useState<DateEntry[]>(cachedDates)
  const [selectedDate, setSelectedDate] = useState(initDate)
  const [slotMap,      setSlotMap]      = useState<TimeSlotMap | null>(initSlotMap)
  const [loading,      setLoading]      = useState(!!initDate && !initSlotMap)
  const [error,        setError]        = useState<string | null>(null)
  const [detailModal,  setDetailModal]  = useState<DetailModal | null>(null)
  const [focusId,      setFocusId]      = useState<string | null>(null)

  useEffect(() => {
    if (!initialFocus) return
    setFocusId(initialFocus.id)
    if (initialFocus.date !== selectedDate) {
      handleDateSelect(initialFocus.date)
    }
  }, [initialFocus])

  useEffect(() => {
    if (!focusId || loading || !slotMap) return
    const el = entryRefs.current[focusId]
    if (!el) return
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      onFocusHandled?.()
      window.setTimeout(() => setFocusId(null), 1200)
    })
  }, [focusId, loading, slotMap, onFocusHandled])

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data) => {
        const available: DateEntry[] = data.availableDatesWithToday ?? []
        setDates(available)
        setPageCache(DATES_CACHE_KEY, available)
        if (available.length > 0 && !initDate) handleDateSelect(available[0].value)
      })
      .catch(() => setError('設定の取得に失敗しました'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedDateEntry = dates.find((d) => d.value === selectedDate)
  const timeSlotOrder = (selectedDateEntry?.timeSlots ?? []).map((t) => t.value)

  async function handleDateSelect(date: string) {
    setSelectedDate(date)
    currentDateRef.current = date
    const cached = getPageCache<TimeSlotMap>(slotCacheKey(date))
    if (cached) {
      setSlotMap(cached)
      setLoading(false)
      const authHeader = profile ? { Authorization: `Bearer ${profile.getAccessToken()}` } : {}
      fetch(`/api/reservations/all?date=${date}`, { headers: authHeader })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data && currentDateRef.current === date) {
            const sm = data.slotMap ?? {}
            setSlotMap(sm)
            setPageCache(slotCacheKey(date), sm)
          }
        })
        .catch(() => {})
      return
    }
    setSlotMap(null)
    setLoading(true)
    setError(null)
    try {
      const authHeader = profile ? { Authorization: `Bearer ${profile.getAccessToken()}` } : {}
      const res = await fetch(`/api/reservations/all?date=${date}`, { headers: authHeader })
      if (!res.ok) throw new Error()
      const data = await res.json()
      const sm = data.slotMap ?? {}
      setSlotMap(sm)
      setPageCache(slotCacheKey(date), sm)
    } catch {
      setError('取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const activeSlots = slotMap
    ? (() => {
        const known = timeSlotOrder.filter((ts) => slotMap[ts]?.length)
        const extra = Object.keys(slotMap).filter((ts) => !timeSlotOrder.includes(ts) && slotMap[ts]?.length).sort()
        return [...known, ...extra]
      })()
    : []

  const isOwn = (entry: SlotEntry) => !!profile && entry.userId === profile.userId

  return (
    <div>
      <p className="text-[1.05rem] font-bold mb-4 text-ink">全登録表示</p>

      {error && <div className="banner-error">{error}</div>}

      {/* 日付チップ（横スクロール） */}
      <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1 mb-4">
        {dates.map((d) => (
          <button
            key={d.value}
            onClick={() => handleDateSelect(d.value)}
            className={
              'flex-shrink-0 px-3.5 py-1.5 border-[1.5px] rounded-full text-[0.85rem] cursor-pointer transition whitespace-nowrap ' +
              (selectedDate === d.value
                ? 'bg-brand border-brand text-white font-semibold'
                : 'bg-[#fafafa] border-line text-ink-sub')
            }
          >
            {d.label}
          </button>
        ))}
      </div>

      {selectedDateEntry?.lotteryTime && (
        <div className="flex items-center gap-1.5 text-[0.82rem] text-ink-sub -mt-2 mb-4 px-1">
          <span className="icon icon-sm text-brand">schedule</span>
          <span>抽選時刻 <strong className="text-ink">{selectedDateEntry.lotteryTime}</strong></span>
        </div>
      )}

      {loading && (
        <div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="mb-4">
              <Skeleton width="100px" height="14px" className="mb-2" />
              <Skeleton width="100%" height="40px" className="mb-1" />
              <Skeleton width="100%" height="40px" />
            </div>
          ))}
        </div>
      )}

      {slotMap && !loading && (
        activeSlots.length === 0
          ? (
            <div className="flex flex-col items-center gap-2 py-12 px-4 text-ink-pale text-center">
              <span className="icon icon-xl text-ink-pale">event_busy</span>
              <span className="text-[0.9rem]">この日の登録はまだありません</span>
            </div>
          )
          : activeSlots.map((ts) => (
            <div key={ts} className="mb-4">
              <div className="flex items-center gap-1.5 text-[0.8rem] font-bold text-ink-sub mb-1.5 px-1">
                <span className="icon icon-sm">schedule</span>
                <span>{ts}</span>
                <span className="ml-auto text-ink-pale font-normal">{slotMap[ts].length}件</span>
              </div>
              {slotMap[ts].map((entry, i) => (
                <button
                  key={entry.id}
                  ref={(el) => { entryRefs.current[entry.id] = el }}
                  className={
                    'flex items-center gap-2.5 px-3 py-2 bg-surface border rounded-lg mb-1 shadow-[var(--shadow-card-sm)] w-full text-left transition-colors ' +
                    (entry.id === focusId ? 'border-brand bg-brand-light/40' : 'border-line')
                  }
                  onClick={() => setDetailModal({ entry, date: selectedDate, timeSlot: ts })}
                >
                  {entry.status === 'confirmed' ? (
                    <div className="w-[22px] h-[22px] rounded-full bg-brand-light text-brand-dark text-[0.7rem] font-bold flex items-center justify-center flex-shrink-0">
                      {i + 1}
                    </div>
                  ) : (
                    <div className="w-1.5 h-1.5 rounded-full bg-ink-pale flex-shrink-0" />
                  )}
                  <span className="text-[0.9rem] text-ink font-medium flex-1 truncate">{entry.bandName}</span>
                  {entry.hamoani && (
                    <span className="text-[0.7rem] font-semibold text-brand bg-brand-light px-1.5 py-0.5 rounded-full shrink-0">
                      ハモアニ
                    </span>
                  )}
                  {isOwn(entry) && <span className="icon icon-sm text-ink-pale">chevron_right</span>}
                </button>
              ))}
            </div>
          ))
      )}

      {!selectedDate && !loading && (
        <div className="flex flex-col items-center gap-2 py-12 px-4 text-ink-pale text-center">
          <span className="icon icon-xl text-ink-pale">calendar_month</span>
          <span className="text-[0.9rem]">日付を選択してください</span>
        </div>
      )}

      {/* バンド詳細モーダル */}
      {detailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDetailModal(null)} />
          <div className="relative bg-surface rounded-2xl shadow-[var(--shadow-modal)] w-full max-w-[320px] overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-line">
              <p className="text-base font-bold text-ink">登録詳細</p>
              <button className="btn-icon-close" onClick={() => setDetailModal(null)}>
                <span className="icon">close</span>
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="flex items-center gap-2.5">
                <span className="icon text-brand" style={{ fontSize: 20 }}>groups</span>
                <span className="text-[0.95rem] font-semibold text-ink">{detailModal.entry.bandName}</span>
                {detailModal.entry.hamoani && (
                  <span className="text-[0.7rem] font-semibold text-brand bg-brand-light px-1.5 py-0.5 rounded-full shrink-0">
                    ハモアニ
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2.5">
                <span className="icon text-ink-pale" style={{ fontSize: 20 }}>calendar_today</span>
                <span className="text-[0.88rem] text-ink-sub">{detailModal.date.slice(5).replace('-', '/')}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="icon text-ink-pale" style={{ fontSize: 20 }}>schedule</span>
                <span className="text-[0.88rem] text-ink-sub">{detailModal.timeSlot}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="icon text-ink-pale" style={{ fontSize: 20 }}>
                  {detailModal.entry.status === 'confirmed' ? 'check_circle' : 'hourglass_empty'}
                </span>
                <span className="text-[0.88rem] text-ink-sub">
                  {detailModal.entry.status === 'confirmed' ? '抽選確定' : '抽選待ち'}
                </span>
              </div>
            </div>
            {isOwn(detailModal.entry) && onEditRequest && (
              <div className="px-5 pb-5">
                <button
                  className="btn-outline w-full flex items-center justify-center gap-1.5 py-2.5"
                  onClick={() => { setDetailModal(null); onEditRequest(detailModal.entry.id) }}
                >
                  <span className="icon" style={{ fontSize: 16 }}>edit</span>
                  編集
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
