import { useState, useEffect, useCallback } from 'react'
import type { LiffProfile } from '../LiffApp'
import Skeleton from '../../components/Skeleton'

type Favorite = { id: string; name: string; nobuTimeSlot: string | null }


type Props = {
  profile: LiffProfile
  initialEdit?: { facility: 'kobu' | 'nobu' | 'nobu-room'; id: string } | null
  onEditHandled?: () => void
  onKobuEdit?: (r: { id: string; date: string; bandName: string; startTime: string; endTime: string }) => void
  onNobuRoomEdit?: (r: { id: string; date: string; bandName: string; startTime: string; endTime: string }) => void
}

type NobuReservation = {
  id: string
  bandName: string
  date: string       // "YYYY-MM-DDTHH:MM-HH:MM"
  status: 'pending' | 'confirmed'
  facility: 'nobu'
  availabilityStatus?: 'normal' | 'emergency_blocked' | 'slot_mismatch' | 'temporary_open'
  availabilityLabel?: string
  availabilityMessage?: string
  availableTimeSlots?: NobuTimeSlot[]
}

type KobuReservation = {
  id: string
  bandName: string
  date: string       // "YYYY-MM-DD"
  startTime: string
  endTime: string
  status: 'confirmed'
  facility: 'kobu'
}

type NobuRoomReservation = {
  id: string
  bandName: string
  date: string       // "YYYY-MM-DD"
  startTime: string
  endTime: string
  status: 'confirmed'
  facility: 'nobu-room'
}

type Reservation = NobuReservation | KobuReservation | NobuRoomReservation

function startISO(r: Reservation): string {
  if (r.facility === 'nobu') {
    const [datePart, timePart] = r.date.split('T')
    return `${datePart}T${timePart.split('-')[0]}:00+09:00`
  }
  return `${r.date}T${r.startTime}:00+09:00`
}

function isPast(r: Reservation): boolean {
  return Date.now() >= new Date(startISO(r)).getTime()
}

function sortKey(r: Reservation): string {
  if (r.facility === 'nobu') return r.date
  return `${r.date}T${r.startTime}`
}

type FacilityConfig = { label: string; icon: string; iconBg: string; iconColor: string; labelColor: string }

function facilityConfig(r: Reservation): FacilityConfig {
  if (r.facility === 'nobu') return      { label: '農部生協', icon: 'grass',        iconBg: 'bg-emerald-100', iconColor: 'text-emerald-600', labelColor: 'text-emerald-600' }
  if (r.facility === 'nobu-room') return { label: '農部室',   icon: 'door_sliding', iconBg: 'bg-teal-100',    iconColor: 'text-teal-600',    labelColor: 'text-teal-600'    }
  return                                 { label: '工部室',   icon: 'door_open',    iconBg: 'bg-cyan-100',    iconColor: 'text-cyan-700',    labelColor: 'text-cyan-700'    }
}

function displayDateStr(r: Reservation): string {
  if (r.facility === 'nobu') return r.date.split('T')[0].slice(5).replace('-', '/')
  return r.date.slice(5).replace('-', '/')
}

function displayTime(r: Reservation): string {
  if (r.facility === 'nobu') return r.date.split('T')[1]
  return `${r.startTime}〜${r.endTime}`
}

function availabilityNotice(r: Reservation): {
  kind: 'info' | 'warning'
  icon: string
  label: string
  message?: string
} | null {
  if (r.facility !== 'nobu') return null
  if (r.availabilityStatus === 'temporary_open') {
    return { kind: 'info', icon: 'event_available', label: r.availabilityLabel ?? '臨時開放日' }
  }
  if (r.availabilityStatus === 'emergency_blocked') {
    return {
      kind: 'warning',
      icon: 'warning',
      label: r.availabilityLabel ?? '受付停止中',
      message: r.availabilityMessage,
    }
  }
  if (r.availabilityStatus === 'slot_mismatch') {
    return {
      kind: 'warning',
      icon: 'warning',
      label: r.availabilityLabel ?? '時間枠確認',
      message: r.availabilityMessage,
    }
  }
  return null
}


