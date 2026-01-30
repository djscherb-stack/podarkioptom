import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import ProductionBlock from '../components/ProductionBlock'
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

export default function DayPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlDate = searchParams.get('date')
  const [selectedDate, setSelectedDate] = useState(() =>
    urlDate || getStoredDate() || formatDate(new Date())
  )
  const [data, setData] = useState(null)
  const [expandedKey, setExpandedKey] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Синхронизация с URL и sessionStorage при смене даты
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
      apiFetch(`${API}/day/${selectedDate}`)
        .then(setData)
        .catch(e => setError(e.message))
        .finally(() => setLoading(false))
    }
  }, [selectedDate])

  const handleRefresh = () => {
    apiFetch(`${API}/refresh`, { method: 'GET' }).then(() => {
      apiFetch(`${API}/day/${selectedDate}`).then(setData)
    }).catch(e => setError(e.message))
  }

  if (error) return <div className="error">Ошибка: {error}</div>

  const productions = data?.productions || {}
  const hasData = Object.values(productions).some(p => p?.departments?.length > 0)

  const handleDateChange = (v) => {
    setSelectedDate(v)
    sessionStorage.setItem(STORAGE_KEY, v)
    setSearchParams({ date: v }, { replace: true })
  }

  return (
    <div className="page day-page">
      <div className="day-page-header">
        <div className="day-page-title-row">
          <h1>Аналитика по дню</h1>
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
        <>
          {(() => {
            const d = selectedDate ? new Date(selectedDate + 'T12:00:00') : null
            const year = d?.getFullYear()
            const month = d ? d.getMonth() + 1 : null
            return (
              <>
                <ProductionBlock prodName="ЧАЙ" prodData={productions.ЧАЙ} expandedKey={expandedKey} onToggle={setExpandedKey} year={year} month={month} />
                <ProductionBlock prodName="ГРАВИРОВКА" prodData={productions.ГРАВИРОВКА} expandedKey={expandedKey} onToggle={setExpandedKey} year={year} month={month} />
                <ProductionBlock prodName="ЛЮМИНАРК" prodData={productions.ЛЮМИНАРК} expandedKey={expandedKey} onToggle={setExpandedKey} year={year} month={month} />
              </>
            )
          })()}
          {!hasData && <div className="empty">Нет данных за выбранный день</div>}
        </>
      )}
    </div>
  )
}
