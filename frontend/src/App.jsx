import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import MonthPage from './pages/MonthPage'
import DayPage from './pages/DayPage'
import MonthsComparePage from './pages/MonthsComparePage'
import DepartmentDetailPage from './pages/DepartmentDetailPage'
import LoginPage from './pages/LoginPage'
import AdminPage from './pages/AdminPage'
import UploadButton from './components/UploadButton'
import { API, apiFetch, AuthError } from './api'
import './App.css'

function getYesterdayDateStr() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getYesterdayDayPath() {
  return `/day?date=${getYesterdayDateStr()}`
}

function getDayPath() {
  const stored = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('analytics-day-date') : null
  const dateStr = (stored && /^\d{4}-\d{2}-\d{2}$/.test(stored)) ? stored : getYesterdayDateStr()
  return `/day?date=${dateStr}`
}

function DayNavLink(props) {
  return <NavLink to={getDayPath()} {...props} />
}

function AppContent({ userInfo }) {
  const isAdmin = userInfo?.is_admin === true
  return (
    <div className="app">
      <aside className="app-sidebar">
        <div className="app-sidebar-nav">
          <NavLink to="/month" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            По месяцу
          </NavLink>
          <DayNavLink className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            По дню
          </DayNavLink>
          <NavLink to="/months" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            Аналитика по месяцам
          </NavLink>
          {isAdmin && (
            <NavLink to="/admin" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              Админ
            </NavLink>
          )}
        </div>
      </aside>
      <div className="app-main">
        <header className="app-header">
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <img src="/happy-brands-logo.png" alt="" className="site-logo" />
            <span className="site-title">Happy Brands</span>
          </div>
          <div className="app-header-right">
            <div className="nav-upload">
              <UploadButton />
            </div>
            <button
              type="button"
              className="btn-logout"
              onClick={async () => {
                try {
                  await fetch(`${API}/logout`, { method: 'POST', credentials: 'include' })
                } finally {
                  window.location.href = getYesterdayDayPath()
                }
              }}
            >
              Выйти
            </button>
          </div>
        </header>
        <main className="main">
          <Routes>
          <Route path="/" element={<Navigate to={getYesterdayDayPath()} replace />} />
          <Route path="/month" element={<MonthPage />} />
          <Route path="/day" element={<DayPage />} />
          <Route path="/months" element={<MonthsComparePage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/department" element={<DepartmentDetailPage />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

function App() {
  const [authStatus, setAuthStatus] = useState('pending')
  const [userInfo, setUserInfo] = useState(null)

  useEffect(() => {
    fetch(`${API}/me`, { credentials: 'include' })
      .then(async (r) => {
        if (r.ok) {
          const d = await r.json()
          setUserInfo({ username: d.username, is_admin: d.is_admin })
          setAuthStatus('ok')
        } else {
          setAuthStatus('fail')
        }
      })
      .catch(() => setAuthStatus('fail'))
  }, [])

  if (authStatus === 'pending') {
    return (
      <div className="login-page">
        <div style={{ position: 'absolute', top: '1.5rem', left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <img src="/happy-brands-logo.png" alt="" className="site-logo" />
          <span className="site-title site-header-login">Happy Brands</span>
        </div>
        <div className="login-box"><p>Загрузка...</p></div>
      </div>
    )
  }

  if (authStatus === 'fail') {
    return (
      <LoginPage
        onLogin={() => setAuthStatus('ok')}
      />
    )
  }

  return (
    <BrowserRouter>
      <AppContent userInfo={userInfo} />
    </BrowserRouter>
  )
}

export default App
