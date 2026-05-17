import TimeRangeInput from './TimeRangeInput'

export type TimeSlot = { label: string; value: string }

type Props = {
  slots: TimeSlot[]
  onChange: (slots: TimeSlot[]) => void
  conflictSet?: Set<number>
}

// "09:00-10:00" → "9:00~10:00"
export function valueToLabel(value: string): string {
  const [s, e] = value.split('-')
  if (!s || !e) return ''
  const fmt = (t: string) => {
    const [h, m] = t.split(':')
    return `${parseInt(h, 10)}:${m}`
  }
  return `${fmt(s)}~${fmt(e)}`
}

// "HH:MM" → 分
export function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

// 重複しているスロットのインデックスを Set で返す
export function findConflicts(slots: TimeSlot[]): Set<number> {
  const result = new Set<number>()
  const ranges = slots.map((s) => {
    const [start, end] = (s.value ?? '').split('-')
    if (!start || !end) return null
    return { start: toMinutes(start), end: toMinutes(end) }
  })
  for (let i = 0; i < ranges.length; i++) {
    const a = ranges[i]
    if (!a || a.end <= a.start) continue
    for (let j = i + 1; j < ranges.length; j++) {
      const b = ranges[j]
      if (!b || b.end <= b.start) continue
      if (a.start < b.end && b.start < a.end) { result.add(i); result.add(j) }
    }
  }
  return result
}

export default function TimeSlotsEditor({ slots, onChange, conflictSet }: Props) {
  const conflicts = conflictSet ?? findConflicts(slots)

  function update(i: number, value: string) {
    onChange(slots.map((s, idx) => idx === i ? { value, label: valueToLabel(value) } : s))
  }
  function add()    { onChange([...slots, { label: '', value: '' }]) }
  function remove(i: number) { onChange(slots.filter((_, idx) => idx !== i)) }

  return (
    <div className="slot-list">
      {slots.map((s, i) => (
        <div key={i} className={`slot-row slot-row-time${conflicts.has(i) ? ' has-conflict' : ''}`}>
          <TimeRangeInput value={s.value} onChange={(v) => update(i, v)} />
          <span style={{ fontSize: '0.8rem', color: 'var(--text-pale)', minWidth: '100px' }}>
            {s.label || '未設定'}
          </span>
          <button className="btn-icon" onClick={() => remove(i)}>
            <span className="icon">delete</span>
          </button>
        </div>
      ))}
      <button className="btn-outline" style={{ width: 'auto', padding: '0.4rem 0.8rem', marginTop: '0.25rem' }} onClick={add}>
        <span className="icon icon-sm">add</span> 時間枠を追加
      </button>
    </div>
  )
}
