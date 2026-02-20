import { useState, useEffect, useCallback, useRef } from 'react'
import { API, apiFetch } from '../api'

const GROUP_OPTIONS = [
  { value: 'day', label: 'По дням' },
  { value: 'week', label: 'По неделям' },
  { value: 'month', label: 'По месяцам' },
]

const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

function formatPeriod(row, groupBy) {
  if (groupBy === 'week' || groupBy === 'month') return row.label || row.date
  const s = row.date
  if (!s || s.length < 10) return s
  const [y, m, d] = s.split('-').map(Number)
  if (!d || !m) return s
  const month = MONTH_SHORT[m - 1] || m
  return `${d} ${month} ${y}`
}

/** Рубли без копеек, с разделением по тысячам (пробел) */
function formatCostRubles(value) {
  if (value == null || value === '') return ''
  const n = Number(value)
  if (Number.isNaN(n)) return ''
  return Math.round(n).toLocaleString('ru-RU', { maximumFractionDigits: 0 })
}

/** Количество с разделителями тысяч */
function formatQty(value) {
  if (value == null || value === '') return '0'
  const n = Number(value)
  if (Number.isNaN(n)) return '0'
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2, minimumFractionDigits: 0 })
}

/** Колонки с показателями (qty + cost) для выбора и суммирования. colIndex -> [label, qtyKey, costKey] */
const SELECTABLE_COLUMNS = [
  [1, 'Остаток на нач.', 'balance_start', 'balance_start_cost'],
  [2, 'Поступило на склад', 'in_qty', 'in_cost'],
  [3, 'Поступило после разборки', 'ingredients_qty', 'ingredients_cost'],
  [4, 'Списано', 'internal_qty', 'internal_cost'],
  [5, 'Отгружено', 'out_qty', 'out_cost'],
  [6, '% списано', 'internal_qty', 'internal_cost'],
  [7, '% отгружено', 'out_qty', 'out_cost'],
  [8, 'Остаток на кон.', 'balance_end', 'balance_end_cost'],
]

