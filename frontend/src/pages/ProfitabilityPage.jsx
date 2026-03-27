import { useState, useEffect, useCallback, Fragment } from 'react'
import { apiFetch } from '../api'
import './ProfitabilityPage.css'

const TABS = [
  { key: 'analytics', label: 'Аналитика' },
  { key: 'upload', label: 'Загрузка файлов' },
  { key: 'work_rates', label: 'Стоимость работы' },
  { key: 'mappings', label: 'Маппинг артикулов' },
]

const DIRECTIONS = [
  { key: 'luminarc', label: 'Люминарк' },
  { key: 'engraving', label: 'Гравировка' },
  { key: 'tea', label: 'Чай' },
]

const METRIC_COLS = [
  { key: 'количество',               label: 'Кол-во',              fmt: 'qty', noPerUnit: true },
  { key: 'средняя_цена',             label: 'Ср. цена',             fmt: 'rub', noPerUnit: true },
  { key: 'реализация',               label: 'Реализация',           fmt: 'rub' },
  { key: 'себестоимость',            label: 'Себест. матер.',       fmt: 'rub' },
  { key: 'себестоимость_на_ед',      label: 'Себест. матер./ед',   fmt: 'rub', noPerUnit: true },
  { key: 'работа',                   label: 'ЗП',                   fmt: 'rub' },
  { key: 'итого_себестоимость',      label: 'Итого себест.',        fmt: 'rub' },
  { key: 'доля_себестоимости',       label: 'Доля себест.',         fmt: 'pct', noPerUnit: true },
  { key: 'услуги_мп',                label: 'Услуги МП',            fmt: 'rub' },
  { key: 'услуги_мп_на_ед',          label: 'Услуги МП/ед',        fmt: 'rub', noPerUnit: true },
  { key: 'логистика',                label: 'Логистика',            fmt: 'rub' },
  { key: 'логистика_на_ед',          label: 'Логистика/ед',        fmt: 'rub', noPerUnit: true },
  { key: 'реклама',                  label: 'Реклама',              fmt: 'rub' },
  { key: 'маржа_до_рекламы',         label: 'Маржа до рекл.',      fmt: 'rub' },
  { key: 'маржа_до_рекламы_на_ед',   label: 'Маржа до рекл./ед',  fmt: 'rub', noPerUnit: true },
  { key: 'маржа_после_рекламы',      label: 'Маржа после рекл.',   fmt: 'rub' },
  { key: 'маржа_после_рекламы_на_ед',label: 'Маржа после рекл./ед',fmt: 'rub', noPerUnit: true },
  { key: 'рентабельность_пct',       label: 'Рент. (%)',            fmt: 'pct', noPerUnit: true },
]

function fmt(value, type) {
  if (value === null || value === undefined || isNaN(value)) return '—'
  if (type === 'qty') return Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 0 })
  if (type === 'pct') return `${Number(value).toFixed(1)}%`
  if (type === 'rub') {
    const n = Number(value)
    return n.toLocaleString('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 })
  }
  return value
}

function colorForRent(pct) {
  if (pct === null || pct === undefined || isNaN(pct)) return ''
  if (pct >= 20) return 'cell-positive'
  if (pct >= 5) return 'cell-neutral'
  if (pct < 0) return 'cell-negative'
  return 'cell-warn'
}

