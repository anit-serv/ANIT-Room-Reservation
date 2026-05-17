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
}

export default function DateListEditor({ dates, onChange, emptyText, min }: Props) {
  const [picker, setPicker] = useState('')
  const [err, setErr] = useState<string | null>(null)

  function add() {
    setErr(null)
    if (!picker) return
    if (dates.includes(picker)) { setErr('既に追加されています'); return }
    onChange([...dates, picker].sort())
    setPicker('')
  }

  function remove(d: string) {
    onChange(dates.filter((x) => x !== d))
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
        <input
          type="date"
          className="text-input"
          value={picker}
          min={min}
          onChange={(e) => setPicker(e.target.value)}
          style={{ width: 'auto' }}
        />
        <button className="btn-outline" style={{ width: 'auto', padding: '0.5rem 0.8rem' }} onClick={add}>
          <span className="icon icon-sm">add</span> 追加
        </button>
      </div>
      {err && <div style={{ color: 'var(--red)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{err}</div>}
      {dates.length === 0
        ? <div style={{ color: 'var(--text-pale)', fontSize: '0.85rem' }}>{emptyText ?? '登録なし'}</div>
        : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {dates.map((d) => (
              <div key={d} className="date-pill">
                <span>{formatDate(d)}</span>
                <button className="btn-pill-close" onClick={() => remove(d)} title="削除">
                  <span className="icon icon-sm">close</span>
                </button>
              </div>
            ))}
          </div>
        )}
    </div>
  )
}
