import { useState, useRef } from 'react'
import CalendarPicker from './CalendarPicker'

const WEEK_DAYS = ['日', '月', '火', '水', '木', '金', '土']

function displayDate(date: string): string {
  const d = new Date(date + 'T00:00:00Z')
  const m   = d.getUTCMonth() + 1
  const day = d.getUTCDate()
  const wd  = WEEK_DAYS[d.getUTCDay()]
  return `${d.getUTCFullYear()}年${m}月${day}日 (${wd})`
}

type Props = {
  value: string
  onChange: (date: string) => void
  min?: string
  maxDate?: string
  placeholder?: string
  /** 選択解除ボタンを表示する */
  clearable?: boolean
  className?: string
}

export default function DatePicker({
  value, onChange, min, maxDate,
  placeholder = '日付を選択', clearable, className,
}: Props) {
  const [open, setOpen] = useState(false)
  const [pos,  setPos]  = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)

  function handleOpen() {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 4, left: rect.left })
    }
    setOpen((o) => !o)
  }

  return (
    <div className="inline-flex items-center gap-1">
      <button
        ref={triggerRef}
        type="button"
        onClick={handleOpen}
        className={`text-input flex items-center gap-2 cursor-pointer ${className ?? ''}`}
      >
        <span className="icon text-ink-pale" style={{ fontSize: 18 }}>calendar_today</span>
        <span className={value ? 'text-ink' : 'text-ink-pale'}>
          {value ? displayDate(value) : placeholder}
        </span>
      </button>

      {clearable && value && (
        <button
          type="button"
          onClick={() => { onChange(''); setOpen(false) }}
          className="btn-icon-nav shrink-0"
          aria-label="クリア"
        >
          <span className="icon icon-sm">close</span>
        </button>
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-[190]" onClick={() => setOpen(false)} />
          <div className="fixed z-[200]" style={{ top: pos.top, left: pos.left }}>
            <CalendarPicker
              value={value || undefined}
              onChange={(date) => { onChange(date); setOpen(false) }}
              min={min}
              maxDate={maxDate}
            />
          </div>
        </>
      )}
    </div>
  )
}
