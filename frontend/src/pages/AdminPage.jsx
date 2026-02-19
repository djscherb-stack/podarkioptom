import { useState, useEffect } from 'react'
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
  const navigate = useNavigate()

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

  return (
    <div className="admin-page">
      <h2>Админ-панель</h2>

      <section className="admin-upload-section">
        <h3>Загрузка данных</h3>
        <div className="admin-upload-buttons">
          <UploadButton />
          <SyncButton onSuccess={() => { loadSyncLog(); apiFetch(`${API}/admin/data-dates`).then(setDateRange).catch(() => {}) }} />
          <RefreshDataButton onSuccess={() => apiFetch(`${API}/admin/data-dates`).then(setDateRange).catch(() => {})} />
        </div>
      </section>

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
      </section>
    </div>
  )
}
