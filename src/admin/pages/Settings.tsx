import { useEffect, useState, useMemo, useCallback } from 'react'
import { useBlocker } from 'react-router-dom'
import { adminFetch } from '../auth'
import { getPageCache, setPageCache } from '../pageCache'
import TimeSlotsEditor, { findConflicts, toMinutes, type TimeSlot, type TimeSlotPreset } from '../components/TimeSlotsEditor'
import DateListEditor from '../components/DateListEditor'
import PerDayScheduleEditor, { findAllConflicts, type PerDaySchedule } from '../components/PerDayScheduleEditor'
import ConfirmDialog from '../../components/ConfirmDialog'
import DatePicker from '../../components/DatePicker'
import { useToast } from '../../contexts/ToastContext'
import FacilitySettingsChanges from '../components/FacilitySettingsChanges'
import RoomPreferenceSettings from './RoomPreferenceSettings'
import { notificationFollowsLottery, operationChangeOnExecutionDate } from '../../../lib/lotteryTiming'

type SettingsCore = {
  availableDays: number[]
  timeSlots: TimeSlot[]
  extraDates: string[]
  excludedDates: string[]
  perDaySchedule: PerDaySchedule
}

type LotteryTimeOverrides = { byWeekday: Record<string, string>; byDate: Record<string, string> }
type ScheduledChange = SettingsCore & { effectiveFrom: string; lotteryTime?: string; lotteryTimeOverrides?: LotteryTimeOverrides }
type RoomModeVersion = { effectiveFrom: string; enabled: boolean }
type LegacyDayOverride = { date: string; type: 'blocked' | 'opened'; reason?: string; timeSlots?: TimeSlot[] }
type LegacyLotteryOverride = { date: string; lotteryTime: string }

type SettingsResponse = SettingsCore & {
  nextChange: ScheduledChange | null
  scheduledChanges?: ScheduledChange[]
  reservableDatesInWindow?: string[]
  lotteryTime: string
  defaultLotteryTime?: string
  lotteryTimeOverrides?: LotteryTimeOverrides
  lotteryMode: 'previous-day' | 'same-day'
  notifyMode: 'previous-day' | 'same-day'
  notifyTime: string
  hamoaniStartDate?: string | null
  hamoaniEndDate?: string | null
  roomModeVersions?: RoomModeVersion[]
}

const WEEK_DAYS = ['日', '月', '火', '水', '木', '金', '土']

