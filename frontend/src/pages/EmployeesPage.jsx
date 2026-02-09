import { useState, useEffect } from 'react'
import { API, apiFetch } from '../api'
import { formatQty } from '../components/EmployeeOutputBlock'

const MONTH_NAMES = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

function toISO(d) {
  return d.toISOString().slice(0, 10)
}

function formatDateLabel(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`
}

function getThisMonthRange() {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  return { from: toISO(new Date(y, m, 1)), to: toISO(new Date(y, m + 1, 0)) }
}

function getLastMonthRange() {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() - 1
  const from = new Date(y, m, 1)
  const to = new Date(y, m + 1, 0)
  return { from: toISO(from), to: toISO(to) }
}

function getLast30DaysRange() {
  const to = new Date()
  const from = new Date(to)
  from.setDate(from.getDate() - 29)
  return { from: toISO(from), to: toISO(to) }
}

export default function EmployeesPage() {
  const [employeeList, setEmployeeList] = useState([])
  const [employeeName, setEmployeeName] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [stats, setStats] = useState(null)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingStats, setLoadingStats] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    apiFetch(`${API}/employees`)
      .then((r) => setEmployeeList(r.employees || []))
      .catch(() => setEmployeeList([]))
      .finally(() => setLoadingList(false))
  }, [])

  const applyPreset = (preset) => {
    let range
    if (preset === 'this_month') range = getThisMonthRange()
    else if (preset === 'last_month') range = getLastMonthRange()
    else range = getLast30DaysRange()
    setDateFrom(range.from)
    setDateTo(range.to)
  }

  const loadStats = () => {
    const user = employeeName.trim()
    if (!user || !dateFrom || !dateTo) {
      setError('Выберите сотрудника и период')
      return
    }
    setError(null)
    setLoadingStats(true)
    setStats(null)
    const params = new URLSearchParams({ user, date_from: dateFrom, date_to: dateTo })
    apiFetch(`${API}/employees/stats?${params}`)
      .then((data) => {
        if (data.error) {
          setError(data.error)
          setStats(null)
        } else {
          setStats(data)
        }
      })
      .catch((e) => {
        setError(e.message || 'Ошибка загрузки')
        setStats(null)
      })
      .finally(() => setLoadingStats(false))
  }

  return (
    <div className="page employees-page">
      <h1>Сотрудники <span className="employee-output-beta" title="Данные могут быть не корректными">(бета-версия)</span></h1>

      <div className="employees-filters">
        <div className="employees-filter-row">
          <label className="employees-label">ФИО сотрудника</label>
          <input
            type="text"
            className="employees-input"
            list="employees-datalist"
            value={employeeName}
            onChange={(e) => setEmployeeName(e.target.value)}
            placeholder="Выберите из списка или введите ФИО"
            autoComplete="off"
          />
          <datalist id="employees-datalist">
            {employeeList.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>

        <div className="employees-filter-row">
          <label className="employees-label">Период</label>
          <div className="employees-period-row">
            <input
              type="date"
              className="employees-date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
            <span className="employees-date-sep">—</span>
            <input
              type="date"
              className="employees-date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
            <div className="employees-presets">
              <button type="button" className="employees-preset-btn" onClick={() => applyPreset('this_month')}>
                Этот месяц
              </button>
              <button type="button" className="employees-preset-btn" onClick={() => applyPreset('last_month')}>
                Прошлый месяц
              </button>
              <button type="button" className="employees-preset-btn" onClick={() => applyPreset('last_30')}>
                Последние 30 дней
              </button>
            </div>
          </div>
        </div>

        <div className="employees-filter-row">
          <span className="employees-label" />
          <button type="button" className="employees-submit-btn" onClick={loadStats} disabled={loadingStats || loadingList}>
            {loadingStats ? 'Загрузка...' : 'Показать'}
          </button>
        </div>
      </div>

      {error && <p className="employees-error">{error}</p>}

      {loadingStats && <p className="employees-loading">Загрузка...</p>}

      {stats && !loadingStats && (
        <div className="employees-report">
          <section className="employees-section">
            <h3>Даты выхода</h3>
            <div className="employees-dates-grid">
              {stats.work_dates?.length ? (
                stats.work_dates.map((d) => (
                  <span key={d} className="employees-date-chip">
                    {formatDateLabel(d)}
                  </span>
                ))
              ) : (
                <span>Нет данных</span>
              )}
            </div>
          </section>

          <section className="employees-section">
            <h3>Отработано дней</h3>
            <p className="employees-days-count">{stats.days_count ?? 0}</p>
          </section>

          <section className="employees-section">
            <h3>Участки</h3>
            {stats.departments?.length ? (
              <ul className="employees-dept-list">
                {stats.departments.map((d, i) => (
                  <li key={i}>
                    {d.production} — {d.department}
                  </li>
                ))}
              </ul>
            ) : (
              <p>Нет данных</p>
            )}
          </section>

          <section className="employees-section">
            <h3>Выпуск продукции (вид номенклатуры — наименование)</h3>
            {stats.products?.length ? (
              <table className="employees-products-table">
                <thead>
                  <tr>
                    <th>Вид номенклатуры</th>
                    <th>Наименование</th>
                    <th>Выработка</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.products.map((row, i) => (
                    <tr key={i}>
                      <td>{row.nomenclature_type}</td>
                      <td>{row.product_name}</td>
                      <td>{formatQty(row.output)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>Нет данных</p>
            )}
          </section>
        </div>
      )}

      {!stats && !loadingStats && !error && employeeName.trim() && dateFrom && dateTo && (
        <p className="employees-hint">Нажмите «Показать», чтобы загрузить отчёт.</p>
      )}
    </div>
  )
}
