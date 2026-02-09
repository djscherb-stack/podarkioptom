import { useState, useEffect } from 'react'
import { API, apiFetch } from '../api'
import { formatQty } from '../components/EmployeeOutputBlock'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'

const MONTH_NAMES = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

function toISO(d) {
  return d.toISOString().slice(0, 10)
}

function formatDateLabel(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`
}

function formatDateShort(iso) {
  if (!iso) return ''
  const [, , d] = iso.split('-')
  return `${d}`
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

const CHART_COLORS = ['#5b8fc9', '#6b9e7a', '#c9a85b', '#9e6b8f', '#6b8f9e', '#b86b6b', '#7a9bb8', '#8b7a9e']

export default function EmployeesPage() {
  const [employeeList, setEmployeeList] = useState([])
  const [departmentList, setDepartmentList] = useState([])
  const [employeeName, setEmployeeName] = useState('')
  const [selectedDept, setSelectedDept] = useState({ production: '', department: '' })
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [stats, setStats] = useState(null)
  const [deptStats, setDeptStats] = useState(null)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingStats, setLoadingStats] = useState(false)
  const [loadingDept, setLoadingDept] = useState(false)
  const [error, setError] = useState(null)
  const [errorDept, setErrorDept] = useState(null)
  const [yesterdaySummaryOpen, setYesterdaySummaryOpen] = useState(false)
  const [yesterdaySummary, setYesterdaySummary] = useState(null)
  const [loadingYesterday, setLoadingYesterday] = useState(false)

  useEffect(() => {
    apiFetch(`${API}/employees`).then((r) => setEmployeeList(r.employees || [])).catch(() => setEmployeeList([]))
    apiFetch(`${API}/departments`).then((r) => setDepartmentList(r.departments || [])).catch(() => setDepartmentList([]))
    setLoadingList(false)
  }, [])

  const applyPreset = (preset) => {
    const range = preset === 'this_month' ? getThisMonthRange() : preset === 'last_month' ? getLastMonthRange() : getLast30DaysRange()
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
        } else setStats(data)
      })
      .catch((e) => {
        setError(e.message || 'Ошибка загрузки')
        setStats(null)
      })
      .finally(() => setLoadingStats(false))
  }

  const loadDeptStats = () => {
    const { production, department } = selectedDept
    if (!production || !department || !dateFrom || !dateTo) {
      setErrorDept('Выберите участок и период')
      return
    }
    setErrorDept(null)
    setLoadingDept(true)
    setDeptStats(null)
    const params = new URLSearchParams({ production, department, date_from: dateFrom, date_to: dateTo })
    apiFetch(`${API}/departments/stats?${params}`)
      .then((data) => {
        if (data.error) {
          setErrorDept(data.error)
          setDeptStats(null)
        } else setDeptStats(data)
      })
      .catch((e) => {
        setErrorDept(e.message || 'Ошибка загрузки')
        setDeptStats(null)
      })
      .finally(() => setLoadingDept(false))
  }

  const deptOptionValue = selectedDept.production && selectedDept.department
    ? `${selectedDept.production} — ${selectedDept.department}`
    : ''

  const loadYesterdaySummary = () => {
    const now = new Date()
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    const dateStr = toISO(yesterday)
    setLoadingYesterday(true)
    setYesterdaySummary(null)
    apiFetch(`${API}/day/${dateStr}`)
      .then((data) => {
        const byDept = data?.employee_output?.by_department || []
        const byProduction = {}
        byDept.forEach((item) => {
          const p = item.production || '—'
          if (!byProduction[p]) {
            byProduction[p] = { production: p, employee_count: 0, total_output: 0 }
          }
          byProduction[p].employee_count += item.employee_count ?? 0
          byProduction[p].total_output += item.total_output ?? 0
        })
        const list = Object.values(byProduction)
          .filter((r) => r.employee_count > 0 || r.total_output > 0)
          .map((r) => ({
            ...r,
            output_per_employee: r.employee_count ? round2(r.total_output / r.employee_count) : 0,
            total_hours: r.employee_count * 12,
            output_per_hour: r.employee_count ? round2(r.total_output / (r.employee_count * 12)) : 0,
          }))
          .sort((a, b) => (b.total_output || 0) - (a.total_output || 0))
        setYesterdaySummary({ date: dateStr, list })
      })
      .catch(() => setYesterdaySummary({ date: dateStr, list: [], error: true }))
      .finally(() => setLoadingYesterday(false))
  }

  const toggleYesterdaySummary = () => {
    if (!yesterdaySummaryOpen) {
      if (!yesterdaySummary && !loadingYesterday) loadYesterdaySummary()
      setYesterdaySummaryOpen(true)
    } else {
      setYesterdaySummaryOpen(false)
    }
  }

  function round2(val) {
    return Math.round((val || 0) * 100) / 100
  }

  return (
    <div className="page employees-page">
      <h1>Сотрудники <span className="employee-output-beta" title="Данные могут быть не корректными">(бета-версия)</span></h1>

      {/* Общий выбор периода */}
      <div className="employees-filters employees-filters-shared">
        <div className="employees-filter-row">
          <label className="employees-label">Период</label>
          <div className="employees-period-row">
            <input type="date" className="employees-date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <span className="employees-date-sep">—</span>
            <input type="date" className="employees-date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            <div className="employees-presets">
              <button type="button" className="employees-preset-btn" onClick={() => applyPreset('this_month')}>Этот месяц</button>
              <button type="button" className="employees-preset-btn" onClick={() => applyPreset('last_month')}>Прошлый месяц</button>
              <button type="button" className="employees-preset-btn" onClick={() => applyPreset('last_30')}>Последние 30 дней</button>
            </div>
            <button
              type="button"
              className={`employees-yesterday-btn ${yesterdaySummaryOpen ? 'expanded' : ''}`}
              onClick={toggleYesterdaySummary}
            >
              {yesterdaySummaryOpen ? '▼ Сводка за вчера' : '▶ Сводка за вчера'}
            </button>
          </div>
        </div>
      </div>

      {yesterdaySummaryOpen && (
        <div className="employees-yesterday-summary">
          {loadingYesterday && <p className="employees-yesterday-loading">Загрузка…</p>}
          {!loadingYesterday && yesterdaySummary?.error && <p className="employees-error">Не удалось загрузить данные за вчера.</p>}
          {!loadingYesterday && yesterdaySummary && !yesterdaySummary.error && (
            <>
              <h3 className="employees-yesterday-title">Сводка за {formatDateLabel(yesterdaySummary.date)}</h3>
              {yesterdaySummary.list.length === 0 ? (
                <p className="employees-yesterday-empty">Нет данных по выработке за вчера.</p>
              ) : (
                <table className="employees-yesterday-table">
                  <thead>
                    <tr>
                      <th>Производство</th>
                      <th>Сотрудников</th>
                      <th>Выработка на сотрудника</th>
                      <th>Выработка в час</th>
                      <th>Всего выработка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {yesterdaySummary.list.map((row, i) => (
                      <tr key={row.production}>
                        <td>{row.production}</td>
                        <td>{row.employee_count}</td>
                        <td>{formatQty(row.output_per_employee)}</td>
                        <td>{formatQty(row.output_per_hour)}</td>
                        <td>{formatQty(row.total_output)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      )}

      {/* Блок: Сотрудник */}
      <section className="employees-block employees-block-person">
        <h2 className="employees-block-title">Аналитика по сотруднику</h2>
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
            <span className="employees-label" />
            <button type="button" className="employees-submit-btn" onClick={loadStats} disabled={loadingStats || loadingList}>
              {loadingStats ? 'Загрузка...' : 'Показать'}
            </button>
          </div>
        </div>
        {error && <p className="employees-error">{error}</p>}
        {stats && !loadingStats && (
          <div className="employees-report employees-report-with-charts">
            <div className="employees-kpi-row">
              <div className="employees-kpi-card">
                <span className="employees-kpi-label">Отработано дней</span>
                <span className="employees-kpi-value">{stats.days_count ?? 0}</span>
              </div>
              <div className="employees-kpi-card">
                <span className="employees-kpi-label">Участков</span>
                <span className="employees-kpi-value">{stats.departments?.length ?? 0}</span>
              </div>
            </div>
            {stats.work_dates?.length > 0 && (
              <div className="employees-chart-wrap">
                <h4>Даты выхода</h4>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={stats.work_dates.map((d) => ({ date: d, label: formatDateShort(d), full: formatDateLabel(d), count: 1 }))} margin={{ top: 8, right: 8, left: 8, bottom: 24 }}>
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis hide domain={[0, 1.2]} />
                    <Tooltip content={({ active, payload }) => (active && payload?.[0] ? <div className="employees-tooltip">{payload[0].payload.full}</div> : null)} />
                    <Bar dataKey="count" fill="#5b8fc9" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {stats.products?.length > 0 && (
              <div className="employees-chart-wrap">
                <h4>Выпуск по видам номенклатуры (топ-8)</h4>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart
                    layout="vertical"
                    data={stats.products.slice(0, 8).map((p) => ({ name: p.nomenclature_type.length > 25 ? p.nomenclature_type.slice(0, 24) + '…' : p.nomenclature_type, output: p.output, full: p.nomenclature_type }))}
                    margin={{ top: 4, right: 24, left: 4, bottom: 4 }}
                  >
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10 }} />
                    <Tooltip content={({ active, payload }) => (active && payload?.[0] ? <div className="employees-tooltip">{payload[0].payload.full}: {formatQty(payload[0].payload.output)}</div> : null)} />
                    <Bar dataKey="output" fill="#6b9e7a" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <section className="employees-section">
              <h3>Участки</h3>
              {stats.departments?.length ? (
                <ul className="employees-dept-list">
                  {stats.departments.map((d, i) => (
                    <li key={i}>{d.production} — {d.department}</li>
                  ))}
                </ul>
              ) : (
                <p>Нет данных</p>
              )}
            </section>
            <section className="employees-section">
              <h3>Выпуск продукции (вид — наименование)</h3>
              {stats.products?.length ? (
                <table className="employees-products-table">
                  <thead>
                    <tr><th>Вид номенклатуры</th><th>Наименование</th><th>Выработка</th></tr>
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
      </section>

      {/* Блок: Участки */}
      <section className="employees-block employees-block-dept">
        <h2 className="employees-block-title">Аналитика по участку</h2>
        <div className="employees-filters">
          <div className="employees-filter-row">
            <label className="employees-label">Участок</label>
            <select
              className="employees-select"
              value={deptOptionValue}
              onChange={(e) => {
                const v = e.target.value
                const found = departmentList.find((d) => `${d.production} — ${d.department}` === v)
                setSelectedDept(found ? { production: found.production, department: found.department } : { production: '', department: '' })
              }}
            >
              <option value="">Выберите участок</option>
              {departmentList.map((d, i) => (
                <option key={i} value={`${d.production} — ${d.department}`}>{d.production} — {d.department}</option>
              ))}
            </select>
          </div>
          <div className="employees-filter-row">
            <span className="employees-label" />
            <button type="button" className="employees-submit-btn" onClick={loadDeptStats} disabled={loadingDept}>
              {loadingDept ? 'Загрузка...' : 'Показать'}
            </button>
          </div>
        </div>
        {errorDept && <p className="employees-error">{errorDept}</p>}
        {deptStats && !loadingDept && (
          <div className="employees-report employees-report-with-charts">
            <div className="employees-kpi-row employees-kpi-row-dept">
              <div className="employees-kpi-card">
                <span className="employees-kpi-label">Сотрудников на участке</span>
                <span className="employees-kpi-value">{deptStats.employees?.length ?? 0}</span>
              </div>
              <div className="employees-kpi-card">
                <span className="employees-kpi-label">Рабочих часов</span>
                <span className="employees-kpi-value">{deptStats.total_hours ?? 0} ч</span>
              </div>
              <div className="employees-kpi-card">
                <span className="employees-kpi-label">Средний выпуск в час</span>
                <span className="employees-kpi-value">{formatQty(deptStats.avg_per_hour)}</span>
              </div>
              <div className="employees-kpi-card">
                <span className="employees-kpi-label">Средний выпуск в смену (12 ч)</span>
                <span className="employees-kpi-value">{formatQty(deptStats.avg_per_shift)}</span>
              </div>
            </div>
            {deptStats.days_breakdown?.length > 0 && (
              <div className="employees-chart-wrap">
                <h4>Выход сотрудников по дням</h4>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={deptStats.days_breakdown.map((d) => ({ ...d, label: formatDateShort(d.date), full: formatDateLabel(d.date) }))} margin={{ top: 8, right: 8, left: 8, bottom: 24 }}>
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip content={({ active, payload }) => (active && payload?.[0] ? <div className="employees-tooltip">{payload[0].payload.full}: {payload[0].payload.employees_count} чел.</div> : null)} />
                    <Bar dataKey="employees_count" name="Сотрудников" fill="#5b8fc9" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <section className="employees-section">
              <h3>Список сотрудников на участке</h3>
              {deptStats.employees?.length ? (
                <ul className="employees-dept-list">
                  {deptStats.employees.map((name, i) => (
                    <li key={i}>{name}</li>
                  ))}
                </ul>
              ) : (
                <p>Нет данных</p>
              )}
            </section>
            <section className="employees-section">
              <h3>Всего выпущено (вид — наименование)</h3>
              {deptStats.products?.length ? (
                <>
                  <div className="employees-chart-wrap">
                    <h4>Топ продукции по выработке</h4>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie
                          data={deptStats.products.slice(0, 6).map((p, i) => ({ name: (p.product_name || p.nomenclature_type).slice(0, 20) + (p.product_name?.length > 20 ? '…' : ''), value: p.output, full: `${p.nomenclature_type}: ${p.product_name}` }))}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={70}
                          label={({ name }) => name}
                        >
                          {deptStats.products.slice(0, 6).map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v) => formatQty(v)} content={({ active, payload }) => (active && payload?.[0] ? <div className="employees-tooltip">{payload[0].payload.full}: {formatQty(payload[0].payload.value)}</div> : null)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <table className="employees-products-table">
                    <thead>
                      <tr><th>Вид номенклатуры</th><th>Наименование</th><th>Выработка</th></tr>
                    </thead>
                    <tbody>
                      {deptStats.products.map((row, i) => (
                        <tr key={i}>
                          <td>{row.nomenclature_type}</td>
                          <td>{row.product_name}</td>
                          <td>{formatQty(row.output)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : (
                <p>Нет данных</p>
              )}
            </section>
          </div>
        )}
      </section>
    </div>
  )
}
