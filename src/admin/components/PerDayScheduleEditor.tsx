import { useState } from 'react'
import TimeSlotsEditor, { type TimeSlot, type TimeSlotPreset, findConflicts } from './TimeSlotsEditor'
import DatePicker from '../../components/DatePicker'

const WEEK_DAYS = ['日', '月', '火', '水', '木', '金', '土']

export type PerDaySchedule = {
  enabled: boolean
  byWeekday: { [day: string]: TimeSlot[] }
  byDate:    { [date: string]: TimeSlot[] }
}

type Props = {
  schedule: PerDaySchedule
  onChange: (s: PerDaySchedule) => void
  defaultSlots: TimeSlot[]
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
  schedule, onChange, defaultSlots, availableDays, extraDates = [], excludedDates = [], presets, onSavePreset, onDeletePreset,
}: Props) {
  const [pickWeekday, setPickWeekday] = useState<string>('')
  const [pickDate, setPickDate]       = useState<string>('')
  const [editing, setEditing]         = useState<{ kind: 'weekday' | 'date'; key: string } | null>(null)
  const [adding, setAdding]           = useState<'weekday' | 'date' | null>(null)

  function copiedDefaultSlots(): TimeSlot[] {
    return defaultSlots.length > 0
      ? defaultSlots.map((slot) => ({ ...slot }))
      : [{ label: '', value: '' }]
  }

  function addWeekday() {
    if (!pickWeekday) return
    if (schedule.byWeekday[pickWeekday]) return
    onChange({
      ...schedule,
      enabled: true,
      byWeekday: { ...schedule.byWeekday, [pickWeekday]: copiedDefaultSlots() },
    })
    setEditing({ kind: 'weekday', key: pickWeekday })
    setAdding(null)
    setPickWeekday('')
  }
  function removeWeekday(day: string) {
    const next = { ...schedule.byWeekday }
    delete next[day]
    onChange({ ...schedule, enabled: Object.keys(next).length > 0 || Object.keys(schedule.byDate).length > 0, byWeekday: next })
    if (editing?.kind === 'weekday' && editing.key === day) setEditing(null)
  }
  function updateWeekday(day: string, slots: TimeSlot[]) {
    onChange({ ...schedule, enabled: true, byWeekday: { ...schedule.byWeekday, [day]: slots } })
  }

  function addDate() {
    if (!pickDate) return
    if (schedule.byDate[pickDate]) return
    if (getDateWarning(pickDate, availableDays, extraDates, excludedDates)) return
    onChange({
      ...schedule,
      enabled: true,
      byDate: { ...schedule.byDate, [pickDate]: copiedDefaultSlots() },
    })
    setEditing({ kind: 'date', key: pickDate })
    setAdding(null)
    setPickDate('')
  }
  function removeDate(date: string) {
    const next = { ...schedule.byDate }
    delete next[date]
    onChange({ ...schedule, enabled: Object.keys(schedule.byWeekday).length > 0 || Object.keys(next).length > 0, byDate: next })
    if (editing?.kind === 'date' && editing.key === date) setEditing(null)
  }
  function updateDate(date: string, slots: TimeSlot[]) {
    onChange({ ...schedule, enabled: true, byDate: { ...schedule.byDate, [date]: slots } })
  }

  const weekdayOptions = availableDays.filter((d) => !schedule.byWeekday[String(d)])
  const dateWarning = getDateWarning(pickDate, availableDays, extraDates, excludedDates)
  const weekdayRules = Object.entries(schedule.byWeekday).sort(([a], [b]) => Number(a) - Number(b))
  const dateRules = Object.entries(schedule.byDate).sort(([a], [b]) => a.localeCompare(b))
  const hasRules = weekdayRules.length > 0 || dateRules.length > 0

  return (
    <div>
      <p className="text-[0.85rem] text-ink-sub mb-3">
        通常と異なる時間枠を適用する日だけ登録します。適用順: 特定日 &gt; 曜日ルール &gt; デフォルト時間枠
      </p>

      {hasRules && !schedule.enabled && (
        <div className="banner-warn mb-4">
          保存済みのルールは現在無効です。
          <button type="button" className="btn-outline w-auto px-3 py-1 ml-3 text-[0.8rem]"
            onClick={() => onChange({ ...schedule, enabled: true })}>
            ルールを有効にする
          </button>
        </div>
      )}

      <div className="flex gap-2 flex-wrap mb-4">
        {weekdayOptions.length > 0 && (
          <button type="button" className="btn-outline w-auto px-3 py-2" onClick={() => setAdding('weekday')}>
            <span className="icon icon-sm">add</span> 曜日ルールを追加
          </button>
        )}
        <button type="button" className="btn-outline w-auto px-3 py-2" onClick={() => setAdding('date')}>
          <span className="icon icon-sm">add</span> 特定日ルールを追加
        </button>
      </div>

      {adding === 'weekday' && (
        <RuleComposer title="曜日ルールを追加" onClose={() => { setAdding(null); setPickWeekday('') }}>
          <div className="flex gap-2 items-center flex-wrap">
            <select className="text-input w-auto" value={pickWeekday}
              onChange={(e) => setPickWeekday(e.target.value)}>
              <option value="">曜日を選択</option>
              {weekdayOptions.map((d) => (
                <option key={d} value={String(d)}>{WEEK_DAYS[d]}曜</option>
              ))}
            </select>
            <button type="button" className="btn-primary w-auto px-4 py-2" onClick={addWeekday} disabled={!pickWeekday}>
              作成して編集
            </button>
          </div>
        </RuleComposer>
      )}

      {adding === 'date' && (
        <RuleComposer title="特定日ルールを追加" onClose={() => { setAdding(null); setPickDate('') }}>
          <div className="flex gap-2 items-center flex-wrap">
            <DatePicker value={pickDate} onChange={setPickDate} min={todayJST()} placeholder="日付を選択" />
            <button
              type="button"
              className="btn-primary w-auto px-4 py-2"
              onClick={addDate}
              disabled={!pickDate || !!schedule.byDate[pickDate] || !!dateWarning}
            >
              作成して編集
            </button>
          </div>
          {dateWarning && (
            <p className="mt-2 text-warn text-[0.85rem] flex items-center gap-1">
              <span className="icon icon-sm">warning</span>
              {dateWarning}
            </p>
          )}
        </RuleComposer>
      )}

      {!hasRules && !adding && (
        <div className="bg-bg border border-dashed border-line rounded-[10px] px-4 py-5 text-[0.85rem] text-ink-pale text-center">
          例外ルールはありません。全ての日にデフォルト時間枠が適用されます。
        </div>
      )}

      {weekdayRules.length > 0 && (
        <RuleList title="曜日ルール">
          {weekdayRules.map(([day, slots]) => (
            <RuleCard
              key={day}
              title={`毎週 ${WEEK_DAYS[Number(day)]}曜日`}
              slots={slots}
              active={schedule.enabled}
              editing={editing?.kind === 'weekday' && editing.key === day}
              onEdit={() => setEditing((prev) => prev?.kind === 'weekday' && prev.key === day ? null : { kind: 'weekday', key: day })}
              onRemove={() => removeWeekday(day)}
            >
              <TimeSlotsEditor slots={slots} onChange={(next) => updateWeekday(day, next)}
                presets={presets} onSavePreset={onSavePreset} onDeletePreset={onDeletePreset} />
            </RuleCard>
          ))}
        </RuleList>
      )}

      {dateRules.length > 0 && (
        <RuleList title="特定日ルール">
          {dateRules.map(([date, slots]) => (
            <RuleCard
              key={date}
              title={formatDate(date)}
              slots={slots}
              active={schedule.enabled}
              editing={editing?.kind === 'date' && editing.key === date}
              onEdit={() => setEditing((prev) => prev?.kind === 'date' && prev.key === date ? null : { kind: 'date', key: date })}
              onRemove={() => removeDate(date)}
            >
              <TimeSlotsEditor slots={slots} onChange={(next) => updateDate(date, next)}
                presets={presets} onSavePreset={onSavePreset} onDeletePreset={onDeletePreset} />
            </RuleCard>
          ))}
        </RuleList>
      )}
    </div>
  )
}

function formatDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const weekday = WEEK_DAYS[new Date(year, month - 1, day).getDay()]
  return `${date} (${weekday})`
}

function summarizeSlots(slots: TimeSlot[]): string {
  if (slots.length === 0) return '時間枠未設定'
  return slots.map((slot) => slot.label || slot.value || '未設定').join(' / ')
}

function RuleComposer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="bg-bg border border-line rounded-[10px] p-4 mb-4">
      <div className="flex justify-between items-center mb-3">
        <strong className="text-[0.9rem]">{title}</strong>
        <button type="button" className="btn-icon-close" onClick={onClose} aria-label="閉じる">
          <span className="icon">close</span>
        </button>
      </div>
      {children}
    </div>
  )
}

function RuleList({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <div className="text-[0.82rem] font-semibold text-ink-sub mb-2">{title}</div>
      {children}
    </div>
  )
}

function RuleCard({
  title, slots, active, editing, onEdit, onRemove, children,
}: {
  title: string
  slots: TimeSlot[]
  active: boolean
  editing: boolean
  onEdit: () => void
  onRemove: () => void
  children: React.ReactNode
}) {
  return (
    <div className="bg-bg border border-line rounded-[10px] p-3 mb-2">
      <div className="flex justify-between items-start gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <strong>{title}</strong>
            {!active && <span className="badge badge-neutral">無効</span>}
          </div>
          <p className="text-[0.82rem] text-ink-sub truncate">{summarizeSlots(slots)}</p>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button
            type="button"
            className="btn-icon-nav"
            onClick={onEdit}
            aria-expanded={editing}
            aria-label={`${title}の時間枠を${editing ? '閉じる' : '開く'}`}
          >
            <span className={`icon transition-transform duration-200 ${editing ? 'rotate-180' : ''}`}>
              expand_more
            </span>
          </button>
          <button type="button" className="btn-icon-danger" onClick={onRemove} aria-label={`${title}を削除`}>
            <span className="icon">delete</span>
          </button>
        </div>
      </div>
      <div
        className={`grid transition-all duration-200 ease-out ${
          editing ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden min-h-0">
          <div className="mt-3 pt-3 border-t border-line">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