function todayJST(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function minEffectiveDate(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function roomModeAtDate(date: string, versions: RoomModeVersion[]): boolean {
  return versions.find((version) => version.effectiveFrom <= date)?.enabled ?? false
}

function emptySchedule(): PerDaySchedule {
  return { enabled: false, byWeekday: {}, byDate: {} }
}

function isDateAvailableInForm(date: string, availableDays: number[], extraDates: string[], excludedDates: string[]): boolean {
  if (excludedDates.includes(date)) return false
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  return availableDays.includes(weekday) || extraDates.includes(date)
}

function timeSlotsForDateInForm(date: string, defaults: TimeSlot[], schedule: PerDaySchedule): TimeSlot[] {
  if (!schedule.enabled) return defaults
  if (schedule.byDate?.[date]?.length) return schedule.byDate[date]
  const weekday = String(new Date(`${date}T00:00:00Z`).getUTCDay())
  return schedule.byWeekday?.[weekday]?.length ? schedule.byWeekday[weekday] : defaults
}

const SETTINGS_CACHE_KEY = 'settings:nobu'

export default function Settings() {
  const cached = getPageCache<SettingsResponse>(SETTINGS_CACHE_KEY)
  const [current, setCurrent]             = useState<SettingsResponse | null>(cached ?? null)
  const [availableDays, setAvailableDays] = useState<number[]>(cached?.availableDays ?? [])
  const [timeSlots, setTimeSlots]         = useState<TimeSlot[]>(cached?.timeSlots ?? [])
  const [extraDates, setExtraDates]       = useState<string[]>(cached?.extraDates ?? [])
  const [excludedDates, setExcludedDates] = useState<string[]>(cached?.excludedDates ?? [])
  const [perDaySchedule, setPerDaySchedule] = useState<PerDaySchedule>(cached?.perDaySchedule ?? emptySchedule())
  const [effectiveFrom, setEffectiveFrom] = useState<string>(minEffectiveDate())
  const [minDate, setMinDate]             = useState<string>(minEffectiveDate())
  const [editingScheduled, setEditingScheduled] = useState(false)
  const [editingScheduledDate, setEditingScheduledDate] = useState<string | null>(null)
  const [saving, setSaving]               = useState(false)
  const [message, setMessage]             = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [step, setStep]                   = useState<'editing' | 'confirming'>('editing')
  const [presets, setPresets]             = useState<TimeSlotPreset[]>([])
  const [cancelTarget, setCancelTarget]   = useState<string | null>(null)
  const [lotteryTime, setLotteryTime] = useState(cached?.defaultLotteryTime ?? cached?.lotteryTime ?? '21:00')
  const [lotteryTimeOverrides, setLotteryTimeOverrides] = useState<LotteryTimeOverrides>(cached?.lotteryTimeOverrides ?? { byWeekday: {}, byDate: {} })
  const [addingLotteryRule, setAddingLotteryRule] = useState<'weekday' | 'date' | null>(null)
  const [pickLotteryWeekday, setPickLotteryWeekday] = useState('')
  const [exceptionDate, setExceptionDate] = useState('')
  const [lotteryMode, setLotteryMode] = useState<'previous-day' | 'same-day'>(cached?.lotteryMode ?? 'previous-day')
  const [notifyMode, setNotifyMode] = useState<'previous-day' | 'same-day'>(cached?.notifyMode ?? cached?.lotteryMode ?? 'previous-day')
  const [notifyTime, setNotifyTime] = useState(cached?.notifyTime ?? cached?.lotteryTime ?? '21:00')
  const [hamoaniStartDate, setHamoaniStartDate] = useState<string>(cached?.hamoaniStartDate ?? '')
  const [hamoaniEndDate,   setHamoaniEndDate]   = useState<string>(cached?.hamoaniEndDate ?? '')
  const [roomModeVersions, setRoomModeVersions] = useState<RoomModeVersion[]>(cached?.roomModeVersions ?? [])
  const [roomModeEnabled, setRoomModeEnabled] = useState(() => roomModeAtDate(minEffectiveDate(), cached?.roomModeVersions ?? []))
  const [notificationMode, setNotificationMode] = useState<'post' | 'comment'>('post')
  const [fallbackPost, setFallbackPost] = useState(false)
  const [savedNotification, setSavedNotification] = useState<{ mode: 'post' | 'comment'; fallback: boolean } | null>(null)
  const [commentConfigured, setCommentConfigured] = useState(false)
  const [legacyDayOverrides, setLegacyDayOverrides] = useState<LegacyDayOverride[]>([])
  const [legacyLotteryOverrides, setLegacyLotteryOverrides] = useState<LegacyLotteryOverride[]>([])
  const [deletingOverride, setDeletingOverride] = useState<string | null>(null)
  const { showToast } = useToast()

  useEffect(() => { load(true); loadPresets(); loadLegacyOverrides() }, [])

  async function loadLegacyOverrides() {
    try {
      const [dayRes, lotteryRes] = await Promise.all([
        adminFetch('/api/admin/settings/day-overrides'),
        adminFetch('/api/admin/settings/lottery-overrides'),
      ])
      if (!dayRes.ok || !lotteryRes.ok) return
      const [dayData, lotteryData] = await Promise.all([dayRes.json(), lotteryRes.json()])
      setLegacyDayOverrides(dayData.overrides ?? [])
      setLegacyLotteryOverrides(lotteryData.overrides ?? [])
    } catch { /* Main settings remain available even if legacy overrides cannot be loaded. */ }
  }

  async function removeLegacyOverride(type: 'day' | 'lottery', date: string) {
    const path = type === 'day' ? 'day-overrides' : 'lottery-overrides'
    setDeletingOverride(`${type}:${date}`)
    try {
      const res = await adminFetch(`/api/admin/settings/${path}/${date}`, { method: 'DELETE' })
      const result = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(result.error ?? '解除に失敗しました')
      showToast(`${date} の旧設定を解除しました`)
      if (result.cronWarning) setMessage({ type: 'error', text: result.cronWarning })
      await Promise.all([load(true), loadLegacyOverrides()])
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message ?? '解除に失敗しました' })
    } finally {
      setDeletingOverride(null)
    }
  }

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
      setMessage({ type: 'error', text: err.error ?? 'プリセットの保存に失敗しました' })
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

  async function load(resetRoomMode = false) {
    const [res, roomConfigRes] = await Promise.all([adminFetch('/api/admin/settings'), adminFetch('/api/room/config')])
    if (!res.ok) { setMessage({ type: 'error', text: '設定の取得に失敗しました' }); return }
    if (!roomConfigRes.ok) { setMessage({ type: 'error', text: '通知方式を取得できませんでした' }); return }
    const roomConfig = await roomConfigRes.json()
    setNotificationMode(roomConfig.notificationMode ?? 'post')
    setFallbackPost(roomConfig.fallbackPost === true)
    setSavedNotification({ mode: roomConfig.notificationMode ?? 'post', fallback: roomConfig.fallbackPost === true })
    setCommentConfigured(roomConfig.commentBandConfigured === true)
    const data = (await res.json()) as SettingsResponse
    setCurrent(data)
    setRoomModeVersions(data.roomModeVersions ?? [])
    if (resetRoomMode) setRoomModeEnabled(roomModeAtDate(effectiveFrom, data.roomModeVersions ?? []))
    setPageCache<SettingsResponse>(SETTINGS_CACHE_KEY, data)
    setLotteryTime(data.defaultLotteryTime ?? data.lotteryTime ?? '21:00')
    setLotteryTimeOverrides(data.lotteryTimeOverrides ?? { byWeekday: {}, byDate: {} })
    setLotteryMode(data.lotteryMode ?? 'previous-day')
    setNotifyMode(data.notifyMode ?? data.lotteryMode ?? 'previous-day')
    setNotifyTime(data.notifyTime ?? data.lotteryTime ?? '21:00')
    const hStart = data.hamoaniStartDate ?? ''
    const hEnd   = data.hamoaniEndDate ?? ''
    setHamoaniStartDate(hStart); setHamoaniEndDate(hEnd)
    if (!editingScheduled) applyToForm(data)
  }

  const scheduledChanges = current?.scheduledChanges ?? (current?.nextChange ? [current.nextChange] : [])

  function loadScheduledForEdit(change: ScheduledChange) {
    applyToForm(change)
    setLotteryTime(change.lotteryTime ?? current?.defaultLotteryTime ?? current?.lotteryTime ?? '21:00')
    setLotteryTimeOverrides(change.lotteryTimeOverrides ?? { byWeekday: {}, byDate: {} })
    setEffectiveFrom(change.effectiveFrom)
    setRoomModeEnabled(roomModeAtDate(change.effectiveFrom, roomModeVersions))
    setEditingScheduled(true)
    setEditingScheduledDate(change.effectiveFrom)
    setMessage(null)
  }

  function cancelEditScheduled() {
    if (!current) return
    applyToForm(current)
    setLotteryTime(current.defaultLotteryTime ?? current.lotteryTime ?? '21:00')
    setLotteryTimeOverrides(current.lotteryTimeOverrides ?? { byWeekday: {}, byDate: {} })
    setEffectiveFrom(minEffectiveDate())
    setRoomModeEnabled(roomModeAtDate(minEffectiveDate(), roomModeVersions))
    setEditingScheduled(false)
    setEditingScheduledDate(null)
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

  const exceptionTimes = [...Object.values(lotteryTimeOverrides.byWeekday),
    ...Object.entries(lotteryTimeOverrides.byDate).filter(([date]) => date >= effectiveFrom).map(([, time]) => time)]
  const lotteryTimeInvalid = !lotteryTime || lotteryTime < '03:00' ||
    [lotteryTime, ...exceptionTimes].some((time) => !time || time < '03:00' ||
      !notificationFollowsLottery(lotteryMode, time, notifyMode, notifyTime))
  const operationDirty = !!current && (lotteryMode !== current.lotteryMode ||
    notifyMode !== (current.notifyMode ?? current.lotteryMode) || notifyTime !== current.notifyTime)
  const editDate = todayJST()
  const followingDate = new Date(Date.parse(`${editDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
  const activeExecutionDates = [editDate, followingDate].filter((date) =>
    current?.reservableDatesInWindow?.includes(date))
  const operationBlockedEvent = operationDirty && current
    ? operationChangeOnExecutionDate(editDate, activeExecutionDates, current, {
      lotteryMode, lotteryTime: current.lotteryTime, notifyMode, notifyTime,
    }) : null
  const hamoaniDirty = !!current && (hamoaniStartDate !== (current.hamoaniStartDate ?? '') ||
    hamoaniEndDate !== (current.hamoaniEndDate ?? ''))
  const hamoaniRangeInvalid = !!hamoaniStartDate && !!hamoaniEndDate && hamoaniStartDate > hamoaniEndDate
  const hamoaniIncomplete = (!!hamoaniStartDate && !hamoaniEndDate) || (!hamoaniStartDate && !!hamoaniEndDate)
  const notificationDirty = !!savedNotification && (notificationMode !== savedNotification.mode || fallbackPost !== savedNotification.fallback)

  const { recurringChangeCount, datedChangeCount, changedDatedDates } = useMemo(() => {
    if (!current) return { recurringChangeCount: 0, datedChangeCount: 0, changedDatedDates: [] as string[] }
    const baseline = editingScheduled
      ? scheduledChanges.find((change) => change.effectiveFrom === editingScheduledDate) ?? current
      : current
    const sortedStr = (arr: string[]) => JSON.stringify([...arr].sort())
    const baselineSchedule = baseline.perDaySchedule ?? emptySchedule()
    const recurringChangeCount = [
      JSON.stringify(availableDays) !== JSON.stringify(baseline.availableDays ?? [3, 4, 6]),
      JSON.stringify(timeSlots)     !== JSON.stringify(baseline.timeSlots ?? []),
      JSON.stringify(perDaySchedule.byWeekday) !== JSON.stringify(baselineSchedule.byWeekday),
      (Object.keys(perDaySchedule.byWeekday).length > 0 || Object.keys(baselineSchedule.byWeekday).length > 0) &&
        perDaySchedule.enabled !== baselineSchedule.enabled,
      lotteryTime !== (editingScheduled
        ? baseline.lotteryTime ?? current.defaultLotteryTime ?? current.lotteryTime ?? '21:00'
        : current.defaultLotteryTime ?? current.lotteryTime ?? '21:00'),
      JSON.stringify(lotteryTimeOverrides) !== JSON.stringify(baseline.lotteryTimeOverrides ?? { byWeekday: {}, byDate: {} }),
      roomModeEnabled !== roomModeAtDate(effectiveFrom, roomModeVersions),
      editingScheduled && effectiveFrom !== editingScheduledDate,
    ].filter(Boolean).length
    const extraChanged = sortedStr(extraDates) !== sortedStr(baseline.extraDates ?? [])
    const excludedChanged = sortedStr(excludedDates) !== sortedStr(baseline.excludedDates ?? [])
    const byDateChanged = JSON.stringify(perDaySchedule.byDate) !== JSON.stringify(baselineSchedule.byDate)
    const datedChangeCount = [extraChanged, excludedChanged, byDateChanged].filter(Boolean).length
    const previousDates = baselineSchedule.byDate ?? {}
    const changedDatedDates = [
      ...new Set([
        ...extraDates.filter((date) => !(baseline.extraDates ?? []).includes(date)),
        ...(baseline.extraDates ?? []).filter((date) => !extraDates.includes(date)),
        ...excludedDates.filter((date) => !(baseline.excludedDates ?? []).includes(date)),
        ...(baseline.excludedDates ?? []).filter((date) => !excludedDates.includes(date)),
        ...Object.keys(perDaySchedule.byDate), ...Object.keys(previousDates),
      ]),
    ].filter((date) =>
      extraDates.includes(date) !== (baseline.extraDates ?? []).includes(date) ||
      excludedDates.includes(date) !== (baseline.excludedDates ?? []).includes(date) ||
      JSON.stringify(perDaySchedule.byDate[date] ?? null) !== JSON.stringify(previousDates[date] ?? null),
    ).sort()
    return { recurringChangeCount, datedChangeCount, changedDatedDates }
  }, [current, scheduledChanges, editingScheduled, editingScheduledDate, availableDays, timeSlots, extraDates, excludedDates, perDaySchedule, lotteryTime, lotteryTimeOverrides, roomModeEnabled, effectiveFrom, roomModeVersions])

  const recurringDirty = recurringChangeCount > 0
  const tomorrowWeekday = String(new Date(`${followingDate}T00:00:00Z`).getUTCDay())
  const previousLotteryOverrides = current?.lotteryTimeOverrides ?? { byWeekday: {}, byDate: {} }
  const previousTomorrowTime = previousLotteryOverrides.byDate[followingDate] ??
    previousLotteryOverrides.byWeekday[tomorrowWeekday] ?? current?.defaultLotteryTime ?? current?.lotteryTime ?? lotteryTime
  const nextTomorrowTime = lotteryTimeOverrides.byDate[followingDate] ??
    lotteryTimeOverrides.byWeekday[tomorrowWeekday] ?? lotteryTime
  const tomorrowAvailable = current?.reservableDatesInWindow?.includes(followingDate) ||
    (isDateAvailableInForm(followingDate, availableDays, extraDates, excludedDates) &&
      timeSlotsForDateInForm(followingDate, timeSlots, perDaySchedule).length > 0)
  const recurringBlockedEvent = recurringDirty && current && effectiveFrom <= followingDate && tomorrowAvailable
    ? operationChangeOnExecutionDate(editDate, [followingDate], {
      lotteryMode: current.lotteryMode, lotteryTime: previousTomorrowTime,
      notifyMode: current.notifyMode, notifyTime: current.notifyTime,
    }, {
      lotteryMode: current.lotteryMode, lotteryTime: nextTomorrowTime,
      notifyMode: current.notifyMode, notifyTime: current.notifyTime,
    }) : null
  const blockedEvent = operationBlockedEvent ?? recurringBlockedEvent
  const datedDirty = datedChangeCount > 0
  const reservationScheduleDirty = recurringDirty || datedDirty
  const changeCount = recurringChangeCount + datedChangeCount + Number(operationDirty) + Number(hamoaniDirty) + Number(notificationDirty)
  const isDirty = changeCount > 0

  const effectiveDirty = isDirty

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
  const invalidExtraDates = extraDates.filter((date) => availableDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay()))
  const invalidExcludedDates = excludedDates.filter((date) => !availableDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay()))
  const invalidRuleDates = Object.keys(perDaySchedule.byDate ?? {}).filter((date) =>
    excludedDates.includes(date) || (!extraDates.includes(date) && !availableDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay())))
  const lastReservableDate = (() => {
    const date = new Date(`${minDate}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() + 7)
    return date.toISOString().slice(0, 10)
  })()
  const affectedDates = recurringDirty && effectiveFrom <= lastReservableDate
    ? Array.from(new Set([
      ...(current?.reservableDatesInWindow ?? []).filter((date) => date >= effectiveFrom),
      ...Array.from({ length: 8 }, (_, index) => {
        const date = new Date(`${minDate}T00:00:00Z`)
        date.setUTCDate(date.getUTCDate() + index)
        return date.toISOString().slice(0, 10)
      }).filter((date) => date >= effectiveFrom &&
        isDateAvailableInForm(date, availableDays, extraDates, excludedDates) &&
        timeSlotsForDateInForm(date, timeSlots, perDaySchedule).length > 0),
    ])).sort()
    : []
  const immediateAffectedDates = changedDatedDates.filter((date) => current?.reservableDatesInWindow?.includes(date))
  const hamoaniAffectedDates = hamoaniDirty ? (current?.reservableDatesInWindow ?? []).filter((date) =>
    (Boolean(hamoaniStartDate && hamoaniEndDate) && date >= hamoaniStartDate && date <= hamoaniEndDate) ||
    (Boolean(current?.hamoaniStartDate && current?.hamoaniEndDate) &&
      date >= current!.hamoaniStartDate! && date <= current!.hamoaniEndDate!)) : []

  function goToConfirm() {
    if (!isDirty) return
    setMessage(null)
    if (blockedEvent) {
      setMessage({ type: 'error', text: `変更前または変更後の${blockedEvent}日が本日のため、この変更は適用できません。抽選時刻は適用日を後ろにずらしてください` })
      return
    }
    if (!savedNotification || (notificationMode === 'comment' && !commentConfigured)) {
      setMessage({ type: 'error', text: !savedNotification ? '通知方式を取得できませんでした' : 'コメント先BANDのキーが未設定です' })
      return
    }
    if (!current || !notifyTime || !notificationFollowsLottery(lotteryMode, current.lotteryTime, notifyMode, notifyTime)) {
      setMessage({ type: 'error', text: '通知日は抽選日と同日以降、通知時刻は抽選以降に設定してください' })
      return
    }
    if (hamoaniIncomplete || hamoaniRangeInvalid) {
      setMessage({ type: 'error', text: 'ハモアニ期間の開始日・終了日を正しく指定してください' })
      return
    }
    if (lotteryTimeInvalid) {
      setMessage({ type: 'error', text: '抽選時刻は03:00以降にし、通知日時は抽選以降に設定してください' })
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
    if (invalidExtraDates.length || invalidExcludedDates.length || invalidRuleDates.length) {
      setMessage({ type: 'error', text: '追加日・除外日・特定日ルールの日付を、登録可能曜日に合わせて修正してください' })
      return
    }
    setStep('confirming')
  }


  async function save() {
    setMessage(null)
    if (blockedEvent) {
      setMessage({ type: 'error', text: `変更前または変更後の${blockedEvent}日が本日のため、この変更は適用できません` })
      setStep('editing')
      return
    }
    const currentMin = minEffectiveDate()
    let finalEffective = effectiveFrom
    if (finalEffective < currentMin && recurringDirty) {
      finalEffective = currentMin
      setEffectiveFrom(currentMin)
      setMinDate(currentMin)
      setMessage({ type: 'error', text: `日付が変わったため適用日を ${currentMin} に繰り上げました。内容を確認してもう一度「保存」を押してください` })
      return
    }
    if (finalEffective < currentMin) finalEffective = currentMin

    setSaving(true)
    const applied: string[] = []
    try {
      if (notificationDirty) {
        const notificationRes = await adminFetch('/api/room/config', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notificationMode, fallbackPost }),
        })
        const notificationResult = await notificationRes.json()
        if (!notificationRes.ok) throw new Error(notificationResult.error ?? '通知方式の保存に失敗しました')
        applied.push('BAND通知方式')
      }
      if (operationDirty) {
        const operationRes = await adminFetch('/api/admin/settings/lottery-operation', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lotteryMode, lotteryTime: current!.lotteryTime, notifyMode, notifyTime }),
        })
        const operationResult = await operationRes.json()
        if (!operationRes.ok) throw new Error(operationResult.error ?? '抽選運用の保存に失敗しました')
        applied.push('抽選運用')
      }
      if (hamoaniDirty) {
        const hamoaniRes = await adminFetch('/api/admin/settings/hamoani-period', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hamoaniStartDate: hamoaniStartDate || null, hamoaniEndDate: hamoaniEndDate || null }),
        })
        const hamoaniResult = await hamoaniRes.json()
        if (!hamoaniRes.ok) throw new Error(hamoaniResult.error ?? 'ハモアニ期間の保存に失敗しました')
        applied.push('ハモアニ期間')
      }
      if (reservationScheduleDirty) {
        const res = await adminFetch('/api/admin/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ availableDays, timeSlots, extraDates, excludedDates, perDaySchedule, effectiveFrom: finalEffective, lotteryTime,
            applyRecurring: recurringDirty, applyDated: datedDirty,
            lotteryTimeOverrides: { byWeekday: lotteryTimeOverrides.byWeekday,
              byDate: Object.fromEntries(Object.entries(lotteryTimeOverrides.byDate).filter(([date]) => date >= finalEffective)) },
            roomPreferenceEnabled: roomModeEnabled }),
        })
        const result = await res.json()
        if (!res.ok) throw new Error(result.error ?? '保存に失敗しました')
        showToast(recurringDirty && datedDirty
          ? `設定を保存しました（日付設定は即時反映、その他は${result.effectiveFrom}から適用）`
          : recurringDirty ? `設定を保存しました（${result.effectiveFrom}から適用）` : '日付設定を保存しました（即時反映）')
        if (result.cronWarning) setMessage({ type: 'error', text: result.cronWarning })
      } else {
        showToast('設定を保存しました')
      }
      setEditingScheduled(false)
      setEditingScheduledDate(null)
      setStep('editing')
      await Promise.all([load(), loadLegacyOverrides()])
    } catch (err: any) {
      setMessage({ type: 'error', text: applied.length
        ? `${applied.join('・')}は保存されました。残りは保存できませんでした: ${err.message}`
        : err.message })
      setStep('editing')
    } finally {
      setSaving(false)
    }
  }



  async function execCancelScheduled() {
    if (!cancelTarget) return
    const res = await adminFetch(`/api/admin/settings/scheduled?date=${encodeURIComponent(cancelTarget)}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('取り消しに失敗しました')
    setCancelTarget(null)
    showToast('予約済みの変更を取り消しました')
    setEditingScheduled(false)
    setEditingScheduledDate(null)
    load(true)
  }

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
              ['抽選時刻',              lotteryMode === 'same-day' ? '前日 23:55（固定）' : `前日 ${lotteryTime} の5分前に実行`],
              ['通知時刻',              `${notifyMode === 'previous-day' ? '前日' : '当日'} ${notifyTime}`],
              ['抽選時刻の例外',        `${Object.keys(lotteryTimeOverrides.byWeekday).length}曜日・${Object.keys(lotteryTimeOverrides.byDate).filter((date) => date >= effectiveFrom).length}日`],
              ['デフォルト時間枠',       `${timeSlots.length}件`],
              ['追加日（即時反映）',               `${extraDates.length}件`],
              ['除外日（即時反映）',               `${excludedDates.length}件`],
              ['曜日ルール', Object.keys(perDaySchedule.byWeekday).length + '件'],
              ['特定日ルール（即時反映）', Object.keys(perDaySchedule.byDate).length + '件'],
              ['希望部屋モード',        roomModeEnabled ? 'オン' : 'オフ'],
              ['BAND通知方式（即時反映）', notificationMode === 'comment' ? 'メンション投稿にコメント' : '新規投稿'],
              ...(notificationMode === 'comment' ? [['対象投稿がない場合', fallbackPost ? '1時間後に自動投稿' : '手動通知']] : []),
              ['ハモアニ期間（即時反映）', hamoaniStartDate && hamoaniEndDate ? `${hamoaniStartDate} 〜 ${hamoaniEndDate}` : '無効'],
            ] as [string, string][]).map(([label, value]) => (
              <tr key={label} className="border-b border-line last:border-0">
                <td className="py-3 pr-4 text-ink-sub font-medium w-44 text-[0.88rem]">{label}</td>
                <td className="py-3 font-semibold text-ink">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {recurringDirty && affectedDates.length > 0 && <div className="banner-warn mb-4" role="alert">
        <strong>予約可能期間内の設定が変わります。</strong>
        {' '}対象日: {affectedDates.join('、')}。既存予約は自動では変更されません。
      </div>}
      {datedDirty && immediateAffectedDates.length > 0 && <div className="banner-warn mb-4" role="alert">
        <strong>現在予約可能な日付の設定が即時反映されます。</strong>
        {' '}対象日: {immediateAffectedDates.join('、')}。既存予約は自動では変更されません。
      </div>}
      {hamoaniAffectedDates.length > 0 && <div className="banner-warn mb-4" role="alert">
        <strong>ハモアニ期間の変更が現在予約可能な日付に即時反映されます。</strong>
        {' '}対象日: {hamoaniAffectedDates.join('、')}。既存予約は自動では変更されません。
      </div>}

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

  return (
    <div className={`pb-80 ${!current ? 'skeleton-layout' : ''}`} aria-busy={!current} ref={(el) => { if (el) el.inert = !current }}>
      <FacilitySettingsChanges count={changeCount} />
      <h1 className="text-2xl font-bold mb-6">設定 - 農部生協</h1>

      {message && <div className="banner-error">{message.text}</div>}

      {editingScheduled && (
        <div className="banner-warn">
          <span className="icon icon-sm align-middle">edit</span>
          {' '}{editingScheduledDate ? `${editingScheduledDate} の` : ''}適用予定の変更を編集中（保存すると上書きされます）
          <button className="btn-outline w-auto px-2.5 py-1 ml-3 text-[0.8rem]" onClick={cancelEditScheduled}>
            キャンセル
          </button>
        </div>
      )}

      {scheduledChanges.length > 0 && !editingScheduled && (
        <div className="bg-warn-light border border-warn rounded-xl p-5 mb-4 shadow-[var(--shadow-card-sm)]">
          <div className="flex justify-between items-center mb-3 gap-2 flex-wrap">
            <strong className="text-warn">
              <span className="icon align-middle">schedule</span> 適用予定の変更
            </strong>
            <span className="text-[0.85rem] text-warn">{scheduledChanges.length}件</span>
          </div>
          <div className="flex flex-col gap-2">
            {scheduledChanges.map((change) => (
              <div key={change.effectiveFrom} className="bg-surface/70 border border-warn/50 rounded-lg p-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="text-[0.9rem] text-ink-sub">
                    適用日: <strong>{change.effectiveFrom}</strong>
                    {' / '}
                    抽選: <strong>{change.lotteryTime ?? '—'}</strong>
                    {' / '}
                    曜日: <strong>{change.availableDays.map((d) => WEEK_DAYS[d]).join('・') || 'なし'}</strong>
                    {' / '}
                    追加日: <strong>{change.extraDates?.length ?? 0}件</strong>
                    {' / '}
                    除外日: <strong>{change.excludedDates?.length ?? 0}件</strong>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      className="btn-icon-nav"
                      onClick={() => loadScheduledForEdit(change)}
                      aria-label={`${change.effectiveFrom}の適用予定を編集`}
                      title="編集"
                    >
                      <span className="icon">edit</span>
                    </button>
                    <button
                      className="btn-icon-danger"
                      onClick={() => setCancelTarget(change.effectiveFrom)}
                      aria-label={`${change.effectiveFrom}の適用予定を取り消し`}
                      title="取り消し"
                    >
                      <span className="icon">delete</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
          <h2 className="text-base font-bold mb-3">追加日 <span className="text-xs font-medium text-brand">即時反映</span></h2>
          <p className="text-[0.85rem] text-ink-sub mb-3">
            上記の曜日に該当しない日でも、ここに追加した日は予約可能になります。
            今日以降で、登録可能曜日以外の日付を選択できます。保存すると即時反映します。
          </p>
          <DateListEditor
            dates={extraDates}
            onChange={setExtraDates}
            min={minDate}
            isDateDisabled={(date) => availableDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay())}
            emptyText="追加日なし"
            label="予約可能にする日を選択"
            conflictDates={excludedDates}
            conflictLabel="除外日"
            onMoveConflict={(date) => setExcludedDates((prev) => prev.filter((d) => d !== date))}
          />
          {invalidExtraDates.length > 0 && (
            <p className="mt-2 text-warn text-[0.85rem]">
              <span className="icon icon-sm align-middle">warning</span>
              {' '}登録可能曜日に含まれるため追加日には指定できません：{invalidExtraDates.join('、')}
            </p>
          )}
        </div>

        <div className="admin-card">
          <h2 className="text-base font-bold mb-3">除外日 <span className="text-xs font-medium text-brand">即時反映</span></h2>
          <p className="text-[0.85rem] text-ink-sub mb-3">
            通常は予約可能曜日でも、ここに登録した日は予約できなくなります（祝日や臨時休業など）。
            今日以降で、登録可能曜日の日付だけを選択できます。保存すると即時反映します。
          </p>
          <DateListEditor
            dates={excludedDates}
            onChange={setExcludedDates}
            min={minDate}
            isDateDisabled={(date) => !availableDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay())}
            emptyText="除外日なし"
            label="予約不可にする日を選択"
            conflictDates={extraDates}
            conflictLabel="追加日"
            onMoveConflict={(date) => setExtraDates((prev) => prev.filter((d) => d !== date))}
          />
          {invalidExcludedDates.length > 0 && (
            <p className="mt-2 text-warn text-[0.85rem]">
              <span className="icon icon-sm align-middle">warning</span>
              {' '}登録可能曜日以外の日付は除外日に指定できません：{invalidExcludedDates.join('、')}
            </p>
          )}
        </div>
      </div>

      {legacyDayOverrides.length > 0 && <div className="admin-card">
        <h3 className="font-bold mb-2">以前に登録した日別設定</h3>
        <p className="text-[0.85rem] text-ink-sub mb-3">この設定は通常の追加日・除外日・時間枠より優先されます。新しい設定を保存すると、適用日以降の登録は置き換わります。</p>
        <div className="flex flex-col gap-2">
          {legacyDayOverrides.map((entry) => <div key={entry.date} className="flex items-center justify-between gap-3 rounded-lg border border-line p-3">
            <span className="text-sm">{entry.date}：{entry.type === 'blocked' ? '予約不可' : `予約可能${entry.timeSlots?.length ? `（時間枠 ${entry.timeSlots.length} 件）` : ''}`}{entry.reason ? ` / ${entry.reason}` : ''}</span>
            <button type="button" className="btn-outline w-auto px-3 py-1.5 shrink-0" disabled={deletingOverride !== null}
              onClick={() => { if (window.confirm(`${entry.date} の日別設定を解除しますか？`)) void removeLegacyOverride('day', entry.date) }}>解除</button>
          </div>)}
        </div>
      </div>}

      <div className="admin-card">
        <h2 className="text-base font-bold mb-4">時間枠</h2>
        <h3 className="font-bold mb-2">デフォルト時間枠</h3>
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
        <div className="mt-5 border-t border-line pt-4">
          <h3 className="font-bold mb-3">時間枠の例外設定</h3>
          <PerDayScheduleEditor
          immediateDateRules
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
          {invalidRuleDates.length > 0 && (
            <p className="mt-3 text-warn text-[0.85rem]">
              <span className="icon icon-sm align-middle">warning</span>
              {' '}特定日ルールは除外日を除く登録可能曜日・追加日から指定してください：{invalidRuleDates.join('、')}
            </p>
          )}
        </div>
      </div>

      <RoomPreferenceSettings enabled={roomModeEnabled} onEnabledChange={setRoomModeEnabled}
        mode={notificationMode} onModeChange={setNotificationMode} fallback={fallbackPost}
        onFallbackChange={setFallbackPost} commentConfigured={commentConfigured} />

      {/* 抽選・通知時刻 */}
      <div className="admin-card">
        <h2 className="text-base font-bold mb-3">抽選・通知時刻</h2>
        <h3 className="font-bold mb-1">抽選時刻</h3>
        <p className="text-[0.85rem] text-ink-sub mb-3">抽選日は保存すると即時反映し、時刻は下の「適用日」以降の利用日から反映します。</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block w-48 text-[0.8rem] text-ink-sub">利用日を基準にした抽選日
            <select className="text-input mt-1 w-full" value={lotteryMode} onChange={(e) => {
              const mode = e.target.value as 'previous-day' | 'same-day'
              setLotteryMode(mode)
              if (mode === 'same-day') setNotifyMode('same-day')
            }}>
              <option value="previous-day">前日</option>
              <option value="same-day">当日</option>
            </select>
          </label>
          <label className="block text-[0.8rem] text-ink-sub">時刻
            <input type="time" className="text-input mt-1 disabled:bg-bg disabled:text-ink-pale disabled:cursor-not-allowed" min="03:00" max="23:59" value={lotteryMode === 'same-day' ? '23:55' : lotteryTime} disabled={lotteryMode === 'same-day'} onChange={(e) => setLotteryTime(e.target.value)} />
          </label>
        </div>
        {lotteryTimeInvalid ? (
          <p className="mt-2 text-danger text-[0.85rem]">
            <span className="icon icon-sm align-middle">error</span>
            {' '}抽選時刻は03:00以降にし、通知日時は抽選以降に設定してください
          </p>
        ) : (
          <p className="mt-2 text-[0.82rem] text-ink-sub">
            {lotteryMode === 'same-day'
              ? '当日モードは利用日前日の23:50締切・23:55抽選（固定）です'
              : `${computeLockoutTime(lotteryTime)}（設定時刻の10分前）に翌日分の受付を終了し、5分前に抽選します`}
          </p>
        )}
        <div className="mt-5 border-t border-line pt-4">
          <h3 className="font-bold mb-1">通知時刻</h3>
          <p className="text-[0.85rem] text-ink-sub mb-3">利用日を基準にした通知日と時刻を指定します。保存すると即時反映されます。</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block w-48 text-[0.8rem] text-ink-sub">通知日
              <select className="text-input mt-1 w-full" value={notifyMode} onChange={(e) => {
                const mode = e.target.value as 'previous-day' | 'same-day'
                setNotifyMode(mode)
                if (mode === 'previous-day') setLotteryMode('previous-day')
              }}>
                <option value="previous-day">前日</option>
                <option value="same-day">当日</option>
              </select>
            </label>
            <label className="block text-[0.8rem] text-ink-sub">時刻
              <input type="time" className="text-input mt-1" min="00:00" max="23:59" value={notifyTime} onChange={(e) => setNotifyTime(e.target.value)} />
            </label>
          </div>
          {lotteryTimeInvalid && <p className="mt-2 text-danger text-[0.85rem]">通知日時は通常時刻とすべての例外抽選時刻以降にしてください。</p>}
        </div>
        <fieldset disabled={lotteryMode === 'same-day'} className="mt-5 border-t border-line pt-4 disabled:opacity-50">
          <h3 className="font-bold mb-2">抽選時刻の例外設定</h3>
          <p className="text-sm text-ink-sub mb-3">{lotteryMode === 'same-day' ? '当日モードでは前日23:55固定のため、時刻の例外設定は使用しません。' : '通常と異なる時刻を使う日だけ登録します。適用順: 特定日 > 曜日ルール > 通常の抽選時刻'}</p>
          <div className="flex gap-2 flex-wrap mb-4">
            {Object.keys(lotteryTimeOverrides.byWeekday).length < 7 &&
              <button type="button" className="btn-outline w-auto px-3 py-2" onClick={() => setAddingLotteryRule('weekday')}>
                <span className="icon icon-sm">add</span> 曜日ルールを追加
              </button>}
            <button type="button" className="btn-outline w-auto px-3 py-2" onClick={() => setAddingLotteryRule('date')}>
              <span className="icon icon-sm">add</span> 特定日ルールを追加
            </button>
          </div>
          {addingLotteryRule && <div className="bg-bg border border-line rounded-[10px] p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <strong className="text-[0.9rem]">{addingLotteryRule === 'weekday' ? '曜日ルールを追加' : '特定日ルールを追加'}</strong>
              <button type="button" className="btn-icon-close" aria-label="閉じる" onClick={() => { setAddingLotteryRule(null); setPickLotteryWeekday(''); setExceptionDate('') }}>
                <span className="icon">close</span>
              </button>
            </div>
            <div className="flex gap-2 items-center flex-wrap">
              {addingLotteryRule === 'weekday' ? <select className="text-input w-auto" value={pickLotteryWeekday} onChange={(e) => setPickLotteryWeekday(e.target.value)}>
                <option value="">曜日を選択</option>
                {WEEK_DAYS.map((day, index) => !lotteryTimeOverrides.byWeekday[String(index)] &&
                  <option key={index} value={String(index)}>{day}曜</option>)}
              </select> : <DatePicker value={exceptionDate} onChange={setExceptionDate} min={effectiveFrom} placeholder="日付を選択" />}
              <button type="button" className="btn-primary w-auto px-4 py-2"
                disabled={addingLotteryRule === 'weekday' ? !pickLotteryWeekday : !exceptionDate || exceptionDate < effectiveFrom || !!lotteryTimeOverrides.byDate[exceptionDate]}
                onClick={() => {
                  if (addingLotteryRule === 'weekday') {
                    setLotteryTimeOverrides((prev) => ({ ...prev, byWeekday: { ...prev.byWeekday, [pickLotteryWeekday]: lotteryTime } }))
                    setPickLotteryWeekday('')
                  } else {
                    setLotteryTimeOverrides((prev) => ({ ...prev, byDate: { ...prev.byDate, [exceptionDate]: lotteryTime } }))
                    setExceptionDate('')
                  }
                  setAddingLotteryRule(null)
                }}>作成して編集</button>
            </div>
          </div>}
          {Object.keys(lotteryTimeOverrides.byWeekday).length === 0 && Object.keys(lotteryTimeOverrides.byDate).length === 0 && !addingLotteryRule &&
            <div className="bg-bg border border-dashed border-line rounded-[10px] px-4 py-5 text-[0.85rem] text-ink-pale text-center">例外ルールはありません。通常の抽選時刻が適用されます。</div>}
          {Object.entries(lotteryTimeOverrides.byWeekday).sort(([a], [b]) => Number(a) - Number(b)).map(([day, time]) =>
            <div key={day} className="bg-surface border border-line rounded-[10px] p-3 mb-2 flex flex-wrap items-center gap-3">
              <strong className="text-sm min-w-28">毎週 {WEEK_DAYS[Number(day)]}曜日</strong>
              <input type="time" className="text-input w-auto" aria-label={`${WEEK_DAYS[Number(day)]}曜日の抽選時刻`} value={time}
                onChange={(e) => setLotteryTimeOverrides((prev) => ({ ...prev, byWeekday: { ...prev.byWeekday, [day]: e.target.value } }))} />
              <button type="button" className="btn-icon-danger ml-auto" aria-label={`${WEEK_DAYS[Number(day)]}曜日ルールを削除`}
                onClick={() => setLotteryTimeOverrides((prev) => { const byWeekday = { ...prev.byWeekday }; delete byWeekday[day]; return { ...prev, byWeekday } })}>
                <span className="icon">delete</span>
              </button>
            </div>)}
          {Object.entries(lotteryTimeOverrides.byDate).filter(([date]) => date >= effectiveFrom).sort(([a], [b]) => a.localeCompare(b)).map(([date, time]) =>
            <div key={date} className="bg-surface border border-line rounded-[10px] p-3 mb-2 flex flex-wrap items-center gap-3">
              <strong className="text-sm min-w-28">{date}</strong>
              <input type="time" className="text-input w-auto" aria-label={`${date}の抽選時刻`} value={time}
                onChange={(e) => setLotteryTimeOverrides((prev) => ({ ...prev, byDate: { ...prev.byDate, [date]: e.target.value } }))} />
              <button type="button" className="btn-icon-danger ml-auto" aria-label={`${date}の特定日ルールを削除`}
                onClick={() => setLotteryTimeOverrides((prev) => { const byDate = { ...prev.byDate }; delete byDate[date]; return { ...prev, byDate } })}>
                <span className="icon">delete</span>
              </button>
            </div>)}
          {legacyLotteryOverrides.length > 0 && <div className="mt-4 border-t border-line pt-4">
            <h4 className="font-bold mb-2">以前に登録した日別抽選時刻</h4>
            <p className="text-[0.85rem] text-ink-sub mb-3">通常の抽選時刻より優先されます。新しい設定を保存すると、適用日以降の登録は置き換わります。</p>
            {legacyLotteryOverrides.map((entry) => <div key={entry.date} className="flex items-center justify-between gap-3 rounded-lg border border-line p-3 mb-2">
              <span className="text-sm">{entry.date}：{entry.lotteryTime}</span>
              <button type="button" className="btn-outline w-auto px-3 py-1.5 shrink-0" disabled={deletingOverride !== null}
                onClick={() => { if (window.confirm(`${entry.date} の日別抽選時刻を解除しますか？`)) void removeLegacyOverride('lottery', entry.date) }}>解除</button>
            </div>)}
          </div>}
        </fieldset>
      </div>

      {/* ハモアニ期間（適用日方式ではなく即時反映。毎年夏休み前後などに自由に設定する運用） */}
      <div className="admin-card">
        <h2 className="text-base font-bold mb-1">ハモアニ期間</h2>
        <p className="text-[0.85rem] text-ink-sub mb-3">
          この期間中に登録された「ハモアニ」チェック付きの予約は、抽選で常に優先（上位）になります。
          保存すると即座に反映されます（適用日の指定は不要です）。開始日・終了日を両方空にすると無効化されます。
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <label className="block text-[0.8rem] text-ink-sub mb-1">開始日</label>
            <DatePicker value={hamoaniStartDate} onChange={setHamoaniStartDate} clearable />
          </div>
          <div>
            <label className="block text-[0.8rem] text-ink-sub mb-1">終了日</label>
            <DatePicker value={hamoaniEndDate} onChange={setHamoaniEndDate} min={hamoaniStartDate || undefined} clearable />
          </div>
        </div>
        {!!current?.hamoaniStartDate && !!current?.hamoaniEndDate && (
          <p className="mt-2 text-[0.82rem] text-ink-sub">
            現在有効: <strong className="text-ink">{current.hamoaniStartDate} 〜 {current.hamoaniEndDate}</strong>
          </p>
        )}
        {(!current?.hamoaniStartDate || !current?.hamoaniEndDate) && (
          <p className="mt-2 text-[0.82rem] text-ink-pale">現在は無効です</p>
        )}
      </div>

      <div className="admin-card">
        <h2 className="text-base font-bold mb-3">適用日</h2>
        <p className="text-[0.85rem] text-ink-sub mb-3">登録可能曜日、時間枠、曜日ルールなどの適用日です。追加日・除外日・特定日ルールは保存時に即時反映します。<strong>{minDate}</strong> 以降の日付を指定してください。</p>
        <DatePicker value={effectiveFrom} onChange={(date) => {
          setEffectiveFrom(date)
          setRoomModeEnabled(roomModeAtDate(date, roomModeVersions))
        }} min={minDate} />
        {blockedEvent && <div className="banner-warn mt-3" role="alert">
          変更前または変更後の{blockedEvent}日が本日のため、この変更は適用できません。
          {operationBlockedEvent ? ' 抽選・通知日の変更は即時反映のため、実行日のない日に変更してください。' : ' 抽選時刻の適用日を後ろにずらしてください。'}
        </div>}
        {recurringDirty && affectedDates.length > 0 && <div className="banner-warn mt-3" role="alert">
          <strong>予約可能期間内の設定が変わります。</strong>
          {' '}現在または変更後に予約可能な日付: {affectedDates.join('、')}。既存予約は自動では変更されません。
        </div>}
        {datedDirty && immediateAffectedDates.length > 0 && <div className="banner-warn mt-3" role="alert">
          <strong>現在予約可能な日付の設定が即時反映されます。</strong>
          {' '}対象日: {immediateAffectedDates.join('、')}。既存予約は自動では変更されません。
        </div>}
        {hamoaniAffectedDates.length > 0 && <div className="banner-warn mt-3" role="alert">
          <strong>ハモアニ期間の変更が現在予約可能な日付に即時反映されます。</strong>
          {' '}対象日: {hamoaniAffectedDates.join('、')}。既存予約は自動では変更されません。
        </div>}
      </div>

      <button className="btn-primary max-w-[300px]" onClick={goToConfirm} disabled={!isDirty || !!blockedEvent}>
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

      {cancelTarget && (
        <ConfirmDialog
          title="適用予定の取り消し"
          message={`${cancelTarget} の適用予定を取り消しますか？`}
          confirmLabel="取り消す"
          onClose={() => setCancelTarget(null)}
          onConfirm={execCancelScheduled}
        />
      )}

    </div>
  )
}
