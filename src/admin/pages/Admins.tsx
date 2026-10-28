import { useEffect, useState, useCallback } from 'react'
import { useToast } from '../../contexts/ToastContext'
import { adminFetch } from '../auth'
import { getPageCache, setPageCache } from '../pageCache'
import Skeleton from '../../components/Skeleton'
import ConfirmDialog from '../../components/ConfirmDialog'

type Admin = {
  userId: string
  displayName: string
  pictureUrl: string | null
  isAdmin: boolean
  isSuperAdmin: boolean
  isRoomManager: boolean
  addedAt: number | null
  addedBy: string | null
}
type TransferUser = { userId: string; displayName: string; banned: boolean }

const ADMINS_CACHE_KEY = 'admins-with-room-manager'
type AdminsCache = {
  me: { userId: string; isSuperAdmin?: boolean } | null
  admins: Admin[]
  users: TransferUser[]
}

export default function Admins() {
  const cached = getPageCache<AdminsCache>(ADMINS_CACHE_KEY)
  const [admins, setAdmins]           = useState<Admin[]>(cached?.admins ?? [])
  const [users, setUsers] = useState<TransferUser[]>(cached?.users ?? [])
  const [userSearch, setUserSearch] = useState('')
  const [targetUserId, setTargetUserId] = useState('')
  const [authority, setAuthority] = useState<'super' | 'admin' | 'room'>('room')
  const [sourceUserId, setSourceUserId] = useState('')
  const [editAuthority, setEditAuthority] = useState<'admin' | 'room'>('room')
  const [editUserId, setEditUserId] = useState('')
  const [editSearch, setEditSearch] = useState('')
  const [transferLink, setTransferLink] = useState('')
  const [transferOpen, setTransferOpen] = useState(false)
  const [grantLink, setGrantLink] = useState('')
  const [loading, setLoading]         = useState(!cached)
  const [me, setMe]                   = useState<{ userId: string; isSuperAdmin?: boolean } | null>(cached?.me ?? null)
  const [openId,     setOpenId]       = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const { showToast } = useToast()
  const [confirmAction, setConfirmAction] = useState<{
    title: string
    message: string
    confirmLabel?: string
    onConfirm: () => Promise<void>
  } | null>(null)

  const load = useCallback(async () => {
    if (!getPageCache<AdminsCache>(ADMINS_CACHE_KEY)) setLoading(true)
    try {
      const [meRes, adminRes, usersRes] = await Promise.all([
        adminFetch('/api/admin/auth/me'),
        adminFetch('/api/admin/admins'),
        adminFetch('/api/admin/users'),
      ])
      const meData = await meRes.json()
      const adminData = await adminRes.json()
      const usersData = usersRes.ok ? await usersRes.json() : { users: [] }
      setMe(meData)
      setAdmins(adminData.admins)
      setUsers(usersData.users ?? [])
      setPageCache<AdminsCache>(ADMINS_CACHE_KEY, {
        me: meData,
        admins: adminData.admins,
        users: usersData.users ?? [],
      })
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  function openTransfer(nextAuthority: 'super' | 'admin' | 'room', sourceId: string) {
    const source = admins.find((admin) => admin.userId === sourceId)
    if (!source || (source.isAdmin && sourceId !== me?.userId && !me?.isSuperAdmin)) return
    if (nextAuthority === 'super' && (!me?.isSuperAdmin || sourceId !== me.userId)) return
    if (nextAuthority === 'admin' && !me?.isSuperAdmin && sourceId !== me?.userId) return
    setAuthority(nextAuthority)
    setSourceUserId(sourceId)
    setTargetUserId('')
    setUserSearch('')
    setTransferLink('')
    setMessage(null)
    setTransferOpen(true)
  }

  function revokeRoomManager() {
    const source = admins.find((admin) => admin.userId === sourceUserId)
    if (authority !== 'room' || !source?.isRoomManager || source.userId === me?.userId) return
    setConfirmAction({
      title: '部屋取り権限をはく奪しますか？',
      message: `「${source.displayName || source.userId}」の部屋取り権限をはく奪します。`,
      confirmLabel: 'はく奪',
      onConfirm: async () => {
        const res = await adminFetch('/api/admin/admins/permissions', { method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: source.userId, authority: 'room', operation: 'remove' }) })
        if (!res.ok) throw new Error((await res.json()).error ?? 'はく奪に失敗しました')
        setConfirmAction(null)
        setTransferOpen(false)
        showToast(`「${source.displayName || source.userId}」の部屋取り権限をはく奪しました`)
        await load()
      },
    })
  }

  function changeSelectedAuthority() {
    const target = users.find((user) => user.userId === editUserId)
    if (!target || target.userId === me?.userId || target.banned) return
    const label = editAuthority === 'admin' ? '管理者権限' : '部屋取り権限'
    const verb = '追加'
    setConfirmAction({
      title: `${label}を${verb}しますか？`,
      message: `「${target.displayName || target.userId}」の${label}を${verb}します。`,
      confirmLabel: verb,
      onConfirm: async () => {
        const res = await adminFetch('/api/admin/admins/permissions', { method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: target.userId, authority: editAuthority, operation: 'add' }) })
        if (!res.ok) throw new Error((await res.json()).error ?? `${verb}に失敗しました`)
        setEditUserId('')
        setEditSearch('')
        setConfirmAction(null)
        setTransferOpen(false)
        showToast(`「${target.displayName || target.userId}」の${label}を${verb}しました`)
        await load()
      },
    })
  }

  function transferSelectedAuthority() {
    const target = users.find((user) => user.userId === targetUserId)
    if (!target || target.banned || target.userId === me?.userId) return
    if (authority === 'admin' && me?.isSuperAdmin && !sourceUserId) return
    const label = authority === 'super' ? 'スーパー管理者権限' : authority === 'admin' ? '管理者権限' : '部屋取り権限'
    const source = authority === 'admin' && me?.isSuperAdmin
      ? admins.find((admin) => admin.userId === sourceUserId) : null
    setConfirmAction({
      title: `${label}を移譲しますか？`,
      message: `「${target.displayName || target.userId}」に${label}を移譲します。${authority === 'room' ? '現在の部屋取り担当者は権限を失います。' : source ? `「${source.displayName || source.userId}」は管理者権限を失います。` : '移譲後、あなたはこの権限を失います。'}`,
      confirmLabel: '移譲',
      onConfirm: async () => {
        const res = await adminFetch('/api/admin/admins/transfer', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: target.userId, authority, sourceUserId }) })
        if (!res.ok) throw new Error((await res.json()).error ?? '移譲に失敗しました')
        setTargetUserId('')
        setSourceUserId('')
        setUserSearch('')
        setConfirmAction(null)
        setTransferOpen(false)
        showToast(`「${target.displayName || target.userId}」に${label}を移譲しました`)
        if (authority === 'admin' && !me?.isSuperAdmin) window.location.assign('/admin/login')
        else await load()
      },
    })
  }

  async function createAuthorityLink(kind: 'transfer' | 'grant') {
    setMessage(null)
    const selectedAuthority = kind === 'transfer' ? authority : editAuthority
    const endpoint = kind === 'transfer' ? 'transfer-link' : 'permission-link'
    const body = kind === 'transfer' ? { authority: selectedAuthority, sourceUserId } : { authority: selectedAuthority }
    try {
      const res = await adminFetch(`/api/admin/admins/${endpoint}`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'リンクを作成できませんでした')
      if (kind === 'transfer') setTransferLink(data.url)
      else setGrantLink(data.url)
    } catch (err: any) { setMessage(err.message) }
  }


  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{loading ? <Skeleton width="160px" height="28px" /> : '管理者管理'}</h1>

      {message && !transferOpen && <div className="banner-error">{message}</div>}

      <div className="flex flex-col">

      <div className={`admin-card ${loading ? 'skeleton-layout' : ''}`} aria-busy={loading} ref={(el) => { if (el) el.inert = loading }}>
        <h2 className="text-base font-bold mb-2">権限の追加</h2>
        <p className="text-sm text-ink-sub mb-3">自分より弱い権限を、登録済みユーザーに追加できます。</p>
        <div className="flex gap-2 flex-wrap">
          <select className="text-input flex-1" aria-label="操作する権限" value={editAuthority}
            onChange={(event) => { setEditAuthority(event.target.value as 'admin' | 'room'); setEditUserId(''); setGrantLink('') }}>
            {me?.isSuperAdmin && <option value="admin">管理者権限</option>}
            <option value="room">部屋取り権限</option>
          </select>
        </div>
        <input className="text-input mt-2" placeholder="ユーザー名で検索" value={editSearch}
          onChange={(event) => { setEditSearch(event.target.value); setEditUserId('') }} />
        <select className="text-input mt-2" aria-label="権限を変更するユーザー" value={editUserId}
          onChange={(event) => setEditUserId(event.target.value)}>
          <option value="">ユーザーを選択</option>
          {users.filter((user) => {
            const role = admins.find((admin) => admin.userId === user.userId)
            const hasAuthority = editAuthority === 'admin' ? !!role?.isAdmin : !!role?.isRoomManager
            return user.userId !== me?.userId && (editAuthority === 'room' || !role?.isSuperAdmin) &&
              !user.banned && !hasAuthority &&
              `${user.displayName} ${user.userId}`.toLowerCase().includes(editSearch.toLowerCase())
          }).map((user) => <option key={user.userId} value={user.userId}>{user.displayName || '名前なし'} ({user.userId})</option>)}
        </select>
        <button className="btn-outline mt-2" disabled={!editUserId} onClick={changeSelectedAuthority}>
          選択したユーザーの権限を追加
        </button>
        <button className="btn-outline mt-2 ml-2" onClick={() => createAuthorityLink('grant')}>追加リンクを作成</button>
        <p className="text-[0.78rem] text-ink-sub mt-2">リンクは24時間有効で、最初の1人が利用すると無効になります。</p>
        {grantLink && <input className="text-input mt-2" readOnly aria-label="追加リンク" value={grantLink}
          onFocus={(event) => event.target.select()} />}
      </div>

      {/* 現在の管理者 */}
      <div className="order-first bg-surface border border-line rounded-xl overflow-hidden shadow-[var(--shadow-card-sm)] mb-4">
        <div className="px-5 py-4 border-b border-line">
          <h2 className="text-base font-bold m-0">{loading ? <Skeleton width="190px" height="20px" /> : `現在の権限者 (${admins.length}名)`}</h2>
        </div>

        {/* Desktop */}
        <table className="admin-table hidden md:table">
          <thead>
            <tr>
              <th></th>
              <th>登録日</th>
              <th style={{ width: '100px' }}></th>
            </tr>
          </thead>
          <tbody>
            {loading && Array.from({ length: 3 }, (_, i) => <AdminDesktopRow key={`loading-${i}`} loading />)}
            {!loading && admins.map((a) => <AdminDesktopRow key={a.userId} admin={a} me={me} onTransfer={openTransfer} />)}
          </tbody>
        </table>

        {/* Mobile accordion */}
        <div className="md:hidden">
          {loading && Array.from({ length: 3 }, (_, i) => <AdminMobileCard key={`loading-${i}`}
            a={{ userId: `loading-${i}`, displayName: '読み込み中', pictureUrl: null, isAdmin: true, isSuperAdmin: false, isRoomManager: false, addedAt: null, addedBy: null }}
            me={null} open={false} onToggle={() => {}} onTransfer={() => {}} loading />)}
          {!loading && admins.map((a) => (
            <AdminMobileCard
              key={a.userId}
              a={a}
              me={me}
              open={openId === a.userId}
              onToggle={() => setOpenId(openId === a.userId ? null : a.userId)}
              onTransfer={openTransfer}
            />
          ))}
        </div>
      </div>
      </div>

      {transferOpen && (
        <div className="modal-backdrop" onClick={() => setTransferOpen(false)}>
          <div className="modal-card max-w-[560px]" role="dialog" aria-modal="true" aria-labelledby="transfer-title" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 id="transfer-title" className="text-base font-bold m-0">{authority === 'super' ? 'スーパー管理者権限' : authority === 'admin' ? '管理者権限' : '部屋取り権限'}の操作</h2>
              <button type="button" className="btn-icon-close" aria-label="閉じる" onClick={() => setTransferOpen(false)}><span className="icon">close</span></button>
            </div>
            <p className="text-sm text-ink-sub mb-3">{authority === 'room' ? '現在の部屋取り担当者全員から権限を外し、移譲先に付与します。' : `権限元: ${admins.find((admin) => admin.userId === sourceUserId)?.displayName || sourceUserId}`}</p>
            {message && <div className="banner-error mb-3">{message}</div>}
            <input className="text-input" placeholder="ユーザー名で検索" value={userSearch}
              onChange={(event) => { setUserSearch(event.target.value); setTargetUserId('') }} />
            <select className="text-input mt-2" aria-label="権限の移譲先" value={targetUserId}
              onChange={(event) => setTargetUserId(event.target.value)}>
              <option value="">移譲先を選択</option>
              {users.filter((user) => !user.banned && user.userId !== me?.userId && user.userId !== sourceUserId &&
                (authority === 'room' ? !admins.some((admin) => admin.isRoomManager && admin.userId === user.userId)
                  : authority === 'admin' ? !admins.some((admin) => admin.isAdmin && admin.userId === user.userId) : true) &&
                `${user.displayName} ${user.userId}`.toLowerCase().includes(userSearch.toLowerCase()))
                .map((user) => <option key={user.userId} value={user.userId}>{user.displayName || '名前なし'} ({user.userId})</option>)}
            </select>
            <div className="flex flex-wrap gap-2 mt-3">
              <button className="btn-outline" disabled={!targetUserId} onClick={transferSelectedAuthority}>選択したユーザーへ移譲</button>
              <button className="btn-outline" onClick={() => createAuthorityLink('transfer')}>移譲リンクを作成</button>
              {authority === 'room' && admins.some((admin) => admin.userId === sourceUserId && admin.isRoomManager) &&
                <button className="btn-danger" onClick={revokeRoomManager}>このユーザーの部屋取り権限をはく奪</button>}
            </div>
            <p className="text-[0.78rem] text-ink-sub mt-2">リンクは24時間有効で、最初の1人が利用すると無効になります。</p>
            {transferLink && <input className="text-input mt-2" readOnly aria-label="移譲リンク" value={transferLink} onFocus={(event) => event.target.select()} />}
          </div>
        </div>
      )}


      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel={confirmAction.confirmLabel}
          onClose={() => setConfirmAction(null)}
          onConfirm={confirmAction.onConfirm}
        />
      )}
    </div>
  )
}
function AdminDesktopRow({ admin, me, onTransfer, loading = false }: {
  admin?: Admin
  me?: { userId: string; isSuperAdmin?: boolean } | null
  onTransfer?: (authority: 'super' | 'admin' | 'room', sourceId: string) => void
  loading?: boolean
}) {
  return <tr>
    <td data-label="名前"><div className="flex items-center gap-2 flex-wrap">
      {loading ? <><Skeleton width={32} height={32} circle /><Skeleton width="45%" height={15} /></> : <>
        {admin?.pictureUrl ? <img src={admin.pictureUrl} alt="" className="avatar" /> : <span className="avatar-fallback"><span className="icon">account_circle</span></span>}
        <span>{admin?.displayName || '(名前なし)'}</span>
        {admin?.isSuperAdmin && <button type="button" disabled={!me?.isSuperAdmin || me.userId !== admin.userId} onClick={() => onTransfer?.('super', admin.userId)} className="badge badge-super border-0 cursor-pointer disabled:cursor-default" aria-label={`${admin.displayName || '名前なし'}のスーパー管理者権限を移譲`}><span className="icon icon-sm">star</span>スーパー管理者</button>}
        {admin?.isAdmin && !admin.isSuperAdmin && <button type="button" disabled={!me?.isSuperAdmin && me?.userId !== admin.userId} onClick={() => onTransfer?.('admin', admin.userId)} className="badge badge-info border-0 cursor-pointer disabled:cursor-default" aria-label={`${admin.displayName || '名前なし'}の管理者権限を移譲`}><span className="icon icon-sm">shield_person</span>管理者</button>}
        {admin?.isRoomManager && <button type="button" onClick={() => onTransfer?.('room', admin.userId)} className="badge badge-room border-0 cursor-pointer disabled:cursor-default" aria-label="すべての部屋取り権限を移譲"><span className="icon icon-sm">meeting_room</span>部屋取り</button>}
        {admin && me?.userId === admin.userId && <span className="badge badge-neutral">自分</span>}
      </>}
    </div></td>
    <td data-label="登録日" className="text-[0.85rem] text-ink-sub">{loading ? <Skeleton width={80} height={13} /> : admin?.addedAt ? new Date(admin.addedAt).toLocaleDateString('ja-JP') : '-'}</td>
    <td className="cell-actions" />
  </tr>
}