export default function MyReservations({ profile, initialEdit, onEditHandled, onKobuEdit, onNobuRoomEdit }: Props) {
  const [reservations,  setReservations]  = useState<Reservation[]>([])
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState<string | null>(null)
  const [deleting,      setDeleting]      = useState<string | null>(null)
  const [modifyingNobu, setModifyingNobu] = useState<NobuReservation | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<Reservation | null>(null)
  const [deleteError,   setDeleteError]   = useState<string | null>(null)

  // お気に入り
  const [favorites,    setFavorites]    = useState<Favorite[]>([])
  const [favOpen,      setFavOpen]      = useState(false)
  const [favEditModal, setFavEditModal] = useState<Favorite | null>(null)
  const [addingFav,    setAddingFav]    = useState(false)
  const [newFavName,   setNewFavName]   = useState('')
  const [addingFavErr, setAddingFavErr] = useState<string | null>(null)

  const fetchReservations = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const headers = { Authorization: `Bearer ${profile.getAccessToken()}` }
      const [nobuRes, kobuRes, nobuRoomRes] = await Promise.all([
        fetch('/api/reservations/my', { headers }),
        fetch('/api/kobu-reservations/my', { headers }),
        fetch('/api/nobu-room-reservations/my', { headers }),
      ])
      const failed = [
        { res: nobuRes,     label: '農部生協' },
        { res: kobuRes,     label: '工部室' },
        { res: nobuRoomRes, label: '農部室' },
      ].find(({ res }) => !res.ok)
      if (failed) {
        if (failed.res.status === 401) {
          throw new Error('セッションが切れています。LINEアプリを再起動してください')
        }
        const body = await failed.res.json().catch(() => ({}))
        throw new Error(`${failed.label} API: ${failed.res.status} ${body.error ?? ''}`)
      }
      const [nobuData, kobuData, nobuRoomData] = await Promise.all([nobuRes.json(), kobuRes.json(), nobuRoomRes.json()])

      const nobu: NobuReservation[]         = (nobuData.reservations ?? []).map((r: any) => ({ ...r, facility: 'nobu' }))
      const kobu: KobuReservation[]         = (kobuData.reservations ?? []).map((r: any) => ({ ...r, facility: 'kobu' }))
      const nobuRoom: NobuRoomReservation[] = (nobuRoomData.reservations ?? []).map((r: any) => ({ ...r, facility: 'nobu-room' }))

      const all: Reservation[] = [...nobu, ...kobu, ...nobuRoom].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
      setReservations(all)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '予約の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [profile])

  useEffect(() => { fetchReservations() }, [fetchReservations])

  const fetchFavorites = useCallback(async () => {
    try {
      const r = await fetch('/api/favorites', { headers: { Authorization: `Bearer ${profile.getAccessToken()}` } })
      if (r.ok) setFavorites((await r.json()).favorites ?? [])
    } catch {}
  }, [profile])

  useEffect(() => { fetchFavorites() }, [fetchFavorites])

  async function saveFavorite(id: string, name: string): Promise<void> {
    const res = await fetch(`/api/favorites/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${profile.getAccessToken()}` },
      body: JSON.stringify({ name: name.trim() }),
    })
    if (!res.ok) throw new Error((await res.json()).error ?? '更新に失敗しました')
    await Promise.all([fetchFavorites(), fetchReservations()])
  }

  async function deleteFavorite(id: string): Promise<void> {
    const res = await fetch(`/api/favorites/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${profile.getAccessToken()}` },
    })
    if (!res.ok) throw new Error((await res.json()).error ?? '削除に失敗しました')
    setFavorites(prev => prev.filter(f => f.id !== id))
  }

  async function addFavorite() {
    if (!newFavName.trim()) return
    setAddingFavErr(null)
    try {
      const res = await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${profile.getAccessToken()}` },
        body: JSON.stringify({ name: newFavName.trim() }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '追加に失敗しました')
      setNewFavName('')
      setAddingFav(false)
      fetchFavorites()
    } catch (err: any) {
      setAddingFavErr(err.message)
    }
  }

  useEffect(() => {
    if (!initialEdit || loading) return
    if (initialEdit.facility === 'nobu') {
      const r = reservations.find((x) => x.id === initialEdit.id && x.facility === 'nobu')
      if (!r) return
      setModifyingNobu(r as NobuReservation)
      onEditHandled?.()
    } else if (initialEdit.facility === 'kobu') {
      const r = reservations.find((x) => x.id === initialEdit.id && x.facility === 'kobu')
      if (!r) return
      onKobuEdit?.(r as KobuReservation)
      onEditHandled?.()
    } else if (initialEdit.facility === 'nobu-room') {
      const r = reservations.find((x) => x.id === initialEdit.id && x.facility === 'nobu-room')
      if (!r) return
      onNobuRoomEdit?.(r as NobuRoomReservation)
      onEditHandled?.()
    }
  }, [initialEdit, loading, reservations])

  async function handleDelete(r: Reservation) {
    setDeleting(r.id)
    setDeleteError(null)
    try {
      const endpoint = r.facility === 'nobu'
        ? `/api/reservations/${r.id}`
        : r.facility === 'kobu'
          ? `/api/kobu-reservations/${r.id}`
          : `/api/nobu-room-reservations/${r.id}`
      const res = await fetch(endpoint, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${profile.getAccessToken()}` },
      })
      if (!res.ok) throw new Error()
      setConfirmTarget(null)
      setReservations((prev) => prev.filter((x) => x.id !== r.id))
    } catch {
      setDeleteError('削除に失敗しました')
    } finally {
      setDeleting(null)
    }
  }

  if (loading) return (
    <div>
      <Skeleton width="120px" height="20px" className="mb-4" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="reservation-card">
          <div className="flex flex-col items-center gap-1 shrink-0">
            <Skeleton width="44px" height="44px" style={{ borderRadius: 12 }} />
            <Skeleton width="32px" height="10px" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <Skeleton width="55%" height="16px" />
              <Skeleton width="56px" height="20px" style={{ borderRadius: 20 }} />
            </div>
            <Skeleton width="72%" height="12px" />
          </div>
        </div>
      ))}
    </div>
  )

  if (error) return <div className="banner-error mt-4">{error}</div>

  const favSection = (
    <div className="mb-4 bg-surface border border-line rounded-xl overflow-hidden shadow-[var(--shadow-card-sm)]">
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#f8f8f8] transition text-left"
        onClick={() => setFavOpen(v => !v)}
      >
        <div className="flex items-center gap-2">
          <span className="icon text-brand" style={{ fontSize: 18 }}>star</span>
          <span className="text-[0.9rem] font-semibold text-ink">お気に入りバンド</span>
          {favorites.length > 0 && (
            <span className="text-[0.73rem] text-ink-pale">（{favorites.length}件）</span>
          )}
        </div>
        <span className="icon text-ink-pale">{favOpen ? 'expand_less' : 'expand_more'}</span>
      </button>

      {favOpen && (
        <div className="border-t border-line px-4 py-3 space-y-2">
          {favorites.length === 0 && !addingFav && (
            <p className="text-[0.82rem] text-ink-pale py-1">まだ登録されていません</p>
          )}

          {favorites.map(f => (
            <div key={f.id} className="flex items-center gap-2">
              <span className="flex-1 text-[0.9rem] text-ink truncate">{f.name}</span>
              {f.nobuTimeSlot && (
                <span className="text-[0.7rem] text-ink-pale whitespace-nowrap">
                  農部: {f.nobuTimeSlot.replace('-', '〜')}
                </span>
              )}
              <button className="btn-icon" title="編集" onClick={() => setFavEditModal(f)}>
                <span className="icon" style={{ fontSize: 18 }}>edit</span>
              </button>
            </div>
          ))}

          {addingFav ? (
            <div className="flex items-center gap-2 pt-1">
              <input
                className="text-input flex-1 py-1.5"
                placeholder="バンド名"
                value={newFavName}
                onChange={e => setNewFavName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addFavorite()}
                autoFocus
              />
              <button className="btn-primary py-1 px-3 text-[0.82rem]" onClick={addFavorite}>追加</button>
              <button className="btn-secondary py-1 px-3 text-[0.82rem]" onClick={() => { setAddingFav(false); setNewFavName(''); setAddingFavErr(null) }}>取消</button>
            </div>
          ) : favorites.length < 5 ? (
            <button className="flex items-center gap-1 text-[0.82rem] text-ink-sub py-1 mt-1" onClick={() => setAddingFav(true)}>
              <span className="icon" style={{ fontSize: 16 }}>add_circle</span>バンドを追加
            </button>
          ) : (
            <p className="text-[0.73rem] text-ink-pale mt-1">（最大5件）</p>
          )}

          {addingFavErr && <p className="text-[0.78rem] text-warn">{addingFavErr}</p>}
        </div>
      )}
    </div>
  )

  if (reservations.length === 0) {
    return (
      <div>
        {favSection}
        {favEditModal && (
          <FavoriteEditModal
            favorite={favEditModal}
            onClose={() => setFavEditModal(null)}
            onSave={async (name) => { await saveFavorite(favEditModal.id, name); setFavEditModal(null) }}
            onDelete={async () => { await deleteFavorite(favEditModal.id); setFavEditModal(null) }}
          />
        )}
        <div className="flex flex-col items-center gap-2 py-10 px-4 text-ink-pale text-center">
          <span className="icon icon-xl text-ink-pale">event_busy</span>
          <span className="text-[0.9rem]">予約はまだありません</span>
        </div>
      </div>
    )
  }

  return (
    <div>
      {favSection}

      <div className="flex items-center justify-between mb-4">
        <p className="text-[1.05rem] font-bold m-0 text-ink">自分の予約</p>
        <span className="text-[0.8rem] text-ink-sub bg-bg px-2.5 py-1 rounded-full">
          {reservations.length}件
        </span>
      </div>

      {modifyingNobu && (
        <NobuModifyModal
          reservation={modifyingNobu}
          profile={profile}
          onClose={() => setModifyingNobu(null)}
          onUpdated={fetchReservations}
        />
      )}

      {reservations.map((r) => {
        const isDeleting  = deleting === r.id
        const past        = isPast(r)
        const fc          = facilityConfig(r)
        const isConfirmed = r.facility === 'nobu' ? r.status === 'confirmed' : true
        const canDelete   = r.facility === 'nobu' ? !isConfirmed : true
        const statusBadge = r.facility === 'nobu' && !isConfirmed ? 'badge-pending' : 'badge-confirmed'
        const statusIcon  = r.facility === 'nobu' && !isConfirmed ? 'hourglass_empty' : 'check_circle'
        const statusLabel = r.facility === 'nobu' ? (isConfirmed ? '抽選確定' : '抽選待ち') : '確定'
        const notice      = availabilityNotice(r)

        function handleEdit() {
          if (isPast(r)) return
          if (r.facility === 'nobu') setModifyingNobu(r as NobuReservation)
          else if (r.facility === 'kobu') onKobuEdit?.(r as KobuReservation)
          else onNobuRoomEdit?.(r as NobuRoomReservation)
        }

        return (
          <div key={r.id} className="reservation-card">
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${fc.iconBg}`}>
                <span className={`icon ${fc.iconColor}`} style={{ fontSize: 22 }}>{fc.icon}</span>
              </div>
              <span className={`text-[0.6rem] font-semibold leading-none ${fc.labelColor}`}>{fc.label}</span>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="font-bold text-ink truncate">{r.bandName}</span>
                <span className={`badge ${statusBadge} shrink-0`}>
                  <span className="icon icon-sm">{statusIcon}</span>
                  {statusLabel}
                </span>
              </div>
              <div className="text-[0.8rem] text-ink-sub flex items-center gap-1.5">
                <span className="icon icon-sm text-ink-pale">calendar_month</span>
                <span>{displayDateStr(r)}</span>
                <span className="icon icon-sm text-ink-pale ml-0.5">schedule</span>
                <span>{displayTime(r)}</span>
              </div>
              {notice && (
                <div
                  className={
                    'mt-2 rounded-lg px-3 py-2 text-[0.78rem] border ' +
                    (notice.kind === 'warning'
                      ? 'bg-warn-light text-warn border-warn'
                      : 'bg-brand-light text-brand-dark border-brand/30')
                  }
                >
                  <div className="flex items-center gap-1.5 font-semibold">
                    <span className="icon icon-sm">{notice.icon}</span>
                    <span>{notice.label}</span>
                  </div>
                  {notice.message && <p className="mt-1 leading-relaxed">{notice.message}</p>}
                </div>
              )}
            </div>

            {!past && (
              <div className="flex flex-col gap-1 shrink-0">
                <button className="btn-icon" onClick={handleEdit} disabled={isDeleting} title="変更">
                  <span className="icon" style={{ fontSize: 20 }}>edit</span>
                </button>
                {canDelete && (
                  <button className="btn-icon-danger" onClick={() => { if (isPast(r)) return; setConfirmTarget(r); setDeleteError(null) }} disabled={isDeleting} title="削除">
                    <span className="icon" style={{ fontSize: 20 }}>{isDeleting ? 'hourglass_empty' : 'delete'}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* お気に入り編集モーダル */}
      {favEditModal && (
        <FavoriteEditModal
          favorite={favEditModal}
          onClose={() => setFavEditModal(null)}
          onSave={async (name) => { await saveFavorite(favEditModal.id, name); setFavEditModal(null) }}
          onDelete={async () => { await deleteFavorite(favEditModal.id); setFavEditModal(null) }}
        />
      )}

      {/* 削除確認モーダル */}
      {confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => { if (!deleting) { setConfirmTarget(null) } }} />
          <div className="relative bg-surface rounded-2xl shadow-[var(--shadow-modal)] w-full max-w-[320px] p-6">
            <p className="text-base font-bold text-ink mb-1.5">予約を削除しますか？</p>
            <p className="text-[0.85rem] text-ink-sub mb-4">
              「{confirmTarget.bandName}」の
              {confirmTarget.facility === 'nobu' ? '農部生協' : confirmTarget.facility === 'kobu' ? '工部室' : '農部室'}
              の予約を削除します。
            </p>
            {deleteError && <div className="banner-error">{deleteError}</div>}
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setConfirmTarget(null)} disabled={!!deleting}>
                キャンセル
              </button>
              <button className="btn-danger flex-1" onClick={() => handleDelete(confirmTarget)} disabled={!!deleting}>
                {deleting ? '削除中...' : '削除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── お気に入り編集モーダル ───────────────────────────
function FavoriteEditModal({
  favorite, onClose, onSave, onDelete,
}: {
  favorite: Favorite
  onClose: () => void
  onSave: (name: string) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [name,          setName]          = useState(favorite.name)
  const [saving,        setSaving]        = useState(false)
  const [deleting,      setDeleting]      = useState(false)
  const [error,         setError]         = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  async function handleSave() {
    if (!name.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      await onSave(name)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    try {
      await onDelete()
    } catch (err: any) {
      setError(err.message)
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={() => !saving && !deleting && onClose()} />
      <div className="relative bg-surface rounded-2xl shadow-[var(--shadow-modal)] w-full max-w-[320px] overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-line">
          <p className="text-base font-bold text-ink">お気に入りを編集</p>
          <button className="btn-icon-close" onClick={onClose} disabled={saving || deleting}>
            <span className="icon">close</span>
          </button>
        </div>

        <div className="px-5 py-4">
          <label className="block text-[0.8rem] text-ink-sub mb-1.5">バンド名</label>
          <input
            className="text-input"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            autoFocus
          />
          {favorite.nobuTimeSlot && (
            <p className="text-[0.75rem] text-ink-pale mt-2">
              農部 時間枠: {favorite.nobuTimeSlot.replace('-', '〜')}
            </p>
          )}
          {error && <div className="banner-error mt-2">{error}</div>}
        </div>

        <div className="px-5 pb-5 flex flex-col gap-2">
          <button className="btn-primary" onClick={handleSave} disabled={!name.trim() || saving || deleting}>
            {saving ? '保存中...' : '保存'}
          </button>

          {!deleteConfirm ? (
            <button className="btn-danger" onClick={() => setDeleteConfirm(true)} disabled={saving || deleting}>
              削除
            </button>
          ) : (
            <div className="border border-warn/30 rounded-xl p-3 bg-warn-light">
              <p className="text-[0.82rem] text-ink font-semibold text-center mb-2">本当に削除しますか？</p>
              <div className="flex gap-2">
                <button className="btn-secondary flex-1" onClick={() => setDeleteConfirm(false)} disabled={deleting}>
                  キャンセル
                </button>
                <button className="btn-danger flex-1" onClick={handleDelete} disabled={deleting}>
                  {deleting ? '削除中...' : 'OK'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── 農部予約変更モーダル ─────────────────────────────
type NobuTimeSlot = { label: string; value: string }

function NobuModifyModal({
  reservation, profile, onClose, onUpdated,
}: {
  reservation: NobuReservation
  profile: LiffProfile
  onClose: () => void
  onUpdated: () => void
}) {
  const currentSlot = reservation.date.split('T')[1] // e.g. "18:00-20:00"
  const [newBandName, setNewBandName] = useState(reservation.bandName)
  const [newTimeSlot, setNewTimeSlot] = useState(currentSlot)
  const [slots,       setSlots]       = useState<NobuTimeSlot[] | null>(null)
  const [error,       setError]       = useState<string | null>(null)
  const [saving,      setSaving]      = useState(false)
  const isConfirmed = reservation.status === 'confirmed'

  useEffect(() => {
    const dateOnly = reservation.date.split('T')[0]
    if (reservation.availableTimeSlots) {
      setSlots(reservation.availableTimeSlots)
      return
    }
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data) => {
        const dateEntry = (data.availableDatesWithToday ?? []).find((d: any) => d.value === dateOnly)
        const raw: NobuTimeSlot[] = dateEntry?.timeSlots?.length ? dateEntry.timeSlots : []
        setSlots(raw)
      })
      .catch(() => setSlots([]))
  }, [reservation])

  async function handleSubmit() {
    const noChange = newBandName.trim() === reservation.bandName && newTimeSlot === currentSlot
    if (noChange) { onClose(); return }
    if (!newBandName.trim()) { setError('バンド名を入力してください'); return }
    setSaving(true)
    setError(null)
    try {
      const body: Record<string, string> = {}
      if (newBandName.trim() !== reservation.bandName) body.bandName = newBandName.trim()
      if (newTimeSlot !== currentSlot) body.timeSlot = newTimeSlot
      const res = await fetch(`/api/reservations/${reservation.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${profile.getAccessToken()}`,
        },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '変更に失敗しました')
      onUpdated()
      onClose()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const dateOnly    = reservation.date.split('T')[0]
  const displayDate = dateOnly.slice(5).replace('-', '/')

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card max-w-[360px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold mb-0.5">予約を変更</h3>
            <p className="text-[0.82rem] text-ink-sub">農部 — {displayDate}</p>
          </div>
          <button className="btn-icon-close shrink-0" onClick={onClose} disabled={saving} aria-label="閉じる">
            <span className="icon">close</span>
          </button>
        </div>

        {slots === null ? (
          <div className="text-center py-6 text-ink-pale text-[0.9rem]">読み込み中...</div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-[0.85rem] font-medium mb-1 block">バンド名</label>
              <input
                className="text-input"
                value={newBandName}
                onChange={(e) => setNewBandName(e.target.value)}
                placeholder="バンド名"
              />
            </div>
            <div>
              <label className="text-[0.85rem] font-medium mb-1 block">時間枠</label>
              {isConfirmed ? (
                <p className="text-input bg-bg text-ink-sub cursor-not-allowed">
                  {slots.find((s) => s.value === currentSlot)?.label ?? currentSlot}
                </p>
              ) : slots.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {slots.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      className={
                        'w-full px-3 py-2.5 rounded-lg text-[0.85rem] border-[1.5px] text-left transition ' +
                        (s.value === newTimeSlot
                          ? 'bg-brand border-brand text-white font-semibold'
                          : 'bg-surface border-line text-ink-sub')
                      }
                      onClick={() => setNewTimeSlot(s.value)}
                    >{s.label}</button>
                  ))}
                </div>
              ) : (
                <p className="text-input bg-bg text-ink-sub">
                  {currentSlot}
                </p>
              )}
              {isConfirmed && (
                <p className="text-[0.78rem] text-ink-sub mt-1">抽選確定済みのため時間枠は変更できません</p>
              )}
            </div>
          </div>
        )}

        {error && <div className="banner-error mt-3">{error}</div>}

        <div className="mt-4">
          <button className="btn-primary" onClick={handleSubmit} disabled={saving || slots === null}>
            {saving ? '変更中...' : '変更'}
          </button>
        </div>
      </div>
    </div>
  )
}
