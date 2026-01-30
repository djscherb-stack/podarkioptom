import { useRef, useState } from 'react'

const API = '/api'

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
      const data = await r.json()
      if (r.ok) {
        setMessage('Загружено. Обновляю...')
        onSuccess?.()
        setTimeout(() => window.location.reload(), 800)
      } else {
        setMessage(data.error || 'Ошибка загрузки')
      }
    } catch (err) {
      setMessage('Ошибка: ' + err.message)
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
