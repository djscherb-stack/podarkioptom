import { useState } from 'react'
import { API, apiFetch } from '../api'

export default function RefreshDataButton({ onSuccess }) {
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState(null)
  const [error, setError] = useState(false)

  const handleRefresh = async () => {
    setLoading(true)
    setMsg(null)
    setError(false)
    try {
      const res = await apiFetch(`${API}/admin/refresh`)
      if (res?.status === 'ok') {
        setMsg('Данные пересчитаны')
        onSuccess?.()
      } else {
        setMsg(res?.error || res?.detail || 'Ошибка')
        setError(true)
      }
    } catch (e) {
      setMsg(e?.message || 'Ошибка соединения')
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="refresh-data-wrap">
      <button
        type="button"
        className="admin-btn-refresh-data"
        onClick={handleRefresh}
        disabled={loading}
        title="Пересчитать данные из файлов по новым правилам (выпуск и выработка)"
      >
        {loading ? '⏳ Обновление...' : '⟳ Обновить данные'}
      </button>
      {msg && (
        <span className={`admin-refresh-msg ${error ? 'admin-refresh-msg-error' : ''}`}>
          {msg}
        </span>
      )}
    </div>
  )
}
