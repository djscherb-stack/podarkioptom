import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import MonthPage from './pages/MonthPage'
import DayPage from './pages/DayPage'
import DepartmentDetailPage from './pages/DepartmentDetailPage'
import UploadButton from './components/UploadButton'
import './App.css'

function DayNavLink(props) {
  const stored = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('analytics-day-date') : null
  const to = stored && /^\d{4}-\d{2}-\d{2}$/.test(stored) ? `/day?date=${stored}` : '/day'
  return <NavLink to={to} {...props} />
}

function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <nav className="nav">
          <NavLink to="/" end className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            По месяцу
          </NavLink>
          <DayNavLink className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            По дню
          </DayNavLink>
          <div className="nav-upload">
            <UploadButton />
          </div>
        </nav>
        <main className="main">
          <Routes>
            <Route path="/" element={<MonthPage />} />
            <Route path="/day" element={<DayPage />} />
            <Route path="/department" element={<DepartmentDetailPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App
