import { useState, useEffect, useCallback } from 'react'
import { apiFetch, API } from '../api'
import { ScheduleTable, TimesheetTable, EmployeesTab } from './WorkforcePage'
import './ProductionDashboardPage.css'

const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]

const SECTION_DISPLAY = {
  'Сборочный цех Елино Гравировка':   'Выпуск готовой продукции',
  'Гравировочный цех Елино':           'Гравировка',
  'Картон/Дерево Елино Гравировка':    'Картон/Дерево',
  'Шелкография Елино Гравировка':      'Шелкография',
}

function getYesterday() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

function formatDateLabel(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

function fmtNum(v) {
  if (v == null || isNaN(v)) return '—'
  return new Intl.NumberFormat('ru-RU').format(Math.round(v))
}

function fmtRub(v) {
  if (!v && v !== 0) return '—'
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(v) + ' ₽'
}

// ─── Sparkline ───────────────────────────────────────────────────────────────

function Sparkline({ data }) {
  if (!data || data.length < 2) return null
  const values = data.map(d => d.total ?? 0)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const W = 100, H = 32, PAD = 3
  const iW = W - PAD * 2
  const iH = H - PAD * 2
  const pts = values.map((v, i) => {
    const x = PAD + (i / (values.length - 1)) * iW
    const y = PAD + (1 - (v - min) / range) * iH
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const last = values[values.length - 1]
  const first = values[0]
  const trend = last > first ? 'up' : last < first ? 'down' : 'flat'
  const color = trend === 'up' ? '#22c55e' : trend === 'down' ? '#ef4444' : '#888'

  return (
    <div className="pd-sparkline">
      <svg width={W} height={H} style={{ overflow: 'visible' }}>
        <polyline
          points={pts.join(' ')}
          fill="none"
          stroke={color}
          strokeWidth="1.8"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {values.map((v, i) => {
          const x = PAD + (i / (values.length - 1)) * iW
          const y = PAD + (1 - (v - min) / range) * iH
          return <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r="2" fill={color} />
        })}
      </svg>
      <span className={`pd-trend pd-trend-${trend}`}>
        {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'}
      </span>
    </div>
  )
}

// ─── Delta Badge ──────────────────────────────────────────────────────────────

function DeltaBadge({ delta, pct, unit = 'шт' }) {
  if (delta == null) return null
  const sign = delta > 0 ? '+' : ''
  const cls  = delta > 0 ? 'pos' : delta < 0 ? 'neg' : 'flat'
  return (
    <span className={`pd-delta pd-delta-${cls}`}>
      {sign}{fmtNum(delta)} {unit} ({sign}{pct}%)
    </span>
  )
}

// ─── Section Card ─────────────────────────────────────────────────────────────

function SectionCard({ section, workforce, isMainSection }) {
  const [detailOpen, setDetailOpen] = useState(false)
  const displayName = SECTION_DISPLAY[section.name] || section.name
  const empCount = workforce?.by_section?.[section.name] ?? (isMainSection ? (workforce?.employee_count || null) : null)
  const avgPerEmp = empCount > 0 && section.total > 0 ? Math.round(section.total / empCount) : null

  return (
    <div className={`pd-section-card${section.main ? ' pd-section-main' : ''}`}>
      <div className="pd-sc-header">
        <div className="pd-sc-title-wrap">
          <span className="pd-sc-name">{displayName}</span>
          {section.main && <span className="pd-main-badge">ГП</span>}
        </div>
        <Sparkline data={section.daily_data} />
      </div>

      <div className="pd-sc-total-row">
        <span className="pd-sc-total">{fmtNum(section.total)}</span>
        <span className="pd-sc-unit">{section.unit}</span>
        <DeltaBadge delta={section.delta} pct={section.delta_pct} unit={section.unit} />
      </div>

      <div className="pd-sc-prev">
        Пред. период: <strong>{fmtNum(section.prev_total)}</strong> {section.unit}
      </div>

      {/* Sub-sections (Картон/Дерево: РЕЗКА / Сборка МДФ / Валковый пресс) */}
      {section.subs && section.subs.length > 0 && (
        <div className="pd-subs">
          {section.subs.map(sub => (
            <div key={sub.sub_name} className="pd-sub">
              <div className="pd-sub-header">
                <span className="pd-sub-name">{sub.sub_name}</span>
                <Sparkline data={sub.daily_data} />
              </div>
              <div className="pd-sub-row">
                <span className="pd-sub-total">{fmtNum(sub.total)} {sub.unit}</span>
                <DeltaBadge delta={sub.delta} pct={sub.delta_pct} unit={sub.unit} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Workforce metrics */}
      <div className="pd-sc-metrics">
        <div className="pd-metric">
          <span className="pd-metric-label">Сотрудников на участке</span>
          <span className="pd-metric-value">{empCount != null ? empCount : '—'}</span>
        </div>
        <div className="pd-metric">
          <span className="pd-metric-label">Ср. выпуск / чел.</span>
          <span className="pd-metric-value">{avgPerEmp != null ? `${fmtNum(avgPerEmp)} ${section.unit}` : '—'}</span>
        </div>
        {isMainSection && (workforce?.cost_per_unit > 0) && (
          <div className="pd-metric">
            <span className="pd-metric-label">Стоимость ед. продукции</span>
            <span className="pd-metric-value pd-metric-cost">{fmtRub(workforce.cost_per_unit)}</span>
          </div>
        )}
      </div>

      {/* Detalization */}
      {section.nomenclature && section.nomenclature.length > 0 && (
        <div className="pd-detail">
          <button className="pd-btn-detail" onClick={() => setDetailOpen(o => !o)}>
            Детализация {detailOpen ? '▲' : '▼'}
          </button>
          {detailOpen && (
            <div className="pd-detail-panel">
              <table className="pd-detail-table">
                <thead>
                  <tr>
                    <th>Номенклатура</th>
                    <th className="pd-num-h">Кол-во</th>
                  </tr>
                </thead>
                <tbody>
                  {section.nomenclature.map((n, i) => (
                    <tr key={i}>
                      <td>{n.product_name || n.nomenclature_type}</td>
                      <td className="pd-num">{fmtNum(n.quantity)} {section.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({ workforce, sections }) {
  if (!workforce) return null
  return (
    <div className="pd-summary-card">
      <div className="pd-summary-title">Итого по производству (Гравировка)</div>
      <div className="pd-summary-grid">
        <div className="pd-summary-item">
          <span className="pd-summary-label">Всего сотрудников (производство)</span>
          <span className="pd-summary-value">{workforce.employee_count > 0 ? workforce.employee_count : '—'}</span>
        </div>
        <div className="pd-summary-item">
          <span className="pd-summary-label">ГП на одного сотрудника</span>
          <span className="pd-summary-value">
            {workforce.units_per_employee > 0 ? `${fmtNum(workforce.units_per_employee)} шт` : '—'}
          </span>
        </div>
        <div className="pd-summary-item">
          <span className="pd-summary-label">Отработано часов</span>
          <span className="pd-summary-value">{workforce.total_hours > 0 ? fmtNum(workforce.total_hours) : '—'}</span>
        </div>
        <div className="pd-summary-item">
          <span className="pd-summary-label">ФОТ (все сотрудники)</span>
          <span className="pd-summary-value">{workforce.total_cost > 0 ? fmtRub(workforce.total_cost) : '—'}</span>
        </div>
        <div className="pd-summary-item pd-summary-highlight">
          <span className="pd-summary-label">Стоимость ед. ГП (с учётом всех затрат)</span>
          <span className="pd-summary-value">{workforce.cost_per_unit > 0 ? fmtRub(workforce.cost_per_unit) : '—'}</span>
        </div>
      </div>
    </div>
  )
}

// ─── Efficiency Tab ───────────────────────────────────────────────────────────

function EfficiencyTab() {
  const yesterday = getYesterday()
  const [preset, setPreset]     = useState('yesterday')
  const [dateFrom, setDateFrom] = useState(yesterday)
  const [dateTo, setDateTo]     = useState(yesterday)
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)

  const getEffectiveDates = useCallback(() => {
    if (preset === 'yesterday') {
      const d = getYesterday()
      return { from: d, to: d }
    }
    if (preset === '7days') {
      const to = getYesterday()
      const f = new Date()
      f.setDate(f.getDate() - 7)
      return { from: f.toISOString().slice(0, 10), to }
    }
    return { from: dateFrom, to: dateTo }
  }, [preset, dateFrom, dateTo])

  const load = useCallback(() => {
    const { from, to } = getEffectiveDates()
    setLoading(true)
    setError(null)
    apiFetch(`${API}/production-dashboard/engraving?date_from=${from}&date_to=${to}`)
      .then(res => { setData(res); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [getEffectiveDates])

  useEffect(() => { load() }, [load])

  const { from, to } = getEffectiveDates()
  const periodLabel = from === to
    ? formatDateLabel(from)
    : `${formatDateLabel(from)} — ${formatDateLabel(to)}`

  return (
    <div className="pd-efficiency">
      {/* Period selector */}
      <div className="pd-period-bar">
        <div className="pd-period-presets">
          {[
            { key: 'yesterday', label: 'За вчера' },
            { key: '7days',     label: 'За последние 7 дней' },
            { key: 'period',    label: 'За период' },
          ].map(({ key, label }) => (
            <button
              key={key}
              className={`pd-period-btn${preset === key ? ' pd-period-active' : ''}`}
              onClick={() => setPreset(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {preset === 'period' && (
          <div className="pd-period-custom">
            <input
              type="date"
              className="pd-date-input"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
            />
            <span className="pd-period-dash">—</span>
            <input
              type="date"
              className="pd-date-input"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
            />
            <button className="pd-btn-primary" onClick={load}>Показать</button>
          </div>
        )}
      </div>

      {loading && <div className="pd-loading">Загрузка данных...</div>}
      {error   && <div className="pd-error">Ошибка: {error}</div>}

      {data && !loading && (
        <>
          <div className="pd-period-label">
            Период: <strong>{periodLabel}</strong>
            {data.prev_period && (
              <span className="pd-period-compare">
                {' '}(сравнение с {formatDateLabel(data.prev_period.from)} — {formatDateLabel(data.prev_period.to)})
              </span>
            )}
          </div>

          {(!data.sections || data.sections.length === 0) ? (
            <div className="pd-empty">Нет данных о выпуске продукции за выбранный период.</div>
          ) : (
            <>
              <div className="pd-sections-grid">
                {data.sections.map(section => (
                  <SectionCard
                    key={section.name}
                    section={section}
                    workforce={data.workforce}
                    isMainSection={!!section.main}
                  />
                ))}
              </div>
              <SummaryCard workforce={data.workforce} sections={data.sections} />
            </>
          )}
        </>
      )}
    </div>
  )
}

// ─── Workforce Tab ────────────────────────────────────────────────────────────

function WorkforceTab({ userInfo, reference }) {
  const now = new Date()
  const [year, setYear]     = useState(now.getFullYear())
  const [month, setMonth]   = useState(now.getMonth() + 1)
  const [subTab, setSubTab] = useState('schedule')
  const [importKey]         = useState(0)

  const isAdmin  = userInfo?.is_admin === true
  const role     = userInfo?.schedule_role
  const canEdit  = isAdmin || role === 'manager'

  return (
    <div className="pd-workforce">
      {/* Month navigation */}
      <div className="pd-month-nav">
        <button className="pd-month-btn" onClick={() => {
          if (month === 1) { setMonth(12); setYear(y => y - 1) } else setMonth(m => m - 1)
        }}>‹</button>
        <select className="pd-select" value={month} onChange={e => setMonth(Number(e.target.value))}>
          {MONTH_NAMES.map((n, i) => <option key={i + 1} value={i + 1}>{n}</option>)}
        </select>
        <select className="pd-select" value={year} onChange={e => setYear(Number(e.target.value))}>
          {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <button className="pd-month-btn" onClick={() => {
          if (month === 12) { setMonth(1); setYear(y => y + 1) } else setMonth(m => m + 1)
        }}>›</button>
      </div>

      {/* Sub-tabs */}
      <div className="pd-subtabs">
        {canEdit && (
          <button
            className={`pd-subtab${subTab === 'employees' ? ' pd-subtab-active' : ''}`}
            onClick={() => setSubTab('employees')}
          >
            Список сотрудников
          </button>
        )}
        <button
          className={`pd-subtab${subTab === 'schedule' ? ' pd-subtab-active' : ''}`}
          onClick={() => setSubTab('schedule')}
        >
          График
        </button>
        <button
          className={`pd-subtab${subTab === 'timesheet' ? ' pd-subtab-active' : ''}`}
          onClick={() => setSubTab('timesheet')}
        >
          Табель
        </button>
      </div>

      <div className="pd-wf-content">
        {subTab === 'employees' && canEdit && (
          <EmployeesTab
            key="pd-employees-engraving"
            production="engraving"
            canEdit={canEdit}
          />
        )}
        {subTab === 'schedule' && (
          <ScheduleTable
            key={`pd-sched-${year}-${month}-${importKey}`}
            production="engraving"
            year={year}
            month={month}
            canEdit={canEdit}
            reference={reference}
          />
        )}
        {subTab === 'timesheet' && (
          <TimesheetTable
            key={`pd-ts-${year}-${month}-${importKey}`}
            production="engraving"
            year={year}
            month={month}
            canEdit={canEdit}
            reference={reference}
          />
        )}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ProductionDashboardPage({ userInfo }) {
  const [activeTab, setActiveTab] = useState('efficiency')
  const [reference, setReference] = useState([])

  useEffect(() => {
    apiFetch(`${API}/workforce/reference`)
      .then(d => setReference(Array.isArray(d) ? d : []))
      .catch(() => {})
  }, [])

  const isAdmin    = userInfo?.is_admin === true
  const role       = userInfo?.schedule_role
  const prod       = userInfo?.schedule_production
  const hasAccess  = isAdmin || (role && role !== 'none' && (prod === 'engraving' || prod === 'all'))

  if (!hasAccess) {
    return (
      <div className="pd-page">
        <div className="pd-no-access">
          <h2>Нет доступа</h2>
          <p>У вашей учётной записи нет доступа к панели управления производством.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="pd-page">
      <div className="pd-page-header">
        <h2 className="pd-page-title">Панель управления производством</h2>
        <span className="pd-page-subtitle">Гравировка</span>
      </div>

      <div className="pd-main-tabs">
        <button
          className={`pd-main-tab${activeTab === 'efficiency' ? ' pd-main-tab-active' : ''}`}
          onClick={() => setActiveTab('efficiency')}
        >
          Эффективность производства
        </button>
        <button
          className={`pd-main-tab${activeTab === 'workforce' ? ' pd-main-tab-active' : ''}`}
          onClick={() => setActiveTab('workforce')}
        >
          График Табель
        </button>
      </div>

      <div className="pd-tab-content">
        {activeTab === 'efficiency' && <EfficiencyTab />}
        {activeTab === 'workforce'  && <WorkforceTab userInfo={userInfo} reference={reference} />}
      </div>
    </div>
  )
}
