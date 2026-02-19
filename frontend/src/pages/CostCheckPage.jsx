import { useState, useEffect, useCallback } from 'react'
import { API, apiFetch } from '../api'

const WAKING_MSG = 'Сервер загружается. Подождите минуту и обновите страницу.'

export default function CostCheckPage() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchList = useCallback(() => {
    setLoading(true)
    setError(null)
    apiFetch(`${API}/disassembly/missing-prices`)
      .then((res) => {
        setItems(res?.items ?? [])
        if (res?.error) setError(res.error)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  return (
    <div className="page">
      <div className="page-header">
        <h1>Проверка стоимости</h1>
        <div className="controls">
          <button type="button" className="btn-refresh" onClick={fetchList} title="Обновить">
            ⟳
          </button>
        </div>
      </div>

      <p className="page-description">
        Номенклатура из данных разборки, по которой не загружена себестоимость (нет в файле «цена поступления номенклатуры.xlsx»). Добавьте цены в прайс и положите файл в папку данных, чтобы в аналитике считалась стоимость.
      </p>

      {error && (
        <div className="error">
          Ошибка: {error}
          {error === WAKING_MSG && (
            <p className="cost-check-hint">Проверьте, что бэкенд запущен (например, <code>./run-site.sh</code> или сервер на порту 8000). Затем нажмите «Обновить».</p>
          )}
        </div>
      )}
      {loading && (
        <div className="cost-check-loading">
          <div className="cost-check-progress-wrap">
            <div className="cost-check-progress" role="progressbar" aria-valuetext="Загрузка списка" />
          </div>
          <span className="cost-check-loading-text">Загрузка списка позиций без стоимости…</span>
        </div>
      )}

      {!loading && !error && (
        <div className="cost-check-wrap">
          {items.length === 0 ? (
            <p className="cost-check-ok">По всей номенклатуре разборки загружена себестоимость.</p>
          ) : (
            <>
              <p className="cost-check-count">Найдено позиций без цены: {items.length}</p>
              <table className="cost-check-table">
                <thead>
                  <tr>
                    <th>Наименование (нет в прайсе)</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((name, i) => (
                    <tr key={i}>
                      <td>{name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  )
}
