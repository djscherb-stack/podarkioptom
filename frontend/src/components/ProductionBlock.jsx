import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts'

function formatQty(val) {
  return typeof val === 'number' && val % 1 !== 0
    ? val.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 2 })
    : Number(val).toLocaleString('ru-RU')
}

function DeptComparison({ today, comparison, unitLabel, formatQty, labels = { current: 'сегодня', previous: 'вчера' }, unitsLabel }) {
  const { yesterday, delta, delta_pct, types_today, types_yesterday, types_delta, subs, units_today, units_yesterday, units_delta } = comparison
  const maxVal = Math.max(today ?? 0, yesterday ?? 0, 1)
  return (
    <div className="dept-comparison">
      <div className="comp-chart">
        <div className="comp-bar-row">
          <span className="comp-bar-label">{labels.current}</span>
          <div className="comp-bar-wrap">
            <div className="comp-bar today" style={{ width: `${(today / maxVal) * 100}%` }} />
          </div>
          <span className="comp-bar-val">{formatQty(today ?? 0)}</span>
        </div>
        <div className="comp-bar-row">
          <span className="comp-bar-label">{labels.previous}</span>
          <div className="comp-bar-wrap">
            <div className="comp-bar yesterday" style={{ width: `${(yesterday / maxVal) * 100}%` }} />
          </div>
          <span className="comp-bar-val">{formatQty(yesterday)}</span>
        </div>
      </div>
      <div className="comp-metrics">
        <div className={`comp-metric ${delta >= 0 ? 'up' : 'down'}`}>
          <span className="comp-metric-label">Δ объём</span>
          <span>{delta >= 0 ? '+' : ''}{formatQty(delta)} {unitLabel}</span>
          {delta_pct != null && delta_pct !== 0 && (
            <span className="comp-pct">({delta_pct >= 0 ? '+' : ''}{delta_pct}%)</span>
          )}
        </div>
        {types_today != null && (types_today > 0 || (types_yesterday ?? 0) > 0) && (
          <div className={`comp-metric ${(types_delta ?? 0) >= 0 ? 'up' : 'down'}`}>
            <span className="comp-metric-label">видов</span>
            <span>{types_today} / {types_yesterday ?? 0}{(types_delta ?? 0) !== 0 && ` (Δ ${(types_delta ?? 0) >= 0 ? '+' : ''}${types_delta})`}</span>
          </div>
        )}
        {units_today != null && unitsLabel && (
          <div className={`comp-metric ${(units_delta ?? 0) >= 0 ? 'up' : 'down'}`}>
            <span className="comp-metric-label">{unitsLabel}</span>
            <span>{formatQty(units_today)} / {formatQty(units_yesterday ?? 0)}{(units_delta ?? 0) !== 0 && ` (Δ ${(units_delta ?? 0) >= 0 ? '+' : ''}${formatQty(units_delta)})`}</span>
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
  const gradId = `trendGrad-${(id || '').replace(/[^a-z0-9]/gi, '-')}`
  return (
    <div className="dept-trend">
      <ResponsiveContainer width="100%" height={36}>
        <AreaChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#14b8a6" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#14b8a6" stopOpacity={0} />
            </linearGradient>
          </defs>
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
            cursor={{ stroke: '#14b8a6', strokeWidth: 1, strokeDasharray: '2 2' }}
          />
          <Area type="monotone" dataKey="q" stroke="#14b8a6" strokeWidth={1} fill={`url(#${gradId})`} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function ProductionBlock({ prodName, prodData, expandedKey, onToggle, year, month, comparisonLabels }) {
  const navigate = useNavigate()
  const departments = prodData?.departments || []
  if (departments.length === 0) return null

  const handleCardClick = (e, dept) => {
    if (e.target.closest('.btn-expand') || e.target.closest('.nom-detail') || e.target.closest('.dept-subs')) return
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
          const isExpanded = expandedKey === key
          const hasDetail = (dept.nomenclature?.length > 0) || dept.subs?.length || dept.nomenclature_by_op
          const unitLabel = dept.unit === 'кг' ? 'кг' : 'шт.'

          return (
            <div
              key={key}
              className={`dept-card ${dept.main ? 'dept-card-main' : ''} ${isExpanded ? 'dept-card-expanded' : ''}`}
            >
              <div
                className={`dept-card-summary ${year && month && !isExpanded ? 'dept-card-clickable' : ''}`}
                onClick={year && month && !isExpanded ? (e) => handleCardClick(e, dept) : undefined}
                role={year && month && !isExpanded ? 'button' : undefined}
              >
                {dept.main && <span className="badge-main">Основной показатель</span>}
                <h3>{dept.name}</h3>
                <div className="dept-total">
                  {formatQty(dept.total)} {unitLabel}
                </div>
                {dept.total_units != null && (
                  <div className="dept-total-units">в ед. продукции: {formatQty(dept.total_units)} шт.</div>
                )}
                {dept.comparison != null && (
                  <DeptComparison
                    today={dept.total}
                    comparison={dept.comparison}
                    unitLabel={unitLabel}
                    formatQty={formatQty}
                    labels={comparisonLabels}
                    unitsLabel={dept.total_units != null ? 'ед. продукции' : null}
                  />
                )}
                {dept.avg_30d != null && (
                  <DeptAvg30d
                    avg30d={dept.avg_30d}
                    vsAvgDelta={dept.vs_avg_delta}
                    vsAvgPct={dept.vs_avg_pct}
                    unitLabel={unitLabel}
                    formatQty={formatQty}
                  />
                )}
                {dept.trend_30d?.length > 0 && (
                  <DeptTrend trend={dept.trend_30d} id={key} unitLabel={unitLabel} formatQty={formatQty} />
                )}
                {dept.subs?.length > 0 && (
                  <div className="dept-subs">
                    {dept.subs.map((s) => (
                      <div key={s.sub_name} className="sub-row">
                        {s.sub_name}: {formatQty(s.total)} {s.unit || 'шт.'}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="dept-card-detail">
                {hasDetail && (
                  <button className="btn-expand" onClick={(e) => { e.stopPropagation(); onToggle(isExpanded ? null : key) }}>
                    {isExpanded ? '▼ Свернуть' : '▶ Детализация'}
                  </button>
                )}
                {isExpanded && dept.nomenclature?.length > 0 && (
                  <NomDetail items={dept.nomenclature} unitLabel={unitLabel} formatQty={formatQty} deptUnit={dept.unit} />
                )}
                {isExpanded && dept.nomenclature_by_op && (
                  <NomDetailByOp nomenclatureByOp={dept.nomenclature_by_op} formatQty={formatQty} />
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
