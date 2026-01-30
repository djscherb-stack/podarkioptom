import { useState, useEffect } from 'react'
import { API, apiFetch } from '../api'

function formatQty(val) {
  return typeof val === 'number' && val % 1 !== 0
    ? val.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 2 })
    : Number(val).toLocaleString('ru-RU')
}

export default function MonthsComparePage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    apiFetch(`${API}/months-comparison`)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (error) return <div className="error">Ошибка: {error}</div>
  if (loading) return <div className="loading">Загрузка...</div>
  if (!data?.months?.length) return <div className="empty">Нет данных</div>

  const { months, productions } = data

  return (
    <div className="page months-compare-page">
      <div className="page-header">
        <h1>Аналитика по месяцам</h1>
        <p className="months-compare-subtitle">Выпуск продукции по трём производствам</p>
      </div>
      <div className="months-compare-block">
        <table className="months-compare-table">
          <thead>
            <tr>
              <th className="months-compare-prod">Производство</th>
              {months.map((m, i) => (
                <th key={i} className="months-compare-month">{m.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {['ЧАЙ', 'ГРАВИРОВКА', 'ЛЮМИНАРК'].map(prod => (
              <tr key={prod}>
                <td className="months-compare-prod">{prod}</td>
                {(productions[prod] || []).map((item, i) => (
                  <td key={i} className="months-compare-val">
                    {formatQty(item?.value ?? 0)} {item?.unit || 'шт.'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
