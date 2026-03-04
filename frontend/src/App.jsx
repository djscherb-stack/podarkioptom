import { useState, useEffect, useCallback } from 'react'
import { fetchTheme, applyTheme } from './theme'
import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom'
import MonthPage from './pages/MonthPage'
import DayPage from './pages/DayPage'
import WeekPage from './pages/WeekPage'
import EmployeeOutputPage from './pages/EmployeeOutputPage'
import EmployeesPage from './pages/EmployeesPage'
import MonthsComparePage from './pages/MonthsComparePage'
import DepartmentDetailPage from './pages/DepartmentDetailPage'
import DisassemblyReturnsPage from './pages/DisassemblyReturnsPage'
import DisassemblyNomenclaturePage from './pages/DisassemblyNomenclaturePage'
import CostCheckPage from './pages/CostCheckPage'
import LoginPage from './pages/LoginPage'
import AdminPage from './pages/AdminPage'
import WorkforcePage from './pages/WorkforcePage'
import ProductionDashboardPage from './pages/ProductionDashboardPage'
import { API } from './api'
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
  const hasWorkforceAccess = userInfo?.schedule_role != null &&
    userInfo?.schedule_role !== 'none' &&
    userInfo?.schedule_role !== null
  const hasDashboardAccess = isAdmin || (
    hasWorkforceAccess &&
    (userInfo?.schedule_production === 'engraving' || userInfo?.schedule_production === 'all')
  )
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    onRefreshUser?.()
  }, [location.pathname, onRefreshUser])

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  const canShowNav = (key) => !userInfo?.nav_items || userInfo.nav_items.includes(key)

  return (
    <div className="app">
      <div className={`app-sidebar-overlay ${mobileMenuOpen ? 'open' : ''}`} onClick={() => setMobileMenuOpen(false)} aria-hidden="true" />
      <aside className={`app-sidebar ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="app-sidebar-nav">
          {canShowNav('month') && (
            <NavLink to="/month" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              По месяцу
            </NavLink>
          )}
          {canShowNav('day') && (
            <DayNavLink className={({ isActive }) => `nav-link nav-link-main ${isActive ? 'active' : ''}`.trim()}>
              По дню
            </DayNavLink>
          )}
          {canShowNav('week') && (
            <NavLink to="/week" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              По неделе
            </NavLink>
          )}
          {canShowNav('months') && (
            <NavLink to="/months" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              Аналитика по месяцам
            </NavLink>
          )}
          {canShowNav('employee_output') && (
            <NavLink to="/employee-output" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} title="Данные могут быть не корректными">
              Выработка сотрудников <span className="nav-beta">(бета)</span>
            </NavLink>
          )}
          {canShowNav('employees') && (
            <NavLink to="/employees" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} title="Данные могут быть не корректными">
              Сотрудники <span className="nav-beta">(бета)</span>
            </NavLink>
          )}
          {canShowNav('disassembly') && (
            <NavLink to="/disassembly" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              Разборка возвратов
            </NavLink>
          )}
          {canShowNav('disassembly_nomenclature') && (
            <NavLink to="/disassembly-nomenclature" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              Номенклатура разборки
            </NavLink>
          )}
          {canShowNav('cost_check') && (
            <NavLink to="/cost-check" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              Проверка стоимости
            </NavLink>
          )}
          {hasDashboardAccess && (isAdmin || canShowNav('production_dashboard')) && (
            <NavLink to="/production-dashboard" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              Панель производства
            </NavLink>
          )}
          {hasWorkforceAccess && canShowNav('workforce') && (
            <NavLink to="/workforce" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              Графики и табели
            </NavLink>
          )}
          {isAdmin && (
            <NavLink to="/admin" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              Админ
            </NavLink>
          )}
        </div>
      </aside>
      <div className="app-main">
        <header className="app-header">
          <button type="button" className="btn-mobile-menu btn-mobile-menu-header" onClick={() => setMobileMenuOpen(o => !o)} aria-label="Меню">☰</button>
          <span className="site-title">Производственная аналитика</span>
          <div className="app-header-right">
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
          <Route path="/day" element={<DayPage userInfo={userInfo} />} />
          <Route path="/week" element={<WeekPage userInfo={userInfo} />} />
          <Route path="/employee-output" element={<EmployeeOutputPage />} />
          <Route path="/employees" element={<EmployeesPage />} />
          <Route path="/months" element={<MonthsComparePage />} />
          <Route path="/disassembly" element={<DisassemblyReturnsPage />} />
          <Route path="/disassembly-nomenclature" element={<DisassemblyNomenclaturePage />} />
          <Route path="/cost-check" element={<CostCheckPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/department" element={<DepartmentDetailPage />} />
          <Route path="/workforce" element={<WorkforcePage userInfo={userInfo} />} />
          <Route path="/production-dashboard" element={<ProductionDashboardPage userInfo={userInfo} />} />
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
          setUserInfo({ username: d.username, is_admin: d.is_admin, schedule_role: d.schedule_role, schedule_production: d.schedule_production, schedule_full_name: d.schedule_full_name, nav_items: d.nav_items })
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
              const next = { username: d.username, is_admin: d.is_admin, schedule_role: d.schedule_role, schedule_production: d.schedule_production, schedule_full_name: d.schedule_full_name, nav_items: d.nav_items }
              if (JSON.stringify(prev) !== JSON.stringify(next)) return next
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
