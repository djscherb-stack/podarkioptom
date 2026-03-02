import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch, API } from '../api'
import { fetchTheme, saveTheme, applyTheme, THEME_OPTIONS } from '../theme'
import UploadButton from '../components/UploadButton'
import SyncButton from '../components/SyncButton'
import RefreshDataButton from '../components/RefreshDataButton'
import './AdminPage.css'

function formatDate(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleString('ru-RU')
  } catch {
    return iso
  }
}

const PROD_LABELS = { tea: 'ЧАЙ', engraving: 'ГРАВИРОВКА', luminarc: 'ЛЮМИНАРК' }
const MONTH_SHORT = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек']

const ROLE_LABELS = {
  admin: 'Полный доступ', manager: 'Менеджер', brigadier: 'Бригадир',
  viewer: 'Просмотр', viewer_all: 'Просмотр (весь сайт)',
}
const PROD_OPTS = [
  { v: 'all', l: 'Все производства' },
  { v: 'tea', l: 'ЧАЙ' },
  { v: 'engraving', l: 'ГРАВИРОВКА' },
  { v: 'luminarc', l: 'ЛЮМИНАРК' },
]
const NAV_LABELS = {
  month: 'По месяцу', day: 'По дню', week: 'По неделе',
  months: 'Аналитика по месяцам', employee_output: 'Выработка сотрудников',
  employees: 'Сотрудники', disassembly: 'Разборка возвратов',
  disassembly_nomenclature: 'Номенклатура разборки', cost_check: 'Проверка стоимости',
  workforce: 'Графики и табели',
}

