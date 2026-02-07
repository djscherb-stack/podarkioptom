import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import Calendar from '../components/Calendar'
import { ComparisonTable, DepartmentBlock, formatQty } from '../components/EmployeeOutputBlock'
import { API, apiFetch } from '../api'

const STORAGE_KEY = 'employee-output-date'
const MONTH_NAMES = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

function formatDate(d) {
  return d.toISOString().slice(0, 10)
}

function formatDateLabel(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`
}

function getDefaultDate() {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY)
    if (stored && /^\d{4}-\d{2}-\d{2}$/.test(stored)) return stored
  } catch (_) {}
  // По умолчанию — дата, за которой обычно есть данные выработки
  return '2026-02-05'
}

export default function EmployeeOutputPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlDate = searchParams.get('date')
  const [selectedDate, setSelectedDate] = useState(() =>
    urlDate || getDefaultDate()
  )
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [cache, setCache] = useState({})

  useEffect(() => {
    if (selectedDate) {
      if (urlDate !== selectedDate) setSearchParams({ date: selectedDate }, { replace: true })
      sessionStorage.setItem(STORAGE_KEY, selectedDate)
    }
  }, [selectedDate])

  useEffect(() => {
    if (!selectedDate) return
    if (cache[selectedDate]) {
      setData(cache[selectedDate])
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    apiFetch(`${API}/day/${selectedDate}`)
      .then((res) => {
        setData(res)
        setCache((prev) => {
          const next = { ...prev, [selectedDate]: res }
          const keys = Object.keys(next)
          if (keys.length > 10) delete next[keys[0]]
          return next
        })
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [selectedDate])

  const handleRefresh = () => {
    setLoading(true)
    apiFetch(`${API}/refresh`, { method: 'GET' })
      .then(() => apiFetch(`${API}/day/${selectedDate}`))
      .then((res) => {
        setData(res)
        setCache((prev) => ({ ...prev, [selectedDate]: res }))
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  const handleDateChange = (v) => {
    setSelectedDate(v)
    sessionStorage.setItem(STORAGE_KEY, v)
    setSearchParams({ date: v }, { replace: true })
  }

  if (error) return <div className="error">Ошибка: {error}</div>

  const employeeOutput = data?.employee_output || {}
  const byDepartment = employeeOutput.by_department || []
  const comparison = employeeOutput.comparison || []
  const hasData = byDepartment.length > 0 || comparison.length > 0

  return (
    <div className="page employee-output-page">
      <div className="day-page-header">
        <div className="day-page-title-row">
          <div className="day-page-title-with-note">
            <h1>Выработка сотрудников <span className="employee-output-beta">(бета-версия)</span></h1>
            <p className="employee-output-beta-note">Данные могут быть не корректными.</p>
          </div>
          <button onClick={handleRefresh} className="btn-refresh" title="Обновить данные">
            ⟳
          </button>
        </div>
        <div className="day-page-calendar-row">
          <Calendar value={selectedDate} onChange={handleDateChange} />
          <div className="day-page-selected">
            <span className="day-page-date-label">Выбрано: {formatDateLabel(selectedDate)}</span>
          </div>
        </div>
      </div>

      {loading && <div className="loading">Загрузка...</div>}
      {!loading && (
        <div className="employee-output-page-content">
          {hasData ? (
            <>
              <ComparisonTable comparison={comparison} />
              <div className="employee-output-by-dept">
                {byDepartment.map((item, i) => (
                  <DepartmentBlock
                    key={`${item.production}-${item.department}-${i}`}
                    item={item}
                    formatQty={formatQty}
                  />
                ))}
              </div>
            </>
          ) : (
            <p className="employee-output-empty">
              Нет данных по выработке за выбранный день. Нажмите <strong>⟳ Обновить данные</strong>, затем выберите дату, за которую загружен отчёт — например <strong>29</strong>, <strong>30</strong>, <strong>31 января</strong> или <strong>5 февраля 2026</strong>.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
