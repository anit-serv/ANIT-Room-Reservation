import type { Firestore } from 'firebase-admin/firestore'

export type TimeSlot = { label: string; value: string; deleted?: boolean }

export type PerDaySchedule = {
  enabled: boolean
  byWeekday: { [day: string]: TimeSlot[] }
  byDate: { [date: string]: TimeSlot[] }
}

export type ReservationSettingsCore = {
  availableDays: number[]
  timeSlots: TimeSlot[]
  extraDates: string[]
  excludedDates: string[]
  perDaySchedule: PerDaySchedule
}

export type ReservationSettings = ReservationSettingsCore & {
  effectiveFrom: string
  lotteryTime: string
  defaultLotteryTime: string
  lotteryTimeOverrides: LotteryTimeOverrides
  lotteryMode: 'previous-day' | 'same-day'
  notifyMode: 'previous-day' | 'same-day'
  notifyTime: string
  dayOverride?: ReservationDayOverride | null
  /** 適用日を待たずに反映する特定日の時間枠。 */
  immediateDateTimeSlots?: Record<string, TimeSlot[]>
  /** ハモアニ優先抽選の有効期間（開始日）。null なら無効 */
  hamoaniStartDate: string | null
  /** ハモアニ優先抽選の有効期間（終了日、当日を含む）。null なら無効 */
  hamoaniEndDate: string | null
}

export type ReservationSettingsVersion = ReservationSettingsCore & {
  effectiveFrom: string
  /** このバージョンが適用される日以降の抽選時刻（HH:MM）。未設定なら base 値にフォールバック */
  lotteryTime?: string
  lotteryTimeOverrides: LotteryTimeOverrides
}

export type LotteryTimeOverrides = { byWeekday: Record<string, string>; byDate: Record<string, string> }

const LOTTERY_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export type ReservationDayOverride = {
  date: string
  type: 'blocked' | 'opened'
  reason: string
  timeSlots?: TimeSlot[]
}

export const DEFAULT_AVAILABLE_DAYS = [3, 4, 6]

export const DEFAULT_TIME_SLOTS: TimeSlot[] = [
  { label: '9:00~10:00', value: '09:00-10:00' },
  { label: '10:00~12:00', value: '10:00-12:00' },
  { label: '12:00~14:00', value: '12:00-14:00' },
  { label: '14:00~16:00', value: '14:00-16:00' },
  { label: '16:00~18:00', value: '16:00-18:00' },
  { label: '18:00~20:00', value: '18:00-20:00' },
]

export const DEFAULT_LOTTERY_TIME = '21:00'
export const DEFAULT_NOTIFY_TIME = '21:00'
export const BASE_EFFECTIVE_FROM = '0000-00-00'

const EMPTY_SCHEDULE: PerDaySchedule = { enabled: false, byWeekday: {}, byDate: {} }
const EMPTY_LOTTERY_OVERRIDES: LotteryTimeOverrides = { byWeekday: {}, byDate: {} }

type ImmediateDatedSettings = {
  extraDates: string[]
  excludedDates: string[]
  byDate: Record<string, TimeSlot[]>
}

function readImmediateDatedSettings(data: any): ImmediateDatedSettings | null {
  const value = data?.immediateDatedSettings
  if (!value || !Array.isArray(value.extraDates) || !Array.isArray(value.excludedDates) ||
      !value.byDate || typeof value.byDate !== 'object') return null
  return { extraDates: value.extraDates, excludedDates: value.excludedDates, byDate: value.byDate }
}

function withImmediateDatedSettings<T extends ReservationSettingsCore>(settings: T, data: any): T {
  const immediate = readImmediateDatedSettings(data)
  if (!immediate) return settings
  return {
    ...settings,
    extraDates: immediate.extraDates,
    excludedDates: immediate.excludedDates,
    perDaySchedule: { ...settings.perDaySchedule, byDate: immediate.byDate },
    immediateDateTimeSlots: immediate.byDate,
  }
}

