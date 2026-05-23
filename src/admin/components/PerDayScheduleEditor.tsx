import { useState } from 'react'
import TimeSlotsEditor, { type TimeSlot, type TimeSlotPreset, findConflicts } from './TimeSlotsEditor'

const WEEK_DAYS = ['日', '月', '火', '水', '木', '金', '土']

export type PerDaySchedule = {
  enabled: boolean
  byWeekday: { [day: string]: TimeSlot[] }
  byDate:    { [date: string]: TimeSlot[] }
}

type Props = {
  schedule: PerDaySchedule
  onChange: (s: PerDaySchedule) => void
  availableDays: number[]
  extraDates?: string[]
  excludedDates?: string[]
  presets?: TimeSlotPreset[]
  onSavePreset?: (name: string, slots: TimeSlot[]) => Promise<void> | void
  onDeletePreset?: (id: string) => Promise<void> | void
}

function todayJST(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function getDateWarning(
  date: string,
  availableDays: number[],
  extraDates: string[],
  excludedDates: string[],
): string | null {
  if (!date) return null
  if (date < todayJST()) return '過去の日付は追加できません'
  if (excludedDates.includes(date)) return 'この日付は除外日に設定されているため追加できません'
  if (extraDates.includes(date)) return null
  const [y, m, d] = date.split('-').map(Number)
  const dow = new Date(y, m - 1, d).getDay()
  if (!availableDays.includes(dow)) return `${WEEK_DAYS[dow]}曜日は営業曜日ではないため追加できません`
  return null
}

export function findAllConflicts(s: PerDaySchedule): boolean {
  for (const v of Object.values(s.byWeekday)) {
    if (findConflicts(v).size > 0) return true
    if (v.some((slot) => !slot.value || !slot.label)) return true
  }
  for (const v of Object.values(s.byDate)) {
    if (findConflicts(v).size > 0) return true
    if (v.some((slot) => !slot.value || !slot.label)) return true
  }
  return false
}

export default function PerDayScheduleEditor({
  schedule, onChange, availableDays, extraDates = [], excludedDates = [], presets, onSavePreset, onDeletePreset,
}: Props) {
  const [pickWeekday, setPickWeekday] = useState<string>('')
  const [pickDate, setPickDate]       = useState<string>('')

  function setEnabled(enabled: boolean) {
    onChange({ ...schedule, enabled })
  }

  function addWeekday() {
    if (!pickWeekday) return
    if (schedule.byWeekday[pickWeekday]) return
    onChange({ ...schedule, byWeekday: { ...schedule.byWeekday, [pickWeekday]: [] } })
    setPickWeekday('')
  }
  function removeWeekday(day: string) {
    const next = { ...schedule.byWeekday }
    delete next[day]
    onChange({ ...schedule, byWeekday: next })
  }
  function updateWeekday(day: string, slots: TimeSlot[]) {
    onChange({ ...schedule, byWeekday: { ...schedule.byWeekday, [day]: slots } })
  }

  function addDate() {
    if (!pickDate) return
    if (schedule.byDate[pickDate]) return
    onChange({ ...schedule, byDate: { ...schedule.byDate, [pickDate]: [] } })
    setPickDate('')
  }
  function removeDate(date: string) {
    const next = { ...schedule.byDate }
    delete next[date]
    onChange({ ...schedule, byDate: next })
  }
  function updateDate(date: string, slots: TimeSlot[]) {
    onChange({ ...schedule, byDate: { ...schedule.byDate, [date]: slots } })
  }

  const weekdayOptions = availableDays.filter((d) => !schedule.byWeekday[String(d)])
  const dateWarning = getDateWarning(pickDate, availableDays, extraDates, excludedDates)

  return (
    <div>
      <label className="flex items-center gap-2 mb-3 cursor-pointer text-[0.95rem]">
        <input
          type="checkbox"
          checked={schedule.enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="w-[18px] h-[18px] cursor-pointer accent-brand"
        />
        <span>曜日・日付ごとに時間枠を変える</span>
      </label>

      {schedule.enabled && (
        <>
          <OverrideSection title="曜日別オーバーライド">
            {Object.entries(schedule.byWeekday).map(([day, slots]) => (
              <OverrideCard key={day} title={`${WEEK_DAYS[Number(day)]}曜`} onRemove={() => removeWeekday(day)}>
                <TimeSlotsEditor slots={slots} onChange={(s) => updateWeekday(day, s)}
                  presets={presets} onSavePreset={onSavePreset} onDeletePreset={onDeletePreset} />
              </OverrideCard>
            ))}
            {weekdayOptions.length > 0 && (
              <div className="flex gap-2 mt-2">
                <select className="text-input w-auto" value={pickWeekday}
                  onChange={(e) => setPickWeekday(e.target.value)}>
                  <option value="">曜日を選択</option>
                  {weekdayOptions.map((d) => (
                    <option key={d} value={String(d)}>{WEEK_DAYS[d]}曜</option>
                  ))}
                </select>
                <button className="btn-outline w-auto px-3 py-2" onClick={addWeekday}>
                  <span className="icon icon-sm">add</span> 曜日を追加
                </button>
              </div>
            )}
          </OverrideSection>

          <OverrideSection title="日付別オーバーライド">
            {Object.entries(schedule.byDate).map(([date, slots]) => (
              <OverrideCard key={date} title={date} onRemove={() => removeDate(date)}>
                <TimeSlotsEditor slots={slots} onChange={(s) => updateDate(date, s)}
                  presets={presets} onSavePreset={onSavePreset} onDeletePreset={onDeletePreset} />
              </OverrideCard>
            ))}
            <div className="flex gap-2 mt-2 items-center flex-wrap">
              <input
                type="date"
                className="text-input w-auto"
                value={pickDate}
                onChange={(e) => setPickDate(e.target.value)}
              />
              <button
                className="btn-outline w-auto px-3 py-2"
                onClick={addDate}
                disabled={!pickDate || !!schedule.byDate[pickDate] || !!dateWarning}
              >
                <span className="icon icon-sm">add</span> 日付を追加
              </button>
            </div>
            {dateWarning && (
              <p className="mt-2 text-warn text-[0.85rem] flex items-center gap-1">
                <span className="icon icon-sm">warning</span>
                {dateWarning}
              </p>
            )}
          </OverrideSection>
        </>
      )}
    </div>
  )
}

function OverrideSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 pt-4 border-t border-line">
      <div className="text-[0.85rem] font-semibold text-ink-sub mb-2">{title}</div>
      {children}
    </div>
  )
}

function OverrideCard({ title, onRemove, children }: { title: string; onRemove: () => void; children: React.ReactNode }) {
  return (
    <div className="bg-bg border border-line rounded-[10px] p-3 mb-2">
      <div className="flex justify-between items-center mb-2">
        <strong>{title}</strong>
        <button className="btn-icon-danger" onClick={onRemove}>
          <span className="icon">delete</span>
        </button>
      </div>
      {children}
    </div>
  )
}