export default function DisassemblyReturnsPage() {
  const [groupBy, setGroupBy] = useState('day')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  /** По какой строке раскрыт подпункт детализации: { [dateStr]: "flow:type" } */
  const [expanded, setExpanded] = useState({})
  /** Множество дат, у которых открыта панель детализации (можно открыть несколько) */
  const [detailPanelOpen, setDetailPanelOpen] = useState(() => new Set())
  const [detailCache, setDetailCache] = useState({})
  /** Множество дат, у которых открыта полная детализация */
  const [fullDetailOpen, setFullDetailOpen] = useState(() => new Set())
  const [fullDetailCache, setFullDetailCache] = useState({})
  const [fullDetailLoading, setFullDetailLoading] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summaryPeriod, setSummaryPeriod] = useState('month')
  const [summaryData, setSummaryData] = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState(null)
  /** Сортировка внутри блоков детализации: { [detailKey]: { by: 'quantity'|'cost', dir: 'asc'|'desc' } } */
  const [detailSort, setDetailSort] = useState({})
  /** Выбор диапазона: колонка + диапазон строк (для суммирования сверху) */
  const [selection, setSelection] = useState(null)
  const isSelectingRef = useRef(false)

  const setDetailSortForKey = (key, by) => {
    setDetailSort(prev => {
      const cur = prev[key]
      const nextDir = cur?.by === by ? (cur.dir === 'asc' ? 'desc' : 'asc') : 'desc'
      return { ...prev, [key]: { by, dir: nextDir } }
    })
  }

  const fetchStats = useCallback(() => {
    setLoading(true)
    setError(null)
    apiFetch(`${API}/disassembly/stats?group_by=${groupBy}`)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [groupBy])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  const fetchDetail = (dateStr, flow, detailType) => {
    const key = `${dateStr}-${flow}-${detailType}`
    if (detailCache[key]) return
    apiFetch(`${API}/disassembly/detail?date_str=${encodeURIComponent(dateStr)}&flow=${flow}&detail_type=${detailType}`)
      .then(res => {
        setDetailCache(prev => ({ ...prev, [key]: res?.items || [] }))
      })
      .catch(() => setDetailCache(prev => ({ ...prev, [key]: [] })))
  }

  const toggleExpand = (dateStr, flow, detailType) => {
    const key = `${flow}-${detailType}`
    setExpanded(prev => {
      const next = { ...prev }
      if (next[dateStr] === key) {
        delete next[dateStr]
      } else {
        next[dateStr] = key
      }
      return next
    })
    const cacheKey = `${dateStr}-${flow}-${detailType}`
    if (!detailCache[cacheKey]) fetchDetail(dateStr, flow, detailType)
  }

  const toggleDetailPanel = (dateStr) => {
    setDetailPanelOpen(prev => {
      const next = new Set(prev)
      if (next.has(dateStr)) {
        next.delete(dateStr)
        setExpanded(prevEx => { const o = { ...prevEx }; delete o[dateStr]; return o })
        setFullDetailOpen(prevF => { const s = new Set(prevF); s.delete(dateStr); return s })
      } else {
        next.add(dateStr)
      }
      return next
    })
  }

  const requestFullDetail = (dateStr) => {
    setFullDetailOpen(prev => {
      const next = new Set(prev)
      if (next.has(dateStr)) next.delete(dateStr)
      else next.add(dateStr)
      return next
    })
    if (fullDetailCache[dateStr]) return
    setFullDetailLoading(true)
    apiFetch(`${API}/disassembly/full-detail?date_str=${encodeURIComponent(dateStr)}`)
      .then(res => {
        setFullDetailCache(prev => ({ ...prev, [dateStr]: res }))
      })
      .catch(() => setFullDetailCache(prev => ({ ...prev, [dateStr]: { error: true } })))
      .finally(() => setFullDetailLoading(false))
  }

  const fetchSummary = useCallback(() => {
    setSummaryLoading(true)
    setSummaryError(null)
    apiFetch(`${API}/disassembly/summary?period=${summaryPeriod}&top_in=5&top_internal=15&top_out=15`)
      .then((res) => {
        setSummaryData(res)
        setSummaryError(null)
      })
      .catch((err) => {
        setSummaryData(null)
        setSummaryError(err?.message || 'Не удалось загрузить сводку')
      })
      .finally(() => setSummaryLoading(false))
  }, [summaryPeriod])

  useEffect(() => {
    if (summaryOpen) fetchSummary()
  }, [summaryOpen, fetchSummary])

  const handleCellMouseDown = useCallback((colIndex, rowIndex) => {
    setSelection({ colIndex, startRowIndex: rowIndex, endRowIndex: rowIndex })
    isSelectingRef.current = true
  }, [])
  const handleCellMouseEnter = useCallback((colIndex, rowIndex) => {
    if (!isSelectingRef.current) return
    setSelection(prev => prev && prev.colIndex === colIndex ? { ...prev, endRowIndex: rowIndex } : prev)
  }, [])
  useEffect(() => {
    const onMouseUp = () => { isSelectingRef.current = false }
    document.addEventListener('mouseup', onMouseUp)
    return () => document.removeEventListener('mouseup', onMouseUp)
  }, [])

  const isDateRow = groupBy === 'day'
  const rows = data?.rows || []
  const totals = data?.totals || { in_qty: 0, ingredients_qty: 0, out_qty: 0, internal_qty: 0 }
  // 100% = поступило после разборки (ингредиенты); списано и отгружено — доли от этой базы
  const ingTotal = totals.ingredients_qty ?? 0
  const internalPct = ingTotal > 0 ? (totals.internal_pct != null ? totals.internal_pct : Math.round((totals.internal_qty / ingTotal) * 1000) / 10) : '—'
  const outPct = ingTotal > 0 ? (totals.out_pct != null ? totals.out_pct : Math.round((totals.out_qty / ingTotal) * 1000) / 10) : '—'

  const selectionRowIndices = selection ? (() => {
    const lo = Math.min(selection.startRowIndex, selection.endRowIndex)
    const hi = Math.max(selection.startRowIndex, selection.endRowIndex)
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
  })() : []
  const selectionSummary = selection && selectionRowIndices.length > 0 && rows.length > 0 ? (() => {
    const config = SELECTABLE_COLUMNS.find(c => c[0] === selection.colIndex)
    if (!config) return null
    const [, label, qtyKey, costKey] = config
    let sumQty = 0
    let sumCost = 0
    selectionRowIndices.forEach(i => {
      const row = rows[i]
      if (row) {
        sumQty += Number(row[qtyKey] ?? 0)
        sumCost += Number(row[costKey] ?? 0)
      }
    })
    return { label, sumQty, sumCost }
  })() : null

  return (
    <div className="page">
      <div className="page-header">
        <h1>Аналитика разборки возвратов</h1>
        <div className="controls">
          <select
            value={groupBy}
            onChange={e => setGroupBy(e.target.value)}
            aria-label="Группировка"
          >
            {GROUP_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button
            type="button"
            className={`btn-summary ${summaryOpen ? 'active' : ''}`}
            onClick={() => setSummaryOpen(prev => !prev)}
            title="Сводка: топ поступлений, списаний, отгрузок"
          >
            Сводка
          </button>
          <button type="button" className="btn-refresh" onClick={fetchStats} title="Обновить данные">
            ⟳
          </button>
        </div>
      </div>

      {summaryOpen && (
        <div className="disassembly-summary-panel">
          <div className="disassembly-summary-header">
            <h2>Сводка по разборке возвратов</h2>
            <div className="disassembly-summary-period">
              <span>Период:</span>
              {['week', 'month', 'all'].map(p => (
                <button
                  key={p}
                  type="button"
                  className={summaryPeriod === p ? 'active' : ''}
                  onClick={() => setSummaryPeriod(p)}
                >
                  {p === 'week' ? 'За последнюю неделю' : p === 'month' ? 'За последний месяц' : 'За всё время'}
                </button>
              ))}
            </div>
            <button type="button" className="disassembly-summary-apply" onClick={fetchSummary} disabled={summaryLoading}>
              {summaryLoading ? 'Загрузка…' : 'Применить'}
            </button>
          </div>
          {summaryLoading && (
            <div className="disassembly-summary-loading">
              <div className="disassembly-summary-progress-wrap">
                <div className="disassembly-summary-progress" role="progressbar" aria-valuetext="Загрузка сводки" />
              </div>
              <span className="disassembly-summary-loading-text">Загрузка сводки…</span>
            </div>
          )}
          {!summaryLoading && summaryError && (
            <div className="disassembly-summary-error">
              {summaryError}
              <button type="button" className="disassembly-summary-retry" onClick={fetchSummary}>Повторить</button>
            </div>
          )}
          {!summaryLoading && !summaryError && summaryData && (
            <div className="disassembly-summary-cards">
              <div className="disassembly-summary-card">
                <h3>Топ‑5 поступлений (наборы)</h3>
                <p className="disassembly-summary-sub">Больше всего поступило по наименованию</p>
                <ol className="disassembly-summary-list">
                  {summaryData.top_received?.map((item, i) => (
                    <li key={i}>
                      <span className="summary-name">{item.name}</span>
                      <span className="summary-qty">{item.quantity}</span>
                    </li>
                  ))}
                </ol>
                {(!summaryData.top_received || summaryData.top_received.length === 0) && <p className="summary-empty">Нет данных</p>}
              </div>
              <div className="disassembly-summary-card">
                <h3>Топ‑15 списаний</h3>
                <p className="disassembly-summary-sub">Больше всего списано по наименованию</p>
                <ol className="disassembly-summary-list">
                  {summaryData.top_internal?.map((item, i) => (
                    <li key={i}>
                      <span className="summary-name">{item.name}</span>
                      <span className="summary-qty">{item.quantity}</span>
                    </li>
                  ))}
                </ol>
                {(!summaryData.top_internal || summaryData.top_internal.length === 0) && <p className="summary-empty">Нет данных</p>}
              </div>
              <div className="disassembly-summary-card">
                <h3>Топ‑15 отгрузок (готовая продукция)</h3>
                <p className="disassembly-summary-sub">Больше всего отгружено по наименованию</p>
                <ol className="disassembly-summary-list">
                  {summaryData.top_out?.map((item, i) => (
                    <li key={i}>
                      <span className="summary-name">{item.name}</span>
                      <span className="summary-qty">{item.quantity}</span>
                    </li>
                  ))}
                </ol>
                {(!summaryData.top_out || summaryData.top_out.length === 0) && <p className="summary-empty">Нет данных</p>}
              </div>
            </div>
          )}
          {!summaryLoading && !summaryError && !summaryData && (
            <div className="disassembly-summary-error">Нет данных для отображения. Нажмите «Применить» или проверьте, что данные разборки загружены.</div>
          )}
          <button type="button" className="disassembly-summary-close" onClick={() => setSummaryOpen(false)} aria-label="Закрыть">
            ×
          </button>
        </div>
      )}

      <p className="page-description">
        Поступление на склад разборки возвратов, отгрузка готовой продукции со склада и внутреннее потребление (списание). Данные забираются из таблиц в папке Google Drive проекта.
      </p>

      {error && <div className="error">Ошибка: {error}</div>}
      {loading && <div className="loading">Загрузка...</div>}

      {!loading && data && (
        <>
          {selectionSummary && (
            <div className="disassembly-selection-summary">
              <span className="disassembly-selection-text">
                За выбранные {selectionRowIndices.length} {groupBy === 'day' ? (selectionRowIndices.length === 1 ? 'день' : selectionRowIndices.length < 5 ? 'дня' : 'дней') : 'периодов'}: <strong>{selectionSummary.label}</strong> — {formatQty(selectionSummary.sumQty)} штук, {formatCostRubles(selectionSummary.sumCost) || '0'} ₽
              </span>
              <button type="button" className="disassembly-selection-clear" onClick={() => setSelection(null)}>Сбросить</button>
            </div>
          )}
          <div className="disassembly-table-wrap">
            <table className="disassembly-table">
              <thead>
                <tr>
                  <th className="th-period">Период</th>
                  <th className="th-vertical"><span>Остаток на нач.</span></th>
                  <th className="th-vertical"><span>Поступило на склад</span></th>
                  <th className="th-vertical"><span>Поступило после разборки</span></th>
                  <th className="th-vertical"><span>Списано</span></th>
                  <th className="th-vertical"><span>Отгружено</span></th>
                  <th className="th-vertical"><span>% списано</span></th>
                  <th className="th-vertical"><span>% отгружено</span></th>
                  <th className="th-vertical"><span>Остаток на кон.</span></th>
                  <th className="th-vertical"><span>Проверка</span></th>
                  {isDateRow && <th className="th-detail">Детализация</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <DisassemblyRow
                    key={row.date}
                    row={row}
                    rowIndex={rowIndex}
                    groupBy={groupBy}
                    isDateRow={isDateRow}
                    expanded={expanded}
                    detailPanelOpen={detailPanelOpen}
                    fullDetailOpen={fullDetailOpen}
                    fullDetailData={fullDetailCache[row.date]}
                    fullDetailLoading={fullDetailLoading}
                    detailCache={detailCache}
                    detailSort={detailSort}
                    onDetailSort={setDetailSortForKey}
                    selection={selection}
                    selectionRowIndices={selectionRowIndices}
                    onCellMouseDown={handleCellMouseDown}
                    onCellMouseEnter={handleCellMouseEnter}
                    onToggleExpand={toggleExpand}
                    onToggleDetailPanel={toggleDetailPanel}
                    onRequestFullDetail={requestFullDetail}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr className="totals-row">
                  <td>Итого</td>
                  <td className="disassembly-cell-qty-cost">
                    <div>{formatQty(totals.balance_start ?? 0)}</div>
                    <div className="disassembly-cost">{(formatCostRubles(totals.balance_start_cost) || '0')} ₽</div>
                  </td>
                  <td className="disassembly-cell-qty-cost">
                    <div>{formatQty(totals.in_qty)}</div>
                    <div className="disassembly-cost">{(formatCostRubles(totals.in_cost) || '0')} ₽</div>
                  </td>
                  <td className="disassembly-cell-qty-cost">
                    <div>{formatQty(totals.ingredients_qty ?? 0)}</div>
                    <div className="disassembly-cost">{(formatCostRubles(totals.ingredients_cost) || '0')} ₽</div>
                  </td>
                  <td className="disassembly-cell-qty-cost">
                    <div>{formatQty(totals.internal_qty)}</div>
                    <div className="disassembly-cost">{(formatCostRubles(totals.internal_cost) || '0')} ₽</div>
                  </td>
                  <td className="disassembly-cell-qty-cost">
                    <div>{formatQty(totals.out_qty)}</div>
                    <div className="disassembly-cost">{(formatCostRubles(totals.out_cost) || '0')} ₽</div>
                  </td>
                  <td>{internalPct !== '—' ? `${internalPct}%` : '—'}</td>
                  <td>{outPct !== '—' ? `${outPct}%` : '—'}</td>
                  <td className="disassembly-cell-qty-cost">
                    <div>{formatQty(totals.balance_end ?? 0)}</div>
                    <div className="disassembly-cost">{(formatCostRubles(totals.balance_end_cost) || '0')} ₽</div>
                  </td>
                  <td className="td-check" data-status={totals.check_status}>{totals.check_balance != null ? (totals.check_balance < 0 ? `Не хватает ${formatQty(Math.abs(totals.check_balance))}` : totals.check_balance > 0 ? `Остаток ${formatQty(totals.check_balance)}` : 'Сходится') : (totals.check_message ?? '—')}</td>
                  {isDateRow && <td />}
                </tr>
              </tfoot>
            </table>
          </div>

          {rows.length === 0 && !error && (
            <div className="empty">Нет данных разборки. Загрузите файлы «Перемещение на склад Разборки», «Перемещение готовой продукции со склада разборка», «Внутреннее потребление Разборка» в папку Google Drive или загрузите их вручную в Админке.</div>
          )}
        </>
      )}
    </div>
  )
}

/** Полная детализация: те же колонки, что в основной таблице; вместо периода — наименование (выравнивание по левому краю) */
function FullDetailTable({ rows, formatCostRubles, formatQty }) {
  if (!rows || rows.length === 0) {
    return <p className="full-detail-empty">Нет данных</p>
  }
  const cellQtyCost = (qty, cost) => (
    <div className="disassembly-cell-qty-cost">
      <div>{formatQty(qty)}</div>
      <div className="disassembly-cost">{(formatCostRubles(cost) || '0')} ₽</div>
    </div>
  )
  const pct = (ing, val) => (ing && ing > 0 ? Math.round((val / ing) * 1000) / 10 : null)
  const check = (balance_end) => {
    if (balance_end == null) return '—'
    const b = Number(balance_end)
    if (b < 0) return `Не хватает ${formatQty(Math.abs(b))}`
    if (b > 0) return `Остаток ${formatQty(b)}`
    return 'Сходится'
  }
  return (
    <div className="full-detail-section full-detail-table-wrap">
      <table className="disassembly-table disassembly-full-detail-table">
        <thead>
          <tr>
            <th className="th-period th-nomenclature">Наименование</th>
            <th className="th-vertical"><span>Остаток на нач.</span></th>
            <th className="th-vertical"><span>Поступило на склад</span></th>
            <th className="th-vertical"><span>Поступило после разборки</span></th>
            <th className="th-vertical"><span>Списано</span></th>
            <th className="th-vertical"><span>Отгружено</span></th>
            <th className="th-vertical"><span>% списано</span></th>
            <th className="th-vertical"><span>% отгружено</span></th>
            <th className="th-vertical"><span>Остаток на кон.</span></th>
            <th className="th-vertical"><span>Проверка</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const internalPct = pct(row.ingredients_qty, row.internal_qty)
            const outPct = pct(row.ingredients_qty, row.out_qty)
            return (
              <tr key={i}>
                <td className="disassembly-cell-period disassembly-cell-nomenclature detail-name">{row.name}</td>
                <td className="disassembly-cell-qty-cost">{cellQtyCost(row.balance_start, row.balance_start_cost)}</td>
                <td className="disassembly-cell-qty-cost">{cellQtyCost(row.in_qty, row.in_cost)}</td>
                <td className="disassembly-cell-qty-cost">{cellQtyCost(row.ingredients_qty, row.ingredients_cost)}</td>
                <td className="disassembly-cell-qty-cost">{cellQtyCost(row.internal_qty, row.internal_cost)}</td>
                <td className="disassembly-cell-qty-cost">{cellQtyCost(row.out_qty, row.out_cost)}</td>
                <td>{internalPct != null ? `${internalPct}%` : '—'}</td>
                <td>{outPct != null ? `${outPct}%` : '—'}</td>
                <td className="disassembly-cell-qty-cost">{cellQtyCost(row.balance_end, row.balance_end_cost)}</td>
                <td className="td-check" data-status={row.balance_end < 0 ? 'не хватает' : row.balance_end > 0 ? 'остаток' : 'ok'}>{check(row.balance_end)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function DisassemblyRow({ row, rowIndex, groupBy, isDateRow, expanded, detailPanelOpen, fullDetailOpen, fullDetailData, fullDetailLoading, detailCache, detailSort, onDetailSort, selection, selectionRowIndices, onCellMouseDown, onCellMouseEnter, onToggleExpand, onToggleDetailPanel, onRequestFullDetail }) {
  const dateStr = row.date
  const detailKey = (flow, type) => `${dateStr}-${flow}-${type}`
  const isExpanded = (flow, type) => (expanded && expanded[dateStr] === `${flow}-${type}`)
  const items = (flow, type) => detailCache[detailKey(flow, type)] || []
  const panelOpen = isDateRow && (detailPanelOpen && detailPanelOpen.has && detailPanelOpen.has(dateStr))
  const fullDetailVisible = panelOpen && (fullDetailOpen && fullDetailOpen.has && fullDetailOpen.has(dateStr))
  const sel = (colIndex) => {
    const selected = selection && selection.colIndex === colIndex && selectionRowIndices.includes(rowIndex)
    return {
      className: `disassembly-cell-qty-cost disassembly-cell-selectable${selected ? ' selected' : ''}`.trim(),
      onMouseDown: (e) => { e.preventDefault(); onCellMouseDown?.(colIndex, rowIndex) },
      onMouseEnter: () => onCellMouseEnter?.(colIndex, rowIndex),
    }
  }
  const selPct = (colIndex) => {
    const selected = selection && selection.colIndex === colIndex && selectionRowIndices.includes(rowIndex)
    return {
      className: `disassembly-cell-selectable${selected ? ' selected' : ''}`.trim(),
      onMouseDown: (e) => { e.preventDefault(); onCellMouseDown?.(colIndex, rowIndex) },
      onMouseEnter: () => onCellMouseEnter?.(colIndex, rowIndex),
    }
  }

  return (
    <>
      <tr className={row.is_correction ? 'disassembly-row-correction' : ''}>
        <td className="disassembly-cell-period">
          {formatPeriod(row, groupBy)}
          {row.is_correction && row.correction_note && (
            <div className="disassembly-correction-note" title={row.correction_note}>{row.correction_note}</div>
          )}
        </td>
        <td {...sel(1)}>
          <div>{formatQty(row.balance_start ?? 0)}</div>
          <div className="disassembly-cost">{(formatCostRubles(row.balance_start_cost) || '0')} ₽</div>
        </td>
        <td {...sel(2)}>
          <div>{formatQty(row.in_qty)}</div>
          <div className="disassembly-cost">{(formatCostRubles(row.in_cost) || '0')} ₽</div>
        </td>
        <td {...sel(3)}>
          <div>{formatQty(row.ingredients_qty ?? 0)}</div>
          <div className="disassembly-cost">{(formatCostRubles(row.ingredients_cost) || '0')} ₽</div>
        </td>
        <td {...sel(4)}>
          <div>{formatQty(row.internal_qty)}</div>
          <div className="disassembly-cost">{(formatCostRubles(row.internal_cost) || '0')} ₽</div>
        </td>
        <td {...sel(5)}>
          <div>{formatQty(row.out_qty)}</div>
          <div className="disassembly-cost">{(formatCostRubles(row.out_cost) || '0')} ₽</div>
        </td>
        <td {...selPct(6)}>{row.internal_pct != null ? `${row.internal_pct}%` : '—'}</td>
        <td {...selPct(7)}>{row.out_pct != null ? `${row.out_pct}%` : '—'}</td>
        <td {...sel(8)}>
          <div>{formatQty(row.balance_end ?? 0)}</div>
          <div className="disassembly-cost">{(formatCostRubles(row.balance_end_cost) || '0')} ₽</div>
        </td>
        <td className="td-check" data-status={row.check_status} title={row.check_balance != null ? `Остаток: ${formatQty(row.check_balance)}` : ''}>{row.check_balance != null ? (row.check_balance < 0 ? `Не хватает ${formatQty(Math.abs(row.check_balance))}` : row.check_balance > 0 ? `Остаток ${formatQty(row.check_balance)}` : 'Сходится') : (row.check_message ?? '—')}</td>
        {isDateRow ? (
          <td className="td-detail-btn">
            <button type="button" className="btn-detail-toggle" onClick={() => onToggleDetailPanel(dateStr)} aria-expanded={panelOpen} title={panelOpen ? 'Свернуть детализацию' : 'Детализация'}>
              {panelOpen ? '▲ Свернуть' : '▼ Детализация'}
            </button>
          </td>
        ) : <td />}
      </tr>
      {panelOpen && (
        <tr className="detail-row detail-panel-row">
          <td colSpan={11}>
            <div className="disassembly-detail-panel">
              <div className="disassembly-buttons">
                <button type="button" className="btn-full-detail" onClick={() => onRequestFullDetail(dateStr)} aria-expanded={fullDetailVisible} title="Всё по номенклатуре за день">
                  {fullDetailVisible ? '▲ Свернуть полную детализацию' : '▼ Полная детализация'}
                </button>
                <span className="disassembly-group">
                  <span className="disassembly-group-label">Поступление (наборы):</span>
                  <button type="button" className="btn-detail" onClick={() => onToggleExpand(dateStr, 'in', 'nomenclature')} aria-pressed={isExpanded('in', 'nomenclature')}>По номенклатуре</button>
                  <button type="button" className="btn-detail" onClick={() => onToggleExpand(dateStr, 'in', 'documents')} aria-pressed={isExpanded('in', 'documents')}>По документам</button>
                </span>
                <span className="disassembly-group">
                  <span className="disassembly-group-label">После разборки (ингредиенты):</span>
                  <button type="button" className="btn-detail" onClick={() => onToggleExpand(dateStr, 'ingredients', 'nomenclature')} aria-pressed={isExpanded('ingredients', 'nomenclature')}>По номенклатуре</button>
                  <button type="button" className="btn-detail" onClick={() => onToggleExpand(dateStr, 'ingredients', 'documents')} aria-pressed={isExpanded('ingredients', 'documents')}>По документам</button>
                </span>
                <span className="disassembly-group">
                  <span className="disassembly-group-label">Отгрузка:</span>
                  <button type="button" className="btn-detail" onClick={() => onToggleExpand(dateStr, 'out', 'nomenclature')} aria-pressed={isExpanded('out', 'nomenclature')}>По номенклатуре</button>
                  <button type="button" className="btn-detail" onClick={() => onToggleExpand(dateStr, 'out', 'documents')} aria-pressed={isExpanded('out', 'documents')}>По документам</button>
                </span>
                <span className="disassembly-group">
                  <span className="disassembly-group-label">Списание:</span>
                  <button type="button" className="btn-detail" onClick={() => onToggleExpand(dateStr, 'internal', 'nomenclature')} aria-pressed={isExpanded('internal', 'nomenclature')}>По номенклатуре</button>
                  <button type="button" className="btn-detail" onClick={() => onToggleExpand(dateStr, 'internal', 'documents')} aria-pressed={isExpanded('internal', 'documents')}>По документам</button>
                  <button type="button" className="btn-detail" onClick={() => onToggleExpand(dateStr, 'internal', 'articles')} aria-pressed={isExpanded('internal', 'articles')}>По статьям списания</button>
                </span>
              </div>
              {fullDetailVisible && (
                <div className="full-detail-block">
                  {fullDetailLoading && <div className="loading-inline">Загрузка полной детализации…</div>}
                  {!fullDetailLoading && fullDetailData && !fullDetailData.error && (
                    <FullDetailTable rows={fullDetailData.rows} formatCostRubles={formatCostRubles} formatQty={formatQty} />
                  )}
                  {!fullDetailLoading && fullDetailData && fullDetailData.error && <div className="disassembly-summary-error">Не удалось загрузить детализацию.</div>}
                </div>
              )}
              {[
                ['in', 'nomenclature'], ['in', 'documents'],
                ['ingredients', 'nomenclature'], ['ingredients', 'documents'],
                ['out', 'nomenclature'], ['out', 'documents'],
                ['internal', 'nomenclature'], ['internal', 'documents'], ['internal', 'articles'],
              ].map(([flow, type]) => {
                const key = detailKey(flow, type)
                if ((expanded && expanded[dateStr]) !== `${flow}-${type}`) return null
                const rawList = items(flow, type)
                const sortState = detailSort && detailSort[key]
                const list = rawList.length === 0 ? [] : [...rawList].sort((a, b) => {
                  if (!sortState) return 0
                  const mul = sortState.dir === 'asc' ? 1 : -1
                  if (sortState.by === 'quantity') {
                    return mul * ((Number(a.quantity) ?? 0) - (Number(b.quantity) ?? 0))
                  }
                  return mul * ((Number(a.cost) ?? 0) - (Number(b.cost) ?? 0))
                })
                return (
                  <div key={key} className="disassembly-detail-block">
                    <strong>{flow === 'in' ? 'Поступление' : flow === 'ingredients' ? 'Поступление после разборки' : flow === 'out' ? 'Отгрузка' : 'Списание'} — {type === 'nomenclature' ? 'номенклатура' : type === 'documents' ? 'документы' : 'статьи списания'}</strong>
                    {rawList.length === 0 && <div className="loading-inline">Загрузка...</div>}
                    {rawList.length > 0 && (
                      <>
                        <div className="disassembly-detail-sort">
                          <span className="disassembly-detail-sort-label">Сортировка:</span>
                          <button type="button" className={`btn-detail-sort ${sortState?.by === 'quantity' ? 'active' : ''}`} onClick={() => onDetailSort?.(key, 'quantity')} title={sortState?.by === 'quantity' ? (sortState.dir === 'desc' ? 'По убыванию (клик — по возрастанию)' : 'По возрастанию (клик — по убыванию)') : 'По количеству'}>
                            По количеству{sortState?.by === 'quantity' ? (sortState.dir === 'desc' ? ' ↓' : ' ↑') : ''}
                          </button>
                          <button type="button" className={`btn-detail-sort ${sortState?.by === 'cost' ? 'active' : ''}`} onClick={() => onDetailSort?.(key, 'cost')} title={sortState?.by === 'cost' ? (sortState.dir === 'desc' ? 'По убыванию' : 'По возрастанию') : 'По сумме'}>
                            По сумме{sortState?.by === 'cost' ? (sortState.dir === 'desc' ? ' ↓' : ' ↑') : ''}
                          </button>
                        </div>
                        <table className="disassembly-detail-table">
                          <thead>
                            <tr>
                              <th>Наименование</th>
                              <th className="disassembly-detail-th-qty">Количество</th>
                              <th className="disassembly-detail-th-cost">Сумма, ₽</th>
                            </tr>
                          </thead>
                          <tbody>
                            {list.map((item, i) => (
                              <tr key={i}>
                                <td className="detail-name">{item.name}</td>
                                <td className="disassembly-detail-td-qty">{formatQty(item.quantity)}</td>
                                <td className="disassembly-detail-td-cost">{formatCostRubles(item.cost) || '0'} ₽</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
