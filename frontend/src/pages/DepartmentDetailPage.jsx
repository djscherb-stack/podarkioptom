import { useState, useEffect } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { API, apiFetch } from '../api'

const monthNames = ['', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

function formatTooltipDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${monthNames[m]} ${y}`
}

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

  const quantities = chartData.map(d => d.quantity ?? 0)
  const maxQty = Math.max(...quantities, 1)
  const minQty = Math.min(...quantities.filter(q => q > 0), maxQty) || maxQty

  const getBarColor = (q) => {
    if (q <= 0) return '#9ca3af'
    if (q >= maxQty) return '#1e8e3e'
    if (maxQty > minQty && q <= minQty) return '#d93025'
    return '#9ca3af'
  }

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
              <div className="chart-container chart-container-gray">
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                    <defs>
                      <linearGradient id="chartBgGrad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#e5e7eb" />
                        <stop offset="100%" stopColor="#d1d5db" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#9ca3af" strokeOpacity={0.5} />
                    <XAxis
                      dataKey="day"
                      tick={{ fontSize: 12, fill: '#6b7280' }}
                      label={{ value: 'День месяца', position: 'insideBottom', offset: -5, fill: '#6b7280' }}
                    />
                    <YAxis
                      tick={{ fontSize: 12, fill: '#6b7280' }}
                      tickFormatter={v => v.toLocaleString('ru-RU')}
                      label={{ value: unitLabel, angle: -90, position: 'insideLeft', fill: '#6b7280' }}
                    />
                    <Tooltip
                      formatter={(value) => [value.toLocaleString('ru-RU') + ' ' + unitLabel, 'Выпуск']}
                      labelFormatter={(_, items) => formatTooltipDate(items?.[0]?.payload?.fullDate)}
                    />
                    <Bar dataKey="quantity" radius={[0, 0, 0, 0]} name="Выпуск">
                      {chartData.map((entry, i) => (
                        <Cell key={i} fill={getBarColor(entry.quantity)} />
                      ))}
                    </Bar>
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
