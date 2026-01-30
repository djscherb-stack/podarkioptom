import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import MonthPage from './pages/MonthPage'
import DayPage from './pages/DayPage'
import MonthsComparePage from './pages/MonthsComparePage'
import DepartmentDetailPage from './pages/DepartmentDetailPage'
import LoginPage from './pages/LoginPage'
import UploadButton from './components/UploadButton'
import { API, apiFetch, AuthError } from './api'
import './App.css'

function DayNavLink(props) {
  const stored = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('analytics-day-date') : null
  const to = stored && /^\d{4}-\d{2}-\d{2}$/.test(stored) ? `/day?date=${stored}` : '/day'
  return <NavLink to={to} {...props} />
}

function SiteLogo() {
  return (
    <header className="site-header">
      <img src="/happy-brands-logo.png" alt="Happy Brands" className="site-logo" />
      <span className="site-title">Happy Brands production analytics</span>
    </header>
  )
}

function AppContent() {
  return (
    <div className="app">
      <SiteLogo />
      <nav className="nav">
        <NavLink to="/" end className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
          По месяцу
        </NavLink>
        <DayNavLink className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
          По дню
        </DayNavLink>
        <NavLink to="/months" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
          Аналитика по месяцам
        </NavLink>
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
              window.location.href = '/'
            }
          }}
        >
          Выйти
        </button>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<MonthPage />} />
          <Route path="/day" element={<DayPage />} />
          <Route path="/months" element={<MonthsComparePage />} />
          <Route path="/department" element={<DepartmentDetailPage />} />
        </Routes>
      </main>
    </div>
  )
}

function App() {
  const [authStatus, setAuthStatus] = useState('pending') // pending | ok | fail

  useEffect(() => {
    fetch(`${API}/me`, { credentials: 'include' })
      .then((r) => {
        if (r.ok) setAuthStatus('ok')
        else setAuthStatus('fail')
      })
      .catch(() => setAuthStatus('fail'))
  }, [])

  if (authStatus === 'pending') {
    return (
      <div className="login-page">
        <header className="site-header site-header-login">
          <img src="/happy-brands-logo.png" alt="Happy Brands" className="site-logo" />
          <span className="site-title">Happy Brands production analytics</span>
        </header>
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
      <AppContent />
    </BrowserRouter>
  )
}

export default App
