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

const GRAV_KARTON_DEPT = 'Картон/Дерево Елино Гравировка'
const ROLE_ORDER = ['Оператор станка ЧПУ', 'Сборщик']
const ROLE_LABELS = { 'Оператор станка ЧПУ': 'Оператор станка ЧПУ', 'Сборщик': 'Сборщики' }

function DeltaSpan({ today, yesterday, isPct = false }) {
  if (yesterday == null) return null
  const delta = today - yesterday
  const same = delta === 0
  const cls = same ? '' : delta > 0 ? 'employee-output-delta-plus' : 'employee-output-delta-minus'
  const sign = delta > 0 ? '+' : ''
  const text = isPct ? `${sign}${delta}%` : (delta % 1 !== 0 ? `${sign}${delta.toFixed(1)}` : `${sign}${delta}`)
  return (
    <span className={`employee-output-vs ${cls}`}>
      {' '}(вчера {isPct ? yesterday + '%' : formatQty(yesterday)}, {same ? '0' : text})
    </span>
  )
}

/** Участок: всего выработка + аналитика (кол-во сотрудников, средняя выработка) + по кнопке список сотрудников с % и раскрытием до номенклатуры. Для Картон/Дерево Елино Гравировка — группы Сборщики и Оператор станка ЧПУ */
export function DepartmentBlock({ item, formatQty }) {
  const [showEmployeesList, setShowEmployeesList] = useState(false)
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
  const employees = item.employees || []
  const nEmp = item.employee_count ?? employees.length
  const avgPerEmp = item.average_per_employee
  const avgYesterday = item.average_per_employee_yesterday
  const nEmpYesterday = item.employee_count_yesterday
  const isGravKarton = item.department === GRAV_KARTON_DEPT
  const byRole = isGravKarton && employees.some(e => e.role)
    ? ROLE_ORDER.map(role => ({
        role,
        label: ROLE_LABELS[role] || role,
        employees: employees.filter(e => e.role === role),
      })).filter(g => g.employees.length > 0)
    : null

  const renderEmployeeRows = (list) =>
    list.map((emp, i) => (
      <React.Fragment key={`${emp.user}-${i}`}>
        <tr>
          <td>
            <button
              type="button"
              className="nom-group-btn"
              onClick={(e) => toggleUser(e, emp.user)}
            >
              {expandedUsers.has(emp.user) ? '▼' : '▶'} {emp.user}
              {emp.share_pct != null && <span className="employee-output-share-pct"> — {emp.share_pct}%</span>}
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
    ))

  return (
    <div className="employee-output-dept">
      <h4 className="employee-output-dept-title">
        {item.production} — {item.department}
      </h4>
      <div className="employee-output-dept-total">
        Всего выработка: <strong>{formatQty(item.total_output)}</strong>
      </div>
      <div className="employee-output-dept-analytics">
        <div className="employee-output-analytics-row">
          <span>Количество сотрудников: <strong>{nEmp}</strong></span>
          <DeltaSpan today={nEmp} yesterday={nEmpYesterday} />
        </div>
        {avgPerEmp != null && (
          <div className="employee-output-analytics-row">
            <span>Средняя выработка на сотрудника: <strong>{formatQty(avgPerEmp)}</strong></span>
            {avgYesterday != null && (
              <DeltaSpan today={avgPerEmp} yesterday={avgYesterday} />
            )}
          </div>
        )}
        <button
          type="button"
          className="employee-output-expand-btn"
          onClick={() => setShowEmployeesList(s => !s)}
        >
          {showEmployeesList ? '▼ Свернуть список сотрудников' : '▶ Развернуть список сотрудников'}
        </button>
      </div>
      {showEmployeesList && (
        byRole ? (
          byRole.map(({ role, label, employees: roleEmployees }) => (
            <div key={role} className="employee-output-role-group">
              <h5 className="employee-output-role-title">{label}</h5>
              <table className="employee-output-table employee-output-employees">
                <thead>
                  <tr>
                    <th>Сотрудник</th>
                    <th>Выработка</th>
                  </tr>
                </thead>
                <tbody>{renderEmployeeRows(roleEmployees)}</tbody>
              </table>
            </div>
          ))
        ) : (
          <table className="employee-output-table employee-output-employees">
            <thead>
              <tr>
                <th>Сотрудник</th>
                <th>Выработка</th>
              </tr>
            </thead>
            <tbody>{renderEmployeeRows(employees)}</tbody>
          </table>
        )
      )}
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
