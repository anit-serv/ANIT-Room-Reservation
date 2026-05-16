import { useEffect, useState, useCallback } from 'react'
import { adminFetch } from '../auth'

type Admin = {
  userId: string
  displayName: string
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
  const [me, setMe]                   = useState<{ userId: string } | null>(null)
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

  if (loading) return <div className="splash"><div className="spinner" /></div>

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
                <td>
                  <div>{a.displayName || '(名前なし)'}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-pale)' }}>{a.userId}</div>
                </td>
                <td style={{ fontSize: '0.85rem', color: 'var(--text-sub)' }}>
                  {a.addedAt ? new Date(a.addedAt).toLocaleDateString('ja-JP') : '-'}
                </td>
                <td>
                  {me?.userId === a.userId ? (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-pale)' }}>自分</span>
                  ) : (
                    <button className="btn-icon" onClick={() => removeAdmin(a)}>
                      <span className="icon">person_remove</span>
                    </button>
                  )}
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
                    <td style={{ fontSize: '0.85rem' }}>
                      {inv.createdAt ? new Date(inv.createdAt).toLocaleString('ja-JP') : '-'}
                    </td>
                    <td style={{ fontSize: '0.85rem' }}>
                      {inv.expiresAt ? new Date(inv.expiresAt).toLocaleString('ja-JP') : '-'}
                    </td>
                    <td>
                      {inv.used
                        ? <span className="badge confirmed">使用済み</span>
                        : expired
                          ? <span className="badge" style={{ background: 'var(--bg)', color: 'var(--text-pale)' }}>期限切れ</span>
                          : <span className="badge pending">有効</span>}
                    </td>
                    <td>
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
