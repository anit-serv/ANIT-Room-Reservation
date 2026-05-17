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
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
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
      <Skeleton width="180px" height="28px" style={{ marginBottom: '1.5rem' }} />
      <div className="admin-card">
        <Skeleton width="60%" height="20px" style={{ marginBottom: '0.5rem' }} />
        <Skeleton width="90%" height="14px" style={{ marginBottom: '1rem' }} />
        <Skeleton width="160px" height="36px" />
      </div>
      <div className="admin-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
          <Skeleton width="200px" height="20px" />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ display: 'flex', gap: '0.75rem', padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
            <Skeleton width="40%" height="16px" />
            <Skeleton width="80px" height="14px" style={{ marginLeft: 'auto' }} />
            <Skeleton width="32px" height="32px" />
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div>
      <h1 className="admin-page-title">管理者管理</h1>

      {/* 招待リンク発行 */}
      <div className="admin-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h2 className="admin-card-title" style={{ margin: 0 }}>新規管理者を招待</h2>
          <button className="btn-primary" style={{ width: 'auto', padding: '0.5rem 0.9rem' }}
            onClick={generateInvite} disabled={generating}>
            <span className="icon icon-sm">add_link</span>
            {generating ? '生成中...' : '招待リンクを発行'}
          </button>
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-sub)' }}>
          発行されたリンクを新管理者に共有してください。リンクは24時間有効で、一度使用すると無効になります。
        </p>
        {generated && (
          <div className="invite-result">
            <div style={{ wordBreak: 'break-all', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              {generated.url}
            </div>
            <button className="btn-outline" style={{ width: 'auto', padding: '0.4rem 0.8rem' }}
              onClick={() => copyUrl(generated.url)}>
              <span className="icon icon-sm">content_copy</span> コピー
            </button>
          </div>
        )}
      </div>

      {/* 現在の管理者 */}
      <div className="admin-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
          <h2 className="admin-card-title" style={{ margin: 0 }}>現在の管理者 ({admins.length}名)</h2>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {a.isSuperAdmin && (
                      <span className="badge" style={{ background: '#fff7e0', color: '#b86200', border: '1px solid #f4c95a' }}>
                        <span className="icon icon-sm">star</span>スーパー管理者
                      </span>
                    )}
                    {me?.userId === a.userId && (
                      <span className="badge" style={{ background: 'var(--bg)', color: 'var(--text-sub)' }}>自分</span>
                    )}
                    <span>{a.displayName || '(名前なし)'}</span>
                  </div>
                </td>
                <td data-label="登録日" style={{ fontSize: '0.85rem', color: 'var(--text-sub)' }}>
                  {a.addedAt ? new Date(a.addedAt).toLocaleDateString('ja-JP') : '-'}
                </td>
                <td className="cell-actions">
                  <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'flex-end' }}>
                    {/* スーパー管理者だけが表示できる移譲ボタン */}
                    {me?.isSuperAdmin && !a.isSuperAdmin && me?.userId !== a.userId && (
                      <button
                        className="btn-icon"
                        onClick={() => transferSuper(a)}
                        title="スーパー管理者に移譲"
                        style={{ color: '#b86200', borderColor: '#f4c95a' }}
                      >
                        <span className="icon">star</span>
                      </button>
                    )}
                    {/* 削除ボタン */}
                    {!a.isSuperAdmin && me?.userId !== a.userId && (
                      <button className="btn-icon" onClick={() => removeAdmin(a)} title="削除">
                        <span className="icon">person_remove</span>
                      </button>
                    )}
                    {(a.isSuperAdmin && me?.userId === a.userId) && (
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-pale)' }}>—</span>
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
        <div className="admin-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
            <h2 className="admin-card-title" style={{ margin: 0 }}>発行済み招待</h2>
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
                    <td data-label="発行日" style={{ fontSize: '0.85rem' }}>
                      {inv.createdAt ? new Date(inv.createdAt).toLocaleString('ja-JP') : '-'}
                    </td>
                    <td data-label="有効期限" style={{ fontSize: '0.85rem' }}>
                      {inv.expiresAt ? new Date(inv.expiresAt).toLocaleString('ja-JP') : '-'}
                    </td>
                    <td data-label="状態">
                      {inv.used
                        ? <span className="badge confirmed">使用済み</span>
                        : expired
                          ? <span className="badge" style={{ background: 'var(--bg)', color: 'var(--text-pale)' }}>期限切れ</span>
                          : <span className="badge pending">有効</span>}
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
