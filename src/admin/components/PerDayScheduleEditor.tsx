import { useState } from 'react'
import TimeSlotsEditor, { type TimeSlot, findConflicts } from './TimeSlotsEditor'

const WEEK_DAYS = ['日', '月', '火', '水', '木', '金', '土']

export type PerDaySchedule = {
  enabled: boolean
  byWeekday: { [day: string]: TimeSlot[] }
  byDate:    { [date: string]: TimeSlot[] }
}

type Props = {
  schedule: PerDaySchedule
  onChange: (s: PerDaySchedule) => void
  availableDays: number[]   // 通常曜日
  extraDates: string[]       // 追加日（オーバーライド対象候補）
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

export default function PerDayScheduleEditor({ schedule, onChange, availableDays, extraDates }: Props) {
  const [pickWeekday, setPickWeekday] = useState<string>('')
  const [pickDate, setPickDate]       = useState<string>('')

  function setEnabled(enabled: boolean) {
    onChange({ ...schedule, enabled })
  }

  function addWeekday() {
    if (!pickWeekday) return
    if (schedule.byWeekday[pickWeekday]) return
    onChange({
      ...schedule,
      byWeekday: { ...schedule.byWeekday, [pickWeekday]: [] },
    })
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
    onChange({
      ...schedule,
      byDate: { ...schedule.byDate, [pickDate]: [] },
    })
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
  // 追加日 + 通常曜日に該当する候補日も追加対象にできる（実装簡略のためここでは追加日のみ）
  const dateOptions = extraDates.filter((d) => !schedule.byDate[d])

  return (
    <div>
      <label className="radio-item" style={{ marginBottom: '0.75rem' }}>
        <input
          type="checkbox"
          checked={schedule.enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          style={{ width: '18px', height: '18px', accentColor: 'var(--green)' }}
        />
        <span>曜日・日付ごとに時間枠を変える</span>
      </label>

      {schedule.enabled && (
        <>
          {/* 曜日別オーバーライド */}
          <div className="override-section">
            <div className="override-header">曜日別オーバーライド</div>
            {Object.entries(schedule.byWeekday).map(([day, slots]) => (
              <div key={day} className="override-card">
                <div className="override-card-header">
                  <strong>{WEEK_DAYS[Number(day)]}曜</strong>
                  <button className="btn-icon" onClick={() => removeWeekday(day)}>
                    <span className="icon">delete</span>
                  </button>
                </div>
                <TimeSlotsEditor slots={slots} onChange={(s) => updateWeekday(day, s)} />
              </div>
            ))}
            {weekdayOptions.length > 0 && (
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <select
                  className="text-input"
                  style={{ width: 'auto' }}
                  value={pickWeekday}
                  onChange={(e) => setPickWeekday(e.target.value)}
                >
                  <option value="">曜日を選択</option>
                  {weekdayOptions.map((d) => (
                    <option key={d} value={String(d)}>{WEEK_DAYS[d]}曜</option>
                  ))}
                </select>
                <button className="btn-outline" style={{ width: 'auto', padding: '0.5rem 0.8rem' }} onClick={addWeekday}>
                  <span className="icon icon-sm">add</span> 曜日を追加
                </button>
              </div>
            )}
          </div>

          {/* 日付別オーバーライド */}
          <div className="override-section">
            <div className="override-header">日付別オーバーライド（追加日のみ対象）</div>
            {Object.entries(schedule.byDate).map(([date, slots]) => (
              <div key={date} className="override-card">
                <div className="override-card-header">
                  <strong>{date}</strong>
                  <button className="btn-icon" onClick={() => removeDate(date)}>
                    <span className="icon">delete</span>
                  </button>
                </div>
                <TimeSlotsEditor slots={slots} onChange={(s) => updateDate(date, s)} />
              </div>
            ))}
            {dateOptions.length > 0 ? (
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <select
                  className="text-input"
                  style={{ width: 'auto' }}
                  value={pickDate}
                  onChange={(e) => setPickDate(e.target.value)}
                >
                  <option value="">日付を選択</option>
                  {dateOptions.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                <button className="btn-outline" style={{ width: 'auto', padding: '0.5rem 0.8rem' }} onClick={addDate}>
                  <span className="icon icon-sm">add</span> 日付を追加
                </button>
              </div>
            ) : (
              <div style={{ color: 'var(--text-pale)', fontSize: '0.85rem', marginTop: '0.5rem' }}>
                追加日に登録がないため日付オーバーライドできません
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
