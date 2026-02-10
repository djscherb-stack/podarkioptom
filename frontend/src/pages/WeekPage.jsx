import { useState, useEffect } from 'react'
import ProductionBlock from '../components/ProductionBlock'
import { API, apiFetch } from '../api'

export default function WeekPage() {
  const [weeks, setWeeks] = useState([])
  const [selectedYear, setSelectedYear] = useState(null)
  const [selectedWeek, setSelectedWeek] = useState(null)
  const [data, setData] = useState(null)
  const [expandedKey, setExpandedKey] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    apiFetch(`${API}/weeks`)
      .then(ws => {
        setWeeks(ws)
        if (ws.length > 0) {
          setSelectedYear(ws[0].year)
          setSelectedWeek(ws[0].week)
        } else {
          setData({ productions: {} })
          setLoading(false)
        }
      })
      .catch(e => {
        setError(e.message)
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (!selectedYear || !selectedWeek) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    apiFetch(`${API}/week/${selectedYear}/${selectedWeek}`)
      .then(raw => setData(raw || { productions: {} }))
      .catch(e => {
        setError(e.message)
        setData(null)
      })
      .finally(() => setLoading(false))
  }, [selectedYear, selectedWeek])

  const handleRefresh = () => {
    if (!selectedYear || !selectedWeek) return
    setLoading(true)
    setError(null)
    apiFetch(`${API}/week/${selectedYear}/${selectedWeek}`)
      .then(raw => setData(raw || { productions: {} }))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  if (error) return <div className="error">Ошибка: {error}</div>

  const productions = data?.productions || {}
  const hasData = Object.values(productions).some(p => p?.departments?.length > 0)

  const currentWeek = weeks.find(w => w.year === selectedYear && w.week === selectedWeek)
  const weekLabel = currentWeek ? currentWeek.label : ''

  return (
    <div className="page">
      <div className="page-header">
        <h1>Аналитика по неделе</h1>
        <div className="controls">
          <select
            value={selectedYear && selectedWeek ? `${selectedYear}-${selectedWeek}` : ''}
            onChange={e => {
              const [y, w] = e.target.value.split('-').map(Number)
              setSelectedYear(y)
              setSelectedWeek(w)
            }}
            disabled={weeks.length === 0}
          >
            <option value="">Выберите неделю</option>
            {weeks.map(({ year, week, label }) => (
              <option key={`${year}-${week}`} value={`${year}-${week}`}>
                {label}
              </option>
            ))}
          </select>
          <button onClick={handleRefresh} className="btn-refresh" title="Обновить данные">
            ⟳
          </button>
        </div>
      </div>

      {currentWeek && (
        <div className="page-subtitle">
          <span>Период: {currentWeek.start} — {currentWeek.end}</span>
        </div>
      )}

      {loading && <div className="loading">Загрузка...</div>}
      {!loading && (
        <>
          {Object.entries(productions).map(([name, prodData]) => (
            <ProductionBlock
              key={name}
              prodName={name}
              prodData={prodData}
              expandedKey={expandedKey}
              onToggle={setExpandedKey}
              comparisonLabels={{ current: 'эта неделя', previous: 'прошлая неделя' }}
            />
          ))}
          {!hasData && <div className="empty">Нет данных за выбранную неделю</div>}
        </>
      )}
    </div>
  )
}

