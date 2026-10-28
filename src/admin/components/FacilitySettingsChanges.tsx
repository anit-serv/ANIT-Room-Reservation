import type { TimeSlot } from './TimeSlotsEditor'
import type { PerDaySchedule } from './PerDayScheduleEditor'

type FacilitySettingsValues = {
  availableDays: number[]
  extraDates: string[]
  excludedDates: string[]
  timeSlots: TimeSlot[]
  perDaySchedule: PerDaySchedule
}

const emptySchedule: PerDaySchedule = { enabled: false, byWeekday: {}, byDate: {} }

function sortedDates(dates: string[] | undefined): string {
  return JSON.stringify([...(dates ?? [])].sort())
}

export function countFacilitySettingsChanges(
  baseline: FacilitySettingsValues | null,
  draft: FacilitySettingsValues,
  effectiveFrom?: string,
  previousEffectiveFrom?: string | null,
): number {
  if (!baseline) return 0
  return [
    JSON.stringify([...draft.availableDays].sort()) !== JSON.stringify([...(baseline.availableDays ?? [])].sort()),
    sortedDates(draft.extraDates) !== sortedDates(baseline.extraDates),
    sortedDates(draft.excludedDates) !== sortedDates(baseline.excludedDates),
    JSON.stringify(draft.timeSlots) !== JSON.stringify(baseline.timeSlots ?? []),
    JSON.stringify(draft.perDaySchedule) !== JSON.stringify(baseline.perDaySchedule ?? emptySchedule),
    previousEffectiveFrom != null && effectiveFrom !== previousEffectiveFrom,
  ].filter(Boolean).length
}

export default function FacilitySettingsChanges({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[80] rounded-full bg-[#1a1a1a] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_32px_rgba(0,0,0,0.25)] animate-fade-in pointer-events-none whitespace-nowrap"
      role="status" aria-live="polite" aria-atomic="true">
      <span className="icon icon-sm align-middle mr-1.5">edit</span>
      {count}件の変更
    </div>
  )
}
