import React, { useState } from 'react'

export function formatQty(val) {
  return typeof val === 'number' && val % 1 !== 0
    ? val.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 2 })
    : Number(val).toLocaleString('ru-RU')
}

/** Сравнение: выпуск (из 1С) vs выработка по участкам */
export function ComparisonTable({ comparison }) {
  if (!comparison?.length) return null
  return (
    <div className="employee-output-comparison">
      <h4>Выпуск продукции и выработка по участкам</h4>
      <table className="employee-output-table">
        <thead>
          <tr>
            <th>Производство</th>
            <th>Участок</th>
            <th>Выпуск (1С)</th>
            <th>Выработка</th>
          </tr>
        </thead>
        <tbody>
          {comparison.map((row, i) => (
            <tr key={`${row.production}-${row.department}-${i}`}>
              <td>{row.production}</td>
              <td>{row.department}</td>
              <td>{formatQty(row.release)} {row.unit}</td>
              <td>{formatQty(row.output)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Детализация по сотруднику: вид номенклатуры → наименование */
export function EmployeeDetail({ employee, formatQty }) {
  const [expandedTypes, setExpandedTypes] = useState(new Set())
  const toggle = (e, type) => {
    e.stopPropagation()
    setExpandedTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }
  const byType = employee.by_nomenclature_type || []
  return (
    <div className="employee-output-employee-detail">
      {byType.map(({ nomenclature_type, total, items }) => (
        <div key={nomenclature_type} className="employee-output-nom-type">
          <button
            type="button"
            className="nom-group-btn"
            onClick={(e) => toggle(e, nomenclature_type)}
          >
            {expandedTypes.has(nomenclature_type) ? '▼' : '▶'} {nomenclature_type}
          </button>
          <span className="employee-output-nom-total">{formatQty(total)}</span>
          {expandedTypes.has(nomenclature_type) && items?.length > 0 && (
            <ul className="employee-output-items">
              {items.map((it, idx) => (
                <li key={idx}>
                  {it.product_name} — {formatQty(it.output)}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}

/** Участок: всего выработка + список сотрудников с раскрытием */
export function DepartmentBlock({ item, formatQty }) {
  const [expandedUsers, setExpandedUsers] = useState(new Set())
  const toggleUser = (e, user) => {
    e.stopPropagation()
    setExpandedUsers(prev => {
      const next = new Set(prev)
      if (next.has(user)) next.delete(user)
      else next.add(user)
      return next
    })
  }
  return (
    <div className="employee-output-dept">
      <h4 className="employee-output-dept-title">
        {item.production} — {item.department}
      </h4>
      <div className="employee-output-dept-total">
        Всего выработка: <strong>{formatQty(item.total_output)}</strong>
      </div>
      <table className="employee-output-table employee-output-employees">
        <thead>
          <tr>
            <th>Сотрудник</th>
            <th>Выработка</th>
          </tr>
        </thead>
        <tbody>
          {(item.employees || []).map((emp, i) => (
            <React.Fragment key={`${emp.user}-${i}`}>
              <tr>
                <td>
                  <button
                    type="button"
                    className="nom-group-btn"
                    onClick={(e) => toggleUser(e, emp.user)}
                  >
                    {expandedUsers.has(emp.user) ? '▼' : '▶'} {emp.user}
                  </button>
                </td>
                <td>{formatQty(emp.total)}</td>
              </tr>
              {expandedUsers.has(emp.user) && (
                <tr>
                  <td colSpan={2} className="employee-output-employee-cell">
                    <EmployeeDetail employee={emp} formatQty={formatQty} />
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function EmployeeOutputBlock({ employeeOutput, expanded, onToggle }) {
  const byDepartment = employeeOutput?.by_department || []
  const comparison = employeeOutput?.comparison || []
  const hasData = byDepartment.length > 0 || comparison.length > 0

  return (
    <section className="production-section employee-output-section" aria-label="Выработка сотрудников">
      <h2 className="production-title">Выработка сотрудников <span className="employee-output-beta" title="Данные могут быть не корректными">(бета)</span></h2>
      <div className="employee-output-header">
        <button
          type="button"
          className={`btn-expand employee-output-toggle ${expanded ? 'expanded' : ''}`}
          onClick={() => onToggle(!expanded)}
        >
          {expanded ? '▼ Свернуть' : '▶ Выработка сотрудников (бета)'}
        </button>
      </div>
      {expanded && (
        <div className="employee-output-content">
          {hasData ? (
            <>
              <ComparisonTable comparison={comparison} />
              <div className="employee-output-by-dept">
                {byDepartment.map((item, i) => (
                  <DepartmentBlock key={`${item.production}-${item.department}-${i}`} item={item} formatQty={formatQty} />
                ))}
              </div>
            </>
          ) : (
            <p className="employee-output-empty">
              Нет данных по выработке за выбранный день. Нажмите кнопку <strong>⟳ Обновить данные</strong> вверху страницы (если только что положили файл в <code>data/</code>), затем выберите дату, за которую загружен отчёт — например <strong>29</strong>, <strong>30</strong>, <strong>31 января</strong> или <strong>5 февраля 2026</strong>.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
