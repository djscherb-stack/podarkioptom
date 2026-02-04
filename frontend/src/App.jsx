import { useState, useEffect, useCallback } from 'react'
import { fetchTheme, applyTheme } from './theme'
import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom'
import MonthPage from './pages/MonthPage'
import DayPage from './pages/DayPage'
import MonthsComparePage from './pages/MonthsComparePage'
import DepartmentDetailPage from './pages/DepartmentDetailPage'
import LoginPage from './pages/LoginPage'
import AdminPage from './pages/AdminPage'
import UploadButton from './components/UploadButton'
import SyncButton from './components/SyncButton'
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

function AppContent({ userInfo, onRefreshUser }) {
  const isAdmin = userInfo?.is_admin === true
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    onRefreshUser?.()
  }, [location.pathname, onRefreshUser])

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  return (
    <div className="app">
      <div className={`app-sidebar-overlay ${mobileMenuOpen ? 'open' : ''}`} onClick={() => setMobileMenuOpen(false)} aria-hidden="true" />
      <aside className={`app-sidebar ${mobileMenuOpen ? 'open' : ''}`}>
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
          <span className="site-title">Производственная аналитика</span>
          <button type="button" className="btn-mobile-menu btn-mobile-menu-header" onClick={() => setMobileMenuOpen(o => !o)} aria-label="Меню">☰</button>
          <div className="app-header-right">
            <div className="nav-upload">
              <UploadButton />
              {isAdmin && <SyncButton />}
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
    fetchTheme().then(applyTheme)
  }, [])

  const fetchUserInfo = useCallback(() => {
    fetch(`${API}/me`, { credentials: 'include' })
      .then(async (r) => {
        if (r.ok) {
          const d = await r.json()
          setUserInfo({ username: d.username, is_admin: d.is_admin })
          setAuthStatus('ok')
        } else {
          setAuthStatus('fail')
          setUserInfo(null)
        }
      })
      .catch(() => {
        setAuthStatus('fail')
        setUserInfo(null)
      })
  }, [])

  useEffect(() => {
    fetchUserInfo()
  }, [])

  // Периодическая проверка сессии (чтобы is_admin не терялся)
  useEffect(() => {
    if (authStatus !== 'ok') return
    const id = setInterval(() => {
      fetch(`${API}/me`, { credentials: 'include' })
        .then(async (r) => {
          if (r.ok) {
            const d = await r.json()
            setUserInfo(prev => {
              const next = { username: d.username, is_admin: d.is_admin }
              if (prev?.is_admin !== next.is_admin || prev?.username !== next.username) return next
              return prev
            })
          }
        })
        .catch(() => {})
    }, 30000)
    return () => clearInterval(id)
  }, [authStatus])

  if (authStatus === 'pending') {
    return (
      <div className="login-page">
        <div style={{ position: 'absolute', top: '1.5rem', left: '50%', transform: 'translateX(-50%)' }}>
          <span className="site-title site-header-login">Производственная аналитика</span>
        </div>
        <div className="login-box"><p>Загрузка...</p></div>
      </div>
    )
  }

  if (authStatus === 'fail') {
    return (
      <LoginPage
        onLogin={() => fetchUserInfo()}
      />
    )
  }

  return (
    <BrowserRouter>
      <AppContent userInfo={userInfo} onRefreshUser={fetchUserInfo} />
    </BrowserRouter>
  )
}

export default App
