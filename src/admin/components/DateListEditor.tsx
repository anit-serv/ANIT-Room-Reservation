import { useState } from 'react'
import CalendarPicker from '../../components/CalendarPicker'

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
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function handleSelect(date: string) {
    setPicker(date)
    setErr(null)
    setOpen(false)
  }

  function add() {
    setErr(null)
    if (!picker) return
    if (dates.includes(picker)) {
      setErr('既に追加されています')
      return
    }
    if (conflictDates.includes(picker)) {
      const shouldMove = confirm(`${formatDate(picker)} は${conflictLabel ?? '別の設定'}に登録されています。こちらに変更しますか？`)
      if (!shouldMove) return
      onMoveConflict?.(picker)
    }
    onChange([...dates, picker].sort())
    setPicker('')
  }

  function remove(d: string) {
    onChange(dates.filter((x) => x !== d))
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {/* カレンダートリガー */}
        <div className="relative">
          <button
            type="button"
            aria-label={label}
            onClick={() => setOpen((o) => !o)}
            className="text-input w-auto flex items-center gap-2 cursor-pointer min-w-[200px]"
          >
            <span className="icon text-ink-pale" style={{ fontSize: 18 }}>calendar_today</span>
            <span className={picker ? 'text-ink' : 'text-ink-pale'}>
              {picker ? formatDate(picker) : '日付を選択'}
            </span>
          </button>

          {open && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
              <div className="absolute top-full left-0 mt-1 z-20">
                <CalendarPicker value={picker} onChange={handleSelect} min={min} />
              </div>
            </>
          )}
        </div>

        <button
          className="btn-outline w-auto px-3 py-[0.6rem]"
          onClick={add}
          disabled={!picker}
        >
          追加
        </button>
      </div>

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
