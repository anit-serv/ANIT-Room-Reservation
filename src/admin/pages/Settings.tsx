import { useEffect, useState } from 'react'
import { adminFetch } from '../auth'
import TimeSlotsEditor, { findConflicts, toMinutes, type TimeSlot } from '../components/TimeSlotsEditor'
import DateListEditor from '../components/DateListEditor'
import PerDayScheduleEditor, { findAllConflicts, type PerDaySchedule } from '../components/PerDayScheduleEditor'
import Skeleton from '../../components/Skeleton'

type SettingsCore = {
  availableDays: number[]
  timeSlots: TimeSlot[]
  extraDates: string[]
  excludedDates: string[]
  perDaySchedule: PerDaySchedule
}

type SettingsResponse = SettingsCore & {
  nextChange: (SettingsCore & { effectiveFrom: string }) | null
}

const WEEK_DAYS = ['日', '月', '火', '水', '木', '金', '土']

function todayJST(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

// 設定の最小適用日（今日+7日）。現在表示中の予約期間との競合を避けるため。
function minEffectiveDate(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000)
  d.setUTCDate(d.getUTCDate() + 7)
  return d.toISOString().slice(0, 10)
}

function emptySchedule(): PerDaySchedule {
  return { enabled: false, byWeekday: {}, byDate: {} }
}

