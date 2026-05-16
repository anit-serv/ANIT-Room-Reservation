import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { setAdminToken, getAdminToken } from './auth'

export default function Login() {
  const navigate = useNavigate()
  const [params] = useSearchParams()

  useEffect(() => {
    // OAuth コールバック後のトークン受け取り
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
    <div className="login-screen">
      <div className="login-card">
        <h1 className="login-title">管理画面</h1>
        <p className="login-sub">LINE アカウントでログインしてください</p>
        {error && (
          <div className="banner error" style={{ marginBottom: '1rem' }}>
            {error === 'not_admin'
              ? '管理者として登録されていません'
              : error === 'invalid'
                ? '認証に失敗しました'
                : 'ログインに失敗しました'}
          </div>
        )}
        <button className="line-login-btn" onClick={handleLogin}>
          <span className="icon">login</span>
          LINE でログイン
        </button>
      </div>
    </div>
  )
}
