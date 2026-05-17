import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { setAdminToken, getAdminToken } from './auth'

export default function Login() {
  const navigate = useNavigate()
  const [params] = useSearchParams()

  useEffect(() => {
    const token = params.get('token')
    const error = params.get('error')
    if (token) {
      setAdminToken(token)
      navigate('/admin', { replace: true })
      return
    }
    if (!error && getAdminToken()) {
      navigate('/admin', { replace: true })
    }
  }, [params, navigate])

  function handleLogin() {
    window.location.href = '/api/admin/auth/start'
  }

  const error = params.get('error')

  return (
    <div className="flex items-center justify-center min-h-dvh p-4 bg-bg">
      <div className="bg-surface border border-line rounded-2xl p-8 shadow-[var(--shadow-card)] max-w-[360px] w-full">
        <h1 className="text-[1.3rem] font-bold mb-2 text-center text-ink">管理画面</h1>
        <p className="text-[0.9rem] text-ink-sub text-center mb-6">LINE アカウントでログインしてください</p>
        {error && (
          <div className="banner-error">
            {error === 'not_admin'           ? '管理者として登録されていません'
            : error === 'invitation_expired' ? '招待リンクの有効期限が切れています'
            : error === 'invitation_used'    ? 'この招待リンクは既に使用されています'
            : error === 'invalid_invitation' ? '無効な招待リンクです'
            : error === 'invalid'            ? '認証に失敗しました'
            : 'ログインに失敗しました'}
          </div>
        )}
        <button
          onClick={handleLogin}
          className="w-full flex items-center justify-center gap-2 px-4 py-[0.9rem] bg-brand hover:bg-brand-dark text-white rounded-[10px] text-base font-semibold cursor-pointer transition-colors"
        >
          <span className="icon">login</span>
          LINE でログイン
        </button>
      </div>
    </div>
  )
}
