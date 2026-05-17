import { useEffect, useState, useCallback } from 'react'
import { adminFetch } from '../auth'
import Skeleton from '../../components/Skeleton'

type Admin = {
  userId: string
  displayName: string
  isSuperAdmin: boolean
  addedAt: number | null
  addedBy: string | null
}

type Invitation = {
  token: string
  createdBy: string | null
  createdAt: number | null
  expiresAt: number | null
  used: boolean
  usedBy: string | null
}

export default function Admins() {
  const [admins, setAdmins]           = useState<Admin[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading]         = useState(true)
  const [me, setMe]                   = useState<{ userId: string; isSuperAdmin?: boolean } | null>(null)
  const [generated, setGenerated]     = useState<{ url: string; expiresAt: string } | null>(null)
  const [generating, setGenerating]   = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [meRes, adminRes, invRes] = await Promise.all([
        adminFetch('/api/admin/auth/me'),
        adminFetch('/api/admin/admins'),
        adminFetch('/api/admin/invitations'),
      ])
      setMe(await meRes.json())
      setAdmins((await adminRes.json()).admins)
      setInvitations((await invRes.json()).invitations)
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function removeAdmin(a: Admin) {
    if (!confirm(`「${a.displayName || a.userId}」を管理者から削除しますか？`)) return
    const res = await adminFetch(`/api/admin/admins/${a.userId}`, { method: 'DELETE' })
    if (res.ok) {
      setAdmins((prev) => prev.filter((x) => x.userId !== a.userId))
    } else {
      alert((await res.json()).error ?? '削除に失敗しました')
    }
  }

  async function transferSuper(a: Admin) {
    if (!confirm(
      `スーパー管理者を「${a.displayName || a.userId}」に移譲しますか？\n\n` +
      `この操作は取り消せません。あなたは通常の管理者になります。`
    )) return
    const res = await adminFetch(`/api/admin/admins/${a.userId}/transfer-super`, { method: 'POST' })
    if (res.ok) {
      alert(`「${a.displayName}」にスーパー管理者を移譲しました`)
      load()
    } else {
      alert((await res.json()).error ?? '移譲に失敗しました')
    }
  }

  async function generateInvite() {
    setGenerating(true)
    setGenerated(null)
    try {
      const res = await adminFetch('/api/admin/invitations', { method: 'POST' })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setGenerated({ url: data.url, expiresAt: data.expiresAt })
      load()
    } catch {
      alert('招待リンクの生成に失敗しました')
    } finally {
      setGenerating(false)
    }
  }

  async function revokeInvitation(token: string) {
    if (!confirm('この招待リンクを取り消しますか？')) return
    const res = await adminFetch(`/api/admin/invitations/${token}`, { method: 'DELETE' })
    if (res.ok) {
      setInvitations((prev) => prev.filter((x) => x.token !== token))
    }
  }

  function copyUrl(url: string) {
    navigator.clipboard.writeText(url).then(
      () => alert('URLをコピーしました'),
      () => alert('コピーに失敗しました')
    )
  }

  if (loading) return (
    <div>
      <Skeleton width="180px" height="28px" className="mb-6" />
      <div className="admin-card">
        <Skeleton width="60%" height="20px" className="mb-2" />
        <Skeleton width="90%" height="14px" className="mb-4" />
        <Skeleton width="160px" height="36px" />
      </div>
      <div className="bg-surface border border-line rounded-xl overflow-hidden shadow-[var(--shadow-card-sm)]">
        <div className="px-5 py-4 border-b border-line">
          <Skeleton width="200px" height="20px" />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3 px-4 py-3 border-b border-line items-center last:border-b-0">
            <Skeleton width="40%" height="16px" />
            <Skeleton width="80px" height="14px" className="ml-auto" />
            <Skeleton width="32px" height="32px" />
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">管理者管理</h1>

      {/* 招待リンク発行 */}
      <div className="admin-card">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-base font-bold m-0">新規管理者を招待</h2>
          <button className="btn-primary w-auto px-3.5 py-2"
            onClick={generateInvite} disabled={generating}>
            <span className="icon icon-sm">add_link</span>
            {generating ? '生成中...' : '招待リンクを発行'}
          </button>
        </div>
        <p className="text-[0.85rem] text-ink-sub">
          発行されたリンクを新管理者に共有してください。リンクは24時間有効で、一度使用すると無効になります。
        </p>
        {generated && (
          <div className="mt-3 p-3 bg-brand-light border border-brand rounded-lg">
            <div className="break-all text-[0.85rem] mb-2">{generated.url}</div>
            <button className="btn-outline w-auto px-3 py-1.5" onClick={() => copyUrl(generated.url)}>
              <span className="icon icon-sm">content_copy</span> コピー
            </button>
          </div>
        )}
      </div>

      {/* 現在の管理者 */}
      <div className="bg-surface border border-line rounded-xl overflow-hidden shadow-[var(--shadow-card-sm)] mb-4">
        <div className="px-5 py-4 border-b border-line">
          <h2 className="text-base font-bold m-0">現在の管理者 ({admins.length}名)</h2>
        </div>
        <table className="admin-table">
          <thead>
            <tr>
              <th>名前</th>
              <th>登録日</th>
              <th style={{ width: '100px' }}></th>
            </tr>
          </thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.userId}>
                <td data-label="名前">
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {a.isSuperAdmin && (
                      <span className="badge badge-super"><span className="icon icon-sm">star</span>スーパー管理者</span>
                    )}
                    {me?.userId === a.userId && <span className="badge badge-neutral">自分</span>}
                    <span>{a.displayName || '(名前なし)'}</span>
                  </div>
                </td>
                <td data-label="登録日" className="text-[0.85rem] text-ink-sub">
                  {a.addedAt ? new Date(a.addedAt).toLocaleDateString('ja-JP') : '-'}
                </td>
                <td className="cell-actions">
                  <div className="flex gap-1.5 justify-end">
                    {me?.isSuperAdmin && !a.isSuperAdmin && me?.userId !== a.userId && (
                      <button
                        className="btn-icon hover:text-[var(--color-super)] hover:border-[var(--color-super-border)] hover:bg-[var(--color-super-light)]"
                        onClick={() => transferSuper(a)}
                        title="スーパー管理者に移譲"
                        style={{ color: 'var(--color-super)', borderColor: 'var(--color-super-border)' }}
                      >
                        <span className="icon">star</span>
                      </button>
                    )}
                    {!a.isSuperAdmin && me?.userId !== a.userId && (
                      <button className="btn-icon" onClick={() => removeAdmin(a)} title="削除">
                        <span className="icon">person_remove</span>
                      </button>
                    )}
                    {(a.isSuperAdmin && me?.userId === a.userId) && (
                      <span className="text-[0.8rem] text-ink-pale">—</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 発行済み招待 */}
      {invitations.length > 0 && (
        <div className="bg-surface border border-line rounded-xl overflow-hidden shadow-[var(--shadow-card-sm)]">
          <div className="px-5 py-4 border-b border-line">
            <h2 className="text-base font-bold m-0">発行済み招待</h2>
          </div>
          <table className="admin-table">
            <thead>
              <tr>
                <th>発行日</th>
                <th>有効期限</th>
                <th>状態</th>
                <th style={{ width: '80px' }}></th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((inv) => {
                const expired = inv.expiresAt ? inv.expiresAt < Date.now() : false
                return (
                  <tr key={inv.token}>
                    <td data-label="発行日" className="text-[0.85rem]">
                      {inv.createdAt ? new Date(inv.createdAt).toLocaleString('ja-JP') : '-'}
                    </td>
                    <td data-label="有効期限" className="text-[0.85rem]">
                      {inv.expiresAt ? new Date(inv.expiresAt).toLocaleString('ja-JP') : '-'}
                    </td>
                    <td data-label="状態">
                      {inv.used
                        ? <span className="badge badge-confirmed">使用済み</span>
                        : expired
                          ? <span className="badge badge-neutral">期限切れ</span>
                          : <span className="badge badge-pending">有効</span>}
                    </td>
                    <td className="cell-actions">
                      {!inv.used && !expired && (
                        <button className="btn-icon" onClick={() => revokeInvitation(inv.token)}>
                          <span className="icon">delete</span>
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
