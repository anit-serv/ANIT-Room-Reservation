import { useEffect, useState, useMemo, useCallback } from 'react'
import { useBlocker } from 'react-router-dom'
import { adminFetch } from '../auth'
import TimeSlotsEditor, { findConflicts, toMinutes, type TimeSlot, type TimeSlotPreset } from '../components/TimeSlotsEditor'
import DateListEditor from '../components/DateListEditor'
import PerDayScheduleEditor, { findAllConflicts, type PerDaySchedule } from '../components/PerDayScheduleEditor'
import Skeleton from '../../components/Skeleton'

type SettingsCore = {
  availableDays: number[]
  timeSlots: TimeSlot[]
  extraDates: string[]
  excludedDates: string[]
  perDaySchedule: PerDaySchedule
}

type SettingsResponse = SettingsCore & {
  nextChange: (SettingsCore & { effectiveFrom: string }) | null
  lotteryTime: string
}

const WEEK_DAYS = ['日', '月', '火', '水', '木', '金', '土']

function todayJST(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function minEffectiveDate(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000)
  d.setUTCDate(d.getUTCDate() + 8)
  return d.toISOString().slice(0, 10)
}

function emptySchedule(): PerDaySchedule {
  return { enabled: false, byWeekday: {}, byDate: {} }
}

