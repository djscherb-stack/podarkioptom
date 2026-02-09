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
          {comparison.map((row, i) => {
            const release = Number(row.release)
            const output = Number(row.output)
            const mismatch = !Number.isNaN(release) && !Number.isNaN(output) && Math.abs(release - output) > 1e-6
            return (
              <tr key={`${row.production}-${row.department}-${i}`} className={mismatch ? 'employee-output-comparison-mismatch' : ''}>
                <td>{row.production}</td>
                <td>{row.department}</td>
                <td>{formatQty(row.release)} {row.unit}</td>
                <td>{formatQty(row.output)}</td>
              </tr>
            )
          })}
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

/** Весёлые названия для бригад (одинаковая выработка у нескольких человек) */
const BRIGADE_NAMES = [
  'Весёлые молотки', 'Бригада удачи', 'Огурцы-трудяги', 'Команда мечты', 'Звёзды сцены',
  'Дружные винтики', 'Светлячки', 'Горячие пирожки', 'Быстрые ракеты', 'Ударники поля',
  'Ловкие ручки', 'Тигры труда', 'Пчёлки-труженицы', 'Орлы и соколы', 'Весёлая семейка',
  'Крепкий орешек', 'Девятый вал', 'Огонь и вода', 'Смелые капитаны', 'Золотые руки',
]

/** Уникальное название бригады по индексу (всегда разное). */
function getBrigadeName(index) {
  const n = BRIGADE_NAMES.length
  if (index < n) return BRIGADE_NAMES[index]
  return `${BRIGADE_NAMES[index % n]} №${Math.floor(index / n) + 1}`
}

/** Группирует сотрудников: одинаковую выработку (2+) → бригада, иначе одиночка.
 * startBrigadeIndex — глобальный счётчик для уникальных названий. Возвращает { groups, nextBrigadeIndex }. */
function buildEmployeeGroups(employees, totalOutput, startBrigadeIndex = 0) {
  if (!employees?.length) return { groups: [], nextBrigadeIndex: startBrigadeIndex }
  const byTotal = {}
  employees.forEach((emp) => {
    const key = Math.round((emp.total || 0) * 100) / 100
    if (!byTotal[key]) byTotal[key] = []
    byTotal[key].push(emp)
  })
  const totals = Object.keys(byTotal)
    .map(Number)
    .sort((a, b) => b - a)
  const result = []
  let brigadeIndex = startBrigadeIndex
  totals.forEach((total) => {
    const group = byTotal[total]
    if (group.length >= 2) {
      const brigadeTotal = total * group.length
      const sharePct = totalOutput > 0 ? Math.round((brigadeTotal / totalOutput) * 1000) / 10 : 0
      result.push({
        type: 'brigade',
        name: getBrigadeName(brigadeIndex),
        total,
        brigade_total: brigadeTotal,
        share_pct: sharePct,
        employees: group,
      })
      brigadeIndex += 1
    } else {
      result.push({ type: 'single', ...group[0] })
    }
  })
  return { groups: result, nextBrigadeIndex: brigadeIndex }
}

