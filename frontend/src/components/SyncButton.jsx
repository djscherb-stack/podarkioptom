import { useState, useRef } from 'react'
import { API, apiFetch } from '../api'

const STAGES = [
  { id: 'connect', label: 'Подключение к Google Drive...', pct: 15 },
  { id: 'scan', label: 'Сканирование папки...', pct: 40 },
  { id: 'download', label: 'Скачивание файлов...', pct: 70 },
  { id: 'done', label: 'Готово', pct: 100 },
]

export default function SyncButton({ onSuccess }) {
  const [syncing, setSyncing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [stage, setStage] = useState(0)
  const [progress, setProgress] = useState(0)
  const [log, setLog] = useState([])
  const [error, setError] = useState(null)
  const timerRef = useRef(null)

  const addLog = (msg, type = 'info') => {
    setLog(prev => [...prev, { msg, type, ts: new Date().toLocaleTimeString('ru-RU') }])
  }

  const startStage = (i) => {
    if (i < STAGES.length) {
      setStage(i)
      setProgress(STAGES[i].pct)
      addLog(STAGES[i].label)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    setExpanded(true)
    setLog([])
    setError(null)
    setStage(0)
    setProgress(STAGES[0].pct)
    addLog('Запуск синхронизации...')
    addLog(STAGES[0].label)
    addLog(STAGES[0].label)

    let stageIdx = 0
    const advanceStage = () => {
      stageIdx += 1
      if (stageIdx < STAGES.length) {
        startStage(stageIdx)
        timerRef.current = setTimeout(advanceStage, 800)
      }
    }
    timerRef.current = setTimeout(advanceStage, 600)

    try {
      const res = await apiFetch(`${API}/admin/sync-from-gdrive`)
      clearTimeout(timerRef.current)
      setStage(STAGES.length - 1)
      setProgress(100)
      addLog('Ответ получен.', 'info')

      if (res.ok) {
        const downloaded = res.downloaded || []
        const errors = res.errors || []
        if (downloaded.length > 0) {
          addLog(`Загружено файлов: ${downloaded.length}`, 'success')
          downloaded.forEach(f => addLog(`  ✓ ${f.name} → ${f.saved_as}`, 'success'))
          onSuccess?.()
          setTimeout(() => window.location.reload(), 800)
        } else if (errors.length > 0) {
          addLog('Ошибки при загрузке:', 'error')
          errors.forEach(e => addLog(`  ✗ ${e.file}: ${e.error}`, 'error'))
        } else {
          addLog('Новых файлов не найдено.', 'info')
        }
      } else {
        const err = res.error || res.detail || 'Ошибка синхронизации'
        addLog(err, 'error')
        setError(err)
      }
    } catch (e) {
      clearTimeout(timerRef.current)
      setProgress(100)
      const msg = e?.message || 'Ошибка соединения'
      addLog(msg, 'error')
      setError(msg)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="sync-wrap">
      <button
        type="button"
        className="btn-sync"
        onClick={handleSync}
        disabled={syncing}
        title="Синхронизировать из Google Drive"
      >
        {syncing ? '⏳' : '🔄'} Синхронизация
      </button>
      {expanded && (
        <div className="sync-panel">
          <div className="sync-panel-header">
            <span>Лог синхронизации</span>
            <button
              type="button"
              className="sync-panel-close"
              onClick={() => setExpanded(false)}
              aria-label="Свернуть"
            >
              ×
            </button>
          </div>
          <div className="sync-progress">
            <div className="sync-progress-bar">
              <div className="sync-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <span className="sync-progress-label">{STAGES[Math.min(stage, STAGES.length - 1)]?.label || ''}</span>
          </div>
          <div className="sync-log">
            {log.map((entry, i) => (
              <div key={i} className={`sync-log-line sync-log-${entry.type}`}>
                <span className="sync-log-time">{entry.ts}</span>
                <span className="sync-log-msg">{entry.msg}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