export default function Settings() {
  const [current, setCurrent]             = useState<SettingsResponse | null>(null)
  const [availableDays, setAvailableDays] = useState<number[]>([])
  const [timeSlots, setTimeSlots]         = useState<TimeSlot[]>([])
  const [extraDates, setExtraDates]       = useState<string[]>([])
  const [excludedDates, setExcludedDates] = useState<string[]>([])
  const [perDaySchedule, setPerDaySchedule] = useState<PerDaySchedule>(emptySchedule())
  const [effectiveFrom, setEffectiveFrom] = useState<string>(minEffectiveDate())
  const [minDate, setMinDate]             = useState<string>(minEffectiveDate())
  const [editingScheduled, setEditingScheduled] = useState(false)
  const [saving, setSaving]               = useState(false)
  const [message, setMessage]             = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [step,         setStep]         = useState<'editing' | 'confirming' | 'saved'>('editing')
  const [savedMessage, setSavedMessage] = useState('')
  const [presets, setPresets]             = useState<TimeSlotPreset[]>([])
  const [lotteryTime, setLotteryTime] = useState('21:00')

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

  useEffect(() => {
    function refresh() {
      const newMin = minEffectiveDate()
      setMinDate((prev) => prev !== newMin ? newMin : prev)
      setEffectiveFrom((prev) => prev < newMin ? newMin : prev)
    }
    const visHandler = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', visHandler)
    window.addEventListener('focus', refresh)
    const id = setInterval(refresh, 60_000)
    return () => {
      document.removeEventListener('visibilitychange', visHandler)
      window.removeEventListener('focus', refresh)
      clearInterval(id)
    }
  }, [])

  function applyToForm(s: SettingsCore) {
    setAvailableDays(s.availableDays)
    setTimeSlots(s.timeSlots)
    setExtraDates(s.extraDates ?? [])
    setExcludedDates(s.excludedDates ?? [])
    setPerDaySchedule(s.perDaySchedule ?? emptySchedule())
  }

  async function load() {
    const res = await adminFetch('/api/admin/settings')
    if (!res.ok) { setMessage({ type: 'error', text: '設定の取得に失敗しました' }); return }
    const data = (await res.json()) as SettingsResponse
    setCurrent(data)
    setLotteryTime(data.lotteryTime ?? '21:00')
    if (!editingScheduled) applyToForm(data)
  }

  function loadScheduledForEdit() {
    if (!current?.nextChange) return
    applyToForm(current.nextChange)
    setEffectiveFrom(current.nextChange.effectiveFrom)
    setEditingScheduled(true)
    setMessage(null)
  }

  function cancelEditScheduled() {
    if (!current) return
    applyToForm(current)
    setEffectiveFrom(minEffectiveDate())
    setEditingScheduled(false)
  }

  function toggleDay(d: number) {
    setAvailableDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()
    )
  }

  function computeLockoutTime(lt: string): string {
    const [h, m] = lt.split(':').map(Number)
    const total = h * 60 + m - 10
    if (total < 0) return '無効'
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  }

  const lotteryTimeInvalid = !lotteryTime || lotteryTime < '01:00'

  const isDirty = useMemo(() => {
    if (!current) return false
    const sortedStr = (arr: string[]) => JSON.stringify([...arr].sort())
    return (
      JSON.stringify(availableDays) !== JSON.stringify(current.availableDays ?? [3, 4, 6]) ||
      JSON.stringify(timeSlots)     !== JSON.stringify(current.timeSlots ?? []) ||
      sortedStr(extraDates)         !== sortedStr(current.extraDates ?? []) ||
      sortedStr(excludedDates)      !== sortedStr(current.excludedDates ?? []) ||
      JSON.stringify(perDaySchedule) !== JSON.stringify(current.perDaySchedule ?? emptySchedule()) ||
      lotteryTime !== (current.lotteryTime ?? '21:00')
    )
  }, [current, availableDays, timeSlots, extraDates, excludedDates, perDaySchedule, lotteryTime])

  const effectiveDirty = isDirty && step !== 'saved'

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (effectiveDirty) e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [effectiveDirty])

  const blocker = useBlocker(
    useCallback(({ currentLocation, nextLocation }: { currentLocation: { pathname: string }; nextLocation: { pathname: string } }) =>
      effectiveDirty && currentLocation.pathname !== nextLocation.pathname,
    [effectiveDirty])
  )

  const defaultConflicts = findConflicts(timeSlots)
  const hasOverrideConflict = findAllConflicts(perDaySchedule)
  const hasDateOverlap = extraDates.some((d) => excludedDates.includes(d))

  function goToConfirm() {
    setMessage(null)
    if (lotteryTimeInvalid) {
      setMessage({ type: 'error', text: '抽選時刻は01:00以降を指定してください' })
      return
    }
    if (availableDays.length === 0 && extraDates.length === 0) {
      setMessage({ type: 'error', text: '登録可能曜日か追加日を1つ以上指定してください' })
      return
    }
    if (timeSlots.length === 0 || timeSlots.some((s) => !s.label.trim() || !s.value.trim())) {
      setMessage({ type: 'error', text: 'デフォルト時間枠を全て入力してください' })
      return
    }
    if (timeSlots.some((s) => {
      const [a, b] = (s.value ?? '').split('-')
      return !a || !b || toMinutes(a) >= toMinutes(b)
    })) {
      setMessage({ type: 'error', text: '開始時刻は終了時刻より前にしてください' })
      return
    }
    if (defaultConflicts.size > 0) {
      setMessage({ type: 'error', text: 'デフォルト時間枠が重複しています' })
      return
    }
    if (hasOverrideConflict) {
      setMessage({ type: 'error', text: '曜日/日付別の時間枠に未入力または重複があります' })
      return
    }
    if (hasDateOverlap) {
      setMessage({ type: 'error', text: '同じ日付が追加日と除外日の両方に指定されています' })
      return
    }
    setStep('confirming')
  }

  async function save() {
    setMessage(null)
    const currentMin = minEffectiveDate()
    let finalEffective = effectiveFrom
    if (finalEffective < currentMin) {
      finalEffective = currentMin
      setEffectiveFrom(currentMin)
      setMinDate(currentMin)
      setMessage({ type: 'error', text: `日付が変わったため適用日を ${currentMin} に繰り上げました。内容を確認してもう一度「保存」を押してください` })
      return
    }

    setSaving(true)
    try {
      const [res, lotteryRes] = await Promise.all([
        adminFetch('/api/admin/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ availableDays, timeSlots, extraDates, excludedDates, perDaySchedule, effectiveFrom: finalEffective }),
        }),
        adminFetch('/api/admin/settings/lottery-time', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lotteryTime }),
        }),
      ])
      if (!res.ok) throw new Error((await res.json()).error ?? '保存に失敗しました')
      const lotteryJson = await lotteryRes.json()
      if (!lotteryRes.ok) throw new Error(lotteryJson.error ?? '抽選時刻の保存に失敗しました')
      const result = await res.json()
      setSavedMessage(
        lotteryJson.cronWarning
          ? `⚠️ cron-job.org: ${lotteryJson.cronWarning}`
          : `${result.effectiveFrom} から適用予定`
      )
      setEditingScheduled(false)
      setStep('saved')
      load()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message })
      setStep('editing')
    } finally {
      setSaving(false)
    }
  }

  async function cancelScheduled() {
    if (!confirm('予約済みの設定変更を取り消しますか？')) return
    const res = await adminFetch('/api/admin/settings/scheduled', { method: 'DELETE' })
    if (res.ok) {
      setMessage({ type: 'success', text: '予約済みの変更を取り消しました' })
      setEditingScheduled(false)
      load()
    } else {
      setMessage({ type: 'error', text: '取り消しに失敗しました' })
    }
  }

  if (!current) return (
    <div>
      <Skeleton width="160px" height="28px" className="mb-6" />
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
        <h1 className="text-2xl font-bold">設定 - 農部生協</h1>
      </div>
      <p className="text-[0.88rem] text-ink-sub mb-6 ml-11">保存内容の確認</p>

      <div className="admin-card">
        <table className="w-full text-[0.9rem]">
          <tbody>
            {([
              ['適用日',               effectiveFrom],
              ['登録可能曜日',          availableDays.length === 0 ? 'なし' : availableDays.map(d => WEEK_DAYS[d]).join('・')],
              ['抽選時刻',              lotteryTime],
              ['デフォルト時間枠',       `${timeSlots.length}件`],
              ['追加日',               `${extraDates.length}件`],
              ['除外日',               `${excludedDates.length}件`],
              ['曜日/日付別スケジュール', perDaySchedule.enabled ? '有効' : '無効'],
            ] as [string, string][]).map(([label, value]) => (
              <tr key={label} className="border-b border-line last:border-0">
                <td className="py-3 pr-4 text-ink-sub font-medium w-44 text-[0.88rem]">{label}</td>
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
      <h1 className="text-2xl font-bold mb-6">設定 - 農部生協</h1>
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
      <h1 className="text-2xl font-bold mb-6">設定 - 農部生協</h1>

      {message && (
        <div className={message.type === 'success' ? 'banner-success' : 'banner-error'}>
          {message.text}
        </div>
      )}

      {editingScheduled && (
        <div className="banner-warn">
          <span className="icon icon-sm align-middle">edit</span>
          {' '}適用予定の変更を編集中（保存すると上書きされます）
          <button className="btn-outline w-auto px-2.5 py-1 ml-3 text-[0.8rem]" onClick={cancelEditScheduled}>
            キャンセル
          </button>
        </div>
      )}

      {current.nextChange && !editingScheduled && (
        <div className="bg-warn-light border border-warn rounded-xl p-5 mb-4 shadow-[var(--shadow-card-sm)]">
          <div className="flex justify-between items-center mb-2 gap-2 flex-wrap">
            <strong className="text-warn">
              <span className="icon align-middle">schedule</span> 適用予定の変更
            </strong>
            <div className="flex gap-2">
              <button className="btn-outline w-auto px-3 py-1.5" onClick={loadScheduledForEdit}>
                <span className="icon icon-sm">edit</span> 編集
              </button>
              <button className="btn-danger" onClick={cancelScheduled}>取り消し</button>
            </div>
          </div>
          <div className="text-[0.9rem] text-ink-sub">
            適用日: <strong>{current.nextChange.effectiveFrom}</strong>
            {' / '}
            曜日: <strong>{current.nextChange.availableDays.map((d) => WEEK_DAYS[d]).join('・') || 'なし'}</strong>
            {' / '}
            追加日: <strong>{current.nextChange.extraDates?.length ?? 0}件</strong>
            {' / '}
            除外日: <strong>{current.nextChange.excludedDates?.length ?? 0}件</strong>
          </div>
        </div>
      )}

      {/* 抽選時刻 */}
      <div className="admin-card">
        <h2 className="text-base font-bold mb-1">抽選時刻</h2>
        <p className="text-[0.85rem] text-ink-sub mb-3">
          変更すると cron-job.org のスケジュールも自動で更新されます。
        </p>
        <input
          type="time"
          className="text-input w-auto"
          min="01:00"
          max="23:59"
          value={lotteryTime}
          onChange={(e) => setLotteryTime(e.target.value)}
        />
        {lotteryTimeInvalid ? (
          <p className="mt-2 text-danger text-[0.85rem]">
            <span className="icon icon-sm align-middle">error</span>
            {' '}抽選時刻は01:00以降を指定してください
          </p>
        ) : (
          <p className="mt-2 text-[0.82rem] text-ink-sub">
            {computeLockoutTime(lotteryTime)}（10分前）〜{lotteryTime} の間、当日・翌日の登録が制限されます
          </p>
        )}
      </div>

      <div className="admin-card">
        <h2 className="text-base font-bold mb-3">登録可能曜日</h2>
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="admin-card">
          <h2 className="text-base font-bold mb-3">追加日</h2>
          <p className="text-[0.85rem] text-ink-sub mb-3">
            上記の曜日に該当しない日でも、ここに追加した日は予約可能になります。
          </p>
          <DateListEditor
            dates={extraDates}
            onChange={setExtraDates}
            min={todayJST()}
            emptyText="追加日なし"
            label="予約可能にする日を選択"
            conflictDates={excludedDates}
            conflictLabel="除外日"
            onMoveConflict={(date) => setExcludedDates((prev) => prev.filter((d) => d !== date))}
          />
        </div>

        <div className="admin-card">
          <h2 className="text-base font-bold mb-3">除外日</h2>
          <p className="text-[0.85rem] text-ink-sub mb-3">
            通常は予約可能曜日でも、ここに登録した日は予約できなくなります（祝日や臨時休業など）。
          </p>
          <DateListEditor
            dates={excludedDates}
            onChange={setExcludedDates}
            min={todayJST()}
            emptyText="除外日なし"
            label="予約不可にする日を選択"
            conflictDates={extraDates}
            conflictLabel="追加日"
            onMoveConflict={(date) => setExtraDates((prev) => prev.filter((d) => d !== date))}
          />
        </div>
      </div>

      <div className="admin-card">
        <h2 className="text-base font-bold mb-3">デフォルト時間枠</h2>
        <p className="text-[0.85rem] text-ink-sub mb-3">
          全ての日で使用される基本の時間枠です。曜日や日付別に上書きする場合は下の設定で。
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
        <h2 className="text-base font-bold mb-3">時間枠の例外設定</h2>
        <PerDayScheduleEditor
          schedule={perDaySchedule}
          onChange={setPerDaySchedule}
          defaultSlots={timeSlots}
          availableDays={availableDays}
          extraDates={extraDates}
          excludedDates={excludedDates}
          presets={presets}
          onSavePreset={savePreset}
          onDeletePreset={deletePreset}
        />
      </div>

      <div className="admin-card">
        <h2 className="text-base font-bold mb-3">適用日</h2>
        <p className="text-[0.85rem] text-ink-sub mb-3">
          現在予約可能な最長日（7日後）との競合を避けるため、
          <strong>{minDate}</strong> 以降の日付を指定してください。
        </p>
        <input
          type="date"
          className="text-input w-auto"
          value={effectiveFrom}
          min={minDate}
          onChange={(e) => setEffectiveFrom(e.target.value)}
        />
      </div>

      <button className="btn-primary max-w-[300px]" onClick={goToConfirm}>
        {editingScheduled ? '上書き内容を確認する' : '確認する'}
      </button>

      {blocker.state === 'blocked' && (
        <div className="modal-backdrop" onClick={() => blocker.reset()}>
          <div className="modal-card max-w-[360px]" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold mb-2">ページを離れますか？</h2>
            <p className="text-[0.9rem] text-ink-sub mb-4">未保存の変更が失われます。</p>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => blocker.reset()}>キャンセル</button>
              <button className="btn-danger flex-1" onClick={() => blocker.proceed()}>OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
