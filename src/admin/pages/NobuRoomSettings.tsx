import { useEffect, useState, useMemo, useCallback } from 'react'
import { useBlocker } from 'react-router-dom'
import { adminFetch } from '../auth'
import TimeSlotsEditor, { findConflicts, type TimeSlot, type TimeSlotPreset } from '../components/TimeSlotsEditor'
import DateListEditor from '../components/DateListEditor'
import PerDayScheduleEditor, { findAllConflicts, type PerDaySchedule } from '../components/PerDayScheduleEditor'
import Skeleton from '../../components/Skeleton'

type NobuRoomSettingsCore = {
  availableDays:  number[]
  extraDates:     string[]
  excludedDates:  string[]
  timeSlots:      TimeSlot[]
  perDaySchedule: PerDaySchedule
}

type NobuRoomSettingsResponse = NobuRoomSettingsCore & {
  scheduledChanges?: (NobuRoomSettingsCore & { effectiveFrom: string })[]
  timePresets?: TimePreset[]
}

type TimePreset = { label: string; startTime: string; endTime: string }

const WEEK_DAYS = ['日', '月', '火', '水', '木', '金', '土']

function todayJST(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function emptySchedule(): PerDaySchedule {
  return { enabled: false, byWeekday: {}, byDate: {} }
}

export default function NobuRoomSettings() {
  const [current, setCurrent]               = useState<NobuRoomSettingsResponse | null>(null)
  const [availableDays, setAvailableDays]   = useState<number[]>([0,1,2,3,4,5,6])
  const [extraDates, setExtraDates]         = useState<string[]>([])
  const [excludedDates, setExcludedDates]   = useState<string[]>([])
  const [timeSlots, setTimeSlots]           = useState<TimeSlot[]>([])
  const [perDaySchedule, setPerDaySchedule] = useState<PerDaySchedule>(emptySchedule())
  const [effectiveFrom, setEffectiveFrom]   = useState<string>(todayJST())
  const [editingScheduled, setEditingScheduled]         = useState(false)
  const [editingScheduledDate, setEditingScheduledDate] = useState<string | null>(null)
  const [saving, setSaving]                 = useState(false)
  const [message, setMessage]               = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [step, setStep]                     = useState<'editing' | 'confirming' | 'saved'>('editing')
  const [savedMessage, setSavedMessage]     = useState('')
  const [presets, setPresets]               = useState<TimeSlotPreset[]>([])
  const [timePresets, setTimePresets]       = useState<TimePreset[]>([])
  const [presetSaving, setPresetSaving]     = useState(false)
  const [presetMessage, setPresetMessage]   = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [newPresetLabel, setNewPresetLabel] = useState('')
  const [newPresetStart, setNewPresetStart] = useState('')
  const [newPresetEnd, setNewPresetEnd]     = useState('')

  useEffect(() => { load(); loadPresets() }, [])

  async function loadPresets() {
    try {
      const res = await adminFetch('/api/admin/time-slot-presets')
      if (res.ok) setPresets((await res.json()).presets ?? [])
    } catch { /* ignore */ }
  }

  async function savePreset(name: string, slots: TimeSlot[]) {
    const res = await adminFetch('/api/admin/time-slot-presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, timeSlots: slots }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      setMessage({ type: 'error', text: err.error ?? 'プリセットの保存に失敗しました' })
      return
    }
    await loadPresets()
  }

  async function deletePreset(id: string) {
    const res = await adminFetch(`/api/admin/time-slot-presets/${id}`, { method: 'DELETE' })
    if (res.ok) await loadPresets()
  }

  function applyToForm(s: NobuRoomSettingsCore) {
    setAvailableDays(s.availableDays)
    setTimeSlots(s.timeSlots)
    setExtraDates(s.extraDates ?? [])
    setExcludedDates(s.excludedDates ?? [])
    setPerDaySchedule(s.perDaySchedule ?? emptySchedule())
  }

  async function load() {
    const res = await adminFetch('/api/admin/nobu-room-settings')
    if (!res.ok) { setMessage({ type: 'error', text: '設定の取得に失敗しました' }); return }
    const data = (await res.json()) as NobuRoomSettingsResponse
    setCurrent(data)
    setTimePresets(data.timePresets ?? [])
    if (!editingScheduled) applyToForm(data)
  }

  async function saveTimePresets(updated: TimePreset[]) {
    setPresetSaving(true)
    setPresetMessage(null)
    try {
      const res = await adminFetch('/api/admin/nobu-room-settings/presets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timePresets: updated }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setPresetMessage({ type: 'error', text: err.error ?? '保存に失敗しました' })
        return
      }
      setTimePresets(updated)
      setPresetMessage({ type: 'success', text: 'プリセットを保存しました' })
    } catch {
      setPresetMessage({ type: 'error', text: '保存に失敗しました' })
    } finally {
      setPresetSaving(false)
    }
  }

  const scheduledChanges = current?.scheduledChanges ?? []

  function loadScheduledForEdit(change: NobuRoomSettingsCore & { effectiveFrom: string }) {
    applyToForm(change)
    setEffectiveFrom(change.effectiveFrom)
    setEditingScheduled(true)
    setEditingScheduledDate(change.effectiveFrom)
    setMessage(null)
  }

  function cancelEditScheduled() {
    if (!current) return
    applyToForm(current)
    setEffectiveFrom(todayJST())
    setEditingScheduled(false)
    setEditingScheduledDate(null)
  }

  function toggleDay(d: number) {
    setAvailableDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()
    )
  }

  const isDirty = useMemo(() => {
    if (!current) return false
    const sortedStr = (arr: string[]) => JSON.stringify([...arr].sort())
    return (
      JSON.stringify(availableDays)  !== JSON.stringify(current.availableDays) ||
      sortedStr(extraDates)          !== sortedStr(current.extraDates ?? []) ||
      sortedStr(excludedDates)       !== sortedStr(current.excludedDates ?? []) ||
      JSON.stringify(timeSlots)      !== JSON.stringify(current.timeSlots ?? []) ||
      JSON.stringify(perDaySchedule) !== JSON.stringify(current.perDaySchedule ?? emptySchedule())
    )
  }, [current, availableDays, extraDates, excludedDates, timeSlots, perDaySchedule])

  const effectiveDirty = isDirty && step !== 'saved'

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (effectiveDirty) e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [effectiveDirty])

  const blocker = useBlocker(
    useCallback(({ currentLocation, nextLocation }: { currentLocation: { pathname: string }; nextLocation: { pathname: string } }) =>
      effectiveDirty && currentLocation.pathname !== nextLocation.pathname,
    [effectiveDirty])
  )

  const hasDateOverlap      = extraDates.some((d) => excludedDates.includes(d))
  const defaultConflicts    = findConflicts(timeSlots)
  const hasOverrideConflict = findAllConflicts(perDaySchedule)
  const earlyExtraDates    = extraDates.filter((d) => d < effectiveFrom)
  const earlyExcludedDates = excludedDates.filter((d) => d < effectiveFrom)
  const earlyPerDayDates   = Object.keys(perDaySchedule.byDate ?? {}).filter((d) => d < effectiveFrom)

  function goToConfirm() {
    setMessage(null)
    if (timeSlots.length === 0 || timeSlots.some((s) => !s.label.trim() || !s.value.trim())) {
      setMessage({ type: 'error', text: '営業時間枠を全て入力してください' })
      return
    }
    if (defaultConflicts.size > 0) {
      setMessage({ type: 'error', text: '営業時間枠が重複しています' })
      return
    }
    if (hasOverrideConflict) {
      setMessage({ type: 'error', text: '曜日/日付別の営業時間に未入力または重複があります' })
      return
    }
    if (hasDateOverlap) {
      setMessage({ type: 'error', text: '同じ日付が追加日と除外日の両方に指定されています' })
      return
    }
    if (!effectiveFrom || effectiveFrom < todayJST()) {
      setMessage({ type: 'error', text: '適用日は今日以降を指定してください' })
      return
    }
    setStep('confirming')
  }

  async function save() {
    setSaving(true)
    try {
      const res = await adminFetch('/api/admin/nobu-room-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ availableDays, extraDates, excludedDates, timeSlots, perDaySchedule, effectiveFrom }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '保存に失敗しました')
      const result = await res.json()
      setSavedMessage(
        effectiveFrom === todayJST()
          ? '設定は本日から適用されます'
          : `${result.effectiveFrom} から適用予定`
      )
      setEditingScheduled(false)
      setEditingScheduledDate(null)
      setStep('saved')
      load()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message })
      setStep('editing')
    } finally {
      setSaving(false)
    }
  }

  async function cancelScheduled(date: string) {
    if (!confirm(`${date} の適用予定を取り消しますか？`)) return
    const res = await adminFetch(`/api/admin/nobu-room-settings/scheduled?date=${encodeURIComponent(date)}`, { method: 'DELETE' })
    if (res.ok) {
      setMessage({ type: 'success', text: '予約済みの変更を取り消しました' })
      setEditingScheduled(false)
      setEditingScheduledDate(null)
      load()
    } else {
      setMessage({ type: 'error', text: '取り消しに失敗しました' })
    }
  }

  if (!current) return (
    <div>
      <Skeleton width="200px" height="28px" className="mb-6" />
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="admin-card">
          <Skeleton width="40%" height="20px" className="mb-3" />
          <Skeleton width="100%" height="60px" />
        </div>
      ))}
    </div>
  )

  if (step === 'confirming') return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <button className="btn-icon-nav" onClick={() => setStep('editing')} disabled={saving}>
          <span className="icon">arrow_back</span>
        </button>
        <h1 className="text-2xl font-bold">設定 - 農部室</h1>
      </div>
      <p className="text-[0.88rem] text-ink-sub mb-6 ml-11">保存内容の確認</p>

      <div className="admin-card">
        <table className="w-full text-[0.9rem]">
          <tbody>
            {([
              ['適用日',       effectiveFrom],
              ['利用可能曜日', availableDays.length === 0 ? 'なし' : availableDays.map(d => WEEK_DAYS[d]).join('・')],
              ['営業時間枠',   `${timeSlots.length}件`],
              ['追加日',       `${extraDates.length}件`],
              ['除外日',       `${excludedDates.length}件`],
              ['曜日/日付別',  perDaySchedule.enabled ? '有効' : '無効'],
            ] as [string, string][]).map(([label, value]) => (
              <tr key={label} className="border-b border-line last:border-0">
                <td className="py-3 pr-4 text-ink-sub font-medium w-36 text-[0.88rem]">{label}</td>
                <td className="py-3 font-semibold text-ink">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {message && <div className="banner-error">{message.text}</div>}

      <div className="flex gap-3">
        <button className="btn-outline flex-1 max-w-[180px]" onClick={() => setStep('editing')} disabled={saving}>
          修正
        </button>
        <button className="btn-primary flex-1 max-w-[180px]" onClick={save} disabled={saving}>
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  )

  if (step === 'saved') return (
    <div>
      <h1 className="text-2xl font-bold mb-6">設定 - 農部室</h1>
      <div className="admin-card flex flex-col items-center text-center py-10">
        <div className="w-20 h-20 rounded-full bg-brand-light flex items-center justify-center mb-5">
          <span className="icon text-brand" style={{ fontSize: 44 }}>check_circle</span>
        </div>
        <h2 className="text-xl font-bold text-ink mb-2">保存が完了しました</h2>
        <p className="text-[0.9rem] text-ink-sub mb-8">{savedMessage}</p>
        <button className="btn-outline max-w-[240px]" onClick={() => { setStep('editing'); setMessage(null) }}>
          引き続き編集
        </button>
      </div>
    </div>
  )

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">設定 - 農部室</h1>

      {message && (
        <div className={message.type === 'success' ? 'banner-success' : 'banner-error'}>
          {message.text}
        </div>
      )}

      {editingScheduled && (
        <div className="banner-warn">
          <span className="icon icon-sm align-middle">edit</span>
          {' '}{editingScheduledDate ? `${editingScheduledDate} の` : ''}適用予定の変更を編集中（保存すると上書きされます）
          <button className="btn-outline w-auto px-2.5 py-1 ml-3 text-[0.8rem]" onClick={cancelEditScheduled}>
            キャンセル
          </button>
        </div>
      )}

      {scheduledChanges.length > 0 && !editingScheduled && (
        <div className="bg-warn-light border border-warn rounded-xl p-5 mb-4 shadow-[var(--shadow-card-sm)]">
          <div className="flex justify-between items-center mb-3 gap-2 flex-wrap">
            <strong className="text-warn">
              <span className="icon align-middle">schedule</span> 適用予定の変更
            </strong>
            <span className="text-[0.85rem] text-warn">{scheduledChanges.length}件</span>
          </div>
          <div className="flex flex-col gap-2">
            {scheduledChanges.map((change) => (
              <div key={change.effectiveFrom} className="bg-surface/70 border border-warn/50 rounded-lg p-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="text-[0.9rem] text-ink-sub">
                    適用日: <strong>{change.effectiveFrom}</strong>
                    {' / '}
                    曜日: <strong>{change.availableDays.map((d) => WEEK_DAYS[d]).join('・') || 'なし'}</strong>
                    {' / '}
                    追加日: <strong>{change.extraDates?.length ?? 0}件</strong>
                    {' / '}
                    除外日: <strong>{change.excludedDates?.length ?? 0}件</strong>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      className="btn-icon-nav"
                      onClick={() => loadScheduledForEdit(change)}
                      aria-label={`${change.effectiveFrom}の適用予定を編集`}
                      title="編集"
                    >
                      <span className="icon">edit</span>
                    </button>
                    <button
                      className="btn-icon-danger"
                      onClick={() => cancelScheduled(change.effectiveFrom)}
                      aria-label={`${change.effectiveFrom}の適用予定を取り消し`}
                      title="取り消し"
                    >
                      <span className="icon">delete</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="admin-card">
        <h2 className="text-base font-bold mb-3">利用可能曜日</h2>
        <div className="flex gap-2 flex-wrap">
          {WEEK_DAYS.map((label, i) => {
            const selected = availableDays.includes(i)
            return (
              <label key={i}
                className={
                  'flex items-center justify-center w-12 h-12 rounded-full border-2 font-semibold cursor-pointer transition select-none ' +
                  (selected ? 'bg-brand border-brand text-white' : 'bg-[#fafafa] border-line hover:border-brand')
                }>
                <input type="checkbox" checked={selected} onChange={() => toggleDay(i)} className="hidden" />
                {label}
              </label>
            )
          })}
        </div>
      </div>

      <div className="admin-card">
        <h2 className="text-base font-bold mb-3">デフォルト営業時間枠</h2>
        <p className="text-[0.85rem] text-ink-sub mb-3">
          全ての日で使用される基本の営業時間枠です。曜日や日付別に上書きする場合は下の設定で。
        </p>
        <TimeSlotsEditor
          slots={timeSlots}
          onChange={setTimeSlots}
          conflictSet={defaultConflicts}
          presets={presets}
          onSavePreset={savePreset}
          onDeletePreset={deletePreset}
        />
        {defaultConflicts.size > 0 && (
          <div className="mt-2 text-danger text-[0.85rem]">
            <span className="icon icon-sm align-middle">warning</span>
            {' '}時間枠が重複しています
          </div>
        )}
      </div>

      <div className="admin-card">
        <h2 className="text-base font-bold mb-3">営業時間の例外設定</h2>
        <PerDayScheduleEditor
          schedule={perDaySchedule}
          onChange={setPerDaySchedule}
          defaultSlots={timeSlots}
          availableDays={availableDays}
          extraDates={extraDates}
          excludedDates={excludedDates}
          presets={presets}
          onSavePreset={savePreset}
          onDeletePreset={deletePreset}
        />
        {earlyPerDayDates.length > 0 && (
          <p className="mt-3 text-warn text-[0.85rem]">
            <span className="icon icon-sm align-middle">warning</span>
            {' '}特定日ルールに適用日（{effectiveFrom}）より前の日付が含まれています。これらは設定の対象外です：{earlyPerDayDates.join('、')}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="admin-card">
          <h2 className="text-base font-bold mb-3">追加日</h2>
          <p className="text-[0.85rem] text-ink-sub mb-3">
            上記の曜日に該当しない日でも、ここに追加した日は予約可能になります。
          </p>
          <DateListEditor
            dates={extraDates}
            onChange={setExtraDates}
            min={todayJST()}
            emptyText="追加日なし"
            label="予約可能にする日を選択"
            conflictDates={excludedDates}
            conflictLabel="除外日"
            onMoveConflict={(date) => setExcludedDates((prev) => prev.filter((d) => d !== date))}
          />
          {earlyExtraDates.length > 0 && (
            <p className="mt-2 text-warn text-[0.85rem]">
              <span className="icon icon-sm align-middle">warning</span>
              {' '}適用日（{effectiveFrom}）より前の日付が含まれています。これらは設定の対象外です：{earlyExtraDates.join('、')}
            </p>
          )}
        </div>

        <div className="admin-card">
          <h2 className="text-base font-bold mb-3">除外日</h2>
          <p className="text-[0.85rem] text-ink-sub mb-3">
            通常は予約可能曜日でも、ここに登録した日は予約できなくなります（祝日や臨時休業など）。
          </p>
          <DateListEditor
            dates={excludedDates}
            onChange={setExcludedDates}
            min={todayJST()}
            emptyText="除外日なし"
            label="予約不可にする日を選択"
            conflictDates={extraDates}
            conflictLabel="追加日"
            onMoveConflict={(date) => setExtraDates((prev) => prev.filter((d) => d !== date))}
          />
          {earlyExcludedDates.length > 0 && (
            <p className="mt-2 text-warn text-[0.85rem]">
              <span className="icon icon-sm align-middle">warning</span>
              {' '}適用日（{effectiveFrom}）より前の日付が含まれています。これらは設定の対象外です：{earlyExcludedDates.join('、')}
            </p>
          )}
          {hasDateOverlap && (
            <p className="mt-2 text-danger text-[0.85rem]">
              <span className="icon icon-sm align-middle">warning</span>
              {' '}同じ日付が追加日と除外日の両方に指定されています
            </p>
          )}
        </div>
      </div>

      <div className="admin-card">
        <h2 className="text-base font-bold mb-1">時間プリセット</h2>
        <p className="text-[0.85rem] text-ink-sub mb-4">
          ユーザーが予約時にワンタップで適用できる時間枠のショートカットです。この設定は即時反映されます。
        </p>

        {timePresets.length > 0 && (
          <div className="flex flex-col gap-2 mb-4">
            {timePresets.map((p, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5 bg-bg rounded-lg border border-line">
                <span className="font-semibold text-[0.9rem] text-ink min-w-[80px]">{p.label}</span>
                <span className="text-[0.88rem] text-ink-sub flex-1">{p.startTime} 〜 {p.endTime}</span>
                <button
                  className="btn-icon-danger flex-shrink-0"
                  onClick={() => setTimePresets(prev => prev.filter((_, j) => j !== i))}
                >
                  <span className="icon">delete</span>
                </button>
              </div>
            ))}
          </div>
        )}
        {timePresets.length === 0 && (
          <p className="text-[0.85rem] text-ink-pale mb-4">プリセットはまだありません</p>
        )}

        <div className="flex gap-2 items-end flex-wrap">
          <div className="form-row mb-0 flex-1 min-w-[100px]">
            <label>ラベル</label>
            <input className="text-input" placeholder="午前" value={newPresetLabel} onChange={e => setNewPresetLabel(e.target.value)} />
          </div>
          <div className="form-row mb-0">
            <label>開始</label>
            <input className="text-input w-[110px]" type="time" value={newPresetStart} onChange={e => setNewPresetStart(e.target.value)} />
          </div>
          <div className="form-row mb-0">
            <label>終了</label>
            <input className="text-input w-[110px]" type="time" value={newPresetEnd} onChange={e => setNewPresetEnd(e.target.value)} />
          </div>
          <button
            className="btn-outline w-auto px-4 py-[0.7rem]"
            disabled={!newPresetLabel.trim() || !newPresetStart || !newPresetEnd || newPresetStart >= newPresetEnd}
            onClick={() => {
              setTimePresets(prev => [...prev, { label: newPresetLabel.trim(), startTime: newPresetStart, endTime: newPresetEnd }])
              setNewPresetLabel('')
              setNewPresetStart('')
              setNewPresetEnd('')
            }}
          >
            追加
          </button>
        </div>

        {presetMessage && (
          <div className={`mt-3 ${presetMessage.type === 'success' ? 'banner-success' : 'banner-error'} mb-0`}>
            {presetMessage.text}
          </div>
        )}

        <div className="mt-4">
          <button
            className="btn-primary max-w-[200px]"
            disabled={presetSaving}
            onClick={() => saveTimePresets(timePresets)}
          >
            {presetSaving ? '保存中...' : 'プリセットを保存'}
          </button>
        </div>
      </div>

      <div className="admin-card">
        <h2 className="text-base font-bold mb-3">適用日</h2>
        <p className="text-[0.85rem] text-ink-sub mb-3">
          今日の日付を指定すると即時反映されます。将来の日付を指定すると、その日から設定が適用されます。
        </p>
        <input
          type="date"
          className="text-input w-auto"
          value={effectiveFrom}
          min={todayJST()}
          onChange={(e) => setEffectiveFrom(e.target.value)}
        />
      </div>

      <button className="btn-primary max-w-[300px]" onClick={goToConfirm}>
        {editingScheduled ? '上書き内容を確認する' : '確認する'}
      </button>

      {blocker.state === 'blocked' && (
        <div className="modal-backdrop" onClick={() => blocker.reset()}>
          <div className="modal-card max-w-[360px]" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold mb-2">ページを離れますか？</h2>
            <p className="text-[0.9rem] text-ink-sub mb-4">未保存の変更が失われます。</p>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => blocker.reset()}>キャンセル</button>
              <button className="btn-danger flex-1" onClick={() => blocker.proceed()}>OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
