import { useRef, useState } from 'react'
import { API } from '../api'

export default function UploadButton({ onSuccess }) {
  const inputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState(null)

  const handleClick = () => inputRef.current?.click()

  const handleChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setProgress(0)
    setMessage(null)
    const formData = new FormData()
    formData.append('file', file)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API}/upload`)
    xhr.withCredentials = true

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        setProgress(Math.round((ev.loaded / ev.total) * 100))
      } else {
        setProgress(Math.min(90, (ev.loaded / (file.size || 1)) * 80))
      }
    }

    xhr.onload = () => {
      setProgress(100)
      const ct = xhr.getResponseHeader('content-type') || ''
      try {
        const data = ct.includes('application/json') ? JSON.parse(xhr.responseText) : null
        if (xhr.ok && data) {
          setMessage('Загружено. Обновляю...')
          onSuccess?.()
          setTimeout(() => window.location.reload(), 600)
        } else if (data?.error) {
          setMessage(data.error)
        } else if (!ct.includes('application/json')) {
          if ((xhr.responseText || '').includes('<!DOCTYPE')) {
            setMessage('Сервер не отвечает. Подождите минуту и попробуйте снова.')
          } else {
            setMessage('Ошибка сервера. Проверьте размер файла (до 15 МБ).')
          }
        } else {
          setMessage('Ошибка загрузки')
        }
      } catch {
        setMessage('Ошибка ответа сервера')
      }
      setUploading(false)
      e.target.value = ''
    }

    xhr.onerror = () => {
      setMessage('Ошибка соединения')
      setUploading(false)
      e.target.value = ''
    }

    xhr.send(formData)
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
      <div className="upload-wrap">
        <button
          type="button"
          className="btn-upload"
          onClick={handleClick}
          disabled={uploading}
          title="Загрузить Excel"
        >
          {uploading ? `${progress}%` : '📤 Excel'}
        </button>
        {uploading && (
          <div className="upload-progress">
            <div className="upload-progress-bar" style={{ width: `${progress}%` }} />
          </div>
        )}
        {message && <span className="upload-msg">{message}</span>}
      </div>
    </>
  )
}
