import { useEffect, useState } from 'react'

type Props = {
  value: string                 // "HH:MM-HH:MM"
  onChange: (value: string) => void
  separator?: string            // 出力時のセパレータ（既定: "-"）
}

function parse(value: string, sep = '-'): { start: string; end: string } {
  const [s, e] = (value || '').split(sep)
  return {
    start: s && /^\d{2}:\d{2}$/.test(s) ? s : '',
    end:   e && /^\d{2}:\d{2}$/.test(e) ? e : '',
  }
}

export default function TimeRangeInput({ value, onChange, separator = '-' }: Props) {
  const initial = parse(value, separator)
  const [start, setStart] = useState(initial.start)
  const [end, setEnd]     = useState(initial.end)

  useEffect(() => {
    const p = parse(value, separator)
    setStart(p.start)
    setEnd(p.end)
  }, [value, separator])

  function emit(s: string, e: string) {
    if (s && e) onChange(`${s}${separator}${e}`)
    else onChange('')
  }

  return (
    <div className="time-range">
      <input
        type="time"
        className="text-input time-input"
        value={start}
        onChange={(e) => { setStart(e.target.value); emit(e.target.value, end) }}
        step="600"
      />
      <span className="time-range-sep">
        <span className="icon">arrow_forward</span>
      </span>
      <input
        type="time"
        className="text-input time-input"
        value={end}
        onChange={(e) => { setEnd(e.target.value); emit(start, e.target.value) }}
        step="600"
      />
    </div>
  )
}
