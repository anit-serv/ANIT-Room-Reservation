import { useState } from 'react'

const WEEK_DAYS = ['日', '月', '火', '水', '木', '金', '土']

function formatDate(date: string): string {
  const d = new Date(date + 'T00:00:00Z')
  const m = d.getUTCMonth() + 1
  const day = d.getUTCDate()
  const wd = WEEK_DAYS[d.getUTCDay()]
  return `${date} (${m}/${day} ${wd})`
}

type Props = {
  dates: string[]
  onChange: (dates: string[]) => void
  emptyText?: string
  min?: string
  label?: string
  conflictDates?: string[]
  conflictLabel?: string
  onMoveConflict?: (date: string) => void
}

export default function DateListEditor({
  dates, onChange, emptyText, min, label = '日付を選択して追加',
  conflictDates = [], conflictLabel, onMoveConflict,
}: Props) {
  const [picker, setPicker] = useState('')
  const [err, setErr] = useState<string | null>(null)

  function add(date: string) {
    setErr(null)
    if (!date) return
    if (dates.includes(date)) {
      setErr('既に追加されています')
      setPicker('')
      return
    }
    if (conflictDates.includes(date)) {
      const shouldMove = confirm(`${formatDate(date)} は${conflictLabel ?? '別の設定'}に登録されています。こちらに変更しますか？`)
      if (!shouldMove) {
        setPicker('')
        return
      }
      onMoveConflict?.(date)
    }
    onChange([...dates, date].sort())
    setPicker('')
  }

  function remove(d: string) {
    onChange(dates.filter((x) => x !== d))
  }

  return (
    <div>
      <input
        type="date"
        aria-label={label}
        className="text-input w-auto mb-2"
        value={picker}
        min={min}
        onChange={(e) => {
          const value = e.target.value
          setPicker(value)
          add(value)
        }}
      />
      <p className="text-[0.78rem] text-ink-pale mb-2">日付を選択すると追加されます</p>
      {err && <div className="text-danger text-[0.85rem] mb-2">{err}</div>}
      {dates.length === 0
        ? <div className="text-ink-pale text-[0.85rem]">{emptyText ?? '登録なし'}</div>
        : (
          <div className="flex flex-wrap gap-1.5">
            {dates.map((d) => (
              <div key={d} className="inline-flex items-center gap-1.5 bg-bg border border-line rounded-full pl-3 pr-1.5 py-1 text-[0.85rem]">
                <span>{formatDate(d)}</span>
                <button
                  onClick={() => remove(d)}
                  title="削除"
                  className="bg-transparent border-0 cursor-pointer text-ink-pale inline-flex p-0.5 rounded-full hover:text-danger hover:bg-danger-light"
                >
                  <span className="icon icon-sm">close</span>
                </button>
              </div>
            ))}
          </div>
        )}
    </div>
  )
}
