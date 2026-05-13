import { useState, useEffect } from 'react'
import type { LiffProfile } from '../App'

type Props = { profile: LiffProfile }

type DateOption = { label: string; value: string }
type TimeSlot = { label: string; value: string }

type Step = 'form' | 'done'

export default function ReservationForm({ profile }: Props) {
  const [step, setStep] = useState<Step>('form')
  const [bandName, setBandName] = useState('')
  const [dates, setDates] = useState<DateOption[]>([])
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([])
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedTime, setSelectedTime] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        body: JSON.stringify({
          bandName: bandName.trim(),
          date: `${selectedDate}T${selectedTime}`,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '登録に失敗しました')
      setStep('done')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '登録に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  if (step === 'done') {
    return (
      <div>
        <div className="success-message">
          ✅ 予約を受け付けました。抽選結果をお待ちください。
        </div>
        <button
          className="btn-primary"
          onClick={() => {
            setBandName('')
            setSelectedDate('')
            setSelectedTime('')
            setStep('form')
          }}
        >
          続けて登録する
        </button>
      </div>
    )
  }

  return (
    <div>
      <p className="section-title">予約登録</p>

      {error && <div className="error" style={{ marginBottom: '1rem', height: 'auto', padding: '0.75rem' }}>{error}</div>}

      <div className="form-group">
        <label>バンド名</label>
        <input
          type="text"
          placeholder="バンド名を入力"
          value={bandName}
          onChange={(e) => setBandName(e.target.value)}
        />
      </div>

      <div className="form-group">
        <label>日付</label>
        <div className="select-grid">
          {dates.map((d) => (
            <button
              key={d.value}
              className={selectedDate === d.value ? 'selected' : ''}
              onClick={() => setSelectedDate(d.value)}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div className="form-group">
        <label>時間帯</label>
        <div className="select-grid">
          {timeSlots.map((t) => (
            <button
              key={t.value}
              className={selectedTime === t.value ? 'selected' : ''}
              onClick={() => setSelectedTime(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <button className="btn-primary" onClick={handleSubmit} disabled={!canSubmit}>
        {submitting ? '送信中...' : '予約する'}
      </button>
    </div>
  )
}