export default function AdminPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [theme, setTheme] = useState('dark')
  const [themeSaving, setThemeSaving] = useState(false)
  const [themeMsg, setThemeMsg] = useState(null)
  const [themeError, setThemeError] = useState(false)
  const [dateRange, setDateRange] = useState(null)
  const [syncLog, setSyncLog] = useState([])
  const [dataSources, setDataSources] = useState(null)
  const [wfChangelog, setWfChangelog] = useState(null)
  // Новые секции
  const [adminTab, setAdminTab] = useState('data')  // 'data' | 'users' | 'changelog' | 'roles'
  const [users, setUsers] = useState([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [editingUser, setEditingUser] = useState(null) // username
  const [editUserBuf, setEditUserBuf] = useState({})
  const [userMsg, setUserMsg] = useState(null)
  const [customRoles, setCustomRoles] = useState([])
  const [rolesLoading, setRolesLoading] = useState(false)
  const [newRole, setNewRole] = useState(null)
  const [roleMsg, setRoleMsg] = useState(null)
  const [replaceDisassemblyStep, setReplaceDisassemblyStep] = useState(null)
  const [replaceDisassemblyFiles, setReplaceDisassemblyFiles] = useState({})
  const [replaceDisassemblyMsg, setReplaceDisassemblyMsg] = useState(null)
  const [replaceDisassemblyLoading, setReplaceDisassemblyLoading] = useState(false)
  const [replaceDisassemblyLog, setReplaceDisassemblyLog] = useState([])
  const [replaceDisassemblyProgress, setReplaceDisassemblyProgress] = useState(null)
  const [replaceDisassemblyModalOpen, setReplaceDisassemblyModalOpen] = useState(false)
  const replaceLogEndRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (replaceDisassemblyModalOpen && replaceLogEndRef.current)
      replaceLogEndRef.current.scrollIntoView({ behavior: 'smooth' })
  }, [replaceDisassemblyModalOpen, replaceDisassemblyLog])

  const loadDataSources = () => {
    apiFetch(`${API}/admin/data-sources`)
      .then(setDataSources)
      .catch(() => setDataSources({ error: 'Не удалось загрузить' }))
  }

  const loadSyncLog = () => {
    apiFetch(`${API}/admin/sync-log`).then(r => setSyncLog(r.entries || [])).catch(() => setSyncLog([]))
  }

  useEffect(() => {
    apiFetch(`${API}/admin/data-dates`).then(setDateRange).catch(() => setDateRange({ dates: [] }))
  }, [])

  useEffect(() => {
    apiFetch(`${API}/workforce/changelog?limit=300`)
      .then(r => setWfChangelog(r.entries || []))
      .catch(() => setWfChangelog([]))
  }, [])

  const loadUsers = () => {
    setUsersLoading(true)
    apiFetch(`${API}/admin/users`)
      .then(r => { setUsers(r.users || []); setUsersLoading(false) })
      .catch(() => setUsersLoading(false))
  }

  const loadCustomRoles = () => {
    setRolesLoading(true)
    apiFetch(`${API}/admin/custom-roles`)
      .then(r => { setCustomRoles(r.roles || []); setRolesLoading(false) })
      .catch(() => setRolesLoading(false))
  }

  useEffect(() => {
    if (adminTab === 'users' && users.length === 0) loadUsers()
    if (adminTab === 'roles' && customRoles.length === 0) loadCustomRoles()
    if (adminTab === 'changelog' && wfChangelog === null) {
      apiFetch(`${API}/admin/workforce-changelog?limit=500`)
        .then(r => setWfChangelog(r.entries || []))
        .catch(() => setWfChangelog([]))
    }
  }, [adminTab])

  useEffect(() => {
    loadSyncLog()
  }, [])

  useEffect(() => {
    if (!error && data) loadDataSources()
  }, [error, data])

  useEffect(() => {
    fetchTheme().then(t => setTheme(t))
  }, [])

  useEffect(() => {
    fetch(`${API}/admin/login-history`, { credentials: 'include' })
      .then(async (r) => {
        if (r.status === 403) {
          setError('Доступ запрещён')
          setLoading(false)
          return
        }
        const ct = r.headers.get('content-type') || ''
        if (!ct.includes('application/json')) {
          setError('Ошибка сервера')
          setLoading(false)
          return
        }
        const d = await r.json()
        if (!r.ok) {
          setError(d.detail || d.error || 'Ошибка')
          setLoading(false)
          return
        }
        setData(d)
      })
      .catch((e) => {
        setError(e.message || 'Ошибка загрузки')
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="admin-page">
        <p>Загрузка...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="admin-page admin-error">
        <h2>Админ-панель</h2>
        <p className="admin-err-msg">{error}</p>
        <button type="button" className="admin-btn-back" onClick={() => navigate('/')}>
          На главную
        </button>
      </div>
    )
  }

  const { logins = [], by_user = {} } = data

  const handleSaveTheme = async () => {
    setThemeMsg(null)
    setThemeError(false)
    setThemeSaving(true)
    try {
      const t = await saveTheme(theme)
      applyTheme(t)
      setThemeMsg('Тема сохранена для всех пользователей')
    } catch (e) {
      setThemeMsg(e.message || 'Ошибка')
      setThemeError(true)
    } finally {
      setThemeSaving(false)
    }
  }

  const replaceDisassemblyStart = () => {
    if (!window.confirm('Внимание, эта кнопка перепишет все данные по разбору возвратов. Продолжить?')) return
    setReplaceDisassemblyMsg(null)
    setReplaceDisassemblyFiles({})
    setReplaceDisassemblyStep('select')
  }

  const replaceDisassemblySetFile = (prefix, file) => {
    setReplaceDisassemblyFiles(prev => ({ ...prev, [prefix]: file || null }))
  }

  const replaceDisassemblySubmit = async () => {
    const files = ['001', '002', '003', '004'].map(p => replaceDisassemblyFiles[p])
    if (files.some(f => !f)) {
      setReplaceDisassemblyMsg('Выберите все 4 файла (001, 002, 003, 004).')
      return
    }
    if (!window.confirm('Сейчас будут удалены все старые данные разборки и загружены данные из выбранных четырёх файлов. Точно хотите?')) return
    setReplaceDisassemblyMsg(null)
    setReplaceDisassemblyLoading(true)
    setReplaceDisassemblyLog(['Подготовка...', 'Отправка 4 файлов на сервер...'])
    setReplaceDisassemblyProgress(null)
    setReplaceDisassemblyModalOpen(true)
    try {
      const form = new FormData()
      form.append('file_001', files[0])
      form.append('file_002', files[1])
      form.append('file_003', files[2])
      form.append('file_004', files[3])
      const r = await fetch(`${API}/admin/replace-disassembly`, { method: 'POST', credentials: 'include', body: form })
      const data = await r.json().catch(() => ({}))
      const serverLog = Array.isArray(data.log) ? data.log : []
      setReplaceDisassemblyLog(prev => [...prev, '', 'Ответ сервера:', ...serverLog])
      setReplaceDisassemblyProgress(100)
      if (!r.ok) {
        setReplaceDisassemblyMsg(data.error || 'Ошибка загрузки')
        return
      }
      setReplaceDisassemblyMsg('Данные разборки перезагружены.')
      setReplaceDisassemblyStep(null)
      setReplaceDisassemblyFiles({})
      loadDataSources()
      apiFetch(`${API}/admin/data-dates`).then(setDateRange).catch(() => {})
    } catch (e) {
      setReplaceDisassemblyLog(prev => [...prev, '', `Ошибка: ${e.message || 'Ошибка сети'}`])
      setReplaceDisassemblyProgress(100)
      setReplaceDisassemblyMsg(e.message || 'Ошибка сети')
    } finally {
      setReplaceDisassemblyLoading(false)
    }
  }

  const closeReplaceDisassemblyModal = () => {
    setReplaceDisassemblyModalOpen(false)
    setReplaceDisassemblyLog([])
    setReplaceDisassemblyProgress(null)
  }

  return (
    <div className="admin-page">
      <h2>Админ-панель</h2>

      {/* Навигация по разделам */}
      <div className="admin-tabs">
        {[
          ['data',      '⚙️ Данные'],
          ['users',     '👥 Пользователи'],
          ['changelog', '📋 Журнал изменений'],
          ['roles',     '🔐 Роли'],
        ].map(([id, label]) => (
          <button
            key={id}
            className={`admin-tab-btn ${adminTab === id ? 'active' : ''}`}
            onClick={() => setAdminTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ═══════════════════════ ДАННЫЕ ════════════════════════════════════ */}
      {adminTab === 'data' && (<>
        <section className="admin-upload-section">
        <h3>Загрузка данных</h3>
        <div className="admin-upload-buttons">
          <UploadButton />
          <SyncButton onSuccess={() => { loadSyncLog(); apiFetch(`${API}/admin/data-dates`).then(setDateRange).catch(() => {}) }} />
          <RefreshDataButton onSuccess={() => apiFetch(`${API}/admin/data-dates`).then(setDateRange).catch(() => {})} />
        </div>
      </section>

      <section className="admin-replace-disassembly-section">
        <h3>Перезагрузка данных разборки</h3>
        <p className="admin-replace-disassembly-hint">
          Удалить все текущие файлы разборки (001–004) и заменить их четырьмя выбранными файлами. Используйте для исправления исходных данных. Дальнейшая загрузка идёт по расписанию из Google Drive.
        </p>
        {replaceDisassemblyStep !== 'select' && (
          <button
            type="button"
            className="admin-btn-replace-disassembly"
            onClick={replaceDisassemblyStart}
            disabled={replaceDisassemblyLoading}
          >
            Перезагрузить данные разборки
          </button>
        )}
        {replaceDisassemblyStep === 'select' && (
          <div className="admin-replace-disassembly-files">
            <p className="admin-replace-disassembly-select-hint">Выберите 4 файла Excel в порядке 001, 002, 003, 004:</p>
            {['001', '002', '003', '004'].map(prefix => (
              <label key={prefix} className="admin-replace-disassembly-row">
                <span className="admin-replace-disassembly-label">{prefix}:</span>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={e => replaceDisassemblySetFile(prefix, e.target.files?.[0])}
                />
                <span className="admin-replace-disassembly-filename">{replaceDisassemblyFiles[prefix]?.name || '—'}</span>
              </label>
            ))}
            <div className="admin-replace-disassembly-actions">
              <button type="button" className="admin-btn-secondary" onClick={() => { setReplaceDisassemblyStep(null); setReplaceDisassemblyFiles({}); setReplaceDisassemblyMsg(null) }}>
                Отмена
              </button>
              <button type="button" className="admin-btn-replace-disassembly-submit" onClick={replaceDisassemblySubmit} disabled={replaceDisassemblyLoading}>
                {replaceDisassemblyLoading ? 'Загрузка…' : 'Удалить старые и загрузить эти 4 файла'}
              </button>
            </div>
          </div>
        )}
        {replaceDisassemblyMsg && <p className={`admin-replace-disassembly-msg ${replaceDisassemblyMsg.includes('перезагружены') ? 'admin-replace-disassembly-msg-ok' : 'admin-replace-disassembly-msg-error'}`}>{replaceDisassemblyMsg}</p>}
      </section>

      {replaceDisassemblyModalOpen && (
        <div className="admin-replace-modal-overlay" role="dialog" aria-labelledby="replace-modal-title">
          <div className="admin-replace-modal">
            <h3 id="replace-modal-title" className="admin-replace-modal-title">Перезагрузка данных разборки</h3>
            <div className="admin-replace-modal-progress-wrap">
              <div
                className={`admin-replace-modal-progress-bar ${replaceDisassemblyProgress === null ? 'indeterminate' : ''}`}
                style={replaceDisassemblyProgress !== null ? { width: `${replaceDisassemblyProgress}%` } : undefined}
              />
            </div>
            <p className="admin-replace-modal-progress-label">
              {replaceDisassemblyProgress === null ? 'Выполняется…' : replaceDisassemblyProgress === 100 ? 'Завершено' : `${replaceDisassemblyProgress}%`}
            </p>
            <div className="admin-replace-modal-log" role="log">
              {replaceDisassemblyLog.map((line, i) => (
                <div key={i} className="admin-replace-modal-log-line">{line || '\u00A0'}</div>
              ))}
              <div ref={replaceLogEndRef} />
            </div>
            <div className="admin-replace-modal-actions">
              <button type="button" className="admin-btn-replace-modal-close" onClick={closeReplaceDisassemblyModal}>
                {replaceDisassemblyProgress === 100 ? 'Закрыть' : 'Закрыть (операция может продолжаться)'}
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="admin-data-sources-section">
        <h3>Источники данных</h3>
        <p className="admin-data-sources-hint">
          Какие файлы загружены и попали в аналитику. Обновить: <button type="button" className="admin-btn-link" onClick={loadDataSources}>↻</button>
        </p>
        {dataSources?.error && <p className="admin-data-sources-error">{dataSources.error}</p>}
        {dataSources && !dataSources.error && (
          <div className="admin-data-sources-grid">
            {dataSources.disassembly && typeof dataSources.disassembly === 'object' && !dataSources.disassembly.error && (
              <>
                {['001', '002', '003', '004'].map((key) => {
                  const d = dataSources.disassembly[key] || {}
                  return (
                    <div key={key} className="admin-data-source-card">
                      <span className="admin-data-source-type">{key}</span>
                      <span className="admin-data-source-label">{d.label || key}</span>
                      <span className="admin-data-source-file" title={d.file || ''}>{d.file || '—'}</span>
                      <span className="admin-data-source-stats">Строк: {d.rows ?? '—'}, дат: {d.dates ?? '—'}</span>
                    </div>
                  )
                })}
              </>
            )}
            {dataSources.disassembly?.error && (
              <div className="admin-data-source-card admin-data-source-error">Разборка: {dataSources.disassembly.error}</div>
            )}
            {dataSources.prices && (
              <div className="admin-data-source-card">
                <span className="admin-data-source-type">Прайс</span>
                <span className="admin-data-source-label">{dataSources.prices.label}</span>
                <span className="admin-data-source-file">{dataSources.prices.file}</span>
                <span className="admin-data-source-stats">
                  {dataSources.prices.exists ? `Позиций: ${dataSources.prices.count}` : 'Файл не найден'}
                </span>
              </div>
            )}
            {dataSources.production && (
              <div className="admin-data-source-card">
                <span className="admin-data-source-type">Выпуск</span>
                <span className="admin-data-source-label">{dataSources.production.label}</span>
                <span className="admin-data-source-stats">Строк: {dataSources.production.rows}, дат: {dataSources.production.dates}</span>
              </div>
            )}
            {dataSources.employee_output && (
              <div className="admin-data-source-card">
                <span className="admin-data-source-type">Выработка</span>
                <span className="admin-data-source-label">{dataSources.employee_output.label}</span>
                <span className="admin-data-source-stats">Строк: {dataSources.employee_output.rows}, дат: {dataSources.employee_output.dates}</span>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="admin-sync-log-section">
        <h3>Лог синхронизации Google Drive</h3>
        <p className="admin-sync-log-hint">Запуски по расписанию (cron) и вручную (кнопка). Обновить: <button type="button" className="admin-btn-link" onClick={loadSyncLog}>↻</button></p>
        {syncLog.length === 0 ? (
          <p className="admin-sync-log-empty">Записей пока нет</p>
        ) : (
          <div className="admin-sync-log-list">
            {syncLog.map((e, i) => (
              <div key={i} className={`admin-sync-log-entry ${e.ok ? '' : 'admin-sync-log-entry-error'}`}>
                <div className="admin-sync-log-header">
                  <span className="admin-sync-log-time">{formatDate(e.at)}</span>
                  <span className={`admin-sync-log-source ${e.source === 'cron' ? 'admin-sync-log-cron' : ''}`}>{e.source === 'cron' ? 'cron' : 'админка'}</span>
                  <span className={`admin-sync-log-status ${e.ok ? 'admin-sync-log-ok' : 'admin-sync-log-fail'}`}>{e.ok ? 'OK' : 'Ошибка'}</span>
                </div>
                {e.error && <div className="admin-sync-log-msg admin-sync-log-error">Ошибка: {e.error}</div>}
                {e.downloaded?.length > 0 && (
                  <div className="admin-sync-log-msg admin-sync-log-success">Загружено: {e.downloaded.map(f => f.name).join(', ')}</div>
                )}
                {e.errors?.length > 0 && (
                  <div className="admin-sync-log-msg admin-sync-log-error">Ошибки файлов: {e.errors.map(er => `${er.file}: ${er.error}`).join('; ')}</div>
                )}
                {e.ok && !e.error && (!e.downloaded?.length) && (!e.errors?.length) && (
                  <div className="admin-sync-log-msg admin-sync-log-muted">Новых файлов не найдено</div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {dateRange && (
        <section className="admin-dates-section">
          <h3>Диагностика данных</h3>
          <p className="admin-dates-summary">
            Даты в системе: {dateRange.min_date || '—'} … {dateRange.max_date || '—'}
            {dateRange.dates?.length > 0 && ` (${dateRange.dates.length} дней)`}
          </p>
          {dateRange.dates?.length > 0 && (
            <div className="admin-dates-list">
              {(dateRange.dates.length <= 50
                ? dateRange.dates
                : [...dateRange.dates.slice(0, 10), { date: '...', rows: '' }, ...dateRange.dates.slice(-10)]
              ).map((d, i) => (
                <span key={d.date + i} className="admin-date-chip" title={d.rows ? `${d.rows} записей` : ''}>
                  {d.date}{d.rows ? ` (${d.rows})` : ''}
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="admin-theme-section">
        <h3>Цветовая схема</h3>
        <div className="admin-theme-options">
          {THEME_OPTIONS.map(opt => (
            <label key={opt.id} className="admin-theme-option">
              <input
                type="radio"
                name="theme"
                value={opt.id}
                checked={theme === opt.id}
                onChange={() => {
                  setTheme(opt.id)
                  applyTheme(opt.id)
                }}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
        <button
          type="button"
          className="admin-btn-save-theme"
          onClick={handleSaveTheme}
          disabled={themeSaving}
        >
          {themeSaving ? 'Сохранение...' : 'Сохранить для всех'}
        </button>
        {themeMsg && <p className={`admin-theme-msg ${themeError ? 'admin-theme-msg-error' : ''}`}>{themeMsg}</p>}
      </section>

      <section className="admin-summary">
        <h3>История входов — по пользователям</h3>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Пользователь</th>
              <th>Кол-во входов</th>
              <th>Последний вход</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(by_user).map(([user, info]) => (
              <tr key={user}>
                <td>{user}</td>
                <td>{info.count}</td>
                <td>{formatDate(info.last)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="admin-logins">
        <h3>Последние входы (по времени)</h3>
        <div style={{overflowY:'auto', maxHeight:'340px'}}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Пользователь</th>
                <th>Дата и время</th>
              </tr>
            </thead>
            <tbody>
              {logins.map((e, i) => (
                <tr key={i}>
                  <td>{e.username}</td>
                  <td>{formatDate(e.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      </>)}

      {/* ═══════════════════════ ПОЛЬЗОВАТЕЛИ ══════════════════════════════ */}
      {adminTab === 'users' && (
        <section className="admin-upload-section">
          <div style={{display:'flex', gap:'0.75rem', alignItems:'center', marginBottom:'0.75rem'}}>
            <h3 style={{margin:0}}>Пользователи системы</h3>
            <button className="admin-btn-refresh-data" onClick={loadUsers} disabled={usersLoading}>
              {usersLoading ? '...' : '↻ Обновить'}
            </button>
            {userMsg && <span style={{fontSize:'0.82rem', color: userMsg.ok ? 'var(--positive)' : 'var(--negative)'}}>{userMsg.text}</span>}
          </div>
          <table className="admin-table" style={{fontSize:'0.82rem'}}>
            <thead>
              <tr>
                <th>Логин</th>
                <th>ФИО</th>
                <th>Роль</th>
                <th>Производство</th>
                <th>Входов</th>
                <th>Последний вход</th>
                <th>Действие</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.username} style={{opacity: u.is_system ? 0.75 : 1}}>
                  <td>
                    <span style={{fontFamily:'monospace', fontSize:'0.78rem'}}>{u.username}</span>
                    {u.is_admin && <span style={{marginLeft:'4px', fontSize:'0.7rem', background:'#b86b6b', color:'#fff', borderRadius:'3px', padding:'0 4px'}}>admin</span>}
                  </td>
                  <td>{u.full_name}</td>
                  {editingUser === u.username ? (
                    <>
                      <td>
                        <select style={{fontSize:'0.8rem', padding:'2px 4px', background:'var(--bg)', color:'var(--text)', border:'1px solid var(--accent)', borderRadius:'4px'}}
                          value={editUserBuf.role}
                          onChange={e => setEditUserBuf(b => ({...b, role: e.target.value}))}>
                          {['admin','manager','brigadier','viewer'].map(r => (
                            <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select style={{fontSize:'0.8rem', padding:'2px 4px', background:'var(--bg)', color:'var(--text)', border:'1px solid var(--accent)', borderRadius:'4px'}}
                          value={editUserBuf.production}
                          onChange={e => setEditUserBuf(b => ({...b, production: e.target.value}))}>
                          {PROD_OPTS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                        </select>
                      </td>
                      <td>{u.login_count}</td>
                      <td>{formatDate(u.last_login)}</td>
                      <td style={{display:'flex', gap:'4px'}}>
                        <button className="admin-btn-refresh-data" style={{padding:'2px 8px', fontSize:'0.78rem'}}
                          onClick={async () => {
                            try {
                              await apiFetch(`${API}/admin/users/${encodeURIComponent(u.username)}/role`, {
                                method: 'PUT',
                                body: JSON.stringify({role: editUserBuf.role, production: editUserBuf.production}),
                              })
                              setUserMsg({text: `Роль ${u.username} обновлена`, ok: true})
                              setTimeout(() => setUserMsg(null), 3000)
                              loadUsers()
                            } catch(e) { setUserMsg({text: e.message, ok: false}) }
                            setEditingUser(null)
                          }}>✓</button>
                        {u.has_override && (
                          <button style={{padding:'2px 8px', fontSize:'0.78rem', background:'none', border:'1px solid var(--border)', borderRadius:'4px', cursor:'pointer', color:'var(--text-muted)'}}
                            title="Сбросить к дефолту"
                            onClick={async () => {
                              await apiFetch(`${API}/admin/users/${encodeURIComponent(u.username)}/role`, {method:'DELETE'})
                              loadUsers()
                            }}>↺</button>
                        )}
                        <button style={{padding:'2px 8px', fontSize:'0.78rem', background:'none', border:'1px solid var(--border)', borderRadius:'4px', cursor:'pointer', color:'var(--negative)'}}
                          onClick={() => setEditingUser(null)}>✕</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>
                        <span style={{background:'rgba(91,143,201,0.15)', color:'var(--accent)', borderRadius:'4px', padding:'1px 6px', fontSize:'0.78rem'}}>
                          {ROLE_LABELS[u.role] || u.role}
                        </span>
                        {u.has_override && <span title="Изменено вручную" style={{marginLeft:'3px', fontSize:'0.7rem', opacity:0.6}}>✎</span>}
                      </td>
                      <td style={{fontSize:'0.8rem'}}>{PROD_LABELS[u.production] || u.production || '—'}</td>
                      <td>{u.login_count}</td>
                      <td style={{fontSize:'0.78rem', color:'var(--text-muted)'}}>{formatDate(u.last_login)}</td>
                      <td>
                        {!u.is_system && (
                          <button className="admin-btn-refresh-data" style={{padding:'2px 8px', fontSize:'0.78rem'}}
                            onClick={() => { setEditingUser(u.username); setEditUserBuf({role: u.role, production: u.production}) }}>
                            ✎ Изменить
                          </button>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ═══════════════════════ ЖУРНАЛ ИЗМЕНЕНИЙ ══════════════════════════ */}
      {adminTab === 'changelog' && (
        <section className="admin-upload-section">
          <h3>Журнал изменений графиков и табелей</h3>
          {(!wfChangelog || wfChangelog.length === 0) ? (
            <p style={{color:'var(--text-muted)', fontSize:'0.85rem'}}>
              {wfChangelog === null ? 'Загрузка...' : 'Изменений ещё не было.'}
            </p>
          ) : (
            <div style={{overflowY:'auto', maxHeight:'520px'}}>
              <table className="admin-table" style={{fontSize:'0.82rem'}}>
                <thead>
                  <tr>
                    <th>Дата и время</th>
                    <th>Пользователь</th>
                    <th>Действие</th>
                    <th>Производство</th>
                    <th>Период</th>
                    <th>Детали</th>
                  </tr>
                </thead>
                <tbody>
                  {wfChangelog.map((e, i) => (
                    <tr key={i}>
                      <td style={{whiteSpace:'nowrap'}}>{formatDate(e.at)}</td>
                      <td><strong>{e.username}</strong></td>
                      <td>{e.action}</td>
                      <td>{e.production ? (PROD_LABELS[e.production] || e.production) : '—'}</td>
                      <td style={{whiteSpace:'nowrap'}}>
                        {e.year && e.month ? `${MONTH_SHORT[e.month - 1]} ${e.year}` : '—'}
                      </td>
                      <td style={{color:'var(--text-muted)', maxWidth:'280px', wordBreak:'break-all'}}>{e.details || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ═══════════════════════ РОЛИ ═══════════════════════════════════════ */}
      {adminTab === 'roles' && (
        <section className="admin-upload-section">
          <div style={{display:'flex', gap:'0.75rem', alignItems:'center', marginBottom:'0.75rem'}}>
            <h3 style={{margin:0}}>Кастомные роли</h3>
            <button className="admin-btn-refresh-data"
              onClick={() => setNewRole({name:'', workforce_role:'brigadier', workforce_production:'tea', nav_items: Object.keys(NAV_LABELS).filter(k => k === 'workforce')})}>
              + Создать роль
            </button>
            {roleMsg && <span style={{fontSize:'0.82rem', color: roleMsg.ok ? 'var(--positive)' : 'var(--negative)'}}>{roleMsg.text}</span>}
          </div>

          {/* Форма создания / редактирования */}
          {newRole && (
            <div style={{background:'var(--bg)', border:'1px solid var(--accent)', borderRadius:'8px', padding:'1rem', marginBottom:'1rem'}}>
              <h4 style={{margin:'0 0 0.75rem', fontSize:'0.95rem'}}>{newRole.id ? 'Редактировать роль' : 'Новая роль'}</h4>
              <div style={{display:'flex', flexWrap:'wrap', gap:'0.75rem', marginBottom:'0.75rem'}}>
                <label style={{display:'flex', flexDirection:'column', gap:'3px', fontSize:'0.8rem', color:'var(--text-muted)'}}>
                  Название роли
                  <input style={{padding:'4px 8px', background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:'4px', color:'var(--text)', minWidth:'200px'}}
                    value={newRole.name} placeholder="Например: Бригадир Чая"
                    onChange={e => setNewRole(r => ({...r, name: e.target.value}))} />
                </label>
                <label style={{display:'flex', flexDirection:'column', gap:'3px', fontSize:'0.8rem', color:'var(--text-muted)'}}>
                  Уровень доступа (Графики/Табели)
                  <select style={{padding:'4px 8px', background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:'4px', color:'var(--text)'}}
                    value={newRole.workforce_role}
                    onChange={e => setNewRole(r => ({...r, workforce_role: e.target.value}))}>
                    {Object.entries(ROLE_LABELS).filter(([k]) => ['admin','manager','brigadier','viewer'].includes(k)).map(([k,v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </label>
                <label style={{display:'flex', flexDirection:'column', gap:'3px', fontSize:'0.8rem', color:'var(--text-muted)'}}>
                  Производство
                  <select style={{padding:'4px 8px', background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:'4px', color:'var(--text)'}}
                    value={newRole.workforce_production}
                    onChange={e => setNewRole(r => ({...r, workforce_production: e.target.value}))}>
                    {PROD_OPTS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                </label>
              </div>
              <div style={{marginBottom:'0.75rem'}}>
                <div style={{fontSize:'0.8rem', color:'var(--text-muted)', marginBottom:'0.4rem', fontWeight:600}}>Доступные пункты левого меню:</div>
                <div style={{display:'flex', flexWrap:'wrap', gap:'0.5rem'}}>
                  {Object.entries(NAV_LABELS).map(([k, label]) => (
                    <label key={k} style={{display:'flex', alignItems:'center', gap:'4px', fontSize:'0.82rem', cursor:'pointer', padding:'3px 8px', border:'1px solid var(--border)', borderRadius:'4px', background: (newRole.nav_items || []).includes(k) ? 'rgba(91,143,201,0.15)' : 'transparent'}}>
                      <input type="checkbox"
                        checked={(newRole.nav_items || []).includes(k)}
                        onChange={e => setNewRole(r => ({
                          ...r,
                          nav_items: e.target.checked
                            ? [...(r.nav_items || []), k]
                            : (r.nav_items || []).filter(x => x !== k)
                        }))} />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
              <div style={{display:'flex', gap:'0.5rem'}}>
                <button className="admin-btn-refresh-data"
                  onClick={async () => {
                    if (!newRole.name.trim()) { setRoleMsg({text:'Введите название роли', ok:false}); return }
                    try {
                      const method = newRole.id ? 'PUT' : 'POST'
                      const url = newRole.id ? `${API}/admin/custom-roles/${newRole.id}` : `${API}/admin/custom-roles`
                      await apiFetch(url, {method, body: JSON.stringify(newRole)})
                      setRoleMsg({text: `Роль «${newRole.name}» сохранена`, ok: true})
                      setTimeout(() => setRoleMsg(null), 3000)
                      setNewRole(null)
                      loadCustomRoles()
                    } catch(e) { setRoleMsg({text: e.message, ok:false}) }
                  }}>
                  Сохранить роль
                </button>
                <button style={{padding:'4px 12px', background:'none', border:'1px solid var(--border)', borderRadius:'4px', cursor:'pointer', color:'var(--text-muted)'}}
                  onClick={() => setNewRole(null)}>Отмена</button>
              </div>
            </div>
          )}

          {/* Список кастомных ролей */}
          {rolesLoading ? <p>Загрузка...</p> : customRoles.length === 0 ? (
            <p style={{color:'var(--text-muted)', fontSize:'0.85rem'}}>Кастомных ролей ещё нет. Нажмите «+ Создать роль».</p>
          ) : (
            <table className="admin-table" style={{fontSize:'0.82rem'}}>
              <thead>
                <tr><th>Название</th><th>Уровень</th><th>Производство</th><th>Пункты меню</th><th></th></tr>
              </thead>
              <tbody>
                {customRoles.map(r => (
                  <tr key={r.id}>
                    <td><strong>{r.name}</strong></td>
                    <td>{ROLE_LABELS[r.workforce_role] || r.workforce_role}</td>
                    <td>{PROD_LABELS[r.workforce_production] || r.workforce_production || '—'}</td>
                    <td style={{fontSize:'0.75rem', color:'var(--text-muted)'}}>
                      {(r.nav_items || []).map(k => NAV_LABELS[k] || k).join(', ') || 'не задано'}
                    </td>
                    <td style={{display:'flex', gap:'4px'}}>
                      <button className="admin-btn-refresh-data" style={{padding:'2px 8px', fontSize:'0.78rem'}}
                        onClick={() => setNewRole({...r})}>✎</button>
                      <button style={{padding:'2px 8px', fontSize:'0.78rem', background:'none', border:'1px solid var(--border)', borderRadius:'4px', cursor:'pointer', color:'var(--negative)'}}
                        onClick={async () => {
                          if (!confirm(`Удалить роль «${r.name}»?`)) return
                          await apiFetch(`${API}/admin/custom-roles/${r.id}`, {method:'DELETE'})
                          loadCustomRoles()
                        }}>🗑</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div style={{marginTop:'1rem', padding:'0.6rem 0.9rem', background:'var(--bg)', border:'1px solid var(--border)', borderRadius:'6px', fontSize:'0.78rem', color:'var(--text-muted)'}}>
            💡 После создания роли назначьте её пользователям на вкладке <strong>«Пользователи»</strong>.
            Пункты меню контролируют видимость разделов сайта для этой роли.
          </div>
        </section>
      )}
    </div>
  )
}
