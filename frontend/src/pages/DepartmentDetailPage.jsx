import { useState, useEffect } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { API, apiFetch } from '../api'

const monthNames = ['', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

export default function DepartmentDetailPage() {
  const [searchParams] = useSearchParams()
  const production = searchParams.get('production')
  const department = searchParams.get('department')
  const year = parseInt(searchParams.get('year') || new Date().getFullYear(), 10)
  const month = parseInt(searchParams.get('month') || new Date().getMonth() + 1, 10)

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!production || !department) {
      setError('Не указано подразделение')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const url = `${API}/department-daily/${year}/${month}?production=${encodeURIComponent(production)}&department=${encodeURIComponent(department)}`
    apiFetch(url)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [production, department, year, month])

  if (error) {
    return (
      <div className="page">
        <Link to="/" className="back-link">← Назад к аналитике</Link>
        <div className="error">{error}</div>
      </div>
    )
  }

  const chartData = data?.daily?.map(d => ({
    ...d,
    day: d.date.slice(8),
    fullDate: d.date,
  })) || []

  const unitLabel = data?.unit === 'кг' ? 'кг' : 'шт.'

  return (
    <div className="page department-detail-page">
      <Link to="/" className="back-link">← Назад к аналитике</Link>
      <div className="page-header">
        <h1>{department}</h1>
        <div className="dept-subtitle">
          {production} · {monthNames[month]} {year}
        </div>
      </div>

      {loading && <div className="loading">Загрузка...</div>}
      {!loading && data && (
        <>
          <div className="chart-block">
            <h2>Выпуск по дням</h2>
            {chartData.length > 0 ? (
              <div className="chart-container">
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                    <XAxis
                      dataKey="day"
                      tick={{ fontSize: 12, fill: '#94a3b8' }}
                      label={{ value: 'День месяца', position: 'insideBottom', offset: -5, fill: '#94a3b8' }}
                    />
                    <YAxis
                      tick={{ fontSize: 12, fill: '#94a3b8' }}
                      tickFormatter={v => v.toLocaleString('ru-RU')}
                      label={{ value: unitLabel, angle: -90, position: 'insideLeft', fill: '#94a3b8' }}
                    />
                    <Tooltip
                      formatter={(value) => [value.toLocaleString('ru-RU') + ' ' + unitLabel, 'Выпуск']}
                      labelFormatter={(_, items) => items?.[0]?.payload?.fullDate || ''}
                    />
                    <Bar dataKey="quantity" fill="#14b8a6" radius={[4, 4, 0, 0]} name="Выпуск" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="empty">Нет данных за выбранный месяц</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
