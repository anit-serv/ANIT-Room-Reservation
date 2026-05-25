import { useEffect, useState, useMemo, useCallback } from 'react'
import { useBlocker } from 'react-router-dom'
import { adminFetch } from '../auth'
import TimeSlotsEditor, { findConflicts, type TimeSlot, type TimeSlotPreset } from '../components/TimeSlotsEditor'
import DateListEditor from '../components/DateListEditor'
import PerDayScheduleEditor, { findAllConflicts, type PerDaySchedule } from '../components/PerDayScheduleEditor'
import Skeleton from '../../components/Skeleton'

type KobuSettings = {
  availableDays:  number[]
  extraDates:     string[]
  excludedDates:  string[]
  timeSlots:      TimeSlot[]
  perDaySchedule: PerDaySchedule
}

const WEEK_DAYS = ['日', '月', '火', '水', '木', '金', '土']

function todayJST(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function emptySchedule(): PerDaySchedule {
  return { enabled: false, byWeekday: {}, byDate: {} }
}

export default function KobuSettings() {
  const [current, setCurrent]               = useState<KobuSettings | null>(null)
  const [availableDays, setAvailableDays]   = useState<number[]>([0,1,2,3,4,5,6])
  const [extraDates, setExtraDates]         = useState<string[]>([])
  const [excludedDates, setExcludedDates]   = useState<string[]>([])
  const [timeSlots, setTimeSlots]           = useState<TimeSlot[]>([])
  const [perDaySchedule, setPerDaySchedule] = useState<PerDaySchedule>(emptySchedule())
  const [saving, setSaving]                 = useState(false)
  const [message, setMessage]               = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [step,         setStep]         = useState<'editing' | 'confirming' | 'saved'>('editing')
  const [savedMessage, setSavedMessage] = useState('')
  const [presets, setPresets]           = useState<TimeSlotPreset[]>([])

  useEffect(() => { load(); loadPresets() }, [])

  async function loadPresets() {
    try {
      const res = await adminFetch('/api/admin/time-slot-presets')
      if (res.ok) setPresets((await res.json()).presets ?? [])
    } catch { /* ignore */ }
  }

  async function savePreset(name: string, slots: TimeSlot[]) {
    const res = await adminFetch('/api/admin/time-slot-presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, timeSlots: slots }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      alert(err.error ?? 'プリセットの保存に失敗しました')
      return
    }
    await loadPresets()
  }

  async function deletePreset(id: string) {
    const res = await adminFetch(`/api/admin/time-slot-presets/${id}`, { method: 'DELETE' })
    if (res.ok) await loadPresets()
  }

  async function load() {
    const res = await adminFetch('/api/admin/kobu-settings')
    if (!res.ok) { setMessage({ type: 'error', text: '設定の取得に失敗しました' }); return }
    const data = (await res.json()) as KobuSettings
    setCurrent(data)
    setAvailableDays(data.availableDays)
    setExtraDates(data.extraDates ?? [])
    setExcludedDates(data.excludedDates ?? [])
    setTimeSlots(data.timeSlots ?? [])
    setPerDaySchedule(data.perDaySchedule ?? emptySchedule())
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
      JSON.stringify(availableDays)  !== JSON.stringify(current.availableDays) ||
      sortedStr(extraDates)          !== sortedStr(current.extraDates ?? []) ||
      sortedStr(excludedDates)       !== sortedStr(current.excludedDates ?? []) ||
      JSON.stringify(timeSlots)      !== JSON.stringify(current.timeSlots ?? []) ||
      JSON.stringify(perDaySchedule) !== JSON.stringify(current.perDaySchedule ?? emptySchedule())
    )
  }, [current, availableDays, extraDates, excludedDates, timeSlots, perDaySchedule])

  const effectiveDirty = isDirty && step !== 'saved'

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (effectiveDirty) e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [effectiveDirty])

  const blocker = useBlocker(
    useCallback(({ currentLocation, nextLocation }: { currentLocation: { pathname: string }; nextLocation: { pathname: string } }) =>
      effectiveDirty && currentLocation.pathname !== nextLocation.pathname,
    [effectiveDirty])
  )

  const hasDateOverlap      = extraDates.some((d) => excludedDates.includes(d))
  const defaultConflicts    = findConflicts(timeSlots)
  const hasOverrideConflict = findAllConflicts(perDaySchedule)

  function goToConfirm() {
    setMessage(null)
    if (timeSlots.length === 0 || timeSlots.some((s) => !s.label.trim() || !s.value.trim())) {
      setMessage({ type: 'error', text: '営業時間枠を全て入力してください' })
      return
    }
    if (defaultConflicts.size > 0) {
      setMessage({ type: 'error', text: '営業時間枠が重複しています' })
      return
    }
    if (hasOverrideConflict) {
      setMessage({ type: 'error', text: '曜日/日付別の営業時間に未入力または重複があります' })
      return
    }
    if (hasDateOverlap) {
      setMessage({ type: 'error', text: '同じ日付が追加日と除外日の両方に指定されています' })
      return
    }
    setStep('confirming')
  }

  async function save() {
    setSaving(true)
    try {
      const res = await adminFetch('/api/admin/kobu-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ availableDays, extraDates, excludedDates, timeSlots, perDaySchedule }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '保存に失敗しました')
      setSavedMessage('設定は即時に反映されました')
      setStep('saved')
      load()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message })
      setStep('editing')
    } finally {
      setSaving(false)
    }
  }

  if (!current) return (
    <div>
      <Skeleton width="200px" height="28px" className="mb-6" />
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="admin-card">
          <Skeleton width="40%" height="20px" className="mb-3" />
          <Skeleton width="100%" height="60px" />
        </div>
      ))}
    </div>
  )

  if (step === 'confirming') return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <button className="btn-icon-nav" onClick={() => setStep('editing')} disabled={saving}>
          <span className="icon">arrow_back</span>
        </button>
        <h1 className="text-2xl font-bold">設定 - 工部室</h1>
      </div>
      <p className="text-[0.88rem] text-ink-sub mb-6 ml-11">保存内容の確認</p>

      <div className="admin-card">
        <table className="w-full text-[0.9rem]">
          <tbody>
            {([
              ['利用可能曜日', availableDays.length === 0 ? 'なし' : availableDays.map(d => WEEK_DAYS[d]).join('・')],
              ['営業時間枠',   `${timeSlots.length}件`],
              ['追加日',       `${extraDates.length}件`],
              ['除外日',       `${excludedDates.length}件`],
              ['曜日/日付別',  perDaySchedule.enabled ? '有効' : '無効'],
            ] as [string, string][]).map(([label, value]) => (
              <tr key={label} className="border-b border-line last:border-0">
                <td className="py-3 pr-4 text-ink-sub font-medium w-36 text-[0.88rem]">{label}</td>
                <td className="py-3 font-semibold text-ink">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {message && <div className="banner-error">{message.text}</div>}

      <div className="flex gap-3">
        <button className="btn-outline flex-1 max-w-[180px]" onClick={() => setStep('editing')} disabled={saving}>
          修正
        </button>
        <button className="btn-primary flex-1 max-w-[180px]" onClick={save} disabled={saving}>
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  )

  if (step === 'saved') return (
    <div>
      <h1 className="text-2xl font-bold mb-6">設定 - 工部室</h1>
      <div className="admin-card flex flex-col items-center text-center py-10">
        <div className="w-20 h-20 rounded-full bg-brand-light flex items-center justify-center mb-5">
          <span className="icon text-brand" style={{ fontSize: 44 }}>check_circle</span>
        </div>
        <h2 className="text-xl font-bold text-ink mb-2">保存が完了しました</h2>
        <p className="text-[0.9rem] text-ink-sub mb-8">{savedMessage}</p>
        <button className="btn-outline max-w-[240px]" onClick={() => { setStep('editing'); setMessage(null) }}>
          引き続き編集
        </button>
      </div>
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
        <h2 className="text-base font-bold mb-3">デフォルト営業時間枠</h2>
        <p className="text-[0.85rem] text-ink-sub mb-3">
          全ての日で使用される基本の営業時間枠です。曜日や日付別に上書きする場合は下の設定で。
        </p>
        <TimeSlotsEditor
          slots={timeSlots}
          onChange={setTimeSlots}
          conflictSet={defaultConflicts}
          presets={presets}
          onSavePreset={savePreset}
          onDeletePreset={deletePreset}
        />
        {defaultConflicts.size > 0 && (
          <div className="mt-2 text-danger text-[0.85rem]">
            <span className="icon icon-sm align-middle">warning</span>
            {' '}時間枠が重複しています
          </div>
        )}
      </div>

      <div className="admin-card">
        <h2 className="text-base font-bold mb-3">曜日・日付別の営業時間</h2>
        <PerDayScheduleEditor
          schedule={perDaySchedule}
          onChange={setPerDaySchedule}
          availableDays={availableDays}
          extraDates={extraDates}
          excludedDates={excludedDates}
          presets={presets}
          onSavePreset={savePreset}
          onDeletePreset={deletePreset}
        />
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

      <button className="btn-primary max-w-[300px]" onClick={goToConfirm}>
        確認する
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
