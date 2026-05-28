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

type DayOverride = {
  date: string
  type: 'blocked' | 'opened'
  reason: string
  timeSlots?: TimeSlot[]
  reservationCount?: number
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
  const [dayOverrides, setDayOverrides] = useState<DayOverride[]>([])
  const [emergencyDate, setEmergencyDate] = useState(todayJST())
  const [emergencyType, setEmergencyType] = useState<'blocked' | 'opened'>('blocked')
  const [emergencyReason, setEmergencyReason] = useState('')
  const [emergencyUseCustomSlots, setEmergencyUseCustomSlots] = useState(false)
  const [emergencySlots, setEmergencySlots] = useState<TimeSlot[]>([])
  const [emergencyCount, setEmergencyCount] = useState<number | null>(null)
  const [emergencySaving, setEmergencySaving] = useState(false)
  const [emergencyMessage, setEmergencyMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => { load(); loadPresets(); loadDayOverrides() }, [])

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

  async function loadDayOverrides() {
    try {
      const res = await adminFetch('/api/admin/settings/day-overrides')
      if (res.ok) setDayOverrides((await res.json()).overrides ?? [])
    } catch { /* ignore */ }
  }

  async function loadEmergencyDateInfo(date: string) {
    try {
      const res = await adminFetch(`/api/admin/settings/day-overrides?date=${encodeURIComponent(date)}`)
      if (!res.ok) return
      const data = await res.json()
      setEmergencyCount(data.reservationCount ?? 0)
      if (data.override) {
        setEmergencyType(data.override.type)
        setEmergencyReason(data.override.reason ?? '')
        setEmergencyUseCustomSlots(!!data.override.timeSlots?.length)
        setEmergencySlots(data.override.timeSlots ?? [])
      } else {
        setEmergencyType('blocked')
        setEmergencyReason('')
        setEmergencyUseCustomSlots(false)
        setEmergencySlots([])
      }
    } catch {
      setEmergencyCount(null)
    }
  }

  useEffect(() => { loadEmergencyDateInfo(emergencyDate) }, [emergencyDate])

  async function saveDayOverride() {
    setEmergencyMessage(null)
    if (!emergencyDate) {
      setEmergencyMessage({ type: 'error', text: '日付を指定してください' })
      return
    }
    if (!emergencyReason.trim()) {
      setEmergencyMessage({ type: 'error', text: '理由を入力してください' })
      return
    }
    if (emergencyType === 'opened' && emergencyUseCustomSlots) {
      if (emergencySlots.length === 0 || emergencySlots.some((s) => !s.label.trim() || !s.value.trim())) {
        setEmergencyMessage({ type: 'error', text: '臨時開放の時間枠を入力してください' })
        return
      }
      if (findConflicts(emergencySlots).size > 0) {
        setEmergencyMessage({ type: 'error', text: '臨時開放の時間枠が重複しています' })
        return
      }
    }
    if (
      emergencyType === 'blocked' &&
      (emergencyCount ?? 0) > 0 &&
      !confirm(`${emergencyDate} には予約が ${emergencyCount} 件あります。新規予約受付だけを停止し、既存予約は残します。続行しますか？`)
    ) {
      return
    }

    setEmergencySaving(true)
    try {
      const body = {
        type: emergencyType,
        reason: emergencyReason.trim(),
        ...(emergencyType === 'opened' && emergencyUseCustomSlots ? { timeSlots: emergencySlots } : {}),
      }
      const res = await adminFetch(`/api/admin/settings/day-overrides/${encodeURIComponent(emergencyDate)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? '保存に失敗しました')
      setEmergencyMessage({
        type: 'success',
        text: emergencyType === 'blocked'
          ? `${emergencyDate} の新規予約受付を停止しました`
          : `${emergencyDate} を臨時開放しました`,
      })
      setEmergencyReason('')
      setEmergencyUseCustomSlots(false)
      setEmergencySlots([])
      setEmergencyCount(data.reservationCount ?? emergencyCount)
      await loadDayOverrides()
    } catch (err: any) {
      setEmergencyMessage({ type: 'error', text: err.message })
    } finally {
      setEmergencySaving(false)
    }
  }

  async function deleteDayOverride(date: string) {
    if (!confirm(`${date} の緊急対応を解除しますか？`)) return
    setEmergencySaving(true)
    try {
      const res = await adminFetch(`/api/admin/settings/day-overrides/${encodeURIComponent(date)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error ?? '解除に失敗しました')
      setEmergencyMessage({ type: 'success', text: `${date} の緊急対応を解除しました` })
      await loadDayOverrides()
      if (date === emergencyDate) await loadEmergencyDateInfo(date)
    } catch (err: any) {
      setEmergencyMessage({ type: 'error', text: err.message })
    } finally {
      setEmergencySaving(false)
    }
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

      <div className="admin-card">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div>
            <h2 className="text-base font-bold mb-1">緊急対応</h2>
            <p className="text-[0.85rem] text-ink-sub">
              直近の日付だけ、新規予約受付の停止または臨時開放を即時反映します。既存予約は自動では削除されません。
            </p>
          </div>
          <span className="badge badge-warn">
            <span className="icon icon-sm">bolt</span>
            即時反映
          </span>
        </div>

        {emergencyMessage && (
          <div className={emergencyMessage.type === 'success' ? 'banner-success' : 'banner-error'}>
            {emergencyMessage.text}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[180px_1fr] gap-4 mb-4">
          <div className="form-row mb-0">
            <label>対象日</label>
            <input
              type="date"
              className="text-input"
              value={emergencyDate}
              min={todayJST()}
              onChange={(e) => setEmergencyDate(e.target.value)}
            />
            <p className="text-[0.78rem] text-ink-sub mt-1">
              既存予約: <strong>{emergencyCount ?? '-'}</strong> 件
            </p>
          </div>

          <div className="form-row mb-0">
            <label>操作</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                className={
                  'rounded-lg border-[1.5px] px-3 py-3 text-left transition ' +
                  (emergencyType === 'blocked'
                    ? 'border-warn bg-warn-light text-warn'
                    : 'border-line bg-surface text-ink-sub hover:border-warn')
                }
                onClick={() => setEmergencyType('blocked')}
              >
                <div className="font-semibold flex items-center gap-1.5">
                  <span className="icon icon-sm">block</span>
                  予約不可にする
                </div>
                <p className="text-[0.78rem] mt-1">新規予約受付を止めます</p>
              </button>
              <button
                type="button"
                className={
                  'rounded-lg border-[1.5px] px-3 py-3 text-left transition ' +
                  (emergencyType === 'opened'
                    ? 'border-brand bg-brand-light text-brand-dark'
                    : 'border-line bg-surface text-ink-sub hover:border-brand')
                }
                onClick={() => setEmergencyType('opened')}
              >
                <div className="font-semibold flex items-center gap-1.5">
                  <span className="icon icon-sm">event_available</span>
                  臨時開放する
                </div>
                <p className="text-[0.78rem] mt-1">通常不可の日も予約可能にします</p>
              </button>
            </div>
          </div>
        </div>

        <div className="form-row">
          <label>理由</label>
          <input
            className="text-input"
            value={emergencyReason}
            onChange={(e) => setEmergencyReason(e.target.value)}
            placeholder={emergencyType === 'blocked' ? '例: 設備点検のため' : '例: 臨時営業のため'}
          />
        </div>

        {emergencyType === 'opened' && (
          <div className="mb-4">
            <label className="inline-flex items-center gap-2 text-[0.9rem] font-medium cursor-pointer mb-2">
              <input
                type="checkbox"
                checked={emergencyUseCustomSlots}
                onChange={(e) => {
                  setEmergencyUseCustomSlots(e.target.checked)
                  if (e.target.checked && emergencySlots.length === 0) {
                    setEmergencySlots(timeSlots.map((slot) => ({ ...slot })))
                  }
                }}
              />
              この日だけ時間枠を指定する
            </label>
            {emergencyUseCustomSlots ? (
              <TimeSlotsEditor
                slots={emergencySlots}
                onChange={setEmergencySlots}
                conflictSet={findConflicts(emergencySlots)}
              />
            ) : (
              <p className="text-[0.82rem] text-ink-sub">
                時間枠を指定しない場合、その日に適用される通常設定の時間枠を使います。
              </p>
            )}
          </div>
        )}

        <div className="flex gap-2 flex-wrap mb-4">
          <button className="btn-primary w-auto px-5" onClick={saveDayOverride} disabled={emergencySaving}>
            {emergencySaving ? '保存中...' : '緊急対応を保存'}
          </button>
          {dayOverrides.some((override) => override.date === emergencyDate) && (
            <button className="btn-outline w-auto px-5" onClick={() => deleteDayOverride(emergencyDate)} disabled={emergencySaving}>
              この日の緊急対応を解除
            </button>
          )}
        </div>

        <div className="border-t border-line pt-3">
          <h3 className="text-[0.9rem] font-semibold mb-2">登録済みの緊急対応</h3>
          {dayOverrides.length === 0 ? (
            <p className="text-[0.85rem] text-ink-pale">登録済みの緊急対応はありません</p>
          ) : (
            <div className="flex flex-col gap-2">
              {dayOverrides.map((override) => (
                <div key={override.date} className="flex items-start justify-between gap-3 rounded-lg border border-line bg-bg px-3 py-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <strong>{override.date}</strong>
                      <span className={override.type === 'blocked' ? 'badge badge-warn' : 'badge badge-confirmed'}>
                        {override.type === 'blocked' ? '予約不可' : '臨時開放'}
                      </span>
                      <span className="text-[0.78rem] text-ink-sub">既存予約 {override.reservationCount ?? 0} 件</span>
                    </div>
                    <p className="text-[0.82rem] text-ink-sub mt-1">{override.reason}</p>
                    {override.type === 'opened' && override.timeSlots?.length ? (
                      <p className="text-[0.78rem] text-ink-pale mt-1">
                        時間枠: {override.timeSlots.map((slot) => slot.label || slot.value).join(' / ')}
                      </p>
                    ) : null}
                  </div>
                  <button className="btn-icon-danger shrink-0" onClick={() => deleteDayOverride(override.date)} disabled={emergencySaving} aria-label={`${override.date}の緊急対応を解除`}>
                    <span className="icon">delete</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

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