function DeltaSpan({ today, yesterday, isPct = false, formatQty }) {
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

/** Аналитика по выработке на участке: кол-во сотрудников, средняя выработка, кнопка развернуть список с % и детализацией до наименования. summaryOnCard=true — не показывать две сводные строки (уже на карточке). brigadeIndexRefProp — общий счётчик бригад (уникальные названия на странице). */
export function DeptEmployeeAnalytics({ item, formatQty, compact, summaryOnCard, brigadeIndexRefProp }) {
  const [showEmployeesList, setShowEmployeesList] = useState(false)
  const [expandedUsers, setExpandedUsers] = useState(new Set())
  const localBrigadeRef = React.useRef(0)
  const brigadeIndexRef = brigadeIndexRefProp ?? localBrigadeRef
  const toggleUser = (e, user) => {
    e.stopPropagation()
    setExpandedUsers(prev => {
      const next = new Set(prev)
      if (next.has(user)) next.delete(user)
      else next.add(user)
      return next
    })
  }
  const employees = item?.employees || []
  const totalOutput = item?.total_output ?? 0
  const nEmp = item?.employee_count ?? employees.length
  const avgPerEmp = item?.average_per_employee
  const avgYesterday = item?.average_per_employee_yesterday
  const nEmpYesterday = item?.employee_count_yesterday
  const isGravKarton = item?.department === GRAV_KARTON_DEPT
  const byRole = isGravKarton && employees.some(e => e.role)
    ? ROLE_ORDER.map(role => ({
        role,
        label: ROLE_LABELS[role] || role,
        employees: employees.filter(e => e.role === role),
      })).filter(g => g.employees.length > 0)
    : null

  const [expandedBrigades, setExpandedBrigades] = useState(new Set())
  const toggleBrigade = (e, id) => {
    e.stopPropagation()
    setExpandedBrigades(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const renderEmployeeRows = (list, totalOut) => {
    const { groups, nextBrigadeIndex } = buildEmployeeGroups(list, totalOut, brigadeIndexRef.current)
    brigadeIndexRef.current = nextBrigadeIndex
    const rows = []
    groups.forEach((row, idx) => {
      if (row.type === 'single') {
        const emp = row
        rows.push(
          <React.Fragment key={`single-${emp.user}-${idx}`}>
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
        )
      } else {
        const brigadeId = `brigade-${idx}-${row.name}-${row.total}`
        const isBrigadeOpen = expandedBrigades.has(brigadeId)
        rows.push(
          <React.Fragment key={brigadeId}>
            <tr>
              <td>
                <button
                  type="button"
                  className="nom-group-btn employee-output-brigade-btn"
                  onClick={(e) => toggleBrigade(e, brigadeId)}
                >
                  {isBrigadeOpen ? '▼' : '▶'} Бригада «{row.name}»
                  <span className="employee-output-brigade-meta"> — {row.employees.length} чел., {row.share_pct != null && `${row.share_pct}%`}</span>
                </button>
              </td>
              <td>{formatQty(row.brigade_total)}</td>
            </tr>
            {isBrigadeOpen && row.employees.map((emp, i) => (
              <React.Fragment key={`${brigadeId}-${emp.user}-${i}`}>
                <tr className="employee-output-brigade-member">
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
            ))}
          </React.Fragment>
        )
      }
    })
    return rows
  }

  if (!item || (nEmp === 0 && employees.length === 0)) return null

  return (
    <div className={`employee-output-dept-analytics-wrap ${compact ? 'employee-output-analytics-compact' : ''}`}>
      <div className="employee-output-dept-analytics">
        {!summaryOnCard && (
          <>
            <div className="employee-output-analytics-row">
              <span>Количество сотрудников: <strong>{nEmp}</strong></span>
              <DeltaSpan today={nEmp} yesterday={nEmpYesterday} formatQty={formatQty} />
            </div>
            {avgPerEmp != null && (
              <div className="employee-output-analytics-row">
                <span>Средняя выработка на сотрудника: <strong>{formatQty(avgPerEmp)}</strong></span>
                {avgYesterday != null && (
                  <DeltaSpan today={avgPerEmp} yesterday={avgYesterday} formatQty={formatQty} />
                )}
              </div>
            )}
          </>
        )}
        <button
          type="button"
          className="employee-output-expand-btn"
          onClick={(e) => { e.stopPropagation(); setShowEmployeesList(s => !s) }}
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
                <tbody>{renderEmployeeRows(roleEmployees, totalOutput)}</tbody>
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
            <tbody>{renderEmployeeRows(employees, totalOutput)}</tbody>
          </table>
        )
      )}
    </div>
  )
}

/** Участок: всего выработка + аналитика (кол-во сотрудников, средняя выработка) + по кнопке список сотрудников с % и раскрытием до номенклатуры. Для Картон/Дерево Елино Гравировка — группы Сборщики и Оператор станка ЧПУ */
export function DepartmentBlock({ item, formatQty, brigadeIndexRef }) {
  return (
    <div className="employee-output-dept">
      <h4 className="employee-output-dept-title">
        {item.production} — {item.department}
      </h4>
      <div className="employee-output-dept-total">
        Всего выработка: <strong>{formatQty(item.total_output)}</strong>
      </div>
      <DeptEmployeeAnalytics item={item} formatQty={formatQty} brigadeIndexRefProp={brigadeIndexRef} />
    </div>
  )
}

export default function EmployeeOutputBlock({ employeeOutput, expanded, onToggle }) {
  const byDepartment = employeeOutput?.by_department || []
  const comparison = employeeOutput?.comparison || []
  const hasData = byDepartment.length > 0 || comparison.length > 0
  const brigadeIndexRef = React.useRef(0)

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
                  <DepartmentBlock key={`${item.production}-${item.department}-${i}`} item={item} formatQty={formatQty} brigadeIndexRef={brigadeIndexRef} />
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
