import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch, API } from '../api'
import html2pdf from 'html2pdf.js'
import './WorkforcePage.css'

const PRODUCTIONS = {
  tea: 'ЧАЙ',
  engraving: 'ГРАВИРОВКА',
  luminarc: 'ЛЮМИНАРК',
}

const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]

const DAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']

// Должности с 8-часовым рабочим днём; все остальные — 11 часов
const EIGHT_HOUR_POSITIONS = [
  'руководитель производства',
  'начальник цеха чай',
  'начальник цеха гравировка',
  'начальник цеха гравировки',
  'техник',
  'уборщица',
  'начальник склада',
  'и.о. начальника цеха',
]

function getDefaultHours(position) {
  const p = (position || '').toLowerCase().trim()
  if (EIGHT_HOUR_POSITIONS.some(ep => p === ep || p.startsWith(ep) || ep.startsWith(p))) {
    return 8
  }
  return 11
}

function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

function getDayOfWeek(year, month, day) {
  return new Date(year, month - 1, day).getDay()
}

function isWeekend(year, month, day) {
  const dow = getDayOfWeek(year, month, day)
  return dow === 0 || dow === 6
}

function fmtCost(v) {
  if (!v && v !== 0) return '—'
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(v) + ' ₽'
}

// ─── Модальное окно импорта TSV ───────────────────────────────────────────────
function ImportModal({ title, hint, onImport, onClose }) {
  const [tsv, setTsv] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleImport = async () => {
    if (!tsv.trim()) { setError('Вставьте данные из Google Таблиц'); return }
    setLoading(true)
    setError(null)
    try {
      await onImport(tsv)
      onClose()
    } catch (e) {
      setError(e.message || 'Ошибка импорта')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="wf-modal-overlay" onClick={onClose}>
      <div className="wf-modal" onClick={e => e.stopPropagation()}>
        <div className="wf-modal-header">
          <h3>{title}</h3>
          <button className="wf-modal-close" onClick={onClose}>✕</button>
        </div>
        <p className="wf-modal-hint">{hint}</p>
        <textarea
          className="wf-modal-textarea"
          placeholder="Вставьте сюда данные из Google Таблиц (Ctrl+V или Cmd+V)"
          value={tsv}
          onChange={e => setTsv(e.target.value)}
          rows={12}
          autoFocus
        />
        {error && <div className="wf-error">{error}</div>}
        <div className="wf-modal-actions">
          <button className="wf-btn wf-btn-primary" onClick={handleImport} disabled={loading}>
            {loading ? 'Импорт...' : 'Импортировать'}
          </button>
          <button className="wf-btn wf-btn-secondary" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  )
}

// ─── Модальное окно комбинированного импорта «График + Табель» ───────────────
function CombinedImportModal({ production, defaultYear, defaultMonth, onSuccess, onClose }) {
  const now = new Date()
  const [year, setYear]   = useState(defaultYear  ?? now.getFullYear())
  const [month, setMonth] = useState(defaultMonth ?? now.getMonth() + 1)
  const [tsv, setTsv]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [result, setResult]   = useState(null)

  const handleImport = async () => {
    if (!tsv.trim()) { setError('Вставьте данные из Google Таблиц'); return }
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch(
        `${API}/workforce/combined-import/${production}/${year}/${month}`,
        { method: 'POST', body: JSON.stringify({ tsv }) }
      )
      setResult(res)
      onSuccess?.(res, year, month)
    } catch (e) {
      setError(e.message || 'Ошибка импорта')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="wf-modal-overlay" onClick={onClose}>
      <div className="wf-modal wf-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="wf-modal-header">
          <h3>Импорт: График + Табель из Google Таблиц</h3>
          <button className="wf-modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Выбор месяца */}
        <div className="wf-combined-month-row">
          <span className="wf-combined-month-label">Производство:</span>
          <strong style={{color:'var(--accent)'}}>{PRODUCTIONS[production]}</strong>
          <span className="wf-combined-month-label" style={{marginLeft:'1rem'}}>Месяц:</span>
          <select className="wf-select" value={month} onChange={e => setMonth(Number(e.target.value))}>
            {MONTH_NAMES.map((n, i) => <option key={i+1} value={i+1}>{n}</option>)}
          </select>
          <select className="wf-select" value={year} onChange={e => setYear(Number(e.target.value))}>
            {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y =>
              <option key={y} value={y}>{y}</option>
            )}
          </select>
        </div>

        <div className="wf-modal-hint">
          <strong>Формат таблицы:</strong> первые 3 столбца — ФИО, Должность, Статус. Далее — пары столбцов на каждый день: первый = <em>план (График)</em>, второй = <em>факт (Табель)</em>. Строка заголовка должна содержать номера дней (1, 2, 3…) над колонками плана.
          <br />
          <code style={{fontSize:'0.75rem', opacity:0.8}}>ФИО  |  Должность  |  Статус  |  1  |     |  2  |     |  3  |  …</code>
          <br />
          <code style={{fontSize:'0.75rem', opacity:0.8}}>Иванов  |  Оператор  |  штат  |  8  |  8  |  8  |  7  |  8  |  …</code>
        </div>

        {!result ? (
          <>
            <textarea
              className="wf-modal-textarea"
              placeholder="Вставьте сюда таблицу из Google Sheets (Ctrl+V / Cmd+V)"
              value={tsv}
              onChange={e => setTsv(e.target.value)}
              rows={14}
              autoFocus
            />
            {error && <div className="wf-error" style={{marginTop:'0.5rem'}}>{error}</div>}
            <div className="wf-modal-actions">
              <button className="wf-btn wf-btn-primary" onClick={handleImport} disabled={loading}>
                {loading ? 'Импорт...' : `Импортировать в ${MONTH_NAMES[month-1]} ${year}`}
              </button>
              <button className="wf-btn wf-btn-secondary" onClick={onClose}>Отмена</button>
            </div>
          </>
        ) : (
          <div className="wf-combined-result">
            <div className="wf-combined-result-icon">✓</div>
            <div className="wf-combined-result-text">
              <strong>Импорт завершён успешно</strong>
              <br />
              {PRODUCTIONS[production]} · {MONTH_NAMES[month-1]} {year}
              <br />
              Сотрудников: <strong>{result.employees}</strong> &nbsp;·&nbsp;
              Строк табеля: <strong>{result.timesheet_filled}</strong>
            </div>
            <button className="wf-btn wf-btn-primary" onClick={onClose} style={{marginTop:'1rem'}}>
              Готово
            </button>
          </div>
        )}
      </div>
    </div>
  )
}