function AdminMobileCard({
  a, me, open, onToggle, onTransfer, loading = false,
}: {
  a: Admin
  me: { userId: string; isSuperAdmin?: boolean } | null
  open: boolean
  onToggle: () => void
  onTransfer: (authority: 'super' | 'admin' | 'room', sourceId: string) => void
  loading?: boolean
}) {
  const isSelf = me?.userId === a.userId

  return (
    <div className={`border-b border-line last:border-b-0 ${loading ? 'skeleton-layout' : ''}`} aria-busy={loading} ref={(el) => { if (el) el.inert = loading }}>
      <div className="w-full flex items-center gap-3 px-4 py-3 text-left bg-transparent border-0 hover:bg-[#fafbfc] transition-colors">
        <button type="button" className="flex flex-1 min-w-0 items-center gap-3 text-left bg-transparent border-0 cursor-pointer" onClick={onToggle} aria-expanded={open}>
        {a.pictureUrl
          ? <img src={a.pictureUrl} alt="" className="avatar shrink-0" />
          : <span className="avatar-fallback shrink-0"><span className="icon">account_circle</span></span>}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-medium">{a.displayName || '(名前なし)'}</span>
            {isSelf && <span className="badge badge-neutral">自分</span>}
          </div>
        </div>
          <span className={`icon text-ink-pale transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
            expand_more
          </span>
        </button>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          {a.isSuperAdmin && <button type="button" disabled={!me?.isSuperAdmin || !isSelf} onClick={() => onTransfer('super', a.userId)}
            className="badge badge-super border-0 cursor-pointer disabled:cursor-default"><span className="icon icon-sm">star</span>スーパー管理者</button>}
          {a.isAdmin && !a.isSuperAdmin && <button type="button" disabled={!me?.isSuperAdmin && !isSelf} onClick={() => onTransfer('admin', a.userId)}
            className="badge badge-info border-0 cursor-pointer disabled:cursor-default"><span className="icon icon-sm">shield_person</span>管理者</button>}
          {a.isRoomManager && <button type="button" onClick={() => onTransfer('room', a.userId)}
            className="badge badge-room border-0 cursor-pointer disabled:cursor-default"><span className="icon icon-sm">meeting_room</span>部屋取り</button>}
        </div>
      </div>

      <div className={`grid transition-all duration-200 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden min-h-0">
          <div className="px-4 pb-3 border-t border-line bg-bg">
            <div className="flex items-center justify-between py-2">
              <span className="text-[0.72rem] text-ink-sub font-semibold uppercase tracking-wide">登録日</span>
              <span className="text-[0.85rem] text-ink-sub">
                {a.addedAt ? new Date(a.addedAt).toLocaleDateString('ja-JP') : '-'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