export default function Settings() {
  const [current, setCurrent]             = useState<SettingsResponse | null>(null)
  const [availableDays, setAvailableDays] = useState<number[]>([])
  const [timeSlots, setTimeSlots]         = useState<TimeSlot[]>([])
  const [extraDates, setExtraDates]       = useState<string[]>([])
  const [excludedDates, setExcludedDates] = useState<string[]>([])
  const [perDaySchedule, setPerDaySchedule] = useState<PerDaySchedule>(emptySchedule())
  const [effectiveFrom, setEffectiveFrom] = useState<string>(minEffectiveDate())
  const [editingScheduled, setEditingScheduled] = useState(false)
  const [saving, setSaving]               = useState(false)
  const [message, setMessage]             = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => { load() }, [])

  function applyToForm(s: SettingsCore) {
    setAvailableDays(s.availableDays)
    setTimeSlots(s.timeSlots)
    setExtraDates(s.extraDates ?? [])
    setExcludedDates(s.excludedDates ?? [])
    setPerDaySchedule(s.perDaySchedule ?? emptySchedule())
  }

  async function load() {
    const res = await adminFetch('/api/admin/settings')
    if (!res.ok) { setMessage({ type: 'error', text: '設定の取得に失敗しました' }); return }
    const data = (await res.json()) as SettingsResponse
    setCurrent(data)
    if (!editingScheduled) applyToForm(data)
  }

  function loadScheduledForEdit() {
    if (!current?.nextChange) return
    applyToForm(current.nextChange)
    setEffectiveFrom(current.nextChange.effectiveFrom)
    setEditingScheduled(true)
    setMessage(null)
  }

  function cancelEditScheduled() {
    if (!current) return
    applyToForm(current)
    setEffectiveFrom(minEffectiveDate())
    setEditingScheduled(false)
  }

  function toggleDay(d: number) {
    setAvailableDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()
    )
  }

  const defaultConflicts = findConflicts(timeSlots)
  const hasOverrideConflict = findAllConflicts(perDaySchedule)
  const hasDateOverlap = extraDates.some((d) => excludedDates.includes(d))

  async function save() {
    setMessage(null)
    if (availableDays.length === 0 && extraDates.length === 0) {
      setMessage({ type: 'error', text: '登録可能曜日か追加日を1つ以上指定してください' })
      return
    }
    if (timeSlots.length === 0 || timeSlots.some((s) => !s.label.trim() || !s.value.trim())) {
      setMessage({ type: 'error', text: 'デフォルト時間枠を全て入力してください' })
      return
    }
    if (timeSlots.some((s) => {
      const [a, b] = (s.value ?? '').split('-')
      return !a || !b || toMinutes(a) >= toMinutes(b)
    })) {
      setMessage({ type: 'error', text: '開始時刻は終了時刻より前にしてください' })
      return
    }
    if (defaultConflicts.size > 0) {
      setMessage({ type: 'error', text: 'デフォルト時間枠が重複しています' })
      return
    }
    if (hasOverrideConflict) {
      setMessage({ type: 'error', text: '曜日/日付別の時間枠に未入力または重複があります' })
      return
    }
    if (hasDateOverlap) {
      setMessage({ type: 'error', text: '同じ日付が追加日と除外日の両方に指定されています' })
      return
    }
    if (effectiveFrom < minEffectiveDate()) {
      setMessage({ type: 'error', text: `適用日は${minEffectiveDate()}以降を指定してください` })
      return
    }

    setSaving(true)
    try {
      const body = {
        availableDays, timeSlots, extraDates, excludedDates, perDaySchedule,
        effectiveFrom,
      }
      const res = await adminFetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '保存に失敗しました')
      const result = await res.json()
      setMessage({
        type: 'success',
        text: `${result.effectiveFrom} から適用予定で保存しました`,
      })
      setEditingScheduled(false)
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
      setEditingScheduled(false)
      load()
    } else {
      setMessage({ type: 'error', text: '取り消しに失敗しました' })
    }
  }

  if (!current) return (
    <div>
      <Skeleton width="160px" height="28px" style={{ marginBottom: '1.5rem' }} />
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="admin-card">
          <Skeleton width="40%" height="20px" style={{ marginBottom: '0.75rem' }} />
          <Skeleton width="100%" height="60px" />
        </div>
      ))}
    </div>
  )

  return (
    <div>
      <h1 className="admin-page-title">設定</h1>

      {message && (
        <div className={`banner ${message.type}`} style={{ marginBottom: '1rem' }}>
          {message.text}
        </div>
      )}

      {editingScheduled && (
        <div className="banner" style={{ background: 'var(--orange-light)', color: 'var(--orange)', borderColor: 'var(--orange)', marginBottom: '1rem' }}>
          <span className="icon icon-sm" style={{ verticalAlign: 'middle' }}>edit</span>
          {' '}適用予定の変更を編集中（保存すると上書きされます）
          <button className="btn-outline" style={{ width: 'auto', padding: '0.3rem 0.7rem', marginLeft: '0.75rem', fontSize: '0.8rem' }}
            onClick={cancelEditScheduled}>
            編集をやめる
          </button>
        </div>
      )}

      {current.nextChange && !editingScheduled && (
        <div className="admin-card" style={{ background: 'var(--orange-light)', borderColor: 'var(--orange)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <strong style={{ color: 'var(--orange)' }}>
              <span className="icon" style={{ verticalAlign: 'middle' }}>schedule</span> 適用予定の変更
            </strong>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn-outline" style={{ width: 'auto', padding: '0.4rem 0.8rem' }} onClick={loadScheduledForEdit}>
                <span className="icon icon-sm">edit</span> 編集
              </button>
              <button className="btn-danger" onClick={cancelScheduled}>取り消し</button>
            </div>
          </div>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-sub)' }}>
            適用日: <strong>{current.nextChange.effectiveFrom}</strong>
            {' / '}
            曜日: <strong>{current.nextChange.availableDays.map((d) => WEEK_DAYS[d]).join('・') || 'なし'}</strong>
            {' / '}
            追加日: <strong>{current.nextChange.extraDates?.length ?? 0}件</strong>
            {' / '}
            除外日: <strong>{current.nextChange.excludedDates?.length ?? 0}件</strong>
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

      {/* 追加日 */}
      <div className="admin-card">
        <h2 className="admin-card-title">追加日</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-sub)', marginBottom: '0.75rem' }}>
          上記の曜日に該当しない日でも、ここに追加した日は予約可能になります。
        </p>
        <DateListEditor
          dates={extraDates}
          onChange={setExtraDates}
          min={todayJST()}
          emptyText="追加日なし"
        />
      </div>

      {/* 除外日 */}
      <div className="admin-card">
        <h2 className="admin-card-title">除外日</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-sub)', marginBottom: '0.75rem' }}>
          通常は予約可能曜日でも、ここに登録した日は予約できなくなります（祝日や臨時休業など）。
        </p>
        <DateListEditor
          dates={excludedDates}
          onChange={setExcludedDates}
          min={todayJST()}
          emptyText="除外日なし"
        />
      </div>

      {/* デフォルト時間枠 */}
      <div className="admin-card">
        <h2 className="admin-card-title">デフォルト時間枠</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-sub)', marginBottom: '0.75rem' }}>
          全ての日で使用される基本の時間枠です。曜日や日付別に上書きする場合は下の設定で。
        </p>
        <TimeSlotsEditor slots={timeSlots} onChange={setTimeSlots} conflictSet={defaultConflicts} />
        {defaultConflicts.size > 0 && (
          <div style={{ marginTop: '0.5rem', color: 'var(--red)', fontSize: '0.85rem' }}>
            <span className="icon icon-sm" style={{ verticalAlign: 'middle' }}>warning</span>
            {' '}時間枠が重複しています
          </div>
        )}
      </div>

      {/* 曜日・日付別オーバーライド */}
      <div className="admin-card">
        <h2 className="admin-card-title">曜日・日付別の時間枠</h2>
        <PerDayScheduleEditor
          schedule={perDaySchedule}
          onChange={setPerDaySchedule}
          availableDays={availableDays}
          extraDates={extraDates}
        />
      </div>

      {/* 適用日 */}
      <div className="admin-card">
        <h2 className="admin-card-title">適用日</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-sub)', marginBottom: '0.75rem' }}>
          現在表示中の予約期間（今日含め7日間）との競合を避けるため、
          <strong>{minEffectiveDate()}</strong> 以降の日付を指定してください。
        </p>
        <input
          type="date"
          className="text-input"
          style={{ width: 'auto' }}
          value={effectiveFrom}
          min={minEffectiveDate()}
          onChange={(e) => setEffectiveFrom(e.target.value)}
        />
      </div>

      <button className="btn-primary" style={{ maxWidth: '300px' }} onClick={save} disabled={saving}>
        {saving ? '保存中...' : editingScheduled ? '上書き保存' : '保存'}
      </button>
    </div>
  )
}