// ─────────────────────────────────────────────────────────────────────────────
// Upload Tab
// ─────────────────────────────────────────────────────────────────────────────
function UploadTab({ onUploaded }) {
  const [periodsInfo, setPeriodsInfo] = useState(null)
  const [weeklyFile, setWeeklyFile] = useState(null)
  const [periodLabel, setPeriodLabel] = useState('')
  const [nomFile, setNomFile] = useState(null)
  const [costsFile, setCostsFile] = useState(null)
  const [status, setStatus] = useState({})
  const [loading, setLoading] = useState({})

  const loadInfo = useCallback(async () => {
    try {
      const d = await apiFetch('/api/profitability/periods')
      setPeriodsInfo(d)
    } catch (e) {
      console.error(e)
    }
  }, [])

  useEffect(() => { loadInfo() }, [loadInfo])

  async function uploadFile(kind, file, extra = {}) {
    setLoading(l => ({ ...l, [kind]: true }))
    setStatus(s => ({ ...s, [kind]: null }))
    try {
      const fd = new FormData()
      fd.append('file', file)
      Object.entries(extra).forEach(([k, v]) => fd.append(k, v))
      const r = await fetch(`/api/profitability/upload/${kind}`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Ошибка загрузки')
      setStatus(s => ({ ...s, [kind]: { ok: true, msg: kind === 'weekly'
        ? `Период "${extra.period_label || extra.period_id}" — файлов загружено: ${d.files_count}`
        : `Загружено записей: ${d.count}` } }))
      loadInfo()
      onUploaded?.()
    } catch (e) {
      setStatus(s => ({ ...s, [kind]: { ok: false, msg: e.message } }))
    } finally {
      setLoading(l => ({ ...l, [kind]: false }))
    }
  }

  async function deletePeriod(id) {
    if (!window.confirm(`Удалить период "${id}"?`)) return
    try {
      await apiFetch(`/api/profitability/periods/${id}`, { method: 'DELETE' })
      loadInfo()
      onUploaded?.()
    } catch (e) {
      alert(e.message)
    }
  }

  return (
    <div className="prof-upload">
      <div className="prof-upload-grid">
        {/* Weekly report */}
        <div className="prof-upload-card">
          <h3>Еженедельный отчёт</h3>
          <p className="prof-upload-hint">Детализированный отчёт Wildberries (.xlsx)<br/><span style={{color:'var(--text-muted)',fontSize:'0.8em'}}>Неделя определяется автоматически по дате продажи. Два отчёта за одну неделю складываются.</span></p>
          <div className="prof-upload-row">
            <label className="prof-field-label">Название периода <span style={{color:'var(--text-muted)'}}>(необязательно)</span></label>
            <input
              className="prof-input"
              value={periodLabel}
              onChange={e => setPeriodLabel(e.target.value)}
              placeholder="Автоматически из дат отчёта"
            />
          </div>
          <div className="prof-upload-row">
            <input type="file" accept=".xlsx,.xls" onChange={e => setWeeklyFile(e.target.files[0])} />
          </div>
          <button
            className="prof-btn"
            disabled={!weeklyFile || loading.weekly}
            onClick={() => uploadFile('weekly', weeklyFile, {
              period_id: '',
              period_label: periodLabel || '',
            })}
          >
            {loading.weekly ? 'Загрузка...' : 'Загрузить отчёт'}
          </button>
          {status.weekly && (
            <div className={`prof-status ${status.weekly.ok ? 'ok' : 'err'}`}>{status.weekly.msg}</div>
          )}
        </div>

        {/* Nomenclature */}
        <div className="prof-upload-card">
          <h3>Виды номенклатуры</h3>
          <p className="prof-upload-hint">
            1C-отчёт «Отчёт по категориям товаров» (.xlsx)
            {periodsInfo?.has_nomenclature && <span className="prof-badge-ok"> — загружен</span>}
          </p>
          <div className="prof-upload-row">
            <input type="file" accept=".xlsx,.xls" onChange={e => setNomFile(e.target.files[0])} />
          </div>
          <button
            className="prof-btn"
            disabled={!nomFile || loading.nomenclature}
            onClick={() => uploadFile('nomenclature', nomFile)}
          >
            {loading.nomenclature ? 'Загрузка...' : 'Загрузить'}
          </button>
          {status.nomenclature && (
            <div className={`prof-status ${status.nomenclature.ok ? 'ok' : 'err'}`}>{status.nomenclature.msg}</div>
          )}
        </div>

        {/* Costs */}
        <div className="prof-upload-card">
          <h3>Себестоимости</h3>
          <p className="prof-upload-hint">
            1C-отчёт «Себестоимость» (.xlsx)
            {periodsInfo?.has_costs && <span className="prof-badge-ok"> — загружен</span>}
          </p>
          <div className="prof-upload-row">
            <input type="file" accept=".xlsx,.xls" onChange={e => setCostsFile(e.target.files[0])} />
          </div>
          <button
            className="prof-btn"
            disabled={!costsFile || loading.costs}
            onClick={() => uploadFile('costs', costsFile)}
          >
            {loading.costs ? 'Загрузка...' : 'Загрузить'}
          </button>
          {status.costs && (
            <div className={`prof-status ${status.costs.ok ? 'ok' : 'err'}`}>{status.costs.msg}</div>
          )}
        </div>
      </div>

      {/* Periods list */}
      {periodsInfo?.periods?.length > 0 && (
        <div className="prof-periods-list">
          <h3>Загруженные периоды</h3>
          <table className="prof-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Название</th>
                <th>Файл</th>
                <th>Дата загрузки</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {periodsInfo.periods.map(p => (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td>{p.label}</td>
                  <td className="cell-muted">{p.filename}</td>
                  <td className="cell-muted">{new Date(p.created_at * 1000).toLocaleDateString('ru-RU')}</td>
                  <td>
                    <button className="prof-btn-del" onClick={() => deletePeriod(p.id)}>Удалить</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Work Rates Tab
// ─────────────────────────────────────────────────────────────────────────────
function WorkRatesTab({ periods }) {
  const [allRates, setAllRates] = useState(null)
  const [selectedPeriod, setSelectedPeriod] = useState('default')
  const [rates, setRates] = useState({ luminarc: '', engraving: '', tea: '' })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const loadRates = useCallback(async () => {
    try {
      const d = await apiFetch('/api/profitability/work-rates')
      setAllRates(d)
    } catch (e) {
      console.error(e)
    }
  }, [])

  useEffect(() => { loadRates() }, [loadRates])

  useEffect(() => {
    if (!allRates) return
    const r = allRates[selectedPeriod] || allRates['default'] || {}
    setRates({
      luminarc: r.luminarc ?? '',
      engraving: r.engraving ?? '',
      tea: r.tea ?? '',
    })
  }, [selectedPeriod, allRates])

  async function save() {
    setSaving(true)
    setSaved(false)
    try {
      await apiFetch('/api/profitability/work-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period_id: selectedPeriod,
          rates: {
            luminarc: parseFloat(rates.luminarc) || 0,
            engraving: parseFloat(rates.engraving) || 0,
            tea: parseFloat(rates.tea) || 0,
          },
        }),
      })
      setSaved(true)
      loadRates()
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="prof-work-rates">
      <h3>Стоимость работы на единицу продукции</h3>
      <p className="prof-upload-hint">
        Введите стоимость работы (руб/шт) для каждого направления и периода.
        «По умолчанию» применяется если для конкретного периода ставка не задана.
      </p>

      <div className="prof-wr-period">
        <label className="prof-field-label">Период</label>
        <select
          className="prof-select"
          value={selectedPeriod}
          onChange={e => setSelectedPeriod(e.target.value)}
        >
          <option value="default">По умолчанию</option>
          {periods.map(p => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </div>

      <div className="prof-wr-grid">
        {DIRECTIONS.map(dir => (
          <div key={dir.key} className="prof-wr-card">
            <div className="prof-wr-label">{dir.label}</div>
            <input
              className="prof-input prof-wr-input"
              type="number"
              min="0"
              step="0.01"
              value={rates[dir.key]}
              onChange={e => setRates(r => ({ ...r, [dir.key]: e.target.value }))}
              placeholder="0.00"
            />
            <div className="prof-wr-unit">руб/шт</div>
          </div>
        ))}
      </div>

      <button className="prof-btn" onClick={save} disabled={saving}>
        {saving ? 'Сохранение...' : saved ? 'Сохранено!' : 'Сохранить'}
      </button>

      {allRates && Object.keys(allRates).length > 1 && (
        <div className="prof-wr-history">
          <h4>Все установленные ставки</h4>
          <table className="prof-table">
            <thead>
              <tr>
                <th>Период</th>
                {DIRECTIONS.map(d => <th key={d.key}>{d.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {Object.entries(allRates).map(([pid, r]) => (
                <tr key={pid}>
                  <td>{pid === 'default' ? 'По умолчанию' : (periods.find(p => p.id === pid)?.label || pid)}</td>
                  {DIRECTIONS.map(d => <td key={d.key}>{r[d.key] ?? 0} ₽</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Mappings Tab
// ─────────────────────────────────────────────────────────────────────────────
function MappingsTab({ periods, selectedPeriod }) {
  const [unmatched, setUnmatched] = useState([])
  const [allVids, setAllVids] = useState([])
  const [pending, setPending] = useState({}) // {артикул: вид}
  const [saving, setSaving] = useState(false)
  const [loadPeriod, setLoadPeriod] = useState(selectedPeriod || '')
  const [loading, setLoading] = useState(false)
  const [mappings, setMappings] = useState({})

  async function loadUnmatched() {
    if (!loadPeriod) return
    setLoading(true)
    try {
      const d = await apiFetch(`/api/profitability/unmatched?period_id=${encodeURIComponent(loadPeriod)}`)
      setUnmatched(d.unmatched || [])
      setAllVids(d.all_vids || [])
    } catch (e) {
      alert(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadMappings() {
    try {
      const d = await apiFetch('/api/profitability/mappings')
      setMappings(d.mappings || {})
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => { loadMappings() }, [])

  useEffect(() => {
    if (selectedPeriod) setLoadPeriod(selectedPeriod)
  }, [selectedPeriod])

  async function saveMappings() {
    const toSave = Object.fromEntries(
      Object.entries(pending).filter(([, v]) => v && v.trim())
    )
    if (Object.keys(toSave).length === 0) return
    setSaving(true)
    try {
      await apiFetch('/api/profitability/mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mappings: toSave }),
      })
      setPending({})
      loadMappings()
      loadUnmatched()
    } catch (e) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="prof-mappings">
      <h3>Маппинг артикулов → вид номенклатуры</h3>
      <p className="prof-upload-hint">
        Артикулы из еженедельного отчёта, которые не найдены в файле видов номенклатуры.
        Назначьте вид вручную — он будет сохранён и применён ко всем периодам.
      </p>

      <div className="prof-map-controls">
        <select
          className="prof-select"
          value={loadPeriod}
          onChange={e => setLoadPeriod(e.target.value)}
        >
          <option value="">— выберите период —</option>
          {periods.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <button className="prof-btn" onClick={loadUnmatched} disabled={!loadPeriod || loading}>
          {loading ? 'Загрузка...' : 'Показать несопоставленные'}
        </button>
      </div>

      {unmatched.length > 0 && (
        <>
          <div className="prof-map-count">{unmatched.length} артикулов без вида</div>
          <div className="prof-map-table-wrap">
            <table className="prof-table">
              <thead>
                <tr>
                  <th>Артикул</th>
                  <th>Назначить вид номенклатуры</th>
                </tr>
              </thead>
              <tbody>
                {unmatched.map(art => (
                  <tr key={art}>
                    <td className="prof-map-art">{art}</td>
                    <td>
                      <input
                        list={`vids-${art}`}
                        className="prof-input prof-map-input"
                        value={pending[art] ?? ''}
                        onChange={e => setPending(p => ({ ...p, [art]: e.target.value }))}
                        placeholder="Введите или выберите вид"
                      />
                      <datalist id={`vids-${art}`}>
                        {allVids.map(v => <option key={v} value={v} />)}
                      </datalist>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="prof-btn"
            onClick={saveMappings}
            disabled={saving || Object.keys(pending).every(k => !pending[k]?.trim())}
          >
            {saving ? 'Сохранение...' : 'Сохранить маппинги'}
          </button>
        </>
      )}

      {Object.keys(mappings).length > 0 && (
        <div className="prof-map-existing">
          <h4>Сохранённые маппинги ({Object.keys(mappings).length})</h4>
          <div className="prof-map-table-wrap">
            <table className="prof-table">
              <thead>
                <tr><th>Артикул</th><th>Вид номенклатуры</th></tr>
              </thead>
              <tbody>
                {Object.entries(mappings).map(([art, vid]) => (
                  <tr key={art}>
                    <td className="prof-map-art">{art}</td>
                    <td>{vid}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics Tab
// ─────────────────────────────────────────────────────────────────────────────
function AnalyticsTab({ periods }) {
  const [period, setPeriod] = useState('')
  const [comparePeriod, setComparePeriod] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState({})
  const [showPerUnit, setShowPerUnit] = useState(false)
  const [filterDir, setFilterDir] = useState('all')

  async function load() {
    if (!period) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ period_id: period })
      if (comparePeriod) params.set('compare_id', comparePeriod)
      const d = await apiFetch(`/api/profitability/data?${params}`)
      setData(d)
      setExpanded({})
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (periods.length > 0 && !period) setPeriod(periods[0].id)
  }, [periods])

  function toggleExpand(vid) {
    setExpanded(e => ({ ...e, [vid]: !e[vid] }))
  }

  function expandAll() {
    const all = {}
    data?.rows.forEach(r => { all[r.вид] = true })
    setExpanded(all)
  }
  function collapseAll() { setExpanded({}) }


  const filteredRows = data?.rows?.filter(row => {
    if (filterDir === 'all') return true
    return row.артикулы?.some(a => a.направление === filterDir)
  }) || []

  // Итоги по всем видам
  function totalRow(rows) {
    const t = { количество: 0, реализация: 0, себестоимость: 0, работа: 0, итого_себестоимость: 0, логистика: 0, услуги_мп: 0, реклама: 0, маржа_до_рекламы: 0, маржа_после_рекламы: 0 }
    rows.forEach(r => {
      Object.keys(t).forEach(k => { t[k] += (r[k] || 0) })
    })
    const qty = t.количество || 0
    const pu = (v) => qty ? v / qty : 0
    t.средняя_цена = pu(t.реализация)
    t.доля_себестоимости = t.реализация ? t.итого_себестоимость / t.реализация * 100 : 0
    t.рентабельность_пct = t.реализация ? t.маржа_после_рекламы / t.реализация * 100 : 0
    t.себестоимость_на_ед = pu(t.себестоимость)
    t.услуги_мп_на_ед = pu(t.услуги_мп)
    t.логистика_на_ед = pu(t.логистика)
    t.маржа_до_рекламы_на_ед = pu(t.маржа_до_рекламы)
    t.маржа_после_рекламы_на_ед = pu(t.маржа_после_рекламы)
    return t
  }

  // Compare: найти вид в compare
  function getCompareRow(vid) {
    if (!data?.compare) return null
    return data.compare.rows.find(r => r.вид === vid) || null
  }

  return (
    <div className="prof-analytics">
      <div className="prof-controls">
        <div className="prof-controls-row">
          <div className="prof-control-group">
            <label className="prof-field-label">Период</label>
            <select className="prof-select" value={period} onChange={e => setPeriod(e.target.value)}>
              <option value="">— выберите —</option>
              {periods.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          <div className="prof-control-group">
            <label className="prof-field-label">Сравнить с</label>
            <select className="prof-select" value={comparePeriod} onChange={e => setComparePeriod(e.target.value)}>
              <option value="">— без сравнения —</option>
              {periods.filter(p => p.id !== period).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          <div className="prof-control-group">
            <label className="prof-field-label">Направление</label>
            <select className="prof-select" value={filterDir} onChange={e => setFilterDir(e.target.value)}>
              <option value="all">Все</option>
              {DIRECTIONS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          </div>
          <button className="prof-btn" onClick={load} disabled={!period || loading}>
            {loading ? 'Загрузка...' : 'Рассчитать'}
          </button>
        </div>
        {data && (
          <div className="prof-controls-row prof-controls-row-sm">
            <label className="prof-toggle">
              <input type="checkbox" checked={showPerUnit} onChange={e => setShowPerUnit(e.target.checked)} />
              На единицу
            </label>
            <button className="prof-btn-sm" onClick={expandAll}>Раскрыть все</button>
            <button className="prof-btn-sm" onClick={collapseAll}>Свернуть все</button>
            {data.unmatched?.length > 0 && (
              <span className="prof-warn-badge">{data.unmatched.length} артикулов без вида</span>
            )}
          </div>
        )}
      </div>

      {error && <div className="prof-error">{error}</div>}

      {data && (
        <div className="prof-table-wrap">
          <table className="prof-table prof-table-main">
            <thead>
              <tr>
                <th className="col-name">Вид / Артикул</th>
                {METRIC_COLS.map(c => (
                  <th key={c.key} className="col-num">{c.label}{showPerUnit && !c.noPerUnit ? '/ед' : ''}</th>
                ))}
                {data.compare && <th className="col-num">Рент. % (сравн.)</th>}
                {data.compare && <th className="col-num">∆ Рент. %</th>}
              </tr>
            </thead>
            <tbody>
              {/* Итоговая строка */}
              {(() => {
                const t = totalRow(filteredRows)
                return (
                  <tr className="row-total">
                    <td className="col-name">ИТОГО</td>
                    {METRIC_COLS.map(c => {
                      const key = showPerUnit && !c.noPerUnit
                        ? `${c.key}_на_ед` : c.key
                      const v = t[key] ?? t[c.key]
                      return (
                        <td key={c.key} className={`col-num ${c.key === 'рентабельность_пct' ? colorForRent(v) : ''}`}>
                          {fmt(v, c.fmt)}
                        </td>
                      )
                    })}
                    {data.compare && <td className="col-num">—</td>}
                    {data.compare && <td className="col-num">—</td>}
                  </tr>
                )
              })()}

              {filteredRows.map(row => {
                const isExpanded = expanded[row.вид]
                const compareRow = getCompareRow(row.вид)
                return (
                  <Fragment key={row.вид}>
                    <tr className="row-vid" onClick={() => toggleExpand(row.вид)}>
                      <td className="col-name">
                        <span className="expand-icon">{isExpanded ? '▼' : '▶'}</span>
                        {row.вид}
                      </td>
                      {METRIC_COLS.map(c => {
                        const key = showPerUnit && !c.noPerUnit
                          ? `${c.key}_на_ед` : c.key
                        const v = row[key] ?? row[c.key]
                        return (
                          <td key={c.key} className={`col-num ${c.key === 'рентабельность_пct' ? colorForRent(v) : ''}`}>
                            {fmt(v, c.fmt)}
                          </td>
                        )
                      })}
                      {data.compare && (
                        <td className={`col-num ${colorForRent(compareRow?.рентабельность_пct)}`}>
                          {compareRow ? fmt(compareRow.рентабельность_пct, 'pct') : '—'}
                        </td>
                      )}
                      {data.compare && (
                        <td className={`col-num ${colorForRent((row.рентабельность_пct || 0) - (compareRow?.рентабельность_пct || 0))}`}>
                          {compareRow
                            ? `${((row.рентабельность_пct || 0) - (compareRow.рентабельность_пct || 0)).toFixed(1)}%`
                            : '—'}
                        </td>
                      )}
                    </tr>
                    {isExpanded && row.артикулы.map(art => (
                      <tr key={art.артикул} className="row-art">
                        <td className="col-name col-art">
                          <span className="art-badge">{art.направление}</span>
                          {art.артикул}
                        </td>
                        {METRIC_COLS.map(c => {
                          const key = showPerUnit && !c.noPerUnit
                            ? `${c.key}_на_ед` : c.key
                          const v = art[key] ?? art[c.key]
                          return (
                            <td key={c.key} className={`col-num ${c.key === 'рентабельность_пct' ? colorForRent(v) : ''}`}>
                              {fmt(v, c.fmt)}
                            </td>
                          )
                        })}
                        {data.compare && <td className="col-num">—</td>}
                        {data.compare && <td className="col-num">—</td>}
                      </tr>
                    ))}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {data?.unmatched?.length > 0 && (
        <details className="prof-unmatched">
          <summary>{data.unmatched.length} артикулов без вида номенклатуры (не участвуют в расчёте)</summary>
          <div className="prof-unmatched-list">
            {data.unmatched.join(', ')}
          </div>
        </details>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────
export default function ProfitabilityPage() {
  const [tab, setTab] = useState('analytics')
  const [periods, setPeriods] = useState([])

  const loadPeriods = useCallback(async () => {
    try {
      const d = await apiFetch('/api/profitability/periods')
      setPeriods(d.periods || [])
    } catch (e) {
      console.error(e)
    }
  }, [])

  useEffect(() => { loadPeriods() }, [loadPeriods])

  return (
    <div className="prof-page">
      <div className="prof-header">
        <h2 className="prof-title">Рентабельность</h2>
        <div className="prof-tabs">
          {TABS.map(t => (
            <button
              key={t.key}
              className={`prof-tab ${tab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="prof-content">
        {tab === 'analytics' && <AnalyticsTab periods={periods} />}
        {tab === 'upload' && <UploadTab onUploaded={loadPeriods} />}
        {tab === 'work_rates' && <WorkRatesTab periods={periods} />}
        {tab === 'mappings' && <MappingsTab periods={periods} selectedPeriod={periods[0]?.id} />}
      </div>
    </div>
  )
}
