import { useState, useEffect } from 'react'
import ProductionBlock from '../components/ProductionBlock'
import { API, apiFetch } from '../api'

// Конвертация старого формата API (departments) в productions
function normalizeMonthData(raw) {
  if (!raw) return { productions: {} }
  if (raw.productions) return raw
  // Старый формат: { departments, nomenclature_by_department }
  if (raw.departments?.length > 0) {
    return {
      productions: {
        'Сводка': {
          departments: raw.departments.map(d => ({
            ...d,
            unit: 'шт.',
            nomenclature: raw.nomenclature_by_department?.[d.name] || []
          }))
        }
      }
    }
  }
  return { productions: {} }
}

export default function MonthPage() {
  const [months, setMonths] = useState([])
  const [selectedYear, setSelectedYear] = useState(null)
  const [selectedMonth, setSelectedMonth] = useState(null)
  const [data, setData] = useState(null)
  const [expandedKey, setExpandedKey] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const monthNames = ['', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

  useEffect(() => {
    apiFetch(`${API}/months`)
      .then(m => {
        setMonths(m)
        if (m.length > 0) {
          setSelectedYear(m[0].year)
          setSelectedMonth(m[0].month)
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
    if (!selectedYear || !selectedMonth) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    apiFetch(`${API}/month/${selectedYear}/${selectedMonth}`)
      .then(raw => setData(normalizeMonthData(raw)))
      .catch(e => {
        setError(e.message)
        setData(null)
      })
      .finally(() => setLoading(false))
  }, [selectedYear, selectedMonth])

  const handleRefresh = () => {
    apiFetch(`${API}/refresh`).then(() => {
      apiFetch(`${API}/months`).then(m => {
        setMonths(m)
        if (m.length > 0) {
          setSelectedYear(m[0].year)
          setSelectedMonth(m[0].month)
        }
      })
      if (selectedYear && selectedMonth) {
        apiFetch(`${API}/month/${selectedYear}/${selectedMonth}`)
          .then(raw => setData(normalizeMonthData(raw)))
      }
    }).catch(e => setError(e.message))
  }

  if (error) return <div className="error">Ошибка: {error}</div>

  const productions = data?.productions || {}
  const hasData = Object.values(productions).some(p => p?.departments?.length > 0)

  return (
    <div className="page">
      <div className="page-header">
        <h1>Аналитика по месяцу</h1>
        <div className="controls">
          <select
            value={selectedYear && selectedMonth ? `${selectedYear}-${selectedMonth}` : ''}
            onChange={e => {
              const [y, m] = e.target.value.split('-').map(Number)
              setSelectedYear(y)
              setSelectedMonth(m)
            }}
            disabled={months.length === 0}
          >
            <option value="">Выберите месяц</option>
            {months.map(({ year, month }) => (
              <option key={`${year}-${month}`} value={`${year}-${month}`}>
                {monthNames[month]} {year}
              </option>
            ))}
          </select>
          <button onClick={handleRefresh} className="btn-refresh" title="Обновить данные">
            ⟳
          </button>
        </div>
      </div>

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
              year={selectedYear}
              month={selectedMonth}
              comparisonLabels={{ current: 'этот месяц', previous: 'предыдущий' }}
            />
          ))}
          {!hasData && <div className="empty">Нет данных за выбранный месяц</div>}
        </>
      )}
    </div>
  )
}
