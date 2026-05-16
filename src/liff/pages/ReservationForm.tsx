import { useState, useEffect } from 'react'
import type { LiffProfile } from '../LiffApp'

type Props = { profile: LiffProfile }
type DateOption = { label: string; value: string }
type TimeSlot   = { label: string; value: string }

export default function ReservationForm({ profile }: Props) {
  const [bandName,     setBandName]     = useState('')
  const [dates,        setDates]        = useState<DateOption[]>([])
  const [timeSlots,    setTimeSlots]    = useState<TimeSlot[]>([])
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedTime, setSelectedTime] = useState('')
  const [submitting,   setSubmitting]   = useState(false)
  const [done,         setDone]         = useState(false)
  const [error,        setError]        = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data) => {
        setDates(data.availableDates ?? [])
        setTimeSlots(data.timeSlots ?? [])
      })
      .catch(() => setError('設定の取得に失敗しました'))
  }, [])

  const canSubmit = bandName.trim() && selectedDate && selectedTime && !submitting

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/reservations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${profile.idToken}`,
        },
        body: JSON.stringify({ bandName: bandName.trim(), date: `${selectedDate}T${selectedTime}` }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '登録に失敗しました')
      setDone(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '登録に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  function reset() {
    setBandName(''); setSelectedDate(''); setSelectedTime(''); setDone(false); setError(null)
  }

  const dateLabel = dates.find((d) => d.value === selectedDate)?.label ?? ''
  const timeLabel = timeSlots.find((t) => t.value === selectedTime)?.label ?? ''

  if (done) {
    return (
      <div>
        <div className="banner success">✅ 予約を受け付けました。抽選結果をお待ちください。</div>
        <div className="card" style={{ marginBottom: '0.75rem' }}>
          <div className="summary-row"><span className="summary-key">バンド名</span><span className="summary-val">{bandName}</span></div>
          <div className="summary-row"><span className="summary-key">日付</span><span className="summary-val">{dateLabel}</span></div>
          <div className="summary-row"><span className="summary-key">時間帯</span><span className="summary-val">{timeLabel}</span></div>
        </div>
        <button className="btn-outline" onClick={reset}>続けて登録する</button>
      </div>
    )
  }

  return (
    <div>
      <p className="page-title">予約登録</p>

      {error && <div className="banner error">{error}</div>}

      {/* バンド名 */}
      <div className={`section ${bandName.trim() ? 'completed' : ''}`}>
        <div className="section-header">
          <span className="section-label">
            <span className="step-badge">1</span>
            バンド名
          </span>
          {bandName.trim() && <span className="icon icon-sm" style={{ color: 'var(--green)' }}>check_circle</span>}
        </div>
        <input
          className="text-input"
          type="text"
          placeholder="バンド名を入力"
          value={bandName}
          onChange={(e) => setBandName(e.target.value)}
        />
      </div>

      {/* 日付 */}
      <div className={`section ${selectedDate ? 'completed' : ''}`}>
        <div className="section-header">
          <span className="section-label">
            <span className="step-badge">2</span>
            日付
          </span>
          {selectedDate && <span className="icon icon-sm" style={{ color: 'var(--green)' }}>check_circle</span>}
        </div>
        <div className="select-grid cols-3">
          {dates.map((d) => (
            <button
              key={d.value}
              className={`select-btn ${selectedDate === d.value ? 'selected' : ''}`}
              onClick={() => setSelectedDate(d.value)}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {/* 時間帯 */}
      <div className={`section ${selectedTime ? 'completed' : ''}`}>
        <div className="section-header">
          <span className="section-label">
            <span className="step-badge">3</span>
            時間帯
          </span>
          {selectedTime && <span className="icon icon-sm" style={{ color: 'var(--green)' }}>check_circle</span>}
        </div>
        <div className="select-grid">
          {timeSlots.map((t) => (
            <button
              key={t.value}
              className={`select-btn ${selectedTime === t.value ? 'selected' : ''}`}
              onClick={() => setSelectedTime(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 確認サマリー */}
      {canSubmit && (
        <div className="summary">
          <div className="summary-row"><span className="summary-key">バンド名</span><span className="summary-val">{bandName}</span></div>
          <div className="summary-row"><span className="summary-key">日付</span><span className="summary-val">{dateLabel}</span></div>
          <div className="summary-row"><span className="summary-key">時間帯</span><span className="summary-val">{timeLabel}</span></div>
        </div>
      )}

      <button className="btn-primary" onClick={handleSubmit} disabled={!canSubmit}>
        {submitting ? '送信中...' : '予約する'}
      </button>
    </div>
  )
}
