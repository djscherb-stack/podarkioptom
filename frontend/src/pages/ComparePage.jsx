import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import Calendar from '../components/Calendar'
import { API, apiFetch } from '../api'

const STORAGE_KEY = 'analytics-day-date'
const MONTH_NAMES = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

function formatDate(d) {
  return d.toISOString().slice(0, 10)
}

function formatDateLabel(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`
}

function getStoredDate() {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY)
    if (stored && /^\d{4}-\d{2}-\d{2}$/.test(stored)) return stored
  } catch (_) {}
  return null
}

function formatQty(val) {
  return typeof val === 'number' && val % 1 !== 0
    ? val.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 2 })
    : Number(val).toLocaleString('ru-RU')
}

export default function ComparePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlDate = searchParams.get('date')
  const [selectedDate, setSelectedDate] = useState(() =>
    urlDate || getStoredDate() || formatDate(new Date())
  )
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (selectedDate) {
      if (urlDate !== selectedDate) setSearchParams({ date: selectedDate }, { replace: true })
      sessionStorage.setItem(STORAGE_KEY, selectedDate)
    }
  }, [selectedDate])

  useEffect(() => {
    if (selectedDate) {
      setLoading(true)
      setError(null)
      apiFetch(`${API}/day-compare/${selectedDate}`)
        .then(setData)
        .catch(e => setError(e.message))
        .finally(() => setLoading(false))
    }
  }, [selectedDate])

  const handleDateChange = (v) => {
    setSelectedDate(v)
    sessionStorage.setItem(STORAGE_KEY, v)
    setSearchParams({ date: v }, { replace: true })
  }

  if (error) return <div className="error">Ошибка: {error}</div>

  const compare = data?.compare || []
  const byProduction = {}
  for (const row of compare) {
    const p = row.production
    if (!byProduction[p]) byProduction[p] = []
    byProduction[p].push(row)
  }

  return (
    <div className="page compare-page">
      <div className="day-page-header">
        <div className="day-page-title-row">
          <h1>Сравнение: выпуск продукции и выработка сотрудников</h1>
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
        <div className="compare-content">
          <p className="compare-desc">
            Сравнение выпущенной продукции (первая таблица) и выработки по сканированиям сотрудников (вторая таблица) по участкам.
          </p>
          {['ЧАЙ', 'ГРАВИРОВКА', 'ЛЮМИНАРК'].map(prodName => (
            <section key={prodName} className="compare-section">
              <h2>{prodName}</h2>
              <table className="compare-table">
                <thead>
                  <tr>
                    <th>Участок</th>
                    <th>Выпуск продукции</th>
                    <th>Выработка сотрудников</th>
                    <th>Разница</th>
                  </tr>
                </thead>
                <tbody>
                  {(byProduction[prodName] || []).map((row, i) => (
                    <tr key={i}>
                      <td>{row.department}</td>
                      <td>{formatQty(row.product_total)} {row.unit}</td>
                      <td>{formatQty(row.employee_total)} {row.unit}</td>
                      <td className={row.diff === 0 ? 'diff-zero' : row.diff > 0 ? 'diff-positive' : 'diff-negative'}>
                        {row.diff === 0 ? '0' : (row.diff > 0 ? '+' : '') + formatQty(row.diff)} {row.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(byProduction[prodName] || []).length === 0 && (
                <p className="empty">Нет данных</p>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
