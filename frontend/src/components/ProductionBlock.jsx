import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LineChart, Line, YAxis, ResponsiveContainer, Tooltip } from 'recharts'
import { DeptEmployeeAnalytics } from './EmployeeOutputBlock'

function formatQty(val) {
  return typeof val === 'number' && val % 1 !== 0
    ? val.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 2 })
    : Number(val).toLocaleString('ru-RU')
}

function DeptComparison({ today, comparison, unitLabel, formatQty, labels = { current: 'сегодня', previous: 'вчера' }, unitsLabel, useUnits, secondaryMetric }) {
  const { yesterday, delta, delta_pct, types_today, types_yesterday, types_delta, subs, units_today, units_yesterday, units_delta } = comparison
  const t = useUnits ? (units_today ?? today) : today
  const y = useUnits ? (units_yesterday ?? yesterday) : yesterday
  const d = useUnits ? (units_delta ?? delta) : delta
  const maxVal = Math.max(t ?? 0, y ?? 0, 1)
  const tv = t ?? 0
  const yv = y ?? 0
  const todayColor = tv > yv ? '#1e8e3e' : tv < yv ? '#d93025' : '#9ca3af'
  const yesterdayColor = yv > tv ? '#1e8e3e' : yv < tv ? '#d93025' : '#9ca3af'
  return (
    <div className="dept-comparison">
      <div className="comp-chart">
        <div className="comp-bar-row">
          <span className="comp-bar-label">{labels.current}</span>
          <div className="comp-bar-wrap comp-bar-wrap-gray">
            <div className="comp-bar today" style={{ width: `${(tv / maxVal) * 100}%`, background: todayColor }} />
          </div>
          <span className="comp-bar-val">{formatQty(t ?? 0)}</span>
        </div>
        <div className="comp-bar-row">
          <span className="comp-bar-label">{labels.previous}</span>
          <div className="comp-bar-wrap comp-bar-wrap-gray">
            <div className="comp-bar yesterday" style={{ width: `${(yv / maxVal) * 100}%`, background: yesterdayColor }} />
          </div>
          <span className="comp-bar-val">{formatQty(y)}</span>
        </div>
      </div>
      <div className="comp-metrics">
        <div className={`comp-metric ${d >= 0 ? 'up' : 'down'}`}>
          <span className="comp-metric-label">Δ объём</span>
          <span>{d >= 0 ? '+' : ''}{formatQty(d)} {useUnits ? 'ед.' : unitLabel}</span>
          {!useUnits && delta_pct != null && delta_pct !== 0 && (
            <span className="comp-pct">({delta_pct >= 0 ? '+' : ''}{delta_pct}%)</span>
          )}
          {useUnits && units_delta != null && (
            <span className="comp-pct">
              ({y ? ((units_delta / y) * 100).toFixed(1) : '0'}%)
            </span>
          )}
        </div>
        {types_today != null && (types_today > 0 || (types_yesterday ?? 0) > 0) && (
          <div className={`comp-metric ${(types_delta ?? 0) >= 0 ? 'up' : 'down'}`}>
            <span className="comp-metric-label">видов</span>
            <span>{types_today} / {types_yesterday ?? 0}{(types_delta ?? 0) !== 0 && ` (Δ ${(types_delta ?? 0) >= 0 ? '+' : ''}${types_delta})`}</span>
          </div>
        )}
        {units_today != null && unitsLabel && !useUnits && (
          <div className={`comp-metric ${(units_delta ?? 0) >= 0 ? 'up' : 'down'}`}>
            <span className="comp-metric-label">{unitsLabel}</span>
            <span>{formatQty(units_today)} / {formatQty(units_yesterday ?? 0)}{(units_delta ?? 0) !== 0 && ` (Δ ${(units_delta ?? 0) >= 0 ? '+' : ''}${formatQty(units_delta)})`}</span>
          </div>
        )}
        {useUnits && secondaryMetric && (
          <div className={`comp-metric ${(secondaryMetric.delta ?? 0) >= 0 ? 'up' : 'down'}`}>
            <span className="comp-metric-label">выпуск (из 1С)</span>
            <span>{formatQty(secondaryMetric.today)} / {formatQty(secondaryMetric.yesterday)} {(secondaryMetric.delta ?? 0) !== 0 && ` (Δ ${(secondaryMetric.delta ?? 0) >= 0 ? '+' : ''}${formatQty(secondaryMetric.delta)} шт)`}</span>
          </div>
        )}
      </div>
      {subs?.length > 0 && (
        <div className="comp-subs">
          {subs.map(s => (
            <div key={s.name} className="comp-sub-row">
              <span>{s.name}</span>
              <span className="comp-sub-vals">{formatQty(s.today)} / {formatQty(s.yesterday)}</span>
              <span className={`comp-sub-delta ${s.delta >= 0 ? 'up' : 'down'}`}>
                {s.delta >= 0 ? '+' : ''}{formatQty(s.delta)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DeptAvg30d({ avg30d, vsAvgDelta, vsAvgPct, unitLabel, formatQty }) {
  if (avg30d == null) return null
  const up = (vsAvgDelta ?? 0) >= 0
  return (
    <div className="comp-avg-block">
      <span className="comp-avg-label">Ср. 30 дн:</span>
      <span className="comp-avg-val">{formatQty(avg30d)} {unitLabel}</span>
      {(vsAvgDelta != null && vsAvgDelta !== 0) && (
        <span className={`comp-avg-delta ${up ? 'up' : 'down'}`}>
          {up ? '+' : ''}{formatQty(vsAvgDelta)} ({vsAvgPct != null ? (vsAvgPct >= 0 ? '+' : '') + vsAvgPct + '%' : ''})
        </span>
      )}
    </div>
  )
}

const MONTH_NAMES = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

/** Группирует items по виду номенклатуры */
function groupByNomenclature(items) {
  const byType = {}
  for (const it of items || []) {
    const nt = it.nomenclature_type || it.product_name || '—'
    if (!byType[nt]) byType[nt] = { total: 0, items: [] }
    byType[nt].total += it.quantity
    byType[nt].items.push({ product_name: it.product_name || '—', quantity: it.quantity })
  }
  return Object.entries(byType).map(([type, { total, items: list }]) => ({ type, total, items: list }))
}

function NomDetail({ items, unitLabel, formatQty, deptUnit }) {
  const [expandedTypes, setExpandedTypes] = useState(new Set())
  const groups = groupByNomenclature(items)
  const toggle = (e, t) => {
    e.stopPropagation()
    setExpandedTypes(prev => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }
  const u = deptUnit || 'шт.'
  return (
    <div className="nom-detail" onClick={(e) => e.stopPropagation()}>
      <table className="nom-detail-table">
        <thead>
          <tr>
            <th>Вид номенклатуры</th>
            <th>Наименование</th>
            <th>Кол-во</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(({ type, total, items: list }) => (
            <React.Fragment key={type}>
              <tr className="nom-group-row">
                <td colSpan={2}>
                  <button
                    type="button"
                    className="nom-group-btn"
                    onClick={(e) => toggle(e, type)}
                  >
                    {expandedTypes.has(type) ? '▼' : '▶'} {type}
                  </button>
                </td>
                <td className="nom-group-total">{formatQty(total)} {u}</td>
              </tr>
              {expandedTypes.has(type) && list.map((item, i) => (
                <tr key={`${type}-${i}`} className="nom-item-row">
                  <td />
                  <td>{item.product_name}</td>
                  <td>{formatQty(item.quantity)} {u}</td>
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Последние 7 дней: день → виды номенклатуры → наименования */
function NomDetail7Days({ last7days, unitLabel, formatQty, deptUnit, useUnits }) {
  const [expandedDays, setExpandedDays] = useState(new Set())
  const [expandedTypes, setExpandedTypes] = useState({})
  const u = deptUnit || 'шт.'
  const toggleDay = (e, date) => {
    e.stopPropagation()
    setExpandedDays(prev => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }
  const toggleType = (e, dayDate, type) => {
    e.stopPropagation()
    const k = `${dayDate}\n${type}`
    setExpandedTypes(prev => ({ ...prev, [k]: !prev[k] }))
  }
  return (
    <div className="nom-detail nom-detail-7d" onClick={(e) => e.stopPropagation()}>
      <table className="nom-detail-table">
        <thead>
          <tr>
            <th>Дата</th>
            <th>Вид номенклатуры</th>
            <th>Наименование</th>
            <th>Кол-во</th>
          </tr>
        </thead>
        <tbody>
          {(last7days || []).map(({ date, total, total_units, nomenclature }) => {
            const [y, m, d] = (date || '').split('-').map(Number)
            const dateLabel = `${d} ${MONTH_NAMES[m - 1] || ''}`
            const dispTotal = useUnits && total_units != null ? total_units : total
            const dispUnit = useUnits && total_units != null ? 'ед.' : u
            const groups = groupByNomenclature(nomenclature)
            const dayExpanded = expandedDays.has(date)
            return (
              <React.Fragment key={date}>
                <tr className="nom-group-row nom-day-row">
                  <td>
                    <button
                      type="button"
                      className="nom-group-btn"
                      onClick={(e) => toggleDay(e, date)}
                    >
                      {dayExpanded ? '▼' : '▶'} {dateLabel}
                    </button>
                  </td>
                  <td colSpan={2} />
                  <td className="nom-group-total">{formatQty(dispTotal)} {dispUnit}</td>
                </tr>
                {dayExpanded && groups.map(({ type, total: typeTotal, items: list }) => {
                  const typeKey = `${date}\n${type}`
                  const typeExpanded = expandedTypes[typeKey]
                  return (
                    <React.Fragment key={typeKey}>
                      <tr className="nom-group-row nom-type-row">
                        <td />
                        <td colSpan={2}>
                          <button
                            type="button"
                            className="nom-group-btn"
                            onClick={(e) => toggleType(e, date, type)}
                          >
                            {typeExpanded ? '▼' : '▶'} {type}
                          </button>
                        </td>
                        <td className="nom-group-total">{formatQty(typeTotal)} {u}</td>
                      </tr>
                      {typeExpanded && list.map((item, i) => (
                        <tr key={`${typeKey}-${i}`} className="nom-item-row">
                          <td />
                          <td />
                          <td>{item.product_name}</td>
                          <td>{formatQty(item.quantity)} {u}</td>
                        </tr>
                      ))}
                    </React.Fragment>
                  )
                })}
              </React.Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function NomDetailByOp({ nomenclatureByOp, formatQty }) {
  const [expanded, setExpanded] = useState({})
  const toggle = (e, op, type) => {
    e.stopPropagation()
    const k = `${op}\n${type}`
    setExpanded(prev => ({ ...prev, [k]: !prev[k] }))
  }
  return (
    <div className="nom-detail nom-by-op" onClick={(e) => e.stopPropagation()}>
      {Object.entries(nomenclatureByOp || {}).map(([opName, items]) => {
        const groups = groupByNomenclature(items)
        return (
          <div key={opName} className="nom-op-block">
            <h4>{opName}</h4>
            <table className="nom-detail-table">
              <thead>
                <tr>
                  <th>Вид номенклатуры</th>
                  <th>Наименование</th>
                  <th>Кол-во</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(({ type, total, items: list }) => (
                  <React.Fragment key={type}>
                    <tr className="nom-group-row">
                      <td colSpan={2}>
                        <button
                          type="button"
                          className="nom-group-btn"
                          onClick={(e) => toggle(e, opName, type)}
                        >
                          {expanded[`${opName}\n${type}`] ? '▼' : '▶'} {type}
                        </button>
                      </td>
                      <td className="nom-group-total">{formatQty(total)} шт.</td>
                    </tr>
                    {expanded[`${opName}\n${type}`] && list.map((item, i) => (
                      <tr key={`${type}-${i}`} className="nom-item-row">
                        <td />
                        <td>{item.product_name}</td>
                        <td>{formatQty(item.quantity)} шт.</td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}

function DeptTrend({ trend, id, unitLabel, formatQty }) {
  if (!trend?.length) return null
  const data = trend.map(({ date, quantity }) => {
    const [y, m, d] = date.split('-').map(Number)
    const dateLabel = `${d} ${MONTH_NAMES[m - 1]}`
    return { date: date.slice(5), dateLabel, fullDate: date, q: quantity }
  })
  const qs = data.map(r => r.q)
  const minQ = Math.min(...qs)
  const maxQ = Math.max(...qs)
  const padding = Math.max((maxQ - minQ) * 0.08, 1)
  const domain = [minQ - padding, maxQ + padding]
  return (
    <div className="dept-trend">
      <ResponsiveContainer width="100%" height={36}>
        <LineChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
          <YAxis hide domain={domain} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null
              const p = payload[0].payload
              return (
                <div className="dept-trend-tooltip">
                  {p.dateLabel} · {formatQty(p.q)} {unitLabel}
                </div>
              )
            }}
            cursor={{ stroke: '#6b7280', strokeWidth: 1, strokeDasharray: '2 2' }}
          />
          <Line type="monotone" dataKey="q" stroke="#6b7280" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function UnitsVerify({ breakdown, formatQty }) {
  const [open, setOpen] = useState(false)
  if (!breakdown?.length) return null
  return (
    <div className="units-verify">
      <button type="button" className="btn-units-verify" onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}>
        {open ? '▼ Свернуть' : '▶ Проверка'}
      </button>
      {open && (
        <div className="units-verify-detail" onClick={(e) => e.stopPropagation()}>
          <table className="units-verify-table">
            <thead>
              <tr>
                <th>Вид номенклатуры</th>
                <th>Выпущено</th>
                <th>Коэфф.</th>
                <th>В ед. продукции</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((row, i) => (
                <tr key={i}>
                  <td>{row.nomenclature_type}</td>
                  <td>{formatQty(row.quantity)} шт</td>
                  <td>×{row.multiplier}</td>
                  <td>{formatQty(row.units)} ед.</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function ProductionBlock({ prodName, prodData, employeeOutput, expandedKey, onToggle, expanded7daysKey, onToggle7days, year, month, comparisonLabels }) {
  const navigate = useNavigate()
  const departments = prodData?.departments || []
  const byDeptMap = (employeeOutput?.by_department || []).reduce((acc, d) => {
    acc[`${d.production}-${d.department}`] = d
    return acc
  }, {})
  if (departments.length === 0) return null

  const handleCardClick = (e, dept) => {
    if (e.target.closest('.btn-expand') || e.target.closest('.btn-expand-7d') || e.target.closest('.nom-detail') || e.target.closest('.dept-subs') || e.target.closest('.employee-output-dept-analytics-wrap') || e.target.closest('.dept-card-employee-summary')) return
    if (year && month) {
      navigate(`/department?production=${encodeURIComponent(prodName)}&department=${encodeURIComponent(dept.name)}&year=${year}&month=${month}`)
    }
  }

  return (
    <section className="production-section">
      <h2 className="production-title">{prodName}</h2>
      <div className="dept-cards">
        {departments.map((dept) => {
          const key = `${prodName}-${dept.name}`
          const deptEmployeeOutput = byDeptMap[key]
          const hasEmployeeOutput = deptEmployeeOutput && ((deptEmployeeOutput.employee_count ?? 0) > 0 || (deptEmployeeOutput.employees?.length ?? 0) > 0)
          const isExpanded = expandedKey === key
          const is7daysExpanded = expanded7daysKey === key
          const hasDetail = (dept.nomenclature?.length > 0) || dept.subs?.length || dept.nomenclature_by_op || hasEmployeeOutput
          const has7days = (dept.last_7_days?.length || 0) > 0
          const unitLabel = dept.unit === 'кг' ? 'кг' : 'шт.'
          const hasProminentSubs = (prodName === 'ЧАЙ' && dept.name === 'Фасовочный цех Елино') || (prodName === 'ГРАВИРОВКА' && dept.name === 'Картон/Дерево Елино Гравировка')

          return (
            <div
              key={key}
              className={`dept-card ${dept.main ? 'dept-card-main' : ''} ${(isExpanded || is7daysExpanded) ? 'dept-card-expanded' : ''}`}
            >
              <div
                className={`dept-card-summary ${year && month && !isExpanded && !is7daysExpanded ? 'dept-card-clickable' : ''}`}
                onClick={year && month && !isExpanded && !is7daysExpanded ? (e) => handleCardClick(e, dept) : undefined}
                role={year && month && !isExpanded ? 'button' : undefined}
              >
                {dept.main && <span className="badge-main">Основной показатель</span>}
                <h3>{dept.name}</h3>
                {dept.total_units != null && prodName === 'ЧАЙ' && dept.name === 'Сборочный цех Елино' ? (
                  <>
                    <div className="dept-total">
                      {formatQty(dept.total_units)} ед.
                    </div>
                    <div className="dept-total-secondary">
                      выпуск: {formatQty(dept.total)} шт. (из 1С)
                    </div>
                    <div className="dept-total-units-wrap">
                      <UnitsVerify breakdown={dept.units_breakdown} formatQty={formatQty} />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="dept-total">
                      {formatQty(dept.total)} {unitLabel}
                    </div>
                    {dept.total_units != null && (
                      <div className="dept-total-units-wrap">
                        <div className="dept-total-units">в ед. продукции: {formatQty(dept.total_units)} шт.</div>
                        <UnitsVerify breakdown={dept.units_breakdown} formatQty={formatQty} />
                      </div>
                    )}
                  </>
                )}
                {hasProminentSubs && dept.subs?.length > 0 && (
                  <div className="dept-prominent-subs">
                    {dept.subs.map((s) => (
                      <div key={s.sub_name} className="dept-prominent-sub">
                        {s.sub_name}: {formatQty(s.total)} {s.unit || 'шт.'}
                      </div>
                    ))}
                  </div>
                )}
                {dept.comparison != null && (
                  <DeptComparison
                    today={dept.total_units != null && prodName === 'ЧАЙ' && dept.name === 'Сборочный цех Елино' ? dept.total_units : dept.total}
                    comparison={dept.comparison}
                    unitLabel={unitLabel}
                    formatQty={formatQty}
                    labels={comparisonLabels}
                    unitsLabel={dept.total_units != null && !(prodName === 'ЧАЙ' && dept.name === 'Сборочный цех Елино') ? 'ед. продукции' : null}
                    useUnits={dept.total_units != null && prodName === 'ЧАЙ' && dept.name === 'Сборочный цех Елино'}
                    secondaryMetric={dept.total_units != null && prodName === 'ЧАЙ' && dept.name === 'Сборочный цех Елино' ? { today: dept.total, yesterday: dept.comparison.yesterday, delta: dept.comparison.delta } : null}
                  />
                )}
                {dept.avg_30d != null && (
                  <DeptAvg30d
                    avg30d={dept.avg_30d}
                    vsAvgDelta={dept.vs_avg_delta}
                    vsAvgPct={dept.vs_avg_pct}
                    unitLabel={dept.total_units != null && prodName === 'ЧАЙ' && dept.name === 'Сборочный цех Елино' ? 'ед.' : unitLabel}
                    formatQty={formatQty}
                  />
                )}
                {dept.trend_30d?.length > 0 && (
                  <DeptTrend
                    trend={dept.trend_30d}
                    id={key}
                    unitLabel={dept.total_units != null && prodName === 'ЧАЙ' && dept.name === 'Сборочный цех Елино' ? 'ед.' : unitLabel}
                    formatQty={formatQty}
                  />
                )}
                {dept.subs?.length > 0 && !hasProminentSubs && (
                  <div className="dept-subs">
                    {dept.subs.map((s) => (
                      <div key={s.sub_name} className="sub-row">
                        {s.sub_name}: {formatQty(s.total)} {s.unit || 'шт.'}
                      </div>
                    ))}
                  </div>
                )}
                {hasEmployeeOutput && (
                  <div className="dept-card-employee-summary">
                    <div className="dept-card-employee-row">
                      <span>Сотрудников: <strong>{deptEmployeeOutput.employee_count ?? deptEmployeeOutput.employees?.length ?? 0}</strong></span>
                      {deptEmployeeOutput.employee_count_yesterday != null && (
                        <span className="dept-card-employee-vs">
                          {' '}(вчера {deptEmployeeOutput.employee_count_yesterday}
                          {(deptEmployeeOutput.employee_count ?? 0) - deptEmployeeOutput.employee_count_yesterday !== 0 && (
                            <span className={(deptEmployeeOutput.employee_count ?? 0) >= deptEmployeeOutput.employee_count_yesterday ? 'dept-card-delta-up' : 'dept-card-delta-down'}>
                              {' '}{(deptEmployeeOutput.employee_count ?? 0) - deptEmployeeOutput.employee_count_yesterday >= 0 ? '+' : ''}{(deptEmployeeOutput.employee_count ?? 0) - deptEmployeeOutput.employee_count_yesterday}
                            </span>
                          )})
                        </span>
                      )}
                    </div>
                    {deptEmployeeOutput.average_per_employee != null && (
                      <div className="dept-card-employee-row">
                        <span>Выработка на сотрудника: <strong>{formatQty(deptEmployeeOutput.average_per_employee)}</strong></span>
                        {deptEmployeeOutput.average_per_employee_yesterday != null && (
                          <span className="dept-card-employee-vs">
                            {' '}(вчера {formatQty(deptEmployeeOutput.average_per_employee_yesterday)}
                            {Math.abs((deptEmployeeOutput.average_per_employee ?? 0) - deptEmployeeOutput.average_per_employee_yesterday) > 1e-6 && (
                              <span className={(deptEmployeeOutput.average_per_employee ?? 0) >= deptEmployeeOutput.average_per_employee_yesterday ? 'dept-card-delta-up' : 'dept-card-delta-down'}>
                                {' '}{((deptEmployeeOutput.average_per_employee ?? 0) - deptEmployeeOutput.average_per_employee_yesterday) >= 0 ? '+' : ''}{formatQty((deptEmployeeOutput.average_per_employee ?? 0) - deptEmployeeOutput.average_per_employee_yesterday)}
                              </span>
                            )})
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="dept-card-detail">
                <div className="dept-detail-buttons">
                  {hasDetail && (
                    <button className="btn-expand" onClick={(e) => { e.stopPropagation(); onToggle(isExpanded ? null : key); onToggle7days?.(null) }}>
                      {isExpanded ? '▼ Свернуть' : '▶ Детализация'}
                    </button>
                  )}
                  {has7days && (
                    <button className="btn-expand btn-expand-7d" onClick={(e) => { e.stopPropagation(); onToggle7days?.(is7daysExpanded ? null : key); onToggle?.(null) }}>
                      {is7daysExpanded ? '▼ Свернуть' : '▶ Последние 7 дней'}
                    </button>
                  )}
                </div>
                {isExpanded && hasEmployeeOutput && (
                  <div className="dept-card-employee-analytics" onClick={(e) => e.stopPropagation()}>
                    <DeptEmployeeAnalytics item={deptEmployeeOutput} formatQty={formatQty} compact summaryOnCard />
                  </div>
                )}
                {isExpanded && dept.nomenclature?.length > 0 && (
                  <NomDetail items={dept.nomenclature} unitLabel={unitLabel} formatQty={formatQty} deptUnit={dept.unit} />
                )}
                {isExpanded && dept.nomenclature_by_op && (
                  <NomDetailByOp nomenclatureByOp={dept.nomenclature_by_op} formatQty={formatQty} />
                )}
                {is7daysExpanded && dept.last_7_days?.length > 0 && (
                  <NomDetail7Days
                    last7days={dept.last_7_days}
                    unitLabel={unitLabel}
                    formatQty={formatQty}
                    deptUnit={dept.unit}
                    useUnits={dept.total_units != null && prodName === 'ЧАЙ' && dept.name === 'Сборочный цех Елино'}
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
