import { useEffect, useState } from 'react'
import { useToast } from '../../contexts/ToastContext'
import { adminFetch } from '../auth'
import { getPageCache, setPageCache } from '../pageCache'
import TimeSlotsEditor, { findConflicts, type TimeSlot } from '../components/TimeSlotsEditor'
import Skeleton from '../../components/Skeleton'
import DatePicker from '../../components/DatePicker'
import ConfirmDialog from '../../components/ConfirmDialog'

type DayOverride = {
  date: string
  type: 'blocked' | 'opened'
  reason: string
  timeSlots?: TimeSlot[]
  reservationCount?: number
}

type EmergencyDateOption = {
  label: string
  value: string
  isReservable: boolean
  canBlock: boolean
  canOpen: boolean
  blockedReason?: string
  openReason?: string
}

type LotteryDateOption = {
  label: string
  value: string
  isReservable: boolean
  currentLotteryTime: string
  hasOverride: boolean
  editable: boolean
  minTime: string
  maxTime: string
  note?: string
}

type LotteryOverride = {
  date: string
  lotteryTime: string
}

type SettingsResponse = {
  timeSlots: TimeSlot[]
}

function todayJST(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function tomorrowJST(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

function maxEmergencyDate(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000)
  d.setUTCDate(d.getUTCDate() + 7)
  return d.toISOString().slice(0, 10)
}

const EMERGENCY_CACHE_KEY = 'settings:nobu-emergency'
type EmergencyCache = {
  dayOverrides: DayOverride[]
  defaultSlots: TimeSlot[]
  emergencyDates: EmergencyDateOption[]
  lotteryOverrides?: LotteryOverride[]
  lotteryDateOptions?: LotteryDateOption[]
}

export default function NobuEmergencySettings() {
  const cached = getPageCache<EmergencyCache>(EMERGENCY_CACHE_KEY)
  const [loading, setLoading] = useState(!cached)
  const [dayOverrides, setDayOverrides] = useState<DayOverride[]>(cached?.dayOverrides ?? [])
  const [defaultSlots, setDefaultSlots] = useState<TimeSlot[]>(cached?.defaultSlots ?? [])
  const [emergencyDates, setEmergencyDates] = useState<EmergencyDateOption[]>(cached?.emergencyDates ?? [])
  const [emergencyDate, setEmergencyDate] = useState('')
  const [emergencyType, setEmergencyType] = useState<'blocked' | 'opened' | null>(null)
  const [emergencyReason, setEmergencyReason] = useState('')
  const [emergencyUseCustomSlots, setEmergencyUseCustomSlots] = useState(false)
  const [emergencySlots, setEmergencySlots] = useState<TimeSlot[]>([])
  const [emergencyCount, setEmergencyCount] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  // 抽選時刻の緊急対応（予約不可/開放とは独立）
  const [lotteryOverrides, setLotteryOverrides] = useState<LotteryOverride[]>(cached?.lotteryOverrides ?? [])
  const [lotteryDateOptions, setLotteryDateOptions] = useState<LotteryDateOption[]>(cached?.lotteryDateOptions ?? [])
  const [lotteryDate, setLotteryDate] = useState('')
  const [lotteryTimeInput, setLotteryTimeInput] = useState('')
  const [lotterySaving, setLotterySaving] = useState(false)
  const [lotteryMessage, setLotteryMessage] = useState<string | null>(null)
  const { showToast } = useToast()
  const [confirmAction, setConfirmAction] = useState<{
    title: string
    message: string
    confirmLabel?: string
    onConfirm: () => Promise<void>
  } | null>(null)

  useEffect(() => {
    loadInitial()
  }, [])

  useEffect(() => {
    if (emergencyDate) loadEmergencyDateInfo(emergencyDate)
  }, [emergencyDate])

  // 抽選時刻: 対象日を選んだら初期値を「既存上書き or 現在の有効値」にセット（最小時刻でクランプ）
  useEffect(() => {
    if (!lotteryDate) return
    const opt = lotteryDateOptions.find((o) => o.value === lotteryDate)
    if (!opt) return
    const existing = lotteryOverrides.find((o) => o.date === lotteryDate)?.lotteryTime
    let t = existing ?? opt.currentLotteryTime
    if (t < opt.minTime) t = opt.minTime
    setLotteryTimeInput(t)
  }, [lotteryDate, lotteryDateOptions, lotteryOverrides])

  async function loadInitial() {
    if (!getPageCache<EmergencyCache>(EMERGENCY_CACHE_KEY)) setLoading(true)
    const [slots, dayOverrideData, lotteryData] = await Promise.all([
      loadSettings(),
      loadDayOverrides(),
      loadLotteryOverrides(),
    ])
    setPageCache<EmergencyCache>(EMERGENCY_CACHE_KEY, {
      defaultSlots: slots ?? defaultSlots,
      dayOverrides: dayOverrideData?.overrides ?? dayOverrides,
      emergencyDates: dayOverrideData?.emergencyDates ?? emergencyDates,
      lotteryOverrides: lotteryData?.overrides ?? lotteryOverrides,
      lotteryDateOptions: lotteryData?.dateOptions ?? lotteryDateOptions,
    })
    setLoading(false)
  }

  async function loadLotteryOverrides() {
    try {
      const res = await adminFetch('/api/admin/settings/lottery-overrides')
      if (res.ok) {
        const data = await res.json()
        const overrides = (data.overrides ?? []) as LotteryOverride[]
        const dateOptions = (data.dateOptions ?? []) as LotteryDateOption[]
        setLotteryOverrides(overrides)
        setLotteryDateOptions(dateOptions)
        return { overrides, dateOptions }
      }
    } catch { /* ignore */ }
    return null
  }

  async function loadSettings() {
    try {
      const res = await adminFetch('/api/admin/settings')
      if (!res.ok) return null
      const data = (await res.json()) as SettingsResponse
      const slots = data.timeSlots ?? []
      setDefaultSlots(slots)
      return slots
    } catch { return null }
  }

  async function loadDayOverrides() {
    try {
      const res = await adminFetch('/api/admin/settings/day-overrides')
      if (res.ok) {
        const data = await res.json()
        const overrides = data.overrides ?? []
        const dates = data.emergencyDates ?? []
        setDayOverrides(overrides)
        setEmergencyDates(dates)
        return { overrides, emergencyDates: dates }
      }
    } catch { /* ignore */ }
    return null
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
        // emergencyType はユーザーの選択を保持する（リセットしない）
        setEmergencyReason('')
        setEmergencyUseCustomSlots(false)
        setEmergencySlots([])
      }
    } catch {
      setEmergencyCount(null)
    }
  }

  const selectedDateOption = emergencyDates.find((entry) => entry.value === emergencyDate)
  const selectedDateWarning =
    emergencyType === 'blocked'
      ? selectedDateOption?.blockedReason
      : emergencyType === 'opened'
        ? selectedDateOption?.openReason
        : undefined
  const selectedDateAllowed =
    !!emergencyDate &&
    (!emergencyType ||
    (emergencyType === 'blocked' && !!selectedDateOption?.canBlock) ||
    (emergencyType === 'opened' && !!selectedDateOption?.canOpen))

  function isAllowedDateForType(date: string, type: 'blocked' | 'opened' | null = emergencyType): boolean {
    if (!type) return true
    if (!date || date <= todayJST()) return false
    const option = emergencyDates.find((entry) => entry.value === date)
    if (!option) return false
    return type === 'blocked' ? option.canBlock : option.canOpen
  }

  function selectEmergencyType(type: 'blocked' | 'opened') {
    setEmergencyType(type)
    if (!isAllowedDateForType(emergencyDate, type)) {
      const nextDate = emergencyDates.find(
        (entry) => entry.value > todayJST() && (type === 'blocked' ? entry.canBlock : entry.canOpen)
      )?.value
      if (nextDate) setEmergencyDate(nextDate)
    }
  }

  async function saveDayOverride() {
    setMessage(null)
    if (!emergencyDate) {
      setMessage('日付を指定してください')
      return
    }
    if (emergencyDate < tomorrowJST() || emergencyDate > maxEmergencyDate()) {
      setMessage(`緊急対応は ${tomorrowJST()} 〜 ${maxEmergencyDate()} の範囲で指定してください`)
      return
    }
    if (!emergencyType) {
      setMessage('操作を選択してください')
      return
    }
    if (!selectedDateAllowed) {
      setMessage(selectedDateWarning ?? 'この日付は選択した操作の対象にできません')
      return
    }
    if (!emergencyReason.trim()) {
      setMessage('理由を入力してください')
      return
    }
    if (emergencyType === 'opened' && emergencyUseCustomSlots) {
      if (emergencySlots.length === 0 || emergencySlots.some((s) => !s.label.trim() || !s.value.trim())) {
        setMessage('臨時開放の時間枠を入力してください')
        return
      }
      if (findConflicts(emergencySlots).size > 0) {
        setMessage('臨時開放の時間枠が重複しています')
        return
      }
    }
    if (emergencyType === 'blocked') {
      if (emergencyCount === null) {
        setMessage('既存予約件数の取得に失敗しています。日付を選択し直してください')
        return
      }
      if (emergencyCount > 0) {
        setConfirmAction({
          title: '既存予約があります',
          message: `${emergencyDate} には予約が ${emergencyCount} 件あります。新規予約受付だけを停止し、既存予約は残します。続行しますか？`,
          confirmLabel: '続行',
          onConfirm: async () => {
            await executeSaveDayOverride()
            setConfirmAction(null)
          },
        })
        return
      }
    }

    await executeSaveDayOverride()
  }

  async function executeSaveDayOverride() {
    setSaving(true)
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
      showToast(
        emergencyType === 'blocked'
          ? `${emergencyDate} の新規予約受付を停止しました`
          : `${emergencyDate} を臨時開放しました`,
      )
      setMessage(null)
      setEmergencyCount(data.reservationCount ?? emergencyCount)
      await Promise.all([loadDayOverrides(), loadEmergencyDateInfo(emergencyDate)])
    } catch (err: any) {
      setMessage(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function deleteDayOverride(date: string) {
    setConfirmAction({
      title: '緊急対応を解除しますか？',
      message: `${date} の緊急対応を解除します。`,
      confirmLabel: '解除',
      onConfirm: async () => {
        setSaving(true)
        try {
          const res = await adminFetch(`/api/admin/settings/day-overrides/${encodeURIComponent(date)}`, { method: 'DELETE' })
          if (!res.ok) throw new Error((await res.json()).error ?? '解除に失敗しました')
          showToast(`${date} の緊急対応を解除しました`)
          setConfirmAction(null)
          await loadDayOverrides()
          if (date === emergencyDate) await loadEmergencyDateInfo(date)
        } finally {
          setSaving(false)
        }
      },
    })
  }

  const selLotteryOpt = lotteryDateOptions.find((o) => o.value === lotteryDate)

  async function saveLotteryOverride() {
    setLotteryMessage(null)
    if (!lotteryDate) { setLotteryMessage('対象日を選択してください'); return }
    const opt = lotteryDateOptions.find((o) => o.value === lotteryDate)
    if (!opt || !opt.editable) { setLotteryMessage(opt?.note ?? 'この日は抽選時刻を変更できません'); return }
    if (!lotteryTimeInput || lotteryTimeInput < opt.minTime || lotteryTimeInput > opt.maxTime) {
      setLotteryMessage(`指定できる抽選時刻は ${opt.minTime}〜${opt.maxTime} です`); return
    }
    setLotterySaving(true)
    try {
      const res = await adminFetch(`/api/admin/settings/lottery-overrides/${encodeURIComponent(lotteryDate)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lotteryTime: lotteryTimeInput }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? '保存に失敗しました')
      showToast(data.cronWarning ? `⚠️ ${data.cronWarning}` : `${lotteryDate} の抽選時刻を ${lotteryTimeInput} に変更しました`)
      await loadLotteryOverrides()
    } catch (err: any) {
      setLotteryMessage(err.message)
    } finally {
      setLotterySaving(false)
    }
  }

  function deleteLotteryOverride(date: string) {
    setConfirmAction({
      title: '抽選時刻の緊急対応を解除しますか？',
      message: `${date} の抽選時刻を通常設定に戻します。`,
      confirmLabel: '解除',
      onConfirm: async () => {
        setLotterySaving(true)
        try {
          const res = await adminFetch(`/api/admin/settings/lottery-overrides/${encodeURIComponent(date)}`, { method: 'DELETE' })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(data.error ?? '解除に失敗しました')
          showToast(data.cronWarning ? `⚠️ ${data.cronWarning}` : `${date} の抽選時刻を通常設定に戻しました`)
          setConfirmAction(null)
          await loadLotteryOverrides()
        } finally {
          setLotterySaving(false)
        }
      },
    })
  }

  if (loading) return (
    <div>
      <Skeleton width="240px" height="28px" className="mb-6" />
      <div className="admin-card">
        <Skeleton width="40%" height="20px" className="mb-3" />
        <Skeleton width="100%" height="180px" />
      </div>
    </div>
  )

  return (
    <div className="pb-80">
      <h1 className="text-2xl font-bold mb-6">緊急対応 - 農部生協</h1>

      {message && <div className="banner-error">{message}</div>}

      <div className="admin-card">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div>
            <h2 className="text-base font-bold mb-1">緊急対応</h2>
            <p className="text-[0.85rem] text-ink-sub">
              通常設定では間に合わない日付だけ、新規予約受付の停止または臨時開放を即時反映します。既存予約は自動では削除されません。
            </p>
          </div>
          <span className="badge badge-warn">
            <span className="icon icon-sm">bolt</span>
            即時反映
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[270px_1fr] gap-4 mb-4">
          <div className="form-row mb-0">
            <label>対象日</label>
            <div className="flex items-center gap-2 flex-wrap">
              <DatePicker
                value={emergencyDate}
                onChange={setEmergencyDate}
                min={tomorrowJST()}
                maxDate={maxEmergencyDate()}
                getDayClass={(date) => {
                  if (date <= todayJST()) return 'text-ink-pale cursor-not-allowed opacity-40'
                  const opt = emergencyDates.find(e => e.value === date)
                  if (!opt || (!opt.canBlock && !opt.canOpen)) return 'text-ink-pale cursor-not-allowed opacity-40'
                  const compatible = !emergencyType
                    || (emergencyType === 'blocked' ? opt.canBlock : opt.canOpen)
                  if (opt.canBlock) {
                    return compatible
                      ? 'text-warn hover:bg-warn-light cursor-pointer font-medium'
                      : 'text-warn opacity-40 cursor-not-allowed'
                  }
                  return compatible
                    ? 'text-brand hover:bg-brand-light cursor-pointer font-medium'
                    : 'text-brand opacity-40 cursor-not-allowed'
                }}
                getSelectedClass={(date) => {
                  const opt = emergencyDates.find(e => e.value === date)
                  if (opt?.canBlock) return 'bg-warn text-white font-bold cursor-pointer'
                  if (opt?.canOpen)  return 'bg-brand text-white font-bold cursor-pointer'
                  return 'bg-brand text-white font-bold cursor-pointer'
                }}
                isDateDisabled={(date) => {
                  if (date <= todayJST()) return true
                  const opt = emergencyDates.find(e => e.value === date)
                  if (!opt) return true
                  if (emergencyType) return emergencyType === 'blocked' ? !opt.canBlock : !opt.canOpen
                  return !opt.canBlock && !opt.canOpen
                }}
                className="justify-start whitespace-nowrap"
              />
              {emergencyDate && (
                <span className="text-[0.78rem] text-ink-sub whitespace-nowrap">
                  既存予約: <strong className="text-ink">{emergencyCount ?? '-'}</strong> 件
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[0.75rem] text-ink-sub">
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-warn" />
                予約不可にできる日（{emergencyDates.filter(d => d.canBlock).length}日）
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-brand" />
                臨時開放できる日（{emergencyDates.filter(d => d.canOpen).length}日）
              </span>
            </div>
            {emergencyType && !selectedDateAllowed && selectedDateWarning && (
              <p className="text-[0.78rem] text-warn mt-1">
                <span className="icon icon-sm align-middle">warning</span>
                {' '}{selectedDateWarning}
              </p>
            )}
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
                onClick={() => selectEmergencyType('blocked')}
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
                onClick={() => selectEmergencyType('opened')}
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
            placeholder={emergencyType === 'opened' ? '例: 臨時営業のため' : '例: 設備点検のため'}
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
                    setEmergencySlots(defaultSlots.map((slot) => ({ ...slot })))
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
          <button className="btn-primary w-auto px-5" onClick={saveDayOverride} disabled={saving || !selectedDateAllowed}>
            {saving ? '保存中...' : '緊急対応を保存'}
          </button>
          {dayOverrides.some((override) => override.date === emergencyDate) && (
            <button className="btn-outline w-auto px-5" onClick={() => deleteDayOverride(emergencyDate)} disabled={saving}>
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
                  <button className="btn-icon-danger shrink-0" onClick={() => deleteDayOverride(override.date)} disabled={saving} aria-label={`${override.date}の緊急対応を解除`}>
                    <span className="icon">delete</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="admin-card">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div>
            <h2 className="text-base font-bold mb-1">抽選時刻の緊急対応</h2>
            <p className="text-[0.85rem] text-ink-sub">
              当日〜7日後の予約可能日について、その日だけ抽選時刻を変更します。当日分は即時に反映されます（cron-job.org も自動更新）。
            </p>
          </div>
          <span className="badge badge-warn">
            <span className="icon icon-sm">bolt</span>
            即時反映
          </span>
        </div>

        {lotteryMessage && <div className="banner-error">{lotteryMessage}</div>}

        <div className="grid grid-cols-1 lg:grid-cols-[270px_1fr] gap-4 mb-4">
          <div className="form-row mb-0">
            <label>対象日</label>
            <DatePicker
              value={lotteryDate}
              onChange={setLotteryDate}
              min={todayJST()}
              maxDate={maxEmergencyDate()}
              getDayClass={(date) => {
                const o = lotteryDateOptions.find((e) => e.value === date)
                return o?.editable
                  ? 'text-brand hover:bg-brand-light cursor-pointer font-medium'
                  : 'text-ink-pale cursor-not-allowed opacity-40'
              }}
              getSelectedClass={() => 'bg-brand text-white font-bold cursor-pointer'}
              isDateDisabled={(date) => !lotteryDateOptions.find((e) => e.value === date)?.editable}
              className="justify-start whitespace-nowrap"
            />
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[0.75rem] text-ink-sub">
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-brand" />
                変更できる日（{lotteryDateOptions.filter((d) => d.editable).length}日）
              </span>
            </div>
          </div>

          <div className="form-row mb-0">
            <label>抽選時刻</label>
            {!lotteryDate ? (
              <p className="text-[0.82rem] text-ink-sub">対象日を選択してください</p>
            ) : selLotteryOpt?.editable ? (
              <>
                <input
                  type="time"
                  className="text-input w-auto"
                  min={selLotteryOpt.minTime}
                  max={selLotteryOpt.maxTime}
                  value={lotteryTimeInput}
                  onChange={(e) => setLotteryTimeInput(e.target.value)}
                />
                <p className="text-[0.78rem] text-ink-sub mt-1.5">
                  現在の抽選時刻: <strong className="text-ink">{selLotteryOpt.currentLotteryTime}</strong>
                  {selLotteryOpt.note ? <><br />{selLotteryOpt.note}</> : null}
                </p>
              </>
            ) : (
              <p className="text-[0.82rem] text-warn">
                <span className="icon icon-sm align-middle">warning</span>
                {' '}{selLotteryOpt?.note ?? 'この日は抽選時刻を変更できません'}
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2 flex-wrap mb-4">
          <button className="btn-primary w-auto px-5" onClick={saveLotteryOverride} disabled={lotterySaving || !selLotteryOpt?.editable}>
            {lotterySaving ? '保存中...' : '抽選時刻を変更'}
          </button>
          {lotteryOverrides.some((o) => o.date === lotteryDate) && (
            <button className="btn-outline w-auto px-5" onClick={() => deleteLotteryOverride(lotteryDate)} disabled={lotterySaving}>
              この日の変更を解除
            </button>
          )}
        </div>

        <div className="border-t border-line pt-3">
          <h3 className="text-[0.9rem] font-semibold mb-2">登録済みの抽選時刻変更</h3>
          {lotteryOverrides.length === 0 ? (
            <p className="text-[0.85rem] text-ink-pale">登録済みの抽選時刻変更はありません</p>
          ) : (
            <div className="flex flex-col gap-2">
              {lotteryOverrides.map((o) => (
                <div key={o.date} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg px-3 py-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <strong>{o.date}</strong>
                    <span className="badge badge-warn">抽選 {o.lotteryTime}</span>
                  </div>
                  <button className="btn-icon-danger shrink-0" onClick={() => deleteLotteryOverride(o.date)} disabled={lotterySaving} aria-label={`${o.date}の抽選時刻変更を解除`}>
                    <span className="icon">delete</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel={confirmAction.confirmLabel}
          onClose={() => setConfirmAction(null)}
          onConfirm={confirmAction.onConfirm}
        />
      )}
    </div>
  )
}
