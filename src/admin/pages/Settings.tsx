import { useEffect, useState } from 'react'
import { adminFetch } from '../auth'
import TimeRangeInput from '../components/TimeRangeInput'

// "09:00-10:00" → "9:00~10:00"
function valueToLabel(value: string): string {
  const [s, e] = value.split('-')
  if (!s || !e) return ''
  const fmt = (t: string) => {
    const [h, m] = t.split(':')
    return `${parseInt(h, 10)}:${m}`
  }
  return `${fmt(s)}~${fmt(e)}`
}

type TimeSlot = { label: string; value: string }
type NextChange = {
  availableDays: number[]
  timeSlots: TimeSlot[]
  effectiveFrom: string
} | null

type SettingsResponse = {
  availableDays: number[]
  timeSlots: TimeSlot[]
  nextChange: NextChange
}

const WEEK_DAYS = ['日', '月', '火', '水', '木', '金', '土']

function todayJST(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export default function Settings() {
  const [current, setCurrent]           = useState<SettingsResponse | null>(null)
  const [availableDays, setAvailableDays] = useState<number[]>([])
  const [timeSlots, setTimeSlots]       = useState<TimeSlot[]>([])
  const [applyMode, setApplyMode]       = useState<'now' | 'scheduled'>('now')
  const [effectiveFrom, setEffectiveFrom] = useState<string>(todayJST())
  const [saving, setSaving]             = useState(false)
  const [message, setMessage]           = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    const res = await adminFetch('/api/admin/settings')
    if (!res.ok) {
      setMessage({ type: 'error', text: '設定の取得に失敗しました' })
      return
    }
    const data = (await res.json()) as SettingsResponse
    setCurrent(data)
    setAvailableDays(data.availableDays)
    setTimeSlots(data.timeSlots)
  }

  function toggleDay(d: number) {
    setAvailableDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()
    )
  }

  function updateSlotValue(i: number, value: string) {
    setTimeSlots((prev) => prev.map((s, idx) =>
      idx === i ? { value, label: valueToLabel(value) } : s
    ))
  }

  function addSlot() {
    setTimeSlots((prev) => [...prev, { label: '', value: '' }])
  }

  function removeSlot(i: number) {
    setTimeSlots((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function save() {
    setMessage(null)
    if (availableDays.length === 0) {
      setMessage({ type: 'error', text: '登録可能曜日を1つ以上選択してください' })
      return
    }
    if (timeSlots.length === 0 || timeSlots.some((s) => !s.label.trim() || !s.value.trim())) {
      setMessage({ type: 'error', text: '時間枠のラベルと値を全て入力してください' })
      return
    }
    setSaving(true)
    try {
      const body: any = { availableDays, timeSlots }
      if (applyMode === 'scheduled') body.effectiveFrom = effectiveFrom
      else body.applyNow = true

      const res = await adminFetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '保存に失敗しました')
      const result = await res.json()
      setMessage({
        type: 'success',
        text: result.applied === 'now' ? '即時適用しました' : `${result.effectiveFrom} から適用予定で保存しました`,
      })
      load()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  async function cancelScheduled() {
    if (!confirm('予約済みの設定変更を取り消しますか？')) return
    const res = await adminFetch('/api/admin/settings/scheduled', { method: 'DELETE' })
    if (res.ok) {
      setMessage({ type: 'success', text: '予約済みの変更を取り消しました' })
      load()
    } else {
      setMessage({ type: 'error', text: '取り消しに失敗しました' })
    }
  }

  if (!current) return <div className="splash"><div className="spinner" /></div>

  return (
    <div>
      <h1 className="admin-page-title">設定</h1>

      {message && (
        <div className={`banner ${message.type}`} style={{ marginBottom: '1rem' }}>
          {message.text}
        </div>
      )}

      {/* 予約済み変更の通知 */}
      {current.nextChange && (
        <div className="admin-card" style={{ background: 'var(--orange-light)', borderColor: 'var(--orange)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <strong style={{ color: 'var(--orange)' }}>
              <span className="icon" style={{ verticalAlign: 'middle' }}>schedule</span> 適用予定の変更
            </strong>
            <button className="btn-danger" onClick={cancelScheduled}>取り消し</button>
          </div>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-sub)' }}>
            適用日: <strong>{current.nextChange.effectiveFrom}</strong>
          </div>
        </div>
      )}

      {/* 登録可能曜日 */}
      <div className="admin-card">
        <h2 className="admin-card-title">登録可能曜日</h2>
        <div className="day-grid">
          {WEEK_DAYS.map((label, i) => (
            <label key={i} className={`day-chip ${availableDays.includes(i) ? 'selected' : ''}`}>
              <input
                type="checkbox"
                checked={availableDays.includes(i)}
                onChange={() => toggleDay(i)}
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      {/* 時間枠 */}
      <div className="admin-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h2 className="admin-card-title" style={{ margin: 0 }}>時間枠</h2>
          <button className="btn-outline" style={{ width: 'auto', padding: '0.4rem 0.8rem' }} onClick={addSlot}>
            <span className="icon icon-sm">add</span> 追加
          </button>
        </div>
        <div className="slot-list">
          {timeSlots.map((s, i) => (
            <div key={i} className="slot-row slot-row-time">
              <TimeRangeInput value={s.value} onChange={(v) => updateSlotValue(i, v)} />
              <span style={{ fontSize: '0.8rem', color: 'var(--text-pale)', minWidth: '100px' }}>
                {s.label || '未設定'}
              </span>
              <button className="btn-icon" onClick={() => removeSlot(i)}>
                <span className="icon">delete</span>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 適用タイミング */}
      <div className="admin-card">
        <h2 className="admin-card-title">適用タイミング</h2>
        <div className="radio-list">
          <label className="radio-item">
            <input
              type="radio"
              checked={applyMode === 'now'}
              onChange={() => setApplyMode('now')}
            />
            <span>即時適用</span>
          </label>
          <label className="radio-item">
            <input
              type="radio"
              checked={applyMode === 'scheduled'}
              onChange={() => setApplyMode('scheduled')}
            />
            <span>指定日から適用</span>
            <input
              type="date"
              className="text-input"
              style={{ width: 'auto', marginLeft: '0.5rem' }}
              value={effectiveFrom}
              min={todayJST()}
              disabled={applyMode !== 'scheduled'}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          </label>
        </div>
      </div>

      <button className="btn-primary" style={{ maxWidth: '300px' }} onClick={save} disabled={saving}>
        {saving ? '保存中...' : '保存'}
      </button>
    </div>
  )
}
