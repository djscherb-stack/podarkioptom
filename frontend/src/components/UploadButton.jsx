import { useRef, useState } from 'react'
import { API } from '../api'

export default function UploadButton({ onSuccess }) {
  const inputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState(null)

  const handleClick = () => inputRef.current?.click()

  const handleChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setMessage(null)
    const formData = new FormData()
    formData.append('file', file)
    try {
      const r = await fetch(`${API}/upload`, {
        method: 'POST',
        body: formData,
      })
      const ct = r.headers.get('content-type') || ''
      let data
      if (ct.includes('application/json')) {
        data = await r.json()
      } else {
        const text = await r.text()
        if (text.includes('<!DOCTYPE') || text.includes('<html')) {
          setMessage('Сервер не отвечает. Подождите минуту и попробуйте снова.')
          return
        }
        setMessage('Ошибка сервера. Проверьте размер файла (до 10 МБ).')
        return
      }
      if (r.ok) {
        setMessage('Загружено. Обновляю...')
        onSuccess?.()
        setTimeout(() => window.location.reload(), 800)
      } else {
        setMessage(data.error || 'Ошибка загрузки')
      }
    } catch (err) {
      setMessage('Ошибка: ' + err.message + '. Возможно, сервер ещё загружается.')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        onChange={handleChange}
        style={{ display: 'none' }}
      />
      <button
        type="button"
        className="btn-upload"
        onClick={handleClick}
        disabled={uploading}
        title="Загрузить Excel"
      >
        {uploading ? '...' : '📤 Excel'}
      </button>
      {message && <span className="upload-msg">{message}</span>}
    </>
  )
}
