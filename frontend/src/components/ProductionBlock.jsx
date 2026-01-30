import { useNavigate } from 'react-router-dom'

function formatQty(val) {
  return typeof val === 'number' && val % 1 !== 0
    ? val.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 2 })
    : Number(val).toLocaleString('ru-RU')
}

function DeptComparison({ today, comparison, unitLabel, formatQty }) {
  const { yesterday, delta, delta_pct, types_today, types_yesterday, types_delta, subs } = comparison
  const maxVal = Math.max(today ?? 0, yesterday ?? 0, 1)
  return (
    <div className="dept-comparison">
      <div className="comp-chart">
        <div className="comp-bar-row">
          <span className="comp-bar-label">сегодня</span>
          <div className="comp-bar-wrap">
            <div className="comp-bar today" style={{ width: `${(today / maxVal) * 100}%` }} />
          </div>
          <span className="comp-bar-val">{formatQty(today ?? 0)}</span>
        </div>
        <div className="comp-bar-row">
          <span className="comp-bar-label">вчера</span>
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

export default function ProductionBlock({ prodName, prodData, expandedKey, onToggle, year, month }) {
  const navigate = useNavigate()
  const departments = prodData?.departments || []
  if (departments.length === 0) return null

  const handleCardClick = (e, dept) => {
    if (e.target.closest('.btn-expand') || e.target.closest('.nom-list') || e.target.closest('.nom-by-op') || e.target.closest('.dept-subs')) return
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
              className={`dept-card ${dept.main ? 'dept-card-main' : ''} ${year && month ? 'dept-card-clickable' : ''}`}
              onClick={year && month ? (e) => handleCardClick(e, dept) : undefined}
              role={year && month ? 'button' : undefined}
            >
              {dept.main && <span className="badge-main">Основной показатель</span>}
              <h3>{dept.name}</h3>
              <div className="dept-total">
                {formatQty(dept.total)} {unitLabel}
              </div>
              {dept.comparison != null && (
                <DeptComparison today={dept.total} comparison={dept.comparison} unitLabel={unitLabel} formatQty={formatQty} />
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
              {hasDetail && (
                <button className="btn-expand" onClick={() => onToggle(isExpanded ? null : key)}>
                  {isExpanded ? '▼ Свернуть' : '▶ Детализация'}
                </button>
              )}
              {isExpanded && dept.nomenclature?.length > 0 && (
                <div className="nom-list">
                  <table>
                    <thead>
                      <tr>
                        <th>Вид номенклатуры</th>
                        <th>Наименование</th>
                        <th>Кол-во</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dept.nomenclature.map(({ nomenclature_type, product_name, quantity, unit }, i) => (
                        <tr key={i}>
                          <td>{nomenclature_type}</td>
                          <td>{product_name || '—'}</td>
                          <td>{formatQty(quantity)} {unit || dept.unit || 'шт.'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {isExpanded && dept.nomenclature_by_op && (
                <div className="nom-by-op">
                  {Object.entries(dept.nomenclature_by_op).map(([opName, items]) => (
                    <div key={opName} className="nom-op-block">
                      <h4>{opName}</h4>
                      <table>
                        <thead>
                          <tr>
                            <th>Вид номенклатуры</th>
                            <th>Наименование</th>
                            <th>Кол-во</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map(({ nomenclature_type, product_name, quantity }, i) => (
                            <tr key={i}>
                              <td>{nomenclature_type}</td>
                              <td>{product_name || '—'}</td>
                              <td>{formatQty(quantity)} шт.</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
