import { useState, useEffect, useCallback } from 'react'
import { apiFetch, API } from '../api'
import { ScheduleTable, TimesheetTable, EmployeesTab } from './WorkforcePage'
import './ProductionDashboardPage.css'

const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]

const SECTION_DISPLAY = {
  // Гравировка
  'Сборочный цех Елино Гравировка':   'Выпуск готовой продукции',
  'Гравировочный цех Елино':           'Гравировка',
  'Картон/Дерево Елино Гравировка':    'Картон/Дерево',
  'Шелкография Елино Гравировка':      'Шелкография',
  // Чай
  'Купажный цех Елино':                'Купажный цех',
  'Шелкография Елино':                 'Шелкография',
  'Картон/Дерево Елино':               'Картон/Дерево',
  'Сборочный цех Елино':               'Сборочный цех',
  'Фасовка КУБОВ':                     'Фасовочный цех',
  'Фасовка банок':                     'Фасовочный цех',
  // Люминарк
  'Сборочный цех Люминарк':            'Сборочный цех Люминарк',
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

function shortDateLabel(iso) {
  if (!iso) return ''
  const [, m, d] = iso.split('-')
  return `${parseInt(d, 10)}.${m}`
}

// ─── Section Cost Analytics ────────────────────────────────────────────────────

const SECTION_COLORS = {
  'Выпуск готовой продукции': '#111111',
  'Гравировка':               '#2563eb',
  'Резка МДФ':                '#d97706',
  'Сборка МДФ':               '#16a34a',
  'Шелкография':              '#7c3aed',
  'Валковый пресс':           '#dc2626',
  'Купажный цех':             '#0891b2',
  'Фасовочный цех':           '#7c3aed',
  'Сборочный цех':            '#16a34a',
  'Сборочный цех Люминарк':   '#16a34a',
  'Разборка':                 '#dc2626',
  'Картон/Дерево':            '#d97706',
  'Фасовка КУБОВ':            '#0891b2',
  'Фасовка банок':            '#7c3aed',
}

const PRODUCTION_CONFIG = {
  engraving: { label: 'Гравировка', apiKey: 'engraving', wfKey: 'engraving', fullLabel: 'ГРАВИРОВКА' },
  tea:       { label: 'Чай',        apiKey: 'tea',        wfKey: 'tea',        fullLabel: 'ЧАЙ' },
  luminarc:  { label: 'Люминарк',   apiKey: 'luminarc',   wfKey: 'luminarc',   fullLabel: 'ЛЮМИНАРК' },
}

// Многолинейный SVG-график: себестоимость единицы по участкам за 15 дней
const CW = 540, CH = 170, CPL = 52, CPR = 8, CPT = 8, CPB = 26
const ciW = CW - CPL - CPR
const ciH = CH - CPT - CPB

function CpuLineChart({ seriesList, dates }) {
  const active = seriesList.filter(s => s.values.filter(v => v != null).length >= 2)
  if (!active.length || dates.length < 2) return null

  const allVals = active.flatMap(s => s.values.filter(v => v != null))
  const maxY = Math.max(...allVals) * 1.15 || 1
  const n = dates.length

  const xOf = i => (ciW * i / (n - 1)).toFixed(1)
  const yOf = v => (ciH - ciH * v / maxY).toFixed(1)

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => maxY * t)

  const buildPath = (values) => {
    let d = ''
    values.forEach((v, i) => {
      if (v == null) return
      const cmd = (i > 0 && values[i - 1] != null) ? 'L' : 'M'
      d += ` ${cmd} ${xOf(i)} ${yOf(v)}`
    })
    return d.trim()
  }

  return (
    <div className="pd-cpu-chart-wrap">
      <svg viewBox={`0 0 ${CW} ${CH}`} style={{ width: '100%', height: CH }}>
        <g transform={`translate(${CPL},${CPT})`}>
          {/* Y grid */}
          {yTicks.map((v, i) => (
            <g key={i}>
              <line x1={0} x2={ciW} y1={yOf(v)} y2={yOf(v)}
                stroke={i === 0 ? '#999' : '#e5e7eb'} strokeWidth={i === 0 ? 1 : 0.5}
                strokeDasharray={i > 0 ? '3 3' : ''} />
              <text x={-6} y={+yOf(v) + 4} textAnchor="end" fontSize={9} fill="#888">
                {v > 0 ? `₽${Math.round(v)}` : '0'}
              </text>
            </g>
          ))}
          {/* X labels */}
          {dates.map((d, i) => {
            if (i % 3 !== 0 && i !== n - 1) return null
            return (
              <text key={d} x={xOf(i)} y={ciH + 18} textAnchor="middle" fontSize={9} fill="#888">
                {shortDateLabel(d)}
              </text>
            )
          })}
          {/* Lines */}
          {active.map(s => (
            <path key={s.name} d={buildPath(s.values)}
              fill="none" stroke={s.color} strokeWidth={1.8}
              strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {/* Dots at last known value */}
          {active.map(s => {
            const lastIdx = s.values.map((v, i) => v != null ? i : -1).filter(i => i >= 0).pop()
            if (lastIdx == null) return null
            return (
              <circle key={s.name} cx={xOf(lastIdx)} cy={yOf(s.values[lastIdx])}
                r={3} fill={s.color} />
            )
          })}
        </g>
      </svg>
      {/* Legend */}
      <div className="pd-cpu-legend">
        {active.map(s => (
          <span key={s.name} className="pd-cpu-legend-item">
            <span className="pd-cpu-legend-dot" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  )
}

function SectionCostBlock({ workforce, sections }) {
  if (!workforce || !sections || sections.length === 0) return null
  const wfSections   = workforce.sections || {}
  const totalCost    = workforce.total_cost || 0
  const isPlanned    = workforce.is_planned === true
  const dailyBySection = workforce?.last_15_days?.daily_by_section || {}

  // Основной участок — знаменатель для всех расчётов себестоимости
  const mainSection     = sections.find(s => s.main)
  const mainOutput      = mainSection?.total || 0
  const mainDisplayName = mainSection ? (SECTION_DISPLAY[mainSection.name] || mainSection.name) : null

  // Ежедневный выпуск основного участка (для матрицы)
  const mainDailyProdMap = {}
  if (mainSection) {
    ;(mainSection.daily_data || []).forEach(d => { mainDailyProdMap[d.date] = d.total })
  }

  // Собираем данные по каждому участку (дедупликация по displayName для матрицы ФОТ)
  const seenWfSections = new Set()
  const sectionData = sections.map(section => {
    const displayName = SECTION_DISPLAY[section.name] || section.name
    const wfSec       = wfSections[displayName] || {}
    // Если несколько производственных секций маппятся на один участок workforce
    // (напр. Фасовка КУБОВ + Фасовка банок → Фасовочный цех), ФОТ берём только один раз
    const alreadySeen = seenWfSections.has(displayName)
    if (!alreadySeen && wfSec.cost) seenWfSections.add(displayName)
    const sectionCost = alreadySeen ? 0 : (wfSec.cost || 0)
    const empCount    = wfSec.employee_count || 0
    const output      = section.total || 0
    // Делим на выпуск ОСНОВНОГО участка — тогда строки матрицы суммируются в итоговую себест.
    const denominator = mainOutput > 0 ? mainOutput : output
    const costPerUnit = denominator > 0 && sectionCost > 0 ? sectionCost / denominator : 0
    const pctOfTotal  = totalCost > 0 && sectionCost > 0 ? (sectionCost / totalCost) * 100 : 0

    // Ежедневные карты: дата → значение
    const dailyProdMap = {}
    ;(section.daily_data || []).forEach(d => { dailyProdMap[d.date] = d.total })
    const dailyCostMap = alreadySeen ? {} : (dailyBySection[displayName] || {})

    return { displayName, main: section.main, unit: section.unit || 'шт',
             empCount, output, sectionCost, costPerUnit, pctOfTotal,
             dailyProdMap, dailyCostMap }
  }).filter(r => r.output > 0 || r.sectionCost > 0)

  if (!sectionData.length) return null

  // Объединяем все даты из обоих источников
  const allDatesSet = new Set()
  sectionData.forEach(s => {
    Object.keys(s.dailyProdMap).forEach(d => allDatesSet.add(d))
    Object.keys(s.dailyCostMap).forEach(d => allDatesSet.add(d))
  })
  const allDates = Array.from(allDatesSet).sort()

  // Формируем серии для графика (только участки с выпуском, без вспомогательных)
  const chartSections = sectionData.filter(s =>
    s.output > 0 && s.displayName !== 'Вспомогательный персонал'
  )
  const seriesList = chartSections.map(s => ({
    name:   s.displayName,
    color:  SECTION_COLORS[s.displayName] || '#888',
    values: allDates.map(date => {
      const out  = s.dailyProdMap[date] || 0
      const cost = s.dailyCostMap[date] || 0
      return out > 0 && cost > 0 ? cost / out : null
    }),
  }))

  // Короткий форматтер для матричных ячеек
  const fmtCpu = v => v > 0 ? `${Math.round(v)} ₽` : null

  // Строки матрицы: все участки с ФОТ (включая вспомогательных — они тоже влияют на себест.)
  const matrixRows = sectionData.filter(s => s.sectionCost > 0).map(s => ({
    ...s,
    dailyCpuMap: Object.fromEntries(
      allDates.map(date => {
        const cost    = s.dailyCostMap[date] || 0
        // Делим на выпуск ОСНОВНОГО участка за этот день
        const mainOut = mainDailyProdMap[date] || s.dailyProdMap[date] || 0
        return [date, mainOut > 0 && cost > 0 ? cost / mainOut : null]
      })
    ),
  }))

  return (
    <div className="pd-dynamics-block">
      <div className="pd-dynamics-title">
        Динамика себестоимости единицы продукции по участкам · последние 15 дней
        {isPlanned && <span className="pd-dynamics-plan-badge"> · по плану (табель не заполнен)</span>}
      </div>
      <div className="pd-dynamics-desc">
        Стоимость ФОТ на единицу выпущенной продукции — ежедневно и за период в целом
      </div>

      {/* График для визуализации тренда */}
      {seriesList.some(s => s.values.filter(v => v != null).length >= 2)
        ? <CpuLineChart seriesList={seriesList} dates={allDates} />
        : <div className="pd-cpu-no-data">
            График накапливается — появится после загрузки данных выпуска за несколько дней
          </div>
      }

      {/* Матрица: участки × дни */}
      <div className="pd-dynamics-table-wrap pd-cpu-matrix-wrap">
        <table className="pd-dynamics-table pd-cpu-matrix">
          <thead>
            <tr>
              <th className="pd-dyn-col-name pd-cpu-sticky-col">Участок</th>
              {allDates.map(d => (
                <th key={d} className="pd-cpu-date-col">{shortDateLabel(d)}</th>
              ))}
              <th className="pd-cpu-avg-col">За период</th>
            </tr>
          </thead>
          <tbody>
            {matrixRows.map(r => (
              <tr key={r.displayName}>
                <td className="pd-dyn-col-name pd-cpu-sticky-col">
                  <span className="pd-dyn-section-dot"
                    style={{ background: SECTION_COLORS[r.displayName] || '#888' }} />
                  {r.main ? <strong>{r.displayName}</strong> : r.displayName}
                </td>
                {allDates.map(date => {
                  const val = r.dailyCpuMap[date]
                  return (
                    <td key={date} className={`pd-cpu-cell${val != null ? ' pd-cpu-cell-val' : ''}`}>
                      {val != null ? fmtCpu(val) : '—'}
                    </td>
                  )
                })}
                <td className="pd-cpu-avg-col">
                  {r.costPerUnit > 0
                    ? <strong className="pd-dyn-cpu-val">{fmtCpu(r.costPerUnit)}</strong>
                    : '—'}
                </td>
              </tr>
            ))}
            {/* Итоговая строка: суммарная себестоимость = совпадает с SummaryCard */}
            {allDates.some(d => (workforce?.last_15_days?.daily_cost?.[d] || 0) > 0) && (
              <tr className="pd-cpu-row-fot">
                <td className="pd-dyn-col-name pd-cpu-sticky-col">
                  <strong style={{ fontSize: '0.75rem' }}>Итого себест.</strong>
                </td>
                {allDates.map(date => {
                  const dc      = workforce?.last_15_days?.daily_cost?.[date] || 0
                  const mainOut = mainDailyProdMap[date] || 0
                  const cpu     = dc > 0 && mainOut > 0 ? dc / mainOut : null
                  return (
                    <td key={date} className={`pd-cpu-cell pd-cpu-cell-fot${cpu != null ? ' pd-cpu-cell-val' : ''}`}>
                      {cpu != null ? <strong>{fmtCpu(cpu)}</strong> : '—'}
                    </td>
                  )
                })}
                <td className="pd-cpu-avg-col">
                  {workforce.cost_per_unit > 0
                    ? <strong className="pd-dyn-cpu-val">{fmtCpu(workforce.cost_per_unit)}</strong>
                    : '—'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

    </div>
  )
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
  const color = trend === 'up' ? '#6DC24B' : trend === 'down' ? '#D9534F' : '#888'

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

function SectionCard({ section, workforce, isMainSection, index }) {
  const [detailOpen, setDetailOpen] = useState(false)
  const displayName = SECTION_DISPLAY[section.name] || section.name
  const sectionKey = displayName
  const wfSec = workforce?.sections?.[sectionKey] || {}
  const empCount = wfSec.employee_count != null
    ? wfSec.employee_count
    : (workforce?.by_section?.[sectionKey] ?? (isMainSection ? (workforce?.employee_count || null) : null))
  const avgPerEmp = empCount > 0 && section.total > 0 ? Math.round(section.total / empCount) : null
  const sectionCost = wfSec.cost || 0
  const sectionCostPerUnit = section.total > 0 && sectionCost > 0
    ? sectionCost / section.total
    : 0

  const subLabel = section.main
    ? 'Основной участок'
    : `${index + 1} участок`

  return (
    <div className={`pd-section-row${section.main ? ' pd-section-main' : ''}`}>
      <div className="pd-sec-cell pd-sec-name-cell">
        <div className="pd-sec-name-line">
          <span className="pd-sec-bullet" />
          <span className="pd-sec-name">{displayName}</span>
        </div>
        <div className="pd-sec-subline">
          <span>{subLabel}</span>
          {sectionCost > 0 && sectionCostPerUnit > 0 && (
            <span className="pd-sec-subline-cost">
              · ФОТ: <strong>{fmtRub(sectionCost)}</strong>
              {' · '}
              Себест. ед.: <span className="pd-sec-unit-cost">{fmtRub(sectionCostPerUnit)}</span>
            </span>
          )}
        </div>
      </div>
      <div className="pd-sec-cell pd-sec-out">
        <span className="pd-sec-out-main">{fmtNum(section.total)}</span>
        <span className="pd-sec-out-unit">{section.unit}</span>
      </div>
      <div className="pd-sec-cell pd-sec-prev">
        {fmtNum(section.prev_total)} {section.unit}
      </div>
      <div className="pd-sec-cell pd-sec-change">
        <DeltaBadge delta={section.delta} pct={section.delta_pct} unit={section.unit} />
      </div>
      <div className="pd-sec-cell pd-sec-emps">
        {empCount != null ? empCount : '—'}
      </div>
      <div className="pd-sec-cell pd-sec-per-emp">
        {avgPerEmp != null ? `${fmtNum(avgPerEmp)} ${section.unit}` : '—'}
      </div>
      <div className="pd-sec-cell pd-sec-trend">
        <Sparkline data={section.daily_data} />
      </div>

      {section.nomenclature && section.nomenclature.length > 0 && (
        <div className="pd-sec-detail-row">
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

function SummaryCard({ workforce, sections, productionLabel }) {
  if (!workforce) return null
  const mainSection = (sections || []).find(s => s.main)
  const totalOutput = mainSection?.total ?? 0
  const outputUnit = mainSection?.unit ?? 'шт'
  return (
    <div className="pd-summary-card">
      <div className="pd-summary-title">Итого по производству{productionLabel ? ` · ${productionLabel}` : ''}</div>
      <div className="pd-summary-grid">
        <div className="pd-summary-item">
          <span className="pd-summary-label">Выпущено ГП</span>
          <span className="pd-summary-value">{totalOutput > 0 ? fmtNum(totalOutput) : '—'}</span>
          <span className="pd-summary-desc">{outputUnit}, за период</span>
        </div>
        <div className="pd-summary-item">
          <span className="pd-summary-label">Сотрудников</span>
          <span className="pd-summary-value">{workforce.employee_count > 0 ? workforce.employee_count : '—'}</span>
          <span className="pd-summary-desc">на производстве</span>
        </div>
        <div className="pd-summary-item">
          <span className="pd-summary-label">ГП / сотрудник</span>
          <span className="pd-summary-value">
            {workforce.units_per_employee > 0 ? fmtNum(workforce.units_per_employee) : '—'}
          </span>
          <span className="pd-summary-desc">шт, средний выпуск</span>
        </div>
        <div className="pd-summary-item">
          <span className="pd-summary-label">Часов отработано</span>
          <span className="pd-summary-value">{workforce.total_hours > 0 ? fmtNum(workforce.total_hours) : '—'}</span>
          <span className="pd-summary-desc">за период</span>
        </div>
        <div className="pd-summary-item">
          <span className="pd-summary-label">ФОТ</span>
          <span className="pd-summary-value">{workforce.total_cost > 0 ? fmtRub(workforce.total_cost) : '—'}</span>
          <span className="pd-summary-desc">все сотрудники</span>
        </div>
        <div className="pd-summary-item pd-summary-highlight">
          <span className="pd-summary-label">Себест. ед. ГП</span>
          <span className="pd-summary-value">{workforce.cost_per_unit > 0 ? fmtRub(workforce.cost_per_unit) : '—'}</span>
          <span className="pd-summary-desc">с учётом всех затрат</span>
        </div>
      </div>
    </div>
  )
}

// ─── Aux Staff Block ──────────────────────────────────────────────────────────

function AuxStaffBlock({ workforce, sections }) {
  const [open, setOpen] = useState(false)

  const auxSec = workforce?.sections?.['Вспомогательный персонал']
  if (!auxSec || (auxSec.employee_count === 0 && auxSec.cost === 0)) return null

  const totalOutput = (sections || []).find(s => s.main)?.total ?? 0
  const costPerUnit = totalOutput > 0 && auxSec.cost > 0
    ? auxSec.cost / totalOutput : 0
  const isPlanned = workforce?.is_planned === true

  const employees = auxSec.employees || []

  return (
    <div className="pd-aux-block">
      {/* ── Заголовок с кнопкой разворота ── */}
      <button className="pd-aux-header" onClick={() => setOpen(o => !o)}>
        <div className="pd-aux-header-left">
          <span className="pd-aux-title">Вспомогательный персонал</span>
          {isPlanned && <span className="pd-dynamics-plan-badge"> · по плану</span>}
        </div>
        <div className="pd-aux-header-kpi">
          <span className="pd-aux-kpi-item">
            <span className="pd-aux-kpi-label">Сотрудников</span>
            <span className="pd-aux-kpi-value">{auxSec.employee_count}</span>
          </span>
          <span className="pd-aux-kpi-item">
            <span className="pd-aux-kpi-label">ФОТ за период</span>
            <span className="pd-aux-kpi-value">{fmtRub(auxSec.cost)}</span>
          </span>
          {costPerUnit > 0 && (
            <span className="pd-aux-kpi-item">
              <span className="pd-aux-kpi-label">На ед. ГП</span>
              <strong className="pd-aux-kpi-cpu">{fmtRub(costPerUnit)}</strong>
            </span>
          )}
          <span className="pd-aux-chevron">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* ── Детализация ── */}
      {open && (
        <div className="pd-aux-detail">
          {employees.length === 0 ? (
            <div className="pd-aux-empty">Детализация недоступна для этого периода</div>
          ) : (
            <table className="pd-aux-table">
              <thead>
                <tr>
                  <th className="pd-aux-col-name">ФИО</th>
                  <th>Должность</th>
                  <th>Статус</th>
                  <th>Ставка, ₽/ч</th>
                  <th>Часов</th>
                  <th>ФОТ, ₽</th>
                  <th className="pd-aux-col-cpu">На ед. ГП, ₽</th>
                </tr>
              </thead>
              <tbody>
                {employees.map(emp => {
                  const cpu = totalOutput > 0 && emp.cost > 0
                    ? emp.cost / totalOutput : 0
                  return (
                    <tr key={emp.name}>
                      <td className="pd-aux-col-name">{emp.name}</td>
                      <td>{emp.position || '—'}</td>
                      <td>{emp.status || '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        {emp.rate > 0 ? fmtNum(emp.rate) : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {emp.hours > 0 ? emp.hours : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <strong>{emp.cost > 0 ? fmtRub(emp.cost) : '—'}</strong>
                      </td>
                      <td className="pd-aux-col-cpu">
                        {cpu > 0
                          ? <strong className="pd-dyn-cpu-val">{fmtRub(cpu)}</strong>
                          : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="pd-aux-total-row">
                  <td className="pd-aux-col-name" colSpan={4}><strong>ИТОГО</strong></td>
                  <td style={{ textAlign: 'right' }}>
                    <strong>{auxSec.hours > 0 ? auxSec.hours : '—'}</strong>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <strong>{fmtRub(auxSec.cost)}</strong>
                  </td>
                  <td className="pd-aux-col-cpu">
                    {costPerUnit > 0
                      ? <strong className="pd-dyn-cpu-val">{fmtRub(costPerUnit)}</strong>
                      : '—'}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Attendance Block ─────────────────────────────────────────────────────────

const ATTENDANCE_SECTION_ORDER = [
  // Гравировка
  'Выпуск готовой продукции', 'Гравировка', 'Шелкография',
  'Резка МДФ', 'Сборка МДФ',
  // Чай
  'Купажный цех', 'Фасовочный цех', 'Шелкография',
  'Картон/Дерево', 'Сборочный цех',
  // Люминарк
  'Склад', 'Упаковка', 'Комплекты', 'Сборочный цех Люминарк',
  // Общее
  'Вспомогательный персонал',
]

function AttendanceBlock({ workforce }) {
  if (!workforce) return null
  const planned = workforce.planned_count ?? 0
  const actual  = workforce.actual_count  ?? 0
  if (planned === 0 && actual === 0) return null

  const plannedBySec = workforce.planned_by_section || {}
  const actualBySec  = workforce.actual_by_section  || {}
  const allSections  = [...new Set([
    ...ATTENDANCE_SECTION_ORDER,
    ...Object.keys(plannedBySec),
    ...Object.keys(actualBySec),
  ])].filter(s => s !== '—' && (plannedBySec[s] || actualBySec[s]))

  const pct = planned > 0 ? Math.round(actual / planned * 100) : null

  return (
    <div className="pd-att-block">
      <div className="pd-att-header">
        <span className="pd-att-title">Явка сотрудников</span>
        <div className="pd-att-totals">
          <div className="pd-att-kpi">
            <span className="pd-att-kpi-val">{planned}</span>
            <span className="pd-att-kpi-label">по графику</span>
          </div>
          <div className="pd-att-kpi pd-att-kpi-actual">
            <span className="pd-att-kpi-val">{actual}</span>
            <span className="pd-att-kpi-label">по факту</span>
          </div>
          {pct !== null && (
            <div className={`pd-att-pct ${pct >= 100 ? 'pd-att-pct-ok' : pct >= 80 ? 'pd-att-pct-warn' : 'pd-att-pct-bad'}`}>
              {pct}%
            </div>
          )}
        </div>
      </div>

      <div className="pd-att-sections">
        {allSections.map(sec => {
          const p = plannedBySec[sec] ?? 0
          const a = actualBySec[sec]  ?? 0
          const sp = p > 0 ? Math.round(a / p * 100) : null
          return (
            <div key={sec} className="pd-att-sec-card">
              <div className="pd-att-sec-name">{sec}</div>
              <div className="pd-att-sec-row">
                <span className="pd-att-sec-label">График</span>
                <span className="pd-att-sec-val">{p || '—'}</span>
              </div>
              <div className="pd-att-sec-row">
                <span className="pd-att-sec-label">Табель</span>
                <span className={`pd-att-sec-val ${a < p ? 'pd-att-sec-short' : a > 0 ? 'pd-att-sec-ok' : ''}`}>{a || '—'}</span>
              </div>
              {sp !== null && p > 0 && (
                <div className="pd-att-sec-bar">
                  <div className={`pd-att-sec-bar-fill ${sp >= 100 ? 'ok' : sp >= 80 ? 'warn' : 'bad'}`}
                    style={{ width: `${Math.min(100, sp)}%` }} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Efficiency Tab ───────────────────────────────────────────────────────────

function shiftDate(isoStr, days) {
  const d = new Date(isoStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function EfficiencyTab({ production = 'engraving' }) {
  const yesterday = getYesterday()
  const [preset, setPreset]     = useState('yesterday')
  const [dateFrom, setDateFrom] = useState(yesterday)
  const [dateTo, setDateTo]     = useState(yesterday)
  const [dayOffset, setDayOffset] = useState(0)   // 0 = вчера, 1 = позавчера, и т.д.
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)

  const getEffectiveDates = useCallback(() => {
    if (preset === 'yesterday') {
      const d = shiftDate(getYesterday(), -dayOffset)
      return { from: d, to: d }
    }
    if (preset === '7days') {
      const to = getYesterday()
      const f = new Date()
      f.setDate(f.getDate() - 7)
      return { from: f.toISOString().slice(0, 10), to }
    }
    return { from: dateFrom, to: dateTo }
  }, [preset, dateFrom, dateTo, dayOffset])

  const getTrendDays = useCallback(() => 15, [])

  const load = useCallback(() => {
    const { from, to } = getEffectiveDates()
    const trendDays = getTrendDays()
    setLoading(true)
    setError(null)
    apiFetch(`${API}/production-dashboard/${production}?date_from=${from}&date_to=${to}&trend_days=${trendDays}`)
      .then(res => { setData(res); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [getEffectiveDates, getTrendDays])

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
          <button
            className={`pd-period-btn${preset === 'yesterday' ? ' pd-period-active' : ''}`}
            onClick={() => { setPreset('yesterday'); setDayOffset(0) }}
          >
            За вчера
          </button>
          {/* Стрелки навигации по дням */}
          <div className="pd-day-nav">
            <button
              className="pd-day-nav-btn"
              title="Предыдущий день"
              onClick={() => { setPreset('yesterday'); setDayOffset(o => o + 1) }}
            >‹</button>
            <span className="pd-day-nav-label">
              {formatDateLabel(shiftDate(getYesterday(), -dayOffset))}
            </span>
            <button
              className="pd-day-nav-btn"
              title="Следующий день"
              disabled={dayOffset === 0}
              onClick={() => setDayOffset(o => Math.max(0, o - 1))}
            >›</button>
          </div>
          {[
            { key: '7days',  label: 'За последние 7 дней' },
            { key: 'period', label: 'За период' },
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
              <SummaryCard workforce={data.workforce} sections={data.sections} productionLabel={PRODUCTION_CONFIG[production]?.fullLabel} />
              <AttendanceBlock workforce={data.workforce} />

              <div className="pd-sections-block">
                <div className="pd-sections-section-title">
                  ПРОИЗВОДСТВЕННЫЕ УЧАСТКИ · ЭФФЕКТИВНОСТЬ ПРОИЗВОДСТВА
                </div>
                <div className="pd-sections-title-row">
                  <div className="pd-sec-col pd-sec-col-name">Участок</div>
                  <div className="pd-sec-col">Выпуск</div>
                  <div className="pd-sec-col">Пред. период</div>
                  <div className="pd-sec-col">Изменение</div>
                  <div className="pd-sec-col">Сотрудников</div>
                  <div className="pd-sec-col">Ср. / чел.</div>
                  <div className="pd-sec-col pd-sec-col-trend">Динамика</div>
                </div>

                <div className="pd-sections-table">
                  {data.sections.map((section, idx) => (
                    <SectionCard
                      key={section.name}
                      section={section}
                      workforce={data.workforce}
                      isMainSection={!!section.main}
                      index={idx}
                    />
                  ))}
                </div>
              </div>

              <SectionCostBlock workforce={data.workforce} sections={data.sections} />
              <AuxStaffBlock workforce={data.workforce} sections={data.sections} />
            </>
          )}
        </>
      )}
    </div>
  )
}

// ─── Workforce Tab ────────────────────────────────────────────────────────────

function WorkforceTab({ userInfo, reference, production = 'engraving' }) {
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
      <div className="pd-wf-panel">
        <div className="pd-sections-section-title pd-wf-panel-title">
          ГРАФИК · ТАБЕЛЬ · СПИСОК СОТРУДНИКОВ
        </div>
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
            key={`pd-employees-${production}`}
            production={production}
            canEdit={canEdit}
          />
        )}
        {subTab === 'schedule' && (
          <ScheduleTable
            key={`pd-sched-${production}-${year}-${month}-${importKey}`}
            production={production}
            year={year}
            month={month}
            canEdit={canEdit}
            reference={reference}
          />
        )}
        {subTab === 'timesheet' && (
          <TimesheetTable
            key={`pd-ts-${production}-${year}-${month}-${importKey}`}
            production={production}
            year={year}
            month={month}
            canEdit={canEdit}
            reference={reference}
          />
        )}
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ProductionDashboardPage({ userInfo, production = 'engraving' }) {
  const [activeTab, setActiveTab] = useState('efficiency')
  const [reference, setReference] = useState([])

  useEffect(() => {
    apiFetch(`${API}/workforce/reference`)
      .then(d => setReference(Array.isArray(d) ? d : []))
      .catch(() => {})
  }, [])

  const isAdmin   = userInfo?.is_admin === true
  const role      = userInfo?.schedule_role
  const hasAccess = isAdmin || (role && role !== 'none')

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

  const cfg = PRODUCTION_CONFIG[production] || PRODUCTION_CONFIG.engraving

  return (
    <div className="pd-page">
      <div className="pd-page-header">
        <h2 className="pd-page-title">Панель производства</h2>
        <span className="pd-page-subtitle">{cfg.fullLabel}</span>
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
        {activeTab === 'efficiency' && <EfficiencyTab key={production} production={production} />}
        {activeTab === 'workforce'  && <WorkforceTab key={production} production={production} userInfo={userInfo} reference={reference} />}
      </div>
    </div>
  )
}