// ─── Справочник (матричный вид) ───────────────────────────────────────────────
function ReferenceTab() {
  const [reference, setReference] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [showImport, setShowImport] = useState(false)
  // Редактирование ячейки: {position, status}
  const [editCell, setEditCell] = useState(null)
  const [editValue, setEditValue] = useState('')
  // Добавление новой должности / нового статуса
  const [addingPosition, setAddingPosition] = useState(false)
  const [newPositionName, setNewPositionName] = useState('')
  const [addingStatus, setAddingStatus] = useState(false)
  const [newStatusName, setNewStatusName] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    apiFetch(`${API}/workforce/reference`)
      .then(data => { setReference(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const showMsg = (text, ok = true) => {
    setMsg({ text, ok })
    setTimeout(() => setMsg(null), 3000)
  }

  const save = async (entries) => {
    setSaving(true)
    try {
      await apiFetch(`${API}/workforce/reference`, { method: 'PUT', body: JSON.stringify(entries) })
      setReference(entries)
      showMsg('Сохранено')
    } catch (e) {
      showMsg(e.message || 'Ошибка', false)
    } finally {
      setSaving(false)
    }
  }

  const handleImport = async (tsv) => {
    const res = await apiFetch(`${API}/workforce/reference/import`, {
      method: 'POST', body: JSON.stringify({ tsv }),
    })
    setReference(res.entries || [])
    showMsg(`Импортировано ${res.count} записей`)
  }

  // Строим матрицу: уникальные должности и статусы (в порядке появления)
  // Фильтруем внутренние placeholder-значения
  const positions = [...new Set(reference.map(r => r.position).filter(p => p && p !== '__placeholder__'))]
  const statuses  = [...new Set(reference.map(r => r.status).filter(s => s && s !== '__placeholder__'))]

  // Поиск ставки по ячейке
  const getRate = (pos, status) => {
    const entry = reference.find(r => r.position === pos && r.status === status)
    return entry ? entry.hourly_rate : null
  }

  // Клик по ячейке — открываем редактор
  const handleCellClick = (pos, status) => {
    const rate = getRate(pos, status)
    setEditCell({ position: pos, status })
    setEditValue(rate !== null ? String(rate) : '')
  }

  // Сохранение ячейки по blur / Enter
  const handleCellSave = () => {
    if (!editCell) return
    const { position, status } = editCell
    const raw = editValue.trim().replace(',', '.')
    let newRef

    if (!raw || raw.toLowerCase() === 'х' || raw.toLowerCase() === 'x' || raw === '-') {
      // Убираем запись (ставим «х»)
      newRef = reference.filter(r => !(r.position === position && r.status === status))
    } else {
      const rate = parseFloat(raw)
      if (isNaN(rate) || rate < 0) { setEditCell(null); return }
      const exists = reference.some(r => r.position === position && r.status === status)
      if (exists) {
        newRef = reference.map(r =>
          r.position === position && r.status === status ? { ...r, hourly_rate: rate } : r
        )
      } else {
        newRef = [...reference, { position, status, hourly_rate: rate }]
      }
    }
    save(newRef)
    setEditCell(null)
  }

  // Добавить новую должность (строку)
  const handleAddPosition = () => {
    const name = newPositionName.trim()
    if (!name) { setAddingPosition(false); setNewPositionName(''); return }
    if (positions.filter(p => p !== '__placeholder__').includes(name)) {
      setAddingPosition(false); setNewPositionName(''); return
    }
    // Добавляем строку. Если статусов нет — просто создаём пустую запись-маркер
    const realStatuses = statuses.filter(s => s)
    const newEntries = realStatuses.length > 0
      ? realStatuses.map(s => ({ position: name, status: s, hourly_rate: 0 }))
      : [{ position: name, status: '__placeholder__', hourly_rate: 0 }]
    // Убираем __placeholder__ записи если уже есть реальные данные
    const cleaned = reference.filter(r => !(r.position === '__placeholder__' || r.status === '__placeholder__'))
    save([...cleaned, ...newEntries])
    setAddingPosition(false)
    setNewPositionName('')
  }

  // Добавить новый статус (столбец) — только по Enter или кнопке ✓ (не onBlur)
  const handleAddStatus = () => {
    const name = newStatusName.trim()
    if (!name) { setAddingStatus(false); setNewStatusName(''); return }
    if (statuses.includes(name)) {
      setAddingStatus(false); setNewStatusName(''); return
    }
    // Если есть должности — добавляем для каждой; иначе просто добавляем
    // фиктивную запись с пустой должностью, которая станет видна как пустой столбец
    const newEntries = positions.length > 0
      ? positions.map(p => ({ position: p, status: name, hourly_rate: 0 }))
      : [{ position: '__placeholder__', status: name, hourly_rate: 0 }]
    save([...reference, ...newEntries])
    setAddingStatus(false)
    setNewStatusName('')
  }

  // Удалить должность (всю строку)
  const handleDeletePosition = (pos) => {
    if (!confirm(`Удалить должность «${pos}» и все её ставки?`)) return
    save(reference.filter(r => r.position !== pos))
  }

  // Удалить статус (весь столбец)
  const handleDeleteStatus = (status) => {
    if (!confirm(`Удалить статус «${status}» для всех должностей?`)) return
    save(reference.filter(r => r.status !== status))
  }

  if (loading) return <div className="wf-loading">Загрузка...</div>

  return (
    <div className="wf-reference">
      {/* Тулбар */}
      <div className="wf-toolbar">
        <h3>Справочник должностей и ставок</h3>
        <div className="wf-toolbar-actions">
          {msg && <span className={`wf-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</span>}
          {saving && <span className="wf-msg">Сохранение...</span>}
          <button className="wf-btn wf-btn-secondary" onClick={() => setShowImport(true)}>
            ↓ Импорт из Google Таблиц
          </button>
          <button className="wf-btn wf-btn-secondary" onClick={() => setAddingStatus(true)}>
            + Статус (столбец)
          </button>
          <button className="wf-btn wf-btn-primary" onClick={() => setAddingPosition(true)}>
            + Должность (строка)
          </button>
        </div>
      </div>

      {/* Матрица — отображается всегда, даже если справочник пуст */}
      <div className="wf-table-scroll" style={{padding:'0 0 0.5rem'}}>
        {reference.length === 0 && !addingStatus && !addingPosition && (
          <div className="wf-empty" style={{padding:'1.5rem', textAlign:'center'}}>
            Справочник пуст. Нажмите <strong>«+ Статус»</strong> чтобы добавить колонку, затем <strong>«+ Должность»</strong> чтобы добавить строку. Или используйте <strong>«Импорт из Google Таблиц»</strong>.
          </div>
        )}
        {(reference.length > 0 || addingStatus || addingPosition) && (
          <table className="wf-ref-matrix">
            <thead>
              <tr>
                <th className="wf-ref-corner">Должность</th>
                {statuses.map(s => (
                  <th key={s} className="wf-ref-status-header">
                    <div className="wf-ref-status-cell">
                      <span>{s}</span>
                      <button
                        className="wf-ref-del-col"
                        onClick={() => handleDeleteStatus(s)}
                        title={`Удалить столбец «${s}»`}
                      >×</button>
                    </div>
                  </th>
                ))}
                {addingStatus ? (
                  <th className="wf-ref-status-header">
                    <div className="wf-ref-status-cell">
                      <input
                        className="wf-ref-new-input"
                        placeholder="Статус..."
                        value={newStatusName}
                        autoFocus
                        onChange={e => setNewStatusName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleAddStatus()
                          if (e.key === 'Escape') { setAddingStatus(false); setNewStatusName('') }
                        }}
                        style={{width:'80px'}}
                      />
                      <button className="wf-btn-icon wf-btn-save" onClick={handleAddStatus} title="Добавить">✓</button>
                      <button className="wf-btn-icon wf-btn-cancel" onClick={() => { setAddingStatus(false); setNewStatusName('') }} title="Отмена">✕</button>
                    </div>
                  </th>
                ) : null}
                <th style={{width:'30px'}}></th>
              </tr>
            </thead>
            <tbody>
              {positions.filter(p => p !== '__placeholder__').map((pos, rowIdx) => (
                <tr key={pos} className={rowIdx % 2 === 0 ? 'wf-ref-row-even' : ''}>
                  <td className="wf-ref-pos-cell">
                    <span>{pos}</span>
                    <button
                      className="wf-ref-del-row"
                      onClick={() => handleDeletePosition(pos)}
                      title={`Удалить должность «${pos}»`}
                    >×</button>
                  </td>
                  {statuses.map(status => {
                    const rate = getRate(pos, status)
                    const isEditing = editCell?.position === pos && editCell?.status === status
                    const isEmpty = rate === null
                    return (
                      <td
                        key={status}
                        className={`wf-ref-rate-cell ${isEmpty ? 'wf-ref-na' : 'wf-ref-has-rate'} ${isEditing ? 'wf-ref-editing' : ''}`}
                        onClick={() => !isEditing && handleCellClick(pos, status)}
                        title={isEmpty ? 'Нет ставки — нажмите, чтобы добавить' : `Нажмите, чтобы изменить (${rate} ₽/ч)`}
                      >
                        {isEditing ? (
                          <input
                            className="wf-ref-input"
                            value={editValue}
                            autoFocus
                            onChange={e => setEditValue(e.target.value)}
                            onBlur={handleCellSave}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleCellSave()
                              if (e.key === 'Escape') setEditCell(null)
                            }}
                          />
                        ) : (
                          isEmpty
                            ? <span className="wf-ref-x">х</span>
                            : <span className="wf-ref-rate">{rate}</span>
                        )}
                      </td>
                    )
                  })}
                  {addingStatus && <td className="wf-ref-na"><span className="wf-ref-x">х</span></td>}
                  <td></td>
                </tr>
              ))}

              {/* Строка добавления должности */}
              {addingPosition && (
                <tr className="wf-new-row">
                  <td className="wf-ref-pos-cell" style={{gap:'0.25rem'}}>
                    <input
                      className="wf-ref-new-input"
                      placeholder="Название должности..."
                      value={newPositionName}
                      autoFocus
                      onChange={e => setNewPositionName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleAddPosition()
                        if (e.key === 'Escape') { setAddingPosition(false); setNewPositionName('') }
                      }}
                      style={{width:'140px'}}
                    />
                    <button className="wf-btn-icon wf-btn-save" onClick={handleAddPosition} title="Добавить">✓</button>
                    <button className="wf-btn-icon wf-btn-cancel" onClick={() => { setAddingPosition(false); setNewPositionName('') }} title="Отмена">✕</button>
                  </td>
                  {statuses.map(s => (
                    <td key={s} className="wf-ref-na"><span className="wf-ref-x">х</span></td>
                  ))}
                  <td colSpan={2}></td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <div className="wf-hint-box">
        <strong>Как редактировать:</strong> нажмите на число, чтобы изменить ставку. Введите «х» или очистите поле — ячейка станет недоступной. Нажмите <kbd>Enter</kbd> для сохранения, <kbd>Esc</kbd> для отмены.
        <br /><strong>Импорт из Google Sheets:</strong> выделите всю таблицу (Ctrl+A), скопируйте (Ctrl+C) и вставьте в форму импорта. Формат: первая строка — заголовок со статусами, первый столбец — должности, «х» = не применимо.
      </div>

      {showImport && (
        <ImportModal
          title="Импорт справочника из Google Таблиц"
          hint={"Скопируйте таблицу из Google Sheets и вставьте ниже.\n\nОжидаемый формат (статусы как заголовки столбцов):\nДолжность | штат | найм | Астамиров | Универсал М | ГПХ\nОператор  | 484  | 484  | 610       | 578         | 484\nКарщик    | 484  | 484  | х         | х           | 484\n\n«х» = ставка для этого статуса не предусмотрена."}
          onImport={handleImport}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  )
}

// ─── Список сотрудников производства ─────────────────────────────────────────
function fmtFireDate(iso) {
  if (!iso) return ''
  try {
    const [y, m, d] = iso.split('-')
    return `${d}.${m}.${y}`
  } catch { return iso }
}

// Участки для производства ГРАВИРОВКА
export const ENGRAVING_SECTIONS = [
  'Сборочный цех',
  'Гравировочный цех',
  'Резка МДФ',
  'Сборка МДФ',
  'Валковый пресс',
  'Шелкография',
  'Вспомогательный персонал',
]

export const TEA_SECTIONS = [
  'Купажный цех',
  'Фасовочный цех',
  'Шелкография',
  'Картон/Дерево',
  'Термотуннель',
  'Упаковка',
  'Вспомогательный персонал',
]

export const LUMINARC_SECTIONS = [
  'Склад',
  'Упаковка',
  'Комплекты',
  'Вспомогательный персонал',
]

export function getSectionsForProduction(production) {
  if (production === 'engraving') return ENGRAVING_SECTIONS
  if (production === 'tea') return TEA_SECTIONS
  if (production === 'luminarc') return LUMINARC_SECTIONS
  return []
}

export function EmployeesTab({ production, canEdit }) {
  const [employees, setEmployees] = useState([])
  const [ref, setRef] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [importMode, setImportMode] = useState('replace')
  const [addingRow, setAddingRow] = useState(false)
  const [newEmp, setNewEmp] = useState({ full_name: '', position: '', status: '', phone: '', section: '' })
  const [editingId, setEditingId] = useState(null)
  const [editBuf, setEditBuf] = useState({})
  const [showFired, setShowFired] = useState(false)
  const [assigning, setAssigning] = useState(false)
  // id сотрудника, ожидающего подтверждения увольнения
  const [confirmFireId, setConfirmFireId] = useState(null)

  const positions = [...new Set(ref.map(r => r.position))]
  const statusesByPosition = (pos) => [...new Set(ref.filter(r => r.position === pos).map(r => r.status))]

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      apiFetch(`${API}/workforce/employees/${production}`),
      apiFetch(`${API}/workforce/reference`),
    ]).then(([emps, refData]) => {
      setEmployees(Array.isArray(emps) ? emps : [])
      setRef(Array.isArray(refData) ? refData : [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [production])

  useEffect(() => { load() }, [load])

  const showMsg = (text, ok = true) => {
    setMsg({ text, ok })
    setTimeout(() => setMsg(null), 3000)
  }

  const saveList = async (list) => {
    setSaving(true)
    try {
      await apiFetch(`${API}/workforce/employees/${production}`, {
        method: 'PUT', body: JSON.stringify(list),
      })
      setEmployees(list)
      showMsg(`Сохранено (${list.length} чел.)`)
    } catch (e) {
      showMsg(e.message || 'Ошибка', false)
    } finally { setSaving(false) }
  }

  const handleAdd = () => {
    if (!newEmp.full_name.trim()) return
    const emp = {
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
      full_name: newEmp.full_name.trim(),
      position: newEmp.position,
      status: newEmp.status,
      ...(newEmp.phone    ? { phone:    newEmp.phone.trim()    } : {}),
      ...(newEmp.section  ? { section:  newEmp.section         } : {}),
    }
    saveList([...employees, emp])
    setNewEmp({ full_name: '', position: '', status: '', phone: '', section: '' })
    setAddingRow(false)
  }

  const handleDelete = (id) => {
    if (!confirm('Полностью удалить сотрудника из списка?')) return
    saveList(employees.filter(e => e.id !== id))
  }

  const handleEditStart = (emp) => {
    setEditingId(emp.id)
    setEditBuf({ full_name: emp.full_name, position: emp.position, status: emp.status, phone: emp.phone || '', section: emp.section || '' })
  }

  const handleEditSave = () => {
    const updated = employees.map(e => e.id === editingId ? { ...e, ...editBuf } : e)
    saveList(updated)
    setEditingId(null)
  }

  const handleImport = async (tsv) => {
    const res = await apiFetch(`${API}/workforce/employees/${production}/import`, {
      method: 'POST', body: JSON.stringify({ tsv, mode: importMode }),
    })
    setEmployees(res.employees || [])
    showMsg(`Импортировано ${res.count} сотрудников`)
  }

  const handleFire = async (id) => {
    const today = new Date().toISOString().split('T')[0]
    try {
      await apiFetch(`${API}/workforce/employees/${production}/${id}/fire`, {
        method: 'PATCH', body: JSON.stringify({ fired_at: today }),
      })
      setEmployees(prev => prev.map(e => e.id === id ? { ...e, fired_at: today } : e))
      showMsg('Сотрудник уволен. Удалён из текущего и будущих графиков.')
    } catch (e) {
      showMsg(e.message || 'Ошибка', false)
    } finally { setConfirmFireId(null) }
  }

  const handleReinstate = async (id) => {
    try {
      await apiFetch(`${API}/workforce/employees/${production}/${id}/reinstate`, { method: 'PATCH' })
      setEmployees(prev => prev.map(e => {
        if (e.id !== id) return e
        const { fired_at, ...rest } = e
        return rest
      }))
      showMsg('Сотрудник восстановлен.')
    } catch (e) {
      showMsg(e.message || 'Ошибка', false)
    }
  }

  const handleAssignSections = async () => {
    setAssigning(true)
    try {
      const res = await apiFetch(`${API}/workforce/engraving-assign-sections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      showMsg(`Участки проставлены (${res.count} чел.)`)
      load()
    } catch (e) {
      showMsg(e.message || 'Ошибка', false)
    } finally {
      setAssigning(false)
    }
  }

  const activeEmps = employees.filter(e => !e.fired_at)
  const firedEmps  = employees.filter(e => !!e.fired_at)

  if (loading) return <div className="wf-loading">Загрузка...</div>

  const showSection = true
  const sectionOptions = getSectionsForProduction(production)
  const colSpan = canEdit ? (showSection ? 7 : 6) : (showSection ? 6 : 5)

  const renderRow = (emp, idx, isFired = false) => {
    if (editingId === emp.id) {
      return (
        <tr key={emp.id}>
          <td className="wf-num" style={{color:'var(--text-muted)'}}>{idx}</td>
          <td>
            <input className="wf-cell-input" value={editBuf.full_name}
              onChange={e => setEditBuf(b => ({...b, full_name: e.target.value}))} autoFocus />
          </td>
          <td>
            <select className="wf-cell-input" value={editBuf.position}
              onChange={e => setEditBuf(b => ({...b, position: e.target.value, status: ''}))}>
              <option value="">— Должность —</option>
              {positions.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </td>
          <td>
            <select className="wf-cell-input" value={editBuf.status}
              onChange={e => setEditBuf(b => ({...b, status: e.target.value}))}>
              <option value="">— Статус —</option>
              {statusesByPosition(editBuf.position).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </td>
          <td>
            <input className="wf-cell-input" value={editBuf.phone || ''}
              placeholder="+7 (999) 000-00-00"
              onChange={e => setEditBuf(b => ({...b, phone: e.target.value}))} />
          </td>
          {showSection && (
            <td>
              <select className="wf-cell-input" value={editBuf.section || ''}
                onChange={e => setEditBuf(b => ({...b, section: e.target.value}))}>
                <option value="">— Участок —</option>
                {sectionOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </td>
          )}
          <td className="wf-row-actions">
            <button className="wf-btn-icon wf-btn-save" onClick={handleEditSave} title="Сохранить">✓</button>
            <button className="wf-btn-icon wf-btn-cancel" onClick={() => setEditingId(null)} title="Отмена">✕</button>
          </td>
        </tr>
      )
    }

    return (
      <tr key={emp.id} className={isFired ? 'wf-emp-fired-row' : ''}>
        <td className="wf-num" style={{color:'var(--text-muted)'}}>{idx}</td>
        <td>
          <span style={{fontWeight: isFired ? 400 : 500, opacity: isFired ? 0.6 : 1}}>
            {emp.full_name}
          </span>
          {isFired && (
            <span className="wf-fired-badge">Уволен с {fmtFireDate(emp.fired_at)}</span>
          )}
        </td>
        <td style={{opacity: isFired ? 0.5 : 1}}>{emp.position}</td>
        <td><span className="wf-status-badge" style={{opacity: isFired ? 0.5 : 1}}>{emp.status}</span></td>
        <td style={{opacity: isFired ? 0.5 : 1, fontSize:'0.82rem', color: emp.phone ? 'var(--text)' : 'var(--text-muted)'}}>
          {emp.phone
            ? <a href={`tel:${emp.phone}`} style={{color:'var(--accent)', textDecoration:'none'}}>{emp.phone}</a>
            : <span style={{opacity:0.4}}>—</span>
          }
        </td>
        {showSection && (
          <td style={{opacity: isFired ? 0.5 : 1, fontSize:'0.82rem', color: emp.section ? 'var(--text)' : 'var(--text-muted)'}}>
            {emp.section || <span style={{opacity:0.4}}>—</span>}
          </td>
        )}
        {canEdit && (
          <td className="wf-row-actions">
            {!isFired ? (
              <>
                {confirmFireId === emp.id ? (
                  <span style={{display:'flex', gap:'0.25rem', alignItems:'center'}}>
                    <span style={{fontSize:'0.75rem', color:'var(--negative)', whiteSpace:'nowrap'}}>Уволить?</span>
                    <button className="wf-btn-icon wf-btn-save" onClick={() => handleFire(emp.id)} title="Да">✓</button>
                    <button className="wf-btn-icon wf-btn-cancel" onClick={() => setConfirmFireId(null)} title="Отмена">✕</button>
                  </span>
                ) : (
                  <>
                    <button className="wf-btn-icon" onClick={() => handleEditStart(emp)} title="Редактировать">✎</button>
                    <button className="wf-btn wf-btn-fire wf-btn-sm" onClick={() => setConfirmFireId(emp.id)} title="Уволить">
                      Уволить
                    </button>
                    <button className="wf-btn-icon wf-btn-danger" onClick={() => handleDelete(emp.id)} title="Удалить полностью">🗑</button>
                  </>
                )}
              </>
            ) : (
              <button className="wf-btn wf-btn-secondary wf-btn-sm" onClick={() => handleReinstate(emp.id)}>
                Восстановить
              </button>
            )}
          </td>
        )}
      </tr>
    )
  }

  return (
    <div className="wf-reference">
      {ref.length === 0 && (
        <div className="wf-warn-banner">
          ⚠️ Справочник должностей пуст. Перейдите на вкладку <strong>«Справочник»</strong> и загрузите данные — тогда должности и статусы появятся в выпадающих списках.
        </div>
      )}
      <div className="wf-toolbar">
        <div className="wf-toolbar-info">
          <span className="wf-prod-label">{PRODUCTIONS[production]}</span>
          <span className="wf-sub-label">Сотрудники</span>
          <span className="wf-count-badge">{activeEmps.length} акт.</span>
          {firedEmps.length > 0 && (
            <span className="wf-count-badge" style={{color:'var(--negative)', borderColor:'var(--negative)'}}>
              {firedEmps.length} уволен.
            </span>
          )}
        </div>
        <div className="wf-toolbar-actions">
          {msg && <span className={`wf-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</span>}
          {saving && <span className="wf-msg">Сохранение...</span>}
          {firedEmps.length > 0 && (
            <button className="wf-btn wf-btn-secondary wf-btn-sm"
              onClick={() => setShowFired(f => !f)}>
              {showFired ? 'Скрыть уволенных' : `Показать уволенных (${firedEmps.length})`}
            </button>
          )}
          {canEdit && (
            <>
              {showSection && (
                <button
                  className="wf-btn wf-btn-secondary"
                  onClick={handleAssignSections}
                  disabled={assigning}
                  title="Проставить участки всем по должности: гравировщики→Гравировка, сборщик коробок→Сборка МДФ, упаковщик/комплектовщик→Сборочный цех и т.д."
                >
                  {assigning ? 'Распределение...' : 'Распределить по участкам'}
                </button>
              )}
              <button className="wf-btn wf-btn-secondary" onClick={() => { setImportMode('replace'); setShowImport(true) }}>
                ↓ Импорт (заменить)
              </button>
              <button className="wf-btn wf-btn-secondary" onClick={() => { setImportMode('append'); setShowImport(true) }}>
                ↓ Импорт (добавить)
              </button>
              <button className="wf-btn wf-btn-primary" onClick={() => setAddingRow(true)}>+ Добавить</button>
            </>
          )}
        </div>
      </div>

      <div className="wf-table-wrap">
        <table className="wf-table">
          <thead>
            <tr>
              <th style={{width:'40px'}}>#</th>
              <th>ФИО</th>
              <th>Должность</th>
              <th>Статус</th>
              <th>Телефон</th>
              {showSection && <th>Участок</th>}
              {canEdit && <th style={{width:'160px'}}></th>}
            </tr>
          </thead>
          <tbody>
            {activeEmps.map((emp, idx) => renderRow(emp, idx + 1, false))}
            {addingRow && canEdit && (
              <tr className="wf-new-row">
                <td className="wf-num">+</td>
                <td>
                  <input className="wf-cell-input" placeholder="Фамилия Имя Отчество" value={newEmp.full_name}
                    onChange={e => setNewEmp(n => ({...n, full_name: e.target.value}))}
                    onKeyDown={e => e.key === 'Enter' && handleAdd()} autoFocus />
                </td>
                <td>
                  <select className="wf-cell-input" value={newEmp.position}
                    onChange={e => setNewEmp(n => ({...n, position: e.target.value, status: ''}))}>
                    <option value="">— Должность —</option>
                    {positions.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </td>
                <td>
                  <select className="wf-cell-input" value={newEmp.status}
                    onChange={e => setNewEmp(n => ({...n, status: e.target.value}))}>
                    <option value="">— Статус —</option>
                    {statusesByPosition(newEmp.position).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td>
                  <input className="wf-cell-input" placeholder="+7 (999) 000-00-00" value={newEmp.phone}
                    onChange={e => setNewEmp(n => ({...n, phone: e.target.value}))} />
                </td>
                {showSection && (
                  <td>
                    <select className="wf-cell-input" value={newEmp.section}
                      onChange={e => setNewEmp(n => ({...n, section: e.target.value}))}>
                      <option value="">— Участок —</option>
                      {sectionOptions.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                )}
                <td className="wf-row-actions">
                  <button className="wf-btn wf-btn-primary wf-btn-sm" onClick={handleAdd}>Добавить</button>
                  <button className="wf-btn wf-btn-secondary wf-btn-sm" onClick={() => setAddingRow(false)}>Отмена</button>
                </td>
              </tr>
            )}
            {activeEmps.length === 0 && !addingRow && (
              <tr>
                <td colSpan={colSpan} className="wf-empty">
                  Список пуст. Добавьте сотрудников вручную или импортируйте из Google Таблиц.
                </td>
              </tr>
            )}
            {/* Уволенные — показываются по кнопке */}
            {showFired && firedEmps.length > 0 && (
              <>
                <tr>
                  <td colSpan={colSpan} style={{
                    padding:'0.35rem 0.75rem', background:'rgba(180,60,60,0.08)',
                    fontSize:'0.78rem', color:'var(--negative)', fontWeight:600,
                    borderTop:'2px solid var(--border)'
                  }}>
                    Уволенные сотрудники ({firedEmps.length})
                  </td>
                </tr>
                {firedEmps.map((emp, idx) => renderRow(emp, idx + 1, true))}
              </>
            )}
          </tbody>
        </table>
      </div>

      <div className="wf-hint-box">
        <strong>Формат импорта из Google Таблиц:</strong>
        <pre>ФИО{'\t'}Должность{'\t'}Статус{'\t'}Телефон (необязательно){'\n'}Иванов Иван Иванович{'\t'}Оператор{'\t'}штат{'\t'}+7 (999) 111-22-33{'\n'}Петров Пётр{'\t'}Бригадир{'\t'}найм{'\t'}</pre>
        <p style={{margin:'0.3rem 0 0', fontSize:'0.78rem'}}>
          <strong>Импорт (заменить)</strong> — полностью заменяет список. &nbsp;
          <strong>Импорт (добавить)</strong> — добавляет к существующим. &nbsp;
          При любом импорте уволенные сотрудники сохраняются.
        </p>
      </div>

      {showImport && (
        <ImportModal
          title={`Импорт сотрудников из Google Таблиц (${importMode === 'replace' ? 'заменить список' : 'добавить к списку'})`}
          hint={"Скопируйте и вставьте данные из Google Sheets.\nФормат: ФИО | Должность | Статус (без заголовка или с заголовком)."}
          onImport={handleImport}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  )
}


// ─── Ресайз колонок ────────────────────────────────────────────────────────────
function useColResize(initial) {
  const [widths, setWidths] = useState(initial)
  const startResize = useCallback((col, e) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = widths[col]
    const onMove = (me) => setWidths(w => ({ ...w, [col]: Math.max(50, startW + me.clientX - startX) }))
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [widths])
  return [widths, setWidths, startResize]
}

// Ручка изменения ширины колонки
function ResizeHandle({ col, onMouseDown }) {
  return (
    <span
      className="wf-resize-handle"
      onMouseDown={e => onMouseDown(col, e)}
      title="Перетащите для изменения ширины"
    />
  )
}

// ─── Выпадающий фильтр-дропдаун ───────────────────────────────────────────────
function FilterDropdown({ label, options, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const onOut = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onOut)
    return () => document.removeEventListener('mousedown', onOut)
  }, [])

  const toggle = (opt) =>
    onChange(selected.includes(opt) ? selected.filter(x => x !== opt) : [...selected, opt])

  const count = selected.length

  return (
    <div className="wf-fd" ref={ref}>
      <button
        type="button"
        className={`wf-btn wf-btn-secondary wf-btn-xs wf-fd-btn ${count > 0 ? 'wf-fd-active' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        {label}{count > 0 ? ` (${count})` : ''} {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className="wf-fd-panel">
          <div className="wf-fd-options">
            {options.map(opt => (
              <label key={opt} className="wf-fd-check">
                <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} />
                <span>{opt}</span>
              </label>
            ))}
            {options.length === 0 && <span className="wf-fd-empty">Нет вариантов</span>}
          </div>
          <div className="wf-fd-footer">
            <button type="button" className="wf-btn wf-btn-secondary wf-btn-xs" onClick={() => onChange([])}>
              Сбросить
            </button>
            <button type="button" className="wf-btn wf-btn-primary wf-btn-xs" onClick={() => setOpen(false)}>
              ОК
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Таблица графика ──────────────────────────────────────────────────────────
export function ScheduleTable({ production, year, month, canEdit, reference }) {
  const [schedule, setSchedule] = useState(null)
  const [empList, setEmpList] = useState([])   // список сотрудников для проверки увольнений
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [copying, setCopying] = useState(false)
  const [msg, setMsg] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [addingEmployee, setAddingEmployee] = useState(false)
  const [newEmp, setNewEmp] = useState({ full_name: '', position: '', status: '' })
  const [editCell, setEditCell] = useState(null)       // {empId, day} — ячейка дня
  const [editingEmpId, setEditingEmpId] = useState(null) // id строки сотрудника
  const [editEmpBuf, setEditEmpBuf] = useState({})
  const [sortBy, setSortBy] = useState('fio')          // 'fio' | 'position' | 'status' | 'section'
  const [positionFilter, setPositionFilter] = useState([])
  const [statusFilter, setStatusFilter] = useState([])
  const [sectionFilter, setSectionFilter] = useState([])
  const [editingSection, setEditingSection] = useState(null) // full_name редактируемого участка
  const numDays = getDaysInMonth(year, month)
  const [colWidths, , startResize] = useColResize({ fio: 185, pos: 110, status: 80, section: 100 })

  // Карта участков по ФИО (из списка сотрудников)
  const sectionMap = Object.fromEntries(empList.map(e => [e.full_name?.trim() || '', e.section || '']))
  const hasSections = empList.some(e => e.section)

  // Доступные участки для выбора
  const availableSections = [...new Set([
    ...empList.map(e => e.section).filter(Boolean),
    ...getSectionsForProduction(production),
  ])].sort((a, b) => a.localeCompare(b, 'ru'))

  const handleSectionEdit = async (fullName, newSection) => {
    const empEntry = empList.find(e => e.full_name?.trim() === fullName?.trim())
    if (!empEntry) { setEditingSection(null); return }
    try {
      await apiFetch(`${API}/workforce/employees/${production}/${empEntry.id}/section`, {
        method: 'PATCH', body: JSON.stringify({ section: newSection }),
      })
      setEmpList(list => list.map(e => e.id === empEntry.id ? { ...e, section: newSection } : e))
    } catch (err) {
      alert('Ошибка сохранения участка: ' + err.message)
    }
    setEditingSection(null)
  }

  // Карта увольнений по ФИО (lowercase)
  const firedMap = {}
  empList.forEach(e => { if (e.fired_at) firedMap[e.full_name.trim().toLowerCase()] = e.fired_at })

  // Проверить, уволен ли сотрудник в текущем или прошлом месяце
  const getFiredAt = (full_name) => firedMap[full_name?.trim().toLowerCase()] || null

  // Уволен до начала текущего месяца (не должен быть в этом месяце)
  const isFiredBeforeThisMonth = (fired_at) => {
    if (!fired_at) return false
    const [fy, fm] = fired_at.split('-').map(Number)
    return fy < year || (fy === year && fm < month)
  }

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      apiFetch(`${API}/workforce/schedule/${production}/${year}/${month}`),
      apiFetch(`${API}/workforce/employees/${production}`),
    ]).then(([sched, emps]) => {
      setSchedule(sched)
      setEmpList(Array.isArray(emps) ? emps : [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [production, year, month])

  useEffect(() => { load() }, [load])

  const saveSchedule = async (data) => {
    setSaving(true)
    try {
      await apiFetch(`${API}/workforce/schedule/${production}/${year}/${month}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      })
      setMsg({ text: 'Сохранено', ok: true })
      setSchedule(data)
    } catch (e) {
      setMsg({ text: e.message || 'Ошибка сохранения', ok: false })
    } finally {
      setSaving(false)
      setTimeout(() => setMsg(null), 3000)
    }
  }

  const handleCellClick = (empId, day) => {
    if (!canEdit) return
    const employeesArr = schedule?.employees || []
    const emp = employeesArr.find(e => e.id === empId)
    if (!emp) return
    const dayStr = String(day)
    const current = emp.working_days[dayStr]
    if (current !== undefined) {
      // Открываем редактирование
      setEditCell({ empId, day })
    } else {
      // Ставим часы по умолчанию согласно должности
      const defaultH = getDefaultHours(emp.position)
      const updated = {
        ...schedule,
        employees: schedule.employees.map(e =>
          e.id === empId ? { ...e, working_days: { ...e.working_days, [dayStr]: defaultH } } : e
        ),
      }
      saveSchedule(updated)
    }
  }

  const handleCellEdit = (empId, day, val) => {
    const dayStr = String(day)
    const hours = parseFloat(val)
    const updated = {
      ...schedule,
      employees: schedule.employees.map((e, i) => {
        if (e.id !== empId) return e
        const wd = { ...e.working_days }
        if (!val || isNaN(hours) || hours <= 0) {
          delete wd[dayStr]
        } else {
          wd[dayStr] = hours
        }
        return { ...e, working_days: wd }
      }),
    }
    setEditCell(null)
    saveSchedule(updated)
  }

  const handleDeleteEmployee = (empId) => {
    const emp = (schedule.employees || []).find(e => e.id === empId)
    if (!emp) return
    if (!confirm(`Удалить «${emp.full_name}» из графика этого месяца?`)) return
    const updated = { ...schedule, employees: schedule.employees.filter(e => e.id !== empId) }
    saveSchedule(updated)
  }

  const handleEditEmpStart = (emp) => {
    setEditingEmpId(emp.id)
    setEditEmpBuf({ full_name: emp.full_name, position: emp.position, status: emp.status })
  }

  const handleEditEmpSave = () => {
    if (!editEmpBuf.full_name?.trim()) return
    const updated = {
      ...schedule,
      employees: schedule.employees.map(e =>
        e.id === editingEmpId ? { ...e, ...editEmpBuf, full_name: editEmpBuf.full_name.trim() } : e
      ),
    }
    saveSchedule(updated)
    setEditingEmpId(null)
  }

  const handleAddEmployee = () => {
    if (!newEmp.full_name.trim()) return
    const emp = {
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
      full_name: newEmp.full_name.trim(),
      position: newEmp.position,
      status: newEmp.status,
      working_days: {},
    }
    const updated = { ...schedule, employees: [...(schedule.employees || []), emp] }
    saveSchedule(updated)
    setNewEmp({ full_name: '', position: '', status: '' })
    setAddingEmployee(false)
  }

  const handleImport = async (tsv) => {
    const res = await apiFetch(`${API}/workforce/schedule/${production}/${year}/${month}/import`, {
      method: 'POST',
      body: JSON.stringify({ tsv }),
    })
    setSchedule(res.schedule)
    setMsg({ text: `Импортировано ${res.count} сотрудников`, ok: true })
    setTimeout(() => setMsg(null), 3000)
  }

  // Копировать сотрудников из предыдущего месяца (без рабочих дней, без уволенных)
  const handleCopyFromPrev = async () => {
    setCopying(true)
    try {
      const prevMonth = month === 1 ? 12 : month - 1
      const prevYear  = month === 1 ? year - 1 : year
      const prevSched = await apiFetch(`${API}/workforce/schedule/${production}/${prevYear}/${prevMonth}`)
      const prevEmps  = prevSched.employees || []

      // Фильтруем: исключаем сотрудников, уволенных ДО начала текущего месяца
      const monthStart = `${year}-${String(month).padStart(2,'0')}-01`
      const filtered = prevEmps
        .filter(e => {
          const fa = firedMap[e.full_name?.trim().toLowerCase()]
          if (!fa) return true           // не уволен — берём
          return fa >= monthStart        // уволен в этом или будущем месяце — тоже берём (с пометкой)
        })
        .map(e => ({
          ...e,
          id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
          working_days: {},              // рабочие дни сбрасываются
        }))

      // Добавляем только тех, кого ещё нет в текущем графике
      const existingNames = new Set((schedule?.employees || []).map(e => e.full_name?.trim().toLowerCase()))
      const toAdd = filtered.filter(e => !existingNames.has(e.full_name?.trim().toLowerCase()))

      if (toAdd.length === 0) {
        setMsg({ text: 'Все сотрудники из прошлого месяца уже есть в текущем графике', ok: true })
        setTimeout(() => setMsg(null), 3000)
        return
      }

      const updated = { ...schedule, employees: [...(schedule?.employees || []), ...toAdd] }
      await saveSchedule(updated)
      setMsg({ text: `Добавлено ${toAdd.length} сотрудников из предыдущего месяца`, ok: true })
      setTimeout(() => setMsg(null), 3000)
    } catch (e) {
      setMsg({ text: e.message || 'Ошибка копирования', ok: false })
      setTimeout(() => setMsg(null), 3000)
    } finally {
      setCopying(false)
    }
  }

  // Уникальные должности и статусы из справочника
  const positions = [...new Set(reference.map(r => r.position))]
  const statusesByPosition = (pos) => [...new Set(reference.filter(r => r.position === pos).map(r => r.status))]

  if (loading) return <div className="wf-loading">Загрузка графика...</div>
  if (!schedule) return <div className="wf-error">Ошибка загрузки</div>

  const employees = schedule.employees || []

  // Фильтрация по должности, статусу и участку
  const filteredEmployees = employees.filter(emp => {
    if (positionFilter.length && !positionFilter.includes(emp.position)) return false
    if (statusFilter.length && !statusFilter.includes(emp.status)) return false
    if (sectionFilter.length) {
      const sec = sectionMap[emp.full_name?.trim()] || ''
      if (!sectionFilter.includes(sec)) return false
    }
    return true
  })

  // Сортировка
  const sortedEmployees = [...filteredEmployees].sort((a, b) => {
    const get = (e) => {
      if (sortBy === 'position') return (e.position || '').toLowerCase()
      if (sortBy === 'status') return (e.status || '').toLowerCase()
      if (sortBy === 'section') return (sectionMap[e.full_name?.trim()] || '').toLowerCase()
      return (e.full_name || '').toLowerCase()
    }
    return get(a).localeCompare(get(b), 'ru')
  })

  // Итоговые данные по дням — по отфильтрованным сотрудникам
  const dayTotals = {}
  for (let d = 1; d <= numDays; d++) {
    dayTotals[d] = filteredEmployees.filter(e => e.working_days[String(d)] !== undefined).length
  }
  const totalPlannedDays = filteredEmployees.reduce((s, e) => s + Object.keys(e.working_days).length, 0)

  return (
    <div className="wf-schedule">
      <div className="wf-toolbar">
        <div className="wf-toolbar-info">
          <span className="wf-prod-label">{PRODUCTIONS[production]}</span>
          <span className="wf-sub-label">График на {MONTH_NAMES[month - 1]} {year}</span>
          <span className="wf-count-badge">{filteredEmployees.length} сотр.</span>
        </div>
        <div className="wf-toolbar-actions">
          {msg && <span className={`wf-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</span>}
          {saving && <span className="wf-msg">Сохранение...</span>}
          {canEdit && (
            <>
              <button className="wf-btn wf-btn-secondary" onClick={() => setShowImport(true)}>↓ Импорт из Google Таблиц</button>
              <button
                className="wf-btn wf-btn-secondary"
                onClick={handleCopyFromPrev}
                disabled={copying}
                title="Перенести сотрудников из предыдущего месяца без рабочих дней. Уволенные не переходят."
              >
                {copying ? '...' : '← Из прошлого месяца'}
              </button>
              <button className="wf-btn wf-btn-primary" onClick={() => setAddingEmployee(true)}>+ Сотрудник</button>
            </>
          )}
        </div>
      </div>

      {/* Фильтры и сортировка */}
      <div className="wf-filter-bar">
        <FilterDropdown
          label="Должности"
          options={positions}
          selected={positionFilter}
          onChange={setPositionFilter}
        />
        <FilterDropdown
          label="Статусы"
          options={[...new Set(reference.map(r => r.status).filter(Boolean))]}
          selected={statusFilter}
          onChange={setStatusFilter}
        />
        {hasSections && (
          <FilterDropdown
            label="Участки"
            options={availableSections}
            selected={sectionFilter}
            onChange={setSectionFilter}
          />
        )}
        <div className="wf-filter-sep" />
        <span className="wf-filter-label">Сорт:</span>
        <button type="button" className={`wf-btn wf-btn-secondary wf-btn-xs ${sortBy === 'fio' ? 'wf-btn-active' : ''}`} onClick={() => setSortBy('fio')}>ФИО</button>
        <button type="button" className={`wf-btn wf-btn-secondary wf-btn-xs ${sortBy === 'position' ? 'wf-btn-active' : ''}`} onClick={() => setSortBy('position')}>Должность</button>
        <button type="button" className={`wf-btn wf-btn-secondary wf-btn-xs ${sortBy === 'status' ? 'wf-btn-active' : ''}`} onClick={() => setSortBy('status')}>Статус</button>
        {hasSections && (
          <button type="button" className={`wf-btn wf-btn-secondary wf-btn-xs ${sortBy === 'section' ? 'wf-btn-active' : ''}`} onClick={() => setSortBy('section')}>Участок</button>
        )}
        {(positionFilter.length > 0 || statusFilter.length > 0 || sectionFilter.length > 0) && (
          <>
            <div className="wf-filter-sep" />
            <button type="button" className="wf-btn wf-btn-danger wf-btn-xs" onClick={() => { setPositionFilter([]); setStatusFilter([]); setSectionFilter([]) }}>
              ✕ Сбросить фильтры
            </button>
          </>
        )}
      </div>

      <div className="wf-table-scroll">
        <table
          className={`wf-schedule-table ${canEdit ? 'wf-has-actions' : ''}`}
          style={{
            '--wf-fio-width': `${colWidths.fio}px`,
            '--wf-pos-width': `${colWidths.pos}px`,
            '--wf-status-width': `${colWidths.status}px`,
            '--wf-section-width': `${colWidths.section}px`,
          }}
        >
          <thead>
            <tr>
              {canEdit && <th className="wf-col-actions-left"></th>}
              <th className="wf-col-name wf-resizable-col" style={{ width: colWidths.fio, minWidth: colWidths.fio, maxWidth: colWidths.fio }}>
                ФИО<ResizeHandle col="fio" onMouseDown={startResize} />
              </th>
              <th className="wf-col-pos wf-resizable-col" style={{ width: colWidths.pos, minWidth: colWidths.pos, maxWidth: colWidths.pos }}>
                Должность<ResizeHandle col="pos" onMouseDown={startResize} />
              </th>
              <th className={`wf-col-status wf-resizable-col${!hasSections ? ' wf-last-sticky' : ''}`} style={{ width: colWidths.status, minWidth: colWidths.status, maxWidth: colWidths.status }}>
                Статус<ResizeHandle col="status" onMouseDown={startResize} />
              </th>
              {hasSections && <th className="wf-col-section wf-resizable-col wf-last-sticky" style={{ width: colWidths.section, minWidth: colWidths.section, maxWidth: colWidths.section }}>
                Участок<ResizeHandle col="section" onMouseDown={startResize} />
              </th>}
              {Array.from({ length: numDays }, (_, i) => i + 1).map(d => (
                <th key={d} className={`wf-col-day ${isWeekend(year, month, d) ? 'wf-weekend' : ''}`}>
                  <div>{d}</div>
                  <div className="wf-dow">{DAY_NAMES[getDayOfWeek(year, month, d)]}</div>
                </th>
              ))}
              <th className="wf-col-total">Итого</th>
            </tr>
          </thead>
          <tbody>
            {sortedEmployees.map((emp) => {
              const totalDays = Object.keys(emp.working_days).length
              const totalHours = Object.values(emp.working_days).reduce((s, h) => s + h, 0)
              const firedAt   = getFiredAt(emp.full_name)
              const firedBeforeThisMonth = isFiredBeforeThisMonth(firedAt)
              const firedThisMonth = firedAt && !firedBeforeThisMonth
              const isEditingRow = editingEmpId === emp.id
              return (
                <tr key={emp.id} className={firedThisMonth ? 'wf-sched-fired-row' : firedBeforeThisMonth ? 'wf-sched-fired-prev-row' : ''}>
                  {/* Кнопки действий — слева */}
                  {canEdit && (
                    <td className="wf-col-actions-left">
                      {isEditingRow ? (
                        <span className="wf-sched-actions">
                          <button className="wf-btn-icon wf-btn-save" onClick={handleEditEmpSave} title="Сохранить">✓</button>
                          <button className="wf-btn-icon wf-btn-cancel" onClick={() => setEditingEmpId(null)} title="Отмена">✕</button>
                        </span>
                      ) : (
                        <span className="wf-sched-actions">
                          <button className="wf-btn-icon" onClick={() => handleEditEmpStart(emp)} title="Редактировать сотрудника">✎</button>
                          <button className="wf-btn-icon wf-btn-danger" onClick={() => handleDeleteEmployee(emp.id)} title="Удалить из графика">🗑</button>
                        </span>
                      )}
                    </td>
                  )}

                  {/* ФИО */}
                  <td className="wf-col-name" style={{ width: colWidths.fio, minWidth: colWidths.fio }}>
                    {isEditingRow ? (
                      <input
                        className="wf-cell-input"
                        value={editEmpBuf.full_name || ''}
                        autoFocus
                        onChange={e => setEditEmpBuf(b => ({...b, full_name: e.target.value}))}
                        onKeyDown={e => { if (e.key === 'Enter') handleEditEmpSave(); if (e.key === 'Escape') setEditingEmpId(null) }}
                        style={{width:'100%', minWidth:'130px'}}
                      />
                    ) : (
                      <>
                        {emp.full_name}
                        {firedThisMonth && (
                          <span className="wf-fired-badge" style={{marginLeft:'4px'}}>
                            Уволен с {fmtFireDate(firedAt)}
                          </span>
                        )}
                      </>
                    )}
                  </td>

                  {/* Должность */}
                  <td className="wf-col-pos">
                    {isEditingRow ? (
                      <select
                        className="wf-cell-input"
                        value={editEmpBuf.position || ''}
                        onChange={e => setEditEmpBuf(b => ({...b, position: e.target.value, status: ''}))}
                        style={{width:'100%'}}
                      >
                        <option value="">— Должность —</option>
                        {positions.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    ) : emp.position}
                  </td>

                  {/* Статус */}
                  <td className={`wf-col-status${!hasSections ? ' wf-last-sticky' : ''}`}>
                    {isEditingRow ? (
                      <select
                        className="wf-cell-input"
                        value={editEmpBuf.status || ''}
                        onChange={e => setEditEmpBuf(b => ({...b, status: e.target.value}))}
                        style={{width:'100%'}}
                      >
                        <option value="">— Статус —</option>
                        {statusesByPosition(editEmpBuf.position).map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : <span className="wf-status-badge">{emp.status}</span>}
                  </td>

                  {/* Участок */}
                  {hasSections && (
                    <td
                      className={`wf-col-section wf-last-sticky${canEdit ? ' wf-section-editable' : ''}`}
                      title={canEdit ? 'Нажмите для изменения участка' : (sectionMap[emp.full_name?.trim()] || '')}
                      onClick={() => canEdit && !isEditingRow && setEditingSection(emp.full_name?.trim())}
                    >
                      {editingSection === emp.full_name?.trim() ? (
                        <select
                          className="wf-cell-input wf-section-select"
                          autoFocus
                          value={sectionMap[emp.full_name?.trim()] || ''}
                          onChange={e => handleSectionEdit(emp.full_name, e.target.value)}
                          onBlur={() => setEditingSection(null)}
                          onKeyDown={e => e.key === 'Escape' && setEditingSection(null)}
                          onClick={e => e.stopPropagation()}
                        >
                          <option value="">— не задан —</option>
                          {availableSections.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : (
                        sectionMap[emp.full_name?.trim()] || <span className="wf-section-empty">—</span>
                      )}
                    </td>
                  )}

                  {/* Ячейки дней */}
                  {Array.from({ length: numDays }, (_, i) => i + 1).map(d => {
                    const dayStr = String(d)
                    const hours = emp.working_days[dayStr]
                    const isEditing = editCell?.empId === emp.id && editCell?.day === d
                    return (
                      <td
                        key={d}
                        className={`wf-day-cell ${hours !== undefined ? 'wf-day-on' : ''} ${isWeekend(year, month, d) ? 'wf-weekend' : ''} ${canEdit && !isEditingRow ? 'wf-editable' : ''}`}
                        onClick={() => !isEditing && !isEditingRow && handleCellClick(emp.id, d)}
                      >
                        {isEditing ? (
                          <input
                            className="wf-day-input"
                            type="number"
                            defaultValue={hours || ''}
                            autoFocus
                            onBlur={e => handleCellEdit(emp.id, d, e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleCellEdit(emp.id, d, e.target.value)
                              if (e.key === 'Escape') setEditCell(null)
                              if (e.key === 'Delete' || e.key === 'Backspace') {
                                if (!e.target.value) handleCellEdit(emp.id, d, '')
                              }
                            }}
                          />
                        ) : (
                          hours !== undefined ? <span>{hours}</span> : null
                        )}
                      </td>
                    )
                  })}

                  <td className="wf-col-total">
                    <span className="wf-total-days">{totalDays}д</span>
                    <span className="wf-total-hours">{totalHours}ч</span>
                  </td>
                </tr>
              )
            })}

            {/* Строка добавления */}
            {addingEmployee && (
              <tr className="wf-new-row">
                {canEdit && <td className="wf-col-actions-left"></td>}
                <td>
                  <input
                    className="wf-cell-input"
                    placeholder="ФИО"
                    value={newEmp.full_name}
                    onChange={e => setNewEmp(n => ({ ...n, full_name: e.target.value }))}
                    autoFocus
                    onKeyDown={e => e.key === 'Enter' && handleAddEmployee()}
                  />
                </td>
                <td>
                  <select className="wf-cell-input" value={newEmp.position} onChange={e => setNewEmp(n => ({ ...n, position: e.target.value, status: '' }))}>
                    <option value="">— Должность —</option>
                    {positions.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </td>
                <td>
                  <select className="wf-cell-input" value={newEmp.status} onChange={e => setNewEmp(n => ({ ...n, status: e.target.value }))}>
                    <option value="">— Статус —</option>
                    {statusesByPosition(newEmp.position).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                {hasSections && <td></td>}
                <td colSpan={numDays + 2} className="wf-row-actions">
                  <button className="wf-btn wf-btn-primary wf-btn-sm" onClick={handleAddEmployee}>Добавить</button>
                  <button className="wf-btn wf-btn-secondary wf-btn-sm" onClick={() => setAddingEmployee(false)}>Отмена</button>
                </td>
              </tr>
            )}

            {/* Итоговая строка */}
            <tr className="wf-totals-row">
              {canEdit && <td></td>}
              <td colSpan={hasSections ? 4 : 3} className="wf-totals-label">Всего по дням:</td>
              {Array.from({ length: numDays }, (_, i) => i + 1).map(d => (
                <td key={d} className={`wf-day-total ${isWeekend(year, month, d) ? 'wf-weekend' : ''}`}>
                  {dayTotals[d] > 0 ? dayTotals[d] : ''}
                </td>
              ))}
              <td className="wf-col-total">{totalPlannedDays}д</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="wf-hint-box">
        <strong>Подсказка:</strong> Клик по пустой ячейке — ставит часы по умолчанию (8 ч для руководящих должностей, 11 ч для остальных). Клик по заполненной — редактировать. Enter — подтвердить, Delete/пустое — удалить.
        {canEdit && <> | Формат импорта: ФИО {'\t'} Должность {'\t'} Статус {'\t'} 1 {'\t'} 2 {'\t'} ... {'\t'} 31</>}
      </div>

      {showImport && (
        <ImportModal
          title="Импорт графика из Google Таблиц"
          hint={`Скопируйте таблицу из Google Sheets и вставьте ниже.\nФормат столбцов: ФИО | Должность | Статус | 1 | 2 | ... | 31\nЗначения в ячейках дней: число часов (8, 4...), «+» = 8 ч, пусто = выходной.`}
          onImport={handleImport}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  )
}

// ─── Таблица табеля ───────────────────────────────────────────────────────────
export function TimesheetTable({ production, year, month, canEdit, onlyToday = false, reference }) {
  const [schedule, setSchedule] = useState(null)
  const [timesheet, setTimesheet] = useState(null)
  const [empList, setEmpList] = useState([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState(null)
  // Редактирование: {empId, day} + локальное значение в строке ввода
  const [editCell, setEditCell] = useState(null)
  const [editValue, setEditValue] = useState('')
  // Фильтры, сортировка, ширина колонок
  const [positionFilter, setPositionFilter] = useState([])
  const [statusFilter, setStatusFilter] = useState([])
  const [sectionFilter, setSectionFilter] = useState([])
  const [sortBy, setSortBy] = useState('fio')
  const [editingSection, setEditingSection] = useState(null)
  const [colWidths, , startResize] = useColResize({ fio: 185, pos: 110, status: 80, section: 100 })
  const numDays = getDaysInMonth(year, month)

  // Участки из списка сотрудников
  const sectionMap = Object.fromEntries(empList.map(e => [e.full_name?.trim() || '', e.section || '']))
  const hasSections = empList.some(e => e.section)

  const availableSections = [...new Set([
    ...empList.map(e => e.section).filter(Boolean),
    'Гравировочный цех', 'Сборочный цех', 'Резка МДФ',
    'Шелкография', 'Сборка МДФ', 'Вспомогательный персонал',
  ])].sort((a, b) => a.localeCompare(b, 'ru'))

  const handleSectionEdit = async (fullName, newSection) => {
    const empEntry = empList.find(e => e.full_name?.trim() === fullName?.trim())
    if (!empEntry) { setEditingSection(null); return }
    try {
      await apiFetch(`${API}/workforce/employees/${production}/${empEntry.id}/section`, {
        method: 'PATCH', body: JSON.stringify({ section: newSection }),
      })
      setEmpList(list => list.map(e => e.id === empEntry.id ? { ...e, section: newSection } : e))
    } catch (err) {
      alert('Ошибка сохранения участка: ' + err.message)
    }
    setEditingSection(null)
  }

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      apiFetch(`${API}/workforce/schedule/${production}/${year}/${month}`),
      apiFetch(`${API}/workforce/timesheet/${production}/${year}/${month}`),
      apiFetch(`${API}/workforce/employees/${production}`),
    ]).then(([sched, ts, emps]) => {
      setSchedule(sched)
      setTimesheet(ts)
      setEmpList(Array.isArray(emps) ? emps : [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [production, year, month])

  useEffect(() => { load() }, [load])

  // Открыть ячейку табеля для редактирования
  const handleCellClick = (empId, day, currentHours, plannedH) => {
    if (!canEdit) return
    setEditCell({ empId, day })
    // Если есть фактические часы — показываем их; иначе подставляем плановые из графика
    const initVal = currentHours !== undefined
      ? String(currentHours)
      : plannedH !== undefined ? String(plannedH) : ''
    setEditValue(initVal)
  }

  // Сохранить ячейку (по blur или Enter)
  const handleCellSave = async () => {
    if (!editCell) return
    const { empId, day } = editCell
    const raw = editValue.trim().replace(',', '.')
    const hours = raw === '' ? null : parseFloat(raw)
    if (raw !== '' && (isNaN(hours) || hours < 0 || hours > 24)) {
      setEditCell(null)
      return
    }
    setEditCell(null)
    try {
      const res = await apiFetch(
        `${API}/workforce/timesheet/${production}/${year}/${month}/cell`,
        { method: 'PATCH', body: JSON.stringify({ employee_id: empId, day, hours }) }
      )
      setTimesheet(ts => ({ ...ts, records: res.records }))
    } catch (e) {
      setMsg({ text: e.message || 'Ошибка сохранения', ok: false })
      setTimeout(() => setMsg(null), 3000)
    }
  }

  // Ставки из справочника
  const rateMap = {}
  reference.forEach(r => { rateMap[`${r.position}|${r.status}`] = r.hourly_rate })

  if (loading) return <div className="wf-loading">Загрузка табеля...</div>
  if (!schedule || !timesheet) return <div className="wf-error">Ошибка загрузки</div>

  const employees = schedule.employees || []
  const records = timesheet.records || {}

  // Фильтрация и сортировка
  const tsPositions = [...new Set(employees.map(e => e.position).filter(Boolean))].sort()
  const tsStatuses  = [...new Set(employees.map(e => e.status).filter(Boolean))].sort()

  const filteredEmps = employees.filter(emp => {
    if (positionFilter.length > 0 && !positionFilter.includes(emp.position)) return false
    if (statusFilter.length > 0 && !statusFilter.includes(emp.status)) return false
    if (sectionFilter.length > 0) {
      const sec = sectionMap[emp.full_name?.trim()] || ''
      if (!sectionFilter.includes(sec)) return false
    }
    return true
  })
  const sortedEmps = [...filteredEmps].sort((a, b) => {
    if (sortBy === 'fio')      return (a.full_name || '').localeCompare(b.full_name || '', 'ru')
    if (sortBy === 'position') return (a.position || '').localeCompare(b.position || '', 'ru')
    if (sortBy === 'status')   return (a.status || '').localeCompare(b.status || '', 'ru')
    if (sortBy === 'section')  return (sectionMap[a.full_name?.trim()] || '').localeCompare(sectionMap[b.full_name?.trim()] || '', 'ru')
    return 0
  })

  // Итоги по дням (всегда по всем сотрудникам, не по отфильтрованным)
  const dayPlanned = {}
  const dayActual = {}
  for (let d = 1; d <= numDays; d++) {
    dayPlanned[d] = 0
    dayActual[d] = 0
  }
  employees.forEach(emp => {
    Object.keys(emp.working_days).forEach(dStr => { dayPlanned[parseInt(dStr)]++ })
    const ts = records[emp.id] || {}
    Object.entries(ts).forEach(([dStr, h]) => { if (h > 0) dayActual[parseInt(dStr)]++ })
  })

  const today = new Date()
  const todayDay = (today.getFullYear() === year && today.getMonth() + 1 === month) ? today.getDate() : null

  // Для бригадиров: ячейка редактируема только если это сегодняшний день
  const isCellEditable = (d) => {
    if (!canEdit) return false
    if (onlyToday) return d === todayDay  // только сегодня
    return true
  }

  return (
    <div className="wf-schedule">
      <div className="wf-toolbar">
        <div className="wf-toolbar-info">
          <span className="wf-prod-label">{PRODUCTIONS[production]}</span>
          <span className="wf-sub-label">Табель на {MONTH_NAMES[month - 1]} {year}</span>
          <span className="wf-count-badge">{filteredEmps.length}{filteredEmps.length !== employees.length ? `/${employees.length}` : ''} сотр.</span>
        </div>
        <div className="wf-toolbar-actions">
          {msg && <span className={`wf-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</span>}
          {!canEdit && <span className="wf-msg">Просмотр (только чтение)</span>}
          {onlyToday && canEdit && (
            <span className="wf-ts-today-badge">
              ⏱ Редактирование только сегодня ({todayDay ? `${todayDay} ${MONTH_NAMES[month-1]}` : 'недоступно'})
            </span>
          )}
        </div>
      </div>

      {/* Фильтры и сортировка */}
      <div className="wf-filter-bar">
        <FilterDropdown label="Должности" options={tsPositions} selected={positionFilter} onChange={setPositionFilter} />
        <FilterDropdown label="Статусы" options={tsStatuses} selected={statusFilter} onChange={setStatusFilter} />
        {hasSections && (
          <FilterDropdown label="Участки" options={availableSections} selected={sectionFilter} onChange={setSectionFilter} />
        )}
        <div className="wf-filter-sep" />
        <span className="wf-filter-label">Сорт:</span>
        <button type="button" className={`wf-btn wf-btn-secondary wf-btn-xs ${sortBy === 'fio' ? 'wf-btn-active' : ''}`} onClick={() => setSortBy('fio')}>ФИО</button>
        <button type="button" className={`wf-btn wf-btn-secondary wf-btn-xs ${sortBy === 'position' ? 'wf-btn-active' : ''}`} onClick={() => setSortBy('position')}>Должность</button>
        <button type="button" className={`wf-btn wf-btn-secondary wf-btn-xs ${sortBy === 'status' ? 'wf-btn-active' : ''}`} onClick={() => setSortBy('status')}>Статус</button>
        {hasSections && (
          <button type="button" className={`wf-btn wf-btn-secondary wf-btn-xs ${sortBy === 'section' ? 'wf-btn-active' : ''}`} onClick={() => setSortBy('section')}>Участок</button>
        )}
        {(positionFilter.length > 0 || statusFilter.length > 0 || sectionFilter.length > 0) && (
          <>
            <div className="wf-filter-sep" />
            <button type="button" className="wf-btn wf-btn-danger wf-btn-xs" onClick={() => { setPositionFilter([]); setStatusFilter([]); setSectionFilter([]) }}>
              ✕ Сбросить фильтры
            </button>
          </>
        )}
      </div>

      <div className="wf-table-scroll">
        <table
          className="wf-schedule-table wf-timesheet-table"
          style={{
            '--wf-fio-width': `${colWidths.fio}px`,
            '--wf-pos-width': `${colWidths.pos}px`,
            '--wf-status-width': `${colWidths.status}px`,
            '--wf-section-width': `${colWidths.section}px`,
          }}
        >
          <thead>
            <tr>
              <th className="wf-col-name wf-resizable-col" style={{ width: colWidths.fio, minWidth: colWidths.fio, maxWidth: colWidths.fio }}>
                ФИО<ResizeHandle col="fio" onMouseDown={startResize} />
              </th>
              <th className="wf-col-pos wf-resizable-col" style={{ width: colWidths.pos, minWidth: colWidths.pos, maxWidth: colWidths.pos }}>
                Должность<ResizeHandle col="pos" onMouseDown={startResize} />
              </th>
              <th className={`wf-col-status wf-resizable-col${!hasSections ? ' wf-last-sticky' : ''}`} style={{ width: colWidths.status, minWidth: colWidths.status, maxWidth: colWidths.status }}>
                Статус<ResizeHandle col="status" onMouseDown={startResize} />
              </th>
              {hasSections && <th className="wf-col-section wf-resizable-col wf-last-sticky" style={{ width: colWidths.section, minWidth: colWidths.section, maxWidth: colWidths.section }}>
                Участок<ResizeHandle col="section" onMouseDown={startResize} />
              </th>}
              {Array.from({ length: numDays }, (_, i) => i + 1).map(d => (
                <th key={d} className={`wf-col-day ${isWeekend(year, month, d) ? 'wf-weekend' : ''} ${d === todayDay ? 'wf-today' : ''}`}>
                  <div>{d}</div>
                  <div className="wf-dow">{DAY_NAMES[getDayOfWeek(year, month, d)]}</div>
                </th>
              ))}
              <th className="wf-col-total">Ч план</th>
              <th className="wf-col-total">Ч факт</th>
              <th className="wf-col-total">₽ план</th>
              <th className="wf-col-total">₽ факт</th>
            </tr>
          </thead>
          <tbody>
            {sortedEmps.map(emp => {
              const rate = rateMap[`${emp.position}|${emp.status}`] || 0
              const ts = records[emp.id] || {}
              const plannedHours = Object.values(emp.working_days).reduce((s, h) => s + h, 0)
              const actualHours = Object.values(ts).reduce((s, h) => s + (h || 0), 0)
              const plannedCost = plannedHours * rate
              const actualCost = actualHours * rate

              return (
                <tr key={emp.id}>
                  <td className="wf-col-name" style={{ width: colWidths.fio, minWidth: colWidths.fio }}>{emp.full_name}</td>
                  <td className="wf-col-pos">{emp.position}</td>
                  <td className={`wf-col-status${!hasSections ? ' wf-last-sticky' : ''}`}><span className="wf-status-badge">{emp.status}</span></td>
                  {hasSections && (
                    <td
                      className={`wf-col-section wf-last-sticky${canEdit ? ' wf-section-editable' : ''}`}
                      title={canEdit ? 'Нажмите для изменения участка' : (sectionMap[emp.full_name?.trim()] || '')}
                      onClick={() => canEdit && setEditingSection(emp.full_name?.trim())}
                    >
                      {editingSection === emp.full_name?.trim() ? (
                        <select
                          className="wf-cell-input wf-section-select"
                          autoFocus
                          value={sectionMap[emp.full_name?.trim()] || ''}
                          onChange={e => handleSectionEdit(emp.full_name, e.target.value)}
                          onBlur={() => setEditingSection(null)}
                          onKeyDown={e => e.key === 'Escape' && setEditingSection(null)}
                          onClick={e => e.stopPropagation()}
                        >
                          <option value="">— не задан —</option>
                          {availableSections.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : (
                        sectionMap[emp.full_name?.trim()] || <span className="wf-section-empty">—</span>
                      )}
                    </td>
                  )}
                  {Array.from({ length: numDays }, (_, i) => i + 1).map(d => {
                    const dayStr = String(d)
                    const plannedH = emp.working_days[dayStr]
                    const actualH = ts[dayStr]
                    const isScheduled = plannedH !== undefined
                    const isFilled = actualH !== undefined
                    const isToday = d === todayDay

                    const isEditing = editCell?.empId === emp.id && editCell?.day === dayStr
                    const cellCanEdit = isCellEditable(d)
                    // Стиль ячейки:
                    // wf-ts-scheduled = по плану (голубой)
                    // wf-ts-unscheduled-fill = не по плану но есть часы (оранжевый)
                    // wf-ts-worked / wf-ts-absent = заполнен факт
                    // wf-ts-locked = заблокировано (не сегодня, бригадир)
                    const cellClass = [
                      'wf-day-cell',
                      isWeekend(year, month, d) ? 'wf-weekend' : '',
                      isToday ? 'wf-today' : '',
                      isScheduled ? 'wf-ts-scheduled' : (isFilled && actualH > 0 ? 'wf-ts-unscheduled-fill' : ''),
                      isFilled ? (actualH > 0 ? 'wf-ts-worked' : 'wf-ts-absent') : '',
                      cellCanEdit ? 'wf-editable' : '',
                      onlyToday && !isToday && canEdit ? 'wf-ts-locked' : '',
                      isEditing ? 'wf-ref-editing' : '',
                    ].filter(Boolean).join(' ')

                    const cellTitle = cellCanEdit
                      ? isScheduled
                        ? (actualH !== undefined ? `Факт: ${actualH}ч (план: ${plannedH}ч)` : `План: ${plannedH}ч — нажмите`)
                        : (actualH !== undefined ? `Внеплановый выход: ${actualH}ч — нажмите` : 'Нет в графике — нажмите для внепланового часов')
                      : onlyToday && !isToday && canEdit
                        ? 'Бригадир может редактировать только сегодняшний день'
                        : undefined

                    return (
                      <td
                        key={d}
                        className={cellClass}
                        onClick={() => !isEditing && cellCanEdit && handleCellClick(emp.id, dayStr, actualH, plannedH)}
                        title={cellTitle}
                      >
                        {isEditing ? (
                          <input
                            className="wf-ts-input-edit wf-ts-input-flash"
                            type="number"
                            min="0"
                            max="24"
                            step="0.5"
                            autoFocus
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onFocus={e => e.target.select()}
                            onBlur={handleCellSave}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleCellSave()
                              if (e.key === 'Escape') setEditCell(null)
                            }}
                          />
                        ) : (
                          <span className={
                            actualH !== undefined
                              ? (actualH > 0 ? 'wf-ts-val' : 'wf-ts-absent-val')
                              : isScheduled ? 'wf-ts-plan' : ''
                          }>
                            {actualH !== undefined ? actualH : (isScheduled ? plannedH : '')}
                          </span>
                        )}
                      </td>
                    )
                  })}
                  <td className="wf-col-total wf-num">{plannedHours}</td>
                  <td className="wf-col-total wf-num">{actualHours || '—'}</td>
                  <td className="wf-col-total wf-num">{fmtCost(plannedCost)}</td>
                  <td className="wf-col-total wf-num">{actualHours ? fmtCost(actualCost) : '—'}</td>
                </tr>
              )
            })}

            {/* Строки итогов */}
            <tr className="wf-totals-row">
              <td colSpan={3} className="wf-totals-label">План (чел.):</td>
              {Array.from({ length: numDays }, (_, i) => i + 1).map(d => (
                <td key={d} className={`wf-day-total ${isWeekend(year, month, d) ? 'wf-weekend' : ''} ${d === todayDay ? 'wf-today' : ''}`}>
                  {dayPlanned[d] > 0 ? dayPlanned[d] : ''}
                </td>
              ))}
              <td colSpan={4}></td>
            </tr>
            <tr className="wf-totals-row wf-totals-actual">
              <td colSpan={3} className="wf-totals-label">Факт (чел.):</td>
              {Array.from({ length: numDays }, (_, i) => i + 1).map(d => {
                const diff = dayActual[d] - dayPlanned[d]
                return (
                  <td key={d} className={`wf-day-total ${isWeekend(year, month, d) ? 'wf-weekend' : ''} ${d === todayDay ? 'wf-today' : ''}`}>
                    {dayActual[d] > 0 ? (
                      <span className={diff < 0 ? 'wf-neg' : diff > 0 ? 'wf-pos' : ''}>{dayActual[d]}</span>
                    ) : ''}
                  </td>
                )
              })}
              <td colSpan={4}></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="wf-hint-box">
        Голубой фон = по плану (из графика). Нажмите на любую ячейку для внесения факта — даже если сотрудника нет в графике (оранжевый). Серое число = план. Зелёное = факт &gt; 0. <kbd>Enter</kbd> — сохранить, <kbd>Esc</kbd> — отмена.
      </div>
    </div>
  )
}

// ─── Выгрузка табелей ────────────────────────────────────────────────────────
function TimesheetExportTab({ userInfo }) {
  const now = new Date()
  const isAdmin = userInfo?.schedule_role === 'admin'
  const userProd = userInfo?.schedule_production

  const [expProd, setExpProd]   = useState(isAdmin ? 'tea' : (userProd || 'tea'))
  const [expYear, setExpYear]   = useState(now.getFullYear())
  const [expMonth, setExpMonth] = useState(now.getMonth() + 1)
  const [fromDay, setFromDay]   = useState(1)
  const [toDay, setToDay]       = useState(getDaysInMonth(now.getFullYear(), now.getMonth() + 1))
  const [status, setStatus]     = useState('all')

  const [loading, setLoading]     = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [preview, setPreview]     = useState(null)
  const [error, setError]         = useState(null)
  const previewRef = useRef(null)

  // Подтягиваем доступные статусы из справочника
  const [allStatuses, setAllStatuses] = useState([])
  useEffect(() => {
    apiFetch(`${API}/workforce/reference`)
      .then(d => {
        const s = [...new Set((d || []).map(r => r.status).filter(Boolean))]
        setAllStatuses(s)
      })
      .catch(() => {})
  }, [])

  // Обновить toDay при смене месяца/года
  useEffect(() => {
    const max = getDaysInMonth(expYear, expMonth)
    if (toDay > max) setToDay(max)
    if (fromDay > max) setFromDay(1)
  }, [expYear, expMonth])

  const productions = isAdmin
    ? Object.entries(PRODUCTIONS)
    : [[userProd, PRODUCTIONS[userProd] || userProd]]

  const buildPreview = async () => {
    setLoading(true)
    setError(null)
    setPreview(null)
    try {
      const [sched, ts, ref] = await Promise.all([
        apiFetch(`${API}/workforce/schedule/${expProd}/${expYear}/${expMonth}`),
        apiFetch(`${API}/workforce/timesheet/${expProd}/${expYear}/${expMonth}`),
        apiFetch(`${API}/workforce/reference`),
      ])
      // Карта ставок
      const rateMap = {}
      ;(ref || []).forEach(r => { rateMap[`${r.position}|${r.status}`] = r.hourly_rate })

      // Дни периода
      const days = []
      for (let d = fromDay; d <= toDay; d++) days.push(d)

      // Фильтруем сотрудников
      let employees = sched.employees || []
      if (status !== 'all') employees = employees.filter(e => e.status === status)

      const records = ts.records || {}

      // Строим строки
      const rows = employees.map(emp => {
        const rate = rateMap[`${emp.position}|${emp.status}`] || 0
        const tsEmp = records[emp.id] || {}
        const hoursPerDay = {}
        const costPerDay = {}
        let totalH = 0, totalC = 0
        days.forEach(d => {
          const h = tsEmp[String(d)]
          if (h !== undefined && h !== null) {
            hoursPerDay[d] = h
            costPerDay[d] = h * rate
            totalH += h
            totalC += h * rate
          }
        })
        return { id: emp.id, full_name: emp.full_name, position: emp.position, status: emp.status, rate, hoursPerDay, costPerDay, totalH, totalC }
      })

      // Итоги по дням
      const dayTotalsH = {}, dayTotalsC = {}
      days.forEach(d => {
        dayTotalsH[d] = rows.reduce((s, r) => s + (r.hoursPerDay[d] || 0), 0)
        dayTotalsC[d] = rows.reduce((s, r) => s + (r.costPerDay[d] || 0), 0)
      })
      const grandH = rows.reduce((s, r) => s + r.totalH, 0)
      const grandC = rows.reduce((s, r) => s + r.totalC, 0)

      setPreview({
        production: expProd, productionName: PRODUCTIONS[expProd],
        status, period: { year: expYear, month: expMonth, fromDay, toDay },
        days, rows, dayTotalsH, dayTotalsC, grandH, grandC,
      })
    } catch (e) {
      setError(e.message || 'Ошибка загрузки данных')
    } finally {
      setLoading(false)
    }
  }

  const handlePrint = async () => {
    if (!preview || !previewRef.current) return
    setPdfLoading(true)
    try {
      const { productionName, status: st, period } = preview
      const monthName = MONTH_NAMES[period.month - 1]
      const filename = `Табель_${productionName}_${period.fromDay}-${period.toDay}_${monthName}_${period.year}.pdf`

      const element = previewRef.current

      await html2pdf().set({
        margin: [8, 6, 8, 6],
        filename,
        image: { type: 'jpeg', quality: 0.97 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          logging: false,
          letterRendering: true,
        },
        jsPDF: {
          unit: 'mm',
          format: 'a4',
          orientation: 'landscape',
        },
        pagebreak: { mode: 'avoid-all' },
      }).from(element).save()
    } catch (e) {
      console.error('PDF error:', e)
      alert('Ошибка генерации PDF. Попробуйте ещё раз.')
    } finally {
      setPdfLoading(false)
    }
  }

  const numDays = preview ? preview.days.length : 0
  const maxDay = getDaysInMonth(expYear, expMonth)

  return (
    <div className="wf-export">
      {/* Панель фильтров */}
      <div className="wf-export-filters">
        <h3>Выгрузка табеля</h3>
        <div className="wf-export-form">
          {/* Производство */}
          <label className="wf-export-label">
            Производство
            <select className="wf-select" value={expProd} onChange={e => setExpProd(e.target.value)}>
              {productions.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
            </select>
          </label>

          {/* Месяц/год */}
          <label className="wf-export-label">
            Месяц
            <div style={{display:'flex', gap:'0.35rem'}}>
              <select className="wf-select" value={expMonth} onChange={e => setExpMonth(Number(e.target.value))}>
                {MONTH_NAMES.map((n, i) => <option key={i+1} value={i+1}>{n}</option>)}
              </select>
              <select className="wf-select" value={expYear} onChange={e => setExpYear(Number(e.target.value))}>
                {[expYear - 1, expYear, expYear + 1].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </label>

          {/* Период */}
          <label className="wf-export-label">
            С дня
            <select className="wf-select" value={fromDay} onChange={e => setFromDay(Number(e.target.value))}>
              {Array.from({length: maxDay}, (_, i) => i+1).map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <label className="wf-export-label">
            По день
            <select className="wf-select" value={toDay} onChange={e => setToDay(Number(e.target.value))}>
              {Array.from({length: maxDay}, (_, i) => i+1).filter(d => d >= fromDay).map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>

          {/* Статус */}
          <label className="wf-export-label">
            Статус
            <select className="wf-select" value={status} onChange={e => setStatus(e.target.value)}>
              <option value="all">Все статусы</option>
              {allStatuses.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>

          <button
            className="wf-btn wf-btn-primary"
            onClick={buildPreview}
            disabled={loading}
            style={{alignSelf:'flex-end'}}
          >
            {loading ? 'Загрузка...' : 'Показать'}
          </button>
        </div>
        {error && <div className="wf-error" style={{marginTop:'0.5rem'}}>{error}</div>}
      </div>

      {/* Предпросмотр */}
      {preview && (
        <>
          <div className="wf-export-header-row">
            <div className="wf-export-title-info">
              <strong>{preview.productionName}</strong>
              {' · '}
              {preview.status === 'all' ? 'Все статусы' : preview.status}
              {' · '}
              {preview.period.fromDay}–{preview.period.toDay} {MONTH_NAMES[preview.period.month - 1]} {preview.period.year}
              {' · '}
              {preview.rows.length} чел.
            </div>
            <button
              className="wf-btn wf-btn-primary"
              onClick={handlePrint}
              disabled={pdfLoading || preview.rows.length === 0}
              style={{whiteSpace:'nowrap', minWidth:'140px'}}
            >
              {pdfLoading ? '⏳ Генерация...' : '↓ Скачать PDF'}
            </button>
          </div>

          {preview.rows.length === 0 ? (
            <div className="wf-empty" style={{padding:'1.5rem'}}>
              Нет данных по выбранным фильтрам. Проверьте, что табель заполнен и статус совпадает.
            </div>
          ) : (
            <div className="wf-export-preview" ref={previewRef}>
              {/* Заголовок для PDF */}
              <div className="wf-pdf-title">
                <strong>Табель: {preview.productionName}</strong>
                {' · '}
                {preview.status === 'all' ? 'Все статусы' : preview.status}
                {' · '}
                {preview.period.fromDay}–{preview.period.toDay} {MONTH_NAMES[preview.period.month - 1]} {preview.period.year}
                <span style={{float:'right', fontWeight:400, fontSize:'0.78rem', color:'var(--text-muted)'}}>
                  {new Date().toLocaleDateString('ru-RU')}
                </span>
              </div>

              {/* Блок 1: Часы */}
              <div className="wf-export-block-title">ЧАСЫ</div>
              <div className="wf-table-scroll">
                <table className="wf-export-table">
                  <thead>
                    <tr>
                      <th className="wf-exp-col-name">ФИО</th>
                      <th className="wf-exp-col-status">Статус</th>
                      {preview.days.map(d => (
                        <th key={d} className="wf-exp-col-day">{d}</th>
                      ))}
                      <th className="wf-exp-col-total">Итого ч</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map(row => (
                      <tr key={row.id}>
                        <td className="wf-exp-col-name">{row.full_name}</td>
                        <td className="wf-exp-col-status"><span className="wf-status-badge">{row.status}</span></td>
                        {preview.days.map(d => (
                          <td key={d} className={`wf-exp-col-day ${row.hoursPerDay[d] ? 'wf-exp-filled' : ''}`}>
                            {row.hoursPerDay[d] || ''}
                          </td>
                        ))}
                        <td className="wf-exp-col-total">{row.totalH > 0 ? <strong>{row.totalH}</strong> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="wf-exp-footer">
                      <td colSpan={2} className="wf-exp-footer-label">ИТОГО часов:</td>
                      {preview.days.map(d => (
                        <td key={d} className="wf-exp-col-day">{preview.dayTotalsH[d] > 0 ? preview.dayTotalsH[d] : ''}</td>
                      ))}
                      <td className="wf-exp-col-total"><strong>{preview.grandH}</strong></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Блок 2: Рубли */}
              <div className="wf-export-block-title" style={{marginTop:'1.25rem'}}>РУБЛИ</div>
              <div className="wf-table-scroll">
                <table className="wf-export-table">
                  <thead>
                    <tr>
                      <th className="wf-exp-col-name">ФИО</th>
                      <th className="wf-exp-col-status">Статус</th>
                      <th className="wf-exp-col-rate">₽/ч</th>
                      {preview.days.map(d => (
                        <th key={d} className="wf-exp-col-day">{d}</th>
                      ))}
                      <th className="wf-exp-col-total">Итого ₽</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map(row => (
                      <tr key={row.id}>
                        <td className="wf-exp-col-name">{row.full_name}</td>
                        <td className="wf-exp-col-status"><span className="wf-status-badge">{row.status}</span></td>
                        <td className="wf-exp-col-rate wf-num">{row.rate > 0 ? row.rate : '—'}</td>
                        {preview.days.map(d => (
                          <td key={d} className={`wf-exp-col-day ${row.costPerDay[d] ? 'wf-exp-filled' : ''}`}>
                            {row.costPerDay[d] ? row.costPerDay[d].toLocaleString('ru-RU', {maximumFractionDigits:0}) : ''}
                          </td>
                        ))}
                        <td className="wf-exp-col-total">
                          {row.totalC > 0 ? <strong>{row.totalC.toLocaleString('ru-RU', {maximumFractionDigits:0})} ₽</strong> : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="wf-exp-footer">
                      <td colSpan={3} className="wf-exp-footer-label">ИТОГО рублей:</td>
                      {preview.days.map(d => (
                        <td key={d} className="wf-exp-col-day">
                          {preview.dayTotalsC[d] > 0 ? preview.dayTotalsC[d].toLocaleString('ru-RU', {maximumFractionDigits:0}) : ''}
                        </td>
                      ))}
                      <td className="wf-exp-col-total">
                        <strong>{preview.grandC.toLocaleString('ru-RU', {maximumFractionDigits:0})} ₽</strong>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// buildPrintHTML больше не используется — PDF генерируется через html2pdf.js из DOM
function buildPrintHTML(data) {  // eslint-disable-line no-unused-vars
  const { productionName, status, period, days, rows, dayTotalsH, dayTotalsC, grandH, grandC } = data
  const monthName = MONTH_NAMES[period.month - 1]
  const periodStr = `${period.fromDay} – ${period.toDay} ${monthName} ${period.year} г.`
  const statusStr = status === 'all' ? 'Все статусы' : status
  const title = `Табель: ${productionName} · ${statusStr} · ${periodStr}`

  const n = (v, dec = 0) => v > 0
    ? new Intl.NumberFormat('ru-RU', {maximumFractionDigits: dec}).format(v)
    : ''

  const dayHeaders = days.map(d => `<th>${d}</th>`).join('')
  const dayHeadersExtra = days.map(d => `<th>${d}</th>`).join('')

  // Строки часов
  const hoursRows = rows.map(row => {
    const cells = days.map(d => {
      const h = row.hoursPerDay[d]
      return `<td class="${h ? 'filled' : ''}">${h || ''}</td>`
    }).join('')
    return `<tr>
      <td class="name">${row.full_name}</td>
      <td class="status">${row.status}</td>
      ${cells}
      <td class="total-cell">${row.totalH > 0 ? `<b>${row.totalH}</b>` : '—'}</td>
    </tr>`
  }).join('')

  const hoursTotalCells = days.map(d => `<td>${n(dayTotalsH[d])}</td>`).join('')
  const hoursFooter = `<tr class="footer-row">
    <td colspan="2" class="footer-label">ИТОГО часов:</td>
    ${hoursTotalCells}
    <td class="total-cell"><b>${grandH}</b></td>
  </tr>`

  // Строки рублей
  const rubRows = rows.map(row => {
    const cells = days.map(d => {
      const c = row.costPerDay[d]
      return `<td class="${c ? 'filled' : ''}">${c ? n(c) : ''}</td>`
    }).join('')
    return `<tr>
      <td class="name">${row.full_name}</td>
      <td class="status">${row.status}</td>
      <td class="rate">${row.rate > 0 ? row.rate : '—'}</td>
      ${cells}
      <td class="total-cell">${row.totalC > 0 ? `<b>${n(row.totalC)} ₽</b>` : '—'}</td>
    </tr>`
  }).join('')

  const rubTotalCells = days.map(d => `<td>${n(dayTotalsC[d])}</td>`).join('')
  const rubFooter = `<tr class="footer-row">
    <td colspan="3" class="footer-label">ИТОГО рублей:</td>
    ${rubTotalCells}
    <td class="total-cell"><b>${n(grandC)} ₽</b></td>
  </tr>`

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  @page { size: A4 landscape; margin: 12mm 10mm 12mm 10mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Arial', 'Helvetica Neue', sans-serif; font-size: 8pt; color: #111; margin: 0; }
  h2 { font-size: 11pt; margin: 0 0 2mm; font-weight: 700; }
  .subtitle { font-size: 8.5pt; color: #444; margin-bottom: 3mm; }
  .block-title {
    font-size: 9pt; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.05em; color: #1a3a5c;
    border-bottom: 2px solid #1a3a5c; margin: 4mm 0 2mm; padding-bottom: 0.5mm;
  }
  table { border-collapse: collapse; width: 100%; table-layout: fixed; }
  th, td { border: 1px solid #bbb; padding: 1.5mm 1mm; text-align: center; vertical-align: middle; overflow: hidden; }
  th { background: #1a3a5c; color: #fff; font-size: 7.5pt; font-weight: 700; }
  td.name { text-align: left; font-size: 7pt; }
  td.status { font-size: 7pt; }
  td.rate { font-size: 7pt; }
  td.total-cell { font-weight: 700; background: #eef4ff; font-size: 8pt; }
  td.filled { background: #e8f5e9; }
  tr.footer-row td { background: #d6e8f7; font-weight: 700; font-size: 8pt; }
  td.footer-label { text-align: right; font-style: italic; }
  tr:nth-child(even) td { background: #f7f9fc; }
  tr:nth-child(even) td.filled { background: #dff0df; }
  tr:nth-child(even) td.total-cell { background: #ddeeff; }
  tr.footer-row td { background: #cde0f0 !important; }
  .col-name  { width: 42mm; }
  .col-status{ width: 16mm; }
  .col-rate  { width: 12mm; }
  .col-day   { width: ${Math.max(5, Math.min(9, Math.floor(185 / days.length)))}mm; font-size: 7pt; }
  .col-total { width: 16mm; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none; }
  }
</style>
</head>
<body>
  <h2>${title}</h2>
  <div class="subtitle">Сформировано: ${new Date().toLocaleString('ru-RU')}</div>

  <div class="block-title">Часы</div>
  <table>
    <thead>
      <tr>
        <th class="col-name">ФИО</th>
        <th class="col-status">Статус</th>
        ${dayHeaders}
        <th class="col-total">Итого ч</th>
      </tr>
    </thead>
    <tbody>${hoursRows}</tbody>
    <tfoot>${hoursFooter}</tfoot>
  </table>

  <div class="block-title" style="margin-top:5mm">Рубли</div>
  <table>
    <thead>
      <tr>
        <th class="col-name">ФИО</th>
        <th class="col-status">Статус</th>
        <th class="col-rate">₽/ч</th>
        ${dayHeadersExtra}
        <th class="col-total">Итого ₽</th>
      </tr>
    </thead>
    <tbody>${rubRows}</tbody>
    <tfoot>${rubFooter}</tfoot>
  </table>

  <script>
    window.addEventListener('load', function() { window.print(); });
  </script>
</body>
</html>`
}


// ─── Аналитика ────────────────────────────────────────────────────────────────
const n0  = (v) => v > 0 ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(v) : ''
const n0z = (v) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(v || 0)

// ─── Старая аналитика (карточки + день-сетка) ─────────────────────────────────
function AnalyticsTab({ year, month }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedDay, setSelectedDay] = useState(null)
  const [dayData, setDayData] = useState(null)
  const numDays = getDaysInMonth(year, month)

  useEffect(() => {
    setLoading(true)
    apiFetch(`${API}/workforce/analytics/${year}/${month}`)
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [year, month])

  const handleDayClick = async (day) => {
    setSelectedDay(day)
    try {
      const d = await apiFetch(`${API}/workforce/analytics/${year}/${month}/${day}`)
      setDayData(d)
    } catch { setDayData(null) }
  }

  if (loading) return <div className="wf-loading">Загрузка аналитики...</div>
  if (!data) return <div className="wf-error">Ошибка загрузки аналитики</div>

  const prods = data.productions || {}
  const totalEmployees  = Object.values(prods).reduce((s, p) => s + p.total_employees, 0)
  const totalPlannedCost = Object.values(prods).reduce((s, p) => s + p.total_planned_cost, 0)
  const totalActualCost  = Object.values(prods).reduce((s, p) => s + p.total_actual_cost, 0)

  return (
    <div className="wf-analytics">
      <h3>Аналитика: {MONTH_NAMES[month - 1]} {year}</h3>
      <div className="wf-analytics-cards">
        <div className="wf-card"><div className="wf-card-label">Всего сотрудников</div><div className="wf-card-value">{totalEmployees}</div></div>
        <div className="wf-card wf-card-plan"><div className="wf-card-label">ФОТ план (месяц)</div><div className="wf-card-value">{fmtCost(totalPlannedCost)}</div></div>
        <div className="wf-card wf-card-fact"><div className="wf-card-label">ФОТ факт (месяц)</div><div className="wf-card-value">{fmtCost(totalActualCost)}</div></div>
        {totalPlannedCost > 0 && (
          <div className={`wf-card ${totalActualCost <= totalPlannedCost ? 'wf-card-pos' : 'wf-card-neg'}`}>
            <div className="wf-card-label">Отклонение</div>
            <div className="wf-card-value">{fmtCost(totalActualCost - totalPlannedCost)}</div>
          </div>
        )}
      </div>

      <div className="wf-analytics-prods">
        {Object.entries(prods).map(([prod, p]) => (
          <div key={prod} className="wf-analytics-prod-card">
            <h4>{p.name}</h4>
            <div className="wf-analytics-prod-stats">
              <div className="wf-stat-row"><span>Сотрудников:</span><strong>{p.total_employees}</strong></div>
              {Object.entries(p.status_counts).map(([status, cnt]) => (
                <div key={status} className="wf-stat-row wf-stat-sub">
                  <span><span className="wf-status-badge wf-status-badge-sm">{status}</span></span>
                  <strong>{cnt}</strong>
                </div>
              ))}
              <div className="wf-stat-divider"></div>
              <div className="wf-stat-row"><span>ФОТ план:</span><strong>{fmtCost(p.total_planned_cost)}</strong></div>
              <div className="wf-stat-row"><span>ФОТ факт:</span><strong>{p.total_actual_cost > 0 ? fmtCost(p.total_actual_cost) : '—'}</strong></div>
              <div className="wf-stat-row"><span>Часы план:</span><strong>{p.total_planned_hours}</strong></div>
              <div className="wf-stat-row"><span>Часы факт:</span><strong>{p.total_actual_hours > 0 ? p.total_actual_hours : '—'}</strong></div>
            </div>
          </div>
        ))}
      </div>

      <div className="wf-analytics-daily">
        <h4>По дням — нажмите на день для подробностей</h4>
        <div className="wf-daily-grid">
          {Array.from({ length: numDays }, (_, i) => i + 1).map(d => {
            const totalPlanned = Object.values(prods).reduce((s, p) => s + (p.daily_planned[String(d)] || 0), 0)
            const totalActual  = Object.values(prods).reduce((s, p) => s + (p.daily_actual[String(d)]  || 0), 0)
            const hasData  = totalPlanned > 0
            const isToday  = new Date().getFullYear() === year && new Date().getMonth()+1 === month && new Date().getDate() === d
            return (
              <div key={d}
                className={`wf-day-card ${hasData ? 'wf-day-card-active' : ''} ${selectedDay === d ? 'wf-day-card-selected' : ''} ${isWeekend(year, month, d) ? 'wf-day-card-weekend' : ''} ${isToday ? 'wf-day-card-today' : ''}`}
                onClick={() => hasData && handleDayClick(d)}
              >
                <div className="wf-day-num">{d}</div>
                <div className="wf-day-dow">{DAY_NAMES[getDayOfWeek(year, month, d)]}</div>
                {hasData && <>
                  <div className="wf-day-plan">{totalPlanned}</div>
                  {totalActual > 0 && <div className={`wf-day-fact ${totalActual < totalPlanned ? 'wf-neg' : ''}`}>{totalActual}</div>}
                </>}
              </div>
            )
          })}
        </div>
        <div className="wf-daily-legend">
          <span><span className="wf-legend-plan"></span>Синее — план</span>
          <span><span className="wf-legend-fact"></span>Зелёное/красное — факт</span>
        </div>
      </div>

      {selectedDay && dayData && (
        <div className="wf-day-detail">
          <h4>{selectedDay} {MONTH_NAMES[month - 1]} {year} — детали по производствам</h4>
          <div className="wf-day-detail-grid">
            {Object.entries(dayData.productions).map(([prod, dp]) => (
              <div key={prod} className="wf-day-detail-card">
                <div className="wf-day-detail-name">{dp.name}</div>
                <div className="wf-day-detail-row"><span>План (чел.):</span><strong>{dp.planned_count}</strong></div>
                <div className="wf-day-detail-row"><span>Факт (чел.):</span><strong className={dp.actual_count < dp.planned_count ? 'wf-neg' : ''}>{dp.actual_count}</strong></div>
                <div className="wf-day-detail-row"><span>ФОТ план:</span><strong>{fmtCost(dp.planned_cost)}</strong></div>
                <div className="wf-day-detail-row"><span>ФОТ факт:</span><strong>{dp.actual_cost > 0 ? fmtCost(dp.actual_cost) : '—'}</strong></div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Матричная аналитика ──────────────────────────────────────────────────────

function MatrixSection({ prods, days, year, month, mode, expanded, onToggle }) {
  const prodKeys = Object.keys(prods)
  const grandPlan = (d) => prodKeys.reduce((s, k) =>
    s + (mode === 'people' ? (prods[k].daily_planned[d] || 0) : (prods[k].daily_planned_cost[d] || 0)), 0)
  const grandFact = (d) => prodKeys.reduce((s, k) =>
    s + (mode === 'people' ? (prods[k].daily_actual[d] || 0) : (prods[k].daily_actual_cost[d] || 0)), 0)

  const pf = (plan, fact, wknd = false) => (
    <>
      <td className={`wf-am-pf wf-am-plan${wknd ? ' wf-weekend' : ''}`}>{n0(plan)}</td>
      <td className={`wf-am-pf wf-am-fact${wknd ? ' wf-weekend' : ''}${fact > 0 && fact < plan ? ' wf-am-under' : ''}`}>{n0(fact)}</td>
    </>
  )

  return (
    <div className="wf-am-scroll-wrap">
      <table className="wf-analytics-matrix">
        <thead>
          <tr>
            <th className="wf-am-col-group wf-am-sticky-head" rowSpan={2}>
              {mode === 'people' ? 'Вышло сотрудников' : 'Потрачено денег, ₽'}
            </th>
            <th className="wf-am-col-sub wf-am-sticky-head wf-am-sticky2" rowSpan={2}>Статус</th>
            {days.map(d => (
              <th key={d} colSpan={2} className={`wf-am-day-header${isWeekend(year, month, d) ? ' wf-weekend' : ''}${new Date().getDate() === d && new Date().getMonth()+1 === month && new Date().getFullYear() === year ? ' wf-today' : ''}`}>
                {d}
              </th>
            ))}
            <th colSpan={2} className="wf-am-day-header wf-am-total-header">Итого</th>
          </tr>
          <tr>
            {days.map(d => (
              <>
                <th key={`${d}-p`} className={`wf-am-pf wf-am-plan${isWeekend(year, month, d) ? ' wf-weekend' : ''}`}>пл</th>
                <th key={`${d}-f`} className={`wf-am-pf wf-am-fact${isWeekend(year, month, d) ? ' wf-weekend' : ''}`}>фк</th>
              </>
            ))}
            <th className="wf-am-pf wf-am-plan">пл</th>
            <th className="wf-am-pf wf-am-fact">фк</th>
          </tr>
        </thead>
        <tbody>
          {/* Итого ВСЕГО */}
          <tr className="wf-am-grand-row">
            <td className="wf-am-col-group wf-am-sticky-td" colSpan={2}>Итого</td>
            {days.map(d => { const ds = String(d); return pf(grandPlan(ds), grandFact(ds), isWeekend(year, month, d)) })}
            {pf(days.reduce((s,d)=>s+grandPlan(String(d)),0), days.reduce((s,d)=>s+grandFact(String(d)),0))}
          </tr>

          {prodKeys.map(pk => {
            const p = prods[pk]
            const isExp = expanded[pk]
            const statuses = Object.keys(p.status_employee_count || {})
            const getPlan = (d) => mode === 'people' ? (p.daily_planned[d] || 0) : (p.daily_planned_cost[d] || 0)
            const getFact = (d) => mode === 'people' ? (p.daily_actual[d]  || 0) : (p.daily_actual_cost[d]  || 0)
            const totPlan = days.reduce((s,d)=>s+getPlan(String(d)),0)
            const totFact = days.reduce((s,d)=>s+getFact(String(d)),0)
            return (
              <>
                {/* Строка производства — кликабельная */}
                <tr key={pk} className="wf-am-prod-row" onClick={() => onToggle(pk)} style={{cursor:'pointer'}}>
                  <td className="wf-am-col-group wf-am-sticky-td wf-am-prod-sticky">
                    <span className="wf-am-toggle">{isExp ? '▼' : '▶'}</span> {p.name}
                  </td>
                  <td className="wf-am-col-sub wf-am-sticky2-td" style={{fontStyle:'italic', color:'var(--text-muted)', fontSize:'0.72rem'}}>
                    {isExp ? 'свернуть' : `${p.total_employees} чел.`}
                  </td>
                  {days.map(d => { const ds=String(d); return pf(getPlan(ds),getFact(ds),isWeekend(year,month,d)) })}
                  {pf(totPlan, totFact)}
                </tr>

                {/* Строки статусов — видны только когда развёрнуто */}
                {isExp && statuses.map(st => {
                  const stPlan = (d) => mode==='people' ? (p.status_daily_planned?.[st]?.[d]||0) : (p.status_daily_plan_cost?.[st]?.[d]||0)
                  const stFact = (d) => mode==='people' ? (p.status_daily_actual?.[st]?.[d]||0) : (p.status_daily_fact_cost?.[st]?.[d]||0)
                  const stTP   = mode==='people' ? days.reduce((s,d)=>s+stPlan(String(d)),0) : (p.status_total_plan_cost?.[st]||0)
                  const stTF   = mode==='people' ? days.reduce((s,d)=>s+stFact(String(d)),0) : (p.status_total_fact_cost?.[st]||0)
                  return (
                    <tr key={`${pk}-${st}`} className="wf-am-status-row">
                      <td className="wf-am-col-group wf-am-sticky-td"></td>
                      <td className="wf-am-col-sub wf-am-sticky2-td">{st}</td>
                      {days.map(d => { const ds=String(d); return pf(stPlan(ds),stFact(ds),isWeekend(year,month,d)) })}
                      {pf(stTP, stTF)}
                    </tr>
                  )
                })}
              </>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function MatrixAnalyticsTab({ year, month }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const numDays = getDaysInMonth(year, month)
  const days = Array.from({ length: numDays }, (_, i) => i + 1)
  // Состояние развёрнутости для каждого производства (по умолчанию все свёрнуты)
  const [expanded, setExpanded] = useState({ tea: false, engraving: false, luminarc: false })

  const loadData = useCallback(() => {
    setLoading(true)
    apiFetch(`${API}/workforce/analytics/${year}/${month}`)
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [year, month])

  useEffect(() => { loadData() }, [loadData])

  const toggle = (prod) => setExpanded(e => ({ ...e, [prod]: !e[prod] }))
  const allExpanded = Object.values(expanded).every(Boolean)
  const toggleAll   = () => setExpanded(Object.fromEntries(Object.keys(expanded).map(k => [k, !allExpanded])))

  if (loading) return <div className="wf-loading">Загрузка...</div>
  if (!data) return <div className="wf-error">Ошибка загрузки</div>

  const prods    = data.productions || {}
  const prodKeys = Object.keys(prods)
  const totalEmp = prodKeys.reduce((s,k) => s + (prods[k].total_employees  || 0), 0)
  const totalPlan = prodKeys.reduce((s,k) => s + (prods[k].total_planned_cost || 0), 0)
  const totalFact = prodKeys.reduce((s,k) => s + (prods[k].total_actual_cost  || 0), 0)

  return (
    <div className="wf-analytics">
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:'0.5rem', marginBottom:'0.5rem'}}>
        <h3 style={{margin:0}}>Матричная аналитика: {MONTH_NAMES[month - 1]} {year}</h3>
        <div style={{display:'flex', gap:'0.5rem', alignItems:'center'}}>
          <button className="wf-btn wf-btn-primary wf-btn-sm" onClick={loadData} disabled={loading} title="Подтянуть актуальные данные после изменений в табелях">
            {loading ? 'Загрузка…' : '🔄 Обновить'}
          </button>
          <button className="wf-btn wf-btn-secondary wf-btn-sm" onClick={toggleAll}>
            {allExpanded ? '▲ Свернуть все' : '▼ Развернуть все'}
          </button>
        </div>
      </div>
      <p style={{fontSize:'0.78rem', color:'var(--text-muted)', margin:'0 0 0.75rem'}}>
        Нажмите на строку производства (▶) чтобы развернуть разбивку по статусам.
      </p>

      <div className="wf-an-section-title">Вышло сотрудников (план / факт)</div>
      <MatrixSection prods={prods} days={days} year={year} month={month} mode="people" expanded={expanded} onToggle={toggle} />

      <div className="wf-an-section-title" style={{marginTop:'1.25rem'}}>Потрачено денег, ₽ (план / факт)</div>
      <MatrixSection prods={prods} days={days} year={year} month={month} mode="money" expanded={expanded} onToggle={toggle} />

      {/* Итоги за месяц */}
      <div className="wf-an-section-title" style={{marginTop:'1.25rem'}}>Итоги за месяц</div>
      <div className="wf-am-totals-grid">
        <div className="wf-am-totals-block">
          <div className="wf-am-totals-title">Всего сотрудников: <strong>{totalEmp}</strong></div>
          {prodKeys.map(k => {
            const p = prods[k]
            return (
              <div key={k} className="wf-am-totals-prod">
                <div className="wf-am-totals-prod-name">{p.name} — <strong>{p.total_employees}</strong></div>
                {Object.entries(p.status_employee_count || {}).map(([st, cnt]) => (
                  <div key={st} className="wf-am-totals-status-row">
                    <span className="wf-status-badge wf-status-badge-sm">{st}</span><span>{cnt}</span>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
        <div className="wf-am-totals-block">
          <div className="wf-am-totals-title">
            ФОТ: <strong>план {n0z(totalPlan)} ₽</strong> /
            <span className={totalFact < totalPlan ? ' wf-neg' : ' wf-pos'}> факт {n0z(totalFact)} ₽</span>
          </div>
          {prodKeys.map(k => {
            const p = prods[k]
            return (
              <div key={k} className="wf-am-totals-prod">
                <div className="wf-am-totals-prod-name">
                  {p.name} — <strong>пл {n0z(p.total_planned_cost)} ₽</strong>
                  <span className={p.total_actual_cost < p.total_planned_cost ? ' wf-neg' : ' wf-pos'}> / фк {n0z(p.total_actual_cost)} ₽</span>
                </div>
                {Object.keys(p.status_total_plan_cost || {}).map(st => (
                  <div key={st} className="wf-am-totals-status-row">
                    <span className="wf-status-badge wf-status-badge-sm">{st}</span>
                    <span>пл {n0z(p.status_total_plan_cost?.[st])} ₽</span>
                    <span className={p.status_total_fact_cost?.[st] < p.status_total_plan_cost?.[st] ? 'wf-neg' : ''}> / фк {n0z(p.status_total_fact_cost?.[st])} ₽</span>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Главная страница ─────────────────────────────────────────────────────────
export default function WorkforcePage({ userInfo }) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [activeTab, setActiveTab] = useState(null)    // 'reference' | 'tea' | 'engraving' | 'luminarc' | 'analytics'
  const [subTab, setSubTab] = useState('schedule')    // 'schedule' | 'timesheet' | 'employees'
  const [reference, setReference] = useState([])
  const [showCombinedImport, setShowCombinedImport] = useState(false)
  // ключ для принудительного перемонтирования таблиц после импорта
  const [importKey, setImportKey] = useState(0)

  const role = userInfo?.schedule_role
  const production = userInfo?.schedule_production
  const fullName = userInfo?.schedule_full_name
  const isAdmin     = role === 'admin'
  const isManager   = role === 'manager'
  const isBrigadier = role === 'brigadier'
  const isViewer    = role === 'viewer'

  // Определяем доступные вкладки
  const availableTabs = []

  // Справочник — только для admin
  if (isAdmin) availableTabs.push('reference')

  // Производства
  if (isAdmin || isViewer) {
    // Полный доступ ко всем производствам
    ;['tea', 'engraving', 'luminarc'].forEach(p => availableTabs.push(p))
  } else if ((isManager || isBrigadier) && production && production !== 'none') {
    availableTabs.push(production)
  }

  // Аналитика — admin, viewers; у менеджера только базовая аналитика (без матричной и выгрузки)
  if (isAdmin || isManager || isViewer) availableTabs.push('analytics')
  if (isAdmin || isViewer) availableTabs.push('matrix_analytics')

  // Выгрузка табелей — только admin и viewer (у менеджера скрыта)
  if (isAdmin || isViewer) availableTabs.push('export')

  // Устанавливаем вкладку по умолчанию
  useEffect(() => {
    if (availableTabs.length > 0 && !activeTab) {
      if (isBrigadier) {
        setActiveTab(production)
        setSubTab('timesheet')
      } else if (isViewer) {
        setActiveTab('analytics')
      } else {
        setActiveTab(availableTabs[0])
      }
    }
  }, [role, production])

  // Загружаем справочник для компонентов
  useEffect(() => {
    apiFetch(`${API}/workforce/reference`)
      .then(d => setReference(Array.isArray(d) ? d : []))
      .catch(() => {})
  }, [])

  if (!role || role === null || (!isAdmin && !isManager && !isBrigadier && !isViewer)) {
    return (
      <div className="wf-page">
        <div className="wf-no-access">
          <h2>Нет доступа</h2>
          <p>У вашей учётной записи нет доступа к модулю «Графики и табели».</p>
        </div>
      </div>
    )
  }

  const tabLabel = (tab) => {
    if (tab === 'reference')        return '📋 Справочник'
    if (tab === 'analytics')        return '📊 Аналитика'
    if (tab === 'matrix_analytics') return '📈 Матричная аналитика'
    if (tab === 'export')           return '📄 Выгрузка табелей'
    return PRODUCTIONS[tab] || tab
  }

  return (
    <div className="wf-page">
      <div className="wf-page-header">
        <h2>Графики и табели работы</h2>
        <div className="wf-month-picker">
          <button className="wf-btn wf-btn-icon-sm" onClick={() => {
            if (month === 1) { setMonth(12); setYear(y => y - 1) } else setMonth(m => m - 1)
          }}>‹</button>
          <select className="wf-select" value={month} onChange={e => setMonth(Number(e.target.value))}>
            {MONTH_NAMES.map((n, i) => <option key={i + 1} value={i + 1}>{n}</option>)}
          </select>
          <select className="wf-select" value={year} onChange={e => setYear(Number(e.target.value))}>
            {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button className="wf-btn wf-btn-icon-sm" onClick={() => {
            if (month === 12) { setMonth(1); setYear(y => y + 1) } else setMonth(m => m + 1)
          }}>›</button>
        </div>
      </div>

      {/* Главные вкладки */}
      <div className="wf-tabs">
        {availableTabs.map(tab => (
          <button
            key={tab}
            className={`wf-tab ${activeTab === tab ? 'wf-tab-active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tabLabel(tab)}
          </button>
        ))}
      </div>

      {/* Суб-вкладки для производств */}
      {activeTab && !['reference', 'analytics'].includes(activeTab) && (
        <div className="wf-subtabs">
          {(isAdmin || isManager) && (
            <button
              className={`wf-subtab ${subTab === 'employees' ? 'wf-subtab-active' : ''}`}
              onClick={() => setSubTab('employees')}
            >
              Сотрудники
            </button>
          )}
          {(isAdmin || isManager || isViewer || isBrigadier) && (
            <button
              className={`wf-subtab ${subTab === 'schedule' ? 'wf-subtab-active' : ''}`}
              onClick={() => setSubTab('schedule')}
            >
              График
            </button>
          )}
          <button
            className={`wf-subtab ${subTab === 'timesheet' ? 'wf-subtab-active' : ''}`}
            onClick={() => setSubTab('timesheet')}
          >
            Табель
          </button>
          {isAdmin && (
            <button
              className="wf-subtab wf-subtab-import"
              onClick={() => setShowCombinedImport(true)}
              title="Импортировать график и табель одновременно из Google Sheets"
            >
              ↓ Импорт График+Табель
            </button>
          )}
        </div>
      )}

      {/* Контент */}
      <div className="wf-content">
        {activeTab === 'reference' && <ReferenceTab />}

        {activeTab && PRODUCTIONS[activeTab] && subTab === 'employees' && (isAdmin || isManager) && (
          <EmployeesTab
            key={`employees-${activeTab}`}
            production={activeTab}
            canEdit={isAdmin || isManager}
          />
        )}

        {activeTab && PRODUCTIONS[activeTab] && subTab === 'schedule' && (isAdmin || isManager || isViewer || isBrigadier) && (
          <ScheduleTable
            key={`schedule-${activeTab}-${year}-${month}-${importKey}`}
            production={activeTab}
            year={year}
            month={month}
            canEdit={isAdmin || isManager}
            reference={reference}
          />
        )}

        {activeTab && PRODUCTIONS[activeTab] && subTab === 'timesheet' && (
          <TimesheetTable
            key={`timesheet-${activeTab}-${year}-${month}-${importKey}`}
            production={activeTab}
            year={year}
            month={month}
            canEdit={isAdmin || isManager || isBrigadier}
            onlyToday={isBrigadier}
            reference={reference}
          />
        )}

        {activeTab === 'analytics' && (
          <AnalyticsTab year={year} month={month} />
        )}

        {activeTab === 'matrix_analytics' && (
          <MatrixAnalyticsTab year={year} month={month} />
        )}

        {activeTab === 'export' && (
          <TimesheetExportTab userInfo={userInfo} />
        )}
      </div>

      {/* Комбинированный импорт */}
      {showCombinedImport && activeTab && PRODUCTIONS[activeTab] && (
        <CombinedImportModal
          production={activeTab}
          defaultYear={year}
          defaultMonth={month}
          onSuccess={(res, importedYear, importedMonth) => {
            // Переключаем месяц на импортированный и обновляем таблицы
            setYear(importedYear)
            setMonth(importedMonth)
            setImportKey(k => k + 1)
          }}
          onClose={() => setShowCombinedImport(false)}
        />
      )}
    </div>
  )
}