export function normalizeLotteryTimeOverrides(value: any): LotteryTimeOverrides {
  const validEntries = (entries: any, keyCheck: (key: string) => boolean) =>
    Object.fromEntries(Object.entries(entries ?? {}).filter(([key, time]) => keyCheck(key) && typeof time === 'string' && LOTTERY_TIME_RE.test(time))) as Record<string, string>
  return {
    byWeekday: validEntries(value?.byWeekday, (key) => /^[0-6]$/.test(key)),
    byDate: validEntries(value?.byDate, (key) => DATE_ONLY_RE.test(key)),
  }
}

function lotteryTimeForDate(date: string, normalTime: string, overrides: LotteryTimeOverrides): string {
  const weekday = String(new Date(`${date}T00:00:00Z`).getUTCDay())
  return overrides.byDate[date] ?? overrides.byWeekday[weekday] ?? normalTime
}

export function todayJST(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export function addDaysJST(days: number): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function normalizeReservationSettingsCore(data: any): ReservationSettingsCore {
  let timeSlots = data?.timeSlots as TimeSlot[] | undefined
  if ((!timeSlots || timeSlots.length === 0) && (data?.openTime || data?.closeTime)) {
    const open = data.openTime ?? '09:00'
    const close = data.closeTime ?? '20:00'
    timeSlots = [{ label: `${open}〜${close}`, value: `${open}-${close}` }]
  }

  return {
    availableDays: Array.isArray(data?.availableDays) ? data.availableDays : DEFAULT_AVAILABLE_DAYS,
    timeSlots: (timeSlots?.length ? timeSlots : DEFAULT_TIME_SLOTS).filter((slot) => !slot.deleted),
    extraDates: Array.isArray(data?.extraDates) ? data.extraDates : [],
    excludedDates: Array.isArray(data?.excludedDates) ? data.excludedDates : [],
    perDaySchedule: data?.perDaySchedule ?? EMPTY_SCHEDULE,
  }
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

export function normalizeReservationSettings(data: any, effectiveFrom = BASE_EFFECTIVE_FROM): ReservationSettings {
  return {
    ...normalizeReservationSettingsCore(data),
    effectiveFrom,
    lotteryTime: data?.lotteryTime ?? DEFAULT_LOTTERY_TIME,
    defaultLotteryTime: data?.lotteryTime ?? DEFAULT_LOTTERY_TIME,
    lotteryTimeOverrides: normalizeLotteryTimeOverrides(data?.lotteryTimeOverrides),
    lotteryMode: data?.lotteryMode === 'same-day' ? 'same-day' : 'previous-day',
    notifyMode: data?.notifyMode === 'same-day' ? 'same-day' :
      data?.notifyMode === 'previous-day' ? 'previous-day' :
      (data?.lotteryMode === 'same-day' ? 'same-day' : 'previous-day'),
    notifyTime: typeof data?.notifyTime === 'string' && LOTTERY_TIME_RE.test(data.notifyTime)
      ? data.notifyTime : (data?.lotteryTime ?? DEFAULT_NOTIFY_TIME),
    hamoaniStartDate: typeof data?.hamoaniStartDate === 'string' && DATE_ONLY_RE.test(data.hamoaniStartDate) ? data.hamoaniStartDate : null,
    hamoaniEndDate: typeof data?.hamoaniEndDate === 'string' && DATE_ONLY_RE.test(data.hamoaniEndDate) ? data.hamoaniEndDate : null,
  }
}

/** 指定日がハモアニ優先抽選の有効期間内かどうか（開始日・終了日を含む） */
export function isHamoaniActive(
  settings: { hamoaniStartDate?: string | null; hamoaniEndDate?: string | null },
  date: string,
): boolean {
  if (!settings.hamoaniStartDate || !settings.hamoaniEndDate) return false
  return date >= settings.hamoaniStartDate && date <= settings.hamoaniEndDate
}

export function pickTimeSlotsForDate(date: string, settings: ReservationSettingsCore): TimeSlot[] {
  const override = (settings as ReservationSettings).dayOverride
  if (override?.date === date) {
    if (override.type === 'blocked') return []
    if (override.timeSlots?.length) return override.timeSlots
  }
  const immediateSlots = (settings as ReservationSettings).immediateDateTimeSlots?.[date]
  if (immediateSlots?.length) return immediateSlots
  const sched = settings.perDaySchedule
  const defaultSlots = settings.timeSlots?.length ? settings.timeSlots : DEFAULT_TIME_SLOTS
  if (!sched?.enabled) return defaultSlots
  if (sched.byDate?.[date]?.length) return sched.byDate[date]
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay()
  if (sched.byWeekday?.[String(weekday)]?.length) return sched.byWeekday[String(weekday)]
  return defaultSlots
}

/** 農部生協が開いている時間を農部室の予約枠から除く。端点が接するだけなら重複しない。 */
export function excludeNobuSeikyoHours(roomSlots: TimeSlot[], seikyoSlots: TimeSlot[]): TimeSlot[] {
  const toMinutes = (time: string) => {
    const [hour, minute] = time.split(':').map(Number)
    return hour * 60 + minute
  }
  const toTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  const blocked = seikyoSlots.map((slot) => slot.value.split('-').map(toMinutes))
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && start < end)
    .sort(([a], [b]) => a - b)
  return roomSlots.flatMap((slot) => {
    const [start, end] = slot.value.split('-').map(toMinutes)
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return []
    let available: [number, number][] = [[start, end]]
    for (const [blockedStart, blockedEnd] of blocked) {
      available = available.flatMap(([a, b]) => {
        if (blockedEnd <= a || blockedStart >= b) return [[a, b]] as [number, number][]
        const parts: [number, number][] = []
        if (a < blockedStart) parts.push([a, blockedStart])
        if (blockedEnd < b) parts.push([blockedEnd, b])
        return parts
      })
    }
    return available.map(([a, b]) => ({ label: `${toTime(a)}〜${toTime(b)}`, value: `${toTime(a)}-${toTime(b)}` }))
  })
}

export async function pickNobuRoomTimeSlotsForDate(db: Firestore, date: string, roomSlots: TimeSlot[]): Promise<TimeSlot[]> {
  const seikyo = await resolveReservationSettingsForDate(db, date)
  return excludeNobuSeikyoHours(roomSlots,
    isDateAvailableBySettings(date, seikyo) ? pickTimeSlotsForDate(date, seikyo) : [])
}

export function isDateAvailableBySettings(date: string, settings: ReservationSettingsCore): boolean {
  const override = (settings as ReservationSettings).dayOverride
  if (override?.date === date) return override.type === 'opened'
  if (settings.excludedDates.includes(date)) return false
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay()
  return settings.availableDays.includes(weekday) || settings.extraDates.includes(date)
}

export function isTimeSlotAvailableBySettings(dateTime: string, settings: ReservationSettingsCore): boolean {
  const [date, timeSlot] = dateTime.split('T')
  if (!date || !timeSlot || !isDateAvailableBySettings(date, settings)) return false
  return pickTimeSlotsForDate(date, settings).some((slot) => slot.value === timeSlot)
}

function normalizeVersion(data: any): ReservationSettingsVersion | null {
  if (!data?.effectiveFrom || typeof data.effectiveFrom !== 'string') return null
  const lotteryTime =
    typeof data.lotteryTime === 'string' && LOTTERY_TIME_RE.test(data.lotteryTime)
      ? data.lotteryTime
      : undefined
  return {
    ...normalizeReservationSettingsCore(data),
    effectiveFrom: data.effectiveFrom,
    ...(lotteryTime ? { lotteryTime } : {}),
    lotteryTimeOverrides: normalizeLotteryTimeOverrides(data?.lotteryTimeOverrides),
  }
}

function normalizeDayOverride(data: any): ReservationDayOverride | null {
  if (!data?.date || typeof data.date !== 'string') return null
  if (data.type !== 'blocked' && data.type !== 'opened') return null
  const timeSlots = Array.isArray(data.timeSlots)
    ? data.timeSlots.filter((slot: any) => slot && typeof slot.label === 'string' && typeof slot.value === 'string')
    : undefined
  return {
    date: data.date,
    type: data.type,
    reason: typeof data.reason === 'string' ? data.reason : '',
    ...(timeSlots?.length ? { timeSlots } : {}),
  }
}

function compareEffectiveFrom(a: { effectiveFrom: string }, b: { effectiveFrom: string }): number {
  return a.effectiveFrom.localeCompare(b.effectiveFrom)
}

export async function listReservationSettingsVersions(
  db: Firestore,
  options: { maxEffectiveFrom?: string; minEffectiveFrom?: string } = {},
): Promise<ReservationSettingsVersion[]> {
  let query: FirebaseFirestore.Query = db
    .collection('settings')
    .doc('reservation')
    .collection('versions')

  if (options.maxEffectiveFrom) query = query.where('effectiveFrom', '<=', options.maxEffectiveFrom)
  if (options.minEffectiveFrom) query = query.where('effectiveFrom', '>=', options.minEffectiveFrom)

  const snap = await query.get()
  return snap.docs
    .map((doc) => normalizeVersion(doc.data()))
    .filter((version): version is ReservationSettingsVersion => version !== null)
    .sort(compareEffectiveFrom)
}

export async function getReservationDayOverride(
  db: Firestore,
  date: string,
): Promise<ReservationDayOverride | null> {
  const doc = await db
    .collection('settings')
    .doc('reservation')
    .collection('dayOverrides')
    .doc(date)
    .get()
  return doc.exists ? normalizeDayOverride(doc.data()) : null
}

export async function listReservationDayOverrides(
  db: Firestore,
  options: { minDate?: string; maxDate?: string } = {},
): Promise<ReservationDayOverride[]> {
  let query: FirebaseFirestore.Query = db
    .collection('settings')
    .doc('reservation')
    .collection('dayOverrides')

  if (options.minDate) query = query.where('date', '>=', options.minDate)
  if (options.maxDate) query = query.where('date', '<=', options.maxDate)

  const snap = await query.get()
  return snap.docs
    .map((doc) => normalizeDayOverride(doc.data()))
    .filter((override): override is ReservationDayOverride => override !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
}

// ─── 抽選時刻の日付別緊急上書き（dayOverrides とは独立） ───
export type ReservationLotteryOverride = { date: string; lotteryTime: string }

function normalizeLotteryOverride(data: any): ReservationLotteryOverride | null {
  if (!data?.date || typeof data.date !== 'string') return null
  if (typeof data.lotteryTime !== 'string' || !LOTTERY_TIME_RE.test(data.lotteryTime)) return null
  return { date: data.date, lotteryTime: data.lotteryTime }
}

export async function getReservationLotteryOverride(
  db: Firestore,
  date: string,
): Promise<ReservationLotteryOverride | null> {
  const doc = await db
    .collection('settings')
    .doc('reservation')
    .collection('lotteryOverrides')
    .doc(date)
    .get()
  return doc.exists ? normalizeLotteryOverride(doc.data()) : null
}

export async function listReservationLotteryOverrides(
  db: Firestore,
  options: { minDate?: string; maxDate?: string } = {},
): Promise<ReservationLotteryOverride[]> {
  let query: FirebaseFirestore.Query = db
    .collection('settings')
    .doc('reservation')
    .collection('lotteryOverrides')

  if (options.minDate) query = query.where('date', '>=', options.minDate)
  if (options.maxDate) query = query.where('date', '<=', options.maxDate)

  const snap = await query.get()
  return snap.docs
    .map((doc) => normalizeLotteryOverride(doc.data()))
    .filter((o): o is ReservationLotteryOverride => o !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
}

export async function getPendingReservationSettingsChange(
  db: Firestore,
  fromDate = addDaysJST(1),
): Promise<(ReservationSettingsVersion & { source: 'version' | 'legacy-next-change' }) | null> {
  const candidates = await listPendingReservationSettingsChanges(db, fromDate)
  return candidates[0] ?? null
}

export async function listPendingReservationSettingsChanges(
  db: Firestore,
  fromDate = addDaysJST(1),
): Promise<(ReservationSettingsVersion & { source: 'version' | 'legacy-next-change' })[]> {
  const [doc, futureVersions] = await Promise.all([
    db.collection('settings').doc('reservation').get(),
    listReservationSettingsVersions(db, { minEffectiveFrom: fromDate }),
  ])
  const data = doc.exists ? doc.data() : {}
  const candidates: (ReservationSettingsVersion & { source: 'version' | 'legacy-next-change' })[] =
    futureVersions.map((version) => ({ ...version, source: 'version' }))

  const legacy = normalizeVersion(data?.nextChange)
  if (legacy && legacy.effectiveFrom >= fromDate) {
    candidates.push({ ...legacy, source: 'legacy-next-change' })
  }

  return candidates.sort(compareEffectiveFrom).map((change) => withImmediateDatedSettings(change, data))
}

export async function resolveReservationSettingsForDate(
  db: Firestore,
  date: string,
): Promise<ReservationSettings> {
  const docRef = db.collection('settings').doc('reservation')
  const [doc, versions, dayOverride, lotteryOverride] = await Promise.all([
    docRef.get(),
    listReservationSettingsVersions(db, { maxEffectiveFrom: date }),
    getReservationDayOverride(db, date),
    getReservationLotteryOverride(db, date),
  ])
  const data = doc.exists ? doc.data() : {}
  const base = normalizeReservationSettings(data, BASE_EFFECTIVE_FROM)
  const legacy = normalizeVersion(data?.nextChange)

  const applicable = [...versions]
  if (legacy && legacy.effectiveFrom <= date) applicable.push(legacy)

  const sortedApplicable = applicable.sort(compareEffectiveFrom)
  const latest = sortedApplicable[sortedApplicable.length - 1]
  // 抽選時刻の優先順位: 日付別緊急上書き > 適用中バージョン > base
  const defaultLotteryTime = latest?.lotteryTime ?? base.defaultLotteryTime
  const lotteryTimeOverrides = latest?.lotteryTimeOverrides ?? base.lotteryTimeOverrides
  const lotteryTime = lotteryOverride?.lotteryTime ?? lotteryTimeForDate(date, defaultLotteryTime, lotteryTimeOverrides)
  const notifyTime = typeof data?.notifyTime === 'string' && LOTTERY_TIME_RE.test(data.notifyTime)
    ? base.notifyTime : lotteryTime
  // ハモアニ期間はバージョン管理せず base の値をそのまま使う（管理画面から自由に即時変更する運用のため）
  const { hamoaniStartDate, hamoaniEndDate } = base
  if (!latest) return withImmediateDatedSettings({ ...base, lotteryTime, notifyTime, dayOverride }, data)

  return withImmediateDatedSettings({
    ...latest,
    lotteryTime,
    defaultLotteryTime,
    lotteryTimeOverrides,
    lotteryMode: base.lotteryMode,
    notifyMode: base.notifyMode,
    notifyTime,
    dayOverride,
    hamoaniStartDate,
    hamoaniEndDate,
  }, data)
}

// ─── 汎用施設設定バージョン管理 (工部室・農部室) ───────────

export async function listFacilitySettingsVersions(
  db: Firestore,
  settingDocId: string,
  options: { maxEffectiveFrom?: string; minEffectiveFrom?: string } = {},
): Promise<ReservationSettingsVersion[]> {
  let query: FirebaseFirestore.Query = db
    .collection('settings')
    .doc(settingDocId)
    .collection('versions')

  if (options.maxEffectiveFrom) query = query.where('effectiveFrom', '<=', options.maxEffectiveFrom)
  if (options.minEffectiveFrom) query = query.where('effectiveFrom', '>=', options.minEffectiveFrom)

  const snap = await query.get()
  return snap.docs
    .map((doc) => normalizeVersion(doc.data()))
    .filter((v): v is ReservationSettingsVersion => v !== null)
    .sort(compareEffectiveFrom)
}

export async function listPendingFacilitySettingsChanges(
  db: Firestore,
  settingDocId: string,
  fromDate = addDaysJST(1),
): Promise<ReservationSettingsVersion[]> {
  return listFacilitySettingsVersions(db, settingDocId, { minEffectiveFrom: fromDate })
}

export async function resolveFacilitySettingsForDate(
  db: Firestore,
  settingDocId: string,
  date: string,
  defaults: ReservationSettingsCore,
): Promise<ReservationSettingsVersion> {
  // 工部室・農部室には dayOverride（緊急対応）を設ける予定がないため取得しない。
  // 農部生協用の resolveReservationSettingsForDate とは意図的に異なる。
  const versions = await listFacilitySettingsVersions(db, settingDocId, { maxEffectiveFrom: date })
  const latest = versions[versions.length - 1]
  return latest ?? { ...defaults, effectiveFrom: BASE_EFFECTIVE_FROM, lotteryTimeOverrides: EMPTY_LOTTERY_OVERRIDES }
}

export async function resolveReservationSettingsForDates(
  db: Firestore,
  dates: string[],
): Promise<Record<string, ReservationSettings>> {
  if (dates.length === 0) return {}

  const sortedDates = [...dates].sort()
  const maxDate = sortedDates[sortedDates.length - 1]
  const docRef = db.collection('settings').doc('reservation')
  const [doc, versions, overrideEntries, lotteryOverrideEntries] = await Promise.all([
    docRef.get(),
    listReservationSettingsVersions(db, { maxEffectiveFrom: maxDate }),
    Promise.all(sortedDates.map(async (date) => [date, await getReservationDayOverride(db, date)] as const)),
    Promise.all(sortedDates.map(async (date) => [date, await getReservationLotteryOverride(db, date)] as const)),
  ])
  const data = doc.exists ? doc.data() : {}
  const base = normalizeReservationSettings(data, BASE_EFFECTIVE_FROM)
  const legacy = normalizeVersion(data?.nextChange)
  const allVersions = legacy && legacy.effectiveFrom <= maxDate
    ? [...versions, legacy].sort(compareEffectiveFrom)
    : versions

  const result: Record<string, ReservationSettings> = {}
  const overridesByDate = Object.fromEntries(overrideEntries)
  const lotteryOverridesByDate = Object.fromEntries(lotteryOverrideEntries)
  for (const date of sortedDates) {
    const candidates = allVersions.filter((version) => version.effectiveFrom <= date)
    const latest = candidates[candidates.length - 1]
    // 抽選時刻の優先順位: 日付別緊急上書き > 適用中バージョン > base
    const defaultLotteryTime = latest?.lotteryTime ?? base.defaultLotteryTime
    const lotteryTimeOverrides = latest?.lotteryTimeOverrides ?? base.lotteryTimeOverrides
    const lotteryTime = lotteryOverridesByDate[date]?.lotteryTime ?? lotteryTimeForDate(date, defaultLotteryTime, lotteryTimeOverrides)
    const notifyTime = typeof data?.notifyTime === 'string' && LOTTERY_TIME_RE.test(data.notifyTime)
      ? base.notifyTime : lotteryTime
    result[date] = withImmediateDatedSettings(latest
      ? { ...latest, lotteryTime, defaultLotteryTime, lotteryTimeOverrides, lotteryMode: base.lotteryMode, notifyMode: base.notifyMode, notifyTime, dayOverride: overridesByDate[date], hamoaniStartDate: base.hamoaniStartDate, hamoaniEndDate: base.hamoaniEndDate }
      : { ...base, lotteryTime, notifyTime, dayOverride: overridesByDate[date] }, data)
  }
  return result
}
