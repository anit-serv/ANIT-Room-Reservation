import { useState, useRef, useEffect } from 'react'
import TimeRangeInput from './TimeRangeInput'

export type TimeSlot = { label: string; value: string }

export type TimeSlotPreset = {
  id: string
  name: string
  timeSlots: TimeSlot[]
  createdAt: number | null
}

type Props = {
  slots: TimeSlot[]
  onChange: (slots: TimeSlot[]) => void
  conflictSet?: Set<number>
  presets?: TimeSlotPreset[]
  onSavePreset?: (name: string, slots: TimeSlot[]) => Promise<void> | void
  onDeletePreset?: (id: string) => Promise<void> | void
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

export function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

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

export default function TimeSlotsEditor({
  slots, onChange, conflictSet, presets, onSavePreset, onDeletePreset,
}: Props) {
  const conflicts = conflictSet ?? findConflicts(slots)
  const [menuOpen, setMenuOpen] = useState(false)
  const [saveDialog, setSaveDialog] = useState(false)
  const [presetName, setPresetName] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  function update(i: number, value: string) {
    onChange(slots.map((s, idx) => idx === i ? { value, label: valueToLabel(value) } : s))
  }
  function add()    { onChange([...slots, { label: '', value: '' }]) }
  function remove(i: number) { onChange(slots.filter((_, idx) => idx !== i)) }

  function applyPreset(p: TimeSlotPreset) {
    onChange(p.timeSlots.map((s) => ({ ...s })))
    setMenuOpen(false)
  }

  async function handleSave() {
    if (!presetName.trim() || !onSavePreset) return
    await onSavePreset(presetName.trim(), slots)
    setPresetName('')
    setSaveDialog(false)
    setMenuOpen(false)
  }

  async function handleDelete(p: TimeSlotPreset, e: React.MouseEvent) {
    e.stopPropagation()
    if (!onDeletePreset) return
    if (!confirm(`プリセット「${p.name}」を削除しますか？`)) return
    await onDeletePreset(p.id)
  }

  const canSavePreset = slots.length > 0 && slots.every((s) => s.label && s.value) && conflicts.size === 0

  return (
    <>
      {presets !== undefined && (
        <div className="relative inline-block mb-2" ref={menuRef}>
          <button
            type="button"
            className="btn-outline w-auto px-3 py-1.5 mt-0 inline-flex items-center gap-1 text-[0.85rem]"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="icon icon-sm">bookmarks</span>
            プリセット
            <span className="icon icon-sm">{menuOpen ? 'expand_less' : 'expand_more'}</span>
          </button>
          {menuOpen && (
            <div className="absolute top-[calc(100%+4px)] left-0 min-w-[240px] bg-surface border border-line rounded-[10px] shadow-[0_6px_20px_rgba(0,0,0,.1)] p-1.5 z-50 max-h-[280px] overflow-y-auto">
              {presets.length === 0 ? (
                <div className="px-2.5 py-3 text-[0.85rem] text-ink-pale text-center">保存済みのプリセットはありません</div>
              ) : (
                presets.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-md cursor-pointer hover:bg-bg transition-colors"
                    onClick={() => applyPreset(p)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[0.9rem] font-medium">{p.name}</div>
                      <div className="text-[0.75rem] text-ink-pale">{p.timeSlots.length}枠</div>
                    </div>
                    {onDeletePreset && (
                      <span
                        className="text-ink-pale p-1 rounded inline-flex hover:text-danger hover:bg-danger-light"
                        onClick={(e) => handleDelete(p, e)}
                        title="プリセットを削除"
                      >
                        <span className="icon icon-sm">delete</span>
                      </span>
                    )}
                  </div>
                ))
              )}
              {onSavePreset && (
                <button
                  type="button"
                  className="flex items-center gap-1.5 w-full px-2.5 py-2 rounded-md border-0 bg-transparent text-left cursor-pointer border-t border-line mt-1 pt-2 text-brand font-semibold disabled:opacity-50 disabled:cursor-not-allowed enabled:hover:bg-bg"
                  onClick={() => { setSaveDialog(true); setMenuOpen(false) }}
                  disabled={!canSavePreset}
                  title={canSavePreset ? '' : '時間枠を正しく入力すると保存できます'}
                >
                  <span className="icon icon-sm">bookmark_add</span>
                  現在の内容を保存
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {slots.map((s, i) => (
          <div key={i}
            className={
              'grid grid-cols-[1fr_auto_auto] gap-2 items-center p-1.5 rounded-lg transition-all ' +
              (conflicts.has(i) ? 'bg-danger-light shadow-[inset_0_0_0_1.5px_var(--color-danger)]' : '')
            }>
            <TimeRangeInput value={s.value} onChange={(v) => update(i, v)} />
            <span className="text-[0.8rem] text-ink-pale min-w-[100px]">
              {s.label || '未設定'}
            </span>
            <button className="btn-icon" onClick={() => remove(i)}>
              <span className="icon">delete</span>
            </button>
          </div>
        ))}
        <button className="btn-outline w-auto px-3 py-1.5 mt-1" onClick={add}>
          <span className="icon icon-sm">add</span> 時間枠を追加
        </button>
      </div>

      {saveDialog && (
        <div className="modal-backdrop" onClick={() => setSaveDialog(false)}>
          <div className="modal-card max-w-[400px]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold mb-3">プリセットとして保存</h3>
            <div className="form-row">
              <label>プリセット名</label>
              <input
                className="text-input"
                placeholder="例: 通常営業日"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex gap-2 mt-4">
              <button className="btn-outline flex-1" onClick={() => setSaveDialog(false)}>キャンセル</button>
              <button className="btn-primary flex-1" onClick={handleSave} disabled={!presetName.trim()}>保存</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
