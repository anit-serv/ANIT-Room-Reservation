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
  extraDates: string[]
  presets?: TimeSlotPreset[]
  onSavePreset?: (name: string, slots: TimeSlot[]) => Promise<void> | void
  onDeletePreset?: (id: string) => Promise<void> | void
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
  schedule, onChange, availableDays, extraDates, presets, onSavePreset, onDeletePreset,
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
  const dateOptions = extraDates.filter((d) => !schedule.byDate[d])

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

          <OverrideSection title="日付別オーバーライド（追加日のみ対象）">
            {Object.entries(schedule.byDate).map(([date, slots]) => (
              <OverrideCard key={date} title={date} onRemove={() => removeDate(date)}>
                <TimeSlotsEditor slots={slots} onChange={(s) => updateDate(date, s)}
                  presets={presets} onSavePreset={onSavePreset} onDeletePreset={onDeletePreset} />
              </OverrideCard>
            ))}
            {dateOptions.length > 0 ? (
              <div className="flex gap-2 mt-2">
                <select className="text-input w-auto" value={pickDate}
                  onChange={(e) => setPickDate(e.target.value)}>
                  <option value="">日付を選択</option>
                  {dateOptions.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                <button className="btn-outline w-auto px-3 py-2" onClick={addDate}>
                  <span className="icon icon-sm">add</span> 日付を追加
                </button>
              </div>
            ) : (
              <div className="text-ink-pale text-[0.85rem] mt-2">
                追加日に登録がないため日付オーバーライドできません
              </div>
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
        <button className="btn-icon" onClick={onRemove}>
          <span className="icon">delete</span>
        </button>
      </div>
      {children}
    </div>
  )
}
