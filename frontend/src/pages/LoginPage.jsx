import { useState } from 'react'

const API = '/api'

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const r = await fetch(`${API}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      })
      const data = r.ok ? {} : await r.json().catch(() => ({}))
      if (r.ok) {
        onLogin?.()
      } else {
        setError(data.error || 'Ошибка входа')
      }
    } catch (err) {
      setError(err.message || 'Ошибка соединения')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <header className="site-header site-header-login">
        <span className="site-title">Производственная аналитика</span>
      </header>
      <div className="login-box">
        <h1>Аналитика выпуска</h1>
        <p className="login-subtitle">Введите логин и пароль</p>
        <form onSubmit={handleSubmit} className="login-form">
          <input
            type="text"
            placeholder="Логин"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            disabled={loading}
          />
          <input
            type="password"
            placeholder="Пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={loading}
          />
          {error && <div className="login-error">{error}</div>}
          <button type="submit" disabled={loading} className="login-btn">
            {loading ? 'Вход...' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  )
}
