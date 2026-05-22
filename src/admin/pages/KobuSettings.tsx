import { useEffect, useState, useMemo, useCallback } from 'react'
import { useBlocker } from 'react-router-dom'
import { adminFetch } from '../auth'
import DateListEditor from '../components/DateListEditor'
import Skeleton from '../../components/Skeleton'

type KobuSettings = {
  availableDays:  number[]
  extraDates:     string[]
  excludedDates:  string[]
  openTime:       string
  closeTime:      string
}

const WEEK_DAYS = ['日', '月', '火', '水', '木', '金', '土']

function todayJST(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

const DEFAULTS: KobuSettings = {
  availableDays:  [0, 1, 2, 3, 4, 5, 6],
  extraDates:     [],
  excludedDates:  [],
  openTime:       '08:00',
  closeTime:      '20:00',
}

export default function KobuSettings() {
  const [current, setCurrent]               = useState<KobuSettings | null>(null)
  const [availableDays, setAvailableDays]   = useState<number[]>(DEFAULTS.availableDays)
  const [extraDates, setExtraDates]         = useState<string[]>([])
  const [excludedDates, setExcludedDates]   = useState<string[]>([])
  const [openTime, setOpenTime]             = useState('08:00')
  const [closeTime, setCloseTime]           = useState('20:00')
  const [saving, setSaving]                 = useState(false)
  const [message, setMessage]               = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    const res = await adminFetch('/api/admin/kobu-settings')
    if (!res.ok) { setMessage({ type: 'error', text: '設定の取得に失敗しました' }); return }
    const data = (await res.json()) as KobuSettings
    setCurrent(data)
    setAvailableDays(data.availableDays)
    setExtraDates(data.extraDates ?? [])
    setExcludedDates(data.excludedDates ?? [])
    setOpenTime(data.openTime ?? '08:00')
    setCloseTime(data.closeTime ?? '20:00')
  }

  function toggleDay(d: number) {
    setAvailableDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()
    )
  }

  const isDirty = useMemo(() => {
    if (!current) return false
    const sortedStr = (arr: string[]) => JSON.stringify([...arr].sort())
    return (
      JSON.stringify(availableDays) !== JSON.stringify(current.availableDays) ||
      sortedStr(extraDates)         !== sortedStr(current.extraDates ?? []) ||
      sortedStr(excludedDates)      !== sortedStr(current.excludedDates ?? []) ||
      openTime  !== current.openTime  ||
      closeTime !== current.closeTime
    )
  }, [current, availableDays, extraDates, excludedDates, openTime, closeTime])

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (isDirty) e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  const blocker = useBlocker(
    useCallback(({ currentLocation, nextLocation }: { currentLocation: { pathname: string }; nextLocation: { pathname: string } }) =>
      isDirty && currentLocation.pathname !== nextLocation.pathname,
    [isDirty])
  )

  const hasDateOverlap = extraDates.some((d) => excludedDates.includes(d))

  async function save() {
    setMessage(null)
    if (openTime >= closeTime) {
      setMessage({ type: 'error', text: '開始時刻は終了時刻より前にしてください' })
      return
    }
    if (hasDateOverlap) {
      setMessage({ type: 'error', text: '同じ日付が追加日と除外日の両方に指定されています' })
      return
    }
    setSaving(true)
    try {
      const res = await adminFetch('/api/admin/kobu-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ availableDays, extraDates, excludedDates, openTime, closeTime }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '保存に失敗しました')
      setMessage({ type: 'success', text: '保存しました' })
      load()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  if (!current) return (
    <div>
      <Skeleton width="200px" height="28px" className="mb-6" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="admin-card">
          <Skeleton width="40%" height="20px" className="mb-3" />
          <Skeleton width="100%" height="60px" />
        </div>
      ))}
    </div>
  )

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">設定 - 工部室</h1>

      {message && (
        <div className={message.type === 'success' ? 'banner-success' : 'banner-error'}>
          {message.text}
        </div>
      )}

      <div className="admin-card">
        <h2 className="text-base font-bold mb-3">利用可能曜日</h2>
        <div className="flex gap-2 flex-wrap">
          {WEEK_DAYS.map((label, i) => {
            const selected = availableDays.includes(i)
            return (
              <label key={i}
                className={
                  'flex items-center justify-center w-12 h-12 rounded-full border-2 font-semibold cursor-pointer transition select-none ' +
                  (selected ? 'bg-brand border-brand text-white' : 'bg-[#fafafa] border-line hover:border-brand')
                }>
                <input type="checkbox" checked={selected} onChange={() => toggleDay(i)} className="hidden" />
                {label}
              </label>
            )
          })}
        </div>
      </div>

      <div className="admin-card">
        <h2 className="text-base font-bold mb-3">営業時間</h2>
        <div className="flex items-center gap-3">
          <input type="time" className="text-input w-auto" value={openTime}
            onChange={(e) => setOpenTime(e.target.value)} />
          <span className="text-ink-sub">〜</span>
          <input type="time" className="text-input w-auto" value={closeTime}
            onChange={(e) => setCloseTime(e.target.value)} />
        </div>
        {openTime >= closeTime && (
          <p className="mt-2 text-danger text-[0.85rem]">
            <span className="icon icon-sm align-middle">error</span>
            {' '}開始時刻は終了時刻より前にしてください
          </p>
        )}
      </div>

      <div className="admin-card">
        <h2 className="text-base font-bold mb-3">追加日</h2>
        <p className="text-[0.85rem] text-ink-sub mb-3">
          上記の曜日に該当しない日でも、ここに追加した日は予約可能になります。
        </p>
        <DateListEditor dates={extraDates} onChange={setExtraDates} min={todayJST()} emptyText="追加日なし" />
      </div>

      <div className="admin-card">
        <h2 className="text-base font-bold mb-3">除外日</h2>
        <p className="text-[0.85rem] text-ink-sub mb-3">
          通常は予約可能曜日でも、ここに登録した日は予約できなくなります（祝日や臨時休業など）。
        </p>
        <DateListEditor dates={excludedDates} onChange={setExcludedDates} min={todayJST()} emptyText="除外日なし" />
        {hasDateOverlap && (
          <p className="mt-2 text-danger text-[0.85rem]">
            <span className="icon icon-sm align-middle">warning</span>
            {' '}同じ日付が追加日と除外日の両方に指定されています
          </p>
        )}
      </div>

      <button className="btn-primary max-w-[300px]" onClick={save} disabled={saving}>
        {saving ? '保存中...' : '保存'}
      </button>

      {blocker.state === 'blocked' && (
        <div className="modal-backdrop" onClick={() => blocker.reset()}>
          <div className="modal-card max-w-[360px]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <span className="icon text-warn" style={{ fontSize: 28 }}>warning</span>
              <h2 className="text-base font-bold m-0">未保存の変更があります</h2>
            </div>
            <p className="text-[0.9rem] text-ink-sub mb-4">
              保存せずにページを離れると、変更内容が失われます。
            </p>
            <div className="flex gap-2">
              <button className="btn-outline flex-1" onClick={() => blocker.reset()}>留まる</button>
              <button className="btn-danger flex-1" onClick={() => blocker.proceed()}>離れる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
